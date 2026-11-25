import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { getAdminLanding } from "../lib/admin-navigation.ts";
import {
  filterDismissedExpiredStudioAlerts,
  getStudioAlertExpiryKey,
  getStudioMembership,
} from "../lib/studio-membership.ts";

const root = process.cwd();

test("Admin Home match cards omit Unresponded while preserving Confirmed, Tentative, Not Playing and Match Center", () => {
  const dashSrc = fs.readFileSync(path.join(root, "components/AdminDashboard.tsx"), "utf8");
  assert.doesNotMatch(dashSrc, /Unresponded|unrespondedCount/);
  assert.match(dashSrc, /grid-cols-3/);
  assert.match(dashSrc, /Confirmed/);
  assert.match(dashSrc, /Tentative/);
  assert.match(dashSrc, /Not Playing/);

  const matchesSrc = fs.readFileSync(path.join(root, "components/MatchesTab.tsx"), "utf8");
  assert.match(matchesSrc, /Unresponded/);
});

test("AppHeader renders modern segmented Player/Admin persona switch gated by admin access", () => {
  const headerSrc = fs.readFileSync(path.join(root, "components/layout/AppHeader.tsx"), "utf8");
  assert.match(headerSrc, /\{isAdmin && onTogglePersona && \(/);
  assert.match(headerSrc, /data-testid="header-persona-toggle"/);
  assert.match(headerSrc, /data-testid="header-persona-player"/);
  assert.match(headerSrc, /data-testid="header-persona-admin"/);
  assert.match(headerSrc, /role="group"/);
  assert.match(headerSrc, /aria-pressed=\{persona === "player"\}/);
  assert.match(headerSrc, /aria-pressed=\{persona === "admin"\}/);
  assert.match(headerSrc, /persona !== "admin" && adminPendingCount > 0/);
  assert.match(headerSrc, /data-testid="header-persona-pending"/);

  // Verify getAdminLanding preserves role priority across all active admin roles
  assert.deepEqual(
    getAdminLanding({ isSuperAdmin: true, isClubAdmin: true, isFinanceAdmin: true }),
    { tab: "home" },
  );
  assert.deepEqual(
    getAdminLanding({ isSuperAdmin: false, isClubAdmin: true, isFinanceAdmin: false }),
    { tab: "home" },
  );
  assert.deepEqual(
    getAdminLanding({ isSuperAdmin: false, isClubAdmin: false, isFinanceAdmin: true }),
    { tab: "finance" },
  );
});

test("Expired Studio alert dismissal filters only the dismissed player/expiry without altering membership", () => {
  const expired = [
    { id: "p1", name: "Alice", studioExpiryDate: "2026-10-01", isStudioMember: true },
    { id: "p2", name: "Bob", studioExpiryDate: "2026-10-05", isStudioMember: true },
    { id: "p3", name: "Charlie", isStudioMember: true },
  ];

  // No dismissals -> all 3 visible
  assert.equal(filterDismissedExpiredStudioAlerts(expired, undefined).length, 3);

  // Dismissing p1 hides only p1
  const dismissed = { p1: getStudioAlertExpiryKey(expired[0]) };
  const afterDismiss = filterDismissedExpiredStudioAlerts(expired, dismissed);
  assert.deepEqual(
    afterDismiss.map((p) => p.id),
    ["p2", "p3"],
  );
  assert.equal(expired[0].isStudioMember, true);

  // If p1 renews and later expires with a new expiry date, alert surfaces again
  const renewedAndExpiredAgain = [
    { id: "p1", name: "Alice", studioExpiryDate: "2026-12-01", isStudioMember: true },
  ];
  assert.equal(filterDismissedExpiredStudioAlerts(renewedAndExpiredAgain, dismissed).length, 1);
});

test("Studio membership status revokes isStudioUser when both player and appUser flags are cleared", () => {
  const pastExpiry = "2025-01-01";
  const activeBeforeRemoval = getStudioMembership(
    { isStudioMember: true, studioExpiryDate: pastExpiry },
    { isStudioMember: true, studioExpiryDate: pastExpiry },
    Date.parse("2026-01-01T00:00:00Z"),
  );
  assert.equal(activeBeforeRemoval.isStudioUser, true);

  // If only player was updated and appUser remained true, isStudioUser stayed true (the old gap)
  const partialUpdate = getStudioMembership(
    { isStudioMember: false, studioExpiryDate: pastExpiry },
    { isStudioMember: true, studioExpiryDate: pastExpiry },
    Date.parse("2026-01-01T00:00:00Z"),
  );
  assert.equal(partialUpdate.isStudioUser, true);

  // When both player and appUser are set to false, Studio access is fully revoked while past subscription history remains
  const fullyRemoved = getStudioMembership(
    { isStudioMember: false, studioExpiryDate: pastExpiry },
    { isStudioMember: false, studioExpiryDate: pastExpiry },
    Date.parse("2026-01-01T00:00:00Z"),
  );
  assert.equal(fullyRemoved.isStudioUser, false);
  assert.equal(fullyRemoved.hasPastSubscription, true);
});

test("AdminDashboard and StudioAdminTab both use the authorised removeStudioMembership workflow", () => {
  const dashSrc = fs.readFileSync(path.join(root, "components/AdminDashboard.tsx"), "utf8");
  const studioAdminSrc = fs.readFileSync(path.join(root, "components/StudioAdminTab.tsx"), "utf8");

  assert.match(dashSrc, /store\.dismissExpiredStudioAlert\(/);
  assert.match(dashSrc, /store\.removeStudioMembership\(/);
  assert.match(dashSrc, /data-testid=\{`dismiss-expired-studio-\$\{p\.id\}`\}/);
  assert.match(dashSrc, /data-testid=\{`remove-expired-studio-\$\{p\.id\}`\}/);
  assert.match(dashSrc, /Remove from Studio/);

  assert.match(studioAdminSrc, /store\.removeStudioMembership\(/);
  assert.doesNotMatch(studioAdminSrc, /store\.updatePlayer\(pid,\s*\{\s*isStudioMember:\s*false/);
});
