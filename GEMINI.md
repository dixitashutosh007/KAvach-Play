# GEMINI.md — KAvach Play Agent Instructions

Follow [`AGENTS.md`](AGENTS.md) as the persistent repository operating instructions for all work in KAvach Play.

## Mandatory Security Baseline & Review Rules

Every agent performing security-related work, scanning, or independent review MUST:

1. **Read [`docs/security/SECURITY_BASELINE.md`](docs/security/SECURITY_BASELINE.md) first** before scanning the repository or proposing security changes.
2. **Consult:**
   - [`docs/security/THREAT_MODEL.md`](docs/security/THREAT_MODEL.md)
   - [`docs/security/SECURITY_REVIEW_HISTORY.md`](docs/security/SECURITY_REVIEW_HISTORY.md)
   - [`docs/security/ACCEPTED_RISKS.md`](docs/security/ACCEPTED_RISKS.md)
3. **Apply the right-sized context:** KAvach Play is a private cricket club management application (~300 club members), not a public multi-tenant enterprise SaaS platform. `docs/security/SECURITY_BASELINE.md` takes precedence over generic enterprise SaaS assumptions, while never overriding essential security protections.
4. **Fail-closed on missing baseline:** If `docs/security/SECURITY_BASELINE.md` cannot be accessed, ask the owner for clarification rather than silently assuming an enterprise-grade threat model.
5. **Follow the review classification & format:** Use only `P0` (Critical / Launch blocker), `P1` (Important / Fix before launch), and `P2` (Hardening / Post-launch), provide concrete source evidence and realistic attack paths, and avoid reopening closed findings without new source-code evidence.
