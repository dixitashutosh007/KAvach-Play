/**
 * Google sign-in ↔ player record linking (`tests/google-player-linking.test.mjs`).
 *
 * Pure decision logic plus the transaction flow against an in-memory fake
 * Firestore. No emulator, network or real database.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  checkGoogleLinkEligibility,
  selectPlayerForEmail,
  decideGoogleLink,
  linkGoogleLogin,
  normalizeEmail,
} from "../lib/google-linking.ts";

const src = (f) => fs.readFileSync(path.resolve(f), "utf-8");

// ── Minimal in-memory Firestore fake (only what linkGoogleLogin uses) ───────
function makeDb(initial) {
  const store = JSON.parse(JSON.stringify(initial)); // { players: {id: data}, appUsers: {id: data} }
  const snap = (id, data) => ({ id, exists: data !== undefined, data: () => (data === undefined ? undefined : { ...data }) });
  const docRef = (col, id) => ({ __col: col, __id: id, get: async () => snap(id, store[col]?.[id]) });
  const query = (col, field, value) => ({
    __query: true,
    get: async () => ({
      docs: Object.entries(store[col] || {})
        .filter(([, d]) => d[field] === value)
        .map(([id, d]) => snap(id, d)),
    }),
  });
  const db = {
    store,
    writes: [],
    collection: (col) => ({
      get: async () => ({ docs: Object.entries(store[col] || {}).map(([id, d]) => snap(id, d)) }),
      doc: (id) => docRef(col, id),
      where: (field, _op, value) => query(col, field, value),
    }),
    runTransaction: async (fn) => {
      const pending = [];
      const tx = {
        get: (refOrQuery) => refOrQuery.get(),
        set: (ref, data, opts) => pending.push({ ref, data, opts }),
      };
      const result = await fn(tx);
      for (const { ref, data, opts } of pending) {
        store[ref.__col] = store[ref.__col] || {};
        store[ref.__col][ref.__id] = opts?.merge ? { ...(store[ref.__col][ref.__id] || {}), ...data } : data;
        db.writes.push({ col: ref.__col, id: ref.__id, data });
      }
      return result;
    },
  };
  return db;
}

const google = (over = {}) => ({ uid: "g-uid", email: "Asha@Example.com", emailVerified: true, signInProvider: "google.com", ...over });

// ─────────────────────────────────────────────────────────────────────────────
describe("Eligibility comes only from the verified token", () => {
  it("requires Google sign-in", () => {
    const r = checkGoogleLinkEligibility(google({ signInProvider: "password" }));
    assert.equal(r.ok, false);
    assert.equal(r.code, "NOT_GOOGLE_SIGN_IN");
  });
  it("requires a Google-verified email", () => {
    assert.equal(checkGoogleLinkEligibility(google({ emailVerified: false })).code, "EMAIL_NOT_VERIFIED");
    assert.equal(checkGoogleLinkEligibility(google({ emailVerified: undefined })).code, "EMAIL_NOT_VERIFIED");
  });
  it("normalises the email", () => {
    assert.deepEqual(checkGoogleLinkEligibility(google()), { ok: true, email: "asha@example.com" });
    assert.equal(normalizeEmail("  A@B.COM "), "a@b.com");
  });
});

describe("Player selection", () => {
  const players = [
    { id: "p1", data: { email: "asha@example.com" } },
    { id: "p2", data: { email: "ASHA@example.com", disabled: true } },
    { id: "p3", data: { email: "asha@example.com", mergedInto: "p1" } },
    { id: "p4", data: { email: "ravi@example.com" } },
  ];
  it("matches exactly one active, un-merged player (case-insensitive)", () => {
    const r = selectPlayerForEmail(players, "asha@example.com");
    assert.equal(r.ok, true);
    assert.equal(r.player.id, "p1");
  });
  it("no match → 404; duplicate active match → 409 (never guesses)", () => {
    assert.equal(selectPlayerForEmail(players, "none@example.com").status, 404);
    const dup = [...players, { id: "p5", data: { email: "Asha@example.com" } }];
    assert.equal(selectPlayerForEmail(dup, "asha@example.com").code, "AMBIGUOUS_EMAIL");
  });
  it("players mid-merge are not eligible", () => {
    assert.equal(selectPlayerForEmail([{ id: "x", data: { email: "a@b.co", mergeStatus: "in_progress" } }], "a@b.co").status, 404);
  });
});

describe("Link decision", () => {
  const player = { id: "p1", data: { email: "asha@example.com", authUid: "phone-uid" } };
  it("keeps the phone login as primary and adds the Google login", () => {
    assert.deepEqual(decideGoogleLink({ uid: "g-uid", player, appUserPlayerId: null, primaryPlayerIds: [] }), { ok: true, action: "link", playerId: "p1" });
  });
  it("is idempotent", () => {
    assert.equal(decideGoogleLink({ uid: "g-uid", player, appUserPlayerId: "p1", primaryPlayerIds: [] }).action, "already-linked");
    assert.equal(decideGoogleLink({ uid: "phone-uid", player, appUserPlayerId: null, primaryPlayerIds: ["p1"] }).action, "already-linked");
  });
  it("never moves a login already linked to another player", () => {
    assert.equal(decideGoogleLink({ uid: "g-uid", player, appUserPlayerId: "p9", primaryPlayerIds: [] }).code, "LOGIN_LINKED_TO_OTHER_PLAYER");
    assert.equal(decideGoogleLink({ uid: "g-uid", player, appUserPlayerId: null, primaryPlayerIds: ["p9"] }).code, "LOGIN_LINKED_TO_OTHER_PLAYER");
  });
});

describe("linkGoogleLogin transaction (in-memory)", () => {
  it("links: writes ONLY appUsers/{uid}.playerId; player authUid/phone link untouched", async () => {
    const db = makeDb({
      players: { p1: { name: "Asha", email: "asha@example.com", authUid: "phone-uid", mobile: "+919999999999" } },
      appUsers: { "g-uid": { email: "asha@example.com", authProviders: ["google.com"] } },
    });
    const r = await linkGoogleLogin(db, google());
    assert.deepEqual(r, { ok: true, playerId: "p1", alreadyLinked: false });
    assert.equal(db.writes.length, 1);
    assert.equal(db.writes[0].col, "appUsers");
    assert.equal(db.writes[0].id, "g-uid");
    assert.equal(db.store.appUsers["g-uid"].playerId, "p1");
    assert.equal(db.store.appUsers["g-uid"].authProviders[0], "google.com", "existing fields preserved (merge)");
    assert.equal(db.store.players.p1.authUid, "phone-uid", "primary phone login unchanged");
  });
  it("second call is a no-op", async () => {
    const db = makeDb({ players: { p1: { email: "asha@example.com" } }, appUsers: { "g-uid": { playerId: "p1" } } });
    const r = await linkGoogleLogin(db, google());
    assert.equal(r.alreadyLinked, true);
    assert.equal(db.writes.length, 0);
  });
  it("refuses unverified email or non-Google logins without writing", async () => {
    const db = makeDb({ players: { p1: { email: "asha@example.com" } }, appUsers: {} });
    assert.equal((await linkGoogleLogin(db, google({ emailVerified: false }))).ok, false);
    assert.equal((await linkGoogleLogin(db, google({ signInProvider: "phone" }))).ok, false);
    assert.equal(db.writes.length, 0);
  });
  it("refuses when this login already points at another player", async () => {
    const db = makeDb({ players: { p1: { email: "asha@example.com" }, p2: { email: "other@example.com" } }, appUsers: { "g-uid": { playerId: "p2" } } });
    const r = await linkGoogleLogin(db, google());
    assert.equal(r.status, 409);
    assert.equal(db.writes.length, 0);
  });
});

describe("Wiring", () => {
  it("route takes identity only from the verified token and rejects a body", () => {
    const route = src("app/api/player/link-google/route.ts");
    assert.match(route, /const auth = await requireAuth\(req\);/);
    assert.match(route, /emailVerified: auth\.emailVerified,/);
    assert.match(route, /signInProvider: auth\.signInProvider,/);
    assert.match(route, /does not accept a request body/);
  });
  it("requireAuth exposes verified-email and provider from the decoded token", () => {
    const s = src("lib/server-auth.ts");
    assert.match(s, /emailVerified: decoded\.email_verified === true,/);
    assert.match(s, /decoded\.firebase\?\.sign_in_provider/);
  });
  it("client never writes player/appUsers links directly; it calls the server routes", () => {
    const page = src("app/page.tsx");
    const fn = page.slice(page.indexOf("const handleSyncAccount"), page.indexOf("const handleSyncAccount") + 2000);
    assert.match(fn, /"\/api\/player\/link-google"/);
    assert.match(fn, /"\/api\/player\/link-account"/);
    assert.ok(!/updateDoc\(|setDoc\(/.test(fn));
  });
  it("player payments are scoped by the resolved player id, not the login uid", () => {
    const page = src("app/page.tsx");
    // D-16: admins are only unscoped in Admin persona; in Player persona they are
    // scoped by the resolved player id exactly like a regular player.
    assert.match(page, /const playerScope = isAdminUser && persona === "admin" \? undefined : scopedPlayerId \|\| user\?\.uid;/);
    assert.match(page, /store\.refreshNonce, scopedPlayerId\]\);/);
  });
  it("Firestore rules still forbid clients from changing appUsers.playerId", () => {
    const rules = src("firestore.rules");
    const block = rules.slice(rules.indexOf("match /appUsers/{userId}"), rules.indexOf("match /appUsers/{userId}") + 1400);
    assert.match(block, /allow create: if !incoming\(\)\.keys\(\)\.hasAny\(\['playerId'\]\)/);
    assert.match(block, /allow update: if !incoming\(\)\.diff\(existing\(\)\)\.affectedKeys\(\)\.hasAny\(\['playerId'\]\)/);
  });
});

describe("Regression: record whose id equals the Google login uid", () => {
  it("the client email candidate no longer excludes the login's own record id", () => {
    const page = src("app/page.tsx");
    const block = page.slice(page.indexOf("const existingPlayerWithSameEmail ="), page.indexOf("const existingPlayerWithSameEmail =") + 400);
    assert.ok(!block.includes("p.id !== user?.uid"), "own-id record must be offered for Google linking");
  });
  it("server links such a record via the verified email without touching its authUid", async () => {
    const db = makeDb({
      players: { "g-uid": { name: "Asha", email: "asha@example.com", authUid: "phone-uid" } },
      appUsers: {},
    });
    const r = await linkGoogleLogin(db, google());
    assert.deepEqual(r, { ok: true, playerId: "g-uid", alreadyLinked: false });
    assert.equal(db.store.appUsers["g-uid"].playerId, "g-uid");
    assert.equal(db.store.players["g-uid"].authUid, "phone-uid");
  });
  it("without a verified matching email there is no link (remediation preserved)", async () => {
    const db = makeDb({ players: { "g-uid": { name: "Asha", email: "different@example.com", authUid: "phone-uid" } }, appUsers: {} });
    const r = await linkGoogleLogin(db, google());
    assert.equal(r.ok, false);
    assert.equal(db.writes.length, 0);
  });
});
