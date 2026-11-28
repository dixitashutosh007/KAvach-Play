/**
 * Firebase Auth + Firestore Emulator validation for Audit Logging Coverage Completion.
 *
 * Tests server-authoritative transactional audit writes & role-based audit viewer
 * across Announcements, Badges, Matches (including base fee), and GET /api/audit/log.
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
  } catch {}
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

describe("Audit Logging Coverage Completion (Firebase Auth + Firestore Emulator)", { skip: !hasEmulator ? "Emulator not running" : false }, () => {
  let app;
  let db;
  let auth;
  let announcementsRoute;
  let badgesRoute;
  let matchesRoute;
  let postsRoute;
  let auditLogRoute;
  let writeServerAudit;

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

    announcementsRoute = await import("../app/api/admin/announcements/route.ts");
    badgesRoute = await import("../app/api/admin/badges/route.ts");
    matchesRoute = await import("../app/api/admin/matches/route.ts");
    postsRoute = await import("../app/api/admin/posts/route.ts");
    auditLogRoute = await import("../app/api/audit/log/route.ts");
    ({ writeServerAudit } = await import("../lib/server-audit.ts"));

    superToken = await signInEmulatorUser(auth, "aud-super", { admin: true });
    clubToken = await signInEmulatorUser(auth, "aud-club");
    financeToken = await signInEmulatorUser(auth, "aud-finance");
    playerToken = await signInEmulatorUser(auth, "aud-player");

    await Promise.all([
      db.collection("appUsers").doc("aud-super").set({ status: "Active", name: "Super User", role: "admin" }),
      db.collection("appUsers").doc("aud-club").set({ status: "Active", name: "Club User", isClubAdmin: true }),
      db.collection("appUsers").doc("aud-finance").set({ status: "Active", name: "Finance User", isFinanceAdmin: true }),
      db.collection("appUsers").doc("aud-player").set({ status: "Active", name: "Plain Player", role: "player" }),
    ]);

    // Seed one payment audit entry so role-based filtering in GET /api/audit/log can be verified
    await writeServerAudit(db, {
      id: "seed_payment_audit_1",
      actorId: "aud-finance",
      actorName: "Finance User",
      action: "paid",
      entity: "payment",
      entityId: "pay-seed-1",
      entityLabel: "Player 1",
      changes: [{ field: "status", oldValue: "Unpaid", newValue: "Paid" }],
      summary: "Marked payment Paid (₹800)",
    });
  });

  after(async () => {
    if (app) await deleteApp(app);
  });

  it("Announcements: POST, PATCH, DELETE write transactional server audits and deduplicate retries", async () => {
    // Player & Finance Admin rejected
    const finPost = await announcementsRoute.POST(
      new Request("http://localhost/api/admin/announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${financeToken}` },
        body: JSON.stringify({ title: "Blocked", text: "Blocked" }),
      }),
    );
    assert.equal(finPost.status, 403);

    // Club Admin creates announcement with idempotencyKey
    const createBody = {
      id: "emu-ann-1",
      title: "Net Practice",
      text: "6 AM sharp",
      isPinned: true,
      idempotencyKey: "ann_key_1",
    };
    const res1 = await announcementsRoute.POST(
      new Request("http://localhost/api/admin/announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${clubToken}` },
        body: JSON.stringify(createBody),
      }),
    );
    assert.equal(res1.status, 200);

    // Retry with same idempotencyKey deduplicates
    const resRetry = await announcementsRoute.POST(
      new Request("http://localhost/api/admin/announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${clubToken}` },
        body: JSON.stringify(createBody),
      }),
    );
    assert.equal(resRetry.status, 200);
    assert.equal((await resRetry.json()).deduplicated, true);

    // Update announcement
    const patchRes = await announcementsRoute.PATCH(
      new Request("http://localhost/api/admin/announcements", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${clubToken}` },
        body: JSON.stringify({
          postId: "emu-ann-1",
          fields: { title: "Net Practice Updated", isPinned: false },
          idempotencyKey: "ann_upd_1",
        }),
      }),
    );
    assert.equal(patchRes.status, 200);

    // Delete announcement
    const delRes = await announcementsRoute.DELETE(
      new Request("http://localhost/api/admin/announcements?postId=emu-ann-1&idempotencyKey=ann_del_1", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${clubToken}` },
      }),
    );
    assert.equal(delRes.status, 200);

    const annAudits = await db
      .collection("auditLogs")
      .where("entity", "==", "post")
      .where("entityId", "==", "emu-ann-1")
      .get();
    assert.equal(annAudits.size, 3);
    const actions = annAudits.docs.map((d) => d.data().action).sort();
    assert.deepEqual(actions, ["created", "deleted", "updated"]);
  });

  it("Badges: POST, PATCH, DELETE for badges & badgeTypes write transactional server audits", async () => {
    // Create badge type
    const typeRes = await badgesRoute.POST(
      new Request("http://localhost/api/admin/badges", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${clubToken}` },
        body: JSON.stringify({
          target: "badgeType",
          badgeTypeDef: { id: "yorker-king", label: "Yorker King", tier: "gold" },
          idempotencyKey: "bt_1",
        }),
      }),
    );
    assert.equal(typeRes.status, 200);

    // Grant badge
    const badgeRes = await badgesRoute.POST(
      new Request("http://localhost/api/admin/badges", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${clubToken}` },
        body: JSON.stringify({
          target: "badge",
          badge: { id: "emu-bdg-1", playerId: "p-1", playerName: "Virat", badgeType: "yorker-king" },
          idempotencyKey: "bdg_1",
        }),
      }),
    );
    assert.equal(badgeRes.status, 200);

    // Update badge
    const patchRes = await badgesRoute.PATCH(
      new Request("http://localhost/api/admin/badges", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${clubToken}` },
        body: JSON.stringify({
          target: "badge",
          id: "emu-bdg-1",
          updates: { note: "3 yorkers in death overs" },
        }),
      }),
    );
    assert.equal(patchRes.status, 200);

    // Delete badge
    const delRes = await badgesRoute.DELETE(
      new Request("http://localhost/api/admin/badges?target=badge&id=emu-bdg-1&idempotencyKey=bdg_del_1", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${clubToken}` },
      }),
    );
    assert.equal(delRes.status, 200);

    const bdgAudits = await db
      .collection("auditLogs")
      .where("entity", "==", "badge")
      .where("entityId", "==", "emu-bdg-1")
      .get();
    assert.equal(bdgAudits.size, 3);
  });

  it("Matches & Base Fee: POST + PATCH enforce role boundaries and record old/new fee values", async () => {
    const createRes = await matchesRoute.POST(
      new Request("http://localhost/api/admin/matches", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${clubToken}` },
        body: JSON.stringify({
          match: { id: "emu-match-1", opponent: "Royals", date: "2026-12-01", format: "T20", matchType: "Practice", fee: 600 },
          idempotencyKey: "m_create_1",
        }),
      }),
    );
    assert.equal(createRes.status, 200);

    // Finance Admin cannot edit non-fee fields
    const finBadPatch = await matchesRoute.PATCH(
      new Request("http://localhost/api/admin/matches", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${financeToken}` },
        body: JSON.stringify({ matchId: "emu-match-1", updates: { opponent: "Hacked" } }),
      }),
    );
    assert.equal(finBadPatch.status, 403);

    // Finance Admin CAN update base match fee
    const finFeePatch = await matchesRoute.PATCH(
      new Request("http://localhost/api/admin/matches", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${financeToken}` },
        body: JSON.stringify({ matchId: "emu-match-1", updates: { fee: 750 } }),
      }),
    );
    assert.equal(finFeePatch.status, 200);

    // Non-existent match returns 404 and creates no misleading audit
    const missingPatch = await matchesRoute.PATCH(
      new Request("http://localhost/api/admin/matches", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${clubToken}` },
        body: JSON.stringify({ matchId: "does-not-exist", updates: { fee: 900 } }),
      }),
    );
    assert.equal(missingPatch.status, 404);

    const matchAudits = await db
      .collection("auditLogs")
      .where("entity", "==", "match")
      .where("entityId", "==", "emu-match-1")
      .get();
    assert.equal(matchAudits.size, 2);
    const feeUpdate = matchAudits.docs.find((d) => d.data().action === "updated")?.data();
    assert.equal(feeUpdate.changes[0].field, "fee");
    assert.equal(feeUpdate.changes[0].oldValue, "600");
    assert.equal(feeUpdate.changes[0].newValue, "750");
  });

  it("GET /api/audit/log enforces server-side role filtering and actor filtering", async () => {
    const playerRes = await auditLogRoute.GET(
      new Request("http://localhost/api/audit/log", {
        headers: { Authorization: `Bearer ${playerToken}` },
      }),
    );
    assert.equal(playerRes.status, 403);

    // Club Admin sees operational audits (post, badge, match) but NO payment audits and NO match.fee diffs
    const clubRes = await auditLogRoute.GET(
      new Request("http://localhost/api/audit/log?limit=50", {
        headers: { Authorization: `Bearer ${clubToken}` },
      }),
    );
    assert.equal(clubRes.status, 200);
    const clubBody = await clubRes.json();
    assert.equal(clubBody.logs.some((l) => l.entity === "payment"), false);
    assert.equal(clubBody.logs.some((l) => l.entity === "badge"), true);
    const clubMatchUpdate = clubBody.logs.find((l) => l.entity === "match" && l.action === "updated");
    assert.ok(clubMatchUpdate);
    assert.equal(clubMatchUpdate.changes.some((c) => c.field === "fee"), false);

    // Finance Admin sees payment and match.fee audits, but NO badge/post audits
    const finRes = await auditLogRoute.GET(
      new Request("http://localhost/api/audit/log?limit=50", {
        headers: { Authorization: `Bearer ${financeToken}` },
      }),
    );
    assert.equal(finRes.status, 200);
    const finBody = await finRes.json();
    assert.equal(finBody.logs.some((l) => l.entity === "payment"), true);
    assert.equal(finBody.logs.some((l) => l.entity === "badge"), false);
    assert.equal(finBody.logs.some((l) => l.entity === "post"), false);

    // Super Admin sees all entities + actorQuery filter
    const superRes = await auditLogRoute.GET(
      new Request("http://localhost/api/audit/log?actorQuery=Finance%20User&limit=50", {
        headers: { Authorization: `Bearer ${superToken}` },
      }),
    );
    assert.equal(superRes.status, 200);
    const superBody = await superRes.json();
    assert.ok(superBody.logs.length >= 2);
    assert.equal(superBody.logs.every((l) => l.actorName === "Finance User"), true);

    // Multi-page pagination preserves role & entity filters
    const page1Res = await auditLogRoute.GET(
      new Request("http://localhost/api/audit/log?entity=match&limit=1", {
        headers: { Authorization: `Bearer ${clubToken}` },
      }),
    );
    assert.equal(page1Res.status, 200);
    const page1 = await page1Res.json();
    assert.equal(page1.logs.length, 1);
    assert.equal(page1.hasMore, true);
    assert.ok(page1.nextCursor);

    const page2Res = await auditLogRoute.GET(
      new Request(`http://localhost/api/audit/log?entity=match&limit=1&cursor=${encodeURIComponent(page1.nextCursor)}`, {
        headers: { Authorization: `Bearer ${clubToken}` },
      }),
    );
    assert.equal(page2Res.status, 200);
    const page2 = await page2Res.json();
    assert.equal(page2.logs.length, 1);
    assert.notEqual(page2.logs[0].id, page1.logs[0].id);
    assert.equal(page2.logs[0].entity, "match");
  });

  it("Bulk Match Updates (PUT /api/admin/matches): writes per-match audits, deduplicates retries, and rolls back failures", async () => {
    await db.collection("matches").doc("emu-bulk-1").set({
      opponent: "Alpha XI",
      date: "2026-12-05",
      format: "T20",
      fee: 500,
    });
    await db.collection("matches").doc("emu-bulk-2").set({
      opponent: "Beta XI",
      date: "2026-12-06",
      format: "T20",
      fee: 600,
    });

    // Player rejected (403)
    const playerBulk = await matchesRoute.PUT(
      new Request("http://localhost/api/admin/matches", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${playerToken}` },
        body: JSON.stringify({ updates: [{ matchId: "emu-bulk-1", updates: { fee: 999 } }] }),
      }),
    );
    assert.equal(playerBulk.status, 403);

    // Finance Admin cannot bulk-update non-fee fields (403)
    const finBadBulk = await matchesRoute.PUT(
      new Request("http://localhost/api/admin/matches", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${financeToken}` },
        body: JSON.stringify({ updates: [{ matchId: "emu-bulk-1", updates: { opponent: "Hacked" } }] }),
      }),
    );
    assert.equal(finBadBulk.status, 403);

    // Missing match aborts transaction without partial writes or misleading audits
    const failBulk = await matchesRoute.PUT(
      new Request("http://localhost/api/admin/matches", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${clubToken}` },
        body: JSON.stringify({
          updates: [
            { matchId: "emu-bulk-1", updates: { opponent: "Should Rollback" } },
            { matchId: "emu-bulk-missing", updates: { opponent: "Missing" } },
          ],
          idempotencyKey: "bulk_fail_1",
        }),
      }),
    );
    assert.equal(failBulk.status, 404);
    assert.equal((await db.collection("matches").doc("emu-bulk-1").get()).data().opponent, "Alpha XI");

    // Successful bulk update with idempotencyKey
    const bulkPayload = {
      updates: [
        { matchId: "emu-bulk-1", updates: { opponent: "Alpha Updated", fee: 700 } },
        { matchId: "emu-bulk-2", updates: { format: "T30" } },
      ],
      idempotencyKey: "bulk_ok_1",
    };
    const okBulk = await matchesRoute.PUT(
      new Request("http://localhost/api/admin/matches", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${clubToken}` },
        body: JSON.stringify(bulkPayload),
      }),
    );
    assert.equal(okBulk.status, 200);
    assert.equal((await okBulk.json()).updatedCount, 2);

    // Retry with same idempotencyKey deduplicates
    const retryBulk = await matchesRoute.PUT(
      new Request("http://localhost/api/admin/matches", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${clubToken}` },
        body: JSON.stringify(bulkPayload),
      }),
    );
    assert.equal(retryBulk.status, 200);
    assert.equal((await retryBulk.json()).deduplicated, true);

    const bulk1Audits = await db
      .collection("auditLogs")
      .where("entity", "==", "match")
      .where("entityId", "==", "emu-bulk-1")
      .get();
    assert.equal(bulk1Audits.size, 1);
    assert.equal(bulk1Audits.docs[0].data().actorId, "aud-club");

    const bulk2Audits = await db
      .collection("auditLogs")
      .where("entity", "==", "match")
      .where("entityId", "==", "emu-bulk-2")
      .get();
    assert.equal(bulk2Audits.size, 1);
  });

  it("Regular Feed Posts (/api/admin/posts): create, update, delete write server audits without duplicating announcements", async () => {
    // Rejects announcements
    const annReject = await postsRoute.POST(
      new Request("http://localhost/api/admin/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${clubToken}` },
        body: JSON.stringify({ text: "Ann", isAnnouncement: true }),
      }),
    );
    assert.equal(annReject.status, 400);

    // Rejects Player (403)
    const playerPost = await postsRoute.POST(
      new Request("http://localhost/api/admin/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${playerToken}` },
        body: JSON.stringify({ text: "Blocked player post" }),
      }),
    );
    assert.equal(playerPost.status, 403);

    // Create + retry deduplication
    const createPayload = { id: "emu-feed-1", text: "Great net session today!", idempotencyKey: "feed_c_1" };
    const c1 = await postsRoute.POST(
      new Request("http://localhost/api/admin/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${clubToken}` },
        body: JSON.stringify(createPayload),
      }),
    );
    assert.equal(c1.status, 200);

    const c2 = await postsRoute.POST(
      new Request("http://localhost/api/admin/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${clubToken}` },
        body: JSON.stringify(createPayload),
      }),
    );
    assert.equal(c2.status, 200);
    assert.equal((await c2.json()).deduplicated, true);

    // Update
    const u1 = await postsRoute.PATCH(
      new Request("http://localhost/api/admin/posts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${clubToken}` },
        body: JSON.stringify({ postId: "emu-feed-1", text: "Updated net session post!", idempotencyKey: "feed_u_1" }),
      }),
    );
    assert.equal(u1.status, 200);

    // Delete
    const d1 = await postsRoute.DELETE(
      new Request("http://localhost/api/admin/posts?postId=emu-feed-1&idempotencyKey=feed_d_1", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${clubToken}` },
      }),
    );
    assert.equal(d1.status, 200);

    const postAudits = await db
      .collection("auditLogs")
      .where("entity", "==", "post")
      .where("entityId", "==", "emu-feed-1")
      .get();
    assert.equal(postAudits.size, 3);
    assert.deepEqual(
      postAudits.docs.map((d) => d.data().action).sort(),
      ["created", "deleted", "updated"],
    );
  });
});
