"use client";

/**
 * KAvach Design (`components/DesignTab.tsx`)
 *
 * Post-card generator with two output sizes (1080x1080 for feed/WhatsApp,
 * 1080x1920 for stories/reels covers), three templates modelled on the
 * club's existing design language, and zero external deps or AI services.
 * Cards are inline SVG rasterized to PNG through <canvas> so downloads
 * and native share both hit the device directly — no Firebase Storage
 * spend, no upload quotas.
 *
 * The templates are laid out like the club's existing posts: a
 * full-bleed hero photo, a bold "PLAYER OF THE MATCH" corner card, an
 * angled name banner, a split stats card on white, a deep-navy team
 * score strip, and a red result pill along the bottom. Textures come
 * from inline SVG patterns (diagonal stripes and dotted grunge) so
 * every card carries the same sports-broadcast feel without an image
 * asset library.
 */

import { useMemo, useRef, useState, useEffect } from "react";
import { useStore } from "@/hooks/useStore";
import type { Match } from "@/lib/types";
import {
  BEBAS_NEUE_FONT_FACE_CSS,
  CONDENSED_STACK,
} from "@/lib/embedded-fonts";
import {
  Download,
  Share2,
  ImagePlus,
  X,
  Palette,
  Square,
  RectangleVertical,
} from "lucide-react";
import { format, parseISO } from "date-fns";

// -------- Sizes --------
type SizeKey = "square" | "portrait45" | "portrait";
const SIZES: Record<SizeKey, { w: number; h: number; label: string; ratio: string; platforms: string }> = {
  square: {
    w: 1080,
    h: 1080,
    label: "Square 1:1",
    ratio: "1:1",
    platforms: "Instagram feed · WhatsApp msg · Facebook post",
  },
  portrait45: {
    w: 1080,
    h: 1350,
    label: "Portrait 4:5",
    ratio: "4:5",
    platforms: "Instagram feed (portrait) · Facebook portrait post",
  },
  portrait: {
    w: 1080,
    h: 1920,
    label: "Portrait 9:16",
    ratio: "9:16",
    platforms: "Instagram Story · WhatsApp Status · Reels cover",
  },
};

// -------- Photo filter presets (SVG feColorMatrix / feComponentTransfer) --------
// Applied to the hero photo via filter="url(#photoFx_<id>)" so the effect
// survives SVG → canvas rasterization. Values chosen to loosely mirror
// the KAvach-Design CSS presets (Fierce / Stylish / Calm / etc.).
type PhotoFxId = "none" | "fierce" | "stylish" | "calm" | "aggressive" | "vibrant" | "grayscale";
const PHOTO_FILTERS: { id: PhotoFxId; label: string }[] = [
  { id: "none", label: "Original" },
  { id: "fierce", label: "Fierce" },
  { id: "stylish", label: "Stylish" },
  { id: "calm", label: "Calm" },
  { id: "aggressive", label: "Aggressive" },
  { id: "vibrant", label: "Vibrant" },
  { id: "grayscale", label: "B&W" },
];

// -------- Card type (POTM / Best Batsman / Best Bowler) --------
type CardTypeVariant = "potm" | "best_batsman" | "best_bowler";
const CARD_TYPE_TITLE: Record<CardTypeVariant, string[]> = {
  potm: ["PLAYER", "OF THE", "MATCH"],
  best_batsman: ["BEST", "", "BATSMAN"],
  best_bowler: ["BEST", "", "BOWLER"],
};

// -------- Auto-computed batting/bowling stats --------
const calcStrikeRate = (runs: string, balls: string): string => {
  const r = parseFloat(runs);
  const b = parseFloat(balls);
  if (!isFinite(r) || !isFinite(b) || b <= 0) return "";
  return ((r / b) * 100).toFixed(1);
};
// Overs like "4.3" mean 4 overs and 3 balls, per cricket convention.
const oversToBalls = (overs: string): number => {
  const o = parseFloat(overs);
  if (!isFinite(o) || o <= 0) return 0;
  const whole = Math.floor(o);
  const partBalls = Math.round((o - whole) * 10);
  return whole * 6 + Math.min(5, partBalls);
};
const calcEconomy = (runs: string, overs: string): string => {
  const balls = oversToBalls(overs);
  const r = parseFloat(runs);
  if (!isFinite(r) || balls <= 0) return "";
  const totalOvers = balls / 6;
  return (r / totalOvers).toFixed(2);
};

type CardKind = "scorecard" | "milestone" | "achievement";

type Scheme = {
  id: string;
  label: string;
  bgFrom: string;
  bgTo: string;
  primary: string; // main accent (used for name banner, result bar)
  deep: string;    // deep base (used for score strip)
  onPrimary: string;
};

const SCHEMES: Scheme[] = [
  {
    id: "scarlet-navy",
    label: "Scarlet · Navy",
    bgFrom: "#7f1d1d",
    bgTo: "#450a0a",
    primary: "#DC2626",
    deep: "#0F172A",
    onPrimary: "#FFFFFF",
  },
  {
    id: "amber-navy",
    label: "Amber · Navy",
    bgFrom: "#78350f",
    bgTo: "#431407",
    primary: "#F59E0B",
    deep: "#0F172A",
    onPrimary: "#0F172A",
  },
  {
    id: "emerald-navy",
    label: "Emerald · Navy",
    bgFrom: "#065f46",
    bgTo: "#022c22",
    primary: "#10B981",
    deep: "#0F172A",
    onPrimary: "#FFFFFF",
  },
  {
    id: "midnight-red",
    label: "Midnight · Red",
    bgFrom: "#1e293b",
    bgTo: "#020617",
    primary: "#EF4444",
    deep: "#020617",
    onPrimary: "#FFFFFF",
  },
];

// Result dropdown — pre-built templates, admin just enters a number
type ResultTpl = {
  id: string;
  label: string;
  needsNumber: boolean;
  unit?: "runs" | "wickets";
  build: (num: string, clubName: string) => string;
};

const buildResultTemplates = (clubName: string): ResultTpl[] => [
  {
    id: "won-runs",
    label: `${clubName} Won by … Runs`,
    needsNumber: true,
    unit: "runs",
    build: (n) => `${clubName.toUpperCase()} WON BY ${n || "—"} RUNS`,
  },
  {
    id: "won-wkts",
    label: `${clubName} Won by … Wickets`,
    needsNumber: true,
    unit: "wickets",
    build: (n) => `${clubName.toUpperCase()} WON BY ${n || "—"} WICKETS`,
  },
  {
    id: "lost-runs",
    label: `${clubName} Lost by … Runs`,
    needsNumber: true,
    unit: "runs",
    build: (n) => `${clubName.toUpperCase()} LOST BY ${n || "—"} RUNS`,
  },
  {
    id: "lost-wkts",
    label: `${clubName} Lost by … Wickets`,
    needsNumber: true,
    unit: "wickets",
    build: (n) => `${clubName.toUpperCase()} LOST BY ${n || "—"} WICKETS`,
  },
  {
    id: "tie",
    label: "Match Tied",
    needsNumber: false,
    build: () => `MATCH TIED`,
  },
  {
    id: "nr",
    label: "No Result / Abandoned",
    needsNumber: false,
    build: () => `NO RESULT`,
  },
  {
    id: "custom",
    label: "Custom text…",
    needsNumber: false,
    build: () => "",
  },
];

// Match sort: 3wk past + 1wk future first (prioritised, ordered by
// closeness to today), then everything else newest-first.
const priorityWindowSort = (a: Match, b: Match) => {
  const now = Date.now();
  const past = 21 * 24 * 60 * 60 * 1000;
  const future = 7 * 24 * 60 * 60 * 1000;
  const parse = (m: Match) => (m.date ? new Date(m.date).getTime() : 0);
  const inPriority = (m: Match) => {
    const t = parse(m);
    return t !== 0 && t >= now - past && t <= now + future;
  };
  const aP = inPriority(a);
  const bP = inPriority(b);
  if (aP !== bP) return aP ? -1 : 1;
  if (aP && bP) {
    return Math.abs(parse(a) - now) - Math.abs(parse(b) - now);
  }
  return parse(b) - parse(a); // most recent first outside the window
};

// -------- Shared SVG defs (patterns & gradients) --------
const SvgDefs = ({
  scheme,
  photoDataUrl,
  size,
}: {
  scheme: Scheme;
  photoDataUrl: string;
  size: { w: number; h: number };
}) => (
  <defs>
    {/* Embedded Bebas Neue so PNG export renders with the real font
        (external CSS doesn't apply inside a Blob-URL SVG loaded as
        an <image> for canvas rasterization). */}
    <style
      type="text/css"
      dangerouslySetInnerHTML={{ __html: BEBAS_NEUE_FONT_FACE_CSS }}
    />
    <linearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stopColor={scheme.bgFrom} />
      <stop offset="100%" stopColor={scheme.bgTo} />
    </linearGradient>
    {/* Darkening gradient for the lower half so overlays stay readable */}
    <linearGradient id="darkenBottom" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor="#000" stopOpacity="0" />
      <stop offset="55%" stopColor="#000" stopOpacity="0.35" />
      <stop offset="100%" stopColor="#000" stopOpacity="0.85" />
    </linearGradient>
    {/* Diagonal stripe pattern for corners/textures */}
    <pattern id="diagStripes" width="40" height="40" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="40" height="40" fill="transparent" />
      <rect width="18" height="40" fill="#000" fillOpacity="0.18" />
    </pattern>
    {/* Grunge texture using turbulence */}
    <filter id="grunge" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3" />
      <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.15 0" />
      <feComposite in2="SourceGraphic" operator="in" />
    </filter>
    {/* Photo look presets. Each is a stack of primitives applied in
        pipeline order. feColorMatrix values are 4x5 matrices
        (RGBA in → RGBA out). Numbers tuned to mirror the CSS
        filters used by the KAvach-Design Studio prototype. */}
    <filter id="photoFx_fierce" colorInterpolationFilters="sRGB">
      <feColorMatrix type="saturate" values="1.4" />
      <feComponentTransfer>
        <feFuncR type="linear" slope="1.25" intercept="-0.12" />
        <feFuncG type="linear" slope="1.25" intercept="-0.12" />
        <feFuncB type="linear" slope="1.25" intercept="-0.12" />
      </feComponentTransfer>
    </filter>
    <filter id="photoFx_stylish" colorInterpolationFilters="sRGB">
      <feColorMatrix type="saturate" values="0.85" />
      <feComponentTransfer>
        <feFuncR type="linear" slope="1.15" intercept="0.03" />
        <feFuncG type="linear" slope="1.15" intercept="0.03" />
        <feFuncB type="linear" slope="1.15" intercept="0.03" />
      </feComponentTransfer>
    </filter>
    <filter id="photoFx_calm" colorInterpolationFilters="sRGB">
      <feColorMatrix
        type="matrix"
        values="0.393 0.769 0.189 0 0
                0.349 0.686 0.168 0 0
                0.272 0.534 0.131 0 0
                0     0     0     1 0"
      />
      <feColorMatrix type="saturate" values="0.7" />
      <feComponentTransfer>
        <feFuncR type="linear" slope="1.1" intercept="0.02" />
        <feFuncG type="linear" slope="1.1" intercept="0.02" />
        <feFuncB type="linear" slope="1.1" intercept="0.02" />
      </feComponentTransfer>
    </filter>
    <filter id="photoFx_aggressive" colorInterpolationFilters="sRGB">
      <feColorMatrix type="saturate" values="1.6" />
      <feColorMatrix type="hueRotate" values="-15" />
      <feComponentTransfer>
        <feFuncR type="linear" slope="1.35" intercept="-0.18" />
        <feFuncG type="linear" slope="1.35" intercept="-0.18" />
        <feFuncB type="linear" slope="1.35" intercept="-0.18" />
      </feComponentTransfer>
    </filter>
    <filter id="photoFx_vibrant" colorInterpolationFilters="sRGB">
      <feColorMatrix type="saturate" values="1.3" />
      <feComponentTransfer>
        <feFuncR type="linear" slope="1.15" intercept="0.02" />
        <feFuncG type="linear" slope="1.15" intercept="0.02" />
        <feFuncB type="linear" slope="1.15" intercept="0.02" />
      </feComponentTransfer>
    </filter>
    <filter id="photoFx_grayscale" colorInterpolationFilters="sRGB">
      <feColorMatrix type="saturate" values="0" />
      <feComponentTransfer>
        <feFuncR type="linear" slope="1.1" />
        <feFuncG type="linear" slope="1.1" />
        <feFuncB type="linear" slope="1.1" />
      </feComponentTransfer>
    </filter>
    <clipPath id="fullBleed">
      <rect x="0" y="0" width={size.w} height={size.h} />
    </clipPath>
  </defs>
);

// -------- Corner Logo Card --------
const CornerLogoCard = ({
  x,
  y,
  size,
  logoUrl,
}: {
  x: number;
  y: number;
  size: number;
  logoUrl: string;
}) => (
  <g>
    <rect x={x} y={y} width={size} height={size} rx="20" fill="#FFFFFF" />
    <rect x={x + 4} y={y + 4} width={size - 8} height={size - 8} rx="16" fill="none" stroke="#F59E0B" strokeWidth="4" strokeOpacity="0.5" />
    {logoUrl ? (
      <image
        href={logoUrl}
        x={x + 14}
        y={y + 14}
        width={size - 28}
        height={size - 28}
        preserveAspectRatio="xMidYMid meet"
      />
    ) : null}
  </g>
);

// -------- Corner Title Card ("PLAYER OF THE MATCH", "MILESTONE", ...) --------
const CornerTitleCard = ({
  x,
  y,
  width,
  height,
  lines,
  scheme,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  lines: string[];
  scheme: Scheme;
}) => (
  <g>
    <rect x={x} y={y} width={width} height={height} rx="20" fill="#FFFFFF" />
    <text
      x={x + 24}
      y={y + 60}
      fill={scheme.deep}
      fontFamily={CONDENSED_STACK}
      fontSize="46"
      fontWeight="900"
      letterSpacing="1"
    >
      {lines[0]}
    </text>
    {lines[1] && (
      <text
        x={x + 24}
        y={y + 110}
        fill={scheme.deep}
        fontFamily={CONDENSED_STACK}
        fontSize="24"
        fontWeight="700"
        letterSpacing="4"
      >
        {lines[1]}
      </text>
    )}
    {lines[2] && (
      <text
        x={x + 24}
        y={y + 160}
        fill={scheme.deep}
        fontFamily={CONDENSED_STACK}
        fontSize="46"
        fontWeight="900"
        letterSpacing="1"
      >
        {lines[2]}
      </text>
    )}
    <rect x={x + 24} y={y + height - 30} width="70" height="8" fill={scheme.primary} rx="2" />
  </g>
);

// -------- Angled name banner --------
const AngledNameBanner = ({
  x,
  y,
  width,
  height,
  text,
  scheme,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  scheme: Scheme;
}) => {
  const cut = Math.round(height * 0.6);
  const pts = [
    `${x},${y}`,
    `${x + width - cut},${y}`,
    `${x + width},${y + height / 2}`,
    `${x + width - cut},${y + height}`,
    `${x},${y + height}`,
  ].join(" ");
  return (
    <g>
      <polygon points={pts} fill={scheme.primary} />
      <text
        x={x + 32}
        y={y + height / 2 + 18}
        fill={scheme.onPrimary}
        fontFamily={CONDENSED_STACK}
        fontSize="52"
        fontWeight="900"
        letterSpacing="1"
      >
        {text}
      </text>
    </g>
  );
};

// -------- Split stats card on white --------
type StatCol = { label: string; value: string; sub?: string; accent?: boolean };
const StatSplitCard = ({
  x,
  y,
  width,
  height,
  left,
  right,
  scheme,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  left: StatCol;
  right: StatCol;
  scheme: Scheme;
}) => {
  const midX = x + width / 2;
  const col = (cx: number, s: StatCol) => (
    <>
      <rect x={cx + 24} y={y + 26} width="6" height="26" rx="1" fill={scheme.primary} />
      <text
        x={cx + 44}
        y={y + 48}
        fill="#64748B"
        fontFamily={CONDENSED_STACK}
        fontSize="20"
        fontWeight="800"
        letterSpacing="4"
      >
        {s.label.toUpperCase()}
      </text>
      <text
        x={cx + 44}
        y={y + 130}
        fill={s.accent ? scheme.primary : scheme.deep}
        fontFamily={CONDENSED_STACK}
        fontSize="82"
        fontWeight="900"
      >
        {s.value || "—"}
      </text>
      {s.sub && (
        <text
          x={cx + 44}
          y={y + 168}
          fill="#94A3B8"
          fontFamily={CONDENSED_STACK}
          fontSize="18"
          fontWeight="700"
          letterSpacing="2"
        >
          {s.sub}
        </text>
      )}
    </>
  );
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx="18" fill="#FFFFFF" />
      {col(x, left)}
      <line x1={midX} y1={y + 30} x2={midX} y2={y + height - 30} stroke={scheme.primary} strokeWidth="3" />
      {col(midX, right)}
    </g>
  );
};

// -------- Team score strip --------
const TeamScoreStrip = ({
  x,
  y,
  width,
  height,
  teamA,
  teamB,
  scheme,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  teamA: { name: string; score: string; overs: string };
  teamB: { name: string; score: string; overs: string };
  scheme: Scheme;
}) => {
  const halfW = width / 2;
  const initial = (n: string) => (n?.trim()?.charAt(0) || "?").toUpperCase();
  const cellPadY = 30;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={scheme.deep} />
      {/* Team A (left aligned) */}
      <circle cx={x + 48} cy={y + cellPadY + 8} r="26" fill="#FFFFFF" />
      <text
        x={x + 48}
        y={y + cellPadY + 17}
        textAnchor="middle"
        fill={scheme.deep}
        fontFamily={CONDENSED_STACK}
        fontSize="26"
        fontWeight="900"
      >
        {initial(teamA.name)}
      </text>
      <text
        x={x + 88}
        y={y + cellPadY + 12}
        fill="#FFFFFF"
        fontFamily={CONDENSED_STACK}
        fontSize="24"
        fontWeight="800"
        letterSpacing="3"
      >
        {teamA.name.toUpperCase()}
      </text>
      <text
        x={x + 88}
        y={y + cellPadY + 80}
        fill="#FFFFFF"
        fontFamily={CONDENSED_STACK}
        fontSize="60"
        fontWeight="900"
      >
        {teamA.score || "—"}
      </text>
      {teamA.overs && (
        <text
          x={x + 88}
          y={y + cellPadY + 115}
          fill="#94A3B8"
          fontFamily={CONDENSED_STACK}
          fontSize="18"
          fontWeight="800"
          letterSpacing="3"
        >
          {teamA.overs.toUpperCase()}
        </text>
      )}
      {/* Divider */}
      <line
        x1={x + halfW}
        y1={y + 24}
        x2={x + halfW}
        y2={y + height - 24}
        stroke="#FFFFFF"
        strokeWidth="1"
        strokeOpacity="0.25"
      />
      {/* Team B (right aligned) */}
      <circle cx={x + width - 48} cy={y + cellPadY + 8} r="26" fill="#FFFFFF" />
      <text
        x={x + width - 48}
        y={y + cellPadY + 17}
        textAnchor="middle"
        fill={scheme.deep}
        fontFamily={CONDENSED_STACK}
        fontSize="26"
        fontWeight="900"
      >
        {initial(teamB.name)}
      </text>
      <text
        x={x + width - 88}
        y={y + cellPadY + 12}
        textAnchor="end"
        fill="#FFFFFF"
        fontFamily={CONDENSED_STACK}
        fontSize="24"
        fontWeight="800"
        letterSpacing="3"
      >
        {teamB.name.toUpperCase()}
      </text>
      <text
        x={x + width - 88}
        y={y + cellPadY + 80}
        textAnchor="end"
        fill="#FFFFFF"
        fontFamily={CONDENSED_STACK}
        fontSize="60"
        fontWeight="900"
      >
        {teamB.score || "—"}
      </text>
      {teamB.overs && (
        <text
          x={x + width - 88}
          y={y + cellPadY + 115}
          textAnchor="end"
          fill="#94A3B8"
          fontFamily={CONDENSED_STACK}
          fontSize="18"
          fontWeight="800"
          letterSpacing="3"
        >
          {teamB.overs.toUpperCase()}
        </text>
      )}
    </g>
  );
};

// -------- Result pill --------
const ResultPill = ({
  x,
  y,
  width,
  height,
  text,
  scheme,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  scheme: Scheme;
}) => (
  <g>
    <rect x={x} y={y} width={width} height={height} rx={height / 2} fill={scheme.primary} />
    <text
      x={x + width / 2}
      y={y + height / 2 + 12}
      textAnchor="middle"
      fill={scheme.onPrimary}
      fontFamily={CONDENSED_STACK}
      fontSize="34"
      fontWeight="900"
      letterSpacing="2"
    >
      {text}
    </text>
  </g>
);

// =====================================================================
// Templates
// =====================================================================

type ScorecardData = {
  teamName: string;
  opponent: string;
  teamScore: string;
  teamOvers: string;
  oppScore: string;
  oppOvers: string;
  potm: string;
  potmSubtitle: string;
  statLeft: StatCol;
  statRight: StatCol;
  resultText: string;
  websiteText: string;
  ctaText: string;
};

function ScorecardTemplate({
  size,
  scheme,
  photoDataUrl,
  logoUrl,
  clubName,
  data,
  cardType,
  photoNaturalSize,
  photoPan,
  photoZoom,
  photoFilter,
}: {
  size: SizeKey;
  scheme: Scheme;
  photoDataUrl: string;
  logoUrl: string;
  clubName: string;
  data: ScorecardData;
  cardType: CardTypeVariant;
  photoNaturalSize: { w: number; h: number } | null;
  photoPan: { x: number; y: number };
  photoZoom: number;
  photoFilter: PhotoFxId;
}) {
  const s = SIZES[size];
  const isPortrait = size === "portrait";

  // Layout: photo fills the whole canvas; overlays sit on top.
  // For portrait: bottom overlay starts at ~55% of height.
  // For square: bottom overlay starts at ~52%.
  const overlayTop = Math.round(s.h * (isPortrait ? 0.52 : 0.5));

  // Layout coords
  const pad = 40;
  const cornerCardSize = isPortrait ? 200 : 160;
  const titleW = isPortrait ? 380 : 340;
  const titleH = isPortrait ? 220 : 190;

  // stats card
  const statY = overlayTop + (isPortrait ? 260 : 180);
  const statH = isPortrait ? 220 : 200;

  // score strip
  const scoreStripH = isPortrait ? 200 : 180;
  const scoreY = statY + statH + (isPortrait ? 40 : 30);

  // result pill
  const resultH = isPortrait ? 92 : 82;
  const resultY = scoreY + scoreStripH + (isPortrait ? 24 : 18);

  // name banner
  const bannerY = overlayTop + (isPortrait ? 160 : 100);
  const bannerH = isPortrait ? 90 : 80;
  const bannerW = Math.round(s.w * 0.5);

  return (
    <svg
      viewBox={`0 0 ${s.w} ${s.h}`}
      xmlns="http://www.w3.org/2000/svg"
      style={{ width: "100%", height: "auto", display: "block" }}
    >
      <SvgDefs scheme={scheme} photoDataUrl={photoDataUrl} size={s} />

      {/* Background: full-bleed photo, or gradient placeholder.
          When we know the photo's natural dimensions, size the SVG image
          manually so we can pan (photoPan.x/y) and zoom (photoZoom)
          without relying on preserveAspectRatio (which centers only).
          Falls back to a plain "slice" if we don't have dimensions yet. */}
      {photoDataUrl && photoNaturalSize ? (
        (() => {
          // Cover-fit the natural photo into the canvas, then optionally
          // zoom in further. Pan values are 0..100 (%) mapping to the
          // available overflow after cover-fit + zoom.
          const coverScale = Math.max(s.w / photoNaturalSize.w, s.h / photoNaturalSize.h);
          const scale = coverScale * photoZoom;
          const drawW = photoNaturalSize.w * scale;
          const drawH = photoNaturalSize.h * scale;
          const overflowX = Math.max(0, drawW - s.w);
          const overflowY = Math.max(0, drawH - s.h);
          const x = -overflowX * (photoPan.x / 100);
          const y = -overflowY * (photoPan.y / 100);
          const filterAttr =
            photoFilter && photoFilter !== "none"
              ? `url(#photoFx_${photoFilter})`
              : undefined;
          return (
            <g clipPath="url(#fullBleed)">
              <image
                href={photoDataUrl}
                x={x}
                y={y}
                width={drawW}
                height={drawH}
                preserveAspectRatio="none"
                filter={filterAttr}
              />
            </g>
          );
        })()
      ) : photoDataUrl ? (
        <image
          href={photoDataUrl}
          x="0"
          y="0"
          width={s.w}
          height={s.h}
          preserveAspectRatio="xMidYMid slice"
          clipPath="url(#fullBleed)"
        />
      ) : (
        <>
          <rect width={s.w} height={s.h} fill="url(#bgGrad)" />
          <text
            x={s.w / 2}
            y={overlayTop - 40}
            textAnchor="middle"
            fill="#FFFFFF"
            fillOpacity="0.4"
            fontFamily={CONDENSED_STACK}
            fontSize="22"
            letterSpacing="4"
          >
            HERO PHOTO GOES HERE
          </text>
        </>
      )}

      {/* Softening gradient over the lower half so overlays stay legible */}
      <rect x="0" y={overlayTop - 200} width={s.w} height={s.h - overlayTop + 200} fill="url(#darkenBottom)" />

      {/* Bottom deep-navy body block behind stats + score strip */}
      <rect
        x="0"
        y={statY + statH + (isPortrait ? 20 : 10)}
        width={s.w}
        height={s.h - (statY + statH) - (isPortrait ? 20 : 10)}
        fill={scheme.deep}
      />

      {/* Corner cards */}
      <CornerTitleCard
        x={pad}
        y={pad}
        width={titleW}
        height={titleH}
        lines={CARD_TYPE_TITLE[cardType]}
        scheme={scheme}
      />

      <CornerLogoCard
        x={s.w - pad - cornerCardSize}
        y={pad}
        size={cornerCardSize}
        logoUrl={logoUrl}
      />

      {/* Name banner */}
      <AngledNameBanner
        x={pad}
        y={bannerY}
        width={bannerW}
        height={bannerH}
        text={(data.potm || "PLAYER NAME").toUpperCase()}
        scheme={scheme}
      />

      {/* Stats split card */}
      <StatSplitCard
        x={pad}
        y={statY}
        width={s.w - pad * 2}
        height={statH}
        left={data.statLeft}
        right={data.statRight}
        scheme={scheme}
      />

      {/* Team score strip */}
      <TeamScoreStrip
        x={0}
        y={scoreY}
        width={s.w}
        height={scoreStripH}
        teamA={{
          name: data.teamName || clubName,
          score: data.teamScore,
          overs: data.teamOvers ? `${data.teamOvers} OVERS` : "",
        }}
        teamB={{
          name: data.opponent || "OPPONENT",
          score: data.oppScore,
          overs: data.oppOvers ? `${data.oppOvers} OVERS` : "",
        }}
        scheme={scheme}
      />

      {/* Result pill */}
      <ResultPill
        x={pad}
        y={resultY}
        width={s.w - pad * 2}
        height={resultH}
        text={data.resultText || "RESULT PENDING"}
        scheme={scheme}
      />

      {/* Footer web + CTA */}
      <text
        x={pad}
        y={s.h - 32}
        fill="#FFFFFF"
        fillOpacity="0.55"
        fontFamily={CONDENSED_STACK}
        fontSize="18"
        fontWeight="700"
        letterSpacing="3"
      >
        {(data.websiteText || "").toUpperCase()}
      </text>
      <text
        x={s.w - pad}
        y={s.h - 32}
        textAnchor="end"
        fill="#FFFFFF"
        fillOpacity="0.75"
        fontFamily={CONDENSED_STACK}
        fontSize="18"
        fontWeight="800"
        letterSpacing="3"
      >
        {(data.ctaText || "").toUpperCase()}
      </text>
    </svg>
  );
}

// -------- Milestone card (500 NOT OUT style) --------
type MilestoneData = {
  headline: string;   // e.g. "500 NOT OUT" or "100 MATCHES"
  subhead: string;    // e.g. clubName / player name
  caption: string;    // e.g. "WINS 345 (70%)"
};

function MilestoneTemplate({
  size,
  scheme,
  photoDataUrl,
  logoUrl,
  data,
}: {
  size: SizeKey;
  scheme: Scheme;
  photoDataUrl: string;
  logoUrl: string;
  data: MilestoneData;
}) {
  const s = SIZES[size];
  const isPortrait = size === "portrait";

  // Top logo band (transparent logo sits directly on the coloured bg)
  const logoTop = 60;
  const logoH = isPortrait ? 160 : 140;
  // Headline block
  const headTop = logoTop + logoH + 40;
  const headSize = isPortrait ? 170 : 130;

  const subTop = headTop + headSize + 20;
  // Photo area
  const photoTop = subTop + (isPortrait ? 80 : 60);
  const photoH = s.h - photoTop - (isPortrait ? 200 : 180);
  const photoPadX = 60;

  // Caption strip at bottom
  const capH = isPortrait ? 120 : 100;
  const capY = s.h - capH;

  return (
    <svg
      viewBox={`0 0 ${s.w} ${s.h}`}
      xmlns="http://www.w3.org/2000/svg"
      style={{ width: "100%", height: "auto", display: "block" }}
    >
      <SvgDefs scheme={scheme} photoDataUrl={photoDataUrl} size={s} />

      {/* Textured coloured background */}
      <rect width={s.w} height={s.h} fill="url(#bgGrad)" />
      {/* Diagonal stripe corners for that sports poster look */}
      <polygon
        points={`0,0 ${Math.round(s.w * 0.4)},0 0,${Math.round(s.w * 0.35)}`}
        fill="url(#diagStripes)"
      />
      <polygon
        points={`${s.w},${s.h} ${s.w - Math.round(s.w * 0.4)},${s.h} ${s.w},${s.h - Math.round(s.w * 0.35)}`}
        fill="url(#diagStripes)"
      />
      {/* Soft grunge overlay */}
      <rect width={s.w} height={s.h} filter="url(#grunge)" opacity="0.6" />

      {/* Centered logo */}
      {logoUrl && (
        <image
          href={logoUrl}
          x={s.w / 2 - logoH / 2}
          y={logoTop}
          width={logoH}
          height={logoH}
          preserveAspectRatio="xMidYMid meet"
        />
      )}

      {/* HUGE headline (auto-fit) */}
      <text
        x={s.w / 2}
        y={headTop + headSize * 0.78}
        textAnchor="middle"
        fill="#FFFFFF"
        fontFamily={CONDENSED_STACK}
        fontSize={headSize}
        fontWeight="900"
        letterSpacing="4"
      >
        {(data.headline || "MILESTONE").toUpperCase()}
      </text>

      {/* Dashes under headline */}
      <rect x={s.w / 2 - 300} y={subTop - 8} width="90" height="6" fill="#FFFFFF" opacity="0.85" />
      <rect x={s.w / 2 + 210} y={subTop - 8} width="90" height="6" fill="#FFFFFF" opacity="0.85" />

      {/* Subhead */}
      <text
        x={s.w / 2}
        y={subTop + 40}
        textAnchor="middle"
        fill="#FFFFFF"
        fontFamily={CONDENSED_STACK}
        fontSize="48"
        fontWeight="900"
        letterSpacing="6"
      >
        {(data.subhead || "KAVACH").toUpperCase()}
      </text>

      {/* Framed photo */}
      <rect
        x={photoPadX - 8}
        y={photoTop - 8}
        width={s.w - photoPadX * 2 + 16}
        height={photoH + 16}
        rx="10"
        fill="#FFFFFF"
        opacity="0.15"
      />
      {photoDataUrl ? (
        <image
          href={photoDataUrl}
          x={photoPadX}
          y={photoTop}
          width={s.w - photoPadX * 2}
          height={photoH}
          preserveAspectRatio="xMidYMid slice"
        />
      ) : (
        <>
          <rect x={photoPadX} y={photoTop} width={s.w - photoPadX * 2} height={photoH} fill="#000000" opacity="0.35" />
          <text
            x={s.w / 2}
            y={photoTop + photoH / 2}
            textAnchor="middle"
            fill="#FFFFFF"
            fillOpacity="0.6"
            fontFamily={CONDENSED_STACK}
            fontSize="24"
            letterSpacing="4"
          >
            OPTIONAL TEAM PHOTO
          </text>
        </>
      )}

      {/* Caption strip */}
      <rect x="0" y={capY} width={s.w} height={capH} fill="#000000" opacity="0.45" />
      <rect x="0" y={capY} width={s.w} height="6" fill="url(#diagStripes)" opacity="0.6" />
      <rect x={s.w / 2 - 320} y={capY + capH / 2 - 3} width="90" height="6" fill="#FFFFFF" opacity="0.85" />
      <rect x={s.w / 2 + 230} y={capY + capH / 2 - 3} width="90" height="6" fill="#FFFFFF" opacity="0.85" />
      <text
        x={s.w / 2}
        y={capY + capH / 2 + 16}
        textAnchor="middle"
        fill="#FFFFFF"
        fontFamily={CONDENSED_STACK}
        fontSize="46"
        fontWeight="900"
        letterSpacing="4"
      >
        {(data.caption || "").toUpperCase()}
      </text>
    </svg>
  );
}

// -------- Achievement card (Player Profile / Kohli style) --------
type AchievementData = {
  playerName: string;
  playerCountry: string;
  rows: { label: string; value: string }[]; // up to 5 stat rows
};

function AchievementTemplate({
  size,
  scheme,
  photoDataUrl,
  logoUrl,
  clubName,
  data,
}: {
  size: SizeKey;
  scheme: Scheme;
  photoDataUrl: string;
  logoUrl: string;
  clubName: string;
  data: AchievementData;
}) {
  const s = SIZES[size];
  const isPortrait = size === "portrait";

  const pad = 50;
  const rowH = isPortrait ? 90 : 76;
  const rowsStartY = isPortrait ? s.h * 0.5 : s.h * 0.42;

  return (
    <svg
      viewBox={`0 0 ${s.w} ${s.h}`}
      xmlns="http://www.w3.org/2000/svg"
      style={{ width: "100%", height: "auto", display: "block" }}
    >
      <SvgDefs scheme={scheme} photoDataUrl={photoDataUrl} size={s} />

      {/* Navy background */}
      <rect width={s.w} height={s.h} fill={scheme.deep} />
      {/* Splash accent bottom-left */}
      <polygon
        points={`0,${s.h} 0,${s.h - 260} 260,${s.h}`}
        fill={scheme.primary}
        opacity="0.7"
      />
      <polygon
        points={`0,${s.h} 0,${s.h - 180} 180,${s.h}`}
        fill={scheme.primary}
      />

      {/* Player photo on right */}
      {photoDataUrl && (
        <image
          href={photoDataUrl}
          x={s.w / 2}
          y="0"
          width={s.w / 2}
          height={s.h}
          preserveAspectRatio="xMidYMid slice"
        />
      )}
      {/* Subtle overlay tint on photo half */}
      <rect x={s.w / 2} y="0" width={s.w / 2} height={s.h} fill={scheme.deep} opacity="0.15" />

      {/* Corner logo top-right */}
      {logoUrl && (
        <image
          href={logoUrl}
          x={s.w - pad - 120}
          y={pad}
          width="120"
          height="120"
          preserveAspectRatio="xMidYMid meet"
        />
      )}

      {/* Top-left small banner */}
      <polygon
        points={`${pad},${pad} ${pad + 320},${pad} ${pad + 300},${pad + 60} ${pad},${pad + 60}`}
        fill={scheme.primary}
      />
      <text
        x={pad + 22}
        y={pad + 42}
        fill="#FFFFFF"
        fontFamily={CONDENSED_STACK}
        fontSize="26"
        fontWeight="900"
        letterSpacing="3"
      >
        PLAYER PROFILE
      </text>

      {/* Name (two lines) */}
      {(() => {
        const parts = (data.playerName || "PLAYER NAME").split(" ");
        const first = parts.shift() || "";
        const last = parts.join(" ");
        const nameSize = isPortrait ? 130 : 100;
        return (
          <>
            <text
              x={pad}
              y={isPortrait ? 340 : 260}
              fill="#FFFFFF"
              fontFamily={CONDENSED_STACK}
              fontSize={nameSize * 0.55}
              fontWeight="700"
              letterSpacing="1"
            >
              {first.toUpperCase()}
            </text>
            <text
              x={pad}
              y={isPortrait ? 340 + nameSize * 0.85 : 260 + nameSize * 0.85}
              fill="#FFFFFF"
              fontFamily={CONDENSED_STACK}
              fontSize={nameSize}
              fontWeight="900"
              letterSpacing="1"
            >
              {last.toUpperCase()}
            </text>
          </>
        );
      })()}

      {/* Country / role pill */}
      <g>
        <rect
          x={pad}
          y={isPortrait ? 480 : 380}
          width={Math.max(200, (data.playerCountry?.length || 4) * 30)}
          height="60"
          rx="8"
          fill={scheme.primary}
        />
        <text
          x={pad + 22}
          y={isPortrait ? 522 : 422}
          fill="#FFFFFF"
          fontFamily={CONDENSED_STACK}
          fontSize="30"
          fontWeight="900"
          letterSpacing="3"
        >
          {(data.playerCountry || clubName || "TEAM").toUpperCase()}
        </text>
      </g>

      {/* Stat rows */}
      {data.rows.slice(0, 5).map((r, i) => (
        <g key={i}>
          <polygon
            points={`${pad},${rowsStartY + i * rowH} ${pad + 460},${rowsStartY + i * rowH} ${pad + 440},${rowsStartY + i * rowH + rowH - 14} ${pad},${rowsStartY + i * rowH + rowH - 14}`}
            fill="#FFFFFF"
          />
          <text
            x={pad + 22}
            y={rowsStartY + i * rowH + rowH / 2 + 6}
            fill={scheme.deep}
            fontFamily={CONDENSED_STACK}
            fontSize="28"
            fontWeight="700"
          >
            {r.label}
          </text>
          <text
            x={pad + 440}
            y={rowsStartY + i * rowH + rowH / 2 + 6}
            textAnchor="end"
            fill={scheme.deep}
            fontFamily={CONDENSED_STACK}
            fontSize="32"
            fontWeight="900"
          >
            {r.value}
          </text>
        </g>
      ))}
    </svg>
  );
}

// =====================================================================
// Main tab
// =====================================================================

export function DesignTab({ store }: { store: ReturnType<typeof useStore> }) {
  const clubName = store.appConfig?.clubName || "KAvach";
  const logoPrimary = store.appConfig?.logoUrl || "";
  const logoTransparent =
    store.appConfig?.logoTransparentUrl || store.appConfig?.logoUrl || "";

  const [kind, setKind] = useState<CardKind>("scorecard");
  const [sizeKey, setSizeKey] = useState<SizeKey>("portrait");
  const [schemeId, setSchemeId] = useState<string>(SCHEMES[0].id);
  const scheme = SCHEMES.find((s) => s.id === schemeId) || SCHEMES[0];

  // Load the embedded Bebas Neue @font-face into the document so
  // the live preview renders with the same typography as the export.
  // Idempotent — a repeat mount just no-ops on the existing <style>.
  useEffect(() => {
    const id = "kavach-design-embedded-fonts";
    if (typeof document === "undefined" || document.getElementById(id)) return;
    const style = document.createElement("style");
    style.id = id;
    style.appendChild(document.createTextNode(BEBAS_NEUE_FONT_FACE_CSS));
    document.head.appendChild(style);
  }, []);

  // -------- Photo (shared) --------
  const [photoDataUrl, setPhotoDataUrl] = useState<string>("");
  const [photoNaturalSize, setPhotoNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [photoPan, setPhotoPan] = useState<{ x: number; y: number }>({ x: 50, y: 30 });
  const [photoZoom, setPhotoZoom] = useState<number>(1);
  const [photoFilter, setPhotoFilter] = useState<PhotoFxId>("none");
  const fileRef = useRef<HTMLInputElement | null>(null);
  const onPickPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const src = reader.result as string;
      const img = new Image();
      img.onload = () => {
        const maxDim = 1800;
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const ctx = c.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, w, h);
        setPhotoDataUrl(c.toDataURL("image/jpeg", 0.92));
        setPhotoNaturalSize({ w, h });
        // Reset pan/zoom so the fresh photo starts centered.
        setPhotoPan({ x: 50, y: 30 });
        setPhotoZoom(1);
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  };

  // Pointer drag on the preview → adjust pan. Only meaningful when the
  // photo is zoomed in (or naturally larger than the canvas), otherwise
  // there's no overflow to shift into.
  const dragState = useRef<{ down: boolean; sx: number; sy: number; px: number; py: number } | null>(null);
  const onPreviewPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!photoDataUrl) return;
    dragState.current = { down: true, sx: e.clientX, sy: e.clientY, px: photoPan.x, py: photoPan.y };
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
  };
  const onPreviewPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const st = dragState.current;
    if (!st?.down) return;
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    // Convert pixel delta → percentage delta, sensitive to preview size.
    const dxPct = ((e.clientX - st.sx) / rect.width) * 100;
    const dyPct = ((e.clientY - st.sy) / rect.height) * 100;
    setPhotoPan({
      x: Math.max(0, Math.min(100, st.px - dxPct)),
      y: Math.max(0, Math.min(100, st.py - dyPct)),
    });
  };
  const onPreviewPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragState.current) dragState.current.down = false;
    try {
      (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
    } catch {}
  };

  // -------- Match dropdown (priority-window sort) --------
  const sortedMatches = useMemo(
    () => [...store.matches].filter((m) => !m.isArchived).sort(priorityWindowSort),
    [store.matches],
  );

  // -------- Scorecard state --------
  const [scMatchId, setScMatchId] = useState<string>("");
  const scMatch = store.matches.find((m) => m.id === scMatchId);
  const [scOpponent, setScOpponent] = useState<string>("");
  const [scTeamScore, setScTeamScore] = useState<string>("");
  const [scTeamOvers, setScTeamOvers] = useState<string>("");
  const [scOppScore, setScOppScore] = useState<string>("");
  const [scOppOvers, setScOppOvers] = useState<string>("");
  const [scPotmId, setScPotmId] = useState<string>("");
  const [scPotmNameOverride, setScPotmNameOverride] = useState<string>("");
  // Card variant — swaps the corner title + which stats are shown
  const [cardType, setCardType] = useState<CardTypeVariant>("potm");

  // Structured batting / bowling inputs. Strike rate and economy are
  // computed from these on the fly (no double-entry).
  const [batRuns, setBatRuns] = useState<string>("39");
  const [batBalls, setBatBalls] = useState<string>("22");
  const [batIsNotOut, setBatIsNotOut] = useState<boolean>(true);
  const [bowlWickets, setBowlWickets] = useState<string>("3");
  const [bowlRuns, setBowlRuns] = useState<string>("44");
  const [bowlOvers, setBowlOvers] = useState<string>("6");

  // Derived display values
  const battingDisplayValue = batRuns
    ? `${batRuns}${batIsNotOut ? "*" : ""}`
    : "—";
  const bowlingDisplayValue = bowlWickets && bowlRuns
    ? `${bowlWickets}/${bowlRuns}`
    : "—";
  const battingSubText = batBalls
    ? `SR: ${calcStrikeRate(batRuns, batBalls) || "—"} · ${batBalls}B`
    : "";
  const bowlingSubText = bowlOvers
    ? `ECO: ${calcEconomy(bowlRuns, bowlOvers) || "—"} · ${bowlOvers}O`
    : "";

  // Result dropdown
  const resultTemplates = useMemo(() => buildResultTemplates(clubName), [clubName]);
  const [resultId, setResultId] = useState<string>("won-runs");
  const [resultNumber, setResultNumber] = useState<string>("");
  const [resultCustom, setResultCustom] = useState<string>("");
  const currentResultTpl = resultTemplates.find((r) => r.id === resultId) || resultTemplates[0];
  const resultText = resultId === "custom"
    ? resultCustom.toUpperCase()
    : currentResultTpl.build(resultNumber, clubName);

  // Website + CTA
  const [scWebsite, setScWebsite] = useState<string>("kavachcricket.com");
  const [scCta, setScCta] = useState<string>("Go get them !");

  // Auto-fill from match
  useEffect(() => {
    if (!scMatch) return;
    setScOpponent(scMatch.opponent || "");
    // Best-effort autofill: some clubs don't store the score directly on
    // the match, so we only pre-populate what we know.
    const potm = scMatch.potmId
      ? store.players.find((p) => p.id === scMatch.potmId)
      : null;
    if (potm) {
      setScPotmId(potm.id);
      setScPotmNameOverride(potm.name);
    } else if (scMatch.playerOfTheMatch) {
      setScPotmId("");
      setScPotmNameOverride(scMatch.playerOfTheMatch);
    }
    // Try to parse "KAvach won by 47 runs" -> pre-select result tpl
    const r = (scMatch.result || "").toLowerCase();
    if (r.includes("won") && r.includes("wicket")) setResultId("won-wkts");
    else if (r.includes("won")) setResultId("won-runs");
    else if (r.includes("lost") && r.includes("wicket")) setResultId("lost-wkts");
    else if (r.includes("lost")) setResultId("lost-runs");
    else if (r.includes("tie")) setResultId("tie");
    const numMatch = (scMatch.result || "").match(/(\d+)/);
    if (numMatch) setResultNumber(numMatch[1]);
  }, [scMatchId]); // eslint-disable-line react-hooks/exhaustive-deps

  // POTM player picker (also updates displayed name)
  const rosterOptions = useMemo(
    () =>
      [...store.players]
        .filter((p) => !p.disabled)
        .sort((a, b) =>
          (a.name || "").localeCompare(b.name || "", "en", { sensitivity: "base" }),
        ),
    [store.players],
  );

  const potmName = scPotmId
    ? store.players.find((p) => p.id === scPotmId)?.name || scPotmNameOverride
    : scPotmNameOverride;

  // -------- Milestone state --------
  const [mHeadline, setMHeadline] = useState<string>("500 NOT OUT");
  const [mSubhead, setMSubhead] = useState<string>(clubName);
  const [mCaption, setMCaption] = useState<string>("WINS 345 (70%)");

  // -------- Achievement state --------
  const [aPlayerId, setAPlayerId] = useState<string>(rosterOptions[0]?.id || "");
  const [aPlayerName, setAPlayerName] = useState<string>("");
  const [aCountry, setACountry] = useState<string>(clubName);
  const [aRows, setARows] = useState<{ label: string; value: string }[]>([
    { label: "Matches", value: "109" },
    { label: "Runs", value: "3712" },
    { label: "Highest Score", value: "122" },
    { label: "Average", value: "50.85" },
    { label: "50/100", value: "33 / 1" },
  ]);
  useEffect(() => {
    const p = store.players.find((pp) => pp.id === aPlayerId);
    if (p) setAPlayerName(p.name);
  }, [aPlayerId, store.players]);

  // -------- Export --------
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string>("");

  const cloneSvgAsBlob = async (): Promise<Blob | null> => {
    // Make sure the embedded Bebas Neue face is fully parsed before we
    // rasterize — otherwise the very first export can fall through to
    // the system fallback stack while the font is still decoding.
    if (typeof document !== "undefined" && (document as any).fonts?.ready) {
      try {
        await (document as any).fonts.load("48px 'Bebas Neue'");
        await (document as any).fonts.ready;
      } catch {
        // non-fatal — proceed with whatever's loaded
      }
    }
    const container = document.getElementById("kavach-design-preview");
    const svgEl = container?.querySelector("svg");
    if (!svgEl) return null;
    const svgClone = svgEl.cloneNode(true) as SVGSVGElement;
    // Inline any remote image hrefs as data URIs so canvas won't taint.
    const externalImages = svgClone.querySelectorAll("image");
    for (const img of Array.from(externalImages)) {
      const href = img.getAttribute("href") || img.getAttribute("xlink:href") || "";
      if (href && !href.startsWith("data:")) {
        try {
          const res = await fetch(href, { mode: "cors" });
          const blob = await res.blob();
          const dataUrl: string = await new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result as string);
            r.onerror = reject;
            r.readAsDataURL(blob);
          });
          img.setAttribute("href", dataUrl);
        } catch {
          // Drop unreachable images rather than fail the whole export.
          img.remove();
        }
      }
    }
    svgClone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    const svgString = new XMLSerializer().serializeToString(svgClone);
    const svgBlob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();
    const loaded: Promise<void> = new Promise((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = reject;
    });
    img.src = url;
    try {
      await loaded;
      const canvas = document.createElement("canvas");
      canvas.width = SIZES[sizeKey].w;
      canvas.height = SIZES[sizeKey].h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/png", 0.95),
      );
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  const filenameFor = () => {
    const stamp = new Date().toISOString().split("T")[0];
    const suffix =
      kind === "scorecard"
        ? `scorecard-${(scOpponent || "match").replace(/\s+/g, "-")}`
        : kind === "milestone"
          ? `milestone-${(mHeadline || "club").replace(/\s+/g, "-")}`
          : `profile-${(aPlayerName || "player").replace(/\s+/g, "-")}`;
    return `kavach-${suffix}-${sizeKey}-${stamp}.png`;
  };

  const handleDownload = async () => {
    setIsExporting(true);
    setExportError("");
    try {
      const blob = await cloneSvgAsBlob();
      if (!blob) throw new Error("Could not render card.");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filenameFor();
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setExportError(err?.message || "Export failed.");
    } finally {
      setIsExporting(false);
    }
  };

  const handleShare = async () => {
    setIsExporting(true);
    setExportError("");
    try {
      const blob = await cloneSvgAsBlob();
      if (!blob) throw new Error("Could not render card.");
      const file = new File([blob], filenameFor(), { type: "image/png" });
      const nav: any = window.navigator;
      if (nav.canShare && nav.canShare({ files: [file] })) {
        await nav.share({ files: [file], title: `${clubName} — ${kind}` });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filenameFor();
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        alert(
          "Your browser doesn't expose native sharing. Card downloaded — open WhatsApp or Instagram and attach.",
        );
      }
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        setExportError(err?.message || "Share failed.");
      }
    } finally {
      setIsExporting(false);
    }
  };

  // Data assembly for each template. Card-type variant picks which
  // stats show:
  //   POTM         → Batting (left, accent) + Bowling (right)
  //   Best Batsman → Runs (accent) + Strike Rate
  //   Best Bowler  → Wickets (accent) + Economy
  const battingCol: StatCol = {
    label: "Batting",
    value: battingDisplayValue,
    sub: battingSubText,
    accent: true,
  };
  const bowlingCol: StatCol = {
    label: "Bowling",
    value: bowlingDisplayValue,
    sub: bowlingSubText,
    accent: false,
  };
  const bestBatsmanLeft: StatCol = {
    label: "Runs",
    value: battingDisplayValue,
    sub: batBalls ? `${batBalls} Balls` : "",
    accent: true,
  };
  const bestBatsmanRight: StatCol = {
    label: "Strike Rate",
    value: calcStrikeRate(batRuns, batBalls) || "—",
    sub: "Impact",
  };
  const bestBowlerLeft: StatCol = {
    label: "Wickets",
    value: bowlWickets || "—",
    sub: bowlOvers ? `${bowlOvers} Overs` : "",
    accent: true,
  };
  const bestBowlerRight: StatCol = {
    label: "Economy",
    value: calcEconomy(bowlRuns, bowlOvers) || "—",
    sub: bowlRuns ? `${bowlRuns} Runs` : "",
  };
  const [statLeftCol, statRightCol] =
    cardType === "best_batsman"
      ? [bestBatsmanLeft, bestBatsmanRight]
      : cardType === "best_bowler"
        ? [bestBowlerLeft, bestBowlerRight]
        : [battingCol, bowlingCol];

  const scData: ScorecardData = {
    teamName: clubName,
    opponent: scOpponent,
    teamScore: scTeamScore,
    teamOvers: scTeamOvers,
    oppScore: scOppScore,
    oppOvers: scOppOvers,
    potm: potmName || "",
    potmSubtitle: "",
    statLeft: statLeftCol,
    statRight: statRightCol,
    resultText,
    websiteText: scWebsite,
    ctaText: scCta,
  };

  const milestoneData: MilestoneData = {
    headline: mHeadline,
    subhead: mSubhead,
    caption: mCaption,
  };

  const achievementData: AchievementData = {
    playerName: aPlayerName,
    playerCountry: aCountry,
    rows: aRows,
  };

  return (
    <div className="space-y-4 pb-8">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
          <Palette className="w-5 h-5 text-accent" /> KAvach Design
        </h2>
      </div>

      {/* Template picker */}
      <div className="glass rounded-xl border border-glass-border p-1 flex gap-1">
        {(
          [
            { id: "scorecard", label: "Match / POTM" },
            { id: "milestone", label: "Milestone" },
            { id: "achievement", label: "Profile" },
          ] as { id: CardKind; label: string }[]
        ).map((opt) => (
          <button
            key={opt.id}
            onClick={() => setKind(opt.id)}
            className={`flex-1 px-3 py-2 rounded-lg text-[11px] font-bold uppercase tracking-wider transition ${
              kind === opt.id
                ? "bg-accent text-black shadow"
                : "text-white/60 hover:text-white"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Size picker */}
      <div className="glass rounded-xl border border-glass-border p-3">
        <div className="text-[10px] font-bold uppercase tracking-widest text-white/50 mb-2">
          Canvas Size
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(Object.keys(SIZES) as SizeKey[]).map((k) => (
            <button
              key={k}
              onClick={() => setSizeKey(k)}
              className={`rounded-lg p-2.5 text-left border transition ${
                sizeKey === k
                  ? "border-accent bg-accent/10"
                  : "border-glass-border bg-black/20 hover:border-white/30"
              }`}
            >
              <div className="flex items-center gap-1.5 text-white font-bold text-[11px]">
                {k === "square" ? (
                  <Square className="w-3.5 h-3.5" />
                ) : (
                  <RectangleVertical className="w-3.5 h-3.5" />
                )}
                {SIZES[k].label}
              </div>
              <div className="text-[9px] text-white/50 mt-1 leading-tight">
                {SIZES[k].platforms}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Colour scheme */}
      <div className="glass rounded-xl border border-glass-border p-3">
        <div className="text-[10px] font-bold uppercase tracking-widest text-white/50 mb-2">
          Colour Scheme
        </div>
        <div className="grid grid-cols-2 gap-2">
          {SCHEMES.map((s) => (
            <button
              key={s.id}
              onClick={() => setSchemeId(s.id)}
              className={`rounded-lg p-3 text-[11px] font-bold uppercase tracking-wider text-white transition border ${
                schemeId === s.id ? "border-white" : "border-transparent"
              }`}
              style={{ background: `linear-gradient(135deg, ${s.bgFrom}, ${s.bgTo})` }}
            >
              <div className="flex items-center gap-2">
                <span className="w-4 h-4 rounded" style={{ background: s.primary }} />
                <span className="w-4 h-4 rounded" style={{ background: s.deep }} />
                {s.label}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Photo */}
      <div className="glass rounded-xl border border-glass-border p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-white/50 flex items-center gap-1.5">
            <ImagePlus className="w-3 h-3" /> Hero Photo
          </span>
          {photoDataUrl && (
            <button
              onClick={() => {
                setPhotoDataUrl("");
                if (fileRef.current) fileRef.current.value = "";
              }}
              className="text-[10px] font-bold uppercase text-red-400 hover:text-red-300 flex items-center gap-1"
            >
              <X className="w-3 h-3" /> Remove
            </button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          onChange={onPickPhoto}
          className="w-full text-xs text-white/70 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-accent file:text-black hover:file:opacity-90"
        />
        <p className="text-[10px] text-white/40 mt-1.5 leading-tight">
          Upload a portrait photo of the player (POTM card) or a group shot (milestone).
          Drag the preview below to reframe; use zoom to punch in on the face.
        </p>

        {photoDataUrl && photoNaturalSize && (
          <>
            {/* Filter presets */}
            <div className="mt-3">
              <div className="text-[10px] font-bold uppercase tracking-widest text-white/50 mb-1">
                Photo Look
              </div>
              <div className="flex flex-wrap gap-1">
                {PHOTO_FILTERS.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setPhotoFilter(f.id)}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition ${
                      photoFilter === f.id
                        ? "bg-accent text-black"
                        : "bg-black/40 text-white/60 hover:text-white"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
            {/* Zoom + pan sliders */}
            <div className="mt-3 grid grid-cols-3 gap-2">
              <label className="text-[10px] text-white/60">
                <div className="mb-1 font-bold uppercase tracking-widest text-white/50">Zoom</div>
                <input
                  type="range"
                  min="1"
                  max="2.5"
                  step="0.05"
                  value={photoZoom}
                  onChange={(e) => setPhotoZoom(parseFloat(e.target.value))}
                  className="w-full accent-accent"
                />
                <div className="text-[10px] font-mono text-white/40">{photoZoom.toFixed(2)}×</div>
              </label>
              <label className="text-[10px] text-white/60">
                <div className="mb-1 font-bold uppercase tracking-widest text-white/50">Pan X</div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={photoPan.x}
                  onChange={(e) =>
                    setPhotoPan((p) => ({ ...p, x: parseInt(e.target.value, 10) }))
                  }
                  className="w-full accent-accent"
                />
                <div className="text-[10px] font-mono text-white/40">{photoPan.x}%</div>
              </label>
              <label className="text-[10px] text-white/60">
                <div className="mb-1 font-bold uppercase tracking-widest text-white/50">Pan Y</div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={photoPan.y}
                  onChange={(e) =>
                    setPhotoPan((p) => ({ ...p, y: parseInt(e.target.value, 10) }))
                  }
                  className="w-full accent-accent"
                />
                <div className="text-[10px] font-mono text-white/40">{photoPan.y}%</div>
              </label>
            </div>
          </>
        )}
      </div>

      {/* Kind-specific form */}
      {kind === "scorecard" && (
        <div className="glass rounded-xl border border-glass-border p-3 space-y-3">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-white/50 block mb-1">
              Pick a match to auto-fill (recent 3 wks past / 1 wk future first)
            </label>
            <select
              value={scMatchId}
              onChange={(e) => setScMatchId(e.target.value)}
              className="w-full bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent [&>option]:bg-neutral-900"
            >
              <option value="">— none —</option>
              {sortedMatches.map((m) => (
                <option key={m.id} value={m.id}>
                  vs {m.opponent} · {m.date}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-white/50 block mb-1">
              Player of the Match
            </label>
            <div className="grid grid-cols-2 gap-2">
              <select
                value={scPotmId}
                onChange={(e) => {
                  setScPotmId(e.target.value);
                  const p = store.players.find((pp) => pp.id === e.target.value);
                  if (p) setScPotmNameOverride(p.name);
                }}
                className="bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent [&>option]:bg-neutral-900"
              >
                <option value="">— pick player —</option>
                {rosterOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <input
                value={scPotmNameOverride}
                onChange={(e) => setScPotmNameOverride(e.target.value)}
                placeholder="Or type name / short tag"
                className="bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <input
              value={scOpponent}
              onChange={(e) => setScOpponent(e.target.value)}
              placeholder="Opponent"
              className="bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent"
            />
            <input
              value={""}
              disabled
              placeholder={`${clubName} (auto)`}
              className="bg-black/20 border border-glass-border rounded-lg px-3 py-2 text-sm text-white/40 cursor-not-allowed"
            />
            <input
              value={scTeamScore}
              onChange={(e) => setScTeamScore(e.target.value)}
              placeholder="Our score e.g. 240/9"
              className="bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent"
            />
            <input
              value={scTeamOvers}
              onChange={(e) => setScTeamOvers(e.target.value)}
              placeholder="Our overs e.g. 30"
              className="bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent"
            />
            <input
              value={scOppScore}
              onChange={(e) => setScOppScore(e.target.value)}
              placeholder="Their score e.g. 213/10"
              className="bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent"
            />
            <input
              value={scOppOvers}
              onChange={(e) => setScOppOvers(e.target.value)}
              placeholder="Their overs e.g. 26.1"
              className="bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent"
            />
          </div>

          {/* Card variant */}
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-white/50 block mb-1">
              Card Type
            </label>
            <div className="flex gap-1">
              {([
                { id: "potm", label: "POTM" },
                { id: "best_batsman", label: "Best Batsman" },
                { id: "best_bowler", label: "Best Bowler" },
              ] as { id: CardTypeVariant; label: string }[]).map((v) => (
                <button
                  key={v.id}
                  onClick={() => setCardType(v.id)}
                  className={`flex-1 px-2 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition ${
                    cardType === v.id
                      ? "bg-accent text-black"
                      : "bg-black/40 text-white/60 hover:text-white"
                  }`}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>

          {/* Batting stats (POTM + Best Batsman) */}
          {(cardType === "potm" || cardType === "best_batsman") && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-white/50">
                  Batting
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={batIsNotOut}
                    onChange={(e) => setBatIsNotOut(e.target.checked)}
                    className="accent-accent"
                  />
                  <span className="text-[10px] font-bold uppercase text-white/70">Not Out</span>
                </label>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={batRuns}
                  onChange={(e) => setBatRuns(e.target.value)}
                  placeholder="Runs e.g. 39"
                  inputMode="numeric"
                  className="bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent font-mono"
                />
                <input
                  value={batBalls}
                  onChange={(e) => setBatBalls(e.target.value)}
                  placeholder="Balls e.g. 22"
                  inputMode="numeric"
                  className="bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent font-mono"
                />
              </div>
              {batRuns && batBalls && (
                <div className="mt-1 text-[10px] text-white/40 font-mono uppercase tracking-widest">
                  SR: {calcStrikeRate(batRuns, batBalls) || "—"}
                </div>
              )}
            </div>
          )}

          {/* Bowling stats (POTM + Best Bowler) */}
          {(cardType === "potm" || cardType === "best_bowler") && (
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-white/50 block mb-1">
                Bowling
              </label>
              <div className="grid grid-cols-3 gap-2">
                <input
                  value={bowlWickets}
                  onChange={(e) => setBowlWickets(e.target.value)}
                  placeholder="Wkts"
                  inputMode="numeric"
                  className="bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent font-mono"
                />
                <input
                  value={bowlRuns}
                  onChange={(e) => setBowlRuns(e.target.value)}
                  placeholder="Runs"
                  inputMode="numeric"
                  className="bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent font-mono"
                />
                <input
                  value={bowlOvers}
                  onChange={(e) => setBowlOvers(e.target.value)}
                  placeholder="Overs e.g. 4.3"
                  inputMode="decimal"
                  className="bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent font-mono"
                />
              </div>
              {bowlRuns && bowlOvers && (
                <div className="mt-1 text-[10px] text-white/40 font-mono uppercase tracking-widest">
                  ECO: {calcEconomy(bowlRuns, bowlOvers) || "—"}
                </div>
              )}
            </div>
          )}

          {/* Result dropdown */}
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-white/50 block mb-1">
              Result
            </label>
            <div className="grid grid-cols-2 gap-2">
              <select
                value={resultId}
                onChange={(e) => setResultId(e.target.value)}
                className="bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent [&>option]:bg-neutral-900"
              >
                {resultTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
              {currentResultTpl.needsNumber ? (
                <input
                  type="number"
                  value={resultNumber}
                  onChange={(e) => setResultNumber(e.target.value)}
                  placeholder={currentResultTpl.unit === "wickets" ? "e.g. 6" : "e.g. 47"}
                  className="bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent font-mono"
                />
              ) : resultId === "custom" ? (
                <input
                  value={resultCustom}
                  onChange={(e) => setResultCustom(e.target.value)}
                  placeholder="Custom result text"
                  className="bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent"
                />
              ) : (
                <div className="text-xs text-white/40 self-center pl-2">
                  No number needed.
                </div>
              )}
            </div>
            <div className="mt-2 text-[10px] text-white/40 font-mono uppercase tracking-widest">
              Preview: {resultText || "—"}
            </div>
          </div>

          {/* Footer text */}
          <div className="grid grid-cols-2 gap-2">
            <input
              value={scWebsite}
              onChange={(e) => setScWebsite(e.target.value)}
              placeholder="Website footer"
              className="bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-accent"
            />
            <input
              value={scCta}
              onChange={(e) => setScCta(e.target.value)}
              placeholder="Call-to-action"
              className="bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-accent"
            />
          </div>
        </div>
      )}

      {kind === "milestone" && (
        <div className="glass rounded-xl border border-glass-border p-3 space-y-3">
          <input
            value={mHeadline}
            onChange={(e) => setMHeadline(e.target.value)}
            placeholder="Headline e.g. 500 NOT OUT"
            className="w-full bg-black/40 border border-glass-border rounded-lg px-3 py-3 text-lg text-white font-black focus:outline-none focus:border-accent"
          />
          <input
            value={mSubhead}
            onChange={(e) => setMSubhead(e.target.value)}
            placeholder={`Sub-headline e.g. ${clubName}`}
            className="w-full bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent"
          />
          <input
            value={mCaption}
            onChange={(e) => setMCaption(e.target.value)}
            placeholder="Bottom caption e.g. WINS 345 (70%)"
            className="w-full bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent"
          />
          <p className="text-[10px] text-white/40 leading-tight">
            The uploaded photo appears framed in the middle of the card. Best for team
            group photos.
          </p>
        </div>
      )}

      {kind === "achievement" && (
        <div className="glass rounded-xl border border-glass-border p-3 space-y-3">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-white/50 block mb-1">
              Player
            </label>
            <select
              value={aPlayerId}
              onChange={(e) => setAPlayerId(e.target.value)}
              className="w-full bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent [&>option]:bg-neutral-900"
            >
              {rosterOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <input
            value={aPlayerName}
            onChange={(e) => setAPlayerName(e.target.value)}
            placeholder="Player display name"
            className="w-full bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent"
          />
          <input
            value={aCountry}
            onChange={(e) => setACountry(e.target.value)}
            placeholder={`Team / role tag e.g. ${clubName}`}
            className="w-full bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent"
          />
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-white/50 block mb-1">
              Stat rows (up to 5 shown)
            </label>
            {aRows.map((r, i) => (
              <div key={i} className="grid grid-cols-[1fr,1fr,auto] gap-2 mb-2">
                <input
                  value={r.label}
                  onChange={(e) => {
                    const c = [...aRows];
                    c[i] = { ...c[i], label: e.target.value };
                    setARows(c);
                  }}
                  placeholder="Label"
                  className="bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent"
                />
                <input
                  value={r.value}
                  onChange={(e) => {
                    const c = [...aRows];
                    c[i] = { ...c[i], value: e.target.value };
                    setARows(c);
                  }}
                  placeholder="Value"
                  className="bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent font-mono"
                />
                <button
                  onClick={() => setARows(aRows.filter((_, ix) => ix !== i))}
                  className="px-2 rounded-lg bg-red-500/20 text-red-300 text-xs font-bold hover:bg-red-500/30"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
            {aRows.length < 5 && (
              <button
                onClick={() => setARows([...aRows, { label: "New Stat", value: "0" }])}
                className="w-full text-[11px] font-bold uppercase tracking-wider text-accent py-2 border border-dashed border-accent/40 rounded-lg hover:bg-accent/5"
              >
                + Add Row
              </button>
            )}
          </div>
        </div>
      )}

      {/* Preview */}
      <div className="glass rounded-xl border border-glass-border p-3">
        <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-white/50 flex items-center justify-between">
          <span>
            Live Preview · {SIZES[sizeKey].w} × {SIZES[sizeKey].h}
          </span>
          <span className="text-white/40">{SIZES[sizeKey].ratio}</span>
        </div>
        <div
          id="kavach-design-preview"
          onPointerDown={onPreviewPointerDown}
          onPointerMove={onPreviewPointerMove}
          onPointerUp={onPreviewPointerUp}
          onPointerCancel={onPreviewPointerUp}
          className={`rounded-xl overflow-hidden bg-black shadow-lg mx-auto select-none ${photoDataUrl ? "cursor-move touch-none" : ""}`}
          style={{
            maxWidth:
              sizeKey === "portrait"
                ? "min(100%, 360px)"
                : sizeKey === "portrait45"
                  ? "min(100%, 420px)"
                  : "100%",
          }}
        >
          {kind === "scorecard" && (
            <ScorecardTemplate
              size={sizeKey}
              scheme={scheme}
              photoDataUrl={photoDataUrl}
              logoUrl={logoPrimary}
              clubName={clubName}
              data={scData}
              cardType={cardType}
              photoNaturalSize={photoNaturalSize}
              photoPan={photoPan}
              photoZoom={photoZoom}
              photoFilter={photoFilter}
            />
          )}
          {kind === "milestone" && (
            <MilestoneTemplate
              size={sizeKey}
              scheme={scheme}
              photoDataUrl={photoDataUrl}
              logoUrl={logoTransparent}
              data={milestoneData}
            />
          )}
          {kind === "achievement" && (
            <AchievementTemplate
              size={sizeKey}
              scheme={scheme}
              photoDataUrl={photoDataUrl}
              logoUrl={logoTransparent}
              clubName={clubName}
              data={achievementData}
            />
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sticky bottom-4">
        <button
          onClick={handleDownload}
          disabled={isExporting}
          className="rounded-lg bg-white/10 hover:bg-white/20 text-white py-3 text-sm font-bold uppercase tracking-widest transition flex items-center justify-center gap-2 disabled:opacity-60"
        >
          <Download className="w-4 h-4" />
          {isExporting ? "..." : "Download PNG"}
        </button>
        <button
          onClick={handleShare}
          disabled={isExporting}
          className="rounded-lg bg-accent text-black py-3 text-sm font-black uppercase tracking-widest transition flex items-center justify-center gap-2 disabled:opacity-60 shadow"
        >
          <Share2 className="w-4 h-4" />
          {isExporting ? "..." : "Share"}
        </button>
      </div>
      {exportError && (
        <div className="text-xs text-red-400 text-center">{exportError}</div>
      )}
    </div>
  );
}
