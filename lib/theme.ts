/**
 * Theme presets and utilities.
 *
 * The app supports named color themes. The active one comes from
 * store.appConfig.globalTheme, optionally overridden per-session by an
 * admin's Settings preview. Consumers should use the useTheme hook
 * rather than importing THEME_PRESETS directly.
 */

export interface ThemePreset {
  id: string;
  name: string;
  mode: "light" | "dark";
  accent: string;
  bg: string;
  glassBg: string;
  glassBorder: string;
  textAccent: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  surface: string;
  surfaceHover: string;
  border: string;
  description: string;
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: "kavach",
    name: "Kavach Light",
    mode: "light",
    accent: "#D51F43",
    bg: "#F6F7F9",
    glassBg: "#FFFFFF",
    glassBorder: "#E5E7EB",
    textAccent: "#FFFFFF",
    textPrimary: "#171C26",
    textSecondary: "#4B5563",
    textMuted: "#9CA3AF",
    surface: "#FFFFFF",
    surfaceHover: "#F3F4F6",
    border: "#E5E7EB",
    description: "Clean, professional light theme with KAvach red branding.",
  },
  {
    id: "emerald",
    name: "Emerald Pitch",
    mode: "dark",
    accent: "#10b981",
    bg: "radial-gradient(circle at 50% 0%, #064e3b 0%, #022c22 100%)",
    glassBg: "rgba(16, 185, 129, 0.05)",
    glassBorder: "rgba(16, 185, 129, 0.15)",
    textAccent: "#022c22",
    textPrimary: "#ffffff",
    textSecondary: "rgba(255, 255, 255, 0.7)",
    textMuted: "rgba(255, 255, 255, 0.4)",
    surface: "rgba(16, 185, 129, 0.05)",
    surfaceHover: "rgba(16, 185, 129, 0.10)",
    border: "rgba(16, 185, 129, 0.15)",
    description: "Deep stadium fields & grass turf aesthetic.",
  },
  {
    id: "ruby",
    name: "Crimson Arena",
    mode: "dark",
    accent: "#f43f5e",
    bg: "radial-gradient(circle at 50% 0%, #4c0519 0%, #170008 100%)",
    glassBg: "rgba(244, 63, 94, 0.05)",
    glassBorder: "rgba(244, 63, 94, 0.15)",
    textAccent: "#170008",
    textPrimary: "#ffffff",
    textSecondary: "rgba(255, 255, 255, 0.7)",
    textMuted: "rgba(255, 255, 255, 0.4)",
    surface: "rgba(244, 63, 94, 0.05)",
    surfaceHover: "rgba(244, 63, 94, 0.10)",
    border: "rgba(244, 63, 94, 0.15)",
    description: "Fierce stadium intensity with warm crimson tones.",
  },
  {
    id: "cyber",
    name: "Teal Cyber-Turf",
    mode: "dark",
    accent: "#06b6d4",
    bg: "radial-gradient(circle at 50% 0%, #083344 0%, #021720 100%)",
    glassBg: "rgba(6, 182, 212, 0.05)",
    glassBorder: "rgba(6, 182, 212, 0.15)",
    textAccent: "#021720",
    textPrimary: "#ffffff",
    textSecondary: "rgba(255, 255, 255, 0.7)",
    textMuted: "rgba(255, 255, 255, 0.4)",
    surface: "rgba(6, 182, 212, 0.05)",
    surfaceHover: "rgba(6, 182, 212, 0.10)",
    border: "rgba(6, 182, 212, 0.15)",
    description: "Striking high-contrast digital workspace.",
  },
  {
    id: "amber",
    name: "Golden Glory",
    mode: "dark",
    accent: "#f59e0b",
    bg: "radial-gradient(circle at 50% 0%, #451a03 0%, #180500 100%)",
    glassBg: "rgba(245, 158, 11, 0.04)",
    glassBorder: "rgba(245, 158, 11, 0.13)",
    textAccent: "#180500",
    textPrimary: "#ffffff",
    textSecondary: "rgba(255, 255, 255, 0.7)",
    textMuted: "rgba(255, 255, 255, 0.4)",
    surface: "rgba(245, 158, 11, 0.04)",
    surfaceHover: "rgba(245, 158, 11, 0.09)",
    border: "rgba(245, 158, 11, 0.13)",
    description: "Warm, professional retro champions gold look.",
  },
  {
    id: "royal",
    name: "Midnight Royal",
    mode: "dark",
    accent: "#6366f1",
    bg: "radial-gradient(circle at 50% 0%, #1e1b4b 0%, #0f0728 100%)",
    glassBg: "rgba(99, 102, 241, 0.05)",
    glassBorder: "rgba(99, 102, 241, 0.15)",
    textAccent: "#0f0728",
    textPrimary: "#ffffff",
    textSecondary: "rgba(255, 255, 255, 0.7)",
    textMuted: "rgba(255, 255, 255, 0.4)",
    surface: "rgba(99, 102, 241, 0.05)",
    surfaceHover: "rgba(99, 102, 241, 0.10)",
    border: "rgba(99, 102, 241, 0.15)",
    description: "Premium midnight blues with indigo elements.",
  },
  {
    id: "carbon",
    name: "Elite Carbon",
    mode: "dark",
    accent: "#f1f5f9",
    bg: "radial-gradient(circle at 50% 0%, #1e293b 0%, #09101d 100%)",
    glassBg: "rgba(241, 245, 249, 0.04)",
    glassBorder: "rgba(241, 245, 249, 0.13)",
    textAccent: "#0f172a",
    textPrimary: "#ffffff",
    textSecondary: "rgba(255, 255, 255, 0.7)",
    textMuted: "rgba(255, 255, 255, 0.4)",
    surface: "rgba(241, 245, 249, 0.04)",
    surfaceHover: "rgba(241, 245, 249, 0.09)",
    border: "rgba(241, 245, 249, 0.13)",
    description: "Luxury stealth carbon dark design.",
  },
  {
    id: "brown",
    name: "Classic Brown",
    mode: "dark",
    accent: "#d97706",
    bg: "radial-gradient(circle at 50% 0%, #5e3a1f 0%, #291508 100%)",
    glassBg: "rgba(217, 119, 6, 0.05)",
    glassBorder: "rgba(217, 119, 6, 0.15)",
    textAccent: "#291508",
    textPrimary: "#ffffff",
    textSecondary: "rgba(255, 255, 255, 0.7)",
    textMuted: "rgba(255, 255, 255, 0.4)",
    surface: "rgba(217, 119, 6, 0.05)",
    surfaceHover: "rgba(217, 119, 6, 0.10)",
    border: "rgba(217, 119, 6, 0.15)",
    description: "Warm, rich leather and earthy tones.",
  },
];

export const DEFAULT_THEME_ID = "kavach";

export function resolveTheme(
  preferredId: string | null | undefined,
  fallbackId: string | null | undefined,
): ThemePreset {
  const target = preferredId || fallbackId || DEFAULT_THEME_ID;
  return THEME_PRESETS.find((t) => t.id === target) || THEME_PRESETS[0];
}
