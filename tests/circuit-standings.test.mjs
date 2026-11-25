/**
 * Club Rankings model and wiring (`tests/circuit-standings.test.mjs`).
 * Only two rankings are active: Ranking in Bangalore (`bangalore`) and
 * Ranking in India (`india`), with backward-compatible read fallback for
 * legacy 4-category keys (`bangalore-wins`/`bangalore-played`, `india-wins`/`india-played`).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  CIRCUITS,
  CIRCUIT_KEYS,
  formatStanding,
  readStoredStanding,
  standingsByCircuit,
  validateCircuitStandingInput,
} from "../lib/circuit-standings.ts";
import { getVisibleClubSections } from "../lib/admin-navigation.ts";

const src = (f) => fs.readFileSync(f, "utf-8");
const ok = { circuit: "india", rank: 20, value: 0 };

describe("Rankings: exactly Bangalore and India", () => {
  it("exposes only bangalore and india without Most Played / Most Wins", () => {
    assert.deepEqual(CIRCUIT_KEYS, ["bangalore", "india"]);
    assert.deepEqual(
      CIRCUITS.map((c) => `${c.scope} – ${c.metric}`),
      ["Bangalore – Ranking in Bangalore", "India – Ranking in India"],
    );
  });
});

describe("validateCircuitStandingInput: circuit, rank, optional value", () => {
  it("accepts bangalore and india with integer rank (value optional)", () => {
    assert.deepEqual(validateCircuitStandingInput({ circuit: "india", rank: 20 }), { ok: true, value: ok });
    assert.deepEqual(validateCircuitStandingInput({ circuit: "bangalore", rank: " 4 " }), {
      ok: true,
      value: { circuit: "bangalore", rank: 4, value: 0 },
    });
    assert.deepEqual(validateCircuitStandingInput({ circuit: "india", rank: 15, value: 700 }), {
      ok: true,
      value: { circuit: "india", rank: 15, value: 700 },
    });
  });

  const bad = [
    ["non-object", null],
    ["array", []],
    ["a player field", { ...ok, playerId: "p1" }],
    ["an unknown field", { ...ok, updatedBy: "x" }],
    ["legacy circuit", { circuit: "india-wins", rank: 20 }],
    ["unknown circuit", { circuit: "mumbai", rank: 20 }],
    ["missing rank", { circuit: "india" }],
    ["rank 0", { circuit: "india", rank: 0 }],
    ["rank decimal", { circuit: "india", rank: 1.5 }],
    ["rank text", { circuit: "india", rank: "20th" }],
    ["rank too large", { circuit: "india", rank: 100001 }],
    ["negative value", { circuit: "india", rank: 2, value: -1 }],
    ["value too large", { circuit: "india", rank: 2, value: 100001 }],
  ];
  for (const [name, input] of bad) it(`rejects ${name}`, () => assert.equal(validateCircuitStandingInput(input).ok, false));
});

describe("Stored rankings & legacy fallback", () => {
  it("reads active and legacy doc ids defensively; drops malformed docs", () => {
    assert.deepEqual(readStoredStanding("india", { circuit: "india", rank: 20 }), ok);
    assert.deepEqual(readStoredStanding("india-wins", { circuit: "india-wins", rank: 12, value: 300 }), {
      circuit: "india-wins",
      rank: 12,
      value: 300,
    });
    assert.equal(readStoredStanding("india", { circuit: "bangalore", rank: 20 }), null);
    assert.equal(readStoredStanding("india__p1", { circuit: "india", rank: 1 }), null);
    assert.equal(readStoredStanding("india", { circuit: "india", rank: 0 }), null);
  });

  it("maps active keys and falls back to legacy -wins then -played without mutating records", () => {
    const legacyOnly = standingsByCircuit([
      { circuit: "india-played", rank: 15, value: 700 },
      { circuit: "india-wins", rank: 12, value: 500 },
      { circuit: "bangalore-played", rank: 4, value: 200 },
    ]);
    assert.equal(legacyOnly.india?.rank, 12);
    assert.equal(legacyOnly.bangalore?.rank, 4);

    // Active key overrides legacy fallback
    const withActive = standingsByCircuit([
      { circuit: "india-wins", rank: 12, value: 500 },
      { circuit: "india", rank: 7, value: 0 },
    ]);
    assert.equal(withActive.india?.rank, 7);
    assert.equal(formatStanding(ok), "#20");
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
  it("Admin Club → Leaderboard & Stats hosts ClubStatisticsAdmin and Club Rankings; Club/Super only", () => {
    assert.match(src("components/ClubTab.tsx"), /\{show\("leaderboard"\) && isClubAdmin && \(\s*<div className="space-y-6">\s*<ClubStatisticsAdmin \/>\s*<CircuitStandingsAdmin \/>/);
    assert.ok(getVisibleClubSections({ isSuperAdmin: false, isClubAdmin: true, isFinanceAdmin: false }, () => true).includes("leaderboard"));
    assert.ok(!getVisibleClubSections({ isSuperAdmin: false, isClubAdmin: false, isFinanceAdmin: true }, () => true).includes("leaderboard"));
    assert.doesNotMatch(src("components/club/CircuitStandingsAdmin.tsx"), /Most Wins|Most Played|player/i);
  });
  it("Player Club Stats window shows consolidated performance and only Bangalore/India rankings", () => {
    const p = src("components/club/PlayerClubTab.tsx");
    assert.match(p, /useCircuitStandings\(\)/);
    assert.match(p, /standingsByCircuit\(circuit\.standings\)/);
    assert.doesNotMatch(p, /Most Wins|Most Played/);
  });
});
