/**
 * Admin Match Details simplification — Phase 3 (`tests/match-details-redesign.test.mjs`).
 * SSR and source inspection only.
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

const { MatchDetailsSummary, DetailsSection } = load("components/matches/MatchDetailsSummary.tsx");
const tab = src("components/MatchesTab.tsx");
const details = tab.slice(tab.indexOf("export function MatchPayments("), tab.indexOf("function AssignMatchAdmin"));
const markup = details.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\/.*$/gm, "");

const match = { id: "m1", opponent: "The Crew", date: "2026-11-14", time: "07:00", format: "T30", matchType: "Practice", result: "KAvach Won", fee: 693, jerseyColor: "Scarlet Red", maxSquadSize: 12 };
const ground = { id: "g1", name: "NVD Oval", mapUrl: "https://maps.google.com/?q=nvd" };

describe("Summary card", () => {
  const html = render(React.createElement(MatchDetailsSummary, { match, ground, tournamentName: "Winter Cup", playing: 13, paid: 13, unpaid: 0 }));
  it("type + format chips, opponent with stored result, date · time, ground + directions, tournament", () => {
    const t = text(html);
    assert.match(t, /Practice T30/);
    assert.match(t, /vs The Crew WON/);
    assert.match(t, /14 NOV · 7:00 AM/i);
    assert.match(t, /NVD Oval Get Directions/);
    assert.match(t, /Winter Cup/);
    assert.ok(html.includes('href="https://maps.google.com/?q=nvd"'));
  });
  it("Playing / Paid / Unpaid counts for admins; only Playing otherwise", () => {
    assert.match(text(html), /13 Playing 13 Paid 0 Unpaid/);
    const p = render(React.createElement(MatchDetailsSummary, { match, ground, playing: 13, paid: 13, unpaid: 0, showPaymentCounts: false }));
    assert.ok(!/Paid|Unpaid/.test(text(p)));
  });
  it("pending match shows no result; no travel estimate anywhere", () => {
    const p = render(React.createElement(MatchDetailsSummary, { match: { ...match, result: "Pending" }, ground, playing: 0, paid: 0, unpaid: 0 }));
    assert.ok(!p.includes("result-stamp-m1"));
    assert.ok(!/Approx|time to reach/i.test(text(html) + text(p)));
  });
  it("collapsible section: closed by default, opens to its content", () => {
    const closed = render(React.createElement(DetailsSection, { icon: null, title: "Squad (13)" }, React.createElement("p", null, "inside")));
    assert.match(closed, /aria-expanded="false"/);
    assert.ok(!closed.includes("inside"));
    const open = render(React.createElement(DetailsSection, { icon: null, title: "Payments", defaultOpen: true }, React.createElement("p", null, "inside")));
    assert.ok(open.includes("inside"));
  });
});

describe("Match Details screen (admin) — Manage Match redesign", () => {
  it("compact match card (info + fee + edit) first for admins; players keep the summary", () => {
    assert.match(details, /<MatchInfoCard\s+match=\{match\}/);
    assert.match(src("components/matches/MatchInfoCard.tsx"), /data-testid="details-edit-match"/);
    assert.match(details, /<MatchDetailsSummary\s+match=\{match\}/);
    assert.ok(details.indexOf("<MatchInfoCard") < details.indexOf('data-testid="manage-match"'));
  });
  it("Squad (default) and Finance tabs; squad then financial summary", () => {
    assert.match(details, /useState<"squad" \| "finance">\("squad"\)/);
    assert.match(details, /\["squad", `Squad \(\$\{played\}\)`\]/);
    const squad = details.slice(details.indexOf('data-testid="details-squad"'), details.indexOf('manageTab === "finance" && ('));
    assert.ok(squad.indexOf("<SquadList") < squad.indexOf("<MatchFinancialsCard"));
  });
  it("squad keeps add players, Finance Plans and per-player actions (now in the ⋯ menu)", () => {
    const squad = details.slice(details.indexOf('data-testid="details-squad"'), details.indexOf('manageTab === "finance" && ('));
    for (const k of ['data-testid="apply-fee-plans"', "<SquadPicker", "<SquadList"]) assert.ok(squad.includes(k), k);
    for (const k of ['case "plan":', 'case "markPaid":', 'case "remove":', 'case "feePayer":', "store.clearFeeOverride(match.id, p.id)", "store.notifyPlayerPayment(p.playerId, match.id)"]) {
      assert.ok(details.includes(k), k);
    }
  });
  it("one financial statement (no duplicate inline calculation)", () => {
    assert.match(details, /const statement = useMemo\(\(\) => buildMatchFinancialStatement\(match, matchPayments\)/);
    assert.ok(!/const financials = useMemo/.test(details));
  });
  it("removed: discussion, travel estimate, WhatsApp result share, performer details", () => {
    for (const gone of ["Discussion", "Approx time to reach", "Share Result on WhatsApp", "BEST BATSMAN", "POTM", "TOP PERFORMERS", "handlePostComment", '"comments"']) {
      assert.ok(!markup.includes(gone), gone);
    }
  });
  it("kept: tentative unblock, archive toggle, player availability roster; group reminder removed", () => {
    assert.match(details, /Unblock/);
    assert.match(details, /onToggleArchive=/);
    assert.match(src("components/matches/MatchInfoCard.tsx"), /Archive match/);
    assert.match(details, /Player Availability/);
    assert.ok(!/Remind Group|handleGroupRemind|isGroupRemindModalOpen|wa\.me/.test(details));
  });
  it("match card shows fee, links, jersey and squad size", () => {
    const card = src("components/matches/MatchInfoCard.tsx");
    for (const k of ["Match Fee", "match.matchUrl", "match.streamingUrl", "match.jerseyColor", "match.maxSquadSize"]) assert.ok(card.includes(k), k);
  });
});
