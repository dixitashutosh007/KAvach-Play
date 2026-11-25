import { describe, it, before, after, beforeEach } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rulesContent = fs.readFileSync(path.resolve(__dirname, "../firestore.rules"), "utf8");
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;

describe(
  "Phase 1 Security Rules: merchOrders & appUsers hardening",
  { skip: !emulatorHost && "FIRESTORE_EMULATOR_HOST not set (requires local emulator runner)" },
  () => {
    let testEnv;
    let rut;
    let fs_;

    before(async () => {
      if (!emulatorHost) return;
      rut = await import("@firebase/rules-unit-testing");
      fs_ = await import("firebase/firestore");
      testEnv = await rut.initializeTestEnvironment({
        projectId: "kavach-phase1-rules-test",
        firestore: {
          host: emulatorHost.split(":")[0],
          port: parseInt(emulatorHost.split(":")[1], 10),
          rules: rulesContent,
        },
      });
    });

    after(async () => {
      if (testEnv) await testEnv.cleanup();
    });

    beforeEach(async () => {
      if (!testEnv) return;
      await testEnv.clearFirestore();
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const db = ctx.firestore();
        await db.doc("appUsers/uid_p1").set({
          name: "Player One",
          email: "p1@example.com",
          role: "player",
          playerId: "p1",
          status: "Active",
        });
        await db.doc("appUsers/uid_club").set({
          name: "Club Admin",
          role: "player",
          isClubAdmin: true,
          status: "Active",
        });
        await db.doc("appUsers/uid_fin").set({
          name: "Finance Admin",
          role: "player",
          isFinanceAdmin: true,
          status: "Active",
        });
        await db.doc("appUsers/uid_super").set({
          name: "Super Admin",
          role: "player",
          status: "Active",
        });
        await db.doc("players/p1").set({
          id: "p1",
          name: "Player One",
          authUid: "uid_p1",
          mobile: "+919876543210",
          inviteStatus: "Accepted",
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      });
    });

    const p1 = () => testEnv.authenticatedContext("uid_p1").firestore();
    const club = () => testEnv.authenticatedContext("uid_club").firestore();
    const fin = () => testEnv.authenticatedContext("uid_fin").firestore();
    const sup = () => testEnv.authenticatedContext("uid_super", { admin: true }).firestore();
    const ts = () => fs_.serverTimestamp();

    it("Workstream B: Player cannot create merchOrders directly in Firestore", async () => {
      await rut.assertFails(
        p1().doc("merchOrders/evil_ord").set({
          id: "evil_ord",
          playerId: "p1",
          playerName: "Player One",
          merchId: "jersey1",
          merchName: "Official Jersey",
          price: 1,
          paymentStatus: "Unpaid",
          orderStatus: "Order Placed",
          createdAt: ts(),
        }),
      );
    });

    it("Workstream B: Club Admin can create manual merchOrders, Finance Admin cannot", async () => {
      const order = {
        id: "manual_1",
        playerId: "p1",
        playerName: "Player One",
        merchId: "jersey1",
        merchName: "Official Jersey",
        price: 1200,
        paymentStatus: "Unpaid",
        orderStatus: "Order Placed",
        isManual: true,
        createdAt: ts(),
      };
      await rut.assertSucceeds(club().doc("merchOrders/manual_1").set(order));
      await rut.assertFails(fin().doc("merchOrders/manual_2").set({ ...order, id: "manual_2" }));
    });

    it("Workstream C: Player cannot grant Studio membership, expiry, role, or status on own appUsers", async () => {
      await rut.assertFails(p1().doc("appUsers/uid_p1").update({ isStudioMember: true }));
      await rut.assertFails(p1().doc("appUsers/uid_p1").update({ studioExpiryDate: "2099-12-31" }));
      await rut.assertFails(p1().doc("appUsers/uid_p1").update({ lastPaidAmount: 5000 }));
      await rut.assertFails(p1().doc("appUsers/uid_p1").update({ status: "Disabled" }));
      await rut.assertFails(p1().doc("appUsers/uid_p1").update({ isFinanceAdmin: true }));
      await rut.assertFails(p1().doc("appUsers/uid_p1").update({ arbitraryField: "x" }));
    });

    it("Workstream C: Player can still update allowed profile/login metadata on own appUsers", async () => {
      await rut.assertSucceeds(
        p1().doc("appUsers/uid_p1").update({
          authProviders: ["phone"],
          lastLoginAt: "2026-11-25T15:00:00Z",
          name: "Player One Updated",
        }),
      );
    });

    it("Workstream C: Club Admin cannot modify another user's appUsers document", async () => {
      await rut.assertFails(club().doc("appUsers/uid_p1").update({ isStudioMember: true }));
      await rut.assertFails(club().doc("appUsers/uid_p1").update({ email: "hacked@example.com" }));
      await rut.assertFails(club().doc("appUsers/uid_fin").update({ name: "Tampered" }));
      await rut.assertFails(club().doc("appUsers/uid_super").update({ name: "Tampered" }));
    });

    it("Workstream C: Finance Admin cannot escalate to Super Admin; Super Admin can update status", async () => {
      await rut.assertFails(fin().doc("appUsers/uid_fin").update({ isSuperAdmin: true }));
      await rut.assertSucceeds(sup().doc("appUsers/uid_p1").update({ status: "Disabled" }));
    });
  },
);
