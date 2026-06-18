"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import {
  User,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
} from "firebase/auth";
import { auth, testConnection } from "@/lib/firebase";
import { LoadingScreen } from "./LoadingScreen";

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signIn: () => Promise<void>;
  signInDemo: () => Promise<void>;
  signInWithEmail: (email: string, pass: string) => Promise<void>;
  linkGoogleAccount: () => Promise<void>;
  logOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  signIn: async () => {},
  signInDemo: async () => {},
  signInWithEmail: async () => {},
  linkGoogleAccount: async () => {},
  logOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    testConnection();
    const unsubscribe = auth.onAuthStateChanged((u) => {
      if (u) {
        const lastActive = localStorage.getItem("kavach_session_time");
        const now = Date.now();
        const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
        
        if (lastActive && now - parseInt(lastActive, 10) > THIRTY_DAYS) {
          console.warn("Session expired (1 month timeout)");
          auth.signOut();
          setUser(null);
          localStorage.removeItem("kavach_session_time");
        } else {
          localStorage.setItem("kavach_session_time", now.toString());
          setUser(u);
        }
      } else {
        setUser(null);
        localStorage.removeItem("kavach_session_time");
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const signIn = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err: any) {
      if (err.code === "auth/popup-closed-by-user") {
        console.warn("Login popup closed by user.");
        return;
      }
      console.error("Google Login Error:", err);
      const isIFrame =
        typeof window !== "undefined" && window.self !== window.top;
      let msg = err?.message || String(err);

      if (err.code === "auth/operation-not-allowed") {
        msg =
          "Google Sign-In is not enabled on your Firebase project.\n\nTo enable Google Sign-In:\n1. Go to your Firebase Console -> Authentication -> Sign-in method.\n2. Click 'Add new provider' and select 'Google'.\n3. Slide the 'Enable' toggle, configure your project's public-facing name / support email, and click 'Save'.";
      } else if (err.code === "auth/popup-blocked") {
        msg =
          "The login popup was blocked by your browser. Please allow popups for this site or open the application in a new tab.";
      } else if (isIFrame) {
        msg +=
          "\n\nNote: If you are seeing this inside the AI Studio frame, third-party sign-in popups or cookies may be blocked by your browser's security settings. Please try clicking the 'Open in new window' button in the top-right corner to run the application in a dedicated tab.";
      }
      alert(msg);
      throw err;
    }
  };

  const signInDemo = async () => {
    try {
      const { signInAnonymously } = await import("firebase/auth");
      await signInAnonymously(auth);
    } catch (anonErr: any) {
      console.warn(
        "Anonymous login failed, trying Email/Password fallback...",
        anonErr,
      );

      try {
        const { signInWithEmailAndPassword, createUserWithEmailAndPassword } =
          await import("firebase/auth");
        const email = "demo_player@kavach.com";
        const password = "DemoPlayerPassword123!";
        try {
          await signInWithEmailAndPassword(auth, email, password);
        } catch (signInErr: any) {
          if (
            signInErr.code === "auth/user-not-found" ||
            signInErr.code === "auth/invalid-credential"
          ) {
            await createUserWithEmailAndPassword(auth, email, password);
          } else {
            throw signInErr;
          }
        }
      } catch (fallbackErr: any) {
        console.error(
          "All demo login strategies failed:",
          anonErr,
          fallbackErr,
        );

        const details = `
Demo Player Login could not connect to Firebase Auth.

To fix this, please enable either "Anonymous" or "Email/Password" sign-in provider in your Firebase Console:
1. Go to Firebase Console -> Authentication -> Sign-in Pages / Methods.
2. Click "Add new provider" (or select existing).
3. Enable 'Anonymous' or 'Email/Password'.
4. Click Save.

Error Details:
- Anonymous: ${anonErr?.message || anonErr}
- Email/Pass: ${fallbackErr?.message || fallbackErr}
        `.trim();
        alert(details);
      }
    }
  };

  const signInWithEmail = async (email: string, pass: string) => {
    const { signInWithEmailAndPassword } =
      await import("firebase/auth");
    try {
      await signInWithEmailAndPassword(auth, email, pass);
    } catch (err: any) {
      if (err.code === "auth/operation-not-allowed") {
        throw new Error(
          "Email/Password authentication provider is not enabled in your Firebase project.",
        );
      } else {
        throw new Error(
          "Login failed. Please verify your email and password. Note: New accounts must use Sign in with Google.",
        );
      }
    }
  };

  const linkGoogleAccount = async () => {
    if (!auth.currentUser) return;
    try {
      const { linkWithPopup, GoogleAuthProvider } = await import("firebase/auth");
      const googleProvider = new GoogleAuthProvider();
      googleProvider.setCustomParameters({ prompt: "select_account" });
      await linkWithPopup(auth.currentUser, googleProvider);
    } catch (err: any) {
      if (err.code === "auth/credential-already-in-use") {
        throw new Error("This Google account is already linked to another user. Please log out and sign in directly with Google.");
      }
      throw new Error(err.message || "Failed to link Google account.");
    }
  };

  const logOut = async () => {
    await signOut(auth);
  };

  if (loading) {
    return <LoadingScreen />;
  }

  return (
    <AuthContext.Provider
      value={{ user, loading, signIn, signInDemo, signInWithEmail, linkGoogleAccount, logOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
