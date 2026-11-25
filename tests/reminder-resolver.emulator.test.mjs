/**
 * FND-03 & FND-03-R1 Reminder resolver & HTTP route tests (Firestore Emulator).
 * Run: npm run test:emulator -- tests/reminder-resolver.emulator.test.mjs
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolveAuthorizedDueReminder } from "../lib/reminder-server.ts";
import { authorizeEmailRequest } from "../lib/email-auth.ts";

const ROOT = pathToFileURL(process.cwd() + "/").href;
register(
  "data:text/javascript," +
    encodeURIComponent(`
const ROOT = ${JSON.stringify(ROOT)};
export async function resolve(spec, ctx, next) {
  if (spec === "next/server") return next("next/server.js", ctx);
  if (spec.startsWith("@/")) spec = new URL(spec.slice(2) + (/\\.[a-z]+$/.test(spec) ? "" : ".ts"), ROOT).href;
  return next(spec, ctx);
}
export async function load(url, ctx, next) {
  if (!url.endsWith(".json")) return next(url, ctx);
  const { readFile } = await import("node:fs/promises");
  return { format: "json", source: await readFile(new URL(url), "utf-8"), shortCircuit: true };
}
`),
  import.meta.url,
);

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

  it("authorizeEmailRequest permits Super Admin for all emails, scopes Finance Admin to due_reminder, and denies Club Admin-only due_reminder", () => {
    const finOnly = { superAdmin: false, clubAdmin: false, financeAdmin: true };
    const clubAdmin = { superAdmin: false, clubAdmin: true, financeAdmin: false };
    const superAdmin = { superAdmin: true, clubAdmin: false, financeAdmin: false };
    assert.equal(authorizeEmailRequest(finOnly, { action: "due_reminder", playerId: "p1" }).ok, true);
    assert.equal(authorizeEmailRequest(finOnly, { to: ["x@y.com"], subject: "Custom", text: "Body" }).ok, false);
    assert.equal(authorizeEmailRequest(clubAdmin, { to: ["x@y.com"], subject: "Custom", text: "Body" }).ok, true);
    const clubDue = authorizeEmailRequest(clubAdmin, { action: "due_reminder", playerId: "p1" });
    assert.equal(clubDue.ok, false);
    if (!clubDue.ok) assert.equal(clubDue.status, 403);
    assert.equal(authorizeEmailRequest(superAdmin, { action: "due_reminder", playerId: "p1" }).ok, true);
  });

  it("FND-02-R1 & FND-03-R1: HTTP /api/email/send & /api/whatsapp/send enforce server-derived dues for all admin roles and reject manipulated/player requests", async () => {
    const { setServerDbForTesting } = await import("../lib/server-db.ts");
    setServerDbForTesting(db);

    const emailRoute = await import("../app/api/email/send/route.ts");
    const waRoute = await import("../app/api/whatsapp/send/route.ts");

    const origFetch = globalThis.fetch;
    const origResend = process.env.RESEND_API_KEY;
    const origWaPhone = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const origWaToken = process.env.WHATSAPP_ACCESS_TOKEN;

    process.env.RESEND_API_KEY = "re_test_mock_key";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "1234567890";
    process.env.WHATSAPP_ACCESS_TOKEN = "wa_test_mock_token";

    const capturedFetches = [];
    globalThis.fetch = async (url, init = {}) => {
      const urlStr = String(url);
      if (urlStr.includes("resend.com") || urlStr.includes("graph.facebook.com")) {
        capturedFetches.push({ url: urlStr, body: JSON.parse(String(init.body || "{}")) });
        return new Response(JSON.stringify({ id: "mock_msg_1", ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return origFetch(url, init);
    };

    try {
      const pid = uid("p");
      const m = uid("m");
      const payId = uid("pay");
      await Promise.all([
        db.collection("players").doc(pid).set({ name: "Real Player", email: "real@club.test", mobile: "9876543210" }),
        db.collection("matches").doc(m).set({ opponent: "Royals", fee: 500, result: "Pending" }),
        // Partial Paid record (200 paid of 500 -> 300 remaining)
        db.collection("payments").doc(payId).set({ matchId: m, playerId: pid, status: "Paid", feeCollectedAmount: 200 }),
      ]);

      const callRoute = async (handler, roles, body) => {
        const res = await handler(
          new Request("https://play.kavachcricket.com/api/test", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-test-uid": "actor_1",
              "x-test-roles": roles,
            },
            body: JSON.stringify(body),
          }),
        );
        return { status: res.status, json: await res.json().catch(() => ({})) };
      };

      // 1. Ordinary Player rejected (403) on both endpoints
      assert.equal((await callRoute(emailRoute.POST, "", { action: "due_reminder", playerId: pid })).status, 403);
      assert.equal((await callRoute(waRoute.POST, "", { action: "due_reminder", playerId: pid })).status, 403);

      // 2. Finance Admin and Super Admin get server-derived recipient/amount even if client sends manipulated fields
      for (const role of ["financeAdmin", "superAdmin"]) {
        capturedFetches.length = 0;
        const eRes = await callRoute(emailRoute.POST, role, {
          action: "due_reminder",
          playerId: pid,
          to: ["attacker@evil.test"],
          subject: "Hacked Subject",
          text: "Pay ₹1",
          html: "<b>Hacked</b>",
        });
        assert.equal(eRes.status, 200, `Email failed for ${role}`);
        assert.equal(capturedFetches.length, 1);
        assert.deepEqual(capturedFetches[0].body.to, ["real@club.test"]);
        assert.match(capturedFetches[0].body.subject, /300/);
        assert.doesNotMatch(capturedFetches[0].body.html || "", /Hacked/);

        capturedFetches.length = 0;
        const wRes = await callRoute(waRoute.POST, role, {
          action: "due_reminder",
          playerId: pid,
          to: "9999999999",
          name: "Fake Name",
          amount: 1,
          link: "https://evil.test",
        });
        assert.equal(wRes.status, 200, `WA failed for ${role}`);
        assert.equal(capturedFetches.length, 1);
        assert.equal(capturedFetches[0].body.to, "919876543210");
        const waParams = capturedFetches[0].body.template.components[0].parameters.map((p) => p.text);
        assert.deepEqual(waParams, ["Real Player", "300", `https://play.kavachcricket.com/pay/${pid}`]);
      }

      // 2b. Club Admin-only is denied (403) for due_reminder on both routes with zero provider calls
      capturedFetches.length = 0;
      const clubEmailDue = await callRoute(emailRoute.POST, "clubAdmin", {
        action: "due_reminder",
        playerId: pid,
      });
      assert.equal(clubEmailDue.status, 403);
      const clubWaDue = await callRoute(waRoute.POST, "clubAdmin", {
        action: "due_reminder",
        playerId: pid,
      });
      assert.equal(clubWaDue.status, 403);
      assert.equal(capturedFetches.length, 0);

      // 2c. Legitimate non-Finance Club Admin messaging remains permitted, while Finance Admin is denied non-Finance messaging
      capturedFetches.length = 0;
      const clubEmailAnnounce = await callRoute(emailRoute.POST, "clubAdmin", {
        to: ["real@club.test"],
        subject: "Match Squad Update",
        text: "Report at 7:00 AM.",
      });
      assert.equal(clubEmailAnnounce.status, 200);
      assert.equal(capturedFetches.length, 1);

      capturedFetches.length = 0;
      const clubWaCustom = await callRoute(waRoute.POST, "clubAdmin", {
        to: "9876543210",
        templateName: "squad_announcement",
        params: ["Match One"],
      });
      assert.equal(clubWaCustom.status, 200);
      assert.equal(capturedFetches.length, 1);

      capturedFetches.length = 0;
      assert.equal(
        (await callRoute(emailRoute.POST, "financeAdmin", {
          to: ["real@club.test"],
          subject: "Club News",
          text: "Hello",
        })).status,
        403,
      );
      assert.equal(
        (await callRoute(waRoute.POST, "financeAdmin", {
          to: "9876543210",
          templateName: "squad_announcement",
          params: ["Match One"],
        })).status,
        403,
      );
      assert.equal(capturedFetches.length, 0);

      // 3. Clearing the remaining balance causes authorized roles to reject (400) with zero provider calls
      await db.collection("payments").doc(payId).update({ feeCollectedAmount: 500 });
      capturedFetches.length = 0;
      assert.equal((await callRoute(emailRoute.POST, "financeAdmin", { action: "due_reminder", playerId: pid })).status, 400);
      assert.equal((await callRoute(waRoute.POST, "superAdmin", { action: "due_reminder", playerId: pid })).status, 400);
      assert.equal(capturedFetches.length, 0);

      // 4. Match-specific WhatsApp reminder resolves ONLY that match's outstanding balance
      const m1Id = "match_spec_1";
      const m2Id = "match_spec_2";
      await db.collection("matches").doc(m1Id).set({
        id: m1Id,
        opponent: "Match One",
        date: "2026-11-20",
        fee: 500,
        result: "Pending",
      });
      await db.collection("matches").doc(m2Id).set({
        id: m2Id,
        opponent: "Match Two",
        date: "2026-11-27",
        fee: 400,
        result: "Pending",
      });
      await db.collection("matches").doc(m1Id).collection("payments").doc("mp1").set({
        id: "mp1",
        matchId: m1Id,
        playerId: pid,
        status: "Unpaid",
      });
      await db.collection("matches").doc(m2Id).collection("payments").doc("mp2").set({
        id: "mp2",
        matchId: m2Id,
        playerId: pid,
        status: "Unpaid",
      });
      await db.collection("otherFees").doc("of1").set({
        id: "of1",
        playerId: pid,
        title: "No Show",
        amount: 200,
        status: "Unpaid",
      });

      capturedFetches.length = 0;
      const specRes = await callRoute(waRoute.POST, "financeAdmin", {
        action: "due_reminder",
        playerId: pid,
        matchId: m1Id,
        amount: 1, // ignored; server must compute 500
      });
      assert.equal(specRes.status, 200);
      assert.equal(capturedFetches.length, 1);
      const specParams = capturedFetches[0].body.template.components[0].parameters.map((p) => p.text);
      assert.deepEqual(specParams, ["Real Player", "500", `https://play.kavachcricket.com/pay/${pid}`]);
    } finally {
      globalThis.fetch = origFetch;
      if (origResend === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = origResend;
      if (origWaPhone === undefined) delete process.env.WHATSAPP_PHONE_NUMBER_ID;
      else process.env.WHATSAPP_PHONE_NUMBER_ID = origWaPhone;
      if (origWaToken === undefined) delete process.env.WHATSAPP_ACCESS_TOKEN;
      else process.env.WHATSAPP_ACCESS_TOKEN = origWaToken;
    }
  });
});
