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

// Direct literal references for Next.js Webpack DefinePlugin client-side inlining
const COMPILED_NEXT_PUBLIC_DB_ID =
  typeof process !== "undefined" ? process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID : undefined;
const COMPILED_AWS_BRANCH =
  typeof process !== "undefined" ? process.env.AWS_BRANCH : undefined;
const COMPILED_GIT_BRANCH =
  typeof process !== "undefined" ? process.env.GIT_BRANCH : undefined;
const COMPILED_GITHUB_REF_NAME =
  typeof process !== "undefined" ? process.env.GITHUB_REF_NAME : undefined;

/**
 * Resolves and validates the deployment branch across candidate environment variables.
 *
 * Rules:
 * 1. Inspects every populated value among AWS_BRANCH, GIT_BRANCH, and GITHUB_REF_NAME.
 * 2. Normalizes values by trimming whitespace.
 * 3. If populated values disagree, fails closed by throwing an explicit Configuration Error.
 * 4. Returns the single agreeing branch name, or empty string if none are populated.
 */
export function resolveDeploymentBranch(
  env?: Record<string, string | undefined>
): string {
  const branchCandidates: Array<{ key: string; value: string }> = [];

  const awsBranch =
    env !== undefined
      ? env.AWS_BRANCH
      : (typeof process !== "undefined" ? process.env.AWS_BRANCH : COMPILED_AWS_BRANCH);
  const gitBranch =
    env !== undefined
      ? env.GIT_BRANCH
      : (typeof process !== "undefined" ? process.env.GIT_BRANCH : COMPILED_GIT_BRANCH);
  const ghRef =
    env !== undefined
      ? env.GITHUB_REF_NAME
      : (typeof process !== "undefined" ? process.env.GITHUB_REF_NAME : COMPILED_GITHUB_REF_NAME);

  if (awsBranch !== undefined && awsBranch.trim() !== "") {
    branchCandidates.push({ key: "AWS_BRANCH", value: awsBranch.trim() });
  }
  if (gitBranch !== undefined && gitBranch.trim() !== "") {
    branchCandidates.push({ key: "GIT_BRANCH", value: gitBranch.trim() });
  }
  if (ghRef !== undefined && ghRef.trim() !== "") {
    branchCandidates.push({ key: "GITHUB_REF_NAME", value: ghRef.trim() });
  }

  if (branchCandidates.length === 0) {
    return "";
  }

  const distinctBranches = Array.from(new Set(branchCandidates.map((c) => c.value)));
  if (distinctBranches.length > 1) {
    const details = branchCandidates.map((c) => `${c.key}='${c.value}'`).join(", ");
    throw new Error(
      `Configuration Error: Conflicting branch identities detected (${details}). Failing closed without fallback.`
    );
  }

  return distinctBranches[0];
}

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
  env?: Record<string, string | undefined>
): string {
  // 1. Inspect and validate candidate explicit database ID variables independently
  const candidates: Array<{ key: string; value: string }> = [];

  const rawNextPublic =
    env !== undefined
      ? env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID
      : (typeof process !== "undefined"
          ? process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID
          : COMPILED_NEXT_PUBLIC_DB_ID);

  if (rawNextPublic !== undefined) {
    const trimmed = rawNextPublic.trim();
    if (!trimmed) {
      throw new Error(
        "Configuration Error: Missing Firestore database ID. NEXT_PUBLIC_FIRESTORE_DATABASE_ID is empty or whitespace-only. Failing closed."
      );
    }
    if (!APPROVED_FIRESTORE_DATABASE_IDS.has(trimmed)) {
      throw new Error(
        `Configuration Error: Unrecognized Firestore database ID '${trimmed}'. Only approved production ('${PRODUCTION_FIRESTORE_DATABASE_ID}') and development ('${DEVELOPMENT_FIRESTORE_DATABASE_ID}') databases are permitted. Failing closed without fallback.`
      );
    }
    candidates.push({ key: "NEXT_PUBLIC_FIRESTORE_DATABASE_ID", value: trimmed });
  }

  const rawServerDb =
    env !== undefined
      ? env.FIRESTORE_DATABASE_ID
      : (typeof process !== "undefined" ? process.env.FIRESTORE_DATABASE_ID : undefined);

  if (rawServerDb !== undefined) {
    const trimmed = rawServerDb.trim();
    if (!trimmed) {
      throw new Error(
        "Configuration Error: Missing Firestore database ID. FIRESTORE_DATABASE_ID is empty or whitespace-only. Failing closed."
      );
    }
    if (!APPROVED_FIRESTORE_DATABASE_IDS.has(trimmed)) {
      throw new Error(
        `Configuration Error: Unrecognized Firestore database ID '${trimmed}'. Only approved production ('${PRODUCTION_FIRESTORE_DATABASE_ID}') and development ('${DEVELOPMENT_FIRESTORE_DATABASE_ID}') databases are permitted. Failing closed without fallback.`
      );
    }
    candidates.push({ key: "FIRESTORE_DATABASE_ID", value: trimmed });
  }

  // If both are supplied, require exact agreement
  if (candidates.length === 2 && candidates[0].value !== candidates[1].value) {
    throw new Error(
      `Configuration Error: Conflicting database configuration detected. NEXT_PUBLIC_FIRESTORE_DATABASE_ID='${candidates[0].value}' does not match FIRESTORE_DATABASE_ID='${candidates[1].value}'. Failing closed.`
    );
  }

  const explicitDbId = candidates.length > 0 ? candidates[0].value : "";

  const branch = resolveDeploymentBranch(env);
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
  let branch: string;
  try {
    branch = resolveDeploymentBranch(env);
  } catch {
    return false; // Conflicting branch identities fail closed (payments disabled)
  }

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

/**
 * Evaluates whether hosted Razorpay test-mode checkout is permitted on `mig-mov`
 * against the development/staging database (`kavach-play-db-ext`).
 *
 * Fail-closed guarantees:
 * - Never enabled on `main`, `master`, preview, or unrecognized branches.
 * - Never enabled against `PRODUCTION_FIRESTORE_DATABASE_ID`.
 * - Requires explicit `ALLOW_STAGING_TEST_PAYMENTS === "true"`.
 * - Requires both `RAZORPAY_KEY_ID` and `NEXT_PUBLIC_RAZORPAY_KEY_ID` to be present,
 *   identical, and start with `"rzp_test_"` (live `rzp_live_*` keys are rejected).
 * - Requires non-empty `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET`.
 */
export function isStagingTestCheckoutEnabled(
  env: Record<string, string | undefined> = (typeof process !== "undefined" ? process.env : {})
): boolean {
  if (env.DISABLE_PAYMENT_OPERATIONS === "true") {
    return false;
  }
  if (env.ALLOW_STAGING_TEST_PAYMENTS !== "true") {
    return false;
  }

  let branch: string;
  try {
    branch = resolveDeploymentBranch(env);
  } catch {
    return false;
  }
  if (branch !== "mig-mov") {
    return false;
  }

  let dbId: string;
  try {
    dbId = resolveFirestoreDatabaseId(env);
  } catch {
    return false;
  }
  if (dbId !== DEVELOPMENT_FIRESTORE_DATABASE_ID) {
    return false;
  }

  const nextPublicKeyId = (env.NEXT_PUBLIC_RAZORPAY_KEY_ID || "").trim();
  const serverKeyId = (env.RAZORPAY_KEY_ID || "").trim();
  const keySecret = (env.RAZORPAY_KEY_SECRET || "").trim();
  const webhookSecret = (env.RAZORPAY_WEBHOOK_SECRET || "").trim();

  if (!nextPublicKeyId.startsWith("rzp_test_")) {
    return false;
  }
  if (!serverKeyId.startsWith("rzp_test_") || serverKeyId !== nextPublicKeyId) {
    return false;
  }
  if (!keySecret || !webhookSecret) {
    return false;
  }

  return true;
}
