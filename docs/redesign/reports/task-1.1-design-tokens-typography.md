# KAvach Play — Core Foundation
## Task 1.1 Implementation & Review Corrections Report: Design Tokens & Typography Injection

**Document Path:** `docs/redesign/reports/task-1.1-design-tokens-typography.md`  
**Date:** November 19, 2026  
**Author:** Senior Frontend Engineer & Design Systems Architect  
**Reviewing Authority:** Independent Technical Reviewer (ChatGPT) & Product Design Authority  
**Repository:** `dixitashutosh007/KAvach-Play`  
**Target Branch:** `mig-mov`  
**Starting Baseline HEAD SHA:** `6539a212384ec98271119122edb6a82cc463f347`  
**Initial Implementation Commit SHA:** `f9ff25f33f89cafddf4931fa0d55815922685b6d`  
**Review Status:** Corrections Implemented, Verified & Documented  

---

### 1. Assignment Name and Objective

- **Assignment:** Task 1.1 — Implement Approved Design Tokens & Typography (incorporating Reviewer Feedback).
- **Objective:** Establish the approved KAvach Play design-system colour tokens and typography foundation in the existing Next.js 15 / Tailwind CSS application on branch `mig-mov`.
- **Operating Boundary:** Strictly limited to token definitions and font integration in `app/globals.css` and `app/layout.tsx`. Zero modification of existing screen layouts, navigation, business logic, payment gateways, or APIs.
- **Review Corrections Objective:** Address reviewer feedback on single source of truth, accent token unification to Scarlet (`#C0394B`), removal of duplicate declarations in `@theme`, and explicit distinction between tokens defined for future screens vs. styles actively applied to existing screens.

---

### 2. Repository & Baseline Verification

- **Repository:** `https://github.com/dixitashutosh007/KAvach-Play`
- **Target Branch:** `mig-mov`
- **Starting Baseline Commit:** `6539a212384ec98271119122edb6a82cc463f347` (`merge: merge branch 'security/remediation-1f-a' into mig-mov`).
- **Initial Task 1.1 Commit:** `f9ff25f33f89cafddf4931fa0d55815922685b6d` (`feat(ui): establish approved design tokens and typography`).
- **Review Baseline Remote HEAD:** `cb1fb4b35dde77b93f22375313eaaf25d41cb39e` (`docs: add task 1.1 design tokens and typography implementation report`).
- **Working Tree Status:** Clean across all tracked repository files before and after implementation.

---

### 3. Reviewer Feedback & Implemented Corrections

| Reviewer Finding | Issue Identified | Resolution in `app/globals.css` |
|---|---|---|
| **A. Accent Inconsistency** | `:root` mapped `--color-accent` to Scarlet (`#C0394B`), while `@theme` retained legacy `--color-accent: var(--theme-accent, #D51F43)`. This caused raw CSS properties and Tailwind utility classes (`bg-accent`, `text-accent`) to diverge. | Removed `#D51F43` from `@theme`. Defined `--color-accent: var(--brand-scarlet);` in both `:root` and `@theme`. Tailwind utilities and CSS properties now resolve consistently to `#C0394B`. |
| **B. Source of Truth** | Tokens were defined with hardcoded hex codes in `:root` and duplicated independently in `@theme`. | Established `:root` as the canonical source of truth for the 8 approved palette hex values. `@theme` now references these canonical custom properties via `var(...)` syntax. |
| **C. Duplicate Declarations** | `@theme` contained duplicate entries for `--color-brand` and `--color-brand-surface`. | Cleaned up duplicate lines in `@theme` while maintaining backward compatibility for legacy properties. |
| **D. Report Inaccuracy** | Initial report implied Warm White (`#FFF6F4`) and Charcoal (`#29252A`) were immediately applied as global canvas and body text for all existing screens. | Clarified that Warm White and Charcoal are **defined and available** for subsequent screen redesigns (starting Phase 2 Player Home), while existing screens continue using their current background (`#F6F7F9`) and text (`#171C26`) to avoid visual regressions. |

---

### 4. Files Inspected

Before and during implementation, the following architectural files were inspected:
1. `postcss.config.mjs`: Confirmed Tailwind CSS v4 engine (`@tailwindcss/postcss: 4.1.11`).
2. `app/globals.css`: Inspected `@import "tailwindcss";`, `:root`, and `@theme` directives.
3. `app/layout.tsx`: Inspected root container, metadata, client providers, and Google Font loaders.
4. `hooks/useTheme.ts` & `lib/theme.ts`: Inspected runtime theme presets and fallback values.
5. `tests/ui-ux-design.test.mjs`: Inspected test assertions to verify token contracts.

---

### 5. Files Changed

Permitted files modified under Task 1.1 and its review corrections:

| File Path | Nature of Change | Summary of Modifications |
|---|---|---|
| [`app/globals.css`](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/app/globals.css) | Modified | Injected canonical `:root` custom properties for all 8 approved brand tokens. Updated `@theme` block to reference `:root` canonical variables. Unified `--color-accent` to Scarlet (`var(--brand-scarlet)`). Removed duplicate legacy `--color-brand` and `--color-brand-surface` declarations. Added typography utilities (`.font-heading`, `.font-body`). Preserved existing `body` styling (`--theme-bg`, `--theme-text-primary`) for backward compatibility on existing screens. |
| [`app/layout.tsx`](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/app/layout.tsx) | Modified (Initial Task 1.1) | Imported `Inter` and `Poppins` from `next/font/google`. Configured `inter` (variable `--font-inter`, default sans) and `poppins` (variable `--font-poppins`, weights 400-800). Injected font variables onto the `<html>` element and set `<body className={`${inter.className} font-sans`}>`. Preserved all existing providers, metadata, and fallbacks. |
| [`docs/redesign/reports/task-1.1-design-tokens-typography.md`](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/docs/redesign/reports/task-1.1-design-tokens-typography.md) | Modified | Updated implementation report to document reviewer corrections, unified accent resolution, single source of truth, test outcomes, and scope boundaries. |

---

### 6. Exact Token Architecture & Semantic Aliases

#### 6.1 Canonical Base Brand Tokens (`:root`)

The approved palette is defined once in `:root` as the single authoritative source of truth:

```css
:root {
  /* Approved KAvach Play Brand Colour Tokens (Canonical Source of Truth) */
  --brand-wine: #7A1E2B;
  --brand-scarlet: #C0394B;
  --brand-dusty: #E76B73;
  --brand-gold: #D6A84F;
  --canvas-warm: #FFF6F4;
  --surface-blush: #F8EDEE;
  --surface-card: #FFFFFF;
  --text-charcoal: #29252A;

  /* Semantic Aliases */
  --color-primary: var(--brand-wine);
  --color-primary-hover: var(--brand-scarlet);
  --color-accent: var(--brand-scarlet);
  --color-background: var(--canvas-warm);
  --color-surface: var(--surface-card);
  --color-surface-muted: var(--surface-blush);
  --color-text: var(--text-charcoal);
  --color-border: #E5E7EB;
  --color-highlight: var(--brand-gold);
}
```

#### 6.2 Tailwind v4 Theme Binding (`@theme`)

In Tailwind CSS v4, the `@theme` block references canonical properties to generate utility classes:

```css
@theme {
  /* Approved Named Brand Tokens - referencing canonical :root properties */
  --color-deep-wine: var(--brand-wine);
  --color-scarlet: var(--brand-scarlet);
  --color-dusty-red: var(--brand-dusty);
  --color-muted-gold: var(--brand-gold);
  --color-warm-white: var(--canvas-warm);
  --color-soft-blush: var(--surface-blush);
  --color-white: #FFFFFF;
  --color-charcoal: var(--text-charcoal);

  /* Semantic Aliases - consistent with :root custom properties */
  --color-primary: var(--brand-wine);
  --color-primary-hover: var(--brand-scarlet);
  --color-accent: var(--brand-scarlet);
  --color-background: var(--canvas-warm);
  --color-surface: var(--surface-card);
  --color-surface-muted: var(--surface-blush);
  --color-text: var(--text-charcoal);
  --color-border: #E5E7EB;
  --color-highlight: var(--brand-gold);

  /* Font Families */
  --font-sans: var(--font-inter), -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-heading: var(--font-poppins), -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-body: var(--font-inter), -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;

  /* Existing Legacy Tokens Preserved for Backward Compatibility (Deduplicated) */
  --color-brand: var(--theme-brand, #A30F2D);
  --color-brand-surface: var(--theme-brand-surface, #FCE8ED);
  --color-glass-bg: var(--theme-glass-bg, #FFFFFF);
  --color-glass-border: var(--theme-glass-border, #E5E7EB);
  --color-text-primary: var(--theme-text-primary, #171C26);
  --color-text-secondary: var(--theme-text-secondary, #667085);
  --color-text-muted: var(--theme-text-muted, #9CA3AF);
  --color-surface-hover: var(--theme-surface-hover, #F3F4F6);
  --color-text-accent: var(--theme-text-accent, #FFFFFF);
}
```

#### 6.3 Defined & Available vs. Actively Applied Styles

To prevent visual regressions during Task 1.1:
- **Defined and Available:** Warm White (`#FFF6F4`) and Charcoal (`#29252A`) are fully defined as named utilities (`bg-warm-white`, `text-charcoal`) and semantic variables (`--color-background`, `--color-text`). They are available for upcoming screen redesigns starting with Phase 2 (Player Home).
- **Actively Applied to Existing Screens:** The `body` element in `app/globals.css` intentionally retains `background: var(--theme-bg, #F6F7F9);` and `color: var(--theme-text-primary, #171C26);`. Existing screens and components are not altered, maintaining visual stability until their scheduled phase redesigns.

---

#### 6.4 Token Mapping Summary Table

| Token Name | Hex Code | Canonical CSS Var | Tailwind Class | Semantic Role |
|---|---|---|---|---|
| **Deep Wine** | `#7A1E2B` | `--brand-wine` | `bg-deep-wine`, `text-deep-wine` | Primary brand color, headers, primary action backgrounds |
| **Scarlet** | `#C0394B` | `--brand-scarlet` | `bg-scarlet`, `text-scarlet`, `bg-accent` | Secondary emphasis, primary interactive CTAs, active focus rings, unified accent |
| **Dusty Red** | `#E76B73` | `--brand-dusty` | `bg-dusty-red`, `text-dusty-red` | Supporting accents, active sub-tabs, soft borders |
| **Muted Gold** | `#D6A84F` | `--brand-gold` | `bg-muted-gold`, `text-muted-gold` | Highlights, milestone badges, trophy accents, 50/100 accolades |
| **Warm White** | `#FFF6F4` | `--canvas-warm` | `bg-warm-white`, `text-warm-white` | Defined canvas background for upcoming screen redesigns |
| **Soft Blush** | `#F8EDEE` | `--surface-blush` | `bg-soft-blush`, `text-soft-blush` | Secondary surfaces, card backdrops, elevated list items |
| **White** | `#FFFFFF` | `--surface-card` | `bg-white`, `text-white` | Cards, elevated modal surfaces, bottom sheets |
| **Charcoal** | `#29252A` | `--text-charcoal` | `bg-charcoal`, `text-charcoal` | Defined body text and heading color for upcoming screen redesigns |

---

### 7. Typography Implementation & Loading

- **Next.js Google Fonts Integration:** Loaded via `next/font/google` directly in `app/layout.tsx`.
- **Inter (Body & Tabular Data):**
  - Variable: `--font-inter`
  - Applied to `<html>` and `<body>` via `${inter.className} font-sans`.
  - Fallback: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`.
- **Poppins (Headings & Display):**
  - Variable: `--font-poppins`
  - Weights: `["400", "500", "600", "700", "800"]`.
  - Available via utility class `.font-heading` and Tailwind `font-heading`.
- **Zero Third-Party External Scripts:** Fonts are bundled at build time with `display: "swap"`.

---

### 8. Verification & Test Results

Verification was executed against the corrected codebase:

| Check | Command Executed | Outcome | Details |
|---|---|---|---|
| **Production Build** | `npm run build` (`NODE_ENV=production next build`) | **PASS (Exit code 0)** | All 19 routes compiled successfully. Google Fonts inlined and optimized in output JS chunks. |
| **Type Checking** | Executed during `next build` | **PASS (Exit code 0)** | Zero TypeScript errors across all routes and components. |
| **Lint Validation** | `npm run lint` (`eslint .`) | **PASS (Exit code 0)** | 0 errors. 4 pre-existing Firestore security rules warnings noted. |
| **Functional Tests** | `npm run test:functional` (`node --test tests/*.test.mjs`) | **311 PASSED, 1 FAILED** | 311 tests passed across all functional suites. See failure analysis below. |

#### Functional Test Failure Analysis:
- **Test:** `UX-002: Design tokens define primary brand #A30F2D and primary action #D51F43` in `tests/ui-ux-design.test.mjs` (Line 23).
- **Root Cause:** Line 23 of `tests/ui-ux-design.test.mjs` checks `app/globals.css` with a hardcoded regex expecting the legacy action token: `assert.match(css, /--color-accent:\s*var\(--theme-accent,\s*#D51F43\);/)`.
- **Nature of Failure:** This test was written for the earlier audit baseline prior to the approved design palette mandate. In accordance with the reviewer's instructions to resolve accent inconsistency by unifying `--color-accent` to Scarlet (`#C0394B`), `#D51F43` was removed.
- **Reporting Integrity:** As instructed by the reviewer ("If a check fails: Identify whether the failure existed before this task or was introduced by your changes. Do not conceal failures. Do not make unrelated fixes to force a green build"), this test failure is accurately disclosed and not masked by unauthorized edits to `tests/ui-ux-design.test.mjs`.

---

### 9. Preservation & Non-Regression Checks

- **Existing Layouts & Screens:** 100% untouched. No screen JSX or styling classes were altered.
- **Authentication & Authorization:** Untouched.
- **Razorpay Payments & Webhooks:** Untouched.
- **Backward Compatibility:** All existing legacy tokens (`--color-brand`, `--color-brand-surface`, `--color-glass-bg`, `--color-text-primary`, `--theme-bg`) remain active.

---

### 10. Confirmation of Strict Scope Adherence

In accordance with Core Foundation guidelines and reviewer constraints:
- Zero header refactoring.
- Zero navigation or drawer changes.
- Zero screen redesigns.
- Zero cash logger or dues modifications.
- Zero package installs or version changes.
- Zero production deployment.
- Strict **STOP condition observed** following completion of Task 1.1 review corrections.
