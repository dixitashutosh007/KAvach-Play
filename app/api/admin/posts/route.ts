import crypto from "node:crypto";
import { NextResponse } from "next/server.js";
import { FieldValue } from "firebase-admin/firestore";
import { requireRole } from "../../../../lib/server-auth.ts";
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

const POST_ADMIN_ROLES = ["superAdmin", "clubAdmin", "financeAdmin"] as const;

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
    .update(`${uid}:post:${op}:${postId}:${trimmed}`)
    .digest("hex")
    .slice(0, 32);
  return `post_${digest}`;
}

function isAlreadyExistsError(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code;
  return code === 6 || String(err).includes("ALREADY_EXISTS");
}

/**
 * POST /api/admin/posts — Create a regular feed post (non-announcement) with transactional server audit.
 */
export async function POST(req: Request) {
  const auth = await requireRole(req, [...POST_ADMIN_ROLES]);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (body.isAnnouncement === true) {
    return NextResponse.json(
      { error: "Announcements must be created via /api/admin/announcements." },
      { status: 400 },
    );
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return NextResponse.json({ error: "Post text is required." }, { status: 400 });
  }

  const imageUrl = typeof body.imageUrl === "string" && body.imageUrl.trim() ? body.imageUrl.trim() : undefined;
  const isSystem = body.isSystem === true;
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
        isAnnouncement: false,
        isSystem,
        authorName,
        authorId: auth.uid,
        comments: [],
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (imageUrl) payload.imageUrl = imageUrl;

      tx.create(postRef, payload);

      await writeServerAudit(
        db,
        {
          ...(safeAuditId ? { id: safeAuditId } : {}),
          actorId: auth.uid,
          actorName,
          action: "created",
          entity: "post",
          entityId: postId,
          entityLabel: text.slice(0, 60),
          changes: [
            { field: "text", newValue: text.slice(0, 120) },
            ...(imageUrl ? [{ field: "imageUrl", newValue: "[image]" }] : []),
          ],
          summary: `Created feed post: "${text.slice(0, 60)}"`,
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
    console.error("[admin/posts] POST failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Could not create post." }, { status: 500 });
  }
}

/**
 * PATCH /api/admin/posts — Update a regular feed post with transactional server audit.
 */
export async function PATCH(req: Request) {
  const auth = await requireRole(req, [...POST_ADMIN_ROLES]);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const postId = typeof body.postId === "string" ? body.postId.trim() : "";
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!isSafeId(postId)) {
    return NextResponse.json({ error: "Valid postId is required." }, { status: 400 });
  }
  if (!text) {
    return NextResponse.json({ error: "Post text is required." }, { status: 400 });
  }

  const safeAuditId = scopedAuditId(body.idempotencyKey, auth.uid, "update", postId);

  try {
    const db = getServerFirestore();
    const actorName = await actorNameFor(db, auth.uid);

    await db.runTransaction(async (tx) => {
      const postRef = db.collection("posts").doc(postId);
      const snap = await tx.get(postRef);
      if (!snap.exists) {
        throw new RequestError(404, "Post not found.");
      }
      const oldData = snap.data() || {};
      if (oldData.isAnnouncement === true || oldData.kind === "potw") {
        throw new RequestError(400, "Announcements must be updated via /api/admin/announcements.");
      }

      const oldText = String(oldData.text || "");
      if (oldText === text) return;

      tx.update(postRef, {
        text,
        updatedAt: FieldValue.serverTimestamp(),
      });

      await writeServerAudit(
        db,
        {
          ...(safeAuditId ? { id: safeAuditId } : {}),
          actorId: auth.uid,
          actorName,
          action: "updated",
          entity: "post",
          entityId: postId,
          entityLabel: text.slice(0, 60),
          changes: [
            {
              field: "text",
              oldValue: oldText.slice(0, 120),
              newValue: text.slice(0, 120),
            },
          ],
          summary: `Updated feed post "${text.slice(0, 60)}"`,
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
    console.error("[admin/posts] PATCH failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Could not update post." }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/posts?postId=<id>&idempotencyKey=<key>
 */
export async function DELETE(req: Request) {
  const auth = await requireRole(req, [...POST_ADMIN_ROLES]);
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
        throw new RequestError(404, "Post not found.");
      }
      const oldData = snap.data() || {};
      if (oldData.isAnnouncement === true || oldData.kind === "potw") {
        throw new RequestError(400, "Announcements must be deleted via /api/admin/announcements.");
      }

      const oldText = String(oldData.text || postId);
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
          entityLabel: oldText.slice(0, 60),
          changes: [{ field: "text", oldValue: oldText.slice(0, 120) }],
          summary: `Deleted feed post "${oldText.slice(0, 60)}"`,
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
    console.error("[admin/posts] DELETE failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Could not delete post." }, { status: 500 });
  }
}
