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
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#F6F7F9] z-[50]" />
    );
  }

  // Festive override: during the Independence-Day window the boot screen
  // shows the waving-flag greeting regardless of the configured animation
  // theme. Gated by date so it auto-retires — no admin action needed.
  if (isIndependenceDayWindow()) {
    return <IndependenceDayLoader clubName={clubName} />;
  }

  if (theme === "staggered") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#F6F7F9] z-[50]">
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
          <div className="absolute inset-0 bg-[#A30F2D]/15 blur-xl rounded-full" />
          <Shield className="w-16 h-16 text-[#A30F2D] relative z-10" strokeWidth={1.5} />
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
                i < 6 ? "text-[#171C26]" : "text-[#D51F43]"
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
           className="h-[2px] bg-[#A30F2D]/30 w-32 mt-4"
        />
      </div>
    );
  }

  if (theme === "breathe") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#F6F7F9] z-[50]">
        <motion.div
           animate={{ scale: [1, 1.15, 1] }}
           transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
           className="relative flex flex-col items-center justify-center"
        >
          <motion.div
             animate={{ opacity: [0.15, 0.35, 0.15] }}
             transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
             className="absolute inset-0 bg-[#A30F2D] rounded-full blur-3xl w-40 h-40 -ml-4 mt-[-10px]"
          />
          <Shield className="w-20 h-20 text-[#A30F2D] relative z-10 drop-shadow-[0_0_15px_rgba(163,15,45,0.3)] mb-8" strokeWidth={1} />
          <motion.div
             animate={{ opacity: [0.6, 1, 0.6] }}
             transition={{ duration: 4, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}
             className="text-2xl font-black text-[#171C26] tracking-[0.3em] uppercase flex gap-3 relative z-10"
          >
            <span>KAvach</span>
            <span className="text-[#D51F43] font-light">Play</span>
          </motion.div>
        </motion.div>
      </div>
    );
  }

  if (theme === "minimal") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#F6F7F9] z-[50]">
        <div className="relative mb-6 flex items-center justify-center">
          <motion.div
             animate={{ rotate: 360 }}
             transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
             className="absolute inset-0 w-16 h-16 border-[3px] border-[#A30F2D]/20 border-t-[#D51F43] rounded-full"
          />
          <Shield className="w-8 h-8 text-[#A30F2D] m-4" strokeWidth={2} />
        </div>
        <motion.div
           animate={{ opacity: [0.6, 1, 0.6] }}
           transition={{ duration: 2, repeat: Infinity }}
           className="text-[#667085] uppercase tracking-widest text-[10px] font-bold"
        >
          KAvach Play
        </motion.div>
      </div>
    );
  }

  if (theme === "kinetic") {
    const text = "KAvach PLAY".split("");
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#F6F7F9] z-[50]">
        <motion.div
           initial={{ scale: 0.8, opacity: 0 }}
           animate={{ scale: [0.8, 1, 1, 0.8], opacity: [0, 1, 1, 0] }}
           transition={{ duration: 3, times: [0, 0.1, 0.8, 1], repeat: Infinity, ease: "easeInOut" }}
           className="mb-8"
        >
          <Shield className="w-12 h-12 text-[#A30F2D] drop-shadow-[0_0_10px_rgba(163,15,45,0.3)]" strokeWidth={1.5} />
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
              className="text-4xl font-black text-[#A30F2D] tracking-wider"
              style={{ marginRight: char === ' ' ? '1rem' : '0' }}
            >
              {char}
            </motion.span>
          ))}
        </div>
        <motion.div
           animate={{ width: ["0%", "200px", "0%"] }}
           transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
           className="h-[1px] bg-[#A30F2D]/40"
        />
      </div>
    );
  }

  // Default theme: "radar"
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#F6F7F9] bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-white via-[#F6F7F9] to-[#E5E7EB] z-[50] overflow-hidden">
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
            opacity: [0.15, 0.35, 0.15],
          }}
          transition={{
            duration: 2.5,
            repeat: Infinity,
            ease: "easeInOut",
          }}
          className="absolute inset-0 bg-[#A30F2D]/15 rounded-full blur-[60px] w-64 h-64 -mt-16 -ml-16"
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
            className="absolute inset-0 border-[3px] border-dashed border-[#A30F2D]/20 rounded-full"
          />

          {/* Internal rotating solid ring */}
          <motion.div
            animate={{ rotate: -360 }}
            transition={{
              duration: 4,
              repeat: Infinity,
              ease: "linear",
            }}
            className="absolute inset-3 border-[3px] border-t-[#D51F43] border-r-transparent border-b-[#A30F2D] border-l-transparent rounded-full shadow-[0_0_15px_rgba(213,31,67,0.2)]"
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
            className="bg-white backdrop-blur-sm p-5 rounded-full border border-border shadow-lg"
          >
            <Shield className="w-10 h-10 text-[#A30F2D] drop-shadow-[0_0_8px_rgba(163,15,45,0.4)]" strokeWidth={1.5} />
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
              className="text-3xl font-black text-[#171C26] tracking-[0.2em]"
            >
              KAvach
            </motion.span>
            <motion.span
              initial={{ x: 20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.6, duration: 0.6, ease: "easeOut" }}
              className="text-3xl font-black text-[#D51F43] tracking-[0.2em] drop-shadow-[0_0_8px_rgba(213,31,67,0.3)]"
            >
              PLAY
            </motion.span>
          </div>

          <div className="flex justify-center gap-2 relative">
            <motion.div
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: "100%", opacity: 1 }}
                transition={{ delay: 1, duration: 1 }}
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[1px] bg-gradient-to-r from-transparent via-[#A30F2D]/30 to-transparent w-full"
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
                className="w-2 h-2 bg-[#D51F43] rounded-full drop-shadow-[0_0_5px_rgba(213,31,67,0.5)] z-10"
              />
            ))}
          </div>
          
          <motion.div
             initial={{ opacity: 0 }}
             animate={{ opacity: 1 }}
             transition={{ delay: 1.5, duration: 1 }}
             className="mt-6 text-[#667085] uppercase tracking-[0.3em] text-[9px] font-bold"
          >
             Loading Portal
          </motion.div>
        </motion.div>
      </motion.div>
    </div>
  );
}
