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
    <div className="camera-wrap" style={{ width: "90%", maxWidth: 800, margin: "0 auto", padding: "52px 0 72px" }}>
      {/* Home's tagline is vertically CENTERED in its hero, so its offset grows
          with viewport height; this mirrors that math so the tagline morphs in
          place into this headline at any window size. The constants encode the
          home hero's height (~720px desktop, ~560px mobile, incl. nav+padding);
          re-tune if the home hero's size changes materially.

          The upper bound matters: Safari's "Full Page" screenshot renders with
          the viewport expanded to the whole document, so an uncapped 50dvh
          resolved to 644px on iPhone and dumped a blank half-screen above the
          headline. The caps sit above every real-device value (mobile tops out
          near 120px at 852px tall, desktop near 220px at a 1212px window), so
          they never fire while browsing, only when a capture inflates dvh. */}
      <style>{`
        /* 318 must match the same constant in the home page's .bitgraph-wrap.
           It moved from 306 when the mobile camera box grew from 230 to 254px;
           the offset is what keeps that box centered, so the two are one number
           in two files. See .bitgraph-camera in globals.css. */
        .camera-wrap { padding-top: clamp(52px, calc(50dvh - 318px), 120px) !important; }
        @media (min-width: 769px) { .camera-wrap { padding-top: clamp(52px, calc(50dvh - 386px), 220px) !important; } }
        .camera-wrap h1 a { color: inherit; text-decoration: none; transition: color .15s ease; }
        .camera-wrap h1 a:hover, .camera-wrap h1 a:focus-visible { color: #0065A4; }
      `}</style>
      {/* The page's axiom in the same hero voice as home's tagline: home
          states the metaphor, this page states the mechanism. It sits
          directly above the tinted stage it describes, so the band needs no
          label of its own. */}
      {/* Identical type and top offset to home's tagline (52px wrap padding,
          same clamp), so clicking "A camera for bits." morphs it in place into
          this line on typical viewports. Home drifts only on very tall windows
          where its hero re-centers. */}
      <h1 style={{
        textAlign: "center", fontSize: "clamp(24px, 9.3vw, 54px)", fontWeight: 800,
        letterSpacing: "-0.035em", lineHeight: 1.02, color: "#111827",
        margin: "0 0 clamp(12px, 2.5vw, 16px)",
      }}>
        <a href="/">The frame exists first.</a>
      </h1>
      {/* Subhead in home's hero-why voice, same type + gap, so the pair
          mirrors home's tagline + "Give your data a place in space and time." */}
      <p style={{
        maxWidth: 600, margin: "0 auto clamp(28px, 5vw, 44px)", textAlign: "center",
        fontSize: "clamp(15px, 3.6vw, 18px)", lineHeight: 1.4, color: "#1f2937",
        fontWeight: 500, letterSpacing: "-0.012em", textWrap: "balance",
      }}>
        An exposure cannot come before its frame.
      </p>
      <CameraExplainer />
      {/* The closing pair: a definition, then the same claim for data. Both
          take a flat "is" so the two lines rhyme structurally; "is like" was
          weighed and refused, a simile hedges the punchline and breaks with
          the home hero ("A camera for bits.", stated, not compared). "digital
          film" was dropped for the same reason it read oddly: film's nature is
          that it is physical, and "digital film" idiomatically means a movie
          shot digitally. Line one defines the term, so line two inherits it
          and needs no qualifier. Plain text, no link: the punchline is the
          page's last word, not a door. */}
      <p style={{
        margin: "clamp(56px, 7vw, 84px) auto 0", maxWidth: 720, textAlign: "center",
        fontSize: "clamp(15px, 3.6vw, 18px)", fontWeight: 500, lineHeight: 1.6, letterSpacing: "-0.012em", color: "#374151", textWrap: "balance",
      }}>
        <span style={{ display: "block" }}>Film is the recording medium for light.</span>
        <span style={{ display: "block" }}><strong style={{ color: "#111827", fontWeight: 700 }}>BitGraph is film for data.</strong></span>
      </p>
    </div>
  );
}
