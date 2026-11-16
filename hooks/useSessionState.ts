"use client";

import { useState, useEffect } from "react";

/**
 * sessionStorage-backed useState. Lets accordions and filters
 * survive an in-tab navigation (e.g. open a match -> hit Back ->
 * the past-matches list is still expanded, filters preserved).
 * SSR-safe: first render always matches `initial`; hydration
 * happens in the mount effect. Value is dropped when the tab
 * closes so we don't pollute the user's browser forever.
 */
export function useSessionState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(initial);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(key);
      if (raw !== null) setValue(JSON.parse(raw) as T);
    } catch {
      // Broken/blocked sessionStorage — silently fall through.
    }
    setHydrated(true);
  }, [key]);
  useEffect(() => {
    if (!hydrated) return;
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Same silent fallback: state simply doesn't persist.
    }
  }, [key, value, hydrated]);
  return [value, setValue] as const;
}
