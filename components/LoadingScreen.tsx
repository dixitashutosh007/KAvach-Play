"use client";

import { useState, useEffect } from "react";
import { motion } from "motion/react";
import { Shield } from "lucide-react";
import {
  IndependenceDayLoader,
  isIndependenceDayWindow,
} from "@/components/festive/IndependenceDay";

export function LoadingScreen({
  theme: propTheme,
  clubName,
}: {
  theme?: "radar" | "kinetic" | "minimal" | "staggered" | "breathe";
  clubName?: string;
}) {
  const [theme, setTheme] = useState<"radar" | "kinetic" | "minimal" | "staggered" | "breathe">("radar");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (propTheme) {
      setTheme(propTheme);
    } else {
      const saved = localStorage.getItem("kavach_loading_theme");
      if (saved) {
        setTheme(saved as any);
      }
    }
  }, [propTheme]);

  if (!mounted) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#022c22] z-[50]" />
    );
  }

  // Festive override: during the Independence-Day window the boot screen
  // shows the waving-flag greeting regardless of the configured animation
  // theme. Gated by date so it auto-retires — no admin action needed.
  // Checked after `mounted` so server and first client render agree
  // (avoids a hydration mismatch from Date differing SSR vs client).
  if (isIndependenceDayWindow()) {
    return <IndependenceDayLoader clubName={clubName} />;
  }

  if (theme === "staggered") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#022c22] z-[50]">
        <motion.div
          initial={{ y: -50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{
            type: "spring",
            stiffness: 260,
            damping: 20,
            duration: 1
          }}
          className="mb-6 relative"
        >
          <div className="absolute inset-0 bg-emerald-500/30 blur-xl rounded-full" />
          <Shield className="w-16 h-16 text-emerald-400 relative z-10" strokeWidth={1.5} />
        </motion.div>
        
        <div className="flex overflow-hidden">
          {["K", "A", "v", "a", "c", "h", " ", "P", "L", "A", "Y"].map((char, i) => (
            <motion.span
              key={i}
              initial={{ y: "100%", opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{
                delay: 0.5 + i * 0.05,
                duration: 0.5,
                ease: "backOut"
              }}
              className={`text-2xl font-black tracking-widest ${
                i < 6 ? "text-white" : "text-emerald-400"
              }`}
              style={{ marginRight: char === ' ' ? '0.5rem' : '0' }}
            >
              {char}
            </motion.span>
          ))}
        </div>
        
        <motion.div
           initial={{ opacity: 0 }}
           animate={{ opacity: [0, 1, 0] }}
           transition={{ delay: 1.5, duration: 2, repeat: Infinity }}
           className="h-[2px] bg-emerald-500/50 w-32 mt-4"
        />
      </div>
    );
  }

  if (theme === "breathe") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#022c22] z-[50]">
        <motion.div
           animate={{ scale: [1, 1.15, 1] }}
           transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
           className="relative flex flex-col items-center justify-center"
        >
          <motion.div
             animate={{ opacity: [0.3, 0.7, 0.3] }}
             transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
             className="absolute inset-0 bg-emerald-500 rounded-full blur-3xl w-40 h-40 -ml-4 mt-[-10px]"
          />
          <Shield className="w-20 h-20 text-emerald-300 relative z-10 drop-shadow-[0_0_15px_rgba(52,211,153,0.5)] mb-8" strokeWidth={1} />
          <motion.div
             animate={{ opacity: [0.5, 1, 0.5] }}
             transition={{ duration: 4, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}
             className="text-2xl font-black text-white tracking-[0.3em] uppercase flex gap-3 relative z-10"
          >
            <span>KAvach</span>
            <span className="text-emerald-400 font-light">Play</span>
          </motion.div>
        </motion.div>
      </div>
    );
  }

  if (theme === "minimal") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#022c22] z-[50]">
        <div className="relative mb-6 flex items-center justify-center">
          <motion.div
             animate={{ rotate: 360 }}
             transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
             className="absolute inset-0 w-16 h-16 border-[3px] border-emerald-500/20 border-t-emerald-400 rounded-full"
          />
          <Shield className="w-8 h-8 text-emerald-400 m-4" strokeWidth={2} />
        </div>
        <motion.div
           animate={{ opacity: [0.5, 1, 0.5] }}
           transition={{ duration: 2, repeat: Infinity }}
           className="text-emerald-400/80 uppercase tracking-widest text-[10px] font-bold"
        >
          KAvach Play
        </motion.div>
      </div>
    );
  }

  if (theme === "kinetic") {
    const text = "KAvach PLAY".split("");
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#022c22] z-[50]">
        <motion.div
           initial={{ scale: 0.8, opacity: 0 }}
           animate={{ scale: [0.8, 1, 1, 0.8], opacity: [0, 1, 1, 0] }}
           transition={{ duration: 3, times: [0, 0.1, 0.8, 1], repeat: Infinity, ease: "easeInOut" }}
           className="mb-8"
        >
          <Shield className="w-12 h-12 text-emerald-400 drop-shadow-[0_0_10px_rgba(52,211,153,0.5)]" strokeWidth={1.5} />
        </motion.div>
        
        <div className="flex mb-8">
          {text.map((char, index) => (
            <motion.span
              key={index}
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 1, 1, 0] }}
              transition={{
                duration: 3,
                times: [0, 0.1, 0.8, 1],
                delay: index * 0.15,
                repeat: Infinity,
                ease: "easeInOut"
              }}
              className="text-4xl font-black text-emerald-400 tracking-wider"
              style={{ marginRight: char === ' ' ? '1rem' : '0' }}
            >
              {char}
            </motion.span>
          ))}
        </div>
        <motion.div
           animate={{ width: ["0%", "200px", "0%"] }}
           transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
           className="h-[1px] bg-emerald-500/50"
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#022c22] bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-[#034032] to-[#01140f] z-[50] overflow-hidden">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="relative flex flex-col items-center"
      >
        {/* Pulsing background glow */}
        <motion.div
          animate={{
            scale: [1, 1.2, 1],
            opacity: [0.2, 0.5, 0.2],
          }}
          transition={{
            duration: 2.5,
            repeat: Infinity,
            ease: "easeInOut",
          }}
          className="absolute inset-0 bg-emerald-500/20 rounded-full blur-[60px] w-64 h-64 -mt-16 -ml-16"
        />

        <div className="relative flex items-center justify-center w-32 h-32">
          {/* External rotating dashed ring */}
          <motion.div
            animate={{ rotate: 360 }}
            transition={{
              duration: 8,
              repeat: Infinity,
              ease: "linear",
            }}
            className="absolute inset-0 border-[3px] border-dashed border-emerald-500/30 rounded-full"
          />

          {/* Internal rotating solid ring */}
          <motion.div
            animate={{ rotate: -360 }}
            transition={{
              duration: 4,
              repeat: Infinity,
              ease: "linear",
            }}
            className="absolute inset-3 border-[3px] border-t-emerald-400 border-r-transparent border-b-emerald-400 border-l-transparent rounded-full shadow-[0_0_15px_rgba(52,211,153,0.3)]"
          />

          <motion.div
            animate={{
              y: [0, -8, 0],
            }}
            transition={{
              duration: 2.5,
              repeat: Infinity,
              ease: "easeInOut",
            }}
            className="bg-black/30 backdrop-blur-sm p-5 rounded-full border border-emerald-500/20 shadow-[0_0_30px_rgba(52,211,153,0.2)]"
          >
            <Shield className="w-10 h-10 text-emerald-400 drop-shadow-[0_0_10px_rgba(52,211,153,0.8)]" strokeWidth={1.5} />
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.8 }}
          className="mt-10 text-center flex flex-col items-center"
        >
          <div className="flex items-center gap-2 overflow-hidden mb-5">
            <motion.span
              initial={{ x: -20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.6, duration: 0.6, ease: "easeOut" }}
              className="text-3xl font-black text-white tracking-[0.2em]"
            >
              KAvach
            </motion.span>
            <motion.span
              initial={{ x: 20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.6, duration: 0.6, ease: "easeOut" }}
              className="text-3xl font-black text-emerald-400 tracking-[0.2em] drop-shadow-[0_0_8px_rgba(52,211,153,0.5)]"
            >
              PLAY
            </motion.span>
          </div>

          <div className="flex justify-center gap-2 relative">
            <motion.div
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: "100%", opacity: 1 }}
                transition={{ delay: 1, duration: 1 }}
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[1px] bg-gradient-to-r from-transparent via-emerald-500/50 to-transparent w-full"
            />
            {[...Array(3)].map((_, i) => (
              <motion.div
                key={i}
                animate={{
                  scale: [1, 1.8, 1],
                  opacity: [0.3, 1, 0.3],
                }}
                transition={{
                  duration: 1.2,
                  repeat: Infinity,
                  delay: i * 0.2,
                  ease: "easeInOut"
                }}
                className="w-2 h-2 bg-emerald-400 rounded-full drop-shadow-[0_0_5px_rgba(52,211,153,0.8)] z-10"
              />
            ))}
          </div>
          
          <motion.div
             initial={{ opacity: 0 }}
             animate={{ opacity: 1 }}
             transition={{ delay: 1.5, duration: 1 }}
             className="mt-6 text-emerald-400/60 uppercase tracking-[0.3em] text-[9px] font-bold"
          >
             Loading Portal
          </motion.div>
        </motion.div>
      </motion.div>
    </div>
  );
}
