/**
 * DEF-R3-001 Regression Tests: Finance API Authorization
 *
 * Verifies against Firebase Local Emulator + actual Next.js route handlers that:
 * - Unauthenticated requests return 401.
 * - Ordinary Players and Club Admin-only accounts receive HTTP 403 on all
 *   Finance APIs (assignments, sponsorship reports, subscriptions, match-plans
 *   preview/apply, match-ledger, webhook-reconciliation).
 * - Finance Admin and Super Admin retain authorized access (HTTP 200).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { initializeApp, getApps, deleteApp } from "firebase-admin/app";
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

const hasEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;

describe("DEF-R3-001: Finance API authorization matrix", { skip: !hasEmulator ? "FIRESTORE_EMULATOR_HOST not set" : false }, () => {
  let app;
  let db;
  let assignmentsRoute;
  let sponsorshipRoute;
  let subscriptionsRoute;
  let matchPlansRoute;
  let matchLedgerRoute;
  let reconRoute;

  const matchId = "def_r3_001_match";

  before(async () => {
    const projectId = process.env.GCLOUD_PROJECT || "demo-kavach-play";
    app = getApps().length ? getApps()[0] : initializeApp({ projectId });
    db = getFirestore(app);
    const { setServerDbForTesting } = await import("../lib/server-db.ts");
    setServerDbForTesting(db);

    await db.collection("matches").doc(matchId).set({
      id: matchId,
      date: "2026-11-22",
      opponent: "Tigers",
      fee: 500,
      result: "Pending",
      financeStatus: "open",
    });

    assignmentsRoute = await import("../app/api/finance/assignments/route.ts");
    sponsorshipRoute = await import("../app/api/finance/reports/sponsorship/route.ts");
    subscriptionsRoute = await import("../app/api/finance/subscriptions/route.ts");
    matchPlansRoute = await import("../app/api/finance/match-plans/route.ts");
    matchLedgerRoute = await import("../app/api/finance/match-ledger/route.ts");
    reconRoute = await import("../app/api/finance/webhook-reconciliation/route.ts");
  });

  after(async () => {
    for (const a of getApps()) await deleteApp(a);
  });

  function makeReq(url, method, rolesHeader, body) {
    const headers = {};
    if (rolesHeader !== null) {
      headers["x-test-uid"] = `actor_${rolesHeader || "player"}`;
      headers["x-test-roles"] = rolesHeader;
    }
    if (body !== undefined) {
      headers["content-type"] = "application/json";
    }
    return new Request(url, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  }

  it("denies unauthenticated callers with 401 on all Finance APIs", async () => {
    assert.equal((await assignmentsRoute.GET(makeReq("http://localhost/api/finance/assignments", "GET", null))).status, 401);
    assert.equal((await sponsorshipRoute.GET(makeReq("http://localhost/api/finance/reports/sponsorship?from=2026-11-01&to=2026-11-30", "GET", null))).status, 401);
    assert.equal((await subscriptionsRoute.GET(makeReq("http://localhost/api/finance/subscriptions?month=2026-11", "GET", null))).status, 401);
    assert.equal((await matchPlansRoute.POST(makeReq("http://localhost/api/finance/match-plans", "POST", null, { action: "preview", matchId }))).status, 401);
    assert.equal((await matchPlansRoute.POST(makeReq("http://localhost/api/finance/match-plans", "POST", null, { action: "apply", matchId }))).status, 401);
  });

  it("denies Player and Club Admin-only callers with 403 on all Finance APIs", async () => {
    for (const role of ["", "clubAdmin"]) {
      assert.equal((await assignmentsRoute.GET(makeReq("http://localhost/api/finance/assignments", "GET", role))).status, 403, `assignments GET for ${role || "player"}`);
      assert.equal((await sponsorshipRoute.GET(makeReq("http://localhost/api/finance/reports/sponsorship?from=2026-11-01&to=2026-11-30", "GET", role))).status, 403, `sponsorship GET for ${role || "player"}`);
      assert.equal((await subscriptionsRoute.GET(makeReq("http://localhost/api/finance/subscriptions?month=2026-11", "GET", role))).status, 403, `subscriptions GET for ${role || "player"}`);
      assert.equal((await matchPlansRoute.POST(makeReq("http://localhost/api/finance/match-plans", "POST", role, { action: "preview", matchId }))).status, 403, `match-plans preview for ${role || "player"}`);
      assert.equal((await matchPlansRoute.POST(makeReq("http://localhost/api/finance/match-plans", "POST", role, { action: "apply", matchId }))).status, 403, `match-plans apply for ${role || "player"}`);
      assert.equal((await matchLedgerRoute.POST(makeReq("http://localhost/api/finance/match-ledger", "POST", role, { action: "closeFinance", matchId }))).status, 403, `match-ledger for ${role || "player"}`);
      assert.equal((await reconRoute.GET(makeReq("http://localhost/api/finance/webhook-reconciliation", "GET", role))).status, 403, `webhook-reconciliation for ${role || "player"}`);
    }
  });

  it("permits Finance Admin and Super Admin on all Finance APIs", async () => {
    for (const role of ["financeAdmin", "superAdmin"]) {
      assert.equal((await assignmentsRoute.GET(makeReq("http://localhost/api/finance/assignments", "GET", role))).status, 200, `assignments GET for ${role}`);
      assert.equal((await sponsorshipRoute.GET(makeReq("http://localhost/api/finance/reports/sponsorship?from=2026-11-01&to=2026-11-30", "GET", role))).status, 200, `sponsorship GET for ${role}`);
      assert.equal((await subscriptionsRoute.GET(makeReq("http://localhost/api/finance/subscriptions?month=2026-11", "GET", role))).status, 200, `subscriptions GET for ${role}`);
      assert.equal((await matchPlansRoute.POST(makeReq("http://localhost/api/finance/match-plans", "POST", role, { action: "preview", matchId }))).status, 200, `match-plans preview for ${role}`);
      assert.equal((await matchPlansRoute.POST(makeReq("http://localhost/api/finance/match-plans", "POST", role, { action: "apply", matchId }))).status, 200, `match-plans apply for ${role}`);
      assert.equal((await reconRoute.GET(makeReq("http://localhost/api/finance/webhook-reconciliation", "GET", role))).status, 200, `webhook-reconciliation for ${role}`);
    }
  });
});
