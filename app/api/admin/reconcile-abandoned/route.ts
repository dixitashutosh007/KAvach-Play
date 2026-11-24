/**
 * POST /api/admin/reconcile-abandoned
 *
 * Reconciles financial obligations for abandoned matches in accordance with
 * approved Option A policy (AGENTS.md):
 *   - An abandoned match creates no player match-fee obligation.
 *   - Waive/void unpaid match-fee obligations (status: "Waived", waivedReason: "Match Abandoned").
 *   - Preserve original amount, player, match, reason, timestamp and audit history.
 *   - Do NOT delete payment records.
 *   - Exclude waived obligations from outstanding dues, checkout, reminders, and collections.
 *   - Already-paid amounts remain historical transactions (never delete, never alter status).
 *   - Transition is idempotent and safely retryable.
 *
 * Auth: requireAdmin (Firebase ID token with admin claim or appUsers role).
 * Body: { dryRun?: boolean, matchId?: string }
 */

import { NextResponse } from "next/server.js";
import { requireFinanceAdmin } from "../../../../lib/server-auth.ts";
import { getServerFirestore } from "../../../../lib/server-db.ts";
import { actorNameFor } from "../../../../lib/server-audit.ts";
import { waiveAbandonedMatchObligations, type WaiverSummary } from "../../../../lib/abandoned-match.ts";

export async function POST(req: Request) {
  const guard = await requireFinanceAdmin(req);
  if (!guard.ok) return guard.response;

  try {
    const body = await req.json().catch(() => ({}));
    const dryRun = Boolean(body.dryRun);
    const targetMatchId = body.matchId ? String(body.matchId).trim() : null;

    const db = getServerFirestore();
    let matchesToReconcile: { id: string; opponent?: string; date?: string; fee?: number }[] = [];

    if (targetMatchId) {
      const matchDoc = await db.collection("matches").doc(targetMatchId).get();
      if (!matchDoc.exists) {
        return NextResponse.json({ error: `Match ${targetMatchId} not found.` }, { status: 404 });
      }
      const data = matchDoc.data() || {};
      if (data.result !== "Abandoned") {
        return NextResponse.json(
          { error: `Match ${targetMatchId} is not abandoned (result: ${data.result || "N/A"}).` },
          { status: 400 },
        );
      }
      matchesToReconcile.push({ id: matchDoc.id, ...data });
    } else {
      const snap = await db.collection("matches").where("result", "==", "Abandoned").get();
      snap.forEach((d) => {
        matchesToReconcile.push({ id: d.id, ...d.data() });
      });
    }

    const actor = { id: guard.uid, name: await actorNameFor(db, guard.uid) };
    const waivedList: WaiverSummary["waivedList"] = [];
    const paidPreservedList: WaiverSummary["paidPreservedList"] = [];
    let alreadyWaivedCount = 0;
    let otherCount = 0;

    // Shared trusted transition (lib/abandoned-match.ts) — also used by the
    // weekend results route; writes one audit entry per match it changes.
    for (const match of matchesToReconcile) {
      const r = await waiveAbandonedMatchObligations(db, match, { dryRun, actor });
      waivedList.push(...r.waivedList);
      paidPreservedList.push(...r.paidPreservedList);
      alreadyWaivedCount += r.alreadyWaivedCount;
      otherCount += r.otherCount;
    }

    return NextResponse.json({
      success: true,
      dryRun,
      scannedMatches: matchesToReconcile.length,
      abandonedMatches: matchesToReconcile.length,
      waivedCount: waivedList.length,
      paidPreservedCount: paidPreservedList.length,
      alreadyWaivedCount,
      otherCount,
      waivedList,
      paidPreservedList,
    });
  } catch (err: any) {
    console.error("[reconcile-abandoned] Failed:", err);
    return NextResponse.json(
      { error: "Internal server error during reconciliation.", details: err?.message },
      { status: 500 },
    );
  }
}
