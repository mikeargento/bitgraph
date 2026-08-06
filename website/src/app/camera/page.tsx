import type { Metadata } from "next";
import { CameraExplainer } from "@/components/camera-explainer";

// The standalone shareable home of the explainer diagram (also embedded on
// the home page below the camera). A real route, so the site nav and footer
// come from the root layout.
export const metadata: Metadata = {
  title: "A Camera for Bits",
  description: "How a BitGraph is made: the digital frame exists first, and the file exposes it once.",
  openGraph: {
    title: "BitGraph: A Camera for Bits",
    description: "How a BitGraph is made: the digital frame exists first, and the file exposes it once.",
  },
};

export default function CameraPage() {
  return (
    /* The standard page shape, same as home, /roll and /folder: one column,
       40px under the nav, everything on the left rail. The centered hero and
       the home-tagline morph formula are RETIRED with the home hero itself
       (2026-08-06, the utilitarian pass) — this was the last page carrying
       them. */
    <div style={{ width: "90%", maxWidth: 800, margin: "0 auto", padding: "40px 0 80px" }}>
      {/* The page's axiom as its title, at the one size every page title
          uses. Plain text, no link: the logo is the way home. */}
      <h1 style={{
        fontSize: "clamp(26px, 6vw, 32px)", fontWeight: 600,
        letterSpacing: "-0.03em", lineHeight: 1.1, color: "#111827",
        margin: "0 0 4px",
      }}>
        The frame exists first.
      </h1>
      <p style={{ fontSize: 14, lineHeight: 1.6, color: "#4b5563", margin: "0 0 18px" }}>
        An exposure cannot come before its frame.
      </p>
      <CameraExplainer />
      {/* The closing pair: a definition, then the same claim for data. Both
          take a flat "is" so the two lines rhyme structurally; "is like" was
          weighed and refused, a simile hedges the punchline. "digital film"
          was dropped because film's nature is that it is physical, and
          "digital film" idiomatically means a movie shot digitally. Line one
          defines the term, so line two inherits it and needs no qualifier.
          Plain text, no link: the punchline is the page's last word, not a
          door. */}
      <p style={{
        margin: "40px 0 0",
        fontSize: 15, fontWeight: 500, lineHeight: 1.6, letterSpacing: "-0.012em", color: "#374151",
      }}>
        <span style={{ display: "block" }}>Film is the recording medium for light.</span>
        <span style={{ display: "block" }}><strong style={{ color: "#111827", fontWeight: 700 }}>BitGraph is film for data.</strong></span>
      </p>
    </div>
  );
}
