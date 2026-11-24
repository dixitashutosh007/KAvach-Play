/**
 * Circuit Standings model and wiring (`tests/circuit-standings.test.mjs`).
 * Imports the PRODUCTION module lib/circuit-standings.ts (validation, ordering,
 * formatting) and lib/admin-navigation.ts; source checks for rules/route/UI wiring.
 * No emulator, browser or network. API + rules behaviour: circuit-standings.emulator.test.mjs.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  CIRCUITS,
  CIRCUIT_KEYS,
  clubToday,
  formatAsOf,
  formatStandingValue,
  isSelectablePlayer,
  isValidAsOf,
  readStoredStanding,
  standingDocId,
  standingsFor,
  validateCircuitStandingInput,
} from "../lib/circuit-standings.ts";
import { getVisibleClubSections } from "../lib/admin-navigation.ts";

const src = (f) => fs.readFileSync(f, "utf-8");
const TODAY = "2026-11-24";
const ok = { circuit: "india-wins", playerId: "p_1", rank: 1, value: 42, asOf: "2026-11-20" };

describe("Circuits: exactly the four supported standings", () => {
  it("India/Bangalore × Most Wins/Most Played, each with its metric", () => {
    assert.deepEqual(CIRCUIT_KEYS, ["india-wins", "india-played", "bangalore-wins", "bangalore-played"]);
    assert.deepEqual(
      CIRCUITS.map((c) => `${c.scope} – ${c.metric} (${c.valueLabel})`),
      ["India – Most Wins (Wins)", "India – Most Played (Matches played)", "Bangalore – Most Wins (Wins)", "Bangalore – Most Played (Matches played)"],
    );
  });
});

describe("validateCircuitStandingInput", () => {
  it("accepts a complete record; digit strings are converted", () => {
    assert.deepEqual(validateCircuitStandingInput(ok, TODAY), { ok: true, value: ok });
    assert.deepEqual(validateCircuitStandingInput({ ...ok, rank: " 3 ", value: "120" }, TODAY), { ok: true, value: { ...ok, rank: 3, value: 120 } });
  });
  const bad = [
    ["non-object", null],
    ["array", []],
    ["unknown field", { ...ok, playerName: "Forged" }],
    ["client-supplied id", { ...ok, id: "x" }],
    ["unknown circuit", { ...ok, circuit: "mumbai-wins" }],
    ["missing player", { ...ok, playerId: "" }],
    ["player id with path chars", { ...ok, playerId: "a/b" }],
    ["rank 0", { ...ok, rank: 0 }],
    ["rank decimal", { ...ok, rank: 1.5 }],
    ["rank too large", { ...ok, rank: 1000 }],
    ["rank text", { ...ok, rank: "1st" }],
    ["negative value", { ...ok, value: -1 }],
    ["value 350+", { ...ok, value: "350+" }],
    ["value too large", { ...ok, value: 10001 }],
    ["future as-of", { ...ok, asOf: "2026-11-25" }],
    ["impossible date", { ...ok, asOf: "2026-02-30" }],
    ["bad date format", { ...ok, asOf: "20/11/2026" }],
    ["missing as-of", { circuit: "india-wins", playerId: "p_1", rank: 1, value: 4 }],
  ];
  for (const [name, input] of bad) {
    it(`rejects ${name}`, () => assert.equal(validateCircuitStandingInput(input, TODAY).ok, false));
  }
  it("error messages name the circuit's metric", () => {
    const r = validateCircuitStandingInput({ ...ok, circuit: "bangalore-played", value: "x" }, TODAY);
    assert.match(r.error, /Matches played/);
  });
  it("isValidAsOf accepts today and earlier only", () => {
    assert.equal(isValidAsOf(TODAY, TODAY), true);
    assert.equal(isValidAsOf("1999-12-31", TODAY), false);
    assert.match(clubToday(new Date("2026-11-24T20:00:00Z")), /^2026-11-25$/); // IST is UTC+5:30
  });
});

describe("Stored records → display", () => {
  const rows = [
    { id: standingDocId("india-wins", "b"), data: { circuit: "india-wins", playerId: "b", playerName: "Bala", rank: 2, value: 30, asOf: "2026-11-01" } },
    { id: standingDocId("india-wins", "a"), data: { circuit: "india-wins", playerId: "a", playerName: "Arun", rank: 1, value: 42, asOf: "2026-11-01" } },
    { id: standingDocId("india-wins", "c"), data: { circuit: "india-wins", playerId: "c", playerName: "Chetan", rank: 2, value: 35, asOf: "2026-11-01" } },
    { id: standingDocId("india-played", "a"), data: { circuit: "india-played", playerId: "a", playerName: "Arun", rank: 1, value: 1, asOf: "2026-11-01" } },
    { id: "junk", data: { circuit: "india-wins", playerId: "z", rank: 0, value: 1, asOf: "x" } },
    { id: "junk2", data: { circuit: "delhi-wins", playerId: "z", rank: 1, value: 1, asOf: "x" } },
  ];
  const parsed = rows.map((r) => readStoredStanding(r.id, r.data)).filter(Boolean);
  it("malformed records are dropped, never shown", () => assert.equal(parsed.length, 4));
  it("sorted by rank; ties by higher value", () => {
    assert.deepEqual(standingsFor(parsed, "india-wins").map((s) => s.playerName), ["Arun", "Chetan", "Bala"]);
    assert.deepEqual(standingsFor(parsed, "bangalore-wins"), []);
  });
  it("value is labelled by the circuit's metric", () => {
    assert.equal(formatStandingValue("india-wins", 42), "42 wins");
    assert.equal(formatStandingValue("india-wins", 1), "1 win");
    assert.equal(formatStandingValue("bangalore-played", 118), "118 matches");
    assert.equal(formatStandingValue("india-played", 1), "1 match");
    assert.equal(formatAsOf("2026-11-05"), "5 Nov 2026");
  });
  it("one record per (circuit, player) via deterministic id", () => assert.equal(standingDocId("india-wins", "p1"), "india-wins__p1"));
  it("inactive or merged players are not selectable", () => {
    assert.equal(isSelectablePlayer({}), true);
    assert.equal(isSelectablePlayer({ disabled: true }), false);
    assert.equal(isSelectablePlayer({ mergedInto: "p2" }), false);
    assert.equal(isSelectablePlayer({ mergeStatus: "in_progress" }), false);
  });
});

describe("Permissions wiring", () => {
  it("Firestore rules: signed-in read, no client writes", () => {
    const rules = src("firestore.rules");
    const block = rules.slice(rules.indexOf("match /circuitStandings/{standingId}"), rules.indexOf("match /merchandises/"));
    assert.match(block, /allow read: if isSignedIn\(\);/);
    assert.match(block, /allow write: if false;/);
  });
  it("API: every method is guarded by requireClubAdmin and audited", () => {
    const route = src("app/api/admin/circuit-standings/route.ts");
    for (const m of ["POST", "PUT", "DELETE"]) assert.match(route, new RegExp(`export async function ${m}\\(req: Request\\)`));
    assert.match(route, /const guard = await requireClubAdmin\(req\);/);
    assert.equal((route.match(/await guarded\(req\)/g) || []).length, 3);
    assert.equal((route.match(/writeServerAudit\(/g) || []).length, 3);
  });
  it("Admin Club → Club Stats (leaderboard section) hosts the manager; Club/Super only", () => {
    const club = src("components/ClubTab.tsx");
    assert.match(club, /\{show\("leaderboard"\) && isClubAdmin && \(\s*<div className="space-y-6">\s*<ClubStatisticsAdmin \/>\s*<CircuitStandingsAdmin store=\{store\} \/>/);
    const yes = getVisibleClubSections({ isSuperAdmin: false, isClubAdmin: true, isFinanceAdmin: false }, () => true);
    const no = getVisibleClubSections({ isSuperAdmin: false, isClubAdmin: false, isFinanceAdmin: true }, () => true);
    assert.ok(yes.includes("leaderboard"));
    assert.ok(!no.includes("leaderboard"));
  });
  it("Player Club reads the saved standings (no hardcoded records)", () => {
    const p = src("components/club/PlayerClubTab.tsx");
    assert.match(p, /useCircuitStandings\(\)/);
    assert.match(p, /standingsFor\(circuit\.standings, c\.key\)\[0\]/);
    assert.doesNotMatch(p, /const CIRCUIT_STANDINGS = \[/);
    assert.match(src("components/club/CircuitStandingsAdmin.tsx"), /isSelectablePlayer/);
  });
});
