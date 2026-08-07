import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(dateVal: any, fallback: string = "—"): string {
  if (!dateVal) return fallback;
  try {
    let d: Date;
    if (typeof dateVal === "object" && typeof dateVal.toDate === "function") {
      d = dateVal.toDate();
    } else if (typeof dateVal === "object" && dateVal.seconds) {
      d = new Date(dateVal.seconds * 1000);
    } else if (dateVal instanceof Date) {
      d = dateVal;
    } else if (typeof dateVal === "string" && dateVal.includes("/")) {
      const parts = dateVal.split("/");
      if (parts.length === 3 && parts[2].length >= 4) {
        // Assume DD/MM/YYYY if month is <= 12 and part[2] is a year
        d = new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
      } else {
        d = new Date(dateVal);
      }
    } else if (typeof dateVal === "string" && dateVal.includes("-")) {
      const parts = dateVal.split("-");
      if (parts.length === 3 && parts[0].length === 4) {
        // Assume YYYY-MM-DD
        d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
      } else {
        d = new Date(dateVal);
      }
    } else {
      d = new Date(dateVal);
    }
    
    if (isNaN(d.getTime())) return fallback;
    const day = String(d.getDate()).padStart(2, "0");
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const month = monthNames[d.getMonth()];
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
  } catch {
    return fallback;
  }
}

export function dbToInputDate(dbDate: any): string {
  if (!dbDate) return "";
  if (typeof dbDate !== "string") {
    try {
      let d: Date;
      if (typeof dbDate === "object" && typeof dbDate.toDate === "function") {
        d = dbDate.toDate();
      } else if (typeof dbDate === "object" && dbDate.seconds) {
        d = new Date(dbDate.seconds * 1000);
      } else if (dbDate instanceof Date) {
        d = dbDate;
      } else {
        d = new Date(dbDate);
      }
      if (!isNaN(d.getTime())) {
        const day = String(d.getDate()).padStart(2, "0");
        const month = String(d.getMonth() + 1).padStart(2, "0");
        const year = d.getFullYear();
        return `${day}/${month}/${year}`;
      }
    } catch {}
    return "";
  }
  const parts = dbDate.split("-");
  if (parts.length === 3) {
    const [y, m, d] = parts;
    if (y.length === 4 && m.length === 2 && d.length === 2) {
      return `${d}/${m}/${y}`;
    }
  }
  try {
    const d = new Date(dbDate);
    if (!isNaN(d.getTime())) {
      const day = String(d.getDate()).padStart(2, "0");
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const year = d.getFullYear();
      return `${day}/${month}/${year}`;
    }
  } catch {}
  return dbDate || "";
}

/**
 * Normalize an Indian mobile number to +91XXXXXXXXXX form.
 * Strips non-digits, drops leading +91 / 91 / 0 / 091, keeps the last 10
 * digits. Returns the original string unchanged if it can't be normalized
 * (e.g. a partial number the user is still typing).
 */
export function normalizeIndianMobile(input: string | undefined | null): string {
  if (!input) return "";
  const raw = String(input).trim();
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 13 && digits.startsWith("091")) digits = digits.slice(3);
  else if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length > 10) digits = digits.slice(-10);
  if (digits.length !== 10) return raw;
  return `+91${digits}`;
}

/**
 * Validate a jersey-number string against club rules:
 *   - up to 3 digits, numeric only
 *   - never "10" (reserved / blocked)
 * Returns "" (empty string means "no error"). If invalid, returns
 * the human-readable error message the caller should show.
 */
export function validateJerseyNumber(input: string | undefined | null): string {
  const value = String(input || "").trim();
  if (!value) return "Jersey number is required.";
  if (!/^\d{1,3}$/.test(value)) return "Jersey number must be up to 3 digits (numbers only).";
  if (value === "10" || value === "010" || value === "0010") return "Jersey number 10 is reserved and cannot be used.";
  return "";
}

export function inputToDbDate(inputDate: string | undefined | null): string {
  if (!inputDate) return "";
  const parts = inputDate.split("/");
  if (parts.length === 3) {
    const [d, m, y] = parts;
    if (d.length > 0 && m.length > 0 && y.length === 4) {
      const day = d.padStart(2, "0");
      const month = m.padStart(2, "0");
      return `${y}-${month}-${day}`;
    }
  }
  return inputDate;
}
