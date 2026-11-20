/**
 * User-safe descriptions for realtime subscription failures (`lib/subscription-errors.ts`).
 * Pure module: no Firebase imports, so it is unit-testable without initialising the SDK.
 */
/**
 * Converts a Firestore listener error into a short, user-safe message.
 * Never includes tokens, user identifiers or raw backend payloads.
 */
export function describeSubscriptionError(error: unknown): string {
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code || "")
      : "";
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (code === "permission-denied" || message.includes("Missing or insufficient permissions")) {
    return "You do not have permission to load matches. Ask a club admin to check your account access.";
  }
  if (code === "unavailable" || message.toLowerCase().includes("offline")) {
    return "Matches could not be loaded because the database is unreachable. Check your connection and retry.";
  }
  if (code === "failed-precondition") {
    return "Matches could not be loaded because the database query is not supported by the current configuration.";
  }
  return "Matches could not be loaded. Please refresh and try again.";
}
