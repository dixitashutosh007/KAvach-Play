# Match Center Corrections & Admin Access Investigation

Branch: `mig-mov` · Baseline: `8978577` · Date: 2026-11-20

## 1. Root causes

| Reported issue | Root cause (verified) |
|---|---|
| "RSVP Needed" still visible | The Match Center cards were already clean. The label came from the **Player Home** upcoming-fixture cards (`components/home/UpcomingMatchesSection.tsx`), which also showed a "Your Availability" heading. Previous fixes only touched `components/matches/*`. |
| "Scarlet Red" / "Whites" text instead of the infographic | Same Player Home cards rendered `{match.jerseyColor}` as text. The Match Day Alert (`HomeTab.tsx`), the campaign banner subtitle (`CampaignHeroBanner.tsx`) and the tournament detail (`TournamentsTab.tsx`) also printed the raw value. |
| Consecutive cards look identical | The alternate surface was `bg-warm-white/70`, and `warm-white` is `#FFF6F4`, which is the page canvas colour. The alternate card was effectively invisible against the background. Player Home cards had no alternation at all. |
| No Result state | Not mapped. An unknown value produced no stamp on the card, and the modal styled it as amber. |
| Admin `role` string used as authority | `PlayerMatchCenter` treated `appUser.role === "admin"` as admin, and the pending-approval bypass in `app/page.tsx` used the same string. Rules and the shell use the claim and the flags only. |
| Matches subscription failures invisible | `useStore` only logged listener errors, so a permission or database failure looked like "no matches". |

## 2. Admin access / missing matches: findings

Verified in source and with a production build:
- `firestore.rules` allows public reads of `matches`. Every helper uses `$(database)`, and admin helpers read the claim and the `appUsers` flags. Rules do not block match reads.
- The `mig-mov` browser bundle (from `npm run build` with `AWS_BRANCH=mig-mov`) inlines `NEXT_PUBLIC_FIRESTORE_DATABASE_ID="kavach-play-db-ext"` and `AWS_BRANCH="mig-mov"`. The client and server both resolve to the development database. The resolver has no browser fallback at HEAD.
- Admin authority is the `admin` claim (shared Auth, unaffected by the import) or the `appUsers/{uid}` flags (replaced by production values on 2026-11-20).
- A user with neither authority nor a linked player record sees no fixtures, by design (`isPlayerEligibleForMatch`).

**Most likely cause (requires owner verification, not provable from code):** the affected admins' `appUsers/{uid}` documents in `kavach-play-db-ext` lack the expected permission flags, or do not exist, because they were overwritten by the production snapshot. The `[KAvach access diagnostic]` console line on the `mig-mov` deployment confirms or rules this out per user. Restoring a flag is a data change that needs owner approval.

Earlier `mig-mov` builds between `61ded57` and `af91dda` read `process.env` as an object in the browser, which Next.js does not inline, so the browser resolver threw. If the reported symptoms were observed on a build from that window, redeploying HEAD resolves that part.

## 3. Changes

- `components/matches/matchResult.ts` (new): authoritative result → stamp mapping (WON, LOST, TIE, DRAW, ABANDONED, NO RESULT). Pending and unknown values produce no stamp, and results are never inferred from scores.
- `PlayerMatchCard.tsx`: shared result mapping; visible alternate surface (`bg-soft-blush` plus a subtle dusty-red rail) that never overrides Next Match or unsettled alerts; "View Details" is now a real button (keyboard accessible, stops propagation).
- `PlayerMatchDetailModal.tsx`: same result mapping for the outcome banner.
- `PlayerMatchCenter.tsx`: admin check uses the claim and flags, not `role`; shows the matches error banner.
- `components/home/UpcomingMatchesSection.tsx`: removed "RSVP Needed" and "Your Availability"; jersey infographic; deterministic alternation; "Not Playing" label is now "Out" (data unchanged).
- `HomeTab.tsx`, `CampaignHeroBanner.tsx`, `TournamentsTab.tsx`: jersey text replaced by the infographic or removed.
- `hooks/useStore.ts`: `matchesError` and `selfAppUserStatus`; a deleted `appUsers/{uid}` document is cleared from state.
- `lib/subscription-errors.ts` (new), `components/matches/MatchesLoadError.tsx` (new): safe user-facing error banner in player and admin match views.
- `app/page.tsx`: pending-approval bypass uses `isAdminUser`; development-only access diagnostic (booleans only).
- `lib/firebase.ts`: exports the bound `firestoreDatabaseId` (non-secret).

No changes to `firestore.rules`, `lib/database-config.ts`, `amplify.yml`, `next.config.ts`, the data model, the APIs or the payment code.

## 4. Verification

- `tests/match-center-admin-access.test.mjs` (new, 45 tests): 45/45 pass. Against baseline `8978577`, 15 fail, exactly on the defects above.
- All non-emulator functional tests (22 files, including the new file): 499/499 pass.
- Playwright (local `next dev`, synthetic store, Mobile and Desktop Chrome): `match-center-corrections.spec.ts` 36/36 over 3 repeats, plus `player-match-center-behavioral`, `player-home-behavioral` and `shared-shell-behavioral`.
- `player-home-behavioral` 4B failed identically on baseline `8978577`, because the tournament badge moved into progressive disclosure in `eb94c4e`. The test now expands the card first.
- `npx tsc --noEmit`: 0 errors (baseline 0).
- `npm run build` with `AWS_BRANCH=mig-mov`: succeeds; the client bundle is bound to `kavach-play-db-ext`.
- Not run: Firebase emulator suites (no rules or server changes) and anything touching cloud data.

Screenshots: `docs/qa/screenshots/match-center-corrections/` (before/after at 390×844).
