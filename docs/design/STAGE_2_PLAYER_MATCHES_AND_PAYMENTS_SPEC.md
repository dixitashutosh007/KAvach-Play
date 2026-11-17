# KAvach Play — Phase 4 Stage 2: Player Matches and Payments Specification

**Document Type:** UX Blueprint & High-Fidelity Design Specification  
**Stage:** 2 of 6 (Player Matches & Payments Experience)  
**Standard:** `AGENTS.md` & Approved Phase 3 Information Architecture  
**Target Viewports:** Mobile (360×800, 390×844) and Desktop (1280×800+)  
**Theme:** Light-first Sports-Tech, Scarlet-led  
**Date:** 2026-11-17  

---

## 1. Executive Summary & User Objectives

Stage 2 addresses the two core operational touchpoints for cricket club players:
1. **Match Discovery, Availability & Scorecards (Matches):** Enabling players to track weekend fixtures, RSVP promptly, view squad selections, examine scorecards, and review catch statistics.
2. **Financial Clarity & Frictionless Settlement (Payments):** Eliminating uncertainty around dues, providing transparent line-item fee breakdowns, honoring the approved Abandoned Match waiver policy (Option A), and providing a fast mobile checkout with instant digital receipts.

---

## 2. Screen 2 Blueprint: Matches Listing Experience

### 2.1 Viewport Layouts & Information Hierarchy

#### Mobile View (360px–390px)
- **Top Sticky Filter Pill Bar:**
  - `Upcoming (2)` | `Past Results (8)` | `Abandoned`
  - Search input with clear button (filters by Opponent, Venue, or Tournament).
- **Match Card Anatomy:**
  - **Header:** Format badge (e.g. `20 Overs T20`), Date (`Sun, 24 Nov • 07:30 AM`), Venue link with Pin icon.
  - **Matchup Display:**
    ```
    KAvach CC          vs       Spartans CC
    [Crest]                     [Shield]
    Status: Squad Announced (14 Members)
    ```
  - **Player Participation Badge:**
    - Green checkmark: `Playing (Squad XI)`
    - Amber clock: `Pending RSVP`
    - Red cross: `Unavailable`
  - **Action Area:** 44px touch targets for "RSVP / Edit" and "View Details".
- **Past Match Card Display:**
  - Result Banner: `KAvach won by 42 runs` (Green) or `Defeat by 3 wkts` (Red).
  - Summary Scoreline: `KAvach: 178/6 (20.0) • Spartans: 136/9 (20.0)`.
  - Player of the Match badge: `🏅 Rahul Verma (4/18)`.

#### Desktop View (≥ 1024px)
- Multi-column responsive layout:
  - Top toolbar with Date Range Picker, Format Filter (`T20`, `35 Overs`, `Net Practice`), and Search bar.
  - Toggle between **Card View** (responsive 2-column grid) and **Calendar View** (monthly fixture grid).
  - Right sidebar summary: Player Season Attendance Rate (e.g. `85% Match Attendance`) and Next Match Directions.

---

## 3. Screen 3 Blueprint: Match Details & Participation

### 3.1 Detail Drawer / Modal Structure
When a match card is tapped, a smooth slide-up drawer (mobile) or slide-over panel (desktop) opens, preserving the background context.

#### Key Content Sections
1. **Fixture Hero:**
   - Opponent, Ground name, Google Maps 1-tap navigation button, Match Fee (`₹500`), Reporting Time (`06:45 AM IST`).
2. **Squad & Selection Sheet:**
   - Confirmed Playing XI partitioned into Batters, All-Rounders, Wicket-Keeper, and Bowlers.
   - Captain & Vice-Captain badges (`(C)`, `(VC)`).
   - Current player highlighted in subtle Light Brand Surface (`#FCE8ED`).
   - Reserves / Standby list clearly separated.
3. **Interactive Scorecard (Past Matches):**
   - Innings Tabs: `KAvach CC (1st Inn)` | `Opposition (2nd Inn)`.
   - Responsive Batting Table: Batsman, Dismissal info, Runs, Balls, 4s, 6s, Strike Rate.
   - Responsive Bowling Table: Bowler, Overs, Maidens, Runs, Wickets, Economy.
   - Fall of Wickets ticker.
4. **Catches & Fielding Recognition:**
   - **Stunning Catches:** Highlight cards celebrating exceptional catches.
   - **Dropped Catches:** Transparent accountability metrics recorded by match scorers.
5. **Match Discussion Feed:**
   - Team comments, strategy notes, and pitch condition updates.

---

## 4. Screen 4 Blueprint: Payments & Dues Management

### 4.1 Financial Ledger & Dues Breakdown

#### Outstanding Dues Summary Hero
- **Total Balance Pill:**
  - `₹1,250 Outstanding` displayed in prominent 28px Inter font.
  - Subtitle: `2 Match Fees • 1 Studio Pass`.
  - Primary Action Button: **"Pay Full Balance (₹1,250)"** (`#D51F43`).

#### Individual Dues Line Items
Each pending obligation is rendered as an interactive card with explicit breakdown:
1. **Match Fee Obligations:**
   - Title: `Match vs Spartans CC (24 Nov)`
   - Status: `Unpaid • Due by Tue, 26 Nov 23:59 IST` (Enforcing Asia/Kolkata deadline).
   - Fee: `₹500` (Includes individual override or guest premium if applicable).
2. **Abandoned Match Policy (Option A):**
   - Title: `Match vs Royal Tigers (Rain Abandoned)`
   - Status Chip: `Waived per Club Policy` (`bg-gray-100 text-gray-700`).
   - Fee: `₹0` (Original ₹500 fee visibly struck through with explanation: *"Abandoned matches create no payment obligation"*).
3. **Studio & Facility Passes:**
   - Title: `Studio Nets Session (1 Hour)`
   - Fee: `₹250`.
4. **Late Fees Notice:**
   - Deterministic deadline notice: *"Match fees are due by Tuesday 23:59 IST following the match weekend. Automatic late fees of ₹150 apply past the deadline."*

---

## 5. Screen 5 Blueprint: Payment History & Receipts

### 5.1 Chronological Transaction Ledger
Players can review all historical transactions across all payment channels:
- **Columns / Card Elements:**
  - Date & Timestamp (`17 Nov 2026, 11:24 AM IST`).
  - Description / Purpose (`Match Fee - vs Royal Strikers`).
  - Channel Badge: `Razorpay Online` (Purple), `Pitch-Side Cash` (Green), `Club Sponsored` (Gold).
  - Transaction Reference ID (`pay_Px78qK1290`).
  - Amount Paid (`₹500.00`).
  - Action: **"Download Receipt"** (Generates formatted PDF/print receipt).

### 5.2 Receipt Preview Modal
- Club header with KAvach logo and GST/Registration metadata.
- Payer Name, Player ID (`KAV-042`), and Phone number.
- Gateway Payment ID and Verified Timestamp.
- Official digital club authorization stamp.

---

## 6. Interaction States & Transitions

| Action | State | Visual Feedback |
|---|---|---|
| **Filter Switch** | Tapping "Past Results" | Active filter pill animates smoothly with `#D51F43` background; match cards transition with subtle cross-fade. |
| **Scorecard Tab** | Switching Innings | Smooth slide transition between 1st and 2nd innings tables without page jumps. |
| **Checkout Click** | Tap "Pay Now" | Opens secure Razorpay modal with exact pre-calculated amount and itemized obligation list. |
| **Payment Success** | Payment verified | Green checkmark animation, instant balance update to `₹0`, and receipt added to history ledger. |
| **Empty Filter** | No matches found | Contextual empty state with illustration and "Clear Filter" button. |

---

## 7. Responsive & Accessibility Specifications

1. **Mobile Tables (< 768px):**
   - Complex cricket scorecards and transaction ledgers feature horizontal scroll indicators with sticky player name columns so key information remains readable without zooming.
2. **Touch Target Sizing:**
   - All filter tabs, match cards, drawer close buttons, and checkout triggers strictly enforce `≥ 44×44px`.
3. **Color Contrast:**
   - Result badges (Victory `#15803D` / Defeat `#DC2626`) paired with high-contrast text and icons (not reliant on color alone).
