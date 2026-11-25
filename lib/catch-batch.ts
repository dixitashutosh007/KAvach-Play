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

export interface CatchBatchResult {
  allSucceeded: boolean;
  succeededCount: number;
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
  for (const pid of selectedPlayers) {
    if (state.succeededPlayerIds.has(pid)) {
      continue;
    }
    const playerName = getPlayerName(pid);
    if (!playerName) {
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
      return {
        allSucceeded: false,
        succeededCount,
        failedPlayerId: pid,
        errorMessage: err?.message || `Failed to record catch for ${playerName}. Please retry.`,
      };
    }
  }

  return { allSucceeded: true, succeededCount };
}
