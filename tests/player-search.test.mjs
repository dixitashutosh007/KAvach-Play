import test from "node:test";
import assert from "node:assert/strict";
import { searchPlayerAccessibleData } from "../lib/player-search.ts";

const baseInput = {
  matches: [
    {
      id: "m-open",
      opponent: "Royal Strikers",
      date: "2026-11-28",
      format: "T20",
      groundId: "g-1",
      visibility: "open",
    },
    {
      id: "m-private",
      opponent: "Royal Secret",
      date: "2026-11-29",
      format: "T20",
      groundId: "g-1",
      visibility: "closed",
      selectedPlayerIds: ["other-player"],
    },
  ],
  posts: [
    { id: "a-1", title: "Royal Jersey Launch", text: "New kit", isAnnouncement: true },
    { id: "f-1", title: "Royal Match Photos", text: "Gallery", isAnnouncement: false },
  ],
  players: [
    {
      id: "p-1",
      name: "Royal Sharma",
      kavachId: "KAV-01",
      phone: "9998887776",
      email: "royal@secret.com",
    },
    {
      id: "p-2",
      name: "Disabled Player",
      kavachId: "KAV-02",
      disabled: true,
    },
    {
      id: "p-3",
      name: "Merged Player",
      kavachId: "KAV-03",
      mergedInto: "p-1",
    },
  ],
  grounds: [
    {
      id: "g-1",
      name: "Royal Oval Ground",
      mapUrl: "https://maps.google.com/?q=1,2",
      organiserName: "Org",
      organiserPhone: "9111111111",
      gpayNumber: "9222222222",
    },
  ],
  polls: [
    { id: "poll-1", title: "Royal Kit Color", type: "singleChoice", options: ["Scarlet", "Gold"], isSticked: false, isActive: true },
    { id: "poll-2", title: "Royal Inactive Poll", type: "singleChoice", options: ["A"], isSticked: false, isActive: false },
  ],
  payments: [
    { id: "pay-1", matchId: "m-private", playerId: "other-player", status: "Unpaid", amount: 500 },
  ],
  mePlayer: { id: "p-1", name: "Royal Sharma" },
  isAdmin: false,
};

test("searchPlayerAccessibleData returns matches, grounds, polls, posts, and public players while enforcing permissions", () => {
  const res = searchPlayerAccessibleData({ ...baseInput, query: "royal" });
  assert.ok(res);

  // Ineligible closed match is excluded
  assert.deepEqual(res.matches.map((m) => m.id), ["m-open"]);

  // Grounds exclude organiserPhone and gpayNumber
  assert.equal(res.grounds.length, 1);
  assert.equal(res.grounds[0].name, "Royal Oval Ground");
  assert.equal("organiserPhone" in res.grounds[0], false);
  assert.equal("gpayNumber" in res.grounds[0], false);

  // Active polls included; inactive polls excluded
  assert.deepEqual(res.polls.map((p) => p.id), ["poll-1"]);

  // Disabled & merged players excluded; private PII stripped from returned player
  assert.equal(res.players.length, 1);
  assert.equal(res.players[0].id, "p-1");
  for (const key of ["phone", "email", "dob", "chestSize", "jerseyNumber", "authUid", "paymentHistory"]) {
    assert.equal(key in res.players[0], false);
  }
});

test("searchPlayerAccessibleData enforces destination-screen eligibility and feature flags", () => {
  const phoneRes = searchPlayerAccessibleData({ ...baseInput, query: "9998887776" });
  assert.equal(phoneRes?.players.length, 0);

  const emailRes = searchPlayerAccessibleData({ ...baseInput, query: "royal@secret.com" });
  assert.equal(emailRes?.players.length, 0);

  const gpayRes = searchPlayerAccessibleData({ ...baseInput, query: "9222222222" });
  assert.equal(gpayRes?.grounds.length, 0);

  const orgPhoneRes = searchPlayerAccessibleData({ ...baseInput, query: "9111111111" });
  assert.equal(orgPhoneRes?.grounds.length, 0);

  // Searching by ground name still excludes ineligible squad-assigned matches for non-admins
  const groundQueryRes = searchPlayerAccessibleData({ ...baseInput, query: "Royal Oval Ground" });
  assert.deepEqual(groundQueryRes?.matches.map((m) => m.id), ["m-open"]);

  // Unlinked user (mePlayer = null) cannot discover matches (consistent with destination screen)
  const unlinkedRes = searchPlayerAccessibleData({ ...baseInput, mePlayer: null, query: "Royal" });
  assert.deepEqual(unlinkedRes?.matches.map((m) => m.id), []);

  // Disabled features hide associated results
  const disabledAllPosts = searchPlayerAccessibleData({
    ...baseInput,
    query: "royal",
    isFeatureEnabled: (k) => k !== "polls" && k !== "announcements" && k !== "feed",
  });
  assert.equal(disabledAllPosts?.polls.length, 0);
  assert.equal(disabledAllPosts?.announcements.length, 0);
});
