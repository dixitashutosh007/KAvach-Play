/**
 * Focused Unit and Behavioral Tests for Player Match Center UI/UX Refinement
 * (`tests/player-match-center-ui.test.mjs`)
 *
 * Covers:
 * 1. Red and white jersey infographic mapping.
 * 2. Missing or unexpected jersey colour handling.
 * 3. Expand/collapse progressive disclosure behavior.
 * 4. Expanding a card does not open the detail modal (propagation stopped).
 * 5. Selecting a card still opens the detail modal.
 * 6. Playing, Maybe and Out actions work with accurate parameters and stopped propagation.
 * 7. Disabled availability behavior remains unchanged (reason rendered, clicks blocked).
 * 8. No "RSVP" or "Immediate Fixture" labels appear in the card.
 * 9. "Report By" information is no longer rendered on the card.
 * 10. WON and LOST stamps display correctly for recorded results with margins preserved.
 * 11. Tie, Draw and Abandoned states remain correctly represented.
 * 12. Pending/unknown results do not display an invented outcome.
 * 13. Existing payment status and privacy behavior remain intact.
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

// Dynamic loader for TSX components using TypeScript transpiler
const moduleCache = new Map();
function loadTsxModule(filePath) {
  const absPath = path.resolve(filePath);
  if (moduleCache.has(absPath)) return moduleCache.get(absPath);

  const code = fs.readFileSync(absPath, "utf-8");
  const js = ts.transpileModule(code, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.React,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;

  const mod = { exports: {} };
  moduleCache.set(absPath, mod.exports);

  const dir = path.dirname(absPath);
  const customRequire = (id) => {
    if (id === "react") return React;
    if (id === "lucide-react") return req("lucide-react");
    if (id.startsWith("@/lib/")) {
      return loadTsxModule(path.resolve("lib", id.slice(6) + ".ts"));
    }
    if (id.startsWith("./") || id.startsWith("../")) {
      let resolved = path.resolve(dir, id);
      if (fs.existsSync(resolved + ".ts")) resolved += ".ts";
      else if (fs.existsSync(resolved + ".tsx")) resolved += ".tsx";
      else if (fs.existsSync(resolved + ".js")) resolved += ".js";
      return loadTsxModule(resolved);
    }
    return req(id);
  };

  const fn = new Function("require", "module", "exports", js);
  fn(customRequire, mod, mod.exports);
  moduleCache.set(absPath, mod.exports);
  return mod.exports;
}

const { JerseyInfographic, getJerseyDetails } = loadTsxModule(
  "components/matches/JerseyInfographic.tsx"
);
const { PlayerMatchCard } = loadTsxModule("components/matches/PlayerMatchCard.tsx");

describe("Player Match Center UI/UX Refinement Test Suite", () => {
  const baseMatch = {
    id: "match-test-1",
    opponent: "Noida Super Kings",
    date: "2026-11-28",
    time: "07:30",
    fee: 650,
    format: "T20",
    jerseyColor: "Scarlet Red",
    result: "Pending",
  };

  const baseGround = {
    id: "ground-1",
    name: "Feroz Shah Kotla",
    mapUrl: "https://maps.google.com/?q=Kotla",
  };

  const basePaymentStatus = {
    status: "PAID",
    netPayable: 0,
    amountPaid: 650,
    isWaived: false,
  };

  // ── 1 & 2. Jersey Infographic Mapping & Missing/Unexpected Handling ─────────
  describe("1 & 2. Jersey Infographic Tests", () => {
    it("1. Maps 'Scarlet Red' to Red jersey infographic with accessible label and brand styling", () => {
      const details = getJerseyDetails("Scarlet Red");
      assert.ok(details, "Details should exist for Scarlet Red");
      assert.equal(details.label, "Red jersey");
      assert.equal(details.isRed, true);
      assert.equal(details.isWhite, false);
      assert.equal(details.fillColor, "#D51F43");

      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(JerseyInfographic, { color: "Scarlet Red" })
      );
      assert.ok(html.includes('aria-label="Red jersey"'));
      assert.ok(html.includes('fill="#D51F43"'));
      assert.ok(!html.includes("Scarlet Red"), "Must not render textual color label");
    });

    it("1b. Maps 'Whites' to White jersey infographic with dark charcoal outline for light surface contrast", () => {
      const details = getJerseyDetails("Whites");
      assert.ok(details, "Details should exist for Whites");
      assert.equal(details.label, "White jersey");
      assert.equal(details.isWhite, true);
      assert.equal(details.isRed, false);
      assert.equal(details.fillColor, "#FFFFFF");
      assert.equal(details.strokeColor, "#374151"); // Charcoal outline

      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(JerseyInfographic, { color: "Whites" })
      );
      assert.ok(html.includes('aria-label="White jersey"'));
      assert.ok(html.includes('fill="#FFFFFF"'));
      assert.ok(html.includes('stroke="#374151"'));
      assert.ok(!html.includes("Whites"), "Must not render textual color label");
    });

    it("2. Safely handles missing, empty, or undefined jersey color by returning null", () => {
      assert.equal(getJerseyDetails(null), null);
      assert.equal(getJerseyDetails(undefined), null);
      assert.equal(getJerseyDetails(""), null);
      assert.equal(getJerseyDetails("   "), null);

      const htmlEmpty = ReactDOMServer.renderToStaticMarkup(
        React.createElement(JerseyInfographic, { color: null })
      );
      assert.equal(htmlEmpty, "");
    });

    it("2b. Gracefully handles unexpected jersey color without throwing", () => {
      const details = getJerseyDetails("Cobalt Blue");
      assert.ok(details);
      assert.equal(details.label, "Cobalt Blue jersey");

      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(JerseyInfographic, { color: "Cobalt Blue" })
      );
      assert.ok(html.includes('aria-label="Cobalt Blue jersey"'));
    });
  });

  // ── 3, 4 & 5. Expand/Collapse & Modal Navigation Independence ────────────────
  describe("3, 4 & 5. Expand/Collapse Progressive Disclosure & Click Independence", () => {
    it("3. Contains expand/collapse toggle with accessible attributes and collapsed secondary details by default", () => {
      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(PlayerMatchCard, {
          match: baseMatch,
          ground: baseGround,
          tournamentName: "Winter Corporate Trophy",
          personalPaymentStatus: basePaymentStatus,
          availability: "Playing",
          onSelectMatch: () => {},
        })
      );

      // Verify expand button exists with accessible label
      assert.ok(html.includes('data-testid="expand-button-match-test-1"'));
      assert.ok(html.includes('aria-expanded="false"'));
      assert.ok(html.includes('aria-label="Expand secondary details"'));

      // Secondary details (Tournament & format badge) are collapsed by default
      assert.ok(!html.includes('data-testid="match-secondary-details-match-test-1"'));
    });

    it("4 & 5. Card click invokes onSelectMatch, while expand button and actions stop propagation", () => {
      const cardSource = fs.readFileSync(
        path.resolve("components/matches/PlayerMatchCard.tsx"),
        "utf-8"
      );

      // Verify card container triggers onSelectMatch(match.id)
      assert.match(
        cardSource,
        /onClick=\{\(\)\s*=>\s*onSelectMatch\(match\.id\)\}/,
        "Card container must trigger onSelectMatch(match.id)"
      );

      // Verify expand button stops propagation and toggles isExpanded
      assert.match(
        cardSource,
        /data-testid=\{`expand-button-\$\{match\.id\}`\}[\s\S]*?onClick=\{\(e\)\s*=>\s*\{\s*e\.stopPropagation\(\);\s*setIsExpanded\(\(prev\)\s*=>\s*!prev\);\s*\}\}/,
        "Expand button must stop propagation and toggle isExpanded without bubbling to card"
      );

      // Verify directions link stops propagation
      assert.match(
        cardSource,
        /aria-label=\{`Directions to \$\{ground\.name\}`\}[\s\S]*?onClick=\{\(e\)\s*=>\s*e\.stopPropagation\(\)\}/,
        "Directions link must stop propagation"
      );
    });
  });

  // ── 6 & 7. Availability Actions & Disabled Behavior ─────────────────────────
  describe("6 & 7. 1-Tap Availability Actions & Disabled Behavior", () => {
    it("6. Playing, Maybe and Out buttons are rendered with accessible labels and invoke onRsvp", () => {
      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(PlayerMatchCard, {
          match: baseMatch,
          personalPaymentStatus: basePaymentStatus,
          availability: "Maybe",
          onSelectMatch: () => {},
          onRsvp: async () => {},
        })
      );

      // Verify all 3 action buttons exist with exact accessible names
      assert.ok(html.includes('aria-label="Mark availability as Playing"'));
      assert.ok(html.includes('aria-label="Mark availability as Maybe"'));
      assert.ok(html.includes('aria-label="Mark availability as Out"'));

      // Verify aria-pressed accurately indicates active selection
      assert.ok(html.includes('aria-pressed="true"')); // Maybe is active
      assert.ok(html.includes('aria-pressed="false"')); // Playing and Out are inactive

      // Verify code contract for handleActionClick: stops propagation & invokes onRsvp with Confirmed/Tentative/No
      const cardSource = fs.readFileSync(
        path.resolve("components/matches/PlayerMatchCard.tsx"),
        "utf-8"
      );
      assert.match(cardSource, /handleActionClick\s*=\s*async\s*\(/);
      assert.match(cardSource, /e\.stopPropagation\(\)/);
      assert.match(cardSource, /await onRsvp\(match\.id,\s*targetAvailability\)/);
      assert.match(cardSource, /handleActionClick\(e,\s*"Confirmed"\)/);
      assert.match(cardSource, /handleActionClick\(e,\s*"Tentative"\)/);
      assert.match(cardSource, /handleActionClick\(e,\s*"No"\)/);
    });

    it("7. Disabled availability renders reason message and prevents action clicks", async () => {
      let rsvpCalled = false;
      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(PlayerMatchCard, {
          match: baseMatch,
          personalPaymentStatus: basePaymentStatus,
          availability: "Playing",
          disabledRsvp: true,
          disabledRsvpReason: "Squad announced - availability locked",
          onSelectMatch: () => {},
          onRsvp: async () => {
            rsvpCalled = true;
          },
        })
      );

      assert.ok(html.includes("Squad announced - availability locked"));
      assert.ok(!html.includes("Mark availability as Playing"));
    });
  });

  // ── 8 & 9. Removal of Unnecessary Labels ────────────────────────────────────
  describe("8 & 9. Removal of Unnecessary Labels ('RSVP', 'Immediate Fixture', 'Report By')", () => {
    it("8. Does not render 'Immediate Fixture' label on next match banner", () => {
      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(PlayerMatchCard, {
          match: baseMatch,
          personalPaymentStatus: basePaymentStatus,
          availability: "Playing",
          isImmediateNext: true,
          onSelectMatch: () => {},
        })
      );

      assert.ok(html.includes("Next Match"), "Next Match visual highlight must be retained");
      assert.ok(
        !html.includes("Immediate Fixture"),
        "'Immediate Fixture' text must be completely removed"
      );
    });

    it("8b. Does not render 'RSVP', 'RSVP Needed', or 'Your Availability' in the card", () => {
      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(PlayerMatchCard, {
          match: baseMatch,
          personalPaymentStatus: basePaymentStatus,
          availability: "Pending", // Unset availability
          onSelectMatch: () => {},
          onRsvp: async () => {},
        })
      );

      assert.ok(!html.includes("RSVP Needed"), "'RSVP Needed' must not appear");
      assert.ok(!html.includes("Your Availability"), "'Your Availability' heading must not appear");
      assert.ok(!html.includes(">RSVP<"), "'RSVP' text must not appear");
    });

    it("9. Does not render 'Report By' text on the card", () => {
      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(PlayerMatchCard, {
          match: baseMatch,
          personalPaymentStatus: basePaymentStatus,
          availability: "Playing",
          onSelectMatch: () => {},
        })
      );

      assert.ok(!html.includes("Report by"), "'Report by' must not be rendered on the card");
      assert.ok(!html.includes("Report By"), "'Report By' must not be rendered on the card");
      // Retains actual match schedule
      assert.ok(html.includes("7:30 AM"));
    });
  });

  // ── 10, 11 & 12. Match Result Stamps ────────────────────────────────────────
  describe("10, 11 & 12. Prominent Sports Match Result Stamps", () => {
    it("10. Renders prominent green WON stamp with margin for KAvach Won", () => {
      const wonMatch = {
        ...baseMatch,
        result: "KAvach Won",
        resultMarginAmount: 24,
        resultMarginType: "runs",
      };

      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(PlayerMatchCard, {
          match: wonMatch,
          personalPaymentStatus: basePaymentStatus,
          availability: "Playing",
          onSelectMatch: () => {},
        })
      );

      assert.ok(html.includes('data-testid="result-stamp-match-test-1"'));
      assert.ok(html.includes("WON"));
      assert.ok(html.includes("by 24 runs"));
      assert.ok(html.includes("bg-emerald-600"), "Must use vibrant sports emerald green");
    });

    it("10b. Renders prominent red LOST stamp with margin for KAvach Lost", () => {
      const lostMatch = {
        ...baseMatch,
        result: "KAvach Lost",
        resultMarginAmount: 4,
        resultMarginType: "wkts",
      };

      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(PlayerMatchCard, {
          match: lostMatch,
          personalPaymentStatus: basePaymentStatus,
          availability: "Playing",
          onSelectMatch: () => {},
        })
      );

      assert.ok(html.includes('data-testid="result-stamp-match-test-1"'));
      assert.ok(html.includes("LOST"));
      assert.ok(html.includes("by 4 wkts"));
      assert.ok(html.includes("bg-rose-600"), "Must use vibrant sports rose red");
    });

    it("11. Renders amber stamp for Tie / Draw and muted grey for Abandoned", () => {
      const tieMatch = { ...baseMatch, result: "Tie" };
      const tieHtml = ReactDOMServer.renderToStaticMarkup(
        React.createElement(PlayerMatchCard, {
          match: tieMatch,
          personalPaymentStatus: basePaymentStatus,
          availability: "Playing",
          onSelectMatch: () => {},
        })
      );
      assert.ok(tieHtml.includes("TIE"));
      assert.ok(tieHtml.includes("bg-amber-500"));

      const abandonedMatch = { ...baseMatch, result: "Abandoned" };
      const abandonedHtml = ReactDOMServer.renderToStaticMarkup(
        React.createElement(PlayerMatchCard, {
          match: abandonedMatch,
          personalPaymentStatus: { status: "WAIVED", netPayable: 0, amountPaid: 0, isWaived: true },
          availability: "Playing",
          onSelectMatch: () => {},
        })
      );
      assert.ok(abandonedHtml.includes("ABANDONED"));
      assert.ok(abandonedHtml.includes("bg-slate-200"));
    });

    it("12. Does not render any result stamp for Pending or unknown results", () => {
      const pendingMatch = { ...baseMatch, result: "Pending" };
      const pendingHtml = ReactDOMServer.renderToStaticMarkup(
        React.createElement(PlayerMatchCard, {
          match: pendingMatch,
          personalPaymentStatus: basePaymentStatus,
          availability: "Playing",
          onSelectMatch: () => {},
        })
      );
      assert.ok(!pendingHtml.includes('data-testid="result-stamp-match-test-1"'));

      const unknownMatch = { ...baseMatch, result: undefined };
      const unknownHtml = ReactDOMServer.renderToStaticMarkup(
        React.createElement(PlayerMatchCard, {
          match: unknownMatch,
          personalPaymentStatus: basePaymentStatus,
          availability: "Playing",
          onSelectMatch: () => {},
        })
      );
      assert.ok(!unknownHtml.includes('data-testid="result-stamp-match-test-1"'));
    });
  });

  // ── 13. Payment Status & Privacy Behavior Intact ────────────────────────────
  describe("13. Payment Status & Privacy Integrity", () => {
    it("13. Renders PAID, UNPAID, PARTIALLY PAID and Option A WAIVED badges correctly", () => {
      const paidHtml = ReactDOMServer.renderToStaticMarkup(
        React.createElement(PlayerMatchCard, {
          match: baseMatch,
          personalPaymentStatus: { status: "PAID", netPayable: 0, amountPaid: 650, isWaived: false },
          availability: "Playing",
          onSelectMatch: () => {},
        })
      );
      assert.ok(paidHtml.includes('data-testid="payment-status-match-test-1"'));
      assert.ok(paidHtml.includes("PAID"));

      const unpaidHtml = ReactDOMServer.renderToStaticMarkup(
        React.createElement(PlayerMatchCard, {
          match: baseMatch,
          personalPaymentStatus: { status: "UNPAID", netPayable: 650, amountPaid: 0, isWaived: false },
          availability: "Playing",
          onSelectMatch: () => {},
        })
      );
      assert.ok(unpaidHtml.includes("UNPAID • ₹650"));

      const partialHtml = ReactDOMServer.renderToStaticMarkup(
        React.createElement(PlayerMatchCard, {
          match: baseMatch,
          personalPaymentStatus: { status: "PARTIALLY PAID", netPayable: 350, amountPaid: 300, isWaived: false },
          availability: "Playing",
          onSelectMatch: () => {},
        })
      );
      assert.ok(partialHtml.includes("PARTIALLY PAID • ₹350 due"));

      // Option A Policy on Abandoned match
      const waivedHtml = ReactDOMServer.renderToStaticMarkup(
        React.createElement(PlayerMatchCard, {
          match: { ...baseMatch, result: "Abandoned" },
          personalPaymentStatus: { status: "WAIVED", netPayable: 0, amountPaid: 200, isWaived: true },
          availability: "Playing",
          onSelectMatch: () => {},
        })
      );
      assert.ok(waivedHtml.includes("WAIVED • ₹200 collected"));
      assert.ok(!waivedHtml.includes("UNPAID"));
    });

    it("13b. Displays unsettled alert callout for older unsettled matches", () => {
      const html = ReactDOMServer.renderToStaticMarkup(
        React.createElement(PlayerMatchCard, {
          match: baseMatch,
          personalPaymentStatus: { status: "UNPAID", netPayable: 500, amountPaid: 0, isWaived: false },
          availability: "Playing",
          isUnsettledAlert: true,
          onSelectMatch: () => {},
        })
      );

      assert.ok(html.includes('data-testid="unsettled-alert-match-test-1"'));
      assert.ok(html.includes("Unsettled Obligation"));
      assert.ok(html.includes("₹500 due for this past match"));
    });
  });
});
