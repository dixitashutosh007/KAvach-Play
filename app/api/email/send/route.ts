import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { doc, getDocFromServer } from "firebase/firestore";
import nodemailer from "nodemailer";

export async function POST(req: Request) {
  try {
    const { to, subject, text, html, apiKey, config } = await req.json();

    let activeConfig = config;

    // If no config is passed directly from a workspace setting test,
    // load SMTP & Resend settings securely from database
    if (!activeConfig) {
      try {
        const docRef = doc(db, "appConfig", "default");
        const docSnap = await getDocFromServer(docRef);
        if (docSnap.exists()) {
          activeConfig = docSnap.data();
        }
      } catch (dbErr) {
        console.warn("Could not fetch appConfig from Firestore inside send route:", dbErr);
      }
    }

    // Determine the email provider and settings
    const provider = activeConfig?.emailProvider || "resend";
    const recipients = Array.isArray(to) ? to : [to];

    if (recipients.length === 0 || !recipients[0]) {
      return NextResponse.json({
        success: false,
        error: "No recipients specified."
      }, { status: 400 });
    }

    if (provider === "resend") {
      const activeResendKey = activeConfig?.resendApiKey || apiKey || process.env.RESEND_API_KEY;
      const activeSender = activeConfig?.resendSender || "Kavach Play <onboarding@resend.dev>";

      if (!activeResendKey) {
        return NextResponse.json({
          success: false,
          error: "Resend API Key is not configured. Please provide a key in settings."
        }, { status: 400 });
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
          subject: subject,
          text: text,
          html: html || text.replace(/\n/g, "<br>"),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        return NextResponse.json({
          success: false,
          error: data.message || "Resend API connection failed."
        });
      }

      return NextResponse.json({ success: true, data });
    } else {
      // SMTP provider option
      const smtpHost = activeConfig?.smtpHost;
      const smtpPort = parseInt(activeConfig?.smtpPort || "587", 10);
      const smtpSecure = !!activeConfig?.smtpSecure;
      const smtpUser = activeConfig?.smtpUser;
      const smtpPassword = activeConfig?.smtpPassword;
      const smtpFrom = activeConfig?.smtpFrom || smtpUser;

      if (!smtpHost || !smtpUser || !smtpPassword) {
        return NextResponse.json({
          success: false,
          error: "SMTP details are incomplete in App Configuration. Host, User, and Password are required."
        });
      }

      let effectiveSecure = !!activeConfig?.smtpSecure;
      // Auto-correct secure flag for well-known ports to prevent SSL wrong version number errors
      if (smtpPort === 587) effectiveSecure = false; // Port 587 uses STARTTLS (secure: false)
      if (smtpPort === 465) effectiveSecure = true;  // Port 465 uses Implicit TLS (secure: true)

      const transporter = nodemailer.createTransport({
        host: smtpHost.trim(),
        port: smtpPort,
        secure: effectiveSecure,
        auth: {
          user: smtpUser.trim(),
          pass: smtpPassword.replace(/\s+/g, ''),
        },
      });

      const info = await transporter.sendMail({
        from: smtpFrom,
        to: recipients.join(", "),
        subject: subject,
        text: text,
        html: html || text.replace(/\n/g, "<br>"),
      });

      return NextResponse.json({ success: true, messageId: info.messageId });
    }
  } catch (err: any) {
    console.error("Email Sending Route Error:", err);
    return NextResponse.json({ success: false, error: err.message || "An error occurred while sending the email" });
  }
}
