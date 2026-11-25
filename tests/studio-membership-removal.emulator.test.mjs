/**
 * Studio Membership Removal & Alert Dismissal (`tests/studio-membership-removal.emulator.test.mjs`).
 *
 * Production code exercised against the Firestore emulator:
 *   - app/api/admin/studio-membership/remove/route.ts
 *   - lib/studio-membership-server.ts
 *   - firestore.rules appUsers/{uid} dismissedExpiredStudioAlerts update
 *
 * Run: node scripts/run-emulator-tests.mjs tests/studio-membership-removal.emulator.test.mjs
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

describe("Studio Membership Removal — server API & Firestore rules", { skip }, () => {
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
      : initializeApp({ projectId: "kavach-studio-remove-test" });
    db = getFirestore(app);
    (await import("../lib/server-db.ts")).setServerDbForTesting(db);
    route = await import("../app/api/admin/studio-membership/remove/route.ts");
    for (const l of ["log", "info", "warn", "error"]) {
      saved[l] = console[l];
      console[l] = () => {};
    }
  });

  after(() => {
    for (const [l, fn] of Object.entries(saved)) console[l] = fn;
  });

  function postRemove(body, caller) {
    const headers = { "content-type": "application/json" };
    if (caller?.uid) headers["x-test-uid"] = caller.uid;
    if (caller?.roles) headers["x-test-roles"] = caller.roles;
    return route.POST(
      new Request("http://localhost/api/admin/studio-membership/remove", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      }),
    );
  }

  it("rejects unauthorized roles (Finance Admin, Player, retired matchAdmin) with 403", async () => {
    for (const caller of [FIN, PLAYER, LEGACY]) {
      const res = await postRemove({ playerId: "p_any" }, caller);
      assert.equal(res.status, 403, `Expected 403 for ${caller.uid}`);
    }
  });

  it("returns 400 for missing playerId and 404 for unknown player", async () => {
    const badRes = await postRemove({ playerId: "" }, CLUB);
    assert.equal(badRes.status, 400);

    const missingRes = await postRemove({ playerId: "p_nonexistent" }, SUPER);
    assert.equal(missingRes.status, 404);
  });

  it("atomically revokes isStudioMember on player and all linked appUsers while preserving identity and history", async () => {
    await db.collection("players").doc("p_expired_1").set({
      id: "p_expired_1",
      name: "Rohan Sharma",
      mobile: "9999999999",
      kavachId: "KAV-2026-0042",
      authUid: "u_rohan_auth",
      isStudioMember: true,
      studioStartDate: "2026-01-01",
      studioEndDate: "2026-03-31",
      studioExpiryDate: "2026-03-31",
      studioPlan: "3M",
      lastPaidDate: "2026-01-01",
      lastPaidAmount: 3000,
    });
    await db.collection("appUsers").doc("u_rohan_auth").set({
      id: "u_rohan_auth",
      role: "player",
      playerId: "p_expired_1",
      isStudioMember: true,
      studioExpiryDate: "2026-03-31",
    });

    const res = await postRemove({ playerId: "p_expired_1" }, CLUB);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.ok, true);
    assert.equal(json.playerId, "p_expired_1");
    assert.deepEqual(json.updatedAppUserIds, ["u_rohan_auth"]);

    const playerDoc = (await db.collection("players").doc("p_expired_1").get()).data();
    assert.equal(playerDoc.isStudioMember, false);
    assert.equal(playerDoc.kavachId, "KAV-2026-0042");
    assert.equal(playerDoc.authUid, "u_rohan_auth");
    assert.equal(playerDoc.studioExpiryDate, "2026-03-31");
    assert.equal(playerDoc.lastPaidAmount, 3000);

    const appUserDoc = (await db.collection("appUsers").doc("u_rohan_auth").get()).data();
    assert.equal(appUserDoc.isStudioMember, false);
    assert.equal(appUserDoc.playerId, "p_expired_1");
    assert.equal(appUserDoc.role, "player");
  });

  it("allows an admin to persist dismissedExpiredStudioAlerts on their own appUsers doc via Firestore rules", async () => {
    const { initializeTestEnvironment, assertSucceeds, assertFails } = await import(
      "@firebase/rules-unit-testing"
    );
    const [host, port] = emulatorHost.split(":");
    const rules = fs.readFileSync("firestore.rules", "utf8");
    const env = await initializeTestEnvironment({
      projectId: "kavach-studio-remove-rules",
      firestore: { host, port: Number(port), rules },
    });

    try {
      await env.withSecurityRulesDisabled(async (ctx) => {
        const adminDb = ctx.firestore();
        await adminDb.collection("appUsers").doc("u_club_admin").set({
          role: "player",
          isClubAdmin: true,
          status: "Active",
        });
        await adminDb.collection("appUsers").doc("u_other_user").set({
          role: "player",
          status: "Active",
        });
      });

      const clubCtx = env.authenticatedContext("u_club_admin", { email: "club@kavach.test" });
      await assertSucceeds(
        clubCtx
          .firestore()
          .collection("appUsers")
          .doc("u_club_admin")
          .update({
            dismissedExpiredStudioAlerts: { p_expired_1: "2026-03-31" },
          }),
      );

      // Cannot escalate role or mutate playerId via the same update
      await assertFails(
        clubCtx
          .firestore()
          .collection("appUsers")
          .doc("u_club_admin")
          .update({
            dismissedExpiredStudioAlerts: { p_expired_1: "2026-03-31" },
            isSuperAdmin: true,
          }),
      );

      const playerCtx = env.authenticatedContext("u_other_user", { email: "p@kavach.test" });
      await assertFails(
        playerCtx
          .firestore()
          .collection("appUsers")
          .doc("u_club_admin")
          .update({
            dismissedExpiredStudioAlerts: { p_expired_1: "2026-03-31" },
          }),
      );
    } finally {
      await env.cleanup();
    }
  });
});
