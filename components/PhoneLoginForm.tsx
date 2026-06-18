"use client";

import React, { useState, useEffect } from "react";
import {
  RecaptchaVerifier,
  signInWithPhoneNumber,
  ConfirmationResult,
} from "firebase/auth";
import { auth } from "@/lib/firebase";
import { ChevronRight } from "lucide-react";

export function PhoneLoginForm({
  onOtherOptions,
  themeAccent,
  themeTextAccent,
}: {
  onOtherOptions: () => void;
  themeAccent: string;
  themeTextAccent: string;
}) {
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [confirmationResult, setConfirmationResult] =
    useState<ConfirmationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    // We must ensure Recaptcha is initialized only once and on the client side
    if (typeof window !== "undefined") {
      try {
        if (!(window as any).recaptchaVerifier) {
          (window as any).recaptchaVerifier = new RecaptchaVerifier(
            auth,
            "recaptcha-container",
            {
              size: "invisible",
            },
          );
        }
      } catch (err) {
        console.error("Recaptcha init error", err);
      }
    }

    // Cleanup on unmount
    return () => {
      if (typeof window !== "undefined" && (window as any).recaptchaVerifier) {
        try {
          (window as any).recaptchaVerifier.clear();
          (window as any).recaptchaVerifier = null;
        } catch (e) {}
      }
    };
  }, []);

  const requestOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone) return;
    setError("");

    const OTP_RATE_LIMIT_KEY = "otp_rate_limit";
    let rateLimitData = { attempts: 0, firstAttemptTime: Date.now() };
    try {
      const stored = localStorage.getItem(OTP_RATE_LIMIT_KEY);
      if (stored) {
        rateLimitData = JSON.parse(stored);
      }
    } catch (e) {}

    const now = Date.now();
    if (now - rateLimitData.firstAttemptTime > 15 * 60 * 1000) {
      rateLimitData.attempts = 0;
      rateLimitData.firstAttemptTime = now;
    }

    if (rateLimitData.attempts >= 3) {
      setError(
        "Maximum retry attempts reached. Please try again after 15 minutes.",
      );
      return;
    }

    setLoading(true);

    try {
      const appVerifier = (window as any).recaptchaVerifier;
      const formattedPhone = phone.startsWith("+") ? phone : `+91${phone}`;

      // Update rate limit before attempting
      rateLimitData.attempts += 1;
      localStorage.setItem(OTP_RATE_LIMIT_KEY, JSON.stringify(rateLimitData));

      const result = await signInWithPhoneNumber(
        auth,
        formattedPhone,
        appVerifier,
      );
      setConfirmationResult(result);
    } catch (err: any) {
      // console.error(err); // Commenetd out so the preview wrapper doesn't report a handled error.
      let errMsg = err.message || "Failed to send OTP.";

      // Specifically catch the region blocked error
      if (
        err.code === "auth/operation-not-allowed" &&
        err.message.includes("region")
      ) {
        errMsg =
          "Registration blocked. SMS for this region is not enabled in the Firebase console. Admins: Please go to Firebase Authentication -> Settings -> SMS Region Policy and allow SMS for this country code.";
      } else if (err.code === "auth/too-many-requests") {
        errMsg = "Too many requests sent. Firebase SMS limit reached. Please try again later or use Google Sign-in as an alternative.";
      }

      setError(errMsg);
      // We do not clear and recreate RecaptchaVerifier here anymore.
      // Re-using the same verifier solves "reCAPTCHA has already been rendered" error.
    } finally {
      setLoading(false);
    }
  };

  const verifyOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!confirmationResult || !otp) return;
    setError("");
    setLoading(true);
    try {
      await confirmationResult.confirm(otp);
    } catch (err: any) {
      setError("Invalid OTP or expired.");
    } finally {
      setLoading(false);
    }
  };

  if (!confirmationResult) {
    return (
      <form onSubmit={requestOTP} className="space-y-4 text-left">
        <div id="recaptcha-container"></div>
        <div className="space-y-1">
          <label className="text-[10px] font-bold uppercase tracking-wider text-white/60">
            Mobile Number
          </label>
          <div className="flex bg-white/5 border border-white/10 rounded-xl focus-within:border-accent transition overflow-hidden">
            <span className="px-3 py-2 flex items-center justify-center text-white/40 border-r border-white/10 text-sm">
              +91
            </span>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="9876543210"
              className="w-full px-3.5 py-2 bg-transparent text-white text-sm focus:outline-none"
              required
            />
          </div>
        </div>

        {error && (
          <div className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 p-2.5 rounded-lg">
            {error}
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <button
            type="button"
            onClick={onOtherOptions}
            className="flex-1 py-3 px-4 rounded-xl border border-white/10 text-white text-xs font-bold hover:bg-white/5 transition cursor-pointer text-center"
          >
            Email / Google
          </button>
          <button
            type="submit"
            disabled={loading}
            className="flex-1 py-3 px-4 rounded-xl bg-accent text-black text-xs font-bold hover:opacity-95 transition shadow-[0_4px_12px_rgba(16,185,129,0.15)] flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50"
            style={{ backgroundColor: themeAccent, color: themeTextAccent }}
          >
            {loading ? (
              <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                <span>Send OTP</span>
                <ChevronRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={verifyOTP} className="space-y-4 text-left">
      <div className="space-y-1">
        <label className="text-[10px] font-bold uppercase tracking-wider text-white/60">
          Enter OTP Sent to +91 {phone}
        </label>
        <input
          type="text"
          value={otp}
          autoComplete="one-time-code"
          onChange={(e) => setOtp(e.target.value)}
          placeholder="123456"
          className="w-full px-3.5 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-accent transition text-center tracking-widest text-lg font-mono"
          required
        />
      </div>

      {error && (
        <div className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 p-2.5 rounded-lg">
          {error}
        </div>
      )}

      <div className="flex gap-2 pt-2">
        <button
          type="button"
          onClick={() => {
            setConfirmationResult(null);
            setOtp("");
            setError("");
          }}
          className="py-3 px-4 rounded-xl border border-white/10 text-white text-xs font-bold hover:bg-white/5 transition cursor-pointer"
        >
          Back
        </button>
        <button
          type="submit"
          disabled={loading}
          className="flex-1 py-3 px-4 rounded-xl bg-accent text-black text-xs font-bold hover:opacity-95 transition shadow-[0_4px_12px_rgba(16,185,129,0.15)] flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50"
          style={{ backgroundColor: themeAccent, color: themeTextAccent }}
        >
          {loading ? (
            <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
          ) : (
            <>
              <span>Verify & Login</span>
              <ChevronRight className="w-4 h-4" />
            </>
          )}
        </button>
      </div>
    </form>
  );
}
