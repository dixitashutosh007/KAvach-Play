import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import fs from "node:fs";
import path from "node:path";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { POST as clubStatsPOST } from "../app/api/admin/club-stats/route.ts";
import { POST as paymentActionPOST } from "../app/api/admin/matches/payment-action/route.ts";
import { POST as shopOrdersPOST } from "../app/api/shop/orders/route.ts";
import { POST as auditLogPOST } from "../app/api/audit/log/route.ts";
import { getServerFirestore } from "../lib/server-db.ts";

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const skipReason = !emulatorHost
  ? "FIRESTORE_EMULATOR_HOST not set (run via emulator)"
  : false;

function jsonReq(url, body, uid, roles) {
  const headers = { "content-type": "application/json" };
  if (uid) headers["x-test-uid"] = uid;
  if (roles) headers["x-test-roles"] = roles;
  return new Request(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("Phase 1 Round 3: Final Security, Authz Matrix, Idempotency Isolation & Shop Integrity (Emulator)", { skip: skipReason }, () => {
  let db;

  before(async () => {
    if (!emulatorHost) return;
    process.env.NODE_ENV = "test";
    process.env.KAVACH_TEST_AUTH_BYPASS = "true";
    process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID = "ai-studio-cae01507-23c3-4ee4-92c8-848c4cf7d412";
    db = getServerFirestore();

    await db.doc("appUsers/u_club_1").set({ uid: "u_club_1", name: "Club Admin One", isClubAdmin: true, accountStatus: "active" });
    await db.doc("appUsers/u_club_2").set({ uid: "u_club_2", name: "Club Admin Two", isClubAdmin: true, accountStatus: "active" });
    await db.doc("appUsers/u_fin_1").set({ uid: "u_fin_1", name: "Finance Admin One", isFinanceAdmin: true, accountStatus: "active" });
    await db.doc("appUsers/u_super_1").set({ uid: "u_super_1", name: "Super Admin One", isSuperAdmin: true, accountStatus: "active" });
    await db.doc("appUsers/u_player_1").set({ uid: "u_player_1", name: "Player One", role: "player", playerId: "p_1", accountStatus: "active" });
    await db.doc("players/p_1").set({ id: "p_1", name: "Player One", inviteStatus: "Verified" });
    await db.doc("players/p_2").set({ id: "p_2", name: "Player Two", inviteStatus: "Verified" });
    await db.doc("appConfig/default").set({ features: { shop: true } });
    await db.doc("merchandises/m_jersey").set({
      id: "m_jersey",
      name: "Match Jersey",
      price: 1200,
      available: true,
      customOptions: [
        { label: "Sleeve", choices: [{ label: "Half", price: 0 }, { label: "Full", price: 200 }] },
      ],
    });
    await db.doc("merchandises/m_cap").set({
      id: "m_cap",
      name: "Club Cap",
      price: 400,
      available: true,
    });
    await db.doc("merchandises/m_oos").set({
      id: "m_oos",
      name: "Out of Stock Cap",
      price: 500,
      available: false,
    });
    await db.doc("merchandises/m_archived").set({
      id: "m_archived",
      name: "Archived Tee",
      price: 600,
      isArchived: true,
    });
    await db.doc("merchandises/m_neg_opt").set({
      id: "m_neg_opt",
      name: "Neg Opt Jersey",
      price: 1000,
      available: true,
      customOptions: [{ label: "Discount", choices: [{ label: "Bad", price: -100 }] }],
    });
    await db.doc("merchandises/m_neg_base").set({
      id: "m_neg_base",
      name: "Neg Base",
      price: -50,
      available: true,
    });
    await db.doc("merchandises/m_moq").set({
      id: "m_moq",
      name: "MOQ Kit",
      price: 900,
      minOrderQuantity: 10,
      available: true,
      customFields: [
        {
          name: "Collar",
          required: true,
          options: [
            { value: "Polo", priceModifierType: "Add", priceModifierValue: 100 },
            { value: "Round", priceModifierType: "Add", priceModifierValue: 0 },
          ],
        },
      ],
    });
  });

  it("Round 3 (1): /api/shop/orders forces paymentStatus='Unpaid' for Player, Club Admin, Finance Admin, and Super Admin even when Paid is spoofed", async () => {
    const callers = [
      { uid: "u_player_1", roles: "player", label: "Player" },
      { uid: "u_club_1", roles: "clubAdmin", label: "Club Admin" },
      { uid: "u_fin_1", roles: "financeAdmin", label: "Finance Admin" },
      { uid: "u_super_1", roles: "superAdmin", label: "Super Admin" },
    ];
    for (const c of callers) {
      const r = await shopOrdersPOST(
        jsonReq(
          "http://localhost/api/shop/orders",
          {
            merchId: "m_jersey",
            playerId: "p_1",
            quantity: 1,
            customSelections: { Sleeve: "Half" },
            isManual: true,
            paymentStatus: "Paid",
            price: 1,
            razorpayPaymentId: "pay_spoof",
            idempotencyKey: `k_spoof_${c.uid}_${Date.now()}`,
          },
          c.uid,
          c.roles,
        ),
      );
      assert.equal(r.status, 200, `${c.label} order creation should succeed`);
      const body = await r.json();
      assert.equal(body.paymentStatus, "Unpaid", `${c.label} must default to Unpaid`);
      assert.equal(body.price, 1200, `${c.label} must use server price 1200`);
      const saved = await db.doc(`merchOrders/${body.id}`).get();
      assert.equal(saved.data()?.paymentStatus, "Unpaid");
      assert.equal(saved.data()?.razorpayPaymentId, undefined);
    }
  });

  it("Round 3 (2a): Club Admin squad add/remove/Unpaid allowed; Paid/Waived denied (403); cross-match payment denied (404)", async () => {
    const matchA = `m_auth_a_${Date.now()}`;
    const matchB = `m_auth_b_${Date.now()}`;
    await db.doc(`matches/${matchA}`).set({ id: matchA, opponent: "Match A", date: "2026-12-05", fee: 600 });
    await db.doc(`matches/${matchB}`).set({ id: matchB, opponent: "Match B", date: "2026-12-06", fee: 600 });

    // Club Admin adds p_1 to matchA
    const rAdd = await paymentActionPOST(
      jsonReq("http://localhost/api/admin/matches/payment-action", { action: "addSquadPlayer", matchId: matchA, paymentId: "pay_a1", playerId: "p_1", status: "Unpaid", idempotencyKey: `k_add_${Date.now()}` }, "u_club_1", "clubAdmin"),
    );
    assert.equal(rAdd.status, 200);

    // Club Admin removes p_1 from squad (Not Playing)
    const rRem = await paymentActionPOST(
      jsonReq("http://localhost/api/admin/matches/payment-action", { action: "updatePaymentStatus", matchId: matchA, paymentId: "pay_a1", status: "Not Playing", idempotencyKey: `k_rem_${Date.now()}` }, "u_club_1", "clubAdmin"),
    );
    assert.equal(rRem.status, 200);

    // Club Admin marks p_1 Unpaid
    const rUnpaid = await paymentActionPOST(
      jsonReq("http://localhost/api/admin/matches/payment-action", { action: "updatePaymentStatus", matchId: matchA, paymentId: "pay_a1", status: "Unpaid", idempotencyKey: `k_unp_${Date.now()}` }, "u_club_1", "clubAdmin"),
    );
    assert.equal(rUnpaid.status, 200);

    // Club Admin CANNOT mark Paid or Waived (403)
    for (const s of ["Paid", "Waived"]) {
      const k = `k_forb_${s}_${Date.now()}`;
      const rForbid = await paymentActionPOST(
        jsonReq("http://localhost/api/admin/matches/payment-action", { action: "updatePaymentStatus", matchId: matchA, paymentId: "pay_a1", status: s, idempotencyKey: k }, "u_club_1", "clubAdmin"),
      );
      assert.equal(rForbid.status, 403);
    }

    // Club Admin attempting to modify matchA's payment via matchB returns 404 (match-scoped subcollection)
    const rCross = await paymentActionPOST(
      jsonReq("http://localhost/api/admin/matches/payment-action", { action: "updatePaymentStatus", matchId: matchB, paymentId: "pay_a1", status: "Not Playing", idempotencyKey: `k_cross_${Date.now()}` }, "u_club_1", "clubAdmin"),
    );
    assert.equal(rCross.status, 404);
  });

  it("Round 3 (2b): Finance Admin permitted payment ops; Finance Admin denied club-stats (403); Player denied payment-action & cross-player shop order (403)", async () => {
    const matchId = `m_fin_${Date.now()}`;
    await db.doc(`matches/${matchId}`).set({ id: matchId, opponent: "Fin XI", date: "2026-12-05", fee: 600 });

    await paymentActionPOST(
      jsonReq("http://localhost/api/admin/matches/payment-action", { action: "addSquadPlayer", matchId, paymentId: "pay_f1", playerId: "p_1", status: "Unpaid", idempotencyKey: `kf1_${Date.now()}` }, "u_club_1", "clubAdmin"),
    );
    await paymentActionPOST(
      jsonReq("http://localhost/api/admin/matches/payment-action", { action: "addSquadPlayer", matchId, paymentId: "pay_f2", playerId: "p_2", status: "Unpaid", idempotencyKey: `kf2_${Date.now()}` }, "u_club_1", "clubAdmin"),
    );

    // Finance Admin permitted ops: proxy (on Unpaid pay_f1) -> clearFeeOverride -> Paid -> legacy plan
    assert.equal((await paymentActionPOST(jsonReq("http://localhost/api/admin/matches/payment-action", { action: "assignProxyPayment", matchId, sourcePaymentId: "pay_f1", targetPlayerId: "p_2", idempotencyKey: `k_px_${Date.now()}` }, "u_fin_1", "financeAdmin"))).status, 200);
    assert.equal((await paymentActionPOST(jsonReq("http://localhost/api/admin/matches/payment-action", { action: "clearFeeOverride", matchId, paymentId: "pay_f1", idempotencyKey: `k_cl_${Date.now()}` }, "u_fin_1", "financeAdmin"))).status, 200);
    assert.equal((await paymentActionPOST(jsonReq("http://localhost/api/admin/matches/payment-action", { action: "updatePaymentStatus", matchId, paymentId: "pay_f1", status: "Paid", feeCollectedAmount: 600, idempotencyKey: `k_p_${Date.now()}` }, "u_fin_1", "financeAdmin"))).status, 200);
    assert.equal((await paymentActionPOST(jsonReq("http://localhost/api/admin/matches/payment-action", { action: "applyLegacyPlan", matchId, paymentId: "pay_f2", feeOverride: 250, planTag: "Youth", status: "Unpaid", idempotencyKey: `k_lg_${Date.now()}` }, "u_fin_1", "financeAdmin"))).status, 200);

    // Finance Admin denied club-stats (403)
    const rFinClub = await clubStatsPOST(
      jsonReq("http://localhost/api/admin/club-stats", { matchesPlayed: 10, matchesWon: 5 }, "u_fin_1", "financeAdmin"),
    );
    assert.equal(rFinClub.status, 403);

    // Player denied payment-action (own or other player) (403)
    const rPlayerPay = await paymentActionPOST(
      jsonReq("http://localhost/api/admin/matches/payment-action", { action: "updatePaymentStatus", matchId, paymentId: "pay_f2", status: "Paid" }, "u_player_1", "player"),
    );
    assert.equal(rPlayerPay.status, 403);

    // Player denied shop order for another player (403)
    const rPlayerOrder = await shopOrdersPOST(
      jsonReq("http://localhost/api/shop/orders", { merchId: "m_jersey", playerId: "p_2", quantity: 1, customSelections: { Sleeve: "Half" } }, "u_player_1", "player"),
    );
    assert.equal(rPlayerOrder.status, 403);
  });

  it("Round 3 (2c): Player self-availability (Unpaid <-> Not Playing) permitted under Firestore rules while Paid/cross-player denied", async () => {
    const [host, portStr] = emulatorHost.split(":");
    const rules = fs.readFileSync(path.resolve("firestore.rules"), "utf8");
    const testEnv = await initializeTestEnvironment({
      projectId: `rules-r3-${Date.now()}`,
      firestore: { host, port: Number(portStr), rules },
    });

    try {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const adm = ctx.firestore();
        await adm.doc("appUsers/u_p1").set({ uid: "u_p1", playerId: "p_1", status: "Active" });
        await adm.doc("players/p_1").set({ id: "p_1", name: "Player 1", disabled: false });
        await adm.doc("players/p_2").set({ id: "p_2", name: "Player 2", disabled: false });
        await adm.doc("matches/m_r1").set({ id: "m_r1", opponent: "Rules XI", date: "2026-12-10", financeStatus: "open" });
        await adm.doc("matches/m_r1/payments/pay_1").set({ id: "pay_1", matchId: "m_r1", playerId: "p_1", status: "Not Playing", availability: "No", createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
        await adm.doc("matches/m_r1/payments/pay_2").set({ id: "pay_2", matchId: "m_r1", playerId: "p_2", status: "Unpaid", availability: "Yes", createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      });

      const p1Db = testEnv.authenticatedContext("u_p1").firestore();
      // Allowed: self availability Not Playing -> Unpaid + availability: "Yes"
      await assertSucceeds(updateDoc(doc(p1Db, "matches/m_r1/payments/pay_1"), { status: "Unpaid", availability: "Yes", updatedAt: serverTimestamp() }));
      // Denied: self marking Paid
      await assertFails(updateDoc(doc(p1Db, "matches/m_r1/payments/pay_1"), { status: "Paid", updatedAt: serverTimestamp() }));
      // Denied: modifying another player's payment/availability
      await assertFails(updateDoc(doc(p1Db, "matches/m_r1/payments/pay_2"), { status: "Not Playing", availability: "No", updatedAt: serverTimestamp() }));
    } finally {
      await testEnv.cleanup();
    }
  });

  it("Round 3 (3): Idempotency isolation — scoped to actor, operation, and resource; detects payload mismatch (409)", async () => {
    const sharedKey = `shared_key_${Date.now()}`;
    const match1 = `m_iso1_${Date.now()}`;
    const match2 = `m_iso2_${Date.now()}`;
    await db.doc(`matches/${match1}`).set({ id: match1, opponent: "Iso 1", date: "2026-12-05", fee: 600 });
    await db.doc(`matches/${match2}`).set({ id: match2, opponent: "Iso 2", date: "2026-12-06", fee: 600 });

    // 1. Concurrent same actor, same key, same payload (club-stats) -> 1 write, all 200
    const concStats = await Promise.all(
      Array.from({ length: 3 }, () =>
        clubStatsPOST(jsonReq("http://localhost/api/admin/club-stats", { matchesPlayed: 30, matchesWon: 18, idempotencyKey: sharedKey }, "u_club_1", "clubAdmin")),
      ),
    );
    for (const r of concStats) assert.equal(r.status, 200);

    // 2. Retry after lost response -> 200 deduplicated
    const rRetry = await clubStatsPOST(
      jsonReq("http://localhost/api/admin/club-stats", { matchesPlayed: 30, matchesWon: 18, idempotencyKey: sharedKey }, "u_club_1", "clubAdmin"),
    );
    assert.equal(rRetry.status, 200);
    assert.equal((await rRetry.json()).deduplicated, true);

    // 3. Same actor, same key, DIFFERENT payload -> 409
    const rDiffPayload = await clubStatsPOST(
      jsonReq("http://localhost/api/admin/club-stats", { matchesPlayed: 99, matchesWon: 50, idempotencyKey: sharedKey }, "u_club_1", "clubAdmin"),
    );
    assert.equal(rDiffPayload.status, 409);

    // 4. DIFFERENT actor (u_club_2), SAME key -> succeeds independently (NOT deduplicated!)
    const rDiffActor = await clubStatsPOST(
      jsonReq("http://localhost/api/admin/club-stats", { matchesPlayed: 40, matchesWon: 22, idempotencyKey: sharedKey }, "u_club_2", "clubAdmin"),
    );
    assert.equal(rDiffActor.status, 200);
    assert.notEqual((await rDiffActor.json()).deduplicated, true);

    // 5. DIFFERENT operation (payment-action), SAME actor, SAME key -> succeeds independently
    const rDiffOp = await paymentActionPOST(
      jsonReq("http://localhost/api/admin/matches/payment-action", { action: "addSquadPlayer", matchId: match1, paymentId: "pay_iso1", playerId: "p_1", status: "Unpaid", idempotencyKey: sharedKey }, "u_club_1", "clubAdmin"),
    );
    assert.equal(rDiffOp.status, 200);
    assert.notEqual((await rDiffOp.json()).deduplicated, true);

    // 6. DIFFERENT resource (match2), SAME actor, SAME operation, SAME key -> succeeds independently
    const rDiffRes = await paymentActionPOST(
      jsonReq("http://localhost/api/admin/matches/payment-action", { action: "addSquadPlayer", matchId: match2, paymentId: "pay_iso2", playerId: "p_1", status: "Unpaid", idempotencyKey: sharedKey }, "u_club_1", "clubAdmin"),
    );
    assert.equal(rDiffRes.status, 200);
    assert.notEqual((await rDiffRes.json()).deduplicated, true);

    // Verify independent audit doc exists for u_club_2
    const hashClub2 = crypto.createHash("sha256").update(`u_club_2:club_stats:clubStats:${sharedKey}`).digest("hex").slice(0, 32);
    assert.equal((await db.doc(`auditLogs/club_stats_${hashClub2}`).get()).exists, true);
  });

  it("Round 3 (4): Shop data integrity — server customOption pricing, archived/OOS rejection, concurrent retries return original order", async () => {
    assert.equal((await shopOrdersPOST(jsonReq("http://localhost/api/shop/orders", { merchId: "m_oos", playerId: "p_1", quantity: 1 }, "u_player_1", "player"))).status, 409);
    assert.equal((await shopOrdersPOST(jsonReq("http://localhost/api/shop/orders", { merchId: "m_archived", playerId: "p_1", quantity: 1 }, "u_player_1", "player"))).status, 409);
    assert.equal((await shopOrdersPOST(jsonReq("http://localhost/api/shop/orders", { merchId: "m_none", playerId: "p_1", quantity: 1 }, "u_player_1", "player"))).status, 404);

    const kShop = `k_shop_int_${Date.now()}`;
    const r1 = await shopOrdersPOST(
      jsonReq("http://localhost/api/shop/orders", { merchId: "m_jersey", playerId: "p_1", quantity: 2, customSelections: { Sleeve: "Full" }, price: 5, idempotencyKey: kShop }, "u_player_1", "player"),
    );
    assert.equal(r1.status, 200);
    const b1 = await r1.json();
    assert.equal(b1.price, 2800);

    // Retry returns original order ID
    const rRetry = await shopOrdersPOST(
      jsonReq("http://localhost/api/shop/orders", { merchId: "m_jersey", playerId: "p_1", quantity: 2, customSelections: { Sleeve: "Full" }, idempotencyKey: kShop }, "u_player_1", "player"),
    );
    assert.equal(rRetry.status, 200);
    const bRetry = await rRetry.json();
    assert.equal(bRetry.deduplicated, true);
    assert.equal(bRetry.id, b1.id);
  });

  it("Round 3 (5a): Closed match rolls back payment-action and writes no misleading audit", async () => {
    const matchId = `m_closed_aud_${Date.now()}`;
    await db.doc(`matches/${matchId}`).set({ id: matchId, opponent: "Closed XI", date: "2026-12-06", financeStatus: "closed" });

    const kFail = `k_closed_fail_${Date.now()}`;
    const r = await paymentActionPOST(
      jsonReq("http://localhost/api/admin/matches/payment-action", { action: "addSquadPlayer", matchId, paymentId: "pay_closed", playerId: "p_1", idempotencyKey: kFail }, "u_club_1", "clubAdmin"),
    );
    assert.equal(r.status, 409);
    assert.equal((await db.doc(`matches/${matchId}/payments/pay_closed`).get()).exists, false);
    const hFail = crypto.createHash("sha256").update(`u_club_1:addSquadPlayer:${matchId}:pay_closed:${kFail}`).digest("hex").slice(0, 32);
    assert.equal((await db.doc(`auditLogs/payact_${hFail}`).get()).exists, false);
  });

  it("Round 3 (5b): /api/audit/log rejects all restricted entities (payment, player_stat, club_stats, shop, fee_plan_assignment, user_role) with 403", async () => {
    for (const restricted of ["payment", "player_stat", "club_stats", "shop", "fee_plan_assignment", "user_role"]) {
      const r = await auditLogPOST(
        jsonReq("http://localhost/api/audit/log", { action: "updated", entity: restricted, entityId: "x1", summary: "spoof" }, "u_fin_1", "financeAdmin"),
      );
      assert.equal(r.status, 403, `Entity ${restricted} must remain 403 on /api/audit/log`);
    }
  });

  it("Round 3 (5c): AuditEntity and AuditLogTab expose club_stats, player_stat, and shop distinctly", () => {
    const auditLib = fs.readFileSync(path.resolve("lib/auditLog.ts"), "utf8");
    const auditTab = fs.readFileSync(path.resolve("components/AuditLogTab.tsx"), "utf8");
    assert.match(auditLib, /"club_stats"/);
    assert.match(auditLib, /"player_stat"/);
    assert.match(auditLib, /"shop"/);
    assert.match(auditTab, /value: "club_stats"/);
    assert.match(auditTab, /value: "player_stat"/);
    assert.match(auditTab, /value: "shop"/);
  });

  it("Round 4 (1-4 & 11): Proxy payment ignores client amounts, rejects cross-match/self/duplicate/circular sponsorship, and audits both sides", async () => {
    const mA = `m_px_a_${Date.now()}`;
    const mB = `m_px_b_${Date.now()}`;
    await db.doc(`matches/${mA}`).set({ id: mA, opponent: "Proxy A", date: "2026-12-08", fee: 700 });
    await db.doc(`matches/${mB}`).set({ id: mB, opponent: "Proxy B", date: "2026-12-09", fee: 700 });
    await db.doc("players/p_3").set({ id: "p_3", name: "Player Three", inviteStatus: "Verified" });

    await paymentActionPOST(jsonReq("http://localhost/api/admin/matches/payment-action", { action: "addSquadPlayer", matchId: mA, paymentId: "pa_1", playerId: "p_1", status: "Unpaid" }, "u_club_1", "clubAdmin"));
    await paymentActionPOST(jsonReq("http://localhost/api/admin/matches/payment-action", { action: "addSquadPlayer", matchId: mA, paymentId: "pa_2", playerId: "p_2", status: "Unpaid" }, "u_club_1", "clubAdmin"));
    await paymentActionPOST(jsonReq("http://localhost/api/admin/matches/payment-action", { action: "addSquadPlayer", matchId: mA, paymentId: "pa_3", playerId: "p_3", status: "Unpaid" }, "u_club_1", "clubAdmin"));
    await paymentActionPOST(jsonReq("http://localhost/api/admin/matches/payment-action", { action: "addSquadPlayer", matchId: mB, paymentId: "pb_1", playerId: "p_1", status: "Unpaid" }, "u_club_1", "clubAdmin"));

    // 3. Same source and target player -> 400
    const rSelf = await paymentActionPOST(
      jsonReq("http://localhost/api/admin/matches/payment-action", { action: "assignProxyPayment", matchId: mA, sourcePaymentId: "pa_1", targetPlayerId: "p_1" }, "u_fin_1", "financeAdmin"),
    );
    assert.equal(rSelf.status, 400);

    // 2. Cross-match payment record (pb_1 belongs to mB, not mA) -> 404
    const rCrossMatch = await paymentActionPOST(
      jsonReq("http://localhost/api/admin/matches/payment-action", { action: "assignProxyPayment", matchId: mA, sourcePaymentId: "pb_1", targetPlayerId: "p_2" }, "u_fin_1", "financeAdmin"),
    );
    assert.equal(rCrossMatch.status, 404);

    // 1 & 11. Manipulated sourceFee=1 / matchFee=1 ignored; server derives 700 + 700 = 1400 and audits both sides
    const kPx = `k_px_r4_${Date.now()}`;
    const rPx = await paymentActionPOST(
      jsonReq("http://localhost/api/admin/matches/payment-action", { action: "assignProxyPayment", matchId: mA, sourcePaymentId: "pa_1", targetPlayerId: "p_2", sourceFee: 1, matchFee: 1, idempotencyKey: kPx }, "u_fin_1", "financeAdmin"),
    );
    assert.equal(rPx.status, 200);
    const pxBody = await rPx.json();
    assert.equal(pxBody.sourceFee, 700);
    assert.equal(pxBody.newTargetFee, 1400);

    const pxHash = crypto.createHash("sha256").update(`u_fin_1:assignProxyPayment:${mA}:pa_1:${kPx}`).digest("hex").slice(0, 32);
    const pxAudit = await db.doc(`auditLogs/payact_${pxHash}`).get();
    const pxFields = (pxAudit.data()?.changes || []).map((c) => c.field);
    assert.ok(pxFields.includes("source.sponsoredBy"));
    assert.ok(pxFields.includes("source.feeOverride"));
    assert.ok(pxFields.includes("source.status"));
    assert.ok(pxFields.includes("target.feeOverride"));
    assert.ok(pxFields.includes("target.sponsoring"));

    // 4a. Duplicate sponsorship of pa_1 -> 409
    const rDupSponsor = await paymentActionPOST(
      jsonReq("http://localhost/api/admin/matches/payment-action", { action: "assignProxyPayment", matchId: mA, sourcePaymentId: "pa_1", targetPlayerId: "p_3" }, "u_fin_1", "financeAdmin"),
    );
    assert.equal(rDupSponsor.status, 409);

    // 4b. Circular sponsorship: p_2 is already sponsoring p_1, so p_2 cannot be sponsored by p_3 -> 409
    const rCirc1 = await paymentActionPOST(
      jsonReq("http://localhost/api/admin/matches/payment-action", { action: "assignProxyPayment", matchId: mA, sourcePaymentId: "pa_2", targetPlayerId: "p_3" }, "u_fin_1", "financeAdmin"),
    );
    assert.equal(rCirc1.status, 409);

    // 4c. Circular sponsorship: p_3 cannot be sponsored by p_1 (who is already sponsored) -> 409
    const rCirc2 = await paymentActionPOST(
      jsonReq("http://localhost/api/admin/matches/payment-action", { action: "assignProxyPayment", matchId: mA, sourcePaymentId: "pa_3", targetPlayerId: "p_1" }, "u_fin_1", "financeAdmin"),
    );
    assert.equal(rCirc2.status, 409);
  });

  it("Round 4 (5-7 & 9-10): Shop validates custom options, rejects negative prices, enforces server orderStatus, checks player linking, and detects idempotency hash changes", async () => {
    // 5. Unknown custom option key -> 400; invalid choice -> 400
    assert.equal((await shopOrdersPOST(jsonReq("http://localhost/api/shop/orders", { merchId: "m_moq", playerId: "p_1", customSelections: { Collar: "Polo", UnknownKey: "X" } }, "u_player_1", "player"))).status, 400);
    assert.equal((await shopOrdersPOST(jsonReq("http://localhost/api/shop/orders", { merchId: "m_moq", playerId: "p_1", customSelections: { Collar: "InvalidChoice" } }, "u_player_1", "player"))).status, 400);

    // 6. Missing required option -> 400
    assert.equal((await shopOrdersPOST(jsonReq("http://localhost/api/shop/orders", { merchId: "m_moq", playerId: "p_1" }, "u_player_1", "player"))).status, 400);

    // 7. Negative option price -> 409; negative base price -> 409
    assert.equal((await shopOrdersPOST(jsonReq("http://localhost/api/shop/orders", { merchId: "m_neg_opt", playerId: "p_1", customSelections: { Discount: "Bad" } }, "u_player_1", "player"))).status, 409);
    assert.equal((await shopOrdersPOST(jsonReq("http://localhost/api/shop/orders", { merchId: "m_neg_base", playerId: "p_1" }, "u_player_1", "player"))).status, 409);

    // 10. Nonexistent playerId (admin -> 404; player -> 403)
    assert.equal((await shopOrdersPOST(jsonReq("http://localhost/api/shop/orders", { merchId: "m_cap", playerId: "p_nonexistent" }, "u_club_1", "clubAdmin"))).status, 404);
    assert.equal((await shopOrdersPOST(jsonReq("http://localhost/api/shop/orders", { merchId: "m_cap", playerId: "p_nonexistent" }, "u_player_1", "player"))).status, 403);

    // 9. Server-authoritative orderStatus (MOQ=10 -> Awaiting Min Order Qnty even if client sends Ready to Place Order) + idempotency mismatch on accepted field (size)
    const kMoq = `k_moq_${Date.now()}`;
    const rMoq = await shopOrdersPOST(
      jsonReq("http://localhost/api/shop/orders", { merchId: "m_moq", playerId: "p_1", quantity: 1, size: "M", customSelections: { Collar: "Polo" }, orderStatus: "Ready to Place Order", idempotencyKey: kMoq }, "u_player_1", "player"),
    );
    assert.equal(rMoq.status, 200);
    const moqBody = await rMoq.json();
    assert.equal(moqBody.price, 1000);
    assert.equal(moqBody.orderStatus, "Awaiting Min Order Qnty");

    const rMoqDiffSize = await shopOrdersPOST(
      jsonReq("http://localhost/api/shop/orders", { merchId: "m_moq", playerId: "p_1", quantity: 1, size: "L", customSelections: { Collar: "Polo" }, idempotencyKey: kMoq }, "u_player_1", "player"),
    );
    assert.equal(rMoqDiffSize.status, 409);
  });

  it("Round 4 (8 & P2): payment-action derives manualBy server-side and detects idempotency mismatch on paymentMethod / feeOffsetAmount", async () => {
    const matchId = `m_meta_${Date.now()}`;
    await db.doc(`matches/${matchId}`).set({ id: matchId, opponent: "Meta XI", date: "2026-12-10", fee: 500 });
    await paymentActionPOST(jsonReq("http://localhost/api/admin/matches/payment-action", { action: "addSquadPlayer", matchId, paymentId: "pm_1", playerId: "p_1", status: "Unpaid" }, "u_club_1", "clubAdmin"));

    const kMeta = `k_meta_${Date.now()}`;
    const r1 = await paymentActionPOST(
      jsonReq("http://localhost/api/admin/matches/payment-action", { action: "updatePaymentStatus", matchId, paymentId: "pm_1", status: "Paid", paymentMethod: "manual", manualBy: "Spoofed Admin", feeOffsetAmount: 50, feeCollectedAmount: 450, idempotencyKey: kMeta }, "u_fin_1", "financeAdmin"),
    );
    assert.equal(r1.status, 200);

    // Verify manualBy was derived from server actor ("Finance Admin One"), NOT "Spoofed Admin"
    const pDoc = await db.doc(`matches/${matchId}/payments/pm_1`).get();
    assert.equal(pDoc.data()?.manualBy, "Finance Admin One");

    // Verify idempotency mismatch when paymentMethod or feeOffsetAmount changes -> 409
    const rDiffMethod = await paymentActionPOST(
      jsonReq("http://localhost/api/admin/matches/payment-action", { action: "updatePaymentStatus", matchId, paymentId: "pm_1", status: "Paid", paymentMethod: "razorpay", feeOffsetAmount: 50, feeCollectedAmount: 450, idempotencyKey: kMeta }, "u_fin_1", "financeAdmin"),
    );
    assert.equal(rDiffMethod.status, 409);

    const rDiffOffset = await paymentActionPOST(
      jsonReq("http://localhost/api/admin/matches/payment-action", { action: "updatePaymentStatus", matchId, paymentId: "pm_1", status: "Paid", paymentMethod: "manual", feeOffsetAmount: 100, feeCollectedAmount: 450, idempotencyKey: kMeta }, "u_fin_1", "financeAdmin"),
    );
    assert.equal(rDiffOffset.status, 409);
  });
});
