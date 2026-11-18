import { NextResponse } from "next/server.js";
import { requireAuth, getEffectiveDb, ensureAdminApp } from "../../../../lib/server-auth.ts";
import { linkPlayerAccount } from "../../../../lib/account-linking.ts";

export async function POST(req: Request) {
  const auth = await requireAuth(req);
  if (!auth.ok) {
    return auth.response;
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  // Reject client attempts to inject privileged, role, or profile fields during account linking
  const forbiddenKeys = [
    "role",
    "status",
    "authUid",
    "name",
    "email",
    "mobile",
    "isSuperAdmin",
    "isClubAdmin",
    "isMatchAdmin",
    "isFinanceAdmin",
    "isStudioAdmin",
    "isDesigner",
    "canDesign",
  ];
  if (forbiddenKeys.some((k) => k in body)) {
    return NextResponse.json(
      { error: "Extra profile, status, or role fields cannot be modified during account linking." },
      { status: 400 },
    );
  }

  const app = ensureAdminApp();
  const db = (getEffectiveDb as any)(app);

  const result = await linkPlayerAccount(db, {
    uid: auth.uid,
    verifiedPhoneNumber: auth.phoneNumber,
    requestedPlayerId: body.playerId,
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
