# KAvach Play — Phase 4 Stage 1: Player Navigation and Home Specification

**Document Type:** UX Blueprint & High-Fidelity Design Specification  
**Stage:** 1 of 6 (Player Navigation & Home Experience)  
**Standard:** `AGENTS.md` & Approved Phase 3 Information Architecture  
**Target Viewports:** Mobile (360×800, 390×844) and Desktop (1280×800+)  
**Theme:** Light-first Sports-Tech, Scarlet-led  
**Date:** 2026-11-17  

---

## 1. Executive Summary & Design Goals

Stage 1 defines the primary landing and orientation experience for KAvach Cricket Club players across mobile and desktop devices.

### Key Goals
1. **Zero Disorientation:** Provide an instantaneous, high-contrast overview of the player's immediate club commitments upon opening the app.
2. **Frictionless Actionability:** Allow players to RSVP to the next upcoming match in 1 tap without navigating away from the home feed.
3. **Financial Transparency:** Surface outstanding obligations (match fees, studio fees) clearly with an unambiguous "Pay Now" action, avoiding surprise dues.
4. **Clean Hierarchy:** Separate high-urgency notifications (match 18h directions, dues alerts) from community social content (feed, polls, birthdays).
5. **Responsive Integrity:** Eliminate mobile header collisions and tiny touch targets; enforce 44px touch bounding boxes throughout.

---

## 2. Design Tokens & Styling Foundations

| Token Name | Token Hex / Value | Semantic Role in Player Home |
|---|---|---|
| **Primary Brand** | `#A30F2D` | Club crest, top navigation headers, primary section accents |
| **Primary Action** | `#D51F43` | Primary action buttons (RSVP "Available", "Pay Now", "Publish Post") |
| **Light Brand Surface** | `#FCE8ED` | Hero banner highlights, badge pill backgrounds, active tab indicators |
| **App Background** | `#F6F7F9` | Clean, glare-free canvas background for outdoor/pitch-side readability |
| **Card Surface** | `#FFFFFF` | Elevated cards with subtle 1px border (`#E5E7EB`) and soft shadow |
| **Main Text** | `#171C26` | High-contrast typography for headers, player names, amounts (WCAG AAA) |
| **Secondary Text** | `#667085` | Subtitles, metadata, timestamps, match dates, venue labels |
| **Border** | `#E5E7EB` | Subtle structural dividers and card bounding boxes |
| **Success** | `#15803D` | "Confirmed / Playing" RSVP badge, "Paid" status chip |
| **Warning** | `#D97706` | "Tentative" RSVP badge, "Due Soon" reminder pill |
| **Error / Urgent** | `#DC2626` | "Overdue" dues pill, "Unavailable" RSVP badge |
| **Gold / Prestige** | `#D6A52B` | Player of the Match honors, MVP badges, milestone trophies |

---

## 3. Screen Blueprint: Global Header & Player Navigation

### 3.1 Global Header (Mobile 360px & Desktop 1280px)

#### Mobile Header (360px–390px Viewport)
```
+-------------------------------------------------------------------+
| [KAvach Crest]  KAVACH PLAY       [Admin Shield]*  [(🔔)]  [(Avatar)]|
|                 KAvach Cricket Club                               |
+-------------------------------------------------------------------+
* Admin Shield icon button only rendered for authorized club administrators.
```
- **Height:** 64px sticky at top (`z-40`, background `#FFFFFF/95` backdrop-blur-md).
- **Club Crest & Title:** 36×36px crest SVG with "KAVACH PLAY" bold tracking-wide title; truncated on 360px screens to prevent collision.
- **Admin Shield Button (Conditional):** If the user possesses admin claims, displays a compact 44×44px icon button with red outline and shield icon. Does not display full "Admin Console" text on narrow screens (< 480px).
- **Notifications Bell:** 44×44px touch bounding box. Includes red pulse dot when `unreadCount > 0`. Tapping opens the non-disruptive notifications drawer.
- **User Avatar:** 36×36px rounded circle (enclosed in 44×44px clickable target). Tapping navigates to "Club / My Card" or opens quick profile drawer.

#### Desktop Header & Sidebar (≥ 1024px Viewport)
- On desktop, top header is minimized while the **Left Rail Sidebar** (256px fixed width) hosts:
  1. Club Branding & Season Tagline.
  2. 5 Primary Navigation Items with rich icon + label + active pill indicator.
  3. Player Quick Stats summary card (Total Runs, Wickets, Matches Played).
  4. Bottom user tile with sign-out and profile link.

### 3.2 Player Mobile Bottom Navigation (5 Approved Items)

```
+-------------------------------------------------------------------+
|   [Home]     [Matches]     [Payments]    [Performance]    [Club]  |
|     🏠          🏏             💳              🏆           🛡️    |
+-------------------------------------------------------------------+
```
- **Height:** 68px sticky at bottom (`z-40`, background `#FFFFFF`, border-top `1px solid #E5E7EB`).
- **Touch Targets:** Exactly 5 equal columns, each yielding a 72×68px touch surface (exceeds 44px min standard).
- **Active State:** Scarlet icon `#D51F43` + bold label `#D51F43` + subtle top border accent `#D51F43`.
- **Inactive State:** Muted icon `#667085` + medium label `#667085`.

---

## 4. Screen Blueprint: Player Home Feed Components

### 4.1 Next Match Countdown & 1-Tap RSVP Card (Hero Unit)
- **Visual Design:** Premium sports-tech card with subtle scarlet accent header.
- **Header:** Format badge (e.g. `20 Overs T20` or `35 Overs Leather Ball`), fixture date (`Sun, 24 Nov 2026 • 07:30 AM IST`), and Live Countdown pill (`Starts in 3d 14h`).
- **Matchup:**
  ```
  KAvach Cricket Club   vs   Spartans CC
       [Club Logo]                [Opp. Logo / Shield]
  Venue: Kavach Arena Ground 1 (Directions Link with Pin icon)
  ```
- **1-Tap RSVP Action Strip:**
  - 3 large, accessible pill buttons with real-time feedback:
    1. **"Available"** (`bg-emerald-50 text-emerald-700 border-emerald-200`, check icon).
    2. **"Tentative"** (`bg-amber-50 text-amber-700 border-amber-200`, clock icon).
    3. **"Unavailable"** (`bg-rose-50 text-rose-700 border-rose-200`, x icon).
  - Tapping updates immediate local state and displays a quick confirmation toast ("Availability marked: Available").
  - Includes an optional 1-tap "Add note" trigger (e.g. "Arriving by 7:45 AM").
- **Squad Status Indicator:**
  - If squad is announced: displays "Squad Announced: You are in the XI!" with a "View Squad" link.

### 4.2 Outstanding Dues Summary Alert Card
- **Condition:** Displayed prominently when the player has unpaid match fees or other dues (`totalDue > 0`).
- **Card Styling:** Light brand surface (`#FCE8ED`) with deep scarlet border (`#D51F43/30`).
- **Content:**
  - Title: "Outstanding Club Dues"
  - Amount: `₹1,250` (Formatted in bold Inter font, `#171C26`).
  - Breakdown: `2 Matches (₹1,000) • 1 Studio Pass (₹250)`.
  - Action: High-contrast primary action button **"Pay Now"** (`bg-[#D51F43] text-white min-h-[44px]`).
  - Clicking triggers immediate payment modal or routes to `/pay/{playerId}`.
- **Zero Due State:** If dues are `₹0`, shows a discreet green pill: `"All dues settled • Good standing"`.

### 4.3 Club Announcements & Social Feed
- **Create Post Widget (For authorized players / captains):**
  - "Share club update, match photos, or team shout-out..."
- **Feed Card Hierarchy:**
  - Author Avatar + Name + Player Role/Badge (e.g. "Captain", "Match Admin") + Relative Timestamp ("2h ago").
  - Content Text with full markdown/emoji support.
  - Optional media preview (match flyer, ground condition photo).
  - Engagement Bar: Like count (Heart icon), Comments count (Message icon), Share action.
- **Empty Feed State:**
  - Clean illustrated cricket ball icon with message: "No club updates yet this week. Stay tuned for weekend match announcements!"

### 4.4 Quick Utility Widgets
- **Upcoming Birthdays Widget:** Displays celebrating club members this week with a 1-tap "Send Wishes" button.
- **Club Weather & Pitch Report:** Weekend weather forecast for match venue (Temperature, Rain probability, Pitch condition).

---

## 5. Interaction States & Transitions

| Interaction | Trigger | Visual Response |
|---|---|---|
| **RSVP Selection** | Tap "Available" button | Button scales down slightly (`scale-95`), background shifts to active emerald, checkmark animates in, confirmation banner confirms status. |
| **Header Bell Tap** | Tap Bell icon | Slides out non-disruptive Right Drawer (360px wide on desktop, 100% width on mobile) displaying notifications with "Mark All Read" action. Underlying Home feed stays intact. |
| **Dues Card Tap** | Tap "Pay Now" | Opens Razorpay Payment Intent modal with pre-validated amount and itemized breakdown. |
| **Bottom Nav Switch** | Tap "Matches" | Active tab indicator slides smoothly using Framer Motion view transition. |
| **Pull to Refresh** | Pull down on mobile | Spinning scarlet spinner refreshes match fixtures and feed items. |

---

## 6. Accessibility & Responsive Specifications

1. **Touch Target Size:** All buttons, icons, bottom nav items, and RSVP selectors strictly adhere to `≥ 44×44px` bounding box.
2. **Color Contrast:**
   - Text `#171C26` on `#FFFFFF`: **15.2:1** (Exceeds WCAG AAA requirement of 7:1).
   - Brand text `#A30F2D` on `#FCE8ED`: **6.4:1** (Exceeds WCAG AA requirement of 4.5:1).
   - Action `#D51F43` on `#FFFFFF`: **5.1:1** (Exceeds WCAG AA).
3. **Screen Reader (ARIA):**
   - Bottom navigation marked with `role="navigation"` and `aria-label="Player Primary Navigation"`.
   - RSVP buttons include `aria-pressed="true|false"`.
   - Notifications bell includes `aria-label="Notifications, 3 unread"`.
4. **Layout Breakpoints:**
   - Mobile: `< 640px` (Full-width single column stack, sticky bottom nav).
   - Tablet: `640px – 1023px` (Two-column grid for Feed + Match Card, sticky bottom nav).
   - Desktop: `≥ 1024px` (Left fixed navigation sidebar, center feed column, right utility widgets column).
