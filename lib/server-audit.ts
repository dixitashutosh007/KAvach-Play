/**
 * Server-side audit writer (`lib/server-audit.ts`).
 *
 * Writes to the same `auditLogs` collection and document shape as the client
 * `logAudit()` (lib/auditLog.ts), via the Admin SDK, so server-performed
 * financial actions appear in the existing Audit Log screen.
 */
import { FieldValue, type Firestore } from "firebase-admin/firestore";

export interface ServerAuditEntry {
  actorId: string;
  actorName: string;
  actorType?: "admin" | "player" | "system";
  action: "created" | "updated" | "deleted" | "paid" | "status_change";
  entity: string;
  entityId: string;
  entityLabel: string;
  changes: { field: string; oldValue?: string; newValue?: string }[];
  summary: string;
  id?: string;
}

export async function writeServerAudit(db: Firestore, entry: ServerAuditEntry, batchOrTx?: { set: (ref: any, data: any) => unknown }): Promise<void> {
  const { id: customId, actorType = "admin", ...rest } = entry;
  const id = customId || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const ref = db.collection("auditLogs").doc(id);
  const data = {
    ...rest,
    actorType,
    source: "server_authoritative",
    id,
    timestamp: FieldValue.serverTimestamp(),
  };
  if (batchOrTx) batchOrTx.set(ref, data);
  else await ref.set(data);
}

/** Display name for an admin uid (appUsers name, else fallback). */
export async function actorNameFor(db: Firestore, uid: string): Promise<string> {
  try {
    const snap = await db.collection("appUsers").doc(uid).get();
    const name = snap.exists ? (snap.data()?.name as string | undefined) : undefined;
    return name || "Admin";
  } catch {
    return "Admin";
  }
}
