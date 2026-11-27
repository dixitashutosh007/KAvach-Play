import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { setServerDbForTesting } from "../lib/server-db.ts";
import { GET as getPublicPlayers } from "../app/api/players/public/route.ts";
import { GET as getFinancePlayers } from "../app/api/finance/players/route.ts";
import { POST as postAuditLog } from "../app/api/audit/log/route.ts";
import { linkPlayerAccount } from "../lib/account-linking.ts";
import { linkGoogleLogin } from "../lib/google-linking.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rulesContent = fs.readFileSync(path.resolve(__dirname, "../firestore.rules"), "utf8");
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;

describe(
  "Phase 2 Final Closure: P2-AUD-01/02, P2-REG-01, P2-API-01/02/03, P2-PII-01 & P2-ID-02/03",
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
      const rateSnap = await adminDb.collection("rateLimits").get();
      if (!rateSnap.empty) {
        const b = adminDb.batch();
        rateSnap.docs.forEach((d) => b.delete(d.ref));
        await b.commit();
      }
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

    // ── P2-PII-01 & P2-API-03: Finance Admin Restriction & Bounded Projection ─
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

    it("P2-PII-01 & P2-API-03: GET /api/finance/players is Finance/Super Admin only, cursor-paginated, and strips PII", async () => {
      for (const [id, name] of [
        ["p_fin_1", "Fin One"],
        ["p_fin_2", "Fin Two"],
        ["p_fin_3", "Fin Three"],
      ]) {
        await adminDb.collection("players").doc(id).set({
          id,
          name,
          kavachId: `KAV-${id}`,
          isStudioMember: true,
          studioExpiryDate: "2026-12-31",
          mobile: "+919111111111",
          email: `${id}@example.com`,
          dob: "1992-04-12",
          bloodGroup: "AB+",
          emergencyContact: "7777777777",
          locality: "Indiranagar",
          authUid: `uid_${id}`,
          inviteStatus: "Accepted",
        });
      }

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

      const page1 = await getFinancePlayers(
        new Request("https://play.kavachcricket.com/api/finance/players?limit=2", {
          headers: { "x-test-uid": "uid_fin", "x-test-role": "financeAdmin" },
        }),
      );
      assert.equal(page1.status, 200);
      const b1 = await page1.json();
      assert.equal(b1.players.length, 2);
      assert.equal(b1.hasMore, true);
      assert.ok(b1.nextCursor);
      for (const pii of ["mobile", "email", "dob", "bloodGroup", "emergencyContact", "locality", "authUid"]) {
        assert.equal(pii in b1.players[0], false, `Finance projection must not expose ${pii}`);
      }

      const page2 = await getFinancePlayers(
        new Request(`https://play.kavachcricket.com/api/finance/players?limit=2&cursor=${encodeURIComponent(b1.nextCursor)}`, {
          headers: { "x-test-uid": "uid_fin", "x-test-role": "financeAdmin" },
        }),
      );
      assert.equal(page2.status, 200);
      const b2 = await page2.json();
      assert.equal(b2.players.length, 1);
      assert.equal(b2.hasMore, false);
    });

    // ── P2-ID-02 & P2-ID-03: isSelf() + Own-Player Listener Verification ─────
    it("P2-ID-02 & P2-ID-03: authUid listener and doc reads enforce active/disabled/legacy/linked/conflicting rules", async () => {
      const { collection, query, where, getDocs, doc, getDoc } = await import("firebase/firestore");

      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const db = ctx.firestore();
        await db.doc("appUsers/uid_dis_pl").set({ name: "DisPl", role: "player", playerId: "p_disabled", status: "Active" });
        await db.doc("players/p_disabled").set({
          id: "p_disabled", name: "Disabled Player", authUid: "uid_dis_pl", disabled: true, inviteStatus: "Accepted",
        });
        await db.doc("appUsers/uid_dis_app").set({ name: "DisApp", role: "player", playerId: "p_active_for_dis", status: "Disabled" });
        await db.doc("players/p_active_for_dis").set({
          id: "p_active_for_dis", name: "Active Player", authUid: "uid_dis_app", disabled: false, inviteStatus: "Accepted",
        });
        await db.doc("appUsers/uid_merged").set({ name: "Merged", role: "player", playerId: "p_keeper", status: "Active" });
        await db.doc("players/p_loser").set({
          id: "p_loser", name: "Loser", disabled: true, mergedInto: "p_keeper", inviteStatus: "Accepted",
        });
        await db.doc("players/p_keeper").set({
          id: "p_keeper", name: "Keeper", authUid: "uid_merged", disabled: false, inviteStatus: "Accepted",
        });
        await db.doc("appUsers/uid_legacy").set({ name: "Legacy", role: "player", playerId: null, status: "Active" });
        await db.doc("players/uid_legacy").set({
          id: "uid_legacy", name: "Legacy Player", authUid: null, inviteStatus: "Accepted",
        });
      });

      const authQuery = (db, uid) => getDocs(query(collection(db, "players"), where("authUid", "==", uid)));

      // 1. Active linked player: own doc get succeeds; collection list/authUid query denied for non-admins
      await rut.assertSucceeds(getDoc(doc(p1(), "players/p1")));
      await rut.assertFails(authQuery(p1(), "uid_p1"));

      // 2. Active appUser linked to disabled player: doc get & authUid query denied
      const disPlDb = testEnv.authenticatedContext("uid_dis_pl").firestore();
      await rut.assertFails(getDoc(doc(disPlDb, "players/p_disabled")));
      await rut.assertFails(authQuery(disPlDb, "uid_dis_pl"));

      // 3. Disabled appUser linked to active player: doc get & authUid query denied
      const disAppDb = testEnv.authenticatedContext("uid_dis_app").firestore();
      await rut.assertFails(getDoc(doc(disAppDb, "players/p_active_for_dis")));
      await rut.assertFails(authQuery(disAppDb, "uid_dis_app"));

      // 4. Missing player document: doc get denied
      const missingDb = testEnv.authenticatedContext("uid_missing").firestore();
      await rut.assertFails(getDoc(doc(missingDb, "players/uid_missing")));

      // 5. Merged loser denied, keeper allowed
      const mergedDb = testEnv.authenticatedContext("uid_merged").firestore();
      await rut.assertFails(getDoc(doc(mergedDb, "players/p_loser")));
      await rut.assertSucceeds(getDoc(doc(mergedDb, "players/p_keeper")));

      // 6. Legacy unlinked player: doc get allowed; conflicting appUsers.playerId blocks legacy fallback
      const legacyDb = testEnv.authenticatedContext("uid_legacy").firestore();
      await rut.assertSucceeds(getDoc(doc(legacyDb, "players/uid_legacy")));
      await rut.assertFails(getDoc(doc(p1(), "players/uid_p1")));

      // 7. Account linking -> unlinking transition
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await ctx.firestore().doc("appUsers/uid_legacy").update({ playerId: "p2" });
      });
      await rut.assertFails(getDoc(doc(legacyDb, "players/uid_legacy")));
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await ctx.firestore().doc("appUsers/uid_legacy").update({ playerId: null });
      });
      await rut.assertSucceeds(getDoc(doc(legacyDb, "players/uid_legacy")));
    });

    // ── P2-REG-01: Complete Registration Flow (appUsers + players batch) ─────
    it("P2-REG-01: RegistrationForm omits prohibited entitlement keys; batch create succeeds and isStudioMember write fails", async () => {
      const regSrc = fs.readFileSync(path.resolve(__dirname, "../components/onboarding/RegistrationForm.tsx"), "utf8");
      assert.equal(regSrc.includes("isStudioMember"), false);

      const { doc, writeBatch, serverTimestamp } = await import("firebase/firestore");
      const freshDb = testEnv.authenticatedContext("uid_fresh").firestore();

      // Valid RegistrationForm batch (appUsers + players without isStudioMember)
      const okBatch = writeBatch(freshDb);
      okBatch.set(doc(freshDb, "appUsers/uid_fresh"), {
        email: "fresh@example.com",
        name: "Fresh Player",
        photoURL: "",
        role: "player",
        mobile: "9811111111",
      });
      okBatch.set(doc(freshDb, "players/uid_fresh"), {
        name: "Fresh Player",
        email: "fresh@example.com",
        mobile: "9811111111",
        inviteStatus: "Pending",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await rut.assertSucceeds(okBatch.commit());

      // Client writing entitlement key isStudioMember: false must still fail
      const badDb = testEnv.authenticatedContext("uid_fresh_bad").firestore();
      const badBatch = writeBatch(badDb);
      badBatch.set(doc(badDb, "appUsers/uid_fresh_bad"), {
        name: "Bad Player",
        role: "player",
        isStudioMember: false,
      });
      badBatch.set(doc(badDb, "players/uid_fresh_bad"), {
        name: "Bad Player",
        inviteStatus: "Pending",
      });
      await rut.assertFails(badBatch.commit());
    });

    // ── P2-AUD-01 & P2-AUD-02: Audit Authenticity & Failure Handling ─────────
    it("P2-AUD-01: Direct Firestore auditLogs create/update/delete denied; /api/audit/log blocks authoritative entities", async () => {
      await rut.assertFails(p1().doc("auditLogs/forged_p1").set({ action: "created", entity: "player" }));
      await rut.assertFails(club().doc("auditLogs/forged_club").set({ action: "created", entity: "player" }));
      await rut.assertFails(fin().doc("auditLogs/forged_fin").set({ action: "created", entity: "payment" }));
      await rut.assertFails(sup().doc("auditLogs/forged_sup").set({ action: "created", entity: "settings" }));
      await rut.assertFails(sup().doc("auditLogs/log_1").delete());
      await rut.assertFails(sup().doc("auditLogs/log_1").update({ action: "edited" }));

      await adminDb.collection("appUsers").doc("uid_club").set({
        name: "Verified Club Admin",
        role: "player",
        isClubAdmin: true,
        status: "Active",
      });

      // Authoritative-only entities rejected via /api/audit/log
      for (const payload of [
        { action: "updated", entity: "user_role", entityId: "u1", summary: "Spoof role" },
        { action: "paid", entity: "payment", entityId: "pay1", summary: "Spoof pay" },
        { action: "deleted", entity: "player", entityId: "p1", summary: "Spoof delete" },
      ]) {
        const res = await postAuditLog(
          new Request("https://play.kavachcricket.com/api/audit/log", {
            method: "POST",
            headers: { "content-type": "application/json", "x-test-uid": "uid_club", "x-test-role": "clubAdmin" },
            body: JSON.stringify(payload),
          }),
        );
        assert.equal(res.status, 403);
      }

      // Allowed client activity is tagged source: "client_activity" with server actor/timestamp
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
            entity: "ground",
            entityId: "g1",
            entityLabel: "Ground 1",
            changes: [{ field: "mobile", oldValue: "9876543210", newValue: "9999999999" }],
            summary: "Updated ground details",
            idempotencyKey: "audit_test_p2_1",
          }),
        }),
      );
      assert.equal(okRes.status, 200);
      const saved = (await adminDb.collection("auditLogs").doc("audit_test_p2_1").get()).data();
      assert.equal(saved.actorId, "uid_club");
      assert.equal(saved.actorName, "Verified Club Admin");
      assert.equal(saved.source, "client_activity");
      assert.notEqual(saved.timestamp, "1999-01-01T00:00:00Z");
      assert.equal(saved.changes[0].oldValue, "[REDACTED]");
    });

    it("P2-AUD-01: Account linking and Google linking write server_authoritative auditLogs atomically", async () => {
      await adminDb.collection("players").doc("p_link_phone").set({
        id: "p_link_phone",
        name: "Phone Link Player",
        mobile: "9876500001",
        inviteStatus: "Accepted",
      });
      const phoneRes = await linkPlayerAccount(adminDb, {
        uid: "uid_phone_link",
        verifiedPhoneNumber: "+919876500001",
      });
      assert.equal(phoneRes.ok, true);
      const phoneAudit = (await adminDb.collection("auditLogs").doc("link_uid_phone_link_p_link_phone").get()).data();
      assert.equal(phoneAudit.source, "server_authoritative");
      assert.equal(phoneAudit.actorId, "uid_phone_link");
      assert.equal(phoneAudit.entity, "player");

      await adminDb.collection("players").doc("p_link_google").set({
        id: "p_link_google",
        name: "Google Link Player",
        email: "glink@example.com",
        inviteStatus: "Accepted",
      });
      const googleRes = await linkGoogleLogin(adminDb, {
        uid: "uid_google_link",
        email: "glink@example.com",
        emailVerified: true,
        signInProvider: "google.com",
      });
      assert.equal(googleRes.ok, true);
      const googleAudit = (await adminDb.collection("auditLogs").doc("glink_uid_google_link_p_link_google").get()).data();
      assert.equal(googleAudit.source, "server_authoritative");
      assert.equal(googleAudit.actorId, "uid_google_link");
    });

    it("P2-AUD-02: lib/auditLog.ts checks response.ok and does not silently treat errors as success", () => {
      const src = fs.readFileSync(path.resolve(__dirname, "../lib/auditLog.ts"), "utf8");
      assert.match(src, /if\s*\(!res\.ok\)/);
      assert.match(src, /export async function logAuditStrict/);
    });

    // ── P2-API-01 & P2-API-02: Cursor Pagination & Shared Rate Limiting ──────
    it("P2-API-01 & P2-API-02: GET /api/players/public uses cursor pagination, strips PII, and enforces shared Firestore rate limit", async () => {
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

      for (const qs of ["?limit=201", "?sort=invalid", "?cursor=nonexistent_doc", `?search=${"a".repeat(81)}`]) {
        const bad = await getPublicPlayers(
          new Request(`https://play.kavachcricket.com/api/players/public${qs}`, {
            headers: { "x-test-uid": "uid_p1", "x-test-player-id": "p1" },
          }),
        );
        assert.equal(bad.status, 400, qs);
      }

      const page1 = await getPublicPlayers(
        new Request("https://play.kavachcricket.com/api/players/public?limit=2&sort=runs_desc", {
          headers: { "x-test-uid": "uid_p1", "x-test-player-id": "p1" },
        }),
      );
      assert.equal(page1.status, 200);
      const d1 = await page1.json();
      assert.equal(d1.players.length, 2);
      assert.equal(d1.hasMore, true);
      assert.ok(d1.nextCursor);
      assert.equal(d1.players[0].id, "p_b");
      assert.equal(d1.players[1].id, "p_c");
      assert.equal(d1.players.some((x) => x.id === "p_pend" || x.id === "p_dis"), false);
      for (const pii of ["mobile", "email", "dob", "bloodGroup", "emergencyContact", "locality", "authUid"]) {
        assert.equal(pii in d1.players[0], false);
      }

      const page2 = await getPublicPlayers(
        new Request(`https://play.kavachcricket.com/api/players/public?limit=2&sort=runs_desc&cursor=${encodeURIComponent(d1.nextCursor)}`, {
          headers: { "x-test-uid": "uid_p1", "x-test-player-id": "p1" },
        }),
      );
      assert.equal(page2.status, 200);
      const d2 = await page2.json();
      assert.equal(d2.players.length, 1);
      assert.equal(d2.players[0].id, "p_a");
      assert.equal(d2.hasMore, false);

      // Shared Firestore rate limit triggers 429 on 61st request
      const windowId = Math.floor(Date.now() / 60_000);
      await adminDb.collection("rateLimits").doc(`public_players_uid_rate_test_${windowId}`).set({
        scope: "public_players",
        key: "uid_rate_test",
        windowId,
        count: 60,
      });
      const limited = await getPublicPlayers(
        new Request("https://play.kavachcricket.com/api/players/public?limit=1", {
          headers: { "x-test-uid": "uid_rate_test", "x-test-player-id": "p1" },
        }),
      );
      assert.equal(limited.status, 429);
    });
  },
);
