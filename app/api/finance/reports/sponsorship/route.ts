/**
 * Sponsorship & subscription report (`/api/finance/reports/sponsorship`).
 *
 * GET ?from=YYYY-MM-DD&to=YYYY-MM-DD   (Club, Finance, Super Admin: read-only)
 *
 * Reads matches dated in the range, their payments and the subscription
 * periods overlapping it, and builds the report with the shared pure rules
 * (lib/subscription-periods → buildSponsorshipReport). Subscription money is
 * counted once, at the period; match-level subscription allocations are shown
 * as "covered", never again as cash collected. Abandoned matches are excluded.
 */
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/server-auth";
import { getServerFirestore } from "@/lib/server-db";
import { buildSponsorshipReport, type ReportMatch, type ReportPayment, type SubscriptionPeriod } from "@/lib/subscription-periods";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 366;

export async function GET(req: Request) {
  const guard = await requireRole(req, ["superAdmin", "financeAdmin", "clubAdmin"]);
  if (!guard.ok) return guard.response;
  const params = new URL(req.url).searchParams;
  const from = params.get("from") || "";
  const to = params.get("to") || "";
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || to < from) {
    return NextResponse.json({ error: "Choose a valid date range." }, { status: 400 });
  }
  if ((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000 > MAX_DAYS) {
    return NextResponse.json({ error: "Choose a range of up to one year." }, { status: 400 });
  }
  try {
    const db = getServerFirestore();
    const matchSnap = await db.collection("matches").where("date", ">=", from).where("date", "<=", to).get();
    const matches: ReportMatch[] = matchSnap.docs.map((d) => {
      const m = d.data();
      return { id: d.id, date: String(m.date || ""), opponent: m.opponent, fee: Number(m.fee) || 0, result: m.result };
    });
    const paySnaps = await Promise.all(matchSnap.docs.map((d) => d.ref.collection("payments").get()));
    const raw = paySnaps.flatMap((s, i) => s.docs.map((d) => ({ ...d.data(), matchId: matchSnap.docs[i].id })));
    const playerIds = [...new Set(raw.map((p: any) => p.playerId).filter((x: unknown) => typeof x === "string" && x))] as string[];
    const names: Record<string, string> = {};
    for (let i = 0; i < playerIds.length; i += 100) {
      const ps = await db.getAll(...playerIds.slice(i, i + 100).map((id) => db.collection("players").doc(id)));
      ps.forEach((p) => {
        if (p.exists) names[p.id] = String(p.data()?.name || "Player");
      });
    }
    const payments: ReportPayment[] = raw.map((p: any) => ({
      matchId: p.matchId,
      playerId: p.playerId,
      playerName: names[p.playerId] || "Player",
      status: p.status,
      guestName: p.guestName,
      feeOverride: p.feeOverride,
      feeOffsetAmount: p.feeOffsetAmount,
      feeCollectedAmount: p.feeCollectedAmount,
      manualMethod: p.manualMethod,
      planTag: p.planTag,
      financeSnapshot: p.financeSnapshot
        ? {
            planId: p.financeSnapshot.planId ?? null,
            planName: p.financeSnapshot.planName,
            planType: p.financeSnapshot.planType,
            source: p.financeSnapshot.source,
            pendingAllocation: !!p.financeSnapshot.pendingAllocation,
            periodId: p.financeSnapshot.periodId,
          }
        : undefined,
    }));
    const periodSnap = await db.collection("subscriptionPeriods").where("periodStart", "<=", to).get();
    const periods = periodSnap.docs.map((d) => d.data() as SubscriptionPeriod).filter((p) => p.periodEnd >= from);
    return NextResponse.json(buildSponsorshipReport({ from, to, matches, payments, periods }));
  } catch (err) {
    console.error("[finance/reports/sponsorship] failed", err);
    return NextResponse.json({ error: "Could not build the report." }, { status: 500 });
  }
}
