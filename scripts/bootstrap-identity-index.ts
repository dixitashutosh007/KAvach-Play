/**
 * Offline Dry-Run Identity Index Bootstrap & Collision Analysis
 * (scripts/bootstrap-identity-index.ts)
 *
 * Scans historical player profiles, validates phone number formats,
 * verifies bidirectional UID bindings, and produces a collision report.
 *
 * NOTE: Dry-run only by default. Zero database modifications performed.
 */

import { parseStrictIndianMobile } from "../lib/account-linking.ts";

export interface CollisionReport {
  totalLinkedPlayers: number;
  validPhoneCount: number;
  invalidPhoneCount: number;
  phoneCollisions: Array<{ phone: string; playerIds: string[] }>;
  uidCollisions: Array<{ uid: string; playerIds: string[] }>;
  appUserInconsistencies: Array<{ uid: string; playerId: string; appUserPlayerId?: string }>;
}

export async function generateIdentityCollisionReport(
  db: FirebaseFirestore.Firestore,
): Promise<CollisionReport> {
  const playersSnap = await db.collection("players").get();
  const phoneToPlayers = new Map<string, string[]>();
  const uidToPlayers = new Map<string, string[]>();

  let totalLinked = 0;
  let validPhone = 0;
  let invalidPhone = 0;
  const appUserInconsistencies: Array<{ uid: string; playerId: string; appUserPlayerId?: string }> = [];

  for (const doc of playersSnap.docs) {
    const data = doc.data() || {};
    if (!data.authUid) continue;
    totalLinked++;

    const uid = data.authUid;
    if (!uidToPlayers.has(uid)) uidToPlayers.set(uid, []);
    uidToPlayers.get(uid)!.push(doc.id);

    const parsed = parseStrictIndianMobile(data.mobile);
    if (!parsed.ok) {
      invalidPhone++;
    } else {
      validPhone++;
      const canonical = parsed.canonical;
      if (!phoneToPlayers.has(canonical)) phoneToPlayers.set(canonical, []);
      phoneToPlayers.get(canonical)!.push(doc.id);
    }

    // Check appUsers doc
    const userDoc = await db.collection("appUsers").doc(uid).get();
    const userData = userDoc.exists ? userDoc.data() || {} : {};
    if (userData.playerId !== doc.id) {
      appUserInconsistencies.push({
        uid,
        playerId: doc.id,
        appUserPlayerId: userData.playerId,
      });
    }
  }

  const phoneCollisions = Array.from(phoneToPlayers.entries())
    .filter(([_, list]) => list.length > 1)
    .map(([phone, playerIds]) => ({ phone, playerIds }));

  const uidCollisions = Array.from(uidToPlayers.entries())
    .filter(([_, list]) => list.length > 1)
    .map(([uid, playerIds]) => ({ uid, playerIds }));

  return {
    totalLinkedPlayers: totalLinked,
    validPhoneCount: validPhone,
    invalidPhoneCount: invalidPhone,
    phoneCollisions,
    uidCollisions,
    appUserInconsistencies,
  };
}
