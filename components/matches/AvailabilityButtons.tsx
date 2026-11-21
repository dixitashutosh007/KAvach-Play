"use client";

/**
 * Availability buttons (`components/matches/AvailabilityButtons.tsx`).
 *
 * The approved three-button control: Playing · Maybe · Out.
 * - `value === null` means the player has NOT responded: no button is pressed and
 *   nothing is persisted until the player chooses.
 * - Persists only through the caller's existing workflow, using the stored
 *   availability vocabulary: Playing → "Confirmed", Maybe → "Tentative", Out → "No".
 * - Clicks never bubble to the parent card (which opens the match detail view).
 */
import React from "react";
import { CheckCircle2, HelpCircle, XCircle, Loader2 } from "lucide-react";

export type AvailabilityChoice = "Playing" | "Maybe" | "Out";
export type StoredAvailability = "Confirmed" | "Tentative" | "No";

export const AVAILABILITY_CHOICES: AvailabilityChoice[] = ["Playing", "Maybe", "Out"];

export const CHOICE_TO_STORED: Record<AvailabilityChoice, StoredAvailability> = {
  Playing: "Confirmed",
  Maybe: "Tentative",
  Out: "No",
};

/**
 * Maps a derived/display availability to a button.
 * Anything that is not an explicit player answer (Pending, missing, unknown) → null.
 */
export function toAvailabilityChoice(status: string | null | undefined): AvailabilityChoice | null {
  switch (status) {
    case "Playing":
    case "Confirmed":
    case "Yes":
      return "Playing";
    case "Maybe":
    case "Tentative":
      return "Maybe";
    case "Out":
    case "No":
    case "Not Playing":
      return "Out";
    default:
      return null;
  }
}

const STYLES: Record<
  AvailabilityChoice,
  { Icon: typeof CheckCircle2; selected: string; idle: string }
> = {
  Playing: {
    Icon: CheckCircle2,
    selected: "bg-emerald-600 border-emerald-600 text-white shadow-xs",
    idle: "bg-emerald-50 border-emerald-300 text-emerald-800 hover:bg-emerald-100",
  },
  Maybe: {
    Icon: HelpCircle,
    selected: "bg-amber-500 border-amber-500 text-white shadow-xs",
    idle: "bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100",
  },
  Out: {
    Icon: XCircle,
    selected: "bg-rose-600 border-rose-600 text-white shadow-xs",
    idle: "bg-rose-50 border-rose-300 text-rose-800 hover:bg-rose-100",
  },
};

export interface AvailabilityButtonsProps {
  matchId: string;
  value: AvailabilityChoice | null;
  onSelect: (stored: StoredAvailability, choice: AvailabilityChoice) => void | Promise<void>;
  /** Choice currently being saved (spinner on that button). */
  pendingChoice?: AvailabilityChoice | null;
  /** Blocks re-submission while an update is in flight. */
  busy?: boolean;
}

export function AvailabilityButtons({
  matchId,
  value,
  onSelect,
  pendingChoice = null,
  busy = false,
}: AvailabilityButtonsProps) {
  return (
    <div
      className="grid grid-cols-3 gap-2"
      data-testid={`availability-buttons-${matchId}`}
      data-value={value ?? "none"}
      onClick={(e) => e.stopPropagation()}
    >
      {AVAILABILITY_CHOICES.map((choice) => {
        const { Icon, selected, idle } = STYLES[choice];
        const isSelected = value === choice;
        const isPending = pendingChoice === choice;
        return (
          <button
            key={choice}
            type="button"
            disabled={busy}
            aria-pressed={isSelected}
            aria-label={`Mark availability as ${choice}`}
            data-testid={`availability-${choice.toLowerCase()}-${matchId}`}
            onClick={(e) => {
              e.stopPropagation();
              if (busy || isSelected) return;
              void onSelect(CHOICE_TO_STORED[choice], choice);
            }}
            className={`min-h-[44px] px-2 rounded-xl border text-sm font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:cursor-wait disabled:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-scarlet/50 ${
              isSelected ? selected : idle
            }`}
          >
            {isPending ? (
              <Loader2 className="w-4 h-4 animate-spin shrink-0" aria-hidden="true" />
            ) : (
              <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
            )}
            <span>{choice}</span>
          </button>
        );
      })}
    </div>
  );
}
