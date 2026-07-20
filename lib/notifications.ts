import { db } from "./firebase";
import { collection, addDoc, serverTimestamp, Timestamp } from "firebase/firestore";

export type NotificationType = "email" | "in_app" | "both";

// Notifications expire 90 days after creation. Firestore's native TTL policy
// (configured once in GCP console — see docs/aws-migration-runbook.md) deletes
// any document whose `expiresAt` Timestamp is in the past, at no cost.
const NOTIFICATION_TTL_DAYS = 90;

export async function createNotification(
  userId: string,
  title: string,
  message: string,
  type: NotificationType,
  metadata?: any,
) {
  try {
    const expiresAt = Timestamp.fromMillis(
      Date.now() + NOTIFICATION_TTL_DAYS * 24 * 60 * 60 * 1000,
    );
    await addDoc(collection(db, "notifications"), {
      userId,
      title,
      message,
      type,
      metadata: metadata || null,
      isRead: false,
      createdAt: serverTimestamp(),
      expiresAt,
    });
    // In a real production app, "email" or "both" notification types would trigger
    // a Cloud Function or Firebase Extension (Trigger Email) to send an actual email.
  } catch (error) {
    console.error("Failed to create notification", error);
  }
}
