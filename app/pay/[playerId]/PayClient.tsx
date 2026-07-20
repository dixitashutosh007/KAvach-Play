"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/hooks/useStore";
import { PlayerFinanceView } from "@/components/FinanceTab";
import { useAuth } from "@/components/AuthProvider";
import { useRouter } from "next/navigation";

export function PayClient({ playerId }: { playerId: string }) {
  const router = useRouter();

  const { user, loading } = useAuth();
  const store = useStore(user, true);

  const [initialDuesCount, setInitialDuesCount] = useState<number | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);

  useEffect(() => {
    store.ensurePayments?.();
    store.ensureOtherFees?.();
  }, [store.ensurePayments, store.ensureOtherFees]);

  const pendingDuesCount =
    store.payments.filter((p) => p.playerId === playerId && p.status === "Unpaid").length +
    store.otherFees.filter((f) => f.playerId === playerId && f.status === "Unpaid").length;

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
      <div className="flex items-center justify-center p-6 text-white text-center">
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
      <div className="flex items-center justify-center p-6 text-white text-center">
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
              sessionStorage.setItem("postLoginRedirect", `/pay/${playerId}`);
              router.push("/");
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
      <div className="flex items-center justify-center p-6 text-white text-center">
        <div className="space-y-4">
          <div className="w-8 h-8 rounded-full border-2 border-accent border-t-transparent animate-spin mx-auto" />
          <div className="text-[10px] font-bold uppercase tracking-widest text-white/50">
            Fetching Details...
          </div>
        </div>
      </div>
    );
  }

  if (showSuccess) {
    return (
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
    );
  }

  return <PlayerFinanceView store={store} userId={playerId} showOnly="dues" />;
}
