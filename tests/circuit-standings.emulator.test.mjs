/**
 * Circuit Standings (`tests/circuit-standings.emulator.test.mjs`).
 * The club's own rank and total in each of the four circuits.
 *
 * Production code exercised against the Firestore emulator:
 *   - app/api/admin/circuit-standings/route.ts  (set / update / clear, roles, validation, audit)
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
  const get = async (c) => {
    const s = await db.doc(`circuitStandings/${c}`).get();
    return s.exists ? s.data() : null;
  };
  const count = async () => (await db.collection("circuitStandings").count().get()).data().count;
  const audits = async (c) => (await db.collection("auditLogs").where("entity", "==", "circuit_standing").where("entityId", "==", c).get()).docs.map((d) => d.data());

  it("CS-01 unauthenticated 401; player, Finance Admin and retired Match Admin get 403 on every method; nothing written", async () => {
    for (const [m, body] of [["PUT", { circuit: "india", rank: 20 }], ["DELETE", { circuit: "india" }]]) {
      assert.equal((await call(m, body, null)).status, 401, m);
      for (const who of [PLAYER, FIN, LEGACY]) assert.equal((await call(m, body, who)).status, 403, `${m} ${JSON.stringify(who)}`);
    }
    assert.equal(await count(), 0);
  });

  it("CS-02 Club Admin and Super Admin set Bangalore and India rankings; each is audited", async () => {
    const rows = [
      [CLUB, { circuit: "india", rank: 20 }],
      [SUPER, { circuit: "bangalore", rank: 4 }],
    ];
    for (const [who, body] of rows) {
      const r = await call("PUT", body, who);
      assert.equal(r.status, 200, JSON.stringify(r.json));
      assert.equal(r.json.changed, true);
      const d = await get(body.circuit);
      assert.deepEqual({ circuit: d.circuit, rank: d.rank, value: d.value }, { ...body, value: 0 });
      assert.equal(d.updatedBy, who.uid);
      const a = await audits(body.circuit);
      assert.equal(a.length, 1);
      assert.equal(a[0].action, "created");
    }
    assert.equal(await count(), 2);
  });

  it("CS-03 edit updates in place with old → new values audited; the same values are a no-op", async () => {
    const r = await call("PUT", { circuit: "india", rank: 18 });
    assert.equal(r.status, 200);
    assert.equal((await get("india")).rank, 18);
    const a = (await audits("india")).find((x) => x.action === "updated");
    assert.deepEqual(
      a.changes.map((c) => [c.field, c.oldValue, c.newValue]),
      [["rank", "20", "18"]],
    );
    assert.equal((await call("PUT", { circuit: "india", rank: 18 })).json.changed, false);
    assert.equal((await audits("india")).length, 2);
    assert.equal(await count(), 2);
  });

  it("CS-04 validation: bad numbers, unknown/legacy circuit, player or extra fields are rejected; nothing changes", async () => {
    const cases = [
      { circuit: "delhi", rank: 1 },
      { circuit: "india-wins", rank: 1 },
      { circuit: "india", rank: 0 },
      { circuit: "india", rank: 2, value: -1 },
      { circuit: "india", rank: 2, value: "500+" },
      { circuit: "india", rank: "20th" },
      { circuit: "india" },
      { circuit: "india", rank: 2, playerId: "p1" },
      { circuit: "india", rank: 2, updatedBy: "x" },
    ];
    for (const c of cases) assert.equal((await call("PUT", c)).status, 400, JSON.stringify(c));
    assert.equal((await call("PUT", "{not json")).status, 400);
    assert.equal((await call("DELETE", { circuit: "../players/x" })).status, 400);
    assert.equal((await call("DELETE", { circuit: "india", extra: 1 })).status, 400);
    assert.equal((await get("india")).rank, 18);
  });

  it("CS-05 clear: Finance denied; Club/Super clear it, audited; 404 when already cleared; others untouched", async () => {
    assert.equal((await call("DELETE", { circuit: "bangalore" }, FIN)).status, 403);
    assert.ok(await get("bangalore"));
    const r = await call("DELETE", { circuit: "bangalore" }, SUPER);
    assert.equal(r.status, 200);
    assert.equal(await get("bangalore"), null);
    assert.equal((await call("DELETE", { circuit: "bangalore" })).status, 404);
    const a = (await audits("bangalore")).find((x) => x.action === "deleted");
    assert.equal(a.actorId, "u_super");
    assert.equal(await count(), 1);
    // Setting it again re-creates it.
    assert.equal((await call("PUT", { circuit: "bangalore", rank: 4 })).status, 200);
    assert.equal(await count(), 2);
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
      await setDoc(doc(d, "circuitStandings/india-wins"), { circuit: "india-wins", rank: 20, value: 500 });
    });
  });
  after(async () => {
    if (testEnv) await testEnv.cleanup();
  });

  it("CS-R1 signed-in members (player and admins) can read; unauthenticated cannot", async () => {
    const { doc, getDoc, collection, getDocs } = await import("firebase/firestore");
    for (const [uid, claims] of [["p_uid"], ["fin_uid"], ["club_uid"], ["super_uid", { admin: true }]]) {
      const d = testEnv.authenticatedContext(uid, claims).firestore();
      await rut.assertSucceeds(getDoc(doc(d, "circuitStandings/india-wins")));
      await rut.assertSucceeds(getDocs(collection(d, "circuitStandings")));
    }
    await rut.assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), "circuitStandings/india-wins")));
  });

  it("CS-R2 no client can create, edit or delete standings directly — not even Club or Super Admin", async () => {
    const { doc, setDoc, updateDoc, deleteDoc } = await import("firebase/firestore");
    for (const [uid, claims] of [["p_uid"], ["fin_uid"], ["club_uid"], ["super_uid", { admin: true }]]) {
      const d = testEnv.authenticatedContext(uid, claims).firestore();
      await rut.assertFails(setDoc(doc(d, "circuitStandings/india-played"), { circuit: "india-played", rank: 1, value: 5 }));
      await rut.assertFails(updateDoc(doc(d, "circuitStandings/india-wins"), { rank: 1 }));
      await rut.assertFails(deleteDoc(doc(d, "circuitStandings/india-wins")));
    }
  });
});
