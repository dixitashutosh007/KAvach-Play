/**
 * Player Home greeting helpers (`lib/greeting.ts`). Pure, no Firebase imports.
 */

export const CLUB_TIME_ZONE = "Asia/Kolkata";

/** Hour of day (0-23) in the club's timezone, independent of the device timezone. */
export function getClubHour(now: Date = new Date(), timeZone: string = CLUB_TIME_ZONE): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  return Number.isFinite(hour) ? hour % 24 : now.getHours();
}

export function getTimeOfDayGreeting(now: Date = new Date(), timeZone: string = CLUB_TIME_ZONE): string {
  const hour = getClubHour(now, timeZone);
  if (hour < 12) return "Good Morning";
  if (hour < 17) return "Good Afternoon";
  return "Good Evening";
}

/**
 * Names that are system placeholders rather than a real person's name:
 * "Player", "Admin", "Guest", auto-generated "Player (ab12c)" / "Demo Player (XYZ1)".
 */
export function isPlaceholderName(name: string | null | undefined): boolean {
  const n = (name || "").trim();
  if (!n) return true;
  if (/^(player|admin|guest|user|member)$/i.test(n)) return true;
  if (/^(demo\s+)?player\s*\([^)]*\)$/i.test(n)) return true;
  return false;
}

/** First usable, non-placeholder display name from the ordered candidates, or null. */
export function resolveGreetingName(
  ...candidates: Array<string | null | undefined>
): string | null {
  for (const c of candidates) {
    if (!isPlaceholderName(c)) return (c as string).trim().replace(/\s+/g, " ");
  }
  return null;
}

/** "Good Morning, Asha Rao" — or just "Good Morning" when no real name is known. */
export function buildHomeGreeting(name: string | null, now: Date = new Date()): string {
  const base = getTimeOfDayGreeting(now);
  return name ? `${base}, ${name}` : base;
}
