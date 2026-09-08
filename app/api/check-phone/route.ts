import { NextResponse } from "next/server";
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import firebaseConfig from "../../../firebase-applet-config.json";

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

function normalizePhone(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 13 && digits.startsWith("091")) digits = digits.slice(3);
  else if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length > 10) digits = digits.slice(-10);
  return digits;
}

export async function POST(req: Request) {
  try {
    const { phone } = await req.json();
    if (!phone || typeof phone !== "string") {
      return NextResponse.json({ exists: false });
    }

    const digits = normalizePhone(phone);
    if (digits.length !== 10) {
      return NextResponse.json({ exists: false });
    }

    const app = ensureAdminApp();
    const dbId =
      process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID ||
      (firebaseConfig as any).firestoreDatabaseId;
    let db;
    try {
      db = getFirestore(app, dbId);
    } catch {
      db = getFirestore(app);
    }

    const snap = await db.collection("players").get();
    for (const doc of snap.docs) {
      const data = doc.data();
      if (data.disabled || data.mergedInto) continue;

      const pDigits = normalizePhone(data.mobile || "");
      if (pDigits.length === 10 && pDigits === digits) {
        const hasEmail = !!data.email && data.email.includes("@");
        const loginMethod = hasEmail ? "Google Sign-In" : "your existing login method";
        const maskedEmail = hasEmail
          ? data.email.replace(/^(.{2})(.*)(@.*)$/, (_: string, a: string, b: string, c: string) => a + "*".repeat(b.length) + c)
          : undefined;
        return NextResponse.json({
          exists: true,
          name: data.name || "Player",
          loginMethod,
          maskedEmail,
        });
      }
    }

    return NextResponse.json({ exists: false });
  } catch (err) {
    console.error("check-phone error:", err);
    return NextResponse.json({ exists: false });
  }
}
