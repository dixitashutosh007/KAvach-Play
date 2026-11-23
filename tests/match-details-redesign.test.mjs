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

describe("Match Details screen (admin)", () => {
  it("summary card first with a clearly visible Edit Match action", () => {
    assert.match(details, /<MatchDetailsSummary\s+match=\{match\}/);
    assert.match(details, /data-testid="details-edit-match"/);
    assert.ok(details.indexOf("<MatchDetailsSummary") < details.indexOf('data-testid="details-edit-match"'));
  });
  it("Squad, Payments and Match Info as collapsible sections, in that order", () => {
    const order = ['testId="details-squad"', 'testId="details-payments"', 'testId="details-match-info"'].map((k) => details.indexOf(k));
    assert.ok(order.every((i) => i > 0));
    assert.deepEqual([...order].sort((a, b) => a - b), order);
    assert.match(details, /title=\{`Squad \(\$\{played\}\)`\}/);
  });
  it("squad keeps add players, Finance Plans and per-player payment actions", () => {
    const squad = details.slice(details.indexOf('testId="details-squad"'), details.indexOf('testId="details-payments"'));
    for (const k of ['data-testid="apply-fee-plans"', "<SquadPicker", "Adjust fee", "Change Fee Payer", "clearFeeOverride"]) {
      assert.ok(squad.includes(k), k);
    }
  });
  it("payments section keeps the financial breakdown", () => {
    const pay = details.slice(details.indexOf('testId="details-payments"'), details.indexOf('testId="details-match-info"'));
    assert.match(pay, /Direct Collected/);
    assert.match(pay, /financials\.isBalanced/);
  });
  it("removed: discussion, travel estimate, WhatsApp result share, performer details", () => {
    for (const gone of ["Discussion", "Approx time to reach", "Share Result on WhatsApp", "BEST BATSMAN", "POTM", "TOP PERFORMERS", "handlePostComment", '"comments"']) {
      assert.ok(!markup.includes(gone), gone);
    }
  });
  it("kept: tentative unblock, archive toggle, player availability roster; group reminder removed", () => {
    assert.match(details, /Unblock/);
    assert.match(details, /Archived/);
    assert.match(details, /Player Availability/);
    assert.ok(!/Remind Group|handleGroupRemind|isGroupRemindModalOpen|wa\.me/.test(details));
  });
  it("Match Info shows fee (with saved margin), ground fee, budget, links", () => {
    const info = details.slice(details.indexOf('testId="details-match-info"'));
    assert.match(info, /Match fee \(per player\)/);
    assert.match(info, /match\.feeMarginPct !== undefined/);
    assert.match(info, /Ground fee/);
    assert.match(info, /match\.matchUrl/);
    assert.match(info, /match\.streamingUrl/);
  });
  it("sections nest without page-edge negative margins", () => {
    // admin branch only (the non-admin roster after ") : (" keeps its original layout)
    const start = details.indexOf('data-testid="match-details-sections"');
    const sections = details.slice(start, details.indexOf("      ) : (", start));
    assert.ok(!sections.includes("-mx-4 sm:mx-0"));
  });
});
