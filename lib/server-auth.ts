/**
 * Server-side auth guard and Role-Based Access Control (RBAC) for API routes.
 *
 * Implements SEC-001, D-08, and Active Remediation Master Plan Phase 5:
 * - Super-admin authority is granted strictly via the `admin: true` Firebase Auth custom claim (SEC-001).
 * - Granular administrative capabilities (Club Admin, Match Admin, Finance Admin, Studio Admin, Designer)
 *   are verified server-side against custom claims and authoritative `/appUsers/{uid}` documents.
 * - Client-supplied roles and privileged fields in request bodies or client headers are strictly rejected.
 * - Enforces fail-closed account status verification: accounts with `status: "Disabled"` are rejected immediately.
 * - Enforces fail-closed database lookup: if the authoritative `/appUsers/{uid}` read fails due to a database error,
 *   privileged access is strictly denied (503 Service Unavailable) rather than silently assuming active status.
 * - All token verification for administrative access enforces `checkRevoked: true` to prevent stale token reuse.
 * - Test bypass isolation: x-test-* identity headers are strictly locked behind KAVACH_TEST_AUTH_BYPASS="true"
 *   and NODE_ENV="test", and are permanently disabled in production runtimes.
 */
import { NextResponse } from "next/server.js";
import { getAuth } from "firebase-admin/auth";
import firebaseConfig from "../firebase-applet-config.json" with { type: "json" };
import {
  getServerFirestore,
  ensureAdminApp,
  resolveFirestoreDatabaseId,
  arePaymentOperationsEnabled,
  setServerDbForTesting,
} from "./server-db.ts";

export {
  getServerFirestore,
  ensureAdminApp,
  resolveFirestoreDatabaseId,
  arePaymentOperationsEnabled,
};

export type AppRole =
  | "superAdmin"
  | "clubAdmin"
  | "matchAdmin"
  | "financeAdmin"
  | "studioAdmin"
  | "isDesigner"
  | "player";

/**
 * Checks whether test authentication bypass is permitted.
 * Strictly forbidden in production; requires both NODE_ENV === "test"
 * AND the explicit process.env.KAVACH_TEST_AUTH_BYPASS === "true" flag.
 */
export function isTestAuthBypassAllowed(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return (
    process.env.NODE_ENV === "test" &&
    process.env.KAVACH_TEST_AUTH_BYPASS === "true"
  );
}

/**
 * In non-production environments (unit tests), allows injecting a mock database
 * to test missing user docs, disabled accounts, and database errors deterministically.
 */
export function setAuthDbForTesting(db: any) {
  setServerDbForTesting(db);
}

export function getEffectiveDb(app?: any) {
  return getServerFirestore(app);
}

export type AuthGuardResult =
  | {
      ok: true;
      uid: string;
      email?: string;
      phoneNumber?: string;
      playerId?: string;
      status?: string;
      roles?: Set<AppRole>;
    }
  | { ok: false; response: NextResponse };

export type AdminGuardResult = AuthGuardResult;

export type RoleGuardResult =
  | {
      ok: true;
      uid: string;
      email?: string;
      roles: Set<AppRole>;
      status: string;
      playerId?: string;
    }
  | { ok: false; response: NextResponse };

export type UserAccountResult =
  | {
      ok: true;
      roles: Set<AppRole>;
      status: string;
      playerId?: string;
      exists: boolean;
    }
  | {
      ok: false;
      error: string;
      isDatabaseError: boolean;
    };

/**
 * Queries the authoritative user roles and account status from Firestore /appUsers/{uid}.
 * Fail-closed: returns ok: false if database query fails.
 */
export async function getUserAccount(
  app: any,
  uid: string,
  decodedToken?: any,
): Promise<UserAccountResult> {
  const roles = new Set<AppRole>(["player"]);
  let status = "Active";
  let playerId: string | undefined = undefined;
  let docExists = false;

  // 1. Authoritative Firestore lookup on /appUsers/{uid}
  try {
    const db = getEffectiveDb(app);
    const userDoc = await db.collection("appUsers").doc(uid).get();
    if (userDoc.exists) {
      docExists = true;
      const data = userDoc.data() || {};
      if (data.status) status = String(data.status);
      if (data.playerId) playerId = String(data.playerId);

      // If account is disabled, fail immediately: no administrative privileges
      if (status === "Disabled") {
        return { ok: true, roles, status: "Disabled", playerId, exists: true };
      }

      // Granular roles stored authoritatively in appUsers (write-protected by firestore.rules)
      if (data.isClubAdmin === true || data.role === "clubAdmin") roles.add("clubAdmin");
      if (data.isMatchAdmin === true || data.role === "matchAdmin") roles.add("matchAdmin");
      if (data.isFinanceAdmin === true || data.role === "financeAdmin") roles.add("financeAdmin");
      if (data.isStudioAdmin === true || data.role === "studioAdmin") roles.add("studioAdmin");
      if (
        data.isDesigner === true ||
        data.canDesign === true ||
        data.role === "designer"
      ) {
        roles.add("isDesigner");
      }
    }
  } catch (err: any) {
    // Fail-closed on database error: do NOT silently continue or retain claims
    console.error(`[server-auth] Database error looking up /appUsers/${uid}:`, err);
    return {
      ok: false,
      error: "Failed to verify account authorization due to database error.",
      isDatabaseError: true,
    };
  }

  // 2. Super Admin authority: granted strictly via verified custom claim { admin: true } (SEC-001)
  // Super Admin inherits all admin roles, BUT disabled status is still strictly enforced.
  if (decodedToken?.admin === true && status !== "Disabled") {
    roles.add("superAdmin");
    roles.add("clubAdmin");
    roles.add("matchAdmin");
    roles.add("financeAdmin");
    roles.add("studioAdmin");
    roles.add("isDesigner");
  }

  return { ok: true, roles, status, playerId, exists: docExists };
}

/**
 * Verify the caller is any authenticated Firebase user with an active account.
 * Fail-closed: rejects if database error prevents confirming account status.
 */
export async function requireAuth(req: Request): Promise<AuthGuardResult> {
  // Test environment bypass: isolated strictly behind isTestAuthBypassAllowed()
  if (isTestAuthBypassAllowed() && req.headers.get("x-test-uid")) {
    if (req.headers.get("x-test-db-error") === "true") {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Failed to verify account status due to database error." },
          { status: 503 },
        ),
      };
    }
    const testStatus = req.headers.get("x-test-status") || "Active";
    if (testStatus === "Disabled") {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Account is disabled." },
          { status: 403 },
        ),
      };
    }
    return {
      ok: true,
      uid: req.headers.get("x-test-uid")!,
      email: req.headers.get("x-test-email") || "test@kavachcricket.com",
      phoneNumber: req.headers.get("x-test-phone") || undefined,
      playerId: req.headers.get("x-test-player-id") || undefined,
      status: testStatus,
    };
  }

  const authHeader = req.headers.get("authorization");
  if (!authHeader || (!authHeader.startsWith("Bearer ") && authHeader !== "Bearer")) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Missing Authorization header." },
        { status: 401 },
      ),
    };
  }
  const token = authHeader.startsWith("Bearer ") ? authHeader.substring(7).trim() : "";
  if (!token) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Empty bearer token." },
        { status: 401 },
      ),
    };
  }

  const app = ensureAdminApp();
  let decoded: any;
  try {
    decoded = await getAuth(app).verifyIdToken(token);
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Invalid or expired token." },
        { status: 401 },
      ),
    };
  }

  // Authoritatively confirm account status (fail-closed)
  const accountResult = await getUserAccount(app, decoded.uid, decoded);
  if (!accountResult.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Failed to verify account status due to database error." },
        { status: 503 },
      ),
    };
  }

  if (accountResult.status === "Disabled") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Account is disabled." },
        { status: 403 },
      ),
    };
  }

  return {
    ok: true,
    uid: decoded.uid,
    email: decoded.email,
    phoneNumber: decoded.phone_number,
    playerId: accountResult.playerId,
    status: accountResult.status,
  };
}

/**
 * Require Super Admin authority.
 * Strictly verifies token custom claim { admin: true } with checkRevoked: true (SEC-001).
 * Fail-closed: also verifies the account is not disabled in Firestore.
 */
export async function requireAdmin(req: Request): Promise<AdminGuardResult> {
  // Test environment bypass: isolated strictly behind isTestAuthBypassAllowed()
  if (isTestAuthBypassAllowed() && req.headers.get("x-test-uid")) {
    if (req.headers.get("x-test-db-error") === "true") {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Failed to verify account status due to database error." },
          { status: 503 },
        ),
      };
    }
    const testStatus = req.headers.get("x-test-status") || "Active";
    if (testStatus === "Disabled") {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Account is disabled." },
          { status: 403 },
        ),
      };
    }
    if (req.headers.get("x-test-admin") === "true") {
      return {
        ok: true,
        uid: req.headers.get("x-test-uid")!,
        email: req.headers.get("x-test-email") || "test@kavachcricket.com",
      };
    }
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Admin privilege required (verified admin custom claim required)." },
        { status: 403 },
      ),
    };
  }

  const authHeader = req.headers.get("authorization");
  if (!authHeader || (!authHeader.startsWith("Bearer ") && authHeader !== "Bearer")) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Missing Authorization header." },
        { status: 401 },
      ),
    };
  }
  const token = authHeader.startsWith("Bearer ") ? authHeader.substring(7).trim() : "";
  if (!token) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Empty bearer token." },
        { status: 401 },
      ),
    };
  }

  const app = ensureAdminApp();
  let decoded: any;
  try {
    // SEC-001: checkRevoked = true forces verification against Firebase backend
    // to reject revoked refresh tokens immediately for privileged admin routes.
    decoded = await getAuth(app).verifyIdToken(token, true);
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Invalid or expired token." },
        { status: 401 },
      ),
    };
  }

  // Strict: verified admin custom claim is strictly required (SEC-001)
  if (decoded.admin !== true) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Admin privilege required (verified admin custom claim required)." },
        { status: 403 },
      ),
    };
  }

  // Confirm account is not disabled in authoritative store (fail-closed)
  const accountResult = await getUserAccount(app, decoded.uid, decoded);
  if (!accountResult.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Failed to verify account status due to database error." },
        { status: 503 },
      ),
    };
  }

  if (accountResult.status === "Disabled") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Account is disabled." },
        { status: 403 },
      ),
    };
  }

  return { ok: true, uid: decoded.uid, email: decoded.email };
}

/**
 * Server-side Granular RBAC Guard (D-08).
 * Checks that the authenticated caller holds at least one of the allowed roles.
 * Super Admin (custom claim { admin: true }) inherits all administrative roles unless disabled.
 * Fail-closed: rejects if database error occurs.
 */
export async function requireRole(
  req: Request,
  allowedRoles: AppRole[],
): Promise<RoleGuardResult> {
  // Test environment bypass: isolated strictly behind isTestAuthBypassAllowed()
  if (isTestAuthBypassAllowed() && req.headers.get("x-test-uid")) {
    if (req.headers.get("x-test-db-error") === "true") {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Failed to verify account authorization due to database error." },
          { status: 503 },
        ),
      };
    }

    const testStatus = req.headers.get("x-test-status") || "Active";
    if (testStatus === "Disabled") {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Account is disabled." },
          { status: 403 },
        ),
      };
    }

    const testRoles = new Set<AppRole>(["player"]);
    if (req.headers.get("x-test-admin") === "true") {
      testRoles.add("superAdmin");
      testRoles.add("clubAdmin");
      testRoles.add("matchAdmin");
      testRoles.add("financeAdmin");
      testRoles.add("studioAdmin");
      testRoles.add("isDesigner");
    }

    const headerRoles = req.headers.get("x-test-roles") || req.headers.get("x-test-role");
    if (headerRoles) {
      for (const r of headerRoles.split(",")) {
        const trimmed = r.trim() as AppRole;
        if (trimmed) testRoles.add(trimmed);
      }
    }

    const hasAllowed = allowedRoles.some((r) => testRoles.has(r));
    if (!hasAllowed) {
      return {
        ok: false,
        response: NextResponse.json(
          {
            error: `Access forbidden: requires one of [${allowedRoles.join(", ")}].`,
          },
          { status: 403 },
        ),
      };
    }

    return {
      ok: true,
      uid: req.headers.get("x-test-uid")!,
      email: req.headers.get("x-test-email") || "test@kavachcricket.com",
      roles: testRoles,
      status: testStatus,
      playerId: req.headers.get("x-test-player-id") || undefined,
    };
  }

  const authHeader = req.headers.get("authorization");
  if (!authHeader || (!authHeader.startsWith("Bearer ") && authHeader !== "Bearer")) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Missing Authorization header." },
        { status: 401 },
      ),
    };
  }
  const token = authHeader.startsWith("Bearer ") ? authHeader.substring(7).trim() : "";
  if (!token) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Empty bearer token." },
        { status: 401 },
      ),
    };
  }

  const app = ensureAdminApp();
  let decoded: any;
  try {
    decoded = await getAuth(app).verifyIdToken(token, true);
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Invalid or expired token." },
        { status: 401 },
      ),
    };
  }

  // Authoritatively confirm account status and roles (fail-closed)
  const accountResult = await getUserAccount(app, decoded.uid, decoded);
  if (!accountResult.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: accountResult.error },
        { status: 503 },
      ),
    };
  }

  if (accountResult.status === "Disabled") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Account is disabled." },
        { status: 403 },
      ),
    };
  }

  const hasRole = allowedRoles.some((r) => accountResult.roles.has(r));
  if (!hasRole) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: `Access forbidden: requires one of [${allowedRoles.join(", ")}].`,
        },
        { status: 403 },
      ),
    };
  }

  return {
    ok: true,
    uid: decoded.uid,
    email: decoded.email,
    roles: accountResult.roles,
    status: accountResult.status,
    playerId: accountResult.playerId,
  };
}

/** Convenience role guards */
export async function requireSuperAdmin(req: Request): Promise<RoleGuardResult> {
  return requireRole(req, ["superAdmin"]);
}

export async function requireClubAdmin(req: Request): Promise<RoleGuardResult> {
  return requireRole(req, ["clubAdmin", "superAdmin"]);
}

export async function requireMatchAdmin(req: Request): Promise<RoleGuardResult> {
  return requireRole(req, ["matchAdmin", "clubAdmin", "superAdmin"]);
}

export async function requireFinanceAdmin(req: Request): Promise<RoleGuardResult> {
  return requireRole(req, ["financeAdmin", "superAdmin"]);
}

export async function requireStudioAdmin(req: Request): Promise<RoleGuardResult> {
  return requireRole(req, ["studioAdmin", "superAdmin"]);
}
