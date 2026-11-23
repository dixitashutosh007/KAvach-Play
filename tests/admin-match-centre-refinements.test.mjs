/**
 * Admin Match Centre refinements (`tests/admin-match-centre-refinements.test.mjs`):
 * regular list restored under the date selector, Calendar Sync button order,
 * lazily loaded per-match Payment Details, and the shared finance calculation.
 *
 * Pure functions, server-side rendering and source inspection only:
 * no emulator, browser, network or database access.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
import React from "react";
import ReactDOMServer from "react-dom/server";

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
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  cache.set(abs, mod.exports);
  const dir = path.dirname(abs);
  const r = (id) => {
    if (id === "react") return React;
    if (id.startsWith("@/lib/")) return load(withExt(path.resolve("lib", id.slice(6).replace(/\.ts$/, ""))));
    if (id.startsWith("@/components/")) return load(withExt(path.resolve("components", id.slice(13))));
    if (id.startsWith("./") || id.startsWith("../")) return load(withExt(path.resolve(dir, id.replace(/\.ts$/, ""))));
    return req(id);
  };
  new Function("require", "module", "exports", js)(r, mod, mod.exports);
  cache.set(abs, mod.exports);
  return mod.exports;
}
const render = (el) => ReactDOMServer.renderToStaticMarkup(el);
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const src = (f) => fs.readFileSync(path.resolve(f), "utf-8");

const { summarizeMatchFinance, financeReportPayments } = load("lib/match-finance.ts");
const { MatchPaymentPanel, formatINR } = load("components/matches/MatchPaymentPanel.tsx");

const match = { id: "m1", fee: 500, date: "2026-11-29", opponent: "Raptors", result: "Pending" };
const players = [
  { id: "p1", name: "Asha" },
  { id: "p2", name: "Ravi", photoURL: "https://example.com/r.jpg" },
  { id: "p3", name: "Kiran" },
  { id: "p4", name: "Meera" },
  { id: "p5", name: "Dev" },
  { id: "p6", name: "Neha" },
];
const pay = (id, playerId, status, over = {}) => ({ id, matchId: "m1", playerId, status, ...over });
const payments = [
  pay("a", "p1", "Paid", { paymentMethod: "razorpay" }),
  pay("b", "p2", "Paid", { paymentMethod: "manual", manualMethod: "club_sponsored" }),
  pay("c", "p3", "Unpaid"),
  pay("d", "p4", "Unpaid", { feeOverride: 300 }),
  pay("e", "p5", "Waived"),
  pay("f", "p6", "Not Playing"),
  pay("g", "ghost", "Unpaid"), // unknown player: excluded like the Finance report
  { id: "x", matchId: "other", playerId: "p1", status: "Paid" }, // other match
];

// ─────────────────────────────────────────────────────────────────────────────
describe("Shared finance calculation (Finance report == Match Centre panel)", () => {
  const rows = financeReportPayments(match, payments, players);
  const s = summarizeMatchFinance(match, rows, players);

  it("inclusion rule matches the Finance report (no Not Playing, known players, this match)", () => {
    assert.deepEqual(rows.map((r) => r.id), ["a", "b", "c", "d", "e"]);
  });
  it("collected excludes club-sponsored; sponsored offset counted; due sums Unpaid only", () => {
    assert.equal(s.feeCollected, 500);
    // existing semantics: ₹500 club-sponsored + ₹200 fee-override discount (500 → 300)
    assert.equal(s.feeOffset, 700);
    assert.equal(s.totalDue, 800);
    assert.deepEqual(s.paidPlayers, ["Asha", "Ravi"]);
    assert.deepEqual(s.unpaidPlayers, ["Kiran", "Meera", "Dev"]);
  });
  it("FinanceTab now calls the shared function (no inline duplicate)", () => {
    const fin = src("components/FinanceTab.tsx");
    assert.match(fin, /return summarizeMatchFinance\(match, paymentsForMatch, store\.players\);/);
    assert.ok(!/let feeCollected = 0;/.test(fin));
    assert.match(src("lib/match-finance.ts"), /let feeCollected = 0;/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("Payment Details panel (lazy)", () => {
  const panel = (props = {}) =>
    render(React.createElement(MatchPaymentPanel, { match, players, payments, status: "ready", ensureMatchPayments: () => {}, ...props }));

  it("collapsed by default: only the bar, no payment content", () => {
    const html = panel();
    assert.ok(html.includes('data-testid="payment-toggle-m1"'));
    assert.ok(html.includes('aria-expanded="false"'));
    assert.match(text(html), /Payment Details/);
    assert.ok(!html.includes("payment-body-m1"));
    assert.ok(!/₹/.test(text(html)), "no amounts while collapsed");
  });

  it("fetches only after expanding, for this match only", () => {
    const s = src("components/matches/MatchPaymentPanel.tsx");
    assert.match(s, /if \(open\) ensureMatchPayments\?\.\(match\.id\);/);
    assert.match(s, /const \[open, setOpen\] = useState\(defaultOpen\);/);
  });

  it("loading and error states never show figures; error offers Retry", () => {
    for (const status of [undefined, "loading"]) {
      const html = panel({ defaultOpen: true, status });
      assert.ok(html.includes('data-testid="payment-loading"'));
      assert.ok(!/₹/.test(text(html)));
    }
    const err = panel({ defaultOpen: true, status: "error" });
    assert.ok(err.includes('data-testid="payment-error"'));
    assert.match(text(err), /Retry/);
    assert.ok(!/₹/.test(text(err)));
  });

  it("summary uses the shared calculation and INR formatting", () => {
    const html = panel({ defaultOpen: true });
    const metric = (id) => text(html.slice(html.indexOf(`data-testid="${id}"`), html.indexOf("</div>", html.indexOf(`data-testid="${id}"`))));
    assert.match(metric("payment-collected"), /Collected ₹500/);
    assert.match(metric("payment-sponsored"), /KAvach Sponsored ₹700/);
    assert.match(metric("payment-pending"), /Pending ₹800/);
    assert.equal(formatINR(125000), "₹1,25,000");
  });

  it("paid / unpaid / waived players are classified without duplicates", () => {
    const html = panel({ defaultOpen: true });
    const section = (id) => text(html.slice(html.indexOf(`data-testid="${id}"`), html.indexOf("</ul>", html.indexOf(`data-testid="${id}"`))));
    assert.match(section("paid-players"), /Paid Players \(2\).*Asha.*Ravi/);
    assert.match(section("unpaid-players"), /Unpaid Players \(2\).*Kiran.*₹500 due.*Meera.*₹300 due/);
    assert.match(section("waived-players"), /Waived \(1\).*Dev/);
    assert.ok(!section("unpaid-players").includes("Dev"));
    assert.ok(!section("paid-players").includes("Kiran"));
    assert.ok(!text(html).includes("Neha"), "Not Playing excluded");
  });

  it("player lists scroll horizontally with fixed-size chips; photo used when safe", () => {
    const html = panel({ defaultOpen: true });
    const list = html.slice(html.lastIndexOf("<ul", html.indexOf('data-testid="paid-players-list"')), html.indexOf(">", html.indexOf('data-testid="paid-players-list"')));
    for (const c of ["flex", "overflow-x-auto", "no-scrollbar"]) assert.ok(list.includes(c), c);
    assert.ok(!list.includes("flex-wrap"));
    assert.ok(html.includes('class="shrink-0 w-[5.5rem]'));
    assert.ok(html.includes('src="https://example.com/r.jpg"'));
  });

  it("empty states: no records, nobody paid, nobody pending", () => {
    assert.ok(panel({ defaultOpen: true, payments: [] }).includes('data-testid="payment-empty"'));
    const onlyUnpaid = panel({ defaultOpen: true, payments: [pay("c", "p3", "Unpaid")] });
    assert.match(text(onlyUnpaid), /No players have paid yet\./);
    const onlyPaid = panel({ defaultOpen: true, payments: [pay("a", "p1", "Paid")] });
    assert.match(text(onlyPaid), /No pending payments\./);
  });

  it("abandoned (non-billable) match is flagged rather than shown as a plain due", () => {
    const html = panel({ defaultOpen: true, match: { ...match, result: "Abandoned" } });
    assert.match(text(html), /Not billable/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("On-demand payment loading (no preload for the admin Match Centre)", () => {
  it("page: admin persona on Matches no longer starts the all-payments listener", () => {
    const page = src("app/page.tsx");
    assert.match(page, /const wantsAllPayments =\s*PAYMENT_TABS\.has\(activeTab\) && !\(activeTab === "matches" && persona === "admin"\);/);
    assert.match(page, /if \(wantsAllPayments\) store\.ensurePayments\?\.\(playerScope\);/);
    assert.match(page, /if \(!wantsAllPayments\) store\.detachDomain\?\.\("allPayments"\);/);
  });
  it("store: per-match load status with retry after an error", () => {
    const st = src("hooks/useStore.ts");
    assert.match(st, /const \[matchPaymentsStatus, setMatchPaymentsStatus\]/);
    assert.match(st, /\[matchId\]: "error"/);
    assert.match(st, /lazySubsRef\.current\.delete\(key\);\s*setMatchPaymentsStatus/);
    assert.match(st, /if \(lazySubsRef\.current\.has\(key\)\) return;/, "duplicate listeners prevented");
    assert.match(st, /    matchPaymentsStatus,\n/);
  });
  it("Matches tab: Calendar loads all (Assign retired, D-19); edit form and match detail load one match", () => {
    const tab = src("components/MatchesTab.tsx");
    assert.match(tab, /if \(subTab === "matches" && activeView === "calendar"\) store\.ensurePayments\?\.\(\);/);
    assert.match(tab, /if \(isAdmin && editingId\) store\.ensureMatchPayments\?\.\(editingId\);/);
    assert.match(tab, /store\.ensureMatchPayments\?\.\(match\.id\);\s*\/\/ eslint-disable-next-line react-hooks\/exhaustive-deps\s*\}, \[match\.id, store\.ensureMatchPayments, store\.refreshNonce\]\);/);
  });
  it("collapsed admin cards no longer compute counts from preloaded payments", () => {
    const tab = src("components/MatchesTab.tsx");
    const card = tab.slice(tab.indexOf("const renderMatchCard ="), tab.indexOf("if (isAdmin) {", tab.indexOf("const renderMatchCard =")));
    assert.ok(!/store\.payments\.(filter|find|some)/.test(card), "no per-card counting over preloaded payments");
    assert.match(card, /payments=\{store\.payments\}/, "rows handed to the lazy panel only");
    assert.match(card, /Ground Fee Paid/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("List View: regular listing always visible", () => {
  const tab = src("components/MatchesTab.tsx");
  const admin = tab.slice(tab.indexOf("if (isAdmin) {", tab.indexOf("const renderMatchCard =")), tab.indexOf("if (allMatches.length === 0) {"));

  it("date selector first, then the regular list (independent of selection)", () => {
    const dateList = admin.indexOf("<AdminMatchDateList");
    const regular = admin.indexOf('data-testid="regular-match-list"');
    assert.ok(dateList > 0 && regular > dateList);
    assert.match(admin, /\{regularList\}/);
    assert.ok(!/selectedKey|picked/.test(admin), "regular list does not depend on the selected date");
  });
  it("existing ordering and groups restored", () => {
    assert.match(admin, /const fourteenDaysFromNow = new Date\(now\);/);
    assert.match(admin, /pastCutoff\.setDate\(pastCutoff\.getDate\(\) - 10\);/);
    assert.match(admin, /upcomingNear\.map\(renderMatchCard\)/);
    assert.match(admin, /Scheduled Later \(\{upcomingLater\.length\}\)/);
    assert.match(admin, /Past Matches \(\{pastMatches\.length\}\)/);
    assert.match(tab, /useSessionState\(\s*"matches:isLaterScheduledCollapsed",\s*true,/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("Calendar Sync toolbar (mobile grid, desktop row)", () => {
  const tb = src("components/MatchToolbar.tsx");
  const tag = (id) => tb.slice(tb.lastIndexOf("<", tb.indexOf(`data-testid="${id}"`)), tb.indexOf(">", tb.indexOf(`data-testid="${id}"`) + 40));
  it("desktop (DOM) order: Sync → Check → View | Export → Reset", () => {
    const order = ["cal-sync", "cal-check", "cal-view", "cal-export", "cal-reset"].map((id) => tb.indexOf(`data-testid="${id}"`));
    assert.ok(order.every((i) => i > 0));
    assert.deepEqual([...order].sort((a, b) => a - b), order);
    assert.match(tb, /grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center/);
  });
  it("mobile order: Sync full width, then Check | Reset, then View | Export", () => {
    assert.match(tag("cal-sync"), /col-span-2 order-1 sm:order-none/);
    assert.match(tag("cal-check"), /order-2 sm:order-none/);
    assert.match(tag("cal-reset"), /order-3 sm:order-none/);
    assert.match(tag("cal-view"), /order-4 sm:order-none/);
    assert.match(tag("cal-export"), /order-5 sm:order-none/);
  });
  it("hierarchy: filled scarlet primary, outlined scarlet Check, restrained red Reset; labels truncate", () => {
    assert.match(tag("cal-sync"), /bg-brand[^"]*text-white/);
    assert.match(tag("cal-check"), /border-brand\/40[^"]*text-brand/);
    assert.match(tag("cal-reset"), /border-red-200[^"]*text-red-700/);
    assert.match(tb, /h-11 sm:h-9 min-w-0/);
    assert.ok((tb.match(/<span className="truncate">/g) || []).length >= 5);
  });
  it("labels, icons and handlers stay paired", () => {
    const btn = (id) => tb.slice(tb.lastIndexOf("<", tb.indexOf(`data-testid="${id}"`)), tb.indexOf("</", tb.indexOf(`data-testid="${id}"`) + 200) + 12);
    assert.match(btn("cal-sync"), /onClick=\{handleResync\}[\s\S]*CalendarCheck[\s\S]*Sync to Calendar/);
    assert.match(btn("cal-check"), /onClick=\{handleCheckSync\}[\s\S]*RefreshCw[\s\S]*Check Sync/);
    assert.match(btn("cal-view"), /href=\{calendarUrl\}[\s\S]*ExternalLink[\s\S]*View Calendar/);
    assert.match(btn("cal-export"), /onClick=\{handleExport\}[\s\S]*Download[\s\S]*Export Schedule/);
    assert.match(btn("cal-reset"), /onClick=\{requestPurge\}[\s\S]*Trash2[\s\S]*Reset Calendar/);
  });
  it("reset still requires explicit confirmation before calling the existing purge", () => {
    assert.match(tb, /const ok = await confirmAction\(\{[\s\S]*destructive: true,[\s\S]*if \(ok\) await handlePurge\(\);/);
    assert.match(tb, /calPost\(\{ action: "purge" \}\)/);
  });
});
