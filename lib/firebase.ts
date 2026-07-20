/**
 * Firebase Service Initialization (`lib/firebase.ts`)
 *
 * This file acts as the bridge between the React frontend and Firebase services.
 * It reads configuration from `firebase-applet-config.json` and initializes
 * the Firebase App, Auth, Storage, and Firestore databases. Long polling is explicitly
 * enabled for Firestore to bypass firewall/proxy socket restrictions often seen in preview environments.
 */
import { initializeApp } from "firebase/app";
import { getAuth, browserLocalPersistence, setPersistence, indexedDBLocalPersistence } from "firebase/auth";
import { initializeFirestore, doc, getDocFromServer, persistentLocalCache, persistentMultipleTabManager } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import firebaseConfig from "../firebase-applet-config.json";

export const app = initializeApp(firebaseConfig);
const dbId =
  process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID ||
  (firebaseConfig as any).firestoreDatabaseId ||
  "ai-studio-cae01507-23c3-4ee4-92c8-848c4cf7d412";

export const db = initializeFirestore(
  app,
  {
    experimentalForceLongPolling: true,
    localCache: persistentLocalCache({tabManager: persistentMultipleTabManager()})
  },
  dbId,
);
export const auth = getAuth(app);
setPersistence(auth, indexedDBLocalPersistence).catch(() => {
  setPersistence(auth, browserLocalPersistence).catch(console.error);
});
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
