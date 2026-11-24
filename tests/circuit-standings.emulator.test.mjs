/**
 * Circuit Standings (`tests/circuit-standings.emulator.test.mjs`).
 *
 * Production code exercised against the Firestore emulator:
 *   - app/api/admin/circuit-standings/route.ts  (CRUD, roles, validation, audit)
 *   - firestore.rules circuitStandings          (signed-in read; no client writes)
 * Caller identity via the KAVACH_TEST_AUTH_BYPASS headers (x-test-uid / x-test-roles).
 *
 * Run: node scripts/run-emulator-tests.mjs tests/circuit-standings.emulator.test.mjs
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const skip =
  (!emulatorHost && "FIRESTORE_EMULATOR_HOST not set (run via scripts/run-emulator-tests.mjs)") ||
  (process.env.KAVACH_TEST_AUTH_BYPASS !== "true" && "KAVACH_TEST_AUTH_BYPASS not set");

const CLUB = { uid: "u_club", roles: "clubAdmin" };
const SUPER = { uid: "u_super", roles: "superAdmin" };
const FIN = { uid: "u_fin", roles: "financeAdmin" };
const PLAYER = { uid: "u_player" };
const LEGACY = { uid: "u_legacy", roles: "matchAdmin" };

describe("Circuit Standings — server API", { skip }, () => {
  let db;
  let route;
  const saved = {};

  before(async () => {
    Object.assign(process.env, {
      NODE_ENV: "test",
      AWS_BRANCH: "main",
      NEXT_PUBLIC_FIRESTORE_DATABASE_ID: "ai-studio-cae01507-23c3-4ee4-92c8-848c4cf7d412",
    });
    const { initializeApp, getApps } = await import("firebase-admin/app");
    const { getFirestore } = await import("firebase-admin/firestore");
    const app = getApps().length ? getApps()[0] : initializeApp({ projectId: "kavach-circuit-test" });
    db = getFirestore(app);
    (await import("../lib/server-db.ts")).setServerDbForTesting(db);
    route = await import("../app/api/admin/circuit-standings/route.ts");
    for (const l of ["log", "info", "warn", "error"]) {
      saved[l] = console[l];
      console[l] = () => {};
    }
    await db.doc("players/p_arun").set({ name: "Arun", authUid: "u_arun" });
    await db.doc("players/p_bala").set({ name: "Bala", authUid: "u_bala" });
    await db.doc("players/p_off").set({ name: "Gone", disabled: true });
    await db.doc("players/p_merged").set({ name: "Old", mergedInto: "p_arun" });
  });
  after(() => Object.assign(console, saved));

  const call = async (method, body, who = CLUB) => {
    const headers = { "content-type": "application/json" };
    if (who) {
      headers["x-test-uid"] = who.uid;
      if (who.roles) headers["x-test-roles"] = who.roles;
    }
    const res = await route[method](new Request("http://localhost/api/admin/circuit-standings", { method, headers, body: typeof body === "string" ? body : JSON.stringify(body) }));
    return { status: res.status, json: await res.json() };
  };
  const rec = (over = {}) => ({ circuit: "india-wins", playerId: "p_arun", rank: 1, value: 42, asOf: "2026-11-20", ...over });
  const get = async (id) => {
    const s = await db.doc(`circuitStandings/${id}`).get();
    return s.exists ? s.data() : null;
  };
  const count = async () => (await db.collection("circuitStandings").count().get()).data().count;
  const audits = async (entityId) => (await db.collection("auditLogs").where("entity", "==", "circuit_standing").where("entityId", "==", entityId).get()).docs.map((d) => d.data());

  it("CS-01 unauthenticated 401; player, Finance Admin and retired Match Admin get 403 on every method; nothing written", async () => {
    for (const m of ["POST", "PUT", "DELETE"]) {
      const body = m === "DELETE" ? { id: "india-wins__p_arun" } : m === "PUT" ? { id: "india-wins__p_arun", ...rec() } : rec();
      assert.equal((await call(m, body, null)).status, 401, m);
      for (const who of [PLAYER, FIN, LEGACY]) assert.equal((await call(m, body, who)).status, 403, `${m} ${JSON.stringify(who)}`);
    }
    assert.equal(await count(), 0);
  });

  it("CS-02 Club Admin creates a standing; server snapshots the player's name and audits it", async () => {
    const r = await call("POST", rec());
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.equal(r.json.id, "india-wins__p_arun");
    const d = await get("india-wins__p_arun");
    assert.equal(d.playerName, "Arun");
    assert.deepEqual({ circuit: d.circuit, playerId: d.playerId, rank: d.rank, value: d.value, asOf: d.asOf }, rec());
    assert.equal(d.updatedBy, "u_club");
    const a = await audits("india-wins__p_arun");
    assert.equal(a.length, 1);
    assert.equal(a[0].action, "created");
    assert.equal(a[0].actorId, "u_club");
  });

  it("CS-03 one record per (circuit, player): a second create is 409; the same player in another circuit is fine", async () => {
    const r = await call("POST", rec({ rank: 3 }));
    assert.equal(r.status, 409);
    assert.equal((await get("india-wins__p_arun")).rank, 1);
    assert.equal((await call("POST", rec({ circuit: "india-played", value: 120 }), SUPER)).status, 201);
  });

  it("CS-04 validation: bad fields, unknown/forged fields, future dates, missing/inactive/merged players are rejected", async () => {
    const before = await count();
    const cases = [
      rec({ circuit: "delhi-wins" }),
      rec({ rank: 0 }),
      rec({ value: -2 }),
      rec({ value: "350+" }),
      rec({ asOf: "2999-01-01" }),
      rec({ asOf: "2026-02-30" }),
      { ...rec(), playerName: "Forged Name" },
      { ...rec(), updatedBy: "someone" },
    ];
    for (const c of cases) assert.equal((await call("POST", c)).status, 400, JSON.stringify(c));
    assert.equal((await call("POST", "{not json")).status, 400);
    for (const playerId of ["p_missing", "p_off", "p_merged"]) {
      const r = await call("POST", rec({ circuit: "bangalore-wins", playerId }));
      assert.equal(r.status, 400, playerId);
    }
    assert.equal(await count(), before);
  });

  it("CS-05 edit: rank/value/date change in place and is audited with old → new values; unchanged edit is a no-op", async () => {
    const r = await call("PUT", { id: "india-wins__p_arun", ...rec({ rank: 2, value: 45 }) });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.changed, true);
    const d = await get("india-wins__p_arun");
    assert.equal(d.rank, 2);
    assert.equal(d.value, 45);
    const a = (await audits("india-wins__p_arun")).find((x) => x.action === "updated");
    assert.deepEqual(
      a.changes.map((c) => [c.field, c.oldValue, c.newValue]),
      [
        ["rank", "1", "2"],
        ["value", "42", "45"],
      ],
    );
    const again = await call("PUT", { id: "india-wins__p_arun", ...rec({ rank: 2, value: 45 }) }, SUPER);
    assert.equal(again.json.changed, false);
  });

  it("CS-06 edit that changes the player moves the record; moving onto an existing (circuit, player) is 409", async () => {
    const r = await call("PUT", { id: "india-wins__p_arun", ...rec({ playerId: "p_bala", rank: 2, value: 45 }) });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.id, "india-wins__p_bala");
    assert.equal(await get("india-wins__p_arun"), null);
    assert.equal((await get("india-wins__p_bala")).playerName, "Bala");
    // india-played__p_arun exists (CS-03): moving Bala's record onto it is refused, nothing changes.
    const clash = await call("PUT", { id: "india-wins__p_bala", ...rec({ circuit: "india-played", playerId: "p_arun", value: 1 }) });
    assert.equal(clash.status, 409);
    assert.ok(await get("india-wins__p_bala"));
    assert.equal((await get("india-played__p_arun")).value, 120);
    assert.equal((await call("PUT", { id: "india-wins__nobody", ...rec() })).status, 404);
    assert.equal((await call("PUT", { id: "../players/p_arun", ...rec() })).status, 400);
  });

  it("CS-07 delete: Club/Super only, audited, 404 when already gone; the player record is untouched", async () => {
    assert.equal((await call("DELETE", { id: "india-wins__p_bala" }, FIN)).status, 403);
    assert.ok(await get("india-wins__p_bala"));
    const r = await call("DELETE", { id: "india-wins__p_bala" }, SUPER);
    assert.equal(r.status, 200);
    assert.equal(await get("india-wins__p_bala"), null);
    assert.equal((await call("DELETE", { id: "india-wins__p_bala" })).status, 404);
    assert.equal((await call("DELETE", { id: "india-played__p_arun", extra: 1 })).status, 400);
    const a = (await audits("india-wins__p_bala")).find((x) => x.action === "deleted");
    assert.equal(a.actorId, "u_super");
    assert.equal((await db.doc("players/p_bala").get()).data().name, "Bala");
  });
});

describe("Circuit Standings — Firestore rules", { skip }, () => {
  let testEnv;
  let rut;
  before(async () => {
    rut = await import("@firebase/rules-unit-testing");
    const [host, port] = emulatorHost.split(":");
    testEnv = await rut.initializeTestEnvironment({
      projectId: "kavach-circuit-rules",
      firestore: { host, port: Number(port), rules: fs.readFileSync("firestore.rules", "utf8") },
    });
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const { doc, setDoc } = await import("firebase/firestore");
      const d = ctx.firestore();
      await setDoc(doc(d, "appUsers/p_uid"), { name: "P", playerId: "p1", role: "player" });
      await setDoc(doc(d, "appUsers/fin_uid"), { name: "Fin", role: "player", isFinanceAdmin: true });
      await setDoc(doc(d, "appUsers/club_uid"), { name: "Club", role: "player", isClubAdmin: true });
      await setDoc(doc(d, "circuitStandings/india-wins__p1"), { circuit: "india-wins", playerId: "p1", playerName: "P", rank: 1, value: 10, asOf: "2026-11-01" });
    });
  });
  after(async () => {
    if (testEnv) await testEnv.cleanup();
  });

  it("CS-R1 signed-in members (player and admins) can read; unauthenticated cannot", async () => {
    const { doc, getDoc, collection, getDocs } = await import("firebase/firestore");
    for (const [uid, claims] of [["p_uid"], ["fin_uid"], ["club_uid"], ["super_uid", { admin: true }]]) {
      const d = testEnv.authenticatedContext(uid, claims).firestore();
      await rut.assertSucceeds(getDoc(doc(d, "circuitStandings/india-wins__p1")));
      await rut.assertSucceeds(getDocs(collection(d, "circuitStandings")));
    }
    await rut.assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), "circuitStandings/india-wins__p1")));
  });

  it("CS-R2 no client can create, edit or delete standings directly — not even Club or Super Admin", async () => {
    const { doc, setDoc, updateDoc, deleteDoc } = await import("firebase/firestore");
    for (const [uid, claims] of [["p_uid"], ["fin_uid"], ["club_uid"], ["super_uid", { admin: true }]]) {
      const d = testEnv.authenticatedContext(uid, claims).firestore();
      await rut.assertFails(setDoc(doc(d, "circuitStandings/india-played__p1"), { circuit: "india-played", playerId: "p1", playerName: "P", rank: 1, value: 5, asOf: "2026-11-01" }));
      await rut.assertFails(updateDoc(doc(d, "circuitStandings/india-wins__p1"), { rank: 9 }));
      await rut.assertFails(deleteDoc(doc(d, "circuitStandings/india-wins__p1")));
    }
  });
});
