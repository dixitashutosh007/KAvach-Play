import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  deterministicPlayerStatId,
  findDuplicatePlayerStats,
  isEligibleForNewStats,
  validatePlayerStatInput,
} from "../lib/kavach-stats-validation.ts";

const root = process.cwd();

test("validatePlayerStatInput validates playerId, year, runs, and wickets", () => {
  assert.deepEqual(
    validatePlayerStatInput({ playerId: "p-1", year: 2026, runs: 420, wickets: 12 }, 2026),
    { ok: true, value: { playerId: "p-1", year: 2026, runs: 420, wickets: 12 } },
  );
  assert.equal(validatePlayerStatInput({ playerId: "", year: 2026, runs: 10, wickets: 1 }, 2026).ok, false);
  assert.equal(validatePlayerStatInput({ playerId: "p/1", year: 2026, runs: 10, wickets: 1 }, 2026).ok, false);
  assert.equal(validatePlayerStatInput({ playerId: "p-1", year: 1980, runs: 10, wickets: 1 }, 2026).ok, false);
  assert.equal(validatePlayerStatInput({ playerId: "p-1", year: 2026, runs: -5, wickets: 1 }, 2026).ok, false);
  assert.equal(validatePlayerStatInput({ playerId: "p-1", year: 2026, runs: 10.5, wickets: 1 }, 2026).ok, false);
  assert.equal(validatePlayerStatInput({ playerId: "p-1", year: 2026, runs: 10, wickets: -1 }, 2026).ok, false);
});

test("isEligibleForNewStats blocks disabled, merged, and missing players", () => {
  assert.equal(isEligibleForNewStats({ id: "p-1", name: "Active" }), true);
  assert.equal(isEligibleForNewStats({ id: "p-2", name: "Disabled", disabled: true }), false);
  assert.equal(isEligibleForNewStats({ id: "p-3", name: "Merged", mergedInto: "p-1" }), false);
  assert.equal(isEligibleForNewStats(null), false);
});

test("findDuplicatePlayerStats detects duplicate (playerId, year) records", () => {
  const dups = findDuplicatePlayerStats([
    { id: "a", playerId: "p-1", year: 2026, runs: 100, wickets: 2 },
    { id: "b", playerId: "p-1", year: 2026, runs: 120, wickets: 3 },
    { id: "c", playerId: "p-2", year: 2026, runs: 50, wickets: 1 },
  ]);
  assert.equal(dups.length, 1);
  assert.equal(dups[0].key, "p-1_2026");
  assert.equal(dups[0].records.length, 2);
  assert.equal(deterministicPlayerStatId("p-1", 2026), "p-1_2026");
});

test("player-stats API route enforces Club/Super Admin RBAC, transactions, and audit logging", () => {
  const routeSrc = fs.readFileSync(
    path.join(root, "app/api/admin/player-stats/route.ts"),
    "utf8",
  );
  assert.match(routeSrc, /requireRole\(req,\s*\[\.\.\.POTW_AWARD_ROLES\]\)/);
  assert.match(routeSrc, /db\.runTransaction/);
  assert.match(routeSrc, /isEligibleForNewStats\(playerData\)/);
  assert.match(routeSrc, /writeServerAudit\(/);
  assert.match(routeSrc, /entity:\s*"player_stat"/);

  const clubTabSrc = fs.readFileSync(path.join(root, "components/ClubTab.tsx"), "utf8");
  assert.match(clubTabSrc, /show\("leaderboard"\) && isClubAdmin[\s\S]*<KavachStatsAdmin store=\{store\} \/>/);
});
