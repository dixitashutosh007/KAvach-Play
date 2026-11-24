/**
 * Weekend match operations — schedule and eligibility rules
 * (`tests/weekend-ops.test.mjs`). Imports the PRODUCTION module lib/weekend-ops.ts.
 * No browser, emulator, network or database access.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as w from "../lib/weekend-ops.ts";

const ist = (date, time = "00:00") => w.istToMs(date, time);
// 2026-11-21 is a Saturday, 2026-11-22 Sunday, 2026-11-23 Monday, 2026-11-24 Tuesday.
const m = (id, date, time = "07:00", format = "T20", extra = {}) => ({ id, date, time, format, result: "Pending", ...extra });

describe("IST calendar", () => {
  it("converts IST wall-clock time and rejects malformed or overflowed dates", () => {
    assert.equal(ist("2026-11-22", "19:00"), Date.UTC(2026, 10, 22, 13, 30));
    assert.equal(w.istToMs("2026-02-31", "10:00"), null);
    assert.equal(w.istToMs("2026-11-22", "25:00"), null);
    assert.equal(w.istToMs("22/11/2026", "10:00"), null);
    assert.equal(w.istToMs(undefined, "10:00"), null);
    assert.equal(w.istDate(Date.UTC(2026, 10, 21, 19, 0)), "2026-11-22"); // 00:30 IST next day
  });
  it("finds the most recent weekly occurrence, inclusive of the exact minute", () => {
    assert.equal(w.lastOccurrence(ist("2026-11-22", "19:00"), 0, 19), ist("2026-11-22", "19:00"));
    assert.equal(w.lastOccurrence(ist("2026-11-22", "18:59"), 0, 19), ist("2026-11-15", "19:00"));
    assert.equal(w.lastOccurrence(ist("2026-11-24", "12:00"), 2, 8), ist("2026-11-24", "08:00"));
  });
});

describe("match completion estimate (no end-time field)", () => {
  it("adds 4 h (T20), 5 h (T30), 6 h (Other) to the start", () => {
    assert.deepEqual(w.estimatedEnd(m("a", "2026-11-22", "07:00", "T20")), { ms: ist("2026-11-22", "11:00") });
    assert.deepEqual(w.estimatedEnd(m("a", "2026-11-22", "07:00", "T30")), { ms: ist("2026-11-22", "12:00") });
    assert.deepEqual(w.estimatedEnd(m("a", "2026-11-22", "07:00", "Other")), { ms: ist("2026-11-22", "13:00") });
  });
  it("never guesses: missing start or format is an exception", () => {
    assert.deepEqual(w.estimatedEnd(m("a", "2026-11-22", "")), { issue: "missing_or_invalid_start" });
    assert.deepEqual(w.estimatedEnd(m("a", "", "07:00")), { issue: "missing_or_invalid_start" });
    assert.deepEqual(w.estimatedEnd(m("a", "2026-11-22", "07:00", "T20", { format: undefined })), { issue: "missing_or_unknown_format" });
    assert.deepEqual(w.estimatedEnd(m("a", "2026-11-22", "07:00", "T10")), { issue: "missing_or_unknown_format" });
  });
  it("is eligible exactly 6 h after the estimated end, and never when a result exists", () => {
    const x = m("a", "2026-11-22", "07:00", "T20"); // end 11:00 → eligible 17:00
    assert.equal(w.resultEligibility(x, ist("2026-11-22", "16:59")).eligible, false);
    assert.equal(w.resultEligibility(x, ist("2026-11-22", "17:00")).eligible, true);
    assert.deepEqual(w.resultEligibility({ ...x, result: "KAvach Won" }, ist("2026-11-29")), { eligible: false, reason: "has_result" });
    assert.deepEqual(w.resultEligibility({ ...x, isArchived: true }, ist("2026-11-29")), { eligible: false, reason: "archived" });
    assert.equal(w.resultEligibility({ ...x, result: undefined }, ist("2026-11-29")).eligible, true);
  });
  it("maps the four prompt choices to the stored result values only", () => {
    assert.deepEqual(w.RESULT_CHOICES.map((c) => c.value), ["KAvach Won", "KAvach Lost", "Tie", "Abandoned"]);
    assert.equal(w.isResultValue("Pending"), false);
    assert.equal(w.isResultValue("Draw"), false);
    assert.equal(w.isResultValue("KAvach Won"), true);
  });
});

describe("results prompt (Sunday 19:00 IST)", () => {
  const matches = [
    m("sat", "2026-11-21", "07:00"),
    m("sun-late", "2026-11-22", "14:00", "T20"), // end 18:00, eligible Monday 00:00 → not by the 19:00 cutoff
    m("sun", "2026-11-22", "07:00"),
    m("done", "2026-11-22", "07:00", "T20", { result: "KAvach Lost" }),
    m("old10", "2026-11-12", "07:00"),
    m("old20", "2026-11-02", "07:00"),
    m("nofmt", "2026-11-21", "07:00", "T20", { format: undefined }),
  ];
  it("includes eligible matches in the 14-day testing look-back, excludes recorded and too-recent ones, reports exceptions", () => {
    const r = w.resultsPrompt(matches, ist("2026-11-22", "19:00"), "testing");
    assert.deepEqual(r.items.map((x) => x.id), ["old10", "sat", "sun"]);
    assert.deepEqual(r.exceptions, [{ id: "nofmt", reason: "missing_or_unknown_format" }]);
  });
  it("uses 7 days in recurring mode; older matches are only in the backfill queue", () => {
    const r = w.resultsPrompt(matches, ist("2026-11-22", "19:00"), "recurring");
    assert.deepEqual(r.items.map((x) => x.id), ["sat", "sun"]);
    assert.deepEqual(w.resultsBackfill(matches, ist("2026-11-23", "08:00")).map((x) => x.id), ["old20", "old10", "sat", "sun", "sun-late"]);
  });
  it("before Sunday 19:00 the cutoff is the previous Sunday, so this weekend is not yet due", () => {
    const r = w.resultsPrompt(matches, ist("2026-11-22", "18:59"), "recurring");
    assert.deepEqual(r.items.map((x) => x.id), ["old10"]);
  });
});

describe("Player of the Weekend window (Monday 08:00 → Friday 23:59 IST)", () => {
  it("opens Monday 08:00 for the preceding Saturday", () => {
    assert.deepEqual(w.potwWindow(ist("2026-11-23", "07:59")), { open: false });
    const open = w.potwWindow(ist("2026-11-23", "08:00"));
    assert.equal(open.open, true);
    assert.equal(open.weekendId, "2026-11-21");
    assert.equal(w.potwWindow(ist("2026-11-27", "23:58")).weekendId, "2026-11-21");
    assert.deepEqual(w.potwWindow(ist("2026-11-28", "00:00")), { open: false });
    assert.deepEqual(w.potwWindow(ist("2026-11-29", "12:00")), { open: false });
  });
  it("labels the weekend and derives one deterministic id per weekend", () => {
    assert.equal(w.weekendLabel("2026-11-21"), "21 Nov – 22 Nov 2026");
    assert.deepEqual(w.potwIds("2026-11-21"), { badge: "potw_2026-11-21", post: "potw_2026-11-21", notification: "potw_2026-11-21" });
  });
  it("validates the optional message: ≤ 4 lines, ≤ 120 characters", () => {
    assert.deepEqual(w.validatePotwMessage(undefined), { ok: true, value: "" });
    assert.deepEqual(w.validatePotwMessage("  82* off 51  "), { ok: true, value: "82* off 51" });
    assert.equal(w.validatePotwMessage("a\nb\nc\nd").ok, true);
    assert.equal(w.validatePotwMessage("a\nb\nc\nd\ne").ok, false);
    assert.equal(w.validatePotwMessage("x".repeat(121)).ok, false);
    assert.equal(w.validatePotwMessage("x".repeat(120)).ok, true);
    assert.equal(w.validatePotwMessage(42).ok, false);
    assert.equal(w.validatePotwMessage("bad\u0007bell").ok, false);
  });
  it("banner shows the newest award for 7 days or until a newer award", () => {
    const toMs = (v) => (typeof v === "number" ? v : null);
    const a1 = { id: "potw_2026-11-14", kind: "potw", createdAt: ist("2026-11-16", "09:00") };
    const a2 = { id: "potw_2026-11-21", kind: "potw", createdAt: ist("2026-11-23", "09:00") };
    const other = { id: "p", createdAt: ist("2026-11-24", "09:00") };
    assert.equal(w.activePotwPost([a1, other], ist("2026-11-22", "12:00"), toMs)?.id, a1.id);
    assert.equal(w.activePotwPost([a1, a2, other], ist("2026-11-23", "10:00"), toMs)?.id, a2.id);
    assert.equal(w.activePotwPost([a1], ist("2026-11-23", "09:00"), toMs), null); // exactly 7 days
    assert.equal(w.activePotwPost([a2], ist("2026-11-30", "08:59"), toMs)?.id, a2.id);
    assert.equal(w.activePotwPost([other], ist("2026-11-24", "10:00"), toMs), null);
  });
});

describe("actual match fee prompt (Tuesday 08:00 IST)", () => {
  const matches = [
    m("sat", "2026-11-21"),
    m("sun", "2026-11-22", "07:00", "T20", { result: "Abandoned" }),
    m("paid", "2026-11-22", "07:00", "T20", { groundFeePaidAmount: 0 }),
    m("closed", "2026-11-21", "07:00", "T20", { financeStatus: "closed" }),
    m("archived", "2026-11-21", "07:00", "T20", { isArchived: true }),
    m("prev", "2026-11-15"),
    m("future", "2026-11-28"),
  ];
  it("recurring: only the preceding Saturday–Sunday with no recorded fee (₹0 counts as recorded)", () => {
    const f = w.feesPrompt(matches, ist("2026-11-24", "08:00"), "recurring");
    assert.deepEqual([f.from, f.to], ["2026-11-21", "2026-11-22"]);
    assert.deepEqual(f.items.map((x) => x.id), ["sat", "sun"]);
  });
  it("testing: 14 days before the Tuesday cutoff", () => {
    const f = w.feesPrompt(matches, ist("2026-11-24", "09:00"), "testing");
    assert.deepEqual(f.items.map((x) => x.id), ["prev", "sat", "sun"]);
  });
  it("before Tuesday 08:00 the previous weekend applies", () => {
    const f = w.feesPrompt(matches, ist("2026-11-24", "07:59"), "recurring");
    assert.deepEqual([f.from, f.to], ["2026-11-14", "2026-11-15"]);
    assert.deepEqual(f.items.map((x) => x.id), ["prev"]);
  });
  it("mode switch is a server setting defaulting to testing", () => {
    assert.equal(w.weekendOpsMode({}), "testing");
    assert.equal(w.weekendOpsMode({ WEEKEND_OPS_MODE: "recurring" }), "recurring");
    assert.equal(w.weekendOpsMode({ WEEKEND_OPS_MODE: "RECURRING" }), "testing");
  });
});

describe("CricHeroes link", () => {
  it("accepts https CricHeroes hosts only", () => {
    assert.equal(w.cricHeroesHref("https://cricheroes.com/scorecard/123/x"), "https://cricheroes.com/scorecard/123/x");
    assert.equal(w.cricHeroesHref(" https://www.cricheroes.in/match/1 "), "https://www.cricheroes.in/match/1");
    for (const bad of ["http://cricheroes.com/x", "javascript:alert(1)", "https://cricheroes.com.evil.io/x", "https://evilcricheroes.com/x", "", null, 5, "not a url"]) {
      assert.equal(w.cricHeroesHref(bad), null, String(bad));
    }
  });
});

describe("server routes keep the approved authority", () => {
  const src = (f) => fs.readFileSync(f, "utf-8");
  const roles = src("lib/weekend-ops-server.ts");
  it("results: Super Admin + Match Admin only (Club Admin not added before role consolidation)", () => {
    assert.match(roles, /RESULT_RECORDER_ROLES = \["superAdmin", "matchAdmin"\] as const/);
    assert.match(src("app/api/admin/weekend-results/route.ts"), /requireRole\(req, \[\.\.\.RESULT_RECORDER_ROLES\]\)/);
  });
  it("award: the existing badge authority; fees: the existing Finance guard on the unchanged ledger route", () => {
    assert.match(roles, /POTW_AWARD_ROLES = \["superAdmin", "clubAdmin"\] as const/);
    assert.match(roles, /FEE_ROLES = \["superAdmin", "financeAdmin"\] as const/);
    assert.match(src("app/api/finance/match-ledger/route.ts"), /const guard = await requireFinanceAdmin\(req\);/);
  });
  it("the test clock override is honoured only behind the test auth bypass", () => {
    assert.match(roles, /if \(isTestAuthBypassAllowed\(\)\) \{\s*const pinned = Number\(req\.headers\.get\("x-test-now"\)\)/);
  });
  it("one waiver mechanism: both routes call the shared abandoned-match transition", () => {
    assert.match(src("app/api/admin/reconcile-abandoned/route.ts"), /waiveAbandonedMatchObligations\(db, match, \{ dryRun, actor \}\)/);
    assert.match(src("app/api/admin/weekend-results/route.ts"), /waiveAbandonedMatchObligations\(db, saved\.match, \{ actor \}\)/);
  });
});
