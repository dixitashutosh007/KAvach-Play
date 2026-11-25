import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  buildCaptainWhatsAppUrl,
  getEligibleCaptainPlayers,
  getUpcomingMatchesMissingCaptain,
  isFridayInKolkata,
  resolveMatchCaptain,
  shouldShowFridayCaptainReminder,
} from "../lib/match-captain.ts";
import {
  buildDefaultSquadNotifyMessage,
  buildSquadWhatsAppMessage,
  buildSquadWhatsAppUrl,
  getMatchesWithinNext48Hours,
  resolveMatchSquadRecipients,
} from "../lib/squad-notify.ts";

const root = process.cwd();

const makePlayer = (overrides = {}) => ({
  id: "p1",
  name: "Virat K",
  mobile: "9876543210",
  inviteStatus: "Verified",
  ...overrides,
});

const makeMatch = (overrides = {}) => ({
  id: "m1",
  groundId: "g1",
  format: "T20",
  jerseyColor: "Scarlet Red",
  opponent: "Titans",
  matchType: "Practice",
  fee: 500,
  date: "2026-11-27",
  time: "09:00",
  maxSquadSize: 12,
  result: "Pending",
  ...overrides,
});

test("Captain assignment: eligible list is not restricted to squad and handles missing/inactive/legacy matches safely", () => {
  const players = [
    makePlayer({ id: "p_active_1", name: "Arjun" }),
    makePlayer({ id: "p_active_2", name: "Bharat", inviteStatus: "Accepted" }),
    makePlayer({ id: "p_disabled", name: "Disabled", disabled: true }),
    makePlayer({ id: "p_merged", name: "Merged", mergedInto: "p_active_1" }),
    makePlayer({ id: "p_rejected", name: "Rejected", inviteStatus: "Rejected" }),
    makePlayer({ id: "p_pending", name: "Pending", inviteStatus: "Pending" }),
  ];

  const eligible = getEligibleCaptainPlayers(players);
  assert.deepEqual(
    eligible.map((p) => p.id),
    ["p_active_1", "p_active_2"],
  );

  // Legacy match without captainId
  assert.equal(resolveMatchCaptain(makeMatch(), players), null);

  // Active captain resolves cleanly
  assert.deepEqual(
    resolveMatchCaptain(makeMatch({ captainId: "p_active_2" }), players),
    { id: "p_active_2", name: "Bharat", mobile: "9876543210" },
  );

  // Deleted or disabled captain returns null without silently substituting another player
  assert.equal(resolveMatchCaptain(makeMatch({ captainId: "p_deleted" }), players), null);
  assert.equal(resolveMatchCaptain(makeMatch({ captainId: "p_disabled" }), players), null);
  assert.equal(resolveMatchCaptain(makeMatch({ captainId: "p_merged" }), players), null);
});

test("Player Contact Captain WhatsApp URL formatting and missing/invalid phone handling", () => {
  const match = makeMatch({ opponent: "Warriors", date: "2026-11-28" });

  const okIndian = buildCaptainWhatsAppUrl(
    { id: "p1", name: "Rohit", mobile: "9876543210" },
    match,
  );
  assert.equal(okIndian.ok, true);
  assert.equal(okIndian.digits, "919876543210");
  assert.match(okIndian.url, /^https:\/\/wa\.me\/919876543210\?text=/);
  assert.match(decodeURIComponent(okIndian.url), /Warriors/);

  const okIntl = buildCaptainWhatsAppUrl(
    { id: "p2", name: "Alex", mobile: "+447911123456" },
    match,
  );
  assert.equal(okIntl.ok, true);
  assert.equal(okIntl.digits, "447911123456");

  const missing = buildCaptainWhatsAppUrl({ id: "p3", name: "NoPhone", mobile: "" }, match);
  assert.equal(missing.ok, false);

  const invalid = buildCaptainWhatsAppUrl({ id: "p4", name: "BadPhone", mobile: "123" }, match);
  assert.equal(invalid.ok, false);
});

test("Friday Captain Reminder uses Asia/Kolkata timezone and clears when captain is assigned", () => {
  // 2026-11-27 is a Friday in IST.
  // 2026-11-26T18:30:00Z == 2026-11-27 00:00:00 IST (Friday)
  const friStartIst = Date.parse("2026-11-26T18:30:00Z");
  // 2026-11-27T18:29:59Z == 2026-11-27 23:59:59 IST (Friday)
  const friEndIst = Date.parse("2026-11-27T18:29:59Z");
  // 2026-11-27T18:30:00Z == 2026-11-28 00:00:00 IST (Saturday)
  const satStartIst = Date.parse("2026-11-27T18:30:00Z");

  assert.equal(isFridayInKolkata(friStartIst), true);
  assert.equal(isFridayInKolkata(friEndIst), true);
  assert.equal(isFridayInKolkata(satStartIst), false);

  const mNoCap = makeMatch({ id: "m_nocap", date: "2026-11-28", time: "09:00" });
  const mWithCap = makeMatch({ id: "m_cap", date: "2026-11-29", time: "09:00", captainId: "p1" });

  // Non-admin never sees reminder
  assert.equal(shouldShowFridayCaptainReminder([mNoCap], false, friStartIst), false);

  // Authorized admin sees reminder on Friday when a match lacks a captain
  assert.equal(shouldShowFridayCaptainReminder([mNoCap, mWithCap], true, friStartIst), true);
  assert.deepEqual(
    getUpcomingMatchesMissingCaptain([mNoCap, mWithCap], friStartIst).map((m) => m.id),
    ["m_nocap"],
  );

  // Once captain is assigned, reminder disappears immediately
  const mAssigned = { ...mNoCap, captainId: "p2" };
  assert.equal(shouldShowFridayCaptainReminder([mAssigned, mWithCap], true, friStartIst), false);
});

test("Squad notification: 48h window, squad resolution (incl. non-payment squad members, excl. Not Playing), and wa.me encoding", () => {
  const nowMs = Date.parse("2026-11-27T09:00:00+05:30");
  const mSoon = makeMatch({ id: "m_soon", date: "2026-11-28", time: "09:00", captainId: "p1" });
  const mLater = makeMatch({ id: "m_later", date: "2026-12-05", time: "09:00" });
  const mPast = makeMatch({ id: "m_past", date: "2026-11-25", time: "09:00" });
  const mAbandoned = makeMatch({ id: "m_abandoned", date: "2026-11-28", time: "14:00", result: "Abandoned" });

  const next48 = getMatchesWithinNext48Hours([mSoon, mLater, mPast, mAbandoned], nowMs);
  assert.deepEqual(next48.map((m) => m.id), ["m_soon"]);

  const players = [
    makePlayer({ id: "p1", name: "Captain A", mobile: "9876543210" }),
    makePlayer({ id: "p2", name: "Paid B", mobile: "+91 98765 00002" }),
    makePlayer({ id: "p3", name: "NoPayRecord C", mobile: "9876500003" }),
    makePlayer({ id: "p4", name: "Out D", mobile: "9876500004" }),
    makePlayer({ id: "p5", name: "BadPhone E", mobile: "12345" }),
  ];

  const payments = [
    { id: "pay1", matchId: "m_soon", playerId: "p1", status: "Unpaid", availability: "Confirmed" },
    { id: "pay2", matchId: "m_soon", playerId: "p2", status: "Paid", availability: "Confirmed" },
    { id: "pay4", matchId: "m_soon", playerId: "p4", status: "Not Playing", availability: "No" },
    { id: "pay5", matchId: "m_soon", playerId: "p5", status: "Unpaid", availability: "Confirmed" },
    { id: "payGuest", matchId: "m_soon", playerId: "p1", status: "Unpaid", availability: "Confirmed", guestName: "Guest of Captain" },
  ];

  const matchWithDirectSquad = { ...mSoon, squadPlayerIds: ["p3", "p4"] };
  const resolution = resolveMatchSquadRecipients(matchWithDirectSquad, payments, players);

  // p1, p2, p3 (via squadPlayerIds without payment doc), p5 included; p4 (Not Playing / No) excluded; guest deduped
  assert.deepEqual(
    resolution.recipients.map((r) => r.player.id),
    ["p1", "p2", "p5", "p3"],
  );
  assert.equal(resolution.validPhoneCount, 3);
  assert.deepEqual(resolution.missingPhoneNames, ["BadPhone E"]);

  const msg = buildSquadWhatsAppMessage({
    match: mSoon,
    ground: { id: "g1", name: "Chinnaswamy Nets", mapUrl: "https://maps.example/1", organiserName: "Org", gpayNumber: "999" },
    players,
    customMessage: "Report by 8:15 AM sharp.",
    resolution,
  });

  assert.match(msg, /KAvach vs Titans/);
  assert.match(msg, /Captain: Captain A/);
  assert.match(msg, /Report by 8:15 AM sharp\./);
  assert.match(msg, /@\+919876543210/);
  assert.match(msg, /@\+919876500002/);
  assert.match(msg, /@\+919876500003/);
  assert.match(msg, /BadPhone E/);
  assert.doesNotMatch(msg, /9876500004/);

  const url = buildSquadWhatsAppUrl(msg);
  assert.match(url, /^https:\/\/wa\.me\/\?text=/);
  assert.equal(decodeURIComponent(url.replace("https://wa.me/?text=", "")), msg);

  assert.ok(buildDefaultSquadNotifyMessage(mSoon).length > 0);
});

test("UI wiring: CAP marker, Contact Captain, and shared SquadNotifyModal in Admin Home & Match Center", () => {
  const squadListSrc = fs.readFileSync(path.join(root, "components/matches/SquadList.tsx"), "utf8");
  const playerCardSrc = fs.readFileSync(path.join(root, "components/matches/PlayerMatchCard.tsx"), "utf8");
  const playerDetailSrc = fs.readFileSync(path.join(root, "components/matches/PlayerMatchDetailModal.tsx"), "utf8");
  const matchesTabSrc = fs.readFileSync(path.join(root, "components/MatchesTab.tsx"), "utf8");
  const adminDashSrc = fs.readFileSync(path.join(root, "components/AdminDashboard.tsx"), "utf8");

  assert.match(squadListSrc, /CAP/);
  assert.match(playerDetailSrc, /CAP/);
  assert.match(playerCardSrc, /contact-captain-/);
  assert.match(playerCardSrc, /Contact Captain/);
  assert.match(matchesTabSrc, /<SquadNotifyModal/);
  assert.match(matchesTabSrc, /<CaptainSelector/);
  assert.match(matchesTabSrc, /match-center-notify-48h/);
  assert.match(adminDashSrc, /<SquadNotifyModal/);
  assert.match(adminDashSrc, /friday-captain-reminder/);
});
