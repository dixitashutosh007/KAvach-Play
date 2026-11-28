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
  assert.equal(firstAttempt.succeededCount, 2);
  assert.equal(firstAttempt.failedPlayers.length, 1);
  assert.equal(firstAttempt.failedPlayerId, "p2");
  assert.match(firstAttempt.errorMessage || "", /Network timeout/);
  // p1 and p3 succeeded and had their keys cleared; only p2 key preserved
  assert.equal("p1" in state.pendingKeys, false);
  assert.equal("p3" in state.pendingKeys, false);
  assert.equal(state.pendingKeys.p2, "key-2");
  assert.equal(state.succeededPlayerIds.has("p1"), true);
  assert.equal(state.succeededPlayerIds.has("p3"), true);

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
  assert.equal(retryAttempt.succeededCount, 1);
  // p1 and p3 were NOT re-submitted; only p2 retried with key-2
  assert.deepEqual(
    calls.map((c) => [c.playerId, c.idempotencyKey]),
    [
      ["p1", "key-1"],
      ["p2", "key-2"],
      ["p3", "key-3"],
      ["p2", "key-2"],
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

test("unresolved selected player returns failure, preserves pending keys and succeededPlayerIds, and retries cleanly", async () => {
  let seq = 0;
  let p2Available = false;
  const calls = [];
  const state = createCatchBatchState();

  const firstAttempt = await executeCatchBatch({
    selectedPlayers: ["p1", "p2", "p3"],
    state,
    catchType: "stunning",
    playerCounts: { p1: 1, p2: 1, p3: 1 },
    comment: "Practice",
    getPlayerName: (id) => (id === "p2" && !p2Available ? null : names[id] || null),
    generateKey: () => `key-${++seq}`,
    recordCatch: async (entry) => {
      calls.push(entry);
    },
  });

  // Never reports allSucceeded: true when p2 could not be resolved; p1 and p3 still persist once
  assert.equal(firstAttempt.allSucceeded, false);
  assert.equal(firstAttempt.succeededCount, 2);
  assert.equal(firstAttempt.failedPlayers.length, 1);
  assert.equal(firstAttempt.failedPlayerId, "p2");
  assert.match(firstAttempt.errorMessage || "", /p2/);
  assert.equal(state.succeededPlayerIds.has("p1"), true);
  assert.equal(state.succeededPlayerIds.has("p3"), true);
  assert.equal("p1" in state.pendingKeys, false);
  assert.equal("p3" in state.pendingKeys, false);
  assert.equal(state.pendingKeys.p2, "key-2");

  // Retry once p2 becomes active again: p1 and p3 are NOT re-submitted, p2 reuses key-2
  p2Available = true;
  const retryAttempt = await executeCatchBatch({
    selectedPlayers: ["p1", "p2", "p3"],
    state,
    catchType: "stunning",
    playerCounts: { p1: 1, p2: 1, p3: 1 },
    comment: "Practice",
    getPlayerName: (id) => names[id] || null,
    generateKey: () => `key-${++seq}`,
    recordCatch: async (entry) => {
      calls.push(entry);
    },
  });

  assert.equal(retryAttempt.allSucceeded, true);
  assert.equal(retryAttempt.succeededCount, 1);
  assert.deepEqual(
    calls.map((c) => [c.playerId, c.idempotencyKey]),
    [
      ["p1", "key-1"],
      ["p3", "key-3"],
      ["p2", "key-2"],
    ],
  );
  assert.deepEqual(state.pendingKeys, {});
});

test("AdminDashboard Quick Catch modal blocks closing and input mutations while saving", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "components/AdminDashboard.tsx"), "utf8");
  assert.match(src, /executeCatchBatch\(/);
  assert.match(src, /batchStateRef\.current/);
  assert.match(src, /if \(isSavingRef\.current\) return;/);
  assert.match(src, /const handleClose = \(\) => \{\s*if \(isSavingRef\.current \|\| isSaving\) return;/);
  assert.match(src, /onClick=\{handleClose\}\s*disabled=\{isSaving\}/);
  assert.match(src, /value=\{matchId\}\s*disabled=\{isSaving\}/);
  assert.match(src, /value=\{comment\}\s*disabled=\{isSaving\}/);
  assert.match(src, /type="checkbox"\s*disabled=\{isSaving\}/);
});
