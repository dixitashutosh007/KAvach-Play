# Independent QA Prompt — Weekend Match Operations (D-21)

Paste into a **separate, read-only** Antigravity browser/QA session. Do not run it in the implementation session.

---

You are an independent QA reviewer for KAvach Play. Test the **Weekend Match Operations** workstream and report what you **actually executed**.

## Environment (fill in before starting — do not guess)

- **Staging URL:** `<owner to provide — production https://play.kavachcricket.com must NOT be used>`
- **Deployed commit:** must equal the `feat/weekend-match-operations` HEAD stated in the implementation report. Confirm from deployment metadata. If you cannot confirm it, mark every scenario **Blocked**.
- **Server setting:** `WEEKEND_OPS_MODE` unset (testing look-back: 14 days).
- **Test accounts:** synthetic staging accounts provided by the owner, one each of Super Admin, Match Admin (legacy), Club Admin, Finance Admin, Designer and Player. Never put credentials in the report.
- **Seed data:** synthetic staging matches.
  - Sat/Sun of the most recent weekend with `result` Pending, one T20 and one T30.
  - One match more than 14 days old without a result.
  - One match with no format.
  - One Pending match with 2 Unpaid payments, 1 Paid payment and 1 Not Playing.
  - Matches with `matchUrl` = a `https://cricheroes.com/...` URL, an `http://` URL, and empty.
- **Time:** the prompts depend on server time (IST). Results are due from Sunday 19:00, POTW Monday 08:00 to Friday 23:59, fees from Tuesday 08:00. If today's time does not satisfy a schedule, mark that scenario **Blocked (schedule)**. Do not change server clocks.

## Restrictions

- Read-only towards code, config, rules, permissions and deployments. No commits and no deploys.
- No production access.
- Writes only to synthetic staging records through the app UI.
- No real payments.
- Inaccessible scenarios are **Blocked**, not Passed.

## Scenarios

Record for each: Expected, Actual, **Pass / Fail / Blocked**, screenshot reference, and any console or network errors.

### Persona and visibility

1. Player account: no prompt, no task bar and no pending indicator on any screen.
2. Super Admin in Player persona: the Admin toggle shows a numeric pending badge, and no modal appears.
3. Switch to Admin persona: exactly one modal opens (Results first if due). Its contents match the seeded pending work.
4. "Skip for Later" closes it. The next due prompt may open. The "Weekend tasks" bar lists skipped work.
5. Toggle Player ↔ Admin twice in the same tab: skipped prompts do **not** reopen automatically; the task bar reopens them.
6. New browser session: due prompts are offered again once.

### A. Results

7. Results list only matches eligible by the 4 h / 5 h / 6 h + 6 h rule, grouped by date, with ground and time.
8. The match with no format appears as an exception note, not as a row.
9. The match older than 14 days is **not** in the prompt.
10. Save one result only (partial). It persists after refresh; the other stays pending; the badge count drops.
11. Two admins (two browsers) save **different** results for the same match: one succeeds; the other sees "Already recorded as … by another admin". The stored value is unchanged.
12. Abandoned on the payments-seeded match:
    - Unpaid payments become **Waived** (reason "Match Abandoned"); Paid and Not Playing are unchanged.
    - The player's dues exclude it; no refund is created.
    - Finance → Activity Log shows the result entry and the waiver entry, both with the admin's name.
13. Club Admin, Finance Admin and Designer get no results prompt and no backfill entry. Direct POST to `/api/admin/weekend-results` with their token returns 403. Players get 403; unauthenticated requests get 401.
14. Match Admin: Match Center shows "Missing results (backfill)". The queue lists the old match; nothing is pre-selected; saving one works. Club Admin does not see the entry.

### B. Player of the Weekend (Club or Super Admin, Mon 08:00 – Fri 23:59)

15. The modal shows the weekend label, a player search, an optional message with a character and line counter (limits 120 / 4), and a live banner preview.
16. A 5-line message or more than 120 characters is blocked.
17. Grant:
    - Player Home shows the gold POTW banner (photo or initials, crown, name, message).
    - The player has one "Player of the Weekend" badge.
    - The player (if linked) has one notification.
    - Activity Log has one entry.
18. Grant again, or from a second admin at the same moment: "already awarded"; still exactly **one** badge, banner, notification and post.
19. The manual Badges award picker does not offer "Player of the Weekend".
20. Skip creates nothing: no badge, post or notification.
21. Match Admin and Finance Admin get no POTW prompt. Direct POST to `/api/admin/player-of-weekend` returns 403.
22. Banner expiry: if a staging award older than 7 days exists, it is not shown; a newer award replaces the old banner.

### C. CricHeroes link

23. On Player Home, Player Matches and Admin Match Center, a card with an https CricHeroes URL shows "View on CricHeroes ↗" on the **same row as "vs"**:
    - It opens in a new tab with `rel="noopener noreferrer"`.
    - The card height equals a card without the link.
24. Cards with the `http://` URL or no URL show no link.

### D. Actual match fee (Finance or Super Admin, from Tuesday 08:00)

25. The modal lists the weekend's matches without a recorded actual fee, including abandoned ones.
26. Negative or non-numeric input is blocked. Save one amount (partial):
    - Match → Finance shows "Actual match fee paid" with history and an audit entry.
    - Configured match fee and players' fees are unchanged.
    - The match leaves the prompt.
27. ₹0 is accepted and clears the match from the prompt.
28. Correcting the amount via Match → Finance still requires a reason.
29. Match Admin and Club Admin get no fee prompt. Direct POST to `/api/finance/match-ledger` returns 403.

### Viewports and regression

30. Repeat 3, 15, 17, 23 and 25 at 360, 390, 430, 768, 1280 and 1440 px:
    - No horizontal scroll.
    - Modals are usable: bottom sheet on mobile, controls at least 44 px.
31. Regression:
    - Player nav is Home / Club / Matches.
    - Admin nav is the six destinations.
    - Pay Now flow opens (do not pay).
    - Match Center edit form still saves a result.
    - Finance reconcile-abandoned still works for Finance Admin.

## Report

A table of scenario → Pass / Fail / Blocked with evidence, the exact commit verified, accounts and roles used (no secrets), and any defects with reproduction steps.
