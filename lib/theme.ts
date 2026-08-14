/**
 * Theme presets and utilities.
 *
 * The app supports 8 named color themes. The active one comes from
 * store.appConfig.globalTheme, optionally overridden per-session by an
 * admin's Settings preview. Consumers should use the useTheme hook
 * rather than importing THEME_PRESETS directly.
 */

export interface ThemePreset {
  id: string;
  name: string;
  accent: string;
  bg: string;
  glassBg: string;
  glassBorder: string;
  textAccent: string;
  description: string;
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: "emerald",
    name: "Emerald Pitch",
    accent: "#10b981",
    bg: "radial-gradient(circle at 50% 0%, #064e3b 0%, #022c22 100%)",
    glassBg: "rgba(16, 185, 129, 0.05)",
    glassBorder: "rgba(16, 185, 129, 0.15)",
    textAccent: "#022c22",
    description: "Deep stadium fields & grass turf aesthetic.",
  },
  {
    id: "ruby",
    name: "Crimson Arena",
    accent: "#f43f5e",
    bg: "radial-gradient(circle at 50% 0%, #4c0519 0%, #170008 100%)",
    glassBg: "rgba(244, 63, 94, 0.05)",
    glassBorder: "rgba(244, 63, 94, 0.15)",
    textAccent: "#170008",
    description: "Fierce stadium intensity with warm crimson tones.",
  },
  {
    id: "cyber",
    name: "Teal Cyber-Turf",
    accent: "#06b6d4",
    bg: "radial-gradient(circle at 50% 0%, #083344 0%, #021720 100%)",
    glassBg: "rgba(6, 182, 212, 0.05)",
    glassBorder: "rgba(6, 182, 212, 0.15)",
    textAccent: "#021720",
    description: "Striking high-contrast digital workspace.",
  },
  {
    id: "amber",
    name: "Golden Glory",
    accent: "#f59e0b",
    bg: "radial-gradient(circle at 50% 0%, #451a03 0%, #180500 100%)",
    glassBg: "rgba(245, 158, 11, 0.04)",
    glassBorder: "rgba(245, 158, 11, 0.13)",
    textAccent: "#180500",
    description: "Warm, professional retro champions gold look.",
  },
  {
    id: "royal",
    name: "Midnight Royal",
    accent: "#6366f1",
    bg: "radial-gradient(circle at 50% 0%, #1e1b4b 0%, #0f0728 100%)",
    glassBg: "rgba(99, 102, 241, 0.05)",
    glassBorder: "rgba(99, 102, 241, 0.15)",
    textAccent: "#0f0728",
    description: "Premium midnight blues with indigo elements.",
  },
  {
    id: "carbon",
    name: "Elite Carbon",
    accent: "#f1f5f9",
    bg: "radial-gradient(circle at 50% 0%, #1e293b 0%, #09101d 100%)",
    glassBg: "rgba(241, 245, 249, 0.04)",
    glassBorder: "rgba(241, 245, 249, 0.13)",
    textAccent: "#0f172a",
    description: "Luxury stealth carbon dark design.",
  },
  {
    id: "brown",
    name: "Classic Brown",
    accent: "#d97706",
    bg: "radial-gradient(circle at 50% 0%, #5e3a1f 0%, #291508 100%)",
    glassBg: "rgba(217, 119, 6, 0.05)",
    glassBorder: "rgba(217, 119, 6, 0.15)",
    textAccent: "#291508",
    description: "Warm, rich leather and earthy tones.",
  },
  {
    // Independence-day tribute. The Indian flag's saffron/white/green
    // can't be the literal page background — the whole app renders
    // white text, which would vanish on white/orange bands. So this is
    // a *dark* tricolour: a deep saffron→neutral→green vertical sweep
    // kept dark enough that white text stays >15:1 contrast everywhere.
    // Accent is the official India Saffron (#FF9933); the app already
    // pairs solid bg-accent with black text, so a light accent is safe.
    // Glass panels use a neutral white tint (nodding to the white band),
    // and on-accent text uses Ashoka-Chakra navy — so all four flag
    // colours (saffron, white, green, chakra navy) are represented.
    id: "tiranga",
    name: "Tiranga Tricolour",
    accent: "#FF9933",
    bg: "linear-gradient(180deg, #3d1e00 0%, #20232f 50%, #06220e 100%)",
    glassBg: "rgba(255, 255, 255, 0.055)",
    glassBorder: "rgba(255, 153, 51, 0.22)",
    textAccent: "#04122e",
    description: "Saffron, white & green with Ashoka-navy — Tiranga pride.",
  },
];

export const DEFAULT_THEME_ID = "emerald";

export function resolveTheme(
  preferredId: string | null | undefined,
  fallbackId: string | null | undefined,
): ThemePreset {
  const target = preferredId || fallbackId || DEFAULT_THEME_ID;
  return THEME_PRESETS.find((t) => t.id === target) || THEME_PRESETS[0];
}
