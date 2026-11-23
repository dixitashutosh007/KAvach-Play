# R4 supplemental evidence: delayed E5 re-check (reviewer-approved)

**Run:** 2026-11-23, 15:49:47Z–15:49:51Z UTC, Node v22.23.5; 8 `GET /v1/orders?receipt=…` requests (one per original receipt, no pagination); same proxy-injected, owner-attested test-mode key; `NODE_USE_ENV_PROXY=1`.
**Script:** `e5-recheck.mjs` (this folder). It reads the original evidence read-only; the original `r4-receipt-evidence.json` is **unmodified** (sha256 `5c80fde3671cdcea…`, recorded in the output).
**Raw output:** `e5-recheck-evidence.json`, `e5-recheck-summary.txt` (unmodified; 0 credential-like matches).

| Receipt | Orders known from create responses | Original E5 (≈20–24 s after creation) | Re-check (≈5 min 40 s after) |
|---|---|---|---|
| E1 | 2 | 0 | **2** (both known IDs) |
| E2 | 5 | 0 | **5** (all known IDs) |
| E3-5 ms (aborted) | 0 | 0 | **0** |
| E3-50 ms (aborted) | 0 | 0 | **1**: `order_U3fdWRWVWR0KeS`, created_at 1795448647 |
| E3-150 ms (aborted) | 0 | 0 | **1**: `order_U3fdWWEDypFeeC`, created_at 1795448647 |
| E3-400 ms | 1 | 0 | **1** (known ID) |
| E3-1000 ms | 1 | 0 | **1** (known ID) |
| E4 | 2 | 0 | **2** (both known IDs) |

## Findings

1. **Receipt-filtered listing is eventually consistent, not broken.** Every order known from a create response was found on re-check (11/11). Visibility lag in this run: **> about 20 s and ≤ about 5 min 40 s**. The exact bound is unknown.
2. **Orphan orders confirmed (E3).** The 50 ms and 150 ms requests were aborted by the client timer (`aborted_by_timer`, no headers received), so the caller never learned an order ID. Razorpay nonetheless created one order for each. The 5 ms abort pre-empted creation.
3. Duplicate-receipt acceptance (E1, E2, E4) is now **corroborated by listing** as well as by create responses.
4. In total, 13 unpaid ₹1 test orders exist from run `r4mwtfrkta4202` (11 returned to the caller and 2 orphans).

## Effect on the original analysis

- E5 "unreliable" is refined to "**eventually consistent with lag of unknown upper bound**". A zero result is still never proof of non-creation.
- E3 changes from inconclusive to **orphan confirmed**.
