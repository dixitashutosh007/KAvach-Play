import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  awardBadgesBatch,
  DEFAULT_STACKABLE_BADGES,
  getAvailableBadgesForPlayers,
  getEligiblePlayersForBadge,
} from "../lib/badge-awarding.ts";

describe("Phase 1: Badge per-player eligibility and multi-player batch awarding", () => {
  it("filters per-player eligibility for non-stackable, stackable, and system badges", () => {
    const existing = new Map([
      ["p1", new Set(["year_1", "centurion"])],
      ["p2", new Set(["centurion"])],
    ]);

    const nonStack = getEligiblePlayersForBadge(
      ["p1", "p2", "p3", "p2"],
      "year_1",
      existing,
      DEFAULT_STACKABLE_BADGES,
    );
    assert.deepEqual(nonStack.eligible, ["p2", "p3"]);
    assert.deepEqual(nonStack.skipped, ["p1"]);

    const stackable = getEligiblePlayersForBadge(
      ["p1", "p2"],
      "centurion",
      existing,
      DEFAULT_STACKABLE_BADGES,
    );
    assert.deepEqual(stackable.eligible, ["p1", "p2"]);
    assert.deepEqual(stackable.skipped, []);

    const system = getEligiblePlayersForBadge(
      ["p1", "p2"],
      "player_of_weekend",
      existing,
      DEFAULT_STACKABLE_BADGES,
    );
    assert.deepEqual(system.eligible, []);
    assert.deepEqual(system.skipped, ["p1", "p2"]);
  });

  it("hides non-stackable badges only when all selected players already hold them", () => {
    const existing = new Map([
      ["p1", new Set(["year_1"])],
      ["p2", new Set(["year_1", "original"])],
    ]);
    const allTypes = ["year_1", "original", "centurion", "player_of_weekend"];

    const bothSelected = getAvailableBadgesForPlayers(allTypes, ["p1", "p2"], existing, DEFAULT_STACKABLE_BADGES);
    assert.deepEqual(bothSelected, ["original", "centurion"]);

    const p2Only = getAvailableBadgesForPlayers(allTypes, ["p2"], existing, DEFAULT_STACKABLE_BADGES);
    assert.deepEqual(p2Only, ["centurion"]);
  });

  it("reports succeeded, skipped, and failed players and retries only failed without duplicating", async () => {
    const existing = new Map([
      ["p1", new Set(["year_1"])],
      ["p2", new Set()],
      ["p3", new Set()],
    ]);
    const playersById = new Map([
      ["p1", { id: "p1", name: "Alice" }],
      ["p2", { id: "p2", name: "Bob" }],
      ["p3", { id: "p3", name: "Charlie" }],
    ]);

    const calls = [];
    let failP3 = true;
    let seq = 0;

    const first = await awardBadgesBatch({
      playerIds: ["p1", "p2", "p3"],
      badgeType: "year_1",
      playersById,
      existingBadgesByPlayer: existing,
      stackableSet: DEFAULT_STACKABLE_BADGES,
      createKey: () => `k_${++seq}`,
      awardOne: async (player, key) => {
        calls.push({ id: player.id, key });
        if (player.id === "p3" && failP3) {
          const err = new Error("Network timeout");
          err.status = 503;
          throw err;
        }
        return `badge_${player.id}`;
      },
    });

    assert.equal(first.succeeded.length, 1);
    assert.equal(first.succeeded[0].playerId, "p2");
    assert.equal(first.skipped.length, 1);
    assert.equal(first.skipped[0].playerId, "p1");
    assert.equal(first.failed.length, 1);
    assert.equal(first.failed[0].playerId, "p3");
    const p3Key = first.failed[0].idempotencyKey;
    assert.ok(p3Key);
    assert.deepEqual(calls.map((c) => c.id), ["p2", "p3"]);

    // Retry only failed players, preserving idempotency key
    failP3 = false;
    const retryKeys = new Map(first.failed.map((f) => [f.playerId, f.idempotencyKey]));
    const retry = await awardBadgesBatch({
      playerIds: first.failed.map((f) => f.playerId),
      badgeType: "year_1",
      playersById,
      existingBadgesByPlayer: existing,
      stackableSet: DEFAULT_STACKABLE_BADGES,
      idempotencyKeys: retryKeys,
      awardOne: async (player, key) => {
        calls.push({ id: player.id, key });
        return `badge_${player.id}`;
      },
    });

    assert.equal(retry.succeeded.length, 1);
    assert.equal(retry.succeeded[0].playerId, "p3");
    assert.equal(retry.succeeded[0].idempotencyKey, p3Key);
    assert.equal(retry.failed.length, 0);
    // p1 and p2 were NOT called again during retry
    assert.deepEqual(calls, [
      { id: "p2", key: "k_1" },
      { id: "p3", key: "k_2" },
      { id: "p3", key: "k_2" },
    ]);
  });

  it("classifies 409 server conflict as skipped rather than failed", async () => {
    const existing = new Map([["p1", new Set()]]);
    const playersById = new Map([["p1", { id: "p1", name: "Alice" }]]);

    const res = await awardBadgesBatch({
      playerIds: ["p1"],
      badgeType: "year_1",
      playersById,
      existingBadgesByPlayer: existing,
      awardOne: async () => {
        const err = new Error("Player already holds this non-stackable badge.");
        err.status = 409;
        throw err;
      },
    });

    assert.equal(res.succeeded.length, 0);
    assert.equal(res.failed.length, 0);
    assert.equal(res.skipped.length, 1);
    assert.equal(res.skipped[0].playerId, "p1");
  });
});

describe("Phase 1: Static regressions", () => {
  it("buildBadgeMetaMap does not call useToast() inside a non-hook helper", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "components/BadgeIcon.tsx"), "utf8");
    const match = src.match(/export function buildBadgeMetaMap[\s\S]*?\n\}/);
    assert.ok(match, "buildBadgeMetaMap function should exist");
    assert.equal(match[0].includes("useToast"), false, "buildBadgeMetaMap must not call useToast()");
  });

  it("Admin Global Search queries badgeTypes collection instead of badgeTypeDefs", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "app/api/admin/search/route.ts"), "utf8");
    assert.equal(src.includes('collection("badgeTypes")'), true);
    assert.equal(src.includes('collection("badgeTypeDefs")'), false);
  });
});
