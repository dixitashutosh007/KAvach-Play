/**
 * Match finance lifecycle rules C1 / C2
 * (tests/match-finance-lifecycle-rules.emulator.test.mjs).
 * Runs against the Firebase Emulator only (skipped without FIRESTORE_EMULATOR_HOST).
 */
import { describe, it, before, after, beforeEach } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rulesContent = fs.readFileSync(path.resolve(__dirname, "../firestore.rules"), "utf8");
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;

describe(
  "C1/C2: match finance lifecycle",
  { skip: !emulatorHost && "FIRESTORE_EMULATOR_HOST not set (requires local emulator runner)" },
  () => {
    let testEnv, rut, F;
    before(async () => {
      if (!emulatorHost) return;
      rut = await import("@firebase/rules-unit-testing");
      F = await import("firebase/firestore");
      testEnv = await rut.initializeTestEnvironment({
        projectId: "kavach-c1c2-test",
        firestore: { host: emulatorHost.split(":")[0], port: parseInt(emulatorHost.split(":")[1], 10), rules: rulesContent },
      });
    });
    after(async () => {
      if (testEnv) await testEnv.cleanup();
    });
    const baseMatch = { groundId: "g1", format: "T20", jerseyColor: "Scarlet Red", opponent: "XI", matchType: "Practice", fee: 700, date: "2026-11-30", time: "07:00", maxSquadSize: 12 };
    beforeEach(async () => {
      if (!testEnv) return;
      await testEnv.clearFirestore();
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const db = ctx.firestore();
        const now = new Date();
        await db.doc("grounds/g1").set({ name: "RBC" });
        await db.doc("appUsers/ma").set({ name: "CA", role: "player", isClubAdmin: true, status: "Active" });
        await db.doc("appUsers/fa").set({ name: "FA", role: "player", isFinanceAdmin: true, status: "Active" });
        await db.doc("appUsers/pl").set({ name: "PL", role: "player", playerId: "p1", status: "Active" });
        await db.doc("players/p1").set({ id: "p1", name: "P1", authUid: "pl", status: "Active", inviteStatus: "Accepted" });
        await db.doc("matches/open").set({ ...baseMatch, createdAt: now, updatedAt: now });
        await db.doc("matches/closed").set({ ...baseMatch, financeStatus: "closed", groundFeePaidAmount: 8000, isGroundFeePaid: true, createdAt: now, updatedAt: now });
        const pay = (id, m, extra) => db.doc(`matches/${m}/payments/${id}`).set({ id, matchId: m, playerId: "p1", availability: "Confirmed", createdAt: now, updatedAt: now, ...extra });
        await pay("cash", "open", { status: "Paid", paymentMethod: "manual", manualBy: "MA" });
        await pay("rzp", "open", { status: "Paid", paymentMethod: "razorpay", razorpayPaymentId: "pay_1", feeCollectedAmount: 700 });
        await pay("unpaid", "open", { status: "Unpaid" });
        await pay("spons", "open", { status: "Paid", paymentMethod: "manual", manualMethod: "club_sponsored", feeOverride: 0, feeOffsetAmount: 700, feeCollectedAmount: 0 });
        await pay("cUnpaid", "closed", { status: "Unpaid" });
        await pay("cOut", "closed", { status: "Not Playing" });
      });
    });
    const as = (uid) => testEnv.authenticatedContext(uid).firestore();
    const ts = () => F.serverTimestamp();

    it("C1: no client may write the actual ground fee or finance status", async () => {
      await rut.assertFails(as("fa").doc("matches/open").update({ groundFeePaidAmount: 8000, updatedAt: ts() }));
      await rut.assertFails(as("fa").doc("matches/open").update({ financeStatus: "closed", updatedAt: ts() }));
      await rut.assertFails(as("ma").doc("matches/open").update({ isGroundFeePaid: true, updatedAt: ts() }));
    });
    it("C1: unrelated match edits still work (open and closed)", async () => {
      await rut.assertSucceeds(as("ma").doc("matches/open").update({ opponent: "Elevate CC", updatedAt: ts() }));
      await rut.assertSucceeds(as("ma").doc("matches/closed").update({ opponent: "Elevate CC", isArchived: true, updatedAt: ts() }));
    });
    it("C1: closed match fee / budget can't change, and it can't be deleted", async () => {
      await rut.assertFails(as("ma").doc("matches/closed").update({ fee: 800, updatedAt: ts() }));
      await rut.assertFails(as("fa").doc("matches/closed").update({ matchFeeBudget: 9000, updatedAt: ts() }));
      await rut.assertFails(as("ma").doc("matches/closed").delete());
      await rut.assertSucceeds(as("ma").doc("matches/open").update({ fee: 800, updatedAt: ts() }));
    });
    it("C2: real money can't be toggled off or removed by any client role", async () => {
      for (const uid of ["ma", "fa"]) {
        await rut.assertFails(as(uid).doc("matches/open/payments/cash").update({ status: "Unpaid", updatedAt: ts() }));
        await rut.assertFails(as(uid).doc("matches/open/payments/rzp").update({ status: "Not Playing", updatedAt: ts() }));
      }
      await rut.assertFails(as("fa").doc("matches/open/payments/rzp").update({ feeCollectedAmount: 0, updatedAt: ts() }));
      await rut.assertFails(as("fa").doc("matches/open/payments/rzp").update({ razorpayPaymentId: "x", updatedAt: ts() }));
    });
    it("C2: availability notes on a paid row still work; non-cash settlements unaffected", async () => {
      await rut.assertSucceeds(as("ma").doc("matches/open/payments/cash").update({ availabilityNote: "late", updatedAt: ts() }));
      await rut.assertSucceeds(as("fa").doc("matches/open/payments/spons").update({ status: "Unpaid", updatedAt: ts() }));
    });
    it("C2: reversals and financeSnapshot are server-only", async () => {
      await rut.assertFails(as("fa").doc("matches/open/payments/unpaid").update({ reversals: [], updatedAt: ts() }));
      await rut.assertFails(as("fa").doc("matches/open/payments/unpaid").update({ financeSnapshot: { source: "auto" }, updatedAt: ts() }));
    });
    it("C2: closed match — no new squad rows, no re-adding, no fee changes; collection and removal of unpaid still work", async () => {
      const row = { id: "n1", matchId: "closed", playerId: "p1", status: "Unpaid", availability: "Confirmed", createdAt: ts(), updatedAt: ts() };
      await rut.assertFails(as("fa").doc("matches/closed/payments/n1").set(row));
      await rut.assertFails(as("ma").doc("matches/closed/payments/cOut").update({ status: "Unpaid", updatedAt: ts() }));
      await rut.assertFails(as("pl").doc("matches/closed/payments/cOut").update({ status: "Unpaid", availability: "Yes", updatedAt: ts() }));
      await rut.assertFails(as("fa").doc("matches/closed/payments/cUnpaid").update({ feeOverride: 300, updatedAt: ts() }));
      await rut.assertSucceeds(as("fa").doc("matches/closed/payments/cUnpaid").update({ status: "Paid", paymentMethod: "manual", manualBy: "FA", updatedAt: ts() }));
    });
    it("C2: unpaid player on a closed match can be removed", async () => {
      await rut.assertSucceeds(as("ma").doc("matches/closed/payments/cUnpaid").update({ status: "Not Playing", updatedAt: ts() }));
    });
  },
);
