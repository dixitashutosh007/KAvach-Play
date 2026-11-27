import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  isObsoleteAdminActivityNotification,
  filterVisibleNotifications,
} from "../lib/historical-activity-filter.ts";

describe("Phase C: Historical Administrative Prompt Filtering", () => {
  // Friday 2026-11-27 18:30 IST (current operational week started Fri 2026-11-27 00:00 IST)
  const nowMs = Date.parse("2026-11-27T18:30:00+05:30");
  const prevWeekTs = { seconds: Math.floor(Date.parse("2026-11-21T10:00:00+05:30") / 1000) };
  const currentWeekTs = { seconds: Math.floor(Date.parse("2026-11-27T10:00:00+05:30") / 1000) };

  it("hides obsolete historical Assign Captain, Player of the Week, and Match Fee admin prompts", () => {
    const notifications = [
      { id: "n1", userId: "admin", title: "Assign Captain", message: "Match vs Titans needs a captain", createdAt: prevWeekTs },
      { id: "n2", userId: "admin", title: "Player of the Week", message: "Select Player of the Week", createdAt: prevWeekTs },
      { id: "n3", userId: "admin", title: "Actual Match Fee", message: "Update actual match fee entry", createdAt: prevWeekTs },
      { id: "n4", userId: "admin", title: "Assign Captain", message: "Upcoming match needs captain", createdAt: currentWeekTs },
      { id: "n5", userId: "admin", title: "New Player Request", message: "Player requested to join", createdAt: prevWeekTs, metadata: { type: "player_request" } },
      { id: "n6", userId: "all", title: "Player of the Weekend", message: "Rohan won POTW!", createdAt: prevWeekTs, metadata: { type: "potw_award" } },
    ];

    const visible = filterVisibleNotifications(notifications, { isAdmin: true, nowMs });
    assert.deepEqual(visible.map((n) => n.id), ["n4", "n5", "n6"]);
  });

  it("never hides player notifications or genuine award/payment records", () => {
    const notifications = [
      { id: "p1", userId: "uid_1", title: "Match Fee Due", message: "Your match fee is due", createdAt: prevWeekTs },
      { id: "p2", userId: "all", title: "Player of the Weekend", message: "Awarded to Rohan", createdAt: prevWeekTs, metadata: { type: "potw_award" } },
    ];
    assert.equal(isObsoleteAdminActivityNotification(notifications[0], nowMs), false);
    assert.equal(isObsoleteAdminActivityNotification(notifications[1], nowMs), false);

    const visiblePlayer = filterVisibleNotifications(notifications, { isAdmin: false, uid: "uid_1", nowMs });
    assert.deepEqual(visiblePlayer.map((n) => n.id), ["p1", "p2"]);
  });

  it("wires filterVisibleNotifications in NotificationsTab and app/page.tsx, preserves Previous Weeks History, removes obsolete historical prompts", () => {
    const notifSrc = fs.readFileSync(path.resolve("components/NotificationsTab.tsx"), "utf8");
    const pageSrc = fs.readFileSync(path.resolve("app/page.tsx"), "utf8");
    const actionCentreSrc = fs.readFileSync(path.resolve("components/action-centre/ClubActionCentre.tsx"), "utf8");
    const promptsSrc = fs.readFileSync(path.resolve("components/weekend-ops/WeekendPrompts.tsx"), "utf8");
    assert.match(notifSrc, /filterVisibleNotifications/);
    assert.match(pageSrc, /filterVisibleNotifications/);
    assert.match(actionCentreSrc, /Previous Weeks History/);
    assert.doesNotMatch(promptsSrc, /data-testid="history-fees"|testId="history-fees"/);
    assert.doesNotMatch(promptsSrc, /data-testid="history-potw"|testId="history-potw"/);
    assert.doesNotMatch(promptsSrc, /data-testid="history-results"|testId="history-results"/);
  });

  it("filters action-centre & weekend-ops historical shapes with _seconds timestamps and personal admin UIDs", () => {
    const prevWeekAdminTs = { _seconds: Math.floor(Date.parse("2026-11-20T18:00:00+05:30") / 1000) };
    const notifications = [
      { id: "a1", userId: "admin", title: "Club Admin Reminder", message: "Add Players to the Squad", createdAt: prevWeekAdminTs },
      { id: "a2", userId: "admin", title: "Weekend Operations", message: "Enter Match Results", createdAt: prevWeekAdminTs, metadata: { type: "weekend_ops" } },
      { id: "a3", userId: "admin_uid_1", title: "Share Match Details", message: "Share Match Details in the Group", createdAt: prevWeekAdminTs, metadata: { type: "action_centre_reminder" } },
      { id: "a4", userId: "admin", title: "Studio Subscription Purchased", message: "Rohan bought Pro", createdAt: prevWeekAdminTs },
    ];
    const visible = filterVisibleNotifications(notifications, { isAdmin: true, uid: "admin_uid_1", nowMs });
    assert.deepEqual(visible.map((n) => n.id), ["a4"]);
  });
});
