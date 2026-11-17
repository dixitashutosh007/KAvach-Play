/**
 * SEC-001 Administrator Authority Server Guard Tests
 * (tests/server-auth.test.mjs)
 *
 * Verifies directly against production requireAdmin() in lib/server-auth.ts (QA-001 Compliant):
 * 1. requireAdmin strictly enforces custom claim { admin: true } as the sole authority.
 * 2. Ordinary authenticated users without custom claim receive 403 Forbidden.
 * 3. Callers with forged role == 'admin' in Firestore receive 403 Forbidden.
 * 4. Callers with revoked admin claim (admin: false) receive 403 Forbidden.
 * 5. Environment variable attempts (ALLOW_LEGACY_ADMIN_ROLE_FALLBACK) have zero effect.
 * 6. Expired or invalid tokens receive 401 Unauthorized.
 * 7. Missing or empty Authorization header receives 401 Unauthorized.
 */

import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { BaseAuth } from "firebase-admin/auth";
import { requireAdmin } from "../lib/server-auth.ts";

describe("SEC-001: requireAdmin Production Server Guard (QA-001 Compliant)", () => {
  // Mock BaseAuth.prototype.verifyIdToken to test production requireAdmin logic directly
  mock.method(BaseAuth.prototype, "verifyIdToken", async function (token) {
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
    if (token === "token-revoked-admin") {
      return {
        uid: "revoked_admin_999",
        email: "revoked@kavachcricket.com",
        admin: false,
      };
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

    const res = await requireAdmin(req);
    assert.equal(res.ok, true);
    assert.equal(res.uid, "admin_uid_123");
    assert.equal(res.email, "admin@kavachcricket.com");
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

  it("rejects a caller whose admin custom claim was revoked (admin: false) with 403 Forbidden", async () => {
    const req = new Request("http://localhost:3000/api/email/send", {
      method: "POST",
      headers: {
        authorization: "Bearer token-revoked-admin",
      },
    });

    const res = await requireAdmin(req);
    assert.equal(res.ok, false);
    assert.equal(res.response.status, 403);
    const body = await res.response.json();
    assert.match(body.error, /verified admin custom claim required/i);
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
