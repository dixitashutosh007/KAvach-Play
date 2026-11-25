/**
 * Monthly Subscription periods (`/api/finance/subscriptions`).
 *
 * GET  ?month=YYYY-MM          list periods (Finance, Super Admin: view)
 * POST (Finance Admin / Super Admin only):
 *   { action: "createForMonth", month }                    one period per player per monthly assignment
 *   { action: "recordPayment",  periodId, method, note? }  full plan amount (server-derived), cash/upi/bank
 *   { action: "voidPayment",    periodId, reason }         undo a mistaken record (history kept)
 *   { action: "editValidity",   periodId, periodEnd, reason }
 *   { action: "close",          periodId }                 allocate to matches played; leftover = club income
 *
 * Collection `subscriptionPeriods` is server-only (no client rule; the
 * catch-all denies browser access). Amounts always come from Firestore. Each
 * change runs in a transaction with an audit entry; nothing is deleted.
 * Owner decisions (D3): no carry-forward, no proration, a month without
 * matches still owes the subscription, validity editable until closed.
 */
import { NextResponse } from "next/server";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { requireFinanceAdmin } from "@/lib/server-auth";
import { getServerFirestore } from "@/lib/server-db";
import { actorNameFor, writeServerAudit } from "@/lib/server-audit";
import { getClubCalendarDate } from "@/lib/utils";
import {
  isMonthKey,
  periodsForMonth,
  settlePeriod,
  validateValidityEdit,
  type PeriodMatchItem,
  type SubscriptionPeriod,
} from "@/lib/subscription-periods";
import type { FeePlan, FinancePlanAssignment } from "@/lib/types";

const COLLECTION = "subscriptionPeriods";
const METHODS = ["cash", "upi", "bank"] as const;

class RequestError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
const cleanText = (r: unknown) => (typeof r === "string" ? r.trim().slice(0, 300) : "");
const inr = (n: number) => `₹${Math.round(n)}`;
const nowIso = () => new Date().toISOString();

function serialize(id: string, data: FirebaseFirestore.DocumentData) {
  return {
    ...data,
    id,
    paidAt: data.paidAt?.toMillis?.() ?? null,
    closedAt: data.closedAt?.toMillis?.() ?? null,
    createdAt: data.createdAt?.toMillis?.() ?? null,
  };
}

export async function GET(req: Request) {
  const guard = await requireFinanceAdmin(req);
  if (!guard.ok) return guard.response;
  try {
    const month = new URL(req.url).searchParams.get("month");
    const db = getServerFirestore();
    const q = isMonthKey(month) ? db.collection(COLLECTION).where("month", "==", month) : db.collection(COLLECTION);
    const snap = await q.get();
    return NextResponse.json({ periods: snap.docs.map((d) => serialize(d.id, d.data())) });
  } catch (err) {
    console.error("[finance/subscriptions] GET failed", err);
    return NextResponse.json({ error: "Could not load subscription periods." }, { status: 500 });
  }
}

function periodRef(db: Firestore, periodId: unknown) {
  if (typeof periodId !== "string" || !periodId || periodId.length > 300 || periodId.includes("/")) {
    throw new RequestError(400, "Invalid subscription period.");
  }
  return db.collection(COLLECTION).doc(periodId);
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
  const todayKey = getClubCalendarDate().dateString;
  const audit = (tx: FirebaseFirestore.Transaction, entityId: string, entityLabel: string, summary: string, changes: { field: string; oldValue?: string; newValue?: string }[]) =>
    writeServerAudit(db, { actorId, actorName, action: "updated", entity: "subscription_period", entityId, entityLabel, changes, summary }, tx);

  try {
    switch (body?.action) {
      case "createForMonth": {
        const month = body.month;
        if (!isMonthKey(month)) throw new RequestError(400, "Choose a month.");
        const created = await db.runTransaction(async (tx) => {
          const plansSnap = await tx.get(db.collection("feePlans").where("type", "==", "monthly"));
          const plans = plansSnap.docs.map((d) => ({ ...(d.data() as FeePlan), id: d.id }));
          if (!plans.length) return [];
          const assignments: FinancePlanAssignment[] = [];
          for (let i = 0; i < plans.length; i += 30) {
            const s = await tx.get(db.collection("financePlanAssignments").where("planId", "in", plans.slice(i, i + 30).map((p) => p.id)));
            s.docs.forEach((d) => assignments.push({ ...(d.data() as FinancePlanAssignment), id: d.id }));
          }
          const existing = await tx.get(db.collection(COLLECTION).where("month", "==", month));
          const playerIds = [...new Set(assignments.map((a) => a.playerId))];
          const names: Record<string, string> = {};
          if (playerIds.length) {
            const ps = await tx.getAll(...playerIds.map((id) => db.collection("players").doc(id)));
            ps.forEach((p) => {
              if (p.exists && !p.data()?.disabled && !p.data()?.mergedInto) names[p.id] = String(p.data()?.name || "Player");
            });
          }
          const toCreate = periodsForMonth({
            month,
            plans,
            assignments: assignments.filter((a) => names[a.playerId]),
            existingIds: new Set(existing.docs.map((d) => d.id)),
            playerNames: names,
          });
          for (const p of toCreate) {
            tx.create(db.collection(COLLECTION).doc(p.id), { ...p, createdBy: actorId, createdByName: actorName, createdAt: FieldValue.serverTimestamp() });
          }
          if (toCreate.length) {
            await audit(tx, month, `Subscriptions ${month}`, `Created ${toCreate.length} subscription period${toCreate.length === 1 ? "" : "s"} for ${month}`,
              toCreate.map((p) => ({ field: p.playerName, newValue: `${p.planName} ${inr(p.amount)} (${p.periodStart} to ${p.periodEnd})` })));
          }
          return toCreate;
        });
        return NextResponse.json({ ok: true, created: created.length });
      }

      case "recordPayment": {
        const method = body.method;
        if (!METHODS.includes(method)) throw new RequestError(400, "Choose cash, UPI or bank transfer.");
        const note = cleanText(body.note);
        await db.runTransaction(async (tx) => {
          const ref = periodRef(db, body.periodId);
          const snap = await tx.get(ref);
          if (!snap.exists) throw new RequestError(404, "Subscription period not found.");
          const p = snap.data() as SubscriptionPeriod;
          if (p.status === "paid") throw new RequestError(409, "This subscription is already recorded as paid.");
          tx.update(ref, {
            status: "paid",
            paidAmount: p.amount,
            paidMethod: method,
            paidNote: note || FieldValue.delete(),
            paidBy: actorId,
            paidByName: actorName,
            paidAt: FieldValue.serverTimestamp(),
            paymentHistory: FieldValue.arrayUnion({ action: "paid", amount: p.amount, method, byName: actorName, at: nowIso() }),
          });
          await audit(tx, ref.id, `${p.playerName} · ${p.planName} ${p.month}`, `Recorded ${inr(p.amount)} subscription payment (${method}) for ${p.playerName}, ${p.month}`, [
            { field: "status", oldValue: "due", newValue: "paid" },
            { field: "amount", newValue: inr(p.amount) },
            { field: "method", newValue: method },
          ]);
        });
        return NextResponse.json({ ok: true });
      }

      case "voidPayment": {
        const reason = cleanText(body.reason);
        if (!reason) throw new RequestError(400, "Give a reason.");
        await db.runTransaction(async (tx) => {
          const ref = periodRef(db, body.periodId);
          const snap = await tx.get(ref);
          if (!snap.exists) throw new RequestError(404, "Subscription period not found.");
          const p = snap.data() as SubscriptionPeriod;
          if (p.status !== "paid") throw new RequestError(409, "No payment is recorded for this period.");
          if (p.closed) throw new RequestError(409, "This period is closed. Refunds are a separate process.");
          tx.update(ref, {
            status: "due",
            paidAmount: FieldValue.delete(),
            paidMethod: FieldValue.delete(),
            paidNote: FieldValue.delete(),
            paidBy: FieldValue.delete(),
            paidByName: FieldValue.delete(),
            paidAt: FieldValue.delete(),
            paymentHistory: FieldValue.arrayUnion({ action: "voided", amount: p.paidAmount ?? p.amount, reason, byName: actorName, at: nowIso() }),
          });
          await audit(tx, ref.id, `${p.playerName} · ${p.planName} ${p.month}`, `Voided subscription payment for ${p.playerName}, ${p.month}. Reason: ${reason}`, [
            { field: "status", oldValue: "paid", newValue: "due" },
            { field: "reason", newValue: reason },
          ]);
        });
        return NextResponse.json({ ok: true });
      }

      case "editValidity": {
        const reason = cleanText(body.reason);
        if (!reason) throw new RequestError(400, "Give a reason for changing the validity.");
        await db.runTransaction(async (tx) => {
          const ref = periodRef(db, body.periodId);
          const snap = await tx.get(ref);
          if (!snap.exists) throw new RequestError(404, "Subscription period not found.");
          const p = { ...(snap.data() as SubscriptionPeriod), id: snap.id };
          const others = await tx.get(db.collection(COLLECTION).where("playerId", "==", p.playerId));
          const problem = validateValidityEdit(p, body.periodEnd, others.docs.map((d) => ({ ...(d.data() as SubscriptionPeriod), id: d.id })));
          if (problem) throw new RequestError(409, problem);
          tx.update(ref, {
            periodEnd: body.periodEnd,
            validityEdits: FieldValue.arrayUnion({ from: p.periodEnd, to: body.periodEnd, reason, byName: actorName, at: nowIso() }),
          });
          await audit(tx, ref.id, `${p.playerName} · ${p.planName} ${p.month}`, `Changed subscription validity for ${p.playerName}: ${p.periodEnd} → ${body.periodEnd}. Reason: ${reason}`, [
            { field: "periodEnd", oldValue: p.periodEnd, newValue: body.periodEnd },
            { field: "reason", newValue: reason },
          ]);
        });
        return NextResponse.json({ ok: true });
      }

      case "close": {
        const result = await db.runTransaction(async (tx) => {
          const ref = periodRef(db, body.periodId);
          const snap = await tx.get(ref);
          if (!snap.exists) throw new RequestError(404, "Subscription period not found.");
          const p = { ...(snap.data() as SubscriptionPeriod), id: snap.id };
          if (p.closed) throw new RequestError(409, "This period is already closed.");
          if (p.periodEnd >= todayKey) throw new RequestError(409, `Close the period after it ends (${p.periodEnd}).`);

          // This player's subscription-covered match payments for this plan, not yet settled.
          const paySnap = await tx.get(db.collectionGroup("payments").where("playerId", "==", p.playerId));
          const candidates = paySnap.docs.filter((d) => {
            const x = d.data();
            return (
              x.status === "Paid" &&
              x.manualMethod === "part_of_plan" &&
              !x.guestName &&
              x.financeSnapshot?.planId === p.planId &&
              !x.financeSnapshot?.periodId &&
              d.ref.parent.parent?.parent.id === "matches"
            );
          });
          const matchIds = [...new Set(candidates.map((d) => d.ref.parent.parent!.id))];
          const matches = matchIds.length ? await tx.getAll(...matchIds.map((id) => db.collection("matches").doc(id))) : [];
          const matchById = new Map(matches.filter((m) => m.exists).map((m) => [m.id, m.data()!]));
          const items: (PeriodMatchItem & { ref: FirebaseFirestore.DocumentReference; snap: any })[] = [];
          for (const d of candidates) {
            const m = matchById.get(d.ref.parent.parent!.id);
            if (!m || m.result === "Abandoned") continue;
            const date = String(m.date || "");
            if (date < p.periodStart || date > p.periodEnd) continue;
            items.push({ matchId: d.ref.parent.parent!.id, paymentId: d.id, date, fee: Number(m.fee) || 0, opponent: m.opponent, ref: d.ref, snap: d.data().financeSnapshot });
          }

          const settlement = settlePeriod(p, items);
          for (const a of settlement.allocations) {
            const it = items.find((i) => i.paymentId === a.paymentId && i.matchId === a.matchId)!;
            const applied = { ...(it.snap?.applied || {}), feeCollectedAmount: a.allocated, feeOffsetAmount: a.sponsorship };
            tx.update(it.ref, {
              feeCollectedAmount: a.allocated,
              feeOffsetAmount: a.sponsorship,
              financeSnapshot: {
                ...it.snap,
                contribution: a.allocated,
                sponsorship: a.sponsorship,
                matchFee: a.fee,
                pendingAllocation: false,
                periodId: p.id,
                applied,
                computedBy: actorId,
                computedByName: actorName,
                computedAt: FieldValue.serverTimestamp(),
              },
              updatedAt: FieldValue.serverTimestamp(),
            });
          }
          tx.update(ref, {
            closed: true,
            settlement: { ...settlement, allocations: settlement.allocations.map(({ matchId, paymentId, date, fee, opponent, allocated, sponsorship }) => ({ matchId, paymentId, date, fee, opponent: opponent || "", allocated, sponsorship })) },
            closedBy: actorId,
            closedByName: actorName,
            closedAt: FieldValue.serverTimestamp(),
          });
          await audit(tx, ref.id, `${p.playerName} · ${p.planName} ${p.month}`,
            `Closed ${p.month} subscription for ${p.playerName}: ${settlement.allocations.length} match${settlement.allocations.length === 1 ? "" : "es"}, allocated ${inr(settlement.allocatedTotal)}, club sponsored ${inr(settlement.sponsorshipTotal)}, unused ${inr(settlement.unused)} (club income, no carry-forward)`,
            settlement.allocations.map((a) => ({ field: `${a.date} vs ${a.opponent || "Match"}`, newValue: `subscription ${inr(a.allocated)}, club ${inr(a.sponsorship)}` })));
          return settlement;
        });
        return NextResponse.json({ ok: true, settlement: result });
      }

      default:
        return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }
  } catch (err) {
    if (err instanceof RequestError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[finance/subscriptions] failed", err);
    return NextResponse.json({ error: "The change could not be saved." }, { status: 500 });
  }
}
