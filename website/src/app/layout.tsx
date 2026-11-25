import type { Metadata, Viewport } from "next";
import { RootProvider } from "fumadocs-ui/provider/next";
import "./site.css";
import { ScrollToTop } from "@/components/scroll-to-top";
import { NoOrphans } from "@/components/no-orphans";
import { FigMarkers } from "@/components/figures/fig";
// Page views, counted anonymously by Vercel Web Analytics: no cookies (the privacy page says so).
import { Analytics } from "@vercel/analytics/next";

/* The site is a documentation site on Fumadocs (2026-11-25): every page in one frame, a sidebar of every page, search,
   and the page. The text is MDX in content/docs; the pages that do work are routes under app/(docs)/(app). */

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

const SITE_DESCRIPTION =
  "BitGraph instantly makes any digital file a one-of-a-kind record. No NFTs, wallets, or blockchain required.";

export const metadata: Metadata = {
  title: {
    // Every tab reads "BitGraph | Page", and Home reads "BitGraph" alone.
    default: "BitGraph",
    template: "BitGraph | %s",
  },
  description: SITE_DESCRIPTION,
  keywords: [
    "BitGraph", "provenance", "file provenance", "record provenance", "which came first", "Content Credentials", "C2PA",
    "hardware enclave", "offline verification",
  ],
  openGraph: { title: "BitGraph", description: SITE_DESCRIPTION, type: "website", siteName: "BitGraph" },
  twitter: { card: "summary", title: "BitGraph", description: SITE_DESCRIPTION },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        {/* Figure arrowheads, once per page, before any figure (see FigMarkers in components/figures/fig.tsx). */}
        <FigMarkers />
        <ScrollToTop />
        {/* No one-word last lines: the last two words of every block of text are kept together. */}
        <NoOrphans />
        {/* Light, dark or the system's choice, from the switch in the sidebar. The page search is /api/docs-search
            (/api/search is the proof lookup). */}
        <RootProvider search={{ options: { api: "/api/docs-search" } }}>{children}</RootProvider>
        <Analytics />
      </body>
    </html>
  );
}
