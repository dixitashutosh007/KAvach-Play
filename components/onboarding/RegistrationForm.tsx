"use client";

import { useState } from "react";
import { User } from "firebase/auth";
import { motion } from "motion/react";
import { Shield } from "lucide-react";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { normalizeIndianMobile, validateJerseyNumber } from "@/lib/utils";

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

/**
 * Mandatory first-time registration form. Writes both an appUsers doc and
 * a players doc with inviteStatus = "Pending". The store's real-time
 * listener picks up the new docs and the app moves on automatically.
 */
export function RegistrationForm({
  user,
  onLogOut,
  themeStyles,
  accentColor,
  textAccentColor,
}: {
  user: User;
  onLogOut: () => Promise<void>;
  themeStyles: React.CSSProperties;
  accentColor: string;
  textAccentColor: string;
}) {
  const [form, setForm] = useState<FormState>(EMPTY_STATE);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const jerseyError = validateJerseyNumber(form.jerseyNumber);
    if (jerseyError) {
      alert(jerseyError);
      return;
    }
    setIsSubmitting(true);
    try {
      const userDoc = doc(db, "appUsers", user.uid);
      const playerDoc = doc(db, "players", user.uid);
      const normalizedMobile = normalizeIndianMobile(user.phoneNumber || "");
      const normalizedEmergency = normalizeIndianMobile(form.emergencyContact);
      await setDoc(userDoc, {
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
      await setDoc(playerDoc, {
        name: form.name || user.displayName || "",
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
          First Time Here!
        </h2>
        <p className="text-xs text-white/70 mb-6 text-center leading-relaxed">
          Welcome to Kavach Play. Please complete this mandatory registration to submit your join request.
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
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
            disabled={isSubmitting || !form.name}
            className="w-full py-3 px-4 rounded-xl font-bold mt-4 shadow flex items-center justify-center transition-opacity cursor-pointer disabled:opacity-50"
            style={{ backgroundColor: accentColor, color: textAccentColor }}
          >
            {isSubmitting ? "Registering..." : "Submit Request"}
          </button>
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
