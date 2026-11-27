import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { setServerDbForTesting } from "../lib/server-db.ts";
import { GET as getPublicPlayers } from "../app/api/players/public/route.ts";
import { _resetPublicPlayersRateLimitForTesting } from "../lib/club-feed.ts";
import { GET as getFinancePlayers } from "../app/api/finance/players/route.ts";
import { POST as postAuditLog } from "../app/api/audit/log/route.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rulesContent = fs.readFileSync(path.resolve(__dirname, "../firestore.rules"), "utf8");
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;

describe(
  "Phase 2 Closure: P2-AUD-01, P2-PII-01, P2-ID-02 & P2-API-01",
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
      _resetPublicPlayersRateLimitForTesting();
      await testEnv.clearFirestore();
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const db = ctx.firestore();
        await db.doc("appUsers/uid_p1").set({ name: "P1", role: "player", playerId: "p1", status: "Active" });
        await db.doc("appUsers/uid_club").set({ name: "Club Admin User", role: "player", isClubAdmin: true, status: "Active" });
        await db.doc("appUsers/uid_fin").set({ name: "Finance Admin User", role: "player", isFinanceAdmin: true, status: "Active" });
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
          locality: "Koramangala",
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

    // ── P2-PII-01: Finance Admin Restriction & Player Scoping ────────────────
    it("DEF-R3-003: Player can read own players/{id}, CANNOT read other players or list collection", async () => {
      await rut.assertSucceeds(p1().doc("players/p1").get());
      await rut.assertFails(p1().doc("players/p2").get());
      await rut.assertFails(p1().collection("players").get());
    });

    it("P2-PII-01: Finance Admin CANNOT read other players, list players, or create/update/delete players in Firestore", async () => {
      await rut.assertFails(fin().doc("players/p2").get());
      await rut.assertFails(fin().collection("players").get());
      await rut.assertFails(
        fin().doc("players/p_new_fin").set({
          name: "Unauthorized",
          mobile: "+919999999999",
          inviteStatus: "Accepted",
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      );
      await rut.assertFails(fin().doc("players/p2").update({ name: "Tampered by Fin" }));
      await rut.assertFails(fin().doc("players/p2").delete());
    });

    it("P2-PII-01: Club Admin and Super Admin retain full Firestore player management", async () => {
      await rut.assertSucceeds(club().doc("players/p2").get());
      await rut.assertSucceeds(sup().collection("players").get());
      await rut.assertSucceeds(
        club().doc("players/p_new_club").set({
          name: "Club Created",
          mobile: "+919888888888",
          inviteStatus: "Accepted",
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      );
      await rut.assertSucceeds(club().doc("players/p_new_club").update({ name: "Club Updated" }));
      await rut.assertSucceeds(club().doc("players/p_new_club").delete());
    });

    it("P2-PII-01: GET /api/finance/players is Finance/Super Admin only and strips unrelated PII", async () => {
      await adminDb.collection("players").doc("p_fin_test").set({
        id: "p_fin_test",
        name: "Finance Projection Player",
        kavachId: "KAV-99",
        isStudioMember: true,
        studioExpiryDate: "2026-12-31",
        mobile: "+919111111111",
        email: "private@example.com",
        dob: "1992-04-12",
        bloodGroup: "AB+",
        emergencyContact: "7777777777",
        locality: "Indiranagar",
        authUid: "uid_fin_test",
        inviteStatus: "Accepted",
      });

      const unauth = await getFinancePlayers(new Request("https://play.kavachcricket.com/api/finance/players"));
      assert.equal(unauth.status, 401);

      const asPlayer = await getFinancePlayers(
        new Request("https://play.kavachcricket.com/api/finance/players", {
          headers: { "x-test-uid": "uid_p1", "x-test-role": "player" },
        }),
      );
      assert.equal(asPlayer.status, 403);

      const asClub = await getFinancePlayers(
        new Request("https://play.kavachcricket.com/api/finance/players", {
          headers: { "x-test-uid": "uid_club", "x-test-role": "clubAdmin" },
        }),
      );
      assert.equal(asClub.status, 403);

      const asFin = await getFinancePlayers(
        new Request("https://play.kavachcricket.com/api/finance/players", {
          headers: { "x-test-uid": "uid_fin", "x-test-role": "financeAdmin" },
        }),
      );
      assert.equal(asFin.status, 200);
      const body = await asFin.json();
      const proj = body.players.find((x) => x.id === "p_fin_test");
      assert.ok(proj);
      assert.equal(proj.isStudioMember, true);
      assert.equal(proj.studioExpiryDate, "2026-12-31");
      for (const pii of ["mobile", "email", "dob", "bloodGroup", "emergencyContact", "locality", "authUid"]) {
        assert.equal(pii in proj, false, `Finance projection must not expose ${pii}`);
      }
    });

    // ── P2-ID-02: isSelf() Disabled Player & Identity Mapping Coverage ────────
    it("P2-ID-02: Disabled player cannot access own record via appUsers.playerId or authUid; disabled appUser blocked", async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const db = ctx.firestore();
        // 1. Active appUser linked to disabled player
        await db.doc("appUsers/uid_dis_pl").set({ name: "DisPl", role: "player", playerId: "p_disabled", status: "Active" });
        await db.doc("players/p_disabled").set({
          id: "p_disabled", name: "Disabled Player", authUid: "uid_dis_pl", disabled: true, inviteStatus: "Accepted",
        });
        // 2. Disabled appUser linked to active player
        await db.doc("appUsers/uid_dis_app").set({ name: "DisApp", role: "player", playerId: "p_active_for_dis", status: "Disabled" });
        await db.doc("players/p_active_for_dis").set({
          id: "p_active_for_dis", name: "Active Player", authUid: "uid_dis_app", disabled: false, inviteStatus: "Accepted",
        });
        // 3. Merged loser (disabled) + active keeper
        await db.doc("appUsers/uid_merged").set({ name: "Merged", role: "player", playerId: "p_keeper", status: "Active" });
        await db.doc("players/p_loser").set({
          id: "p_loser", name: "Loser", disabled: true, mergedInto: "p_keeper", inviteStatus: "Accepted",
        });
        await db.doc("players/p_keeper").set({
          id: "p_keeper", name: "Keeper", authUid: "uid_merged", disabled: false, inviteStatus: "Accepted",
        });
        // 4. Legacy unlinked player (both appUsers.playerId and players.authUid absent/null)
        await db.doc("appUsers/uid_legacy").set({ name: "Legacy", role: "player", playerId: null, status: "Active" });
        await db.doc("players/uid_legacy").set({
          id: "uid_legacy", name: "Legacy Player", authUid: null, inviteStatus: "Accepted",
        });
      });

      const disPlDb = testEnv.authenticatedContext("uid_dis_pl").firestore();
      await rut.assertFails(disPlDb.doc("players/p_disabled").get());

      const disAppDb = testEnv.authenticatedContext("uid_dis_app").firestore();
      await rut.assertFails(disAppDb.doc("players/p_active_for_dis").get());

      const mergedDb = testEnv.authenticatedContext("uid_merged").firestore();
      await rut.assertFails(mergedDb.doc("players/p_loser").get());
      await rut.assertSucceeds(mergedDb.doc("players/p_keeper").get());

      const legacyDb = testEnv.authenticatedContext("uid_legacy").firestore();
      await rut.assertSucceeds(legacyDb.doc("players/uid_legacy").get());

      // Conflicting appUsers.playerId blocks legacy fallback
      await rut.assertFails(p1().doc("players/uid_p1").get());

      // Account linking -> unlinking transition
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await ctx.firestore().doc("appUsers/uid_legacy").update({ playerId: "p2" });
      });
      await rut.assertFails(legacyDb.doc("players/uid_legacy").get());
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await ctx.firestore().doc("appUsers/uid_legacy").update({ playerId: null });
      });
      await rut.assertSucceeds(legacyDb.doc("players/uid_legacy").get());
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

    // ── P2-AUD-01: Audit Log Integrity ───────────────────────────────────────
    it("P2-AUD-01: Direct Firestore auditLogs create/update/delete denied for all clients", async () => {
      await rut.assertFails(p1().doc("auditLogs/forged_p1").set({ action: "created", entity: "player" }));
      await rut.assertFails(club().doc("auditLogs/forged_club").set({ action: "created", entity: "player" }));
      await rut.assertFails(fin().doc("auditLogs/forged_fin").set({ action: "created", entity: "payment" }));
      await rut.assertFails(sup().doc("auditLogs/forged_sup").set({ action: "created", entity: "settings" }));
      await rut.assertFails(sup().doc("auditLogs/log_1").delete());
      await rut.assertFails(sup().doc("auditLogs/log_1").update({ action: "edited" }));
    });

    it("P2-AUD-01: POST /api/audit/log enforces role, server actorId/timestamp, PII redaction, and fails closed on invalid input", async () => {
      await adminDb.collection("appUsers").doc("uid_club").set({
        name: "Verified Club Admin",
        role: "player",
        isClubAdmin: true,
        status: "Active",
      });

      // Player denied
      const playerRes = await postAuditLog(
        new Request("https://play.kavachcricket.com/api/audit/log", {
          method: "POST",
          headers: { "content-type": "application/json", "x-test-uid": "uid_p1", "x-test-role": "player" },
          body: JSON.stringify({ action: "created", entity: "player", entityId: "p1", summary: "Spoof" }),
        }),
      );
      assert.equal(playerRes.status, 403);

      // Invalid action rejected before writing
      const badRes = await postAuditLog(
        new Request("https://play.kavachcricket.com/api/audit/log", {
          method: "POST",
          headers: { "content-type": "application/json", "x-test-uid": "uid_club", "x-test-role": "clubAdmin" },
          body: JSON.stringify({ action: "forged_action", entity: "player", entityId: "p1", summary: "Bad" }),
        }),
      );
      assert.equal(badRes.status, 400);

      // Client-supplied actorId, actorName, actorType, timestamp are ignored; PII redacted
      const okRes = await postAuditLog(
        new Request("https://play.kavachcricket.com/api/audit/log", {
          method: "POST",
          headers: { "content-type": "application/json", "x-test-uid": "uid_club", "x-test-role": "clubAdmin" },
          body: JSON.stringify({
            actorId: "spoofed_super_admin",
            actorName: "Spoofed Name",
            actorType: "system",
            timestamp: "1999-01-01T00:00:00Z",
            action: "updated",
            entity: "player",
            entityId: "p1",
            entityLabel: "Player One",
            changes: [{ field: "mobile", oldValue: "9876543210", newValue: "9999999999" }],
            summary: "Updated player profile",
            idempotencyKey: "audit_test_p2_1",
          }),
        }),
      );
      assert.equal(okRes.status, 200);
      const saved = (await adminDb.collection("auditLogs").doc("audit_test_p2_1").get()).data();
      assert.equal(saved.actorId, "uid_club");
      assert.equal(saved.actorName, "Verified Club Admin");
      assert.equal(saved.actorType, "admin");
      assert.notEqual(saved.timestamp, "1999-01-01T00:00:00Z");
      assert.equal(saved.changes[0].oldValue, "[REDACTED]");
      assert.equal(saved.changes[0].newValue, "[REDACTED]");
    });

    it("P2-AUD-01: AuditLogTab UI removes obsolete Truncate Logs controls", () => {
      const ui = fs.readFileSync(path.resolve(__dirname, "../components/AuditLogTab.tsx"), "utf8");
      assert.equal(ui.includes("truncateAuditLogs"), false);
      assert.equal(ui.includes("Truncate Old Logs"), false);
    });

    // ── P2-API-01: Public Directory Pagination, Validation & Rate Limiting ────
    it("P2-API-01: GET /api/players/public validates params, paginates cleanly, strips PII, and rate-limits", async () => {
      const unauth = await getPublicPlayers(new Request("https://play.kavachcricket.com/api/players/public"));
      assert.equal(unauth.status, 401);

      for (const [id, name, runs, extra] of [
        ["p_a", "Alpha", 100, { mobile: "+919876543299", email: "a@example.com", dob: "1990-01-01" }],
        ["p_b", "Bravo", 300, { bloodGroup: "O+", emergencyContact: "8888888888" }],
        ["p_c", "Charlie", 200, { locality: "HSR" }],
        ["p_pend", "Pending Player", 999, { inviteStatus: "Pending" }],
        ["p_dis", "Disabled Player", 999, { disabled: true }],
      ]) {
        await adminDb.collection("players").doc(id).set({
          id,
          name,
          totalRuns: runs,
          inviteStatus: extra.inviteStatus || "Accepted",
          ...extra,
        });
      }

      // Invalid params rejected (400)
      for (const qs of ["?page=0", "?limit=201", "?sort=invalid", `?search=${"a".repeat(81)}`]) {
        const bad = await getPublicPlayers(
          new Request(`https://play.kavachcricket.com/api/players/public${qs}`, {
            headers: { "x-test-uid": "uid_p1", "x-test-player-id": "p1" },
          }),
        );
        assert.equal(bad.status, 400, qs);
      }

      // Valid paginated + sorted response
      const page1 = await getPublicPlayers(
        new Request("https://play.kavachcricket.com/api/players/public?page=1&limit=2&sort=runs_desc", {
          headers: { "x-test-uid": "uid_p1", "x-test-player-id": "p1" },
        }),
      );
      assert.equal(page1.status, 200);
      const d1 = await page1.json();
      assert.equal(d1.players.length, 2);
      assert.equal(d1.hasMore, true);
      assert.equal(d1.players[0].id, "p_b");
      assert.equal(d1.players.some((x) => x.id === "p_pend" || x.id === "p_dis"), false);
      for (const pii of ["mobile", "email", "dob", "bloodGroup", "emergencyContact", "locality", "authUid"]) {
        assert.equal(pii in d1.players[0], false);
      }

      // Rate limit triggers 429 after 60 requests
      _resetPublicPlayersRateLimitForTesting();
      let limitedStatus = 200;
      for (let i = 0; i < 61; i++) {
        const r = await getPublicPlayers(
          new Request("https://play.kavachcricket.com/api/players/public?limit=1", {
            headers: { "x-test-uid": "uid_rate_test", "x-test-player-id": "p1" },
          }),
        );
        limitedStatus = r.status;
      }
      assert.equal(limitedStatus, 429);
    });
  },
);
