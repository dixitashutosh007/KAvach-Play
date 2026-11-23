/**
 * Match finance ledger actions (`/api/finance/match-ledger`).
 *
 * POST, Finance Admin / Super Admin only:
 *   { action: "setGroundFee",    matchId, amount, reason? }   finance open; reason required to correct
 *   { action: "adjustGroundFee", matchId, amount, reason }    finance closed (authorised adjustment)
 *   { action: "closeFinance",    matchId }                    actual fee must be recorded
 *   { action: "reopenFinance",   matchId, reason }
 *   { action: "reversePayment",  matchId, paymentId, amount, method, reference, reason, removeFromSquad }
 *
 * Extends the existing match / payment documents (no new collections); see
 * docs/implementation/MATCH_FINANCE_LIFECYCLE.md. Each action runs in one
 * Firestore transaction with a server audit entry. History arrays are
 * append-only; the original payment transaction (amount, method, Razorpay id)
 * is never overwritten — a reversal copies it into `reversals[]` and changes
 * only `status`. No Razorpay API calls are made: a reversal records a refund
 * already made (Razorpay dashboard refund id, or a documented cash / UPI /
 * bank return).
 */
import { NextResponse } from "next/server";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { requireFinanceAdmin } from "@/lib/server-auth";
import { getServerFirestore } from "@/lib/server-db";
import { actorNameFor, writeServerAudit } from "@/lib/server-audit";
import { buildMatchFinancialStatement, collectedMoney } from "@/lib/match-finance";
import type { Match, MatchPayment } from "@/lib/types";

const REFUND_METHODS = ["razorpay_refund", "cash", "upi", "bank"] as const;
const MAX_AMOUNT = 10_000_000;

class RequestError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
const cleanText = (r: unknown, max = 300) => (typeof r === "string" ? r.trim().slice(0, max) : "");
const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const nowIso = () => new Date().toISOString();

function validId(id: unknown, what: string): string {
  if (typeof id !== "string" || !id || id.length > 128 || id.includes("/")) throw new RequestError(400, `Invalid ${what}.`);
  return id;
}

function parseAmount(v: unknown, what: string): number {
  const n = Number(v);
  if (v === null || v === "" || !Number.isFinite(n) || n < 0 || n > MAX_AMOUNT) throw new RequestError(400, `Enter a valid ${what} (₹0 or more).`);
  return Math.round(n);
}

async function loadMatch(db: Firestore, tx: FirebaseFirestore.Transaction, matchId: string) {
  const ref = db.collection("matches").doc(matchId);
  const snap = await tx.get(ref);
  if (!snap.exists) throw new RequestError(404, "Match not found.");
  return { ref, match: { ...(snap.data() as Match & { financeStatus?: string }), id: matchId } };
}

async function loadStatement(tx: FirebaseFirestore.Transaction, matchRef: FirebaseFirestore.DocumentReference, match: Match & { financeStatus?: string }) {
  const paySnap = await tx.get(matchRef.collection("payments"));
  const payments = paySnap.docs.map((d) => ({ ...(d.data() as MatchPayment), id: d.id, matchId: match.id }));
  return buildMatchFinancialStatement(match, payments);
}

export async function POST(req: Request) {
  const guard = await requireFinanceAdmin(req);
  if (!guard.ok) return guard.response;
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const db = getServerFirestore();
  const actorId = guard.uid;
  const actorName = await actorNameFor(db, actorId);
  const audit = (tx: FirebaseFirestore.Transaction, entityId: string, entity: "match" | "payment", entityLabel: string, summary: string, changes: { field: string; oldValue?: string; newValue?: string }[]) =>
    writeServerAudit(db, { actorId, actorName, action: "updated", entity, entityId, entityLabel, changes, summary }, tx);

  try {
    const matchId = validId(body?.matchId, "match");
    const action = body?.action;

    if (action === "setGroundFee" || action === "adjustGroundFee") {
      const amount = parseAmount(body.amount, "actual match fee paid");
      const reason = cleanText(body.reason);
      await db.runTransaction(async (tx) => {
        const { ref, match } = await loadMatch(db, tx, matchId);
        const closed = match.financeStatus === "closed";
        const previous = typeof match.groundFeePaidAmount === "number" ? match.groundFeePaidAmount : null;
        if (action === "setGroundFee" && closed) throw new RequestError(409, "Match finances are closed. Use an adjustment (with a reason) to change the actual fee.");
        if (action === "adjustGroundFee" && !closed) throw new RequestError(409, "Match finances are open; edit the actual fee directly.");
        if (previous === amount) throw new RequestError(409, `The actual fee is already ${inr(amount)}.`);
        const kind = action === "adjustGroundFee" ? "adjustment" : previous === null ? "set" : "correction";
        if (kind !== "set" && !reason) throw new RequestError(400, "Give a reason for changing the actual fee.");
        tx.update(ref, {
          groundFeePaidAmount: amount,
          isGroundFeePaid: true,
          groundFeeSetBy: actorId,
          groundFeeSetByName: actorName,
          groundFeeSetAt: FieldValue.serverTimestamp(),
          groundFeeHistory: FieldValue.arrayUnion({ kind, from: previous, to: amount, reason, by: actorId, byName: actorName, at: nowIso() }),
          updatedAt: FieldValue.serverTimestamp(),
        });
        await audit(tx, matchId, "match", `vs ${match.opponent || "Match"} (${match.date})`,
          `${kind === "set" ? "Recorded" : kind === "correction" ? "Corrected" : "Adjusted (finance closed)"} actual match fee paid: ${previous === null ? "" : `${inr(previous)} → `}${inr(amount)}${reason ? `. Reason: ${reason}` : ""}`,
          [{ field: "groundFeePaidAmount", oldValue: previous === null ? "" : inr(previous), newValue: inr(amount) }, ...(reason ? [{ field: "reason", newValue: reason }] : [])]);
      });
      return NextResponse.json({ ok: true });
    }

    if (action === "closeFinance" || action === "reopenFinance") {
      const reason = cleanText(body.reason);
      if (action === "reopenFinance" && !reason) throw new RequestError(400, "Give a reason for reopening the match finances.");
      const statement = await db.runTransaction(async (tx) => {
        const { ref, match } = await loadMatch(db, tx, matchId);
        const closed = match.financeStatus === "closed";
        if (action === "closeFinance" && closed) throw new RequestError(409, "Match finances are already closed.");
        if (action === "reopenFinance" && !closed) throw new RequestError(409, "Match finances are not closed.");
        if (action === "closeFinance" && typeof match.groundFeePaidAmount !== "number") {
          throw new RequestError(409, "Record the actual match fee paid before closing the match finances.");
        }
        const st = await loadStatement(tx, ref, match);
        const snapshot = {
          systemFee: st.systemFee,
          clubSponsored: st.clubSponsored,
          maxPlayerCollection: st.maxPlayerCollection,
          collected: st.collected,
          outstanding: st.outstanding,
          actualFeePaid: st.actualFeePaid,
          netResult: st.netResult,
          players: st.players,
          pendingAllocationCount: st.pendingAllocationCount,
        };
        const entry = { action: action === "closeFinance" ? "closed" : "reopened", reason, statement: snapshot, by: actorId, byName: actorName, at: nowIso() };
        tx.update(ref, {
          financeStatus: action === "closeFinance" ? "closed" : "open",
          ...(action === "closeFinance"
            ? { financeClosedAt: FieldValue.serverTimestamp(), financeClosedBy: actorId, financeClosedByName: actorName }
            : {}),
          financeHistory: FieldValue.arrayUnion(entry),
          updatedAt: FieldValue.serverTimestamp(),
        });
        await audit(tx, matchId, "match", `vs ${match.opponent || "Match"} (${match.date})`,
          action === "closeFinance"
            ? `Closed match finances: expected ${inr(st.maxPlayerCollection)}, collected ${inr(st.collected)}, actual fee ${inr(st.actualFeePaid || 0)}, net ${st.netResult === null ? "n/a" : inr(st.netResult)}`
            : `Reopened match finances. Reason: ${reason}`,
          [{ field: "financeStatus", oldValue: closed ? "closed" : "open", newValue: action === "closeFinance" ? "closed" : "open" }, ...(reason ? [{ field: "reason", newValue: reason }] : [])]);
        return snapshot;
      });
      return NextResponse.json({ ok: true, statement });
    }

    if (action === "reversePayment") {
      const paymentId = validId(body.paymentId, "payment");
      const amount = parseAmount(body.amount, "refund amount");
      const method = body.method;
      if (!REFUND_METHODS.includes(method)) throw new RequestError(400, "Choose how the money was returned.");
      const reference = cleanText(body.reference, 200);
      const reason = cleanText(body.reason);
      if (!reason) throw new RequestError(400, "Give a reason for the refund.");
      if (!reference) {
        throw new RequestError(400, method === "cash" ? "Add the cash refund confirmation (who returned it, to whom, when)." : "Add the refund reference / transaction ID.");
      }
      const removeFromSquad = body.removeFromSquad === true;

      await db.runTransaction(async (tx) => {
        const { ref: matchRef, match } = await loadMatch(db, tx, matchId);
        const payRef = matchRef.collection("payments").doc(paymentId);
        const paySnap = await tx.get(payRef);
        if (!paySnap.exists) throw new RequestError(404, "Payment not found.");
        const p = { ...(paySnap.data() as MatchPayment), id: paymentId };
        const collected = collectedMoney(p, Number(match.fee) || 0);
        if (p.status !== "Paid") throw new RequestError(409, "This payment is not marked Paid; there is nothing to refund.");
        if (collected <= 0) {
          throw new RequestError(409, "This fee was settled by club sponsorship, a subscription or another player — it is not real money and can't be refunded. Change it through Finance Plans.");
        }
        if (amount !== collected) {
          throw new RequestError(409, `The refund must be the full amount collected (${inr(collected)}). Partial refunds aren't supported yet.`);
        }
        const original = {
          status: p.status,
          paymentMethod: p.paymentMethod ?? null,
          manualMethod: p.manualMethod ?? null,
          feeCollectedAmount: p.feeCollectedAmount ?? null,
          feeOverride: p.feeOverride ?? null,
          razorpayPaymentId: p.razorpayPaymentId ?? null,
          manualBy: p.manualBy ?? null,
        };
        const resultStatus = removeFromSquad ? "Not Playing" : "Unpaid";
        const playerSnap = await tx.get(db.collection("players").doc(p.playerId));
        const playerName = p.guestName || (playerSnap.exists ? String(playerSnap.data()?.name || "Player") : "Player");
        tx.update(payRef, {
          status: resultStatus,
          reversals: FieldValue.arrayUnion({ amount, method, reference, reason, removedFromSquad: removeFromSquad, original, resultStatus, by: actorId, byName: actorName, at: nowIso() }),
          updatedAt: FieldValue.serverTimestamp(),
        });
        await audit(tx, paymentId, "payment", `${playerName} · vs ${match.opponent || "Match"} (${match.date})`,
          `Refunded ${inr(amount)} to ${playerName} (${method.replace("_", " ")}, ref ${reference})${removeFromSquad ? " and removed from the squad" : ""}. Reason: ${reason}`,
          [
            { field: "status", oldValue: "Paid", newValue: resultStatus },
            { field: "refund", newValue: `${inr(amount)} ${method}` },
            { field: "reference", newValue: reference },
            { field: "reason", newValue: reason },
            ...(original.razorpayPaymentId ? [{ field: "razorpayPaymentId", oldValue: original.razorpayPaymentId, newValue: "(kept)" }] : []),
          ]);
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (err) {
    if (err instanceof RequestError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[finance/match-ledger] failed", err);
    return NextResponse.json({ error: "The change could not be saved." }, { status: 500 });
  }
}
