"use client";

/** Small shared building blocks for the Finance Plans screens (`components/finance/FinanceUi.tsx`). */
import React from "react";
import { X } from "lucide-react";

export const inr = (n: number) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const fmtDate = (d: string | null | undefined) => {
  if (!d) return "";
  const [y, m, day] = d.split("-").map(Number);
  return `${day} ${MONTHS[m - 1]} ${y}`;
};

export function Sheet({ title, onClose, children, testId }: { title: string; onClose: () => void; children: React.ReactNode; testId?: string }) {
  return (
    <div className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center bg-black/60 sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full sm:max-w-lg max-h-[92dvh] overflow-y-auto overscroll-contain rounded-t-2xl sm:rounded-2xl bg-surface shadow-xl" data-testid={testId}>
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 px-4 py-3 bg-surface border-b border-border">
          <h3 className="text-base font-black font-heading text-text-primary">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="w-11 h-11 rounded-full flex items-center justify-center hover:bg-surface-hover cursor-pointer">
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>
        <div className="p-4 flex flex-col gap-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{children}</div>
      </div>
    </div>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 flex items-center justify-between gap-2 text-sm text-rose-800">
      <span>{message}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="min-h-[36px] px-3 rounded-lg border border-rose-300 bg-white text-xs font-bold cursor-pointer">
          Retry
        </button>
      )}
    </div>
  );
}

export function Metric({ label, value, tone, testId }: { label: string; value: string; tone?: "brand" | "success" | "warning"; testId?: string }) {
  const cls =
    tone === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : tone === "warning" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-border bg-surface text-text-primary";
  return (
    <div className={`rounded-xl border px-3 py-2 ${cls}`} data-testid={testId}>
      <p className="text-[10px] font-bold uppercase tracking-wide opacity-80">{label}</p>
      <p className="text-lg font-black font-heading tabular-nums">{value}</p>
    </div>
  );
}

export const FIELD = "min-h-[48px] w-full rounded-xl border border-border bg-surface px-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-brand/30";
export const PRIMARY_BTN = "flex-1 min-h-[48px] rounded-xl bg-brand text-white text-sm font-black inline-flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer";
export const SECONDARY_BTN = "min-h-[48px] px-5 rounded-xl border border-border text-sm font-bold text-text-primary hover:bg-surface-hover cursor-pointer";
