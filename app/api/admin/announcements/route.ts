import crypto from "node:crypto";
import { NextResponse } from "next/server.js";
import { FieldValue } from "firebase-admin/firestore";
import { requireClubAdmin } from "../../../../lib/server-auth.ts";
import { getServerFirestore } from "../../../../lib/server-db.ts";
import { actorNameFor, writeServerAudit } from "../../../../lib/server-audit.ts";
import { isSafeId } from "../../../../lib/weekend-ops-server.ts";

class RequestError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function scopedAuditId(
  rawKey: unknown,
  uid: string,
  op: string,
  postId: string,
): string | undefined {
  if (typeof rawKey !== "string") return undefined;
  const trimmed = rawKey.trim();
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(trimmed)) return undefined;
  const digest = crypto
    .createHash("sha256")
    .update(`${uid}:announcement:${op}:${postId}:${trimmed}`)
    .digest("hex")
    .slice(0, 32);
  return `ann_${digest}`;
}

function isAlreadyExistsError(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code;
  return code === 6 || String(err).includes("ALREADY_EXISTS");
}

/**
 * POST /api/admin/announcements — Create an announcement with transactional server audit.
 */
export async function POST(req: Request) {
  const auth = await requireClubAdmin(req);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 160) : "";
  const isPinned = body.isPinned === true;
  const imageUrl = typeof body.imageUrl === "string" && body.imageUrl.trim() ? body.imageUrl.trim() : undefined;
  const linkUrl = typeof body.linkUrl === "string" && body.linkUrl.trim() ? body.linkUrl.trim() : undefined;
  const displayDurationSec =
    typeof body.displayDurationSec === "number" && Number.isFinite(body.displayDurationSec)
      ? body.displayDurationSec
      : undefined;

  if (!text) {
    return NextResponse.json({ error: "Announcement text is required." }, { status: 400 });
  }

  const postId =
    typeof body.id === "string" && isSafeId(body.id.trim())
      ? body.id.trim()
      : crypto.randomUUID();
  const safeAuditId = scopedAuditId(body.idempotencyKey, auth.uid, "create", postId);

  try {
    const db = getServerFirestore();
    const actorName = await actorNameFor(db, auth.uid);
    const authorName =
      typeof body.authorName === "string" && body.authorName.trim()
        ? body.authorName.trim().slice(0, 120)
        : actorName;

    const result = await db.runTransaction(async (tx) => {
      const postRef = db.collection("posts").doc(postId);
      const existing = await tx.get(postRef);
      if (existing.exists) {
        return { id: postId, deduplicated: true };
      }

      const payload: Record<string, unknown> = {
        text,
        isAnnouncement: true,
        isPinned,
        authorName,
        authorId: auth.uid,
        comments: [],
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (title) payload.title = title;
      if (imageUrl) payload.imageUrl = imageUrl;
      if (linkUrl) payload.linkUrl = linkUrl;
      if (displayDurationSec !== undefined) payload.displayDurationSec = displayDurationSec;

      tx.create(postRef, payload);

      const changes: { field: string; oldValue?: string; newValue?: string }[] = [
        { field: "isAnnouncement", newValue: "Yes" },
        { field: "isPinned", newValue: isPinned ? "Yes" : "No" },
        { field: "text", newValue: text.slice(0, 120) },
      ];
      if (title) changes.unshift({ field: "title", newValue: title });

      await writeServerAudit(
        db,
        {
          ...(safeAuditId ? { id: safeAuditId } : {}),
          actorId: auth.uid,
          actorName,
          action: "created",
          entity: "post",
          entityId: postId,
          entityLabel: title || text.slice(0, 60),
          changes,
          summary: `Published announcement "${title || text.slice(0, 60)}"`,
        },
        tx,
      );

      return { id: postId, deduplicated: false };
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (safeAuditId && isAlreadyExistsError(err)) {
      return NextResponse.json({ ok: true, id: postId, deduplicated: true });
    }
    console.error("[admin/announcements] POST failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Could not publish announcement." }, { status: 500 });
  }
}

/**
 * PATCH /api/admin/announcements — Edit announcement fields/visibility with transactional server audit.
 */
export async function PATCH(req: Request) {
  const auth = await requireClubAdmin(req);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const postId = typeof body.postId === "string" ? body.postId.trim() : "";
  if (!isSafeId(postId)) {
    return NextResponse.json({ error: "Valid postId is required." }, { status: 400 });
  }

  const fields =
    body.fields && typeof body.fields === "object" && !Array.isArray(body.fields)
      ? (body.fields as Record<string, unknown>)
      : {};
  const allowedKeys = ["text", "title", "isPinned", "imageUrl", "linkUrl", "displayDurationSec"] as const;
  const safeAuditId = scopedAuditId(body.idempotencyKey, auth.uid, "update", postId);

  try {
    const db = getServerFirestore();
    const actorName = await actorNameFor(db, auth.uid);

    await db.runTransaction(async (tx) => {
      const postRef = db.collection("posts").doc(postId);
      const snap = await tx.get(postRef);
      if (!snap.exists) {
        throw new RequestError(404, "Announcement not found.");
      }
      const oldData = snap.data() || {};
      if (oldData.kind === "potw") {
        throw new RequestError(400, "POTW announcements must be updated via /api/admin/player-of-weekend.");
      }

      const updatePayload: Record<string, unknown> = {
        updatedAt: FieldValue.serverTimestamp(),
      };
      const changes: { field: string; oldValue?: string; newValue?: string }[] = [];

      for (const key of allowedKeys) {
        if (!(key in fields)) continue;
        const nextVal = fields[key];
        const prevVal = oldData[key];
        if (nextVal === undefined || nextVal === null) {
          updatePayload[key] = FieldValue.delete();
        } else {
          updatePayload[key] = nextVal;
        }

        const oldStr =
          key === "imageUrl"
            ? prevVal ? "[image]" : ""
            : prevVal !== undefined && prevVal !== null
              ? String(prevVal).slice(0, 120)
              : "";
        const newStr =
          key === "imageUrl"
            ? nextVal ? "[image]" : ""
            : nextVal !== undefined && nextVal !== null
              ? String(nextVal).slice(0, 120)
              : "";

        if (oldStr !== newStr) {
          changes.push({
            field: key,
            ...(oldStr ? { oldValue: oldStr } : {}),
            ...(newStr ? { newValue: newStr } : {}),
          });
        }
      }

      if (changes.length === 0) {
        return;
      }

      tx.update(postRef, updatePayload);
      const label =
        (typeof fields.title === "string" && fields.title.trim()) ||
        (typeof oldData.title === "string" && oldData.title.trim()) ||
        (typeof fields.text === "string" && fields.text.trim().slice(0, 60)) ||
        String(oldData.text || postId).slice(0, 60);

      await writeServerAudit(
        db,
        {
          ...(safeAuditId ? { id: safeAuditId } : {}),
          actorId: auth.uid,
          actorName,
          action: "updated",
          entity: "post",
          entityId: postId,
          entityLabel: label,
          changes,
          summary: `Updated announcement "${label}"`,
        },
        tx,
      );
    });

    return NextResponse.json({ ok: true, id: postId });
  } catch (err) {
    if (safeAuditId && isAlreadyExistsError(err)) {
      return NextResponse.json({ ok: true, id: postId, deduplicated: true });
    }
    if (err instanceof RequestError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[admin/announcements] PATCH failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Could not update announcement." }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/announcements?postId=<id>&idempotencyKey=<key>
 */
export async function DELETE(req: Request) {
  const auth = await requireClubAdmin(req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const postId = (url.searchParams.get("postId") || "").trim();
  const idempotencyKey = url.searchParams.get("idempotencyKey");
  if (!isSafeId(postId)) {
    return NextResponse.json({ error: "Valid postId is required." }, { status: 400 });
  }

  const safeAuditId = scopedAuditId(idempotencyKey, auth.uid, "delete", postId);

  try {
    const db = getServerFirestore();
    const actorName = await actorNameFor(db, auth.uid);

    await db.runTransaction(async (tx) => {
      const postRef = db.collection("posts").doc(postId);
      const snap = await tx.get(postRef);
      if (!snap.exists) {
        throw new RequestError(404, "Announcement not found.");
      }
      const oldData = snap.data() || {};
      if (oldData.kind === "potw") {
        throw new RequestError(400, "POTW announcements must be deleted via /api/admin/player-of-weekend.");
      }

      const label =
        (typeof oldData.title === "string" && oldData.title.trim()) ||
        String(oldData.text || postId).slice(0, 60);

      tx.delete(postRef);
      await writeServerAudit(
        db,
        {
          ...(safeAuditId ? { id: safeAuditId } : {}),
          actorId: auth.uid,
          actorName,
          action: "deleted",
          entity: "post",
          entityId: postId,
          entityLabel: label,
          changes: [
            ...(oldData.title ? [{ field: "title", oldValue: String(oldData.title).slice(0, 120) }] : []),
            { field: "isPinned", oldValue: oldData.isPinned ? "Yes" : "No" },
            { field: "text", oldValue: String(oldData.text || "").slice(0, 120) },
          ],
          summary: `Deleted announcement "${label}"`,
        },
        tx,
      );
    });

    return NextResponse.json({ ok: true, id: postId });
  } catch (err) {
    if (safeAuditId && isAlreadyExistsError(err)) {
      return NextResponse.json({ ok: true, id: postId, deduplicated: true });
    }
    if (err instanceof RequestError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[admin/announcements] DELETE failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Could not delete announcement." }, { status: 500 });
  }
}
