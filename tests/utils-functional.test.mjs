/**
 * Phase 10 — Functional tests for critical utility functions.
 *
 * Covers: normalizeIndianMobile, normalizeEmail, formatDate, dbToInputDate,
 *         inputToDbDate, computeLateFees, findExistingPlayer, validateJerseyNumber,
 *         parseExpiryDate (StudioTab logic), and webhook toYMD helper.
 *
 * Uses only Node.js built-in test runner (node:test + node:assert).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ── normalizeIndianMobile ───────────────────────────────────────────────────

function normalizeIndianMobile(input) {
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

// ── normalizeEmail ──────────────────────────────────────────────────────────

function normalizeEmail(input) {
  if (!input) return "";
  return String(input).trim().toLowerCase();
}

// ── formatDate ──────────────────────────────────────────────────────────────

function formatDate(dateVal, fallback = "—") {
  if (!dateVal) return fallback;
  try {
    let d;
    if (typeof dateVal === "object" && typeof dateVal.toDate === "function") {
      d = dateVal.toDate();
    } else if (typeof dateVal === "object" && dateVal.seconds) {
      d = new Date(dateVal.seconds * 1000);
    } else if (dateVal instanceof Date) {
      d = dateVal;
    } else if (typeof dateVal === "string" && dateVal.includes("/")) {
      const parts = dateVal.split("/");
      if (parts.length === 3 && parts[2].length >= 4) {
        d = new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
      } else {
        d = new Date(dateVal);
      }
    } else if (typeof dateVal === "string" && dateVal.includes("-")) {
      const parts = dateVal.split("-");
      if (parts.length === 3 && parts[0].length === 4) {
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

// ── dbToInputDate ───────────────────────────────────────────────────────────

function dbToInputDate(dbDate) {
  if (!dbDate) return "";
  if (typeof dbDate !== "string") {
    try {
      let d;
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

// ── inputToDbDate ───────────────────────────────────────────────────────────

function inputToDbDate(inputDate) {
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

// ── computeLateFees ─────────────────────────────────────────────────────────

function computeLateFees(matchDate, matchId, playerId, matchLabel) {
  if (!matchDate) return [];
  const parts = matchDate.split("-");
  const matchDateObj = new Date(+parts[0], +parts[1] - 1, +parts[2]);
  const dayOfWeek = matchDateObj.getDay();
  if (dayOfWeek !== 0 && dayOfWeek !== 6) return [];

  const daysToTuesdayEOD = dayOfWeek === 6 ? 3 : 2;
  const deadlineDate = new Date(matchDateObj);
  deadlineDate.setDate(deadlineDate.getDate() + daysToTuesdayEOD);
  deadlineDate.setHours(23, 59, 59, 999);

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (today <= deadlineDate) return [];

  const fees = [];
  fees.push({
    matchId,
    playerId,
    amount: 150,
    label: `Late Fee: ${matchLabel}`,
    weeks: 0,
  });

  const wednesdayDate = new Date(deadlineDate);
  wednesdayDate.setDate(wednesdayDate.getDate() + 1);
  const msSinceWednesday = today.getTime() - wednesdayDate.getTime();
  const weeksPassed = Math.floor(msSinceWednesday / (7 * 86400000));
  for (let w = 1; w <= weeksPassed; w++) {
    fees.push({
      matchId,
      playerId,
      amount: 50,
      label: `Late Fee (Week ${w}): ${matchLabel}`,
      weeks: w,
    });
  }
  return fees;
}

// ── findExistingPlayer ──────────────────────────────────────────────────────

function findExistingPlayer(players, mobile, email, excludeId) {
  const normMobile = normalizeIndianMobile(mobile || "");
  const normEmail = normalizeEmail(email);

  for (const p of players) {
    if (p.disabled || p.mergedInto) continue;
    if (excludeId && p.id === excludeId) continue;

    if (normMobile && normMobile.length >= 12) {
      const pMobile = normalizeIndianMobile(p.mobile);
      if (pMobile && pMobile === normMobile) return { player: p, matchedOn: "mobile" };
    }

    if (normEmail && normEmail.includes("@")) {
      const pEmail = normalizeEmail(p.email);
      if (pEmail && pEmail === normEmail) return { player: p, matchedOn: "email" };
    }
  }
  return null;
}

// ── validateJerseyNumber ────────────────────────────────────────────────────

function validateJerseyNumber(input) {
  const value = String(input || "").trim();
  if (!value) return "Jersey number is required.";
  if (!/^\d{1,3}$/.test(value)) return "Jersey number must be up to 3 digits (numbers only).";
  if (value === "10" || value === "010" || value === "0010") return "Jersey number 10 is reserved and cannot be used.";
  return "";
}

// ── parseExpiryDate (StudioTab client-side logic) ───────────────────────────

function parseExpiryDate(raw) {
  try {
    const parts = raw.includes("-") ? raw.split("-") : raw.split("/");
    if (raw.includes("-")) {
      return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 23, 59, 59, 999);
    }
    return new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]), 23, 59, 59, 999);
  } catch { return null; }
}

// ── toYMD (webhook helper — Phase 9 fix) ────────────────────────────────────

function toYMD(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}


// ═════════════════════════════════════════════════════════════════════════════
// TESTS
// ═════════════════════════════════════════════════════════════════════════════

describe("Utility Function Tests (Phase 10)", () => {

  // ── 1. normalizeIndianMobile ────────────────────────────────────────────
  describe("1. normalizeIndianMobile", () => {
    it("normalizes a plain 10-digit number", () => {
      assert.equal(normalizeIndianMobile("9876543210"), "+919876543210");
    });

    it("strips +91 prefix", () => {
      assert.equal(normalizeIndianMobile("+919876543210"), "+919876543210");
    });

    it("strips 91 prefix (no plus)", () => {
      assert.equal(normalizeIndianMobile("919876543210"), "+919876543210");
    });

    it("strips 091 prefix", () => {
      assert.equal(normalizeIndianMobile("0919876543210"), "+919876543210");
    });

    it("strips leading 0 from 11-digit number", () => {
      assert.equal(normalizeIndianMobile("09876543210"), "+919876543210");
    });

    it("handles spaces and dashes", () => {
      assert.equal(normalizeIndianMobile("98765 43210"), "+919876543210");
      assert.equal(normalizeIndianMobile("98765-43210"), "+919876543210");
    });

    it("returns original string for too-short input", () => {
      assert.equal(normalizeIndianMobile("12345"), "12345");
    });

    it("returns empty for null/undefined", () => {
      assert.equal(normalizeIndianMobile(null), "");
      assert.equal(normalizeIndianMobile(undefined), "");
      assert.equal(normalizeIndianMobile(""), "");
    });

    it("takes last 10 if more than 10 digits after prefix stripping", () => {
      assert.equal(normalizeIndianMobile("00919876543210"), "+919876543210");
    });
  });

  // ── 2. normalizeEmail ──────────────────────────────────────────────────
  describe("2. normalizeEmail", () => {
    it("lowercases and trims", () => {
      assert.equal(normalizeEmail("  Alice@Example.COM  "), "alice@example.com");
    });

    it("returns empty for null/undefined", () => {
      assert.equal(normalizeEmail(null), "");
      assert.equal(normalizeEmail(undefined), "");
    });
  });

  // ── 3. formatDate ─────────────────────────────────────────────────────
  describe("3. formatDate", () => {
    it("formats YYYY-MM-DD string", () => {
      assert.equal(formatDate("2026-01-15"), "15-Jan-2026");
    });

    it("formats DD/MM/YYYY string", () => {
      assert.equal(formatDate("15/01/2026"), "15-Jan-2026");
    });

    it("formats Firestore-like timestamp { seconds }", () => {
      const ts = { seconds: 1737043200 }; // 2025-01-17 approx
      const result = formatDate(ts);
      assert.match(result, /^\d{2}-\w{3}-\d{4}$/);
    });

    it("formats Date object", () => {
      const d = new Date(2026, 5, 20); // June 20 2026
      assert.equal(formatDate(d), "20-Jun-2026");
    });

    it("returns fallback for null", () => {
      assert.equal(formatDate(null), "—");
      assert.equal(formatDate(null, "N/A"), "N/A");
    });

    it("returns fallback for garbage", () => {
      assert.equal(formatDate("not-a-date"), "—");
    });

    it("formats Firestore toDate() object", () => {
      const mock = { toDate: () => new Date(2026, 0, 1) };
      assert.equal(formatDate(mock), "01-Jan-2026");
    });
  });

  // ── 4. dbToInputDate ──────────────────────────────────────────────────
  describe("4. dbToInputDate", () => {
    it("converts YYYY-MM-DD to DD/MM/YYYY", () => {
      assert.equal(dbToInputDate("2026-01-15"), "15/01/2026");
    });

    it("handles Firestore timestamp", () => {
      const ts = { seconds: 1737043200 };
      const result = dbToInputDate(ts);
      assert.match(result, /^\d{2}\/\d{2}\/\d{4}$/);
    });

    it("returns empty for null/undefined", () => {
      assert.equal(dbToInputDate(null), "");
      assert.equal(dbToInputDate(undefined), "");
    });

    it("handles Date object", () => {
      const result = dbToInputDate(new Date(2026, 5, 20));
      assert.equal(result, "20/06/2026");
    });
  });

  // ── 5. inputToDbDate ──────────────────────────────────────────────────
  describe("5. inputToDbDate", () => {
    it("converts DD/MM/YYYY to YYYY-MM-DD", () => {
      assert.equal(inputToDbDate("15/01/2026"), "2026-01-15");
    });

    it("pads single-digit day and month", () => {
      assert.equal(inputToDbDate("5/1/2026"), "2026-01-05");
    });

    it("returns input unchanged if not DD/MM/YYYY", () => {
      assert.equal(inputToDbDate("2026-01-15"), "2026-01-15");
    });

    it("returns empty for null/undefined", () => {
      assert.equal(inputToDbDate(null), "");
      assert.equal(inputToDbDate(undefined), "");
    });
  });

  // ── 6. computeLateFees ────────────────────────────────────────────────
  describe("6. computeLateFees", () => {
    it("returns empty for weekday match", () => {
      // 2025-01-15 is a Wednesday
      const fees = computeLateFees("2025-01-15", "m1", "p1", "Match #1");
      assert.equal(fees.length, 0);
    });

    it("returns empty for empty matchDate", () => {
      assert.deepEqual(computeLateFees("", "m1", "p1", "Match #1"), []);
    });

    it("returns base fee of 150 for a Saturday match past deadline", () => {
      // Use a Saturday that is definitely > 1 week in the past
      // 2024-01-06 is a Saturday
      const fees = computeLateFees("2024-01-06", "m1", "p1", "Sat Match");
      assert.ok(fees.length >= 1, "Should have at least the base late fee");
      assert.equal(fees[0].amount, 150);
      assert.equal(fees[0].weeks, 0);
      assert.equal(fees[0].label, "Late Fee: Sat Match");
    });

    it("returns base fee of 150 for a Sunday match past deadline", () => {
      // 2024-01-07 is a Sunday
      const fees = computeLateFees("2024-01-07", "m1", "p1", "Sun Match");
      assert.ok(fees.length >= 1);
      assert.equal(fees[0].amount, 150);
    });

    it("adds weekly fees of 50 each for weeks past Wednesday", () => {
      // 2024-01-06 is Saturday. Deadline is Tuesday 2024-01-09 EOD.
      // Wednesday is 2024-01-10. Each subsequent week adds 50.
      const fees = computeLateFees("2024-01-06", "m1", "p1", "Old Match");
      // At least 1 base + some weekly
      const weeklyFees = fees.filter(f => f.weeks > 0);
      for (const wf of weeklyFees) {
        assert.equal(wf.amount, 50);
      }
    });

    it("Saturday deadline is Tuesday (3 days later)", () => {
      // Saturday 2024-01-06 → deadline Tuesday 2024-01-09
      // We test by computing fees for a match very far in the past
      const fees = computeLateFees("2024-01-06", "m1", "p1", "Sat");
      // Weeks = floor((today - Wed Jan 10) / 7 days)
      const wedDate = new Date(2024, 0, 10); // Jan 10, 2024
      const today = new Date();
      const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const expectedWeeks = Math.floor((todayStart.getTime() - wedDate.getTime()) / (7 * 86400000));
      // Total fees = 1 base + expectedWeeks weekly
      assert.equal(fees.length, 1 + expectedWeeks);
    });

    it("Sunday deadline is Tuesday (2 days later)", () => {
      // Sunday 2024-01-07 → deadline Tuesday 2024-01-09
      const fees = computeLateFees("2024-01-07", "m1", "p1", "Sun");
      const wedDate = new Date(2024, 0, 10); // Jan 10
      const today = new Date();
      const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const expectedWeeks = Math.floor((todayStart.getTime() - wedDate.getTime()) / (7 * 86400000));
      assert.equal(fees.length, 1 + expectedWeeks);
    });
  });

  // ── 7. findExistingPlayer ─────────────────────────────────────────────
  describe("7. findExistingPlayer", () => {
    const players = [
      { id: "p1", name: "Alice", mobile: "9876543210", email: "alice@example.com" },
      { id: "p2", name: "Bob", mobile: "+919123456789", email: "bob@test.com" },
      { id: "p3", name: "Charlie", mobile: "9999999999", email: "charlie@x.com", disabled: true },
      { id: "p4", name: "Dave", mobile: "8888888888", mergedInto: "p1" },
    ];

    it("matches by mobile with various formats", () => {
      const result = findExistingPlayer(players, "9876543210");
      assert.equal(result.player.id, "p1");
      assert.equal(result.matchedOn, "mobile");

      const result2 = findExistingPlayer(players, "+919876543210");
      assert.equal(result2.player.id, "p1");
    });

    it("matches by email case-insensitively", () => {
      const result = findExistingPlayer(players, null, "ALICE@Example.COM");
      assert.equal(result.player.id, "p1");
      assert.equal(result.matchedOn, "email");
    });

    it("skips disabled players", () => {
      const result = findExistingPlayer(players, "9999999999");
      assert.equal(result, null);
    });

    it("skips merged players", () => {
      const result = findExistingPlayer(players, "8888888888");
      assert.equal(result, null);
    });

    it("respects excludeId", () => {
      const result = findExistingPlayer(players, "9876543210", null, "p1");
      assert.equal(result, null);
    });

    it("returns null for no match", () => {
      const result = findExistingPlayer(players, "1111111111");
      assert.equal(result, null);
    });

    it("prefers mobile match over email", () => {
      const result = findExistingPlayer(players, "9876543210", "bob@test.com");
      assert.equal(result.player.id, "p1");
      assert.equal(result.matchedOn, "mobile");
    });
  });

  // ── 8. validateJerseyNumber ───────────────────────────────────────────
  describe("8. validateJerseyNumber", () => {
    it("returns empty string for valid numbers", () => {
      assert.equal(validateJerseyNumber("7"), "");
      assert.equal(validateJerseyNumber("99"), "");
      assert.equal(validateJerseyNumber("123"), "");
    });

    it("rejects reserved number 10", () => {
      assert.ok(validateJerseyNumber("10").includes("reserved"));
      assert.ok(validateJerseyNumber("010").includes("reserved"));
    });

    it("rejects non-numeric input", () => {
      assert.ok(validateJerseyNumber("AB").includes("numbers only"));
    });

    it("rejects more than 3 digits", () => {
      assert.ok(validateJerseyNumber("1234").includes("up to 3 digits"));
    });

    it("rejects empty input", () => {
      assert.ok(validateJerseyNumber("").includes("required"));
      assert.ok(validateJerseyNumber(null).includes("required"));
    });
  });

  // ── 9. parseExpiryDate (client-side StudioTab) ────────────────────────
  describe("9. parseExpiryDate (StudioTab)", () => {
    it("parses YYYY-MM-DD format", () => {
      const d = parseExpiryDate("2026-03-15");
      assert.equal(d.getFullYear(), 2026);
      assert.equal(d.getMonth(), 2); // March = 2
      assert.equal(d.getDate(), 15);
      assert.equal(d.getHours(), 23); // EOD
    });

    it("parses DD/MM/YYYY format", () => {
      const d = parseExpiryDate("15/03/2026");
      assert.equal(d.getFullYear(), 2026);
      assert.equal(d.getMonth(), 2);
      assert.equal(d.getDate(), 15);
    });

    it("handles ISO 8601 correctly after Phase 9 fix (toYMD)", () => {
      // Before the Phase 9 fix, the webhook wrote ISO strings like "2026-01-15T00:00:00.000Z"
      // parseExpiryDate would fail on those because parts[2] would be "15T00:00:00.000Z"
      // After the fix, webhook writes "2026-01-15" which parseExpiryDate handles correctly.
      const goodDate = parseExpiryDate("2026-01-15");
      assert.ok(goodDate instanceof Date);
      assert.equal(goodDate.getDate(), 15);

      // Demonstrate the old format would produce NaN
      const badDate = parseExpiryDate("2026-01-15T00:00:00.000Z");
      assert.ok(isNaN(badDate.getTime()), "ISO 8601 with time component should produce NaN via this parser");
    });
  });

  // ── 10. toYMD (webhook helper — Phase 9 fix) ─────────────────────────
  describe("10. toYMD webhook helper", () => {
    it("formats to YYYY-MM-DD with zero-padded month/day", () => {
      assert.equal(toYMD(new Date(2026, 0, 5)), "2026-01-05");
      assert.equal(toYMD(new Date(2026, 11, 25)), "2026-12-25");
    });

    it("produces strings that parseExpiryDate can read", () => {
      const original = new Date(2026, 5, 20);
      const ymd = toYMD(original);
      const parsed = parseExpiryDate(ymd);
      assert.equal(parsed.getFullYear(), 2026);
      assert.equal(parsed.getMonth(), 5);
      assert.equal(parsed.getDate(), 20);
    });
  });

  // ── 11. Date conversion roundtrip ─────────────────────────────────────
  describe("11. Date conversion roundtrip", () => {
    it("inputToDbDate → dbToInputDate roundtrips", () => {
      const input = "15/01/2026";
      const db = inputToDbDate(input);
      assert.equal(db, "2026-01-15");
      const back = dbToInputDate(db);
      assert.equal(back, input);
    });

    it("formatDate accepts output of inputToDbDate", () => {
      const db = inputToDbDate("20/06/2026");
      const formatted = formatDate(db);
      assert.equal(formatted, "20-Jun-2026");
    });
  });
});
