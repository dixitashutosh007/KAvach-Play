export type CatchType = "dropped" | "stunning";

export interface ValidatedCatchInput {
  playerId: string;
  type: CatchType;
  count: number;
  matchId?: string;
  comment?: string;
}

export function validateCatchInput(input: {
  playerId: unknown;
  type: unknown;
  count: unknown;
  matchId?: unknown;
  comment?: unknown;
}): { ok: true; value: ValidatedCatchInput } | { ok: false; error: string } {
  if (typeof input.playerId !== "string" || !input.playerId.trim() || input.playerId.includes("/")) {
    return { ok: false, error: "Select a valid player." };
  }
  if (input.type !== "dropped" && input.type !== "stunning") {
    return { ok: false, error: "Catch type must be 'stunning' or 'dropped'." };
  }
  const count = typeof input.count === "string" ? Number(input.count.trim()) : Number(input.count);
  if (!Number.isInteger(count) || count < 1 || count > 50) {
    return { ok: false, error: "Catch count must be a whole number between 1 and 50." };
  }
  const matchId =
    typeof input.matchId === "string" && input.matchId.trim() && !input.matchId.includes("/")
      ? input.matchId.trim()
      : undefined;
  const comment =
    typeof input.comment === "string" && input.comment.trim()
      ? input.comment.trim().slice(0, 200)
      : undefined;

  return {
    ok: true,
    value: {
      playerId: input.playerId.trim(),
      type: input.type,
      count,
      matchId,
      comment,
    },
  };
}

/**
 * Computes the new `stunningCatches` and `droppedCatches` totals for a player
 * when transitioning a catchLog entry from `oldEntry` (null on create) to
 * `newEntry` (null on delete), clamping at 0 so totals never go negative.
 */
export function computeCorrectedCatchTotals(
  current: { stunningCatches?: number; droppedCatches?: number },
  oldEntry: { type: CatchType; count: number } | null,
  newEntry: { type: CatchType; count: number } | null,
): { stunningCatches: number; droppedCatches: number } {
  let stunning = Math.max(0, Number(current.stunningCatches) || 0);
  let dropped = Math.max(0, Number(current.droppedCatches) || 0);

  if (oldEntry) {
    if (oldEntry.type === "stunning") stunning = Math.max(0, stunning - oldEntry.count);
    else dropped = Math.max(0, dropped - oldEntry.count);
  }
  if (newEntry) {
    if (newEntry.type === "stunning") stunning += newEntry.count;
    else dropped += newEntry.count;
  }

  return { stunningCatches: stunning, droppedCatches: dropped };
}
