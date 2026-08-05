/**
 * Personal Player Profile & Onboarding (`components/ProfileTab.tsx`)
 *
 * Provides the interface for a player to view and edit their own detailed profile
 * (dob, playing style, emergency contacts, etc). When new users first log in and
 * their invitation status is pending/unverified, this tab handles the initial
 * data collection form required for admin approval. Can also display personal
 * finance views specific to the current user.
 */
import { useStore } from "@/hooks/useStore";
import { useAuth } from "./AuthProvider";
import { useState } from "react";
import { Calendar, MapPin, User, Save, CreditCard, Plus, Trash2, Edit2, PieChart, ChevronDown, ChevronRight } from "lucide-react";
import { formatDate, dbToInputDate, inputToDbDate } from "@/lib/utils";
import Image from "next/image";

import { PlayerFinanceView } from "./FinanceTab";
import { PollInteraction, PollResults } from "./OpinionTab";
import { AuthProviderBadges } from "./AuthProviderBadges";
import { db } from "@/lib/firebase";
import { doc, setDoc, deleteDoc, updateDoc, serverTimestamp } from "firebase/firestore";
export function ProfileTab({
  store,
  forceEdit,
}: {
  store: ReturnType<typeof useStore>;
  forceEdit?: boolean;
}) {
  const { user, hasAdminClaim, logOut } = useAuth();
  const appUser = store.appUsers.find((u) => u.id === user?.uid);
  const userPhone = user?.phoneNumber || appUser?.mobile;
  const linkedPlayer =
    store.players.find((p) => p.id === user?.uid || p.authUid === user?.uid) ||
    store.players.find((p) => p.mobile && userPhone && p.mobile === userPhone);
  const isAdmin = appUser?.role === "admin" || hasAdminClaim;

  const hasMissingMandatory =
    !isAdmin &&
    (!appUser?.name ||
      !appUser?.dob ||
      !appUser?.locality ||
      !appUser?.bloodGroup ||
      !appUser?.emergencyContact ||
      !appUser?.mobile);
  const [isEditing, setIsEditing] = useState(forceEdit || hasMissingMandatory);
  // Email is provider-controlled ONLY if Firebase Auth gave us one (Google or
  // email/password sign-in). For phone-OTP-only users, user.email is null and
  // the field must be editable so they can supply an email during registration.
  const emailIsProviderLocked = !!user?.email;
  const [formData, setFormData] = useState({
    name: appUser?.name || linkedPlayer?.name || user?.displayName || "",
    email: appUser?.email || user?.email || linkedPlayer?.email || "",
    dob: dbToInputDate(appUser?.dob || linkedPlayer?.dob),
    locality: appUser?.locality || linkedPlayer?.locality || "",
    bloodGroup: appUser?.bloodGroup || linkedPlayer?.bloodGroup || "",
    emergencyContact:
      appUser?.emergencyContact || linkedPlayer?.emergencyContact || "",
    battingStyle:
      appUser?.battingStyle || linkedPlayer?.battingStyle || "Right-hand bat",
    bowlingStyle:
      appUser?.bowlingStyle || linkedPlayer?.bowlingStyle || "Right-arm medium",
    isWicketKeeper:
      appUser?.isWicketKeeper ?? linkedPlayer?.isWicketKeeper ?? false,
    chestSize: appUser?.chestSize || linkedPlayer?.chestSize || "",
    jerseyNumber: appUser?.jerseyNumber || linkedPlayer?.jerseyNumber || "",
    mobile: appUser?.mobile || linkedPlayer?.mobile || user?.phoneNumber || "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const processedForm = {
      ...formData,
      dob: inputToDbDate(formData.dob),
    };
    
    // Auto-create appUser if it was somehow missing but they are editing profile.
    // Prefer the user-typed email (formData.email) over provider fallbacks so
    // phone-OTP users who just filled in their email actually get it saved.
    if (!appUser && user) {
      await store.updateAppUserProfile(user.uid, {
        ...processedForm,
        email: processedForm.email || user.email || linkedPlayer?.email || "",
        role: "player",
        isStudioMember: linkedPlayer?.isStudioMember || false,
      });
    } else if (appUser) {
      await store.updateAppUserProfile(appUser.id, processedForm);
    }

    // Also sync to the player document auto-created on sign up
    // We locate the player document by matching the OLD mobile, or the user's ID
    const playerToUpdate =
      store.players.find((p) => p.mobile && p.mobile === formData.mobile) ||
      store.players.find((p) => p.mobile && p.mobile === (appUser?.mobile || linkedPlayer?.mobile)) ||
      store.players.find(
        (p) => p.id === (appUser?.id || user?.uid) || p.authUid === (appUser?.id || user?.uid),
      );

    if (formData.mobile && playerToUpdate) {
      // Find if another admin-created player with the NEW mobile already exists
      const duplicatePlayer = store.players.find(
        (p) => p.mobile === formData.mobile && p.id !== playerToUpdate.id,
      );
      if (duplicatePlayer) {
        // Keep the admin's record intact to preserve stats/payments
        // Delete the old playerToUpdate (since we are merging into the admin's)
        await store.deletePlayer(playerToUpdate.id);
        // Update the admin's record with new profile
        await store.updatePlayer(duplicatePlayer.id, {
          ...processedForm,
          authUid: user?.uid,
          name: processedForm.name || "Unknown",
          inviteStatus: "Pending",
        });
        setIsEditing(false);
        return;
      }
    }

    if (playerToUpdate) {
      await store.updatePlayer(playerToUpdate.id, {
        ...processedForm,
        authUid: user?.uid,
        name: processedForm.name || "Unknown",
        inviteStatus:
          formData.mobile && playerToUpdate.inviteStatus !== "Verified"
            ? "Pending"
            : playerToUpdate.inviteStatus || "Unverified",
      });
    } else {
      // The user has an appUser document but no player document (e.g. was deleted by admin)
      // We must recreate the player document so they can be pending again
      await store.addPlayer({
        ...processedForm,
        name: processedForm.name || appUser?.name || "Unknown",
        mobile: processedForm.mobile || appUser?.mobile || "",
        email: appUser?.email || user?.email || "",
        inviteStatus: "Pending",
        authUid: appUser?.id || user?.uid || ""
      });
      // Note: addPlayer generates a new ID. The next render will link them via mobile matching.
    }
    setIsEditing(false);
  };

  // Look up payments for this user based on ID or mobile matching Players array
  const myPayments = linkedPlayer
    ? store.payments.filter((p) => p.playerId === linkedPlayer.id).slice(0, 5) // Recent 5
    : [];

  return (
    <div className="space-y-6 flex flex-col">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold tracking-tight text-white mb-2">
          My Overview
        </h2>
      </div>

      {store.appConfig?.isStudioEnabled &&
        (appUser?.isStudioMember || linkedPlayer?.isStudioMember) && (
          <div className="glass rounded-xl border border-accent/30 bg-accent/10 p-5 relative overflow-hidden">
            <div className="absolute right-0 top-0 w-32 h-32 bg-accent opacity-20 blur-3xl rounded-full translate-x-10 -translate-y-10 pointer-events-none"></div>
            <div className="relative z-10 flex flex-col gap-4">
              <div className="flex gap-4 items-center">
                <div className="w-14 h-14 bg-accent/20 border justify-center items-center flex rounded-full border-accent text-accent mb-[2px] shadow-[0_0_15px_rgba(16,185,129,0.4)] shrink-0">
                  <span className="text-2xl">🎬</span>
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-base font-black text-accent uppercase tracking-widest leading-none mb-1">
                    Studio Member
                  </h4>
                  <p className="text-sm text-white/80">
                    Active Premium Club Membership
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 pt-3 border-t border-accent/20 text-xs font-mono">
                <div>
                  <span className="text-white/50 block mb-1">LAST PAID</span>
                  <span className="text-white font-bold text-sm">
                    {(appUser?.lastPaidAmount ?? linkedPlayer?.lastPaidAmount)
                      ? `₹${appUser?.lastPaidAmount ?? linkedPlayer?.lastPaidAmount}`
                      : "—"}
                  </span>
                </div>
                <div>
                  <span className="text-white/50 block mb-1">PAID ON</span>
                  <span className="text-white font-bold text-sm">
                    {formatDate(
                      appUser?.lastPaidDate ?? linkedPlayer?.lastPaidDate,
                    )}
                  </span>
                </div>
                <div className="col-span-2">
                  <span className="text-white/50 block mb-1">
                    MEMBERSHIP VALID TILL
                  </span>
                  <span className="text-accent font-black text-lg">
                    {formatDate(
                      appUser?.studioExpiryDate ??
                        linkedPlayer?.studioExpiryDate ??
                        appUser?.studioEndDate ??
                        linkedPlayer?.studioEndDate,
                    )}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

      <div className="flex items-center justify-between pt-4">
        <h2 className="text-lg font-bold tracking-tight text-white">
          Personal Profile
        </h2>
        {!isEditing && (
          <button
            onClick={() => setIsEditing(true)}
            className="rounded-full bg-white/10 px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-white hover:bg-white/20 transition"
          >
            Edit
          </button>
        )}
      </div>

      <div className="glass rounded-xl p-5 relative overflow-hidden">
        {/* Decorative background element */}
        <div className="absolute right-0 top-0 w-32 h-32 bg-white opacity-5 blur-3xl rounded-full translate-x-10 -translate-y-10 pointer-events-none"></div>

        {isEditing ? (
          <form onSubmit={handleSubmit} className="space-y-4 relative z-10">
            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-white/70">
                Full Name <span className="text-red-400">*</span>
              </label>
              <input
                required
                type="text"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                className="w-full rounded-lg border border-glass-border bg-white/5 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-white/70">
                  Email <span className="text-red-400">*</span>
                </label>
                <input
                  required
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  disabled={emailIsProviderLocked}
                  placeholder="you@example.com"
                  className={
                    emailIsProviderLocked
                      ? "w-full rounded-lg border border-glass-border bg-black/20 px-3 py-2 text-sm text-white/50 cursor-not-allowed"
                      : "w-full rounded-lg border border-glass-border bg-white/5 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
                  }
                />
                {emailIsProviderLocked && (
                  <p className="mt-1 text-[9px] text-white/40 leading-tight">
                    Email is managed by your sign-in provider (Google) and can't be changed here.
                  </p>
                )}
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-white/70">
                  Mobile Number <span className="text-red-400">*</span>
                </label>
                <input
                  required
                  type="tel"
                  value={formData.mobile}
                  onChange={(e) =>
                    setFormData({ ...formData, mobile: e.target.value })
                  }
                  className="w-full rounded-lg border border-glass-border bg-white/5 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
                  placeholder="e.g. 9876543210"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-white/70">
                  Date of Birth
                  <span className="text-red-400">*</span>
                </label>
                <input
                  required
                  type="date"
                  value={inputToDbDate(formData.dob)}
                  onChange={(e) =>
                    setFormData({ ...formData, dob: e.target.value })
                  }
                  className="w-full rounded-lg border border-glass-border bg-white/5 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-white/70">
                  Locality/Area <span className="text-red-400">*</span>
                </label>
                <input
                  required
                  type="text"
                  value={formData.locality}
                  onChange={(e) =>
                    setFormData({ ...formData, locality: e.target.value })
                  }
                  className="w-full rounded-lg border border-glass-border bg-white/5 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-white/70">
                  Blood Group <span className="text-red-400">*</span>
                </label>
                <select
                  required
                  value={formData.bloodGroup}
                  onChange={(e) =>
                    setFormData({ ...formData, bloodGroup: e.target.value })
                  }
                  className="w-full rounded-lg border border-glass-border bg-white/5 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none [&>option]:bg-emerald-950"
                >
                  <option value="" disabled>
                    Select
                  </option>
                  <option value="A+">A+</option>
                  <option value="A-">A-</option>
                  <option value="B+">B+</option>
                  <option value="B-">B-</option>
                  <option value="O+">O+</option>
                  <option value="O-">O-</option>
                  <option value="AB+">AB+</option>
                  <option value="AB-">AB-</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-white/70">
                  Emergency Contact <span className="text-red-400">*</span>
                </label>
                <input
                  required
                  type="tel"
                  value={formData.emergencyContact}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      emergencyContact: e.target.value,
                    })
                  }
                  className="w-full rounded-lg border border-glass-border bg-white/5 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-white/70">
                  Batting Style
                </label>
                <select
                  value={formData.battingStyle}
                  onChange={(e) =>
                    setFormData({ ...formData, battingStyle: e.target.value })
                  }
                  className="w-full rounded-lg border border-glass-border bg-white/5 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none [&>option]:bg-emerald-950"
                >
                  <option value="Right-hand bat">Right-hand bat</option>
                  <option value="Left-hand bat">Left-hand bat</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-white/70">
                  Bowling Style
                </label>
                <select
                  value={formData.bowlingStyle}
                  onChange={(e) =>
                    setFormData({ ...formData, bowlingStyle: e.target.value })
                  }
                  className="w-full rounded-lg border border-glass-border bg-white/5 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none [&>option]:bg-emerald-950"
                >
                  <option value="Right-arm fast">Right-arm fast</option>
                  <option value="Right-arm medium">Right-arm medium</option>
                  <option value="Right-arm spin">Right-arm spin</option>
                  <option value="Left-arm fast">Left-arm fast</option>
                  <option value="Left-arm spin">Left-arm spin</option>
                  <option value="None">None</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-white/70">
                  Wicket Keeper
                </label>
                <select
                  value={formData.isWicketKeeper ? "Yes" : "No"}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      isWicketKeeper: e.target.value === "Yes",
                    })
                  }
                  className="w-full rounded-lg border border-glass-border bg-white/5 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none [&>option]:bg-emerald-950"
                >
                  <option value="No">No</option>
                  <option value="Yes">Yes</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-white/70">
                  Jersey Size & No.
                </label>
                <div className="flex gap-2">
                  <select
                    value={formData.chestSize}
                    onChange={(e) =>
                      setFormData({ ...formData, chestSize: e.target.value })
                    }
                    className="w-1/2 rounded-lg border border-glass-border bg-black/40 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none [&>option]:bg-neutral-950 font-mono"
                  >
                    <option value="">Select Size</option>
                    {["36", "38", "40", "42", "44", "46", "S", "M", "L", "XL", "XXL"].map((sz) => (
                      <option key={sz} value={sz}>{sz}</option>
                    ))}
                  </select>
                  {isAdmin ? (
                    <input
                      type="text"
                      placeholder="Number"
                      value={formData.jerseyNumber}
                      onChange={(e) =>
                        setFormData({ ...formData, jerseyNumber: e.target.value })
                      }
                      className="w-1/2 rounded-lg border border-glass-border bg-white/5 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
                    />
                  ) : (
                    <input
                      type="text"
                      disabled
                      placeholder="No."
                      value={formData.jerseyNumber || "—"}
                      className="w-1/2 rounded-lg border border-glass-border/40 bg-white/5 opacity-50 cursor-not-allowed px-3 py-2 text-sm text-white focus:outline-none font-mono"
                      title="Jersey number can only be assigned or edited by administrators."
                    />
                  )}
                </div>
              </div>
            </div>

            <div className="pt-3 flex gap-2">
              {!hasMissingMandatory && (
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="flex-1 rounded-lg bg-white/5 py-2.5 text-sm font-bold text-white hover:bg-white/10 transition"
                >
                  Cancel
                </button>
              )}
              <button
                type="submit"
                className="flex-1 rounded-lg bg-accent py-2.5 text-sm font-bold text-black border border-accent flex items-center justify-center gap-2 hover:bg-accent/90 transition shadow-lg"
              >
                <Save className="w-4 h-4" /> Save
              </button>
            </div>
          </form>
        ) : (
          <div className="relative z-10 space-y-6">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-accent/20 border-2 border-accent/40 flex items-center justify-center shrink-0 shadow-[0_0_15px_rgba(var(--color-accent),0.2)]">
                {user?.photoURL || appUser?.photoURL ? (
                  <Image
                    src={user?.photoURL || appUser?.photoURL || ""}
                    width={64}
                    height={64}
                    alt="Profile"
                    className="w-full h-full rounded-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <User className="w-8 h-8 text-accent" />
                )}
              </div>
              <div className="min-w-0">
                <h3 className="font-bold text-xl text-white truncate">
                  {appUser?.name || linkedPlayer?.name || "Set your name"}
                </h3>
                <p className="text-white/60 font-mono text-xs">
                  {appUser?.mobile || linkedPlayer?.mobile || "Add mobile to link"}
                </p>
                <p className="inline-block mt-1 px-2 py-0.5 rounded border border-accent/30 bg-accent/10 text-accent text-[10px] font-bold uppercase tracking-widest">
                  {appUser?.role || "player"}
                </p>
              </div>
            </div>

            <div className="pt-1">
              <p className="text-white/40 text-[10px] font-bold uppercase tracking-widest mb-1.5">
                Sign-in method
              </p>
              <AuthProviderBadges
                providers={
                  user?.providerData?.map((p) => p.providerId).filter(Boolean) ||
                  appUser?.authProviders
                }
                firstLinkedAt={appUser?.firstProviderLinkedAt}
                lastLoginAt={appUser?.lastLoginAt}
                showTimestamps
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-3">
                <div>
                  <p className="text-white/40 text-[10px] font-bold uppercase tracking-widest flex items-center gap-1 mb-1">
                    <Calendar className="w-3 h-3" /> DOB
                  </p>
                  <p className="text-sm font-medium">
                    {formatDate(appUser?.dob || linkedPlayer?.dob)}
                  </p>
                </div>
                <div>
                  <p className="text-white/40 text-[10px] font-bold uppercase tracking-widest flex items-center gap-1 mb-1">
                    <MapPin className="w-3 h-3" /> Area
                  </p>
                  <p className="text-sm font-medium">
                    {appUser?.locality || linkedPlayer?.locality || "—"}
                  </p>
                </div>
              </div>
              <div className="space-y-3 pl-4 border-l border-glass-border">
                <div>
                  <p className="text-white/40 text-[10px] font-bold uppercase tracking-widest mb-1">
                    Batting
                  </p>
                  <p className="text-sm font-medium">
                    {appUser?.battingStyle || linkedPlayer?.battingStyle || "—"}
                  </p>
                </div>
                <div>
                  <p className="text-white/40 text-[10px] font-bold uppercase tracking-widest mb-1">
                    Bowling
                  </p>
                  <p className="text-sm font-medium">
                    {appUser?.bowlingStyle || linkedPlayer?.bowlingStyle || "—"}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {!isEditing && linkedPlayer?.id && (
        <div className="pt-2">
          <OutOfPlayConfig store={store} playerId={linkedPlayer.id} />
        </div>
      )}

      <div className="pt-2">
        <PlayerFinanceView
          store={store}
          userId={user?.uid}
        />
      </div>

      {!isEditing && linkedPlayer?.id && (
        <div className="pt-2">
          <OpinionResults store={store} playerId={linkedPlayer.id} />
        </div>
      )}

      {!isEditing && (
        <div className="pt-6 pb-2 space-y-4">
          <a
            href="/legal"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-white/5 border border-white/10 py-3 text-sm font-bold text-white/50 hover:bg-white/10 hover:text-white transition"
          >
            Privacy Policy & Terms of Service
            <CreditCard className="w-4 h-4 hidden" />
          </a>
          <button
            onClick={() => logOut()}
            className="w-full rounded-lg bg-red-500/10 border border-red-500/20 py-3 text-sm font-bold text-red-400 hover:bg-red-500/20 transition flex items-center justify-center gap-2"
          >
            Sign Out of Account
          </button>
        </div>
      )}
    </div>
  );
}

function OutOfPlayConfig({
  store,
  playerId,
}: {
  store: ReturnType<typeof useStore>;
  playerId: string;
}) {
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [comment, setComment] = useState("");

  const outOfPlays = store.outOfPlays
    .filter((o) => o.playerId === playerId)
    .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());

  const handleSave = async () => {
    if (!startDate || !endDate) {
      alert("Please select both start and end dates.");
      return;
    }
    if (new Date(startDate) > new Date(endDate)) {
      alert("End date cannot be before start date.");
      return;
    }

    try {
      if (editingId) {
        const existing = outOfPlays.find((o) => o.id === editingId);
        if (existing) {
          await store.updateOutOfPlay({
            ...existing,
            startDate,
            endDate,
            comment,
          });
        }
      } else {
        await store.addOutOfPlay({
          playerId,
          startDate,
          endDate,
          comment,
        });
      }
      setIsAdding(false);
      setEditingId(null);
      setStartDate("");
      setEndDate("");
      setComment("");
    } catch (e) {
      console.error(e);
      alert("Failed to save Out of Play data.");
    }
  };

  const startEdit = (o: any) => {
    setEditingId(o.id);
    setStartDate(o.startDate);
    setEndDate(o.endDate);
    setComment(o.comment || "");
    setIsAdding(true);
  };

  const handleDelete = async (id: string) => {
    if (confirm("Are you sure you want to delete this record?")) {
      await store.deleteOutOfPlay(id);
    }
  };

  return (
    <div className="glass rounded-xl sm:border border-glass-border p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold text-white tracking-widest uppercase">
          Out of Play Calendar
        </h3>
        {!isAdding && (
          <button
            onClick={() => {
              setEditingId(null);
              setStartDate("");
              setEndDate("");
              setComment("");
              setIsAdding(true);
            }}
            className="text-accent hover:bg-accent/10 p-1.5 rounded-lg transition"
          >
            <Plus className="w-5 h-5" />
          </button>
        )}
      </div>

      {isAdding && (
        <div className="mb-6 space-y-3 bg-black/20 p-4 rounded-xl border border-glass-border">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-white/50 mb-1 block">
                Start Date
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full bg-white/5 border border-glass-border rounded-lg px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-white/50 mb-1 block">
                End Date
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full bg-white/5 border border-glass-border rounded-lg px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-white/50 mb-1 block">
              Reason / Comment (Optional)
            </label>
            <input
              type="text"
              placeholder="e.g. Vacation, Injury"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              className="w-full bg-white/5 border border-glass-border rounded-lg px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
            />
          </div>
          <div className="flex gap-2 pt-2">
            <button
              onClick={() => setIsAdding(false)}
              className="flex-1 rounded-lg bg-white/5 py-2 text-xs font-bold text-white hover:bg-white/10 transition"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="flex-1 rounded-lg bg-accent py-2 text-xs font-bold text-black hover:bg-accent/90 transition"
            >
              {editingId ? "Update" : "Save"}
            </button>
          </div>
        </div>
      )}

      {outOfPlays.length === 0 && !isAdding ? (
        <div className="text-center py-6 text-white/40 text-sm italic">
          You have no upcoming out-of-play dates.
        </div>
      ) : (
        <div className="space-y-2">
          {outOfPlays.map((o) => (
            <div
              key={o.id}
              className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-glass-border"
            >
              <div>
                <div className="text-sm font-bold text-white">
                  {formatDate(o.startDate)} - {formatDate(o.endDate)}
                </div>
                {o.comment && (
                  <div className="text-xs text-white/50">{o.comment}</div>
                )}
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => startEdit(o)}
                  className="p-1.5 text-white/40 hover:text-white transition"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleDelete(o.id)}
                  className="p-1.5 text-red-400/60 hover:text-red-400 transition"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OpinionResults({ store, playerId }: { store: ReturnType<typeof useStore>, playerId: string }) {
  const [editingPollId, setEditingPollId] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const myResponses = store.pollResponses.filter(r => r.playerId === playerId);
  
  if (myResponses.length === 0) return null;

  const handleDelete = async (responseId: string) => {
    if (!confirm("Delete your response?")) return;
    try {
      await deleteDoc(doc(db, "pollResponses", responseId));
    } catch (err: any) {
      alert("Error: " + err.message);
    }
  };

  const handleUpdateVote = async (pollId: string, val: any) => {
    const responseId = pollId + "_" + playerId;
    try {
      await updateDoc(doc(db, "pollResponses", responseId), {
        response: val,
        updatedAt: serverTimestamp(),
      });
      setEditingPollId(null);
    } catch (err: any) {
      alert("Error updating vote: " + err.message);
    }
  };

  return (
    <div className="glass rounded-xl sm:border border-glass-border p-5">
      <button 
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between cursor-pointer"
      >
        <div className="flex items-center gap-3">
          <PieChart className="w-5 h-5 text-accent" />
          <h3 className="text-sm font-bold text-white tracking-widest uppercase">
            Pulse
          </h3>
        </div>
        {isExpanded ? <ChevronDown className="w-4 h-4 text-white/50" /> : <ChevronRight className="w-4 h-4 text-white/50" />}
      </button>
      {isExpanded && (
        <div className="space-y-3 mt-4">
          {myResponses.map(resp => {
            const poll = store.polls.find(p => p.id === resp.pollId);
            if (!poll) return null; 
            if (!poll.isActive) return null; 

            if (editingPollId === poll.id) {
              return (
                <div key={resp.id} className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-4">
                  <div className="flex justify-between items-start gap-4">
                    <h4 className="text-sm font-bold text-white leading-tight">{poll.title}</h4>
                    <button onClick={() => setEditingPollId(null)} className="text-white/50 hover:text-white shrink-0">Cancel</button>
                  </div>
                  <PollInteraction poll={poll} onVote={(val) => handleUpdateVote(poll.id, val)} />
                </div>
              );
            }

            return (
              <div key={resp.id} className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-3 group">
                <div className="flex justify-between items-start gap-4">
                  <div>
                    <h4 className="text-sm font-bold text-white mb-1 leading-tight">{poll.title}</h4>
                    <p className="text-xs text-accent">
                      Your Vote: {Array.isArray(resp.response) ? resp.response.join(", ") : resp.response}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition shrink-0">
                    <button onClick={() => setEditingPollId(poll.id)} className="p-2 text-white/50 hover:text-white rounded bg-white/5 hover:bg-white/10 transition">
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => handleDelete(resp.id)} className="p-2 text-red-500/50 hover:text-red-500 rounded bg-white/5 hover:bg-white/10 transition">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <PollResults poll={poll} store={store} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
