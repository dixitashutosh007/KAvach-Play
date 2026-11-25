import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyMatchAvailability,
  computeMatchAvailabilityReadiness,
  hasExplicitAvailabilityResponse,
  resolveCanonicalPlayerPaymentRecord,
} from "../lib/match-readiness.ts";
import { derivePlayerAvailability } from "../lib/personal-match-payment.ts";

test("classifyMatchAvailability maps all MatchPayment.availability values accurately", () => {
  assert.equal(classifyMatchAvailability("Yes"), "confirmed");
  assert.equal(classifyMatchAvailability("Confirmed"), "confirmed");
  assert.equal(classifyMatchAvailability("Waitlist"), "confirmed");
  assert.equal(classifyMatchAvailability("Tentative"), "tentative");
  assert.equal(classifyMatchAvailability("No"), "not_playing");
  assert.equal(classifyMatchAvailability("Pending"), "unresponded");
  assert.equal(classifyMatchAvailability(undefined), "unresponded");
  assert.equal(classifyMatchAvailability(null), "unresponded");
});

test("hasExplicitAvailabilityResponse treats Waitlist and Yes as explicit responses, not unresponded", () => {
  assert.equal(hasExplicitAvailabilityResponse("Yes"), true);
  assert.equal(hasExplicitAvailabilityResponse("Confirmed"), true);
  assert.equal(hasExplicitAvailabilityResponse("Waitlist"), true);
  assert.equal(hasExplicitAvailabilityResponse("Tentative"), true);
  assert.equal(hasExplicitAvailabilityResponse("No"), true);
  assert.equal(hasExplicitAvailabilityResponse("Pending"), false);
  assert.equal(hasExplicitAvailabilityResponse(undefined), false);
});

test("computeMatchAvailabilityReadiness reconciles mutually exclusive counts against eligible players", () => {
  const players = [
    { id: "p1", disabled: false, inviteStatus: "Accepted" }, // Yes
    { id: "p2", disabled: false, inviteStatus: "Verified" }, // Confirmed
    { id: "p3", disabled: false, inviteStatus: "Accepted" }, // Waitlist
    { id: "p4", disabled: false, inviteStatus: "Accepted" }, // Tentative
    { id: "p5", disabled: false, inviteStatus: "Accepted" }, // No
    { id: "p6", disabled: false, inviteStatus: "Accepted" }, // Pending
    { id: "p7", disabled: false, inviteStatus: "Accepted" }, // Missing record
    { id: "p8", disabled: true, inviteStatus: "Accepted" },  // Disabled (excluded)
    { id: "p9", disabled: false, inviteStatus: "Pending" },  // Pending registration (excluded)
    { id: "p10", disabled: false, inviteStatus: "Rejected" }, // Rejected (excluded)
  ];

  const payments = [
    { id: "pay1", playerId: "p1", status: "Not Playing", availability: "Yes" },
    { id: "pay2", playerId: "p2", status: "Unpaid", availability: "Confirmed" },
    { id: "pay3", playerId: "p3", status: "Not Playing", availability: "Waitlist" },
    { id: "pay4", playerId: "p4", status: "Not Playing", availability: "Tentative" },
    { id: "pay5", playerId: "p5", status: "Not Playing", availability: "No" },
    { id: "pay6", playerId: "p6", status: "Not Playing", availability: "Pending" },
  ];

  const r = computeMatchAvailabilityReadiness(players, payments);
  assert.equal(r.eligibleCount, 7);
  assert.equal(r.confirmedCount, 3);
  assert.equal(r.tentativeCount, 1);
  assert.equal(r.notPlayingCount, 1);
  assert.equal(r.unrespondedCount, 2);
  assert.equal(
    r.confirmedCount + r.tentativeCount + r.notPlayingCount + r.unrespondedCount,
    r.eligibleCount,
  );
  assert.equal(r.squadCount, 1);
});

test("computeMatchAvailabilityReadiness does not treat squad membership as availability if availability is Pending", () => {
  const players = [{ id: "p1", disabled: false, inviteStatus: "Accepted" }];
  const payments = [{ id: "pay1", playerId: "p1", status: "Unpaid", availability: "Pending" }];
  const r = computeMatchAvailabilityReadiness(players, payments);
  assert.equal(r.squadCount, 1);
  assert.equal(r.confirmedCount, 0);
  assert.equal(r.unrespondedCount, 1);
});

test("resolveCanonicalPlayerPaymentRecord ignores guest records and is order-independent", () => {
  const players = [{ id: "p1", disabled: false, inviteStatus: "Accepted" }];
  const records = [
    { id: "guest-1", playerId: "p1", guestName: "Guest of P1", status: "Unpaid", availability: "Confirmed", updatedAt: { seconds: 5000 } },
    { id: "primary-pending", playerId: "p1", status: "Not Playing", availability: "Pending", updatedAt: { seconds: 1000 } },
    { id: "primary-explicit", playerId: "p1", status: "Unpaid", availability: "Tentative", updatedAt: { seconds: 2000 } },
  ];

  const forward = resolveCanonicalPlayerPaymentRecord("p1", records);
  const reversed = resolveCanonicalPlayerPaymentRecord("p1", [...records].reverse());
  assert.equal(forward?.id, "primary-explicit");
  assert.equal(reversed?.id, "primary-explicit");

  const rForward = computeMatchAvailabilityReadiness(players, records);
  const rReversed = computeMatchAvailabilityReadiness(players, [...records].reverse());
  assert.deepEqual(rForward, rReversed);
  assert.equal(rForward.tentativeCount, 1);
  assert.equal(rForward.confirmedCount, 0);

  // If ONLY a guest record exists, canonical resolver returns null so guest records are never mutated as player availability
  assert.equal(resolveCanonicalPlayerPaymentRecord("p1", [records[0]]), null);
});

test("derivePlayerAvailability and admin readiness agree for Paid + No/Tentative/Confirmed/Waitlist", () => {
  const match = { id: "m1", date: "2026-12-01", opponent: "Titans", format: "T20", fee: 600 };
  const player = { id: "p1", name: "Test Player", disabled: false, inviteStatus: "Accepted" };

  // Paid + No -> Not Playing on both player & admin views
  const paidNo = [{ id: "pay1", matchId: "m1", playerId: "p1", status: "Paid", availability: "No" }];
  assert.equal(derivePlayerAvailability(player, match, paidNo).status, "Not Playing");
  assert.equal(derivePlayerAvailability(player, match, paidNo).isOut, true);
  assert.equal(computeMatchAvailabilityReadiness([player], paidNo).notPlayingCount, 1);

  // Paid + Tentative -> Maybe / Tentative on both views
  const paidTent = [{ id: "pay1", matchId: "m1", playerId: "p1", status: "Paid", availability: "Tentative" }];
  assert.equal(derivePlayerAvailability(player, match, paidTent).status, "Maybe");
  assert.equal(derivePlayerAvailability(player, match, paidTent).isMaybe, true);
  assert.equal(computeMatchAvailabilityReadiness([player], paidTent).tentativeCount, 1);

  // Paid + Confirmed -> Playing / Confirmed on both views
  const paidConf = [{ id: "pay1", matchId: "m1", playerId: "p1", status: "Paid", availability: "Confirmed" }];
  assert.equal(derivePlayerAvailability(player, match, paidConf).status, "Playing");
  assert.equal(derivePlayerAvailability(player, match, paidConf).isConfirmed, true);
  assert.equal(computeMatchAvailabilityReadiness([player], paidConf).confirmedCount, 1);

  // Paid + Waitlist -> Waitlist (Playing, isConfirmed) / Confirmed on both views
  const paidWait = [{ id: "pay1", matchId: "m1", playerId: "p1", status: "Paid", availability: "Waitlist" }];
  assert.equal(derivePlayerAvailability(player, match, paidWait).badgeLabel, "Waitlist");
  assert.equal(derivePlayerAvailability(player, match, paidWait).isConfirmed, true);
  assert.equal(computeMatchAvailabilityReadiness([player], paidWait).confirmedCount, 1);
});
