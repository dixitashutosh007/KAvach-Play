"use client";

import { auth } from "@/lib/firebase";

/**
 * Terminal screen shown when an admin has disabled the player. Only exit
 * is to sign out; the app is unusable otherwise.
 */
export function AccountDisabledScreen() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-black">
      <div className="glass p-8 rounded-2xl max-w-lg w-full text-center space-y-6 border border-red-500/30">
        <h2 className="font-extrabold text-xl text-white tracking-wide uppercase">
          Account Disabled
        </h2>
        <p className="text-white/60">
          Your profile has been disabled by the administrator. Contact support for more information.
        </p>
        <button
          onClick={() => {
            auth.signOut();
            window.location.reload();
          }}
          className="px-4 py-2 bg-red-500/20 text-red-400 font-bold uppercase tracking-widest text-xs rounded-lg"
        >
          Sign Out
        </button>
      </div>
    </div>
  );
}
