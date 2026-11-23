/**
 * Subscriptions & Squad Management (`components/StudioTab.tsx`)
 *
 * Manages the "Studio" (premium features or subscriptions) aspect of the application.
 * Allows users to view their current subscription status, history, and available plans.
 * Integrates with Razorpay (if configured) for handling actual payments to upgrade
 * or renew subscription tiers.
 */
import { useState, useEffect } from "react";
import { useStore } from "@/hooks/useStore";
import { authedFetch } from "@/lib/authed-fetch";
import { useAuth } from "./AuthProvider";
import {
  Video,
  Calendar,
  CreditCard,
  Sparkles,
  Shield,
  Check,
  Phone,
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { dbToInputDate, normalizeIndianMobile } from "@/lib/utils";
import { getStudioMembership, type StudioMembershipStatus } from "@/lib/studio-membership";
import { resolvePlayerForUser } from "@/lib/player-identity";
import { useToast } from "@/components/ui/Toast";

// Make sure to add Razorpay to window type if needed
declare global {
  interface Window {
    Razorpay: any;
  }
}

export function StudioTab({ store }: { store: ReturnType<typeof useStore> }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [loadingPlanId, setLoadingPlanId] = useState<string | null>(null);
  const [paymentError, setPaymentError] = useState("");
  const [plansExpanded, setPlansExpanded] = useState(false);

  // Look up user profiles across both appUser and associated player registry file
  const appUser = store.appUsers.find((u) => u.id === user?.uid);
  const player = resolvePlayerForUser(store.players, user?.uid, appUser);

  const isStudioUser = appUser?.isStudioMember || player?.isStudioMember;

  useEffect(() => {
    // Dynamically load Razorpay SDK
    if (!document.getElementById("razorpay-checkout-js")) {
      const script = document.createElement("script");
      script.id = "razorpay-checkout-js";
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.async = true;
      document.body.appendChild(script);
    }
  }, []);

  useEffect(() => {
    if (!isStudioUser) setPlansExpanded(true);
  }, [isStudioUser]);

  const handlePayment = async (plan: any) => {
    if (store.appConfig?.features?.payments === false) {
      toast("This feature is currently not available. Contact Club Admin");
      return;
    }

    setLoadingPlanId(plan.id);
    setPaymentError("");

    try {
      const rzpId =
        store.appConfig?.razorpayKeyId ||
        process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;

      if (!rzpId) {
        setPaymentError(
          "Razorpay keys are missing (Settings -> Payment Gateway)",
        );
        setLoadingPlanId(null);
        return;
      }

      const res = await authedFetch("/api/razorpay/order", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount: plan.fee,
          intentData: {
            type: "subscription",
            planId: plan.id,
            userId: user?.uid,
            amount: plan.fee,
            durationDays: plan.durationDays || 30
          }
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create order");

      const options = {
        key: rzpId,
        amount: data.amount,
        currency: data.currency,
        name: "Kavach Play",
        description: `Studio Subscription - ${plan.name}`,
        order_id: data.id,
        handler: function (response: any) {
          // Expiry date extension and subscription history are handled
          // server-side by the Razorpay webhook to avoid a dual-write race
          // that could double the subscription duration.
          const updates = [];

          const getTodayStr = () => {
            const d = new Date();
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          };
          const todayStr = getTodayStr();
          const startDateToUse =
            player?.studioStartDate || appUser?.studioStartDate || todayStr;

          if (appUser?.id) {
            updates.push(
              store.updateAppUserProfile(appUser.id, {
                isStudioMember: true,
                studioPlan: plan.id,
                studioStartDate: startDateToUse,
                lastPaidDate: todayStr,
                lastPaidAmount: plan.fee,
              }),
            );
          }
          if (player?.id) {
            updates.push(
              store.updatePlayer(player.id, {
                isStudioMember: true,
                studioPlan: plan.id,
                studioStartDate: startDateToUse,
                lastPaidDate: todayStr,
                lastPaidAmount: plan.fee,
              }),
            );
          }

          Promise.all(updates)
            .then(async () => {
              if (player && player.id) {
                const { createNotification } = await import("@/lib/notifications");
                createNotification(player.id, "Payment Successful", `Your subscription for ${plan.name} was successful.`, "in_app");
                createNotification("admin", "Studio Subscription Purchased", `${player.name} purchased ${plan.name}.`, "in_app");
              }
              toast("Payment Successful! Your subscription has been active.", "success");
            })
            .catch((err) => {
              console.error("Failed to update profile", err);
              toast(
                "Payment successful but profile update failed. Please contact admin.",
              "error");
            });
        },
        prefill: {
          name: appUser?.name || player?.name || "Kavach Player",
          email: appUser?.email || player?.email || "",
          contact: appUser?.mobile || player?.mobile || "",
        },
        theme: {
          color: "#D51F43", // Primary action brand color
        },
      };

      const paymentObject = new window.Razorpay(options);
      paymentObject.on("payment.failed", async function (response: any) {
        if (player && player.id) {
          try {
            const { createNotification } = await import("@/lib/notifications");
            createNotification("admin", "Studio Payment Failed", `${player.name}'s payment for ${plan.name} failed.`, "in_app");
          } catch(e) {}
        }
        setPaymentError(response.error.description);
      });
      paymentObject.open();
    } catch (err: any) {
      setPaymentError(err.message);
    } finally {
      setLoadingPlanId(null);
    }
  };

  const adminMobile =
    store.appUsers.find((u) => u.role === "admin")?.mobile ||
    store.grounds[0]?.gpayNumber ||
    "9999999999";

  // Resolve fields from either player document or appUser login profile
  const planSymbol = player?.studioPlan || appUser?.studioPlan || "Trial";
  const planNames: Record<string, string> = {
    Trial: "7-Day Trial Membership",
    "1M": "Monthly Starter Pass (1 Month)",
    "3M": "Quarterly Pro Pass (3 Months)",
    "6M": "Half-Year Elite Pass (6 Months)",
    "12M": "Annual Championship Pass (1 Year)",
    Other: "Special Managed Studio Access",
  };
  const activePlanName =
    store.subscriptionPlans.find((p) => p.id === planSymbol)?.name ||
    planNames[planSymbol] ||
    planSymbol;

  const startDateRaw = player?.studioStartDate || appUser?.studioStartDate;
  // Membership status shared with the Profile card (lib/studio-membership.ts).
  const membership = getStudioMembership(player, appUser);
  const endDateRaw = membership.endDateRaw;
  const lastPaidDateRaw = player?.lastPaidDate || appUser?.lastPaidDate;
  const lastPaidAmount =
    player?.lastPaidAmount !== undefined
      ? player.lastPaidAmount
      : appUser?.lastPaidAmount;

  // Format dates for legible output
  const startDate = startDateRaw
    ? startDateRaw.includes("-")
      ? dbToInputDate(startDateRaw)
      : startDateRaw
    : "—";
  const expiryDate = endDateRaw
    ? endDateRaw.includes("-")
      ? dbToInputDate(endDateRaw)
      : endDateRaw
    : "—";
  const lastPaidDate = lastPaidDateRaw
    ? lastPaidDateRaw.includes("-")
      ? dbToInputDate(lastPaidDateRaw)
      : lastPaidDateRaw
    : "—";

  // Compute subscription status: Active | Expired | Inactive | Paused
  type SubStatus = StudioMembershipStatus;
  const subscriptionStatus: SubStatus = membership.status;
  const daysRemaining = membership.daysRemaining;

  const isExpired = subscriptionStatus === "Expired";

  const statusConfig: Record<SubStatus, { text: string; classes: string }> = {
    Active: {
      text: daysRemaining !== null && daysRemaining <= 7
        ? `Active · ${daysRemaining} day${daysRemaining === 1 ? "" : "s"} left`
        : "Active",
      classes: daysRemaining !== null && daysRemaining <= 3
        ? "bg-orange-500/20 text-orange-400 border border-orange-500/30"
        : "bg-accent/10 text-accent border border-accent/20 shadow-inner",
    },
    Expired: {
      text: "Expired",
      classes: "bg-rose-500/10 text-rose-400 border border-rose-500/20",
    },
    Inactive: {
      text: "Inactive",
      classes: "bg-surface-hover text-text-muted border border-border",
    },
    Paused: {
      text: "Paused",
      classes: "bg-amber-500/10 text-amber-400 border border-amber-500/20",
    },
  };

  const statusBadgeText = statusConfig[subscriptionStatus].text;
  const statusBadgeClasses = statusConfig[subscriptionStatus].classes;

  const showPlansAlwaysOpen = subscriptionStatus === "Expired" || subscriptionStatus === "Inactive" || subscriptionStatus === "Paused";

  useEffect(() => {
    if (subscriptionStatus === "Expired" || subscriptionStatus === "Paused") {
      setPlansExpanded(true);
    }
  }, [subscriptionStatus]);

  const plansGrid = (
    <div className="space-y-4 pt-4 border-t border-border/40 mt-6 mt-auto">
      <button
        onClick={() => setPlansExpanded(!plansExpanded)}
        className="w-full flex items-center justify-between group"
      >
        <h3 className="text-sm font-bold text-text-primary uppercase tracking-widest text-left">
          {showPlansAlwaysOpen ? "Renew / Buy Membership" : "Available Plans"}
        </h3>
        <div className="p-1 rounded bg-surface-hover group-hover:bg-surface-hover text-text-muted transition">
          {plansExpanded ? (
            <ChevronUp className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
        </div>
      </button>

      {plansExpanded && (
        <div className="animate-in fade-in slide-in-from-top-2 duration-300">
          {paymentError && (
            <p className="text-[11px] text-rose-400 mt-1 pb-2 text-left">
              {paymentError}
            </p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-left">
            {store.subscriptionPlans
              .filter((p) => p.isActive !== false)
              .map((plan) => (
                <div
                  key={plan.id}
                  className="bg-surface-hover border border-border p-5 rounded-2xl flex flex-col justify-between hover:border-accent/40 transition"
                >
                  <div className="flex justify-between gap-2">
                    <div>
                      <h4 className="text-sm font-black text-text-primary uppercase">
                        {plan.name}
                      </h4>
                      <p className="text-[10px] uppercase tracking-widest text-text-muted font-bold mt-1">
                        <Calendar className="inline w-3 h-3 mr-1" />{" "}
                        {plan.durationDays} Days
                      </p>
                    </div>
                    <span className="text-accent font-black text-lg">
                      ₹{plan.fee}
                    </span>
                  </div>
                  <p className="text-[10px] text-text-muted mt-3 mb-4 whitespace-pre-line">
                    {plan.benefits}
                  </p>
                  <button
                    onClick={() => handlePayment(plan)}
                    disabled={loadingPlanId !== null}
                    className="w-full py-2.5 rounded-xl bg-accent text-text-accent font-extrabold text-[10px] uppercase tracking-wider text-center hover:opacity-90 transition disabled:opacity-50 shadow-lg flex items-center justify-center gap-2"
                  >
                    <CreditCard className="w-3.5 h-3.5" />
                    {loadingPlanId === plan.id
                      ? "Processing..."
                      : "Purchase Plan"}
                  </button>
                </div>
              ))}
            {store.subscriptionPlans.filter((p) => p.isActive !== false)
              .length === 0 && (
              <div className="col-span-2 text-center p-4 text-xs text-text-muted italic">
                No plans available at this moment.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );

  if (!isStudioUser && !membership.hasPastSubscription) {
    return (
      <div className="bg-surface p-6 text-center text-text-muted rounded-2xl border border-border flex flex-col h-full">
        <div className="flex-1 flex flex-col items-center justify-center space-y-4 pt-10 pb-8">
          <span className="p-1 px-2.5 rounded-full bg-surface-hover text-[10px] uppercase font-bold tracking-widest text-text-muted border border-border">
            Inactive
          </span>
          <div className="w-16 h-16 bg-accent/10 border border-accent/20 rounded-full flex items-center justify-center mx-auto mb-2 shadow-[0_0_20px_rgba(16,185,129,0.2)]">
            <Sparkles className="w-8 h-8 text-accent animate-pulse" />
          </div>
          <h2 className="text-2xl font-bold text-text-primary tracking-tight">Unlock Kavach Studio Membership</h2>
          <p className="text-sm max-w-lg mx-auto text-text-secondary leading-relaxed mb-6">
            You are currently not a Kavach Studio Member. Subscribe to a plan that fits your needs and become an exclusive part of our Practice Session Club. Explore the premium benefits below:
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl mx-auto w-full text-left mb-6">
            {[
              "Practice Nets",
              "Daily Morning Practice Sessions",
              "Weekday Evening Flood Light Practice Sessions",
              "Usage of Bowling Machine",
              "Usage of Quarter Fields",
              "Studio Jersey (on selected plans)",
              "20% Discount on Play Arena Activities*",
              "20% Discount on Play Arena Dine-In"
            ].map((benefit, i) => (
              <div key={i} className="flex items-start gap-2 bg-surface-hover p-3 rounded-xl border border-border">
                <Check className="w-4 h-4 text-accent mt-0.5 shrink-0" />
                <span className="text-sm font-medium text-text-primary">{benefit}</span>
              </div>
            ))}
          </div>
        </div>

        {plansGrid}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Dynamic Membership Header Card */}
      <div className="bg-surface rounded-2xl border border-border p-6 relative overflow-hidden flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="absolute top-0 right-0 w-48 h-48 bg-accent/5 rounded-full blur-3xl pointer-events-none" />

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            {subscriptionStatus === "Active" ? (
              <>
                <span className="p-1 px-2.5 rounded-full bg-accent/15 text-[10px] uppercase font-bold tracking-widest text-accent border border-accent/20">
                  Active Member
                </span>
                <span className="flex h-2 w-2 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
              </>
            ) : subscriptionStatus === "Paused" ? (
              <span className="p-1 px-2.5 rounded-full bg-amber-500/15 text-[10px] uppercase font-bold tracking-widest text-amber-400 border border-amber-500/20">
                Membership Paused
              </span>
            ) : (
              <span className="p-1 px-2.5 rounded-full bg-rose-500/15 text-[10px] uppercase font-bold tracking-widest text-rose-400 border border-rose-500/20">
                Membership Expired
              </span>
            )}
          </div>

          <div>
            <h2 className="text-2xl font-black tracking-tight text-text-primary flex items-center gap-2">
              <Video className="w-6 h-6 text-accent shrink-0" /> Studio
            </h2>
            <p className="text-text-secondary text-xs mt-1">
              Your video profile and smart cricket subscription details.
            </p>
          </div>
        </div>

        <div className="flex flex-col items-start md:items-end gap-1 font-mono z-10 relative">
          <span className="text-[10px] text-text-muted uppercase font-bold tracking-wider">
            Status Badge
          </span>
          <span
            className={`text-[12px] font-black uppercase tracking-wider px-3 py-1.5 rounded-lg ${statusBadgeClasses}`}
          >
            {statusBadgeText}
          </span>
        </div>
      </div>

      {/* Subscription Breakdown Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Plan card info */}
        <div className="bg-surface-hover border border-border rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center border border-accent/20">
              <Shield className="w-4.5 h-4.5 text-accent" />
            </div>
            <div>
              <p className="text-[10px] text-text-muted uppercase font-black tracking-wider">
                Current Active Plan
              </p>
              <h3 className="text-sm font-bold text-text-primary mt-0.5">
                {activePlanName}
              </h3>
            </div>
          </div>

          <div className="border-t border-border/40 pt-3 grid grid-cols-2 gap-4">
            <div>
              <p className="text-[9px] text-text-muted uppercase font-bold tracking-wider">
                Start Date
              </p>
              <p className="text-xs font-semibold text-text-primary/95 mt-1">
                {startDate}
              </p>
            </div>
            <div>
              <p className="text-[9px] text-text-muted uppercase font-bold tracking-wider">
                Expiry / Renewal
              </p>
              <p
                className={`text-xs font-semibold mt-1 ${isExpired ? "text-rose-400" : "text-accent"}`}
              >
                {expiryDate}
              </p>
            </div>
          </div>
        </div>

        {/* Payment history card */}
        <div className="bg-surface-hover border border-border rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center border border-accent/20">
              <CreditCard className="w-4.5 h-4.5 text-accent" />
            </div>
            <div>
              <p className="text-[10px] text-text-muted uppercase font-black tracking-wider">
                Last Payment Contribution
              </p>
              <h3 className="text-sm font-bold text-text-primary mt-0.5">
                {lastPaidAmount !== undefined
                  ? `₹${lastPaidAmount}`
                  : "Free Trial"}
              </h3>
            </div>
          </div>

          <div className="border-t border-border/40 pt-3 grid grid-cols-2 gap-4">
            <div>
              <p className="text-[9px] text-text-muted uppercase font-bold tracking-wider">
                Paid Date
              </p>
              <p className="text-xs font-semibold text-text-primary/95 mt-1">
                {lastPaidDate}
              </p>
            </div>
            <div>
              <p className="text-[9px] text-text-muted uppercase font-bold tracking-wider">
                Method
              </p>
              <p className="text-xs font-semibold text-text-secondary mt-1">
                GPAY / UPI Secure
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Subscription Plans */}
      {plansGrid}
    </div>
  );
}
