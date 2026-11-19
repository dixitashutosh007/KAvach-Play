# KAvach Play — Core Foundation
## Document 19: Design System Implementation Blueprint

**Document Type:** Design System Architecture & Component Implementation Blueprint  
**Repository Baseline:** `https://github.com/dixitashutosh007/KAvach-Play`  
**Target Branch:** `mig-mov` (Commit: `6539a21`)  
**Date:** November 2026  
**Status:** Approved Design System Blueprint

---

## 1. Executive Summary

This blueprint defines the technical implementation of the approved KAvach Play design system on the existing Next.js 15 App Router and Tailwind CSS stack. It establishes exact CSS variables, Tailwind utility classes, typography configuration (`Poppins` + `Inter`), responsive layout boundaries, accessibility rules (WCAG 2.1 AA), and a modular reusable component structure.

---

## 2. Approved Design Tokens Specification

### 2.1 Color Tokens

| Token Name | CSS Custom Property | Tailwind Class | Hex Value | Primary Semantic Role | Contrast (on Canvas) |
|---|---|---|---|---|---|
| **Deep Wine** | `--brand-wine` | `text-wine`, `bg-wine` | `#7A1E2B` | Authoritative branding, top header background, active primary tabs, major modal headers. | 9.8:1 (AAA) |
| **Scarlet** | `--brand-scarlet` | `text-scarlet`, `bg-scarlet` | `#C0394B` | Primary call-to-action buttons ("Pay Dues", "Confirm RSVP", "Check In"), focus rings, active badges. | 5.2:1 (AA) |
| **Dusty Red** | `--brand-dusty` | `text-dusty`, `bg-dusty` | `#E76B73` | Secondary accents, soft alerts, hover borders, secondary status indicators. | 3.1:1 (UI Component) |
| **Muted Gold** | `--brand-gold` | `text-gold`, `bg-gold` | `#D6A84F` | Trophies, milestone badges, 50/100 accolades, tournament winner accents. | 3.0:1 (Graphical) |
| **Warm White** | `--canvas-warm` | `bg-warm-canvas` | `#FFF6F4` | Primary page canvas background (eliminates bright outdoor sun glare). | N/A (Canvas) |
| **Soft Blush** | `--surface-blush` | `bg-soft-blush` | `#F8EDEE` | Card containers, list item surfaces, input field backdrops. | N/A (Surface) |
| **White** | `--surface-card` | `bg-white` | `#FFFFFF` | Elevated cards, bottom sheets, centered modal dialogue surfaces. | Base Surface |
| **Charcoal** | `--text-charcoal` | `text-charcoal` | `#29252A` | Primary headings, player names, tabular values, scorecards, invoice text. | 14.5:1 (AAA) |

### 2.2 Status & Operational Accent Tokens (Derived for Accessibility)

| Status Role | Hex Code | Tailwind Utility | Semantic Application | WCAG Compliance |
|---|---|---|---|---|
| **Success / Paid** | `#15803D` | `bg-emerald-700`, `text-emerald-800` | Paid dues, confirmed match attendance, active studio subscription. | 4.8:1 (AA) |
| **Warning / Pending** | `#B45309` | `bg-amber-600`, `text-amber-900` | Unpaid fee notice, tentative RSVP, expiring net pass. | 4.7:1 (AA) |
| **Danger / Overdue** | `#B91C1C` | `bg-rose-700`, `text-rose-900` | Overdue debts, absent match attendance, critical errors. | 5.8:1 (AA) |
| **Info / Option A** | `#1D4ED8` | `bg-blue-700`, `text-blue-900` | Option A waived match notices, ground weather alerts. | 5.9:1 (AA) |

---

## 3. Typography Architecture

### 3.1 Font Configuration
- **Headings Font Family:** `Poppins`, `sans-serif` (weights: `600` SemiBold, `700` Bold, `800` ExtraBold).
- **Body & Numerical Font Family:** `Inter`, `-apple-system`, `sans-serif` (weights: `400` Regular, `500` Medium, `600` SemiBold, `700` Bold).
- **Tabular Figures:** Monospace or tabular figures (`tabular-nums`) for all cricket statistics (runs, wickets, overs, strike rates, economy), timestamps, and financial dues.

### 3.2 Typography Scale

| Hierarchy Level | Font | Size (px / rem) | Line Height | Weight | Tracking | Primary Usage |
|---|---|---|---|---|---|---|
| **Hero / Display** | Poppins | 24px / 1.5rem | 32px | 800 (ExtraBold) | `-0.025em` | Match score banners, total dues headline. |
| **Heading 1 (H1)** | Poppins | 20px / 1.25rem | 28px | 700 (Bold) | `-0.02em` | Hub titles, modal headers. |
| **Heading 2 (H2)** | Poppins | 16px / 1.0rem | 24px | 600 (SemiBold) | `-0.01em` | Card section titles, drawer headings. |
| **Subtitle / Subhead**| Inter | 14px / 0.875rem | 20px | 600 (SemiBold) | `normal` | Card titles, player names. |
| **Body Standard** | Inter | 13px / 0.8125rem | 18px | 400 / 500 | `normal` | Announcement feed, descriptions. |
| **Body Small** | Inter | 12px / 0.75rem | 16px | 500 / 600 | `normal` | Match venue metadata, reporting time. |
| **Caption / Badge** | Inter | 10px / 0.625rem | 14px | 700 (Bold) | `+0.05em` | Uppercase status badges, KAV IDs. |

---

## 4. Spacing, Sizing & Ergonomic Rules

### 4.1 Touch Target Standard (WCAG 2.5.5 Compliance)
- **Mandatory Dimension:** Every touchable button, toggle, tab, link, or icon on mobile viewports must enforce a minimum interactive bounding box of **`44×44px`** (`min-h-[44px]` and `min-w-[44px]`).
- **Pitch-Side Safe Controls:**
  - 1-Tap RSVP pills: `min-h-[44px]` with high-contrast active states.
  - Cash logging action: `min-h-[48px]` with debounced single-tap lock.
  - Attendance selectors: `min-h-[44px]` with visual status cycling.

### 4.2 Spacing & Radii Standards
- **Corner Radii:**
  - Micro Badges & Tags: `rounded-lg` (8px)
  - Interactive Buttons & Inputs: `rounded-xl` (12px)
  - Elevated Cards, Modals, Bottom Sheets: `rounded-2xl` (16px)
  - Full-pill Indicators: `rounded-full` (9999px)
- **Elevation & Shadows:**
  - Subtle Card Elevation: `0 1px 3px 0 rgba(41, 37, 42, 0.06)`
  - Elevated Card / Hover: `0 4px 6px -1px rgba(41, 37, 42, 0.1)`
  - Sheet / Modal Overlay: `0 20px 25px -5px rgba(41, 37, 42, 0.25)`

---

## 5. Reusable Component Pattern Catalog

To prevent component fragmentation across the 4 phases, reusable components must be structured under `components/ui/` and `components/shared/`:

```
components/
├── ui/                              # Core Atomic Primitives
│   ├── Button.tsx                   # Primary (Scarlet), Secondary, Ghost, Danger
│   ├── Input.tsx                    # Accessible input with inline validation
│   ├── Select.tsx                   # Accessible dropdown select
│   ├── Badge.tsx                    # Status badges (Paid, Pending, Overdue, Waived)
│   ├── Card.tsx                     # ContentCard, MetricCard, ActionCard
│   ├── BottomSheet.tsx              # Mobile slide-up sheet with drag handle
│   ├── Modal.tsx                    # Desktop centered modal dialog
│   ├── Toast.tsx                    # Floating toast feedback provider
│   └── ConfirmDialog.tsx            # Global destructive action confirmation
└── shared/                          # Domain Shared Components
    ├── PitchSideCashLogger.tsx      # Safe 2-step cash collection component
    ├── PlayerAvatar.tsx             # Standardized player photo/initials with status
    ├── StatChip.tsx                 # Runs, Wickets, Average tabular display chip
    └── DuesBadge.tsx                # Dynamic dues indicator linking to Finance
```

### 5.1 Component Specifications

1. **`Button` Primitive:**
   - **Primary Variant:** `bg-[#C0394B] text-white font-bold rounded-xl min-h-[44px] px-4 shadow-sm hover:bg-[#7A1E2B] active:scale-[0.98] transition`.
   - **Secondary Variant:** `border border-[#7A1E2B]/30 text-[#7A1E2B] bg-[#FFF6F4] font-semibold rounded-xl min-h-[44px] px-4 hover:bg-[#F8EDEE]`.
   - **Loading State:** Disables click events, displays inline SVG spinner, preserves button width to prevent layout jitter.
2. **`Card` Primitives:**
   - **`ContentCard`:** Surface `bg-white` or `bg-[#F8EDEE]`, border `border-[#E5E7EB]`, radius `rounded-2xl`, padding `p-4` (mobile) / `p-6` (desktop).
   - **`MetricCard`:** Clean KPI box displaying metric value in Poppins ExtraBold, label in Inter Medium, and status change badge.
   - **`ActionCard`:** Card integrating an immediate primary call-to-action button.
3. **`ResponsiveOverlay` (Sheet vs. Modal):**
   - **Mobile (`< 640px`):** Slides up from the bottom as a **Bottom Sheet** (`pb-safe`, drag handle, 100% width, dismiss on backdrop swipe).
   - **Desktop (`>= 640px`):** Centers on screen as an **Elevated Modal** with `max-w-lg` or `max-w-2xl`, Deep Wine header bar, and explicit close button.
   - **History Synchronization:** Intercepts `popstate` to dismiss active overlay without navigating the user away.

---

## 6. Accessibility Governance (WCAG 2.1 AA)

1. **Strict Contrast Compliance:**
   - Charcoal text (`#29252A`) on Warm White canvas (`#FFF6F4`): **14.5:1 (Exceeds AAA)**.
   - Deep Wine elements (`#7A1E2B`) on White: **9.8:1 (Exceeds AAA)**.
   - Scarlet action buttons (`#C0394B`) with white text: **5.2:1 (Exceeds AA)**.
2. **Visible Focus Rings:**
   - All interactive controls feature visible keyboard focus indicators: `outline-2 outline-[#C0394B] outline-offset-2`.
3. **Screen Reader Landmarks:**
   - Semantic HTML regions (`<header>`, `<nav>`, `<main>`, `<aside>`, `<footer>`) with explicit `aria-label` attributes.
   - Dynamic balance updates utilize `aria-live="polite"` to announce payment state changes without interrupting user focus.
