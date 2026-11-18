/**
 * Offline Dry-Run Identity Index Bootstrap & Collision Analysis
 * (scripts/bootstrap-identity-index.ts)
 *
 * Implements SEC-1C-04:
 * Inspects the complete identity population:
 * - ALL players (linked & unlinked, active, disabled, merged)
 * - ALL appUsers (orphaned playerId, multiple UIDs per player, missing playerId)
 * - Both `phoneIndex` and `uidIndex` collections (orphans, disagreements, mismatches)
 * - Detects legacy format variations, phone collisions, UID collisions, orphan index entries, and mismatches.
 * - Emits a deterministic report with `safeToBootstrap: boolean`.
 *
 * NOTE: Strictly read-only by default. Zero database modifications performed.
 */

import { parseStrictIndianMobile, isCanonicalIndianMobile } from "../lib/account-linking.ts";

export interface PhoneCollision {
  canonicalPhone: string;
  playerIds: string[];
  rawFormats: string[];
  activeCount: number;
  isBlocking: boolean;
}

export interface UidCollision {
  uid: string;
  playerIds: string[];
  isBlocking: boolean;
}

export interface AppUserInconsistency {
  uid: string;
  playerId?: string;
  issue: string;
  isBlocking: boolean;
}

export interface OrphanIndexEntry {
  collection: "phoneIndex" | "uidIndex";
  id: string;
  referencedPlayerId: string;
  reason: string;
}

export interface IndexDisagreement {
  canonicalPhone: string;
  uid: string;
  phoneIndexPlayerId: string;
  uidIndexPlayerId: string;
}

export interface CollisionReport {
  timestamp: string;
  safeToBootstrap: boolean;
  blockingIssueCount: number;
  warningCount: number;
  summary: {
    players: {
      total: number;
      active: number;
      disabled: number;
      merged: number;
      linked: number;
      unlinked: number;
      validPhoneCount: number;
      invalidPhoneCount: number;
      missingPhoneCount: number;
    };
    appUsers: {
      total: number;
      withPlayerId: number;
      missingPlayerId: number;
    };
    indexes: {
      phoneIndexTotal: number;
      uidIndexTotal: number;
    };
  };
  phoneCollisions: PhoneCollision[];
  uidCollisions: UidCollision[];
  appUserInconsistencies: AppUserInconsistency[];
  orphanIndexes: OrphanIndexEntry[];
  indexDisagreements: IndexDisagreement[];
  remediationSuggestions: string[];
}

export async function generateIdentityCollisionReport(
  db: FirebaseFirestore.Firestore,
): Promise<CollisionReport> {
  const timestamp = new Date().toISOString();

  // 1. Fetch Complete Populations
  const [playersSnap, appUsersSnap, phoneIndexSnap, uidIndexSnap] = await Promise.all([
    db.collection("players").get(),
    db.collection("appUsers").get(),
    db.collection("phoneIndex").get(),
    db.collection("uidIndex").get(),
  ]);

  // Player Maps and Counters
  const playerMap = new Map<string, FirebaseFirestore.DocumentData>();
  let activePlayers = 0;
  let disabledPlayers = 0;
  let mergedPlayers = 0;
  let linkedPlayers = 0;
  let unlinkedPlayers = 0;
  let validPhoneCount = 0;
  let invalidPhoneCount = 0;
  let missingPhoneCount = 0;

  // Phone and UID tracking maps across ALL players
  const phoneToPlayerEntries = new Map<
    string,
    Array<{ id: string; rawMobile: string; isActive: boolean }>
  >();
  const uidToPlayerEntries = new Map<
    string,
    Array<{ id: string; isActive: boolean }>
  >();

  for (const doc of playersSnap.docs) {
    const data = doc.data() || {};
    playerMap.set(doc.id, data);

    const isActive = data.disabled !== true && !data.mergedInto;
    if (data.mergedInto) {
      mergedPlayers++;
    } else if (data.disabled === true) {
      disabledPlayers++;
    } else {
      activePlayers++;
    }

    if (data.authUid) {
      linkedPlayers++;
      const uid = String(data.authUid).trim();
      if (!uidToPlayerEntries.has(uid)) uidToPlayerEntries.set(uid, []);
      uidToPlayerEntries.get(uid)!.push({ id: doc.id, isActive });
    } else {
      unlinkedPlayers++;
    }

    if (!data.mobile || String(data.mobile).trim() === "") {
      missingPhoneCount++;
    } else {
      const parsed = parseStrictIndianMobile(data.mobile);
      if (!parsed.ok) {
        invalidPhoneCount++;
      } else {
        validPhoneCount++;
        const canonical = parsed.canonical;
        if (!phoneToPlayerEntries.has(canonical)) phoneToPlayerEntries.set(canonical, []);
        phoneToPlayerEntries.get(canonical)!.push({
          id: doc.id,
          rawMobile: String(data.mobile),
          isActive,
        });
      }
    }
  }

  // 2. Identify Phone Collisions
  const phoneCollisions: PhoneCollision[] = [];
  for (const [canonicalPhone, entries] of phoneToPlayerEntries.entries()) {
    if (entries.length > 1) {
      const playerIds = entries.map((e) => e.id);
      const rawFormats = Array.from(new Set(entries.map((e) => e.rawMobile)));
      const activeCount = entries.filter((e) => e.isActive).length;
      // Blocking if more than 1 active player shares the number
      const isBlocking = activeCount > 1;

      phoneCollisions.push({
        canonicalPhone,
        playerIds,
        rawFormats,
        activeCount,
        isBlocking,
      });
    }
  }

  // 3. Identify UID Collisions
  const uidCollisions: UidCollision[] = [];
  for (const [uid, entries] of uidToPlayerEntries.entries()) {
    if (entries.length > 1) {
      const playerIds = entries.map((e) => e.id);
      const activeCount = entries.filter((e) => e.isActive).length;
      const isBlocking = activeCount > 0;

      uidCollisions.push({
        uid,
        playerIds,
        isBlocking,
      });
    }
  }

  // 4. Inspect Complete appUsers Population
  const appUserInconsistencies: AppUserInconsistency[] = [];
  const playerToUserIds = new Map<string, string[]>();

  let appUsersWithPlayerId = 0;
  let appUsersMissingPlayerId = 0;

  for (const userDoc of appUsersSnap.docs) {
    const userData = userDoc.data() || {};
    const uid = userDoc.id;
    const playerId = userData.playerId ? String(userData.playerId).trim() : undefined;

    if (playerId) {
      appUsersWithPlayerId++;
      if (!playerMap.has(playerId)) {
        appUserInconsistencies.push({
          uid,
          playerId,
          issue: "Referenced player document does not exist (Orphaned appUser).",
          isBlocking: true,
        });
      } else {
        const playerDocData = playerMap.get(playerId)!;
        if (playerDocData.disabled === true || playerDocData.mergedInto) {
          appUserInconsistencies.push({
            uid,
            playerId,
            issue: `Referenced player document is ${playerDocData.mergedInto ? "merged" : "disabled"}.`,
            isBlocking: false,
          });
        }
        if (playerDocData.authUid && playerDocData.authUid !== uid) {
          appUserInconsistencies.push({
            uid,
            playerId,
            issue: `Referenced player.authUid (${playerDocData.authUid}) does not match appUser UID (${uid}).`,
            isBlocking: true,
          });
        }
      }

      if (!playerToUserIds.has(playerId)) playerToUserIds.set(playerId, []);
      playerToUserIds.get(playerId)!.push(uid);
    } else {
      appUsersMissingPlayerId++;
    }
  }

  // Multiple appUsers pointing to the same player
  for (const [playerId, userIds] of playerToUserIds.entries()) {
    if (userIds.length > 1) {
      const playerDocData = playerMap.get(playerId);
      const isPlayerActive = playerDocData && !playerDocData.disabled && !playerDocData.mergedInto;
      for (const uid of userIds) {
        appUserInconsistencies.push({
          uid,
          playerId,
          issue: `Multiple appUsers (${userIds.join(", ")}) reference the same player record.`,
          isBlocking: Boolean(isPlayerActive),
        });
      }
    }
  }

  // 5. Inspect phoneIndex Collection
  const orphanIndexes: OrphanIndexEntry[] = [];
  const phoneIndexMap = new Map<string, FirebaseFirestore.DocumentData>();

  for (const doc of phoneIndexSnap.docs) {
    const data = doc.data() || {};
    phoneIndexMap.set(doc.id, data);
    const targetPlayerId = data.playerId ? String(data.playerId).trim() : "";

    if (!targetPlayerId || !playerMap.has(targetPlayerId)) {
      orphanIndexes.push({
        collection: "phoneIndex",
        id: doc.id,
        referencedPlayerId: targetPlayerId,
        reason: "Referenced player does not exist in players collection.",
      });
    } else {
      const player = playerMap.get(targetPlayerId)!;
      const parsedStored = parseStrictIndianMobile(player.mobile);
      if (!parsedStored.ok || parsedStored.canonical !== doc.id) {
        orphanIndexes.push({
          collection: "phoneIndex",
          id: doc.id,
          referencedPlayerId: targetPlayerId,
          reason: `Indexed phone (${doc.id}) does not match player mobile (${player.mobile}).`,
        });
      }
    }
  }

  // 6. Inspect uidIndex Collection & Index Disagreements
  const indexDisagreements: IndexDisagreement[] = [];

  for (const doc of uidIndexSnap.docs) {
    const data = doc.data() || {};
    const uid = doc.id;
    const targetPlayerId = data.playerId ? String(data.playerId).trim() : "";
    const canonicalPhone = data.canonicalPhone ? String(data.canonicalPhone).trim() : "";

    if (!targetPlayerId || !playerMap.has(targetPlayerId)) {
      orphanIndexes.push({
        collection: "uidIndex",
        id: uid,
        referencedPlayerId: targetPlayerId,
        reason: "Referenced player does not exist in players collection.",
      });
    } else {
      const player = playerMap.get(targetPlayerId)!;
      if (player.authUid && player.authUid !== uid) {
        orphanIndexes.push({
          collection: "uidIndex",
          id: uid,
          referencedPlayerId: targetPlayerId,
          reason: `uidIndex doc (${uid}) does not match player.authUid (${player.authUid}).`,
        });
      }
    }

    // Check disagreement with phoneIndex
    if (canonicalPhone && phoneIndexMap.has(canonicalPhone)) {
      const phoneIndexData = phoneIndexMap.get(canonicalPhone)!;
      if (phoneIndexData.playerId && phoneIndexData.playerId !== targetPlayerId) {
        indexDisagreements.push({
          canonicalPhone,
          uid,
          phoneIndexPlayerId: phoneIndexData.playerId,
          uidIndexPlayerId: targetPlayerId,
        });
      }
    }
  }

  // 7. Calculate Severity and safeToBootstrap Status
  const blockingPhoneCollisions = phoneCollisions.filter((c) => c.isBlocking).length;
  const blockingUidCollisions = uidCollisions.filter((c) => c.isBlocking).length;
  const blockingAppUserIssues = appUserInconsistencies.filter((c) => c.isBlocking).length;
  const blockingOrphanIndexes = orphanIndexes.length;
  const blockingDisagreements = indexDisagreements.length;

  const blockingIssueCount =
    blockingPhoneCollisions +
    blockingUidCollisions +
    blockingAppUserIssues +
    blockingOrphanIndexes +
    blockingDisagreements;

  const warningCount =
    phoneCollisions.filter((c) => !c.isBlocking).length +
    uidCollisions.filter((c) => !c.isBlocking).length +
    appUserInconsistencies.filter((c) => !c.isBlocking).length +
    invalidPhoneCount;

  const safeToBootstrap = blockingIssueCount === 0;

  const remediationSuggestions: string[] = [];
  if (blockingPhoneCollisions > 0) {
    remediationSuggestions.push(
      "Merge or resolve active duplicate player records sharing identical phone numbers via /api/admin/merge-players.",
    );
  }
  if (blockingUidCollisions > 0) {
    remediationSuggestions.push(
      "Investigate and unlink/re-link player profiles that share the same Firebase authUid.",
    );
  }
  if (blockingAppUserIssues > 0) {
    remediationSuggestions.push(
      "Repair or remove orphaned appUsers records referencing missing or inconsistent player profiles.",
    );
  }
  if (blockingOrphanIndexes > 0) {
    remediationSuggestions.push(
      "Clean up orphaned phoneIndex or uidIndex documents that reference deleted or nonexistent players.",
    );
  }
  if (blockingDisagreements > 0) {
    remediationSuggestions.push(
      "Reconcile phoneIndex and uidIndex documents that point to conflicting player identifiers.",
    );
  }
  if (invalidPhoneCount > 0) {
    remediationSuggestions.push(
      "Correct malformed or non-standard Indian mobile numbers in historical player profiles.",
    );
  }

  return {
    timestamp,
    safeToBootstrap,
    blockingIssueCount,
    warningCount,
    summary: {
      players: {
        total: playersSnap.docs.length,
        active: activePlayers,
        disabled: disabledPlayers,
        merged: mergedPlayers,
        linked: linkedPlayers,
        unlinked: unlinkedPlayers,
        validPhoneCount,
        invalidPhoneCount,
        missingPhoneCount,
      },
      appUsers: {
        total: appUsersSnap.docs.length,
        withPlayerId: appUsersWithPlayerId,
        missingPlayerId: appUsersMissingPlayerId,
      },
      indexes: {
        phoneIndexTotal: phoneIndexSnap.docs.length,
        uidIndexTotal: uidIndexSnap.docs.length,
      },
    },
    phoneCollisions,
    uidCollisions,
    appUserInconsistencies,
    orphanIndexes,
    indexDisagreements,
    remediationSuggestions,
  };
}