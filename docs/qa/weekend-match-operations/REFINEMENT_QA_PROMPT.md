# Independent QA Prompt — Weekend Operations Refinement (D-21 addendum)

Paste into a **separate, read-only** Antigravity browser/QA session, and run the physical-iPhone section on a real device. Do not run this in the implementation session.

---

You are an independent QA reviewer for KAvach Play. Test the **Weekend Operations refinement** and report only what you **actually executed**.

## Environment (fill in before starting — do not guess)

- **Staging URL:** `<owner to provide — never production https://play.kavachcricket.com>`
- **Deployed commit:** must equal the final `feat/weekend-match-operations` SHA in the refinement delivery message. Confirm it from deployment metadata. If you can't, mark everything **Blocked**.
- **Server env:**
  - `WEEKEND_OPS_MODE` unset (testing look-back).
  - `POTW_HISTORY_FROM` as configured by the owner (default `2026-01-01`).
- **Accounts:** synthetic staging accounts provided by the owner: Super Admin, Match Admin (legacy), Club Admin, Finance Admin, Player. Never record credentials.
- **Seed data:** synthetic staging records.
  - A Pending match from the last weekend.
  - Several older Pending matches (more than 14 days old, across two months).
  - A match with no format.
  - Concluded matches with no actual fee, including at least one abandoned.
  - Two past weekends with a played match and no Player of the Weekend award.
  - Matches whose `matchUrl` is:
    - an https CricHeroes URL;
    - an `http://` CricHeroes URL;
    - a CricHeroes short or share link on another domain;
    - `javascript:alert(1)`;
    - empty.
  - One opponent name over 40 characters.

## Restrictions

- Read-only towards code, config, rules, permissions and deployments. No commits and no deploys.
- No production access.
- Writes only to synthetic staging records through the app.
- No real payments.
- Anything you cannot reach is **Blocked**, not Passed.

## Scenarios

Record for each: Expected, Actual, **Pass / Fail / Blocked**, a screenshot, and console or network errors.

### 1. CricHeroes link

1. On **Player Home**, **Player Matches** (list and match detail) and **Admin Match Center** (card and match detail):
   - The opponent name is underlined with a small external-link icon.
   - Tapping it opens the exact `matchUrl` in a new tab.
   - The match detail view does **not** open behind it.
   - Card height equals a card without a link.
2. An `http://` URL opens as https. A share or short link on another domain opens.
3. `javascript:` and empty URLs show the plain name with no icon. Nothing happens on tap except normal card behaviour.
4. A long opponent name truncates to two lines; the icon is still visible beside it.
5. Keyboard: Tab focuses the link with a visible focus ring; Enter opens CricHeroes and does not open the card.

### 2. iPhone match card (physical iPhone, Safari)

6. On iPhone SE or mini (375), a standard iPhone (390/393) and Pro Max/Plus (428/430), open Player → Matches:
   - **T30/T20 and the jersey appear in the top-right corner of every card.**
   - No text overlaps the ribbon, the Next Match chip, the time column or the corner.
   - No horizontal scroll.
7. Repeat 6 with **Display Zoom** on (Settings → Display → Zoomed) and with Larger Text at one step above default.
8. Desktop (1280/1440) and the Chrome mobile emulator: the desktop card is unchanged (format + jersey in the identity column); the mobile emulator matches the iPhone.

### 3. Admin task experience

9. **Results:** choose results for two matches and Save. The button shows **Saving…**, the window closes on success, a toast confirms, and the counts update.
10. **Player of the Weekend:** grant. The window closes, a toast confirms, the badge and banner appear once.
11. **Actual fee:** enter two amounts and Save. The window closes on success.
12. **Failure:** turn the network off (DevTools offline) and Save in each window.
    - The window stays open, values are kept, and an error plus **Retry** appear.
    - Back online, Retry succeeds and the window closes.
13. **Double click** Save quickly: exactly one request in the Network tab, and one record (one audit entry).
14. While saving, Close/Skip and the rest of the app still respond. No full-screen freeze.
15. **Skip** each popup, then open Match Center: all three tasks are listed under **Weekend tasks** and open their windows.
16. Complete a task as Admin A. Admin B (another browser) refreshes: the task is gone for B.

### 4. Historical Data Completion (Match Center)

17. Super Admin sees three rows with counts: Match Results, Actual Match Fee Paid, Player of the Weekend. Spot-check the counts against the seeded data.
18. Match Admin sees results only, Finance Admin fees only, Club Admin POTW only. Players have no access (direct `GET /api/admin/weekend-prompts?view=history` → 403).
19. **Historical results:**
    - Month filter works and nothing is pre-selected.
    - Save one result: the row shows **Saved**, the progress reads "1 completed · n pending", and the count drops after closing.
    - The saved match does not reappear after refresh, logout/login, or as another admin.
20. **Historical fees:** batch-save two. Same checks as 19. Match → Finance shows each amount with history and an audit entry; configured fees are unchanged.
21. **Historical POTW:**
    - Pick a weekend and a player, then Grant: the badge is added, the player (if linked) is notified, and the Home banner does **not** change.
    - Granting the same weekend again (another admin) → "already awarded"; still one badge.
22. The recurring results and fee prompts never list an item that is also in history, and vice versa.
23. No record is created automatically; no existing result or fee is overwritten. Trying to change a recorded result through the prompt shows "already recorded".

### 5. Regression

24. Recurring prompts:
    - Admin persona only; Player persona shows only the toggle badge.
    - Schedules unchanged: results Sun 19:00, POTW Mon 08:00 – Fri 23:59, fees Tue 08:00 IST.
25. Abandoned via the results prompt waives unpaid fees (paid untouched, no refund). Finance reconcile still works.
26. Player navigation is Home / Club / Matches. Admin navigation has six destinations. Pay Now opens (do not pay). The Match Center edit form saves a result. Badges, banner and notifications behave as before.

## Report

A table of scenario → Pass / Fail / Blocked with evidence, the exact commit verified, devices and iOS versions, roles used (no secrets), and defects with reproduction steps.
