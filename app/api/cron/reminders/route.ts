import { NextRequest, NextResponse } from "next/server";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import firebaseConfig from "@/firebase-applet-config.json";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const apps = getApps();
    const app = apps.length ? apps[0] : initializeApp({ projectId: firebaseConfig.projectId });
    const dbId = process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID || (firebaseConfig as any).firestoreDatabaseId;
    let db;
    try { db = getFirestore(app, dbId); } catch { db = getFirestore(app); }

    const appConfigSnap = await db.collection("appConfig").doc("default").get();
    const appConfig = appConfigSnap.data() || {};
    const automaticReminders = appConfig.automaticReminders || [];

    if (!automaticReminders.length) {
      return NextResponse.json({ message: "No automatic reminders configured." });
    }

    const now = new Date();
    // Use IST timezone as this seems to be an Indian app (₹ currency used)
    const options = { timeZone: 'Asia/Kolkata' };
    const localeStr = now.toLocaleString('en-US', options);
    const dateInIST = new Date(localeStr);
    
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const currentDayName = dayNames[dateInIST.getDay()];
    
    const currentHour = dateInIST.getHours().toString().padStart(2, '0');
    const currentMinute = dateInIST.getMinutes().toString().padStart(2, '0');
    const currentTimeStr = `${currentHour}:${currentMinute}`;
    
    let triggers = [];

    for (const schedule of automaticReminders) {
      // Check if today matches
      if (schedule.days && schedule.days.includes(currentDayName)) {
        // Check if time matches (we allow a 15-minute window if this is run via an hourly/periodic cron, but let's assume it runs exactly or we just check if it's within the current hour for a basic implementation. Better yet, let's just trigger if the hour matches to ensure it runs once that hour)
        const [schedHour, schedMin] = (schedule.time || "09:00").split(":");
        
        // Let's assume the cron runs hourly at minute 0. 
        // We will trigger if the current hour matches the scheduled hour.
        if (schedHour === currentHour) {
           triggers.push(schedule);
        }
      }
    }

    if (triggers.length === 0) {
      return NextResponse.json({ message: `No schedules match the current time (Day: ${currentDayName}, Time: ${currentTimeStr} IST).` });
    }

    const origin = req.nextUrl.origin;
    // Just reuse the existing endpoints to do the heavy lifting
    const results = [];
    
    for (const schedule of triggers) {
      const types = schedule.feeTypes || [];
      if (types.includes("matches")) {
        const res = await fetch(`${origin}/api/reminders/match-fee?secret=${process.env.REPORT_API_SECRET || process.env.API_SECRET || ""}`);
        results.push({ type: "matches", status: res.status });
      }
      if (types.includes("others")) {
        const res = await fetch(`${origin}/api/reminders/other-fee?secret=${process.env.REPORT_API_SECRET || process.env.API_SECRET || ""}`);
        results.push({ type: "others", status: res.status });
      }
      if (types.includes("no-shows")) {
        const res = await fetch(`${origin}/api/reminders/no-show-fee?secret=${process.env.REPORT_API_SECRET || process.env.API_SECRET || ""}`);
        results.push({ type: "no-shows", status: res.status });
      }
    }

    return NextResponse.json({ 
      message: `Triggered ${triggers.length} schedules`,
      results
    });

  } catch (err: any) {
    console.error("Cron Reminder Error", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
