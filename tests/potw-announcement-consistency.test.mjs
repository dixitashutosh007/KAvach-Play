import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { executeAnnouncementDelete, getPotwWeekendIdFromPost } from "../lib/weekend-ops.ts";

const root = process.cwd();

test("getPotwWeekendIdFromPost identifies POTW strictly by kind and potw.weekendId metadata", () => {
  assert.equal(
    getPotwWeekendIdFromPost({ kind: "potw", potw: { weekendId: "2026-11-21" } }),
    "2026-11-21",
  );
  // Never infer from title or text
  assert.equal(
    getPotwWeekendIdFromPost({ title: "Player of the Weekend", text: "Player of the Weekend 2026-11-21" }),
    null,
  );
  assert.equal(getPotwWeekendIdFromPost({ kind: "potw", potw: { weekendId: "invalid" } }), null);
  assert.equal(getPotwWeekendIdFromPost(null), null);
});

test("executeAnnouncementDelete routes POTW announcements to POTW API and never falls back to direct delete", async () => {
  let apiCalls = [];
  let directCalls = 0;

  const ok = await executeAnnouncementDelete({
    post: { id: "potw_2026-11-21", kind: "potw", potw: { weekendId: "2026-11-21" } },
    deleteViaPotwApi: async (wid) => {
      apiCalls.push(wid);
      return true;
    },
    deleteDirectDoc: async () => {
      directCalls++;
      return true;
    },
  });
  assert.equal(ok, true);
  assert.deepEqual(apiCalls, ["2026-11-21"]);
  assert.equal(directCalls, 0);

  // API failure -> returns false and does NOT fall back to direct deletion
  const failed = await executeAnnouncementDelete({
    post: { id: "potw_2026-11-21", kind: "potw", potw: { weekendId: "2026-11-21" } },
    deleteViaPotwApi: async () => false,
    deleteDirectDoc: async () => {
      directCalls++;
      return true;
    },
  });
  assert.equal(failed, false);
  assert.equal(directCalls, 0);
});

test("executeAnnouncementDelete deletes normal announcements via direct delete without calling POTW API", async () => {
  let apiCalls = 0;
  let directCalls = 0;

  const ok = await executeAnnouncementDelete({
    post: { id: "post-1", title: "Player of the Weekend", text: "Club notice", isAnnouncement: true },
    deleteViaPotwApi: async () => {
      apiCalls++;
      return true;
    },
    deleteDirectDoc: async () => {
      directCalls++;
      return true;
    },
  });

  assert.equal(ok, true);
  assert.equal(apiCalls, 0);
  assert.equal(directCalls, 1);
});

test("useStore routes deleteAnnouncement/deletePost via executeAnnouncementDelete and guards POTW metadata on updateAnnouncement", () => {
  const storeSrc = fs.readFileSync(path.join(root, "hooks/useStore.ts"), "utf8");
  assert.match(storeSrc, /executeAnnouncementDelete/);
  assert.match(storeSrc, /\/api\/admin\/player-of-weekend\?weekendId=/);
  assert.match(storeSrc, /if \(k === "kind" \|\| k === "potw"\) continue;/);
});
