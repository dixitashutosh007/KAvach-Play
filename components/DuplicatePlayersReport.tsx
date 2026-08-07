"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Copy, IndianRupee } from "lucide-react";
import { Player } from "@/lib/types";
import { useStore } from "@/hooks/useStore";

/**
 * Admin tool for reviewing and merging duplicate player profiles.
 * Groups players that share a normalized mobile number or a normalized
 * email, shows each candidate's payment counts / dues, lets the admin
 * pick which profile stays ("keeper") and merges every other row into
 * it. The merge itself is done by store.mergePlayer, which reparents
 * match payments, otherFees and merchOrders and then trashes the loser.
 */

const normalizeMobile = (m: string | undefined | null) => {
  if (!m) return "";
  const digits = String(m).replace(/\D/g, "");
  return digits.slice(-10);
};

const normalizeEmail = (e: string | undefined | null) => {
  if (!e) return "";
  return String(e).trim().toLowerCase();
};

export function DuplicatePlayersReport({
  store,
}: {
  store: ReturnType<typeof useStore>;
}) {
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [keeperByGroup, setKeeperByGroup] = useState<Record<string, string>>({});
  const [mergingGroup, setMergingGroup] = useState<string | null>(null);

  // Payments + otherFees are lazy subscriptions in the store — the merge
  // reparents docs from those collections and needs them primed.
  // ensure* helpers are idempotent, so calling on every mount is safe.
  useEffect(() => {
    store.ensurePayments?.();
    store.ensureOtherFees?.();
  }, [store]);

  const groups = useMemo(() => {
    const byMobile = new Map<string, Player[]>();
    const byEmail = new Map<string, Player[]>();

    for (const p of store.players) {
      // Skip already-merged losers so they don't keep appearing after cleanup.
      if (p.mergedInto) continue;
      const m = normalizeMobile(p.mobile);
      if (m && m.length === 10) {
        const arr = byMobile.get(m) || [];
        arr.push(p);
        byMobile.set(m, arr);
      }
      const e = normalizeEmail(p.email);
      if (e && e.includes("@")) {
        const arr = byEmail.get(e) || [];
        arr.push(p);
        byEmail.set(e, arr);
      }
    }

    type Group = { key: string; matchOn: "mobile" | "email"; players: Player[] };
    const out: Group[] = [];
    for (const [key, players] of byMobile.entries()) {
      if (players.length > 1) out.push({ key, matchOn: "mobile", players });
    }
    for (const [key, players] of byEmail.entries()) {
      if (players.length > 1) {
        const alreadyCovered = out.some(
          (g) =>
            g.matchOn === "mobile" &&
            players.every((p) => g.players.some((gp) => gp.id === p.id)),
        );
        if (!alreadyCovered) out.push({ key, matchOn: "email", players });
      }
    }
    return out;
  }, [store.players]);

  const getTotals = (playerId: string) => {
    let paidCount = 0;
    let unpaidCount = 0;
    let unpaidAmount = 0;
    for (const pay of store.payments) {
      if (pay.playerId !== playerId) continue;
      if (pay.status === "Paid") paidCount++;
      if (pay.status === "Unpaid") {
        unpaidCount++;
        const m = store.matches.find((mm) => mm.id === pay.matchId);
        unpaidAmount += m?.fee || 0;
      }
    }
    for (const fee of store.otherFees) {
      if (fee.playerId !== playerId) continue;
      if (fee.status === "Paid") paidCount++;
      if (fee.status === "Unpaid") {
        unpaidCount++;
        unpaidAmount += fee.amount || 0;
      }
    }
    return { paidCount, unpaidCount, unpaidAmount };
  };

  const handleMerge = async (
    groupKey: string,
    keeperId: string,
    losers: Player[],
    keeperName: string,
  ) => {
    if (!keeperId || losers.length === 0) return;
    const loserNames = losers.map((l) => l.name).join(", ");
    if (
      !window.confirm(
        `Merge ${loserNames} into ${keeperName}?\n\n` +
          `• Every match payment and Other Fee owned by the merged profile(s) will be reassigned to ${keeperName}.\n` +
          `• Shop orders will move too.\n` +
          `• Merged profile(s) will be moved to Trash (they can be restored from the Squad list if needed).\n` +
          `• Empty fields on ${keeperName} will be filled in from the merged profiles; existing values are kept.\n` +
          `• ${keeperName}'s mobile will be normalized to +91XXXXXXXXXX.\n\n` +
          `This cannot be automatically undone. Continue?`,
      )
    )
      return;

    setMergingGroup(groupKey);
    try {
      for (const loser of losers) {
        await store.mergePlayer(loser.id, keeperId);
      }
      alert("Merge complete.");
    } catch (err: any) {
      console.error("Merge failed", err);
      // Surface the real reason (permission denied, missing index, etc.)
      // — a generic "check console" is useless on mobile / prod.
      const msg =
        err?.code
          ? `Merge failed [${err.code}]: ${err.message || "unknown error"}`
          : `Merge failed: ${err?.message || String(err)}`;
      alert(msg);
    } finally {
      setMergingGroup(null);
    }
  };

  if (groups.length === 0) return null;

  return (
    <div className="glass rounded-xl border border-amber-500/30 p-4 mb-4">
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="flex w-full items-center justify-between text-white/90 hover:text-white"
      >
        <span className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-amber-400">
          <AlertTriangle className="h-4 w-4" />
          Possible duplicate profiles ({groups.length})
        </span>
        {isCollapsed ? (
          <ChevronRight className="h-5 w-5" />
        ) : (
          <ChevronDown className="h-5 w-5" />
        )}
      </button>

      {!isCollapsed && (
        <div className="mt-4 space-y-4">
          <p className="text-[11px] text-white/50 leading-relaxed">
            These profiles share the same mobile number or email. Pick the
            profile you want to keep, then click Merge — every match
            payment, Other Fee, and shop order tied to the other row(s)
            will move to the keeper and the losers go to Trash.
          </p>

          {groups.map((g) => {
            const groupKey = `${g.matchOn}-${g.key}`;
            const selectedKeeperId = keeperByGroup[groupKey];
            const keeper = g.players.find((p) => p.id === selectedKeeperId);
            const losers = g.players.filter((p) => p.id !== selectedKeeperId);
            const isMerging = mergingGroup === groupKey;
            return (
              <div
                key={groupKey}
                className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3"
              >
                <div className="flex items-center gap-2 mb-2 text-[10px] font-bold uppercase tracking-widest text-amber-400/80">
                  Shared {g.matchOn}:
                  <span className="text-amber-300 font-mono normal-case">{g.key}</span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(g.key);
                    }}
                    className="ml-1 p-0.5 hover:bg-white/10 rounded"
                    title="Copy value"
                  >
                    <Copy className="w-3 h-3" />
                  </button>
                </div>

                <div className="space-y-2">
                  {g.players.map((p) => {
                    const t = getTotals(p.id);
                    const isKeeper = selectedKeeperId === p.id;
                    return (
                      <label
                        key={p.id}
                        className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-md border px-3 py-2 cursor-pointer transition ${
                          isKeeper
                            ? "border-emerald-500/40 bg-emerald-500/10"
                            : "border-white/10 bg-black/30 hover:bg-white/5"
                        }`}
                      >
                        <div className="flex items-start gap-2 min-w-0">
                          <input
                            type="radio"
                            name={`keeper-${groupKey}`}
                            className="mt-1 accent-emerald-500 cursor-pointer"
                            checked={isKeeper}
                            onChange={() =>
                              setKeeperByGroup((prev) => ({
                                ...prev,
                                [groupKey]: p.id,
                              }))
                            }
                            disabled={isMerging}
                          />
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-white truncate">
                              {p.name}
                              {p.disabled && (
                                <span className="ml-2 text-[9px] font-bold uppercase tracking-widest text-red-400">
                                  Trashed
                                </span>
                              )}
                              {isKeeper && (
                                <span className="ml-2 text-[9px] font-bold uppercase tracking-widest text-emerald-400">
                                  Keeper
                                </span>
                              )}
                            </p>
                            <p className="text-[11px] text-white/50 truncate">
                              <span className="font-mono">{p.mobile || "—"}</span>
                              {p.email && (
                                <>
                                  <span className="mx-1.5 text-white/30">·</span>
                                  <span>{p.email}</span>
                                </>
                              )}
                            </p>
                            <p className="text-[10px] text-white/40 font-mono truncate mt-0.5">
                              {p.id}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 text-[10px]">
                          <span className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-bold uppercase tracking-wider">
                            Paid: {t.paidCount}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-red-500/10 border border-red-500/20 text-red-400 font-bold uppercase tracking-wider">
                            Unpaid: {t.unpaidCount}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-white/5 border border-white/10 text-white/70 font-bold uppercase tracking-wider flex items-center gap-1">
                            <IndianRupee className="w-2.5 h-2.5" />
                            {t.unpaidAmount}
                          </span>
                        </div>
                      </label>
                    );
                  })}
                </div>

                <div className="flex justify-end mt-3">
                  <button
                    disabled={!keeper || losers.length === 0 || isMerging}
                    onClick={() =>
                      keeper &&
                      handleMerge(groupKey, keeper.id, losers, keeper.name)
                    }
                    className="rounded-lg bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold uppercase tracking-widest px-4 py-2 disabled:opacity-40 disabled:cursor-not-allowed transition"
                  >
                    {isMerging
                      ? "Merging..."
                      : keeper
                        ? `Merge ${losers.length} into ${keeper.name}`
                        : "Pick keeper to merge"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
