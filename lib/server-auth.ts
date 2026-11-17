/**
 * Server-side auth guard for sensitive API routes.
 *
 * All /api routes that trigger email or WhatsApp sends must go through
 * requireAdmin() first. Without a valid Firebase ID token from an admin,
 * the route rejects — this closes the door on external / AI /
 * link-preview-crawler calls that were hammering these endpoints.
 *
 * "Admin" is defined strictly as: token has the `admin: true` custom claim (SEC-001).
 * No client-writable Firestore document role fallback is permitted.
 */
import { NextResponse } from "next/server.js";
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import firebaseConfig from "../firebase-applet-config.json" with { type: "json" };

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

export type AuthGuardResult =
  | { ok: true; uid: string; email?: string }
  | { ok: false; response: NextResponse };

export type AdminGuardResult = AuthGuardResult;

/**
 * Verify the caller is any authenticated Firebase user.
 * Use this for routes that any signed-in user may call (e.g. creating their own payment order).
 */
export async function requireAuth(req: Request): Promise<AuthGuardResult> {
  // Test environment bypass for integration tests with live emulator
  if (process.env.NODE_ENV === "test" && req.headers.get("x-test-uid")) {
    return {
      ok: true,
      uid: req.headers.get("x-test-uid")!,
      email: req.headers.get("x-test-email") || "test@kavachcricket.com",
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
