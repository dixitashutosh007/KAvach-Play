/**
 * Centralized Server-Side Firebase Admin & Firestore Provider (`lib/server-db.ts`)
 *
 * Unifies Admin SDK database initialization across all API routes and server actions.
 * Guarantees strict environment isolation by requiring a validated database ID and
 * permanently eliminating dangerous fallbacks to the default database.
 */
import { getApps, initializeApp, cert, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import firebaseConfig from "../firebase-applet-config.json" with { type: "json" };
import {
  resolveFirestoreDatabaseId,
  arePaymentOperationsEnabled,
  PRODUCTION_FIRESTORE_DATABASE_ID,
  DEVELOPMENT_FIRESTORE_DATABASE_ID,
} from "./database-config.ts";

export {
  resolveFirestoreDatabaseId,
  arePaymentOperationsEnabled,
  PRODUCTION_FIRESTORE_DATABASE_ID,
  DEVELOPMENT_FIRESTORE_DATABASE_ID,
};

let testDbOverride: any = null;

/**
 * In non-production environments (unit tests), allows injecting a test database.
 */
export function setServerDbForTesting(db: any) {
  if (process.env.NODE_ENV !== "production") {
    testDbOverride = db;
  }
}

/**
 * Initializes or returns the singleton Firebase Admin App.
 */
export function ensureAdminApp(): App {
  const apps = getApps();
  if (apps.length) return apps[0];
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    return initializeApp({
      credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)),
    });
  }
  return initializeApp({ projectId: firebaseConfig.projectId });
}

/**
 * Returns the authoritative server-side Firestore instance for the configured environment.
 *
 * Strict Isolation Guarantees:
 * - Requires a valid, non-empty database ID from resolveFirestoreDatabaseId().
 * - Calls getFirestore(app, dbId).
 * - Under NO circumstances catches errors to fall back to getFirestore(app).
 * - If database selection or connection fails, throws immediately and fails closed.
 */
export function getServerFirestore(app?: App): Firestore {
  if (testDbOverride && process.env.NODE_ENV !== "production") {
    return testDbOverride;
  }

  const adminApp = app || ensureAdminApp();

  // In local emulator test environment, the Firestore emulator only supports the default database.
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    return getFirestore(adminApp);
  }

  const dbId = resolveFirestoreDatabaseId();

  if (!dbId || typeof dbId !== "string" || !dbId.trim()) {
    throw new Error(
      "Configuration Error: Resolved database ID is invalid or empty. Failing closed.",
    );
  }

  return getFirestore(adminApp, dbId.trim());
}
