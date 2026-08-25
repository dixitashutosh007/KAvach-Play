import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "@/components/AuthProvider";
import { ClientOnly } from "@/components/ClientOnly";

export const metadata: Metadata = {
  title: "KAvach Play | Cricket Club Management App",
  description:
    "Mobile-first cricket club management app. Streamline match scheduling, player profiles, membership fee tracking, availability, and team performance with KAvach Play.",
  keywords: [
    "cricket club management",
    "sports administration",
    "team scheduling app",
    "cricket match tracking",
    "player management software",
    "KAvach",
  ],
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <ClientOnly
          fallback={
            <div
              style={{
                minHeight: "100vh",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "#022c22",
              }}
            >
              <div
                style={{
                  width: 48,
                  height: 48,
                  border: "3px solid rgba(52, 211, 153, 0.2)",
                  borderTopColor: "rgb(52, 211, 153)",
                  borderRadius: "50%",
                  animation: "kavach-spin 1s linear infinite",
                }}
              />
              <style>{`@keyframes kavach-spin { to { transform: rotate(360deg); } }`}</style>
            </div>
          }
        >
          <AuthProvider>
            {children}
          </AuthProvider>
        </ClientOnly>
      </body>
    </html>
  );
}
