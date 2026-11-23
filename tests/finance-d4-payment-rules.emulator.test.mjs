/**
 * Finance Plans D4 — fee fields on match payments
 * (tests/finance-d4-payment-rules.emulator.test.mjs).
 *
 * Against the Firebase Emulator (skipped without FIRESTORE_EMULATOR_HOST):
 *  - Match Admin: squad / availability / cash collection at the recorded fee
 *  - Match Admin: cannot set fee amounts, plan tags, sponsorship, snapshot,
 *    plan/club settlement, Razorpay status or a different collected amount
 *  - Finance Admin: can make fee changes
 */

import { describe, it, before, after, beforeEach } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rulesContent = fs.readFileSync(path.resolve(__dirname, "../firestore.rules"), "utf8");
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;

describe(
  "D4: Match Admins cannot change fee fields; Finance Admins can",
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
        projectId: "kavach-d4-test",
        firestore: { host: emulatorHost.split(":")[0], port: parseInt(emulatorHost.split(":")[1], 10), rules: rulesContent },
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
        await db.doc("appUsers/match_admin").set({ name: "Match Admin", role: "player", isMatchAdmin: true, status: "Active" });
        await db.doc("appUsers/finance_admin").set({ name: "Finance Admin", role: "player", isFinanceAdmin: true, status: "Active" });
        await db.doc("players/p1").set({ id: "p1", name: "Player One", status: "Active", inviteStatus: "Accepted" });
        await db.doc("matches/m1").set({ opponent: "XI", fee: 700, date: "2026-11-28", result: "Pending", createdAt: new Date(), updatedAt: new Date() });
        const base = { matchId: "m1", playerId: "p1", availability: "Confirmed", createdAt: new Date(), updatedAt: new Date() };
        await db.doc("matches/m1/payments/regular").set({ id: "regular", status: "Unpaid", ...base });
        await db.doc("matches/m1/payments/planned").set({ id: "planned", status: "Unpaid", feeOverride: 500, feeOffsetAmount: 200, planTag: "Fixed 500", ...base });
        await db.doc("matches/m1/payments/sponsored").set({ id: "sponsored", status: "Paid", feeOverride: 0, feeOffsetAmount: 700, feeCollectedAmount: 0, planTag: "Sponsored", paymentMethod: "manual", manualMethod: "club_sponsored", ...base });
      });
    });

    const ma = () => testEnv.authenticatedContext("match_admin").firestore();
    const fa = () => testEnv.authenticatedContext("finance_admin").firestore();
    const ts = () => fs_.serverTimestamp();

    it("Match Admin: marks a regular fee paid in cash", async () => {
      await rut.assertSucceeds(ma().doc("matches/m1/payments/regular").update({ status: "Paid", paymentMethod: "manual", manualBy: "MA", updatedAt: ts() }));
    });
    it("Match Admin: collects a plan fee at the plan amount, not another amount", async () => {
      await rut.assertSucceeds(ma().doc("matches/m1/payments/planned").update({ status: "Paid", paymentMethod: "manual", feeCollectedAmount: 500, updatedAt: ts() }));
    });
    it("Match Admin: collected amount must equal the recorded fee", async () => {
      await rut.assertFails(ma().doc("matches/m1/payments/planned").update({ status: "Paid", paymentMethod: "manual", feeCollectedAmount: 100, updatedAt: ts() }));
    });
    it("Match Admin: availability and Not Playing still work", async () => {
      await rut.assertSucceeds(ma().doc("matches/m1/payments/regular").update({ availability: "No", status: "Not Playing", updatedAt: ts() }));
      await rut.assertSucceeds(ma().doc("matches/m1/payments/sponsored").update({ status: "Not Playing", updatedAt: ts() }));
    });
    for (const [field, value] of [
      ["feeOverride", 0],
      ["feeOffsetAmount", 700],
      ["planTag", "Youth350"],
      ["sponsoredBy", "p2"],
      ["financeSnapshot", { source: "auto" }],
    ]) {
      it(`Match Admin: cannot set ${field}`, async () => {
        await rut.assertFails(ma().doc("matches/m1/payments/regular").update({ [field]: value, updatedAt: ts() }));
      });
    }
    it("Match Admin: cannot settle a fee as club sponsored / part of plan, claim Razorpay, or waive", async () => {
      await rut.assertFails(ma().doc("matches/m1/payments/regular").update({ status: "Paid", paymentMethod: "manual", manualMethod: "club_sponsored", updatedAt: ts() }));
      await rut.assertFails(ma().doc("matches/m1/payments/regular").update({ status: "Paid", paymentMethod: "manual", manualMethod: "part_of_plan", updatedAt: ts() }));
      await rut.assertFails(ma().doc("matches/m1/payments/regular").update({ status: "Paid", paymentMethod: "razorpay", updatedAt: ts() }));
      await rut.assertFails(ma().doc("matches/m1/payments/regular").update({ status: "Waived", updatedAt: ts() }));
    });
    it("Match Admin: cannot flip a plan-settled fee back to Unpaid", async () => {
      await rut.assertFails(ma().doc("matches/m1/payments/sponsored").update({ status: "Unpaid", updatedAt: ts() }));
    });
    it("Match Admin: creates squad rows, but not with fee fields", async () => {
      const row = { id: "new1", matchId: "m1", playerId: "p1", status: "Unpaid", availability: "Confirmed", createdAt: ts(), updatedAt: ts() };
      await rut.assertSucceeds(ma().doc("matches/m1/payments/new1").set(row));
      await rut.assertFails(ma().doc("matches/m1/payments/new2").set({ ...row, id: "new2", feeOverride: 0 }));
      await rut.assertFails(ma().doc("matches/m1/payments/new3").set({ ...row, id: "new3", status: "Paid" }));
    });
    it("Finance Admin: can change fee fields", async () => {
      await rut.assertSucceeds(fa().doc("matches/m1/payments/regular").update({ feeOverride: 300, feeOffsetAmount: 400, planTag: "Override", updatedAt: ts() }));
      await rut.assertSucceeds(fa().doc("matches/m1/payments/sponsored").update({ status: "Unpaid", updatedAt: ts() }));
    });
  },
);
