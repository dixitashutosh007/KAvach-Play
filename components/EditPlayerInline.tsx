import { useState } from "react";
import { useFinancePlanAssignments } from "@/hooks/useFinancePlanAssignments";
import { assignmentOn, assignmentStatus, describePlan, legacyAssignmentsFor } from "@/lib/finance-plans";
import { getClubCalendarDate } from "@/lib/utils";
import { useStore } from "@/hooks/useStore";
import { Player, FeePlan } from "@/lib/types";
import { dbToInputDate, inputToDbDate, normalizeIndianMobile, validateJerseyNumber } from "@/lib/utils";
import { useAuth } from "@/components/AuthProvider";
import { AuthProviderBadges } from "@/components/AuthProviderBadges";
import { useToast } from "@/components/ui/Toast";

function PlayerFinancePlanSummary({ player, plans }: { player: Player; plans: FeePlan[] }) {
  const { assignments, loading, error } = useFinancePlanAssignments(true);
  const todayKey = getClubCalendarDate().dateString;
  const all = [...assignments, ...legacyAssignmentsFor(player, plans)].filter((a) => a.playerId === player.id);
  const current = assignmentOn(all, player.id, todayKey);
  const upcoming = all.filter((a) => assignmentStatus(a, todayKey) === "scheduled");
  const plan = current ? plans.find((p) => p.id === current.planId) : null;
  return (
    <div className="border border-border bg-surface rounded-xl p-4 space-y-1.5" data-testid="player-finance-plan">
      <h4 className="text-xs font-bold text-text-secondary uppercase tracking-widest">Finance Plan</h4>
      {loading ? (
        <p className="text-xs text-text-muted">Loading…</p>
      ) : error ? (
        <p className="text-xs text-text-muted">{error}</p>
      ) : current ? (
        <p className="text-sm font-bold text-text-primary">
          {current.planName}
          <span className="ml-1 text-xs font-medium text-text-secondary">
            {plan ? `· ${describePlan(plan)}` : ""} · {current.startDate ? `since ${current.startDate}` : "legacy"}
            {current.endDate ? ` · until ${current.endDate}` : ""}
          </span>
        </p>
      ) : (
        <p className="text-sm font-bold text-text-primary">Regular <span className="text-xs font-medium text-text-secondary">· full match fee</span></p>
      )}
      {upcoming.length > 0 && (
        <p className="text-xs text-blue-700">Scheduled: {upcoming.map((u) => `${u.planName} from ${u.startDate}`).join(", ")}</p>
      )}
      <p className="text-[11px] text-text-muted">Assign or end plans in Finance → Other Fees → Finance Plans.</p>
    </div>
  );
}

export function EditPlayerInline({
  player,
  store,
  onCancel,
}: {
  player: Player;
  store: ReturnType<typeof useStore>;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const { user, hasAdminClaim } = useAuth();
  const currentAppUser = store.appUsers.find(u => u.id === user?.uid);
  const isSuperAdmin = !!hasAdminClaim;

  const appUserMatch = store.appUsers.find(
    (u) => u.id === player.id || (u.mobile && player.mobile && normalizeIndianMobile(u.mobile) === normalizeIndianMobile(player.mobile)),
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
    kavachJoiningMonth: player.kavachJoining ? player.kavachJoining.split("/")[0] : "",
    kavachJoiningYear: player.kavachJoining ? player.kavachJoining.split("/")[1] : "",
    totalRuns: player.totalRuns !== undefined ? String(player.totalRuns) : "",
    totalWickets: player.totalWickets !== undefined ? String(player.totalWickets) : "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Admin can leave jersey blank if the player hasn't picked one yet, but
    // if a value is entered it has to obey the club rules (max 3 digits,
    // never "10").
    if (formData.jerseyNumber) {
      const jerseyError = validateJerseyNumber(formData.jerseyNumber);
      if (jerseyError) {
        toast(jerseyError, "error");
        return;
      }
    }
    const { lastPaidAmount, dob, lastPaidDate, studioExpiryDate, kavachJoiningMonth, kavachJoiningYear, totalRuns, totalWickets, ...rest } =
      formData;
    const updatedData: Partial<Player> = {
      ...rest,
      mobile: normalizeIndianMobile(rest.mobile),
      emergencyContact: normalizeIndianMobile(rest.emergencyContact),
      dob: inputToDbDate(dob),
      lastPaidDate: inputToDbDate(lastPaidDate),
      studioExpiryDate: inputToDbDate(studioExpiryDate),
      lastPaidAmount:
        formData.isStudioMember && lastPaidAmount !== ""
          ? Number(lastPaidAmount)
          : undefined,
      kavachJoining: kavachJoiningMonth && kavachJoiningYear
        ? `${kavachJoiningMonth}/${kavachJoiningYear}`
        : undefined,
      totalRuns: totalRuns !== "" ? Number(totalRuns) : undefined,
      totalWickets: totalWickets !== "" ? Number(totalWickets) : undefined,
      // Finance Plan assignments are managed in Finance → Finance Plans (dated,
      // audited, server-side); this editor no longer writes player.feePlanIds.
    };
    await store.updatePlayer(player.id, updatedData);
    // isDesigner used to live here as a super-admin toggle but has
    // moved to Settings → Elevate Player's Role alongside the other
    // admin flags. That keeps role management in one place.
    onCancel();
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="p-4 bg-surface-hover border-t border-border space-y-4"
    >
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-bold text-accent">Edit Profile</h3>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-text-muted hover:text-text-primary"
        >
          Close
        </button>
      </div>

      <div className="bg-surface-hover border border-border rounded-lg px-3 py-2 space-y-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-text-muted block">
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
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-text-secondary">
            Name
          </label>
          <input
            required
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="w-full rounded-lg border border-border bg-surface-hover px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-text-secondary">
            Email
          </label>
          <input
            type="email"
            value={formData.email}
            onChange={(e) =>
              setFormData({ ...formData, email: e.target.value })
            }
            className="w-full rounded-lg border border-border bg-surface-hover px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-text-secondary">
            Mobile
          </label>
          <input
            required
            type="tel"
            value={formData.mobile}
            onChange={(e) =>
              setFormData({ ...formData, mobile: e.target.value })
            }
            className="w-full rounded-lg border border-border bg-surface-hover px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-text-secondary">
            DOB
          </label>
          <input
            type="date"
            value={inputToDbDate(formData.dob)}
            onChange={(e) => setFormData({ ...formData, dob: e.target.value })}
            className="w-full rounded-lg border border-border bg-surface-hover px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-text-secondary">
            KAvach Joining Date
          </label>
          <div className="flex gap-2">
            <select
              value={formData.kavachJoiningMonth}
              onChange={(e) =>
                setFormData({ ...formData, kavachJoiningMonth: e.target.value })
              }
              className="w-full rounded-lg border border-border bg-surface-hover px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
            >
              <option value="">Month</option>
              <option value="01">Jan</option>
              <option value="02">Feb</option>
              <option value="03">Mar</option>
              <option value="04">Apr</option>
              <option value="05">May</option>
              <option value="06">Jun</option>
              <option value="07">Jul</option>
              <option value="08">Aug</option>
              <option value="09">Sep</option>
              <option value="10">Oct</option>
              <option value="11">Nov</option>
              <option value="12">Dec</option>
            </select>
            <select
              value={formData.kavachJoiningYear}
              onChange={(e) =>
                setFormData({ ...formData, kavachJoiningYear: e.target.value })
              }
              className="w-full rounded-lg border border-border bg-surface-hover px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
            >
              <option value="">Year</option>
              {Array.from({ length: 2026 - 2015 + 1 }, (_, i) => 2015 + i).map((year) => (
                <option key={year} value={String(year)}>{year}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-text-secondary">
              Total Runs
            </label>
            <input
              type="number"
              min={0}
              value={formData.totalRuns}
              onChange={(e) => setFormData({ ...formData, totalRuns: e.target.value })}
              className="w-full rounded-lg border border-border bg-surface-hover px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
              placeholder="0"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-text-secondary">
              Total Wickets
            </label>
            <input
              type="number"
              min={0}
              value={formData.totalWickets}
              onChange={(e) => setFormData({ ...formData, totalWickets: e.target.value })}
              className="w-full rounded-lg border border-border bg-surface-hover px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
              placeholder="0"
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-text-secondary">
            Locality
          </label>
          <input
            type="text"
            value={formData.locality}
            onChange={(e) =>
              setFormData({ ...formData, locality: e.target.value })
            }
            className="w-full rounded-lg border border-border bg-surface-hover px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-text-secondary">
            Emergency Contact
          </label>
          <input
            type="tel"
            value={formData.emergencyContact}
            onChange={(e) =>
              setFormData({ ...formData, emergencyContact: e.target.value })
            }
            className="w-full rounded-lg border border-border bg-surface-hover px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-text-secondary">
            Blood Group
          </label>
          <input
            type="text"
            value={formData.bloodGroup}
            onChange={(e) =>
              setFormData({ ...formData, bloodGroup: e.target.value })
            }
            className="w-full rounded-lg border border-border bg-surface-hover px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-text-secondary">
            Chest Size
          </label>
          <select
            value={formData.chestSize}
            onChange={(e) =>
              setFormData({ ...formData, chestSize: e.target.value })
            }
            className="w-full rounded-lg border border-border bg-surface-hover px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none [&>option]:bg-surface font-mono"
          >
            <option value="">Select Size</option>
            {["36", "38", "40", "42", "44", "46", "S", "M", "L", "XL", "XXL"].map((sz) => (
              <option key={sz} value={sz}>{sz}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-text-secondary">
            Jersey No.
          </label>
          <input
            type="text"
            value={formData.jerseyNumber}
            onChange={(e) =>
              setFormData({ ...formData, jerseyNumber: e.target.value })
            }
            className="w-full rounded-lg border border-border bg-surface-hover px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-text-secondary">
            Batting Style
          </label>
          <select
            value={formData.battingStyle}
            onChange={(e) =>
              setFormData({ ...formData, battingStyle: e.target.value })
            }
            className="w-full rounded-lg border border-border bg-surface-hover px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none "
          >
            <option>Right-hand bat</option>
            <option>Left-hand bat</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-text-secondary">
            Bowling Style
          </label>
          <select
            value={formData.bowlingStyle}
            onChange={(e) =>
              setFormData({ ...formData, bowlingStyle: e.target.value })
            }
            className="w-full rounded-lg border border-border bg-surface-hover px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none "
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

      {/* Privileges — super-admins only, only meaningful when the
          player has a linked appUser doc (i.e. they've signed in at
          least once and been provisioned). Toggles write straight to
          appUsers/{uid}; the "last super admin" guard prevents you
          from accidentally demoting the only remaining super-admin. */}
      {isSuperAdmin && appUserMatch && (
        <div className="border border-purple-500/25 bg-purple-500/5 rounded-xl p-4 space-y-3">
          <h4 className="text-xs font-bold text-purple-300 uppercase tracking-widest">
            Privileges
          </h4>
          <p className="text-[10px] text-text-muted leading-relaxed">
            Elevated access to admin surfaces. See Settings for a
            consolidated view of every role and who holds it.
          </p>
          {(() => {
            const superAdminCount = store.appUsers.filter((u) => u.role === "admin").length;
            const isLastSuper =
              appUserMatch.role === "admin" &&
              superAdminCount <= 1 &&
              !hasAdminClaim;
            const isSuperAdminNow = appUserMatch.role === "admin";
            const rows: {
              label: string;
              desc: string;
              checked: boolean;
              disabled: boolean;
              onChange: (checked: boolean) => Promise<void>;
              accent?: boolean;
            }[] = [
              {
                label: "Super Admin",
                desc: "Governed via server custom claim (scripts/set-admin-claim.js). Client toggle disabled for security (SEC-001).",
                checked: isSuperAdminNow,
                disabled: true,
                accent: true,
                onChange: async () => {},
              },
              {
                label: "Studio Admin",
                desc: "Can manage Squad & Studio subscriptions.",
                checked: isSuperAdminNow || !!appUserMatch.isStudioAdmin,
                disabled: isSuperAdminNow,
                onChange: async (checked) =>
                  store.updateAppUserProfile(appUserMatch.id, { isStudioAdmin: checked }),
              },
              {
                label: "Match Admin",
                desc: "Can manage matches, grounds, tournaments & availability.",
                checked: isSuperAdminNow || !!appUserMatch.isMatchAdmin,
                disabled: isSuperAdminNow,
                onChange: async (checked) =>
                  store.updateAppUserProfile(appUserMatch.id, { isMatchAdmin: checked }),
              },
              {
                label: "Finance Admin",
                desc: "Can manage club finances and view reports.",
                checked: isSuperAdminNow || !!appUserMatch.isFinanceAdmin,
                disabled: isSuperAdminNow,
                onChange: async (checked) =>
                  store.updateAppUserProfile(appUserMatch.id, { isFinanceAdmin: checked }),
              },
              {
                label: "Club Admin",
                desc: "Players, Shop, Pulse, Design, Leaderboard, Reminders.",
                checked: isSuperAdminNow || !!appUserMatch.isClubAdmin,
                disabled: isSuperAdminNow,
                onChange: async (checked) =>
                  store.updateAppUserProfile(appUserMatch.id, { isClubAdmin: checked }),
              },
              {
                label: "Designer",
                desc: "Player-level access to Design tab (post templates).",
                checked: isSuperAdminNow || !!appUserMatch.isDesigner,
                disabled: isSuperAdminNow,
                onChange: async (checked) =>
                  store.updateAppUserProfile(appUserMatch.id, { isDesigner: checked }),
              },
            ];
            return rows.map((r) => (
              <label
                key={r.label}
                className={`flex items-start gap-3 p-2 rounded border ${
                  r.disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer hover:bg-surface-hover"
                } ${r.checked ? "bg-surface-hover border-purple-500/20" : "bg-surface-hover border-border"}`}
              >
                <input
                  type="checkbox"
                  checked={r.checked}
                  disabled={r.disabled}
                  onChange={(e) => r.onChange(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded accent-purple-400"
                />
                <div className="min-w-0">
                  <div
                    className={`text-[11px] font-bold uppercase tracking-wider ${r.accent ? "text-accent" : "text-text-primary"}`}
                  >
                    {r.label}
                  </div>
                  <div className="text-[10px] text-text-muted">{r.desc}</div>
                  {r.disabled && r.label === "Super Admin" && (
                    <div className="text-[10px] text-amber-400 mt-0.5">
                      Cannot demote the last super admin.
                    </div>
                  )}
                </div>
              </label>
            ));
          })()}
        </div>
      )}

      {/* Finance Plan — read-only here; managed in Finance → Finance Plans */}
      <PlayerFinancePlanSummary player={player} plans={store.feePlans || []} />

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
            <p className="text-[10px] text-text-muted">
              Enable or disable player&apos;s studio subscription
            </p>
          </div>
          <div className="flex items-center h-[28px] px-2.5 bg-surface-hover border border-accent/20 rounded-lg">
            <input
              type="checkbox"
              id={`isStudioMember-${player.id}`}
              checked={formData.isStudioMember}
              onChange={(e) =>
                setFormData({ ...formData, isStudioMember: e.target.checked })
              }
              className="w-4 h-4 rounded border-border bg-surface-hover text-accent focus:ring-accent accent-accent cursor-pointer animate-pulse"
            />
            <label
              htmlFor={`isStudioMember-${player.id}`}
              className="ml-2 text-[11px] font-bold text-text-primary cursor-pointer select-none"
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
                className="w-full rounded-lg border border-accent/30 bg-surface-hover px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none "
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
                className="w-full rounded-lg border border-accent/30 bg-surface-hover px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
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
                className="w-full rounded-lg border border-accent/30 bg-surface-hover px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
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
                className="w-full rounded-lg border border-accent/30 bg-surface-hover px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
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
