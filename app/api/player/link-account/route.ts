import { NextResponse } from "next/server.js";
import { requireAuth, getEffectiveDb, ensureAdminApp } from "../../../../lib/server-auth.ts";
import { linkPlayerAccount } from "../../../../lib/account-linking.ts";

export async function POST(req: Request) {
  // 1. Authorize caller via Firebase ID token (or test bypass headers in test environment)
  const auth = await requireAuth(req);
  if (!auth.ok) {
    return auth.response;
  }

  // 2. Reject malformed JSON with HTTP 400
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed JSON payload." }, { status: 400 });
  }

  // 3. Require a JSON object (reject null, primitives, arrays)
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Request body must be a JSON object." }, { status: 400 });
  }

  // 4. Reject every unknown property (Strict Schema Allowlist)
  const allowedKeys = new Set(["playerId"]);
  const bodyKeys = Object.keys(body);
  const unknownKeys = bodyKeys.filter((k) => !allowedKeys.has(k));
  if (unknownKeys.length > 0) {
    return NextResponse.json(
      {
        error: `Unknown properties not permitted: ${unknownKeys.join(", ")}. Extra profile, status, or role fields cannot be modified during account linking.`,
      },
      { status: 400 },
    );
  }

  // 5. Require playerId to be a non-empty string within supported document ID length & character limits
  if (!("playerId" in body) || typeof body.playerId !== "string" || !body.playerId.trim()) {
    return NextResponse.json(
      { error: "Missing or invalid playerId. Must be a non-empty string." },
      { status: 400 },
    );
  }

  const playerId = body.playerId.trim();
  if (playerId.length > 100 || !/^[a-zA-Z0-9_\-]+$/.test(playerId)) {
    return NextResponse.json(
      { error: "playerId contains invalid characters or exceeds maximum allowed length." },
      { status: 400 },
    );
  }

  // 6. Execute atomic server linking with verified token claims (UID & phone derived only from auth)
  const app = ensureAdminApp();
  const db = (getEffectiveDb as any)(app);

  const result = await linkPlayerAccount(db, {
    uid: auth.uid,
    verifiedPhoneNumber: auth.phoneNumber,
    requestedPlayerId: playerId,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    playerId: result.playerId,
    alreadyLinked: result.alreadyLinked || false,
  });
}
