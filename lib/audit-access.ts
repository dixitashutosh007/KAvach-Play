export interface AuditRoleContext {
  isSuperAdmin: boolean;
  isClubAdmin: boolean;
  isFinanceAdmin: boolean;
}

const CLUB_ADMIN_AUDIT_ENTITIES = [
  "match",
  "player",
  "ground",
  "tournament",
  "badge",
  "badge_type",
  "poll",
  "post",
  "out_of_play",
  "catch",
  "comment",
  "lead",
  "player_stat",
  "club_stats",
  "subscription",
] as const;

const FINANCE_ADMIN_AUDIT_ENTITIES = [
  "payment",
  "fee",
  "fee_plan",
  "fee_plan_assignment",
  "fee_template",
  "subscription",
  "subscription_period",
  "match",
  "player",
  "reminder",
  "settings",
] as const;

const FINANCIAL_CHANGE_FIELDS = new Set([
  "fee",
  "matchFeeBudget",
  "feeMarginPct",
  "groundFeePaidAmount",
  "financeStatus",
  "paidAmount",
  "feeCollectedAmount",
  "feeOffsetAmount",
  "feeOverride",
]);

/**
 * Returns the authoritative list of audit entity types a caller may view,
 * or "ALL" for Super Admin.
 */
export function getPermittedAuditEntities(roles: AuditRoleContext): string[] | "ALL" {
  if (roles.isSuperAdmin) return "ALL";
  const allowed = new Set<string>();
  if (roles.isClubAdmin) {
    for (const e of CLUB_ADMIN_AUDIT_ENTITIES) allowed.add(e);
  }
  if (roles.isFinanceAdmin) {
    for (const e of FINANCE_ADMIN_AUDIT_ENTITIES) allowed.add(e);
  }
  return Array.from(allowed);
}

/**
 * Filters and sanitizes audit log entries for the caller's role:
 * - Excludes entities outside `getPermittedAuditEntities(roles)`.
 * - For Club-only Admins, strips financial field diffs (e.g. `match.fee`,
 *   `subscription.paidAmount`) so financial amounts never leak via shared entities.
 */
export function filterAndSanitizeAuditEntries<
  T extends {
    entity?: string;
    changes?: Array<{ field: string; oldValue?: unknown; newValue?: unknown }>;
    summary?: string;
  },
>(entries: T[], roles: AuditRoleContext): T[] {
  const permitted = getPermittedAuditEntities(roles);
  const canSeeFinance = roles.isSuperAdmin || roles.isFinanceAdmin;
  const permittedSet = permitted === "ALL" ? null : new Set(permitted);

  const out: T[] = [];
  for (const entry of entries) {
    const entity = String(entry.entity || "");
    if (permittedSet && !permittedSet.has(entity)) continue;

    if (!canSeeFinance && Array.isArray(entry.changes)) {
      const sanitizedChanges = entry.changes.filter((c) => !FINANCIAL_CHANGE_FIELDS.has(c.field));
      const sanitizedSummary =
        typeof entry.summary === "string"
          ? entry.summary.replace(/\(fee ₹[\d,]+\)/gi, "").replace(/₹[\d,]+/g, "[restricted]").trim()
          : entry.summary;
      out.push({
        ...entry,
        changes: sanitizedChanges,
        ...(sanitizedSummary !== undefined ? { summary: sanitizedSummary } : {}),
      });
    } else {
      out.push(entry);
    }
  }
  return out;
}
