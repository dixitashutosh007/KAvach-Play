/**
 * Home top-banner display duration (`lib/banner-duration.ts`). Pure.
 *
 * How long a banner stays on screen before the carousel rotates to the next
 * eligible banner. Stored per announcement as `displayDurationSec` (seconds).
 * Missing / invalid values fall back to the historical default (6 s), so older
 * announcements keep working without any data migration. This is unrelated to
 * campaign start/end dates.
 */

export const BANNER_DURATION_DEFAULT_SEC = 6;
export const BANNER_DURATION_MIN_SEC = 3;
export const BANNER_DURATION_MAX_SEC = 60;

/** Validates admin input (string from a form field or number). */
export function validateDisplayDuration(raw: unknown): { ok: true; value: number } | { ok: false; error: string } {
  const str = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim() : "";
  if (!/^\d+$/.test(str)) {
    return { ok: false, error: "Display duration must be a whole number of seconds." };
  }
  const value = Number(str);
  if (value < BANNER_DURATION_MIN_SEC || value > BANNER_DURATION_MAX_SEC) {
    return {
      ok: false,
      error: `Display duration must be between ${BANNER_DURATION_MIN_SEC} and ${BANNER_DURATION_MAX_SEC} seconds.`,
    };
  }
  return { ok: true, value };
}

/** Rotation delay in ms for a stored value; safe default for missing/invalid data. */
export function resolveDisplayDurationMs(stored: unknown): number {
  const v = validateDisplayDuration(stored);
  return (v.ok ? v.value : BANNER_DURATION_DEFAULT_SEC) * 1000;
}
