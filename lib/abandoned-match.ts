/**
 * Abandoned-match financial transition (approved Option A policy, AGENTS.md).
 *
 * Extracted unchanged from `app/api/admin/reconcile-abandoned/route.ts` so the
 * Finance reconciliation route and the trusted weekend-results route share ONE
 * waiver mechanism (no parallel implementation):
 *  - Unpaid match-fee obligations → status "Waived", waivedReason
 *    "Match Abandoned", waivedAt (originals — amount, player, match — untouched).
 *  - Paid records are historical and are never modified or refunded.
 *  - Already-waived records are left alone, so the transition is idempotent and
 *    safely retryable.
 * Added: one server audit entry per match when anything is waived.
 */
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { writeServerAudit } from "./server-audit.ts";

export interface AbandonedMatchRef {
  id: string;
  fee?: number;
  opponent?: string;
  date?: string;
}

export interface WaiverSummary {
  waivedList: { matchId: string; paymentId: string; playerId: string; amount: number; previousStatus: string }[];
  paidPreservedList: { matchId: string; paymentId: string; playerId: string; amount: number }[];
  alreadyWaivedCount: number;
  otherCount: number;
}

export async function waiveAbandonedMatchObligations(
  db: Firestore,
  match: AbandonedMatchRef,
  opts: { dryRun?: boolean; actor?: { id: string; name: string } } = {},
): Promise<WaiverSummary> {
  const summary: WaiverSummary = { waivedList: [], paidPreservedList: [], alreadyWaivedCount: 0, otherCount: 0 };
  const paymentsSnap = await db.collection(`matches/${match.id}/payments`).get();

  let batch = db.batch();
  let batchCount = 0;
  for (const payDoc of paymentsSnap.docs) {
    const pay = payDoc.data();
    const effectiveAmount = pay.feeOverride !== undefined ? pay.feeOverride : match.fee || 0;
    if (pay.status === "Unpaid") {
      summary.waivedList.push({ matchId: match.id, paymentId: payDoc.id, playerId: pay.playerId, amount: effectiveAmount, previousStatus: "Unpaid" });
      if (!opts.dryRun) {
        batch.update(payDoc.ref, {
          status: "Waived",
          waivedReason: "Match Abandoned",
          waivedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        if (++batchCount >= 400) {
          await batch.commit();
          batch = db.batch();
          batchCount = 0;
        }
      }
    } else if (pay.status === "Paid") {
      summary.paidPreservedList.push({ matchId: match.id, paymentId: payDoc.id, playerId: pay.playerId, amount: pay.feeCollectedAmount ?? effectiveAmount });
    } else if (pay.status === "Waived") {
      summary.alreadyWaivedCount++;
    } else {
      summary.otherCount++;
    }
  }
  if (!opts.dryRun && batchCount > 0) await batch.commit();

  if (!opts.dryRun && summary.waivedList.length > 0) {
    const total = summary.waivedList.reduce((s, w) => s + (Number(w.amount) || 0), 0);
    await writeServerAudit(db, {
      actorId: opts.actor?.id || "system",
      actorName: opts.actor?.name || "System",
      action: "status_change",
      entity: "match",
      entityId: match.id,
      entityLabel: `vs ${match.opponent || "Match"} (${match.date || ""})`,
      changes: [
        { field: "waivedObligations", newValue: String(summary.waivedList.length) },
        { field: "waivedAmount", newValue: `₹${Math.round(total)}` },
      ],
      summary: `Match abandoned: waived ${summary.waivedList.length} unpaid match-fee obligation(s) (₹${Math.round(total)}); ${summary.paidPreservedList.length} paid record(s) preserved.`,
    });
  }
  return summary;
}
