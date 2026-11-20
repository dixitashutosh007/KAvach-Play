/**
 * Venue → Google Maps link resolution (`lib/venue-maps.ts`).
 *
 * Pure helper (no Firebase imports). Rules:
 * 1. Prefer the ground's stored `mapUrl` when it is a well-formed http(s) URL.
 * 2. Otherwise, if a venue name exists, build a URL-encoded Google Maps *search*
 *    for that name (the user sees search results; no coordinates are invented).
 * 3. With no usable venue information, return null so callers render plain text.
 */

export interface VenueLike {
  name?: string | null;
  mapUrl?: string | null;
}

export interface VenueLink {
  href: string;
  /** "stored" = ground.mapUrl, "search" = constructed name search */
  source: "stored" | "search";
}

const GOOGLE_MAPS_SEARCH = "https://www.google.com/maps/search/?api=1&query=";

export function getSafeHttpUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!url.hostname) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function getVenueMapsLink(venue: VenueLike | null | undefined): VenueLink | null {
  if (!venue) return null;
  const stored = getSafeHttpUrl(venue.mapUrl);
  if (stored) return { href: stored, source: "stored" };

  const name = typeof venue.name === "string" ? venue.name.trim() : "";
  if (!name) return null;
  return { href: `${GOOGLE_MAPS_SEARCH}${encodeURIComponent(name)}`, source: "search" };
}
