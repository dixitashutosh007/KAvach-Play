"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/hooks/useStore";
import { PlayerFinanceView } from "@/components/FinanceTab";
import { useAuth } from "@/components/AuthProvider";
import { useParams, useRouter } from "next/navigation";

export default function PayPage() {
  const params = useParams();
  const playerId = params?.playerId as string;
  const router = useRouter();
  
  const { user, loading } = useAuth();
  const store = useStore(user, true);
  
  const [initialDuesCount, setInitialDuesCount] = useState<number | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);

  const pendingDuesCount = store.payments.filter(p => p.playerId === playerId && p.status === "Unpaid").length +
                           store.otherFees.filter(f => f.playerId === playerId && f.status === "Unpaid").length;

  useEffect(() => {
    if (store.isLoaded) {
      if (initialDuesCount === null) {
        setInitialDuesCount(pendingDuesCount);
      } else if (pendingDuesCount < initialDuesCount) {
        // A due was successfully paid and synced via onSnapshot!
        setShowSuccess(true);
      }
    }
  }, [pendingDuesCount, initialDuesCount, store.isLoaded]);

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-6 text-white text-center">
        <div className="space-y-4">
          <div className="w-8 h-8 rounded-full border-2 border-accent border-t-transparent animate-spin mx-auto" />
          <div className="text-[10px] font-bold uppercase tracking-widest text-white/50">
            Checking Authentication...
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-6 text-white text-center">
        <div className="space-y-6 max-w-sm w-full glass p-8 rounded-xl border border-white/10">
          <div className="w-16 h-16 bg-accent/20 text-accent rounded-full flex items-center justify-center mx-auto mb-4 border border-accent/30">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold tracking-tight text-white">Login Required</h1>
          <p className="text-white/50 text-xs">You must be logged in to securely view and pay your match dues and club fees.</p>
          <button 
            onClick={() => {
              sessionStorage.setItem('postLoginRedirect', `/pay/${playerId}`);
              router.push('/');
            }}
            className="w-full bg-white text-black font-bold py-3 rounded-xl transition duration-200 uppercase tracking-widest text-xs mt-4 hover:bg-white/90"
          >
            Go to Login
          </button>
        </div>
      </div>
    );
  }

  if (!store.isLoaded) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-6 text-white text-center">
        <div className="space-y-4">
          <div className="w-8 h-8 rounded-full border-2 border-accent border-t-transparent animate-spin mx-auto" />
          <div className="text-[10px] font-bold uppercase tracking-widest text-white/50">
            Fetching Details...
          </div>
        </div>
      </div>
    );
  }

  const player = store.players.find(p => p.id === playerId);

  if (!player) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-6 text-white text-center">
        <div className="space-y-2">
          <h1 className="text-xl font-bold">Player not found</h1>
          <p className="text-white/50 text-sm">The payment link appears to be invalid or the player was removed.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#070707] text-white">
      <div className="max-w-md mx-auto p-4 sm:p-6 space-y-6">
        <div className="text-center py-6">
          <h1 className="text-2xl font-bold tracking-tight text-white">Kavach Play</h1>
          <div className="text-xs uppercase tracking-widest text-accent mt-1">Payment Portal</div>
        </div>

        <div className="glass rounded-xl p-5 text-center bg-accent/5 border-accent/20">
          <div className="text-[11px] font-bold text-white/60 uppercase tracking-widest mb-1">Paying For</div>
          <div className="text-lg font-black">{player.name}</div>
        </div>

        {showSuccess ? (
          <div className="glass rounded-xl p-6 md:p-8 text-center border-emerald-500/30 bg-emerald-500/5 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="w-16 h-16 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center mx-auto mb-4 border border-emerald-500/30">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-2xl font-black text-white mb-2">Payment Recorded!</h2>
            <p className="text-sm text-emerald-400/80 font-medium mb-6">
              Your payment has been successfully captured and your account balance has been updated.
            </p>
            <button 
              onClick={() => {
                setShowSuccess(false);
                setInitialDuesCount(pendingDuesCount);
              }}
              className="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-3 rounded-xl transition duration-200 uppercase tracking-widest text-xs"
            >
              Continue
            </button>
          </div>
        ) : (
          <PlayerFinanceView store={store} userId={playerId} showOnly="dues" />
        )}
      </div>
    </div>
  );
}
