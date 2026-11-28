import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
import React from "react";
import ReactDOMServer from "react-dom/server";
import {
  BUILTIN_BADGE_CATALOG,
  DEFAULT_STACKABLE_BADGES,
  formatLegacyBadgeLabel,
  getAvailableBadgesForPlayers,
  isBadgeTypeActive,
  normalizeBadgeTier,
  resolveStandardizedBadgeMeta,
} from "../lib/badge-awarding.ts";

const req = createRequire(import.meta.url);
const moduleCache = new Map();
const withExt = (b) => {
  for (const e of [".tsx", ".ts", ".js"]) if (fs.existsSync(b + e)) return b + e;
  return b;
};
function loadComponent(f) {
  const abs = path.resolve(f);
  if (moduleCache.has(abs)) return moduleCache.get(abs);
  const js = ts.transpileModule(fs.readFileSync(abs, "utf-8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  moduleCache.set(abs, mod.exports);
  const dir = path.dirname(abs);
  const r = (id) => {
    if (id === "react") return React;
    if (id === "@/components/ui/Toast") return { useToast: () => ({ toast: () => {} }) };
    if (id.startsWith("@/lib/")) return loadComponent(withExt(path.resolve("lib", id.slice(6).replace(/\.ts$/, ""))));
    if (id.startsWith("@/components/")) return loadComponent(withExt(path.resolve("components", id.slice(13))));
    if (id.startsWith("./") || id.startsWith("../")) return loadComponent(withExt(path.resolve(dir, id.replace(/\.ts$/, ""))));
    return req(id);
  };
  new Function("require", "module", "exports", js)(r, mod, mod.exports);
  moduleCache.set(abs, mod.exports);
  return mod.exports;
}

describe("Phase 2: Badge metadata standardization and backward compatibility", () => {
  it("keeps all 20 built-in badge IDs with complete standardized metadata", () => {
    const expectedIds = [
      "year_1", "year_2", "year_3", "year_4", "year_5",
      "original", "core", "elite",
      "centurion", "hattrick", "5wh",
      "runs_1k", "runs_2k", "runs_5k", "runs_10k",
      "wickets_100", "wickets_200", "wickets_300", "wickets_500",
      "player_of_weekend",
    ];
    assert.deepEqual(Object.keys(BUILTIN_BADGE_CATALOG), expectedIds);

    for (const id of expectedIds) {
      const meta = resolveStandardizedBadgeMeta(id);
      assert.equal(meta.id, id);
      assert.ok(meta.label.length > 0);
      assert.ok(meta.short.length > 0);
      assert.ok(["bronze", "silver", "gold", "diamond"].includes(meta.tier));
      assert.ok(meta.emoji.length > 0);
      assert.ok(meta.description.length > 0);
      assert.ok(meta.criteria.length > 0);
      assert.equal(meta.artworkKey, id);
      assert.equal(meta.active, true);
      assert.equal(meta.isBuiltin, true);
    }
  });

  it("handles legacy custom definitions with missing optional metadata safely", () => {
    const legacyDef = {
      id: "legacy_captain",
      label: "Club Captain",
      short: "",
      tier: "invalid_tier",
      emoji: "",
      stackable: false,
      order: 101,
    };
    const meta = resolveStandardizedBadgeMeta("legacy_captain", [legacyDef]);
    assert.equal(meta.label, "Club Captain");
    assert.equal(meta.short, "Club Captain");
    assert.equal(meta.tier, "bronze");
    assert.equal(meta.emoji, "🏅");
    assert.equal(meta.active, true); // missing active => active
    assert.equal(meta.category, "custom");
    assert.equal(meta.isBuiltin, false);
    assert.equal(isBadgeTypeActive(legacyDef), true);
    assert.equal(normalizeBadgeTier("unknown"), "bronze");
  });

  it("provides safe display fallback for missing/deleted badge definitions", () => {
    const meta = resolveStandardizedBadgeMeta("retired_founders_award", []);
    assert.equal(meta.label, "Retired Founders Award");
    assert.equal(meta.tier, "bronze");
    assert.equal(meta.emoji, "🏅");
    assert.equal(meta.active, false);
    assert.equal(formatLegacyBadgeLabel("old-mvp_2022"), "Old Mvp 2022");
  });

  it("prevents conflicting Firestore overrides from changing built-in stackability, active status, awardMode, or category", () => {
    const conflicting = {
      id: "year_1",
      label: "1 Year",
      short: "1Y",
      tier: "bronze",
      emoji: "1",
      stackable: true, // conflicts with built-in false
      active: false,   // conflicts with built-in true
      awardMode: "manual", // conflicts with built-in auto_tenure
      category: "custom",  // conflicts with built-in tenure
      order: 1,
    };
    const meta = resolveStandardizedBadgeMeta("year_1", [conflicting]);
    assert.equal(meta.stackable, false);
    assert.equal(meta.active, true);
    assert.equal(meta.awardMode, "auto_tenure");
    assert.equal(meta.category, "tenure");
  });

  it("excludes archived custom badge types from new award picker while preserving metadata", () => {
    const customDefs = [
      { id: "active_custom", label: "Active", short: "Act", tier: "gold", emoji: "A", stackable: false, active: true, order: 100 },
      { id: "archived_custom", label: "Archived", short: "Arc", tier: "silver", emoji: "X", stackable: false, active: false, order: 101 },
    ];
    const inactiveSet = new Set(customDefs.filter((d) => !isBadgeTypeActive(d)).map((d) => d.id));
    const available = getAvailableBadgesForPlayers(
      ["year_1", "active_custom", "archived_custom", "player_of_weekend"],
      ["p1"],
      new Map(),
      DEFAULT_STACKABLE_BADGES,
      inactiveSet,
    );
    assert.deepEqual(available, ["year_1", "active_custom"]);
    assert.equal(resolveStandardizedBadgeMeta("archived_custom", customDefs).label, "Archived");
  });

  it("preserves historical award rendering in Profile and enforces archive lifecycle in BadgesTab", () => {
    const profileHub = fs.readFileSync(path.join(process.cwd(), "components/profile/PlayerProfileHub.tsx"), "utf8");
    const profileTab = fs.readFileSync(path.join(process.cwd(), "components/ProfileTab.tsx"), "utf8");
    const badgesTab = fs.readFileSync(path.join(process.cwd(), "components/BadgesTab.tsx"), "utf8");

    // Profile views render all earned badges without filtering by active === false
    assert.equal(profileHub.includes("myBadges"), true);
    assert.equal(profileTab.includes("MyBadgesSection"), true);
    assert.equal(profileTab.includes("b.active"), false);

    // Admin BadgesTab excludes inactive custom types from Grant picker & blocks hard-delete when awards exist
    assert.equal(badgesTab.includes("inactiveBadgeTypes"), true);
    assert.equal(badgesTab.includes("disabled={hasAwards}"), true);
    assert.equal(badgesTab.includes("handleToggleActiveDef"), true);
  });

  it("renders historical awards safely across archived, missing, malformed, and built-in-only cases", () => {
    const { BadgeIcon, PlayerBadgeRow, BadgeShowcase } = loadComponent("components/BadgeIcon.tsx");
    const archivedDefs = [
      {
        id: "archived_hero",
        label: "Archived Hero",
        short: "Hero",
        tier: "gold",
        emoji: "H",
        stackable: false,
        active: false,
        order: 100,
      },
    ];

    // 1. Historical award with archived custom definition renders
    const archivedHtml = ReactDOMServer.renderToStaticMarkup(
      React.createElement(BadgeShowcase, {
        badge: {
          id: "b-arch-1",
          playerId: "p1",
          playerName: "Rahul",
          badgeType: "archived_hero",
          awardedBy: "a1",
          awardedByName: "Admin",
          awardedAt: null,
          redeemed: false,
        },
        customDefs: archivedDefs,
        onClose: () => {},
      }),
    );
    assert.match(archivedHtml, /Archived Hero/);
    assert.match(archivedHtml, /Rahul/);

    // 2. Historical award with missing custom definition renders fallback label
    const missingDefHtml = ReactDOMServer.renderToStaticMarkup(
      React.createElement(PlayerBadgeRow, {
        playerId: "p1",
        badges: [
          {
            id: "b-miss-1",
            playerId: "p1",
            playerName: "Rahul",
            badgeType: "legacy_founders_2021",
            awardedBy: "a1",
            awardedByName: "Admin",
            awardedAt: null,
            redeemed: false,
          },
        ],
        customDefs: [],
      }),
    );
    assert.match(missingDefHtml, /<svg/);

    // 3. Missing playerName + malformed awardedAt render safe fallbacks
    const malformedHtml = ReactDOMServer.renderToStaticMarkup(
      React.createElement(BadgeShowcase, {
        badge: {
          id: "b-mal-1",
          playerId: "p1",
          playerName: "",
          badgeType: "legacy_founders_2021",
          awardedBy: "a1",
          awardedByName: "Admin",
          awardedAt: "not-a-valid-date",
          redeemed: false,
        },
        customDefs: [],
        onClose: () => {},
      }),
    );
    assert.match(malformedHtml, /Legacy Founders 2021/);
    assert.match(malformedHtml, /Player/);
    assert.match(malformedHtml, /Historical award/);

    // 4. Built-in badge renders when no Firestore badgeTypes docs exist
    const builtinHtml = ReactDOMServer.renderToStaticMarkup(
      React.createElement(BadgeIcon, {
        badgeType: "year_1",
        size: 48,
        customDefs: [],
      }),
    );
    assert.match(builtinHtml, /<svg/);
    assert.match(builtinHtml, />1</);
  });
});
