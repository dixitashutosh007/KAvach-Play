"use client";

/**
 * Independence Day festive surfaces (`components/festive/IndependenceDay.tsx`)
 *
 * Two contained, vivid tricolour surfaces used only around 15 August:
 *   - IndependenceDayLoader: a full-screen waving Indian flag + greeting,
 *     shown on the boot/loading screen.
 *   - IndependenceDayBanner: a dismissible tricolour ribbon at the top of
 *     the player home page.
 *
 * These are deliberately NOT a global theme. The app renders white text
 * on a dark chrome everywhere, so the flag's saffron/white/green can't be
 * the page background without hurting readability. Here we OWN the whole
 * surface (loader) or a self-contained card (banner), so we control the
 * text colour against each band and can use the real, vivid flag colours:
 *   Saffron #FF9933 · White #FFFFFF · Green #138808 · Chakra navy #000080
 *
 * isIndependenceDayWindow() gates both so they appear a day or two before
 * the 15th and auto-retire on the 17th — no manual cleanup.
 */

import { useState } from "react";
import { motion } from "motion/react";
import { X } from "lucide-react";

const SAFFRON = "#FF9933";
const GREEN = "#138808";
const NAVY = "#000080";

/** True during the Independence-Day display window (13–16 Aug, local time). */
export function isIndependenceDayWindow(now: Date = new Date()): boolean {
  // getMonth() is 0-indexed; 7 === August.
  return now.getMonth() === 7 && now.getDate() >= 13 && now.getDate() <= 16;
}

/** 24-spoke Ashoka Chakra, drawn in navy. `spin` adds a slow rotation. */
function Chakra({
  className = "",
  spin = false,
  spinSeconds = 12,
}: {
  className?: string;
  spin?: boolean;
  spinSeconds?: number;
}) {
  const spokes = Array.from({ length: 24 }).map((_, i) => {
    const a = (i * 15 * Math.PI) / 180;
    const inner = 8;
    const outer = 44;
    return {
      x1: 50 + inner * Math.cos(a),
      y1: 50 + inner * Math.sin(a),
      x2: 50 + outer * Math.cos(a),
      y2: 50 + outer * Math.sin(a),
      key: i,
    };
  });
  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      style={
        spin
          ? { animation: `idChakraSpin ${spinSeconds}s linear infinite` }
          : undefined
      }
    >
      <circle cx="50" cy="50" r="46" fill="none" stroke={NAVY} strokeWidth="4" />
      <circle cx="50" cy="50" r="6" fill={NAVY} />
      {spokes.map((s) => (
        <line
          key={s.key}
          x1={s.x1}
          y1={s.y1}
          x2={s.x2}
          y2={s.y2}
          stroke={NAVY}
          strokeWidth="1.6"
        />
      ))}
      {/* small dots at spoke ends for the authentic chakra look */}
      {spokes.map((s) => (
        <circle key={`d${s.key}`} cx={s.x2} cy={s.y2} r="1.1" fill={NAVY} />
      ))}
    </svg>
  );
}

/** Shared keyframes injected once wherever a festive surface mounts. */
function FestiveKeyframes() {
  return (
    <style>{`
      @keyframes idChakraSpin { to { transform: rotate(360deg); } }
      @keyframes idFlagWave {
        0%, 100% { transform: perspective(700px) rotateY(-7deg) skewY(0.6deg); }
        50%      { transform: perspective(700px) rotateY(7deg)  skewY(-0.6deg); }
      }
      @keyframes idShine {
        0%   { background-position: -150% 0; }
        100% { background-position: 250% 0; }
      }
      @keyframes idFadeUp {
        from { opacity: 0; transform: translateY(14px); }
        to   { opacity: 1; transform: translateY(0); }
      }
    `}</style>
  );
}

/* --------------------------- Loader ---------------------------- */

export function IndependenceDayLoader({ clubName }: { clubName?: string }) {
  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-8 overflow-hidden bg-[#070b14]">
      <FestiveKeyframes />

      {/* soft tricolour glow behind the flag */}
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          background:
            "radial-gradient(circle at 50% 38%, rgba(255,153,51,0.18) 0%, rgba(19,136,8,0.12) 45%, transparent 70%)",
        }}
      />

      {/* Waving flag */}
      <div className="relative" style={{ animation: "idFlagWave 2.6s ease-in-out infinite" }}>
        <div
          className="relative overflow-hidden rounded-[6px] shadow-2xl"
          style={{
            // Explicit width AND height (2:3 ratio) — don't rely on
            // aspect-ratio, which was collapsing the flex bands on desktop
            // so only the white middle showed. The three bands are a
            // hard-stop gradient so they're always exact equal thirds.
            width: "min(72vw, 300px)",
            height: "min(48vw, 200px)",
            background:
              `linear-gradient(180deg, ${SAFFRON} 0 33.333%, #ffffff 33.333% 66.666%, ${GREEN} 66.666% 100%)`,
          }}
        >
          {/* chakra centred on the white middle third */}
          <div
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{ height: "28%", aspectRatio: "1 / 1" }}
          >
            <Chakra className="h-full w-full" spin spinSeconds={10} />
          </div>
          {/* moving cloth shine */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage:
                "linear-gradient(105deg, transparent 30%, rgba(255,255,255,0.35) 48%, transparent 66%)",
              backgroundSize: "200% 100%",
              animation: "idShine 3.2s linear infinite",
              mixBlendMode: "overlay",
            }}
          />
          {/* faint vertical fold shading for depth */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage:
                "repeating-linear-gradient(90deg, rgba(0,0,0,0.06) 0px, transparent 14px, rgba(255,255,255,0.05) 28px, transparent 42px)",
            }}
          />
        </div>
        {/* flag pole */}
        <div className="absolute left-[-10px] top-[-6px] bottom-[-14px] w-[6px] rounded-full bg-gradient-to-b from-[#c9a24a] to-[#7a5c1e] shadow" />
      </div>

      {/* Greeting */}
      <div className="relative z-10 text-center px-6" style={{ animation: "idFadeUp 0.7s ease-out 0.2s both" }}>
        <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
          Happy Independence Day
        </h1>
        <div className="mt-2 flex items-center justify-center gap-2 text-sm font-bold uppercase tracking-[0.3em]">
          <span style={{ color: SAFFRON }}>15</span>
          <span className="text-white/70">August</span>
          <span style={{ color: GREEN }}>1947</span>
        </div>
        {clubName && (
          <p className="mt-3 text-[11px] font-semibold uppercase tracking-widest text-white/50">
            {clubName} salutes the spirit of India 🇮🇳
          </p>
        )}
      </div>
    </div>
  );
}

/* --------------------------- Banner ---------------------------- */

export function IndependenceDayBanner({ clubName }: { clubName?: string }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div className="md:col-span-12 w-full">
      <FestiveKeyframes />
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="relative overflow-hidden rounded-2xl shadow-lg"
      >
        {/* Three EQUAL tricolour bands (real flag proportions). Fixed
            banner height + flex-1 on each band guarantees exact thirds
            regardless of content. All text lives on the WHITE middle
            band in navy for maximum readability; saffron and green
            carry colour only. */}
        <div className="flex flex-col h-[152px] sm:h-[176px]">
          <div className="flex-1" style={{ background: SAFFRON }} />
          <div className="flex-1 relative bg-white px-4 sm:px-6 flex items-center gap-3 sm:gap-4">
            <Chakra className="h-10 w-10 sm:h-12 sm:w-12 shrink-0" spin spinSeconds={14} />
            <div className="min-w-0 flex-1">
              <h3
                className="text-base sm:text-xl font-black tracking-tight leading-tight"
                style={{ color: NAVY }}
              >
                Happy Independence Day
              </h3>
              <p className="text-[11px] sm:text-sm font-semibold" style={{ color: "#1a2a5c" }}>
                {clubName ? `${clubName} • ` : ""}15 August 1947 · Jai Hind 🇮🇳
              </p>
            </div>
            {/* subtle diagonal shine across the white band */}
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                backgroundImage:
                  "linear-gradient(105deg, transparent 40%, rgba(255,153,51,0.10) 50%, rgba(19,136,8,0.10) 60%, transparent 70%)",
                backgroundSize: "200% 100%",
                animation: "idShine 5s linear infinite",
              }}
            />
            <button
              onClick={() => setDismissed(true)}
              aria-label="Dismiss"
              className="relative z-10 shrink-0 rounded-full p-1.5 text-[#000080]/50 hover:text-[#000080] hover:bg-black/5 transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1" style={{ background: GREEN }} />
        </div>
      </motion.div>
    </div>
  );
}
