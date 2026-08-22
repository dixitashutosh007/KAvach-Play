/**
 * Firebase Service Initialization (`lib/firebase.ts`)
 *
 * This file acts as the bridge between the React frontend and Firebase services.
 * It reads configuration from `firebase-applet-config.json` and initializes
 * the Firebase App, Auth, Storage, and Firestore databases.
 */
import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, browserLocalPersistence, setPersistence, indexedDBLocalPersistence } from "firebase/auth";
import { initializeFirestore, getFirestore, doc, getDocFromServer, persistentLocalCache, persistentMultipleTabManager, Firestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import firebaseConfig from "../firebase-applet-config.json";

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const dbId =
  process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID ||
  (firebaseConfig as any).firestoreDatabaseId ||
  "ai-studio-cae01507-23c3-4ee4-92c8-848c4cf7d412";

const isClient = typeof window !== "undefined";
const isEmbedded = isClient && window.self !== window.top;

let _db: Firestore;
try {
  _db = initializeFirestore(
    app,
    {
      ...(isEmbedded ? { experimentalForceLongPolling: true } : {}),
      ...(isClient ? { localCache: persistentLocalCache({tabManager: persistentMultipleTabManager()}) } : {}),
    },
    dbId,
  );
} catch {
  _db = getFirestore(app, dbId);
}
export const db = _db;

export const auth = getAuth(app);
if (isClient) {
  setPersistence(auth, indexedDBLocalPersistence).catch(() => {
    setPersistence(auth, browserLocalPersistence).catch(console.error);
  });
}
export const storage = getStorage(app);

export async function testConnection() {
  try {
    await getDocFromServer(doc(db, "appConfig", "default"));
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("offline") ||
        error.message.includes("could not reach") ||
        error.message.includes("unreachable"))
    ) {
      console.warn(
        "Could not reach Cloud Firestore backend. Operating in offline/cached mode.",
      );
    }
  }
}
