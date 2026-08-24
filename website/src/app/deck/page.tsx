import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { absolute: "BitGraph" },
  robots: { index: false, follow: false },
};

/* ── /deck: the pitch deck, reduced to its function: a door into the site.
   The sentence, Start here, a name. Everything else the deck used to say
   lives where it belongs: the product proves itself on the other side of
   the link, and the ask travels in the message that sends it.

   A real page of the app on purpose (Mike, 2026-08-24: "easiest fix would
   be to match site style"): it shares globals.css and the bg-arrow-link
   idiom, so it cannot drift from the site by construction. It replaced a
   standalone public/deck.html whose hand-copied styles were always one
   glyph off. UNLINKED and noindexed, per the standing rule: reachable by
   URL for the people it is for, never linked from any page on the site;
   SiteNav returns null here (the door has no chrome). ── */

export default function DeckPage() {
  return (
    <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
      <main
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          padding: 24,
        }}
      >
        <h1
          style={{
            // Home's one-line rule: a 22px floor on the 6vw slope holds the
            // sentence on a single line down to 360px phones.
            fontSize: "clamp(22px, 6vw, 64px)",
            fontWeight: 800,
            letterSpacing: "-0.015em",
            lineHeight: 1.12,
            color: "#111827",
            margin: 0,
          }}
        >
          A BitGraph gives bits <span style={{ color: "#0065A4" }}>a place</span>
        </h1>
        <a
          className="bg-arrow-link"
          href="/"
          style={{
            marginTop: 42,
            fontSize: 19,
            fontWeight: 600,
            letterSpacing: "-0.01em",
            color: "#0065A4",
            textDecoration: "none",
          }}
        >
          Start here <span className="arrow" aria-hidden="true">&rarr;</span>
        </a>
      </main>
      <footer
        style={{
          padding: "20px 24px 26px",
          textAlign: "center",
          fontSize: 13,
          color: "#6b7280",
        }}
      >
        Mike Argento &middot; Buffalo, NY &middot; 2026
      </footer>
    </div>
  );
}
