import type { BadgeTier } from "@/lib/types";
import { normalizeBadgeTier } from "@/lib/badge-awarding";

export interface MetallicPalette {
  highlight: string;
  mid: string;
  shadow: string;
  rim: string;
  text: string;
  accent: string;
  glow: string;
  pillBg: string;
  pillText: string;
}

export const METALLIC_TIER_PALETTES: Record<BadgeTier, MetallicPalette> = {
  bronze: {
    highlight: "#F6C99E",
    mid: "#CD7F32",
    shadow: "#7A3E12",
    rim: "#9A521C",
    text: "#FFF8EC",
    accent: "#A30F2D",
    glow: "rgba(205, 127, 50, 0.35)",
    pillBg: "#FDF2E9",
    pillText: "#9A4E16",
  },
  silver: {
    highlight: "#F8FAFC",
    mid: "#CBD5E1",
    shadow: "#475569",
    rim: "#64748B",
    text: "#0F172A",
    accent: "#A30F2D",
    glow: "rgba(148, 163, 184, 0.38)",
    pillBg: "#F1F5F9",
    pillText: "#334155",
  },
  gold: {
    highlight: "#FEF08A",
    mid: "#EAB308",
    shadow: "#854D0E",
    rim: "#CA8A04",
    text: "#1C1917",
    accent: "#A30F2D",
    glow: "rgba(234, 179, 8, 0.42)",
    pillBg: "#FEF9C3",
    pillText: "#854D0E",
  },
  diamond: {
    highlight: "#ECFEFF",
    mid: "#22D3EE",
    shadow: "#0E7490",
    rim: "#0891B2",
    text: "#083344",
    accent: "#D51F43",
    glow: "rgba(34, 211, 238, 0.42)",
    pillBg: "#ECFEFF",
    pillText: "#155E75",
  },
};

export const BUILTIN_ARTWORK_IDS: readonly string[] = [
  "year_1",
  "year_2",
  "year_3",
  "year_4",
  "year_5",
  "original",
  "core",
  "elite",
  "centurion",
  "hattrick",
  "5wh",
  "runs_1k",
  "runs_2k",
  "runs_5k",
  "runs_10k",
  "wickets_100",
  "wickets_200",
  "wickets_300",
  "wickets_500",
  "player_of_weekend",
];

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function renderMotif(badgeType: string, emoji: string, p: MetallicPalette): string {
  // Normalized 100x100 viewBox coordinates
  if (badgeType.startsWith("year_")) {
    const yr = escapeXml(badgeType.replace("year_", ""));
    return `
      <path d="M 28 24 L 50 18 L 72 24" fill="none" stroke="${p.text}" stroke-opacity="0.35" stroke-width="2.2" stroke-linecap="round"/>
      <text x="50" y="54" text-anchor="middle" dominant-baseline="central" font-family="Inter,system-ui,sans-serif" font-weight="900" font-size="30" fill="${p.text}">${yr}</text>
      <text x="50" y="75" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-weight="800" font-size="9" letter-spacing="1.5" fill="${p.text}" fill-opacity="0.8">YR${yr === "1" ? "" : "S"}</text>
    `;
  }

  if (badgeType.startsWith("runs_")) {
    const label = escapeXml(badgeType.replace("runs_", "").toUpperCase());
    return `
      <g stroke="${p.text}" stroke-opacity="0.28" stroke-width="2.4" stroke-linecap="round">
        <line x1="34" y1="26" x2="66" y2="62"/>
        <line x1="66" y1="26" x2="34" y2="62"/>
      </g>
      <text x="50" y="54" text-anchor="middle" dominant-baseline="central" font-family="Inter,system-ui,sans-serif" font-weight="900" font-size="${label.length >= 3 ? "21" : "25"}" fill="${p.text}">${label}</text>
      <text x="50" y="76" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-weight="800" font-size="8" letter-spacing="1.2" fill="${p.text}" fill-opacity="0.78">RUNS</text>
    `;
  }

  if (badgeType.startsWith("wickets_")) {
    const label = escapeXml(badgeType.replace("wickets_", ""));
    return `
      <g stroke="${p.text}" stroke-opacity="0.28" stroke-width="2.2" stroke-linecap="round">
        <line x1="41" y1="22" x2="41" y2="64"/>
        <line x1="50" y1="20" x2="50" y2="64"/>
        <line x1="59" y1="22" x2="59" y2="64"/>
        <line x1="39" y1="22" x2="61" y2="22"/>
      </g>
      <text x="50" y="54" text-anchor="middle" dominant-baseline="central" font-family="Inter,system-ui,sans-serif" font-weight="900" font-size="22" fill="${p.text}">${label}</text>
      <text x="50" y="76" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-weight="800" font-size="8" letter-spacing="1.2" fill="${p.text}" fill-opacity="0.78">WKTS</text>
    `;
  }

  switch (badgeType) {
    case "original":
      return `
        <path d="M 30 30 L 50 20 L 70 30" fill="none" stroke="${p.accent}" stroke-width="2.6" stroke-linecap="round"/>
        <text x="50" y="54" text-anchor="middle" dominant-baseline="central" font-family="Inter,system-ui,sans-serif" font-weight="900" font-size="26" fill="${p.text}">OG</text>
        <text x="50" y="76" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-weight="800" font-size="7.5" letter-spacing="1.2" fill="${p.text}" fill-opacity="0.8">ORIGINAL</text>
      `;
    case "core":
      return `
        <polygon points="50,22 56,37 72,38 60,49 63,65 50,57 37,65 40,49 28,38 44,37" fill="${p.accent}" fill-opacity="0.85" stroke="${p.text}" stroke-width="1.5"/>
        <text x="50" y="77" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-weight="800" font-size="8" letter-spacing="1.2" fill="${p.text}" fill-opacity="0.85">CORE</text>
      `;
    case "elite":
      return `
        <path d="M 28 56 L 32 32 L 43 44 L 50 26 L 57 44 L 68 32 L 72 56 Z" fill="${p.accent}" fill-opacity="0.88" stroke="${p.text}" stroke-width="1.6" stroke-linejoin="round"/>
        <text x="50" y="75" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-weight="800" font-size="8" letter-spacing="1.4" fill="${p.text}" fill-opacity="0.85">ELITE</text>
      `;
    case "centurion":
      return `
        <circle cx="50" cy="46" r="21" fill="none" stroke="${p.accent}" stroke-opacity="0.7" stroke-width="2.4"/>
        <text x="50" y="48" text-anchor="middle" dominant-baseline="central" font-family="Inter,system-ui,sans-serif" font-weight="900" font-size="22" fill="${p.text}">100</text>
        <text x="50" y="76" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-weight="800" font-size="7.5" letter-spacing="1" fill="${p.text}" fill-opacity="0.8">CENTURY</text>
      `;
    case "hattrick":
      return `
        <g fill="${p.accent}" stroke="${p.text}" stroke-width="1.2">
          <circle cx="34" cy="42" r="7.5"/>
          <circle cx="50" cy="36" r="7.5"/>
          <circle cx="66" cy="42" r="7.5"/>
        </g>
        <text x="50" y="64" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-weight="900" font-size="14" fill="${p.text}">3×3</text>
        <text x="50" y="78" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-weight="800" font-size="7" letter-spacing="1" fill="${p.text}" fill-opacity="0.8">HATTRICK</text>
      `;
    case "5wh":
      return `
        <g stroke="${p.text}" stroke-opacity="0.3" stroke-width="2" stroke-linecap="round">
          <line x1="39" y1="24" x2="36" y2="56"/>
          <line x1="50" y1="22" x2="50" y2="56"/>
          <line x1="61" y1="24" x2="64" y2="56"/>
        </g>
        <text x="50" y="48" text-anchor="middle" dominant-baseline="central" font-family="Inter,system-ui,sans-serif" font-weight="900" font-size="24" fill="${p.text}">5W</text>
        <text x="50" y="76" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-weight="800" font-size="7.5" letter-spacing="1.2" fill="${p.text}" fill-opacity="0.8">HAUL</text>
      `;
    case "player_of_weekend":
      return `
        <path d="M 32 30 H 68 V 44 C 68 55 59 62 50 62 C 41 62 32 55 32 44 Z" fill="${p.accent}" fill-opacity="0.9" stroke="${p.text}" stroke-width="1.6"/>
        <rect x="46" y="62" width="8" height="9" fill="${p.text}" fill-opacity="0.8"/>
        <rect x="38" y="71" width="24" height="4" rx="2" fill="${p.text}" fill-opacity="0.85"/>
      `;
    default: {
      const safeEmoji = escapeXml(emoji || "🏅");
      const fontSize = safeEmoji.length > 2 ? 20 : 28;
      return `
        <text x="50" y="54" text-anchor="middle" dominant-baseline="central" font-family="Inter,system-ui,sans-serif" font-weight="900" font-size="${fontSize}" fill="${p.text}">${safeEmoji}</text>
      `;
    }
  }
}

/**
 * Generate a deterministic, self-contained metallic SVG string for any badge
 * in a normalized 100x100 viewBox. Used by both React UI and Canvas sharing.
 */
let _svgUidCounter = 0;

export function buildBadgeSvgString({
  badgeType,
  tier,
  emoji,
  size = 48,
  uid,
}: {
  badgeType: string;
  tier?: BadgeTier | string;
  emoji?: string;
  size?: number;
  uid?: string;
}): string {
  const safeTier = normalizeBadgeTier(tier);
  const p = METALLIC_TIER_PALETTES[safeTier];
  const resolvedUid = uid ?? `${badgeType}_${++_svgUidCounter}`;
  const cleanUid = resolvedUid.replace(/[^a-zA-Z0-9_-]/g, "");
  const gradId = `m_${cleanUid}`;
  const sheenId = `s_${cleanUid}`;

  return `<svg viewBox="0 0 100 100" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="${gradId}" x1="15%" y1="10%" x2="85%" y2="95%">
      <stop offset="0%" stop-color="${p.highlight}"/>
      <stop offset="48%" stop-color="${p.mid}"/>
      <stop offset="100%" stop-color="${p.shadow}"/>
    </linearGradient>
    <linearGradient id="${sheenId}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.45"/>
      <stop offset="50%" stop-color="#FFFFFF" stop-opacity="0.06"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.18"/>
    </linearGradient>
  </defs>
  <path d="M 50 5 L 91 20 L 91 54 Q 91 81 50 96 Q 9 81 9 54 L 9 20 Z" fill="url(#${gradId})" stroke="${p.rim}" stroke-width="3.5"/>
  <path d="M 50 11 L 85 24 L 85 53 Q 85 76 50 89 Q 15 76 15 53 L 15 24 Z" fill="url(#${sheenId})" stroke="#FFFFFF" stroke-opacity="0.35" stroke-width="1.2"/>
  <path d="M 21 26 L 50 15 L 79 26" fill="none" stroke="${p.accent}" stroke-width="2" stroke-opacity="0.7" stroke-linecap="round"/>
  ${renderMotif(badgeType, emoji || "🏅", p)}
</svg>`;
}
