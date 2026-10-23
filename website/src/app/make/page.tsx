import type { Metadata } from "next";
import { DropBox } from "@/components/drop-box";

/**
 * Make or check a BitGraph: the drop box, and one sentence on everything else. The For software section went to Tools,
 * which already carried all of it (2026-10-21).
 * Split off the home page (2026-10-17): everything from the home's Try it section down.
 */

export const metadata: Metadata = {
  title: "Make a BitGraph",
  description:
    "Make a BitGraph: drop a file. It is hashed in your browser; only its SHA-256 is sent.",
};

export default function MakePage() {
  return (
    <div className="frame home home-typing prose home-scroll">
      {/* The drop box in its own darker band, like the home's first section (2026-10-17). */}
      <div className="home-hero hero-band">
        {/* No visible h1: it repeated the nav (2026-10-17). */}
        <h1 className="sr-only">Make a BitGraph.</h1>
        {/* A small eyebrow names the page in place of the h1 (2026-10-17). */}
        <p className="home-kicker">Make a BitGraph</p>
        <div style={{ marginTop: 16 }}>
          <DropBox />
        </div>
      </div>

      <section className="home-section" aria-label="Everything else">
        <p>
          Anyone can put a recent block hash in a file or write a file&rsquo;s hash to a blockchain. Neither requires BitGraph, and
          neither gives the file a position of its own.
        </p>
        <p style={{ marginTop: 16 }}>
          BitGraph does. It binds the file to a fresh, unpredictable value used exactly once, at a unique position in an unbroken
          sequence. That position can never be reused, reassigned, or occupied by anything&nbsp;else.
        </p>
      </section>
    </div>
  );
}
