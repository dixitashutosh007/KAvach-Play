/**
 * Admin Match Centre — date-first List View (`tests/admin-match-date-list.test.mjs`).
 *
 * Pure date logic, server-side rendering and source inspection only:
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
    if (id.startsWith("@/hooks/")) return load(withExt(path.resolve("hooks", id.slice(8))));
    if (id.startsWith("@/components/")) return load(withExt(path.resolve("components", id.slice(13))));
    if (id.startsWith("./") || id.startsWith("../")) return load(withExt(path.resolve(dir, id.replace(/\.ts$/, ""))));
    return req(id);
  };
  new Function("require", "module", "exports", js)(r, mod, mod.exports);
  cache.set(abs, mod.exports);
  return mod.exports;
}
const render = (el) => ReactDOMServer.renderToStaticMarkup(el);
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const src = (f) => fs.readFileSync(path.resolve(f), "utf-8");
const tagOf = (html, testid) => {
  const i = html.indexOf(`data-testid="${testid}"`);
  assert.ok(i >= 0, `missing ${testid}`);
  return html.slice(html.lastIndexOf("<", i), html.indexOf(">", i));
};

const strip = load("lib/match-date-strip.ts");
const { AdminMatchDateList, DateCard } = load("components/matches/AdminMatchDateList.tsx");

const m = (id, date, over = {}) => ({ id, date, time: "07:00", opponent: `Opp ${id}`, result: "Pending", ...over });
// November 2026: Sundays 1, 8, 15, 22, 29; Saturdays 7, 14, 21, 28.
const NOV = [
  m("a", "2026-11-22", { time: "14:00" }),
  m("b", "2026-11-22", { time: "07:00" }),
  m("c", "2026-11-25"), // Wednesday match
  m("d", "2026-11-28", { isTentative: true }), // tentative only
  m("e", "2026-11-12", { isTentative: true }), // tentative weekday
  m("f", "2026-11-14", { result: "KAvach Won" }), // past match
  m("g", "2026-11-21", { isArchived: true }), // archived → ignored
  m("h", "2026-11-29"),
  m("i", "2026-11-29", { isTentative: true }), // booked wins over tentative
  m("j", "2026-12-05"), // other month
];

describe("Monthly date population", () => {
  const s = strip.buildMonthDateStrip(2026, 10, NOV);
  const keys = s.map((d) => d.key);

  it("every Saturday and Sunday, plus weekdays with matches; sorted, no duplicates", () => {
    for (const d of [1, 7, 8, 14, 15, 21, 22, 28, 29]) assert.ok(keys.includes(`2026-11-${String(d).padStart(2, "0")}`), `weekend ${d}`);
    assert.ok(keys.includes("2026-11-25"), "weekday with a match");
    assert.ok(keys.includes("2026-11-12"), "weekday with a tentative block");
    assert.ok(!keys.includes("2026-11-24"), "plain weekday omitted");
    assert.ok(!keys.includes("2026-12-05"), "other month omitted");
    assert.deepEqual(keys, [...new Set(keys)].sort());
    assert.equal(keys.length, 11);
  });

  it("weekday comes from the calendar date, not the device timezone", () => {
    assert.equal(strip.weekdayOf(2026, 10, 22), 0);
    assert.equal(strip.weekdayOf(2026, 10, 28), 6);
    const sat = s.find((d) => d.key === "2026-11-28");
    assert.equal(sat.weekday, 6);
  });

  it("existing stored date formats are understood (no UTC shift for YYYY-MM-DD)", () => {
    assert.equal(strip.matchDateKey({ date: "2026-11-22" }), "2026-11-22");
    assert.equal(strip.matchDateKey({ date: "" }), null);
  });
});

describe("Booking status precedence", () => {
  const s = Object.fromEntries(strip.buildMonthDateStrip(2026, 10, NOV).map((d) => [d.key, d]));
  it("booked when any non-tentative match exists (even with a tentative block)", () => {
    assert.equal(s["2026-11-22"].status, "booked");
    assert.equal(s["2026-11-29"].status, "booked");
    assert.equal(s["2026-11-14"].status, "booked", "completed matches still count");
    assert.equal(s["2026-11-25"].status, "booked");
  });
  it("tentative only when the date has tentative blocks and no booking", () => {
    assert.equal(s["2026-11-28"].status, "tentative");
    assert.equal(s["2026-11-12"].status, "tentative");
  });
  it("available only for empty weekend dates (archived matches ignored)", () => {
    assert.equal(s["2026-11-21"].status, "available");
    assert.equal(s["2026-11-01"].status, "available");
  });
  it("deleting the only match on a date updates its status", () => {
    const after = strip.buildMonthDateStrip(2026, 10, NOV.filter((x) => x.id !== "c"));
    assert.ok(!after.some((d) => d.key === "2026-11-25"), "weekday disappears");
    const sunday = strip.buildMonthDateStrip(2026, 10, NOV.filter((x) => x.id !== "h" && x.id !== "i"));
    assert.equal(sunday.find((d) => d.key === "2026-11-29").status, "available");
  });
});

describe("Default selection, month navigation and date matches", () => {
  const s = strip.buildMonthDateStrip(2026, 10, NOV);
  it("today when shown, else nearest upcoming date, else none", () => {
    assert.equal(strip.pickDefaultDateKey(s, "2026-11-22"), "2026-11-22");
    assert.equal(strip.pickDefaultDateKey(s, "2026-11-23"), "2026-11-25");
    assert.equal(strip.pickDefaultDateKey(s, "2026-12-15"), null);
  });
  it("month shifting crosses year boundaries", () => {
    assert.deepEqual(strip.shiftMonth(2026, 11, 1), { year: 2027, month: 0 });
    assert.deepEqual(strip.shiftMonth(2026, 0, -1), { year: 2025, month: 11 });
  });
  it("all matches for a date, sorted by start time", () => {
    assert.deepEqual(strip.matchesOnDate(NOV, "2026-11-22").map((x) => x.id), ["b", "a"]);
    assert.deepEqual(strip.matchesOnDate(NOV, "2026-11-29").map((x) => x.id).sort(), ["h", "i"]);
    assert.deepEqual(strip.matchesOnDate(NOV, "2026-11-21"), [], "archived excluded");
  });
  it("labels", () => {
    assert.equal(strip.formatLongDate("2026-11-22"), "Sunday, 22 November 2026");
    assert.equal(strip.formatDayMonth("2026-11-29"), "Sunday, 29 November");
  });
});

describe("Tall vertical date cards", () => {
  const card = (status, selected) =>
    render(React.createElement(DateCard, {
      date: { key: "2026-11-22", year: 2026, month: 10, day: 22, weekday: 0, status, matchCount: status === "booked" ? 2 : 0 },
      selected,
      onSelect: () => {},
    }));

  it("month → date → weekday stacked; ~0.6 width:height; consistent size", () => {
    const html = card("booked", false);
    const t = text(html).trim();
    assert.match(t, /^NOV 22 SUN$/);
    const tag = tagOf(html, "date-card-2026-11-22");
    assert.ok(tag.includes("w-[3.75rem] h-[6.25rem]"), "60×100px on mobile (0.6)");
    assert.ok(tag.includes("sm:w-16 sm:h-[6.75rem]"), "64×108px from sm (≈0.59)");
    assert.ok(tag.includes("shrink-0") && tag.includes("rounded-[18px]") && tag.includes("flex-col"));
    assert.ok(60 / 100 >= 0.55 && 60 / 100 <= 0.65 && 64 / 108 >= 0.55 && 64 / 108 <= 0.65);
  });

  it("selected: filled brand red with white type; unselected: light with subtle border", () => {
    const sel = tagOf(card("booked", true), "date-card-2026-11-22");
    assert.ok(sel.includes("bg-brand") && sel.includes("text-white") && sel.includes('aria-selected="true"'));
    const un = tagOf(card("booked", false), "date-card-2026-11-22");
    assert.ok(un.includes("bg-surface") && un.includes("border-border") && un.includes('aria-selected="false"'));
  });

  it("status marker is independent of selection and stays visible when selected", () => {
    for (const [status, cls] of [["booked", "bg-[#DC2626]"], ["available", "bg-[#15803D]"], ["tentative", "bg-[#D97706]"]]) {
      for (const selected of [false, true]) {
        const html = card(status, selected);
        const marker = tagOf(html, "date-status-2026-11-22");
        assert.ok(marker.includes(cls), `${status} selected=${selected}`);
        if (selected) assert.ok(marker.includes("ring-white"));
        assert.match(tagOf(html, "date-card-2026-11-22"), new RegExp(`data-status="${status}"`));
      }
    }
  });

  it("tentative dates carry a diagonal hatch; status is in the accessible name", () => {
    assert.ok(tagOf(card("tentative", false), "date-card-2026-11-22").includes("repeating-linear-gradient(135deg"));
    assert.ok(!tagOf(card("booked", false), "date-card-2026-11-22").includes("repeating-linear-gradient"));
    assert.match(tagOf(card("booked", true), "date-card-2026-11-22"), /aria-label="SUN 22 NOV, Booked, 2 matches"/);
  });
});

describe("Date selector + selected-date panel", () => {
  const renderList = (props = {}) =>
    render(React.createElement(AdminMatchDateList, {
      matches: NOV,
      todayKey: "2026-11-22",
      renderMatchCard: (match) => React.createElement("div", { key: match.id, "data-testid": `card-${match.id}` }, match.opponent),
      onAddMatch: () => {},
      ...props,
    }));
  const headingText = (html) => {
    const i = html.indexOf('data-testid="selected-date-heading"');
    return text(html.slice(i, html.indexOf("</h3>", i)));
  };

  it("no date selected by default: no panel, a prompt in the header, month navigation present", () => {
    const html = renderList();
    assert.ok(!html.includes('data-testid="date-matches"'), "no empty selected-date panel");
    assert.ok(!html.includes('aria-selected="true"'));
    assert.match(headingText(html), /Select a date to preview its matches/);
    assert.ok(html.includes('aria-label="Previous month"') && html.includes('aria-label="Next month"'));
    assert.match(text(html), /November 2026/);
  });

  it("explicit selection: heading, panel with all matches in time order, clear control", () => {
    const html = renderList({ defaultSelectedKey: "2026-11-22" });
    assert.match(headingText(html), /Sunday, 22 November 2026/);
    assert.ok(tagOf(html, "date-card-2026-11-22").includes('aria-selected="true"'));
    assert.match(text(html), /Matches — Sunday, 22 November 2026/);
    assert.ok(html.indexOf('data-testid="card-b"') < html.indexOf('data-testid="card-a"'));
    assert.ok(!html.includes('data-testid="card-h"'));
    assert.ok(html.includes('data-testid="date-clear"'));
  });

  it("legend lists the three statuses", () => {
    const legend = text(renderList().split('data-testid="date-legend"')[1].split("</ul>")[0]);
    assert.match(legend, /Booked.*Available.*Tentatively Blocked/);
  });

  it("selected available weekend: compact empty state with Add Match", () => {
    const html = renderList({ defaultSelectedKey: "2026-11-21" });
    assert.match(text(html), /No matches scheduled for this date\./);
    assert.match(text(html), /available for booking/);
    assert.ok(html.includes('data-testid="date-add-match"'));
  });

  it("a stale selection (date no longer in the strip) shows no panel", () => {
    const html = renderList({ defaultSelectedKey: "2026-11-24" });
    assert.ok(!html.includes('data-testid="date-matches"'));
  });

  it("loading state is shown inside the panel", () => {
    assert.match(text(renderList({ loaded: false, defaultSelectedKey: "2026-11-22" })), /Loading matches/);
  });

  it("swipe navigation only from the header or a strip already at its edge; taps after a swipe are ignored", () => {
    const s = src("components/matches/AdminMatchDateList.tsx");
    assert.match(s, /const SWIPE_MIN_PX = 60;/);
    assert.match(s, /Math\.abs\(dx\) < Math\.abs\(dy\) \* 1\.5/);
    assert.match(s, /if \(dx > 0 && s\.atStart\)[\s\S]*goToMonth\(-1\)/);
    assert.match(s, /else if \(dx < 0 && s\.atEnd\)[\s\S]*goToMonth\(1\)/);
    assert.match(s, /if \(suppressClickRef\.current\) \{/);
  });

  it("month change clears the selection; tapping the selected date toggles it off", () => {
    const s = src("components/matches/AdminMatchDateList.tsx");
    assert.match(s, /setView\(\(v\) => shiftMonth\(v\.year, v\.month, delta\)\);\s*setPicked\(null\);/);
    assert.match(s, /setPicked\(\(prev\) => \(prev === key \? null : key\)\)/);
  });
});

describe("Match Centre integration", () => {
  const tab = src("components/MatchesTab.tsx");

  it("views are chosen from a dropdown, not tabs; List is default; session remembered", () => {
    assert.match(tab, /data-testid="match-view-select"/);
    assert.match(tab, /\{ value: "list", label: "List View" \}/);
    assert.match(tab, /\{ value: "sheet", label: "Table View" \}/);
    assert.match(tab, /\{ value: "calendar", label: "Calendar View" \}/);
    assert.match(tab, /useSessionState<MatchViewMode>\(\s*"matches:viewMode",\s*defaultAction === "calendar" \? "calendar" : "list",/);
    assert.ok(!/onClick=\{\(\) => setViewMode\("(list|calendar|sheet)"\)\}/.test(tab), "old tab buttons removed");
  });

  it("Table View keeps its Super Admin gate", () => {
    assert.match(tab, /MATCH_VIEW_OPTIONS\.filter\(\(o\) => o\.value !== "sheet" \|\| isSuperAdmin\)/);
    assert.match(tab, /const activeView: MatchViewMode = viewMode === "sheet" && !isSuperAdmin \? "list" : viewMode;/);
  });

  it("admins get the date-first list with the existing cards and the existing Add Match form", () => {
    assert.match(tab, /<AdminMatchDateList\s+matches=\{allMatches\}\s+loaded=\{store\.isLoaded\}\s+renderMatchCard=\{renderMatchCard\}/);
    assert.match(tab, /setFormData\(\(prev\) => \(\{ \.\.\.prev, date: dbToInputDate\(dateKey\) \}\)\);/);
  });

  it("Calendar View and Table View still render", () => {
    assert.match(tab, /activeView === "sheet" \? \(\s*<MatchSheetView store=\{store\} \/>/);
    assert.match(tab, /<MatchCalendarView/);
  });

  it("Edit uses the existing modal; Delete asks for explicit confirmation naming the match", () => {
    assert.match(tab, /startEdit\(match\);/);
    const del = tab.slice(tab.indexOf('data-testid={`admin-delete-match-${match.id}`}') - 1600, tab.indexOf('data-testid={`admin-delete-match-${match.id}`}'));
    assert.match(del, /await confirmAction\(\{/);
    assert.match(del, /vs \$\{match\.opponent \|\| "TBC"\}/);
    assert.match(del, /destructive: true/);
    assert.match(del, /if \(!ok\) return;/);
    assert.match(del, /await store\.deleteMatch\(match\.id\)/);
  });

  it("admin cards carry the lazily loaded Payment Details panel (balances live there)", () => {
    assert.match(tab, /<MatchPaymentPanel\s+match=\{match\}/);
    assert.match(tab, /status=\{store\.matchPaymentsStatus\?\.\[match\.id\]\}/);
    assert.match(tab, /ensureMatchPayments=\{store\.ensureMatchPayments\}/);
  });

  it("no new Firestore subscription for the date list", () => {
    const list = src("components/matches/AdminMatchDateList.tsx");
    assert.ok(!/onSnapshot|firebase\/firestore|collection\(/.test(list));
  });
});
