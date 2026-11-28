/**
 * Firebase Service Initialization (`lib/firebase.ts`)
 *
 * This file acts as the bridge between the React frontend and Firebase services.
 * It reads configuration from `firebase-applet-config.json` and initializes
 * the Firebase App, Auth, Storage, and Firestore databases.
 */
import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, browserLocalPersistence, setPersistence, indexedDBLocalPersistence, connectAuthEmulator } from "firebase/auth";
import { initializeFirestore, getFirestore, doc, getDocFromServer, persistentLocalCache, persistentMultipleTabManager, connectFirestoreEmulator, Firestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import firebaseConfig from "../firebase-applet-config.json";
import { resolveFirestoreDatabaseId } from "./database-config.ts";

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const isLocalEmulator =
  process.env.NODE_ENV !== "production" &&
  process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === "true";
const dbId = isLocalEmulator ? "(default)" : resolveFirestoreDatabaseId();
/** The Firestore database this client is bound to (non-secret identifier). */
export const firestoreDatabaseId = dbId;

const isClient = typeof window !== "undefined";
const isEmbedded = isClient && window.self !== window.top;

let _db: Firestore;
try {
  _db = isLocalEmulator
    ? initializeFirestore(app, { experimentalForceLongPolling: true })
    : initializeFirestore(
        app,
        {
          ...(isEmbedded ? { experimentalForceLongPolling: true } : {}),
          ...(isClient ? { localCache: persistentLocalCache({tabManager: persistentMultipleTabManager()}) } : {}),
        },
        dbId,
      );
} catch {
  _db = isLocalEmulator ? getFirestore(app) : getFirestore(app, dbId);
}
export const db = _db;

export const auth = getAuth(app);
if (
  isClient &&
  process.env.NODE_ENV !== "production" &&
  process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === "true" &&
  !(globalThis as { __KAVACH_EMULATOR_CONNECTED__?: boolean }).__KAVACH_EMULATOR_CONNECTED__
) {
  (globalThis as { __KAVACH_EMULATOR_CONNECTED__?: boolean }).__KAVACH_EMULATOR_CONNECTED__ = true;
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
}
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
