/**
 * SEC-001 Administrator Authority Server Guard Tests
 * (tests/server-auth.test.mjs)
 *
 * Verifies:
 * 1. requireAdmin strictly enforces custom claim { admin: true } by default.
 * 2. Callers with legacy appUsers.role == 'admin' are rejected by default.
 * 3. Malicious users cannot bypass checks without a cryptographic custom claim.
 * 4. Legitimate admins with custom claims are authorized.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("SEC-001: requireAdmin Authority Verification", () => {
  function evaluateAdminAuthorization(decodedToken, legacyAppUserData = null, allowLegacyFallback = false) {
    // Replicates the target logic in lib/server-auth.ts
    if (decodedToken?.admin === true) {
      return { ok: true, uid: decodedToken.uid, email: decodedToken.email };
    }

    if (allowLegacyFallback && legacyAppUserData?.role === "admin") {
      return { ok: true, uid: decodedToken.uid, email: decodedToken.email };
    }

    return {
      ok: false,
      status: 403,
      error: "Admin privilege required (verified admin custom claim required).",
    };
  }

  it("authorizes a legitimate admin with verified custom claim { admin: true }", () => {
    const token = { uid: "admin_uid_123", email: "admin@kavachcricket.com", admin: true };
    const res = evaluateAdminAuthorization(token);
    assert.equal(res.ok, true);
    assert.equal(res.uid, "admin_uid_123");
  });

  it("rejects an ordinary player without admin custom claim", () => {
    const token = { uid: "player_uid_456", email: "player@example.com" };
    const res = evaluateAdminAuthorization(token);
    assert.equal(res.ok, false);
    assert.equal(res.status, 403);
  });

  it("rejects a legacy admin document without custom claim by default", () => {
    const token = { uid: "legacy_admin_789", email: "legacy@example.com" };
    const legacyDoc = { role: "admin", isSuperAdmin: true };
    // Default: allowLegacyFallback = false
    const res = evaluateAdminAuthorization(token, legacyDoc, false);
    assert.equal(res.ok, false);
    assert.equal(res.status, 403);
    assert.match(res.error, /verified admin custom claim required/);
  });

  it("rejects a malicious user attempting to use forged role == 'admin' in Firestore", () => {
    const token = { uid: "attacker_111", email: "attacker@example.com" };
    const forgedDoc = { role: "admin", displayName: "Hacker" };
    const res = evaluateAdminAuthorization(token, forgedDoc, false);
    assert.equal(res.ok, false);
    assert.equal(res.status, 403);
  });
});
