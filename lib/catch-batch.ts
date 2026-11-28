import type { CatchType } from "./catch-validation.ts";

export interface CatchBatchState {
  pendingKeys: Record<string, string>;
  succeededPlayerIds: Set<string>;
}

export function createCatchBatchState(): CatchBatchState {
  return {
    pendingKeys: {},
    succeededPlayerIds: new Set<string>(),
  };
}

export interface CatchBatchFailure {
  playerId: string;
  playerName?: string;
  reason: string;
}

export interface CatchBatchResult {
  allSucceeded: boolean;
  succeededCount: number;
  failedPlayers: CatchBatchFailure[];
  failedPlayerId?: string;
  errorMessage?: string;
}

export async function executeCatchBatch({
  selectedPlayers,
  state,
  catchType,
  playerCounts,
  matchId,
  comment,
  getPlayerName,
  recordCatch,
  generateKey = () => crypto.randomUUID(),
}: {
  selectedPlayers: string[];
  state: CatchBatchState;
  catchType: CatchType;
  playerCounts: Record<string, number>;
  matchId?: string;
  comment?: string;
  getPlayerName: (playerId: string) => string | null;
  recordCatch: (entry: {
    playerId: string;
    playerName: string;
    type: CatchType;
    count: number;
    matchId?: string;
    comment?: string;
    recordedBy: string;
    idempotencyKey: string;
  }) => Promise<unknown>;
  generateKey?: () => string;
}): Promise<CatchBatchResult> {
  // Ensure every not-yet-succeeded player has a stable idempotency key.
  for (const pid of selectedPlayers) {
    if (!state.succeededPlayerIds.has(pid) && !state.pendingKeys[pid]) {
      state.pendingKeys[pid] = generateKey();
    }
  }

  let succeededCount = 0;
  const failedPlayers: CatchBatchFailure[] = [];

  for (const pid of selectedPlayers) {
    if (state.succeededPlayerIds.has(pid)) {
      continue;
    }
    const rawName = getPlayerName(pid);
    const playerName = typeof rawName === "string" ? rawName.trim() : "";
    if (!playerName) {
      failedPlayers.push({
        playerId: pid,
        reason: `Selected player (${pid}) is no longer available.`,
      });
      continue;
    }
    const idempotencyKey = state.pendingKeys[pid];
    try {
      await recordCatch({
        playerId: pid,
        playerName,
        type: catchType,
        count: playerCounts[pid] || 1,
        matchId: matchId || undefined,
        comment: comment?.trim() || undefined,
        recordedBy: "admin",
        idempotencyKey,
      });
      state.succeededPlayerIds.add(pid);
      delete state.pendingKeys[pid];
      succeededCount += 1;
    } catch (err: any) {
      failedPlayers.push({
        playerId: pid,
        playerName,
        reason: err?.message || `Failed to record catch for ${playerName}.`,
      });
    }
  }

  if (failedPlayers.length > 0) {
    const summary = failedPlayers
      .map((f) => `${f.playerName || f.playerId}: ${f.reason}`)
      .join("; ");
    const prefix =
      succeededCount > 0
        ? `${succeededCount} catch${succeededCount === 1 ? "" : "es"} saved; ${failedPlayers.length} failed: `
        : "";
    return {
      allSucceeded: false,
      succeededCount,
      failedPlayers,
      failedPlayerId: failedPlayers[0].playerId,
      errorMessage: `${prefix}${summary} Please retry.`,
    };
  }

  return { allSucceeded: true, succeededCount, failedPlayers: [] };
}
