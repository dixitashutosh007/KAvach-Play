"use client";

import { auth } from "./firebase";
import { fetchWithIdToken } from "./id-token-fetch";

/**
 * fetch() wrapper that attaches the current user's Firebase ID token as a
 * Bearer header. Use for every authenticated /api call.
 * Rejects with a clear error if no user is signed in. On a 401 it refreshes the
 * token once and retries (R1, see lib/id-token-fetch.ts).
 */
export async function authedFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const user = auth.currentUser;
  if (!user) {
    throw new Error("Sign in required.");
  }
  return fetchWithIdToken(user, input, init);
}
