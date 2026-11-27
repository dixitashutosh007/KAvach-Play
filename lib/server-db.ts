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
  isStagingTestCheckoutEnabled,
  PRODUCTION_FIRESTORE_DATABASE_ID,
  DEVELOPMENT_FIRESTORE_DATABASE_ID,
  APPROVED_FIRESTORE_DATABASE_IDS,
} from "./database-config.ts";

export {
  resolveFirestoreDatabaseId,
  arePaymentOperationsEnabled,
  isStagingTestCheckoutEnabled,
  PRODUCTION_FIRESTORE_DATABASE_ID,
  DEVELOPMENT_FIRESTORE_DATABASE_ID,
  APPROVED_FIRESTORE_DATABASE_IDS,
};

export type FirestoreFactory = (app: App, databaseId?: string) => Firestore;

let testDbOverride: any = null;
let firestoreFactory: FirestoreFactory = getFirestore;

/**
 * In non-production environments (unit tests), allows injecting a test database.
 */
export function setServerDbForTesting(db: any) {
  if (process.env.NODE_ENV !== "production") {
    testDbOverride = db;
  }
}

/**
 * In non-production environments (unit tests), allows injecting a controlled factory
 * to verify the exact arguments passed to getFirestore without mock database overrides.
 */
export function setFirestoreFactoryForTesting(factory: FirestoreFactory | null) {
  if (process.env.NODE_ENV !== "production") {
    firestoreFactory = factory || getFirestore;
  }
}

/**
 * Checks if the current execution is strictly a local developer emulator test run.
 *
 * Safety Guarantees:
 * - Disabled in production runtimes (NODE_ENV === "production").
 * - Disabled in deployed AWS environments (AWS_APP_ID or AWS_EXECUTION_ENV).
 * - Only enabled when running local tests against a local FIRESTORE_EMULATOR_HOST.
 */
export function isLocalEmulatorEnvironment(
  env: Record<string, string | undefined> = (typeof process !== "undefined" ? process.env : {})
): boolean {
  if (env.NODE_ENV === "production") return false;
  if (env.AWS_APP_ID || env.AWS_EXECUTION_ENV) return false;
  return Boolean(env.FIRESTORE_EMULATOR_HOST);
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
 * - Requires a valid, approved database ID from resolveFirestoreDatabaseId().
 * - Calls firestoreFactory(app, dbId).
 * - Under NO circumstances catches errors to fall back to firestoreFactory(app).
 * - If database selection or connection fails, throws immediately and fails closed.
 */
export function getServerFirestore(app?: App): Firestore {
  if (testDbOverride && process.env.NODE_ENV !== "production") {
    return testDbOverride;
  }

  const adminApp = app || ensureAdminApp();

  // In strictly local emulator test environment, the Firestore emulator only supports the default database.
  if (isLocalEmulatorEnvironment()) {
    return firestoreFactory(adminApp);
  }

  const dbId = resolveFirestoreDatabaseId();
  return firestoreFactory(adminApp, dbId);
}
