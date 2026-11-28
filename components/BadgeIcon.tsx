import { BadgeType, BadgeTier, Badge, BadgeTypeDef } from "@/lib/types";
import { useId, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import {
  BUILTIN_BADGE_CATALOG,
  normalizeBadgeTier,
  resolveStandardizedBadgeMeta,
  type StandardizedBadgeMeta,
} from "@/lib/badge-awarding";
import type { MilestoneProgress } from "@/lib/badge-milestones";
import { buildBadgeSvgString, METALLIC_TIER_PALETTES } from "./BadgeArtwork";

export type BadgeMeta = StandardizedBadgeMeta;

export const DEFAULT_BADGE_DEFS: Record<
  string,
  { label: string; short: string; tier: BadgeTier; emoji: string; stackable: boolean }
> = Object.fromEntries(
  Object.entries(BUILTIN_BADGE_CATALOG).map(([id, def]) => [
    id,
    { label: def.label, short: def.short, tier: def.tier, emoji: def.emoji, stackable: def.stackable },
  ]),
);

/**
 * Badges issued only by a dedicated server workflow (never from the manual
 * award picker): Player of the Weekend is granted once per weekend by
 * POST /api/admin/player-of-weekend together with its banner and notification.
 */
export const SYSTEM_AWARDED_BADGES: ReadonlySet<string> = new Set(["player_of_weekend"]);

export const TIER_COLORS: Record<BadgeTier, { bg: string; border: string; text: string; glow: string }> = {
  bronze:  { bg: "#CD7F32", border: "#A0522D", text: "#FFF8E7", glow: "rgba(205,127,50,0.4)" },
  silver:  { bg: "#C0C0C0", border: "#808080", text: "#1a1a1a", glow: "rgba(192,192,192,0.4)" },
  gold:    { bg: "#FFD700", border: "#DAA520", text: "#1a1a1a", glow: "rgba(255,215,0,0.4)" },
  diamond: { bg: "#B9F2FF", border: "#00CED1", text: "#003333", glow: "rgba(0,206,209,0.5)" },
};

export function buildBadgeMetaMap(customDefs: BadgeTypeDef[]): Record<string, BadgeMeta> {
  const map: Record<string, BadgeMeta> = {};
  for (const id of Object.keys(BUILTIN_BADGE_CATALOG)) {
    map[id] = resolveStandardizedBadgeMeta(id, customDefs);
  }
  for (const def of customDefs) {
    map[def.id] = resolveStandardizedBadgeMeta(def.id, customDefs);
  }
  return map;
}

export function getAllBadgeTypes(customDefs: BadgeTypeDef[]): string[] {
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
  return resolveStandardizedBadgeMeta(badgeType, customDefs);
}

export function getBadgeTierColors(tier?: BadgeTier | string) {
  return TIER_COLORS[normalizeBadgeTier(tier)];
}

export function BadgeIcon({
  badgeType,
  size = 48,
  count,
  className,
  customDefs,
  locked = false,
}: {
  badgeType: BadgeType;
  size?: number;
  count?: number;
  className?: string;
  customDefs?: BadgeTypeDef[];
  locked?: boolean;
}) {
  const uid = useId().replace(/:/g, "");
  if (badgeType === "player_of_weekend" && !locked) {
    return <PlayerOfWeekendBadgeSvg size={size} count={count} className={className} />;
  }
  const meta = getBadgeMeta(badgeType, customDefs);
  const svgMarkup = buildBadgeSvgString({
    badgeType,
    tier: meta.tier,
    emoji: meta.emoji,
    size,
    uid: `${badgeType}_${size}_${uid}`,
  });

  return (
    <div
      className={`${className || ""}${locked ? " opacity-45 grayscale" : ""}`}
      style={{ position: "relative", width: size, height: size, flexShrink: 0 }}
      aria-label={meta.label}
    >
      <div
        className="w-full h-full"
        style={{ filter: locked ? undefined : `drop-shadow(0 2px 6px ${METALLIC_TIER_PALETTES[meta.tier].glow})` }}
        dangerouslySetInnerHTML={{ __html: svgMarkup }}
      />

      {count && count > 1 && !locked && (
        <span
          className="absolute -top-1 -right-1 bg-[#D51F43] text-white text-[9px] font-bold rounded-full flex items-center justify-center shadow-sm"
          style={{ width: size * 0.4, height: size * 0.4, minWidth: 16, minHeight: 16 }}
        >
          x{count}
        </span>
      )}
    </div>
  );
}

/**
 * Player of the Weekend badge: scarlet shield, gold rim, gold trophy framed by
 * a laurel wreath with a small star — premium, readable at 24–96 px.
 */
export function PlayerOfWeekendBadgeSvg({ size = 48, count, className }: { size?: number; count?: number; className?: string }) {
  const uid = useId().replace(/:/g, "");
  const leaf = (x: number, y: number, rot: number) => (
    <ellipse key={`${x}-${y}`} cx={x} cy={y} rx="3.1" ry="1.5" transform={`rotate(${rot} ${x} ${y})`} fill={`url(#potw-gold-${uid})`} />
  );
  return (
    <div className={className} style={{ position: "relative", width: size, height: size, flexShrink: 0 }} data-testid="badge-potw-icon">
      <svg viewBox="0 0 64 64" width={size} height={size} xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Player of the Weekend badge">
        <defs>
          <linearGradient id={`potw-shield-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#D51F43" />
            <stop offset="100%" stopColor="#7A0B22" />
          </linearGradient>
          <linearGradient id={`potw-gold-${uid}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#F5D77A" />
            <stop offset="55%" stopColor="#D6A52B" />
            <stop offset="100%" stopColor="#A87C14" />
          </linearGradient>
        </defs>
        <path d="M32 3 L57 11 L57 33 Q57 52 32 61 Q7 52 7 33 L7 11 Z" fill={`url(#potw-shield-${uid})`} stroke={`url(#potw-gold-${uid})`} strokeWidth="3" />
        <path d="M32 8 L52 14.5 L52 33 Q52 48.5 32 56 Q12 48.5 12 33 L12 14.5 Z" fill="none" stroke="#F5D77A" strokeOpacity="0.35" strokeWidth="1" />
        {/* Laurel */}
        {[leaf(18.5, 40, -60), leaf(17, 35, -80), leaf(17.5, 30, -100), leaf(19.5, 25.5, -120), leaf(22.5, 44, -35)]}
        {[leaf(45.5, 40, 60), leaf(47, 35, 80), leaf(46.5, 30, 100), leaf(44.5, 25.5, 120), leaf(41.5, 44, 35)]}
        {/* Trophy */}
        <path d="M24 20 H40 V26 Q40 34 32 35.5 Q24 34 24 26 Z" fill={`url(#potw-gold-${uid})`} />
        <path d="M24 22 H20.5 Q20.5 29 25 30 M40 22 H43.5 Q43.5 29 39 30" fill="none" stroke="#D6A52B" strokeWidth="1.8" strokeLinecap="round" />
        <rect x="30.5" y="35" width="3" height="4.5" fill="#D6A52B" />
        <rect x="26" y="39.5" width="12" height="3.5" rx="1" fill={`url(#potw-gold-${uid})`} />
        {/* Star */}
        <path d="M32 11.5 l1.2 2.5 2.7 .4 -2 1.9 .5 2.7 -2.4 -1.3 -2.4 1.3 .5 -2.7 -2 -1.9 2.7 -.4 Z" fill="#F5D77A" />
        <path d="M29.5 23.5 l1.2 -.2 .6 -1.1 .6 1.1 1.2 .2 -.9 .8 .2 1.2 -1.1 -.6 -1.1 .6 .2 -1.2 Z" fill="#7A0B22" opacity="0.7" />
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
        <span className="text-[9px] font-bold text-text-secondary text-center leading-tight">
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

export type BadgeShareFormat = "square" | "portrait";

function loadSvgImage(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

export async function generateBadgeShareImage(
  badge: Badge,
  meta: BadgeMeta,
  format: BadgeShareFormat = "square",
): Promise<{ blob: Blob | null; caption: string; filename: string }> {
  const palette = METALLIC_TIER_PALETTES[meta.tier];
  const awardDate = badge.awardedAt?.toDate?.()
    ? badge.awardedAt.toDate()
    : typeof badge.awardedAt === "string" || typeof badge.awardedAt === "number"
      ? new Date(badge.awardedAt)
      : null;
  const dateStr =
    awardDate && !Number.isNaN(awardDate.getTime())
      ? awardDate.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
      : "Club Honour";
  const playerName = badge.playerName || "Player";
  const caption = `${playerName} earned the "${meta.label}" (${meta.tier.toUpperCase()}) badge at KAvach Play!\n\n#KAvachPlay #CricketBadge #${meta.label.replace(/\s+/g, "")} #Cricket`;
  const filename = `kavach-badge-${meta.id}-${format}.png`;

  const W = 1080;
  const H = format === "portrait" ? 1350 : 1080;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { blob: null, caption, filename };

  // Premium charcoal & KAvach scarlet sports-tech backdrop
  const bgGrad = ctx.createLinearGradient(0, 0, W, H);
  bgGrad.addColorStop(0, "#171C26");
  bgGrad.addColorStop(0.55, "#1E141B");
  bgGrad.addColorStop(1, "#11151D");
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  // Subtle top scarlet glow
  const glowGrad = ctx.createRadialGradient(W / 2, H * 0.36, 20, W / 2, H * 0.36, 420);
  glowGrad.addColorStop(0, palette.glow);
  glowGrad.addColorStop(0.5, "rgba(163, 15, 45, 0.16)");
  glowGrad.addColorStop(1, "rgba(23, 28, 38, 0)");
  ctx.fillStyle = glowGrad;
  ctx.fillRect(0, 0, W, H);

  // Crisp metallic outer frame
  ctx.strokeStyle = palette.rim;
  ctx.lineWidth = 4;
  const inset = 36;
  ctx.strokeRect(inset, inset, W - inset * 2, H - inset * 2);

  // Top scarlet bar
  ctx.fillStyle = "#A30F2D";
  ctx.fillRect(inset, inset, W - inset * 2, 10);

  // Club logo & wordmark
  try {
    const logo = await loadLogo();
    const logoH = format === "portrait" ? 132 : 112;
    const logoW = logoH * (logo.naturalWidth / logo.naturalHeight);
    ctx.drawImage(logo, (W - logoW) / 2, 74, logoW, logoH);
  } catch {}

  ctx.fillStyle = "#FCE8ED";
  ctx.font = "800 18px Inter, system-ui, -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("K A V A C H   P L A Y", W / 2, format === "portrait" ? 242 : 216);

  // Artwork from central registry
  const artSize = format === "portrait" ? 340 : 280;
  const artY = format === "portrait" ? 295 : 255;
  try {
    const svg = buildBadgeSvgString({
      badgeType: badge.badgeType,
      tier: meta.tier,
      emoji: meta.emoji,
      size: artSize,
      uid: "share",
    });
    const artImg = await loadSvgImage(svg);
    ctx.drawImage(artImg, (W - artSize) / 2, artY, artSize, artSize);
  } catch {
    renderBadgeToCanvas(ctx, W / 2, artY + artSize / 2, artSize / 2, meta);
  }

  // Tier pill
  const tierLabel = `${meta.tier.toUpperCase()} TIER`;
  const pillY = artY + artSize + (format === "portrait" ? 44 : 30);
  ctx.font = "800 18px Inter, system-ui, sans-serif";
  const pillW = Math.max(170, ctx.measureText(tierLabel).width + 48);
  ctx.fillStyle = palette.pillBg;
  ctx.beginPath();
  ctx.roundRect((W - pillW) / 2, pillY - 20, pillW, 40, 20);
  ctx.fill();
  ctx.fillStyle = palette.pillText;
  ctx.fillText(tierLabel, W / 2, pillY + 6);

  // Badge label
  const titleY = pillY + (format === "portrait" ? 86 : 70);
  ctx.fillStyle = "#FFFFFF";
  ctx.font = "900 48px Inter, system-ui, -apple-system, sans-serif";
  ctx.fillText(meta.label, W / 2, titleY);

  // Divider
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(W * 0.28, titleY + 34);
  ctx.lineTo(W * 0.72, titleY + 34);
  ctx.stroke();

  // Player name & award details
  const playerY = titleY + (format === "portrait" ? 105 : 86);
  ctx.fillStyle = "#FFFFFF";
  ctx.font = "800 38px Inter, system-ui, -apple-system, sans-serif";
  ctx.fillText(playerName, W / 2, playerY);

  ctx.fillStyle = "rgba(255,255,255,0.68)";
  ctx.font = "600 24px Inter, system-ui, -apple-system, sans-serif";
  ctx.fillText(`Awarded ${dateStr}`, W / 2, playerY + 46);

  if (badge.note) {
    ctx.fillStyle = "#FCE8ED";
    ctx.font = "italic 22px Inter, system-ui, -apple-system, sans-serif";
    ctx.fillText(`"${badge.note}"`, W / 2, playerY + 96);
  }

  // Footer
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.font = "600 18px Inter, system-ui, -apple-system, sans-serif";
  ctx.fillText("play.kavachcricket.com", W / 2, H - 64);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  return { blob, caption, filename };
}

export function BadgeShowcase({
  badge,
  lockedMeta,
  progress,
  customDefs,
  onClose,
}: {
  badge?: Badge | null;
  lockedMeta?: BadgeMeta | null;
  progress?: MilestoneProgress | null;
  customDefs?: BadgeTypeDef[];
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [isSharing, setIsSharing] = useState(false);
  const [shareFormat, setShareFormat] = useState<BadgeShareFormat>("square");
  const isLocked = !badge;
  const meta = badge ? getBadgeMeta(badge.badgeType, customDefs) : (lockedMeta || getBadgeMeta("unknown", customDefs));
  const palette = METALLIC_TIER_PALETTES[meta.tier];

  const awardDate = badge?.awardedAt?.toDate?.()
    ? badge.awardedAt.toDate()
    : typeof badge?.awardedAt === "string" || typeof badge?.awardedAt === "number"
      ? new Date(badge.awardedAt)
      : null;
  const dateStr =
    awardDate && !Number.isNaN(awardDate.getTime())
      ? awardDate.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
      : null;
  const playerDisplayName = badge?.playerName || "Player";

  const triggerDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleShare = async () => {
    if (!badge) return;
    setIsSharing(true);
    try {
      const { blob, caption, filename } = await generateBadgeShareImage(badge, meta, shareFormat);
      if (navigator.share && blob) {
        const file = new File([blob], filename, { type: "image/png" });
        await navigator.share({ text: caption, files: [file] });
      } else if (blob) {
        triggerDownload(blob, filename);
        await navigator.clipboard?.writeText(caption).catch(() => {});
        toast("Badge card downloaded & caption copied!", "success");
      } else {
        await navigator.clipboard?.writeText(caption);
        toast("Badge info copied to clipboard!", "success");
      }
    } catch {
      // user cancelled
    } finally {
      setIsSharing(false);
    }
  };

  const handleDownload = async () => {
    if (!badge) return;
    setIsSharing(true);
    try {
      const { blob, filename } = await generateBadgeShareImage(badge, meta, shareFormat);
      if (blob) {
        triggerDownload(blob, filename);
        toast("Badge image downloaded!", "success");
      }
    } finally {
      setIsSharing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" onClick={onClose} data-testid="badge-detail-modal">
      <div className="absolute inset-0 bg-[#171C26]/70 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-sm rounded-2xl bg-[#FFFFFF] border border-[#E5E7EB] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-2 bg-[#A30F2D] w-full" />
        <div className="p-6 flex flex-col items-center text-center">
          <div className="flex items-center gap-2 mb-4">
            <span
              className="text-[11px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full"
              style={{ background: palette.pillBg, color: palette.pillText }}
            >
              {meta.tier} tier
            </span>
            <span className="text-[11px] font-semibold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-[#F6F7F9] text-[#667085] border border-[#E5E7EB]">
              {meta.category}
            </span>
            {!meta.active && (
              <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                Archived
              </span>
            )}
          </div>

          <div className="mb-4">
            <BadgeIcon badgeType={meta.id} size={120} customDefs={customDefs} locked={isLocked} />
          </div>

          <h2 className="text-xl font-black text-[#171C26] mb-1">{meta.label}</h2>
          {meta.description && (
            <p className="text-sm text-[#667085] mb-2">{meta.description}</p>
          )}
          {meta.criteria && (
            <p className="text-xs font-semibold text-[#A30F2D] bg-[#FCE8ED] px-3 py-1 rounded-full mb-4">
              {meta.criteria}
            </p>
          )}

          {badge ? (
            <div className="w-full rounded-xl bg-[#F6F7F9] border border-[#E5E7EB] p-3 mb-4 space-y-1">
              <p className="text-sm font-bold text-[#171C26]">{playerDisplayName}</p>
              <p className="text-xs text-[#667085]">{dateStr ? `Awarded on ${dateStr}` : "Historical award"}</p>
              {badge.note && (
                <p className="text-xs italic text-[#667085] pt-1">&ldquo;{badge.note}&rdquo;</p>
              )}
            </div>
          ) : progress ? (
            <div className="w-full rounded-xl bg-[#F6F7F9] border border-[#E5E7EB] p-3 mb-4 text-left" data-testid="badge-locked-progress">
              <div className="flex items-center justify-between text-xs font-semibold text-[#171C26] mb-1.5">
                <span>Progress</span>
                <span>{progress.current.toLocaleString()} / {progress.target.toLocaleString()} {progress.unit} ({progress.percent}%)</span>
              </div>
              <div className="w-full h-2 rounded-full bg-[#E5E7EB] overflow-hidden">
                <div className="h-full rounded-full bg-[#D51F43]" style={{ width: `${progress.percent}%` }} />
              </div>
            </div>
          ) : (
            <p className="text-xs text-[#667085] mb-4">Locked — complete the criteria above to unlock.</p>
          )}

          {badge && (
            <div className="w-full space-y-2.5">
              <div className="flex items-center justify-center gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setShareFormat("square")}
                  className={`px-3 py-1.5 rounded-lg font-semibold border transition cursor-pointer ${
                    shareFormat === "square"
                      ? "bg-[#FCE8ED] border-[#A30F2D] text-[#A30F2D]"
                      : "bg-[#F6F7F9] border-[#E5E7EB] text-[#667085]"
                  }`}
                >
                  Square 1:1 (1080×1080)
                </button>
                <button
                  type="button"
                  onClick={() => setShareFormat("portrait")}
                  className={`px-3 py-1.5 rounded-lg font-semibold border transition cursor-pointer ${
                    shareFormat === "portrait"
                      ? "bg-[#FCE8ED] border-[#A30F2D] text-[#A30F2D]"
                      : "bg-[#F6F7F9] border-[#E5E7EB] text-[#667085]"
                  }`}
                >
                  Portrait 4:5 (1080×1350)
                </button>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleShare}
                  disabled={isSharing}
                  className="flex-1 min-h-[44px] bg-[#D51F43] text-white font-bold rounded-xl hover:bg-[#A30F2D] transition disabled:opacity-50 text-sm cursor-pointer"
                >
                  {isSharing ? "Preparing..." : "Share Badge"}
                </button>
                <button
                  type="button"
                  onClick={handleDownload}
                  disabled={isSharing}
                  className="min-h-[44px] px-4 bg-[#F6F7F9] text-[#171C26] border border-[#E5E7EB] font-semibold rounded-xl hover:bg-[#E5E7EB]/60 transition disabled:opacity-50 text-sm cursor-pointer"
                >
                  Download
                </button>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={onClose}
            className="mt-4 min-h-[44px] px-4 text-xs font-semibold text-[#667085] hover:text-[#171C26] transition cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
