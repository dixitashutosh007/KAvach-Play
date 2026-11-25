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

test("authorizeEmailRequest permits Club Admin and Super Admin for all email workflows", () => {
  const clubRoles = { superAdmin: false, clubAdmin: true, financeAdmin: false };
  const superRoles = { superAdmin: true, clubAdmin: false, financeAdmin: false };

  for (const roles of [clubRoles, superRoles]) {
    const res1 = authorizeEmailRequest(roles, arbitraryEmail);
    assert.equal(res1.ok, true);
    if (res1.ok) assert.equal(res1.isFinanceDueReminderOnly, false);

    const res2 = authorizeEmailRequest(roles, baseDueReminder);
    assert.equal(res2.ok, true);
  }
});

test("authorizeEmailRequest denies ordinary Player even for due_reminder", () => {
  const playerRoles = { superAdmin: false, clubAdmin: false, financeAdmin: false };

  const res = authorizeEmailRequest(playerRoles, baseDueReminder);
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.status, 403);
});
