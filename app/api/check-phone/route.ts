import { NextResponse } from "next/server";
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import firebaseConfig from "../../../firebase-applet-config.json";
import { normalizeIndianMobile } from "@/lib/utils";

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

export async function POST(req: Request) {
  try {
    const { phone } = await req.json();
    if (!phone || typeof phone !== "string") {
      return NextResponse.json({ exists: false });
    }

    const normalized = normalizeIndianMobile(phone);
    if (normalized.length < 12) {
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

    const buildExistsResponse = (playerData: FirebaseFirestore.DocumentData, fallbackName?: string) => {
      const hasEmail = !!playerData.email && playerData.email.includes("@");
      const loginMethod = hasEmail ? "Google Sign-In" : "your existing login method";
      const maskedEmail = hasEmail
        ? playerData.email.replace(/^(.{2})(.*)(@.*)$/, (_: string, a: string, b: string, c: string) => a + "*".repeat(b.length) + c)
        : undefined;
      return NextResponse.json({
        exists: true,
        name: playerData.name || fallbackName || "Player",
        loginMethod,
        maskedEmail,
      });
    };

    for (const doc of snap.docs) {
      const data = doc.data();
      if (data.disabled || data.mergedInto) continue;
      const pNormalized = normalizeIndianMobile(data.mobile || "");
      if (pNormalized.length >= 12 && pNormalized === normalized) {
        return buildExistsResponse(data);
      }
    }

    for (const doc of snap.docs) {
      const data = doc.data();
      if (!data.mergedInto) continue;
      const pNormalized = normalizeIndianMobile(data.mobile || "");
      if (pNormalized.length >= 12 && pNormalized === normalized) {
        let keeperId: string = data.mergedInto;
        let keeperData = snap.docs.find(d => d.id === keeperId)?.data();
        let depth = 0;
        while (keeperData?.mergedInto && depth < 5) {
          keeperId = keeperData.mergedInto;
          keeperData = snap.docs.find(d => d.id === keeperId)?.data();
          depth++;
        }
        if (keeperData && !keeperData.disabled) {
          return buildExistsResponse(keeperData, data.name);
        }
      }
    }

    return NextResponse.json({ exists: false });
  } catch (err) {
    console.error("check-phone error:", err);
    return NextResponse.json({ exists: false });
  }
}
