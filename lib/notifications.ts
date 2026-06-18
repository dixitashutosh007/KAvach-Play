import { db } from "./firebase";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";

export type NotificationType = "email" | "in_app" | "both";

export async function createNotification(
  userId: string,
  title: string,
  message: string,
  type: NotificationType,
  metadata?: any,
) {
  try {
    await addDoc(collection(db, "notifications"), {
      userId,
      title,
      message,
      type,
      metadata: metadata || null,
      isRead: false,
      createdAt: serverTimestamp(),
    });
    // In a real production app, "email" or "both" notification types would trigger
    // a Cloud Function or Firebase Extension (Trigger Email) to send an actual email.
  } catch (error) {
    console.error("Failed to create notification", error);
  }
}
