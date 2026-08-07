"use client";

/**
 * KAvach Design (`components/DesignTab.tsx`)
 *
 * Zero-dependency post-card generator. Renders 3 templates (Match
 * Scorecard, Player Milestone, Personal Achievement) as inline SVG at
 * 1080x1080, so the browser can rasterize them to PNG via <canvas>
 * without any external image library or AI service.
 *
 * Uploaded photos live only in the browser tab — they're kept as
 * base64 data URIs and baked into the exported PNG, so we don't need
 * a Firebase Storage bucket, upload quotas, or per-user permissions.
 *
 * The whole feature is mobile-first: the layout stacks controls on
 * top of the preview, tap targets are big, and every field ships
 * prefilled where possible (match dropdown auto-fills opponent,
 * score, ground, format, POTM; player dropdown auto-fills the name
 * for milestone/achievement cards).
 */

import { useMemo, useRef, useState } from "react";
import { useStore } from "@/hooks/useStore";
import { Download, Share2, ImagePlus, X, Palette, LayoutTemplate } from "lucide-react";
import { format, parseISO } from "date-fns";

type CardKind = "scorecard" | "milestone" | "achievement";

type ColourScheme = {
  id: string;
  label: string;
  bg: string;         // page background gradient stops "hex,hex"
  accent: string;     // primary highlight
  text: string;       // primary text
  subtext: string;    // muted text
  panel: string;      // panel/box fill
  divider: string;    // subtle divider
};

const SCHEMES: ColourScheme[] = [
  {
    id: "scarlet",
    label: "Scarlet",
    bg: "#450a0a,#1c0303",
    accent: "#F87171",
    text: "#FFFFFF",
    subtext: "#FCA5A5",
    panel: "#7f1d1d",
    divider: "#450a0a",
  },
  {
    id: "emerald",
    label: "Emerald",
    bg: "#022c22,#064e3b",
    accent: "#34D399",
    text: "#FFFFFF",
    subtext: "#6EE7B7",
    panel: "#065f46",
    divider: "#022c22",
  },
  {
    id: "midnight",
    label: "Midnight",
    bg: "#020617,#0f172a",
    accent: "#FBBF24",
    text: "#FFFFFF",
    subtext: "#94A3B8",
    panel: "#1e293b",
    divider: "#0f172a",
  },
];

const CARD_SIZE = 1080;

export function DesignTab({ store }: { store: ReturnType<typeof useStore> }) {
  const [kind, setKind] = useState<CardKind>("scorecard");
  const [schemeId, setSchemeId] = useState<string>(SCHEMES[0].id);
  const scheme = SCHEMES.find((s) => s.id === schemeId) || SCHEMES[0];

  const clubName = store.appConfig?.clubName || "KAvach";
  const clubLogo = store.appConfig?.logoUrl || "";

  // Shared photo state (all templates)
  const [photoDataUrl, setPhotoDataUrl] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const onPickPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const src = reader.result as string;
      // Downscale to <= 1600px so we don't bloat the export.
      const img = new Image();
      img.onload = () => {
        const maxDim = 1600;
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const ctx = c.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, w, h);
        setPhotoDataUrl(c.toDataURL("image/jpeg", 0.9));
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  };

  // -------------------- Scorecard state --------------------
  const activeMatches = useMemo(
    () =>
      [...store.matches]
        .filter((m) => !m.isArchived)
        .sort((a, b) => (b.date || "").localeCompare(a.date || "")),
    [store.matches],
  );

  const [scMatchId, setScMatchId] = useState<string>(activeMatches[0]?.id || "");
  const scMatch = store.matches.find((m) => m.id === scMatchId);
  const [scTeamName, setScTeamName] = useState<string>(clubName);
  const [scOpponent, setScOpponent] = useState<string>("");
  const [scTeamScore, setScTeamScore] = useState<string>("");
  const [scTeamOvers, setScTeamOvers] = useState<string>("");
  const [scOppScore, setScOppScore] = useState<string>("");
  const [scOppOvers, setScOppOvers] = useState<string>("");
  const [scResult, setScResult] = useState<string>("");
  const [scPOTM, setScPOTM] = useState<string>("");
  const [scCaption, setScCaption] = useState<string>("");
  const [scMatchTouched, setScMatchTouched] = useState<string>("");

  // When a match is picked, autofill the form (unless the admin has
  // already touched a field for this match).
  if (scMatch && scMatchTouched !== scMatchId) {
    const ground = store.grounds.find((g) => g.id === scMatch.groundId);
    setScOpponent(scMatch.opponent || "");
    setScResult(scMatch.result || "");
    // POTM: prefer the linked playerId over freeform.
    const potmPlayer = scMatch.potmId
      ? store.players.find((p) => p.id === scMatch.potmId)
      : null;
    setScPOTM(potmPlayer?.name || scMatch.playerOfTheMatch || "");
    setScTeamName(clubName);
    setScCaption(
      `${scMatch.format || ""}${scMatch.matchType ? ` · ${scMatch.matchType}` : ""}${ground?.name ? ` · ${ground.name}` : ""}`.trim(),
    );
    setScMatchTouched(scMatchId);
  }

  // -------------------- Milestone state --------------------
  const rosterOptions = useMemo(
    () =>
      [...store.players]
        .filter((p) => !p.disabled)
        .sort((a, b) =>
          (a.name || "").localeCompare(b.name || "", "en", { sensitivity: "base" }),
        ),
    [store.players],
  );
  const [mPlayerId, setMPlayerId] = useState<string>(rosterOptions[0]?.id || "");
  const [mPlayerName, setMPlayerName] = useState<string>("");
  const [mStatValue, setMStatValue] = useState<string>("100");
  const [mStatLabel, setMStatLabel] = useState<string>("MATCHES");
  const [mCaption, setMCaption] = useState<string>("A landmark for the ages.");
  const [mPlayerTouched, setMPlayerTouched] = useState<string>("");
  if (mPlayerId && mPlayerTouched !== mPlayerId) {
    const p = store.players.find((pp) => pp.id === mPlayerId);
    if (p) setMPlayerName(p.name);
    setMPlayerTouched(mPlayerId);
  }

  // -------------------- Achievement state --------------------
  const ACHIEVEMENT_TYPES = [
    "CENTURY",
    "HALF-CENTURY",
    "FIVE-WICKET HAUL",
    "HAT-TRICK",
    "MAIDEN OVER",
    "PLAYER OF THE MATCH",
  ];
  const [aPlayerId, setAPlayerId] = useState<string>(rosterOptions[0]?.id || "");
  const [aPlayerName, setAPlayerName] = useState<string>("");
  const [aType, setAType] = useState<string>(ACHIEVEMENT_TYPES[0]);
  const [aStat, setAStat] = useState<string>("");
  const [aCaption, setACaption] = useState<string>("");
  const [aMatchId, setAMatchId] = useState<string>("");
  const [aPlayerTouched, setAPlayerTouched] = useState<string>("");
  if (aPlayerId && aPlayerTouched !== aPlayerId) {
    const p = store.players.find((pp) => pp.id === aPlayerId);
    if (p) setAPlayerName(p.name);
    setAPlayerTouched(aPlayerId);
  }
  const aMatch = store.matches.find((m) => m.id === aMatchId);

  // -------------------- SVG renderers --------------------
  const svgRef = useRef<SVGSVGElement | null>(null);

  const renderScorecard = () => (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${CARD_SIZE} ${CARD_SIZE}`}
      xmlns="http://www.w3.org/2000/svg"
      style={{ width: "100%", height: "auto", display: "block" }}
    >
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={scheme.bg.split(",")[0]} />
          <stop offset="100%" stopColor={scheme.bg.split(",")[1]} />
        </linearGradient>
        <clipPath id="photoClip">
          <rect x="60" y="580" width="960" height="360" rx="24" />
        </clipPath>
      </defs>
      <rect width={CARD_SIZE} height={CARD_SIZE} fill="url(#bg)" />

      {/* Header stripe */}
      <rect x="0" y="0" width={CARD_SIZE} height="120" fill={scheme.panel} opacity="0.85" />
      {clubLogo && (
        <image
          href={clubLogo}
          x="40"
          y="24"
          width="72"
          height="72"
          preserveAspectRatio="xMidYMid slice"
        />
      )}
      <text x="130" y="76" fill={scheme.text} fontFamily="Arial, sans-serif" fontWeight="900" fontSize="42" letterSpacing="2">
        {clubName.toUpperCase()}
      </text>
      <text x={CARD_SIZE - 40} y="76" fill={scheme.accent} textAnchor="end" fontFamily="Arial, sans-serif" fontWeight="900" fontSize="30" letterSpacing="4">
        MATCH RESULT
      </text>

      {/* VS block */}
      <text x={CARD_SIZE / 2} y="210" textAnchor="middle" fill={scheme.subtext} fontFamily="Arial, sans-serif" fontSize="24" letterSpacing="4">
        {scCaption || "MATCH REPORT"}
      </text>

      <text x="80" y="330" fill={scheme.text} fontFamily="Arial, sans-serif" fontSize="52" fontWeight="800" letterSpacing="1">
        {(scTeamName || clubName).toUpperCase()}
      </text>
      <text x={CARD_SIZE - 80} y="330" textAnchor="end" fill={scheme.accent} fontFamily="Arial, sans-serif" fontSize="72" fontWeight="900" letterSpacing="1">
        {scTeamScore || "—"}
        {scTeamOvers ? (
          <tspan fill={scheme.subtext} fontSize="34" fontWeight="700"> ({scTeamOvers})</tspan>
        ) : null}
      </text>

      <line x1="80" y1="370" x2={CARD_SIZE - 80} y2="370" stroke={scheme.divider} strokeWidth="2" />

      <text x="80" y="440" fill={scheme.text} fontFamily="Arial, sans-serif" fontSize="52" fontWeight="800" letterSpacing="1">
        {(scOpponent || "OPPONENT").toUpperCase()}
      </text>
      <text x={CARD_SIZE - 80} y="440" textAnchor="end" fill={scheme.text} fontFamily="Arial, sans-serif" fontSize="72" fontWeight="900" letterSpacing="1">
        {scOppScore || "—"}
        {scOppOvers ? (
          <tspan fill={scheme.subtext} fontSize="34" fontWeight="700"> ({scOppOvers})</tspan>
        ) : null}
      </text>

      {/* Result strip */}
      <rect x="60" y="480" width={CARD_SIZE - 120} height="80" rx="16" fill={scheme.panel} />
      <text x={CARD_SIZE / 2} y="533" textAnchor="middle" fill={scheme.text} fontFamily="Arial, sans-serif" fontSize="34" fontWeight="900" letterSpacing="2">
        {(scResult || "RESULT PENDING").toUpperCase()}
      </text>

      {/* Photo band */}
      {photoDataUrl ? (
        <image
          href={photoDataUrl}
          x="60"
          y="580"
          width="960"
          height="360"
          preserveAspectRatio="xMidYMid slice"
          clipPath="url(#photoClip)"
        />
      ) : (
        <>
          <rect x="60" y="580" width="960" height="360" rx="24" fill={scheme.panel} opacity="0.4" />
          <text x={CARD_SIZE / 2} y="770" textAnchor="middle" fill={scheme.subtext} fontFamily="Arial, sans-serif" fontSize="22" letterSpacing="2">
            OPTIONAL MATCH PHOTO
          </text>
        </>
      )}
      {/* Bottom overlay strip so POTM stays readable over any photo */}
      <rect x="60" y="860" width="960" height="80" rx="0" fill="#000000" opacity="0.55" />
      <text x="80" y="915" fill={scheme.accent} fontFamily="Arial, sans-serif" fontSize="22" fontWeight="800" letterSpacing="3">
        POTM:
        <tspan fill={scheme.text} fontSize="26" fontWeight="900" dx="10" letterSpacing="1">
          {(scPOTM || "—").toUpperCase()}
        </tspan>
      </text>

      {/* Footer */}
      <text x={CARD_SIZE / 2} y="1020" textAnchor="middle" fill={scheme.subtext} fontFamily="Arial, sans-serif" fontSize="20" letterSpacing="4">
        {scMatch?.date ? format(parseISO(scMatch.date), "d MMM yyyy").toUpperCase() : ""}
      </text>
    </svg>
  );

  const renderMilestone = () => (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${CARD_SIZE} ${CARD_SIZE}`}
      xmlns="http://www.w3.org/2000/svg"
      style={{ width: "100%", height: "auto", display: "block" }}
    >
      <defs>
        <linearGradient id="bgm" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={scheme.bg.split(",")[0]} />
          <stop offset="100%" stopColor={scheme.bg.split(",")[1]} />
        </linearGradient>
        <clipPath id="portraitClipM">
          <circle cx={CARD_SIZE / 2} cy="440" r="220" />
        </clipPath>
      </defs>
      <rect width={CARD_SIZE} height={CARD_SIZE} fill="url(#bgm)" />

      {clubLogo && (
        <image href={clubLogo} x="40" y="40" width="80" height="80" preserveAspectRatio="xMidYMid slice" />
      )}
      <text x={CARD_SIZE - 60} y="90" textAnchor="end" fill={scheme.accent} fontFamily="Arial, sans-serif" fontWeight="900" fontSize="32" letterSpacing="4">
        MILESTONE
      </text>

      {/* Portrait circle */}
      <circle cx={CARD_SIZE / 2} cy="440" r="230" fill={scheme.panel} />
      {photoDataUrl ? (
        <image
          href={photoDataUrl}
          x={CARD_SIZE / 2 - 220}
          y="220"
          width="440"
          height="440"
          preserveAspectRatio="xMidYMid slice"
          clipPath="url(#portraitClipM)"
        />
      ) : (
        <text x={CARD_SIZE / 2} y="450" textAnchor="middle" fill={scheme.subtext} fontFamily="Arial, sans-serif" fontSize="24" letterSpacing="2">
          OPTIONAL PORTRAIT
        </text>
      )}
      <circle cx={CARD_SIZE / 2} cy="440" r="230" fill="none" stroke={scheme.accent} strokeWidth="6" />

      <text x={CARD_SIZE / 2} y="750" textAnchor="middle" fill={scheme.text} fontFamily="Arial, sans-serif" fontSize="56" fontWeight="900" letterSpacing="1">
        {(mPlayerName || "PLAYER NAME").toUpperCase()}
      </text>

      {/* Big stat */}
      <text x={CARD_SIZE / 2} y="880" textAnchor="middle" fill={scheme.accent} fontFamily="Arial, sans-serif" fontSize="130" fontWeight="900" letterSpacing="4">
        {mStatValue || "100"}
      </text>
      <text x={CARD_SIZE / 2} y="930" textAnchor="middle" fill={scheme.subtext} fontFamily="Arial, sans-serif" fontSize="30" fontWeight="800" letterSpacing="6">
        {(mStatLabel || "MATCHES").toUpperCase()}
      </text>

      <text x={CARD_SIZE / 2} y="1000" textAnchor="middle" fill={scheme.text} fontFamily="Arial, sans-serif" fontSize="22" letterSpacing="2">
        {mCaption}
      </text>
      <text x={CARD_SIZE / 2} y="1045" textAnchor="middle" fill={scheme.subtext} fontFamily="Arial, sans-serif" fontSize="18" letterSpacing="4">
        {clubName.toUpperCase()}
      </text>
    </svg>
  );

  const renderAchievement = () => (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${CARD_SIZE} ${CARD_SIZE}`}
      xmlns="http://www.w3.org/2000/svg"
      style={{ width: "100%", height: "auto", display: "block" }}
    >
      <defs>
        <linearGradient id="bga" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={scheme.bg.split(",")[0]} />
          <stop offset="100%" stopColor={scheme.bg.split(",")[1]} />
        </linearGradient>
        <clipPath id="portraitClipA">
          <rect x="60" y="180" width="440" height="720" rx="24" />
        </clipPath>
      </defs>
      <rect width={CARD_SIZE} height={CARD_SIZE} fill="url(#bga)" />

      {clubLogo && (
        <image href={clubLogo} x="40" y="40" width="72" height="72" preserveAspectRatio="xMidYMid slice" />
      )}
      <text x={CARD_SIZE - 60} y="86" textAnchor="end" fill={scheme.accent} fontFamily="Arial, sans-serif" fontWeight="900" fontSize="30" letterSpacing="4">
        ACHIEVEMENT
      </text>

      {/* Portrait tall */}
      <rect x="60" y="180" width="440" height="720" rx="24" fill={scheme.panel} />
      {photoDataUrl ? (
        <image
          href={photoDataUrl}
          x="60"
          y="180"
          width="440"
          height="720"
          preserveAspectRatio="xMidYMid slice"
          clipPath="url(#portraitClipA)"
        />
      ) : (
        <text x="280" y="560" textAnchor="middle" fill={scheme.subtext} fontFamily="Arial, sans-serif" fontSize="24" letterSpacing="2">
          OPTIONAL PORTRAIT
        </text>
      )}

      {/* Right content column */}
      <text x="540" y="240" fill={scheme.subtext} fontFamily="Arial, sans-serif" fontSize="22" fontWeight="700" letterSpacing="4">
        SPECIAL ACHIEVEMENT
      </text>
      <text x="540" y="320" fill={scheme.accent} fontFamily="Arial, sans-serif" fontSize="60" fontWeight="900" letterSpacing="2">
        {(aType || "").toUpperCase()}
      </text>

      <line x1="540" y1="360" x2={CARD_SIZE - 60} y2="360" stroke={scheme.divider} strokeWidth="2" />

      <text x="540" y="430" fill={scheme.text} fontFamily="Arial, sans-serif" fontSize="24" letterSpacing="3">
        PLAYER
      </text>
      <text x="540" y="490" fill={scheme.text} fontFamily="Arial, sans-serif" fontSize="46" fontWeight="900" letterSpacing="1">
        {(aPlayerName || "PLAYER NAME").toUpperCase()}
      </text>

      {aStat && (
        <>
          <text x="540" y="580" fill={scheme.subtext} fontFamily="Arial, sans-serif" fontSize="20" letterSpacing="3">
            KEY STAT
          </text>
          <text x="540" y="640" fill={scheme.accent} fontFamily="Arial, sans-serif" fontSize="46" fontWeight="900" letterSpacing="1">
            {aStat}
          </text>
        </>
      )}

      {aMatch && (
        <>
          <text x="540" y="720" fill={scheme.subtext} fontFamily="Arial, sans-serif" fontSize="20" letterSpacing="3">
            MATCH
          </text>
          <text x="540" y="770" fill={scheme.text} fontFamily="Arial, sans-serif" fontSize="26" fontWeight="800">
            vs {aMatch.opponent}
          </text>
          <text x="540" y="805" fill={scheme.subtext} fontFamily="Arial, sans-serif" fontSize="20">
            {aMatch.date ? format(parseISO(aMatch.date), "d MMM yyyy") : ""}
          </text>
        </>
      )}

      {aCaption && (
        <>
          <text x="540" y="870" fill={scheme.text} fontFamily="Arial, sans-serif" fontSize="22" letterSpacing="1">
            {aCaption.length > 40 ? aCaption.slice(0, 40) + "…" : aCaption}
          </text>
        </>
      )}

      <text x="540" y="1020" fill={scheme.subtext} fontFamily="Arial, sans-serif" fontSize="18" letterSpacing="4">
        {clubName.toUpperCase()}
      </text>
    </svg>
  );

  // -------------------- Export helpers --------------------
  const cloneSvgAsBlob = async (): Promise<Blob | null> => {
    const svgEl = document.getElementById("kavach-design-preview")?.querySelector("svg");
    if (!svgEl) return null;
    // Inline any remote image hrefs as data URIs so canvas won't taint.
    const svgClone = svgEl.cloneNode(true) as SVGSVGElement;
    const externalImages = svgClone.querySelectorAll("image");
    for (const img of Array.from(externalImages)) {
      const href = img.getAttribute("href") || img.getAttribute("xlink:href") || "";
      if (href && !href.startsWith("data:")) {
        try {
          const res = await fetch(href, { mode: "cors" });
          const blob = await res.blob();
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result as string);
            r.onerror = reject;
            r.readAsDataURL(blob);
          });
          img.setAttribute("href", dataUrl);
        } catch {
          // If a remote image can't be inlined (typically a CORS-blocked
          // logo hosted on a bucket without CORS headers) we drop it so
          // the export at least succeeds — the SVG still shows the card,
          // just without that image.
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
      img.onerror = (e) => reject(e);
    });
    img.src = url;
    try {
      await loaded;
      const canvas = document.createElement("canvas");
      canvas.width = CARD_SIZE;
      canvas.height = CARD_SIZE;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0, CARD_SIZE, CARD_SIZE);
      return await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/png", 0.95),
      );
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string>("");

  const filenameFor = () => {
    const stamp = new Date().toISOString().split("T")[0];
    const suffix =
      kind === "scorecard"
        ? `scorecard-${(scOpponent || "match").replace(/\s+/g, "-")}`
        : kind === "milestone"
          ? `milestone-${(mPlayerName || "player").replace(/\s+/g, "-")}`
          : `achievement-${(aPlayerName || "player").replace(/\s+/g, "-")}`;
    return `kavach-${suffix}-${stamp}.png`;
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
        await nav.share({
          files: [file],
          title: `${clubName} — ${kind}`,
        });
      } else {
        // Fallback: download and hint the user
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filenameFor();
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        alert(
          "Your browser doesn't expose native sharing. Card downloaded — open WhatsApp or Instagram and attach the file.",
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

  return (
    <div className="space-y-4 pb-8">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
          <Palette className="w-5 h-5 text-accent" /> KAvach Design
        </h2>
      </div>

      {/* Kind picker */}
      <div className="glass rounded-xl border border-glass-border p-1 flex gap-1">
        {(
          [
            { id: "scorecard", label: "Match Result" },
            { id: "milestone", label: "Milestone" },
            { id: "achievement", label: "Achievement" },
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

      {/* Colour scheme */}
      <div className="glass rounded-xl border border-glass-border p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-white/50 flex items-center gap-1.5">
            <LayoutTemplate className="w-3 h-3" /> Colour Scheme
          </span>
        </div>
        <div className="flex gap-2">
          {SCHEMES.map((s) => (
            <button
              key={s.id}
              onClick={() => setSchemeId(s.id)}
              className={`flex-1 rounded-lg px-3 py-2 text-[11px] font-bold uppercase tracking-wider transition border ${
                schemeId === s.id
                  ? "border-white text-white"
                  : "border-transparent text-white/60"
              }`}
              style={{
                background: `linear-gradient(135deg, ${s.bg.split(",")[0]}, ${s.bg.split(",")[1]})`,
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Photo upload */}
      <div className="glass rounded-xl border border-glass-border p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-white/50 flex items-center gap-1.5">
            <ImagePlus className="w-3 h-3" /> Photo (Optional)
          </span>
          {photoDataUrl && (
            <button
              onClick={() => {
                setPhotoDataUrl("");
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
              className="text-[10px] font-bold uppercase text-red-400 hover:text-red-300 flex items-center gap-1"
            >
              <X className="w-3 h-3" /> Remove
            </button>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={onPickPhoto}
          className="w-full text-xs text-white/70 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-accent file:text-black hover:file:opacity-90"
        />
        <p className="text-[10px] text-white/40 mt-1.5 leading-tight">
          Portrait for milestones/achievements, match photo for scorecards. Text stays on top of a dark overlay so nothing gets obstructed.
        </p>
      </div>

      {/* Kind-specific form */}
      {kind === "scorecard" && (
        <div className="glass rounded-xl border border-glass-border p-3 space-y-3">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-white/50 block mb-1">
              Fill from a match (optional)
            </label>
            <select
              value={scMatchId}
              onChange={(e) => setScMatchId(e.target.value)}
              className="w-full bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent [&>option]:bg-neutral-900"
            >
              <option value="">— none —</option>
              {activeMatches.map((m) => (
                <option key={m.id} value={m.id}>
                  vs {m.opponent} · {m.date}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input
              value={scTeamName}
              onChange={(e) => setScTeamName(e.target.value)}
              placeholder="Team name"
              className="bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent"
            />
            <input
              value={scOpponent}
              onChange={(e) => setScOpponent(e.target.value)}
              placeholder="Opponent"
              className="bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent"
            />
            <input
              value={scTeamScore}
              onChange={(e) => setScTeamScore(e.target.value)}
              placeholder="Our score e.g. 156/6"
              className="bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent"
            />
            <input
              value={scTeamOvers}
              onChange={(e) => setScTeamOvers(e.target.value)}
              placeholder="Our overs e.g. 20"
              className="bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent"
            />
            <input
              value={scOppScore}
              onChange={(e) => setScOppScore(e.target.value)}
              placeholder="Their score"
              className="bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent"
            />
            <input
              value={scOppOvers}
              onChange={(e) => setScOppOvers(e.target.value)}
              placeholder="Their overs"
              className="bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent"
            />
          </div>
          <input
            value={scResult}
            onChange={(e) => setScResult(e.target.value)}
            placeholder="Result headline (e.g. KAvach won by 6 wkts)"
            className="w-full bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent"
          />
          <input
            value={scPOTM}
            onChange={(e) => setScPOTM(e.target.value)}
            placeholder="Player of the Match"
            className="w-full bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent"
          />
          <input
            value={scCaption}
            onChange={(e) => setScCaption(e.target.value)}
            placeholder="Sub-heading (format · ground)"
            className="w-full bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent"
          />
        </div>
      )}

      {kind === "milestone" && (
        <div className="glass rounded-xl border border-glass-border p-3 space-y-3">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-white/50 block mb-1">
              Player
            </label>
            <select
              value={mPlayerId}
              onChange={(e) => setMPlayerId(e.target.value)}
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
            value={mPlayerName}
            onChange={(e) => setMPlayerName(e.target.value)}
            placeholder="Display name"
            className="w-full bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              value={mStatValue}
              onChange={(e) => setMStatValue(e.target.value)}
              placeholder="Number (e.g. 100)"
              className="bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent font-mono"
            />
            <input
              value={mStatLabel}
              onChange={(e) => setMStatLabel(e.target.value)}
              placeholder="Unit (MATCHES / RUNS / WICKETS)"
              className="bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent"
            />
          </div>
          <input
            value={mCaption}
            onChange={(e) => setMCaption(e.target.value)}
            placeholder="Short caption"
            className="w-full bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent"
          />
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
            placeholder="Display name"
            className="w-full bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent"
          />
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-white/50 block mb-1">
              Achievement type
            </label>
            <select
              value={aType}
              onChange={(e) => setAType(e.target.value)}
              className="w-full bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent [&>option]:bg-neutral-900"
            >
              {ACHIEVEMENT_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <input
            value={aStat}
            onChange={(e) => setAStat(e.target.value)}
            placeholder="Key stat (e.g. 105* off 62 balls)"
            className="w-full bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent"
          />
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-white/50 block mb-1">
              Related match (optional)
            </label>
            <select
              value={aMatchId}
              onChange={(e) => setAMatchId(e.target.value)}
              className="w-full bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent [&>option]:bg-neutral-900"
            >
              <option value="">— none —</option>
              {activeMatches.map((m) => (
                <option key={m.id} value={m.id}>
                  vs {m.opponent} · {m.date}
                </option>
              ))}
            </select>
          </div>
          <input
            value={aCaption}
            onChange={(e) => setACaption(e.target.value)}
            placeholder="Short caption (max 40 chars)"
            className="w-full bg-black/40 border border-glass-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent"
          />
        </div>
      )}

      {/* Preview */}
      <div className="glass rounded-xl border border-glass-border p-3">
        <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-white/50">
          Live Preview (1080 × 1080)
        </div>
        <div
          id="kavach-design-preview"
          className="rounded-xl overflow-hidden bg-black shadow-lg"
        >
          {kind === "scorecard" && renderScorecard()}
          {kind === "milestone" && renderMilestone()}
          {kind === "achievement" && renderAchievement()}
        </div>
      </div>

      {/* Export buttons */}
      <div className="grid grid-cols-2 gap-2 sticky bottom-4">
        <button
          onClick={handleDownload}
          disabled={isExporting}
          className="rounded-lg bg-white/10 hover:bg-white/20 text-white py-3 text-sm font-bold uppercase tracking-widest transition flex items-center justify-center gap-2 disabled:opacity-60"
        >
          <Download className="w-4 h-4" />
          {isExporting ? "..." : "Download"}
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
