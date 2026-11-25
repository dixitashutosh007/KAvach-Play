import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { derivePayableAmount } from "../lib/razorpay-order.ts";

function makeFakeDb(collections) {
  return {
    collection(name) {
      const col = collections[name] || {};
      return {
        doc(id) {
          return {
            async get() {
              const data = col[id];
              return data ? { exists: true, id, data: () => data } : { exists: false, id, data: () => undefined };
            },
          };
        },
      };
    },
  };
}

describe("Phase 1 Workstream B: Merchandise Order & Payment Integrity", () => {
  const baseDb = () =>
    makeFakeDb({
      appUsers: {
        uid1: { playerId: "p1", status: "Active" },
      },
      players: {
        p1: { id: "p1", name: "Player One", authUid: "uid1" },
      },
      merchandises: {
        jersey1: {
          id: "jersey1",
          name: "Official Jersey",
          basePrice: 1200,
          status: "Accepting Orders",
          customFields: [
            {
              name: "Sleeve",
              required: true,
              options: [
                { value: "Half", priceModifierType: "None", priceModifierValue: 0 },
                { value: "Full", priceModifierType: "Add", priceModifierValue: 200 },
              ],
            },
          ],
        },
        closed1: {
          id: "closed1",
          name: "Closed Cap",
          basePrice: 500,
          status: "Not Accepting Orders",
        },
        hidden1: {
          id: "hidden1",
          name: "Hidden Jacket",
          basePrice: 1500,
          status: "Accepting Orders",
          isHidden: true,
        },
      },
      merchOrders: {
        evil_untrusted: {
          id: "evil_untrusted",
          playerId: "p1",
          merchId: "jersey1",
          price: 1,
          paymentStatus: "Unpaid",
          orderStatus: "Order Placed",
        },
        manual_underpriced: {
          id: "manual_underpriced",
          playerId: "p1",
          merchId: "jersey1",
          price: 1,
          isManual: true,
          paymentStatus: "Unpaid",
          orderStatus: "Order Placed",
        },
        manual_valid_offline: {
          id: "manual_valid_offline",
          playerId: "p1",
          merchId: "jersey1",
          price: 1400,
          isManual: true,
          paymentStatus: "Unpaid",
          orderStatus: "Order Placed",
        },
        server_tampered_snapshot: {
          id: "server_tampered_snapshot",
          playerId: "p1",
          merchId: "jersey1",
          customSelections: { Sleeve: "Full" },
          price: 1200,
          priceSnapshot: { unitPrice: 1200, quantity: 1, totalAmount: 1200, currency: "INR" },
          trustedSource: "server",
          intentId: "intent_tampered",
          paymentStatus: "Unpaid",
          orderStatus: "Order Placed",
        },
        server_valid_unpaid: {
          id: "server_valid_unpaid",
          playerId: "p1",
          merchId: "jersey1",
          customSelections: { Sleeve: "Full" },
          price: 1400,
          priceSnapshot: { unitPrice: 1400, quantity: 1, totalAmount: 1400, currency: "INR" },
          trustedSource: "server",
          intentId: "intent_valid_1",
          paymentStatus: "Failed",
          orderStatus: "Order Placed",
        },
        other_player_order: {
          id: "other_player_order",
          playerId: "p2",
          merchId: "jersey1",
          price: 1200,
          trustedSource: "server",
          intentId: "intent_p2",
          priceSnapshot: { unitPrice: 1200, quantity: 1, totalAmount: 1200, currency: "INR" },
          paymentStatus: "Unpaid",
        },
      },
    });

  it("calculates authoritative merch_order price + custom selection and stores server snapshot", async () => {
    const res = await derivePayableAmount(baseDb(), "uid1", {
      type: "merch_order",
      merchId: "jersey1",
      orderPayload: {
        playerId: "p1",
        merchId: "jersey1",
        price: 1,
        customPriceAdditions: 0,
        customSelections: { Sleeve: "Full" },
      },
    });
    assert.equal(res.amount, 1400);
    assert.equal(res.verifiedIntent.orderPayload.price, 1400);
    assert.equal(res.verifiedIntent.orderPayload.customPriceAdditions, 200);
    assert.equal(res.verifiedIntent.orderPayload.trustedSource, "server");
    assert.deepEqual(res.verifiedIntent.orderPayload.priceSnapshot, {
      unitPrice: 1400,
      quantity: 1,
      totalAmount: 1400,
      currency: "INR",
    });
  });

  it("rejects inactive or hidden merchandise", async () => {
    await assert.rejects(
      derivePayableAmount(baseDb(), "uid1", {
        type: "merch_order",
        merchId: "closed1",
        orderPayload: { playerId: "p1", merchId: "closed1" },
      }),
      /not currently available/i,
    );
    await assert.rejects(
      derivePayableAmount(baseDb(), "uid1", {
        type: "merch_order",
        merchId: "hidden1",
        orderPayload: { playerId: "p1", merchId: "hidden1" },
      }),
      /not currently available/i,
    );
  });

  it("rejects invalid quantity and invalid custom selections", async () => {
    await assert.rejects(
      derivePayableAmount(baseDb(), "uid1", {
        type: "merch_order",
        merchId: "jersey1",
        orderPayload: { playerId: "p1", merchId: "jersey1", quantity: 2, customSelections: { Sleeve: "Half" } },
      }),
      /quantity/i,
    );
    await assert.rejects(
      derivePayableAmount(baseDb(), "uid1", {
        type: "merch_order",
        merchId: "jersey1",
        orderPayload: { playerId: "p1", merchId: "jersey1", customSelections: { Sleeve: "Sleeveless" } },
      }),
      /Invalid selection/i,
    );
  });

  it("rejects untrusted and manual (isManual: true) merchOrders in finance_dues", async () => {
    for (const id of ["evil_untrusted", "manual_underpriced", "manual_valid_offline", "server_tampered_snapshot"]) {
      await assert.rejects(
        derivePayableAmount(baseDb(), "uid1", {
          type: "finance_dues",
          playerId: "p1",
          items: [{ type: "merch", merchId: id }],
        }),
        /Total calculated payable dues must be greater than zero/i,
        `Expected ${id} to be rejected in finance_dues`,
      );
    }
  });

  it("rejects another player's merchOrder in finance_dues", async () => {
    await assert.rejects(
      derivePayableAmount(baseDb(), "uid1", {
        type: "finance_dues",
        playerId: "p1",
        items: [{ type: "merch", merchId: "other_player_order" }],
      }),
      /Total calculated payable dues must be greater than zero/i,
    );
  });

  it("allows valid server-created merchOrders with matching catalogue price & snapshot in finance_dues", async () => {
    const res = await derivePayableAmount(baseDb(), "uid1", {
      type: "finance_dues",
      playerId: "p1",
      items: [{ type: "merch", merchId: "server_valid_unpaid" }],
    });
    assert.equal(res.amount, 1400);
  });
});
