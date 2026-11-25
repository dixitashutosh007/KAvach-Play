import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyMatchAvailability,
  computeMatchAvailabilityReadiness,
  hasExplicitAvailabilityResponse,
} from "../lib/match-readiness.ts";

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
    { playerId: "p1", status: "Not Playing", availability: "Yes" },
    { playerId: "p2", status: "Unpaid", availability: "Confirmed" },
    { playerId: "p3", status: "Not Playing", availability: "Waitlist" },
    { playerId: "p4", status: "Not Playing", availability: "Tentative" },
    { playerId: "p5", status: "Not Playing", availability: "No" },
    { playerId: "p6", status: "Not Playing", availability: "Pending" },
    // p7 has no payment record at all -> Unresponded
  ];

  const r = computeMatchAvailabilityReadiness(players, payments);
  assert.equal(r.eligibleCount, 7);
  assert.equal(r.confirmedCount, 3); // p1 (Yes), p2 (Confirmed), p3 (Waitlist)
  assert.equal(r.tentativeCount, 1); // p4
  assert.equal(r.notPlayingCount, 1); // p5
  assert.equal(r.unrespondedCount, 2); // p6 (Pending), p7 (missing)
  assert.equal(
    r.confirmedCount + r.tentativeCount + r.notPlayingCount + r.unrespondedCount,
    r.eligibleCount,
  );
  // Squad count is tracked independently from availability
  assert.equal(r.squadCount, 1); // only p2 has status !== "Not Playing"
});

test("computeMatchAvailabilityReadiness does not treat squad membership as availability if availability is Pending", () => {
  const players = [
    { id: "p1", disabled: false, inviteStatus: "Accepted" },
  ];
  const payments = [
    { playerId: "p1", status: "Unpaid", availability: "Pending" },
  ];
  const r = computeMatchAvailabilityReadiness(players, payments);
  assert.equal(r.squadCount, 1);
  assert.equal(r.confirmedCount, 0);
  assert.equal(r.unrespondedCount, 1);
});
