import test from "node:test";
import assert from "node:assert/strict";
import { runBulkOperations } from "../lib/bulk-operations.ts";

test("runBulkOperations counts rejected writes as failures, never successes", async () => {
  const items = ["p1", "p2", "p3"];
  const res = await runBulkOperations(items, async () => {
    throw new Error("permission-denied");
  });

  assert.equal(res.succeeded.length, 0);
  assert.equal(res.failed.length, 3);
  assert.deepEqual(
    res.failed.map((f) => f.item),
    ["p1", "p2", "p3"],
  );
});

test("runBulkOperations accurately reports partial success and failure", async () => {
  const items = ["p1", "p2", "p3", "p4"];
  const res = await runBulkOperations(items, async (id) => {
    if (id === "p2" || id === "p4") {
      throw new Error(`write failed for ${id}`);
    }
  });

  assert.deepEqual(res.succeeded, ["p1", "p3"]);
  assert.deepEqual(
    res.failed.map((f) => f.item),
    ["p2", "p4"],
  );
});
