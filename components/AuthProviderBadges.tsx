"use client";

import { Smartphone, Mail, Shield, Ghost, KeyRound } from "lucide-react";

/**
 * Renders one badge per Firebase Auth provider linked to a user.
 * Feed it an array of providerId strings (e.g. from appUsers.authProviders
 * or user.providerData.map(p => p.providerId)).
 */
const PROVIDER_META: Record<
  string,
  { label: string; Icon: React.ComponentType<{ className?: string }>; cls: string }
> = {
  "google.com": {
    label: "Google",
    Icon: Mail,
    cls: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  },
  phone: {
    label: "Mobile OTP",
    Icon: Smartphone,
    cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  },
  password: {
    label: "Email + Password",
    Icon: KeyRound,
    cls: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  },
  anonymous: {
    label: "Guest",
    Icon: Ghost,
    cls: "bg-white/10 text-white/50 border-white/10",
  },
  "apple.com": {
    label: "Apple",
    Icon: Shield,
    cls: "bg-white/15 text-white/70 border-white/20",
  },
};

export function AuthProviderBadges({
  providers,
  size = "sm",
  emptyLabel = "Not signed in yet",
}: {
  providers?: string[] | null;
  size?: "sm" | "xs";
  emptyLabel?: string;
}) {
  const list = (providers || []).filter(Boolean);
  if (list.length === 0) {
    return (
      <span className="text-[10px] text-white/40 italic">{emptyLabel}</span>
    );
  }
  const iconCls = size === "xs" ? "w-3 h-3" : "w-3.5 h-3.5";
  const pillCls =
    size === "xs"
      ? "px-1.5 py-0.5 text-[9px] gap-1"
      : "px-2 py-0.5 text-[10px] gap-1.5";
  return (
    <div className="flex flex-wrap gap-1.5">
      {list.map((id) => {
        const meta =
          PROVIDER_META[id] ||
          ({
            label: id,
            Icon: Shield,
            cls: "bg-white/10 text-white/60 border-white/10",
          } as const);
        const { Icon } = meta;
        return (
          <span
            key={id}
            className={`inline-flex items-center rounded-full border font-bold uppercase tracking-wider whitespace-nowrap ${pillCls} ${meta.cls}`}
          >
            <Icon className={iconCls} />
            {meta.label}
          </span>
        );
      })}
    </div>
  );
}
