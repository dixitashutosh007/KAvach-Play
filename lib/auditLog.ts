import { db } from "@/lib/firebase";
import {
  collection,
  doc,
  setDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  getCountFromServer,
  writeBatch,
  Timestamp,
  QueryDocumentSnapshot,
  DocumentData,
} from "firebase/firestore";

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
  | "fee_template"
  | "settings"
  | "reminder"
  | "poll"
  | "post"
  | "out_of_play"
  | "catch"
  | "comment"
  | "user_role"
  | "lead";

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
  disabled: "Disabled",
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

export async function logAudit(entry: Omit<AuditLogEntry, "id" | "timestamp">, idempotencyKey?: string): Promise<void> {
  try {
    const id = idempotencyKey || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const ref = doc(db, AUDIT_COLLECTION, id);
    await setDoc(ref, {
      ...entry,
      id,
      timestamp: Timestamp.now(),
    }, { merge: true });
  } catch (e) {
    console.error("[auditLog] Failed to write audit log:", e);
  }
}

export async function getAuditLogCount(): Promise<number> {
  const coll = collection(db, AUDIT_COLLECTION);
  const snapshot = await getCountFromServer(coll);
  return snapshot.data().count;
}

export async function fetchAuditLogs(options: {
  entityFilter?: AuditEntity;
  actionFilter?: AuditAction;
  actorTypeFilter?: AuditActorType;
  pageSize?: number;
  lastDoc?: QueryDocumentSnapshot<DocumentData> | null;
}): Promise<{ logs: AuditLogEntry[]; lastDoc: QueryDocumentSnapshot<DocumentData> | null; hasMore: boolean }> {
  const { entityFilter, actionFilter, actorTypeFilter, pageSize = 30, lastDoc } = options;
  const coll = collection(db, AUDIT_COLLECTION);

  const constraints: any[] = [];
  if (entityFilter) constraints.push(where("entity", "==", entityFilter));
  if (actionFilter) constraints.push(where("action", "==", actionFilter));
  if (actorTypeFilter) constraints.push(where("actorType", "==", actorTypeFilter));
  constraints.push(orderBy("timestamp", "desc"));
  constraints.push(limit(pageSize + 1));
  if (lastDoc) constraints.push(startAfter(lastDoc));

  const q = query(coll, ...constraints);
  const snapshot = await getDocs(q);

  const hasMore = snapshot.docs.length > pageSize;
  const docs = hasMore ? snapshot.docs.slice(0, pageSize) : snapshot.docs;

  return {
    logs: docs.map(d => d.data() as AuditLogEntry),
    lastDoc: docs.length > 0 ? docs[docs.length - 1] : null,
    hasMore,
  };
}

export async function truncateAuditLogs(olderThanMonths: number): Promise<number> {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - olderThanMonths);
  const cutoffTs = Timestamp.fromDate(cutoff);

  const coll = collection(db, AUDIT_COLLECTION);
  const q = query(coll, where("timestamp", "<", cutoffTs), limit(500));

  let totalDeleted = 0;
  let hasMore = true;

  while (hasMore) {
    const snapshot = await getDocs(q);
    if (snapshot.empty) break;

    const batch = writeBatch(db);
    snapshot.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
    totalDeleted += snapshot.docs.length;
    hasMore = snapshot.docs.length === 500;
  }

  return totalDeleted;
}
