/**
 * Authoritative Database Configuration & Payment Mode Evaluator (`lib/database-config.ts`)
 *
 * Centralizes environment-aware database ID resolution and payment operation gating
 * across both browser (client-side) and server runtimes without importing Node.js-only SDKs.
 */

export const PRODUCTION_FIRESTORE_DATABASE_ID =
  "ai-studio-cae01507-23c3-4ee4-92c8-848c4cf7d412";
export const DEVELOPMENT_FIRESTORE_DATABASE_ID = "kavach-play-db-ext";

export const APPROVED_FIRESTORE_DATABASE_IDS = new Set<string>([
  PRODUCTION_FIRESTORE_DATABASE_ID,
  DEVELOPMENT_FIRESTORE_DATABASE_ID,
]);

/**
 * Resolves the authoritative Firestore Database ID for the current environment.
 *
 * Requirements:
 * 1. Checks explicit environment variable: NEXT_PUBLIC_FIRESTORE_DATABASE_ID or FIRESTORE_DATABASE_ID.
 * 2. Checks deployment branch identity (AWS_BRANCH, GIT_BRANCH, or GITHUB_REF_NAME).
 * 3. Rejects empty, whitespace-only, malformed, or unrecognized database IDs.
 * 4. Strictly enforces branch-to-database alignment:
 *    - "mig-mov" requires DEVELOPMENT_FIRESTORE_DATABASE_ID ("kavach-play-db-ext").
 *    - "main" / "master" requires PRODUCTION_FIRESTORE_DATABASE_ID ("ai-studio-cae01507-23c3-4ee4-92c8-848c4cf7d412").
 * 5. If branch identity and explicit database ID conflict, FAILS CLOSED: throws an explicit configuration error.
 * 6. If branch is unrecognized (preview, feature, unknown), FAILS CLOSED.
 * 7. Under NO circumstances falls back to "(default)" or an unapproved database.
 */
export function resolveFirestoreDatabaseId(
  env: Record<string, string | undefined> = (typeof process !== "undefined" ? process.env : {})
): string {
  const explicitDbId = (
    env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID?.trim() ||
    env.FIRESTORE_DATABASE_ID?.trim() ||
    ""
  );

  // If explicit ID was provided but is whitespace-only, empty, or unapproved, fail closed immediately.
  if (
    (env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID !== undefined && !explicitDbId) ||
    (env.FIRESTORE_DATABASE_ID !== undefined && !explicitDbId)
  ) {
    throw new Error(
      "Configuration Error: Missing Firestore database ID. Empty or whitespace-only database IDs are rejected. Failing closed.",
    );
  }

  if (explicitDbId && !APPROVED_FIRESTORE_DATABASE_IDS.has(explicitDbId)) {
    throw new Error(
      `Configuration Error: Unrecognized Firestore database ID '${explicitDbId}'. Only approved production ('${PRODUCTION_FIRESTORE_DATABASE_ID}') and development ('${DEVELOPMENT_FIRESTORE_DATABASE_ID}') databases are permitted. Failing closed without fallback.`,
    );
  }

  const branch = (
    env.AWS_BRANCH ||
    env.GIT_BRANCH ||
    env.GITHUB_REF_NAME ||
    ""
  ).trim();

  // Branch-specific resolution and conflict detection
  if (branch === "mig-mov") {
    if (explicitDbId && explicitDbId !== DEVELOPMENT_FIRESTORE_DATABASE_ID) {
      throw new Error(
        `Configuration Error: Conflict detected. Branch 'mig-mov' requires development database '${DEVELOPMENT_FIRESTORE_DATABASE_ID}', but received '${explicitDbId}'. Failing closed.`,
      );
    }
    return DEVELOPMENT_FIRESTORE_DATABASE_ID;
  }

  if (branch === "main" || branch === "master") {
    if (explicitDbId && explicitDbId !== PRODUCTION_FIRESTORE_DATABASE_ID) {
      throw new Error(
        `Configuration Error: Conflict detected. Branch '${branch}' requires production database '${PRODUCTION_FIRESTORE_DATABASE_ID}', but received '${explicitDbId}'. Failing closed.`,
      );
    }
    return PRODUCTION_FIRESTORE_DATABASE_ID;
  }

  // If a branch is present but unrecognized, fail closed
  if (branch) {
    throw new Error(
      `Configuration Error: Unrecognized or unauthorized branch '${branch}'. Failing closed.`,
    );
  }

  // Branch is missing/empty: must have a valid approved explicitDbId
  if (explicitDbId && APPROVED_FIRESTORE_DATABASE_IDS.has(explicitDbId)) {
    return explicitDbId;
  }

  throw new Error(
    `Configuration Error: Missing Firestore database ID. NEXT_PUBLIC_FIRESTORE_DATABASE_ID must be explicitly set to '${PRODUCTION_FIRESTORE_DATABASE_ID}' (production) or '${DEVELOPMENT_FIRESTORE_DATABASE_ID}' (development). Failing closed without default database fallback.`,
  );
}

/**
 * Evaluates whether live Razorpay payment operations (order creation, webhook processing)
 * are permitted in the current runtime environment.
 *
 * Strict Production Authorization Standards:
 * 1. Live Razorpay operations are permitted ONLY when:
 *    - Deployment branch is explicitly "main" or "master".
 *    - Firestore database ID exactly equals the approved production database ID.
 *    - No explicit payment-disable flag is enabled.
 * 2. "mig-mov" must always have payments disabled.
 * 3. Any unknown, preview, feature, or unrecognized branch must have payments disabled.
 * 4. Missing branch identity must fail closed for live payment operations (returns false).
 * 5. Does NOT infer production solely from NODE_ENV or database ID.
 * 6. Preserves existing production payment functionality on "main".
 */
export function arePaymentOperationsEnabled(
  env: Record<string, string | undefined> = (typeof process !== "undefined" ? process.env : {})
): boolean {
  if (env.DISABLE_PAYMENT_OPERATIONS === "true") {
    return false;
  }

  // Strict branch authorization: Live payments require explicit main or master branch
  const branch = (
    env.AWS_BRANCH ||
    env.GIT_BRANCH ||
    env.GITHUB_REF_NAME ||
    ""
  ).trim();

  if (!branch || (branch !== "main" && branch !== "master")) {
    return false; // mig-mov, unknown, preview, feature, or missing branch all return false
  }

  let dbId: string;
  try {
    dbId = resolveFirestoreDatabaseId(env);
  } catch {
    return false; // Fail closed if database ID is invalid or conflicts with branch
  }

  // Live payments can ONLY run against the production database
  if (dbId !== PRODUCTION_FIRESTORE_DATABASE_ID) {
    return false;
  }

  return true;
}
