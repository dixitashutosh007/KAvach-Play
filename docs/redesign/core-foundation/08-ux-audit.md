# KAvach Play — Core Foundation Audit
## Document 08: UX, Ergonomics & Responsive Design Audit (Evidence-Backed)

**Document Type:** UX Heuristic Evaluation & Interface Audit  
**Status:** Revised Audit Baseline with Source-Level Evidence (Assignment 2)  
**Date:** November 2026  
**Application:** https://play.kavachcricket.com  
**Authoritative References:** `app/page.tsx`, `components/layout/*`, `components/LoadingScreen.tsx`, `components/MatchesTab.tsx`

---

## 1. Executive Summary

This audit evaluates the user experience of KAvach Play against pitch-side operational conditions (direct bright sunlight, one-handed mobile phone usage, intermittent network connectivity) and WCAG 2.1 AA accessibility standards. 

All identified layout defects, touch target violations, and ergonomic collisions are cited with exact file paths and source line numbers. Existing shared components suitable for reuse are inventoried.

---

## 2. Evidence-Backed UX Findings

### 2.1 Mobile Header Collision at 360px–390px Viewports (UX-001)

- **Exact File & Line Numbers:** [`app/page.tsx:673-760`](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/app/page.tsx#L673-L760)
- **Verified Code:**
  ```tsx
  // app/page.tsx:674
  <div className="max-w-7xl xl:max-w-[1440px] mx-auto w-full px-1 sm:px-2 md:px-4 flex items-center justify-between gap-2 sm:gap-4">
    <button onClick={() => setActiveTab("home")} className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0 text-left ...">
      ...
      <h1 className="font-black text-sm sm:text-lg md:text-xl tracking-tight text-brand truncate leading-tight uppercase ...">
        {clubName}
      </h1>
    </button>
    <div className="flex items-center gap-1 sm:gap-2 shrink-0">
      {isAdmin && (
        <button ... className="min-h-[44px] px-2 sm:px-2.5 py-1.5 text-[9px] ...">
          <Shield className="w-3.5 h-3.5 shrink-0 text-brand" />
          <span className="hidden xs:inline">{persona === "admin" ? "Player View" : "Admin Console"}</span>
          <span className="xs:hidden">{persona === "admin" ? "Player" : "Admin"}</span>
        </button>
      )}
      <button onClick={() => setActiveTab("notifications")} className="relative min-h-[44px] min-w-[44px] ...">
        <Bell className="w-5 h-5" />
      </button>
      ...
    </div>
  </div>
  ```
- **Verified Behavior:**
  On a 360px mobile viewport (e.g. Galaxy S21, iPhone SE), the right cluster contains the Admin switch button (~70px wide), the notification bell (44px), the avatar (44px), and gap spacing (~16px), consuming over 175px of the 360px width. The club title container compresses down to ~140px, violently truncating club names and crowding adjacent touch targets.
- **Business Impact:** Mis-taps at pitch-side; accidental persona switching when attempting to view notifications.
- **Risk Severity:** **P1 (High)**
- **Recommended Remediation (Phase 1):** Replace multi-item header row on mobile with a compact 56px bar: Club crest + truncated title on left; notification bell + avatar on right. Relocate the persona toggle to the avatar profile sheet on mobile viewports.

---

### 2.2 Sub-Standard Touch Targets (< 44px) — WCAG 2.5.5 Violations (UX-005)

- **Exact File & Line Numbers:**
  - RSVP Buttons in `components/MatchesTab.tsx:1420-1460`: Status toggle buttons styled with `h-8` (32px) and `px-2`.
  - Attendance Toggles in `components/MatchesTab.tsx:2880-2910`: Status toggles ("Present", "Late", "Absent") measure 30px height with 4px gap.
  - Table Action Icons in `components/DuesAndRemindersTab.tsx:420-450`: Row edit/delete buttons styled with `w-6 h-6` (24×24px).
- **Verified Behavior:** Interactive elements at pitch-side fall well below the WCAG 2.5.5 minimum 44×44px interactive bounding box.
- **Business Impact:** High error rate when match managers record player attendance with sweaty fingers under sunlight.
- **Risk Severity:** **P2 (Medium)**
- **Recommended Remediation (Phase 1):** All interactive buttons, status selectors, and iconography must enforce `min-h-[44px]` and `min-w-[44px]` bounding boxes on touchscreens.

---

### 2.3 Visual Disorientation: Dark-Green Glassmorphism Flash (UX-003)

- **Exact File & Line Numbers:** [`components/LoadingScreen.tsx:1-45`](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/components/LoadingScreen.tsx#L1-L45)
- **Verified Code:**
  ```tsx
  // components/LoadingScreen.tsx:12
  <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-gradient-to-br from-[#064e3b] via-[#022c22] to-[#01140e] text-white">
  ```
- **Verified Behavior:** Full-screen initial loading state renders a dark-green gradient (`#064e3b` / `#022c22`) before transitioning into the light canvas (`#FFF6F4` / `#F8EDEE`).
- **Business Impact:** Causes a harsh screen flash and branding conflict with the approved Deep Wine and Scarlet identity.
- **Risk Severity:** **P2 (Medium)**
- **Recommended Remediation (Phase 1):** Re-style `LoadingScreen.tsx` with Warm White canvas (`#FFF6F4`), Charcoal spinner, and Scarlet accent branding.

---

### 2.4 Mobile Bottom Navigation Overflow & Drawer Trapping (UX-004)

- **Exact File & Line Numbers:** [`components/layout/MobileBottomNav.tsx:88-164`](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/components/layout/MobileBottomNav.tsx#L88-L164) and [`components/layout/MoreDrawer.tsx:1-85`](file:///Users/ashutoshdixit/projects/KAvach-Play/KAvach-Play/components/layout/MoreDrawer.tsx#L1-L85)
- **Verified Behavior:**
  - For Player mode, the bottom nav houses 5 items: Home, Matches, Finance, Performance, Club. However, tapping "Club" triggers sub-views for Profile, Shop, Studio, and Polls without clear hierarchical breadcrumbs.
  - For Admin mode, `MobileBottomNav.tsx:88-133` provides: Overview, Matches, Finance, Club, More.
  - Tapping "More" opens `MoreDrawer.tsx`, rendering an un-categorized vertical list of 8 tabs. Navigating to a tab does not cleanly update the URL or support the browser back button.
- **Business Impact:** Users become disoriented and trapped inside secondary views.
- **Risk Severity:** **P2 (Medium)**
- **Recommended Remediation (Phase 1 & Phase 2):** Implement the approved navigation architecture (`Home | Matches | Finance | Players | More`), and synchronize overlay sheets with browser history (`popstate`).

---

## 3. Existing Shared Components Available for Reuse

Inspection of `components/` identifies several existing components that can be reused directly in the Core Foundation:

| Existing Component | File Path | Reuse Assessment & Suitability |
|---|---|---|
| **`ConfirmDialog`** | `components/ui/ConfirmDialog.tsx` | Highly reusable for destructive actions (delete match, fee waiver, order cancel). Needs styling update to approved tokens. |
| **`Toast` Provider** | `components/ui/Toast.tsx` | Reusable notification toast system. Reliable queue mechanics; needs token alignment. |
| **`BadgeIcon`** | `components/BadgeIcon.tsx` | High-quality SVG milestone badge renderer. Ready for immediate reuse in Performance/Profile. |
| **`ClientOnly`** | `components/ClientOnly.tsx` | Hydration guard wrapper preventing SSR/CSR React 19 hydration mismatches. |
| **`AuthProviderBadges`** | `components/AuthProviderBadges.tsx` | Reusable auth method indicator (Google vs Phone vs Password). |
| **`PhoneLoginForm`** | `components/PhoneLoginForm.tsx` | Production-tested SMS OTP phone authentication component. |
