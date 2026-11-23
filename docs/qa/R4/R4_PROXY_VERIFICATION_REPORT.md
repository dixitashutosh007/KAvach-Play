# R4 Revision 3: Proxy Execution Verification Report (pre-execution)

**Status:** Verification only. **The experiment has NOT been executed.** No request has been sent to `api.razorpay.com` by this session, ever. No application code changed; R4 not implemented.
**Date:** 2026-11-23
**Commit under review:** `422967a5d0b02aa817ccd9ec39556da5efd9fdf7`
**Script SHA-256 (`docs/qa/R4/receipt-uniqueness-experiment.mjs` at `422967a`):** `1756ba91e4067b01021d9f0283693190c10daebb8fcaafbb74b72a70cd3c390e`. The working copy is byte-identical.
**Execution environment:** Claude Code cloud session, environment "KAvach-Play" (personal; created for this repository), Node v22.23.5.

Legend: **VERIFIED** = observed directly in this session. **NOT VERIFIABLE** = outside what this session can observe; an owner or platform statement is needed. **NOT AVAILABLE** = the platform does not offer the control.

---

## 1. Credential handling

| Requirement | Finding | Status |
|---|---|---|
| Key ID and Key Secret stored as separate secrets | Saved through the platform's secure credential form as **one** network secret of type *Basic* (username = Key ID, password = Key Secret). Environment metadata shows one entry: name "Razorpay TEST-mode key (rzp_test only)", hosts `["api.razorpay.com"]`. How the platform stores the two values internally is not visible to this session | **NOT VERIFIABLE** (one Basic secret; internal storage unknown) |
| Proxy builds `Basic base64(KeyID:KeySecret)` | The form's Basic type builds `Authorization: Basic base64(username:password)`, which is Razorpay's scheme when username = Key ID and password = Key Secret. The header cannot be observed from here. Correct construction will first be evidenced by execution itself: a 401 would mean wrong credentials or wrong construction | **NOT VERIFIABLE before execution** |
| Injected only into approved Razorpay requests | Scope is **host-level**: the secret is attached to HTTPS requests to `api.razorpay.com` only. It is **not** limited to paths or methods (see §3) | **VERIFIED (host)**; path/method **NOT AVAILABLE** |
| Not exposed to Claude Code | The credential tool returned only `status: saved`. The process environment contains no Razorpay or `rzp_` variable (0 matches). The script runs with placeholders (`rzp_test_proxyInjected` / `proxy-injected`); the proxy overwrites the Authorization header outside the process, so the real key never enters the script's memory, stdout or stderr | **VERIFIED** for this session and process |
| Not in process logs, evidence or chat | Follows from the row above. The script also refuses to output anything containing `rzp_test_`/`rzp_live_`, `Basic <token>` or the placeholder credentials | **VERIFIED** (process side) |
| Not in proxy logs or traces | Proxy logging is platform-internal and not observable from this session | **NOT VERIFIABLE** (platform statement needed) |

## 2. TEST-mode enforcement

| Requirement | Finding | Status |
|---|---|---|
| Stored Key ID is a test-mode key | This session never sees the stored value, and no non-payment Razorpay endpoint reliably reveals key mode. Making a Razorpay call to probe it is not authorised before approval | **NOT VERIFIABLE by Claude Code** |
| Attestation applies to the stored credential, not the placeholder | The script's `^rzp_test_` check validates **only the placeholder**. Test mode rests **solely on the owner's attestation** about the secret saved on 2026-11-23 | Owner attestation required |

**Proposed safeguard (owner, before execution):**
1. In the Razorpay Dashboard, switch to **Test Mode** → Account & Settings → API Keys and generate a **fresh test key dedicated to this experiment**.
2. Re-save it through the credential form, replacing the existing secret.
3. Revoke that key after the run.

This ties the attestation to a key created in test mode for this purpose.

**Blast radius if a live key were stored by mistake:** up to 14 unpaid ₹1 **live** orders would be created. No payment, capture or refund endpoint is called, so no money moves. That would still breach "test mode only", so the attestation is required.

## 3. Destination and endpoint enforcement

| Requirement | Finding | Status |
|---|---|---|
| HTTPS only | The proxy accepts only HTTPS tunnels; plain-HTTP proxy requests are rejected (405, platform proxy notes). The script's origin is the constant `https://api.razorpay.com` | **VERIFIED** (script); proxy behaviour per platform documentation |
| Exact host `api.razorpay.com`; other hosts rejected | Probe of a non-allowed host (`example.com`) was refused by the proxy (CONNECT 403 via curl; Node `fetch` with the proxy enabled: cancelled). The environment's extra allowed hosts list is empty. **Package registries and MCP servers remain reachable**, without the Razorpay credential. `NO_PROXY` does not exempt Razorpay (0 matches) | **VERIFIED** (credential host-scoped; other hosts reachable but receive no credential) |
| Only `POST /v1/orders` and `GET /v1/orders` | The proxy has **no path or method rules**: any HTTPS request to `api.razorpay.com` would carry the credential. Enforced **only in the script** (method+path allowlist; query keys `receipt`, `count`, `skip`; only two `fetch` call sites) | **NOT AVAILABLE at proxy layer**; script-enforced |
| Redirects rejected | Script: `redirect: "error"` on both calls (dry-run N1: real Node fetch throws on 302 without following). Proxy: an HTTPS CONNECT tunnel passes responses through and does not itself follow redirects (inferred from the tunnelling design; not separately tested) | **VERIFIED** (script); proxy inferred |

**Reviewer decision needed:** proxy-layer path/method enforcement is not available on this platform. Either accept script-only enforcement for those two properties, or do not execute through the proxy.

## 4. Critical finding: Node `fetch` bypasses the proxy unless enabled

In this environment, Node v22.23.5's built-in `fetch` **does not use `HTTPS_PROXY` by default**:
- Without the flag: `registry.npmjs.org` → 200 (reached directly); `example.com` → `ENOTFOUND` (direct DNS failure, not a proxy refusal).
- With `NODE_USE_ENV_PROXY=1`: `registry.npmjs.org` → 200; `example.com` → refused by the proxy.

Consequence: executed as originally planned, requests would **bypass the proxy**, so **no credential would be injected**, and they would fail at DNS or reach Razorpay unauthenticated. Execution must set **`NODE_USE_ENV_PROXY=1`**. Node marks this mechanism (`EnvHttpProxyAgent`) as experimental and prints a warning to stderr, which is kept in the summary. This is a run-command setting; **the script is unchanged and its SHA-256 is unaffected.**

**Evidence-interpretation impact (E3):** through the proxy there is an extra hop. A client-side abort closes the client→proxy connection, but the proxy→Razorpay request may already be in flight and still complete. This matches a production caller timing out, since the outcome is genuinely unknown to the caller. Abort *timings*, however, are not comparable to a direct connection. E3 remains "orphan possible or confirmed" evidence only, never a latency measurement.

## 5. Execution limits

Run with **no** `R4_CONCURRENCY` or `R4_ABORT_MS` overrides (explicitly unset), giving the script defaults: **≤ 14 creates, ≤ 48 lists, concurrency 5, aborts 5/50/150/400/1000 ms**. The plan-only run in this environment printed exactly these values. The proxy imposes no request counting; limits are enforced by the script at call time.

## 6. Evidence integrity plan

Proposed exact command (placeholders only; run from the repository root):

```bash
env -u R4_CONCURRENCY -u R4_ABORT_MS NODE_USE_ENV_PROXY=1 R4_CONFIRM=execute RAZORPAY_TEST_KEY_ID=rzp_test_proxyInjected RAZORPAY_TEST_KEY_SECRET=proxy-injected node docs/qa/R4/receipt-uniqueness-experiment.mjs > docs/qa/R4/evidence/r4-receipt-evidence.json 2> docs/qa/R4/evidence/r4-terminal-summary.txt
```

- stdout (raw evidence JSON) and stderr (terminal summary) are written **directly by redirection** and committed **unmodified**.
- A separate `docs/qa/R4/evidence/run-manifest.json` records:
  - commit `422967a`, script SHA-256 `1756ba91…390e`, Node version, the exact command above;
  - start and end time, and the `sha256` of both output files;
  - `credentialMode: "test (proxy-attested by owner; NOT verified by script)"`;
  - `proxyRouting: "NODE_USE_ENV_PROXY=1 (EnvHttpProxyAgent, experimental)"`.
- The evidence JSON contains a field `keyMode: "test"` written by the script. It reflects **only the placeholder prefix**; the manifest states this explicitly. The script is not modified to change it (that would change the reviewed SHA).
- No credentials or Authorization headers can appear: the process never has them (§1), and the script's output guard refuses credential-like strings.
- Analysis against §3 of `R4_RECEIPT_UNIQUENESS_EXPERIMENT.md` goes in a separate file; the raw files are never edited.

## 7. Approvals requested from the independent reviewer

1. Accept that Key ID / Key Secret storage separation, proxy header construction (before a run) and proxy logs are **not verifiable** from this session.
2. Accept **owner attestation** of test mode. Recommended: the fresh, dedicated test key described in §2.
3. Accept **script-only** enforcement of path and method, since proxy-layer path rules are not available.
4. Approve **`NODE_USE_ENV_PROXY=1`** in the run command (required for the key to be injected at all).
5. Approve the evidence plan in §6.

Verdict requested: **APPROVED TO EXECUTE (as specified in §5–§6)** or **CHANGES REQUIRED**.
