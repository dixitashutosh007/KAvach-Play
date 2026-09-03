/**
 * POST /api/calendar/sync
 *
 * Keeps the public Google Calendar in step with the app's matches.
 * Admin-guarded. Uses the Firebase service account (via lib/google-calendar)
 * to create / update / delete Calendar events, and the Admin SDK to read
 * match/ground/tournament docs and to write the resulting googleEventId
 * back onto the match.
 *
 * Body actions:
 *   { action: "upsert",  matchId }                 — create/update the event
 *   { action: "delete",  matchId, googleEventId? } — remove the event
 *   { action: "resync"  }                          — re-push every active match
 *   { action: "status"  }                          — SA email + connectivity test
 */

import { NextResponse } from "next/server";
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import firebaseConfig from "@/firebase-applet-config.json";
import type { Match } from "@/lib/types";
import {
  upsertMatchEvent,
  deleteMatchEvent,
  testCalendarAccess,
  getServiceAccountEmail,
  getCalendarId,
  setCalendarId,
  type EventContext,
} from "@/lib/google-calendar";

function ensureAdminApp() {
  const apps = getApps();
  if (apps.length) return apps[0];
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    return initializeApp({
      credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)),
    });
  }
  return initializeApp({ projectId: firebaseConfig.projectId });
}

function getDb() {
  const app = ensureAdminApp();
  const dbId = (firebaseConfig as any).firestoreDatabaseId;
  try {
    return getFirestore(app, dbId);
  } catch {
    return getFirestore(app);
  }
}

async function buildContext(db: FirebaseFirestore.Firestore, match: Match): Promise<EventContext> {
  const ctx: EventContext = {};
  if (match.groundId) {
    const g = await db.collection("grounds").doc(match.groundId).get();
    if (g.exists) {
      const gd = g.data() as any;
      ctx.groundName = gd?.name;
      ctx.groundMapUrl = gd?.mapUrl;
    }
  }
  if (match.tournamentId) {
    const t = await db.collection("tournaments").doc(match.tournamentId).get();
    if (t.exists) ctx.tournamentName = (t.data() as any)?.name;
  }
  return ctx;
}

export async function POST(req: Request) {
  try {
    const { requireAdmin } = await import("@/lib/server-auth");
    const guard = await requireAdmin(req);
    if (!guard.ok) return guard.response;

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");
    const db = getDb();

    // Read calendar ID from appConfig so the admin can change it in Settings.
    try {
      const cfgSnap = await db.collection("appConfig").doc("default").get();
      if (cfgSnap.exists) {
        const calId = (cfgSnap.data() as any)?.googleCalendarId;
        if (calId) setCalendarId(calId);
      }
    } catch {}

    // ---- status: setup helper for the admin Settings card ----
    if (action === "status") {
      const test = await testCalendarAccess();
      return NextResponse.json({
        ok: test.ok,
        serviceAccountEmail: getServiceAccountEmail(),
        calendarId: getCalendarId(),
        error: test.error,
      });
    }

    // ---- delete ----
    if (action === "delete") {
      const eventId =
        typeof body.googleEventId === "string" ? body.googleEventId : "";
      // If we weren't given the id (match already gone), nothing to do.
      if (eventId) await deleteMatchEvent(eventId);
      return NextResponse.json({ ok: true });
    }

    // ---- resync: re-push every active match, remove archived/abandoned ----
    if (action === "resync") {
      const [matchSnap, groundSnap, tournamentSnap] = await Promise.all([
        db.collection("matches").get(),
        db.collection("grounds").get(),
        db.collection("tournaments").get(),
      ]);

      const groundMap = new Map<string, { name?: string; mapUrl?: string }>();
      for (const g of groundSnap.docs) {
        const gd = g.data() as any;
        groundMap.set(g.id, { name: gd?.name, mapUrl: gd?.mapUrl });
      }
      const tournamentMap = new Map<string, string>();
      for (const t of tournamentSnap.docs) {
        tournamentMap.set(t.id, (t.data() as any)?.name || "");
      }

      const buildCtxLocal = (match: Match): EventContext => {
        const ctx: EventContext = {};
        if (match.groundId) {
          const g = groundMap.get(match.groundId);
          if (g) { ctx.groundName = g.name; ctx.groundMapUrl = g.mapUrl; }
        }
        if (match.tournamentId) {
          ctx.tournamentName = tournamentMap.get(match.tournamentId);
        }
        return ctx;
      };

      const shouldRemove = (m: Match) => m.isArchived || m.result === "Abandoned";

      let synced = 0;
      let removed = 0;
      const errors: string[] = [];
      const BATCH = 10;

      const docs = matchSnap.docs;
      for (let i = 0; i < docs.length; i += BATCH) {
        const chunk = docs.slice(i, i + BATCH);
        const results = await Promise.allSettled(
          chunk.map(async (d) => {
            const match = { id: d.id, ...(d.data() as any) } as Match;
            if (shouldRemove(match)) {
              if (match.googleEventId) {
                await deleteMatchEvent(match.googleEventId);
                await d.ref.update({ googleEventId: FieldValue.delete() });
                return "removed" as const;
              }
              return "skip" as const;
            }
            const ctx = buildCtxLocal(match);
            const eventId = await upsertMatchEvent(match, ctx);
            if (eventId !== match.googleEventId) {
              await d.ref.update({ googleEventId: eventId });
            }
            return "synced" as const;
          }),
        );
        for (let j = 0; j < results.length; j++) {
          const r = results[j];
          if (r.status === "fulfilled") {
            if (r.value === "synced") synced++;
            else if (r.value === "removed") removed++;
          } else {
            const d = chunk[j];
            const data = d.data() as any;
            errors.push(`${data?.opponent || d.id}: ${r.reason?.message || String(r.reason)}`);
          }
        }
      }
      return NextResponse.json({ ok: errors.length === 0, synced, removed, errors });
    }

    // ---- upsert (default create/update path) ----
    if (action === "upsert") {
      const matchId = typeof body.matchId === "string" ? body.matchId : "";
      if (!matchId) {
        return NextResponse.json({ error: "matchId is required." }, { status: 400 });
      }
      const ref = db.collection("matches").doc(matchId);
      const doc = await ref.get();
      if (!doc.exists) {
        return NextResponse.json({ error: "Match not found." }, { status: 404 });
      }
      const match = { id: doc.id, ...(doc.data() as any) } as Match;

      // Archived or abandoned match → make sure no public event remains.
      if (match.isArchived || match.result === "Abandoned") {
        if (match.googleEventId) {
          await deleteMatchEvent(match.googleEventId);
          await ref.update({ googleEventId: FieldValue.delete() });
        }
        return NextResponse.json({ ok: true, removed: true });
      }

      const ctx = await buildContext(db, match);
      const eventId = await upsertMatchEvent(match, ctx);
      if (eventId !== match.googleEventId) {
        await ref.update({ googleEventId: eventId });
      }
      return NextResponse.json({ ok: true, eventId });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err: any) {
    console.error("calendar/sync failed", err);
    return NextResponse.json(
      { error: err?.message || "calendar sync failed", code: err?.code },
      { status: 500 },
    );
  }
}
