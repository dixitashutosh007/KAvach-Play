"use client";

import { Smartphone, Mail, Shield, Ghost, KeyRound, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

/**
 * Renders one badge per Firebase Auth provider linked to a user.
 * Optionally shows "first linked" timestamps under each badge and a
 * "last sign-in" footer line when the caller passes them in.
 *
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

function timeAgo(iso: string | undefined): string | null {
  if (!iso) return null;
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return null;
  }
}

export function AuthProviderBadges({
  providers,
  firstLinkedAt,
  lastLoginAt,
  size = "sm",
  emptyLabel = "Not signed in yet",
  showTimestamps = false,
}: {
  providers?: string[] | null;
  firstLinkedAt?: Record<string, string> | null;
  lastLoginAt?: string | null;
  size?: "sm" | "xs";
  emptyLabel?: string;
  showTimestamps?: boolean;
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
    <div className="space-y-1.5">
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

      {showTimestamps && (firstLinkedAt || lastLoginAt) && (
        <div className="space-y-0.5 text-[10px] text-white/40 leading-tight">
          {list.map((id) => {
            const label = PROVIDER_META[id]?.label || id;
            const rel = timeAgo(firstLinkedAt?.[id]);
            if (!rel) return null;
            return (
              <div key={`ts-${id}`} className="flex items-center gap-1">
                <span className="text-white/50">{label}:</span>
                <span>linked {rel}</span>
              </div>
            );
          })}
          {lastLoginAt && (
            <div className="flex items-center gap-1 pt-0.5">
              <Clock className="w-2.5 h-2.5" />
              <span>Last sign-in {timeAgo(lastLoginAt)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
