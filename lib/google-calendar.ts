/**
 * Google Calendar sync helper (server-only).
 *
 * Pushes KAvach matches into a public Google Calendar so anyone can view
 * the schedule. Uses the existing Firebase service-account key
 * (FIREBASE_SERVICE_ACCOUNT_KEY) — that SA is a Google Cloud identity in
 * the same project, so once the calendar is shared with its client_email
 * (with "Make changes to events") it can create/update/delete events.
 *
 * No googleapis dependency: we mint the OAuth2 access token by signing a
 * JWT with Node's built-in crypto (RS256) and exchanging it at Google's
 * token endpoint, then call the Calendar REST API with fetch. This keeps
 * the bundle lean and avoids pulling a large SDK into the Amplify Lambda.
 *
 * IMPORTANT: import only from server code (API routes). It reads secrets.
 */

import crypto from "crypto";
import type { Match } from "@/lib/types";

const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

const DEFAULT_CALENDAR_ID =
  "d968d1786b9e3fbc887cefeabe1ab1041c60c8c38d6d7945cc905ffad5a25e56@group.calendar.google.com";

let runtimeCalendarId: string | null = null;

/** Let the API route override the calendar id from appConfig. */
export function setCalendarId(id: string | undefined | null) {
  runtimeCalendarId = id && id.trim() ? id.trim() : null;
}

export function getCalendarId(): string {
  return runtimeCalendarId || process.env.GOOGLE_CALENDAR_ID || DEFAULT_CALENDAR_ID;
}

/** Extract a calendar ID from a full Google Calendar embed/public URL. */
export function parseCalendarIdFromUrl(url: string): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    const src = u.searchParams.get("src");
    if (src) return src;
  } catch {}
  return url.trim();
}

type ServiceAccount = { client_email: string; private_key: string };

function getServiceAccount(): ServiceAccount {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_KEY is not set — cannot authenticate to Google Calendar.",
    );
  }
  const parsed = JSON.parse(raw);
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error("Service account key is missing client_email / private_key.");
  }
  return { client_email: parsed.client_email, private_key: parsed.private_key };
}

/** The SA email the admin must share the calendar with. Safe to display. */
export function getServiceAccountEmail(): string {
  try {
    return getServiceAccount().client_email;
  } catch {
    return "";
  }
}

const b64url = (input: Buffer | string) =>
  Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

// Cache the access token across warm Lambda invocations.
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt > now + 60) {
    return cachedToken.token;
  }
  const sa = getServiceAccount();
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: CALENDAR_SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  );
  const signingInput = `${header}.${claim}`;
  const signature = b64url(
    crypto.createSign("RSA-SHA256").update(signingInput).sign(sa.private_key),
  );
  const assertion = `${signingInput}.${signature}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${body}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: json.access_token,
    expiresAt: now + (json.expires_in || 3600),
  };
  return json.access_token;
}

// ---------- Event building ----------

export type EventContext = {
  groundName?: string;
  groundMapUrl?: string;
  tournamentName?: string;
};

/** Parse the match date (stored as YYYY-MM-DD in Firestore) + "HH:MM" time. */
function parseMatchDateTime(date: string, time: string) {
  const raw = (date || "").trim();
  let dd: string | undefined, mm: string | undefined, yyyy: string | undefined;

  if (raw.includes("-")) {
    [yyyy, mm, dd] = raw.split("-");
  } else if (raw.includes("/")) {
    [dd, mm, yyyy] = raw.split("/");
  }

  const [hh, min] = (time || "09:00").split(":");
  return {
    y: Number(yyyy),
    mo: Number(mm),
    d: Number(dd),
    h: Number(hh),
    mi: Number(min),
    valid: !!(yyyy && mm && dd),
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Builds { start, end } as {dateTime, timeZone} in Asia/Kolkata. Matches
 *  default to a 3-hour block. India has no DST, so wall-clock is stable. */
function buildTimes(match: Match) {
  const p = parseMatchDateTime(match.date, match.time);
  if (!p.valid) return null;
  // End = start + 3h, rolling into the next day if needed.
  let endH = p.h + 3;
  let endDay = p.d;
  let endMo = p.mo;
  let endY = p.y;
  if (endH >= 24) {
    endH -= 24;
    // Simple next-day rollover via Date (local-agnostic; we only read parts).
    const nx = new Date(Date.UTC(p.y, p.mo - 1, p.d + 1));
    endY = nx.getUTCFullYear();
    endMo = nx.getUTCMonth() + 1;
    endDay = nx.getUTCDate();
  }
  const startLocal = `${p.y}-${pad(p.mo)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}:00`;
  const endLocal = `${endY}-${pad(endMo)}-${pad(endDay)}T${pad(endH)}:${pad(p.mi)}:00`;
  return {
    start: { dateTime: startLocal, timeZone: "Asia/Kolkata" },
    end: { dateTime: endLocal, timeZone: "Asia/Kolkata" },
  };
}

function buildDescription(match: Match, ctx: EventContext): string {
  const lines: string[] = [];
  lines.push(`Format: ${match.format} · ${match.matchType}`);
  if (ctx.tournamentName) lines.push(`Tournament: ${ctx.tournamentName}`);
  lines.push(`Jersey: ${match.jerseyColor}`);
  if (match.fee) lines.push(`Match Fee: ₹${match.fee} / player`);
  if (ctx.groundName) lines.push(`Ground: ${ctx.groundName}`);
  if (ctx.groundMapUrl) lines.push(`Directions: ${ctx.groundMapUrl}`);
  if (match.matchUrl) lines.push(`Scorecard: ${match.matchUrl}`);
  if (match.streamingUrl) lines.push(`Live Stream: ${match.streamingUrl}`);
  // Result block once the match is decided.
  if (match.result && match.result !== "Pending") {
    let r = match.result;
    if (
      (match.result === "KAvach Won" || match.result === "KAvach Lost") &&
      match.resultMarginAmount
    ) {
      r += ` by ${match.resultMarginAmount} ${match.resultMarginType || "runs"}`;
    }
    lines.push(`Result: ${r}`);
    if (match.playerOfTheMatch) lines.push(`Player of the Match: ${match.playerOfTheMatch}`);
  }
  lines.push("");
  lines.push("— KAvach Cricket Club");
  return lines.join("\n");
}

function buildEventBody(match: Match, ctx: EventContext) {
  const times = buildTimes(match);
  if (!times) throw new Error(`Match ${match.id} has an unparseable date/time.`);
  const titlePrefix = match.isTentative ? "[Tentative] " : "";
  return {
    summary: `${titlePrefix}KAvach vs ${match.opponent || "TBD"}`,
    location: ctx.groundName
      ? `${ctx.groundName}${ctx.groundMapUrl ? ` (${ctx.groundMapUrl})` : ""}`
      : undefined,
    description: buildDescription(match, ctx),
    start: times.start,
    end: times.end,
    // Stamp our match id so events are traceable / de-dupable.
    extendedProperties: { private: { kavachMatchId: match.id } },
  };
}

// ---------- REST calls ----------

async function calendarFetch(path: string, init: RequestInit) {
  const token = await getAccessToken();
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(getCalendarId())}${path}`,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
    },
  );
  return res;
}

/**
 * Create or update the event for a match. Returns the event id (new or
 * existing). If the match already has a googleEventId we PATCH it;
 * otherwise we INSERT and return the fresh id.
 */
export async function upsertMatchEvent(
  match: Match,
  ctx: EventContext,
): Promise<string> {
  const body = buildEventBody(match, ctx);
  if (match.googleEventId) {
    const res = await calendarFetch(`/events/${encodeURIComponent(match.googleEventId)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    if (res.status === 404) {
      // Event was deleted out-of-band — recreate it.
      return insertEvent(body);
    }
    if (!res.ok) throw new Error(`Calendar patch failed (${res.status}): ${await res.text()}`);
    const json = (await res.json()) as { id: string };
    return json.id;
  }
  return insertEvent(body);
}

async function insertEvent(body: unknown): Promise<string> {
  const res = await calendarFetch(`/events`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Calendar insert failed (${res.status}): ${await res.text()}`);
  const json = (await res.json()) as { id: string };
  return json.id;
}

/** Delete a match's event. Swallows 404/410 (already gone). */
export async function deleteMatchEvent(eventId: string): Promise<void> {
  if (!eventId) return;
  const res = await calendarFetch(`/events/${encodeURIComponent(eventId)}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new Error(`Calendar delete failed (${res.status}): ${await res.text()}`);
  }
}

/** Lightweight connectivity check — lists 1 event. Surfaces auth/sharing errors. */
export async function testCalendarAccess(): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await calendarFetch(`/events?maxResults=1`, { method: "GET" });
    if (!res.ok) return { ok: false, error: `${res.status}: ${await res.text()}` };
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}
