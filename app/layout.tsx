import type { Metadata, Viewport } from "next";
import { Inter, Poppins } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/components/AuthProvider";
import { ClientOnly } from "@/components/ClientOnly";
import { ToastProvider } from "@/components/ui/Toast";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

const poppins = Poppins({
  weight: ["400", "500", "600", "700", "800"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-poppins",
});

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
    <html lang="en" className={`${inter.variable} ${poppins.variable}`} suppressHydrationWarning>
      <body className={`${inter.className} font-sans`} suppressHydrationWarning>
        <ClientOnly
          fallback={
            <div
              style={{
                minHeight: "100vh",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "#F6F7F9",
              }}
            >
              <div
                style={{
                  width: 48,
                  height: 48,
                  border: "3px solid rgba(213, 31, 67, 0.2)",
                  borderTopColor: "#D51F43",
                  borderRadius: "50%",
                  animation: "kavach-spin 1s linear infinite",
                }}
              />
              <style>{`@keyframes kavach-spin { to { transform: rotate(360deg); } }`}</style>
            </div>
          }
        >
          <AuthProvider>
            <ToastProvider>
              <ConfirmProvider>
                {children}
              </ConfirmProvider>
            </ToastProvider>
          </AuthProvider>
        </ClientOnly>
      </body>
    </html>
  );
}
