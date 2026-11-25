/**
 * Club Admin Weekly Action Centre (`tests/action-centre.emulator.test.mjs`).
 *
 * Run: node scripts/run-emulator-tests.mjs tests/action-centre.emulator.test.mjs
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const skip =
  (!emulatorHost && "FIRESTORE_EMULATOR_HOST not set (run via scripts/run-emulator-tests.mjs)") ||
  (process.env.KAVACH_TEST_AUTH_BYPASS !== "true" && "KAVACH_TEST_AUTH_BYPASS not set");

const CLUB_A = { uid: "u_club_a", roles: "clubAdmin" };
const CLUB_B = { uid: "u_club_b", roles: "clubAdmin" };
const FIN = { uid: "u_fin", roles: "financeAdmin" };
const PLAYER = { uid: "u_player" };

describe("Club Admin Weekly Action Centre — server API", { skip }, () => {
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
    const app = getApps().length
      ? getApps()[0]
      : initializeApp({ projectId: "kavach-action-centre-test" });
    db = getFirestore(app);
    (await import("../lib/server-db.ts")).setServerDbForTesting(db);
    route = await import("../app/api/admin/action-centre/route.ts");
    for (const l of ["log", "info", "warn", "error"]) {
      saved[l] = console[l];
      console[l] = () => {};
    }
  });

  after(() => {
    for (const [l, fn] of Object.entries(saved)) console[l] = fn;
  });

  function callGet(caller) {
    const headers = {};
    if (caller?.uid) headers["x-test-uid"] = caller.uid;
    if (caller?.roles) headers["x-test-roles"] = caller.roles;
    return route.GET(
      new Request("http://localhost/api/admin/action-centre", { method: "GET", headers }),
    );
  }

  function callPost(body, caller) {
    const headers = { "content-type": "application/json" };
    if (caller?.uid) headers["x-test-uid"] = caller.uid;
    if (caller?.roles) headers["x-test-roles"] = caller.roles;
    return route.POST(
      new Request("http://localhost/api/admin/action-centre", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      }),
    );
  }

  it("rejects unauthorized roles (Finance Admin, Player) with 403", async () => {
    for (const caller of [FIN, PLAYER]) {
      assert.equal((await callGet(caller)).status, 403);
      assert.equal((await callPost({ action: "dismiss_popup", actionId: "add_squad", weekId: "2026-11-27" }, caller)).status, 403);
    }
  });

  it("persists per-admin popup dismissals independently and records match share initiation", async () => {
    await db.collection("appUsers").doc(CLUB_A.uid).set({ id: CLUB_A.uid, isClubAdmin: true });
    await db.collection("appUsers").doc(CLUB_B.uid).set({ id: CLUB_B.uid, isClubAdmin: true });
    await db.collection("matches").doc("m_ac_1").set({
      id: "m_ac_1",
      opponent: "Strikers",
      date: "2026-11-28",
      time: "09:00",
      format: "T20",
      result: "Pending",
    });

    // Admin A dismisses add_squad popup
    const disRes = await callPost(
      { action: "dismiss_popup", actionId: "add_squad", weekId: "2026-11-27" },
      CLUB_A,
    );
    assert.equal(disRes.status, 200);

    // Admin A sees dismissal; Admin B does not
    const getA = await (await callGet(CLUB_A)).json();
    const getB = await (await callGet(CLUB_B)).json();
    assert.equal(getA.dismissedPopups.add_squad, "2026-11-27");
    assert.equal(getB.dismissedPopups.add_squad, undefined);

    // Record share initiation
    const shareRes = await callPost({ action: "record_share", matchId: "m_ac_1" }, CLUB_A);
    assert.equal(shareRes.status, 200);
    const mDoc = (await db.collection("matches").doc("m_ac_1").get()).data();
    assert.equal(mDoc.squadShareInitiatedBy, CLUB_A.uid);
    assert.ok(mDoc.squadShareInitiatedAt);
  });
});
