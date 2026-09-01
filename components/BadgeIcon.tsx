import { BadgeType, BadgeTier, Badge, BadgeTypeDef } from "@/lib/types";
import { useState } from "react";

export type BadgeMeta = { label: string; short: string; tier: BadgeTier; emoji: string; stackable: boolean };

export const DEFAULT_BADGE_DEFS: Record<string, BadgeMeta> = {
  year_1:      { label: "1 Year with KAvach",        short: "1 Year",     tier: "bronze",  emoji: "1",   stackable: false },
  year_2:      { label: "2 Years with KAvach",       short: "2 Years",    tier: "bronze",  emoji: "2",   stackable: false },
  year_3:      { label: "3 Years with KAvach",       short: "3 Years",    tier: "silver",  emoji: "3",   stackable: false },
  year_4:      { label: "4 Years with KAvach",       short: "4 Years",    tier: "silver",  emoji: "4",   stackable: false },
  year_5:      { label: "5 Years with KAvach",       short: "5 Years",    tier: "gold",    emoji: "5",   stackable: false },
  original:    { label: "KAvach Original",            short: "Original",   tier: "gold",    emoji: "OG",  stackable: false },
  core:        { label: "KAvach Core",                short: "Core",       tier: "gold",    emoji: "★",   stackable: false },
  elite:       { label: "KAvach Elite",               short: "Elite",      tier: "diamond", emoji: "♛",   stackable: false },
  centurion:   { label: "KAvach Centurion",           short: "Centurion",  tier: "diamond", emoji: "💯",  stackable: true },
  hattrick:    { label: "KAvach Hattrick",            short: "Hattrick",   tier: "diamond", emoji: "🎯",  stackable: true },
  "5wh":       { label: "KAvach 5 Wicket Haul",      short: "5WH",        tier: "diamond", emoji: "🔥",  stackable: true },
  runs_2k:     { label: "KAvach 2K Run Club",         short: "2K Runs",    tier: "silver",  emoji: "2K",  stackable: false },
  runs_5k:     { label: "KAvach 5K Run Club",         short: "5K Runs",    tier: "gold",    emoji: "5K",  stackable: false },
  runs_10k:    { label: "KAvach 10K Run Club",        short: "10K Runs",   tier: "diamond", emoji: "10K", stackable: false },
  wickets_100: { label: "KAvach 100 Wicket Club",     short: "100 Wkts",   tier: "silver",  emoji: "100", stackable: false },
  wickets_200: { label: "KAvach 200 Wicket Club",     short: "200 Wkts",   tier: "gold",    emoji: "200", stackable: false },
  wickets_300: { label: "KAvach 300 Wicket Club",     short: "300 Wkts",   tier: "gold",    emoji: "300", stackable: false },
  wickets_500: { label: "KAvach 500 Wicket Club",     short: "500 Wkts",   tier: "diamond", emoji: "500", stackable: false },
};

const FALLBACK_META: BadgeMeta = { label: "Badge", short: "Badge", tier: "bronze", emoji: "?", stackable: false };

export const TIER_COLORS: Record<BadgeTier, { bg: string; border: string; text: string; glow: string }> = {
  bronze:  { bg: "#CD7F32", border: "#A0522D", text: "#FFF8E7", glow: "rgba(205,127,50,0.4)" },
  silver:  { bg: "#C0C0C0", border: "#808080", text: "#1a1a1a", glow: "rgba(192,192,192,0.4)" },
  gold:    { bg: "#FFD700", border: "#DAA520", text: "#1a1a1a", glow: "rgba(255,215,0,0.4)" },
  diamond: { bg: "#B9F2FF", border: "#00CED1", text: "#003333", glow: "rgba(0,206,209,0.5)" },
};

export function buildBadgeMetaMap(customDefs: BadgeTypeDef[]): Record<string, BadgeMeta> {
  const map: Record<string, BadgeMeta> = { ...DEFAULT_BADGE_DEFS };
  for (const def of customDefs) {
    map[def.id] = { label: def.label, short: def.short, tier: def.tier, emoji: def.emoji, stackable: def.stackable };
  }
  return map;
}

export function getAllBadgeTypes(customDefs: BadgeTypeDef[]): string[] {
  const metaMap = buildBadgeMetaMap(customDefs);
  const defaultKeys = Object.keys(DEFAULT_BADGE_DEFS);
  const customKeys = customDefs.map(d => d.id).filter(k => !DEFAULT_BADGE_DEFS[k]);
  customKeys.sort((a, b) => {
    const aOrder = customDefs.find(d => d.id === a)?.order ?? 999;
    const bOrder = customDefs.find(d => d.id === b)?.order ?? 999;
    return aOrder - bOrder;
  });
  return [...defaultKeys, ...customKeys];
}

export function getStackableSet(customDefs: BadgeTypeDef[]): Set<string> {
  const metaMap = buildBadgeMetaMap(customDefs);
  return new Set(Object.entries(metaMap).filter(([_, m]) => m.stackable).map(([k]) => k));
}

export function getBadgeMeta(badgeType: BadgeType, customDefs?: BadgeTypeDef[]): BadgeMeta {
  if (customDefs?.length) {
    const custom = customDefs.find(d => d.id === badgeType);
    if (custom) return { label: custom.label, short: custom.short, tier: custom.tier, emoji: custom.emoji, stackable: custom.stackable };
  }
  return DEFAULT_BADGE_DEFS[badgeType] || FALLBACK_META;
}

export function getBadgeTierColors(tier: BadgeTier) {
  return TIER_COLORS[tier];
}

export function BadgeIcon({
  badgeType,
  size = 48,
  count,
  className,
  customDefs,
}: {
  badgeType: BadgeType;
  size?: number;
  count?: number;
  className?: string;
  customDefs?: BadgeTypeDef[];
}) {
  const meta = getBadgeMeta(badgeType, customDefs);
  const colors = TIER_COLORS[meta.tier];
  const r = size / 2;
  const textSize = meta.emoji.length > 2 ? size * 0.22 : size * 0.32;

  return (
    <div className={className} style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <radialGradient id={`bg-${badgeType}-${size}`} cx="35%" cy="30%">
            <stop offset="0%" stopColor={colors.bg} stopOpacity="1" />
            <stop offset="100%" stopColor={colors.border} stopOpacity="1" />
          </radialGradient>
          <filter id={`glow-${badgeType}-${size}`}>
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <path
          d={`M ${r} ${size * 0.05}
              L ${size * 0.92} ${size * 0.2}
              L ${size * 0.92} ${size * 0.55}
              Q ${size * 0.92} ${size * 0.82} ${r} ${size * 0.97}
              Q ${size * 0.08} ${size * 0.82} ${size * 0.08} ${size * 0.55}
              L ${size * 0.08} ${size * 0.2}
              Z`}
          fill={`url(#bg-${badgeType}-${size})`}
          stroke={colors.border}
          strokeWidth={size * 0.04}
          filter={`url(#glow-${badgeType}-${size})`}
        />

        <path
          d={`M ${r} ${size * 0.12}
              L ${size * 0.85} ${size * 0.24}
              L ${size * 0.85} ${size * 0.54}
              Q ${size * 0.85} ${size * 0.76} ${r} ${size * 0.9}
              Q ${size * 0.15} ${size * 0.76} ${size * 0.15} ${size * 0.54}
              L ${size * 0.15} ${size * 0.24}
              Z`}
          fill="none"
          stroke={colors.text}
          strokeWidth={size * 0.015}
          opacity={0.3}
        />

        <text
          x={r}
          y={r * 1.12}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={textSize}
          fontWeight="900"
          fill={colors.text}
          fontFamily="system-ui, -apple-system, sans-serif"
        >
          {meta.emoji}
        </text>
      </svg>

      {count && count > 1 && (
        <span
          className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center"
          style={{ width: size * 0.4, height: size * 0.4, minWidth: 16, minHeight: 16 }}
        >
          x{count}
        </span>
      )}
    </div>
  );
}

export function BadgeCard({
  badgeType,
  count,
  showLabel = true,
  customDefs,
}: {
  badgeType: BadgeType;
  count?: number;
  showLabel?: boolean;
  customDefs?: BadgeTypeDef[];
}) {
  const meta = getBadgeMeta(badgeType, customDefs);
  const colors = TIER_COLORS[meta.tier];

  return (
    <div
      className="flex flex-col items-center gap-1 p-2 rounded-lg border transition hover:scale-105"
      style={{
        borderColor: colors.border + "40",
        background: colors.bg + "10",
      }}
    >
      <BadgeIcon badgeType={badgeType} size={40} count={count} customDefs={customDefs} />
      {showLabel && (
        <span className="text-[9px] font-bold text-white/70 text-center leading-tight">
          {meta.short}
        </span>
      )}
    </div>
  );
}

export function PlayerBadgeRow({
  playerId,
  badges,
  customDefs,
}: {
  playerId: string;
  badges: Badge[];
  customDefs?: BadgeTypeDef[];
}) {
  const playerBadges = badges.filter((b) => b.playerId === playerId);
  if (!playerBadges.length) return null;

  const stackable = getStackableSet(customDefs || []);

  const grouped = new Map<BadgeType, Badge[]>();
  playerBadges.forEach((b) => {
    const arr = grouped.get(b.badgeType) || [];
    arr.push(b);
    grouped.set(b.badgeType, arr);
  });

  return (
    <div className="flex gap-1.5 flex-wrap">
      {Array.from(grouped.entries()).map(([badgeType, bList]) => (
        <BadgeIcon
          key={badgeType}
          badgeType={badgeType}
          size={28}
          count={stackable.has(badgeType) ? bList.length : undefined}
          customDefs={customDefs}
        />
      ))}
    </div>
  );
}

function renderBadgeToCanvas(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, meta: BadgeMeta) {
  const colors = TIER_COLORS[meta.tier];
  const size = r * 2;
  ctx.save();
  ctx.translate(cx - r, cy - r);

  ctx.shadowColor = colors.glow;
  ctx.shadowBlur = r * 0.5;

  ctx.beginPath();
  ctx.moveTo(r, size * 0.05);
  ctx.lineTo(size * 0.92, size * 0.2);
  ctx.lineTo(size * 0.92, size * 0.55);
  ctx.quadraticCurveTo(size * 0.92, size * 0.82, r, size * 0.97);
  ctx.quadraticCurveTo(size * 0.08, size * 0.82, size * 0.08, size * 0.55);
  ctx.lineTo(size * 0.08, size * 0.2);
  ctx.closePath();

  const grad = ctx.createRadialGradient(size * 0.35, size * 0.3, 0, r, r, r);
  grad.addColorStop(0, colors.bg);
  grad.addColorStop(1, colors.border);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = colors.border;
  ctx.lineWidth = size * 0.04;
  ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.beginPath();
  ctx.moveTo(r, size * 0.12);
  ctx.lineTo(size * 0.85, size * 0.24);
  ctx.lineTo(size * 0.85, size * 0.54);
  ctx.quadraticCurveTo(size * 0.85, size * 0.76, r, size * 0.9);
  ctx.quadraticCurveTo(size * 0.15, size * 0.76, size * 0.15, size * 0.54);
  ctx.lineTo(size * 0.15, size * 0.24);
  ctx.closePath();
  ctx.strokeStyle = colors.text + "4D";
  ctx.lineWidth = size * 0.015;
  ctx.stroke();

  const textSize = meta.emoji.length > 2 ? size * 0.22 : size * 0.32;
  ctx.fillStyle = colors.text;
  ctx.font = `900 ${textSize}px system-ui, -apple-system, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(meta.emoji, r, r * 1.12);
  ctx.restore();
}

const LOGO_URL = "/kavach-logo.png";
let _logoCache: HTMLImageElement | null = null;
function loadLogo(): Promise<HTMLImageElement> {
  if (_logoCache) return Promise.resolve(_logoCache);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => { _logoCache = img; resolve(img); };
    img.onerror = reject;
    img.src = LOGO_URL;
  });
}

export async function generateBadgeShareImage(badge: Badge, meta: BadgeMeta): Promise<{ blob: Blob | null; caption: string }> {
  const colors = TIER_COLORS[meta.tier];
  const awardDate = badge.awardedAt?.toDate?.() ? badge.awardedAt.toDate() : new Date();
  const dateStr = awardDate.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const caption = `${badge.playerName} earned the "${meta.label}" badge at KAvach Play!\n\n#KAvachPlay #CricketBadge #${meta.label.replace(/\s+/g, "")} #Cricket #BadgeUnlocked`;

  const W = 1080, H = 1080;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { blob: null, caption };

  const bgGrad = ctx.createLinearGradient(0, 0, W, H);
  bgGrad.addColorStop(0, "#022c22");
  bgGrad.addColorStop(0.5, "#0a0a1a");
  bgGrad.addColorStop(1, "#0f172a");
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  for (let i = 0; i < 60; i++) {
    ctx.beginPath();
    ctx.arc(Math.random() * W, Math.random() * H, Math.random() * 1.5 + 0.5, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.15 + 0.05})`;
    ctx.fill();
  }

  ctx.strokeStyle = colors.border + "40";
  ctx.lineWidth = 3;
  const inset = 30, cr = 20;
  ctx.beginPath();
  ctx.moveTo(inset + cr, inset);
  ctx.lineTo(W - inset - cr, inset);
  ctx.quadraticCurveTo(W - inset, inset, W - inset, inset + cr);
  ctx.lineTo(W - inset, H - inset - cr);
  ctx.quadraticCurveTo(W - inset, H - inset, W - inset - cr, H - inset);
  ctx.lineTo(inset + cr, H - inset);
  ctx.quadraticCurveTo(inset, H - inset, inset, H - inset - cr);
  ctx.lineTo(inset, inset + cr);
  ctx.quadraticCurveTo(inset, inset, inset + cr, inset);
  ctx.closePath();
  ctx.stroke();

  try {
    const logo = await loadLogo();
    const logoH = 150;
    const logoW = logoH * (logo.naturalWidth / logo.naturalHeight);
    ctx.drawImage(logo, (W - logoW) / 2, 35, logoW, logoH);
  } catch {}

  const accent = "rgb(52, 211, 153)";
  ctx.fillStyle = accent;
  ctx.font = "bold 14px system-ui, -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.letterSpacing = "4px";
  ctx.fillText("P L A Y", W / 2, 205);
  ctx.letterSpacing = "0px";

  ctx.strokeStyle = accent + "60";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(W * 0.3, 222);
  ctx.lineTo(W * 0.7, 222);
  ctx.stroke();

  renderBadgeToCanvas(ctx, W / 2, 400, 160, meta);

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 44px system-ui, -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(meta.label, W / 2, 630);

  ctx.strokeStyle = "rgba(255,255,255,0.1)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(W * 0.3, 665);
  ctx.lineTo(W * 0.7, 665);
  ctx.stroke();

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 32px system-ui, -apple-system, sans-serif";
  ctx.fillText(badge.playerName, W / 2, 720);

  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.font = "500 22px system-ui, -apple-system, sans-serif";
  ctx.fillText(`Awarded on ${dateStr}`, W / 2, 765);

  if (badge.note) {
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.font = "italic 18px system-ui, -apple-system, sans-serif";
    ctx.fillText(`"${badge.note}"`, W / 2, 820);
  }

  ctx.save();
  ctx.translate(W - 55, H / 2);
  ctx.rotate(Math.PI / 2);
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.font = "900 40px system-ui, -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.letterSpacing = "12px";
  ctx.fillText("GO GET THEM", 0, 0);
  ctx.letterSpacing = "0px";
  ctx.restore();

  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.font = "500 16px system-ui, -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("kavachplay.com", W / 2, H - 50);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  return { blob, caption };
}

export function BadgeShowcase({
  badge,
  customDefs,
  onClose,
}: {
  badge: Badge;
  customDefs?: BadgeTypeDef[];
  onClose: () => void;
}) {
  const [isSharing, setIsSharing] = useState(false);
  const meta = getBadgeMeta(badge.badgeType, customDefs);
  const colors = TIER_COLORS[meta.tier];
  const awardDate = badge.awardedAt?.toDate?.() ? badge.awardedAt.toDate() : new Date();
  const dateStr = awardDate.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

  const handleShare = async () => {
    setIsSharing(true);
    try {
      const { blob, caption } = await generateBadgeShareImage(badge, meta);
      if (navigator.share && blob) {
        const file = new File([blob], "kavach-badge.png", { type: "image/png" });
        await navigator.share({ text: caption, files: [file] });
      } else if (navigator.share) {
        await navigator.share({ text: caption });
      } else {
        const caption2 = `${badge.playerName} earned the "${meta.label}" badge at KAvach Play!\n\n#KAvachPlay #CricketBadge #Cricket`;
        await navigator.clipboard?.writeText(caption2);
        alert("Badge info copied to clipboard!");
      }
    } catch {
      // user cancelled
    } finally {
      setIsSharing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/90 backdrop-blur-md" />
      <div
        className="relative w-full max-w-sm rounded-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "linear-gradient(160deg, #022c22 0%, #0a0a1a 50%, #0f172a 100%)",
        }}
      >
        {/* Decorative particles */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          {Array.from({ length: 20 }).map((_, i) => (
            <div
              key={i}
              className="absolute rounded-full"
              style={{
                width: Math.random() * 3 + 1,
                height: Math.random() * 3 + 1,
                left: `${Math.random() * 100}%`,
                top: `${Math.random() * 100}%`,
                background: `rgba(255,255,255,${Math.random() * 0.15 + 0.05})`,
              }}
            />
          ))}
        </div>

        {/* Border glow */}
        <div
          className="absolute inset-0 rounded-2xl pointer-events-none"
          style={{ boxShadow: `inset 0 0 0 1.5px ${colors.border}40, 0 0 40px ${colors.glow}` }}
        />

        <div className="relative z-10 flex flex-col items-center py-8 px-6">
          {/* KAvach logo */}
          <img src="/kavach-logo.png" alt="KAvach" className="h-20 w-auto object-contain" />
          <p className="text-accent text-[10px] font-bold tracking-[0.3em] uppercase mt-1 mb-1">
            Play
          </p>
          <div className="w-24 h-px bg-accent/40 mb-6" />

          {/* Large badge */}
          <div className="relative mb-6">
            <div
              className="absolute inset-0 rounded-full blur-3xl opacity-40"
              style={{ background: colors.bg, transform: "scale(1.5)" }}
            />
            <BadgeIcon badgeType={badge.badgeType} size={160} customDefs={customDefs} />
          </div>

          {/* Badge name */}
          <h2 className="text-white font-bold text-2xl text-center mb-1">
            {meta.label}
          </h2>

          {/* Divider */}
          <div className="w-32 h-px bg-white/10 mb-6" />

          {/* Player name */}
          <p className="text-white font-bold text-lg mb-1">
            {badge.playerName}
          </p>

          {/* Award date */}
          <p className="text-white/40 text-sm mb-1">
            Awarded on {dateStr}
          </p>

          {/* Note */}
          {badge.note && (
            <p className="text-white/30 text-xs italic mt-1 mb-2 text-center">
              &ldquo;{badge.note}&rdquo;
            </p>
          )}

          {/* Vertical text decoration */}
          <div
            className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none"
            style={{
              writingMode: "vertical-rl",
              color: "rgba(255,255,255,0.06)",
              fontSize: 20,
              fontWeight: 900,
              letterSpacing: "0.3em",
            }}
          >
            GO GET THEM
          </div>

          {/* Share button */}
          <button
            onClick={handleShare}
            disabled={isSharing}
            className="mt-6 flex items-center gap-2.5 bg-accent text-black font-bold py-3 px-8 rounded-full hover:brightness-110 transition disabled:opacity-50 text-sm"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
            </svg>
            {isSharing ? "Sharing..." : "Share on Social Media"}
          </button>

          {/* Close */}
          <button
            onClick={onClose}
            className="mt-4 text-white/30 text-xs hover:text-white/60 transition"
          >
            Tap anywhere to close
          </button>
        </div>
      </div>
    </div>
  );
}
