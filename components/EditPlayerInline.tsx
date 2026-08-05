import { useState } from "react";
import { useStore } from "@/hooks/useStore";
import { Player } from "@/lib/types";
import { dbToInputDate, inputToDbDate } from "@/lib/utils";
import { useAuth } from "@/components/AuthProvider";
import { AuthProviderBadges } from "@/components/AuthProviderBadges";

export function EditPlayerInline({
  player,
  store,
  onCancel,
}: {
  player: Player;
  store: ReturnType<typeof useStore>;
  onCancel: () => void;
}) {
  const { user, hasAdminClaim } = useAuth();
  const currentAppUser = store.appUsers.find(u => u.id === user?.uid);
  const isSuperAdmin = currentAppUser?.role === "admin" || hasAdminClaim;

  const appUserMatch = store.appUsers.find(
    (u) => u.id === player.id || (u.mobile && u.mobile === player.mobile),
  );

  const [formData, setFormData] = useState({
    name: player.name || "",
    email: player.email || appUserMatch?.email || "",
    mobile: player.mobile || "",
    dob: dbToInputDate(player.dob),
    locality: player.locality || "",
    bloodGroup: player.bloodGroup || "",
    emergencyContact: player.emergencyContact || "",
    battingStyle: player.battingStyle || "Right-hand bat",
    bowlingStyle: player.bowlingStyle || "Right-arm medium",
    isWicketKeeper: player.isWicketKeeper || false,
    chestSize: player.chestSize || "",
    jerseyNumber: player.jerseyNumber || "",
    isStudioMember: player.isStudioMember || false,
    lastPaidDate: dbToInputDate(player.lastPaidDate),
    lastPaidAmount:
      player.lastPaidAmount !== undefined ? String(player.lastPaidAmount) : "",
    studioExpiryDate: dbToInputDate(
      player.studioExpiryDate || player.studioEndDate,
    ),
    studioPlan: player.studioPlan || "Trial",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const { lastPaidAmount, dob, lastPaidDate, studioExpiryDate, ...rest } =
      formData;
    const updatedData: Partial<Player> = {
      ...rest,
      dob: inputToDbDate(dob),
      lastPaidDate: inputToDbDate(lastPaidDate),
      studioExpiryDate: inputToDbDate(studioExpiryDate),
      lastPaidAmount:
        formData.isStudioMember && lastPaidAmount !== ""
          ? Number(lastPaidAmount)
          : undefined,
    };
    await store.updatePlayer(player.id, updatedData);
    onCancel();
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="p-4 bg-black/40 border-t border-glass-border space-y-4"
    >
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-bold text-accent">Edit Profile</h3>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-white/50 hover:text-white"
        >
          Close
        </button>
      </div>

      <div className="bg-white/5 border border-glass-border rounded-lg px-3 py-2 space-y-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-white/50 block">
          Sign-in method
        </span>
        <AuthProviderBadges
          providers={appUserMatch?.authProviders}
          firstLinkedAt={appUserMatch?.firstProviderLinkedAt}
          lastLoginAt={appUserMatch?.lastLoginAt}
          size="xs"
          emptyLabel="Never signed in"
          showTimestamps
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-white/70">
            Name
          </label>
          <input
            required
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="w-full rounded-lg border border-glass-border bg-white/5 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-white/70">
            Email
          </label>
          <input
            type="email"
            value={formData.email}
            onChange={(e) =>
              setFormData({ ...formData, email: e.target.value })
            }
            className="w-full rounded-lg border border-glass-border bg-white/5 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-white/70">
            Mobile
          </label>
          <input
            required
            type="tel"
            value={formData.mobile}
            onChange={(e) =>
              setFormData({ ...formData, mobile: e.target.value })
            }
            className="w-full rounded-lg border border-glass-border bg-white/5 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-white/70">
            DOB
          </label>
          <input
            type="date"
            value={inputToDbDate(formData.dob)}
            onChange={(e) => setFormData({ ...formData, dob: e.target.value })}
            className="w-full rounded-lg border border-glass-border bg-white/5 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-white/70">
            Locality
          </label>
          <input
            type="text"
            value={formData.locality}
            onChange={(e) =>
              setFormData({ ...formData, locality: e.target.value })
            }
            className="w-full rounded-lg border border-glass-border bg-white/5 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-white/70">
            Emergency Contact
          </label>
          <input
            type="tel"
            value={formData.emergencyContact}
            onChange={(e) =>
              setFormData({ ...formData, emergencyContact: e.target.value })
            }
            className="w-full rounded-lg border border-glass-border bg-white/5 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-white/70">
            Blood Group
          </label>
          <input
            type="text"
            value={formData.bloodGroup}
            onChange={(e) =>
              setFormData({ ...formData, bloodGroup: e.target.value })
            }
            className="w-full rounded-lg border border-glass-border bg-white/5 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-white/70">
            Chest Size
          </label>
          <select
            value={formData.chestSize}
            onChange={(e) =>
              setFormData({ ...formData, chestSize: e.target.value })
            }
            className="w-full rounded-lg border border-glass-border bg-black/40 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none [&>option]:bg-neutral-950 font-mono"
          >
            <option value="">Select Size</option>
            {["36", "38", "40", "42", "44", "46", "S", "M", "L", "XL", "XXL"].map((sz) => (
              <option key={sz} value={sz}>{sz}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-white/70">
            Jersey No.
          </label>
          <input
            type="text"
            value={formData.jerseyNumber}
            onChange={(e) =>
              setFormData({ ...formData, jerseyNumber: e.target.value })
            }
            className="w-full rounded-lg border border-glass-border bg-white/5 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-white/70">
            Batting Style
          </label>
          <select
            value={formData.battingStyle}
            onChange={(e) =>
              setFormData({ ...formData, battingStyle: e.target.value })
            }
            className="w-full rounded-lg border border-glass-border bg-white/5 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none [&>option]:bg-emerald-950"
          >
            <option>Right-hand bat</option>
            <option>Left-hand bat</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-white/70">
            Bowling Style
          </label>
          <select
            value={formData.bowlingStyle}
            onChange={(e) =>
              setFormData({ ...formData, bowlingStyle: e.target.value })
            }
            className="w-full rounded-lg border border-glass-border bg-white/5 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none [&>option]:bg-emerald-950"
          >
            <option>Right-arm fast</option>
            <option>Right-arm medium</option>
            <option>Right-arm spin</option>
            <option>Left-arm fast</option>
            <option>Left-arm medium</option>
            <option>Left-arm spin</option>
            <option>None</option>
          </select>
        </div>
      </div>

      {/* Studio Membership Admin control */}
      <div className="border border-accent/25 bg-accent/5 rounded-xl p-4 space-y-4 relative overflow-hidden">
        <div className="absolute top-0 right-0 p-3 opacity-10">
          <span className="text-4xl">🎬</span>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-xs font-bold text-accent uppercase tracking-widest">
              Studio Membership
            </h4>
            <p className="text-[10px] text-white/50">
              Enable or disable player&apos;s studio subscription
            </p>
          </div>
          <div className="flex items-center h-[28px] px-2.5 bg-black/40 border border-accent/20 rounded-lg">
            <input
              type="checkbox"
              id={`isStudioMember-${player.id}`}
              checked={formData.isStudioMember}
              onChange={(e) =>
                setFormData({ ...formData, isStudioMember: e.target.checked })
              }
              className="w-4 h-4 rounded border-glass-border bg-black/40 text-accent focus:ring-accent accent-accent cursor-pointer animate-pulse"
            />
            <label
              htmlFor={`isStudioMember-${player.id}`}
              className="ml-2 text-[11px] font-bold text-white cursor-pointer select-none"
            >
              Studio Member
            </label>
          </div>
        </div>

        {formData.isStudioMember && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-accent/10">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-accent/80">
                Membership Plan
              </label>
              <select
                value={formData.studioPlan}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    studioPlan: e.target.value as any,
                  })
                }
                className="w-full rounded-lg border border-accent/30 bg-black/40 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none [&>option]:bg-emerald-950"
              >
                <option value="Trial">Trial</option>
                <option value="1M">1 Month</option>
                <option value="3M">3 Months</option>
                <option value="6M">6 Months</option>
                <option value="12M">12 Months</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-accent/80">
                Last Paid Date
              </label>
              <input
                type="date"
                value={inputToDbDate(formData.lastPaidDate)}
                onChange={(e) =>
                  setFormData({ ...formData, lastPaidDate: e.target.value })
                }
                className="w-full rounded-lg border border-accent/30 bg-black/40 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-accent/80">
                Last Paid Amount (₹)
              </label>
              <input
                type="number"
                placeholder="e.g. 500"
                value={formData.lastPaidAmount}
                onChange={(e) =>
                  setFormData({ ...formData, lastPaidAmount: e.target.value })
                }
                className="w-full rounded-lg border border-accent/30 bg-black/40 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-accent/80">
                Studio Expiry Date{" "}
                <span className="text-red-400 font-bold">*</span>
              </label>
              <input
                required={formData.isStudioMember}
                type="date"
                value={inputToDbDate(formData.studioExpiryDate)}
                onChange={(e) =>
                  setFormData({ ...formData, studioExpiryDate: e.target.value })
                }
                className="w-full rounded-lg border border-accent/30 bg-black/40 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
              />
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-2 pt-2">
        <button
          type="submit"
          className="flex-1 rounded-lg bg-accent py-2 text-sm font-bold text-black border border-accent/10 hover:bg-accent/90 transition shadow-lg"
        >
          Save Profile
        </button>
      </div>
    </form>
  );
}
