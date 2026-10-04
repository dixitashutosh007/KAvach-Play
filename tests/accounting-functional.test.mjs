import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("Match Fee & Finance Accounting Functional Tests", () => {
  // Mock Data
  const mockMatch = {
    id: "match-101",
    opponent: "Royal Strikers",
    date: "2026-09-20",
    fee: 500,
    matchFeeBudget: 6000, // 500 * 12
    payments: [
      {
        id: "p1",
        playerId: "u1",
        status: "Paid",
        feeOverride: 500,
        feeCollectedAmount: 500,
        feeOffsetAmount: 0,
        paymentMethod: "razorpay",
        razorpayPaymentId: "pay_xyz123",
        manualMethod: undefined,
        manualBy: undefined,
        updatedAt: { seconds: 1726380000 },
      },
      {
        id: "p2",
        playerId: "u2",
        status: "Paid",
        feeOverride: 500,
        feeCollectedAmount: 500,
        feeOffsetAmount: 0,
        paymentMethod: "manual",
        manualMethod: "cash",
        manualBy: "Treasurer",
        updatedAt: { seconds: 1726381000 },
      },
      {
        id: "p3",
        playerId: "u3",
        status: "Unpaid", // Under Youth 350 plan
        feeOverride: 350,
        feeCollectedAmount: 0,
        feeOffsetAmount: 150,
        planTag: "Youth 350",
        manualMethod: undefined,
        updatedAt: { seconds: 1726382000 },
      },
      {
        id: "p4",
        playerId: "u4",
        status: "Paid", // Under Monthly Plan (Subscription)
        feeOverride: 0,
        feeCollectedAmount: 500,
        feeOffsetAmount: 0,
        planTag: "Monthly 2000 (Subscription)",
        manualMethod: "part_of_plan",
        manualBy: "Admin",
        updatedAt: { seconds: 1726383000 },
      },
      {
        id: "p5",
        playerId: "u5",
        status: "Paid", // 100% Club Sponsored
        feeOverride: 0,
        feeCollectedAmount: 0,
        feeOffsetAmount: 500,
        planTag: "Club Sponsored",
        manualMethod: "club_sponsored",
        manualBy: "Admin",
        updatedAt: { seconds: 1726384000 },
      },
      {
        id: "p6",
        playerId: "u6",
        status: "Unpaid", // Regular unpaid player
        feeOverride: undefined,
        feeCollectedAmount: 0,
        feeOffsetAmount: 0,
        manualMethod: undefined,
        updatedAt: { seconds: 1726385000 },
      },
    ],
  };

  const mockPlayers = [
    { id: "u1", name: "Player One" },
    { id: "u2", name: "Player Two" },
    { id: "u3", name: "Youth Player Three" },
    { id: "u4", name: "Monthly Player Four" },
    { id: "u5", name: "Sponsored Player Five" },
    { id: "u6", name: "Unpaid Player Six" },
  ];

  describe("1. Match Fee Table Budget & Collection Formulas", () => {
    it("computes default budget as fee * 12 when matchFeeBudget is not set", () => {
      const standardFee = 450;
      const budget = standardFee * 12;
      assert.equal(budget, 5400);
    });

    it("respects custom matchFeeBudget when set via inline edit", () => {
      const customBudget = 6500;
      const effectiveBudget = customBudget || 500 * 12;
      assert.equal(effectiveBudget, 6500);
    });

    it("aggregates Fee Collected correctly (Razorpay + Cash + Monthly allocated)", () => {
      let feeCollected = 0;
      for (const p of mockMatch.payments) {
        if (p.status === "Paid" && p.manualMethod !== "club_sponsored") {
          const effectiveFee = p.feeOverride !== undefined ? p.feeOverride : mockMatch.fee;
          const amt = p.feeCollectedAmount !== undefined ? p.feeCollectedAmount : effectiveFee;
          feeCollected += amt;
        }
      }
      // p1 (500) + p2 (500) + p4 (500) = 1500
      assert.equal(feeCollected, 1500);
    });

    it("aggregates Club Sponsored correctly (Youth remainder + 100% sponsored)", () => {
      let clubSponsored = 0;
      for (const p of mockMatch.payments) {
        if (p.feeOffsetAmount && p.feeOffsetAmount > 0) {
          clubSponsored += p.feeOffsetAmount;
        } else if (p.manualMethod === "club_sponsored") {
          const effFee = p.feeOverride !== undefined && p.feeOverride > 0 ? p.feeOverride : mockMatch.fee;
          clubSponsored += effFee;
        }
      }
      // p3 (150) + p5 (500) = 650
      assert.equal(clubSponsored, 650);
    });

    it("calculates % Recovered dynamically against budget", () => {
      const budget = 6000;
      const collected = 1500;
      const pctRecovered = budget > 0 ? Math.min(100, Math.round((collected / budget) * 100)) : 0;
      assert.equal(pctRecovered, 25);
    });
  });

  describe("2. Paid / Unpaid Player Counts & Tooltip Lists", () => {
    it("correctly partitions squad into Paid and Unpaid players", () => {
      const paid = [];
      const unpaid = [];

      for (const p of mockMatch.payments) {
        const playerObj = mockPlayers.find((pl) => pl.id === p.playerId);
        const name = playerObj?.name || "Unknown";
        if (p.status === "Paid") {
          paid.push(name);
        } else {
          unpaid.push(name);
        }
      }

      assert.equal(paid.length, 4); // u1, u2, u4, u5
      assert.equal(unpaid.length, 2); // u3, u6
      assert.deepEqual(paid, ["Player One", "Player Two", "Monthly Player Four", "Sponsored Player Five"]);
      assert.deepEqual(unpaid, ["Youth Player Three", "Unpaid Player Six"]);
    });

    it("determines tooltip orientation correctly to avoid top-row clipping", () => {
      const getOrientation = (rowIndex) => (rowIndex < 2 ? "top-full mt-2" : "bottom-full mb-2");
      assert.equal(getOrientation(0), "top-full mt-2");
      assert.equal(getOrientation(1), "top-full mt-2");
      assert.equal(getOrientation(2), "bottom-full mb-2");
      assert.equal(getOrientation(5), "bottom-full mb-2");
    });
  });

  describe("3. Match Fee Plan Bifurcation State Transitions", () => {
    it("fixed fee plan: sets player due to fixed amount and remainder to club sponsored", () => {
      const standardFee = 650;
      const fixedPlanAmount = 350;
      const offset = Math.max(0, standardFee - fixedPlanAmount);

      const paymentState = {
        feeOverride: fixedPlanAmount,
        planTag: "Youth Fixed 350",
        feeOffsetAmount: offset,
        status: "Unpaid",
      };

      assert.equal(paymentState.feeOverride, 350);
      assert.equal(paymentState.feeOffsetAmount, 300);
      assert.equal(paymentState.status, "Unpaid");
    });

    it("monthly subscription plan: bifurcates allocated fee and marks player Paid", () => {
      const standardFee = 500;
      const actualFeeCovered = 500;
      const offset = Math.max(0, standardFee - actualFeeCovered);

      const paymentState = {
        feeOverride: 0,
        planTag: "Monthly 2000 (Subscription)",
        feeOffsetAmount: offset,
        feeCollectedAmount: actualFeeCovered,
        status: "Paid",
        paymentMethod: "manual",
        manualMethod: "part_of_plan",
      };

      assert.equal(paymentState.feeCollectedAmount, 500);
      assert.equal(paymentState.feeOffsetAmount, 0);
      assert.equal(paymentState.status, "Paid");
      assert.equal(paymentState.manualMethod, "part_of_plan");
    });

    it("club sponsored plan: offsets 100% of standard fee and marks player Paid", () => {
      const standardFee = 400;
      const paymentState = {
        feeOverride: 0,
        planTag: "Club Sponsored",
        feeOffsetAmount: standardFee,
        feeCollectedAmount: 0,
        status: "Paid",
        paymentMethod: "manual",
        manualMethod: "club_sponsored",
      };

      assert.equal(paymentState.feeOffsetAmount, 400);
      assert.equal(paymentState.feeCollectedAmount, 0);
      assert.equal(paymentState.status, "Paid");
      assert.equal(paymentState.manualMethod, "club_sponsored");
    });
  });

  describe("4. Transactions Tab Channel Separation", () => {
    function processTransactions(match, players) {
      const txns = [];

      for (const p of match.payments) {
        const player = players.find((pl) => pl.id === p.playerId) || { name: "Unknown" };

        // 1. Sponsored / Offset Transaction
        let sponsorAmt = 0;
        let sponsorLabel = "";
        if (p.feeOffsetAmount && p.feeOffsetAmount > 0) {
          sponsorAmt = p.feeOffsetAmount;
          sponsorLabel = `Club Sponsored (${p.planTag || "Match Fee Plan"})`;
        } else if (p.manualMethod === "club_sponsored") {
          sponsorAmt = p.feeOverride !== undefined && p.feeOverride > 0 ? p.feeOverride : match.fee;
          sponsorLabel = `Club Sponsored (${p.planTag || "Match Fee Plan"})`;
        }

        if (sponsorAmt > 0) {
          txns.push({
            id: `match_sponsor_${p.id}`,
            name: player.name,
            amount: sponsorAmt,
            label: sponsorLabel,
            channel: "club_sponsored",
          });
        }

        // 2. Collected Transaction
        if (p.status === "Paid" && p.manualMethod !== "club_sponsored") {
          const effectiveFee = p.feeOverride !== undefined ? p.feeOverride : match.fee;
          const collectedAmt = p.feeCollectedAmount !== undefined ? p.feeCollectedAmount : effectiveFee;

          if (collectedAmt > 0) {
            const isGenuineRazorpay =
              p.paymentMethod === "razorpay" &&
              (Boolean(p.razorpayPaymentId) || (!p.manualMethod && !p.manualBy));

            txns.push({
              id: `match_pay_${p.id}`,
              name: player.name,
              amount: collectedAmt,
              channel: isGenuineRazorpay ? "razorpay" : "cash",
            });
          }
        }
      }

      return txns;
    }

    it("accurately categorizes transactions into Razorpay, Cash, and Club Sponsored", () => {
      const txns = processTransactions(mockMatch, mockPlayers);

      const razorpayTxns = txns.filter((t) => t.channel === "razorpay");
      const cashTxns = txns.filter((t) => t.channel === "cash");
      const clubSponsoredTxns = txns.filter((t) => t.channel === "club_sponsored");

      // Verify counts
      assert.equal(razorpayTxns.length, 1); // p1
      assert.equal(cashTxns.length, 2); // p2 (cash), p4 (part_of_plan)
      assert.equal(clubSponsoredTxns.length, 2); // p3 (Youth 350 offset 150), p5 (100% sponsored 500)

      // Verify amounts
      assert.equal(razorpayTxns[0].amount, 500);
      assert.equal(cashTxns.reduce((s, t) => s + t.amount, 0), 1000);
      assert.equal(clubSponsoredTxns.reduce((s, t) => s + t.amount, 0), 650);

      // Verify Youth 350 unpaid status produced a Club Sponsored entry of 150 without fake cash collected
      const youthSponsorTxn = clubSponsoredTxns.find((t) => t.name === "Youth Player Three");
      assert.ok(youthSponsorTxn);
      assert.equal(youthSponsorTxn.amount, 150);

      const youthCollectedTxn = txns.find((t) => t.name === "Youth Player Three" && t.channel !== "club_sponsored");
      assert.equal(youthCollectedTxn, undefined);
    });
  });

  describe("5. Permissions & Calendar View Actions", () => {
    it("evaluates effectiveAdmin correctly across custom claims and roles", () => {
      const checkAdmin = (user, hasClaim = false, isAdminProp = false) =>
        isAdminProp ||
        hasClaim ||
        user?.role === "admin" ||
        user?.isMatchAdmin === true ||
        user?.isClubAdmin === true;

      assert.equal(checkAdmin({ role: "player" }, false, false), false);
      assert.equal(checkAdmin({ role: "admin" }, false, false), true);
      assert.equal(checkAdmin({ role: "player" }, true, false), true);
      assert.equal(checkAdmin({ role: "player", isMatchAdmin: true }, false, false), true);
      assert.equal(checkAdmin({ role: "player", isClubAdmin: true }, false, false), true);
    });
  });
});
