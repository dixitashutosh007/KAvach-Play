// TEMPORARY diagnostic endpoint. Remove once sandbox is verified.
// Shows which Firestore database id the server and (indirectly) the client
// are configured to talk to.

import { NextResponse } from "next/server";
import firebaseConfig from "../../../../firebase-applet-config.json";

export async function GET() {
  const envVar = process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID || null;
  const fromConfig = (firebaseConfig as any).firestoreDatabaseId || null;
  const effective = envVar || fromConfig || "(default)";
  return NextResponse.json(
    {
      envVarValue: envVar,
      configFileValue: fromConfig,
      effectiveDatabaseId: effective,
      hint:
        envVar === null
          ? "NEXT_PUBLIC_FIRESTORE_DATABASE_ID is NOT set at build/runtime. Either it wasn't added to Amplify env vars, or the current build predates it being added."
          : `env var is present. Server will use "${effective}".`,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
