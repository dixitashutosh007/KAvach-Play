import test from "node:test";
import assert from "node:assert/strict";
import { authorizeEmailRequest } from "../lib/email-auth.ts";

const baseDueReminder = {
  action: "due_reminder",
  to: ["player@example.com"],
  subject: "Pending Fee Reminder",
  text: "You have ₹650 pending.",
};

const arbitraryEmail = {
  to: ["anyone@example.com"],
  subject: "Club Announcement",
  text: "Arbitrary message",
};

test("authorizeEmailRequest permits Finance Admin strictly for due_reminder", () => {
  const financeRoles = { superAdmin: false, clubAdmin: false, financeAdmin: true };

  const ok = authorizeEmailRequest(financeRoles, baseDueReminder);
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.isFinanceDueReminderOnly, true);

  // Arbitrary email without action: "due_reminder" is rejected
  const denied = authorizeEmailRequest(financeRoles, arbitraryEmail);
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.status, 403);

  // Multi-recipient bulk arbitrary broadcast is rejected for Finance Admin
  const multiRecipient = authorizeEmailRequest(financeRoles, {
    ...baseDueReminder,
    to: ["a@example.com", "b@example.com"],
  });
  assert.equal(multiRecipient.ok, false);
  if (!multiRecipient.ok) assert.equal(multiRecipient.status, 400);
});

test("authorizeEmailRequest permits Super Admin for all emails, and scopes Club Admin to non-Finance emails", () => {
  const clubRoles = { superAdmin: false, clubAdmin: true, financeAdmin: false };
  const superRoles = { superAdmin: true, clubAdmin: false, financeAdmin: false };

  const clubArbitrary = authorizeEmailRequest(clubRoles, arbitraryEmail);
  assert.equal(clubArbitrary.ok, true);
  if (clubArbitrary.ok) assert.equal(clubArbitrary.isFinanceDueReminderOnly, false);

  const clubDueReminder = authorizeEmailRequest(clubRoles, baseDueReminder);
  assert.equal(clubDueReminder.ok, false);
  if (!clubDueReminder.ok) assert.equal(clubDueReminder.status, 403);

  const superArbitrary = authorizeEmailRequest(superRoles, arbitraryEmail);
  assert.equal(superArbitrary.ok, true);
  if (superArbitrary.ok) assert.equal(superArbitrary.isFinanceDueReminderOnly, false);

  const superDueReminder = authorizeEmailRequest(superRoles, baseDueReminder);
  assert.equal(superDueReminder.ok, true);
});

test("authorizeEmailRequest denies ordinary Player even for due_reminder", () => {
  const playerRoles = { superAdmin: false, clubAdmin: false, financeAdmin: false };

  const res = authorizeEmailRequest(playerRoles, baseDueReminder);
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.status, 403);
});
