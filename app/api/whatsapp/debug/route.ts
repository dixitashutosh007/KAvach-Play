import { NextResponse } from "next/server";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import firebaseConfig from "@/firebase-applet-config.json";

function ensureAdminApp() {
  const apps = getApps();
  if (apps.length) return apps[0];
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    return initializeApp({
      credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)),
    });
  }
  return initializeApp({ projectId: firebaseConfig.projectId });
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const key = url.searchParams.get("key");
    if (key !== "kavach-debug-2026") {
      return NextResponse.json({ error: "Invalid debug key" }, { status: 403 });
    }

    const app = ensureAdminApp();
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

    // Step 1: Get phone number details WITH embedded WABA ID
    const phoneRes = await fetch(
      `https://graph.facebook.com/v19.0/${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating,messaging_limit_tier,whatsapp_business_account`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const phoneData = await phoneRes.json();

    // Extract WABA ID from the embedded field
    const wabaIdFromEmbed = phoneData?.whatsapp_business_account?.id;

    // Step 2: Also try the edge endpoint as fallback
    let wabaEdgeData: any = null;
    if (!wabaIdFromEmbed) {
      const wabaRes = await fetch(
        `https://graph.facebook.com/v19.0/${phoneNumberId}/whatsapp_business_account?fields=id,name,currency,timezone_id,message_template_namespace`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      wabaEdgeData = await wabaRes.json();
    }
    const finalWabaId = wabaIdFromEmbed || wabaEdgeData?.id;

    // Step 3: Fetch all templates
    let templates: any = null;
    let templateError: string | null = null;
    if (finalWabaId) {
      const tmplRes = await fetch(
        `https://graph.facebook.com/v19.0/${finalWabaId}/message_templates?fields=name,status,language,category,components,quality_score&limit=100`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      templates = await tmplRes.json();
      if (templates.error) {
        templateError = templates.error.message;
        templates = null;
      }
    }

    // Step 4: Find specific templates
    const templateName = appConfig.whatsappTemplates?.club_invite || "club_invite";
    const clubInviteTemplates = templates?.data?.filter(
      (t: any) => t.name === templateName,
    ) || [];

    const paymentTemplateName = appConfig.whatsappTemplates?.payment_reminder || "payment_reminder_v1";
    const paymentTemplates = templates?.data?.filter(
      (t: any) => t.name === paymentTemplateName,
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

    return NextResponse.json({
      phoneNumber: {
        id: phoneNumberId,
        displayNumber: phoneData.display_phone_number,
        verifiedName: phoneData.verified_name,
        qualityRating: phoneData.quality_rating,
        messagingTier: phoneData.messaging_limit_tier,
      },
      waba: {
        id: finalWabaId || "NOT_FOUND",
        source: wabaIdFromEmbed ? "embedded_in_phone_query" : (wabaEdgeData?.id ? "edge_endpoint" : "NOT_FOUND"),
        embeddedRaw: phoneData?.whatsapp_business_account || null,
        edgeFallbackRaw: wabaEdgeData,
      },
      templateError,
      clubInviteTemplate: {
        searchedName: templateName,
        found: clubInviteTemplates.length,
        templates: clubInviteTemplates,
        diagnosis: clubInviteTemplates.length === 0
          ? "Template not found! Check: (1) exact name on Meta Business Manager, (2) access token needs whatsapp_business_management permission to read templates, (3) template may be under different WABA"
          : clubInviteTemplates.some((t: any) => t.category === "MARKETING")
            ? "WARNING: This is a MARKETING template. Marketing messages are NOT delivered to users who haven't opted in or messaged the business first within 24 hours. This is likely why messages are accepted (200 OK) but never delivered!"
            : clubInviteTemplates.every((t: any) => t.status === "APPROVED")
              ? "Template is APPROVED and UTILITY — should deliver normally"
              : `Template status: ${clubInviteTemplates.map((t: any) => `${t.status} (${t.language})`).join(", ")}`,
      },
      paymentReminderTemplate: {
        searchedName: paymentTemplateName,
        found: paymentTemplates.length,
        templates: paymentTemplates,
      },
      categoryComparison: {
        note: "If club_invite is MARKETING and payment_reminder is UTILITY, that explains why payment works but invite doesn't deliver. MARKETING templates require user opt-in or a 24-hour messaging window.",
        clubInviteCategory: clubInviteTemplates[0]?.category || "not_found",
        paymentReminderCategory: paymentTemplates[0]?.category || "not_found",
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
      totalTemplateCount: templates?.data?.length || 0,
    });
  } catch (error: any) {
    console.error("WhatsApp debug error:", error);
    return NextResponse.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
}
