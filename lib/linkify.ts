/**
 * Safe URL detection for plain-text club content (`lib/linkify.ts`). Pure.
 *
 * Announcement and feed text is stored as plain text. Only http(s) URLs and
 * "www." addresses become links; every other scheme (javascript:, data:, mailto:
 * ...) stays plain text. Trailing punctuation is kept outside the link.
 */

export type TextSegment = { type: "text"; value: string } | { type: "link"; value: string; href: string };

const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/;

/** Returns a safe absolute http(s) href for a detected URL, or null. */
export function toSafeHref(raw: string): string | null {
  const candidate = /^www\./i.test(raw) ? `https://${raw}` : raw;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!url.hostname || !url.hostname.includes(".")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function splitTextWithLinks(text: string | null | undefined): TextSegment[] {
  const input = text || "";
  const segments: TextSegment[] = [];
  let last = 0;
  for (const match of input.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    let raw = match[0];
    const trailing = raw.match(TRAILING_PUNCTUATION)?.[0] || "";
    if (trailing) raw = raw.slice(0, raw.length - trailing.length);
    const href = toSafeHref(raw);
    if (!href) continue;
    if (start > last) segments.push({ type: "text", value: input.slice(last, start) });
    segments.push({ type: "link", value: raw, href });
    last = start + raw.length;
  }
  if (last < input.length) segments.push({ type: "text", value: input.slice(last) });
  return segments.length > 0 ? segments : [{ type: "text", value: input }];
}

/** Like toSafeHref but only HTTPS destinations are allowed (banner navigation). */
export function toSafeHttpsHref(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const href = toSafeHref(raw.trim());
  return href && href.startsWith("https://") ? href : null;
}

/** First HTTPS link found in plain text, or null. */
export function firstHttpsLink(text: string | null | undefined): string | null {
  for (const seg of splitTextWithLinks(text)) {
    if (seg.type === "link" && seg.href.startsWith("https://")) return seg.href;
  }
  return null;
}
