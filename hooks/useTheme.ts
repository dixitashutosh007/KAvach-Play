"use client";

import { useEffect, useMemo } from "react";
import { resolveTheme, ThemePreset } from "@/lib/theme";

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
    root.style.setProperty("--theme-brand", currentTheme.brand || "#A30F2D");
    root.style.setProperty("--theme-brand-surface", currentTheme.brandSurface || "#FCE8ED");
    root.style.setProperty("--theme-bg", currentTheme.bg);
    root.style.setProperty("--theme-glass-bg", currentTheme.glassBg);
    root.style.setProperty("--theme-glass-border", currentTheme.glassBorder);
    root.style.setProperty("--theme-text-accent", currentTheme.textAccent);
    root.style.setProperty("--theme-text-primary", currentTheme.textPrimary);
    root.style.setProperty("--theme-text-secondary", currentTheme.textSecondary);
    root.style.setProperty("--theme-text-muted", currentTheme.textMuted);
    root.style.setProperty("--theme-surface", currentTheme.surface);
    root.style.setProperty("--theme-surface-hover", currentTheme.surfaceHover);
    root.style.setProperty("--theme-border", currentTheme.border);
    root.setAttribute("data-theme-mode", currentTheme.mode);
  }, [currentTheme]);

  const themeStyles = useMemo(
    () =>
      ({
        "--theme-accent": currentTheme.accent,
        "--theme-brand": currentTheme.brand || "#A30F2D",
        "--theme-brand-surface": currentTheme.brandSurface || "#FCE8ED",
        "--theme-bg": currentTheme.bg,
        "--theme-glass-bg": currentTheme.glassBg,
        "--theme-glass-border": currentTheme.glassBorder,
        "--theme-text-accent": currentTheme.textAccent,
        "--theme-text-primary": currentTheme.textPrimary,
        "--theme-text-secondary": currentTheme.textSecondary,
        "--theme-text-muted": currentTheme.textMuted,
        "--theme-surface": currentTheme.surface,
        "--theme-surface-hover": currentTheme.surfaceHover,
        "--theme-border": currentTheme.border,
      }) as React.CSSProperties,
    [currentTheme],
  );

  return { currentTheme, themeStyles };
}
