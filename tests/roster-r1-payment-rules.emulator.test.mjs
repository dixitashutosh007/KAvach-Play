/**
 * ROSTER-R1: Enforce Finance Role Boundary at Firestore Level (Emulator Rules Tests).
 * Run: npm run test:emulator -- tests/roster-r1-payment-rules.emulator.test.mjs
 */
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rulesContent = fs.readFileSync(path.resolve(__dirname, "../firestore.rules"), "utf8");
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const skip = !emulatorHost && "FIRESTORE_EMULATOR_HOST not set (requires local emulator runner)";

describe("ROSTER-R1: Firestore payment & otherFees read authorization", { skip }, () => {
  let testEnv;
  let rut;
  let fs_;

  before(async () => {
    if (!emulatorHost) return;
    rut = await import("@firebase/rules-unit-testing");
    fs_ = await import("firebase/firestore");
    testEnv = await rut.initializeTestEnvironment({
      projectId: "kavach-roster-r1-rules-test",
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
      // Players
      await db.doc("players/p_regular").set({ id: "p_regular", authUid: "uid_regular", name: "Regular Player" });
      await db.doc("players/p_club_admin").set({ id: "p_club_admin", authUid: "uid_club_admin", name: "Club Admin Player" });
      await db.doc("players/p_match_admin").set({ id: "p_match_admin", authUid: "uid_match_admin", name: "Match Admin Player" });
      await db.doc("players/p_other").set({ id: "p_other", authUid: "uid_other", name: "Other Player" });

      // AppUsers
      await db.doc("appUsers/uid_regular").set({ uid: "uid_regular", playerId: "p_regular", status: "Active" });
      await db.doc("appUsers/uid_club_admin").set({ uid: "uid_club_admin", playerId: "p_club_admin", isClubAdmin: true, status: "Active" });
      await db.doc("appUsers/uid_match_admin").set({ uid: "uid_match_admin", playerId: "p_match_admin", isMatchAdmin: true, isClubAdmin: true, status: "Active" });
      await db.doc("appUsers/uid_finance_admin").set({ uid: "uid_finance_admin", isFinanceAdmin: true, status: "Active" });
      await db.doc("appUsers/uid_super_admin").set({ uid: "uid_super_admin", isSuperAdmin: true, status: "Active" });

      // Match & Payments
      await db.doc("matches/m1").set({ id: "m1", groundId: "g1", title: "Sunday Match" });
      await db.doc("matches/m1/payments/pay_regular").set({ id: "pay_regular", matchId: "m1", playerId: "p_regular", status: "Unpaid" });
      await db.doc("matches/m1/payments/pay_club_admin").set({ id: "pay_club_admin", matchId: "m1", playerId: "p_club_admin", status: "Unpaid" });
      await db.doc("matches/m1/payments/pay_match_admin").set({ id: "pay_match_admin", matchId: "m1", playerId: "p_match_admin", status: "Unpaid" });
      await db.doc("matches/m1/payments/pay_other").set({ id: "pay_other", matchId: "m1", playerId: "p_other", status: "Paid" });

      // OtherFees
      await db.doc("players/p_regular/otherFees/fee_reg").set({ id: "fee_reg", playerId: "p_regular", amount: 500, status: "Unpaid" });
      await db.doc("players/p_other/otherFees/fee_other").set({ id: "fee_other", playerId: "p_other", amount: 750, status: "Unpaid" });
    });
  });

  const dbFor = (uid, claims = {}) => testEnv.authenticatedContext(uid, claims).firestore();

  it("Regular Player: can read own payment & own otherFees, denied on another player's", async () => {
    const db = dbFor("uid_regular");
    await rut.assertSucceeds(fs_.getDoc(fs_.doc(db, "matches/m1/payments/pay_regular")));
    await rut.assertFails(fs_.getDoc(fs_.doc(db, "matches/m1/payments/pay_other")));
    await rut.assertFails(fs_.getDocs(fs_.collectionGroup(db, "payments")));
    await rut.assertSucceeds(
      fs_.getDocs(fs_.query(fs_.collectionGroup(db, "payments"), fs_.where("playerId", "==", "p_regular"))),
    );
    await rut.assertFails(
      fs_.getDocs(fs_.query(fs_.collectionGroup(db, "payments"), fs_.where("playerId", "==", "p_other"))),
    );

    await rut.assertSucceeds(fs_.getDoc(fs_.doc(db, "players/p_regular/otherFees/fee_reg")));
    await rut.assertFails(fs_.getDoc(fs_.doc(db, "players/p_other/otherFees/fee_other")));
  });

  it("Club Admin (non-finance): can read own payment only, denied on another player's payment & collectionGroup", async () => {
    const db = dbFor("uid_club_admin");
    await rut.assertSucceeds(fs_.getDoc(fs_.doc(db, "matches/m1/payments/pay_club_admin")));
    await rut.assertFails(fs_.getDoc(fs_.doc(db, "matches/m1/payments/pay_other")));
    await rut.assertFails(fs_.getDocs(fs_.collectionGroup(db, "payments")));
    await rut.assertSucceeds(
      fs_.getDocs(fs_.query(fs_.collectionGroup(db, "payments"), fs_.where("playerId", "==", "p_club_admin"))),
    );
    await rut.assertFails(
      fs_.getDocs(fs_.query(fs_.collectionGroup(db, "payments"), fs_.where("playerId", "==", "p_other"))),
    );
    await rut.assertFails(fs_.getDoc(fs_.doc(db, "players/p_other/otherFees/fee_other")));
  });

  it("Match Admin / other non-finance admin: can read own payment only, denied on another player's payment", async () => {
    const db = dbFor("uid_match_admin");
    await rut.assertSucceeds(fs_.getDoc(fs_.doc(db, "matches/m1/payments/pay_match_admin")));
    await rut.assertFails(fs_.getDoc(fs_.doc(db, "matches/m1/payments/pay_other")));
    await rut.assertFails(fs_.getDocs(fs_.collectionGroup(db, "payments")));
    await rut.assertFails(fs_.getDoc(fs_.doc(db, "players/p_other/otherFees/fee_other")));
  });

  it("Finance Admin: can read own and other players' payments and otherFees (direct & collectionGroup)", async () => {
    const db = dbFor("uid_finance_admin");
    await rut.assertSucceeds(fs_.getDoc(fs_.doc(db, "matches/m1/payments/pay_other")));
    const cgSnap = await rut.assertSucceeds(fs_.getDocs(fs_.collectionGroup(db, "payments")));
    assert.equal(cgSnap.size, 4);
    await rut.assertSucceeds(fs_.getDoc(fs_.doc(db, "players/p_other/otherFees/fee_other")));
    const ofSnap = await rut.assertSucceeds(fs_.getDocs(fs_.collectionGroup(db, "otherFees")));
    assert.equal(ofSnap.size, 2);
  });

  it("Super Admin: can read own and other players' payments and otherFees (direct & collectionGroup)", async () => {
    const db = dbFor("uid_super_admin", { admin: true });
    await rut.assertSucceeds(fs_.getDoc(fs_.doc(db, "matches/m1/payments/pay_other")));
    const cgSnap = await rut.assertSucceeds(fs_.getDocs(fs_.collectionGroup(db, "payments")));
    assert.equal(cgSnap.size, 4);
    await rut.assertSucceeds(fs_.getDoc(fs_.doc(db, "players/p_other/otherFees/fee_other")));
    const ofSnap = await rut.assertSucceeds(fs_.getDocs(fs_.collectionGroup(db, "otherFees")));
    assert.equal(ofSnap.size, 2);
  });
});
