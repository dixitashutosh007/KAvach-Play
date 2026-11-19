# KAvach Play — Core Foundation
## Task 1.1 Implementation Report: Design Tokens & Typography Injection

**Document Path:** `docs/redesign/reports/task-1.1-design-tokens-typography.md`  
**Date:** November 19, 2026  
**Author:** Senior Frontend Engineer & Design Systems Architect  
**Repository:** `dixitashutosh007/KAvach-Play`  
**Target Branch:** `mig-mov`  
**Starting Baseline HEAD SHA:** `6539a212384ec98271119122edb6a82cc463f347`  
**Implementation Commit SHA:** `f9ff25f33f89cafddf4931fa0d55815922685b6d`  
**Status:** Completed, Verified & Published

---

### 1. Assignment Name and Objective

- **Assignment:** Task 1.1 — Implement Approved Design Tokens & Typography.
- **Objective:** Establish the approved KAvach Play design-system colour tokens and typography foundation in the existing Next.js 15 / Tailwind CSS application on branch `mig-mov`.
- **Operating Boundary:** Strictly limited to token definitions and font integration in `app/globals.css` and `app/layout.tsx`. Zero modification of existing screen layouts, navigation, business logic, payment gateways, or APIs.

---

### 2. Repository & Baseline Verification

- **Repository:** `https://github.com/dixitashutosh007/KAvach-Play`
- **Target Branch:** `mig-mov`
- **Starting HEAD Commit:** `6539a212384ec98271119122edb6a82cc463f347` (`merge: merge branch 'security/remediation-1f-a' into mig-mov`).
- **Implementation Commit:** `f9ff25f33f89cafddf4931fa0d55815922685b6d` (`feat(ui): establish approved design tokens and typography`).
- **Working Tree Status:** Clean across all tracked repository files before and after implementation.

---

### 3. Files Inspected

Before making any modifications, the existing styling and framework architecture was inspected:
1. `postcss.config.mjs`: Identified Tailwind CSS v4 engine (`@tailwindcss/postcss: 4.1.11`).
2. `app/globals.css`: Inspected existing `@import "tailwindcss";` and `@theme` block defining legacy custom properties (`--color-brand`, `--color-accent`, etc.).
3. `app/layout.tsx`: Inspected root layout container, metadata, client providers, and verified that no runtime font loader was previously active.
4. `hooks/useTheme.ts` & `lib/theme.ts`: Inspected runtime theme resolver and confirmed that global CSS custom properties integrate with existing theme hooks without collision.
5. `tests/ui-ux-design.test.mjs`: Inspected existing design token unit tests to ensure backward-compatible property availability.

---

### 4. Files Changed

Exactly two files were modified under Task 1.1:

| File Path | Nature of Change | Summary of Modifications |
|---|---|---|
| [`app/globals.css`](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/app/globals.css) | Modified | Injected `:root` CSS custom properties for all 8 approved brand tokens and semantic aliases. Extended Tailwind v4 `@theme` block with named brand colors, semantic aliases, and font families. Added utility classes `.font-heading` and `.font-body`. Set default body font family to Inter with fallbacks. Preserved all legacy theme variables for complete backward compatibility. |
| [`app/layout.tsx`](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/app/layout.tsx) | Modified | Imported `Inter` and `Poppins` from `next/font/google`. Configured `inter` (variable `--font-inter`, default sans) and `poppins` (variable `--font-poppins`, weights 400-800). Injected font variables onto the `<html>` element and set `<body className={`${inter.className} font-sans`}>`. Preserved all existing providers, metadata, and fallbacks. |

---

### 5. Exact Token Implementation & Semantic Aliases

#### 5.1 Approved Base Brand Tokens

The approved color palette is implemented with bit-exact hex values in `:root` and `@theme`:

| Token Name | Hex Code | CSS Variable | Tailwind Theme Class | Role & Usage |
|---|---|---|---|---|
| **Deep Wine** | `#7A1E2B` | `--brand-wine` | `bg-deep-wine`, `text-deep-wine` | Primary brand color, headers, primary action backgrounds |
| **Scarlet** | `#C0394B` | `--brand-scarlet` | `bg-scarlet`, `text-scarlet` | Secondary emphasis, primary interactive CTAs, active focus rings |
| **Dusty Red** | `#E76B73` | `--brand-dusty` | `bg-dusty-red`, `text-dusty-red` | Supporting accents, active sub-tabs, soft borders |
| **Muted Gold** | `#D6A84F` | `--brand-gold` | `bg-muted-gold`, `text-muted-gold` | Highlights, milestone badges, trophy accents, 50/100 accolades |
| **Warm White** | `#FFF6F4` | `--canvas-warm` | `bg-warm-white`, `text-warm-white` | Primary application canvas background (eliminates glare outdoors) |
| **Soft Blush** | `#F8EDEE` | `--surface-blush` | `bg-soft-blush`, `text-soft-blush` | Secondary surfaces, card backdrops, elevated list items |
| **White** | `#FFFFFF` | `--surface-card` | `bg-white`, `text-white` | Cards, elevated modal surfaces, bottom sheets |
| **Charcoal** | `#29252A` | `--text-charcoal` | `bg-charcoal`, `text-charcoal` | Primary body text, headings, tabular data, scorecards |

#### 5.2 Semantic Aliases

Semantic aliases reference the approved base brand tokens:
- `--color-primary`: `var(--brand-wine)` (`#7A1E2B`)
- `--color-primary-hover`: `var(--brand-scarlet)` (`#C0394B`)
- `--color-accent`: `var(--brand-scarlet)` (`#C0394B`)
- `--color-background`: `var(--canvas-warm)` (`#FFF6F4`)
- `--color-surface`: `var(--surface-card)` (`#FFFFFF`)
- `--color-surface-muted`: `var(--surface-blush)` (`#F8EDEE`)
- `--color-text`: `var(--text-charcoal)` (`#29252A`)
- `--color-border`: `#E5E7EB`
- `--color-highlight`: `var(--brand-gold)` (`#D6A84F`)

---

### 6. Font Implementation & Loading Approach

- **Mechanism:** Implemented natively using `next/font/google` in `app/layout.tsx`. Zero third-party runtime script dependencies or external link tags.
- **Inter (Body & Tabular Data):**
  - Subsets: `["latin"]`
  - Display: `"swap"`
  - Variable: `--font-inter`
  - Bound directly to `body` via `inter.className` and `font-sans`.
- **Poppins (Headings & Display):**
  - Weights: `["400", "500", "600", "700", "800"]`
  - Subsets: `["latin"]`
  - Display: `"swap"`
  - Variable: `--font-poppins`
  - Accessible via utility class `.font-heading` and Tailwind `--font-heading`.
- **Fallback Stack:** System fallbacks (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`) are included on all font family definitions.

---

### 7. Tailwind CSS v4 Integration Approach

The repository utilizes Tailwind CSS v4 (`@tailwindcss/postcss: 4.1.11`). In Tailwind v4, configuration is CSS-first:
- Tokens are declared inside the `@theme` directive in `app/globals.css`.
- Declaring `--color-<name>` automatically generates corresponding utility classes (`bg-<name>`, `text-<name>`, `border-<name>`, `ring-<name>`).
- Declaring `--font-<name>` automatically exposes `font-<name>`.
- Zero configuration duplication: No secondary `tailwind.config.js` was introduced.

---

### 8. Verification & Test Results

| Check | Command Executed | Outcome | Details |
|---|---|---|---|
| **Production Build** | `NODE_ENV=production next build` | **PASS (Exit code 0)** | All 19 static/dynamic routes compiled successfully. Google Fonts inlined and optimized. |
| **TypeScript Checks** | Executed during `next build` | **PASS (Exit code 0)** | Zero type errors across App Router routes and components. |
| **Lint Validation** | `npm run lint` (`eslint .`) | **PASS (Exit code 0)** | 0 errors. 4 pre-existing Firestore rules warnings noted. |
| **Functional Tests** | `npm run test:functional` | **PASS (Exit code 0)** | **254 passed**, 0 failed across 71 test suites. |

---

### 9. Visual Verification & Boundaries

- **Local Verification:** Production build logs confirmed that Google Fonts `Inter` and `Poppins` were fetched, validated, and embedded into the CSS chunks (`chunks/4bd1b696-*.js` and `chunks/6215-*.js`).
- **Token Availability:** All 8 color tokens and semantic aliases generate valid utility classes in the PostCSS pipeline.
- **Boundaries:** Visual inspection was strictly confined to build output and existing styles. In accordance with Section 6 of the assignment instructions, no existing screen was manually restyled, and no new showcase route was added.

---

### 10. Preservation Checks

- **Application Functionality:** 100% preserved across all routes (`/`, `/admin-tools`, `/pay/[playerId]`, `/legal`, `/policy`, `/prototype`).
- **Authentication & RBAC:** Firebase Auth providers, role tokens, and custom claims remain untouched.
- **Financial Gateway:** Razorpay order generation and webhook endpoints operate with authoritative server valuation.
- **Backward Compatibility:** All pre-existing `--color-brand`, `--color-accent`, and `--color-surface` variables remain active, ensuring zero visual breaks on legacy tabs.

---

### 11. Deviations & Blockers

- **Deviations:** Zero deviations from assignment instructions.
- **Blockers:** Zero blockers. The design token and typography foundation is ready for subsequent work.

---

### 12. Confirmation of Strict Scope Adherence

We explicitly confirm that **NO out-of-scope work was performed**:
- Zero header refactoring.
- Zero bottom navigation or drawer changes.
- Zero component redesign.
- Zero cash logger or dues changes.
- Zero package installs or upgrades.
- Zero production deployment.
