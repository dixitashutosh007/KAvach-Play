/**
 * Server-side auth guard for sensitive API routes.
 *
 * All /api routes that trigger email or WhatsApp sends must go through
 * requireAdmin() first. Without a valid Firebase ID token from an admin,
 * the route rejects — this closes the door on external / AI /
 * link-preview-crawler calls that were hammering these endpoints.
 *
 * "Admin" is defined as: token has the `admin: true` custom claim OR the
 * caller's appUsers/{uid} doc has role == "admin". The claim path is
 * preferred (no Firestore read); the doc fallback keeps things working
 * during the rollout window before scripts/set-admin-claim.js is applied.
 */
import { NextResponse } from "next/server";
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import firebaseConfig from "../firebase-applet-config.json";

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

export type AdminGuardResult =
  | { ok: true; uid: string; email?: string }
  | { ok: false; response: NextResponse };

export async function requireAdmin(req: Request): Promise<AdminGuardResult> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Missing Authorization header." },
        { status: 401 },
      ),
    };
  }
  const token = authHeader.substring(7).trim();
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

  // Fast path: custom claim
  if (decoded.admin === true) {
    return { ok: true, uid: decoded.uid, email: decoded.email };
  }

  // Fallback: check appUsers doc
  try {
    const dbId =
      process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID ||
      (firebaseConfig as any).firestoreDatabaseId;
    let db;
    try {
      db = getFirestore(app, dbId);
    } catch {
      db = getFirestore(app);
    }
    const snap = await db.collection("appUsers").doc(decoded.uid).get();
    if (snap.exists && snap.data()?.role === "admin") {
      return { ok: true, uid: decoded.uid, email: decoded.email };
    }
  } catch {
    // Fall through to reject
  }

  return {
    ok: false,
    response: NextResponse.json(
      { error: "Admin privilege required." },
      { status: 403 },
    ),
  };
}
