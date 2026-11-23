/**
 * Finance Plans for a match (`/api/finance/match-plans`).
 *
 * POST { action: "preview",  matchId }                     Club, Match, Finance, Super Admin
 * POST { action: "apply",    matchId, scope?: "all"|"refresh" }   Match, Finance, Super Admin
 * POST { action: "override", matchId, paymentId, reason, contribution?, planId? }  Finance, Super Admin
 * POST { action: "clearOverride", matchId, paymentId, reason }  back to the plan rule; Finance, Super Admin
 *
 * Everything is computed here from Firestore (match fee and date, plans, dated
 * assignments, legacy plan ids, current payments) with the shared pure rules in
 * lib/match-plan-application — never from amounts sent by the browser. Writes
 * run in one transaction with an audit entry, so a payment that is paid or
 * edited concurrently is re-read and left alone. Only payments that are
 * untouched (regular, or exactly as the last automatic application left them)
 * are changed; paid, collected, overridden or hand-edited payments are final.
 * Nothing is deleted except the fee fields a plan application itself controls.
 *
 * "refresh" only updates/reverts payments that already carry an automatic
 * snapshot (used after a match's fee or date is edited).
 */
import { NextResponse } from "next/server";
import { FieldValue, type Firestore, type Transaction } from "firebase-admin/firestore";
import { requireFinanceAdmin, requireRole } from "@/lib/server-auth";
import { getServerFirestore } from "@/lib/server-db";
import { actorNameFor, writeServerAudit } from "@/lib/server-audit";
import {
  buildMatchPlanApplication,
  fieldsForOverride,
  fieldsForPlan,
  isOverridable,
  isPristineRegular,
  isUntouchedAuto,
  snapshotForRow,
  AUTO_MANUAL_BY,
  type AppliedFields,
  type FinanceSnapshot,
  type MatchPlanApplication,
  type PaymentWithSnapshot,
} from "@/lib/match-plan-application";
import { planContribution } from "@/lib/finance-plans";
import type { FeePlan, FinancePlanAssignment, Match } from "@/lib/types";

class RequestError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const cleanReason = (r: unknown) => (typeof r === "string" ? r.trim().slice(0, 300) : "");
const inr = (n: number) => `₹${Math.round(n)}`;

/** Firestore update for the controlled fee fields (null → field removed). */
function fieldUpdate(fields: AppliedFields, snapshot: FinanceSnapshot, actorId: string, actorName: string) {
  const del = FieldValue.delete();
  const v = <T,>(x: T | null) => (x === null ? del : x);
  return {
    status: fields.status,
    feeOverride: v(fields.feeOverride),
    feeOffsetAmount: v(fields.feeOffsetAmount),
    feeCollectedAmount: v(fields.feeCollectedAmount),
    planTag: v(fields.planTag),
    paymentMethod: v(fields.paymentMethod),
    manualMethod: v(fields.manualMethod),
    manualBy: fields.manualMethod ? (snapshot.source === "auto" ? AUTO_MANUAL_BY : actorName) : del,
    financeSnapshot: { ...snapshot, computedBy: actorId, computedByName: actorName, computedAt: FieldValue.serverTimestamp() },
    updatedAt: FieldValue.serverTimestamp(),
  };
}

/** Reads everything the plan rules need for one match, inside a transaction. */
async function loadMatchContext(db: Firestore, tx: Transaction, matchId: string) {
  if (typeof matchId !== "string" || !matchId || matchId.length > 128 || matchId.includes("/")) {
    throw new RequestError(400, "Invalid match.");
  }
  const matchRef = db.collection("matches").doc(matchId);
  const matchSnap = await tx.get(matchRef);
  if (!matchSnap.exists) throw new RequestError(404, "Match not found.");
  const match = { ...(matchSnap.data() as Match), id: matchId };

  const paySnap = await tx.get(matchRef.collection("payments"));
  const payments = paySnap.docs.map((d) => ({ ...(d.data() as PaymentWithSnapshot), id: d.id, matchId }));

  const playerIds = [...new Set(payments.map((p) => p.playerId).filter((x) => typeof x === "string" && x))];
  const players: { id: string; name: string; feePlanIds?: string[] }[] = [];
  if (playerIds.length) {
    const snaps = await tx.getAll(...playerIds.map((id) => db.collection("players").doc(id)));
    for (const s of snaps) {
      if (s.exists) players.push({ id: s.id, name: String(s.data()?.name || "Player"), feePlanIds: s.data()?.feePlanIds });
    }
  }

  const plansSnap = await tx.get(db.collection("feePlans"));
  const plans = plansSnap.docs.map((d) => ({ ...(d.data() as FeePlan), id: d.id }));

  const assignments: FinancePlanAssignment[] = [];
  for (let i = 0; i < playerIds.length; i += 30) {
    const chunk = playerIds.slice(i, i + 30);
    const s = await tx.get(db.collection("financePlanAssignments").where("playerId", "in", chunk));
    s.docs.forEach((d) => assignments.push({ ...(d.data() as FinancePlanAssignment), id: d.id }));
  }

  return { matchRef, match, payments, players, plans, assignments };
}

function publicView(app: MatchPlanApplication) {
  return {
    matchId: app.matchId,
    matchDate: app.matchDate,
    matchFee: app.matchFee,
    blocked: app.blocked || null,
    totals: app.totals,
    rows: app.rows.map(({ fields: _f, ...r }) => r),
    changeCount: app.changes.length,
  };
}

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const action = body?.action;
  const guard =
    action === "preview"
      ? await requireRole(req, ["superAdmin", "financeAdmin", "clubAdmin", "matchAdmin"])
      : action === "apply"
        ? await requireRole(req, ["superAdmin", "financeAdmin", "matchAdmin"])
        : action === "override" || action === "clearOverride"
          ? await requireFinanceAdmin(req)
          : null;
  if (!guard) return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  if (!guard.ok) return guard.response;

  const db = getServerFirestore();
  const actorId = guard.uid;

  try {
    if (action === "preview") {
      const result = await db.runTransaction(async (tx) => {
        const ctx = await loadMatchContext(db, tx, body.matchId);
        return buildMatchPlanApplication(ctx);
      });
      return NextResponse.json(publicView(result));
    }

    const actorName = await actorNameFor(db, actorId);

    if (action === "apply") {
      const scope = body.scope === "refresh" ? "refresh" : "all";
      const result = await db.runTransaction(async (tx) => {
        const ctx = await loadMatchContext(db, tx, body.matchId);
        const app = buildMatchPlanApplication(ctx);
        if (app.blocked) throw new RequestError(409, app.blocked);
        const changes = scope === "refresh" ? app.changes.filter((r) => r.action !== "apply") : app.changes;
        for (const row of changes) {
          const ref = ctx.matchRef.collection("payments").doc(row.paymentId);
          tx.update(ref, fieldUpdate(row.fields!, snapshotForRow(app, row), actorId, actorName));
        }
        if (changes.length) {
          await writeServerAudit(
            db,
            {
              actorId,
              actorName,
              action: "updated",
              entity: "payment",
              entityId: ctx.match.id,
              entityLabel: `Finance Plans · vs ${ctx.match.opponent || "Match"} (${ctx.match.date})`,
              changes: changes.map((r) => ({
                field: r.playerName,
                newValue:
                  r.action === "revert"
                    ? `Regular ${inr(app.matchFee)}`
                    : `${r.planName}: player ${inr(r.contribution)}, club ${inr(r.sponsorship)}`,
              })),
              summary: `${scope === "refresh" ? "Refreshed" : "Applied"} Finance Plans for ${changes.length} player${changes.length === 1 ? "" : "s"} (match fee ${inr(app.matchFee)}, ${app.matchDate})`,
            },
            tx,
          );
        }
        return { app, written: changes.length };
      });
      return NextResponse.json({ ...publicView(result.app), written: result.written });
    }

    // ── Overrides (Finance Admin / Super Admin) ──────────────────────────────
    const reason = cleanReason(body.reason);
    if (!reason) return NextResponse.json({ error: "Give a reason for the change." }, { status: 400 });
    const paymentId = body.paymentId;
    if (typeof paymentId !== "string" || !paymentId || paymentId.includes("/")) {
      return NextResponse.json({ error: "Invalid payment." }, { status: 400 });
    }

    await db.runTransaction(async (tx) => {
      const ctx = await loadMatchContext(db, tx, body.matchId);
      if (ctx.match.result === "Abandoned") throw new RequestError(409, "This match was abandoned, so no match fees apply.");
      const payment = ctx.payments.find((p) => p.id === paymentId);
      if (!payment) throw new RequestError(404, "Payment not found.");
      if (payment.status === "Not Playing") throw new RequestError(409, "This player is not in the squad.");
      if (payment.guestName) throw new RequestError(409, "Guest fees are not managed by Finance Plans.");
      const player = ctx.players.find((p) => p.id === payment.playerId);
      const playerName = player?.name || "Player";
      const snap = payment.financeSnapshot;
      if (!isOverridable(payment)) {
        throw new RequestError(409, `${playerName}'s fee can't be changed: money has already been collected, or another player pays it.`);
      }
      const fee = Math.max(0, Math.round(Number(ctx.match.fee) || 0));

      // What the plan rules alone would produce (kept on the override record).
      const others = ctx.payments.map((p) =>
        p.id === paymentId
          ? ({ ...p, status: "Unpaid", feeOverride: undefined, feeOffsetAmount: undefined, feeCollectedAmount: undefined, planTag: undefined, manualMethod: undefined, paymentMethod: undefined, financeSnapshot: undefined } as PaymentWithSnapshot)
          : p,
      );
      const computed = buildMatchPlanApplication({ ...ctx, payments: others }).rows.find((r) => r.paymentId === paymentId);
      if (!computed) throw new RequestError(409, "This payment can't be evaluated.");

      let fields: AppliedFields;
      let snapshot: FinanceSnapshot;
      let summary: string;

      if (action === "clearOverride") {
        if (isPristineRegular(payment) || isUntouchedAuto(payment)) {
          throw new RequestError(409, `${playerName} already follows the plan rule.`);
        }
        if (computed.action === "skip") {
          throw new RequestError(409, `Can't return ${playerName} to the plan rule: ${computed.reason}. Set a new override instead.`);
        }
        const toPlan = computed.action === "apply";
        fields = toPlan ? computed.fields! : fieldsForPlan(null, fee, 0, fee);
        snapshot = snapshotForRow({ matchDate: ctx.match.date, matchFee: fee }, toPlan ? computed : { ...computed, action: "revert", fields });
        summary = `Returned ${playerName} to the plan rule; now ${toPlan ? `${computed.planName} (player ${inr(computed.contribution)})` : `Regular ${inr(fee)}`}. Reason: ${reason}`;
      } else {
        let contribution: number;
        let label: string;
        let planId: string | null = null;
        let planType: FinanceSnapshot["planType"] = "regular";
        if (body.planId !== undefined && body.planId !== null && body.planId !== "") {
          const plan = ctx.plans.find((p) => p.id === body.planId);
          if (!plan) throw new RequestError(404, "Plan not found.");
          if (plan.isActive === false) throw new RequestError(409, `${plan.name} is inactive.`);
          const calc = planContribution(plan, fee);
          if (calc.pendingAllocation) {
            const alloc = Number(body.contribution);
            if (!Number.isFinite(alloc) || alloc < 0) throw new RequestError(400, "Enter the amount allocated from the subscription.");
            contribution = Math.min(fee, Math.round(alloc));
          } else {
            contribution = calc.contribution;
          }
          fields = fieldsForPlan(plan, contribution, fee - contribution, fee);
          label = plan.name;
          planId = plan.id;
          planType = plan.type;
        } else {
          const c = Number(body.contribution);
          if (!Number.isFinite(c) || c < 0) throw new RequestError(400, "Enter the amount the player pays (₹0 or more).");
          if (Math.round(c) > fee) throw new RequestError(400, `The player's amount can't be more than the match fee (${inr(fee)}).`);
          contribution = Math.round(c);
          label = "Fee override";
          fields = fieldsForOverride(contribution, fee, label);
        }
        snapshot = {
          version: 1,
          source: "override",
          planId,
          planName: label,
          planType,
          assignmentId: null,
          legacy: false,
          matchDate: ctx.match.date,
          matchFee: fee,
          contribution,
          sponsorship: fee - contribution,
          applied: fields,
          override: {
            reason,
            computedContribution: computed.contribution,
            computedSponsorship: computed.sponsorship,
            computedPlanName: computed.planName,
          },
        };
        summary = `Overrode ${playerName}'s match fee: player ${inr(contribution)}, club ${inr(fee - contribution)} (${label}; plan rule gave ${computed.planName} ${inr(computed.contribution)}). Reason: ${reason}`;
      }

      tx.update(ctx.matchRef.collection("payments").doc(paymentId), fieldUpdate(fields, snapshot, actorId, actorName));
      await writeServerAudit(
        db,
        {
          actorId,
          actorName,
          action: "updated",
          entity: "payment",
          entityId: paymentId,
          entityLabel: `${playerName} · vs ${ctx.match.opponent || "Match"} (${ctx.match.date})`,
          changes: [
            { field: "playerContribution", oldValue: inr(snap ? snap.contribution : payment.feeOverride ?? fee), newValue: inr(snapshot.contribution) },
            { field: "clubSponsorship", oldValue: inr(snap ? snap.sponsorship : Number(payment.feeOffsetAmount) || 0), newValue: inr(snapshot.sponsorship) },
            { field: "reason", newValue: reason },
          ],
          summary,
        },
        tx,
      );
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof RequestError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[finance/match-plans] failed", err);
    return NextResponse.json({ error: "The change could not be saved." }, { status: 500 });
  }
}
