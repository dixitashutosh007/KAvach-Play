import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { setServerDbForTesting } from "../lib/server-db.ts";
import { GET as getPublicPlayers } from "../app/api/players/public/route.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rulesContent = fs.readFileSync(path.resolve(__dirname, "../firestore.rules"), "utf8");
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;

describe(
  "Phase 2: DEF-R3-003 Player PII scoping, isSelf tightening & auditLogs append-only",
  { skip: !emulatorHost && "FIRESTORE_EMULATOR_HOST not set (requires local emulator runner)" },
  () => {
    let testEnv;
    let rut;
    let adminDb;
    const prevEnv = {};

    before(async () => {
      if (!emulatorHost) return;
      prevEnv.NODE_ENV = process.env.NODE_ENV;
      prevEnv.KAVACH_TEST_AUTH_BYPASS = process.env.KAVACH_TEST_AUTH_BYPASS;
      process.env.NODE_ENV = "test";
      process.env.KAVACH_TEST_AUTH_BYPASS = "true";

      rut = await import("@firebase/rules-unit-testing");
      testEnv = await rut.initializeTestEnvironment({
        projectId: "kavach-phase2-rules-test",
        firestore: {
          host: emulatorHost.split(":")[0],
          port: parseInt(emulatorHost.split(":")[1], 10),
          rules: rulesContent,
        },
      });
      const app = getApps().length ? getApps()[0] : initializeApp({ projectId: "demo-kavach-play" });
      adminDb = getFirestore(app);
      setServerDbForTesting(adminDb);
    });

    after(async () => {
      setServerDbForTesting(null);
      process.env.NODE_ENV = prevEnv.NODE_ENV;
      process.env.KAVACH_TEST_AUTH_BYPASS = prevEnv.KAVACH_TEST_AUTH_BYPASS;
      if (testEnv) await testEnv.cleanup();
    });

    beforeEach(async () => {
      if (!testEnv) return;
      await testEnv.clearFirestore();
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const db = ctx.firestore();
        await db.doc("appUsers/uid_p1").set({ name: "P1", role: "player", playerId: "p1", status: "Active" });
        await db.doc("appUsers/uid_club").set({ name: "Club", role: "player", isClubAdmin: true, status: "Active" });
        await db.doc("appUsers/uid_fin").set({ name: "Fin", role: "player", isFinanceAdmin: true, status: "Active" });
        await db.doc("players/p1").set({
          id: "p1",
          name: "Player One",
          authUid: "uid_p1",
          mobile: "+919876543210",
          email: "p1@example.com",
          bloodGroup: "O+",
          inviteStatus: "Accepted",
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        await db.doc("players/p2").set({
          id: "p2",
          name: "Player Two",
          authUid: "uid_p2",
          mobile: "+919876543211",
          email: "p2@example.com",
          dob: "1995-01-01",
          bloodGroup: "A+",
          emergencyContact: "9999999999",
          inviteStatus: "Verified",
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        // Unclaimed doc whose id matches uid_p1 (tests legacy isSelf fallback)
        await db.doc("players/uid_p1").set({
          id: "uid_p1",
          name: "Legacy Collision",
          mobile: "+919800000000",
          inviteStatus: "Accepted",
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        await db.doc("auditLogs/log_1").set({ action: "updated", entity: "access", createdAt: new Date() });
      });
    });

    const p1 = () => testEnv.authenticatedContext("uid_p1").firestore();
    const club = () => testEnv.authenticatedContext("uid_club").firestore();
    const fin = () => testEnv.authenticatedContext("uid_fin").firestore();
    const sup = () => testEnv.authenticatedContext("uid_super", { admin: true }).firestore();

    it("DEF-R3-003: Player can read own players/{id}, CANNOT read other players or list collection", async () => {
      await rut.assertSucceeds(p1().doc("players/p1").get());
      await rut.assertFails(p1().doc("players/p2").get());
      await rut.assertFails(p1().collection("players").get());
    });

    it("DEF-R3-003: Club Admin, Finance Admin, and Super Admin can read/list players", async () => {
      await rut.assertSucceeds(club().doc("players/p2").get());
      await rut.assertSucceeds(fin().doc("players/p2").get());
      await rut.assertSucceeds(sup().collection("players").get());
    });

    it("Workstream 2B: isSelf legacy fallback does NOT grant access when appUsers.playerId points elsewhere", async () => {
      await rut.assertFails(p1().doc("players/uid_p1").get());
    });

    it("Workstream 2B: New unlinked user can self-create players/{uid} during registration", async () => {
      const fresh = testEnv.authenticatedContext("uid_fresh").firestore();
      await rut.assertSucceeds(
        fresh.doc("players/uid_fresh").set({
          name: "Fresh Player",
          mobile: "+919811111111",
          inviteStatus: "Pending",
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      );
    });

    it("Workstream 2B: auditLogs is strictly append-only (Super Admin cannot delete)", async () => {
      await rut.assertFails(sup().doc("auditLogs/log_1").delete());
      await rut.assertFails(sup().doc("auditLogs/log_1").update({ action: "edited" }));
    });

    it("DEF-R3-003: GET /api/players/public requires auth and strips all PII fields", async () => {
      const unauth = await getPublicPlayers(new Request("https://play.kavachcricket.com/api/players/public"));
      assert.equal(unauth.status, 401);

      await adminDb.collection("players").doc("p_pub").set({
        id: "p_pub",
        name: "Public Player",
        kavachId: "KAV-01",
        mobile: "+919876543299",
        email: "secret@example.com",
        dob: "1990-05-05",
        bloodGroup: "B+",
        emergencyContact: "8888888888",
        locality: "Indiranagar",
        studioExpiryDate: "2026-12-31",
        inviteStatus: "Accepted",
      });
      await adminDb.collection("players").doc("p_pend").set({
        id: "p_pend",
        name: "Pending Player",
        inviteStatus: "Pending",
      });

      const res = await getPublicPlayers(
        new Request("https://play.kavachcricket.com/api/players/public", {
          headers: { "x-test-uid": "uid_p1", "x-test-player-id": "p1" },
        }),
      );
      assert.equal(res.status, 200);
      const data = await res.json();
      const pub = data.players.find((x) => x.id === "p_pub");
      assert.ok(pub);
      assert.equal(pub.name, "Public Player");
      assert.equal(pub.kavachId, "KAV-01");
      for (const pii of ["mobile", "email", "dob", "bloodGroup", "emergencyContact", "locality", "studioExpiryDate", "authUid"]) {
        assert.equal(pii in pub, false, `Public player must not expose ${pii}`);
      }
      assert.equal(data.players.some((x) => x.id === "p_pend"), false);
    });
  },
);
