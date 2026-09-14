import type { Metadata } from "next";
import { Fraunces, Inter } from "next/font/google";
import "./globals.css";
import { SiteNav } from "@/components/chrome/SiteNav";
import { SiteFooter } from "@/components/chrome/SiteFooter";
import { PageTransition } from "@/components/chrome/PageTransition";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  style: ["normal", "italic"],
  axes: ["opsz"],
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://p2pglobal.org"),
  title: {
    default: "P2P Global Discipleship Network",
    template: "%s — P2P Global Discipleship Network",
  },
  description:
    "Everyone is learning from someone. Everyone can help someone grow. A global peer-to-peer discipleship network with Jesus at the center.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "P2P Global Discipleship Network",
    description: "Everyone is learning from someone. Everyone can help someone grow.",
    type: "website",
    siteName: "P2P Global Discipleship Network",
  },
  twitter: {
    card: "summary_large_image",
    title: "P2P Global Discipleship Network",
    description: "Everyone is learning from someone. Everyone can help someone grow.",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${inter.variable}`}>
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <PageTransition />
        <SiteNav />
        <main id="main">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
