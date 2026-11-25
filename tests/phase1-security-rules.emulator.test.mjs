import { describe, it, before, after, beforeEach } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rulesContent = fs.readFileSync(path.resolve(__dirname, "../firestore.rules"), "utf8");
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;

describe(
  "Phase 1 Security Rules: merchOrders, appUsers, appConfig & match payments",
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
        await db.doc("appConfig/default").set({
          clubName: "Kavach",
          emailProvider: "smtp",
          smtpHost: "smtp.trusted.example",
          smtpPort: 587,
          smtpUser: "noreply@kavach.example",
        });
        await db.doc("appUsers/uid_p1").set({
          name: "Player One",
          email: "p1@example.com",
          role: "player",
          playerId: "p1",
          status: "Active",
        });
        await db.doc("appUsers/uid_p2").set({
          name: "Player Two",
          email: "p2@example.com",
          role: "player",
          playerId: "p2",
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
        await db.doc("appUsers/uid_dual").set({
          name: "Dual Admin",
          role: "player",
          isClubAdmin: true,
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
        await db.doc("players/p2").set({
          id: "p2",
          name: "Player Two",
          authUid: "uid_p2",
          mobile: "+919876543211",
          inviteStatus: "Accepted",
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        await db.doc("merchOrders/ord_p1").set({
          id: "ord_p1",
          playerId: "p1",
          playerName: "Player One",
          merchId: "jersey1",
          merchName: "Official Jersey",
          price: 1200,
          paymentStatus: "Unpaid",
          orderStatus: "Order Placed",
          isManual: true,
          createdAt: new Date(),
        });
        await db.doc("matches/m1").set({
          opponent: "XI",
          fee: 700,
          date: "2026-11-28",
          result: "Pending",
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        await db.doc("matches/m1/payments/pay_p2").set({
          id: "pay_p2",
          matchId: "m1",
          playerId: "p2",
          status: "Unpaid",
          availability: "Confirmed",
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      });
    });

    const p1 = () => testEnv.authenticatedContext("uid_p1").firestore();
    const club = () => testEnv.authenticatedContext("uid_club").firestore();
    const fin = () => testEnv.authenticatedContext("uid_fin").firestore();
    const dual = () => testEnv.authenticatedContext("uid_dual").firestore();
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

    it("Workstream B: Club Admin can create offline manual merchOrders, but CANNOT forge server provenance fields", async () => {
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
      await rut.assertFails(club().doc("merchOrders/forge_1").set({ ...order, id: "forge_1", trustedSource: "server" }));
      await rut.assertFails(club().doc("merchOrders/forge_2").set({ ...order, id: "forge_2", intentId: "intent_x" }));
      await rut.assertFails(club().doc("merchOrders/forge_3").set({ ...order, id: "forge_3", priceSnapshot: { totalAmount: 1 } }));
      await rut.assertFails(club().doc("merchOrders/manual_1").update({ trustedSource: "server" }));
      await rut.assertFails(club().doc("merchOrders/manual_1").update({ intentId: "intent_x" }));
      await rut.assertFails(fin().doc("merchOrders/manual_2").set({ ...order, id: "manual_2" }));
    });

    it("Workstream B: Player cannot modify price, customSelections, customPriceAdditions, priceSnapshot, or provenance after order creation", async () => {
      await rut.assertFails(p1().doc("merchOrders/ord_p1").update({ price: 1 }));
      await rut.assertFails(p1().doc("merchOrders/ord_p1").update({ customSelections: { Sleeve: "Half" } }));
      await rut.assertFails(p1().doc("merchOrders/ord_p1").update({ customPriceAdditions: 0 }));
      await rut.assertFails(p1().doc("merchOrders/ord_p1").update({ priceSnapshot: { totalAmount: 1 } }));
      await rut.assertFails(p1().doc("merchOrders/ord_p1").update({ isManual: false }));
      await rut.assertFails(p1().doc("merchOrders/ord_p1").update({ trustedSource: "server" }));
      await rut.assertFails(p1().doc("merchOrders/ord_p1").update({ intentId: "intent_x" }));
      // Legitimate non-pricing display edit (size) remains allowed
      await rut.assertSucceeds(p1().doc("merchOrders/ord_p1").update({ size: "XL" }));
    });

    it("Workstream A: Only Super Admin can modify appConfig/default SMTP settings", async () => {
      await rut.assertFails(p1().doc("appConfig/default").update({ smtpHost: "evil.example" }));
      await rut.assertFails(club().doc("appConfig/default").update({ smtpHost: "evil.example" }));
      await rut.assertFails(fin().doc("appConfig/default").update({ smtpHost: "evil.example" }));
      await rut.assertSucceeds(sup().doc("appConfig/default").update({ smtpHost: "smtp.new-trusted.example" }));
      await rut.assertFails(sup().doc("appConfig/default").update({ smtpPassword: "leak" }));
    });

    it("Workstream C: Player cannot grant Studio membership, expiry, role, status, or nested protected fields on own appUsers", async () => {
      await rut.assertFails(p1().doc("appUsers/uid_p1").update({ isStudioMember: true }));
      await rut.assertFails(p1().doc("appUsers/uid_p1").update({ studioExpiryDate: "2099-12-31" }));
      await rut.assertFails(p1().doc("appUsers/uid_p1").update({ lastPaidAmount: 5000 }));
      await rut.assertFails(p1().doc("appUsers/uid_p1").update({ status: "Disabled" }));
      await rut.assertFails(p1().doc("appUsers/uid_p1").update({ isFinanceAdmin: true }));
      await rut.assertFails(p1().doc("appUsers/uid_p1").update({ "roleMigration.from": "admin" }));
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

    it("Workstream D: Dual-role Club+Finance Admin can settle match payment; Player cannot settle another player's payment", async () => {
      await rut.assertFails(
        p1().doc("matches/m1/payments/pay_p2").update({
          status: "Paid",
          paymentMethod: "manual",
          updatedAt: ts(),
        }),
      );
      await rut.assertSucceeds(
        dual().doc("matches/m1/payments/pay_p2").update({
          status: "Paid",
          paymentMethod: "manual",
          manualMethod: "cash_collected",
          feeCollectedAmount: 700,
          updatedAt: ts(),
        }),
      );
    });
  },
);
