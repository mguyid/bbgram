import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const display = Space_Grotesk({ subsets: ["latin"], variable: "--font-display", weight: ["500", "600", "700"], display: "swap" });

export const metadata: Metadata = {
  title: "Baby Grand",
  description: "Spin, earn points and join the Baby Grand presale.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // The app has one dark Web3 theme, so it no longer follows Telegram's light/dark setting.
  return (
    <html lang="en" className={`${inter.variable} ${display.variable}`} data-theme="dark" suppressHydrationWarning>
      <head>
        {/* Telegram's SDK must load synchronously (Telegram's own guidance). */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="https://telegram.org/js/telegram-web-app.js" />
      </head>
      <body>{children}</body>
    </html>
  );
}
