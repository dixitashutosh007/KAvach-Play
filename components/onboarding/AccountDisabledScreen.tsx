"use client";

import { User } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { doc, setDoc, serverTimestamp, getDocFromServer } from "firebase/firestore";
import { Player } from "@/lib/types";
import { useStore } from "@/hooks/useStore";

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Shown when the admin has moved the player to trash (disabled=true).
 * Mirrors the RejectedScreen cooldown: after 3 days the player can
 * re-request signup; a server-time check defeats client clock tampering.
 */
export function AccountDisabledScreen({
  player,
  user,
  store,
  now,
}: {
  player?: Player;
  user?: User;
  store?: ReturnType<typeof useStore>;
  now?: number;
}) {
  const disabledDate = player?.disabledAt ? new Date(player.disabledAt) : null;
  const timeRemaining =
    disabledDate && now ? disabledDate.getTime() + THREE_DAYS_MS - now : 0;
  const daysRemaining = Math.max(0, Math.ceil(timeRemaining / (1000 * 60 * 60 * 24)));
  const hoursRemaining = Math.max(0, Math.ceil(timeRemaining / (1000 * 60 * 60)));
  const canRetry = disabledDate ? timeRemaining <= 0 : false;

  const handleResubmit = async () => {
    if (!player || !user || !store) return;
    try {
      const pingRef = doc(db, "appUsers", user.uid);
      await setDoc(pingRef, { _ping: serverTimestamp() }, { merge: true });
      const snap = await getDocFromServer(pingRef);
      const serverTime = snap.data()?._ping?.toMillis();
      if (serverTime && disabledDate) {
        if (serverTime < disabledDate.getTime() + THREE_DAYS_MS) {
          alert("Cool-down period is still active. Local system time modification detected.");
          return;
        }
      }
    } catch (e) {
      console.error("Cool-down validation failed:", e);
      alert("Failed to validate server time securely. Try again.");
      return;
    }

    await store.updatePlayer(player.id, {
      disabled: false,
      disabledAt: undefined,
      inviteStatus: "Pending",
    });
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-black">
      <div className="glass p-8 rounded-2xl max-w-lg w-full text-center space-y-6 border border-red-500/30">
        <h2 className="font-extrabold text-xl text-white tracking-wide uppercase">
          Account In Trash
        </h2>
        <p className="text-white/60">
          Your profile has been moved to trash by the administrator.
          {disabledDate && !canRetry && (
            <>
              {" "}You can request a fresh signup in{" "}
              <span className="text-accent font-bold">
                {daysRemaining > 0
                  ? `${daysRemaining} day${daysRemaining === 1 ? "" : "s"}`
                  : `${hoursRemaining} hour${hoursRemaining === 1 ? "" : "s"}`}
              </span>.
            </>
          )}
          {disabledDate && canRetry && (
            <> The 3-day cool-down has ended — you can request a fresh signup below.</>
          )}
          {!disabledDate && (
            <> Contact support to have your account restored.</>
          )}
        </p>

        {canRetry && player && user && store && (
          <button
            onClick={handleResubmit}
            className="px-4 py-2 bg-accent text-black font-bold uppercase tracking-widest text-xs rounded-lg"
          >
            Request Fresh Signup
          </button>
        )}

        <button
          onClick={() => {
            auth.signOut();
            window.location.reload();
          }}
          className="px-4 py-2 bg-red-500/20 text-red-400 font-bold uppercase tracking-widest text-xs rounded-lg block mx-auto"
        >
          Sign Out
        </button>
      </div>
    </div>
  );
}
