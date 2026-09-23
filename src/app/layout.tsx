import type { Metadata } from "next";
import { Archivo, JetBrains_Mono } from "next/font/google";
import "./globals.css";

export const metadata: Metadata = {
  title: "66 Media Monitor",
  description: "Media monitoring dashboard for 66EMP coverage.",
};

// Wire-desk identity: a bold condensed sans for headlines (dispatch-headline
// energy) and a monospace for data/timestamps/labels (teletype energy) — the
// two type roles a real wire service actually used, layered over the
// existing Geist body copy rather than replacing it.
const displayFont = Archivo({
  subsets: ["latin"],
  weight: ["800", "900"],
  variable: "--font-display",
});
const monoFont = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["500", "700"],
  variable: "--font-mono",
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${displayFont.variable} ${monoFont.variable}`}>
      <body>{children}</body>
    </html>
  );
}
