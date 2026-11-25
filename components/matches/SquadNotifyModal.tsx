"use client";

import React, { useEffect, useMemo, useState } from "react";
import { CalendarDays, MapPin, MessageSquare, Shield, Users, X } from "lucide-react";
import type { Ground, Match, MatchPayment, Player } from "@/lib/types";
import { authedFetch } from "@/lib/authed-fetch";
import { resolveMatchCaptain } from "@/lib/match-captain";
import {
  buildDefaultSquadNotifyMessage,
  buildSquadWhatsAppMessage,
  buildSquadWhatsAppUrl,
  formatMatchDateTimeKolkata,
  resolveMatchSquadRecipients,
} from "@/lib/squad-notify";

export interface SquadNotifyModalProps {
  open: boolean;
  match: Match | null;
  ground?: Ground;
  players: readonly Player[];
  payments: readonly MatchPayment[];
  onClose: () => void;
}

export function SquadNotifyModal({
  open,
  match,
  ground,
  players,
  payments,
  onClose,
}: SquadNotifyModalProps) {
  const [customMessage, setCustomMessage] = useState("");

  useEffect(() => {
    if (open && match) {
      setCustomMessage(buildDefaultSquadNotifyMessage(match));
    }
  }, [open, match]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const resolution = useMemo(() => {
    if (!match) return { recipients: [], validPhoneCount: 0, missingPhoneNames: [] };
    return resolveMatchSquadRecipients(match, payments, players);
  }, [match, payments, players]);

  const captain = useMemo(
    () => (match ? resolveMatchCaptain(match, players) : null),
    [match, players],
  );

  if (!open || !match) return null;

  const startLabel = formatMatchDateTimeKolkata(match.date, match.time);

  const handleOpenWhatsApp = () => {
    const message = buildSquadWhatsAppMessage({
      match,
      ground,
      players,
      customMessage,
      resolution,
    });
    const url = buildSquadWhatsAppUrl(message);
    authedFetch("/api/admin/action-centre", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "record_share", matchId: match.id }),
    }).catch(() => {});
    window.open(url, "_blank", "noopener,noreferrer");
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="squad-notify-modal-title"
      data-testid="squad-notify-modal"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-border bg-surface p-5 shadow-xl space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-black uppercase tracking-wider text-brand">
              WhatsApp Squad Notification
            </p>
            <h2
              id="squad-notify-modal-title"
              className="text-lg font-black font-heading text-text-primary mt-0.5"
            >
              Notify Squad — vs {match.opponent || "TBD"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="min-h-[36px] min-w-[36px] rounded-xl flex items-center justify-center text-text-secondary hover:bg-surface-hover cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Match Verification Summary */}
        <div className="rounded-xl border border-border bg-surface-hover p-3 space-y-1.5 text-xs">
          <div className="flex items-center gap-2 text-text-primary font-semibold">
            <CalendarDays className="w-3.5 h-3.5 text-brand shrink-0" aria-hidden="true" />
            <span>{startLabel} (IST)</span>
          </div>
          <div className="flex items-center gap-2 text-text-secondary">
            <MapPin className="w-3.5 h-3.5 text-brand shrink-0" aria-hidden="true" />
            <span className="truncate">{ground?.name || "Ground TBD"}</span>
          </div>
          {captain && (
            <div className="flex items-center gap-2 text-text-secondary">
              <Shield className="w-3.5 h-3.5 text-brand shrink-0" aria-hidden="true" />
              <span>Captain: <strong className="text-text-primary">{captain.name}</strong></span>
            </div>
          )}
          <div className="flex items-center gap-2 text-text-secondary pt-1 border-t border-border/60">
            <Users className="w-3.5 h-3.5 text-brand shrink-0" aria-hidden="true" />
            <span data-testid="squad-notify-recipient-count">
              <strong className="text-text-primary">{resolution.recipients.length}</strong> squad{" "}
              {resolution.recipients.length === 1 ? "player" : "players"}
              {resolution.validPhoneCount < resolution.recipients.length
                ? ` (${resolution.validPhoneCount} with valid WhatsApp number)`
                : ""}
            </span>
          </div>
        </div>

        {resolution.missingPhoneNames.length > 0 && (
          <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
            Missing/invalid mobile for: {resolution.missingPhoneNames.join(", ")}. They will be listed without a contact tag.
          </p>
        )}

        <div>
          <label
            htmlFor="squad-notify-custom-message"
            className="block text-[11px] font-bold uppercase tracking-wider text-text-secondary mb-1.5"
          >
            Custom Message
          </label>
          <textarea
            id="squad-notify-custom-message"
            data-testid="squad-notify-message-input"
            rows={3}
            value={customMessage}
            onChange={(e) => setCustomMessage(e.target.value)}
            placeholder="Add reporting time, kit instructions, or notes..."
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-brand resize-none"
          />
          <p className="mt-1.5 text-[11px] text-text-muted leading-snug">
            Opens your personal WhatsApp with prefilled match details and{" "}
            <code className="font-mono text-[10px]">@+91…</code> contact references. Select your group/chat and tap Send.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            data-testid="squad-notify-cancel"
            className="min-h-[42px] px-4 rounded-xl border border-border bg-surface text-xs font-bold text-text-secondary hover:bg-surface-hover cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleOpenWhatsApp}
            data-testid="squad-notify-submit"
            className="min-h-[42px] px-4 rounded-xl bg-[#A30F2D] text-white text-xs font-bold inline-flex items-center gap-1.5 hover:bg-[#8B0D26] transition cursor-pointer shadow-xs"
          >
            <MessageSquare className="w-3.5 h-3.5" aria-hidden="true" />
            Open WhatsApp
          </button>
        </div>
      </div>
    </div>
  );
}
