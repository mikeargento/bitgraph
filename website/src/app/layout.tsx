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
    // Home's tab title is the home h1 (Mike, 2026-08-19: "fix those"), with no
    // "BitGraph |" prefix: the sentence already names BitGraph, and the
    // template below still brands every other page's tab. It was "BitGraph |
    // A camera for bits" from 2026-07 until the title became the claim.
    default: "A BitGraph gives bits a place",
    template: "%s | BitGraph",
  },
  description:
    "Live cryptographic proof chain. Create, verify, and explore BitGraph proofs.",
  keywords: [
    "BitGraph", "content provenance", "causal order", "proof of integrity",
    "cryptographic provenance", "tamper-evident", "C2PA", "proof explorer",
  ],
  openGraph: {
    title: "A BitGraph gives bits a place",
    description: "Live cryptographic proof chain. Create, verify, and explore BitGraph proofs.",
    type: "website",
    siteName: "BitGraph",
  },
  twitter: {
    card: "summary_large_image",
    title: "A BitGraph gives bits a place",
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
        {/* Runs during parse, before the browser restores scroll. On a reload
            the browser re-applies your saved offset as the page grows, and our
            pages grow after paint (skeleton, then payload, then a full-size
            photo), so a refresh landed part-way down at whatever height existed
            at that instant. A React effect is too late to stop it — hydration
            has already happened. Only reloads are taken over: a plain load has
            no saved offset to suppress, and flipping restoration to manual
            there would stop the browser recording this entry's offset at all,
            so pressing Back later would land at the top instead of where the
            reader left. Plain loads are held by ScrollToTop's pin instead.
            ScrollToTop hands restoration back once the document settles. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var n=performance.getEntriesByType('navigation')[0];" +
              "if(n&&n.type==='reload'&&!location.hash){history.scrollRestoration='manual';}}catch(e){}",
          }}
        />
      </head>
      <body style={{ fontFamily: "acumin-pro, -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif", margin: 0 }}>
        <ScrollToTop />
        <SiteNav />
        <main>{children}</main>
      </body>
    </html>
  );
}
