/**
 * Out of Play calendar helpers (D-20). Pure and timezone-safe: dates are handled
 * as YYYY-MM-DD strings (the format stored in `outOfPlays.startDate/endDate`),
 * so no device timezone conversion can shift a day.
 */

export interface MonthCell {
  day: number;
  iso: string;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Monday-first month grid: leading nulls, then one cell per day. `month` is 0-based. */
export function buildMonthGrid(year: number, month: number): (MonthCell | null)[] {
  const first = new Date(Date.UTC(year, month, 1));
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const leading = (first.getUTCDay() + 6) % 7; // Monday = 0
  const cells: (MonthCell | null)[] = Array.from({ length: leading }, () => null);
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, iso: `${year}-${pad(month + 1)}-${pad(d)}` });
  return cells;
}

/** True when `iso` (YYYY-MM-DD) falls inside any inclusive range. */
export function isDateBlocked(iso: string, ranges: readonly { startDate?: string; endDate?: string }[]): boolean {
  return ranges.some((r) => {
    if (!r.startDate) return false;
    const end = r.endDate || r.startDate;
    return iso >= r.startDate && iso <= end;
  });
}
