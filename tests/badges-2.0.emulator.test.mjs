/**
 * Firebase Auth + Firestore Emulator validation for Badges 2.0 Cumulative Milestone Engine:
 * - Server-authoritative POST /api/admin/badges/evaluate
 * - Authorization (rejects unauthenticated & plain player)
 * - Dry-run preview vs live evaluation
 * - Cumulative tenure (year_1..5), runs (1k..10k), and wickets (100..500)
 * - Repeated & concurrent evaluations do not duplicate
 * - Preserves historical awards on downward stat/joining corrections
 * - Transactional audit logging with server-derived actor attribution
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

async function signInEmulatorUser(auth, uid) {
  try {
    await auth.createUser({ uid, email: `${uid}@kavach.test` });
  } catch {}
  const customToken = await auth.createCustomToken(uid);
  const res = await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    },
  );
  const data = await res.json();
  if (!res.ok || !data.idToken) throw new Error(`Token exchange failed for ${uid}`);
  return data.idToken;
}

describe("Badges 2.0 Cumulative Milestones (Firebase Auth + Firestore Emulator)", { skip: !hasEmulator ? "Emulator not running" : false }, () => {
  let app;
  let db;
  let auth;
  let evaluateRoute;
  let adminToken;
  let playerToken;

  before(async () => {
    const projectId = process.env.GCLOUD_PROJECT || "demo-kavach-play";
    app = getApps().length ? getApps()[0] : initializeApp({ projectId });
    db = getFirestore(app);
    auth = getAuth(app);

    const { setServerDbForTesting } = await import("../lib/server-db.ts");
    setServerDbForTesting(db);

    evaluateRoute = await import("../app/api/admin/badges/evaluate/route.ts");

    await db.collection("appUsers").doc("eval-club-admin").set({
      uid: "eval-club-admin",
      name: "Evaluator Admin",
      status: "Active",
      isClubAdmin: true,
    });
    await db.collection("appUsers").doc("eval-plain-player").set({
      uid: "eval-plain-player",
      name: "Plain Player",
      status: "Active",
      role: "player",
    });

    adminToken = await signInEmulatorUser(auth, "eval-club-admin");
    playerToken = await signInEmulatorUser(auth, "eval-plain-player");
  });

  after(async () => {
    if (app) await deleteApp(app);
  });

  const callEvaluate = (token, body) =>
    evaluateRoute.POST(
      new Request("http://localhost/api/admin/badges/evaluate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      }),
    );

  it("enforces Club Admin authorization", async () => {
    const unauth = await callEvaluate(null, { domain: "all" });
    assert.equal(unauth.status, 401);

    const playerRes = await callEvaluate(playerToken, { domain: "all" });
    assert.equal(playerRes.status, 403);
  });

  it("grants cumulative tenure, runs, and wickets milestones without revoking historical awards", async () => {
    await db.collection("players").doc("eval-p1").set({
      name: "Suresh",
      kavachJoining: "01/2020", // >= 5 years
      totalRuns: 5200,          // runs_1k, runs_2k, runs_5k
      totalWickets: 210,        // wickets_100, wickets_200
    });

    // Seed pre-existing historical year_1 and runs_10k (e.g. from corrected stat)
    await db.collection("badges").doc("hist-year-1").set({
      playerId: "eval-p1",
      playerName: "Suresh",
      badgeType: "year_1",
      awardedBy: "legacy-admin",
      awardedByName: "Legacy Admin",
      note: "Original 1st year",
      redeemed: false,
    });
    await db.collection("badges").doc("hist-runs-10k").set({
      playerId: "eval-p1",
      playerName: "Suresh",
      badgeType: "runs_10k",
      awardedBy: "legacy-admin",
      awardedByName: "Legacy Admin",
      redeemed: false,
    });

    // Dry run first -> writes nothing
    const dryRes = await callEvaluate(adminToken, { domain: "all", playerIds: ["eval-p1"], dryRun: true });
    assert.equal(dryRes.status, 200);
    const dryJson = await dryRes.json();
    assert.equal(dryJson.dryRun, true);
    assert.equal(dryJson.totalGrants, 9); // year_2..5 (4) + runs_1k,2k,5k (3) + wickets_100,200 (2)

    const beforeEvalSnap = await db.collection("badges").where("playerId", "==", "eval-p1").get();
    assert.equal(beforeEvalSnap.size, 2);

    // Live evaluation
    const liveRes = await callEvaluate(adminToken, { domain: "all", playerIds: ["eval-p1"] });
    assert.equal(liveRes.status, 200);
    const liveJson = await liveRes.json();
    assert.equal(liveJson.grantedCount, 9);

    const afterEvalSnap = await db.collection("badges").where("playerId", "==", "eval-p1").get();
    assert.equal(afterEvalSnap.size, 11);

    // Historical awards preserved untouched
    const histYear1 = (await db.collection("badges").doc("hist-year-1").get()).data();
    assert.equal(histYear1.awardedBy, "legacy-admin");
    assert.equal(histYear1.note, "Original 1st year");
    const histRuns10k = await db.collection("badges").doc("hist-runs-10k").get();
    assert.equal(histRuns10k.exists, true);

    // Audit log attribution verified
    const audits = await db.collection("auditLogs").where("actorId", "==", "eval-club-admin").get();
    assert.equal(audits.size, 9);
    assert.equal(audits.docs[0].data().actorName, "Evaluator Admin");
  });

  it("prevents duplicates across repeated and concurrent evaluations", async () => {
    await db.collection("players").doc("eval-p2").set({
      name: "Hardik",
      kavachJoining: "01/2023", // >= 3 years -> year_1, year_2, year_3
      totalRuns: 2100,          // runs_1k, runs_2k
      totalWickets: 110,        // wickets_100
    });

    const [r1, r2] = await Promise.all([
      callEvaluate(adminToken, { domain: "all", playerIds: ["eval-p2"] }),
      callEvaluate(adminToken, { domain: "all", playerIds: ["eval-p2"] }),
    ]);
    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);

    const snap = await db.collection("badges").where("playerId", "==", "eval-p2").get();
    assert.equal(snap.size, 6);

    const r3 = await callEvaluate(adminToken, { domain: "all", playerIds: ["eval-p2"] });
    assert.equal(r3.status, 200);
    const j3 = await r3.json();
    assert.equal(j3.grantedCount, 0);
    assert.equal(j3.skippedCount, 0);

    // Verify 1 audit record per granted badge (6 total for eval-p2)
    const p2Badges = await db.collection("badges").where("playerId", "==", "eval-p2").get();
    assert.equal(p2Badges.size, 6);
    for (const doc of p2Badges.docs) {
      const audits = await db
        .collection("auditLogs")
        .where("entity", "==", "badge")
        .where("entityId", "==", doc.id)
        .get();
      assert.equal(audits.size, 1);
      assert.equal(audits.docs[0].data().actorId, "eval-club-admin");
      assert.equal(audits.docs[0].data().actorName, "Evaluator Admin");
    }
  });

  it("aborts award on audit failure, surfaces independent milestone failures accurately, and retries without duplicating", async () => {
    await db.collection("players").doc("eval-p3").set({
      name: "Bumrah",
      totalRuns: 0,
      totalWickets: 210, // qualifies for wickets_100 and wickets_200
    });

    const origRunTx = db.runTransaction.bind(db);
    let callNum = 0;
    try {
      // 1st milestone (wickets_100): simulate audit write failure inside transaction
      // 2nd milestone (wickets_200): succeeds
      db.runTransaction = async (fn) => {
        callNum++;
        if (callNum === 1) {
          return origRunTx(async (tx) => {
            const wrappedTx = {
              get: tx.get.bind(tx),
              create: (ref, data) => {
                if (ref.parent?.id === "auditLogs") {
                  throw new Error("Simulated audit write failure");
                }
                return tx.create(ref, data);
              },
              set: (ref, data) => {
                if (ref.parent?.id === "auditLogs") {
                  throw new Error("Simulated audit write failure");
                }
                return tx.set(ref, data);
              },
              update: tx.update.bind(tx),
              delete: tx.delete.bind(tx),
            };
            return fn(wrappedTx);
          });
        }
        return origRunTx(fn);
      };

      const partialRes = await callEvaluate(adminToken, { domain: "stats", playerIds: ["eval-p3"] });
      assert.equal(partialRes.status, 200);
      const partialJson = await partialRes.json();
      assert.equal(partialJson.ok, false);
      assert.equal(partialJson.grantedCount, 1);
      assert.equal(partialJson.skippedCount, 0);
      assert.equal(partialJson.failedCount, 1);
      assert.equal(partialJson.failed[0].badgeType, "wickets_100");
      assert.match(partialJson.failed[0].error, /Simulated audit write failure/);

      // Verify wickets_100 was rolled back (0 badges, 0 audits) while wickets_200 succeeded (1 badge, 1 audit)
      const p3BadgesAfterPartial = await db.collection("badges").where("playerId", "==", "eval-p3").get();
      assert.equal(p3BadgesAfterPartial.size, 1);
      assert.equal(p3BadgesAfterPartial.docs[0].data().badgeType, "wickets_200");
      const w200Audits = await db
        .collection("auditLogs")
        .where("entity", "==", "badge")
        .where("entityId", "==", p3BadgesAfterPartial.docs[0].id)
        .get();
      assert.equal(w200Audits.size, 1);
    } finally {
      db.runTransaction = origRunTx;
    }

    // Retry evaluation -> grants only wickets_100 without duplicating wickets_200
    const retryRes = await callEvaluate(adminToken, { domain: "stats", playerIds: ["eval-p3"] });
    assert.equal(retryRes.status, 200);
    const retryJson = await retryRes.json();
    assert.equal(retryJson.ok, true);
    assert.equal(retryJson.grantedCount, 1);
    assert.equal(retryJson.failedCount, 0);

    const p3BadgesFinal = await db.collection("badges").where("playerId", "==", "eval-p3").get();
    assert.equal(p3BadgesFinal.size, 2);
    for (const doc of p3BadgesFinal.docs) {
      const audits = await db
        .collection("auditLogs")
        .where("entity", "==", "badge")
        .where("entityId", "==", doc.id)
        .get();
      assert.equal(audits.size, 1);
    }
  });

  it("does not misclassify transient ABORTED contention without a duplicate as skipped", async () => {
    await db.collection("players").doc("eval-p4").set({
      name: "Pant",
      totalRuns: 1100, // qualifies for runs_1k
      totalWickets: 0,
    });

    const origRunTx = db.runTransaction.bind(db);
    try {
      db.runTransaction = async () => {
        const err = new Error("10 ABORTED: Transient contention");
        err.code = 10;
        throw err;
      };
      const res = await callEvaluate(adminToken, { domain: "stats", playerIds: ["eval-p4"] });
      assert.equal(res.status, 500);
      const json = await res.json();
      assert.equal(json.ok, false);
      assert.equal(json.grantedCount, 0);
      assert.equal(json.skippedCount, 0);
      assert.equal(json.failedCount, 1);
      assert.equal(json.failed[0].badgeType, "runs_1k");
    } finally {
      db.runTransaction = origRunTx;
    }
  });

  it("validates dryRun and playerIds strictly with HTTP 400", async () => {
    for (const badDryRun of ["false", "true", 1, 0, null]) {
      const res = await callEvaluate(adminToken, { domain: "all", dryRun: badDryRun });
      assert.equal(res.status, 400, `Expected 400 for dryRun=${JSON.stringify(badDryRun)}`);
    }

    for (const badPlayerIds of ["eval-p1", 123, null, [""], ["   "], [123], ["valid-id", "bad/id"]]) {
      const res = await callEvaluate(adminToken, { domain: "all", playerIds: badPlayerIds });
      assert.equal(res.status, 400, `Expected 400 for playerIds=${JSON.stringify(badPlayerIds)}`);
    }
  });
});
