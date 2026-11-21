/**
 * Match Card visual redesign (T20/T30 + Tournament/Practice) — unit/component tests
 * (`tests/match-card-redesign.test.mjs`).
 *
 * Pure functions and server-side rendering only: no emulator, browser, network
 * or database access.
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
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const src = (f) => fs.readFileSync(path.resolve(f), "utf-8");

const { getMatchFormatBadge, getMatchCategory, formatMatchCardDate } = load("lib/match-card-format.ts");
const { MatchCardHeader, MatchCardTopBar, MatchFormatBadge, MatchCategoryRibbon } = load("components/matches/MatchCardHeader.tsx");
const { PlayerMatchCard } = load("components/matches/PlayerMatchCard.tsx");
const { MATCH_TYPES, groundFeeForMatchType } = load("lib/match-category.ts");

const paid = { status: "PAID", netPayable: 0, amountPaid: 650, isWaived: false };
const ground = { id: "g1", name: "MSD Sports Arena", mapUrl: "" };
const mk = (over = {}) => ({
  id: "m1",
  opponent: "Cricmonks",
  date: "2026-11-21",
  time: "07:00",
  format: "T30",
  jerseyColor: "Scarlet Red",
  matchType: "Practice",
  result: "Pending",
  ...over,
});

// ─────────────────────────────────────────────────────────────────────────────
describe("Format badge (from stored match.format)", () => {
  it("T20 → blue, T30 → scarlet", () => {
    assert.deepEqual(getMatchFormatBadge("T20"), { label: "T20", tone: "t20" });
    assert.deepEqual(getMatchFormatBadge("T30"), { label: "T30", tone: "t30" });
    assert.ok(render(React.createElement(MatchFormatBadge, { format: "T20", matchId: "a" })).includes("bg-blue-50"));
    assert.ok(render(React.createElement(MatchFormatBadge, { format: "T30", matchId: "a" })).includes("bg-scarlet/10"));
  });
  it("other formats keep their own label with a neutral style; never coerced to T20/T30", () => {
    assert.deepEqual(getMatchFormatBadge("Other"), { label: "Other", tone: "other" });
    assert.deepEqual(getMatchFormatBadge("T10"), { label: "T10", tone: "other" });
  });
  it("missing format renders no badge (no default)", () => {
    assert.equal(getMatchFormatBadge(undefined), null);
    assert.equal(getMatchFormatBadge(""), null);
    assert.equal(render(React.createElement(MatchFormatBadge, { format: undefined, matchId: "a" })), "");
  });
  it("no hardcoded T30 fallback remains in the card components", () => {
    for (const f of ["components/matches/MatchCardHeader.tsx", "components/matches/PlayerMatchCard.tsx"]) {
      assert.ok(!/format \|\| "T(20|30)"/.test(src(f)), f);
    }
  });
});

describe("Category ribbon (from stored match.matchType only)", () => {
  it("maps only the exact stored categories", () => {
    assert.equal(getMatchCategory("Tournament"), "Tournament");
    assert.equal(getMatchCategory("Practice"), "Practice");
    for (const v of [undefined, null, "", "Friendly", "tournament"]) assert.equal(getMatchCategory(v), null);
  });
  it("Tournament: purple ribbon with trophy and TOURNAMENT label", () => {
    const html = render(React.createElement(MatchCategoryRibbon, { category: "Tournament", matchId: "m1" }));
    assert.ok(html.includes('data-category="tournament"'));
    assert.ok(html.includes("from-violet-800"));
    assert.match(text(html), /Tournament/);
    assert.ok(html.includes("uppercase"));
    assert.ok(html.includes("clip-path"), "diagonal cut");
  });
  it("Practice: teal ribbon with stumps icon and PRACTICE label", () => {
    const html = render(React.createElement(MatchCategoryRibbon, { category: "Practice", matchId: "m1" }));
    assert.ok(html.includes('data-category="practice"'));
    assert.ok(html.includes("from-teal-700"));
    assert.match(text(html), /Practice/);
    assert.ok(html.includes("<svg"));
  });
  it("category is independent of format and tournament linkage", () => {
    const t20Tournament = render(React.createElement(MatchCardTopBar, { match: mk({ format: "T20", matchType: "Tournament" }) }));
    assert.ok(t20Tournament.includes('data-category="tournament"'));
    const practiceInTournament = render(React.createElement(MatchCardTopBar, { match: mk({ matchType: "Practice", tournamentId: "t1" }) }));
    assert.ok(practiceInTournament.includes('data-category="practice"'));
    const noCategory = render(React.createElement(MatchCardTopBar, { match: mk({ matchType: undefined, tournamentId: "t1" }) }));
    assert.equal(noCategory, "", "no ribbon is inferred from tournamentId");
  });
  it("ribbon sits flush in the top-left corner, as its own row above the identity", () => {
    const html = render(React.createElement(PlayerMatchCard, {
      match: mk({ matchType: "Tournament" }), ground, personalPaymentStatus: paid, availability: "Pending", onSelectMatch: () => {}, onRsvp: async () => {},
    }));
    assert.ok(html.indexOf("category-ribbon-m1") < html.indexOf("match-card-identity-m1"));
    assert.match(src("components/matches/MatchCardHeader.tsx"), /-mt-3 -ml-3 sm:-mt-4 sm:-ml-4/);
  });
});

describe("Logistics: time, cricket-ball divider, date, venue", () => {
  it("date label is 'DAY · D MON' without the year for this season", () => {
    assert.equal(formatMatchCardDate("2026-11-21", new Date(2026, 10, 1)), "SAT · 21 NOV");
    assert.equal(formatMatchCardDate("22/11/2026", new Date(2026, 10, 1)), "SUN · 22 NOV");
  });
  it("adds the year only for a different calendar year", () => {
    assert.equal(formatMatchCardDate("2025-12-12", new Date(2026, 10, 1)), "FRI · 12 DEC 2025");
    assert.equal(formatMatchCardDate("", new Date()), "Date TBD");
  });
  it("time is prominent and non-wrapping, followed by the cricket-ball divider", () => {
    const html = render(React.createElement(MatchCardHeader, { match: mk({ time: "12:00" }), ground }));
    const logistics = html.slice(html.indexOf('data-testid="match-card-logistics-m1"'));
    assert.match(text(logistics), /12:00 PM/);
    const timeIdx = logistics.indexOf("match-time-m1");
    const ballIdx = logistics.indexOf("<circle");
    const dateIdx = logistics.indexOf("match-date-m1");
    assert.ok(timeIdx < ballIdx && ballIdx < dateIdx, "time → ball divider → date");
    assert.ok(logistics.slice(timeIdx, timeIdx + 300).includes("whitespace-nowrap"));
    assert.ok(logistics.includes("fill-scarlet"));
  });
  it("venue name without a stored map link becomes an encoded Maps search", () => {
    const html = render(React.createElement(MatchCardHeader, { match: mk(), ground }));
    assert.ok(html.includes('href="https://www.google.com/maps/search/?api=1&amp;query=MSD%20Sports%20Arena"'));
  });
});

describe("Responsive composition", () => {
  const s = () => src("components/matches/MatchCardHeader.tsx");
  it("always two columns (identity | divider | logistics), on mobile as on desktop", () => {
    assert.match(s(), /className="@container"/);
    assert.match(s(), /className="grid grid-cols-\[minmax\(0,1fr\)_1px_minmax\(0,auto\)\] items-center/);
    assert.match(s(), /<span className="w-px self-stretch bg-border" aria-hidden="true" \/>/);
    // no stacked fallback
    assert.ok(!s().includes("border-t border-border/70 pt-3"));
    assert.ok(!s().includes("@sm:grid-cols-"));
  });
  it("narrow cards step type down and cap the logistics column instead of stacking", () => {
    assert.match(s(), /max-w-\[9\.5rem\] @sm:max-w-none/);
    assert.match(s(), /text-xl @sm:text-3xl/);
    assert.match(s(), /text-lg @sm:text-2xl/);
  });
  it("long opponent names wrap and clamp instead of overflowing", () => {
    assert.match(s(), /break-words line-clamp-2/);
  });
});

describe("Card behaviour preserved", () => {
  const card = (over = {}, props = {}) =>
    render(React.createElement(PlayerMatchCard, {
      match: mk(over), ground, personalPaymentStatus: paid, availability: "Pending",
      onSelectMatch: () => {}, onRsvp: async () => {}, ...props,
    }));

  it("Playing · Maybe · Out buttons sit below a divider; nothing pressed when unanswered", () => {
    const html = card();
    assert.ok(html.includes("availability-buttons-m1"));
    assert.ok(!html.includes('aria-pressed="true"'));
  });
  it("Next Match keeps priority over alternation and coexists with the ribbon", () => {
    const html = card({ matchType: "Tournament" }, { isImmediateNext: true, variant: "alternate" });
    assert.ok(html.includes('data-testid="next-match-highlight"'));
    assert.ok(html.includes('data-category="tournament"'));
    assert.ok(html.includes('data-variant="default"'));
    assert.ok(html.includes("ring-scarlet/15"));
  });
  it("completed matches show the result stamp and no availability buttons", () => {
    const html = card({ result: "KAvach Won", resultMarginAmount: 20, resultMarginType: "runs" });
    assert.ok(html.includes('data-result-tone="won"'));
    assert.ok(!html.includes("availability-buttons-m1"));
  });
  it("expand toggle only when there is secondary detail (tournament name); details button always", () => {
    assert.ok(!card().includes("expand-button-m1"));
    assert.ok(card({}, { tournamentName: "Winter Cup" }).includes("expand-button-m1"));
    assert.ok(card().includes("view-details-m1"));
  });
  it("venue link, expand, details and availability never bubble to the card click", () => {
    const pc = src("components/matches/PlayerMatchCard.tsx");
    assert.equal((pc.match(/e\.stopPropagation\(\);/g) || []).length >= 2, true);
    assert.match(src("components/matches/AvailabilityButtons.tsx"), /e\.stopPropagation\(\)/);
  });
  it("the experimental slider is removed", () => {
    assert.ok(!fs.existsSync("components/matches/AvailabilitySelector.tsx"));
    for (const f of ["components/matches/PlayerMatchCard.tsx", "components/matches/PlayerMatchDetailModal.tsx"]) {
      assert.ok(!src(f).includes("AvailabilitySelector"), f);
    }
  });
});

describe("Admin Match Center card", () => {
  const s = src("components/MatchesTab.tsx");
  it("uses the shared top bar (ribbon + admin actions) and shared body", () => {
    assert.match(s, /<MatchCardTopBar\s+match=\{match\}\s+end=\{\s*isAdmin \? \(/);
    assert.match(s, /<MatchCardHeader match=\{match\} ground=\{ground\} \/>/);
  });
  it("does not introduce player availability buttons into the admin card", () => {
    assert.ok(!s.includes("AvailabilityButtons"));
  });
});

describe("Match categories: Practice and Tournament only", () => {
  it("add/edit match offer exactly Practice and Tournament", () => {
    assert.deepEqual(MATCH_TYPES, ["Practice", "Tournament"]);
    assert.match(src("components/MatchesTab.tsx"), /\{MATCH_TYPES\.map\(\(type\) => \(/);
    assert.match(src("components/MatchSheetView.tsx"), /\{MATCH_TYPES\.map\(\(t\) => \(/);
  });
  it("no 'Club Match' option anywhere in the type, rules or screens", () => {
    for (const f of ["lib/types.ts", "firestore.rules", "lib/match-category.ts", "components/MatchesTab.tsx", "components/MatchSheetView.tsx"]) {
      const code = src(f).replace(/\/\*[\s\S]*?\*\//g, "");
      assert.ok(!code.includes("Club Match"), f);
    }
    assert.match(src("lib/types.ts"), /matchType: "Practice" \| "Tournament";/);
    assert.match(src("firestore.rules"), /data\.matchType in \['Practice', 'Tournament'\]/);
  });
  it("fee auto-fill: practice fee for Practice, tournament fee for Tournament", () => {
    const g = { practiceFee: 6000, tournamentFee: 9000 };
    assert.equal(groundFeeForMatchType(g, "Practice"), 6000);
    assert.equal(groundFeeForMatchType(g, "Tournament"), 9000);
    assert.equal(groundFeeForMatchType(null, "Tournament"), 0);
  });
  it("only Tournament matches keep a tournament link in the sheet editor", () => {
    assert.match(src("components/MatchSheetView.tsx"), /if \(newType !== "Tournament"\) setField\(match\.id, "tournamentId", ""\);/);
  });
});
