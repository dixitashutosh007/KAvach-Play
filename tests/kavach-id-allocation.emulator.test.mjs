/**
 * ROSTER-R5: Atomic Official Player ID (KAvach ID) allocation — Firestore Emulator tests.
 * Run: npm run test:emulator -- tests/kavach-id-allocation.emulator.test.mjs
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const skip = !emulatorHost && "FIRESTORE_EMULATOR_HOST not set (run via npm run test:emulator)";

describe("ROSTER-R5: Atomic Official Player ID allocation — Emulator", { skip }, () => {
  let db;
  let allocateNextKavachId;
  let route;
  const saved = {};

  before(async () => {
    Object.assign(process.env, { NODE_ENV: "test", KAVACH_TEST_AUTH_BYPASS: "true" });
    const { initializeApp, getApps } = await import("firebase-admin/app");
    const { getFirestore } = await import("firebase-admin/firestore");
    const app = getApps().length
      ? getApps()[0]
      : initializeApp({ projectId: "kavach-roster-id-test" });
    db = getFirestore(app);
    (await import("../lib/server-db.ts")).setServerDbForTesting(db);
    ({ allocateNextKavachId } = await import("../lib/kavach-id.ts"));
    route = await import("../app/api/admin/allocate-kavach-id/route.ts");
    for (const l of ["log", "info", "warn", "error"]) {
      saved[l] = console[l];
      console[l] = () => {};
    }
  });

  after(() => Object.assign(console, saved));

  async function clearState() {
    for (const col of ["players", "kavachIdReservations"]) {
      const snap = await db.collection(col).get();
      if (!snap.empty) {
        const batch = db.batch();
        snap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
    }
    await db.collection("appConfig").doc("kavachIdCounters").delete().catch(() => {});
  }

  async function callPost({ actor = "admin_1", roles = "clubAdmin", body = {} } = {}) {
    const res = await route.POST(
      new Request("http://localhost/api/admin/allocate-kavach-id", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-test-uid": actor,
          "x-test-roles": roles,
        },
        body: JSON.stringify(body),
      }),
    );
    return { status: res.status, json: await res.json().catch(() => ({})) };
  }

  it("preserves existing player IDs without renumbering and allocates next sequential ID", async () => {
    await clearState();
    await db.collection("players").doc("p_existing_1").set({ name: "Existing One", kavachId: "K2026003" });
    await db.collection("players").doc("p_existing_2").set({ name: "Existing Two", kavachId: "K2026007" });

    const r1 = await allocateNextKavachId(db, { year: 2026 });
    assert.equal(r1.kavachId, "K2026008");
    assert.equal(r1.alreadyAssigned, false);

    // Existing players remain untouched
    assert.equal((await db.collection("players").doc("p_existing_1").get()).data().kavachId, "K2026003");
    assert.equal((await db.collection("players").doc("p_existing_2").get()).data().kavachId, "K2026007");
  });

  it("allocates 5 distinct sequential IDs under simultaneous concurrent calls", async () => {
    await clearState();

    const results = await Promise.all([
      callPost({ body: { year: 2026 } }),
      callPost({ body: { year: 2026 } }),
      callPost({ body: { year: 2026 } }),
      callPost({ body: { year: 2026 } }),
      callPost({ body: { year: 2026 } }),
    ]);

    for (const r of results) {
      assert.equal(r.status, 200);
      assert.equal(r.json.alreadyAssigned, false);
    }

    const ids = results.map((r) => r.json.kavachId).sort();
    assert.deepEqual(ids, ["K2026001", "K2026002", "K2026003", "K2026004", "K2026005"]);
  });

  it("does not overwrite an existing player's kavachId when playerId is passed", async () => {
    await clearState();
    await db.collection("players").doc("p_keep").set({ name: "Keep Me", kavachId: "K2025042" });

    const res = await callPost({ body: { year: 2026, playerId: "p_keep" } });
    assert.equal(res.status, 200);
    assert.equal(res.json.kavachId, "K2025042");
    assert.equal(res.json.alreadyAssigned, true);
  });

  it("rejects non-ClubAdmin callers with 403", async () => {
    const res = await callPost({ actor: "player_1", roles: "player", body: { year: 2026 } });
    assert.equal(res.status, 403);
  });
});
