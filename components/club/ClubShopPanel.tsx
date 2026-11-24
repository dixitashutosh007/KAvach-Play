"use client";

/**
 * Admin Club → Club Shop management (`components/club/ClubShopPanel.tsx`).
 *
 * The single control point for the Shop (Club Menu → Club Shop):
 *  - Enable / disable the Shop for players — POST /api/admin/shop, which flips the
 *    EXISTING appConfig/default.features.shop flag (Club/Super Admin, audited).
 *  - Manage Products / Manage Orders / Activity & Reports — the existing ShopTab
 *    admin views, opened directly.
 *  - View Shop (as player) — the existing catalogue.
 * Always available to Club/Super Admins, whether the Shop is enabled or not.
 * Disabling never deletes products, cancels orders or touches payments.
 */
import { useEffect, useRef, useState } from "react";
import { ShoppingBag, Package, ClipboardList, BarChart3, Eye, Loader2 } from "lucide-react";
import type { useStore } from "@/hooks/useStore";
import { authedFetch } from "@/lib/authed-fetch";
import { isShopEnabled } from "@/lib/shop-config";
import { useToast } from "@/components/ui/Toast";

export type ShopAdminView = "store" | "products" | "orders" | "reports";

function apiFetch(url: string, init: RequestInit) {
  const synthetic = process.env.NODE_ENV !== "production" && typeof window !== "undefined" && (window as any).__KAVACH_TEST_USER__ !== undefined;
  return synthetic ? fetch(url, init) : authedFetch(url, init);
}

export function ClubShopPanel({ store, active, onOpen }: { store: ReturnType<typeof useStore>; active?: ShopAdminView | null; onOpen: (view: ShopAdminView) => void }) {
  const { toast } = useToast();
  const serverEnabled = isShopEnabled(store.appConfig);
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const enabled = optimistic ?? serverEnabled;
  // Drop the local value once the store's config reflects the confirmed change.
  useEffect(() => {
    if (optimistic !== null && optimistic === serverEnabled) setOptimistic(null);
  }, [optimistic, serverEnabled]);
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);

  const products = store.merchandises?.length ?? 0;
  const orders = store.merchOrders ?? [];
  const newOrders = orders.filter((o) => o.orderStatus === "Order Placed").length;
  const openOrders = orders.filter((o) => o.orderStatus !== "Fulfilled").length;

  const toggle = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    const next = !enabled;
    setSaving(true);
    setOptimistic(next);
    try {
      const res = await apiFetch("/api/admin/shop", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: next }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not change the Shop setting.");
      // Server confirmed: keep the confirmed value shown until the refreshed config
      // arrives (background refresh — the switch never waits on it).
      void store.refreshAppConfig?.();
      toast(next ? "Club Shop enabled — players can browse and order." : "Club Shop disabled — hidden from players; orders and products are kept.", "success");
    } catch (e) {
      setOptimistic(null);
      toast(e instanceof Error ? e.message : "Could not change the Shop setting.", "error");
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  const actions: { id: ShopAdminView; label: string; sub?: string; icon: typeof Package; dot?: boolean }[] = [
    { id: "products", label: "Products", sub: `${products}`, icon: Package },
    { id: "orders", label: "Orders", sub: newOrders ? `${newOrders} new` : `${openOrders} open`, icon: ClipboardList, dot: newOrders > 0 },
    { id: "reports", label: "Activity & Reports", icon: BarChart3 },
    { id: "store", label: "View Shop", sub: "as player", icon: Eye },
  ];

  return (
    <section className="rounded-2xl border border-scarlet/30 bg-surface overflow-hidden" data-testid="club-shop-panel" aria-label="Club Shop management">
      <div className="p-4 flex items-start gap-4">
        <span className="w-14 h-14 rounded-2xl bg-brand-surface flex items-center justify-center shrink-0">
          <ShoppingBag className="w-7 h-7 text-scarlet" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-black font-heading text-text-primary">Club Shop</h2>
            <span
              data-testid="club-shop-status"
              className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${enabled ? "bg-emerald-600 text-white" : "bg-surface-hover text-text-secondary border border-border"}`}
            >
              {enabled ? "Enabled" : "Disabled"}
            </span>
          </div>
          <p className="text-sm text-text-secondary">Manage products, orders and shop settings.</p>
        </div>
      </div>

      <div className="mx-4 mb-3 rounded-xl border border-border px-3 py-2.5 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-text-primary">Enable Shop (visible to players)</p>
          <p className="text-xs text-text-secondary">
            {enabled ? "Players can browse and place orders from Club." : "Hidden from players; new orders are blocked. Products and existing orders stay available here."}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Enable Club Shop for players"
          disabled={saving}
          onClick={toggle}
          data-testid="club-shop-toggle"
          className={`relative w-14 h-8 rounded-full transition shrink-0 cursor-pointer disabled:opacity-60 ${enabled ? "bg-emerald-600" : "bg-border"}`}
        >
          <span className={`absolute top-1 w-6 h-6 rounded-full bg-white shadow transition-all flex items-center justify-center ${enabled ? "left-7" : "left-1"}`}>
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin text-text-secondary" />}
          </span>
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 border-t border-border">
        {actions.map(({ id, label, sub, icon: Icon, dot }) => (
          <button
            key={id}
            type="button"
            onClick={() => onOpen(id)}
            data-testid={`club-shop-action-${id}`}
            aria-pressed={active === id}
            className={`relative min-h-[72px] flex flex-col items-center justify-center gap-1 px-2 py-2 border-border [&:not(:last-child)]:border-r max-sm:[&:nth-child(2)]:border-r-0 max-sm:[&:nth-child(-n+2)]:border-b cursor-pointer transition ${active === id ? "bg-brand-surface/60" : "hover:bg-surface-hover"}`}
          >
            <span className="relative">
              <Icon className="w-5 h-5 text-text-primary" aria-hidden="true" />
              {dot && <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-scarlet" aria-hidden="true" />}
            </span>
            <span className="text-xs font-bold text-text-primary text-center leading-tight">{label}</span>
            {sub && <span className="text-[11px] text-text-secondary leading-none">{sub}</span>}
          </button>
        ))}
      </div>
    </section>
  );
}
