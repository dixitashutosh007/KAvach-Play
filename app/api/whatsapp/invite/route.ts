import { NextResponse } from "next/server";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import firebaseConfig from "@/firebase-applet-config.json";

export async function POST(req: Request) {
  try {
    const { requireAdmin } = await import("@/lib/server-auth");
    const guard = await requireAdmin(req);
    if (!guard.ok) return guard.response;

    const { to, playerName } = await req.json();
    if (!to || !playerName) {
      return NextResponse.json(
        { error: "to and playerName are required." },
        { status: 400 },
      );
    }

    const apps = getApps();
    const app = apps.length
      ? apps[0]
      : initializeApp({ projectId: firebaseConfig.projectId });
    const dbId = (firebaseConfig as any).firestoreDatabaseId;
    let db;
    try {
      db = getFirestore(app, dbId);
    } catch {
      db = getFirestore(app);
    }

    const appConfigSnap = await db.collection("appConfig").doc("default").get();
    const appConfig = appConfigSnap.data() || {};

    let whatsappProvider = appConfig.whatsappProvider;
    if (
      whatsappProvider !== "meta" &&
      process.env.WHATSAPP_PHONE_NUMBER_ID &&
      process.env.WHATSAPP_ACCESS_TOKEN
    ) {
      whatsappProvider = "meta";
    }
    if (whatsappProvider !== "meta") {
      return NextResponse.json(
        {
          error:
            "WhatsApp API is not configured. Enable it in Settings > Notification Hub.",
        },
        { status: 400 },
      );
    }

    const phoneNumberId =
      appConfig.whatsappPhoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID;
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const whatsappTemplates = appConfig.whatsappTemplates || {};
    const whatsappTemplateVariables = appConfig.whatsappTemplateVariables || {};
    const whatsappTemplateLanguages = appConfig.whatsappTemplateLanguages || {};

    if (!phoneNumberId || !accessToken) {
      return NextResponse.json(
        { error: "WhatsApp API credentials are not configured." },
        { status: 500 },
      );
    }

    let formattedTo = to.replace(/\D/g, "");
    if (formattedTo.startsWith("0") && formattedTo.length === 11) {
      formattedTo = "91" + formattedTo.substring(1);
    } else if (formattedTo.length === 10) {
      formattedTo = "91" + formattedTo;
    }

    const clubName = appConfig.clubName || "Kavach Cricket Club";
    const templateName = whatsappTemplates.club_invite || "welcome_invite";
    const langCode = whatsappTemplateLanguages.club_invite || "en";
    const varsString =
      whatsappTemplateVariables.club_invite || "clubName,playerName,link";

    const varMap: Record<string, string> = {
      playerName: playerName || "Player",
      clubName,
      link: "https://play.kavachcricket.com",
    };

    let params: { type: string; text: string }[] = [];
    if (varsString.trim().length > 0) {
      const varsArray = varsString.split(",").map((v: string) => v.trim());
      for (const v of varsArray) {
        params.push({ type: "text", text: varMap[v] || v });
      }
    }

    const payload = {
      messaging_product: "whatsapp",
      to: formattedTo,
      type: "template",
      template: {
        name: templateName,
        language: { code: langCode },
        components:
          params.length > 0
            ? [{ type: "body", parameters: params }]
            : [],
      },
    };

    console.log("WhatsApp invite payload:", JSON.stringify(payload, null, 2));

    const apiUrl = `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`;
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    console.log("WhatsApp invite response:", JSON.stringify(data, null, 2));

    if (!response.ok) {
      console.error("WhatsApp invite API error:", data);
      return NextResponse.json(
        {
          error: data.error?.message || "Failed to send WhatsApp invite",
          details: data.error,
        },
        { status: response.status },
      );
    }

    const messageId = data?.messages?.[0]?.id;
    const messageStatus = data?.messages?.[0]?.message_status;

    return NextResponse.json({
      success: true,
      messageId,
      messageStatus,
      sentTo: formattedTo,
      template: templateName,
      language: langCode,
    });
  } catch (error: any) {
    console.error("Error sending WhatsApp invite:", error);
    return NextResponse.json(
      { error: error.message || "Internal Server Error" },
      { status: 500 },
    );
  }
}
