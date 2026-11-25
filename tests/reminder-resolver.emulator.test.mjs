/**
 * FND-03 Reminder resolver & authorization — Firestore Emulator tests.
 * Run: npm run test:emulator -- tests/reminder-resolver.emulator.test.mjs
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { resolveAuthorizedDueReminder } from "../lib/reminder-server.ts";
import { authorizeEmailRequest } from "../lib/email-auth.ts";

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const skip = !emulatorHost && "FIRESTORE_EMULATOR_HOST not set (run via npm run test:emulator)";

describe("FND-03: Server-side due reminder resolver (Firestore Emulator)", { skip }, () => {
  let db;
  let seq = 0;
  const uid = (p) => `${p}_${++seq}`;
  const saved = {};

  before(async () => {
    Object.assign(process.env, { NODE_ENV: "test", KAVACH_TEST_AUTH_BYPASS: "true" });
    const { initializeApp, getApps } = await import("firebase-admin/app");
    const { getFirestore } = await import("firebase-admin/firestore");
    const app = getApps().length
      ? getApps()[0]
      : initializeApp({ projectId: "kavach-reminder-resolver-test" });
    db = getFirestore(app);
    await db.collection("appConfig").doc("default").set({
      clubName: "KAvach Club",
      emailTemplates: {
        due_reminder: {
          subject: "Pay ₹{{amount}} — {{clubName}}",
          body: "Hi {{playerName}}, due ₹{{amount}} for {{duesText}}. Link: {{link}}",
        },
      },
    });
    for (const l of ["log", "info", "warn", "error"]) {
      saved[l] = console[l];
      console[l] = () => {};
    }
  });

  after(() => Object.assign(console, saved));

  it("derives recipient, amount, and template from Firestore for match + otherFee dues", async () => {
    const pid = uid("p");
    const m1 = uid("m");
    const m2 = uid("m");
    await Promise.all([
      db.collection("players").doc(pid).set({ name: "Vikram", email: "vikram@club.test", mobile: "+919876543210" }),
      db.collection("matches").doc(m1).set({ opponent: "Lions", fee: 500, result: "Pending" }),
      db.collection("matches").doc(m2).set({ opponent: "Eagles", fee: 600, result: "Pending" }),
      db.collection("payments").doc(uid("pay")).set({ matchId: m1, playerId: pid, status: "Unpaid" }),
      db.collection("payments").doc(uid("pay")).set({ matchId: m2, playerId: pid, status: "Unpaid", feeCollectedAmount: 200 }),
      db.collection("otherFees").doc(uid("of")).set({ playerId: pid, title: "Jersey", amount: 350, status: "Unpaid" }),
      db.collection("otherFees").doc(uid("of")).set({ playerId: pid, title: "Late Fee", amount: 100, status: "Unpaid" }),
    ]);

    // Expected: 500 + (600 - 200) + 350 + 100 = 1350
    const emailRes = await resolveAuthorizedDueReminder(db, {
      playerId: pid,
      channel: "email",
      origin: "https://play.kavachcricket.com",
    });
    assert.equal(emailRes.ok, true);
    if (emailRes.ok) {
      assert.equal(emailRes.email, "vikram@club.test");
      assert.equal(emailRes.amount, 1350);
      assert.equal(emailRes.subject, "Pay ₹1350 — KAvach Club");
      assert.match(emailRes.text || "", /Vikram/);
      assert.match(emailRes.text || "", /1350/);
      assert.match(emailRes.text || "", /https:\/\/play\.kavachcricket\.com\/pay\//);
    }

    const waRes = await resolveAuthorizedDueReminder(db, {
      playerId: pid,
      channel: "whatsapp",
      origin: "https://play.kavachcricket.com",
    });
    assert.equal(waRes.ok, true);
    if (waRes.ok) {
      assert.equal(waRes.mobile, "+919876543210");
      assert.equal(waRes.amount, 1350);
    }
  });

  it("rejects players with no dues, only cancelled/waived dues, subscription-covered, or player-sponsored dues", async () => {
    const pNoDues = uid("p");
    const pCancelled = uid("p");
    const pSub = uid("p");
    const pSponsored = uid("p");
    const m = uid("m");

    await Promise.all([
      db.collection("matches").doc(m).set({ opponent: "Hawks", fee: 500, result: "Pending" }),
      db.collection("players").doc(pNoDues).set({ name: "Paid", email: "a@t.com", mobile: "9876543210" }),
      db.collection("payments").doc(uid("pay")).set({ matchId: m, playerId: pNoDues, status: "Paid" }),

      db.collection("players").doc(pCancelled).set({ name: "Waived", email: "b@t.com", mobile: "9876543211" }),
      db.collection("payments").doc(uid("pay")).set({ matchId: m, playerId: pCancelled, status: "Waived" }),
      db.collection("otherFees").doc(uid("of")).set({ playerId: pCancelled, title: "Fine", amount: 200, status: "Cancelled" }),

      db.collection("players").doc(pSub).set({ name: "Sub", email: "c@t.com", mobile: "9876543212" }),
      db.collection("payments").doc(uid("pay")).set({ matchId: m, playerId: pSub, status: "Paid", manualMethod: "part_of_plan" }),

      db.collection("players").doc(pSponsored).set({ name: "Sponsored", email: "d@t.com", mobile: "9876543213" }),
      db.collection("payments").doc(uid("pay")).set({ matchId: m, playerId: pSponsored, status: "Unpaid", sponsoredBy: pNoDues }),
    ]);

    for (const pid of [pNoDues, pCancelled, pSub, pSponsored]) {
      const e = await resolveAuthorizedDueReminder(db, { playerId: pid, channel: "email", origin: "https://x.test" });
      const w = await resolveAuthorizedDueReminder(db, { playerId: pid, channel: "whatsapp", origin: "https://x.test" });
      assert.equal(e.ok, false, `${pid} email should fail`);
      assert.equal(w.ok, false, `${pid} whatsapp should fail`);
    }
  });

  it("rejects disabled, merged, missing players, missing email, invalid mobile, and stale cleared dues", async () => {
    const pDis = uid("p");
    const pMerged = uid("p");
    const pNoEmail = uid("p");
    const pBadMob = uid("p");
    const pStale = uid("p");
    const m = uid("m");
    const stalePayId = uid("pay");

    await Promise.all([
      db.collection("matches").doc(m).set({ opponent: "Sharks", fee: 500, result: "Pending" }),
      db.collection("players").doc(pDis).set({ name: "Dis", disabled: true, email: "d@t.com", mobile: "9876543210" }),
      db.collection("payments").doc(uid("pay")).set({ matchId: m, playerId: pDis, status: "Unpaid" }),

      db.collection("players").doc(pMerged).set({ name: "Merged", mergedInto: pDis, email: "m@t.com", mobile: "9876543210" }),
      db.collection("payments").doc(uid("pay")).set({ matchId: m, playerId: pMerged, status: "Unpaid" }),

      db.collection("players").doc(pNoEmail).set({ name: "NoEmail", mobile: "9876543210" }),
      db.collection("payments").doc(uid("pay")).set({ matchId: m, playerId: pNoEmail, status: "Unpaid" }),

      db.collection("players").doc(pBadMob).set({ name: "BadMob", email: "bm@t.com", mobile: "123" }),
      db.collection("payments").doc(uid("pay")).set({ matchId: m, playerId: pBadMob, status: "Unpaid" }),

      db.collection("players").doc(pStale).set({ name: "Stale", email: "st@t.com", mobile: "9876543219" }),
      db.collection("payments").doc(stalePayId).set({ matchId: m, playerId: pStale, status: "Unpaid" }),
    ]);

    assert.equal((await resolveAuthorizedDueReminder(db, { playerId: pDis, channel: "email", origin: "https://x.test" })).ok, false);
    assert.equal((await resolveAuthorizedDueReminder(db, { playerId: pMerged, channel: "whatsapp", origin: "https://x.test" })).ok, false);
    assert.equal((await resolveAuthorizedDueReminder(db, { playerId: "missing_id", channel: "email", origin: "https://x.test" })).status, 404);
    assert.equal((await resolveAuthorizedDueReminder(db, { playerId: pNoEmail, channel: "email", origin: "https://x.test" })).ok, false);
    assert.equal((await resolveAuthorizedDueReminder(db, { playerId: pBadMob, channel: "whatsapp", origin: "https://x.test" })).ok, false);

    // Dues cleared between client display and send request
    assert.equal((await resolveAuthorizedDueReminder(db, { playerId: pStale, channel: "email", origin: "https://x.test" })).ok, true);
    await db.collection("payments").doc(stalePayId).update({ status: "Paid" });
    const afterClear = await resolveAuthorizedDueReminder(db, { playerId: pStale, channel: "email", origin: "https://x.test" });
    assert.equal(afterClear.ok, false);
  });

  it("authorizeEmailRequest keeps Club/Super Admin workflows permitted and Finance Admin strictly scoped", () => {
    const finOnly = { superAdmin: false, clubAdmin: false, financeAdmin: true };
    const clubAdmin = { superAdmin: false, clubAdmin: true, financeAdmin: false };
    assert.equal(authorizeEmailRequest(finOnly, { action: "due_reminder", playerId: "p1" }).ok, true);
    assert.equal(authorizeEmailRequest(finOnly, { to: ["x@y.com"], subject: "Custom", text: "Body" }).ok, false);
    assert.equal(authorizeEmailRequest(clubAdmin, { to: ["x@y.com"], subject: "Custom", text: "Body" }).ok, true);
  });
});
