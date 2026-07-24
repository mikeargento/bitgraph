import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});
import "./globals.css";
import "katex/dist/katex.min.css";

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "BitGraph | A camera for bits",
    template: "%s | BitGraph",
  },
  description:
    "Live cryptographic proof chain. Create, verify, and explore BitGraph proofs.",
  keywords: [
    "BitGraph", "content provenance", "causal order", "proof of integrity",
    "cryptographic provenance", "tamper-evident", "C2PA", "proof explorer",
  ],
  openGraph: {
    title: "BitGraph | A camera for bits",
    description: "Live cryptographic proof chain. Create, verify, and explore BitGraph proofs.",
    type: "website",
    siteName: "BitGraph",
  },
  twitter: {
    card: "summary_large_image",
    title: "BitGraph | A camera for bits",
    description: "Live cryptographic proof chain. Create, verify, and explore BitGraph proofs.",
  },
  robots: { index: true, follow: true },
};

import { SiteNav } from "@/components/site-nav";
import { ScrollToTop } from "@/components/scroll-to-top";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <head>
        <link rel="stylesheet" href="https://use.typekit.net/svq0oqy.css" />
      </head>
      <body style={{ fontFamily: "acumin-pro, -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif", margin: 0 }}>
        <ScrollToTop />
        <SiteNav />
        <main>{children}</main>
      </body>
    </html>
  );
}
