import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { getAvailableStatYears, aggregateKavachStats } from "../lib/kavach-stats.ts";

const players = [
  { id: "p-1", name: "Arjun", kavachId: "KAV-01" },
  { id: "p-2", name: "Rohan", kavachId: "KAV-02" },
  { id: "p-disabled", name: "Old", disabled: true },
];

const playerStats = [
  { id: "s-1", playerId: "p-1", year: 2025, runs: 320, wickets: 8 },
  { id: "s-2", playerId: "p-1", year: 2026, runs: 410, wickets: 5 },
  { id: "s-3", playerId: "p-2", year: 2026, runs: 190, wickets: 14 },
  { id: "s-4", playerId: "p-disabled", year: 2026, runs: 999, wickets: 99 },
];

test("getAvailableStatYears returns sorted descending unique years", () => {
  assert.deepEqual(getAvailableStatYears(playerStats), [2026, 2025]);
  assert.deepEqual(getAvailableStatYears([]), []);
});

test("aggregateKavachStats computes overall and year-wise totals without disabled players", () => {
  const overall = aggregateKavachStats(playerStats, players, "overall");
  assert.equal(overall.hasData, true);
  assert.equal(overall.totalRuns, 920);
  assert.equal(overall.totalWickets, 27);
  assert.equal(overall.contributorsCount, 2);
  assert.equal(overall.topScorers[0].playerId, "p-1");
  assert.equal(overall.topScorers[0].runs, 730);
  assert.equal(overall.topWicketTakers[0].playerId, "p-2");
  assert.equal(overall.topWicketTakers[0].wickets, 14);

  const y2026 = aggregateKavachStats(playerStats, players, 2026);
  assert.equal(y2026.totalRuns, 600);
  assert.equal(y2026.totalWickets, 19);
  assert.equal(y2026.topScorers[0].runs, 410);
});

test("aggregateKavachStats does not fabricate data when empty", () => {
  const empty = aggregateKavachStats([], players, "overall");
  assert.equal(empty.hasData, false);
  assert.equal(empty.totalRuns, 0);
  assert.equal(empty.totalWickets, 0);
  assert.deepEqual(empty.topScorers, []);
  assert.deepEqual(empty.topWicketTakers, []);
});

test("PlayerClubTab wires ClubInfoCard and KavachStatsSection with ensurePlayerStats", () => {
  const clubSrc = fs.readFileSync(
    path.join(process.cwd(), "components/club/PlayerClubTab.tsx"),
    "utf8",
  );
  assert.match(clubSrc, /store\.ensurePlayerStats\?\.\(\)/);
  assert.match(clubSrc, /<ClubInfoCard/);
  assert.match(clubSrc, /<KavachStatsSection/);
});
