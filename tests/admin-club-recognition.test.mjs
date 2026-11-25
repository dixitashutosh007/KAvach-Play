import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { computeCorrectedCatchTotals, validateCatchInput } from "../lib/catch-validation.ts";
import { activePotwPost } from "../lib/weekend-ops.ts";

const root = process.cwd();

test("validateCatchInput validates player, type, count, and sanitizes comment", () => {
  const ok = validateCatchInput({
    playerId: "p-1",
    type: "stunning",
    count: "2",
    comment: "  One-handed slip catch  ",
  });
  assert.deepEqual(ok, {
    ok: true,
    value: { playerId: "p-1", type: "stunning", count: 2, matchId: undefined, comment: "One-handed slip catch" },
  });
  assert.equal(validateCatchInput({ playerId: "", type: "stunning", count: 1 }).ok, false);
  assert.equal(validateCatchInput({ playerId: "p-1", type: "invalid", count: 1 }).ok, false);
  assert.equal(validateCatchInput({ playerId: "p-1", type: "dropped", count: 0 }).ok, false);
  assert.equal(validateCatchInput({ playerId: "p-1", type: "dropped", count: 51 }).ok, false);
});

test("computeCorrectedCatchTotals keeps player totals consistent on create, edit, type-switch, and delete", () => {
  // Create 2 stunning catches
  const afterCreate = computeCorrectedCatchTotals({ stunningCatches: 3, droppedCatches: 1 }, null, {
    type: "stunning",
    count: 2,
  });
  assert.deepEqual(afterCreate, { stunningCatches: 5, droppedCatches: 1 });

  // Correct 2 stunning -> 1 dropped
  const afterEdit = computeCorrectedCatchTotals(
    afterCreate,
    { type: "stunning", count: 2 },
    { type: "dropped", count: 1 },
  );
  assert.deepEqual(afterEdit, { stunningCatches: 3, droppedCatches: 2 });

  // Delete 5 dropped (clamps at 0, never negative)
  const afterDelete = computeCorrectedCatchTotals(afterEdit, { type: "dropped", count: 5 }, null);
  assert.deepEqual(afterDelete, { stunningCatches: 3, droppedCatches: 0 });
});

test("POTW lifecycle: retraction clears active banner and falls back cleanly", () => {
  const toMs = (t) => (typeof t === "number" ? t : null);
  const now = Date.UTC(2026, 10, 25, 10, 0, 0);
  const older = { id: "potw_post_2026-11-14", kind: "potw", createdAt: now - 3 * 86400000, potw: { playerName: "A" } };
  const newer = { id: "potw_post_2026-11-21", kind: "potw", createdAt: now - 1 * 86400000, potw: { playerName: "B" } };

  // Newer award replaces older
  assert.equal(activePotwPost([older, newer], now, toMs)?.id, newer.id);
  // After retracting newer, valid older (< 7 days) is active
  assert.equal(activePotwPost([older], now, toMs)?.id, older.id);
  // After retracting all, null (no stale banner)
  assert.equal(activePotwPost([], now, toMs), null);
});

test("POTW and Catches API routes enforce D-22 RBAC, transactions, idempotency, and audit logs", () => {
  const potwSrc = fs.readFileSync(
    path.join(root, "app/api/admin/player-of-weekend/route.ts"),
    "utf8",
  );
  assert.match(potwSrc, /export async function GET\(req: Request\)/);
  assert.match(potwSrc, /export async function PATCH\(req: Request\)/);
  assert.match(potwSrc, /export async function DELETE\(req: Request\)/);
  assert.match(potwSrc, /tx\.delete\(badgeRef\)/);
  assert.match(potwSrc, /tx\.delete\(postRef\)/);
  assert.match(potwSrc, /tx\.delete\(notifRef\)/);
  assert.match(potwSrc, /action:\s*"updated"[\s\S]*?entity:\s*"badge"/);
  assert.match(potwSrc, /action:\s*"deleted"[\s\S]*?entity:\s*"badge"/);

  const catchesSrc = fs.readFileSync(path.join(root, "app/api/admin/catches/route.ts"), "utf8");
  assert.match(catchesSrc, /requireRole\(req,\s*\[\.\.\.POTW_AWARD_ROLES\]\)/);
  assert.match(catchesSrc, /idempotencyKey/);
  assert.match(catchesSrc, /db\.runTransaction/);
  assert.match(catchesSrc, /writeServerAudit\(/);
  assert.match(catchesSrc, /entity:\s*"catch"/);

  const clubTabSrc = fs.readFileSync(path.join(root, "components/ClubTab.tsx"), "utf8");
  assert.match(clubTabSrc, /show\("badges"\) && isClubAdmin[\s\S]*<ClubRecognitionAdmin store=\{store\} \/>/);
});
