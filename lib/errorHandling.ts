/**
 * Database Error Handler (`lib/errorHandling.ts`)
 *
 * Centralized error reporting and handling mechanism for all Firestore database actions.
 * Logs out authentication-related state along with standard error messages to help
 * diagnose security rules/quota/permission errors. It specifically emits a custom
 * window event "firestore-quota-exceeded" to trigger UI warnings gracefully when limits are hit.
 */
import { auth } from "./firebase";

export enum OperationType {
  CREATE = "create",
  UPDATE = "update",
  DELETE = "delete",
  LIST = "list",
  GET = "get",
  WRITE = "write",
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
) {
  const isPermissionDenied =
    error instanceof Error &&
    error.message.includes("Missing or insufficient permissions");

  // Ignore permission errors if user is null (expected during logout)
  if (isPermissionDenied && !auth.currentUser) {
    return;
  }

  const errMessage = error instanceof Error ? error.message : String(error);

  // Check for Firestore Quota Exceeded error
  if (
    errMessage.toLowerCase().includes("quota") ||
    errMessage.toLowerCase().includes("exceeded")
  ) {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("firestore-quota-exceeded"));
    }
  }

  const errInfo: FirestoreErrorInfo = {
    error: errMessage,
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error("Firestore Error: ", JSON.stringify(errInfo));
}
