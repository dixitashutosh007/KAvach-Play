import crypto from "node:crypto";
import { NextResponse } from "next/server.js";
import { FieldValue } from "firebase-admin/firestore";
import { requireClubAdmin } from "../../../../../lib/server-auth.ts";
import { getServerFirestore } from "../../../../../lib/server-db.ts";
import { actorNameFor, writeServerAudit } from "../../../../../lib/server-audit.ts";
import { isSafeId } from "../../../../../lib/weekend-ops-server.ts";
import {
  computeTenureYears,
  evaluateCumulativeMilestones,
  RUNS_MILESTONES,
  TENURE_MILESTONES,
  WICKETS_MILESTONES,
} from "../../../../../lib/badge-milestones.ts";

function deterministicNonStackableBadgeId(playerId: string, badgeType: string): string {
  const digest = crypto
    .createHash("sha256")
    .update(`${playerId}\0${badgeType}`)
    .digest("hex")
    .slice(0, 32);
  return `ns_${digest}`;
}

function isContentionError(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code;
  const msg = err instanceof Error ? err.message : String(err);
  return (
    code === 6 ||
    code === 10 ||
    (code === 3 && msg.includes("Transaction is invalid or closed")) ||
    msg.includes("ALREADY_EXISTS") ||
    msg.includes("ABORTED") ||
    msg.includes("Transaction is invalid or closed")
  );
}

/**
 * POST /api/admin/badges/evaluate
 *
 * Server-authoritative cumulative milestone evaluator for tenure, runs, and wickets.
 * Reads player records from Firestore directly (never trusts client-supplied eligibility or stats),
 * grants missing cumulative milestones idempotently with uniqueness locks + audit logs,
 * and never revokes lower or historical milestone badges.
 */
export async function POST(req: Request) {
  const auth = await requireClubAdmin(req);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const domain =
    body.domain === "tenure" || body.domain === "stats" || body.domain === "all"
      ? body.domain
      : null;
  if (!domain) {
    return NextResponse.json({ error: "domain must be 'tenure', 'stats', or 'all'." }, { status: 400 });
  }
  if (body.dryRun !== undefined && typeof body.dryRun !== "boolean") {
    return NextResponse.json({ error: "dryRun must be a boolean." }, { status: 400 });
  }
  const dryRun = body.dryRun ?? false;

  let filterIds: Set<string> | null = null;
  if (body.playerIds !== undefined) {
    if (!Array.isArray(body.playerIds)) {
      return NextResponse.json({ error: "playerIds must be an array of player IDs." }, { status: 400 });
    }
    const validated: string[] = [];
    for (const rawId of body.playerIds) {
      if (typeof rawId !== "string" || !isSafeId(rawId.trim())) {
        return NextResponse.json(
          { error: "playerIds must contain only valid non-empty player ID strings." },
          { status: 400 },
        );
      }
      validated.push(rawId.trim());
    }
    filterIds = new Set(validated);
  }

  const db = getServerFirestore();
  const actorName = await actorNameFor(db, auth.uid);

  const [playersSnap, badgesSnap] = await Promise.all([
    db.collection("players").get(),
    db.collection("badges").get(),
  ]);

  const badgesByPlayer = new Map<string, Set<string>>();
  for (const doc of badgesSnap.docs) {
    const d = doc.data() || {};
    const pid = typeof d.playerId === "string" ? d.playerId : "";
    const bt = typeof d.badgeType === "string" ? d.badgeType : "";
    if (!pid || !bt) continue;
    let set = badgesByPlayer.get(pid);
    if (!set) {
      set = new Set();
      badgesByPlayer.set(pid, set);
    }
    set.add(bt);
  }

  const plan: { playerId: string; playerName: string; grant: string[] }[] = [];
  for (const doc of playersSnap.docs) {
    const p = doc.data() || {};
    if (p.disabled || p.mergedInto) continue;
    if (filterIds && !filterIds.has(doc.id)) continue;

    const existing = badgesByPlayer.get(doc.id) ?? new Set<string>();
    const grant: string[] = [];

    if (domain === "tenure" || domain === "all") {
      const years = computeTenureYears(typeof p.kavachJoining === "string" ? p.kavachJoining : undefined);
      const res = evaluateCumulativeMilestones(years, TENURE_MILESTONES, existing);
      grant.push(...res.missing);
    }
    if (domain === "stats" || domain === "all") {
      const runs = typeof p.totalRuns === "number" ? p.totalRuns : 0;
      const wickets = typeof p.totalWickets === "number" ? p.totalWickets : 0;
      grant.push(...evaluateCumulativeMilestones(runs, RUNS_MILESTONES, existing).missing);
      grant.push(...evaluateCumulativeMilestones(wickets, WICKETS_MILESTONES, existing).missing);
    }

    if (grant.length > 0) {
      plan.push({
        playerId: doc.id,
        playerName: typeof p.name === "string" && p.name.trim() ? p.name.trim() : doc.id,
        grant,
      });
    }
  }

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      domain,
      planned: plan,
      totalGrants: plan.reduce((s, item) => s + item.grant.length, 0),
    });
  }

  let grantedCount = 0;
  let skippedCount = 0;
  const grantedByPlayer: { playerId: string; playerName: string; granted: string[] }[] = [];
  const failed: { playerId: string; playerName: string; badgeType: string; error: string }[] = [];

  for (const item of plan) {
    const playerGranted: string[] = [];
    for (const badgeType of item.grant) {
      const lockId = deterministicNonStackableBadgeId(item.playerId, badgeType);
      const badgeId = crypto.randomUUID();

      try {
        const awarded = await db.runTransaction(async (tx) => {
          const ref = db.collection("badges").doc(badgeId);
          const lockRef = db.collection("badgeUniquenessLocks").doc(lockId);
          const dupQuery = db
            .collection("badges")
            .where("playerId", "==", item.playerId)
            .where("badgeType", "==", badgeType)
            .limit(1);

          const [dupSnap, lockSnap] = await Promise.all([tx.get(dupQuery), tx.get(lockRef)]);
          if (!dupSnap.empty || lockSnap.exists) {
            return false;
          }

          tx.create(ref, {
            playerId: item.playerId,
            playerName: item.playerName,
            badgeType,
            awardedBy: auth.uid,
            awardedByName: actorName,
            awardedAt: FieldValue.serverTimestamp(),
            redeemed: false,
          });
          tx.create(lockRef, {
            badgeId,
            playerId: item.playerId,
            badgeType,
            createdAt: FieldValue.serverTimestamp(),
          });
          await writeServerAudit(
            db,
            {
              actorId: auth.uid,
              actorName,
              action: "created",
              entity: "badge",
              entityId: badgeId,
              entityLabel: `${badgeType} → ${item.playerName}`,
              changes: [
                { field: "playerId", newValue: item.playerId },
                { field: "playerName", newValue: item.playerName },
                { field: "badgeType", newValue: badgeType },
              ],
              summary: `Evaluated cumulative milestone "${badgeType}" for ${item.playerName}`,
            },
            tx,
          );
          return true;
        });

        if (awarded) {
          grantedCount++;
          playerGranted.push(badgeType);
        } else {
          skippedCount++;
        }
      } catch (err) {
        if (isContentionError(err)) {
          const [lockCheck, dupCheck] = await Promise.all([
            db.collection("badgeUniquenessLocks").doc(lockId).get(),
            db
              .collection("badges")
              .where("playerId", "==", item.playerId)
              .where("badgeType", "==", badgeType)
              .limit(1)
              .get(),
          ]);
          if (lockCheck.exists || !dupCheck.empty) {
            skippedCount++;
            continue;
          }
        }
        failed.push({
          playerId: item.playerId,
          playerName: item.playerName,
          badgeType,
          error: err instanceof Error ? err.message : "Transaction failed",
        });
      }
    }
    if (playerGranted.length > 0) {
      grantedByPlayer.push({
        playerId: item.playerId,
        playerName: item.playerName,
        granted: playerGranted,
      });
    }
  }

  return NextResponse.json(
    {
      ok: failed.length === 0,
      dryRun: false,
      domain,
      grantedCount,
      skippedCount,
      failedCount: failed.length,
      grantedByPlayer,
      failed,
    },
    { status: failed.length > 0 && grantedCount === 0 && skippedCount === 0 ? 500 : 200 },
  );
}
