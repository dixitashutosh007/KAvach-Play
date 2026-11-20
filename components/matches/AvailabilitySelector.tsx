"use client";

/**
 * Three-position availability selector (`components/matches/AvailabilitySelector.tsx`).
 *
 * Discrete segmented "slider": Out → Tentative → Playing.
 * - `value === null` means the player has NOT responded: the control renders a
 *   neutral, unselected state and nothing is persisted until the player chooses.
 * - Persists only through the caller's existing `onSelect` workflow, mapping to the
 *   stored availability vocabulary: Out → "No", Tentative → "Tentative",
 *   Playing → "Confirmed" (no schema change).
 * - Radiogroup semantics: Tab focuses the group, Arrow keys move focus,
 *   Enter/Space selects (arrow keys never persist on their own).
 */
import React, { useRef, useState } from "react";
import { CheckCircle2, HelpCircle, XCircle, Loader2 } from "lucide-react";

export type AvailabilityChoice = "Out" | "Tentative" | "Playing";
export type StoredAvailability = "No" | "Tentative" | "Confirmed";

export const AVAILABILITY_CHOICES: AvailabilityChoice[] = ["Out", "Tentative", "Playing"];

export const CHOICE_TO_STORED: Record<AvailabilityChoice, StoredAvailability> = {
  Out: "No",
  Tentative: "Tentative",
  Playing: "Confirmed",
};

/**
 * Maps the derived/display availability to a selector position.
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
      return "Tentative";
    case "Out":
    case "No":
    case "Not Playing":
      return "Out";
    default:
      return null;
  }
}

const CHOICE_META: Record<
  AvailabilityChoice,
  { label: string; Icon: typeof CheckCircle2; active: string; idleText: string; thumb: string }
> = {
  Out: {
    label: "Out",
    Icon: XCircle,
    active: "text-white",
    idleText: "text-rose-700",
    thumb: "bg-rose-600",
  },
  Tentative: {
    label: "Tentative",
    Icon: HelpCircle,
    active: "text-white",
    idleText: "text-amber-700",
    thumb: "bg-amber-500",
  },
  Playing: {
    label: "Playing",
    Icon: CheckCircle2,
    active: "text-white",
    idleText: "text-emerald-700",
    thumb: "bg-emerald-600",
  },
};

export interface AvailabilitySelectorProps {
  value: AvailabilityChoice | null;
  onSelect: (stored: StoredAvailability, choice: AvailabilityChoice) => void | Promise<void>;
  /** Choice currently being persisted (shows a spinner and blocks re-submission). */
  pendingChoice?: AvailabilityChoice | null;
  busy?: boolean;
  disabled?: boolean;
  /** Used for accessible naming and test ids. */
  matchId: string;
  opponentLabel?: string;
}

export function AvailabilitySelector({
  value,
  onSelect,
  pendingChoice = null,
  busy = false,
  disabled = false,
  matchId,
  opponentLabel,
}: AvailabilitySelectorProps) {
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [focusIndex, setFocusIndex] = useState<number>(() =>
    value ? AVAILABILITY_CHOICES.indexOf(value) : 0,
  );
  const isLocked = busy || disabled;
  const selectedIndex = value ? AVAILABILITY_CHOICES.indexOf(value) : -1;

  const choose = (choice: AvailabilityChoice) => {
    if (isLocked || choice === value) return;
    void onSelect(CHOICE_TO_STORED[choice], choice);
  };

  const moveFocus = (next: number) => {
    const idx = (next + AVAILABILITY_CHOICES.length) % AVAILABILITY_CHOICES.length;
    setFocusIndex(idx);
    optionRefs.current[idx]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, idx: number) => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      moveFocus(idx + 1);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      moveFocus(idx - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      moveFocus(0);
    } else if (e.key === "End") {
      e.preventDefault();
      moveFocus(AVAILABILITY_CHOICES.length - 1);
    }
  };

  const tabbableIndex = selectedIndex >= 0 ? selectedIndex : focusIndex;

  return (
    <div
      role="radiogroup"
      aria-label={opponentLabel ? `Availability for match vs ${opponentLabel}` : "Match availability"}
      aria-disabled={isLocked || undefined}
      data-testid={`availability-selector-${matchId}`}
      data-value={value ?? "none"}
      onClick={(e) => e.stopPropagation()}
      className={`relative grid grid-cols-3 p-1 rounded-full border transition-colors ${
        value ? "bg-surface-hover border-border" : "bg-surface-hover/60 border-dashed border-border"
      } ${disabled ? "opacity-60" : ""}`}
    >
      {/* Sliding thumb (only when an explicit answer exists) */}
      {selectedIndex >= 0 && (
        <span
          aria-hidden="true"
          data-testid={`availability-thumb-${matchId}`}
          className={`absolute top-1 bottom-1 left-1 rounded-full shadow-xs transition-transform duration-200 ease-out motion-reduce:transition-none ${CHOICE_META[value as AvailabilityChoice].thumb}`}
          style={{
            width: "calc((100% - 0.5rem) / 3)",
            transform: `translateX(${selectedIndex * 100}%)`,
          }}
        />
      )}

      {AVAILABILITY_CHOICES.map((choice, idx) => {
        const meta = CHOICE_META[choice];
        const isSelected = value === choice;
        const isPending = pendingChoice === choice;
        const Icon = meta.Icon;
        return (
          <button
            key={choice}
            ref={(el) => {
              optionRefs.current[idx] = el;
            }}
            type="button"
            role="radio"
            aria-checked={isSelected}
            aria-label={`Mark availability as ${meta.label}`}
            data-testid={`availability-option-${choice.toLowerCase()}-${matchId}`}
            tabIndex={idx === tabbableIndex ? 0 : -1}
            disabled={disabled}
            aria-busy={isPending || undefined}
            onClick={(e) => {
              e.stopPropagation();
              choose(choice);
            }}
            onKeyDown={(e) => onKeyDown(e, idx)}
            onFocus={() => setFocusIndex(idx)}
            className={`relative z-10 min-h-[40px] px-1.5 rounded-full text-xs font-bold flex items-center justify-center gap-1 transition-colors duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-scarlet/50 disabled:cursor-not-allowed ${
              isSelected ? meta.active : `${meta.idleText} hover:bg-surface/70`
            } ${busy && !isPending ? "cursor-wait" : ""}`}
          >
            {isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" aria-hidden="true" />
            ) : (
              <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            )}
            <span>{meta.label}</span>
          </button>
        );
      })}
    </div>
  );
}
