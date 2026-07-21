"use client";

import { useEffect, useMemo } from "react";
import { resolveTheme, ThemePreset } from "@/lib/theme";

/**
 * Resolves the active theme and pushes it into CSS custom properties on
 * :root so global styles pick it up. Returns { currentTheme, themeStyles }
 * so callers can also use inline `style={themeStyles}` on tree roots when
 * needed (helpful for full-screen overlays that mount above the app shell).
 */
export function useTheme(
  previewThemeId: string | null | undefined,
  globalThemeId: string | null | undefined,
) {
  const currentTheme: ThemePreset = useMemo(
    () => resolveTheme(previewThemeId, globalThemeId),
    [previewThemeId, globalThemeId],
  );

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    root.style.setProperty("--theme-accent", currentTheme.accent);
    root.style.setProperty("--theme-bg", currentTheme.bg);
    root.style.setProperty("--theme-glass-bg", currentTheme.glassBg);
    root.style.setProperty("--theme-glass-border", currentTheme.glassBorder);
    root.style.setProperty("--theme-text-accent", currentTheme.textAccent);
  }, [currentTheme]);

  const themeStyles = useMemo(
    () =>
      ({
        "--theme-accent": currentTheme.accent,
        "--theme-bg": currentTheme.bg,
        "--theme-glass-bg": currentTheme.glassBg,
        "--theme-glass-border": currentTheme.glassBorder,
        "--theme-text-accent": currentTheme.textAccent,
      }) as React.CSSProperties,
    [currentTheme],
  );

  return { currentTheme, themeStyles };
}
