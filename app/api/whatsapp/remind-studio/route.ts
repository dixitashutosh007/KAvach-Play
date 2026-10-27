import { NextResponse } from 'next/server';
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import firebaseConfig from "@/firebase-applet-config.json";

export async function POST(req: Request) {
  try {
    // Admin-only: block external / crawler / AI-tool invocations.
    const { requireAdmin } = await import("@/lib/server-auth");
    const guard = await requireAdmin(req);
    if (!guard.ok) return guard.response;

    const { to, daysLeft, playerName } = await req.json();

    const apps = getApps();
    const app = apps.length ? apps[0] : initializeApp({ projectId: firebaseConfig.projectId });
    const dbId = (firebaseConfig as any).firestoreDatabaseId;
    let db;
    try { db = getFirestore(app, dbId); } catch { db = getFirestore(app); }

    const appConfigSnap = await db.collection("appConfig").doc("default").get();
    const appConfig = appConfigSnap.data() || {};

    let whatsappProvider = appConfig.whatsappProvider;
    // Fallback: If they haven't explicitly set "meta" in settings, but they have environment variables configured, 
    // allow it to work to not break existing setups.
    if (whatsappProvider !== "meta" && process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_ACCESS_TOKEN) {
        whatsappProvider = "meta";
    }

    if (whatsappProvider !== "meta") {
        return NextResponse.json({ error: 'WhatsApp reminders are disabled. Enable them in Settings > Notification Hub.' }, { status: 400 });
    }

    const phoneNumberId = appConfig.whatsappPhoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID;
    // Access token is server-side only (env var).
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const whatsappTemplates = appConfig.whatsappTemplates || {};
    const whatsappTemplateVariables = appConfig.whatsappTemplateVariables || {};

    if (!phoneNumberId || !accessToken) {
      return NextResponse.json({ error: 'WhatsApp API credentials are not configured.' }, { status: 500 });
    }

    let formattedTo = to.replace(/\D/g, '');
    if (formattedTo.startsWith('0') && formattedTo.length === 11) {
        formattedTo = '91' + formattedTo.substring(1);
    } else if (formattedTo.length === 10) {
        formattedTo = '91' + formattedTo;
    }

    const apiUrl = `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`;

    const resolveVar = (v: string) => {
      if (v === 'playerName') return playerName || "Player";
      if (v === 'daysLeft') return Math.abs(daysLeft).toString();
      if (v === 'daysSinceExpired') return Math.abs(daysLeft).toString();
      if (v === 'clubName') return appConfig.clubName || "Kavach Play";
      return v;
    };

    const defaultVars: Record<string, string> = {
      studio_expired_reminder: "playerName,daysSinceExpired",
      studio_expires_today: "playerName",
      studio_expiry_reminder: "playerName,daysLeft",
    };

    let templateName = '';
    let scenarioKey = '';

    if (daysLeft < 0) {
      scenarioKey = 'studio_expired_reminder';
      templateName = whatsappTemplates.studio_expired_reminder || 'studio_already_expired';
    } else if (daysLeft === 0) {
      scenarioKey = 'studio_expires_today';
      templateName = whatsappTemplates.studio_expires_today || 'studio_expires_today';
    } else {
      scenarioKey = 'studio_expiry_reminder';
      templateName = whatsappTemplates.studio_expiry_reminder || 'studio_expiring_soon';
    }

    const varsString = whatsappTemplateVariables[scenarioKey] || defaultVars[scenarioKey] || '';
    let params: any[] = [];
    if (varsString.trim().length > 0) {
      params = varsString.split(',').map((v: string) => ({
        type: "text",
        text: resolveVar(v.trim()),
      }));
    }

    const payload = {
      messaging_product: "whatsapp",
      to: formattedTo,
      type: "template",
      template: {
        name: templateName,
        language: {
          code: "en" 
        },
        components: params.length > 0 ? [
          {
            type: "body",
            parameters: params
          }
        ] : []
      }
    };

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
        console.error('WhatsApp API Error:', data);
        return NextResponse.json({ 
            error: data.error?.message || 'Failed to send WhatsApp message',
          details: data.error 
          }, { status: response.status });
    }

    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    console.error('Error sending WhatsApp message:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
