/**
 * Finance Plans — Stage 2 (`tests/finance-plans.test.mjs`).
 * Pure rules, server-route source inspection and wiring checks only:
 * no emulator, browser, network or database access.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const req = createRequire(import.meta.url);
const cache = new Map();
const withExt = (b) => {
  for (const e of [".tsx", ".ts", ".js"]) if (fs.existsSync(b + e)) return b + e;
  return b;
};
function load(f) {
  const abs = path.resolve(f);
  if (cache.has(abs)) return cache.get(abs);
  const js = ts.transpileModule(fs.readFileSync(abs, "utf-8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  cache.set(abs, mod.exports);
  const dir = path.dirname(abs);
  const r = (id) => {
    if (id.startsWith("@/lib/")) return load(withExt(path.resolve("lib", id.slice(6).replace(/\.ts$/, ""))));
    if (id.startsWith("./") || id.startsWith("../")) return load(withExt(path.resolve(dir, id.replace(/\.ts$/, ""))));
    return req(id);
  };
  new Function("require", "module", "exports", js)(r, mod, mod.exports);
  cache.set(abs, mod.exports);
  return mod.exports;
}
const src = (f) => fs.readFileSync(path.resolve(f), "utf-8");
const fp = load("lib/finance-plans.ts");

describe("Plan calculations (brief examples)", () => {
  it("Regular: full fee, no sponsorship", () => {
    assert.deepEqual(fp.planContribution(null, 700), { contribution: 700, sponsorship: 0 });
  });
  it("Fixed: ₹500 of ₹700 → club sponsors ₹200; above the fee is charged at the fee and flagged", () => {
    assert.deepEqual(fp.planContribution({ type: "fixed", feeAmount: 500 }, 700), { contribution: 500, sponsorship: 200 });
    const over = fp.planContribution({ type: "fixed", feeAmount: 800 }, 700);
    assert.equal(over.contribution, 700);
    assert.equal(over.sponsorship, 0);
    assert.match(over.warning, /above the match fee/);
  });
  it("Club Sponsored: player ₹0, club ₹700", () => {
    assert.deepEqual(fp.planContribution({ type: "sponsored" }, 700), { contribution: 0, sponsorship: 700 });
  });
  it("Percentage: 10% of ₹700 → ₹630 / ₹70; discount rounded to the rupee; parts always add up", () => {
    assert.deepEqual(fp.planContribution({ type: "percentage", discountPct: 10 }, 700), { contribution: 630, sponsorship: 70 });
    const odd = fp.planContribution({ type: "percentage", discountPct: 33.3 }, 700);
    assert.deepEqual(odd, { contribution: 467, sponsorship: 233 });
    for (const pct of [0, 1, 12.5, 50, 99, 100]) {
      for (const fee of [0, 1, 349, 700, 1234]) {
        const r = fp.planContribution({ type: "percentage", discountPct: pct }, fee);
        assert.equal(r.contribution + r.sponsorship, fee);
        assert.ok(r.contribution >= 0 && r.sponsorship >= 0);
      }
    }
  });
  it("Monthly: fixed per-match allocation, or pending until the period is closed", () => {
    assert.deepEqual(fp.planContribution({ type: "monthly", allocationPolicy: "fixed_per_match", perMatchContribution: 500 }, 700), { contribution: 500, sponsorship: 200 });
    assert.equal(fp.planContribution({ type: "monthly", allocationPolicy: "distribute" }, 700).pendingAllocation, true);
  });
});

describe("Plan validation", () => {
  const ok = { name: "Youth 350", type: "fixed", feeAmount: 350 };
  it("accepts valid configs for every type", () => {
    assert.equal(fp.validatePlanConfig(ok), null);
    assert.equal(fp.validatePlanConfig({ name: "Ten off", type: "percentage", discountPct: 10 }), null);
    assert.equal(fp.validatePlanConfig({ name: "Sponsored", type: "sponsored" }), null);
    assert.equal(fp.validatePlanConfig({ name: "Monthly", type: "monthly", monthlyAmount: 2000, allocationPolicy: "distribute" }), null);
    assert.equal(fp.validatePlanConfig({ name: "Monthly", type: "monthly", monthlyAmount: 2000, allocationPolicy: "fixed_per_match", perMatchContribution: 500 }), null);
  });
  it("rejects bad values", () => {
    assert.match(fp.validatePlanConfig({ ...ok, name: " " }), /name/);
    assert.match(fp.validatePlanConfig({ ...ok, feeAmount: -1 }), /zero or more/);
    assert.match(fp.validatePlanConfig({ name: "x", type: "percentage", discountPct: 120 }), /between 0 and 100/);
    assert.match(fp.validatePlanConfig({ name: "x", type: "monthly", monthlyAmount: 100 }), /allocated/);
    assert.match(fp.validatePlanConfig({ name: "x", type: "monthly", monthlyAmount: 100, allocationPolicy: "fixed_per_match" }), /per match/);
    assert.match(fp.validatePlanConfig({ ...ok, validFrom: "2026-12-01", validTo: "2026-11-01" }), /on or after/);
    assert.match(fp.validatePlanConfig({ name: "x", type: "regular" }), /plan type/);
  });
  it("describes plans", () => {
    assert.equal(fp.describePlan({ type: "fixed", feeAmount: 350 }), "₹350 per match");
    assert.equal(fp.describePlan({ type: "percentage", discountPct: 10 }), "10% off the match fee");
    assert.match(fp.describePlan({ type: "monthly", monthlyAmount: 2000, allocationPolicy: "fixed_per_match", perMatchContribution: 500 }), /₹2,000 per period · ₹500 allocated per match/);
  });
});

describe("Assignment lifecycle", () => {
  const a = (over = {}) => ({ id: "a1", playerId: "p1", planId: "y", planName: "Youth", startDate: "2026-11-01", endDate: "2026-11-30", ...over });
  it("status by date: scheduled / active / ended / cancelled", () => {
    assert.equal(fp.assignmentStatus(a(), "2026-10-31"), "scheduled");
    assert.equal(fp.assignmentStatus(a(), "2026-11-01"), "active");
    assert.equal(fp.assignmentStatus(a(), "2026-11-30"), "active");
    assert.equal(fp.assignmentStatus(a(), "2026-12-01"), "ended");
    assert.equal(fp.assignmentStatus(a({ cancelled: true }), "2026-11-10"), "cancelled");
  });
  it("eligibility uses the match date (inclusive), not today", () => {
    assert.ok(fp.coversDate(a(), "2026-11-01"));
    assert.ok(fp.coversDate(a(), "2026-11-30"));
    assert.ok(!fp.coversDate(a(), "2026-12-01"));
    assert.ok(fp.coversDate(a({ endDate: null }), "2030-01-01"));
    assert.ok(!fp.coversDate(a({ cancelled: true }), "2026-11-10"));
    assert.equal(fp.assignmentOn([a()], "p1", "2026-12-05"), null);
    assert.equal(fp.assignmentOn([a()], "p1", "2026-11-05").id, "a1");
  });
  it("overlap detection (inclusive, open-ended, legacy = since forever, cancelled ignored)", () => {
    const ex = [a()];
    assert.ok(fp.findConflict(ex, { playerId: "p1", startDate: "2026-11-30", endDate: null }), "touching end day overlaps");
    assert.equal(fp.findConflict(ex, { playerId: "p1", startDate: "2026-12-01", endDate: null }), null);
    assert.equal(fp.findConflict(ex, { playerId: "p2", startDate: "2026-11-05", endDate: null }), null);
    assert.ok(fp.findConflict([a({ endDate: null })], { playerId: "p1", startDate: "2027-05-01", endDate: "2027-05-02" }));
    assert.equal(fp.findConflict([a({ cancelled: true })], { playerId: "p1", startDate: "2026-11-05", endDate: null }), null);
    const legacy = fp.legacyAssignmentsFor({ id: "p1", feePlanIds: ["old"] }, [{ id: "old", name: "Old 300" }]);
    assert.equal(legacy[0].legacy, true);
    assert.equal(legacy[0].startDate, null);
    assert.ok(fp.findConflict(legacy, { playerId: "p1", startDate: "2020-01-01", endDate: "2020-01-02" }));
    assert.match(fp.conflictMessage("Asha", legacy[0]), /Asha is already on Old 300 with no end date \(legacy assignment\)\. End that assignment first\./);
  });
  it("dated assignment wins over a legacy one if old data has both", () => {
    const legacy = fp.legacyAssignmentsFor({ id: "p1", feePlanIds: ["old"] }, [{ id: "old", name: "Old" }]);
    assert.equal(fp.assignmentOn([...legacy, a()], "p1", "2026-11-05").id, "a1");
  });
  it("range validation incl. plan active flag and validity window", () => {
    const plan = { name: "Youth", isActive: true };
    assert.equal(fp.validateAssignmentRange("2026-11-01", null, plan), null);
    assert.match(fp.validateAssignmentRange("bad", null, plan), /start date/);
    assert.match(fp.validateAssignmentRange("2026-11-10", "2026-11-01", plan), /on or after/);
    assert.match(fp.validateAssignmentRange("2026-11-01", null, { ...plan, isActive: false }), /inactive/);
    assert.match(fp.validateAssignmentRange("2026-10-01", null, { ...plan, validFrom: "2026-11-01" }), /only valid from/);
    assert.match(fp.validateAssignmentRange("2026-11-01", null, { ...plan, validTo: "2026-12-31" }), /set an end date/);
    assert.equal(fp.validateAssignmentRange("2026-11-01", "2026-12-31", { ...plan, validTo: "2026-12-31" }), null);
  });
});

describe("Server API: authorisation, no deletes, all-or-nothing, audited", () => {
  const route = src("app/api/finance/assignments/route.ts");
  it("GET: Club, Match, Finance and Super Admins only; POST: Finance and Super Admin only", () => {
    assert.match(route, /export async function GET[\s\S]*?requireRole\(req, \["superAdmin", "financeAdmin", "clubAdmin", "matchAdmin"\]\)/);
    assert.match(route, /export async function POST[\s\S]*?const guard = await requireFinanceAdmin\(req\);\s*if \(!guard\.ok\) return guard\.response;/);
  });
  it("assign: transaction, overlap incl. legacy blocks the whole request (409), nothing written", () => {
    assert.match(route, /return db\.runTransaction\(async \(tx\) => \{/);
    assert.match(route, /const conflict = findConflict\(\[\.\.\.existing, \.\.\.legacy\], \{ playerId: ps\.id, startDate: String\(startDate\), endDate \}\);/);
    assert.match(route, /throw new RequestError\(409, `\$\{conflicts\.length\} player/);
    assert.ok(route.indexOf("if (conflicts.length)") < route.indexOf("tx.set(ref, {"), "check before any write");
  });
  it("never deletes; end sets endDate (only earlier), cancel only before start; legacy kept as a record", () => {
    assert.ok(!/\.delete\(/.test(route));
    assert.match(route, /Ending can only bring that date forward/);
    assert.match(route, /This assignment has already started; end it instead of cancelling/);
    const legacy = route.slice(route.indexOf("async function endLegacy"));
    assert.ok(legacy.indexOf("tx.set(ref, {") < legacy.indexOf("arrayRemove(planId)"), "record created before the legacy id is removed");
    assert.match(legacy, /legacy: true,/);
  });
  it("every change writes an audit entry in the same transaction", () => {
    assert.equal((route.match(/await writeServerAudit\(/g) || []).length, 4);
    assert.equal((route.match(/entity: "fee_plan_assignment"/g) || []).length, 4);
    assert.match(src("lib/server-audit.ts"), /db\.collection\("auditLogs"\)/);
    assert.match(src("lib/auditLog.ts"), /\| "fee_plan_assignment"/);
  });
});

describe("UI wiring", () => {
  it("Finance tab label renamed; screen evolves FeePlansAdmin", () => {
    assert.match(src("components/FinanceTab.tsx"), /Finance Plans\n\s*<\/button>/);
    assert.ok(!/Match Fee Plans/.test(src("components/FinanceTab.tsx")));
    const ui = src("components/FeePlansAdmin.tsx");
    assert.match(ui, /export function FeePlansAdmin/);
    assert.match(ui, /const canManage = Boolean\(hasAdminClaim \|\| appUser\?\.isFinanceAdmin\);/);
    for (const k of ['data-testid="finance-plan-new"', 'data-testid="finance-plan-add-players"', "Built-in", "Assigned players", '"current", "Current"', '"history", "History"']) {
      assert.ok(ui.includes(k), k);
    }
    // management controls only for canManage
    assert.match(ui, /\{canManage && \(\s*<button[\s\S]{0,200}data-testid="finance-plan-new"/);
  });
  it("plans with history can't be deleted (deactivate instead); type locked once assigned", () => {
    const ui = src("components/FeePlansAdmin.tsx");
    assert.match(ui, /const neverAssigned = !allAssignments\.some\(\(a\) => a\.planId === plan\.id\);/);
    assert.match(ui, /\{neverAssigned && \(/);
    assert.match(ui, /The type can't change once players have been assigned/);
  });
  it("player editor no longer writes feePlanIds; shows the plan read-only", () => {
    const ed = src("components/EditPlayerInline.tsx");
    assert.ok(!/feePlanIds:/.test(ed));
    assert.match(ed, /<PlayerFinancePlanSummary player=\{player\} plans=\{store\.feePlans \|\| \[\]\} \/>/);
  });
  it("roster shows the current plan only once assignments loaded", () => {
    const pt = src("components/PlayersTab.tsx");
    assert.match(pt, /const showPlans = isAdmin && !plansLoading && !plansError;/);
    assert.match(pt, /data-testid=\{`roster-finance-plan-\$\{player\.id\}`\}/);
  });
  it("percentage plans apply via the shared rule in Match Details", () => {
    const mt = src("components/MatchesTab.tsx");
    assert.match(mt, /if \(plan\.type === "percentage"\) \{[\s\S]*?const \{ contribution, sponsorship \} = planContribution\(plan, standardFee\);/);
  });
});
