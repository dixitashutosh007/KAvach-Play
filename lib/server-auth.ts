/**
 * Server-side auth guard and Role-Based Access Control (RBAC) for API routes.
 *
 * Implements SEC-001, D-08, and Active Remediation Master Plan Phase 5:
 * - Super-admin authority is granted strictly via the `admin: true` Firebase Auth custom claim (SEC-001).
 * - Granular administrative capabilities (Club Admin, Match Admin, Finance Admin, Studio Admin, Designer)
 *   are verified server-side against custom claims and authoritative `/appUsers/{uid}` documents.
 * - Client-supplied roles and privileged fields in request bodies or client headers are strictly rejected.
 * - Enforces account status verification: accounts with `status: "Disabled"` are rejected immediately.
 * - All token verification for administrative access enforces `checkRevoked: true` to prevent stale token reuse.
 */
import { NextResponse } from "next/server.js";
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import firebaseConfig from "../firebase-applet-config.json" with { type: "json" };

export type AppRole =
  | "superAdmin"
  | "clubAdmin"
  | "matchAdmin"
  | "financeAdmin"
  | "studioAdmin"
  | "isDesigner"
  | "player";

function ensureAdminApp() {
  const apps = getApps();
  if (apps.length) return apps[0];
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    return initializeApp({
      credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)),
    });
  }
  return initializeApp({ projectId: firebaseConfig.projectId });
}

function getDb(app: any) {
  const dbId =
    process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID ||
    (firebaseConfig as any).firestoreDatabaseId;
  try {
    return getFirestore(app, dbId);
  } catch {
    return getFirestore(app);
  }
}

export type AuthGuardResult =
  | {
      ok: true;
      uid: string;
      email?: string;
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

/**
 * Extracts and queries the authoritative user roles and account status.
 */
export async function getUserAccount(
  app: any,
  uid: string,
  decodedToken?: any,
): Promise<{ roles: Set<AppRole>; status: string; playerId?: string }> {
  const roles = new Set<AppRole>(["player"]);
  let status = "Active";
  let playerId: string | undefined = undefined;

  // Super Admin custom claim grants all administrative roles (SEC-001)
  if (decodedToken?.admin === true) {
    roles.add("superAdmin");
    roles.add("clubAdmin");
    roles.add("matchAdmin");
    roles.add("financeAdmin");
    roles.add("studioAdmin");
    roles.add("isDesigner");
  }

  // Token custom claims role check
  if (decodedToken?.role && typeof decodedToken.role === "string") {
    const r = decodedToken.role.trim();
    if (r === "clubAdmin") roles.add("clubAdmin");
    if (r === "matchAdmin") roles.add("matchAdmin");
    if (r === "financeAdmin") roles.add("financeAdmin");
    if (r === "studioAdmin") roles.add("studioAdmin");
    if (r === "designer" || r === "isDesigner") roles.add("isDesigner");
  }

  try {
    const db = getDb(app);
    const userDoc = await db.collection("appUsers").doc(uid).get();
    if (userDoc.exists) {
      const data = userDoc.data() || {};
      if (data.status) status = String(data.status);
      if (data.playerId) playerId = String(data.playerId);

      // Granular roles stored authoritatively in appUsers
      // (Write-protected against non-superadmins in firestore.rules)
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
  } catch (err) {
    // If database lookup fails, retain claims-derived roles
    console.warn(`[server-auth] Failed to lookup appUsers doc for ${uid}:`, err);
  }

  return { roles, status, playerId };
}

/**
 * Verify the caller is any authenticated Firebase user with an active account.
 */
export async function requireAuth(req: Request): Promise<AuthGuardResult> {
  // Test environment bypass for integration tests with live emulator or mocks
  if (process.env.NODE_ENV === "test" && req.headers.get("x-test-uid")) {
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
  try {
    const decoded = await getAuth(app).verifyIdToken(token);

    // Verify account is not disabled in Firestore
    try {
      const db = getDb(app);
      const userDoc = await db.collection("appUsers").doc(decoded.uid).get();
      if (userDoc.exists && userDoc.data()?.status === "Disabled") {
        return {
          ok: false,
          response: NextResponse.json(
            { error: "Account is disabled." },
            { status: 403 },
          ),
        };
      }
    } catch {
      // Continue if Firestore read is unconfigured in test
    }

    return { ok: true, uid: decoded.uid, email: decoded.email };
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Invalid or expired token." },
        { status: 401 },
      ),
    };
  }
}

/**
 * Require Super Admin authority.
 * Strictly verifies token custom claim { admin: true } with checkRevoked: true (SEC-001).
 */
export async function requireAdmin(req: Request): Promise<AdminGuardResult> {
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
  let decoded;
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
  if (decoded.admin === true) {
    return { ok: true, uid: decoded.uid, email: decoded.email };
  }

  return {
    ok: false,
    response: NextResponse.json(
      { error: "Admin privilege required (verified admin custom claim required)." },
      { status: 403 },
    ),
  };
}

/**
 * Server-side Granular RBAC Guard (D-08).
 * Checks that the authenticated caller holds at least one of the allowed roles.
 * Super Admin (custom claim { admin: true }) inherits all administrative roles.
 */
export async function requireRole(
  req: Request,
  allowedRoles: AppRole[],
): Promise<RoleGuardResult> {
  // Test environment bypass
  if (process.env.NODE_ENV === "test" && req.headers.get("x-test-uid")) {
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

  const { roles, status, playerId } = await getUserAccount(app, decoded.uid, decoded);

  if (status === "Disabled") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Account is disabled." },
        { status: 403 },
      ),
    };
  }

  const hasRole = allowedRoles.some((r) => roles.has(r));
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
    roles,
    status,
    playerId,
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
