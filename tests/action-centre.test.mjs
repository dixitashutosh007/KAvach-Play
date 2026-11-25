import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  evaluateWeeklyActionCentre,
  getNextDuePopupAction,
  getOperationalWeekId,
} from "../lib/action-centre.ts";

const root = process.cwd();

test("Action Centre evaluates all 5 weekly actions, deadlines in Asia/Kolkata, and progress", () => {
  // Friday 2026-11-27 18:30 IST (after 6:00 PM Friday deadline)
  const friAfter6Pm = Date.parse("2026-11-27T18:30:00+05:30");
  assert.equal(getOperationalWeekId(friAfter6Pm), "2026-11-27");

  const matches = [
    {
      id: "m_sat",
      date: "2026-11-28",
      time: "09:00",
      format: "T20",
      result: "Pending",
      squadCount: 11,
    },
  ];

  const { currentWeek } = evaluateWeeklyActionCentre({
    nowMs: friAfter6Pm,
    matches,
    awardedWeekendIds: new Set(),
  });

  assert.equal(currentWeek.actions.length, 5);
  assert.deepEqual(
    currentWeek.actions.map((a) => a.id),
    ["add_squad", "share_match", "add_results", "add_potw", "add_actual_fee"],
  );

  const squad = currentWeek.actions.find((a) => a.id === "add_squad");
  const share = currentWeek.actions.find((a) => a.id === "share_match");
  const results = currentWeek.actions.find((a) => a.id === "add_results");
  const potw = currentWeek.actions.find((a) => a.id === "add_potw");
  const fee = currentWeek.actions.find((a) => a.id === "add_actual_fee");

  assert.equal(squad.completed, true);
  assert.equal(squad.status, "completed");

  assert.equal(share.completed, false);
  assert.equal(share.isDue, true);
  assert.equal(share.status, "due");

  // Results, POTW, and Actual Fee are not due yet on Friday
  assert.equal(results.isDue, false);
  assert.equal(results.status, "pending");
  assert.equal(potw.isDue, false);
  assert.equal(fee.isDue, false);

  assert.equal(currentWeek.completedCount, 1);
  assert.equal(currentWeek.percent, 20);
  assert.equal(currentWeek.allCompleted, false);
});

test("Sunday 7 PM results, after-Sunday-7-PM POTW, Monday 6 PM fee deadlines and 100% completion", () => {
  // Monday 2026-11-30 19:00 IST (all 5 deadlines have passed)
  const mon7Pm = Date.parse("2026-11-30T19:00:00+05:30");
  assert.equal(getOperationalWeekId(mon7Pm), "2026-11-27");

  const incompleteMatches = [
    {
      id: "m_sat",
      date: "2026-11-28",
      time: "09:00",
      format: "T20",
      result: "Pending",
      squadCount: 11,
      squadShareInitiatedAt: "2026-11-27T12:00:00Z",
      groundFeePaidAmount: null,
    },
  ];

  const incomplete = evaluateWeeklyActionCentre({
    nowMs: mon7Pm,
    matches: incompleteMatches,
    awardedWeekendIds: new Set(),
  });
  assert.equal(incomplete.currentWeek.actions.find((a) => a.id === "add_results").isDue, true);
  assert.equal(incomplete.currentWeek.actions.find((a) => a.id === "add_potw").isDue, true);
  assert.equal(incomplete.currentWeek.actions.find((a) => a.id === "add_actual_fee").isDue, true);

  // Now complete all underlying records
  const completeMatches = [
    {
      ...incompleteMatches[0],
      result: "KAvach Won",
      groundFeePaidAmount: 4500,
    },
  ];
  const complete = evaluateWeeklyActionCentre({
    nowMs: mon7Pm,
    matches: completeMatches,
    awardedWeekendIds: new Set(["2026-11-28"]),
  });
  assert.equal(complete.currentWeek.completedCount, 5);
  assert.equal(complete.currentWeek.percent, 100);
  assert.equal(complete.currentWeek.allCompleted, true);
});

test("Multi-admin popup dismissal is independent per admin and never marks task completed", () => {
  const friAfter6Pm = Date.parse("2026-11-27T18:30:00+05:30");
  const { currentWeek } = evaluateWeeklyActionCentre({
    nowMs: friAfter6Pm,
    matches: [{ id: "m1", date: "2026-11-28", time: "09:00", format: "T20", result: "Pending", squadCount: 0 }],
  });

  // Admin A dismisses add_squad
  const adminADismissed = { add_squad: currentWeek.weekId };
  const adminANext = getNextDuePopupAction(currentWeek, adminADismissed);
  assert.equal(adminANext.id, "share_match");

  // Admin B has no dismissals -> still receives add_squad popup
  const adminBNext = getNextDuePopupAction(currentWeek, {});
  assert.equal(adminBNext.id, "add_squad");

  // Underlying add_squad task remains incomplete
  assert.equal(currentWeek.actions.find((a) => a.id === "add_squad").completed, false);
});

test("Weekly completion history is retained for prior weeks", () => {
  const thisFri = Date.parse("2026-11-27T18:30:00+05:30");
  const { history } = evaluateWeeklyActionCentre({
    nowMs: thisFri,
    matches: [
      {
        id: "m_prev",
        date: "2026-11-21",
        time: "09:00",
        format: "T20",
        result: "KAvach Won",
        squadCount: 11,
        squadShareInitiatedAt: "2026-11-20T12:00:00Z",
        groundFeePaidAmount: 4000,
      },
    ],
    awardedWeekendIds: new Set(["2026-11-21"]),
  });
  assert.equal(history.length, 1);
  assert.equal(history[0].weekId, "2026-11-20");
  assert.equal(history[0].allCompleted, true);
});

test("Action Centre is wired into AdminDashboard, NotificationsTab, ProfileTab, and SquadNotifyModal", () => {
  const dash = fs.readFileSync(path.join(root, "components/AdminDashboard.tsx"), "utf8");
  const notif = fs.readFileSync(path.join(root, "components/NotificationsTab.tsx"), "utf8");
  const prof = fs.readFileSync(path.join(root, "components/ProfileTab.tsx"), "utf8");
  const modal = fs.readFileSync(path.join(root, "components/matches/SquadNotifyModal.tsx"), "utf8");

  assert.match(dash, /<ClubActionCentre/);
  assert.match(notif, /<ClubActionCentre/);
  assert.match(prof, /<ClubActionCentre/);
  assert.match(modal, /\/api\/admin\/action-centre/);
});
