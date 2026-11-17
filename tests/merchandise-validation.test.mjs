/**
 * Merchandise Customisation Validation Tests
 * (tests/merchandise-validation.test.mjs)
 *
 * Verifies:
 * 1. Valid custom selections with price modifiers are correctly calculated.
 * 2. Unknown custom selection fields are rejected with an explicit error.
 * 3. Missing mandatory custom fields are rejected with an explicit error.
 * 4. Invalid/manipulated option values are rejected with an explicit error.
 * 5. Invalid selections are never silently ignored to charge a lower price.
 *
 * Imports directly from production: @/lib/razorpay-order.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calculateAuthoritativeMerchPrice } from "../lib/razorpay-order.ts";

describe("Merchandise Customisation Validation", () => {
  const catalogueJersey = {
    id: "jersey_pro_2026",
    name: "Official Match Jersey",
    basePrice: 800, // ₹800
    customFields: [
      {
        name: "size",
        label: "Size",
        required: true,
        options: [
          { label: "S", value: "S", priceModifierType: "None" },
          { label: "M", value: "M", priceModifierType: "None" },
          { label: "L", value: "L", priceModifierType: "None" },
          { label: "XL", value: "XL", priceModifierType: "Add", priceModifierValue: 50 },
          { label: "XXL", value: "XXL", priceModifierType: "Add", priceModifierValue: 100 },
        ],
      },
      {
        name: "sleeve",
        label: "Sleeve Type",
        required: true,
        options: [
          { label: "Half Sleeve", value: "half", priceModifierType: "None" },
          { label: "Full Sleeve", value: "full", priceModifierType: "Add", priceModifierValue: 120 },
        ],
      },
      {
        name: "collar",
        label: "Collar Style",
        required: false,
        options: [
          { label: "Standard", value: "std", priceModifierType: "None" },
          { label: "Mandarin Collar", value: "mandarin", priceModifierType: "Add", priceModifierValue: 70 },
        ],
      },
    ],
  };

  it("calculates correct base price with standard selections", () => {
    const selections = {
      size: "M",
      sleeve: "half",
    };
    const price = calculateAuthoritativeMerchPrice(catalogueJersey, selections);
    assert.equal(price, 800);
  });

  it("adds price modifiers correctly for upgraded options", () => {
    const selections = {
      size: "XXL", // +100
      sleeve: "full", // +120
      collar: "mandarin", // +70
    };
    const price = calculateAuthoritativeMerchPrice(catalogueJersey, selections);
    assert.equal(price, 800 + 100 + 120 + 70); // ₹1090
  });

  it("rejects unknown custom selection fields (anti-tampering)", () => {
    const selections = {
      size: "M",
      sleeve: "half",
      unauthorizedDiscountCode: "FREE_SHIRT",
    };
    assert.throws(
      () => calculateAuthoritativeMerchPrice(catalogueJersey, selections),
      /Unknown merchandise custom selection field: 'unauthorizedDiscountCode'/,
    );
  });

  it("rejects missing mandatory custom fields", () => {
    const selections = {
      size: "M",
      // missing sleeve!
    };
    assert.throws(
      () => calculateAuthoritativeMerchPrice(catalogueJersey, selections),
      /Missing required merchandise selection for 'sleeve'/,
    );
  });

  it("rejects empty or whitespace-only mandatory selections", () => {
    const selections = {
      size: "M",
      sleeve: "   ",
    };
    assert.throws(
      () => calculateAuthoritativeMerchPrice(catalogueJersey, selections),
      /Missing required merchandise selection for 'sleeve'/,
    );
  });

  it("rejects invalid or manipulated option values", () => {
    const selections = {
      size: "XXXXXL_CUSTOM",
      sleeve: "half",
    };
    assert.throws(
      () => calculateAuthoritativeMerchPrice(catalogueJersey, selections),
      /Invalid selection 'XXXXXL_CUSTOM' for field 'size'/,
    );
  });

  it("never silently ignores invalid selections to charge a lower price", () => {
    const manipulatedSelections = {
      size: "XXL",
      sleeve: "invalid_hacked_value",
    };
    assert.throws(
      () => calculateAuthoritativeMerchPrice(catalogueJersey, manipulatedSelections),
      /Invalid selection 'invalid_hacked_value' for field 'sleeve'/,
    );
  });

  it("rejects invalid merchandise object or non-positive base price", () => {
    assert.throws(
      () => calculateAuthoritativeMerchPrice(null, {}),
      /Invalid merchandise item/,
    );
    assert.throws(
      () => calculateAuthoritativeMerchPrice({ basePrice: 0 }, {}),
      /Invalid merchandise base price/,
    );
  });
});
