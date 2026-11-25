/**
 * DEF-R3-004: Firestore Rules Remediation — Positive & Negative Emulator Tests
 * (tests/def-r3-004-rules.emulator.test.mjs)
 *
 * Covers:
 * 1. /notifications/{notifId}: owner/broadcast read, admin-only 'admin'/'all' create, owner/admin update & delete
 * 2. /merchOrders/{orderId}: player update locks protected fields (orderStatus, merchId, merchName, paymentStatus, price, playerId, createdAt)
 * 3. /pollResponses/{responseId}: create requires isSelf(playerId); update locks playerId & pollId
 * 4. /auditLogs/{logId}: append-only (update: false for all roles including Super Admin)
 * 5. /catchLog/{entryId}: parenthesized role check enforces field & player-existence validation for Club Admin
 *
 * Run: node scripts/run-emulator-tests.mjs tests/def-r3-004-rules.emulator.test.mjs
 */

import { describe, it, before, after, beforeEach } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rulesContent = fs.readFileSync(path.resolve(__dirname, "../firestore.rules"), "utf8");
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const skip = !emulatorHost && "FIRESTORE_EMULATOR_HOST not set (run via scripts/run-emulator-tests.mjs)";

describe("DEF-R3-004: Firestore Security Rules — Positive & Negative Tests", { skip }, () => {
  let testEnv;
  let assertFails;
  let assertSucceeds;
  let serverTimestamp;

  const as = (uid, claims = {}) => testEnv.authenticatedContext(uid, claims).firestore();

  before(async () => {
    const rut = await import("@firebase/rules-unit-testing");
    const fsSdk = await import("firebase/firestore");
    assertFails = rut.assertFails;
    assertSucceeds = rut.assertSucceeds;
    serverTimestamp = fsSdk.serverTimestamp;

    const [host, port] = emulatorHost.split(":");
    testEnv = await rut.initializeTestEnvironment({
      projectId: "kavach-def-r3-004-test",
      firestore: { host, port: Number(port), rules: rulesContent },
    });
  });

  after(async () => {
    if (testEnv) await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      const now = new Date();

      await db.collection("appUsers").doc("uid_p1").set({
        name: "Player 1",
        role: "player",
        playerId: "p1",
        status: "Active",
      });
      await db.collection("appUsers").doc("uid_p2").set({
        name: "Player 2",
        role: "player",
        playerId: "p2",
        status: "Active",
      });
      await db.collection("appUsers").doc("uid_club").set({
        name: "Club Admin",
        role: "player",
        isClubAdmin: true,
        status: "Active",
      });
      await db.collection("appUsers").doc("uid_super").set({
        name: "Super Admin",
        role: "player",
        status: "Active",
      });

      await db.collection("players").doc("p1").set({ name: "Player 1", authUid: "uid_p1" });
      await db.collection("players").doc("p2").set({ name: "Player 2", authUid: "uid_p2" });

      // Notifications fixtures
      await db.collection("notifications").doc("n_p1").set({
        userId: "uid_p1",
        title: "Personal",
        read: false,
      });
      await db.collection("notifications").doc("n_p2").set({
        userId: "uid_p2",
        title: "Other Personal",
        read: false,
      });
      await db.collection("notifications").doc("n_all").set({
        userId: "all",
        title: "Club Broadcast",
        read: false,
      });
      await db.collection("notifications").doc("n_admin").set({
        userId: "admin",
        title: "Admin Alert",
        read: false,
      });

      // Merch order fixture
      await db.collection("merchOrders").doc("ord_1").set({
        id: "ord_1",
        playerId: "p1",
        playerName: "Player 1",
        merchId: "merch_1",
        merchName: "Club Jersey",
        price: 1200,
        size: "M",
        paymentStatus: "Unpaid",
        orderStatus: "Order Placed",
        createdAt: now,
      });

      // Poll & PollResponse fixtures
      await db.collection("polls").doc("poll_1").set({
        title: "Kit Color",
        type: "singleChoice",
        options: ["Red", "White"],
        isSticked: false,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      await db.collection("polls").doc("poll_2").set({
        title: "Practice Time",
        type: "singleChoice",
        options: ["6am", "7am"],
        isSticked: false,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      await db.collection("pollResponses").doc("resp_p1").set({
        pollId: "poll_1",
        playerId: "p1",
        response: "Red",
        createdAt: now,
        updatedAt: now,
      });

      // Audit log fixture
      await db.collection("auditLogs").doc("log_1").set({
        action: "created",
        entity: "match",
        entityId: "m_1",
        createdAt: now,
      });
    });
  });

  // ── 1. /notifications/{notifId} ────────────────────────────────────────────
  describe("/notifications/{notifId}", () => {
    it("allows owner to read/create/update/delete own notification and read 'all' broadcast", async () => {
      const p1 = as("uid_p1");
      await assertSucceeds(p1.collection("notifications").doc("n_p1").get());
      await assertSucceeds(p1.collection("notifications").doc("n_all").get());
      await assertSucceeds(
        p1.collection("notifications").doc("n_p1_new").set({ userId: "uid_p1", title: "Self", read: false }),
      );
      await assertSucceeds(p1.collection("notifications").doc("n_p1").update({ read: true }));
      await assertSucceeds(p1.collection("notifications").doc("n_p1").delete());
    });

    it("denies non-admin reading others' or 'admin' notifications, and denies creating 'admin'/'all' broadcasts", async () => {
      const p1 = as("uid_p1");
      await assertFails(p1.collection("notifications").doc("n_p2").get());
      await assertFails(p1.collection("notifications").doc("n_admin").get());
      await assertFails(
        p1.collection("notifications").doc("n_bad_admin").set({ userId: "admin", title: "Spoof", read: false }),
      );
      await assertFails(
        p1.collection("notifications").doc("n_bad_all").set({ userId: "all", title: "Spam", read: false }),
      );
      await assertFails(
        p1.collection("notifications").doc("n_bad_other").set({ userId: "uid_p2", title: "Spoof", read: false }),
      );
      await assertFails(p1.collection("notifications").doc("n_p2").update({ read: true }));
      await assertFails(p1.collection("notifications").doc("n_p2").delete());
    });

    it("allows admin to read all notifications and create/update/delete 'admin' and 'all' broadcasts", async () => {
      const club = as("uid_club");
      await assertSucceeds(club.collection("notifications").doc("n_p1").get());
      await assertSucceeds(club.collection("notifications").doc("n_admin").get());
      await assertSucceeds(
        club.collection("notifications").doc("n_admin_new").set({ userId: "admin", title: "Admin Note", read: false }),
      );
      await assertSucceeds(
        club.collection("notifications").doc("n_all_new").set({ userId: "all", title: "All Note", read: false }),
      );
      await assertSucceeds(club.collection("notifications").doc("n_admin").update({ read: true }));
      await assertSucceeds(club.collection("notifications").doc("n_admin").delete());
    });
  });

  // ── 2. /merchOrders/{orderId} ──────────────────────────────────────────────
  describe("/merchOrders/{orderId}", () => {
    it("allows owner to update non-protected fields (e.g. size) and Club Admin to update protected fields", async () => {
      const p1 = as("uid_p1");
      const club = as("uid_club");
      await assertSucceeds(p1.collection("merchOrders").doc("ord_1").update({ size: "L" }));
      await assertSucceeds(
        club.collection("merchOrders").doc("ord_1").update({
          orderStatus: "Delivered",
          paymentStatus: "Paid",
        }),
      );
    });

    it("rejects owner updating protected fields (orderStatus, merchId, merchName, paymentStatus, price, playerId, createdAt)", async () => {
      const p1 = as("uid_p1");
      const protectedPatches = [
        { orderStatus: "Delivered" },
        { merchId: "merch_other" },
        { merchName: "Tampered Item" },
        { paymentStatus: "Paid" },
        { price: 1 },
        { playerId: "p2" },
        { createdAt: new Date(0) },
      ];
      for (const patch of protectedPatches) {
        await assertFails(p1.collection("merchOrders").doc("ord_1").update(patch));
      }
      // Non-owner cannot update at all
      await assertFails(as("uid_p2").collection("merchOrders").doc("ord_1").update({ size: "S" }));
    });
  });

  // ── 3. /pollResponses/{responseId} ─────────────────────────────────────────
  describe("/pollResponses/{responseId}", () => {
    it("allows player to create own poll response and update response without changing playerId or pollId", async () => {
      const p1 = as("uid_p1");
      await assertSucceeds(
        p1.collection("pollResponses").doc("resp_p1_poll2").set({
          pollId: "poll_2",
          playerId: "p1",
          response: "6am",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }),
      );
      await assertSucceeds(
        p1.collection("pollResponses").doc("resp_p1").update({
          response: "White",
          updatedAt: serverTimestamp(),
        }),
      );
    });

    it("rejects creating poll response for another player and rejects changing playerId or pollId on update", async () => {
      const p1 = as("uid_p1");
      await assertFails(
        p1.collection("pollResponses").doc("resp_spoof").set({
          pollId: "poll_2",
          playerId: "p2",
          response: "7am",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }),
      );
      await assertFails(
        p1.collection("pollResponses").doc("resp_p1").update({
          playerId: "p2",
          updatedAt: serverTimestamp(),
        }),
      );
      await assertFails(
        p1.collection("pollResponses").doc("resp_p1").update({
          pollId: "poll_2",
          updatedAt: serverTimestamp(),
        }),
      );
    });
  });

  // ── 4. /auditLogs/{logId} ──────────────────────────────────────────────────
  describe("/auditLogs/{logId}", () => {
    it("allows admin create and Super Admin read/delete, while keeping auditLogs strictly append-only (no update)", async () => {
      const club = as("uid_club");
      const superAdmin = as("uid_super", { admin: true });
      const p1 = as("uid_p1");

      await assertSucceeds(
        club.collection("auditLogs").doc("log_2").set({
          action: "updated",
          entity: "player",
          entityId: "p1",
          createdAt: serverTimestamp(),
        }),
      );
      await assertSucceeds(superAdmin.collection("auditLogs").doc("log_1").get());

      // Append-only: nobody (not even Club Admin or Super Admin) may update
      await assertFails(club.collection("auditLogs").doc("log_1").update({ action: "tampered" }));
      await assertFails(superAdmin.collection("auditLogs").doc("log_1").update({ action: "tampered" }));
      await assertFails(p1.collection("auditLogs").doc("log_1").update({ action: "tampered" }));

      // Non-Super-Admin cannot read or delete; Super Admin cannot delete (strictly append-only)
      await assertFails(club.collection("auditLogs").doc("log_1").get());
      await assertFails(club.collection("auditLogs").doc("log_1").delete());
      await assertFails(p1.collection("auditLogs").doc("log_1").set({ action: "fake" }));
      await assertFails(superAdmin.collection("auditLogs").doc("log_1").delete());
    });
  });

  // ── 5. /catchLog/{entryId} ─────────────────────────────────────────────────
  describe("/catchLog/{entryId}", () => {
    it("allows Club Admin to create a valid catchLog entry for an existing player", async () => {
      const club = as("uid_club");
      await assertSucceeds(
        club.collection("catchLog").doc("catch_1").set({
          playerId: "p1",
          type: "Catches",
          count: 2,
        }),
      );
    });

    it("rejects Club Admin creating invalid catchLog entries (type mismatch or non-existent playerId) and rejects non-admins", async () => {
      const club = as("uid_club");
      const p1 = as("uid_p1");

      await assertFails(
        club.collection("catchLog").doc("catch_bad_count").set({
          playerId: "p1",
          type: "Catches",
          count: "two",
        }),
      );
      await assertFails(
        club.collection("catchLog").doc("catch_bad_player").set({
          playerId: "nonexistent_player",
          type: "Catches",
          count: 1,
        }),
      );
      await assertFails(
        club.collection("catchLog").doc("catch_missing_type").set({
          playerId: "p1",
          count: 1,
        }),
      );
      await assertFails(
        p1.collection("catchLog").doc("catch_player").set({
          playerId: "p1",
          type: "Catches",
          count: 1,
        }),
      );
    });
  });
});
