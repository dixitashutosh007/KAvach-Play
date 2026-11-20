/**
 * Authoritative Database Configuration & Payment Mode Evaluator (`lib/database-config.ts`)
 *
 * Centralizes environment-aware database ID resolution and payment operation gating
 * across both browser (client-side) and server runtimes without importing Node.js-only SDKs.
 */

export const PRODUCTION_FIRESTORE_DATABASE_ID =
  "ai-studio-cae01507-23c3-4ee4-92c8-848c4cf7d412";
export const DEVELOPMENT_FIRESTORE_DATABASE_ID = "kavach-play-db-ext";

/**
 * Resolves the authoritative Firestore Database ID for the current environment.
 *
 * Requirements:
 * 1. Checks explicit environment variable: NEXT_PUBLIC_FIRESTORE_DATABASE_ID or FIRESTORE_DATABASE_ID.
 * 2. If environment variable is absent, resolves via deployment branch (e.g. AWS_BRANCH on Amplify):
 *    - "mig-mov" -> DEVELOPMENT_FIRESTORE_DATABASE_ID ("kavach-play-db-ext")
 *    - "main" | "master" -> PRODUCTION_FIRESTORE_DATABASE_ID ("ai-studio-cae01507-23c3-4ee4-92c8-848c4cf7d412")
 * 3. If neither is available, FAILS CLOSED: throws an explicit configuration error.
 *    Under NO circumstances will it silently fall back to "(default)" or an unverified database.
 */
export function resolveFirestoreDatabaseId(): string {
  const explicitDbId =
    (typeof process !== "undefined" &&
      (process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID?.trim() ||
        process.env.FIRESTORE_DATABASE_ID?.trim())) ||
    "";

  if (explicitDbId) {
    return explicitDbId;
  }

  const branch = (
    typeof process !== "undefined"
      ? process.env.AWS_BRANCH ||
        process.env.GIT_BRANCH ||
        process.env.GITHUB_REF_NAME ||
        ""
      : ""
  ).trim();

  if (branch === "mig-mov") {
    return DEVELOPMENT_FIRESTORE_DATABASE_ID;
  }
  if (branch === "main" || branch === "master") {
    return PRODUCTION_FIRESTORE_DATABASE_ID;
  }

  throw new Error(
    "Configuration Error: Missing Firestore database ID. NEXT_PUBLIC_FIRESTORE_DATABASE_ID must be explicitly set to 'ai-studio-cae01507-23c3-4ee4-92c8-848c4cf7d412' (production) or 'kavach-play-db-ext' (development). Failing closed without default database fallback.",
  );
}

/**
 * Evaluates whether live Razorpay payment operations (order creation, webhook processing)
 * are permitted in the current runtime environment.
 *
 * Strict Development Safeguards:
 * 1. For mig-mov / development: Live payment operations are strictly disabled.
 * 2. Live payments can ONLY run against the production database on main.
 * 3. Fails closed if database resolution fails.
 * 4. Development environments cannot accidentally enable live payment operations.
 */
export function arePaymentOperationsEnabled(): boolean {
  if (typeof process !== "undefined" && process.env.DISABLE_PAYMENT_OPERATIONS === "true") {
    return false;
  }

  let dbId: string;
  try {
    dbId = resolveFirestoreDatabaseId();
  } catch {
    return false; // Fail closed if database ID is missing/invalid
  }

  // Development database is strictly forbidden from executing live payments
  if (dbId === DEVELOPMENT_FIRESTORE_DATABASE_ID || dbId.includes("kavach-play-db-ext")) {
    return false;
  }

  const branch = (
    typeof process !== "undefined"
      ? process.env.AWS_BRANCH ||
        process.env.GIT_BRANCH ||
        ""
      : ""
  ).trim();

  // mig-mov branch is strictly forbidden from executing live payments
  if (branch === "mig-mov") {
    return false;
  }

  // In production runtime, ONLY the authoritative production database is permitted
  if (typeof process !== "undefined" && process.env.NODE_ENV === "production" && dbId !== PRODUCTION_FIRESTORE_DATABASE_ID) {
    return false;
  }

  // Non-test environments must strictly target the production database
  if (typeof process !== "undefined" && process.env.NODE_ENV !== "test" && dbId !== PRODUCTION_FIRESTORE_DATABASE_ID) {
    return false;
  }

  return true;
}
