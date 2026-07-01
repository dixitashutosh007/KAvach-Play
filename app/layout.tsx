import type { Metadata, Viewport } from "next";
import "./globals.css"; // Global styles
import { AuthProvider } from "@/components/AuthProvider";

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
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
