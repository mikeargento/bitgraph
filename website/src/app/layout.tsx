import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Inter, Source_Serif_4, Source_Code_Pro } from "next/font/google";
import "./globals.css";
import "katex/dist/katex.min.css";

/* THE FACES (2026-09-17, Mike: "do the fonts exactly how you want. your choice").
   Two voices from one superfamily, Adobe's Source: Source Serif 4 for every
   sentence, Source Code Pro for all structure (headings, the bar, labels,
   lead-ins, field names, data, code). They were drawn to sit together, so
   the serif and the mono share proportions and colour. Both are variable,
   self-hosted by next/font, with real italics and weights; the serif carries
   its optical-size axis, so 17px text and a 15px caption each get their cut.
   JetBrains Mono and Inter stay only as fallbacks behind them and no longer
   preload. Acumin (Typekit) remains for the wordmark and the data views. */
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

/* PREVIEW 2026-09-16 (Mike: "what would inter look like if you replaced every
   mono with inter"). Loaded beside the mono so the swap is one token in
   globals.css (--font-term) either way. */
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
  preload: false,
});

/* The tab strip and the phone's chrome take the page colour (2026-09-16,
   the terminal register). */
export const viewport: Viewport = { themeColor: "#0d1117" };

export const metadata: Metadata = {
  title: {
    // Home's tab title is the home h1 (Mike, 2026-08-19: "fix those"), with no
    // "BitGraph |" prefix: the sentence already names BitGraph, and the
    // template below still brands every other page's tab. It was "BitGraph |
    // A camera for bits" from 2026-07 until the title became the claim.
    default: "BitGraph",
    template: "%s | BitGraph",
  },
  // The overview's own sentence (Mike, 2026-08-19: "update the description
  // too"): the line under the title in a link preview, and what a search
  // result shows. It was "Live cryptographic proof chain. Create, verify, and
  // explore BitGraph proofs." from July, which is the old vocabulary.
  // 2026-09-10: one sentence on every surface, from the overview opener. The
  // previous line ("BitGraph gives your file a position in a public sequence.
  // Nothing else can hold that position, and it cannot be moved later.")
  // predated the opener and local-first.
  description:
    "BitGraph allocates an unused position before it receives a file's SHA-256 fingerprint, then binds the fingerprint to that position and consumes it. The proof is a file you keep. It verifies offline.",
  keywords: [
    "BitGraph", "causal order", "verifiable order", "proof of position",
    "tamper-evident", "AI agent records", "Ethereum anchors",
  ],
  openGraph: {
    title: "BitGraph",
    description: "BitGraph allocates an unused position before it receives a file's SHA-256 fingerprint, then binds the fingerprint to that position and consumes it. The proof is a file you keep. It verifies offline.",
    type: "website",
    siteName: "BitGraph",
  },
  twitter: {
    card: "summary",
    title: "BitGraph",
    description: "BitGraph allocates an unused position before it receives a file's SHA-256 fingerprint, then binds the fingerprint to that position and consumes it. The proof is a file you keep. It verifies offline.",
  },
  robots: { index: true, follow: true },
};

import { SiteNav } from "@/components/site-nav";
import { SiteFooter } from "@/components/site-footer";
import { ScrollToTop } from "@/components/scroll-to-top";
import { NoOrphans } from "@/components/no-orphans";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sourceSerif.variable} ${sourceCode.variable} ${jetbrainsMono.variable} ${inter.variable}`}>
      <head>
        {/* Acumin Pro, the kit the site wore until 2026-09-11 (weights 400, 600,
            700 and italics). PREVIEW 2026-09-16 (Mike: "what about good ol
            acumen"): --font-term in globals.css points at it. */}
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
      {/* Sticky footer: the column fills the viewport and main takes the
          slack, so on a page shorter than the glass the footer bar sits flush
          at the bottom instead of floating over background. Long pages are
          unaffected: main is already taller than the slack. */}
      <body style={{ fontFamily: "var(--font-sans)", margin: 0, minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
        <ScrollToTop />
        {/* No one-word last lines in prose (Mike, 2026-09-17: '"it" gets orphaned'). */}
        <NoOrphans />
        <SiteNav />
        {/* Main owns the page grey (2026-08-27); body and both bars are
            white, so nothing outside the content can ever paint grey. See
            the body rule in globals.css. */}
        <main style={{ flex: "1 0 auto", background: "var(--bg)" }}>{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
