/**
 * Server-side Club Admin Weekly Action Centre handlers (`lib/action-centre-server.ts`).
 */
import { FieldValue } from "firebase-admin/firestore";
import {
  evaluateWeeklyActionCentre,
  type ActionCentreId,
} from "./action-centre.ts";
import { POTW_BADGE_TYPE, istDate, weekendOpsMode } from "./weekend-ops.ts";
import { actorNameFor, writeServerAudit } from "./server-audit.ts";

const VALID_ACTION_IDS: ReadonlySet<string> = new Set([
  "add_squad",
  "share_match",
  "add_results",
  "add_potw",
  "add_actual_fee",
]);

export class ActionCentreHttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function getActionCentreState(
  db: any,
  actorUid: string,
  nowMs: number = Date.now(),
) {
  const DAY = 24 * 60 * 60 * 1000;
  const since = istDate(nowMs - 36 * DAY);

  const [matchSnap, badgeSnap, postSnap, userSnap] = await Promise.all([
    db.collection("matches").where("date", ">=", since).get(),
    db.collection("badges").where("badgeType", "==", POTW_BADGE_TYPE).get(),
    db.collection("posts").where("kind", "==", "potw").get(),
    db.collection("appUsers").doc(actorUid).get(),
  ]);

  const matches = (matchSnap?.docs || []).map((d: any) => ({
    ...(d.data() || {}),
    id: d.id,
  }));

  const squadCountByMatchId = new Map<string, number>();
  await Promise.all(
    matches.map(async (m: any) => {
      const paySnap = await db
        .collection("matches")
        .doc(m.id)
        .collection("payments")
        .get();
      const count = (paySnap?.docs || []).filter((pd: any) => {
        const data = pd.data() || {};
        return !data.guestName && data.status !== "Not Playing" && data.availability !== "No";
      }).length;
      squadCountByMatchId.set(m.id, count);
    }),
  );

  const awardedWeekendIds = new Set<string>();
  for (const d of badgeSnap?.docs || []) {
    const wid = d.data()?.weekendId;
    if (wid) awardedWeekendIds.add(String(wid));
  }
  for (const d of postSnap?.docs || []) {
    const wid = d.data()?.potw?.weekendId;
    if (wid) awardedWeekendIds.add(String(wid));
  }

  const { currentWeek, history } = evaluateWeeklyActionCentre({
    nowMs,
    mode: weekendOpsMode(),
    matches,
    squadCountByMatchId,
    awardedWeekendIds,
  });

  const userData = userSnap?.exists ? userSnap.data() || {} : {};
  const dismissedPopups: Record<string, string> =
    userData.dismissedActionCentrePopups &&
    typeof userData.dismissedActionCentrePopups === "object"
      ? userData.dismissedActionCentrePopups
      : {};

  return {
    now: nowMs,
    currentWeek,
    history,
    dismissedPopups,
  };
}

export async function dismissActionCentrePopup(
  db: any,
  actorUid: string,
  actionId: string,
  weekId: string,
) {
  if (!VALID_ACTION_IDS.has(actionId)) {
    throw new ActionCentreHttpError(400, "Invalid action ID.");
  }
  if (typeof weekId !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(weekId)) {
    throw new ActionCentreHttpError(400, "Invalid week ID.");
  }

  const userRef = db.collection("appUsers").doc(actorUid);
  await db.runTransaction(async (tx: any) => {
    const snap = await tx.get(userRef);
    const existing = snap.exists ? snap.data() || {} : {};
    const prevMap =
      existing.dismissedActionCentrePopups &&
      typeof existing.dismissedActionCentrePopups === "object"
        ? existing.dismissedActionCentrePopups
        : {};
    const nextMap = { ...prevMap, [actionId as ActionCentreId]: weekId };
    if (snap.exists) {
      tx.update(userRef, {
        dismissedActionCentrePopups: nextMap,
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else {
      tx.set(
        userRef,
        {
          dismissedActionCentrePopups: nextMap,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }
  });

  return { ok: true, actionId, weekId };
}

export async function recordMatchSquadShare(
  db: any,
  actorUid: string,
  matchId: string,
) {
  const cleanId = typeof matchId === "string" ? matchId.trim() : "";
  if (!cleanId) {
    throw new ActionCentreHttpError(400, "Match ID is required.");
  }

  const matchRef = db.collection("matches").doc(cleanId);
  await db.runTransaction(async (tx: any) => {
    const snap = await tx.get(matchRef);
    if (!snap.exists) {
      throw new ActionCentreHttpError(404, "Match not found.");
    }
    const data = snap.data() || {};
    const opponent = typeof data.opponent === "string" && data.opponent ? data.opponent : "TBD";
    tx.update(matchRef, {
      squadShareInitiatedAt: FieldValue.serverTimestamp(),
      squadShareInitiatedBy: actorUid,
      updatedAt: FieldValue.serverTimestamp(),
    });
    const actorName = await actorNameFor(db, actorUid);
    await writeServerAudit(
      db,
      {
        actorId: actorUid,
        actorName,
        action: "updated",
        entity: "match",
        entityId: cleanId,
        entityLabel: `vs ${opponent}`,
        changes: [
          {
            field: "squadShareInitiatedBy",
            oldValue: typeof data.squadShareInitiatedBy === "string" ? data.squadShareInitiatedBy : "",
            newValue: actorUid,
          },
        ],
        summary: `Initiated WhatsApp squad share for match vs ${opponent}`,
      },
      tx,
    );
  });

  return { ok: true, matchId: cleanId };
}
