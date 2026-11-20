/**
 * Match Center corrections, admin-access authority and database-resolution tests
 * (`tests/match-center-admin-access.test.mjs`)
 *
 * Covers:
 *  A. Authoritative result stamps (WON / LOST / TIE / DRAW / ABANDONED / NO RESULT),
 *     never inferred from scores; Pending/unknown produce no stamp.
 *  B. Player Home upcoming cards: no RSVP wording, no "Your Availability" heading,
 *     jersey shown as infographic (no "Scarlet Red"/"Whites" text), Playing/Maybe/Out kept,
 *     deterministic alternating surfaces.
 *  C. No user-visible RSVP / jersey-colour text across the player match experience sources.
 *  D. Matches subscription failures are surfaced to the user with safe wording.
 *  E. Admin authority uses the custom claim + rules-protected appUsers flags,
 *     never the free-form `role` string; a missing appUsers record never grants access.
 *  F. Additional database-resolver fail-closed cases (missing identity, conflicting branch
 *     variables, pull-request refs) and Razorpay disabled on mig-mov.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
import React from "react";
import ReactDOMServer from "react-dom/server";

import {
  resolveFirestoreDatabaseId,
  arePaymentOperationsEnabled,
  DEVELOPMENT_FIRESTORE_DATABASE_ID,
  PRODUCTION_FIRESTORE_DATABASE_ID,
} from "../lib/database-config.ts";

const req = createRequire(import.meta.url);
const moduleCache = new Map();

function resolveWithExt(base) {
  for (const ext of [".tsx", ".ts", ".js"]) {
    if (fs.existsSync(base + ext)) return base + ext;
  }
  return base;
}

function loadTsxModule(filePath) {
  const absPath = path.resolve(filePath);
  if (moduleCache.has(absPath)) return moduleCache.get(absPath);
  const code = fs.readFileSync(absPath, "utf-8");
  const js = ts.transpileModule(code, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const mod = { exports: {} };
  moduleCache.set(absPath, mod.exports);
  const dir = path.dirname(absPath);
  const customRequire = (id) => {
    if (id === "react") return React;
    if (id.startsWith("@/lib/")) return loadTsxModule(resolveWithExt(path.resolve("lib", id.slice(6))));
    if (id.startsWith("@/components/")) return loadTsxModule(resolveWithExt(path.resolve("components", id.slice(13))));
    if (id.startsWith("./") || id.startsWith("../")) return loadTsxModule(resolveWithExt(path.resolve(dir, id)));
    return req(id);
  };
  new Function("require", "module", "exports", js)(customRequire, mod, mod.exports);
  moduleCache.set(absPath, mod.exports);
  return mod.exports;
}

const { getMatchResultDisplay } = loadTsxModule("components/matches/matchResult.ts");
const { PlayerMatchCard } = loadTsxModule("components/matches/PlayerMatchCard.tsx");
const { UpcomingMatchesSection } = loadTsxModule("components/home/UpcomingMatchesSection.tsx");
const { MatchesLoadError } = loadTsxModule("components/matches/MatchesLoadError.tsx");
const { describeSubscriptionError } = loadTsxModule("lib/subscription-errors.ts");
const { isPlayerEligibleForMatch } = loadTsxModule("lib/match-eligibility.ts");

const paidStatus = { status: "PAID", netPayable: 0, amountPaid: 650, isWaived: false };
const render = (el) => ReactDOMServer.renderToStaticMarkup(el);
const visibleText = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

// ─────────────────────────────────────────────────────────────────────────────
describe("A. Authoritative match result stamps", () => {
  const cases = [
    ["KAvach Won", "WON", "won"],
    ["KAvach Lost", "LOST", "lost"],
    ["Tie", "TIE", "tied"],
    ["Draw", "DRAW", "tied"],
    ["Abandoned", "ABANDONED", "abandoned"],
    ["No Result", "NO RESULT", "noResult"],
    ["NR", "NO RESULT", "noResult"],
  ];
  for (const [stored, label, tone] of cases) {
    it(`maps stored '${stored}' to ${label} (${tone})`, () => {
      assert.deepEqual(getMatchResultDisplay(stored), { label, tone });
    });
  }

  it("returns no stamp for Pending, empty, null and unknown values", () => {
    for (const v of ["Pending", "", "   ", null, undefined, "Rain stopped play", "Won"]) {
      assert.equal(getMatchResultDisplay(v), null, `value ${JSON.stringify(v)}`);
    }
  });

  it("never infers an outcome from scores or margins when the result is Pending", () => {
    const html = render(
      React.createElement(PlayerMatchCard, {
        match: {
          id: "m-score",
          opponent: "Rivals XI",
          date: "2026-10-01",
          time: "08:00",
          result: "Pending",
          kavachScore: "180/4",
          opponentScore: "120/10",
          resultMarginAmount: 60,
          resultMarginType: "runs",
        },
        personalPaymentStatus: paidStatus,
        availability: "Playing",
        onSelectMatch: () => {},
      }),
    );
    assert.ok(!html.includes("result-stamp-m-score"));
    assert.ok(!/\bWON\b|\bLOST\b/.test(visibleText(html)));
  });

  it("renders a neutral NO RESULT stamp without a margin", () => {
    const html = render(
      React.createElement(PlayerMatchCard, {
        match: { id: "m-nr", opponent: "Rivals XI", date: "2026-10-01", time: "08:00", result: "No Result", resultMarginAmount: 5 },
        personalPaymentStatus: paidStatus,
        availability: "Playing",
        onSelectMatch: () => {},
      }),
    );
    assert.ok(html.includes('data-result-tone="noResult"'));
    assert.ok(visibleText(html).includes("NO RESULT"));
    assert.ok(!visibleText(html).includes("by 5"));
  });

  it("keeps WON margin and green treatment", () => {
    const html = render(
      React.createElement(PlayerMatchCard, {
        match: { id: "m-w", opponent: "Rivals XI", date: "2026-10-01", time: "08:00", result: "KAvach Won", resultMarginAmount: 7, resultMarginType: "wickets" },
        personalPaymentStatus: paidStatus,
        availability: "Playing",
        onSelectMatch: () => {},
      }),
    );
    assert.ok(html.includes('data-result-tone="won"'));
    assert.ok(html.includes("bg-emerald-600"));
    assert.ok(visibleText(html).includes("by 7 wickets"));
  });

  it("detail modal uses the same authoritative mapping", () => {
    const src = fs.readFileSync(path.resolve("components/matches/PlayerMatchDetailModal.tsx"), "utf-8");
    assert.match(src, /getMatchResultDisplay\(match\.result\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("B. Player Home upcoming match cards", () => {
  const matches = [
    { id: "h1", opponent: "Alpha CC", date: "2026-12-05", time: "07:30", format: "T20", jerseyColor: "Scarlet Red" },
    { id: "h2", opponent: "Beta CC", date: "2026-12-12", time: "07:30", format: "T20", jerseyColor: "Whites" },
    { id: "h3", opponent: "Gamma CC", date: "2026-12-19", time: "07:30", format: "T20", jerseyColor: "Scarlet Red" },
  ];
  const html = render(
    React.createElement(UpcomingMatchesSection, {
      matches,
      grounds: [],
      payments: [],
      player: { id: "p1", name: "Test Player" },
      onRsvp: async () => {},
      onNavigateToMatch: () => {},
      onNavigateToAllMatches: () => {},
    }),
  );
  const text = visibleText(html);

  it("shows no RSVP wording and no redundant 'Your Availability' heading", () => {
    assert.ok(!/rsvp/i.test(text), "RSVP must not be visible");
    assert.ok(!/your availability/i.test(text));
  });

  it("renders jerseys as the infographic, never as colour text", () => {
    assert.ok(!text.includes("Scarlet Red"));
    assert.ok(!/\bWhites\b/.test(text));
    assert.equal((html.match(/data-testid="jersey-infographic"/g) || []).length, 3);
    assert.ok(html.includes('aria-label="Red jersey"'));
    assert.ok(html.includes('aria-label="White jersey"'));
  });

  it("keeps Playing / Maybe / Out actions for every card", () => {
    for (const label of ["Mark availability as Playing", "Mark availability as Maybe", "Mark availability as Out"]) {
      assert.equal((html.match(new RegExp(`aria-label="${label}"`, "g")) || []).length, 3, label);
    }
  });

  it("alternates card surfaces deterministically by index", () => {
    const variants = [...html.matchAll(/data-testid="match-card-(h\d)" data-variant="(\w+)"/g)].map((m) => [m[1], m[2]]);
    assert.deepEqual(variants, [["h1", "default"], ["h2", "alternate"], ["h3", "default"]]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("C. No visible RSVP or jersey-colour text in player match experience sources", () => {
  const files = [
    "components/matches/PlayerMatchCard.tsx",
    "components/matches/PlayerMatchCenter.tsx",
    "components/matches/PlayerMatchDetailModal.tsx",
    "components/home/UpcomingMatchesSection.tsx",
    "components/home/CampaignHeroBanner.tsx",
    "components/HomeTab.tsx",
  ];

  // Strip comments, then look only at JSX text nodes and string/template literals.
  function userFacingFragments(src) {
    const noComments = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    const jsxText = [...noComments.matchAll(/>([^<>{}]+)</g)].map((m) => m[1]);
    const literals = [...noComments.matchAll(/"([^"\n]*)"|`([^`]*)`/g)].map((m) => m[1] ?? m[2]);
    return [...jsxText, ...literals];
  }

  for (const file of files) {
    it(`${file} has no user-facing RSVP / Immediate Fixture / Report By / jersey colour text`, () => {
      const fragments = userFacingFragments(fs.readFileSync(path.resolve(file), "utf-8"));
      for (const f of fragments) {
        assert.ok(!/\bRSVP\b/i.test(f), `RSVP in: ${f}`);
        assert.ok(!/Immediate Fixture/i.test(f), `Immediate Fixture in: ${f}`);
        assert.ok(!/Report By/i.test(f), `Report By in: ${f}`);
        assert.ok(!/Scarlet Red/i.test(f), `Scarlet Red in: ${f}`);
        assert.ok(!/\$\{[^}]*jerseyColor[^}]*\}/.test(f), `raw jersey value interpolated in: ${f}`);
      }
    });
  }

  it("no component renders the raw jersey value as text ({match.jerseyColor} / {t.jerseyColor})", () => {
    for (const file of files) {
      const src = fs.readFileSync(path.resolve(file), "utf-8");
      assert.ok(!/>\s*\{\s*\w+\.jerseyColor\s*\}\s*</.test(src), file);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("D. Matches subscription errors are surfaced", () => {
  it("maps permission-denied to an actionable message without leaking backend text", () => {
    const err = Object.assign(new Error("Missing or insufficient permissions. uid=SECRET123"), { code: "permission-denied" });
    const msg = describeSubscriptionError(err);
    assert.match(msg, /permission/i);
    assert.ok(!msg.includes("SECRET123"));
  });

  it("maps unavailable/offline and unknown failures to safe messages", () => {
    assert.match(describeSubscriptionError({ code: "unavailable" }), /unreachable/);
    assert.match(describeSubscriptionError(new Error("boom")), /could not be loaded/);
  });

  it("renders an alert banner only when there is an error", () => {
    assert.equal(render(React.createElement(MatchesLoadError, { message: null })), "");
    const html = render(React.createElement(MatchesLoadError, { message: "Matches could not be loaded." }));
    assert.ok(html.includes('role="alert"'));
    assert.ok(html.includes('data-testid="matches-load-error"'));
  });

  it("store records matchesError and appUsers/self status instead of only logging", () => {
    const src = fs.readFileSync(path.resolve("hooks/useStore.ts"), "utf-8");
    assert.match(src, /setMatchesError\(describeSubscriptionError\(err\)\)/);
    assert.match(src, /setSelfAppUserStatus\("missing"\)/);
    assert.match(src, /matchesError,\s*\n\s*selfAppUserStatus,/);
  });

  it("player and admin match views render the error banner", () => {
    for (const file of ["components/matches/PlayerMatchCenter.tsx", "components/MatchesTab.tsx"]) {
      assert.match(fs.readFileSync(path.resolve(file), "utf-8"), /<MatchesLoadError message=\{store\.matchesError\} \/>/, file);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("E. Admin authority model", () => {
  it("PlayerMatchCenter does not treat the free-form role string as admin authority", () => {
    const src = fs.readFileSync(path.resolve("components/matches/PlayerMatchCenter.tsx"), "utf-8");
    const block = src.slice(src.indexOf("const effectiveIsAdmin"), src.indexOf("const effectiveIsAdmin") + 300);
    assert.ok(!block.includes('role === "admin"'));
    assert.match(block, /hasAdminClaim/);
    assert.match(block, /isClubAdmin/);
    assert.match(block, /isMatchAdmin/);
  });

  it("app shell pending-approval bypass uses the claim/flag authority, not role", () => {
    const src = fs.readFileSync(path.resolve("app/page.tsx"), "utf-8");
    assert.ok(!src.includes('currentUserObj?.role !== "admin"'));
    assert.match(src, /if \(!isAdminUser\) \{/);
  });

  it("app shell admin gate derives only from the claim and appUsers permission flags", () => {
    const src = fs.readFileSync(path.resolve("app/page.tsx"), "utf-8");
    const start = src.indexOf("const isAdminUser =");
    const block = src.slice(start, src.indexOf(";", start));
    assert.match(block, /isSuperAdminUser/);
    assert.ok(!/role/.test(block), "role string must not grant admin");
  });

  it("dev access diagnostic logs booleans only (no uid, email, phone or token)", () => {
    const src = fs.readFileSync(path.resolve("app/page.tsx"), "utf-8");
    const start = src.indexOf('console.info("[KAvach access diagnostic]"');
    const block = src.slice(start, src.indexOf("});", start));
    for (const forbidden of ["uid", "email", "phone", "mobile", "Token", "getIdToken"]) {
      assert.ok(!block.includes(forbidden), `diagnostic must not include ${forbidden}`);
    }
    assert.match(src, /firestoreDatabaseId !== DEVELOPMENT_FIRESTORE_DATABASE_ID\) return;/);
  });

  // Documents the observed failure mode: a user with neither admin authority nor a
  // resolvable player record sees no fixtures at all (not even open ones).
  const openMatch = { id: "open-1", opponent: "Open XI" };
  it("missing appUsers authority + unresolved player => no matches (fails closed, no blanket access)", () => {
    assert.equal(isPlayerEligibleForMatch(null, openMatch, [], false), false);
  });
  it("verified admin authority => all non-archived matches", () => {
    assert.equal(isPlayerEligibleForMatch(null, openMatch, [], true), true);
    assert.equal(isPlayerEligibleForMatch(null, { ...openMatch, isArchived: true }, [], true), false);
  });
  it("verified active player => open fixtures visible", () => {
    assert.equal(isPlayerEligibleForMatch({ id: "p1", inviteStatus: "Verified" }, openMatch, [], false), true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("F. Database resolution fail-closed cases and payment gate", () => {
  it("development mapping: mig-mov => kavach-play-db-ext (with or without explicit ID)", () => {
    assert.equal(resolveFirestoreDatabaseId({ AWS_BRANCH: "mig-mov" }), DEVELOPMENT_FIRESTORE_DATABASE_ID);
    assert.equal(
      resolveFirestoreDatabaseId({ AWS_BRANCH: "mig-mov", NEXT_PUBLIC_FIRESTORE_DATABASE_ID: DEVELOPMENT_FIRESTORE_DATABASE_ID }),
      DEVELOPMENT_FIRESTORE_DATABASE_ID,
    );
  });

  it("production mapping: main => production DB and never development", () => {
    assert.equal(resolveFirestoreDatabaseId({ AWS_BRANCH: "main" }), PRODUCTION_FIRESTORE_DATABASE_ID);
    assert.throws(() =>
      resolveFirestoreDatabaseId({ AWS_BRANCH: "main", NEXT_PUBLIC_FIRESTORE_DATABASE_ID: DEVELOPMENT_FIRESTORE_DATABASE_ID }),
    );
  });

  it("missing branch identity AND missing database ID fails closed", () => {
    assert.throws(() => resolveFirestoreDatabaseId({}), /Missing Firestore database ID/);
  });

  it("conflicting branch identities fail closed", () => {
    assert.throws(
      () => resolveFirestoreDatabaseId({ AWS_BRANCH: "mig-mov", GITHUB_REF_NAME: "main" }),
      /Conflicting branch identities/,
    );
  });

  it("conflicting explicit database variables fail closed", () => {
    assert.throws(
      () =>
        resolveFirestoreDatabaseId({
          NEXT_PUBLIC_FIRESTORE_DATABASE_ID: DEVELOPMENT_FIRESTORE_DATABASE_ID,
          FIRESTORE_DATABASE_ID: PRODUCTION_FIRESTORE_DATABASE_ID,
        }),
      /Conflicting database configuration/,
    );
  });

  it("pull-request and unknown refs fail closed instead of picking a database", () => {
    for (const ref of ["42/merge", "claude/cool-ptolemy-2slwh1", "preview"]) {
      assert.throws(() => resolveFirestoreDatabaseId({ GITHUB_REF_NAME: ref }), /Unrecognized or unauthorized branch/, ref);
    }
  });

  it("browser and server resolve identically for the same configuration", () => {
    // The browser bundle receives NEXT_PUBLIC_FIRESTORE_DATABASE_ID and AWS_BRANCH via
    // next.config.ts `env`; the server reads the same values from process.env.
    const browserEnv = { NEXT_PUBLIC_FIRESTORE_DATABASE_ID: DEVELOPMENT_FIRESTORE_DATABASE_ID, AWS_BRANCH: "mig-mov" };
    const serverEnv = { ...browserEnv, FIRESTORE_DATABASE_ID: DEVELOPMENT_FIRESTORE_DATABASE_ID };
    assert.equal(resolveFirestoreDatabaseId(browserEnv), resolveFirestoreDatabaseId(serverEnv));
  });

  it("resolver has no unconditional browser fallback", () => {
    const src = fs.readFileSync(path.resolve("lib/database-config.ts"), "utf-8");
    assert.ok(!/typeof window !== "undefined"\)\s*\{\s*return DEVELOPMENT_FIRESTORE_DATABASE_ID/.test(src));
  });

  it("next.config.ts and amplify.yml use the same branch → database mapping as the resolver", () => {
    for (const file of ["next.config.ts", "amplify.yml"]) {
      const src = fs.readFileSync(path.resolve(file), "utf-8");
      assert.ok(src.includes(DEVELOPMENT_FIRESTORE_DATABASE_ID), file);
      assert.ok(src.includes(PRODUCTION_FIRESTORE_DATABASE_ID), file);
    }
  });

  it("Razorpay remains disabled on mig-mov", () => {
    assert.equal(arePaymentOperationsEnabled({ AWS_BRANCH: "mig-mov" }), false);
    assert.equal(
      arePaymentOperationsEnabled({ AWS_BRANCH: "mig-mov", NEXT_PUBLIC_FIRESTORE_DATABASE_ID: DEVELOPMENT_FIRESTORE_DATABASE_ID }),
      false,
    );
  });
});
