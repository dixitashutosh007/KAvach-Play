import { NextResponse } from "next/server.js";
import { authorizeEmailRequest, createSmtpTransport, resolveAndValidateSmtpTarget, validateEmailFields } from "../../../../lib/email-auth.ts";
import { requireRole } from "../../../../lib/server-auth.ts";
import { getServerFirestore } from "../../../../lib/server-db.ts";
import { resolveAuthorizedDueReminder } from "../../../../lib/reminder-server.ts";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    // Only signed-in admins can trigger email sends. Auth guard is evaluated FIRST.
    const guard = await requireRole(req, ["clubAdmin", "financeAdmin", "superAdmin"]);
    if (!guard.ok) return guard.response;

    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ success: false, error: "Malformed JSON payload." }, { status: 400 });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ success: false, error: "Request body must be a JSON object." }, { status: 400 });
    }

    const emailAuth = authorizeEmailRequest(
      {
        superAdmin: guard.roles.has("superAdmin"),
        clubAdmin: guard.roles.has("clubAdmin"),
        financeAdmin: guard.roles.has("financeAdmin"),
      },
      body,
    );
    if (!emailAuth.ok) {
      return NextResponse.json({ success: false, error: emailAuth.error }, { status: emailAuth.status });
    }

    let { to, subject, text, html } = body;
    const isDueReminder = body?.action === "due_reminder";
    let safeHtml = emailAuth.isFinanceDueReminderOnly || isDueReminder ? undefined : html;
    // Security (P1-05): Never accept client-supplied SMTP/email `config` from any caller.
    // Trusted configuration always comes from Firestore `appConfig/default` + server env vars.
    let activeConfig: Record<string, any> | undefined;

    if (emailAuth.isFinanceDueReminderOnly || isDueReminder) {
      const origin = new URL(req.url).origin;
      const resolved = await resolveAuthorizedDueReminder(getServerFirestore(), {
        playerId: body?.playerId,
        channel: "email",
        origin,
      });
      if (!resolved.ok) {
        return NextResponse.json({ success: false, error: resolved.error }, { status: resolved.status });
      }
      to = [resolved.email!];
      subject = resolved.subject!;
      text = resolved.text!;
      safeHtml = undefined;
      activeConfig = resolved.appConfig;
    }

    if (!activeConfig) {
      try {
        const docSnap = await getServerFirestore().collection("appConfig").doc("default").get();
        if (docSnap.exists) {
          activeConfig = docSnap.data() || {};
        }
      } catch (dbErr) {
        console.warn("[email/send] Could not fetch appConfig from Firestore:", dbErr instanceof Error ? dbErr.message : "unknown");
      }
    }

    const validated = validateEmailFields({ to, subject, text, html: safeHtml });
    if (!validated.ok) {
      return NextResponse.json({ success: false, error: validated.error }, { status: validated.status });
    }

    const provider = activeConfig?.emailProvider || "resend";
    const { recipients } = validated;

    if (provider === "resend") {
      const activeResendKey = process.env.RESEND_API_KEY;
      const activeSender =
        typeof activeConfig?.resendSender === "string" && activeConfig.resendSender.trim()
          ? activeConfig.resendSender.trim()
          : "Kavach Play <onboarding@resend.dev>";

      if (!activeResendKey) {
        return NextResponse.json(
          { success: false, error: "Resend API Key is not configured." },
          { status: 500 },
        );
      }

      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${activeResendKey}`,
        },
        body: JSON.stringify({
          from: activeSender,
          to: recipients,
          subject: validated.subject,
          text: validated.text,
          html: validated.html || validated.text.replace(/\n/g, "<br>"),
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return NextResponse.json(
          { success: false, error: "Email delivery failed via Resend." },
          { status: 502 },
        );
      }

      return NextResponse.json({ success: true, data });
    } else {
      // Trusted server-side SMTP configuration only (appConfig/default + env vars).
      const smtpHost = typeof activeConfig?.smtpHost === "string" && activeConfig.smtpHost.trim()
        ? activeConfig.smtpHost.trim()
        : (process.env.SMTP_HOST || "").trim();
      const smtpPort = parseInt(String(activeConfig?.smtpPort || process.env.SMTP_PORT || "587"), 10);
      const smtpUser = typeof activeConfig?.smtpUser === "string" && activeConfig.smtpUser.trim()
        ? activeConfig.smtpUser.trim()
        : (process.env.SMTP_USER || "").trim();
      const smtpPassword = process.env.SMTP_PASSWORD;
      const smtpFrom = (typeof activeConfig?.smtpFrom === "string" && activeConfig.smtpFrom.trim()
        ? activeConfig.smtpFrom.trim()
        : smtpUser);

      if (!smtpHost || !smtpUser || !smtpPassword || !Number.isFinite(smtpPort) || smtpPort < 1 || smtpPort > 65535) {
        return NextResponse.json(
          { success: false, error: "SMTP configuration is incomplete or not configured." },
          { status: 500 },
        );
      }

      const resolvedTarget = await resolveAndValidateSmtpTarget(smtpHost);
      if (!resolvedTarget.ok) {
        return NextResponse.json(
          { success: false, error: resolvedTarget.error },
          { status: resolvedTarget.status },
        );
      }

      let effectiveSecure = !!activeConfig?.smtpSecure;
      if (smtpPort === 587) effectiveSecure = false;
      if (smtpPort === 465) effectiveSecure = true;

      // Connect directly to the validated IP (resolvedTarget.ip) while preserving
      // TLS SNI/certificate verification against the original hostname (resolvedTarget.servername).
      // This eliminates DNS rebinding / TOCTOU between validation and socket connection.
      const transporter = createSmtpTransport({
        host: resolvedTarget.ip,
        port: smtpPort,
        secure: effectiveSecure,
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000,
        tls: {
          servername: resolvedTarget.servername,
        },
        auth: {
          user: smtpUser,
          pass: smtpPassword.replace(/\s+/g, ""),
        },
      });

      const info = await transporter.sendMail({
        from: smtpFrom,
        to: recipients.join(", "),
        subject: validated.subject,
        text: validated.text,
        html: validated.html || validated.text.replace(/\n/g, "<br>"),
      });

      return NextResponse.json({ success: true, messageId: info.messageId });
    }
  } catch (err: any) {
    console.error("[email/send] Delivery failed:", err instanceof Error ? err.name : "Error");
    return NextResponse.json(
      { success: false, error: "An error occurred while sending the email." },
      { status: 500 },
    );
  }
}
