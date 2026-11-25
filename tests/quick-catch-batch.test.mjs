import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createCatchBatchState, executeCatchBatch } from "../lib/catch-batch.ts";

const names = { p1: "Arjun", p2: "Rohan", p3: "Vikram" };

test("multiple selected players with all submissions successful generate unique keys and clear them", async () => {
  let seq = 0;
  const calls = [];
  const state = createCatchBatchState();

  const res = await executeCatchBatch({
    selectedPlayers: ["p1", "p2", "p3"],
    state,
    catchType: "stunning",
    playerCounts: { p1: 1, p2: 2, p3: 1 },
    comment: "Great fielding",
    getPlayerName: (id) => names[id] || null,
    generateKey: () => `key-${++seq}`,
    recordCatch: async (entry) => {
      calls.push(entry);
    },
  });

  assert.equal(res.allSucceeded, true);
  assert.equal(res.succeededCount, 3);
  assert.deepEqual(
    calls.map((c) => [c.playerId, c.idempotencyKey]),
    [
      ["p1", "key-1"],
      ["p2", "key-2"],
      ["p3", "key-3"],
    ],
  );
  assert.deepEqual(state.pendingKeys, {});
  assert.equal(state.succeededPlayerIds.size, 3);
});

test("partial success followed by failure preserves failed/pending keys and retries without duplicating succeeded players", async () => {
  let seq = 0;
  let shouldFailP2 = true;
  const calls = [];
  const state = createCatchBatchState();

  const firstAttempt = await executeCatchBatch({
    selectedPlayers: ["p1", "p2", "p3"],
    state,
    catchType: "dropped",
    playerCounts: { p1: 1, p2: 2, p3: 1 },
    comment: "Slip drops",
    getPlayerName: (id) => names[id] || null,
    generateKey: () => `key-${++seq}`,
    recordCatch: async (entry) => {
      calls.push(entry);
      if (entry.playerId === "p2" && shouldFailP2) {
        throw new Error("Network timeout");
      }
    },
  });

  assert.equal(firstAttempt.allSucceeded, false);
  assert.equal(firstAttempt.succeededCount, 1);
  assert.equal(firstAttempt.failedPlayerId, "p2");
  assert.equal(firstAttempt.errorMessage, "Network timeout");
  // p1 key cleared; p2 and p3 keys preserved
  assert.equal("p1" in state.pendingKeys, false);
  assert.equal(state.pendingKeys.p2, "key-2");
  assert.equal(state.pendingKeys.p3, "key-3");
  assert.equal(state.succeededPlayerIds.has("p1"), true);

  // Retry after transient failure
  shouldFailP2 = false;
  const retryAttempt = await executeCatchBatch({
    selectedPlayers: ["p1", "p2", "p3"],
    state,
    catchType: "dropped",
    playerCounts: { p1: 1, p2: 2, p3: 1 },
    comment: "Slip drops",
    getPlayerName: (id) => names[id] || null,
    generateKey: () => `key-${++seq}`,
    recordCatch: async (entry) => {
      calls.push(entry);
    },
  });

  assert.equal(retryAttempt.allSucceeded, true);
  assert.equal(retryAttempt.succeededCount, 2);
  // p1 was NOT re-submitted; p2 reused key-2; p3 used key-3
  assert.deepEqual(
    calls.map((c) => [c.playerId, c.idempotencyKey]),
    [
      ["p1", "key-1"],
      ["p2", "key-2"],
      ["p2", "key-2"],
      ["p3", "key-3"],
    ],
  );
  assert.deepEqual(state.pendingKeys, {});
});

test("genuinely new catch operation after reset generates fresh keys", async () => {
  let seq = 0;
  const calls = [];
  const state1 = createCatchBatchState();
  await executeCatchBatch({
    selectedPlayers: ["p1"],
    state: state1,
    catchType: "stunning",
    playerCounts: { p1: 1 },
    comment: "First batch",
    getPlayerName: (id) => names[id] || null,
    generateKey: () => `key-${++seq}`,
    recordCatch: async (entry) => calls.push(entry),
  });

  const state2 = createCatchBatchState();
  await executeCatchBatch({
    selectedPlayers: ["p1"],
    state: state2,
    catchType: "stunning",
    playerCounts: { p1: 1 },
    comment: "Second batch",
    getPlayerName: (id) => names[id] || null,
    generateKey: () => `key-${++seq}`,
    recordCatch: async (entry) => calls.push(entry),
  });

  assert.notEqual(calls[0].idempotencyKey, calls[1].idempotencyKey);
});

test("AdminDashboard Quick Catch modal wires executeCatchBatch and resets batch state on input changes", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "components/AdminDashboard.tsx"), "utf8");
  assert.match(src, /executeCatchBatch\(/);
  assert.match(src, /batchStateRef\.current/);
  assert.match(src, /resetBatchState\(\)/);
});
