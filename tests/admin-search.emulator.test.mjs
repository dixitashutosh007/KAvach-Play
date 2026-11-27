/**
 * Firebase Emulator validation for GET /api/admin/search.
 * Exercises real Firebase Auth Emulator ID tokens + Firestore Emulator
 * `.select()` projections, `collectionGroup()` queries, and multi-page
 * cursor pagination.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { initializeApp, getApps, deleteApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const ROOT = pathToFileURL(process.cwd() + "/").href;
register(
  "data:text/javascript," +
    encodeURIComponent(`
const ROOT = ${JSON.stringify(ROOT)};
export async function resolve(spec, ctx, next) {
  if (spec === "next/server") return next("next/server.js", ctx);
  if (spec.startsWith("@/")) spec = new URL(spec.slice(2) + (/\\.[a-z]+$/.test(spec) ? "" : ".ts"), ROOT).href;
  return next(spec, ctx);
}`),
  import.meta.url,
);

const hasEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST);

async function signInEmulatorUser(auth, uid, claims = {}) {
  try {
    await auth.createUser({ uid, email: `${uid}@kavach.test` });
  } catch {
    // Already exists
  }
  if (Object.keys(claims).length > 0) {
    await auth.setCustomUserClaims(uid, claims);
  }
  const customToken = await auth.createCustomToken(uid, claims);
  const res = await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    },
  );
  const data = await res.json();
  if (!res.ok || !data.idToken) {
    throw new Error(`Failed to exchange custom token for ${uid}: ${JSON.stringify(data)}`);
  }
  return data.idToken;
}

describe("GET /api/admin/search (Firebase Auth + Firestore Emulator)", { skip: !hasEmulator ? "Emulator not running" : false }, () => {
  let app;
  let db;
  let auth;
  let adminSearchGET;
  let setSearchPageSizeForTesting;

  let superToken;
  let clubToken;
  let financeToken;
  let playerToken;

  before(async () => {
    const projectId = process.env.GCLOUD_PROJECT || "demo-kavach-play";
    app = getApps().length ? getApps()[0] : initializeApp({ projectId });
    db = getFirestore(app);
    auth = getAuth(app);

    const { setServerDbForTesting } = await import("../lib/server-db.ts");
    setServerDbForTesting(db);

    const serverMod = await import("../lib/admin-search-server.ts");
    setSearchPageSizeForTesting = serverMod.setSearchPageSizeForTesting;
    // Force 3 pages over 5 documents (2 + 2 + 1) without altering production default (500)
    setSearchPageSizeForTesting(2);

    const routeMod = await import("../app/api/admin/search/route.ts");
    adminSearchGET = routeMod.GET;

    // Seed Auth Emulator + appUsers
    superToken = await signInEmulatorUser(auth, "emu-super", { admin: true });
    clubToken = await signInEmulatorUser(auth, "emu-club");
    financeToken = await signInEmulatorUser(auth, "emu-finance");
    playerToken = await signInEmulatorUser(auth, "emu-player");

    await Promise.all([
      db.collection("appUsers").doc("emu-super").set({ status: "Active", role: "admin" }),
      db.collection("appUsers").doc("emu-club").set({ status: "Active", isClubAdmin: true }),
      db.collection("appUsers").doc("emu-finance").set({ status: "Active", isFinanceAdmin: true }),
      db.collection("appUsers").doc("emu-player").set({ status: "Active", role: "player" }),
    ]);

    // Seed 5 players, 5 matches, 5 payments (collectionGroup), 5 otherFees (collectionGroup), 3 subscriptions, 3 announcements
    const writes = [];
    for (let i = 1; i <= 5; i++) {
      const pid = `emu-p-${i}`;
      const mid = `emu-m-${i}`;
      writes.push(
        db.collection("players").doc(pid).set({
          name: `EmuStar Player ${i}`,
          kavachId: `KAV-E0${i}`,
          jerseyNumber: `${10 + i}`,
          mobile: `999000111${i}`,
          email: `emup${i}@secret.test`,
          locality: `SecretArea ${i}`,
          inviteStatus: "Accepted",
          isStudioMember: true,
          studioPlan: "3M",
        }),
        db.collection("matches").doc(mid).set({
          opponent: `EmuStar XI ${i}`,
          date: `2026-11-0${i}`,
          format: "T20",
          matchType: "Practice",
          result: "KAvach Won",
          fee: 700 + i * 10,
          financeStatus: "open",
        }),
        db.collection("matches").doc(mid).collection("payments").doc(`pay-${i}`).set({
          playerId: pid,
          status: "Unpaid",
          feeOverride: 750,
          razorpayPaymentId: `rzp_emu_${i}`,
        }),
        db.collection("players").doc(pid).collection("otherFees").doc(`fee-${i}`).set({
          playerId: pid,
          title: `EmuStar Kit Fee ${i}`,
          amount: 400 + i,
          status: "Unpaid",
          comment: "Emulator due",
        }),
      );
    }

    for (let i = 1; i <= 3; i++) {
      writes.push(
        db.collection("subscriptionHistory").doc(`emu-sub-${i}`).set({
          playerId: `emu-p-${i}`,
          planName: `EmuStar Studio Plan ${i}`,
          newExpiryDate: "2027-03-01",
          paidAmount: 3000 + i * 100,
        }),
        db.collection("posts").doc(`emu-ann-${i}`).set({
          title: `EmuStar Announcement ${i}`,
          text: "Club update",
          authorName: "Admin",
          isAnnouncement: true,
        }),
      );
    }

    await Promise.all(writes);
  });

  after(async () => {
    setSearchPageSizeForTesting?.(null);
    if (app) await deleteApp(app);
  });

  it("rejects unauthenticated (401) and ordinary player (403) callers", async () => {
    const unauth = await adminSearchGET(new Request("http://localhost/api/admin/search?q=EmuStar"));
    assert.equal(unauth.status, 401);

    const playerRes = await adminSearchGET(
      new Request("http://localhost/api/admin/search?q=EmuStar", {
        headers: { Authorization: `Bearer ${playerToken}` },
      }),
    );
    assert.equal(playerRes.status, 403);
  });

  it("Super Admin paginates across all pages without duplicates or skips and computes full totalCount", async () => {
    // limit=2 truncates items per category to 2, while totalMatched & totalCount must reflect all seeded matches
    const res = await adminSearchGET(
      new Request("http://localhost/api/admin/search?q=EmuStar&limit=2", {
        headers: { Authorization: `Bearer ${superToken}` },
      }),
    );
    assert.equal(res.status, 200);
    const body = await res.json();

    const byCat = new Map(body.groups.map((g) => [g.category, g]));
    assert.equal(byCat.get("players").items.length, 2);
    assert.equal(byCat.get("players").totalMatched, 5);
    assert.equal(byCat.get("matches").items.length, 2);
    assert.equal(byCat.get("matches").totalMatched, 5);
    assert.equal(byCat.get("announcements").totalMatched, 3);
    // finance: 5 matchPayments + 5 otherFees = 10
    assert.equal(byCat.get("finance").totalMatched, 10);
    // studio: 5 studio members + 3 subscriptionHistory = 8
    assert.equal(byCat.get("studio").totalMatched, 8);

    const expectedTotal = body.groups.reduce((sum, g) => sum + g.totalMatched, 0);
    assert.equal(body.totalCount, expectedTotal);
    assert.equal(body.totalCount, 31);

    // Also verify with limit=20 that all 5 match IDs are distinct (no duplicates or skips)
    const fullRes = await adminSearchGET(
      new Request("http://localhost/api/admin/search?q=EmuStar&limit=20", {
        headers: { Authorization: `Bearer ${superToken}` },
      }),
    );
    const fullBody = await fullRes.json();
    const matchIds = fullBody.groups.find((g) => g.category === "matches").items.map((i) => i.id);
    assert.equal(new Set(matchIds).size, 5);
  });

  it("Club Admin receives operational results with zero financial fields or financial categories", async () => {
    const res = await adminSearchGET(
      new Request("http://localhost/api/admin/search?q=EmuStar&limit=20", {
        headers: { Authorization: `Bearer ${clubToken}` },
      }),
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    const cats = body.groups.map((g) => g.category);

    assert.equal(cats.includes("finance"), false);
    assert.equal(cats.includes("noShows"), false);
    assert.equal(cats.includes("players"), true);
    assert.equal(cats.includes("matches"), true);
    assert.equal(cats.includes("announcements"), true);

    for (const item of body.groups.find((g) => g.category === "matches").items) {
      assert.equal(item.meta, undefined);
    }
    for (const item of body.groups.find((g) => g.category === "studio").items) {
      assert.equal(item.meta, undefined);
    }
  });

  it("Finance Admin receives financial & collectionGroup results with zero player PII or Club-only categories", async () => {
    const res = await adminSearchGET(
      new Request("http://localhost/api/admin/search?q=EmuStar&limit=20", {
        headers: { Authorization: `Bearer ${financeToken}` },
      }),
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    const cats = body.groups.map((g) => g.category);

    assert.equal(cats.includes("finance"), true);
    assert.equal(cats.includes("matches"), true);
    assert.equal(cats.includes("players"), true);
    assert.equal(cats.includes("announcements"), false);

    // Ensure Finance Admin cannot search by player PII
    const piiRes = await adminSearchGET(
      new Request("http://localhost/api/admin/search?q=emup1@secret.test", {
        headers: { Authorization: `Bearer ${financeToken}` },
      }),
    );
    const piiBody = await piiRes.json();
    assert.equal(piiBody.totalCount, 0);
  });
});
