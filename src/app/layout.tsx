import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Trading Command Center",
  description: "Production-grade autonomous prediction market trading command center. Discover, research, evaluate, and execute trades with structured probability estimation and deterministic risk management.",
  keywords: ["prediction market", "trading", "risk management", "autonomous trading", "command center"],
  authors: [{ name: "Trading Command Center" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "Trading Command Center",
    description: "Autonomous prediction market trading with deterministic risk management",
    siteName: "Trading Command Center",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Trading Command Center",
    description: "Autonomous prediction market trading with deterministic risk management",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-gray-950 text-white`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
