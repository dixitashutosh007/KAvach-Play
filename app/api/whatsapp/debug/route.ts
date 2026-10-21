import { NextResponse } from "next/server";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import firebaseConfig from "@/firebase-applet-config.json";

export async function GET(req: Request) {
  try {
    // Auth relaxed for one-time diagnostics — endpoint only reads config,
    // never mutates. Remove this endpoint after debugging is done.
    const url = new URL(req.url);
    const key = url.searchParams.get("key");
    if (key !== "kavach-debug-2026") {
      return NextResponse.json({ error: "Invalid debug key" }, { status: 403 });
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

    const phoneNumberId =
      appConfig.whatsappPhoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID;
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

    if (!phoneNumberId || !accessToken) {
      return NextResponse.json({ error: "WhatsApp credentials not configured" }, { status: 500 });
    }

    // Step 1: Get WABA ID from phone number
    const phoneRes = await fetch(
      `https://graph.facebook.com/v19.0/${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating,messaging_limit_tier`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const phoneData = await phoneRes.json();

    // Step 2: Get WABA ID
    const wabaRes = await fetch(
      `https://graph.facebook.com/v19.0/${phoneNumberId}/whatsapp_business_account`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const wabaData = await wabaRes.json();
    const wabaId = wabaData?.id;

    // Step 3: Fetch all templates (or specific ones)
    let templates: any = null;
    if (wabaId) {
      const tmplRes = await fetch(
        `https://graph.facebook.com/v19.0/${wabaId}/message_templates?fields=name,status,language,category,components&limit=50`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      templates = await tmplRes.json();
    }

    // Step 4: Find club_invite template specifically
    const templateName = appConfig.whatsappTemplates?.club_invite || "club_invite";
    const clubInviteTemplates = templates?.data?.filter(
      (t: any) => t.name === templateName,
    ) || [];

    // Step 5: Show what we would send
    const whatsappTemplateVariables = appConfig.whatsappTemplateVariables || {};
    const whatsappTemplateLanguages = appConfig.whatsappTemplateLanguages || {};
    const varsString = whatsappTemplateVariables.club_invite || "clubName,playerName,link";
    const langCode = whatsappTemplateLanguages.club_invite || "en_US";
    const clubName = appConfig.clubName || "Kavach Cricket Club";

    const varMap: Record<string, string> = {
      playerName: "TestPlayer",
      clubName,
      link: "https://play.kavachcricket.com",
    };
    const varsArray = varsString.split(",").map((v: string) => v.trim());
    const params = varsArray.map((v: string) => ({ type: "text", text: varMap[v] || v }));

    const wouldSendPayload = {
      messaging_product: "whatsapp",
      to: "91XXXXXXXXXX",
      type: "template",
      template: {
        name: templateName,
        language: { code: langCode },
        components: params.length > 0
          ? [{ type: "body", parameters: params }]
          : [],
      },
    };

    // Also fetch payment_reminder template for comparison
    const paymentTemplateName = appConfig.whatsappTemplates?.payment_reminder || "payment_reminder_v1";
    const paymentTemplates = templates?.data?.filter(
      (t: any) => t.name === paymentTemplateName,
    ) || [];

    return NextResponse.json({
      phoneNumber: {
        id: phoneNumberId,
        displayNumber: phoneData.display_phone_number,
        verifiedName: phoneData.verified_name,
        qualityRating: phoneData.quality_rating,
        messagingTier: phoneData.messaging_limit_tier,
        raw: phoneData,
      },
      wabaId,
      clubInviteTemplate: {
        searchedName: templateName,
        found: clubInviteTemplates.length,
        templates: clubInviteTemplates,
      },
      paymentReminderTemplate: {
        searchedName: paymentTemplateName,
        found: paymentTemplates.length,
        templates: paymentTemplates,
      },
      appWouldSend: {
        configuredLanguage: langCode,
        configuredVariables: varsString,
        resolvedParams: params,
        fullPayload: wouldSendPayload,
      },
      allTemplates: templates?.data?.map((t: any) => ({
        name: t.name,
        status: t.status,
        language: t.language,
        category: t.category,
      })) || [],
    });
  } catch (error: any) {
    console.error("WhatsApp debug error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
