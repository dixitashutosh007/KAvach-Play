import { auth } from "@/lib/firebase";
import { authedFetch } from "@/lib/authed-fetch";

export type AuditAction = "created" | "updated" | "deleted" | "paid" | "sent" | "status_change";

export type AuditEntity =
  | "match"
  | "player"
  | "payment"
  | "ground"
  | "tournament"
  | "subscription"
  | "badge"
  | "badge_type"
  | "merchandise"
  | "merch_order"
  | "fee"
  | "fee_plan"
  | "fee_plan_assignment"
  | "subscription_period"
  | "fee_template"
  | "settings"
  | "reminder"
  | "poll"
  | "post"
  | "out_of_play"
  | "catch"
  | "comment"
  | "user_role"
  | "lead"
  | "player_stat"
  | "club_stats"
  | "shop";

export type AuditActorType = "admin" | "player" | "system";

export interface AuditFieldChange {
  field: string;
  oldValue?: any;
  newValue?: any;
}

export interface AuditLogEntry {
  id: string;
  actorId: string;
  actorName: string;
  actorType: AuditActorType;
  action: AuditAction;
  entity: AuditEntity;
  entityId: string;
  entityLabel: string;
  changes: AuditFieldChange[];
  summary: string;
  timestamp: any;
}

const AUDIT_COLLECTION = "auditLogs";

const DISPLAY_LABELS: Record<string, string> = {
  groundId: "Ground",
  matchType: "Type",
  jerseyColor: "Jersey",
  maxSquadSize: "Squad Size",
  matchUrl: "Match URL",
  streamingUrl: "Stream URL",
  fee: "Fee",
  format: "Format",
  opponent: "Opponent",
  tournamentId: "Tournament",
  result: "Result",
  resultMarginType: "Margin Type",
  resultMarginAmount: "Margin",
  playerOfTheMatch: "POTM",
  potmId: "POTM ID",
  bestBatsman: "Best Batsman",
  bestBowler: "Best Bowler",
  isTentative: "Tentative",
  isArchived: "Archived",
  name: "Name",
  email: "Email",
  phone: "Phone",
  jerseyNumber: "Jersey #",
  role: "Role",
  inviteStatus: "Status",
  disabled: "Deactivated",
  totalRuns: "Runs",
  totalWickets: "Wickets",
  stunningCatches: "Stunning Catches",
  droppedCatches: "Dropped Catches",
  practiceFee: "Practice Fee",
  tournamentFee: "Tournament Fee",
  organiserName: "Organiser",
  organiserPhone: "Organiser Phone",
  gpayNumber: "GPay Number",
  mapUrl: "Map URL",
  status: "Status",
  perPlayerFee: "Per Player Fee",
  amountPerMatch: "Amount Per Match",
  studioExpiryDate: "Studio Expiry",
};

export function formatFieldName(field: string): string {
  return DISPLAY_LABELS[field] || field.replace(/([A-Z])/g, " $1").replace(/^./, s => s.toUpperCase()).trim();
}

function formatValue(val: any): string {
  if (val === undefined || val === null) return "-";
  if (val === true) return "Yes";
  if (val === false) return "No";
  if (typeof val === "object" && val.toDate) return val.toDate().toLocaleDateString("en-IN");
  if (val instanceof Date) return val.toLocaleDateString("en-IN");
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}

const SKIP_FIELDS = new Set([
  "id", "createdAt", "updatedAt", "rawPayload",
  "createdBy", "updatedBy",
]);

export function diffChanges(
  oldObj: Record<string, any> | undefined,
  newObj: Record<string, any>,
  fieldsToTrack?: string[],
): AuditFieldChange[] {
  const changes: AuditFieldChange[] = [];
  const keys = fieldsToTrack || Object.keys(newObj);

  for (const key of keys) {
    if (SKIP_FIELDS.has(key)) continue;
    const oldVal = oldObj ? oldObj[key] : undefined;
    const newVal = newObj[key];

    if (newVal === undefined) continue;

    const oldStr = formatValue(oldVal);
    const newStr = formatValue(newVal);
    if (oldStr !== newStr) {
      changes.push({
        field: key,
        oldValue: oldStr === "-" ? undefined : oldStr,
        newValue: newStr === "-" ? undefined : newStr,
      });
    }
  }
  return changes;
}

export async function logAudit(
  entry: Omit<AuditLogEntry, "id" | "timestamp">,
  idempotencyKey?: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const user = auth.currentUser;
    if (!user) return { ok: false, error: "Not authenticated." };
    const token = await user.getIdToken();
    const res = await fetch("/api/audit/log", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        entityLabel: entry.entityLabel,
        changes: entry.changes,
        summary: entry.summary,
        ...(idempotencyKey ? { idempotencyKey } : {}),
      }),
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const data = await res.json();
        if (data?.error) msg = String(data.error);
      } catch {}
      console.error("[auditLog] Server rejected audit log:", msg);
      return { ok: false, error: msg };
    }
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[auditLog] Failed to write audit log:", msg);
    return { ok: false, error: msg };
  }
}

export async function logAuditStrict(
  entry: Omit<AuditLogEntry, "id" | "timestamp">,
  idempotencyKey?: string,
): Promise<void> {
  const result = await logAudit(entry, idempotencyKey);
  if (!result.ok) {
    throw new Error(result.error || "Audit log recording failed.");
  }
}

export async function getAuditLogCount(): Promise<number | null> {
  const res = await authedFetch("/api/audit/log?limit=1");
  if (!res.ok) return null;
  const data = await res.json();
  return typeof data?.totalCount === "number" ? data.totalCount : null;
}

export async function fetchAuditLogs(options: {
  entityFilter?: AuditEntity;
  actionFilter?: AuditAction;
  actorTypeFilter?: AuditActorType;
  actorQuery?: string;
  pageSize?: number;
  cursor?: string | null;
}): Promise<{
  logs: AuditLogEntry[];
  nextCursor: string | null;
  hasMore: boolean;
  permittedEntities: string[] | "ALL";
  totalCount: number | null;
}> {
  const { entityFilter, actionFilter, actorTypeFilter, actorQuery, pageSize = 30, cursor } = options;
  const params = new URLSearchParams();
  params.set("limit", String(pageSize));
  if (entityFilter) params.set("entity", entityFilter);
  if (actionFilter) params.set("action", actionFilter);
  if (actorTypeFilter) params.set("actorType", actorTypeFilter);
  if (actorQuery?.trim()) params.set("actorQuery", actorQuery.trim());
  if (cursor) params.set("cursor", cursor);

  const res = await authedFetch(`/api/audit/log?${params.toString()}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || `HTTP ${res.status}`);
  }
  return {
    logs: Array.isArray(data.logs) ? (data.logs as AuditLogEntry[]) : [],
    nextCursor: typeof data.nextCursor === "string" ? data.nextCursor : null,
    hasMore: Boolean(data.hasMore),
    permittedEntities: data.permittedEntities === "ALL" || Array.isArray(data.permittedEntities) ? data.permittedEntities : [],
    totalCount: typeof data.totalCount === "number" ? data.totalCount : null,
  };
}
