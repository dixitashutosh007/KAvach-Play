/**
 * Offline Dry-Run Identity Index Bootstrap & Collision Analysis
 * (scripts/bootstrap-identity-index.ts)
 *
 * Implements SEC-1C-04 and SEC-1D-04:
 * Inspects the complete identity population:
 * - ALL players (linked & unlinked, active, disabled, merged)
 * - ALL appUsers (orphaned playerId, multiple UIDs per player, missing playerId)
 * - Both `phoneIndex` and `uidIndex` collections (orphans, disagreements, mismatches)
 * - Detects legacy format variations, phone collisions, UID collisions, orphan index entries, and mismatches.
 * - Accurately distinguishes safeToBootstrap, safeToLinkExistingRecords, and requiresManualResolution.
 * - Verifies keeper relationships for merged records.
 * - Flags missing index reservations for already-linked players.
 *
 * NOTE: Strictly read-only by default. Zero database modifications performed.
 */

import { parseStrictIndianMobile } from "../lib/account-linking.ts";

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

export interface MissingIndexReservation {
  playerId: string;
  authUid?: string;
  canonicalPhone?: string;
  missingUidIndex: boolean;
  missingPhoneIndex: boolean;
  reason: string;
}

export interface CollisionReport {
  timestamp: string;
  safeToBootstrap: boolean;
  safeToLinkExistingRecords: boolean;
  requiresManualResolution: boolean;
  blockingIssueCount: number;
  warningCount: number;
  missingPhoneCount: number;
  missingIndexReservations: MissingIndexReservation[];
  duplicatePhones: number;
  duplicateUids: number;
  orphanedMappings: number;
  invalidMergeRelationships: number;
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
      verifiedMergedCount: number;
      unverifiedMergedCount: number;
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
  for (const doc of playersSnap.docs) {
    playerMap.set(doc.id, doc.data() || {});
  }

  let activePlayers = 0;
  let disabledPlayers = 0;
  let mergedPlayers = 0;
  let verifiedMergedCount = 0;
  let unverifiedMergedCount = 0;
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

  for (const [docId, data] of playerMap.entries()) {
    const isActive = data.disabled !== true && !data.mergedInto;
    if (data.mergedInto) {
      mergedPlayers++;
      const keeper = playerMap.get(data.mergedInto);
      if (!keeper) {
        unverifiedMergedCount++;
      } else if (keeper.disabled === true || keeper.mergedInto) {
        // Keeper is disabled or itself merged (invalid merge relationship)
        unverifiedMergedCount++;
      } else {
        verifiedMergedCount++;
      }
    } else if (data.disabled === true) {
      disabledPlayers++;
    } else {
      activePlayers++;
    }

    if (data.authUid) {
      linkedPlayers++;
      const uid = String(data.authUid).trim();
      if (!uidToPlayerEntries.has(uid)) uidToPlayerEntries.set(uid, []);
      uidToPlayerEntries.get(uid)!.push({ id: docId, isActive });
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
          id: docId,
          rawMobile: String(data.mobile),
          isActive,
        });
      }
    }
  }

  // 2. Identify Phone Collisions (SEC-1D-04)
  const phoneCollisions: PhoneCollision[] = [];
  for (const [canonicalPhone, entries] of phoneToPlayerEntries.entries()) {
    if (entries.length > 1) {
      const playerIds = entries.map((e) => e.id);
      const rawFormats = Array.from(new Set(entries.map((e) => e.rawMobile)));
      const activeCount = entries.filter((e) => e.isActive).length;

      // Check if disabled entries are verified as merged into an active player in entries
      const unverifiedDisabledEntries = entries.filter((e) => {
        if (e.isActive) return false;
        const pData = playerMap.get(e.id);
        const mergedInto = pData?.mergedInto;
        return !mergedInto || !entries.some((k) => k.id === mergedInto && k.isActive);
      });

      // Blocking if more than 1 active player OR unverified disabled duplicate exists
      const isBlocking = activeCount > 1 || unverifiedDisabledEntries.length > 0;

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
            isBlocking: true,
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
  const uidIndexMap = new Map<string, FirebaseFirestore.DocumentData>();

  for (const doc of uidIndexSnap.docs) {
    const data = doc.data() || {};
    const uid = doc.id;
    uidIndexMap.set(uid, data);
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

  // 7. Detect Missing Index Reservations for Already-Linked Players (SEC-1D-04)
  const missingIndexReservations: MissingIndexReservation[] = [];
  for (const [playerId, data] of playerMap.entries()) {
    const authUid = data.authUid ? String(data.authUid).trim() : undefined;
    const rawMobile = data.mobile ? String(data.mobile).trim() : undefined;
    const isActive = data.disabled !== true && !data.mergedInto;

    if (authUid && isActive) {
      const hasUidIndex = uidIndexMap.has(authUid) && uidIndexMap.get(authUid)?.playerId === playerId;
      let hasPhoneIndex = false;
      let canonicalPhone: string | undefined = undefined;

      if (rawMobile) {
        const parsed = parseStrictIndianMobile(rawMobile);
        if (parsed.ok) {
          canonicalPhone = parsed.canonical;
          hasPhoneIndex = phoneIndexMap.has(canonicalPhone) && phoneIndexMap.get(canonicalPhone)?.playerId === playerId;
        }
      }

      if (!hasUidIndex || !hasPhoneIndex) {
        missingIndexReservations.push({
          playerId,
          authUid,
          canonicalPhone,
          missingUidIndex: !hasUidIndex,
          missingPhoneIndex: !hasPhoneIndex,
          reason: `Linked player is missing authoritative index reservations (${!hasUidIndex ? "uidIndex" : ""}${!hasUidIndex && !hasPhoneIndex ? ", " : ""}${!hasPhoneIndex ? "phoneIndex" : ""}).`,
        });
      }
    }
  }

  // 8. Detect Malformed Phones on Active or Linked Players (SEC-1D-04)
  const blockingMalformedPhones = Array.from(playerMap.entries()).filter(([_, data]) => {
    const isActiveOrLinked = (data.disabled !== true && !data.mergedInto) || Boolean(data.authUid);
    if (!isActiveOrLinked || !data.mobile) return false;
    return !parseStrictIndianMobile(data.mobile).ok;
  }).length;

  // 8b. Detect Missing Phones on Active Players (SEC-1F-07)
  const activeMissingPhones = Array.from(playerMap.entries()).filter(([_, data]) => {
    const isActive = data.disabled !== true && !data.mergedInto;
    return isActive && (!data.mobile || String(data.mobile).trim() === "");
  }).length;

  // 9. Calculate Severity and safeToBootstrap Status (SEC-1F-07)
  const duplicatePhones = phoneCollisions.filter((c) => c.isBlocking).length;
  const duplicateUids = uidCollisions.filter((c) => c.isBlocking).length;
  const blockingAppUserIssues = appUserInconsistencies.filter((c) => c.isBlocking).length;
  const blockingOrphanIndexes = orphanIndexes.length;
  const blockingDisagreements = indexDisagreements.length;
  const blockingMissingIndexCount = missingIndexReservations.length;
  const invalidMergeRelationships = unverifiedMergedCount;
  const orphanedMappings =
    orphanIndexes.length +
    appUserInconsistencies.filter((i) => i.issue.includes("Orphaned")).length;

  const blockingIssueCount =
    duplicatePhones +
    duplicateUids +
    blockingAppUserIssues +
    blockingOrphanIndexes +
    blockingDisagreements +
    blockingMalformedPhones +
    activeMissingPhones +
    blockingMissingIndexCount +
    invalidMergeRelationships;

  const warningCount =
    phoneCollisions.filter((c) => !c.isBlocking).length +
    uidCollisions.filter((c) => !c.isBlocking).length +
    appUserInconsistencies.filter((c) => !c.isBlocking).length +
    (invalidPhoneCount - blockingMalformedPhones);

  const safeToBootstrap = blockingIssueCount === 0;
  const safeToLinkExistingRecords =
    safeToBootstrap &&
    blockingIssueCount === 0 &&
    blockingMissingIndexCount === 0 &&
    blockingMalformedPhones === 0;
  const requiresManualResolution = !safeToBootstrap || blockingIssueCount > 0;

  const remediationSuggestions: string[] = [];
  if (duplicatePhones > 0) {
    remediationSuggestions.push(
      "Merge or resolve active duplicate player records sharing identical phone numbers via /api/admin/merge-players.",
    );
  }
  if (duplicateUids > 0) {
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
  if (blockingMalformedPhones > 0) {
    remediationSuggestions.push(
      "Correct malformed or non-standard Indian mobile numbers on active and linked player profiles.",
    );
  }
  if (unverifiedMergedCount > 0) {
    remediationSuggestions.push(
      "Resolve merged records that reference nonexistent keeper player documents.",
    );
  }
  if (missingIndexReservations.length > 0) {
    remediationSuggestions.push(
      "Bootstrap missing phoneIndex or uidIndex reservations for verified linked player records.",
    );
  }

  return {
    timestamp,
    safeToBootstrap,
    safeToLinkExistingRecords,
    requiresManualResolution,
    blockingIssueCount,
    warningCount,
    missingPhoneCount: activeMissingPhones,
    missingIndexReservations,
    duplicatePhones,
    duplicateUids,
    orphanedMappings,
    invalidMergeRelationships,
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
        verifiedMergedCount,
        unverifiedMergedCount,
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
