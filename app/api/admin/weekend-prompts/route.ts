/**
 * GET /api/admin/weekend-prompts — due weekend-operations prompts for the caller.
 *
 * Server clock (Asia/Kolkata) + pending state held in the data itself, so a
 * prompt is available on the first eligible admin visit after its scheduled
 * time and disappears for everyone once the work is recorded. Read-only.
 *
 * Sections are returned only for the caller's verified roles:
 *   results — Super Admin / Club Admin    (Sunday 19:00 IST)
 *   potw    — Super Admin / Club Admin    (Monday 08:00 – Friday 23:59 IST)
 *   fees    — Super Admin / Finance Admin (Tuesday 08:00 IST)
 * `?view=history` returns the persistent Historical Data Completion lists and
 * counts for the caller's roles — everything pending that is NOT in the current
 * recurring prompt (an item is in exactly one of the two):
 *   results — eligible matches with no result (+ start/format exceptions)
 *   fees    — concluded, open-finance matches with no actual fee
 *   potw    — past weekends (from POTW_HISTORY_FROM) with a played match and no award
 * Nothing is filled in automatically; completion goes through the same routes.
 */
import { NextResponse } from "next/server.js";
import { requireRole, type AppRole } from "../../../../lib/server-auth.ts";
import { getServerFirestore } from "../../../../lib/server-db.ts";
import {
  feesHistory,
  feesPrompt,
  istDate,
  POTW_BADGE_TYPE,
  potwHistory,
  potwHistoryFrom,
  potwIds,
  potwWindow,
  resultsHistory,
  resultsPrompt,
  weekendLabel,
  weekendOpsMode,
  type MatchLike,
} from "../../../../lib/weekend-ops.ts";
import { FEE_ROLES, POTW_AWARD_ROLES, RESULT_RECORDER_ROLES, serverNow } from "../../../../lib/weekend-ops-server.ts";

const ANY = [...new Set<AppRole>([...RESULT_RECORDER_ROLES, ...POTW_AWARD_ROLES, ...FEE_ROLES])];
const DAY = 24 * 60 * 60 * 1000;

const has = (roles: Set<AppRole>, allowed: readonly AppRole[]) => allowed.some((r) => roles.has(r));
const summary = (m: any) => ({
  id: m.id,
  date: m.date ?? null,
  time: m.time ?? null,
  format: m.format ?? null,
  opponent: m.opponent ?? "",
  groundId: m.groundId ?? null,
  matchType: m.matchType ?? null,
  result: m.result ?? null,
});

export async function GET(req: Request) {
  const guard = await requireRole(req, ANY);
  if (!guard.ok) return guard.response;
  const roles = guard.roles;
  const canResults = has(roles, RESULT_RECORDER_ROLES);
  const canPotw = has(roles, POTW_AWARD_ROLES);
  const canFees = has(roles, FEE_ROLES);

  const db = getServerFirestore();
  const now = serverNow(req);
  const mode = weekendOpsMode();
  const view = new URL(req.url).searchParams.get("view");

  try {
    if (view === "history") {
      // Full read of matches (and award ids) — only when an admin opens Match Center.
      const [snap, badgeSnap, postSnap] = await Promise.all([
        db.collection("matches").get(),
        canPotw ? db.collection("badges").where("badgeType", "==", POTW_BADGE_TYPE).get() : Promise.resolve(null),
        canPotw ? db.collection("posts").where("kind", "==", "potw").get() : Promise.resolve(null),
      ]);
      const all = snap.docs.map((d) => ({ ...(d.data() as any), id: d.id })) as MatchLike[];
      const out: Record<string, unknown> = { now, mode };
      if (canResults) {
        const r = resultsHistory(all, now, mode);
        out.results = { count: r.items.length, items: r.items.map(summary), exceptions: r.exceptions.map((m) => ({ ...summary(m), reason: m.reason })) };
      }
      if (canFees) {
        const f = feesHistory(all, now, mode);
        out.fees = { count: f.length, items: f.map((m: any) => ({ ...summary(m), fee: m.fee ?? null })) };
      }
      if (canPotw) {
        const awarded = new Set<string>();
        badgeSnap!.docs.forEach((d) => d.data()?.weekendId && awarded.add(String(d.data().weekendId)));
        postSnap!.docs.forEach((d) => d.data()?.potw?.weekendId && awarded.add(String(d.data().potw.weekendId)));
        const from = potwHistoryFrom();
        const w = potwHistory(all, awarded, now, from);
        out.potw = { count: w.length, from, items: w.map((x) => ({ weekendId: x.weekendId, label: x.label, matches: x.matches.map(summary) })) };
      }
      return NextResponse.json(out);
    }
    if (view) return NextResponse.json({ error: "Unknown view." }, { status: 400 });

    // One bounded read covers every section: matches dated within the widest look-back.
    const since = istDate(now - 22 * DAY);
    const snap = await db.collection("matches").where("date", ">=", since).get();
    const recent = snap.docs.map((d) => ({ ...(d.data() as any), id: d.id })) as MatchLike[];

    const out: Record<string, unknown> = { now, mode };
    const pending = { results: 0, potw: 0, fees: 0 };

    if (canResults) {
      const r = resultsPrompt(recent, now, mode);
      out.results = { cutoff: r.cutoff, windowStart: r.windowStart, items: r.items.map(summary), exceptions: r.exceptions };
      pending.results = r.items.length;
    }
    if (canPotw) {
      const w = potwWindow(now);
      if (w.open) {
        // Awarded if either the badge or the banner post exists (the award route
        // creates both together and refuses to recreate either).
        const ids = potwIds(w.weekendId);
        const [badgeSnap, postSnap] = await Promise.all([db.collection("badges").doc(ids.badge).get(), db.collection("posts").doc(ids.post).get()]);
        const awarded = badgeSnap.exists ? badgeSnap : postSnap;
        const awardedData = badgeSnap.exists ? badgeSnap.data() : postSnap.data()?.potw;
        const sunday = istDate(Date.parse(`${w.weekendId}T00:00:00+05:30`) + DAY);
        const weekendMatches = recent.filter((m) => m.date === w.weekendId || m.date === sunday);
        out.potw = {
          weekendId: w.weekendId,
          label: weekendLabel(w.weekendId),
          closesAt: w.closesAt,
          awarded: awarded.exists ? { playerId: awardedData?.playerId ?? null, playerName: awardedData?.playerName ?? null } : null,
          matches: weekendMatches.map(summary),
        };
        pending.potw = awarded.exists ? 0 : 1;
      } else {
        out.potw = null;
      }
    }
    if (canFees) {
      const f = feesPrompt(recent, now, mode);
      out.fees = { cutoff: f.cutoff, from: f.from, to: f.to, items: f.items.map((m: any) => ({ ...summary(m), fee: m.fee ?? null })) };
      pending.fees = f.items.length;
    }
    out.pending = pending;
    return NextResponse.json(out);
  } catch {
    console.error("[weekend-prompts] failed to compute prompts");
    return NextResponse.json({ error: "Could not load weekend tasks." }, { status: 500 });
  }
}
