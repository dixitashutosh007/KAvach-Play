/**
 * R1: ID-token fetch with one silent refresh on 401.
 *
 * The server rejects revoked, Firebase-disabled and deleted sessions with 401. A
 * legitimate user can also hit 401 if their cached ID token was issued just before a
 * server-side check (clock skew, token minted moments before revocation of an older
 * session). So on a 401 we force-refresh the token once and resend:
 *  - session still valid  → the refreshed token succeeds; the user never sees an error;
 *  - session ended        → Firebase refuses the refresh (and its SDK signs the user out);
 *                           we raise SessionEndedError with a clear message.
 *
 * Kept free of Firebase imports so it can be unit-tested with the production code.
 */

export interface IdTokenSource {
  getIdToken(forceRefresh?: boolean): Promise<string>;
}

export class SessionEndedError extends Error {
  constructor() {
    super("Your session has ended. Please sign in again.");
    this.name = "SessionEndedError";
  }
}

/** A body can be sent twice only if it is not a one-shot stream. */
function canResend(body: RequestInit["body"]): boolean {
  return !(typeof ReadableStream !== "undefined" && body instanceof ReadableStream);
}

export async function fetchWithIdToken(
  user: IdTokenSource,
  input: RequestInfo | URL,
  init: RequestInit = {},
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const send = (token: string) => {
    const headers = new Headers(init.headers || {});
    headers.set("Authorization", `Bearer ${token}`);
    return fetchImpl(input, { ...init, headers });
  };

  const first = await send(await user.getIdToken());
  if (first.status !== 401 || !canResend(init.body)) return first;

  let fresh: string;
  try {
    fresh = await user.getIdToken(true);
  } catch {
    throw new SessionEndedError();
  }
  return send(fresh);
}
