/**
 * Player Match Centre: All / Upcoming / Past filter and the separated
 * selected-date preview (`tests/player-match-filters.test.mjs`).
 * Pure functions, server-side rendering and source inspection only.
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

const filters = load("lib/player-match-filters.ts");
const { MatchFilterSelect } = load("components/matches/MatchFilterSelect.tsx");
const { MatchDateSelector } = load("components/matches/AdminMatchDateList.tsx");
const center = src("components/matches/PlayerMatchCenter.tsx");

const m = (id, date, time = "07:00") => ({ id, date, time, opponent: `Opp ${id}`, result: "KAvach Won" });

describe("Filter options", () => {
  it("exactly All / Upcoming / Past; no payment or participation filters", () => {
    assert.deepEqual(filters.MATCH_FILTER_OPTIONS.map((o) => o.label), ["All Matches", "Upcoming Matches", "Past Matches"]);
    const html = render(React.createElement(MatchFilterSelect, { value: "all", onChange: () => {} }));
    assert.equal((html.match(/<option /g) || []).length, 3);
    assert.ok(!/Paid|Unpaid|Played|Recent|Previous/i.test(text(html)));
    assert.match(html, /data-testid="match-filter"[^>]*text-scarlet|text-scarlet[^>]*data-testid="match-filter"/);
    assert.match(html, /lucide-filter/);
    assert.match(html, /lucide-chevron-down/);
  });
  it("defaults to All Matches; listing heading follows the filter", () => {
    assert.match(center, /useState<MatchListFilter>\("all"\)/);
    assert.match(center, /\{MATCH_FILTER_LABEL\[matchFilter\]\}/);
    assert.deepEqual(filters.MATCH_FILTER_LABEL, { all: "All Matches", upcoming: "Upcoming Matches", past: "Past Matches" });
  });
  it("old All / Upcoming / Recent / Previous tabs are gone", () => {
    assert.ok(!/filter-tab-|activeTab|recent-matches-section|previous-matches-section/.test(center));
    assert.ok(!/Recent Matches|Previous Matches/.test(center));
  });
});

describe("Past = all accessible past matches, newest first, no duplicates", () => {
  it("merges Recent + Previous, de-duplicates, sorts newest first", () => {
    const recent = [m("r1", "2026-11-15"), m("old-unpaid", "2026-08-01")];
    const previous = [m("p1", "2026-09-10"), m("r1", "2026-11-15")];
    const out = filters.mergePastMatches(recent, previous);
    assert.deepEqual(out.map((x) => x.id), ["r1", "p1", "old-unpaid"]);
  });
  it("same-day matches order by time (later first)", () => {
    const out = filters.mergePastMatches([m("a", "2026-11-15", "07:00"), m("b", "2026-11-15", "14:00")], []);
    assert.deepEqual(out.map((x) => x.id), ["b", "a"]);
  });
  it("center uses the merged past list and keeps upcoming nearest-first from the grouping", () => {
    assert.match(center, /mergePastMatches\(grouped\.recent, grouped\.previous\)\.filter\(matchesSearch\)/);
    assert.match(center, /grouped\.upcoming\.filter\(matchesSearch\)/);
  });
  it("sections per filter: All shows both (with sub-headings), Upcoming/Past show one", () => {
    assert.match(center, /\(matchFilter === "all" \|\| matchFilter === "upcoming"\) && \(\s*<section data-testid="upcoming-matches-section"/);
    assert.match(center, /\(matchFilter === "all" \|\| matchFilter === "past"\) && \(\s*<section data-testid="past-matches-section"/);
    assert.match(center, /Upcoming \(\{filteredUpcoming\.length\}\)/);
    assert.match(center, /Past \(\{filteredPast\.length\}\)/);
  });
  it("availability only on upcoming cards; past list paginates with Show more", () => {
    assert.match(center, /renderPlayerCard\(match, idx, \{ canRsvp: true, isImmediateNext:/);
    assert.match(center, /filteredPast\.slice\(0, pastPageSize\)\.map\(\(match, idx\) => renderPlayerCard\(match, idx\)\)/);
    assert.match(center, /data-testid="load-more-past-matches"/);
  });
});

describe("Layout: heading + filter → calendar → date preview → divider → listing", () => {
  it("order in the page", () => {
    const order = [
      "<MatchFilterSelect value={matchFilter}",
      "<MatchDateSelector",
      'data-testid="listing-divider"',
      'data-testid="regular-match-listing"',
    ].map((k) => center.indexOf(k));
    assert.ok(order.every((i) => i > 0), JSON.stringify(order));
    assert.deepEqual([...order].sort((a, b) => a - b), order);
  });
  it("listing is independent of the calendar; filter state never touches the selection", () => {
    const listing = center.slice(center.indexOf('data-testid="regular-match-listing"'));
    assert.ok(!/picked|selectedKey|setPicked/.test(listing));
    assert.ok(!/setPicked|storageKeyPrefix="playerMatches"[\s\S]*matchFilter/.test(center.slice(center.indexOf("<MatchDateSelector"), center.indexOf('data-testid="listing-divider"'))));
  });
});

describe("Selected-date preview (player)", () => {
  const ms = [m("a", "2026-11-22", "07:00"), m("b", "2026-11-22", "14:00")];
  const html = render(React.createElement(MatchDateSelector, {
    variant: "player", storageKeyPrefix: "playerMatches", matches: ms, todayKey: "2026-11-20",
    defaultSelectedKey: "2026-11-22",
    renderMatchCard: (match) => React.createElement("div", { key: match.id, "data-testid": `card-${match.id}` }),
  }));
  it("heading names the date, shows a count and a preview note; clearable", () => {
    assert.match(text(html), /Matches on Sunday, 22 November/);
    assert.match(text(html), /2 matches/);
    assert.match(text(html), /A preview of this date\. The full match list continues below\./);
    assert.ok(html.includes('data-testid="date-clear"'));
  });
  it("subtle scarlet treatment, both matches in time order", () => {
    const panel = html.slice(html.lastIndexOf("<section", html.indexOf('data-testid="date-matches"')), html.indexOf(">", html.indexOf('data-testid="date-matches"')));
    assert.match(panel, /border-brand\/20 bg-brand-surface\/40/);
    assert.ok(html.indexOf("card-a") < html.indexOf("card-b"));
  });
  it("empty date: meaningful message, no admin wording", () => {
    const empty = render(React.createElement(MatchDateSelector, {
      variant: "player", storageKeyPrefix: "playerMatches", matches: ms, todayKey: "2026-11-20",
      defaultSelectedKey: "2026-11-21", renderMatchCard: () => null,
    }));
    assert.match(text(empty), /No matches scheduled for this date\./);
    assert.match(text(empty), /0 matches/);
    assert.ok(!/available for booking|Add match/i.test(text(empty)));
  });
  it("admin heading unchanged", () => {
    const admin = render(React.createElement(MatchDateSelector, {
      matches: ms, todayKey: "2026-11-20", defaultSelectedKey: "2026-11-22", renderMatchCard: () => null,
    }));
    assert.match(text(admin), /Matches — Sunday, 22 November 2026/);
    assert.ok(!admin.includes("date-preview-note"));
  });
});
