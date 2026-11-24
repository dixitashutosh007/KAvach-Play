/**
 * POST /api/admin/player-of-weekend — grant the Player of the Weekend award (Feature B).
 *
 * Auth: Club Admin or Super Admin — the existing badge-award authority
 * (Firestore rules `badges` create: isClubAdmin()). Players cannot reach it.
 *
 * Body: { weekendId, playerId, message?, source?: "prompt" | "history" }
 *   prompt (default): weekendId must be the weekend whose award window is open
 *     now (Monday 08:00 → Friday 23:59 IST).
 *   history: an explicit Historical Data Completion decision for a past
 *     weekend (on/after POTW_HISTORY_FROM, at least one played match, not the
 *     open weekend). Creates the badge, notification and audit entry but NO Home
 *     banner post — an old award must not displace the current banner.
 *   message: optional, ≤ 4 lines / 120 characters.
 *
 * One transaction with deterministic ids (potw_<weekendId>): the badge, the
 * banner announcement post, the player's notification (if the player has a
 * linked login) and an audit entry are created together or not at all. If the
 * badge already exists (retry, double click, two admins at once) nothing is
 * written and 409 is returned with the existing award → exactly one award,
 * one badge, one banner and one notification per weekend.
 */
import { NextResponse } from "next/server.js";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { requireRole } from "../../../../lib/server-auth.ts";
import { getServerFirestore } from "../../../../lib/server-db.ts";
import { actorNameFor, writeServerAudit } from "../../../../lib/server-audit.ts";
import {
  isHistoricalPotwWeekend,
  POTW_BADGE_TYPE,
  potwHistoryFrom,
  potwIds,
  potwWindow,
  validatePotwMessage,
  weekendLabel,
  type MatchLike,
} from "../../../../lib/weekend-ops.ts";
import { isSafeId, POTW_AWARD_ROLES, serverNow } from "../../../../lib/weekend-ops-server.ts";

const NOTIFICATION_TTL_DAYS = 90;

class RequestError extends Error {
  status: number;
  extra: Record<string, unknown>;
  constructor(status: number, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export async function POST(req: Request) {
  const guard = await requireRole(req, [...POTW_AWARD_ROLES]);
  if (!guard.ok) return guard.response;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const db = getServerFirestore();
  const now = serverNow(req);

  try {
    const historical = body?.source === "history";
    if (!isSafeId(body?.playerId)) throw new RequestError(400, "Select a player.");
    const msg = validatePotwMessage(body?.message);
    if (!msg.ok) throw new RequestError(400, msg.error);
    const playerId: string = body.playerId;
    let weekendId: string;
    if (historical) {
      weekendId = typeof body?.weekendId === "string" ? body.weekendId : "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(weekendId)) throw new RequestError(400, "Choose a weekend.");
    } else {
      const window = potwWindow(now);
      if (!window.open) throw new RequestError(409, "The Player of the Weekend window is closed (Monday 8:00 AM – Friday 11:59 PM IST).");
      if (body?.weekendId !== window.weekendId) throw new RequestError(400, "Awards can only be granted for the current weekend.");
      weekendId = window.weekendId;
    }
    const ids = potwIds(weekendId);

    // Independent reads in parallel: actor name, the linked login
    // (appUsers.playerId is the authoritative link; never assume uid == playerId)
    // and, for a historical award, that weekend's matches.
    const sunday = new Date(Date.parse(`${weekendId}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
    const [actorName, links, weekendSnap] = await Promise.all([
      actorNameFor(db, guard.uid),
      db.collection("appUsers").where("playerId", "==", playerId).limit(2).get(),
      historical ? db.collection("matches").where("date", ">=", weekendId).where("date", "<=", sunday).get() : Promise.resolve(null),
    ]);
    if (historical) {
      const wm = weekendSnap!.docs.map((d) => ({ ...(d.data() as any), id: d.id })) as MatchLike[];
      if (!isHistoricalPotwWeekend(weekendId, wm, now, potwHistoryFrom())) {
        throw new RequestError(400, "This weekend is not open for a historical award (no played match, too early, or the current weekend).");
      }
    }
    const recipientUid = links.size === 1 ? links.docs[0].id : null;

    const result = await db.runTransaction(async (tx) => {
      const badgeRef = db.collection("badges").doc(ids.badge);
      const postRef = db.collection("posts").doc(ids.post);
      const notifRef = db.collection("notifications").doc(ids.notification);
      const playerRef = db.collection("players").doc(playerId);
      const [badgeSnap, playerSnap] = await Promise.all([tx.get(badgeRef), tx.get(playerRef)]);
      if (badgeSnap.exists) {
        const b = badgeSnap.data() || {};
        throw new RequestError(409, `Player of the Weekend has already been awarded to ${b.playerName || "a player"}.`, {
          alreadyAwarded: true,
          award: { playerId: b.playerId, playerName: b.playerName, weekendId },
        });
      }
      if (!playerSnap.exists) throw new RequestError(404, "Player not found.");
      const player = playerSnap.data() || {};
      if (player.disabled || player.mergedInto) throw new RequestError(400, "This player record is not active.");
      const playerName = String(player.name || "Player").slice(0, 100);
      const photoURL = typeof player.photoURL === "string" && player.photoURL.startsWith("https://") ? player.photoURL.slice(0, 500) : "";
      const label = weekendLabel(weekendId);

      tx.create(badgeRef, {
        playerId,
        playerName,
        badgeType: POTW_BADGE_TYPE,
        weekendId,
        ...(historical ? { historical: true } : {}),
        ...(msg.value ? { note: msg.value } : {}),
        awardedBy: guard.uid,
        awardedByName: actorName,
        awardedAt: FieldValue.serverTimestamp(),
        redeemed: false,
      });
      if (!historical) tx.create(postRef, {
        id: ids.post,
        kind: "potw",
        title: "Player of the Weekend",
        text: msg.value ? `${playerName} — ${msg.value}` : `${playerName} is our Player of the Weekend (${label}).`,
        authorName: "KAvach Cricket Club",
        authorId: guard.uid,
        comments: [],
        isAnnouncement: true,
        isPinned: false,
        potw: { playerId, playerName, photoURL, message: msg.value, weekendId, weekendLabel: label },
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      if (recipientUid) {
        tx.create(notifRef, {
          userId: recipientUid,
          title: "You're the Player of the Weekend! 🏆",
          message: msg.value || `Congratulations — you've been named Player of the Weekend for ${label}.`,
          type: "in_app",
          metadata: { kind: "potw", weekendId, badgeId: ids.badge },
          isRead: false,
          createdAt: FieldValue.serverTimestamp(),
          expiresAt: Timestamp.fromMillis(now + NOTIFICATION_TTL_DAYS * 24 * 60 * 60 * 1000),
        });
      }
      await writeServerAudit(
        db,
        {
          actorId: guard.uid,
          actorName,
          action: "created",
          entity: "badge",
          entityId: ids.badge,
          entityLabel: `Player of the Weekend ${label}`,
          changes: [
            { field: "playerId", newValue: playerId },
            { field: "badgeType", newValue: POTW_BADGE_TYPE },
          ],
          summary: `Player of the Weekend (${label}) awarded to ${playerName}${historical ? " (historical data completion; no banner)" : ""}.${recipientUid ? "" : " No linked login — no notification sent."}`,
        },
        tx,
      );
      return { playerId, playerName, weekendId, historical, notified: Boolean(recipientUid) };
    });

    return NextResponse.json({ ok: true, award: result });
  } catch (err) {
    if (err instanceof RequestError) return NextResponse.json({ error: err.message, ...err.extra }, { status: err.status });
    // tx.create on an existing id (concurrent award) surfaces as ALREADY_EXISTS.
    if ((err as any)?.code === 6) return NextResponse.json({ error: "Player of the Weekend has already been awarded.", alreadyAwarded: true }, { status: 409 });
    console.error("[player-of-weekend] award failed");
    return NextResponse.json({ error: "Could not grant the award. Nothing was saved; try again." }, { status: 500 });
  }
}
