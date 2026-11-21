/**
 * Google sign-in → player record linking (`lib/google-linking.ts`). Server-side.
 *
 * Restores production's "sign in with Google and use your player profile"
 * behaviour WITHOUT client-side writes:
 *  - eligible only for a Google sign-in whose email Google has verified
 *    (both read from the verified Firebase ID token, never from the request body);
 *  - the email must match exactly one active, un-merged player record;
 *  - the link is written as `appUsers/{uid}.playerId` (a field Firestore rules
 *    forbid clients from changing). The player's primary login (`authUid`,
 *    uidIndex, phoneIndex) is NOT touched, so mobile-OTP and Google logins both
 *    resolve to the same player.
 *  - idempotent; re-validated inside a transaction.
 *
 * Known limitation: the identity-merge safety checks refuse to merge a player
 * that has more than one linked login (fails closed with 409).
 */
import { FieldValue } from "firebase-admin/firestore";

export const GOOGLE_PROVIDER = "google.com";

export type LinkError = { ok: false; status: number; code: string; error: string };

export function normalizeEmail(email: unknown): string {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface GoogleTokenInfo {
  uid: string;
  email?: string;
  emailVerified?: boolean;
  signInProvider?: string;
}

export function checkGoogleLinkEligibility(t: GoogleTokenInfo): { ok: true; email: string } | LinkError {
  if (!t.uid || typeof t.uid !== "string") {
    return { ok: false, status: 400, code: "INVALID_USER", error: "Missing or invalid user identifier." };
  }
  if (t.signInProvider !== GOOGLE_PROVIDER) {
    return {
      ok: false,
      status: 403,
      code: "NOT_GOOGLE_SIGN_IN",
      error: "Email linking is available only when signed in with Google.",
    };
  }
  if (t.emailVerified !== true) {
    return {
      ok: false,
      status: 403,
      code: "EMAIL_NOT_VERIFIED",
      error: "Your Google email is not verified, so it cannot be used to link a player record.",
    };
  }
  const email = normalizeEmail(t.email);
  if (!EMAIL_SHAPE.test(email)) {
    return { ok: false, status: 400, code: "INVALID_EMAIL", error: "Your Google account has no usable email address." };
  }
  return { ok: true, email };
}

export interface PlayerSnapshotLike {
  id: string;
  data: Record<string, any>;
}

export function isActivePlayer(data: Record<string, any> | undefined | null): boolean {
  return Boolean(data) && data!.disabled !== true && !data!.mergedInto && data!.mergeStatus !== "in_progress";
}

/** Exactly one active, un-merged player must carry this email. */
export function selectPlayerForEmail(
  players: PlayerSnapshotLike[],
  email: string,
): { ok: true; player: PlayerSnapshotLike } | LinkError {
  const matches = players.filter((p) => isActivePlayer(p.data) && normalizeEmail(p.data.email) === email);
  if (matches.length === 0) {
    return {
      ok: false,
      status: 404,
      code: "NO_PLAYER_FOR_EMAIL",
      error: "No active player record has your Google email. Ask a Club Admin to add it to your player record.",
    };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      status: 409,
      code: "AMBIGUOUS_EMAIL",
      error: "More than one player record has your Google email. A Club Admin needs to resolve the duplicate.",
    };
  }
  return { ok: true, player: matches[0] };
}

export type LinkDecision =
  | { ok: true; action: "already-linked" | "link"; playerId: string }
  | LinkError;

/** Pure decision given fresh reads (used inside the transaction). */
export function decideGoogleLink(args: {
  uid: string;
  player: PlayerSnapshotLike;
  appUserPlayerId?: string | null;
  /** Ids of players whose primary `authUid` is this uid. */
  primaryPlayerIds: string[];
}): LinkDecision {
  const { uid, player, appUserPlayerId, primaryPlayerIds } = args;
  if (player.data.authUid === uid) return { ok: true, action: "already-linked", playerId: player.id };
  const otherPrimary = primaryPlayerIds.filter((id) => id !== player.id);
  if (otherPrimary.length > 0) {
    return {
      ok: false,
      status: 409,
      code: "LOGIN_LINKED_TO_OTHER_PLAYER",
      error: "This login is already the main login of another player record. A Club Admin needs to resolve it.",
    };
  }
  if (appUserPlayerId && appUserPlayerId !== player.id) {
    return {
      ok: false,
      status: 409,
      code: "LOGIN_LINKED_TO_OTHER_PLAYER",
      error: "This login is already linked to another player record. A Club Admin needs to resolve it.",
    };
  }
  if (appUserPlayerId === player.id) return { ok: true, action: "already-linked", playerId: player.id };
  return { ok: true, action: "link", playerId: player.id };
}

/** Server entry point: verifies eligibility, selects the player and links atomically. */
export async function linkGoogleLogin(
  db: any,
  token: GoogleTokenInfo,
): Promise<{ ok: true; playerId: string; alreadyLinked: boolean } | LinkError> {
  const eligibility = checkGoogleLinkEligibility(token);
  if (!eligibility.ok) return eligibility;
  const email = eligibility.email;

  // Candidate selection (players is a small collection; email case may vary in data).
  const allPlayers = await db.collection("players").get();
  const selected = selectPlayerForEmail(
    allPlayers.docs.map((d: any) => ({ id: d.id, data: d.data() || {} })),
    email,
  );
  if (!selected.ok) return selected;
  const playerId = selected.player.id;

  return db.runTransaction(async (tx: any) => {
    const playerRef = db.collection("players").doc(playerId);
    const appUserRef = db.collection("appUsers").doc(token.uid);
    const [playerSnap, appUserSnap, primarySnap] = await Promise.all([
      tx.get(playerRef),
      tx.get(appUserRef),
      tx.get(db.collection("players").where("authUid", "==", token.uid)),
    ]);

    // Re-validate against fresh data inside the transaction.
    const playerData = playerSnap.exists ? playerSnap.data() || {} : null;
    if (!playerData || !isActivePlayer(playerData) || normalizeEmail(playerData.email) !== email) {
      return {
        ok: false as const,
        status: 409,
        code: "PLAYER_CHANGED",
        error: "The player record changed while linking. Please try again.",
      };
    }
    const decision = decideGoogleLink({
      uid: token.uid,
      player: { id: playerId, data: playerData },
      appUserPlayerId: appUserSnap.exists ? appUserSnap.data()?.playerId ?? null : null,
      primaryPlayerIds: primarySnap.docs.map((d: any) => d.id),
    });
    if (!decision.ok) return decision;
    if (decision.action === "already-linked") return { ok: true as const, playerId, alreadyLinked: true };

    tx.set(
      appUserRef,
      {
        playerId,
        linkedVia: GOOGLE_PROVIDER,
        linkedEmail: email,
        linkedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return { ok: true as const, playerId, alreadyLinked: false };
  });
}
