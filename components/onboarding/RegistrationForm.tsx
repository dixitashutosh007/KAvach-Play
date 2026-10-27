"use client";

import { useState, useMemo } from "react";
import { User } from "firebase/auth";
import { motion } from "motion/react";
import { Shield, AlertTriangle, LogIn } from "lucide-react";
import { doc, writeBatch, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { normalizeIndianMobile, validateJerseyNumber, findExistingPlayer } from "@/lib/utils";
import { createNotification } from "@/lib/notifications";

interface FormState {
  name: string;
  email: string;
  dob: string;
  locality: string;
  bloodGroup: string;
  emergencyContact: string;
  battingStyle: string;
  bowlingStyle: string;
  isWicketKeeper: boolean;
  chestSize: string;
  jerseyNumber: string;
}

const EMPTY_STATE: FormState = {
  name: "",
  email: "",
  dob: "",
  locality: "",
  bloodGroup: "",
  emergencyContact: "",
  battingStyle: "",
  bowlingStyle: "",
  isWicketKeeper: false,
  chestSize: "",
  jerseyNumber: "",
};

type PlayerInfo = { id: string; name: string; mobile: string; email?: string; disabled?: boolean; mergedInto?: string };

function getLoginMethod(player: PlayerInfo): { method: string; detail: string } {
  const hasMobile = !!player.mobile && player.mobile.length >= 10;
  const hasEmail = !!player.email && player.email.includes("@");
  if (hasMobile && hasEmail) {
    const masked = player.mobile.replace(/(\d{2})\d{6}(\d{2})/, "$1******$2");
    return { method: "Mobile OTP or Google Sign-In", detail: `Mobile: ${masked} | Email: ${player.email}` };
  }
  if (hasMobile) {
    const masked = player.mobile.replace(/(\d{2})\d{6}(\d{2})/, "$1******$2");
    return { method: "Mobile OTP", detail: `Mobile: ${masked}` };
  }
  if (hasEmail) {
    return { method: "Google Sign-In", detail: `Email: ${player.email}` };
  }
  return { method: "your original login method", detail: "Contact admin for help" };
}

/**
 * Mandatory first-time registration form. Writes both an appUsers doc and
 * a players doc with inviteStatus = "Pending". The store's real-time
 * listener picks up the new docs and the app moves on automatically.
 *
 * Blocks registration entirely if phone or email already exists in the
 * players collection, and guides them to log in instead.
 */
export function RegistrationForm({
  user,
  players,
  onLogOut,
  themeStyles,
  accentColor,
  textAccentColor,
}: {
  user: User;
  players: PlayerInfo[];
  onLogOut: () => Promise<void>;
  themeStyles: React.CSSProperties;
  accentColor: string;
  textAccentColor: string;
}) {
  const [form, setForm] = useState<FormState>(EMPTY_STATE);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  const duplicate = useMemo(() => {
    const normalizedMobile = normalizeIndianMobile(user.phoneNumber || "");
    const emailToCheck = form.email || user.email || "";
    return findExistingPlayer(players, normalizedMobile, emailToCheck, user.uid);
  }, [players, form.email, user.phoneNumber, user.email, user.uid]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (duplicate) return;

    const jerseyError = validateJerseyNumber(form.jerseyNumber);
    if (jerseyError) {
      alert(jerseyError);
      return;
    }

    setIsSubmitting(true);
    try {
      const normalizedMobile = normalizeIndianMobile(user.phoneNumber || "");
      const normalizedEmergency = normalizeIndianMobile(form.emergencyContact);
      const userDoc = doc(db, "appUsers", user.uid);
      const playerDoc = doc(db, "players", user.uid);
      const batch = writeBatch(db);
      batch.set(userDoc, {
        email: form.email || user.email || "",
        name: form.name || user.displayName || "",
        photoURL: user.photoURL || "",
        role: "player",
        mobile: normalizedMobile,
        isStudioMember: false,
        dob: form.dob,
        locality: form.locality,
        bloodGroup: form.bloodGroup,
        emergencyContact: normalizedEmergency,
        battingStyle: form.battingStyle,
        bowlingStyle: form.bowlingStyle,
        isWicketKeeper: form.isWicketKeeper,
        chestSize: form.chestSize,
        jerseyNumber: form.jerseyNumber,
      });
      batch.set(playerDoc, {
        name: form.name || user.displayName || "",
        email: form.email || user.email || "",
        mobile: normalizedMobile,
        inviteStatus: "Pending",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        dob: form.dob,
        locality: form.locality,
        bloodGroup: form.bloodGroup,
        emergencyContact: normalizedEmergency,
        battingStyle: form.battingStyle,
        bowlingStyle: form.bowlingStyle,
        isWicketKeeper: form.isWicketKeeper,
        chestSize: form.chestSize,
        jerseyNumber: form.jerseyNumber,
      });
      await batch.commit();
      const playerName = form.name || user.displayName || "Unknown";
      createNotification(
        "admin",
        "New Player Request",
        `Player ${playerName} has submitted a join request and is awaiting approval.`,
        "email",
        { type: "player_request", playerId: user.uid },
      );
      createNotification(
        user.uid,
        "Welcome to the Club",
        `Welcome ${playerName}! Your request to join is currently pending approval.`,
        "email",
      );
    } catch (err) {
      console.error("Registration error:", err);
      alert("Registration failed. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const inputCls =
    "w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-accent";
  const selectCls =
    "w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-accent [&>option]:bg-emerald-950";
  const labelCls =
    "text-[10px] font-bold uppercase tracking-wider text-white/60";

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center p-4 text-center overflow-y-auto"
      style={themeStyles}
    >
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass max-w-md w-full p-8 rounded-2xl border border-white/10 shadow-xl text-left my-8"
      >
        <div className="mb-6 mt-2 text-center text-accent flex justify-center">
          <Shield className="w-10 h-10" />
        </div>
        <h2 className="text-xl font-bold text-white mb-2 text-center">
          Join Kavach Cricket Club
        </h2>
        <p className="text-xs text-white/70 mb-4 text-center leading-relaxed">
          Fill in <strong className="text-white">all fields</strong> below to submit your join request.
          Your request will be sent for admin approval only after you submit this form.
        </p>

        {/* Mandatory notice banner */}
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-3 py-2 mb-5">
          <p className="text-[11px] text-amber-300 leading-relaxed text-center">
            All fields marked <strong>*</strong> are mandatory.
            Your join request is <strong>NOT submitted</strong> until you fill every field and click &quot;Submit Join Request&quot;.
          </p>
        </div>

        {/* Duplicate blocker */}
        {duplicate && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-5 space-y-3">
            <div className="flex items-center gap-2 justify-center">
              <AlertTriangle className="w-5 h-5 text-red-400" />
              <span className="text-sm font-bold text-red-300">Player Already Exists</span>
            </div>
            <p className="text-xs text-white/70 leading-relaxed text-center">
              A profile for <strong className="text-white">&quot;{duplicate.player.name}&quot;</strong> already
              exists with the same {duplicate.matchedOn === "mobile" ? "mobile number" : "email address"}.
            </p>
            <div className="bg-black/30 rounded-lg px-3 py-2 space-y-1">
              <p className="text-[11px] text-white/60">
                <span className="text-white/40">Login using:</span>{" "}
                <strong className="text-emerald-400">{getLoginMethod(duplicate.player).method}</strong>
              </p>
              <p className="text-[10px] text-white/40">
                {getLoginMethod(duplicate.player).detail}
              </p>
            </div>
            <button
              type="button"
              onClick={onLogOut}
              className="w-full py-2.5 px-4 rounded-xl font-bold bg-accent text-black text-xs flex items-center justify-center gap-2 cursor-pointer hover:opacity-90 transition"
            >
              <LogIn className="w-3.5 h-3.5" />
              Go to Login
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className={`space-y-4 ${duplicate ? "opacity-40 pointer-events-none select-none" : ""}`}>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1 text-left">
              <label className={labelCls}>Full Name *</label>
              <input
                type="text"
                required
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                className={inputCls}
                placeholder="John Doe"
              />
            </div>
            <div className="space-y-1 text-left">
              <label className={labelCls}>Email Address *</label>
              <input
                required
                type="email"
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
                className={inputCls}
                placeholder="john@example.com"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1 text-left">
              <label className={labelCls}>Date of Birth *</label>
              <input
                required
                type="date"
                value={form.dob}
                onChange={(e) => set("dob", e.target.value)}
                className={inputCls}
              />
            </div>
            <div className="space-y-1 text-left">
              <label className={labelCls}>Locality/Area *</label>
              <input
                required
                type="text"
                value={form.locality}
                onChange={(e) => set("locality", e.target.value)}
                className={inputCls}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1 text-left">
              <label className={labelCls}>Blood Group *</label>
              <select
                required
                value={form.bloodGroup}
                onChange={(e) => set("bloodGroup", e.target.value)}
                className={selectCls}
              >
                <option value="" disabled>Select</option>
                {["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"].map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1 text-left">
              <label className={labelCls}>Emergency Contact *</label>
              <input
                required
                type="tel"
                value={form.emergencyContact}
                onChange={(e) => set("emergencyContact", e.target.value)}
                className={inputCls}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1 text-left">
              <label className={labelCls}>Batting Style *</label>
              <select
                required
                value={form.battingStyle}
                onChange={(e) => set("battingStyle", e.target.value)}
                className={selectCls}
              >
                <option value="" disabled>Select</option>
                <option value="Right-hand bat">Right-hand bat</option>
                <option value="Left-hand bat">Left-hand bat</option>
              </select>
            </div>
            <div className="space-y-1 text-left">
              <label className={labelCls}>Bowling Style *</label>
              <select
                required
                value={form.bowlingStyle}
                onChange={(e) => set("bowlingStyle", e.target.value)}
                className={selectCls}
              >
                <option value="" disabled>Select</option>
                <option value="Right-arm fast">Right-arm fast</option>
                <option value="Right-arm medium">Right-arm medium</option>
                <option value="Right-arm offbreak">Right-arm offbreak</option>
                <option value="Right-arm legbreak">Right-arm legbreak</option>
                <option value="Left-arm fast">Left-arm fast</option>
                <option value="Left-arm medium">Left-arm medium</option>
                <option value="Slow left-arm orthodox">Slow left-arm orthodox</option>
                <option value="Slow left-arm chinaman">Slow left-arm chinaman</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1 text-left">
              <label className={labelCls}>Wicket Keeper</label>
              <select
                value={form.isWicketKeeper ? "Yes" : "No"}
                onChange={(e) => set("isWicketKeeper", e.target.value === "Yes")}
                className="w-full px-3 py-2 bg-neutral-950 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-accent [&>option]:bg-neutral-950 font-mono"
              >
                <option value="No">No</option>
                <option value="Yes">Yes</option>
              </select>
            </div>
            <div className="space-y-1 text-left">
              <label className={labelCls}>Chest Size *</label>
              <select
                required
                value={form.chestSize}
                onChange={(e) => set("chestSize", e.target.value)}
                className="w-full px-3 py-2 bg-neutral-950 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-accent [&>option]:bg-neutral-950 font-mono"
              >
                <option value="">Select Size</option>
                {["36", "38", "40", "42", "44", "46", "S", "M", "L", "XL", "XXL"].map((sz) => (
                  <option key={sz} value={sz}>{sz}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1 text-left">
              <label className={labelCls}>Jersey Number *</label>
              <input
                required
                type="text"
                inputMode="numeric"
                pattern="\d{1,3}"
                maxLength={3}
                value={form.jerseyNumber}
                onChange={(e) =>
                  set(
                    "jerseyNumber",
                    e.target.value.replace(/\D/g, "").slice(0, 3),
                  )
                }
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-accent font-mono"
                placeholder="e.g. 7"
              />
              <p className="text-[9px] text-white/40 mt-0.5 leading-tight">
                Up to 3 digits. Number 10 is reserved and cannot be used.
              </p>
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting || !form.name || !!duplicate}
            className="w-full py-3 px-4 rounded-xl font-bold mt-4 shadow flex items-center justify-center transition-opacity cursor-pointer disabled:opacity-50"
            style={{ backgroundColor: accentColor, color: textAccentColor }}
          >
            {isSubmitting ? "Submitting..." : "Submit Join Request"}
          </button>
          <p className="text-[10px] text-white/40 text-center leading-tight">
            After submitting, the admin will review and approve your request.
          </p>
          <button
            type="button"
            onClick={onLogOut}
            className="w-full py-3 px-4 rounded-xl font-bold mt-2 border border-white/10 text-white/70 hover:text-white hover:bg-white/5 transition-all text-xs"
          >
            Cancel / Sign Out
          </button>
        </form>
      </motion.div>
    </div>
  );
}
