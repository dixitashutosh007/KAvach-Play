import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
import React from "react";
import ReactDOMServer from "react-dom/server";
import {
  computeMilestoneProgress,
  computeTenureYears,
  evaluateCumulativeMilestones,
  parseTenureYears,
  RUNS_MILESTONES,
  TENURE_MILESTONES,
  WICKETS_MILESTONES,
} from "../lib/badge-milestones.ts";

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
    if (id === "@/components/ui/Toast") return { useToast: () => ({ toast: () => {} }) };
    if (id.startsWith("@/lib/")) return load(withExt(path.resolve("lib", id.slice(6).replace(/\.ts$/, ""))));
    if (id.startsWith("@/components/")) return load(withExt(path.resolve("components", id.slice(13))));
    if (id.startsWith("./") || id.startsWith("../")) return load(withExt(path.resolve(dir, id.replace(/\.ts$/, ""))));
    return req(id);
  };
  new Function("require", "module", "exports", js)(r, mod, mod.exports);
  cache.set(abs, mod.exports);
  return mod.exports;
}

describe("Badges 2.0: Cumulative milestone engine", () => {
  it("evaluates all tenure, runs, and wickets milestones cumulatively without revoking lower tiers", () => {
    const existingTenure = new Set(["year_1"]);
    const tenureRes = evaluateCumulativeMilestones(4, TENURE_MILESTONES, existingTenure);
    assert.deepEqual(tenureRes.qualified, ["year_1", "year_2", "year_3", "year_4"]);
    assert.deepEqual(tenureRes.missing, ["year_2", "year_3", "year_4"]);

    const runsRes = evaluateCumulativeMilestones(5500, RUNS_MILESTONES, new Set(["runs_1k"]));
    assert.deepEqual(runsRes.qualified, ["runs_1k", "runs_2k", "runs_5k"]);
    assert.deepEqual(runsRes.missing, ["runs_2k", "runs_5k"]);

    const wktRes = evaluateCumulativeMilestones(500, WICKETS_MILESTONES, new Set());
    assert.deepEqual(wktRes.qualified, ["wickets_100", "wickets_200", "wickets_300", "wickets_500"]);
    assert.deepEqual(wktRes.missing, ["wickets_100", "wickets_200", "wickets_300", "wickets_500"]);
  });

  it("is idempotent on repeated evaluation and preserves historical awards on downward stat corrections", () => {
    const existing = new Set(["runs_1k", "runs_2k", "runs_5k"]);
    const repeated = evaluateCumulativeMilestones(5500, RUNS_MILESTONES, existing);
    assert.deepEqual(repeated.missing, []);

    // Downward stat correction from 5500 -> 1500: no new grants, no revocations
    const corrected = evaluateCumulativeMilestones(1500, RUNS_MILESTONES, existing);
    assert.deepEqual(corrected.qualified, ["runs_1k"]);
    assert.deepEqual(corrected.missing, []);
  });

  it("parses tenure joining dates deterministically and avoids misleading progress when stats are absent", () => {
    const now = new Date(2026, 10, 28); // Nov 2026
    assert.equal(parseTenureYears("11/2021", now), 5);
    assert.equal(parseTenureYears("12/2021", now), 4);
    assert.equal(parseTenureYears("", now), null);
    assert.equal(computeTenureYears("invalid", now), 0);

    const withStats = computeMilestoneProgress("runs_2k", { totalRuns: 1500 }, now);
    assert.deepEqual(withStats, { current: 1500, target: 2000, percent: 75, unit: "runs" });

    const withoutStats = computeMilestoneProgress("runs_2k", {}, now);
    assert.equal(withoutStats, null);
  });
});

describe("Badges 2.0: Metallic artwork registry & Player/Showcase UI", () => {
  it("generates metallic SVG artwork for all 20 built-in IDs and custom fallback", () => {
    const { BUILTIN_ARTWORK_IDS, buildBadgeSvgString } = load("components/BadgeArtwork.tsx");
    assert.equal(BUILTIN_ARTWORK_IDS.length, 20);

    for (const id of BUILTIN_ARTWORK_IDS) {
      const svg = buildBadgeSvgString({ badgeType: id, tier: "gold", emoji: "★", size: 64, uid: id });
      assert.match(svg, /^<svg /);
      assert.match(svg, /linearGradient/);
      assert.match(svg, /<\/svg>$/);
    }

    const customSvg = buildBadgeSvgString({ badgeType: "custom_x", tier: "diamond", emoji: "<MVP>", size: 48 });
    assert.match(customSvg, /&lt;MVP&gt;/);

    // Every rendered SVG receives a unique gradient ID namespace even without explicit uid
    const s1 = buildBadgeSvgString({ badgeType: "year_1", tier: "bronze", emoji: "1", size: 48 });
    const s2 = buildBadgeSvgString({ badgeType: "year_1", tier: "bronze", emoji: "1", size: 48 });
    const id1 = s1.match(/id="(m_[^"]+)"/)?.[1];
    const id2 = s2.match(/id="(m_[^"]+)"/)?.[1];
    assert.ok(id1 && id2);
    assert.notEqual(id1, id2);
  });

  it("renders PlayerBadgeCollection with earned, locked, archived earned, and reliable progress", () => {
    const { PlayerBadgeCollection } = load("components/badges/PlayerBadgeCollection.tsx");
    const html = ReactDOMServer.renderToStaticMarkup(
      React.createElement(PlayerBadgeCollection, {
        playerId: "p1",
        player: { kavachJoining: "01/2024", totalRuns: 1500, totalWickets: 50 },
        badges: [
          {
            id: "b1",
            playerId: "p1",
            playerName: "Rahul",
            badgeType: "year_1",
            awardedBy: "a1",
            awardedByName: "Admin",
            awardedAt: null,
            redeemed: false,
          },
          {
            id: "b2",
            playerId: "p1",
            playerName: "Rahul",
            badgeType: "archived_legacy",
            awardedBy: "a1",
            awardedByName: "Admin",
            awardedAt: null,
            redeemed: false,
          },
        ],
        badgeTypeDefs: [
          {
            id: "archived_legacy",
            label: "Legacy Hero",
            short: "Hero",
            tier: "gold",
            emoji: "H",
            stackable: false,
            active: false,
            order: 100,
          },
          {
            id: "archived_unearned",
            label: "Hidden Archived",
            short: "Hidden",
            tier: "bronze",
            emoji: "X",
            stackable: false,
            active: false,
            order: 101,
          },
        ],
      }),
    );

    assert.match(html, /player-badge-collection/);
    assert.match(html, /badges-earned-section/);
    assert.match(html, /badges-locked-section/);
    assert.match(html, /Legacy Hero/);
    assert.match(html, /Archived/);
    assert.doesNotMatch(html, /Hidden Archived/);
    assert.match(html, /1,500 \/ 2,000 runs/);
  });

  it("renders BadgeShowcase with square/portrait share options and locked progress view", () => {
    const { BadgeShowcase } = load("components/BadgeIcon.tsx");
    const earnedHtml = ReactDOMServer.renderToStaticMarkup(
      React.createElement(BadgeShowcase, {
        badge: {
          id: "b1",
          playerId: "p1",
          playerName: "Rahul",
          badgeType: "centurion",
          note: "105* vs Titans",
          awardedBy: "a1",
          awardedByName: "Admin",
          awardedAt: null,
          redeemed: false,
        },
        customDefs: [],
        onClose: () => {},
      }),
    );
    assert.match(earnedHtml, /Square 1:1 \(1080×1080\)/);
    assert.match(earnedHtml, /Portrait 4:5 \(1080×1350\)/);
    assert.match(earnedHtml, /Share Badge/);
    assert.match(earnedHtml, /Download/);
    assert.match(earnedHtml, /105\* vs Titans/);

    const { resolveStandardizedBadgeMeta } = load("lib/badge-awarding.ts");
    const lockedHtml = ReactDOMServer.renderToStaticMarkup(
      React.createElement(BadgeShowcase, {
        lockedMeta: resolveStandardizedBadgeMeta("runs_2k"),
        progress: { current: 1500, target: 2000, percent: 75, unit: "runs" },
        customDefs: [],
        onClose: () => {},
      }),
    );
    assert.match(lockedHtml, /1,500 \/ 2,000 runs \(75%\)/);
    assert.doesNotMatch(lockedHtml, /Share Badge/);
  });
});
