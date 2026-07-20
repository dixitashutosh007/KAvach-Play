import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import firebaseConfig from "../../../firebase-applet-config.json";
import { PayClient } from "./PayClient";

// Server-side player lookup. The rest of the payment flow (auth, dues,
// Razorpay checkout, success state) lives in <PayClient>.
async function fetchPlayer(playerId: string): Promise<{ id: string; name: string } | null> {
  try {
    const apps = getApps();
    let app;
    if (!apps.length) {
      if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
        app = initializeApp({
          credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)),
        });
      } else {
        app = initializeApp();
      }
    } else {
      app = apps[0];
    }
    const dbId =
      process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID ||
      (firebaseConfig as any).firestoreDatabaseId;
    let db;
    try {
      db = getFirestore(app, dbId);
    } catch {
      db = getFirestore(app);
    }
    const snap = await db.collection("players").doc(playerId).get();
    if (!snap.exists) return null;
    const data = snap.data() as any;
    return { id: snap.id, name: data?.name || "Player" };
  } catch (err) {
    console.error("fetchPlayer failed", err);
    return null;
  }
}

export default async function PayPage({
  params,
}: {
  params: Promise<{ playerId: string }>;
}) {
  const { playerId } = await params;
  const player = await fetchPlayer(playerId);

  if (!player) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-6 text-white text-center">
        <div className="space-y-2">
          <h1 className="text-xl font-bold">Player not found</h1>
          <p className="text-white/50 text-sm">
            The payment link appears to be invalid or the player was removed.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#070707] text-white">
      <div className="max-w-md mx-auto p-4 sm:p-6 space-y-6">
        <div className="text-center py-6">
          <h1 className="text-2xl font-bold tracking-tight text-white">Kavach Play</h1>
          <div className="text-xs uppercase tracking-widest text-accent mt-1">
            Payment Portal
          </div>
        </div>

        <div className="glass rounded-xl p-5 text-center bg-accent/5 border-accent/20">
          <div className="text-[11px] font-bold text-white/60 uppercase tracking-widest mb-1">
            Paying For
          </div>
          <div className="text-lg font-black">{player.name}</div>
        </div>

        <PayClient playerId={playerId} />
      </div>
    </div>
  );
}
