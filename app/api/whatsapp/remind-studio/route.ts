import { NextResponse } from 'next/server';
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import firebaseConfig from "@/firebase-applet-config.json";

export async function POST(req: Request) {
  try {
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
    const accessToken = appConfig.whatsappAccessToken || process.env.WHATSAPP_ACCESS_TOKEN;
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

    let templateName = '';
    let varsString = '';

    if (daysLeft < 0) {
      templateName = whatsappTemplates.studio_expired_reminder || 'studio_expired_reminder';
      varsString = whatsappTemplateVariables.studio_expired_reminder || 'daysLeft';
    } else if (daysLeft === 0) {
      templateName = whatsappTemplates.studio_expires_today || 'studio_expires_today';
      varsString = whatsappTemplateVariables.studio_expires_today || '';
    } else {
      templateName = whatsappTemplates.studio_expiry_reminder || 'studio_expiry_reminder';
      varsString = whatsappTemplateVariables.studio_expiry_reminder || 'daysLeft';
    }

    let params: any[] = [];
    if (varsString.trim().length > 0) {
      const varsArray = varsString.split(',').map(v => v.trim());
      for (const v of varsArray) {
        let textVal = '';
        if (v === 'playerName') textVal = playerName || "Player";
        else if (v === 'daysLeft') textVal = Math.abs(daysLeft).toString();
        else if (v === 'clubName') textVal = appConfig.clubName || "Kavach Play";
        else textVal = v; // default to just passing the string if unknown

        params.push({ type: "text", text: textVal });
      }
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
