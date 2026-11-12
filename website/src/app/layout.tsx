import { MENU_ICON_NAMES } from "@/components/menu-icons";
import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Inter, Source_Serif_4, Source_Code_Pro, IBM_Plex_Mono, Newsreader, Geist, Inter_Tight } from "next/font/google";
import "./globals.css";
import "katex/dist/katex.min.css";

/* THE FACES (2026-09-17).
   Two voices from one superfamily, Adobe's Source: Source Serif 4 for every
   sentence, Source Code Pro for all structure (headings, the bar, labels,
   lead-ins, field names, data, code). They were drawn to sit together, so
   the serif and the mono share proportions and colour. Both are variable,
   self-hosted by next/font, with real italics and weights; the serif carries
   its optical-size axis, so 17px text and a 15px caption each get their cut.
   JetBrains Mono and Inter stay only as fallbacks behind them and no longer
   preload. */
const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  variable: "--font-source-serif",
  display: "swap",
  // The fallback behind Plantin (Typekit) since 2026-09-17, so it is no longer preloaded:
  // a browser fetches it only if Plantin is missing.
  preload: false,
});
const sourceCode = Source_Code_Pro({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-source-code",
  display: "swap",
  // next/font's automatic fallback for a non-serif is a resized Arial, which would
  // flash proportional text through code blocks on a first load. Off: the stack in
  // globals.css falls back to the system monospace instead.
  adjustFontFallback: false,
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
  preload: false,
});

/* PREVIEW 2026-09-16: Inter in place of every mono. Loaded beside the
   mono so the swap is one token in
   globals.css (--font-term) either way. */
// Hashes, counts and code (2026-10-18): IBM Plex Mono, engineered and squared, self-hosted like the others.
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

/* Newsreader, the site's face since 2026-11-05 (headings only from 2026-10-21): a variable serif with an optical-size
   axis, self-hosted by next/font like the others. */
const newsreader = Newsreader({
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  variable: "--font-newsreader",
  display: "swap",
});

/* Inter Tight, the fallback behind Acumin Pro for headings and the wordmark: a browser shows it if the kit is missing. */
const interTight = Inter_Tight({
  subsets: ["latin"],
  variable: "--font-inter-tight",
  display: "swap",
});

/* Geist, the site's face for part of 2026-11-05, before Newsreader. Kept declared and not preloaded, so the older
   rules that name it still resolve. */
const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
  display: "swap",
  preload: false,
});

/* Inter, the face for the text, the bar and the buttons, in every weight. */
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

/* The tab strip and the phone's chrome take the page colour, the ivory of the page. Keep it equal to --bg. */
export const viewport: Viewport = { themeColor: "#f0eee6" };

/* The site's one-line description: what BitGraph is to the people who use it, on every page without a line of its own
   and in link previews. */
const SITE_DESCRIPTION =
  "BitGraph gives any file or record its place in line, without uploading it. Anyone can check which came first, offline, in seconds.";

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
  openGraph: {
    title: "BitGraph",
    description: SITE_DESCRIPTION,
    type: "website",
    siteName: "BitGraph",
  },
  twitter: {
    card: "summary",
    title: "BitGraph",
    description: SITE_DESCRIPTION,
  },
  robots: { index: true, follow: true },
};

import { SiteNav } from "@/components/site-nav";
import { SiteFooter } from "@/components/site-footer";
import { ScrollToTop } from "@/components/scroll-to-top";
import { NoOrphans } from "@/components/no-orphans";
import { FigMarkers } from "@/components/figures/fig";
// Page views, counted anonymously by Vercel Web Analytics: no cookies (2026-10-12; the privacy page says so).
import { Analytics } from "@vercel/analytics/next";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the head script below marks <html> data-js before React loads.
    <html lang="en" data-theme="light" suppressHydrationWarning className={`${sourceSerif.variable} ${sourceCode.variable} ${jetbrainsMono.variable} ${inter.variable} ${plexMono.variable} ${newsreader.variable} ${geist.variable} ${interTight.variable}`}>
      <head>
        {/* One mode: the site is light, whatever the system's setting. data-theme="light" on <html> says so to the
            stylesheet; there is no switch. */}
        {/* The site is set in Newsreader, which the site serves itself (next/font above). No outside font kit is loaded. */}
        {/* Google's Material Symbols, only the icons the Menu uses. */}
        <link rel="stylesheet" href={`https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..24,400,0..1,0&icon_names=${MENU_ICON_NAMES}&display=block`} />
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
              "if(n&&n.type==='reload'&&!location.hash){history.scrollRestoration='manual';}}catch(e){}" +
              // Marks that script runs, so the home headline can stay hidden until it types itself.
              "document.documentElement.setAttribute('data-js','');",
          }}
        />
      </head>
      {/* Sticky footer: the column fills the viewport and main takes the
          slack, so on a page shorter than the glass the footer bar sits flush
          at the bottom instead of floating over background. Long pages are
          unaffected: main is already taller than the slack. */}
      <body style={{ fontFamily: "var(--font-sans)", margin: 0, minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
        {/* Figure arrowheads, once per page, before any figure (see FigMarkers in components/figures/fig.tsx). */}
        <FigMarkers />
        <ScrollToTop />
        {/* No one-word last lines in prose (2026-09-17: a lone "it" was being orphaned). */}
        <NoOrphans />
        <SiteNav />
        {/* Main owns the page grey (2026-08-27); body and both bars are
            white, so nothing outside the content can ever paint grey. See
            the body rule in globals.css. */}
        <main style={{ flex: "1 0 auto", background: "var(--bg)" }}>{children}</main>
        <SiteFooter />
        <Analytics />
      </body>
    </html>
  );
}
