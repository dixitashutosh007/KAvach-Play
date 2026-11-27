import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  findDuplicateMatches,
  normalizeMatchDateForDuplicate,
  normalizeMatchTimeForDuplicate,
} from "../lib/match-duplicate.ts";

describe("Duplicate Match Detection (lib/match-duplicate.ts)", () => {
  const existing = [
    {
      id: "m1",
      date: "2026-12-06",
      time: "07:00",
      groundId: "g_nvd",
      opponent: "Titans XI",
      format: "T30",
      matchType: "Practice",
      tournamentId: "",
      fee: 500,
    },
    {
      id: "m2",
      date: "2026-12-07",
      time: "12:00",
      groundId: "g_nvd",
      opponent: "Royals",
      format: "T20",
      matchType: "Tournament",
      tournamentId: "t_winter",
      fee: 800,
    },
    {
      id: "m_arch",
      date: "2026-12-06",
      time: "07:00",
      groundId: "g_nvd",
      opponent: "Titans XI",
      format: "T30",
      matchType: "Practice",
      fee: 500,
      isArchived: true,
    },
  ];

  it("detects duplicate even when match fee is different (₹8,000 vs ₹500)", () => {
    const dups = findDuplicateMatches(
      {
        date: "06/12/2026",
        time: "7:00",
        groundId: "g_nvd",
        opponent: "  titans  xi ",
        format: "t30",
        matchType: "Practice",
        tournamentId: "",
      },
      existing,
    );
    assert.deepEqual(dups.map((d) => d.id), ["m1"]);
  });

  it("checks tournamentId when matchType is Tournament and ignores archived matches", () => {
    const sameTournament = findDuplicateMatches(
      {
        date: "2026-12-07",
        time: "12:00",
        groundId: "g_nvd",
        opponent: "Royals",
        format: "T20",
        matchType: "Tournament",
        tournamentId: "t_winter",
      },
      existing,
    );
    assert.deepEqual(sameTournament.map((d) => d.id), ["m2"]);

    const diffTournament = findDuplicateMatches(
      {
        date: "2026-12-07",
        time: "12:00",
        groundId: "g_nvd",
        opponent: "Royals",
        format: "T20",
        matchType: "Tournament",
        tournamentId: "t_summer",
      },
      existing,
    );
    assert.equal(diffTournament.length, 0);
  });

  it("excludes partialCreatedMatchId / editingId so partial recovery does not warn on itself", () => {
    const dups = findDuplicateMatches(
      {
        date: "2026-12-06",
        time: "07:00",
        groundId: "g_nvd",
        opponent: "Titans XI",
        format: "T30",
        matchType: "Practice",
      },
      existing,
      "m1",
    );
    assert.equal(dups.length, 0);
  });

  it("normalizes dates and times consistently", () => {
    assert.equal(normalizeMatchDateForDuplicate("6/12/2026"), "2026-12-06");
    assert.equal(normalizeMatchDateForDuplicate("2026-12-06"), "2026-12-06");
    assert.equal(normalizeMatchTimeForDuplicate("7:00"), "07:00");
    assert.equal(normalizeMatchTimeForDuplicate("12:00"), "12:00");
  });
});
