import { NextResponse } from 'next/server';
import { getServerFirestore } from "@/lib/server-db";

export async function POST(req: Request) {
  try {
    // Admin-only: block external / crawler / AI-tool invocations.
    const { requireRole } = await import("@/lib/server-auth");
    const guard = await requireRole(req, ["financeAdmin", "clubAdmin", "superAdmin"]);
    if (!guard.ok) return guard.response;

    const body = await req.json();
    const isSuperOrClub = guard.roles.has("superAdmin") || guard.roles.has("clubAdmin");
    const isFinanceOnly = !isSuperOrClub && guard.roles.has("financeAdmin");

    const db = getServerFirestore();

    let to = body?.to;
    let name = body?.name;
    let amount = body?.amount;
    let link = body?.link;
    let appConfig: Record<string, any> = {};

    if (isFinanceOnly) {
      if (body?.action !== "due_reminder") {
        return NextResponse.json(
          { error: "Forbidden: Finance Admins may only send due_reminder WhatsApp notifications." },
          { status: 403 },
        );
      }
      const { resolveAuthorizedDueReminder } = await import("@/lib/reminder-server");
      const origin = new URL(req.url).origin;
      const resolved = await resolveAuthorizedDueReminder(db, {
        playerId: body?.playerId,
        channel: "whatsapp",
        origin,
      });
      if (!resolved.ok) {
        return NextResponse.json({ error: resolved.error }, { status: resolved.status });
      }
      to = resolved.mobile!;
      name = resolved.playerName;
      amount = resolved.amount;
      link = resolved.link;
      appConfig = resolved.appConfig;
    } else {
      const appConfigSnap = await db.collection("appConfig").doc("default").get();
      appConfig = appConfigSnap.data() || {};
    }

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
    // Access token is server-side only (env var). Never read from the DB
    // appConfig, which is publicly readable.
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const whatsappTemplates = appConfig.whatsappTemplates || {};
    const whatsappTemplateVariables = appConfig.whatsappTemplateVariables || {};

    if (!phoneNumberId || !accessToken) {
      return NextResponse.json({ error: 'WhatsApp API credentials are not configured.' }, { status: 500 });
    }

    // Clean phone number (remove +, non-digits, ensure it's correct format for WhatsApp API)
    // The WhatsApp Graph API requires the number with country code but no '+' sign
    let formattedTo = to.replace(/\D/g, '');
    
    // Add 91 if it's a 10 digit number (assuming Indian context given the ₹)
    if (formattedTo.startsWith('0') && formattedTo.length === 11) {
        formattedTo = '91' + formattedTo.substring(1);
    } else if (formattedTo.length === 10) {
        formattedTo = '91' + formattedTo;
    }

    const apiUrl = `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`;
    const templateName = whatsappTemplates.payment_reminder || "payment_reminder_v1";
    const varsString = whatsappTemplateVariables.payment_reminder || "playerName,amount,link";

    let params: any[] = [];
    if (varsString.trim().length > 0) {
      const varsArray = varsString.split(',').map((v: string) => v.trim());
      for (const v of varsArray) {
        let textVal = '';
        if (v === 'playerName') textVal = name || "Player";
        else if (v === 'amount') textVal = amount ? amount.toString() : "0";
        else if (v === 'link') textVal = link || "";
        else if (v === 'clubName') textVal = appConfig.clubName || "Kavach Play";
        else textVal = v; 

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
          code: "en" // Change to "en_US" or "en_GB" if required by your template
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
