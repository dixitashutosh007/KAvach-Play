/**
 * POST /api/player/link-google
 *
 * Links the signed-in Google login to the player record whose email matches the
 * Google-verified email in the Firebase ID token. No request body is accepted:
 * identity comes only from the verified token. See lib/google-linking.ts.
 */
import { NextResponse } from "next/server.js";
import { requireAuth, getEffectiveDb, ensureAdminApp } from "../../../../lib/server-auth.ts";
import { linkGoogleLogin } from "../../../../lib/google-linking.ts";

export async function POST(req: Request) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;

  // Reject any client-supplied identity data.
  const raw = await req.text().catch(() => "");
  if (raw.trim() && raw.trim() !== "{}") {
    return NextResponse.json(
      { error: "This endpoint does not accept a request body; identity comes from your sign-in." },
      { status: 400 },
    );
  }

  const app = ensureAdminApp();
  const db = (getEffectiveDb as any)(app);
  try {
    const result = await linkGoogleLogin(db, {
      uid: auth.uid,
      email: auth.email,
      emailVerified: auth.emailVerified,
      signInProvider: auth.signInProvider,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
    }
    return NextResponse.json({ ok: true, playerId: result.playerId, alreadyLinked: result.alreadyLinked });
  } catch (err) {
    console.error("[link-google] Linking failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Your player record could not be linked. Please try again." }, { status: 500 });
  }
}
