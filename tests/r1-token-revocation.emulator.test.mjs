/**
 * R1 — Authentication revocation and session security
 * (tests/r1-token-revocation.emulator.test.mjs)
 *
 * Runs against the Firebase AUTH emulator and FIRESTORE emulator. Nothing in the
 * auth path is mocked: real ID tokens are minted by the Auth emulator, and the
 * production guards in lib/server-auth.ts and the production route handlers verify
 * them through firebase-admin (which talks to the emulator).
 *
 * IMPORTANT — emulator masking: firebase-admin ALWAYS checks revocation/disabled/deleted
 * status when connected to the Auth emulator, regardless of the `checkRevoked` argument
 * (node_modules/firebase-admin/lib/auth/base-auth.js: `if (checkRevoked || isEmulator)`).
 * The emulator-mode tests (R1-01..R1-10) therefore verify error mapping, codes and route
 * wiring, but cannot by themselves distinguish fixed from unfixed code.
 * The R1-P* block switches the same Auth instance to PRODUCTION verification mode; only
 * Google's JWT signature check is replaced (emulator tokens are unsigned). Revocation,
 * disabled and deleted lookups still run for real against the Auth emulator. That block is
 * the reproducer for the R1 defect.
 *
 * The other mocked case is "Auth backend unavailable" (R1-11), which cannot be
 * produced with a healthy emulator; it is clearly labelled.
 *
 * Run: npm run test:emulator -- tests/r1-token-revocation.emulator.test.mjs
 */

import { describe, it, before, after, mock } from "node:test";
import assert from "node:assert/strict";

const PROJECT_ID = "demo-kavach-play"; // must match `--project` in scripts/run-emulator-tests.mjs
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;

// Under the emulator runner, a missing Auth emulator is a configuration failure, not a skip.
if (firestoreHost && !authHost) {
  throw new Error(
    "R1 tests require the Auth emulator (FIREBASE_AUTH_EMULATOR_HOST). Check firebase.json and scripts/run-emulator-tests.mjs.",
  );
}
const skipReason = !authHost || !firestoreHost
  ? "Auth/Firestore emulators not running (run via npm run test:emulator)"
  : false;

const DUMMY_API_KEY = "fake-api-key"; // the Auth emulator accepts any key
const PASSWORD = "Test-password-1"; // synthetic emulator-only credential

async function signIn(email) {
  const res = await fetch(
    `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${DUMMY_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: PASSWORD, returnSecureToken: true }),
    },
  );
  const body = await res.json();
  if (!res.ok) throw new Error(`Emulator sign-in failed: ${JSON.stringify(body.error)}`);
  return body.idToken;
}

/** Builds an emulator-format (unsigned) ID token whose exp is in the past. */
function expiredEmulatorToken(uid) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  return [
    b64({ alg: "none", typ: "JWT" }),
    b64({
      iss: `https://securetoken.google.com/${PROJECT_ID}`,
      aud: PROJECT_ID,
      auth_time: now - 7200,
      user_id: uid,
      sub: uid,
      iat: now - 7200,
      exp: now - 3600,
      firebase: { identities: {}, sign_in_provider: "password" },
    }),
    "",
  ].join(".");
}

function bearer(token, extra = {}) {
  return { authorization: `Bearer ${token}`, ...extra };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe("R1: token revocation on requireAuth and sensitive endpoints (Auth + Firestore emulators)", { skip: skipReason }, () => {
  let adminAuth;
  let db;
  let serverAuth;
  let BaseAuth;
  let orderRoute;
  let linkAccountRoute;
  let linkGoogleRoute;
  let seq = 0;

  /** Creates a fresh synthetic user with an Active appUsers doc and returns { uid, email, token }. */
  async function newUser(label, { appUserStatus = "Active", claims } = {}) {
    seq += 1;
    const email = `r1-${label}-${seq}-${Date.now()}@example.test`;
    const user = await adminAuth.createUser({ email, password: PASSWORD, emailVerified: true });
    if (claims) await adminAuth.setCustomUserClaims(user.uid, claims);
    await db.collection("appUsers").doc(user.uid).set({ email, status: appUserStatus, role: "player" });
    const token = await signIn(email);
    return { uid: user.uid, email, token };
  }

  /**
   * Revocation is second-granular: a token is revoked when its auth_time is before
   * tokensValidAfterTime. Wait past the sign-in second so the revocation is unambiguous.
   */
  async function revoke(uid) {
    await sleep(1100);
    await adminAuth.revokeRefreshTokens(uid);
  }

  before(async () => {
    process.env.NODE_ENV = "test";
    // Payments must be "enabled" so the order route reaches its auth guard (no real Razorpay call is made:
    // every order-route test below is rejected by auth or by currency validation before any gateway use).
    process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID = "ai-studio-cae01507-23c3-4ee4-92c8-848c4cf7d412";
    process.env.AWS_BRANCH = "main";
    process.env.RAZORPAY_KEY_ID = "rzp_test_emulator_mock";
    process.env.RAZORPAY_KEY_SECRET = "rzp_secret_emulator_mock";

    const { getApps, initializeApp } = await import("firebase-admin/app");
    const { getAuth, BaseAuth: BA } = await import("firebase-admin/auth");
    const { getFirestore } = await import("firebase-admin/firestore");
    // Initialise the default app first so production ensureAdminApp() reuses it with the emulator project.
    const app = getApps().length ? getApps()[0] : initializeApp({ projectId: PROJECT_ID });
    adminAuth = getAuth(app);
    db = getFirestore(app);
    BaseAuth = BA;

    serverAuth = await import("../lib/server-auth.ts");
    serverAuth.setAuthDbForTesting(db);
    orderRoute = await import("../app/api/razorpay/order/route.ts");
    linkAccountRoute = await import("../app/api/player/link-account/route.ts");
    linkGoogleRoute = await import("../app/api/player/link-google/route.ts");

    const { arePaymentOperationsEnabled } = await import("../lib/server-db.ts");
    assert.equal(arePaymentOperationsEnabled(), true, "test precondition: order route must reach its auth guard");
  });

  // ── Guard level: requireAuth ────────────────────────────────────────────────

  it("R1-01 valid token succeeds and returns the token's uid", async () => {
    const u = await newUser("valid");
    const res = await serverAuth.requireAuth(new Request("http://localhost/x", { headers: bearer(u.token) }));
    assert.equal(res.ok, true);
    assert.equal(res.uid, u.uid);
  });

  it("R1-02 expired token fails with 401", async () => {
    const u = await newUser("expired");
    const res = await serverAuth.requireAuth(
      new Request("http://localhost/x", { headers: bearer(expiredEmulatorToken(u.uid)) }),
    );
    assert.equal(res.ok, false);
    assert.equal(res.response.status, 401);
  });

  it("R1-03 revoked token fails with 401 TOKEN_REVOKED", async () => {
    const u = await newUser("revoked");
    await revoke(u.uid);
    const res = await serverAuth.requireAuth(new Request("http://localhost/x", { headers: bearer(u.token) }));
    assert.equal(res.ok, false, "a token issued before revokeRefreshTokens() must be rejected");
    assert.equal(res.response.status, 401);
    const body = await res.response.json();
    assert.equal(body.code, "TOKEN_REVOKED");
  });

  it("R1-04 account disabled in Firebase Auth fails with 401 ACCOUNT_DISABLED", async () => {
    const u = await newUser("fb-disabled");
    await adminAuth.updateUser(u.uid, { disabled: true });
    const res = await serverAuth.requireAuth(new Request("http://localhost/x", { headers: bearer(u.token) }));
    assert.equal(res.ok, false, "a Firebase-disabled account must not keep access");
    assert.equal(res.response.status, 401);
    assert.equal((await res.response.json()).code, "ACCOUNT_DISABLED");
  });

  it("R1-05 deleted account fails with 401 ACCOUNT_NOT_FOUND", async () => {
    const u = await newUser("deleted");
    await adminAuth.deleteUser(u.uid);
    const res = await serverAuth.requireAuth(new Request("http://localhost/x", { headers: bearer(u.token) }));
    assert.equal(res.ok, false, "a deleted account must not keep access");
    assert.equal(res.response.status, 401);
    assert.equal((await res.response.json()).code, "ACCOUNT_NOT_FOUND");
  });

  it("R1-06 after revocation the same user can sign in again and is accepted (persistent login preserved)", async () => {
    const u = await newUser("relogin");
    await revoke(u.uid);
    await sleep(1100);
    const fresh = await signIn(u.email);
    const res = await serverAuth.requireAuth(new Request("http://localhost/x", { headers: bearer(fresh) }));
    assert.equal(res.ok, true);
    assert.equal(res.uid, u.uid);
  });

  it("R1-07 in-app appUsers status Disabled is still rejected with 403 (existing behaviour preserved)", async () => {
    const u = await newUser("app-disabled", { appUserStatus: "Disabled" });
    const res = await serverAuth.requireAuth(new Request("http://localhost/x", { headers: bearer(u.token) }));
    assert.equal(res.ok, false);
    assert.equal(res.response.status, 403);
  });

  it("R1-08 missing and malformed Authorization headers fail with 401", async () => {
    const none = await serverAuth.requireAuth(new Request("http://localhost/x"));
    assert.equal(none.response.status, 401);
    const junk = await serverAuth.requireAuth(new Request("http://localhost/x", { headers: bearer("not-a-jwt") }));
    assert.equal(junk.response.status, 401);
  });

  it("R1-09 player calling an admin guard gets 403; super admin claim gets through; revoked admin gets 401", async () => {
    const player = await newUser("player-admin-ep");
    const asPlayer = await serverAuth.requireClubAdmin(new Request("http://localhost/x", { headers: bearer(player.token) }));
    assert.equal(asPlayer.ok, false);
    assert.equal(asPlayer.response.status, 403);

    const admin = await newUser("superadmin", { claims: { admin: true } });
    const asAdmin = await serverAuth.requireClubAdmin(new Request("http://localhost/x", { headers: bearer(admin.token) }));
    assert.equal(asAdmin.ok, true);

    await revoke(admin.uid);
    const asRevokedAdmin = await serverAuth.requireAdmin(new Request("http://localhost/x", { headers: bearer(admin.token) }));
    assert.equal(asRevokedAdmin.ok, false);
    assert.equal(asRevokedAdmin.response.status, 401);
  });

  // ── Route level: the three requireAuth endpoints ────────────────────────────

  it("R1-10a order route: valid token passes auth (rejected later by currency validation, not auth)", async () => {
    const u = await newUser("order-valid");
    const res = await orderRoute.POST(
      new Request("http://localhost/api/razorpay/order", {
        method: "POST",
        headers: bearer(u.token, { "content-type": "application/json" }),
        body: JSON.stringify({ currency: "USD" }),
      }),
    );
    assert.equal(res.status, 400, "reaching currency validation proves the auth guard accepted the token");
    assert.match((await res.json()).error, /Only INR/);
  });

  it("R1-10b order route: revoked player cannot initiate Razorpay order creation (401)", async () => {
    const u = await newUser("order-revoked");
    await revoke(u.uid);
    const res = await orderRoute.POST(
      new Request("http://localhost/api/razorpay/order", {
        method: "POST",
        headers: bearer(u.token, { "content-type": "application/json" }),
        body: JSON.stringify({ currency: "USD" }),
      }),
    );
    assert.equal(res.status, 401);
    assert.equal((await res.json()).code, "TOKEN_REVOKED");
  });

  it("R1-10c order route: Firebase-disabled and deleted accounts are rejected (401)", async () => {
    const d = await newUser("order-fb-disabled");
    await adminAuth.updateUser(d.uid, { disabled: true });
    const del = await newUser("order-deleted");
    await adminAuth.deleteUser(del.uid);
    for (const u of [d, del]) {
      const res = await orderRoute.POST(
        new Request("http://localhost/api/razorpay/order", {
          method: "POST",
          headers: bearer(u.token, { "content-type": "application/json" }),
          body: JSON.stringify({ currency: "USD" }),
        }),
      );
      assert.equal(res.status, 401);
    }
  });

  it("R1-10d link-account route: valid token passes auth; revoked user cannot link another account", async () => {
    const ok = await newUser("link-valid");
    const okRes = await linkAccountRoute.POST(
      new Request("http://localhost/api/player/link-account", {
        method: "POST",
        headers: bearer(ok.token, { "content-type": "application/json" }),
        body: JSON.stringify({}),
      }),
    );
    assert.equal(okRes.status, 400, "reaching body validation proves the auth guard accepted the token");

    const rev = await newUser("link-revoked");
    await revoke(rev.uid);
    const revRes = await linkAccountRoute.POST(
      new Request("http://localhost/api/player/link-account", {
        method: "POST",
        headers: bearer(rev.token, { "content-type": "application/json" }),
        body: JSON.stringify({ playerId: "p_someone_else" }),
      }),
    );
    assert.equal(revRes.status, 401);
    assert.equal((await revRes.json()).code, "TOKEN_REVOKED");
  });

  it("R1-10e link-google route: valid token passes auth; revoked and Firebase-disabled users are rejected", async () => {
    const ok = await newUser("lg-valid");
    const okRes = await linkGoogleRoute.POST(
      new Request("http://localhost/api/player/link-google", {
        method: "POST",
        headers: bearer(ok.token),
        body: JSON.stringify({ playerId: "x" }),
      }),
    );
    assert.equal(okRes.status, 400, "reaching body rejection proves the auth guard accepted the token");

    const rev = await newUser("lg-revoked");
    await revoke(rev.uid);
    const dis = await newUser("lg-fb-disabled");
    await adminAuth.updateUser(dis.uid, { disabled: true });
    for (const u of [rev, dis]) {
      const res = await linkGoogleRoute.POST(
        new Request("http://localhost/api/player/link-google", { method: "POST", headers: bearer(u.token) }),
      );
      assert.equal(res.status, 401);
    }
  });

  // ── Production verification mode (the R1 reproducer) ───────────────────────

  describe("R1-P: production token-verification mode (signature check replaced; revocation lookups real)", () => {
    let savedEmulatorMode;
    let savedVerifyJWT;
    let verifier;

    before(() => {
      // Same Auth instance production requireAuth() uses (getAuth(app) is cached per app).
      verifier = adminAuth.idTokenVerifier;
      savedEmulatorMode = adminAuth.emulatorMode;
      savedVerifyJWT = verifier.verifyJWT;
      adminAuth.emulatorMode = false;
      // Stand-in for Google signature verification only: decode, check iss/aud/exp, return claims.
      verifier.verifyJWT = async (jwt) => {
        const claims = JSON.parse(Buffer.from(String(jwt).split(".")[1] || "", "base64url").toString() || "{}");
        if (claims.aud !== PROJECT_ID || claims.iss !== `https://securetoken.google.com/${PROJECT_ID}`) {
          throw Object.assign(new Error("bad aud/iss"), { code: "auth/argument-error" });
        }
        if (!(claims.exp > Date.now() / 1000)) {
          throw Object.assign(new Error("expired"), { code: "auth/id-token-expired" });
        }
        return { ...claims, uid: claims.sub };
      };
    });

    after(() => {
      adminAuth.emulatorMode = savedEmulatorMode;
      verifier.verifyJWT = savedVerifyJWT;
    });

    it("R1-P0 precondition: in production mode a revoked token is accepted by verifyIdToken() without checkRevoked", async () => {
      const u = await newUser("p-precondition");
      await revoke(u.uid);
      const decoded = await adminAuth.verifyIdToken(u.token); // no checkRevoked: this is what the defect relied on
      assert.equal(decoded.uid, u.uid, "proves production mode does not check revocation unless asked");
    });

    it("R1-P1 valid token is accepted", async () => {
      const u = await newUser("p-valid");
      const res = await serverAuth.requireAuth(new Request("http://localhost/x", { headers: bearer(u.token) }));
      assert.equal(res.ok, true);
    });

    it("R1-P2 revoked token is rejected by requireAuth (401 TOKEN_REVOKED)", async () => {
      const u = await newUser("p-revoked");
      await revoke(u.uid);
      const res = await serverAuth.requireAuth(new Request("http://localhost/x", { headers: bearer(u.token) }));
      assert.equal(res.ok, false, "DEFECT R1: revoked token accepted by requireAuth");
      assert.equal(res.response.status, 401);
      assert.equal((await res.response.json()).code, "TOKEN_REVOKED");
    });

    it("R1-P3 Firebase-disabled account is rejected by requireAuth (401 ACCOUNT_DISABLED)", async () => {
      const u = await newUser("p-fb-disabled");
      await adminAuth.updateUser(u.uid, { disabled: true });
      const res = await serverAuth.requireAuth(new Request("http://localhost/x", { headers: bearer(u.token) }));
      assert.equal(res.ok, false, "DEFECT R1: Firebase-disabled account accepted by requireAuth");
      assert.equal((await res.response.json()).code, "ACCOUNT_DISABLED");
    });

    it("R1-P4 deleted account is rejected by requireAuth (401 ACCOUNT_NOT_FOUND)", async () => {
      const u = await newUser("p-deleted");
      await adminAuth.deleteUser(u.uid);
      const res = await serverAuth.requireAuth(new Request("http://localhost/x", { headers: bearer(u.token) }));
      assert.equal(res.ok, false, "DEFECT R1: deleted account accepted by requireAuth");
      assert.equal((await res.response.json()).code, "ACCOUNT_NOT_FOUND");
    });

    it("R1-P5 order route: revoked player cannot initiate Razorpay order creation", async () => {
      const u = await newUser("p-order");
      await revoke(u.uid);
      const res = await orderRoute.POST(
        new Request("http://localhost/api/razorpay/order", {
          method: "POST",
          headers: bearer(u.token, { "content-type": "application/json" }),
          body: JSON.stringify({ currency: "USD" }),
        }),
      );
      assert.equal(res.status, 401, "DEFECT R1: revoked player reached order processing");
    });

    it("R1-P6 link-account route: revoked user cannot link another account", async () => {
      const u = await newUser("p-link");
      await revoke(u.uid);
      const res = await linkAccountRoute.POST(
        new Request("http://localhost/api/player/link-account", {
          method: "POST",
          headers: bearer(u.token, { "content-type": "application/json" }),
          body: JSON.stringify({}),
        }),
      );
      assert.equal(res.status, 401, "DEFECT R1: revoked user reached account linking");
    });

    it("R1-P7 link-google route: Firebase-disabled user cannot link", async () => {
      const u = await newUser("p-lg");
      await adminAuth.updateUser(u.uid, { disabled: true });
      const res = await linkGoogleRoute.POST(
        new Request("http://localhost/api/player/link-google", { method: "POST", headers: bearer(u.token) }),
      );
      assert.equal(res.status, 401, "DEFECT R1: Firebase-disabled user reached Google linking");
    });

    it("R1-P8 after revocation, a fresh sign-in is accepted (persistent login unaffected)", async () => {
      const u = await newUser("p-relogin");
      await revoke(u.uid);
      await sleep(1100);
      const fresh = await signIn(u.email);
      const res = await serverAuth.requireAuth(new Request("http://localhost/x", { headers: bearer(fresh) }));
      assert.equal(res.ok, true);
    });

  });

  // ── Mocked: Auth backend unavailable ────────────────────────────────────────

  it("R1-11 (mocked SDK error) Auth backend unavailable fails closed with 503, not 401 and not success", async () => {
    const m = mock.method(BaseAuth.prototype, "verifyIdToken", async () => {
      const err = new Error("Auth backend unreachable (simulated)");
      err.code = "auth/internal-error";
      throw err;
    });
    try {
      const res = await serverAuth.requireAuth(new Request("http://localhost/x", { headers: bearer("any") }));
      assert.equal(res.ok, false);
      assert.equal(res.response.status, 503);
      assert.equal((await res.response.json()).code, "AUTH_UNAVAILABLE");
    } finally {
      m.mock.restore();
    }
  });
});
