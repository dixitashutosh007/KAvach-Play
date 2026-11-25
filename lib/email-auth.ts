export interface EmailCallerRoles {
  superAdmin: boolean;
  clubAdmin: boolean;
  financeAdmin: boolean;
}

export interface EmailRequestPayload {
  action?: unknown;
  playerId?: unknown;
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
 * - Super Admin: authorized for all email workflows.
 * - Club Admin-only (without Super Admin or Finance Admin): authorized for
 *   legitimate non-Finance Club Admin emails, but DENIED `action: "due_reminder"` (HTTP 403).
 * - Finance Admin (without Club/Super Admin): strictly limited to explicit
 *   `action: "due_reminder"` payment reminders with non-empty subject/text and
 *   a single recipient. Arbitrary email sending is rejected (HTTP 403).
 * - All other users (ordinary players, unassigned): rejected (HTTP 403).
 */
export function authorizeEmailRequest(
  roles: EmailCallerRoles,
  body: EmailRequestPayload,
): EmailAuthResult {
  if (roles.superAdmin) {
    return { ok: true, isFinanceDueReminderOnly: false };
  }

  if (roles.clubAdmin && !roles.financeAdmin) {
    if (body?.action === "due_reminder") {
      return {
        ok: false,
        status: 403,
        error: "Forbidden: Club Admins without Finance Admin privileges cannot send financial due reminders.",
      };
    }
    return { ok: true, isFinanceDueReminderOnly: false };
  }

  if (roles.clubAdmin && roles.financeAdmin && body?.action !== "due_reminder") {
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

  // When playerId is supplied, the route derives recipient, subject, and text server-side.
  if (typeof body.playerId === "string" && body.playerId.trim()) {
    return { ok: true, isFinanceDueReminderOnly: true };
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
