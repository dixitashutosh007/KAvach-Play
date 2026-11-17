/**
 * FIN-001 Server-Side Payment Tampering & Ownership Security Tests
 * (tests/razorpay-tamper.test.mjs)
 *
 * Verifies:
 * 1. Strict Currency Validation (only INR permitted)
 * 2. Player Ownership & Delegation Verification
 * 3. Authoritative derivation of payable match fees & late fees (client amount ignored)
 * 4. Rejection of already-paid, waived, or abandoned match obligations
 * 5. Batch dues deduplication (preventing duplicate charging/mutation)
 * 6. Merchandise catalog pricing & player binding
 *
 * Imports directly from production: @/lib/razorpay-order
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateCurrency,
  verifyPlayerOwnership,
  calculateAuthoritativeMerchPrice,
  derivePayableAmount,
} from "../lib/razorpay-order.ts";

// ── 1. Currency Validation ───────────────────────────────────────────────────

describe("FIN-001: Currency Validation", () => {
  it("accepts 'INR' and case-insensitive 'inr'", () => {
    assert.equal(validateCurrency("INR"), true);
    assert.equal(validateCurrency("inr"), true);
  });

  it("rejects non-INR currencies (USD, EUR, GBP)", () => {
    assert.equal(validateCurrency("USD"), false);
    assert.equal(validateCurrency("EUR"), false);
    assert.equal(validateCurrency("GBP"), false);
    assert.equal(validateCurrency(""), false);
    assert.equal(validateCurrency(null), false);
  });
});

// ── 2. Player Ownership Verification ─────────────────────────────────────────

describe("FIN-001: Player Ownership Verification", () => {
  const mockDb = {
    collection: (col) => ({
      doc: (id) => ({
        get: async () => {
          if (col === "players") {
            if (id === "player_linked") return { exists: true, data: () => ({ authUid: "auth_user_1" }) };
            if (id === "player_other") return { exists: true, data: () => ({ authUid: "auth_other" }) };
          }
          if (col === "appUsers") {
            if (id === "auth_user_2") return { exists: true, data: () => ({ playerId: "player_profile_2" }) };
          }
          return { exists: false, data: () => null };
        },
      }),
    }),
  };

  it("authorizes when authUid directly matches targetPlayerId", async () => {
    assert.equal(await verifyPlayerOwnership(mockDb, "user_123", "user_123"), true);
  });

  it("authorizes when players doc authUid links to caller", async () => {
    assert.equal(await verifyPlayerOwnership(mockDb, "auth_user_1", "player_linked"), true);
  });

  it("authorizes when appUsers doc playerId links to targetPlayerId", async () => {
    assert.equal(await verifyPlayerOwnership(mockDb, "auth_user_2", "player_profile_2"), true);
  });

  it("rejects unlinked foreign player IDs", async () => {
    assert.equal(await verifyPlayerOwnership(mockDb, "auth_user_1", "player_other"), false);
    assert.equal(await verifyPlayerOwnership(mockDb, "auth_user_1", "player_unknown"), false);
  });
});

// ── 3. Authoritative Merchandise Pricing ─────────────────────────────────────

describe("FIN-001: Merchandise Pricing Catalogue Integrity", () => {
  const catalogueJersey = {
    basePrice: 850,
    customFields: [
      {
        name: "Size",
        options: [
          { value: "M", priceModifierType: "None" },
          { value: "XXL", priceModifierType: "Add", priceModifierValue: 100 },
        ],
      },
      {
        name: "Custom Print",
        options: [
          { value: "Name & Number", priceModifierType: "Add", priceModifierValue: 150 },
          { value: "Plain", priceModifierType: "None" },
        ],
      },
    ],
  };

  it("calculates exact base price without modifiers", () => {
    const price = calculateAuthoritativeMerchPrice(catalogueJersey, { Size: "M", "Custom Print": "Plain" });
    assert.equal(price, 850);
  });

  it("applies legitimate modifiers server-side", () => {
    const price = calculateAuthoritativeMerchPrice(catalogueJersey, { Size: "XXL", "Custom Print": "Name & Number" });
    assert.equal(price, 1100); // 850 + 100 + 150
  });

  it("ignores tampered or non-existent custom field values", () => {
    const price = calculateAuthoritativeMerchPrice(catalogueJersey, { Size: "INVALID_SIZE", HackedField: "FREE" });
    assert.equal(price, 850);
  });
});

// ── 4. derivePayableAmount Security & Tampering Resistance ───────────────────

describe("FIN-001: derivePayableAmount Server-Side Safeguards", () => {
  const mockDb = {
    collection: (col) => ({
      doc: (id) => ({
        get: async () => {
          if (col === "matches") {
            if (id === "m_normal") return { exists: true, data: () => ({ fee: 500, date: "2026-03-01", opponent: "Rivals CC" }) };
            if (id === "m_abandoned") return { exists: true, data: () => ({ fee: 500, date: "2026-03-01", abandoned: true }) };
          }
          if (col === "players") {
            if (id === "player_1") return { exists: true, data: () => ({ authUid: "auth_1" }) };
          }
          return { exists: false, data: () => null };
        },
        collection: (subCol) => ({
          doc: (subId) => ({
            get: async () => {
              if (col === "matches" && subCol === "payments") {
                if (subId === "pay_paid") return { exists: true, data: () => ({ playerId: "player_1", status: "Paid" }) };
                if (subId === "pay_waived") return { exists: true, data: () => ({ playerId: "player_1", status: "Waived" }) };
                if (subId === "pay_other_player") return { exists: true, data: () => ({ playerId: "player_2", status: "Unpaid" }) };
                if (subId === "pay_legit") return { exists: true, data: () => ({ playerId: "player_1", status: "Unpaid", feeOverride: 400 }) };
              }
              if (col === "players" && subCol === "otherFees") {
                if (subId === "fee_paid") return { exists: true, data: () => ({ amount: 150, status: "Paid" }) };
                if (subId === "fee_unpaid") return { exists: true, data: () => ({ amount: 200, status: "Unpaid" }) };
              }
              return { exists: false, data: () => null };
            },
          }),
        }),
      }),
    }),
  };

  it("rejects payments for abandoned matches", async () => {
    await assert.rejects(
      () => derivePayableAmount(mockDb, "auth_1", { type: "match", matchId: "m_abandoned", paymentId: "pay_legit" }),
      /Match has been abandoned/
    );
  });

  it("rejects payments already marked as Paid", async () => {
    await assert.rejects(
      () => derivePayableAmount(mockDb, "auth_1", { type: "match", matchId: "m_normal", paymentId: "pay_paid" }),
      /Match fee is already marked as Paid/
    );
  });

  it("rejects payments marked as Waived", async () => {
    await assert.rejects(
      () => derivePayableAmount(mockDb, "auth_1", { type: "match", matchId: "m_normal", paymentId: "pay_waived" }),
      /Match fee obligation is waived/
    );
  });

  it("rejects unauthorized attempts to pay another player's match obligation", async () => {
    await assert.rejects(
      () => derivePayableAmount(mockDb, "auth_1", { type: "match", matchId: "m_normal", paymentId: "pay_other_player" }),
      /Unauthorized: you cannot initiate payment for another player's obligation/
    );
  });

  it("correctly derives payable fee using feeOverride over default match fee", async () => {
    const res = await derivePayableAmount(mockDb, "auth_1", {
      type: "match",
      matchId: "m_normal",
      paymentId: "pay_legit",
    });
    assert.equal(res.amount, 400); // feeOverride: 400 instead of default 500
    assert.equal(res.verifiedIntent.playerId, "player_1");
  });

  it("rejects unauthorized finance_dues for foreign player IDs", async () => {
    await assert.rejects(
      () => derivePayableAmount(mockDb, "auth_1", {
        type: "finance_dues",
        playerId: "player_unlinked_evil",
        items: [{ type: "other", feeId: "fee_unpaid" }],
      }),
      /Unauthorized: you cannot initiate payment for another player's dues/
    );
  });

  it("deduplicates duplicate dues items within the same batch", async () => {
    const res = await derivePayableAmount(mockDb, "auth_1", {
      type: "finance_dues",
      playerId: "player_1",
      items: [
        { type: "match", matchId: "m_normal", paymentId: "pay_legit" },
        { type: "match", matchId: "m_normal", paymentId: "pay_legit" }, // Duplicate!
      ],
    });
    // Should only be counted once
    assert.equal(res.amount, 400);
    assert.equal(res.verifiedIntent.items.length, 1);
  });
});
