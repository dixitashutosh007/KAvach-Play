"use client";

import { Wallet, ArrowRight, CheckCircle2, AlertCircle } from "lucide-react";
import { PlayerDuesSummary } from "@/lib/player-dues";

export function PersonalPaymentCard({
  duesSummary,
  onNavigateToPayments,
}: {
  duesSummary: PlayerDuesSummary;
  onNavigateToPayments: () => void;
}) {
  const { hasDues, totalDue, dueCount, billableMatchPayments, unpaidOtherFees } = duesSummary;

  return (
    <section
      data-testid="personal-payment-card"
      aria-label="Personal Dues & Payments"
      className="w-full bg-surface border border-border rounded-2xl p-4 sm:p-5 shadow-xs"
    >
      {hasDues ? (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-scarlet/10 border border-scarlet/20 flex items-center justify-center shrink-0 mt-0.5">
              <Wallet className="w-5 h-5 text-scarlet" />
            </div>

            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-deep-wine font-heading">
                  Outstanding Club Dues
                </span>
                <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-scarlet text-white">
                  Payment Due
                </span>
              </div>
              <div className="text-2xl sm:text-3xl font-black font-heading text-text-primary mt-0.5">
                ₹{totalDue.toLocaleString("en-IN")}
              </div>
              <p className="text-xs text-text-secondary mt-1 font-medium">
                {dueCount} pending obligation{dueCount !== 1 ? "s" : ""}
                {billableMatchPayments.length > 0 &&
                  ` • ${billableMatchPayments.length} match fee${billableMatchPayments.length !== 1 ? "s" : ""}`}
                {unpaidOtherFees.length > 0 &&
                  ` • ${unpaidOtherFees.length} fee${unpaidOtherFees.length !== 1 ? "s" : ""}`}
              </p>
            </div>
          </div>

          <button
            type="button"
            data-testid="pay-now-button"
            aria-label="Pay outstanding club dues"
            onClick={onNavigateToPayments}
            className="min-h-[44px] w-full sm:w-auto px-6 py-2.5 bg-scarlet hover:bg-deep-wine text-white font-bold text-xs uppercase tracking-wider rounded-xl transition shadow-xs flex items-center justify-center gap-2 cursor-pointer active:scale-98"
          >
            <span>Pay Now</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <h3 className="text-xs sm:text-sm font-bold text-emerald-900 font-heading">
                All Club Dues Settled
              </h3>
              <p className="text-xs text-text-secondary font-medium">
                Your account is in good standing for all upcoming match selections.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onNavigateToPayments}
            className="min-h-[44px] text-xs font-bold text-scarlet hover:text-deep-wine self-start sm:self-auto flex items-center gap-1 cursor-pointer"
          >
            <span>View Statements</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </section>
  );
}
