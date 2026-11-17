/**
 * SEC-001 Administrator Authority Server Guard Tests
 * (tests/server-auth.test.mjs)
 *
 * Verifies directly against production requireAdmin() in lib/server-auth.ts (QA-001 Compliant):
 * 1. requireAdmin strictly enforces custom claim { admin: true } as the sole authority.
 * 2. verifyIdToken(token, true) is invoked with checkRevoked: true (explicitly asserted in legitimate-admin and revoked-token test scenarios).
 * 3. Ordinary authenticated users without custom claim receive 403 Forbidden.
 * 4. Callers with forged role == 'admin' in Firestore receive 403 Forbidden.
 * 5. Callers with demoted admin claim (admin: false) receive 403 Forbidden.
 * 6. Callers with forged isSuperAdmin: true in token claims (lacking admin: true) receive 403 Forbidden.
 * 7. Mocked revoked token (auth/id-token-revoked from checkRevoked: true) fails verification with 401 Unauthorized.
 *    (Note: This is a mocked verification test simulating Firebase Admin SDK rejection; it does not perform live network calls).
 * 8. Environment variable attempts (ALLOW_LEGACY_ADMIN_ROLE_FALLBACK) have zero effect.
 * 9. Expired or invalid tokens receive 401 Unauthorized.
 * 10. Missing or empty Authorization header receives 401 Unauthorized.
 */

import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { BaseAuth } from "firebase-admin/auth";
import { requireAdmin } from "../lib/server-auth.ts";

describe("SEC-001: requireAdmin Production Server Guard (QA-001 Compliant)", () => {
  let lastVerifyArgs = null;

  // Mock BaseAuth.prototype.verifyIdToken to test production requireAdmin logic directly
  mock.method(BaseAuth.prototype, "verifyIdToken", async function (token, checkRevoked) {
    lastVerifyArgs = { token, checkRevoked };
    if (token === "token-superadmin") {
      return {
        uid: "admin_uid_123",
        email: "admin@kavachcricket.com",
        admin: true,
      };
    }
    if (token === "token-player-with-role-admin") {
      // User who set role: "admin" in their Firestore profile but lacks custom claim
      return {
        uid: "player_forged_456",
        email: "player@example.com",
        admin: false,
      };
    }
    if (token === "token-ordinary-player") {
      return {
        uid: "player_789",
        email: "player789@example.com",
      };
    }
    if (token === "token-demoted-admin") {
      // Token where admin custom claim was explicitly demoted to false
      return {
        uid: "demoted_admin_999",
        email: "demoted@kavachcricket.com",
        admin: false,
      };
    }
    if (token === "token-forged-isSuperAdmin") {
      // Token containing forged or secondary claim isSuperAdmin: true, but lacking admin: true
      return {
        uid: "attacker_superadmin_111",
        email: "attacker@kavachcricket.com",
        isSuperAdmin: true,
      };
    }
    if (token === "token-revoked") {
      // Genuinely revoked token where Firebase Auth checkRevoked throws auth/id-token-revoked
      const err = new Error("Firebase ID token has been revoked.");
      err.code = "auth/id-token-revoked";
      throw err;
    }
    if (token === "token-expired") {
      const err = new Error("Firebase ID token has expired.");
      err.code = "auth/id-token-expired";
      throw err;
    }
    const err = new Error("Decoding Firebase ID token failed.");
    err.code = "auth/argument-error";
    throw err;
  });

  it("authorizes a legitimate super-admin with verified custom claim { admin: true }", async () => {
    const req = new Request("http://localhost:3000/api/email/send", {
      method: "POST",
      headers: {
        authorization: "Bearer token-superadmin",
      },
    });

    lastVerifyArgs = null;
    const res = await requireAdmin(req);
    assert.equal(res.ok, true);
    assert.equal(res.uid, "admin_uid_123");
    assert.equal(res.email, "admin@kavachcricket.com");
    assert.ok(lastVerifyArgs, "verifyIdToken must be called");
    assert.equal(lastVerifyArgs.checkRevoked, true, "verifyIdToken must be invoked with checkRevoked: true");
  });

  it("rejects an ordinary signed-in player without admin custom claim with 403 Forbidden", async () => {
    const req = new Request("http://localhost:3000/api/email/send", {
      method: "POST",
      headers: {
        authorization: "Bearer token-ordinary-player",
      },
    });

    const res = await requireAdmin(req);
    assert.equal(res.ok, false);
    assert.equal(res.response.status, 403);
    const body = await res.response.json();
    assert.match(body.error, /verified admin custom claim required/i);
  });

  it("rejects a caller with role == 'admin' in Firestore who lacks custom claim (no legacy fallback)", async () => {
    const req = new Request("http://localhost:3000/api/whatsapp/send", {
      method: "POST",
      headers: {
        authorization: "Bearer token-player-with-role-admin",
      },
    });

    const res = await requireAdmin(req);
    assert.equal(res.ok, false);
    assert.equal(res.response.status, 403);
    const body = await res.response.json();
    assert.match(body.error, /verified admin custom claim required/i);
  });

  it("rejects a caller whose admin custom claim was demoted (admin: false) with 403 Forbidden", async () => {
    const req = new Request("http://localhost:3000/api/email/send", {
      method: "POST",
      headers: {
        authorization: "Bearer token-demoted-admin",
      },
    });

    const res = await requireAdmin(req);
    assert.equal(res.ok, false);
    assert.equal(res.response.status, 403);
    const body = await res.response.json();
    assert.match(body.error, /verified admin custom claim required/i);
  });

  it("rejects a caller whose token contains isSuperAdmin: true but lacks admin: true with 403 Forbidden", async () => {
    const req = new Request("http://localhost:3000/api/email/send", {
      method: "POST",
      headers: {
        authorization: "Bearer token-forged-isSuperAdmin",
      },
    });

    const res = await requireAdmin(req);
    assert.equal(res.ok, false);
    assert.equal(res.response.status, 403);
    const body = await res.response.json();
    assert.match(body.error, /verified admin custom claim required/i);
  });

  it("rejects a revoked token (auth/id-token-revoked) at verification stage with 401 Unauthorized", async () => {
    const req = new Request("http://localhost:3000/api/email/send", {
      method: "POST",
      headers: {
        authorization: "Bearer token-revoked",
      },
    });

    lastVerifyArgs = null;
    const res = await requireAdmin(req);
    assert.equal(res.ok, false);
    assert.equal(res.response.status, 401);
    const body = await res.response.json();
    assert.match(body.error, /invalid or expired token/i);

    // Assert that requireAdmin invoked verifyIdToken with the token and checkRevoked: true
    assert.ok(lastVerifyArgs, "verifyIdToken must have been called");
    assert.equal(lastVerifyArgs.token, "token-revoked");
    assert.equal(lastVerifyArgs.checkRevoked, true, "verifyIdToken must be invoked with checkRevoked: true");
  });

  it("strictly rejects callers without admin custom claim even when legacy fallback env vars are set", async () => {
    const origFallback1 = process.env.ALLOW_LEGACY_ADMIN_ROLE_FALLBACK;
    const origFallback2 = process.env.ADMIN_ROLE_FALLBACK;
    try {
      process.env.ALLOW_LEGACY_ADMIN_ROLE_FALLBACK = "true";
      process.env.ADMIN_ROLE_FALLBACK = "true";

      const req = new Request("http://localhost:3000/api/admin/merge-players", {
        method: "POST",
        headers: {
          authorization: "Bearer token-player-with-role-admin",
        },
      });

      const res = await requireAdmin(req);
      assert.equal(res.ok, false);
      assert.equal(res.response.status, 403);
      const body = await res.response.json();
      assert.match(body.error, /verified admin custom claim required/i);
    } finally {
      if (origFallback1 === undefined) delete process.env.ALLOW_LEGACY_ADMIN_ROLE_FALLBACK;
      else process.env.ALLOW_LEGACY_ADMIN_ROLE_FALLBACK = origFallback1;
      if (origFallback2 === undefined) delete process.env.ADMIN_ROLE_FALLBACK;
      else process.env.ADMIN_ROLE_FALLBACK = origFallback2;
    }
  });

  it("rejects missing Authorization header with 401 Unauthorized", async () => {
    const req = new Request("http://localhost:3000/api/calendar/sync", {
      method: "POST",
    });

    const res = await requireAdmin(req);
    assert.equal(res.ok, false);
    assert.equal(res.response.status, 401);
    const body = await res.response.json();
    assert.match(body.error, /missing authorization header/i);
  });

  it("rejects empty Bearer token with 401 Unauthorized", async () => {
    const req = new Request("http://localhost:3000/api/calendar/sync", {
      method: "POST",
      headers: {
        authorization: "Bearer   ",
      },
    });

    const res = await requireAdmin(req);
    assert.equal(res.ok, false);
    assert.equal(res.response.status, 401);
    const body = await res.response.json();
    assert.match(body.error, /empty bearer token/i);
  });

  it("rejects expired token with 401 Unauthorized", async () => {
    const req = new Request("http://localhost:3000/api/calendar/sync", {
      method: "POST",
      headers: {
        authorization: "Bearer token-expired",
      },
    });

    const res = await requireAdmin(req);
    assert.equal(res.ok, false);
    assert.equal(res.response.status, 401);
    const body = await res.response.json();
    assert.match(body.error, /invalid or expired token/i);
  });
});
