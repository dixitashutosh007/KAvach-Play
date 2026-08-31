import { BadgeType, BadgeTier, Badge } from "@/lib/types";

const BADGE_META: Record<BadgeType, { label: string; short: string; tier: BadgeTier; emoji: string }> = {
  year_1:      { label: "1 Year with KAvach",        short: "1 Year",     tier: "bronze",  emoji: "1" },
  year_2:      { label: "2 Years with KAvach",       short: "2 Years",    tier: "bronze",  emoji: "2" },
  year_3:      { label: "3 Years with KAvach",       short: "3 Years",    tier: "silver",  emoji: "3" },
  year_4:      { label: "4 Years with KAvach",       short: "4 Years",    tier: "silver",  emoji: "4" },
  year_5:      { label: "5 Years with KAvach",       short: "5 Years",    tier: "gold",    emoji: "5" },
  original:    { label: "KAvach Original",            short: "Original",   tier: "gold",    emoji: "OG" },
  core:        { label: "KAvach Core",                short: "Core",       tier: "gold",    emoji: "★" },
  elite:       { label: "KAvach Elite",               short: "Elite",      tier: "diamond", emoji: "♛" },
  centurion:   { label: "KAvach Centurion",           short: "Centurion",  tier: "diamond", emoji: "💯" },
  hattrick:    { label: "KAvach Hattrick",            short: "Hattrick",   tier: "diamond", emoji: "🎯" },
  "5wh":       { label: "KAvach 5 Wicket Haul",      short: "5WH",        tier: "diamond", emoji: "🔥" },
  runs_2k:     { label: "KAvach 2K Run Club",         short: "2K Runs",    tier: "silver",  emoji: "2K" },
  runs_5k:     { label: "KAvach 5K Run Club",         short: "5K Runs",    tier: "gold",    emoji: "5K" },
  runs_10k:    { label: "KAvach 10K Run Club",        short: "10K Runs",   tier: "diamond", emoji: "10K" },
  wickets_100: { label: "KAvach 100 Wicket Club",     short: "100 Wkts",   tier: "silver",  emoji: "100" },
  wickets_200: { label: "KAvach 200 Wicket Club",     short: "200 Wkts",   tier: "gold",    emoji: "200" },
  wickets_300: { label: "KAvach 300 Wicket Club",     short: "300 Wkts",   tier: "gold",    emoji: "300" },
  wickets_500: { label: "KAvach 500 Wicket Club",     short: "500 Wkts",   tier: "diamond", emoji: "500" },
};

const TIER_COLORS: Record<BadgeTier, { bg: string; border: string; text: string; glow: string }> = {
  bronze:  { bg: "#CD7F32", border: "#A0522D", text: "#FFF8E7", glow: "rgba(205,127,50,0.4)" },
  silver:  { bg: "#C0C0C0", border: "#808080", text: "#1a1a1a", glow: "rgba(192,192,192,0.4)" },
  gold:    { bg: "#FFD700", border: "#DAA520", text: "#1a1a1a", glow: "rgba(255,215,0,0.4)" },
  diamond: { bg: "#B9F2FF", border: "#00CED1", text: "#003333", glow: "rgba(0,206,209,0.5)" },
};

export function getBadgeMeta(badgeType: BadgeType) {
  return BADGE_META[badgeType];
}

export function getBadgeTierColors(tier: BadgeTier) {
  return TIER_COLORS[tier];
}

export function BadgeIcon({
  badgeType,
  size = 48,
  count,
  className,
}: {
  badgeType: BadgeType;
  size?: number;
  count?: number;
  className?: string;
}) {
  const meta = BADGE_META[badgeType];
  const colors = TIER_COLORS[meta.tier];
  const r = size / 2;
  const innerR = r * 0.82;
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

        {/* Shield shape */}
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

        {/* Inner ring */}
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

        {/* Badge text/emoji */}
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

      {/* Count badge for stackable badges */}
      {count && count > 1 && (
        <span
          className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center"
          style={{ width: size * 0.4, height: size * 0.4, minWidth: 16, minHeight: 16 }}
        >
          ×{count}
        </span>
      )}
    </div>
  );
}

export function BadgeCard({
  badgeType,
  count,
  showLabel = true,
}: {
  badgeType: BadgeType;
  count?: number;
  showLabel?: boolean;
}) {
  const meta = BADGE_META[badgeType];
  const colors = TIER_COLORS[meta.tier];

  return (
    <div
      className="flex flex-col items-center gap-1 p-2 rounded-lg border transition hover:scale-105"
      style={{
        borderColor: colors.border + "40",
        background: colors.bg + "10",
      }}
    >
      <BadgeIcon badgeType={badgeType} size={40} count={count} />
      {showLabel && (
        <span className="text-[9px] font-bold text-white/70 text-center leading-tight">
          {meta.short}
        </span>
      )}
    </div>
  );
}

export const ALL_BADGE_TYPES: BadgeType[] = [
  "year_1", "year_2", "year_3", "year_4", "year_5",
  "original", "core", "elite",
  "centurion", "hattrick", "5wh",
  "runs_2k", "runs_5k", "runs_10k",
  "wickets_100", "wickets_200", "wickets_300", "wickets_500",
];

export const STACKABLE_BADGES: Set<BadgeType> = new Set(["centurion", "hattrick", "5wh"]);

export function PlayerBadgeRow({
  playerId,
  badges,
}: {
  playerId: string;
  badges: Badge[];
}) {
  const playerBadges = badges.filter((b) => b.playerId === playerId);
  if (!playerBadges.length) return null;

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
          count={STACKABLE_BADGES.has(badgeType) ? bList.length : undefined}
        />
      ))}
    </div>
  );
}
