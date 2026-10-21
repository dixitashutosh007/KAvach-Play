/**
 * Global Configuration & Setup Manager (`components/SettingsTab.tsx`)
 *
 * Central hub for overall application configurations. For Admins, it permits
 * structural changes such as enabling/disabling major layout modules (Studio,
 * Payments, Leaderboard), controlling the theme colors, overriding admin roles,
 * filling the club logo, and populating mock system data (seed data) for fast onboarding.
 */
import { authedFetch } from "@/lib/authed-fetch";
import { useStore } from "@/hooks/useStore";
import {
  Settings,
  Image as ImageIcon,
  Users,
  Upload,
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  Calendar,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { formatDate, normalizeIndianMobile } from "@/lib/utils";
import { LoadingScreen } from "./LoadingScreen";

export function SettingsTab({ store, setPreviewTheme }: { store: ReturnType<typeof useStore>, setPreviewTheme?: (val: string | null) => void }) {
  const { user, hasAdminClaim } = useAuth();

  // Check if current user is admin
  const currentUserRecord = store.appUsers.find((u) => u.id === user?.uid);
  const isAdmin = currentUserRecord?.role === "admin" || hasAdminClaim;

  const [clubName, setClubName] = useState(
    store.appConfig?.clubName || "KAVACH CRICKET CLUB",
  );
  const [logoUrl, setLogoUrl] = useState(store.appConfig?.logoUrl || "");
  const [logoTransparentUrl, setLogoTransparentUrl] = useState(
    store.appConfig?.logoTransparentUrl || "",
  );
  const [themeColor, setThemeColor] = useState(
    store.appConfig?.themeColor || "#dc143c",
  );
  const [globalTheme, setGlobalTheme] = useState(
    store.appConfig?.globalTheme || "",
  );
  const [loadingAnimationTheme, setLoadingAnimationTheme] = useState<
    "radar" | "kinetic" | "minimal" | "staggered" | "breathe"
  >(
    store.appConfig?.loadingAnimationTheme || "radar"
  );
  const [razorpayKeyId, setRazorpayKeyId] = useState(
    store.appConfig?.razorpayKeyId || "",
  );
  const [smtpHost, setSmtpHost] = useState(store.appConfig?.smtpHost || "");
  const [smtpPort, setSmtpPort] = useState(store.appConfig?.smtpPort || "587");
  const [smtpSecure, setSmtpSecure] = useState(
    !!store.appConfig?.smtpSecure,
  );
  const [smtpUser, setSmtpUser] = useState(store.appConfig?.smtpUser || "");
  const [smtpPassword, setSmtpPassword] = useState(
    store.appConfig?.smtpPassword || "",
  );
  const [smtpFrom, setSmtpFrom] = useState(store.appConfig?.smtpFrom || "");

  // WhatsApp state
  const [whatsappProvider, setWhatsappProvider] = useState<"meta" | "none">(
    store.appConfig?.whatsappProvider || "none"
  );
  const [whatsappPhoneNumberId, setWhatsappPhoneNumberId] = useState(
    store.appConfig?.whatsappPhoneNumberId || ""
  );
  const [whatsappAccessToken, setWhatsappAccessToken] = useState(
    store.appConfig?.whatsappAccessToken || ""
  );

  const defaultWhatsappTemplates = {
    studio_expiry_reminder: "studio_expiry_reminder",
    studio_expired_reminder: "studio_expired_reminder",
    studio_expires_today: "studio_expires_today",
    payment_reminder: "payment_reminder_v1",
    club_invite: "club_invite",
  };

  const [whatsappTemplates, setWhatsappTemplates] = useState(
    store.appConfig?.whatsappTemplates || defaultWhatsappTemplates
  );

  const defaultWhatsappTemplateVariables = {
    studio_expiry_reminder: "daysLeft",
    studio_expired_reminder: "daysLeft",
    studio_expires_today: "",
    payment_reminder: "playerName,amount,link",
    club_invite: "clubName,playerName,link",
  };

  const [whatsappTemplateVariables, setWhatsappTemplateVariables] = useState(
    store.appConfig?.whatsappTemplateVariables || defaultWhatsappTemplateVariables
  );

  const [whatsappTemplateLanguages, setWhatsappTemplateLanguages] = useState(
    store.appConfig?.whatsappTemplateLanguages || { club_invite: "en_US" }
  );

  // Preview state
  const [previewLoadingTheme, setPreviewLoadingTheme] = useState<
    "radar" | "kinetic" | "minimal" | "staggered" | "breathe" | null
  >(null);

  // Collapsible sections state
  const [isAppConfigOpen, setIsAppConfigOpen] = useState(true);
  const [isRazorpayOpen, setIsRazorpayOpen] = useState(false);
  const [isNotificationHubOpen, setIsNotificationHubOpen] = useState(false);
  const [isStudioOpen, setIsStudioOpen] = useState(false);
  const [isAppFeaturesOpen, setIsAppFeaturesOpen] = useState(false);
  const [isMatchConfigOpen, setIsMatchConfigOpen] = useState(false);

  // Email template structures
  const defaultTemplates = {
    welcome: {
      subject: "Welcome to {{clubName}}!",
      body: "Hi {{playerName}},\n\nYour player profile at {{clubName}} has been successfully authenticated.\n\nEnjoy the games!\n\nBest regards,\n{{clubName}} Admin Team",
    },
    payment_success: {
      subject: "Receipt: Payment of {{amount}} Received",
      body: "Hi {{playerName}},\n\nWe have received your payment of {{amount}} for: {{duesText}}.\n\nThank you for your timely payment!\n\nBest regards,\n{{clubName}} Admin Team",
    },
  };

  const [emailTemplates, setEmailTemplates] = useState(
    store.appConfig?.emailTemplates || defaultTemplates,
  );

  const [activeTemplateKey, setActiveTemplateKey] = useState<"welcome" | "payment_success">(
    "welcome",
  );

  const [testTo, setTestTo] = useState("");
  const [testPlayerName, setTestPlayerName] = useState("Alex Smith");
  const [testAmount, setTestAmount] = useState("₹350");
  const [testDuesText, setTestDuesText] = useState("Ground Fee (Eden Gardens)");
  const [testLink, setTestLink] = useState("https://kavachplay.com/pay/123");
  const [isSendingTest, setIsSendingTest] = useState(false);

  const [isStudioEnabled, setIsStudioEnabled] = useState(
    store.appConfig?.isStudioEnabled || false,
  );

  const [features, setFeatures] = useState({
    payments: store.appConfig?.features?.payments !== false,
    studio: store.appConfig?.features?.studio !== false,
    leaderboard: store.appConfig?.features?.leaderboard !== false,
    feed: store.appConfig?.features?.feed !== false,
    matches: store.appConfig?.features?.matches !== false,
    isWixEnabled: store.appConfig?.features?.isWixEnabled === true,
    shop: store.appConfig?.features?.shop !== false,
    pna: store.appConfig?.features?.pna !== false,
    badges: store.appConfig?.features?.badges !== false,
    cricketStatsLeaderboard: store.appConfig?.features?.cricketStatsLeaderboard !== false,
  });

  const [matchConfiguration, setMatchConfiguration] = useState({
    directionsHoursBefore: store.appConfig?.matchConfiguration?.directionsHoursBefore ?? 18,
    directionsHoursAfter: store.appConfig?.matchConfiguration?.directionsHoursAfter ?? 2,
    enablePlayerAvailability: store.appConfig?.matchConfiguration?.enablePlayerAvailability ?? false,
  });

  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [transparentUploadProgress, setTransparentUploadProgress] = useState<
    number | null
  >(null);
  const [seedStatus, setSeedStatus] = useState("");

  // Google Calendar sync (public match calendar)
  const [googleCalendarId, setGoogleCalendarId] = useState(
    store.appConfig?.googleCalendarId || "",
  );
  const [calStatus, setCalStatus] = useState<{
    checked: boolean;
    ok: boolean;
    email?: string;
    calendarId?: string;
    error?: string;
  }>({ checked: false, ok: false });
  const [calBusy, setCalBusy] = useState<"" | "test" | "resync">("");
  const [calResyncMsg, setCalResyncMsg] = useState("");

  const checkCalendarStatus = async () => {
    setCalBusy("test");
    setCalResyncMsg("");
    try {
      const res = await authedFetch("/api/calendar/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "status" }),
      });
      const text = await res.text();
      const json = text ? JSON.parse(text) : {};
      setCalStatus({
        checked: true,
        ok: !!json.ok,
        email: json.serviceAccountEmail,
        calendarId: json.calendarId,
        error: json.error || (!text ? "Empty response from server" : undefined),
      });
    } catch (err: any) {
      setCalStatus({ checked: true, ok: false, error: err?.message || String(err) });
    } finally {
      setCalBusy("");
    }
  };

  const resyncCalendar = async () => {
    setCalBusy("resync");
    setCalResyncMsg("");
    try {
      const res = await authedFetch("/api/calendar/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resync" }),
      });
      const text = await res.text();
      if (!text) {
        setCalResyncMsg("Resync timed out — try again or resync in smaller batches.");
        return;
      }
      const json = JSON.parse(text);
      if (json.ok) {
        setCalResyncMsg(
          `Synced ${json.synced} match${json.synced === 1 ? "" : "es"}${json.removed ? `, removed ${json.removed} archived` : ""}.`,
        );
      } else {
        setCalResyncMsg(
          `Synced ${json.synced || 0}, ${json.errors?.length || 0} failed. ${(json.errors || []).slice(0, 3).join(" · ")}`,
        );
      }
    } catch (err: any) {
      setCalResyncMsg(`Resync failed: ${err?.message || String(err)}`);
    } finally {
      setCalBusy("");
    }
  };

  // Re-seed every appConfig-derived local state whenever store.appConfig
  // updates. Without this, useState(store.appConfig?.foo || "default")
  // runs once at mount — if appConfig hasn't hydrated yet, all fields
  // stay at their fallback ("none", "", etc.). Then when the admin
  // clicks Save later, every fallback gets written back into
  // Firestore, clobbering values the admin never touched. This effect
  // ensures the form always mirrors the DB the moment appConfig arrives.
  // Trade-off: if another admin saves in a parallel tab while you're
  // editing here, your unsaved edits are overwritten — but that's the
  // correct last-write-wins semantics for a shared config doc, and it's
  // vastly less painful than the silent data loss the initial-state
  // pattern was causing.
  useEffect(() => {
    const cfg = store.appConfig;
    if (!cfg) return;
    setClubName(cfg.clubName || "KAVACH CRICKET CLUB");
    setLogoUrl(cfg.logoUrl || "");
    setLogoTransparentUrl(cfg.logoTransparentUrl || "");
    setThemeColor(cfg.themeColor || "#dc143c");
    setGlobalTheme(cfg.globalTheme || "");
    setLoadingAnimationTheme(cfg.loadingAnimationTheme || "radar");
    setRazorpayKeyId(cfg.razorpayKeyId || "");
    setSmtpHost(cfg.smtpHost || "");
    setSmtpPort(cfg.smtpPort || "587");
    setSmtpSecure(!!cfg.smtpSecure);
    setSmtpUser(cfg.smtpUser || "");
    setSmtpPassword(cfg.smtpPassword || "");
    setSmtpFrom(cfg.smtpFrom || "");
    setWhatsappProvider(cfg.whatsappProvider || "none");
    setWhatsappPhoneNumberId(cfg.whatsappPhoneNumberId || "");
    setWhatsappAccessToken(cfg.whatsappAccessToken || "");
    setWhatsappTemplates(cfg.whatsappTemplates || defaultWhatsappTemplates);
    setWhatsappTemplateVariables(
      cfg.whatsappTemplateVariables || defaultWhatsappTemplateVariables,
    );
    setWhatsappTemplateLanguages(
      cfg.whatsappTemplateLanguages || { club_invite: "en_US" },
    );
    setEmailTemplates(cfg.emailTemplates || defaultTemplates);
    setIsStudioEnabled(cfg.isStudioEnabled || false);
    setFeatures({
      payments: cfg.features?.payments !== false,
      studio: cfg.features?.studio !== false,
      leaderboard: cfg.features?.leaderboard !== false,
      feed: cfg.features?.feed !== false,
      matches: cfg.features?.matches !== false,
      isWixEnabled: cfg.features?.isWixEnabled === true,
      shop: cfg.features?.shop !== false,
      pna: cfg.features?.pna !== false,
      badges: cfg.features?.badges !== false,
      cricketStatsLeaderboard: cfg.features?.cricketStatsLeaderboard !== false,
    });
    setMatchConfiguration({
      directionsHoursBefore: cfg.matchConfiguration?.directionsHoursBefore ?? 18,
      directionsHoursAfter: cfg.matchConfiguration?.directionsHoursAfter ?? 2,
      enablePlayerAvailability:
        cfg.matchConfiguration?.enablePlayerAvailability ?? false,
    });
    setGoogleCalendarId(cfg.googleCalendarId || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.appConfig]);

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      // 5MB limit
      alert("Image is too large. Please select an image under 5MB.");
      return;
    }

    setUploadProgress(0);
    const reader = new FileReader();

    reader.onerror = () => {
      alert("Failed to read file.");
      setUploadProgress(null);
    };

    reader.onload = (event) => {
      const base64String = event.target?.result as string;

      const img = new window.Image();
      img.onerror = () => {
        alert("Invalid image file selected.");
        setUploadProgress(null);
      };
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const MAX_SIZE = 400; // Small size for logo
        let { width, height } = img;

        if (width > height && width > MAX_SIZE) {
          height *= MAX_SIZE / width;
          width = MAX_SIZE;
        } else if (height > MAX_SIZE) {
          width *= MAX_SIZE / height;
          height = MAX_SIZE;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          try {
            const compressedBase64 = canvas.toDataURL("image/jpeg", 0.7);
            setLogoUrl(compressedBase64);
            setUploadProgress(100);
            setTimeout(() => setUploadProgress(null), 1000);
          } catch (err) {
            console.error("Canvas export error:", err);
            setLogoUrl(base64String); // fallback
            setUploadProgress(null);
          }
        } else {
          setLogoUrl(base64String); // fallback
          setUploadProgress(null);
        }
      };
      img.src = base64String;
    };
    reader.readAsDataURL(file);
    e.target.value = ""; // Reset input so same file can be selected again
  };

  // Upload for the transparent logo. Same size cap as the primary,
  // but the canvas export uses PNG so alpha is preserved (Design cards
  // rely on this — the logo sits directly on coloured backgrounds).
  const handleTransparentLogoUpload = (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      alert("Image is too large. Please select an image under 5MB.");
      return;
    }
    setTransparentUploadProgress(0);
    const reader = new FileReader();
    reader.onerror = () => {
      alert("Failed to read file.");
      setTransparentUploadProgress(null);
    };
    reader.onload = (event) => {
      const base64String = event.target?.result as string;
      const img = new window.Image();
      img.onerror = () => {
        alert("Invalid image file selected.");
        setTransparentUploadProgress(null);
      };
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const MAX_SIZE = 400;
        let { width, height } = img;
        if (width > height && width > MAX_SIZE) {
          height *= MAX_SIZE / width;
          width = MAX_SIZE;
        } else if (height > MAX_SIZE) {
          width *= MAX_SIZE / height;
          height = MAX_SIZE;
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          // Do NOT paint a background — we want the transparent pixels
          // from the source to carry through into the PNG output.
          ctx.clearRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);
          try {
            const png = canvas.toDataURL("image/png");
            setLogoTransparentUrl(png);
            setTransparentUploadProgress(100);
            setTimeout(() => setTransparentUploadProgress(null), 1000);
          } catch (err) {
            console.error("Canvas export error:", err);
            setLogoTransparentUrl(base64String);
            setTransparentUploadProgress(null);
          }
        } else {
          setLogoTransparentUrl(base64String);
          setTransparentUploadProgress(null);
        }
      };
      img.src = base64String;
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const renderTemplatePreview = (subjOrBody: string) => {
    return subjOrBody
      .replace(/{{clubName}}/g, clubName)
      .replace(/{{playerName}}/g, testPlayerName)
      .replace(/{{amount}}/g, testAmount)
      .replace(/{{duesText}}/g, testDuesText)
      .replace(/{{link}}/g, testLink);
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    try {
      // Extract calendar ID from a pasted embed URL or raw ID.
      let calId = googleCalendarId.trim();
      if (calId) {
        try {
          const u = new URL(calId);
          const src = u.searchParams.get("src");
          if (src) calId = src;
        } catch {}
      }

      await store.updateAppConfig({
        clubName,
        logoUrl,
        logoTransparentUrl,
        themeColor,
        globalTheme,
        loadingAnimationTheme,
        razorpayKeyId,
        emailProvider: "smtp",
        smtpHost,
        smtpPort,
        smtpSecure,
        smtpUser,
        smtpFrom,
        emailTemplates,
        whatsappProvider,
        whatsappPhoneNumberId,
        whatsappTemplates,
        whatsappTemplateVariables,
        whatsappTemplateLanguages,
        isStudioEnabled,
        features,
        matchConfiguration,
        googleCalendarId: calId || undefined,
      });
      if (setPreviewTheme) setPreviewTheme(null);
      alert("Settings saved successfully.");
    } catch (err: any) {
      const code = err?.code ? ` [${err.code}]` : "";
      alert(
        `Settings save failed${code}: ${err?.message || String(err)}\n\n` +
          `If this is "Missing or insufficient permissions", the Firestore rules need to be re-deployed.`,
      );
    }
  };

  const handleTestEmail = async () => {
    if (!testTo) {
      alert("Please enter a recipient email address in the Test Email form below.");
      return;
    }
    setIsSendingTest(true);

    const currentTemplate = emailTemplates[activeTemplateKey] || defaultTemplates[activeTemplateKey];
    const finalSubject = renderTemplatePreview(currentTemplate.subject);
    const finalBody = renderTemplatePreview(currentTemplate.body);

    const configPayload = {
      emailProvider: "smtp",
      smtpHost,
      smtpPort,
      smtpSecure,
      smtpUser,
      // smtpPassword read server-side from SMTP_PASSWORD env var
      smtpFrom,
    };

    try {
      const res = await authedFetch("/api/email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: testTo,
          subject: finalSubject,
          text: finalBody,
          config: configPayload,
        }),
      });
      const data = await res.json();
      if (data.success) {
        alert(`Test email ("${activeTemplateKey}") sent successfully! Check ${testTo}.`);
      } else {
        alert("Failed to send test email: " + (data.error || "Unknown error"));
      }
    } catch (err: any) {
      alert("Error: " + err.message);
    } finally {
      setIsSendingTest(false);
    }
  };

  const handleSeedData = async () => {
    if (!isAdmin) return;
    try {
      // Add multiple sample players
      const p1 = await store.addPlayer({
        name: "Alice Sharma",
        mobile: "9876543201",
      });
      const p2 = await store.addPlayer({
        name: "Bob Kumar",
        mobile: "9876543202",
      });
      const p3 = await store.addPlayer({
        name: "Charlie Singh",
        mobile: "9876543203",
      });

      const g1 = await store.addGround({
        name: "Eden Gardens (Turf 1)",
        mapUrl: "https://maps.google.com/?q=Eden+Gardens",
        organiserName: "Eden Admin",
        gpayNumber: "9876543200",
      });

      if (g1) {
        // Find next Saturday
        const d = new Date();
        d.setDate(d.getDate() + (6 - d.getDay()));
        const nextSatStr = d.toISOString().split("T")[0];

        await store.addMatch({
          date: nextSatStr,
          time: "08:00 AM",
          groundId: g1,
          fee: 350,
          format: "T20",
          jerseyColor: "Scarlet Red",
          opponent: "Internal Squad",
          matchType: "Practice",
          maxSquadSize: 15,
        });
      }

      setSeedStatus("Sample data seeded! Check tabs.");
      setTimeout(() => setSeedStatus(""), 3000);
    } catch (err) {
      console.error("Error seeding data:", err);
      setSeedStatus("Error seeding data.");
    }
  };

  const handleRoleChange = async (userId: string, newRole: string) => {
    if (!isAdmin) return;
    // Don't let user demote themselves easily if they are the only admin
    const adminCount = store.appUsers.filter((u) => u.role === "admin").length;
    if (newRole === "player" && userId === user?.uid && adminCount <= 1) {
      alert(
        "You are the only admin. Promote someone else first before demoting yourself.",
      );
      return;
    }
    await store.updateAppUserRole(userId, newRole);
  };

  if (!isAdmin) {
    return (
      <div className="glass p-8 text-center text-white/50 rounded-xl space-y-3">
        <Settings className="w-8 h-8 opacity-50 mx-auto" />
        <h2 className="text-xl font-bold text-white">Access Denied</h2>
        <p className="text-sm">You need admin privileges to view this page.</p>
      </div>
    );
  }

  if (previewLoadingTheme) {
    return (
      <div className="fixed inset-0 z-[100] flex flex-col">
        <LoadingScreen theme={previewLoadingTheme} />
        <button 
          onClick={() => setPreviewLoadingTheme(null)}
          className="absolute top-6 right-6 z-[101] max-w-xs bg-black/80 border border-emerald-500/50 text-white font-medium py-2 px-4 rounded-xl shadow-lg hover:bg-black hover:scale-105 transition-all text-sm"
        >
          Close Preview
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Settings className="w-5 h-5 text-accent" />
        <h2 className="text-xl font-bold tracking-tight text-white">
          Admin Settings
        </h2>
      </div>

      <div className="glass rounded-xl overflow-hidden">
        <button
          type="button"
          onClick={() => setIsAppConfigOpen(!isAppConfigOpen)}
          className="w-full bg-white/5 px-4 py-3 border-b border-glass-border flex items-center justify-between focus:outline-none"
        >
          <span className="font-bold text-[12px] uppercase tracking-widest text-white/80">App Configuration</span>
          {isAppConfigOpen ? <ChevronDown className="w-4 h-4 text-white/50" /> : <ChevronRight className="w-4 h-4 text-white/50" />}
        </button>
        <form onSubmit={handleSaveConfig} className="p-4 space-y-4">
          {isAppConfigOpen && (
            <div className="space-y-4 mb-4">
              <div>
                <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-white/70">
                  Club Name
                </label>
                <input
                  type="text"
                  value={clubName}
                  onChange={(e) => setClubName(e.target.value)}
                  className="w-full rounded-lg border border-glass-border bg-white/5 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
                  placeholder="e.g. KAVACH"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-white/70">
                  Logo URL or Upload
                </label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="flex flex-1 gap-2">
                    <span className="inline-flex items-center px-3 rounded-lg border border-glass-border bg-white/5 text-white/50">
                      <ImageIcon className="w-4 h-4" />
                    </span>
                    <input
                      type="url"
                      value={logoUrl}
                      onChange={(e) => setLogoUrl(e.target.value)}
                      className="flex-1 rounded-lg border border-glass-border bg-white/5 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none min-w-0"
                      placeholder="https://example.com/logo.png"
                    />
                  </div>
                  <label className="shrink-0 flex items-center justify-center gap-2 cursor-pointer bg-white/10 hover:bg-white/20 transition rounded-lg px-4 py-2 text-sm font-bold border border-glass-border">
                    <Upload className="w-4 h-4" />
                    {uploadProgress !== null
                      ? `${Math.round(uploadProgress)}%`
                      : "Upload image"}
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleLogoUpload}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-white/70">
                  Transparent Logo (for Design cards)
                </label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="flex flex-1 gap-2">
                    <span className="inline-flex items-center px-3 rounded-lg border border-glass-border bg-white/5 text-white/50">
                      <ImageIcon className="w-4 h-4" />
                    </span>
                    <input
                      type="url"
                      value={logoTransparentUrl}
                      onChange={(e) => setLogoTransparentUrl(e.target.value)}
                      className="flex-1 rounded-lg border border-glass-border bg-white/5 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none min-w-0"
                      placeholder="URL, or use Upload →"
                    />
                  </div>
                  <label className="shrink-0 flex items-center justify-center gap-2 cursor-pointer bg-white/10 hover:bg-white/20 transition rounded-lg px-4 py-2 text-sm font-bold border border-glass-border">
                    <Upload className="w-4 h-4" />
                    {transparentUploadProgress !== null
                      ? `${Math.round(transparentUploadProgress)}%`
                      : "Upload PNG"}
                    <input
                      type="file"
                      accept="image/png,image/webp,image/svg+xml"
                      onChange={handleTransparentLogoUpload}
                      className="hidden"
                    />
                  </label>
                </div>
                {logoTransparentUrl && (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-white/50">
                      Preview:
                    </span>
                    {/* Swatch shows the logo on both a light and a dark
                        surface so you can confirm the background really
                        is transparent. */}
                    <div className="flex items-center justify-center h-14 w-14 rounded-lg bg-white border border-glass-border">
                      <img
                        src={logoTransparentUrl}
                        alt="logo on light"
                        className="max-h-12 max-w-12 object-contain"
                      />
                    </div>
                    <div className="flex items-center justify-center h-14 w-14 rounded-lg bg-red-800 border border-glass-border">
                      <img
                        src={logoTransparentUrl}
                        alt="logo on dark"
                        className="max-h-12 max-w-12 object-contain"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setLogoTransparentUrl("")}
                      className="ml-auto text-[10px] font-bold uppercase text-red-400 hover:text-red-300"
                    >
                      Clear
                    </button>
                  </div>
                )}
                <p className="mt-1 text-[10px] text-white/40">
                  Upload a PNG with a transparent background (or paste a URL).
                  Used on Design cards where the logo sits directly on a colour or
                  photo — no white square around it. Optional; falls back to the
                  main logo.
                </p>
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-white/70">
                  Global App Theme
                </label>
                <select
                  value={globalTheme}
                  onChange={(e) => {
                    setGlobalTheme(e.target.value);
                    if (setPreviewTheme) setPreviewTheme(e.target.value);
                  }}
                  className="w-full rounded-lg border border-glass-border bg-black/40 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none [&>option]:bg-emerald-950"
                >
                  <option value="">Let Users Choose</option>
                  <option value="emerald">Emerald Pitch</option>
                  <option value="ruby">Crimson Arena</option>
                  <option value="cyber">Teal Cyber-Turf</option>
                  <option value="amber">Golden Glory</option>
                  <option value="royal">Midnight Royal</option>
                  <option value="carbon">Elite Carbon</option>
                  <option value="brown">Classic Brown</option>
                </select>
              </div>
              
              <div>
                <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-white/70">
                  Loading Screen Animation
                </label>
                <div className="flex flex-col gap-2">
                  <select
                    value={loadingAnimationTheme}
                    onChange={(e) => setLoadingAnimationTheme(e.target.value as any)}
                    className="w-full rounded-lg border border-glass-border bg-black/40 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none [&>option]:bg-emerald-950"
                  >
                    <option value="radar">Radar Pulse (Default)</option>
                    <option value="kinetic">Kinetic Typing</option>
                    <option value="minimal">Minimal Spin</option>
                    <option value="staggered">Staggered Drop</option>
                    <option value="breathe">Breathe</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => setPreviewLoadingTheme(loadingAnimationTheme)}
                    className="text-xs bg-accent/20 hover:bg-accent/30 text-accent font-medium py-1 px-3 rounded self-start mt-1"
                  >
                    Preview Animation
                  </button>
                </div>
              </div>
            </div>
          )}
          
          <div className="border-t border-glass-border pt-4 mt-2">
            <button
              type="button"
              onClick={() => setIsRazorpayOpen(!isRazorpayOpen)}
              className="w-full flex items-center justify-between focus:outline-none"
            >
              <h3 className="text-[12px] font-bold uppercase tracking-widest text-accent mb-0">
                Payment Gateway (Razorpay)
              </h3>
              {isRazorpayOpen ? <ChevronDown className="w-4 h-4 text-accent" /> : <ChevronRight className="w-4 h-4 text-accent" />}
            </button>
            {isRazorpayOpen && (
              <div className="space-y-4 mt-3">
                <div>
                  <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-white/70">
                    Key ID
                  </label>
                  <input
                    type="text"
                    value={razorpayKeyId}
                    onChange={(e) => setRazorpayKeyId(e.target.value)}
                    className="w-full rounded-lg border border-glass-border bg-white/5 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none placeholder:text-white/30 font-mono"
                    placeholder="rzp_test_..."
                  />
                </div>
              </div>
            )}
          </div>
          
          <div className="border-t border-glass-border pt-4 mt-2 space-y-4">
            <button
              type="button"
              onClick={() => setIsNotificationHubOpen(!isNotificationHubOpen)}
              className="w-full flex items-center justify-between focus:outline-none"
            >
              <h3 className="text-[12px] font-bold uppercase tracking-widest text-accent flex items-center justify-between mb-0">
                <span>Notification Hub (Email & WhatsApp)</span>
              </h3>
              {isNotificationHubOpen ? <ChevronDown className="w-4 h-4 text-accent" /> : <ChevronRight className="w-4 h-4 text-accent" />}
            </button>

            {isNotificationHubOpen && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-xl bg-white/5 border border-glass-border animate-fade-in mt-3">
                  <div>
                    <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-white/70">
                      SMTP Host Address
                    </label>
                    <input
                      type="text"
                      value={smtpHost}
                      onChange={(e) => setSmtpHost(e.target.value)}
                      className="w-full rounded-lg border border-glass-border bg-black/40 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none placeholder:text-white/30"
                      placeholder="e.g. smtp.gmail.com"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-white/70">
                      SMTP Port
                    </label>
                    <input
                      type="text"
                      value={smtpPort}
                      onChange={(e) => setSmtpPort(e.target.value)}
                      className="w-full rounded-lg border border-glass-border bg-black/40 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none placeholder:text-white/30 font-mono"
                      placeholder="587, 465, or 25"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-white/70">
                      SMTP User / Account
                    </label>
                    <input
                      type="text"
                      value={smtpUser}
                      onChange={(e) => setSmtpUser(e.target.value)}
                      className="w-full rounded-lg border border-glass-border bg-black/40 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none placeholder:text-white/30"
                      placeholder="e.g. club@gmail.com"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-white/70">
                      SMTP Password
                    </label>
                    <div className="w-full rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-200/90 leading-snug">
                      Set the <code className="font-mono text-amber-200">SMTP_PASSWORD</code> environment variable in AWS Amplify Console → Hosting → Environment variables. Never store this in the database.
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-white/70">
                      SMTP Sender Email (From)
                    </label>
                    <input
                      type="text"
                      value={smtpFrom}
                      onChange={(e) => setSmtpFrom(e.target.value)}
                      className="w-full rounded-lg border border-glass-border bg-black/40 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none placeholder:text-white/30"
                      placeholder="e.g. Club Admin <club@gmail.com>"
                    />
                  </div>
                  <div className="flex items-center gap-3 pt-6 pl-1">
                    <input
                      type="checkbox"
                      checked={smtpSecure}
                      onChange={(e) => setSmtpSecure(e.target.checked)}
                      id="checkbox-smtp-secure"
                      className="w-4 h-4 rounded border-glass-border bg-black/40 text-accent focus:ring-accent accent-accent"
                    />
                    <label htmlFor="checkbox-smtp-secure" className="text-[11px] font-bold uppercase tracking-wider text-white/70 cursor-pointer">
                      Use SSL/TLS Secure Port (465)
                    </label>
                  </div>
                </div>

              {/* Email Templates Editor Module */}
              <div className="space-y-4 p-4 rounded-xl bg-white/5 border border-glass-border">
              <h4 className="text-[11px] font-extrabold uppercase tracking-widest text-accent border-b border-white/10 pb-2">
                ✉️ Automated Email Templates Editor
              </h4>

              {/* Template Selectors */}
              <div className="flex flex-wrap gap-1.5 bg-black/20 p-1 rounded-lg">
                {[
                  { key: "welcome", label: "Join verification" },
                  { key: "payment_success", label: "Receipt Confirm" },
                ].map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setActiveTemplateKey(t.key as any)}
                    className={`flex-1 min-w-[100px] py-1.5 px-2 text-[10px] font-bold uppercase tracking-wider rounded-md transition-all ${
                      activeTemplateKey === t.key
                        ? "bg-white/15 text-white border border-white/10"
                        : "text-white/40 hover:text-white/70"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Template Editor Form */}
              <div className="space-y-3 pt-1">
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-white/60">
                    Template Subject Line
                  </label>
                  <input
                    type="text"
                    value={emailTemplates[activeTemplateKey]?.subject || ""}
                    onChange={(e) => {
                      const updatedSubj = e.target.value;
                      setEmailTemplates((prev: any) => ({
                        ...prev,
                        [activeTemplateKey]: {
                          ...prev[activeTemplateKey],
                          subject: updatedSubj,
                        },
                      }));
                    }}
                    className="w-full rounded-lg border border-glass-border bg-black/40 px-3 py-2 text-xs text-white focus:border-accent focus:outline-none"
                    placeholder="Enter email subject line..."
                  />
                </div>

                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-white/60">
                    Template Content (Supports Markdown / Plaintext / Standard Placeholders)
                  </label>
                  <textarea
                    rows={4}
                    value={emailTemplates[activeTemplateKey]?.body || ""}
                    onChange={(e) => {
                      const updatedBody = e.target.value;
                      setEmailTemplates((prev: any) => ({
                        ...prev,
                        [activeTemplateKey]: {
                          ...prev[activeTemplateKey],
                          body: updatedBody,
                        },
                      }));
                    }}
                    className="w-full rounded-lg border border-glass-border bg-black/40 px-3 py-2 text-xs text-white focus:border-accent focus:outline-none font-sans leading-relaxed"
                    placeholder="Dear {{playerName}}..."
                  />
                </div>

                {/* Variable Cheat Sheet */}
                <div className="bg-black/30 p-2.5 rounded-lg border border-glass-border">
                  <div className="text-[9px] uppercase font-bold text-white/40 tracking-wider mb-1">
                    Available Live Placeholders:
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { code: "{{clubName}}", desc: "Club's official name" },
                      { code: "{{playerName}}", desc: "Player recipient's name" },
                      { code: "{{amount}}", desc: "Due fee value" },
                      { code: "{{duesText}}", desc: "Matched fees descriptions" },
                      { code: "{{link}}", desc: "Dynamic checkout portal URL" },
                    ].map((v) => (
                      <span
                        key={v.code}
                        title={v.desc}
                        className="text-[9.5px] font-mono bg-white/5 border border-white/5 text-accent px-1.5 py-0.5 rounded cursor-help"
                      >
                        {v.code}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* WhatsApp Module */}
            <div className="space-y-4 p-4 rounded-xl bg-white/5 border border-glass-border">
              <h4 className="text-[11px] font-extrabold uppercase tracking-widest text-accent border-b border-white/10 pb-2">
                💬 WhatsApp Settings (Meta Graph API)
              </h4>
              <div className="flex items-center gap-3 mt-2">
                <input
                  type="checkbox"
                  checked={whatsappProvider === "meta"}
                  onChange={(e) => setWhatsappProvider(e.target.checked ? "meta" : "none")}
                  className="w-4 h-4 rounded border-glass-border bg-black/40 text-accent focus:ring-accent accent-accent"
                />
                <label className="text-[11px] font-bold uppercase tracking-wider text-white/70">
                  Enable WhatsApp Reminders
                </label>
              </div>
              
              {whatsappProvider === "meta" && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
                  <div>
                    <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-white/70">
                      Phone Number ID
                    </label>
                    <input
                      type="text"
                      value={whatsappPhoneNumberId}
                      onChange={(e) => setWhatsappPhoneNumberId(e.target.value)}
                      className="w-full rounded-lg border border-glass-border bg-black/40 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
                      placeholder="e.g. 123456789012345"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-white/70">
                      Access Token
                    </label>
                    <div className="w-full rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-200/90 leading-snug">
                      Set the <code className="font-mono text-amber-200">WHATSAPP_ACCESS_TOKEN</code> environment variable in AWS Amplify Console → Hosting → Environment variables. Never store this in the database.
                    </div>
                  </div>
                  
                  <div className="sm:col-span-2 pt-2 border-t border-glass-border">
                    <h5 className="text-[10px] font-bold uppercase tracking-wider text-white/50 mb-3">Approved Template Names</h5>
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-white/70">
                      General Expiry Reminder
                    </label>
                    <input
                      type="text"
                      value={whatsappTemplates.studio_expiry_reminder || ""}
                      onChange={(e) => setWhatsappTemplates({...whatsappTemplates, studio_expiry_reminder: e.target.value})}
                      className="w-full rounded-lg border border-glass-border bg-black/40 px-3 py-2 text-xs text-white focus:border-accent focus:outline-none"
                      placeholder="studio_expiry_reminder"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-white/70">
                      Expires Today
                    </label>
                    <input
                      type="text"
                      value={whatsappTemplates.studio_expires_today || ""}
                      onChange={(e) => setWhatsappTemplates({...whatsappTemplates, studio_expires_today: e.target.value})}
                      className="w-full rounded-lg border border-glass-border bg-black/40 px-3 py-2 text-xs text-white focus:border-accent focus:outline-none"
                      placeholder="studio_expires_today"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-white/70">
                      Already Expired
                    </label>
                    <input
                      type="text"
                      value={whatsappTemplates.studio_expired_reminder || ""}
                      onChange={(e) => setWhatsappTemplates({...whatsappTemplates, studio_expired_reminder: e.target.value})}
                      className="w-full rounded-lg border border-glass-border bg-black/40 px-3 py-2 text-xs text-white focus:border-accent focus:outline-none"
                      placeholder="studio_expired_reminder"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-white/70">
                      Payment Reminder
                    </label>
                    <input
                      type="text"
                      value={whatsappTemplates.payment_reminder || ""}
                      onChange={(e) => setWhatsappTemplates({...whatsappTemplates, payment_reminder: e.target.value})}
                      className="w-full rounded-lg border border-glass-border bg-black/40 px-3 py-2 text-xs text-white focus:border-accent focus:outline-none"
                      placeholder="payment_reminder_v1"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-white/70">
                      Club Invite
                    </label>
                    <input
                      type="text"
                      value={whatsappTemplates.club_invite || ""}
                      onChange={(e) => setWhatsappTemplates({...whatsappTemplates, club_invite: e.target.value})}
                      className="w-full rounded-lg border border-glass-border bg-black/40 px-3 py-2 text-xs text-white focus:border-accent focus:outline-none"
                      placeholder="club_invite"
                    />
                  </div>

                  <div className="sm:col-span-2 pt-2 border-t border-glass-border mt-2">
                    <h5 className="text-[10px] font-bold uppercase tracking-wider text-white/50 mb-3">Template Variables Map (Comma separated)</h5>
                    <p className="text-[9px] text-white/40 mb-3">Map exactly to your Meta Template {"{{1}}"}, {"{{2}}"}, etc. Available: playerName, daysLeft, amount, link, clubName, duesText</p>
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-white/70">
                      General Expiry Reminder Variables
                    </label>
                    <input
                      type="text"
                      value={whatsappTemplateVariables?.studio_expiry_reminder || ""}
                      onChange={(e) => setWhatsappTemplateVariables({...whatsappTemplateVariables, studio_expiry_reminder: e.target.value})}
                      className="w-full rounded-lg border border-glass-border bg-black/40 px-3 py-2 text-xs text-white focus:border-accent focus:outline-none"
                      placeholder="e.g. daysLeft"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-white/70">
                      Expires Today Variables
                    </label>
                    <input
                      type="text"
                      value={whatsappTemplateVariables?.studio_expires_today || ""}
                      onChange={(e) => setWhatsappTemplateVariables({...whatsappTemplateVariables, studio_expires_today: e.target.value})}
                      className="w-full rounded-lg border border-glass-border bg-black/40 px-3 py-2 text-xs text-white focus:border-accent focus:outline-none"
                      placeholder="Leave empty if none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-white/70">
                      Already Expired Variables
                    </label>
                    <input
                      type="text"
                      value={whatsappTemplateVariables?.studio_expired_reminder || ""}
                      onChange={(e) => setWhatsappTemplateVariables({...whatsappTemplateVariables, studio_expired_reminder: e.target.value})}
                      className="w-full rounded-lg border border-glass-border bg-black/40 px-3 py-2 text-xs text-white focus:border-accent focus:outline-none"
                      placeholder="e.g. daysLeft"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-white/70">
                      Payment Reminder Variables
                    </label>
                    <input
                      type="text"
                      value={whatsappTemplateVariables?.payment_reminder || ""}
                      onChange={(e) => setWhatsappTemplateVariables({...whatsappTemplateVariables, payment_reminder: e.target.value})}
                      className="w-full rounded-lg border border-glass-border bg-black/40 px-3 py-2 text-xs text-white focus:border-accent focus:outline-none"
                      placeholder="e.g. playerName,amount,link"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-white/70">
                      Club Invite Variables
                    </label>
                    <input
                      type="text"
                      value={whatsappTemplateVariables?.club_invite || ""}
                      onChange={(e) => setWhatsappTemplateVariables({...whatsappTemplateVariables, club_invite: e.target.value})}
                      className="w-full rounded-lg border border-glass-border bg-black/40 px-3 py-2 text-xs text-white focus:border-accent focus:outline-none"
                      placeholder="e.g. clubName,playerName,link"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-white/70">
                      Club Invite Template Language
                    </label>
                    <select
                      value={whatsappTemplateLanguages?.club_invite || "en_US"}
                      onChange={(e) => setWhatsappTemplateLanguages({...whatsappTemplateLanguages, club_invite: e.target.value})}
                      className="w-full rounded-lg border border-glass-border bg-black/40 px-3 py-2 text-xs text-white focus:border-accent focus:outline-none [&>option]:bg-emerald-950"
                    >
                      <option value="en">English (en)</option>
                      <option value="en_US">English US (en_US)</option>
                      <option value="en_GB">English UK (en_GB)</option>
                      <option value="hi">Hindi (hi)</option>
                    </select>
                    <p className="text-[9px] text-white/40 mt-1">Must match the language selected when creating the template on Meta</p>
                  </div>
                </div>
              )}
            </div>

            {/* Test Email Delivery Module */}
            <div className="space-y-3 p-4 rounded-xl bg-white/5 border border-glass-border mb-4">
              <h4 className="text-[11px] font-extrabold uppercase tracking-widest text-accent border-b border-white/10 pb-2">
                📬 Dynamic Live Test Email
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="mb-1 block text-[9.5px] font-bold uppercase tracking-wider text-white/60">
                    Target Recipient Address
                  </label>
                  <input
                    type="email"
                    value={testTo}
                    onChange={(e) => setTestTo(e.target.value)}
                    className="w-full rounded-lg border border-glass-border bg-black/40 px-3 py-1.5 text-xs text-white focus:border-accent focus:outline-none"
                    placeholder="e.g. member@gmail.com"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[9.5px] font-bold uppercase tracking-wider text-white/60">
                    Sample Player Name
                  </label>
                  <input
                    type="text"
                    value={testPlayerName}
                    onChange={(e) => setTestPlayerName(e.target.value)}
                    className="w-full rounded-lg border border-glass-border bg-black/40 px-3 py-1.5 text-xs text-white focus:border-accent focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[9.5px] font-bold uppercase tracking-wider text-white/60">
                    Sample Fee Amount
                  </label>
                  <input
                    type="text"
                    value={testAmount}
                    onChange={(e) => setTestAmount(e.target.value)}
                    className="w-full rounded-lg border border-glass-border bg-black/40 px-3 py-1.5 text-xs text-white focus:border-accent focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[9.5px] font-bold uppercase tracking-wider text-white/60">
                    Sample Dues Descriptor
                  </label>
                  <input
                    type="text"
                    value={testDuesText}
                    onChange={(e) => setTestDuesText(e.target.value)}
                    className="w-full rounded-lg border border-glass-border bg-black/40 px-3 py-1.5 text-xs text-white focus:border-accent focus:outline-none"
                  />
                </div>
              </div>

              {/* Collapsible live email render preview */}
              <div className="p-3 bg-black/50 border border-glass-border rounded-xl space-y-2 mt-2">
                <div className="text-[9px] uppercase font-bold text-white/40 tracking-widest border-b border-white/5 pb-1 flex justify-between items-center">
                  <span>Live Render Preview</span>
                  <span className="text-[10px] text-accent lowercase">Active Template: {activeTemplateKey}</span>
                </div>
                <div className="space-y-1.5 text-xs text-white/90">
                  <div>
                    <span className="text-white/30 font-bold uppercase text-[9px] tracking-wide mr-1.5">Subject:</span>
                    {renderTemplatePreview(emailTemplates[activeTemplateKey]?.subject || defaultTemplates[activeTemplateKey].subject)}
                  </div>
                  <div>
                    <span className="text-white/30 font-bold uppercase text-[9px] tracking-wide block mb-1">Body Content:</span>
                    <pre className="whitespace-pre-wrap bg-black/40 p-2.5 rounded border border-white/5 text-[11px] font-sans text-white/70 leading-relaxed">
                      {renderTemplatePreview(emailTemplates[activeTemplateKey]?.body || defaultTemplates[activeTemplateKey].body)}
                    </pre>
                  </div>
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleTestEmail}
                  disabled={isSendingTest}
                  className="w-full flex items-center justify-center gap-2 rounded-lg bg-accent/20 hover:bg-accent/30 text-accent py-2 text-xs font-bold transition shadow"
                >
                  {isSendingTest ? (
                    <span className="animate-pulse">Delivering test message...</span>
                  ) : (
                    <span>🚀 Launch Test Email ("{activeTemplateKey}")</span>
                  )}
                </button>
              </div>
            </div>
            </>
            )}
          </div>

          <div className="border-t border-glass-border pt-4 mt-2">
            <button
              type="button"
              onClick={() => setIsStudioOpen(!isStudioOpen)}
              className="w-full flex items-center justify-between focus:outline-none"
            >
              <h3 className="text-[12px] font-bold uppercase tracking-widest text-accent mb-0">
                Studio Functionality
              </h3>
              {isStudioOpen ? <ChevronDown className="w-4 h-4 text-accent" /> : <ChevronRight className="w-4 h-4 text-accent" />}
            </button>
            {isStudioOpen && (
              <div className="flex items-center gap-3 mt-3 mb-2">
                <input
                  type="checkbox"
                  checked={isStudioEnabled}
                  onChange={(e) => setIsStudioEnabled(e.target.checked)}
                  className="w-4 h-4 rounded border-glass-border bg-black/40 text-accent focus:ring-accent accent-accent mb-1"
                />
                <label className="text-[11px] font-bold uppercase tracking-wider text-white/70">
                  Enable Studio Membership
                </label>
              </div>
            )}
          </div>
          <div className="border-t border-glass-border pt-4 mt-2 mb-2">
            <button
              type="button"
              onClick={() => setIsMatchConfigOpen(!isMatchConfigOpen)}
              className="w-full flex items-center justify-between focus:outline-none"
            >
              <h3 className="text-[12px] font-bold uppercase tracking-widest text-accent mb-0">
                Match Configuration
              </h3>
              {isMatchConfigOpen ? <ChevronDown className="w-4 h-4 text-accent" /> : <ChevronRight className="w-4 h-4 text-accent" />}
            </button>
            {isMatchConfigOpen && (
              <div className="space-y-4 mt-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-white/50">
                    Get Directions Button - Show Hours Before Match
                  </label>
                  <input
                    type="number"
                    value={matchConfiguration.directionsHoursBefore}
                    onChange={(e) =>
                      setMatchConfiguration((prev) => ({
                        ...prev,
                        directionsHoursBefore: Number(e.target.value),
                      }))
                    }
                    className="w-full bg-black/40 border border-glass-border rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-accent text-white"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-white/50">
                    Get Directions Button - Hide Hours After Match
                  </label>
                  <input
                    type="number"
                    value={matchConfiguration.directionsHoursAfter}
                    onChange={(e) =>
                      setMatchConfiguration((prev) => ({
                        ...prev,
                        directionsHoursAfter: Number(e.target.value),
                      }))
                    }
                    className="w-full bg-black/40 border border-glass-border rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-accent text-white"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={matchConfiguration.enablePlayerAvailability}
                    onChange={(e) =>
                      setMatchConfiguration((prev) => ({
                        ...prev,
                        enablePlayerAvailability: e.target.checked,
                      }))
                    }
                    className="w-4 h-4 rounded border-glass-border bg-black/40 text-accent focus:ring-accent accent-accent mb-1"
                  />
                  <label className="text-[11px] font-bold uppercase tracking-wider text-white/70">
                    Enable Player Availability Selection
                  </label>
                </div>
              </div>
            )}
          </div>
          <div className="border-t border-glass-border pt-4 mt-2 mb-2">
            <button
              type="button"
              data-testid="app-features-section"
              onClick={() => setIsAppFeaturesOpen(!isAppFeaturesOpen)}
              className="w-full flex items-center justify-between focus:outline-none"
            >
              <h3 className="text-[12px] font-bold uppercase tracking-widest text-accent mb-0">
                App Features
              </h3>
              {isAppFeaturesOpen ? <ChevronDown className="w-4 h-4 text-accent" /> : <ChevronRight className="w-4 h-4 text-accent" />}
            </button>
            {isAppFeaturesOpen && (
              <div className="space-y-3 mt-3">
                {[
                  { key: "payments", label: "Payments & Razorpay integration" },
                  { key: "studio", label: "Studio Tab" },
                  { key: "leaderboard", label: "Leaderboard Tab" },
                  { key: "feed", label: "Club Feed Tab" },
                  { key: "matches", label: "Match Fixtures Tab" },
                  { key: "isWixEnabled", label: "Legacy Wix Feature" },
                  { key: "shop", label: "Club Merchandise Shop Menu" },
                  { key: "pna", label: "Player Not Available (PNA) Report" },
                  { key: "badges", label: "Player Badges / Achievements" },
                  { key: "cricketStatsLeaderboard", label: "Show Runs & Wickets on Leaderboard" },
                ].map(({ key, label }) => (
                  <div key={key} className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      data-testid={`feature-toggle-${key}`}
                      checked={(features as any)[key]}
                      onChange={(e) =>
                        setFeatures((prev) => ({
                          ...prev,
                          [key]: e.target.checked,
                        }))
                      }
                      className="w-4 h-4 rounded border-glass-border bg-black/40 text-accent focus:ring-accent accent-accent"
                    />
                    <label className="text-[11px] font-bold uppercase tracking-wider text-white/70">
                      {label}
                    </label>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="pt-2 flex flex-col gap-2">
            <button
              type="submit"
              className="w-full rounded-lg bg-accent py-2.5 text-sm font-bold text-black shadow hover:bg-accent/90 transition"
            >
              Save Configuration
            </button>
            <button
              type="button"
              onClick={handleSeedData}
              className="w-full rounded-lg bg-white/10 border border-glass-border py-2.5 text-sm font-bold text-white shadow hover:bg-white/20 transition"
            >
              Seed Sample Data
            </button>
            {seedStatus && (
              <div className="text-center text-accent text-sm font-bold mt-2">
                {seedStatus}
              </div>
            )}
          </div>
        </form>
      </div>

      {/* Google Calendar — public match schedule sync. Matches auto-push
          on create/edit/delete; this card is for one-time setup + repair. */}
      <div className="glass rounded-xl overflow-hidden mt-6">
        <div className="w-full bg-white/5 px-4 py-3 border-b border-glass-border flex items-center justify-between">
          <span className="font-bold text-[12px] uppercase tracking-widest text-white/80 flex items-center gap-2">
            <Calendar className="w-4 h-4" /> Public Match Calendar
          </span>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-[11px] text-white/50 leading-relaxed">
            Matches sync to a public Google Calendar automatically when you
            create, edit or delete them. Paste your Google Calendar link below
            and save settings. Then share the calendar with the service-account
            email (with <b>&quot;Make changes to events&quot;</b>).
          </p>

          <div>
            <label className="text-[10px] uppercase tracking-widest text-white/40 block mb-1">
              Google Calendar Link / ID
            </label>
            <input
              type="text"
              value={googleCalendarId}
              onChange={(e) => setGoogleCalendarId(e.target.value)}
              placeholder="Paste Google Calendar embed URL or calendar ID"
              className="w-full rounded-lg bg-black/40 border border-glass-border px-3 py-2 text-[11px] text-white font-mono placeholder:text-white/20 focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <p className="text-[9px] text-white/30 mt-1">
              Save settings after pasting. The calendar ID is extracted automatically from the URL.
            </p>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={checkCalendarStatus}
              disabled={calBusy !== ""}
              className="rounded-lg bg-white/10 hover:bg-white/20 px-3 py-2 text-xs font-bold uppercase tracking-wider text-white transition disabled:opacity-50"
            >
              {calBusy === "test" ? "Testing…" : "Test Connection"}
            </button>
            <button
              type="button"
              onClick={resyncCalendar}
              disabled={calBusy !== ""}
              className="rounded-lg bg-accent hover:bg-accent/90 px-3 py-2 text-xs font-black uppercase tracking-wider text-black transition disabled:opacity-60"
            >
              {calBusy === "resync" ? "Resyncing…" : "Resync All Matches"}
            </button>
          </div>

          {calStatus.checked && (
            <div className="space-y-2">
              {calStatus.email && (
                <div className="bg-black/40 border border-glass-border rounded-lg p-2">
                  <div className="text-[9px] uppercase tracking-widest text-white/40 mb-0.5">
                    Share the calendar with this email
                  </div>
                  <div className="text-[11px] font-mono text-white break-all select-all">
                    {calStatus.email}
                  </div>
                </div>
              )}
              <div
                className={`text-[11px] font-bold rounded-lg p-2 ${
                  calStatus.ok
                    ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-300"
                    : "bg-red-500/10 border border-red-500/30 text-red-300"
                }`}
              >
                {calStatus.ok
                  ? "✓ Connected — the app can write to the calendar."
                  : `✗ Not connected. ${calStatus.error || "Share the calendar with the email above (edit rights)."}`}
              </div>
            </div>
          )}

          {calResyncMsg && (
            <div className="text-[11px] text-white/70 bg-black/30 border border-glass-border rounded-lg p-2">
              {calResyncMsg}
            </div>
          )}
        </div>
      </div>

      {/* Privileges Overview — read-only matrix. Toggling happens in
          Squad → tap the player → Edit → Privileges block. This screen
          exists so you can answer "who has Match Admin?" in one glance
          without hunting through the roster. */}
      <div className="glass rounded-xl overflow-hidden mt-6">
        <div className="w-full bg-white/5 px-4 py-3 border-b border-glass-border flex items-center justify-between">
          <span className="font-bold text-[12px] uppercase tracking-widest text-white/80 flex items-center gap-2">
            <Users className="w-4 h-4" /> Privileges Overview
          </span>
          <span className="text-[10px] text-white/40 normal-case tracking-normal">
            edit in Squad → tap player
          </span>
        </div>
        <div className="p-4 space-y-3">
          {(() => {
            // Compute the members list per role. A super admin is
            // considered to hold every downstream role too, since
            // Squad's toggle enforces exactly that when someone is
            // promoted / demoted.
            const roles: {
              label: string;
              desc: string;
              accent: string;
              filter: (u: any) => boolean;
            }[] = [
              {
                label: "Super Admin",
                desc: "Full access to every admin surface",
                accent: "border-accent/50 bg-accent/10 text-accent",
                filter: (u) => u.role === "admin",
              },
              {
                label: "Match Admin",
                desc: "Matches, grounds, tournaments, availability",
                accent: "border-sky-500/40 bg-sky-500/10 text-sky-300",
                filter: (u) => u.role === "admin" || u.isMatchAdmin,
              },
              {
                label: "Studio Admin",
                desc: "Squad + Studio subscriptions",
                accent: "border-violet-500/40 bg-violet-500/10 text-violet-300",
                filter: (u) => u.role === "admin" || u.isStudioAdmin,
              },
              {
                label: "Finance Admin",
                desc: "Club finances + reports",
                accent: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
                filter: (u) => u.role === "admin" || u.isFinanceAdmin,
              },
              {
                label: "Club Admin",
                desc: "Players, Shop, Pulse, Design, Leaderboard, Reminders",
                accent: "border-pink-500/40 bg-pink-500/10 text-pink-300",
                filter: (u) => u.role === "admin" || u.isClubAdmin,
              },
              {
                label: "Designer",
                desc: "Player-level Design tab access",
                accent: "border-purple-500/40 bg-purple-500/10 text-purple-300",
                filter: (u) => u.role === "admin" || u.isDesigner,
              },
            ];
            const nameFor = (u: any) => {
              // appUsers.name is the canonical display name; fall back
              // to the linked player's name if appUser has none yet
              // (fresh sign-ins), then email prefix, then a UID hash.
              if (u.name) return u.name;
              const p = store.players.find(
                (pp) => pp.id === u.id || (pp.mobile && u.mobile && normalizeIndianMobile(pp.mobile) === normalizeIndianMobile(u.mobile)),
              );
              if (p?.name) return p.name;
              if (u.email) return u.email.split("@")[0];
              return `#${(u.id || "").slice(0, 6)}`;
            };
            return roles.map((r) => {
              const members = store.appUsers.filter(r.filter);
              const sorted = [...members].sort((a, b) =>
                nameFor(a).localeCompare(nameFor(b), "en", { sensitivity: "base" }),
              );
              return (
                <div
                  key={r.label}
                  className={`rounded-lg border p-3 ${r.accent.split(" ").slice(0, 2).join(" ")}`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div>
                      <div className={`text-[11px] font-bold uppercase tracking-widest ${r.accent.split(" ")[2]}`}>
                        {r.label}
                      </div>
                      <div className="text-[10px] text-white/50">{r.desc}</div>
                    </div>
                    <div
                      className={`text-lg font-black font-mono ${r.accent.split(" ")[2]}`}
                    >
                      {sorted.length}
                    </div>
                  </div>
                  {sorted.length === 0 ? (
                    <div className="text-[10px] text-white/40 italic">
                      No members
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {sorted.map((u) => (
                        <span
                          key={u.id}
                          className="bg-black/30 border border-white/10 rounded px-2 py-0.5 text-[11px] text-white/80"
                          title={u.mobile || u.email || u.id}
                        >
                          {nameFor(u)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            });
          })()}
        </div>
      </div>
    </div>
  );
}
