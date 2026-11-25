import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  buildRosterCsv,
  computeRosterSummary,
  filterAndSortRoster,
  formatPlayingInfo,
} from "../lib/club-roster.ts";

const root = process.cwd();

const samplePlayers = [
  { id: "p1", name: "Rohit Mehta", kavachId: "KAV0123", mobile: "9876500001", isStudioMember: true, battingStyle: "Right-hand bat", inviteStatus: "Verified" },
  { id: "p2", name: "Nitin Rao", kavachId: "KAV0163", mobile: "9876500002", isStudioMember: false, battingStyle: "Left-hand bat", inviteStatus: "Verified" },
  { id: "p3", name: "Inactive Member", kavachId: "KAV0199", mobile: "9876500003", isStudioMember: true, disabled: true, inviteStatus: "Verified" },
  { id: "p4", name: "Pending User", mobile: "9876500004", inviteStatus: "Pending" },
  { id: "p5", name: "Merged User", mobile: "9876500005", mergedInto: "p1", inviteStatus: "Verified" },
];

test("computeRosterSummary counts Total, Active, Studio, and Inactive excluding Pending and Merged", () => {
  const summary = computeRosterSummary(samplePlayers);
  assert.deepEqual(summary, {
    totalPlayers: 3,
    activePlayers: 2,
    studioMembers: 1,
    inactivePlayers: 1,
  });
});

test("filterAndSortRoster supports search by name and Player ID, status filter, and membership filter", () => {
  // Search by Official Player ID
  const byId = filterAndSortRoster(samplePlayers, { query: "KAV0163" });
  assert.deepEqual(byId.map((p) => p.id), ["p2"]);

  // Search by name
  const byName = filterAndSortRoster(samplePlayers, { query: "rohit" });
  assert.deepEqual(byName.map((p) => p.id), ["p1"]);

  // Status filter: inactive
  const inactive = filterAndSortRoster(samplePlayers, { statusFilter: "inactive" });
  assert.deepEqual(inactive.map((p) => p.id), ["p3"]);

  // Membership filter: studio + active
  const studioActive = filterAndSortRoster(samplePlayers, { statusFilter: "active", membershipFilter: "studio" });
  assert.deepEqual(studioActive.map((p) => p.id), ["p1"]);

  // Membership filter: regular
  const regular = filterAndSortRoster(samplePlayers, { membershipFilter: "regular" });
  assert.deepEqual(regular.map((p) => p.id), ["p2"]);
});

test("formatPlayingInfo and buildRosterCsv format cricket info and export cleanly", () => {
  assert.equal(formatPlayingInfo({ isWicketKeeper: true, battingStyle: "Right-hand bat", jerseyNumber: "7" }), "Wicket Keeper · Right-hand bat · #7");
  const csv = buildRosterCsv([samplePlayers[0]]);
  assert.match(csv, /"Rohit Mehta","KAV0123","9876500001","","Right-hand bat","Studio","Active"/);
});

test("Club Roster & Player Details enforce Access Control boundary (no role assignment/editing/filters)", () => {
  const playersTabSrc = fs.readFileSync(path.join(root, "components/PlayersTab.tsx"), "utf8");
  const detailsSrc = fs.readFileSync(path.join(root, "components/roster/PlayerDetailsModal.tsx"), "utf8");

  assert.doesNotMatch(playersTabSrc, /\/api\/admin\/access/);
  assert.doesNotMatch(detailsSrc, /\/api\/admin\/access/);
  assert.doesNotMatch(playersTabSrc, /isClubAdmin|isFinanceAdmin|isSuperAdmin|RoleChips/);
  assert.doesNotMatch(detailsSrc, /isClubAdmin|isFinanceAdmin|isSuperAdmin|RoleChips/);

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
