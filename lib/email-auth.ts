export interface EmailCallerRoles {
  superAdmin: boolean;
  clubAdmin: boolean;
  financeAdmin: boolean;
}

export interface EmailRequestPayload {
  action?: unknown;
  to?: unknown;
  subject?: unknown;
  text?: unknown;
  html?: unknown;
}

export type EmailAuthResult =
  | { ok: true; isFinanceDueReminderOnly: boolean }
  | { ok: false; status: number; error: string };

/**
 * Server-side authorization policy for `/api/email/send`:
 * - Super Admin & Club Admin: authorized for all email workflows.
 * - Finance Admin (without Club/Super Admin): strictly limited to explicit
 *   `action: "due_reminder"` payment reminders with non-empty subject/text and
 *   a single recipient. Arbitrary email sending is rejected (HTTP 403).
 * - All other users (ordinary players, unassigned): rejected (HTTP 403).
 */
export function authorizeEmailRequest(
  roles: EmailCallerRoles,
  body: EmailRequestPayload,
): EmailAuthResult {
  if (roles.superAdmin || roles.clubAdmin) {
    return { ok: true, isFinanceDueReminderOnly: false };
  }

  if (!roles.financeAdmin) {
    return {
      ok: false,
      status: 403,
      error: "Forbidden: admin privileges required to send emails.",
    };
  }

  if (body?.action !== "due_reminder") {
    return {
      ok: false,
      status: 403,
      error: "Forbidden: Finance Admins may only send due_reminder payment emails.",
    };
  }

  const recipients = Array.isArray(body.to) ? body.to : body.to ? [body.to] : [];
  if (
    recipients.length !== 1 ||
    typeof recipients[0] !== "string" ||
    !recipients[0].trim()
  ) {
    return {
      ok: false,
      status: 400,
      error: "Due reminders must target exactly one valid recipient.",
    };
  }

  if (
    typeof body.subject !== "string" ||
    !body.subject.trim() ||
    typeof body.text !== "string" ||
    !body.text.trim()
  ) {
    return {
      ok: false,
      status: 400,
      error: "Due reminders require non-empty subject and text.",
    };
  }

  return { ok: true, isFinanceDueReminderOnly: true };
}
