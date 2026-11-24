/**
 * Circuit Standings model and wiring (`tests/circuit-standings.test.mjs`).
 * A standing is the CLUB's own rank and total in a circuit (no player).
 * Imports the PRODUCTION module lib/circuit-standings.ts and lib/admin-navigation.ts;
 * source checks for rules/route/UI wiring. No emulator, browser or network.
 * API + rules behaviour: tests/circuit-standings.emulator.test.mjs.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  CIRCUITS,
  CIRCUIT_KEYS,
  formatStanding,
  formatStandingValue,
  readStoredStanding,
  standingsByCircuit,
  validateCircuitStandingInput,
} from "../lib/circuit-standings.ts";
import { getVisibleClubSections } from "../lib/admin-navigation.ts";

const src = (f) => fs.readFileSync(f, "utf-8");
const ok = { circuit: "india-wins", rank: 20, value: 500 };

describe("Circuits: exactly the four supported standings", () => {
  it("India/Bangalore × Most Wins/Most Played, each with its metric", () => {
    assert.deepEqual(CIRCUIT_KEYS, ["india-wins", "india-played", "bangalore-wins", "bangalore-played"]);
    assert.deepEqual(
      CIRCUITS.map((c) => `${c.scope} – ${c.metric} (${c.valueLabel})`),
      ["India – Most Wins (Wins)", "India – Most Played (Matches played)", "Bangalore – Most Wins (Wins)", "Bangalore – Most Played (Matches played)"],
    );
  });
});

describe("validateCircuitStandingInput: only circuit, rank and total", () => {
  it("accepts the owner's examples; digit strings are converted", () => {
    assert.deepEqual(validateCircuitStandingInput(ok), { ok: true, value: ok });
    assert.deepEqual(validateCircuitStandingInput({ circuit: "india-played", rank: "15", value: " 700 " }), { ok: true, value: { circuit: "india-played", rank: 15, value: 700 } });
    assert.equal(validateCircuitStandingInput({ circuit: "bangalore-wins", rank: 4, value: 115 }).ok, true);
    assert.equal(validateCircuitStandingInput({ circuit: "bangalore-played", rank: 4, value: 200 }).ok, true);
  });
  const bad = [
    ["non-object", null],
    ["array", []],
    ["a player field", { ...ok, playerId: "p1" }],
    ["an unknown field", { ...ok, updatedBy: "x" }],
    ["unknown circuit", { ...ok, circuit: "mumbai-wins" }],
    ["missing rank", { circuit: "india-wins", value: 5 }],
    ["missing total", { circuit: "india-wins", rank: 5 }],
    ["rank 0", { ...ok, rank: 0 }],
    ["rank decimal", { ...ok, rank: 1.5 }],
    ["rank text", { ...ok, rank: "20th" }],
    ["rank too large", { ...ok, rank: 100001 }],
    ["negative total", { ...ok, value: -1 }],
    ["total 500+", { ...ok, value: "500+" }],
    ["total too large", { ...ok, value: 100001 }],
  ];
  for (const [name, input] of bad) it(`rejects ${name}`, () => assert.equal(validateCircuitStandingInput(input).ok, false));
  it("error messages name the circuit's metric", () => {
    assert.match(validateCircuitStandingInput({ circuit: "bangalore-played", rank: 4, value: "x" }).error, /Matches played/);
    assert.match(validateCircuitStandingInput({ circuit: "india-wins", rank: 4, value: "x" }).error, /Wins/);
  });
});

describe("Stored standings → display", () => {
  it("doc id must be the circuit; malformed docs are dropped (never shown)", () => {
    assert.deepEqual(readStoredStanding("india-wins", { circuit: "india-wins", rank: 20, value: 500 }), ok);
    assert.equal(readStoredStanding("india-wins", { circuit: "india-played", rank: 20, value: 500 }), null);
    assert.equal(readStoredStanding("india-wins__p1", { circuit: "india-wins", rank: 1, value: 4 }), null); // old player-shaped record
    assert.equal(readStoredStanding("india-wins", { circuit: "india-wins", rank: 0, value: 4 }), null);
    assert.equal(readStoredStanding("india-wins", { circuit: "india-wins", rank: 3 }), null);
  });
  it("one standing per circuit; formatted as rank and labelled total", () => {
    const m = standingsByCircuit([ok, { circuit: "bangalore-played", rank: 4, value: 200 }]);
    assert.equal(m["india-wins"].rank, 20);
    assert.equal(m["india-played"], undefined);
    assert.equal(formatStanding(ok), "#20 · 500 wins");
    assert.equal(formatStanding({ circuit: "india-played", rank: 15, value: 700 }), "#15 · 700 matches played");
    assert.equal(formatStandingValue("bangalore-wins", 1), "1 win");
    assert.equal(formatStandingValue("india-played", 1250), "1,250 matches played");
  });
});

describe("Permissions and wiring", () => {
  it("Firestore rules: signed-in read, no client writes", () => {
    const rules = src("firestore.rules");
    const block = rules.slice(rules.indexOf("match /circuitStandings/{standingId}"), rules.indexOf("match /merchandises/"));
    assert.match(block, /allow read: if isSignedIn\(\);/);
    assert.match(block, /allow write: if false;/);
  });
  it("API: PUT and DELETE are guarded by requireClubAdmin and audited; no player input", () => {
    const route = src("app/api/admin/circuit-standings/route.ts");
    for (const m of ["PUT", "DELETE"]) assert.match(route, new RegExp(`export async function ${m}\\(req: Request\\)`));
    assert.doesNotMatch(route, /export async function POST/);
    assert.match(route, /const guard = await requireClubAdmin\(req\);/);
    assert.equal((route.match(/await guarded\(req\)/g) || []).length, 2);
    assert.equal((route.match(/writeServerAudit\(/g) || []).length, 2);
    assert.doesNotMatch(route, /playerId/);
  });
  it("Admin Club → Club Stats hosts the manager next to Club Statistics; Club/Super only", () => {
    assert.match(src("components/ClubTab.tsx"), /\{show\("leaderboard"\) && isClubAdmin && \(\s*<div className="space-y-6">\s*<ClubStatisticsAdmin \/>\s*<CircuitStandingsAdmin \/>/);
    assert.ok(getVisibleClubSections({ isSuperAdmin: false, isClubAdmin: true, isFinanceAdmin: false }, () => true).includes("leaderboard"));
    assert.ok(!getVisibleClubSections({ isSuperAdmin: false, isClubAdmin: false, isFinanceAdmin: true }, () => true).includes("leaderboard"));
    assert.doesNotMatch(src("components/club/CircuitStandingsAdmin.tsx"), /player/i);
  });
  it("Player Club reads the saved standings (no hardcoded values)", () => {
    const p = src("components/club/PlayerClubTab.tsx");
    assert.match(p, /useCircuitStandings\(\)/);
    assert.match(p, /standingsByCircuit\(circuit\.standings\)/);
    assert.doesNotMatch(p, /const CIRCUIT_STANDINGS = \[/);
  });
});
