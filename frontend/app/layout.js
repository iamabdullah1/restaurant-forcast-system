/**
 * 🏗️ Root Layout — Wraps Every Page
 * ═══════════════════════════════════
 *
 * 🎓 WHAT IS layout.js?
 *    In Next.js App Router, layout.js wraps ALL pages.
 *    It's like the <html> skeleton that never changes —
 *    only the {children} (page content) swaps out.
 *
 *    layout.js renders ONCE, pages render on navigation.
 *    Perfect for: fonts, global styles, metadata, providers.
 */

import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * 🎓 METADATA:
 *    Next.js uses this to set <title>, <meta> tags, etc.
 *    Good for SEO and browser tab display.
 */
export const metadata = {
  title: "ChefBot 🧑‍🍳 — Restaurant Forecast Assistant",
  description:
    "AI-powered restaurant assistant for demand forecasting, inventory management, and profit analysis.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
