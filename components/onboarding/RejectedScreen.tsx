"use client";

import { User } from "firebase/auth";
import { X } from "lucide-react";
import { doc, setDoc, serverTimestamp, getDocFromServer } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Player } from "@/lib/types";
import { useStore } from "@/hooks/useStore";
import { useToast } from "@/components/ui/Toast";

/**
 * Shown when the admin has rejected a player. Contains an "official email"
 * simulation and — if the 3-day quiet period has elapsed — a Resubmit
 * button that also does a server-time check to defeat client clock tampering.
 */
export function RejectedScreen({
  player,
  user,
  clubName,
  now,
  store,
  onLogOut,
  themeStyles,
}: {
  player: Player;
  user: User;
  clubName: string;
  now: number;
  store: ReturnType<typeof useStore>;
  onLogOut: () => Promise<void>;
  themeStyles: React.CSSProperties;
}) {
  const { toast } = useToast();
  const rejectDate = player.rejectedAt ? new Date(player.rejectedAt) : null;
  const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
  const timeRemaining =
    rejectDate && now ? rejectDate.getTime() + threeDaysMs - now : 0;
  const hoursRemaining = Math.max(0, Math.ceil(timeRemaining / (1000 * 60 * 60)));
  const daysRemaining = Math.max(0, Math.ceil(timeRemaining / (1000 * 60 * 60 * 24)));
  const canRetry = timeRemaining <= 0;

  const handleResubmit = async () => {
    try {
      const pingRef = doc(db, "appUsers", user.uid);
      await setDoc(pingRef, { _ping: serverTimestamp() }, { merge: true });
      const snap = await getDocFromServer(pingRef);
      const serverTime = snap.data()?._ping?.toMillis();
      if (serverTime) {
        const rejectedAtMs = player.rejectedAt
          ? new Date(player.rejectedAt).getTime()
          : 0;
        if (serverTime < rejectedAtMs + threeDaysMs) {
          toast("Quiet period lockout is still active. Local system time modification detected.");
          return;
        }
      }
    } catch (e) {
      console.error("Lockout validation failed:", e);
      toast("Failed to validate server time securely. Try again.", "error");
      return;
    }

    await store.updatePlayer(player.id, {
      inviteStatus: "Pending",
      rejectedAt: undefined,
    });
  };

  const domainSuffix = clubName.toLowerCase().replace(/[^a-z]/g, "") || "kavach";

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center p-4"
      style={themeStyles}
    >
      <div className="bg-surface p-8 rounded-2xl max-w-lg w-full text-center space-y-6 border border-red-500/30 shadow-[0_15px_40px_rgba(239,68,68,0.15)]">
        <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-2 border border-red-500/30 animate-pulse">
          <X className="w-8 h-8 text-red-500" />
        </div>

        <div>
          <h2 className="font-extrabold text-xl text-text-primary tracking-wide uppercase">
            Request Declined
          </h2>
          <p className="text-xs text-text-secondary mt-2">
            Your registration has been rejected by the administrator. Below is
            the official email notification sent to your registered address:
          </p>
        </div>

        <div className="bg-black/45 border border-red-500/20 rounded-xl p-4 text-left font-mono space-y-2 text-[11px] select-all">
          <div className="border-b border-border pb-2 mb-2 flex items-center justify-between text-text-muted text-[9px]">
            <span>✉️ Official Email Notice</span>
            <span className="text-red-400 font-bold uppercase tracking-wider">
              Delivered
            </span>
          </div>
          <div className="text-text-primary">
            <span className="text-text-muted">From:</span> desk@{domainSuffix}.com
          </div>
          <div className="text-text-primary">
            <span className="text-text-muted">To:</span> {user?.email}
          </div>
          <div className="text-text-primary">
            <span className="text-text-muted">Subject:</span> Request to Join {clubName} Rejected
          </div>
          <div className="pt-2 border-t border-dashed border-border text-text-secondary leading-relaxed font-sans text-xs">
            Dear{" "}
            <strong className="text-text-primary font-semibold">
              {player?.name || "Player"}
            </strong>
            ,
            <br />
            <br />
            We thank you for your interest in joining{" "}
            <strong className="text-accent font-bold">{clubName}</strong>. However,
            upon reviewing your credentials, the administrative team has decided
            to decline your request at this time.
            <br />
            <br />
            You are eligible to re-submit your registration with correct/updated
            details after a 3-day quiet period from the decision date.
            <br />
            <br />
            Best Regards,
            <br />
            <span className="text-text-muted text-[9px] uppercase font-bold tracking-widest block mt-2">
              Kavach Admin Desk
            </span>
          </div>
        </div>

        <div className="pt-2">
          {canRetry ? (
            <div>
              <p className="text-xs text-emerald-400 font-extrabold mb-3">
                ✓ The 3-day quiet period has elapsed. You can now re-submit your profile.
              </p>
              <button
                onClick={handleResubmit}
                className="w-full bg-accent text-text-accent font-extrabold py-3 rounded-xl hover:opacity-90 transition cursor-pointer uppercase text-[11px] tracking-wider"
              >
                Resubmit Profile & Retry
              </button>
            </div>
          ) : (
            <div className="bg-surface-hover border border-border p-3 rounded-xl">
              <p className="text-[11px] text-orange-400 font-extrabold uppercase tracking-widest mb-1">
                ⏰ Quiet Period Lockout Active
              </p>
              <p className="text-xs text-text-secondary leading-normal">
                You can retry and resubmit profile in{" "}
                <strong className="text-text-primary font-bold">
                  {hoursRemaining > 24 ? `${daysRemaining} day(s)` : `${hoursRemaining} hour(s)`}
                </strong>
                .
              </p>
            </div>
          )}
        </div>

        <button
          onClick={onLogOut}
          className="w-full bg-surface-hover text-text-secondary font-bold py-2.5 rounded-xl hover:bg-surface-hover hover:text-text-primary transition uppercase text-[10px] tracking-widest border border-border"
        >
          Sign Out
        </button>
      </div>
    </div>
  );
}
