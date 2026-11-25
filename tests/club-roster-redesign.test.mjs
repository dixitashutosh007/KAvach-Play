import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  buildRosterCsv,
  computeRosterSummary,
  filterAndSortRoster,
  formatPlayingInfo,
  formatWhatsAppHref,
  sanitizeCsvCell,
} from "../lib/club-roster.ts";

const root = process.cwd();

const samplePlayers = [
  { id: "p1", name: "Rohit Mehta", kavachId: "KAV0123", mobile: "9876500001", isStudioMember: true, battingStyle: "Right-hand bat", inviteStatus: "Verified" },
  { id: "p2", name: "Nitin Rao", kavachId: "KAV0163", mobile: "9876500002", isStudioMember: false, battingStyle: "Left-hand bat", inviteStatus: "Verified" },
  { id: "p3", name: "Inactive Member", kavachId: "KAV0199", mobile: "9876500003", isStudioMember: true, disabled: true, inviteStatus: "Verified" },
  { id: "p4", name: "Pending User", mobile: "9876500004", inviteStatus: "Pending" },
  { id: "p5", name: "Merged User", mobile: "9876500005", mergedInto: "p1", inviteStatus: "Verified" },
];

test("ROSTER-R2: computeRosterSummary counts Total, Active, Studio (including inactive), and Inactive excluding Pending and Merged", () => {
  const summary = computeRosterSummary(samplePlayers);
  assert.deepEqual(summary, {
    totalPlayers: 3,
    activePlayers: 2,
    studioMembers: 2,
    inactivePlayers: 1,
  });
});

test("filterAndSortRoster supports search by name and Player ID, status filter, and membership filter", () => {
  const byId = filterAndSortRoster(samplePlayers, { query: "KAV0163" });
  assert.deepEqual(byId.map((p) => p.id), ["p2"]);

  const byName = filterAndSortRoster(samplePlayers, { query: "rohit" });
  assert.deepEqual(byName.map((p) => p.id), ["p1"]);

  const inactive = filterAndSortRoster(samplePlayers, { statusFilter: "inactive" });
  assert.deepEqual(inactive.map((p) => p.id), ["p3"]);

  const studioActive = filterAndSortRoster(samplePlayers, { statusFilter: "active", membershipFilter: "studio" });
  assert.deepEqual(studioActive.map((p) => p.id), ["p1"]);

  const regular = filterAndSortRoster(samplePlayers, { membershipFilter: "regular" });
  assert.deepEqual(regular.map((p) => p.id), ["p2"]);
});

test("ROSTER-R3: formatWhatsAppHref normalizes valid Indian/international numbers and rejects invalid/missing", () => {
  assert.equal(formatWhatsAppHref("9876500001"), "https://wa.me/919876500001");
  assert.equal(formatWhatsAppHref("09876500001"), "https://wa.me/919876500001");
  assert.equal(formatWhatsAppHref("+91 98765-00001"), "https://wa.me/919876500001");
  assert.equal(formatWhatsAppHref("14155551234"), "https://wa.me/14155551234");
  assert.equal(formatWhatsAppHref(""), null);
  assert.equal(formatWhatsAppHref(null), null);
  assert.equal(formatWhatsAppHref("123"), null);
});

test("ROSTER-R4: sanitizeCsvCell and buildRosterCsv neutralize formula injection payloads", () => {
  assert.equal(sanitizeCsvCell("=CMD()"), "\"'=CMD()\"");
  assert.equal(sanitizeCsvCell("+1+2"), "\"'+1+2\"");
  assert.equal(sanitizeCsvCell("-2+3"), "\"'-2+3\"");
  assert.equal(sanitizeCsvCell("@SUM(A1)"), "\"'@SUM(A1)\"");
  assert.equal(sanitizeCsvCell("\t=1"), "\"'\t=1\"");
  assert.equal(sanitizeCsvCell("\r=1"), "\"'\r=1\"");
  assert.equal(sanitizeCsvCell("Rohit Mehta"), "\"Rohit Mehta\"");

  const csv = buildRosterCsv([
    { ...samplePlayers[0], name: "=HYPERLINK(\"http://evil\",\"Click\")", email: "@evil" },
  ]);
  assert.match(csv, /"'=HYPERLINK\(""http:\/\/evil"",""Click""\)"/);
  assert.match(csv, /"'@evil"/);
});

test("formatPlayingInfo and buildRosterCsv format cricket info and export cleanly", () => {
  assert.equal(formatPlayingInfo({ isWicketKeeper: true, battingStyle: "Right-hand bat", jerseyNumber: "7" }), "Wicket Keeper · Right-hand bat · #7");
  const csv = buildRosterCsv([samplePlayers[0]]);
  assert.match(csv, /"Rohit Mehta","KAV0123","9876500001","","Right-hand bat","Studio","Active"/);
});

test("ROSTER-R1/R2/R3/R6/R7/R8/R9: Club Roster & Player Details enforce role boundaries and remediated UI contracts", () => {
  const playersTabSrc = fs.readFileSync(path.join(root, "components/PlayersTab.tsx"), "utf8");
  const detailsSrc = fs.readFileSync(path.join(root, "components/roster/PlayerDetailsModal.tsx"), "utf8");
  const clubTabSrc = fs.readFileSync(path.join(root, "components/ClubTab.tsx"), "utf8");

  // Access Control remains strictly in Settings -> Access Control (no role assignment/editing)
  assert.doesNotMatch(playersTabSrc, /\/api\/admin\/access|RoleChips|isClubAdmin|isSuperAdmin/);
  assert.doesNotMatch(detailsSrc, /\/api\/admin\/access|RoleChips|isClubAdmin|isFinanceAdmin|isSuperAdmin/);

  // ROSTER-R1: Finance boundary gated on canViewFinance (derived from isFinanceAdmin / Super Admin)
  assert.match(clubTabSrc, /isFinanceAdmin=\{Boolean\(isFinanceAdmin \|\| isSuperAdmin\)\}/);
  assert.match(playersTabSrc, /const canViewFinance = persona === "admin" && Boolean\(isFinanceAdmin\);/);
  assert.match(playersTabSrc, /canViewFinance=\{canViewFinance\}/);
  assert.match(detailsSrc, /canViewFinance = false/);
  assert.match(detailsSrc, /canViewFinance\s*\?\s*\["overview", "membership", "activity"\]\s*:\s*\["overview", "membership"\]/);
  assert.match(detailsSrc, /canViewFinance && activeTab === "activity"/);

  // ROSTER-R2: Studio KPI label & click resets statusFilter("all") + membershipFilter("studio")
  assert.match(playersTabSrc, />Studio Members</);
  assert.match(playersTabSrc, /setStatusFilter\("all"\);\s*setMembershipFilter\("studio"\)/);

  // ROSTER-R3: WhatsApp contact action in PlayerDetailsModal (no tel: link)
  assert.match(detailsSrc, /formatWhatsAppHref\(player\.mobile\)/);
  assert.doesNotMatch(detailsSrc, /href=\{`tel:/);

  // ROSTER-R6: No bulk selection or quick Activate/Deactivate toolbar in main roster
  assert.doesNotMatch(playersTabSrc, /selectedIds|toggleSelectAll|Deactivate Selected|Activate Selected/);

  // ROSTER-R7: Two-line player info respects canViewFinance and player.isStudioMember
  assert.match(playersTabSrc, /canViewFinance \? \(/);
  assert.match(playersTabSrc, /Their Due:/);
  assert.match(playersTabSrc, /player\.isStudioMember && \(/);
  assert.match(playersTabSrc, /Studio ends:/);

  // ROSTER-R8: Single-line filter/sort row
  assert.match(playersTabSrc, /data-testid="roster-filter-row"[\s\S]*overflow-x-auto[\s\S]*whitespace-nowrap/);

  // ROSTER-R9: Add Directly removed; Invite Player preserved
  assert.doesNotMatch(playersTabSrc, /Add Directly|store\.addPlayer/);
  assert.match(playersTabSrc, /Invite Player/);

  // Key redesigned UI & workflow landmarks
  assert.match(playersTabSrc, /data-testid="club-roster-screen"/);
  assert.match(playersTabSrc, /data-testid="roster-kpi-cards"/);
  assert.match(playersTabSrc, /data-testid="roster-status-filter"/);
  assert.match(playersTabSrc, /data-testid="roster-membership-filter"/);
  assert.match(playersTabSrc, /data-testid="roster-export-btn"/);
  assert.match(playersTabSrc, /data-testid="roster-add-player-btn"/);
  assert.match(detailsSrc, /data-testid="copy-player-id-btn"/);
  assert.match(detailsSrc, /data-testid="toggle-studio-membership-btn"/);
});
