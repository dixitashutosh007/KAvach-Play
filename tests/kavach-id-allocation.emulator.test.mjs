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

  it("existing player without KAvach ID receives one atomically and preserves historical IDs", async () => {
    await clearState();
    await db.collection("players").doc("p_existing_1").set({ name: "Existing One", kavachId: "K2026003" });
    await db.collection("players").doc("p_existing_2").set({ name: "Existing Two", kavachId: "K2026007" });
    await db.collection("players").doc("p_pending").set({ name: "Pending Player", inviteStatus: "Pending" });

    const res = await callPost({ body: { year: 2026, playerId: "p_pending" } });
    assert.equal(res.status, 200);
    assert.equal(res.json.kavachId, "K2026008");
    assert.equal(res.json.alreadyAssigned, false);

    // Persisted on the player doc inside the same transaction
    const pSnap = await db.collection("players").doc("p_pending").get();
    assert.equal(pSnap.data().kavachId, "K2026008");

    // Historical players remain untouched
    assert.equal((await db.collection("players").doc("p_existing_1").get()).data().kavachId, "K2026003");
    assert.equal((await db.collection("players").doc("p_existing_2").get()).data().kavachId, "K2026007");
  });

  it("existing player with KAvach ID retains the same ID and repeated requests are idempotent", async () => {
    await clearState();
    await db.collection("players").doc("p_keep").set({ name: "Keep Me", kavachId: "K2025042" });

    const r1 = await callPost({ body: { year: 2026, playerId: "p_keep" } });
    const r2 = await callPost({ body: { year: 2026, playerId: "p_keep" } });
    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);
    assert.equal(r1.json.kavachId, "K2025042");
    assert.equal(r2.json.kavachId, "K2025042");
    assert.equal(r1.json.alreadyAssigned, true);
    assert.equal(r2.json.alreadyAssigned, true);

    const reservations = await db.collection("kavachIdReservations").get();
    assert.equal(reservations.size, 0);
  });

  it("5 concurrent requests for the same player result in exactly one assigned ID and one reservation", async () => {
    await clearState();
    await db.collection("players").doc("p_race").set({ name: "Race Player", inviteStatus: "Pending" });

    const results = await Promise.all([
      callPost({ body: { year: 2026, playerId: "p_race" } }),
      callPost({ body: { year: 2026, playerId: "p_race" } }),
      callPost({ body: { year: 2026, playerId: "p_race" } }),
      callPost({ body: { year: 2026, playerId: "p_race" } }),
      callPost({ body: { year: 2026, playerId: "p_race" } }),
    ]);

    for (const r of results) {
      assert.equal(r.status, 200);
      assert.equal(r.json.kavachId, "K2026001");
    }
    const freshCount = results.filter((r) => r.json.alreadyAssigned === false).length;
    const reuseCount = results.filter((r) => r.json.alreadyAssigned === true).length;
    assert.equal(freshCount, 1);
    assert.equal(reuseCount, 4);

    // Exactly one reservation and counter == 1 (no wasted IDs)
    const reservations = await db.collection("kavachIdReservations").get();
    assert.equal(reservations.size, 1);
    const counterSnap = await db.collection("appConfig").doc("kavachIdCounters").get();
    assert.equal(counterSnap.data()["2026"], 1);
    const pSnap = await db.collection("players").doc("p_race").get();
    assert.equal(pSnap.data().kavachId, "K2026001");
  });

  it("concurrent requests for different players receive unique sequential IDs", async () => {
    await clearState();
    await db.collection("players").doc("pa").set({ name: "Player A" });
    await db.collection("players").doc("pb").set({ name: "Player B" });
    await db.collection("players").doc("pc").set({ name: "Player C" });

    const results = await Promise.all([
      callPost({ body: { year: 2026, playerId: "pa" } }),
      callPost({ body: { year: 2026, playerId: "pb" } }),
      callPost({ body: { year: 2026, playerId: "pc" } }),
    ]);

    for (const r of results) {
      assert.equal(r.status, 200);
      assert.equal(r.json.alreadyAssigned, false);
    }
    const ids = results.map((r) => r.json.kavachId).sort();
    assert.deepEqual(ids, ["K2026001", "K2026002", "K2026003"]);

    const persisted = await Promise.all(["pa", "pb", "pc"].map((id) => db.collection("players").doc(id).get()));
    assert.deepEqual(persisted.map((s) => s.data().kavachId).sort(), ["K2026001", "K2026002", "K2026003"]);
  });

  it("rejects unauthorized actors with 403 and allows Super Admin", async () => {
    await clearState();
    const playerRes = await callPost({ actor: "player_1", roles: "player", body: { year: 2026 } });
    assert.equal(playerRes.status, 403);

    const financeRes = await callPost({ actor: "fin_1", roles: "financeAdmin", body: { year: 2026 } });
    assert.equal(financeRes.status, 403);

    const superRes = await callPost({ actor: "super_1", roles: "superAdmin", body: { year: 2026 } });
    assert.equal(superRes.status, 200);
  });

  it("rejects invalid or nonexistent playerIds and surfaces allocation failures", async () => {
    await clearState();

    const emptyRes = await callPost({ body: { year: 2026, playerId: "" } });
    assert.equal(emptyRes.status, 400);

    const badCharRes = await callPost({ body: { year: 2026, playerId: "bad/id" } });
    assert.equal(badCharRes.status, 400);

    const nonStringRes = await callPost({ body: { year: 2026, playerId: 12345 } });
    assert.equal(nonStringRes.status, 400);

    const missingRes = await callPost({ body: { year: 2026, playerId: "does_not_exist" } });
    assert.equal(missingRes.status, 404);

    // Simulate exhausted reservation attempts -> allocation failure surfaced as 500
    await db.collection("appConfig").doc("kavachIdCounters").set({ "2026": 0 });
    const batch = db.batch();
    for (let i = 1; i <= 50; i++) {
      const id = `K2026${String(i).padStart(3, "0")}`;
      batch.set(db.collection("kavachIdReservations").doc(id), { kavachId: id });
    }
    await batch.commit();
    await db.collection("players").doc("p_fail").set({ name: "Fail Player", inviteStatus: "Pending" });

    const failRes = await callPost({ body: { year: 2026, playerId: "p_fail" } });
    assert.equal(failRes.status, 500);
    assert.match(failRes.json.error || "", /Could not allocate/);
    // Player remains without kavachId
    const pFail = await db.collection("players").doc("p_fail").get();
    assert.equal(pFail.data().kavachId, undefined);
  });
});
