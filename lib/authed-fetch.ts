"use client";

import { auth } from "./firebase";

/**
 * fetch() wrapper that attaches the current user's Firebase ID token as a
 * Bearer header. Use for calls to admin-gated /api routes (email, whatsapp).
 * Rejects with a clear error if no user is signed in.
 */
export async function authedFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const user = auth.currentUser;
  if (!user) {
    throw new Error("Sign in required.");
  }
  const token = await user.getIdToken();
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}
