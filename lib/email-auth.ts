import nodemailer from "nodemailer";

export type MailTransport = { sendMail: (opts: any) => Promise<{ messageId?: string }> };
let smtpTransportFactoryOverride: ((opts: any) => MailTransport) | null = null;

export function setSmtpTransportFactoryForTesting(factory: ((opts: any) => MailTransport) | null) {
  if (process.env.NODE_ENV !== "production") {
    smtpTransportFactoryOverride = factory;
  }
}

export function createSmtpTransport(opts: any): MailTransport {
  if (smtpTransportFactoryOverride && process.env.NODE_ENV !== "production") {
    return smtpTransportFactoryOverride(opts);
  }
  return nodemailer.createTransport(opts);
}

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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Rejects loopback, link-local, RFC1918 private IPs, and internal hostnames
 * to prevent SSRF / credential exfiltration via SMTP host configuration.
 */
export function isBlockedSmtpHost(rawHost: string): boolean {
  const host = rawHost.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host.length > 253 || /[\s/\\@:]/.test(host)) return true;
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "::1" ||
    host === "0.0.0.0"
  ) {
    return true;
  }
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const [, a, b] = ipv4.map(Number);
    if (
      a === 127 ||
      a === 10 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    ) {
      return true;
    }
  }
  if (/^(fe80:|fc00:|fd00:|::ffff:127\.|::ffff:10\.|::ffff:192\.168\.|::ffff:169\.254\.)/i.test(host)) {
    return true;
  }
  return false;
}

export function validateEmailFields(input: {
  to: unknown;
  subject: unknown;
  text: unknown;
  html?: unknown;
}):
  | { ok: true; recipients: string[]; subject: string; text: string; html?: string }
  | { ok: false; status: number; error: string } {
  const rawList = Array.isArray(input.to) ? input.to : input.to ? [input.to] : [];
  const recipients = rawList
    .filter((r): r is string => typeof r === "string")
    .map((r) => r.trim())
    .filter(Boolean);

  if (recipients.length === 0 || recipients.length > 50 || recipients.some((r) => r.length > 254 || !EMAIL_RE.test(r))) {
    return { ok: false, status: 400, error: "Provide 1–50 valid recipient email addresses." };
  }
  if (typeof input.subject !== "string" || !input.subject.trim() || input.subject.length > 300) {
    return { ok: false, status: 400, error: "Subject must be a non-empty string up to 300 characters." };
  }
  if (typeof input.text !== "string" || !input.text.trim() || input.text.length > 20000) {
    return { ok: false, status: 400, error: "Email text must be a non-empty string up to 20,000 characters." };
  }
  let html: string | undefined;
  if (input.html !== undefined && input.html !== null) {
    if (typeof input.html !== "string" || input.html.length > 50000) {
      return { ok: false, status: 400, error: "HTML body must be a string up to 50,000 characters." };
    }
    html = input.html;
  }
  return { ok: true, recipients, subject: input.subject.trim(), text: input.text, html };
}
