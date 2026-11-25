import nodemailer from "nodemailer";
import dns from "node:dns/promises";
import net from "node:net";

export type MailTransport = { sendMail: (opts: any) => Promise<{ messageId?: string }> };
export type DnsLookupFn = (hostname: string, opts: { all: true; verbatim: true }) => Promise<Array<{ address: string; family: number }>>;

let smtpTransportFactoryOverride: ((opts: any) => MailTransport) | null = null;
let dnsLookupOverride: DnsLookupFn | null = null;

export function setSmtpTransportFactoryForTesting(factory: ((opts: any) => MailTransport) | null) {
  if (process.env.NODE_ENV !== "production") {
    smtpTransportFactoryOverride = factory;
  }
}

export function setDnsLookupForTesting(fn: DnsLookupFn | null) {
  if (process.env.NODE_ENV !== "production") {
    dnsLookupOverride = fn;
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
 * Checks whether an IPv4 or IPv6 address is private, loopback, link-local,
 * multicast, unspecified, or reserved (including IPv4-mapped IPv6).
 */
export function isBlockedIpAddress(rawIp: string): boolean {
  const ip = rawIp.trim().toLowerCase().split("%")[0];
  if (net.isIPv4(ip)) {
    const [a, b, c] = ip.split(".").map(Number);
    if (
      a === 0 ||                                  // 0.0.0.0/8 (unspecified / "this" network)
      a === 10 ||                                 // 10.0.0.0/8 (RFC1918)
      (a === 100 && b >= 64 && b <= 127) ||       // 100.64.0.0/10 (CGNAT RFC6598)
      a === 127 ||                                // 127.0.0.0/8 (loopback)
      (a === 169 && b === 254) ||                 // 169.254.0.0/16 (link-local / cloud metadata)
      (a === 172 && b >= 16 && b <= 31) ||        // 172.16.0.0/12 (RFC1918)
      (a === 192 && b === 0 && c === 0) ||        // 192.0.0.0/24 (IETF protocol)
      (a === 192 && b === 0 && c === 2) ||        // 192.0.2.0/24 (TEST-NET-1)
      (a === 192 && b === 168) ||                 // 192.168.0.0/16 (RFC1918)
      (a === 198 && (b === 18 || b === 19)) ||    // 198.18.0.0/15 (benchmarking)
      (a === 198 && b === 51 && c === 100) ||     // 198.51.100.0/24 (TEST-NET-2)
      (a === 203 && b === 0 && c === 113) ||      // 203.0.113.0/24 (TEST-NET-3)
      a >= 224                                    // 224.0.0.0/4 (multicast) & 240.0.0.0/4 (reserved)
    ) {
      return true;
    }
    return false;
  }

  if (net.isIPv6(ip)) {
    // Check IPv4-mapped IPv6 in dotted form (e.g. ::ffff:127.0.0.1) or hex form (e.g. ::ffff:7f00:1)
    const v4Dotted = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(ip);
    if (v4Dotted) return isBlockedIpAddress(v4Dotted[1]);

    const v4Hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ip);
    if (v4Hex) {
      const hi = parseInt(v4Hex[1], 16);
      const lo = parseInt(v4Hex[2], 16);
      const mapped = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
      return isBlockedIpAddress(mapped);
    }

    if (
      ip === "::" ||
      ip === "0:0:0:0:0:0:0:0" ||
      ip === "::1" ||
      ip === "0:0:0:0:0:0:0:1" ||
      /^fe[89ab][0-9a-f]:/.test(ip) ||   // fe80::/10 link-local
      /^f[cd][0-9a-f]{2}:/.test(ip) ||   // fc00::/7 unique local (ULA)
      /^ff[0-9a-f]{2}:/.test(ip) ||      // ff00::/8 multicast
      /^2001:0?db8:/.test(ip) ||         // 2001:db8::/32 documentation
      /^64:ff9b:/.test(ip)               // 64:ff9b::/96 NAT64
    ) {
      return true;
    }
    return false;
  }

  return true;
}

const HOSTNAME_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

/**
 * Validates hostname syntax and rejects prohibited names and alternative IP encodings
 * (octal, hex, integer, shorthand IPv4).
 */
export function isBlockedSmtpHost(rawHost: string): boolean {
  const host = rawHost.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host.length > 253 || /[\s/\\@]/.test(host)) return true;

  if (net.isIP(host)) {
    return isBlockedIpAddress(host);
  }

  if (host.includes(":")) return true; // non-IPv6 colon in hostname

  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return true;
  }

  // Reject alternative numeric/hex/octal IPv4 forms (e.g. 0x7f000001, 2130706433, 0177.0.0.1, 127.1)
  const labels = host.split(".");
  if (labels.length === 1 && (/^\d+$/.test(labels[0]) || /^0x[0-9a-f]+$/i.test(labels[0]))) {
    return true;
  }
  if (labels.every((l) => /^(\d+|0x[0-9a-f]+)$/i.test(l))) {
    return true;
  }
  if (labels.some((l) => !HOSTNAME_LABEL_RE.test(l))) {
    return true;
  }

  return false;
}

/**
 * Resolves the SMTP hostname once and validates ALL returned DNS records.
 * Returns the pinned IP address so nodemailer connects directly to the validated IP
 * (eliminating DNS-rebinding / TOCTOU gaps between validation and connection).
 */
export async function resolveAndValidateSmtpTarget(rawHost: string): Promise<
  | { ok: true; ip: string; servername: string }
  | { ok: false; status: number; error: string }
> {
  const host = rawHost.trim().replace(/^\[|\]$/g, "");
  if (isBlockedSmtpHost(host)) {
    return { ok: false, status: 400, error: "Configured SMTP host is not permitted." };
  }

  if (net.isIP(host)) {
    return { ok: true, ip: host, servername: host };
  }

  const lookup: DnsLookupFn =
    dnsLookupOverride && process.env.NODE_ENV !== "production"
      ? dnsLookupOverride
      : ((h, o) => dns.lookup(h, o));

  let records: Array<{ address: string; family: number }>;
  try {
    records = await lookup(host, { all: true, verbatim: true });
  } catch {
    return { ok: false, status: 400, error: "Configured SMTP host could not be resolved." };
  }

  if (!Array.isArray(records) || records.length === 0) {
    return { ok: false, status: 400, error: "Configured SMTP host could not be resolved." };
  }

  for (const rec of records) {
    if (!rec?.address || isBlockedIpAddress(rec.address)) {
      return { ok: false, status: 400, error: "Configured SMTP host resolved to a prohibited address." };
    }
  }

  return { ok: true, ip: records[0].address, servername: host };
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
