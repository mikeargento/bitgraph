import type { Metadata } from "next";
import { CameraExplainer } from "@/components/camera-explainer";

// The standalone shareable home of the explainer diagram (also embedded on
// the home page below the camera). A real route, so the site nav and footer
// come from the root layout.
export const metadata: Metadata = {
  title: "BitGraph: A Camera for Bits",
  description: "How a BitGraph is made: the digital frame exists first, and the file exposes it once.",
  openGraph: {
    title: "BitGraph: A Camera for Bits",
    description: "How a BitGraph is made: the digital frame exists first, and the file exposes it once.",
  },
};

export default function CameraPage() {
  return (
    <div style={{ width: "90%", maxWidth: 800, margin: "0 auto", padding: "52px 0 72px" }}>
      {/* The page's axiom in the same hero voice as home's tagline: home
          states the metaphor, this page states the mechanism. It sits
          directly above the tinted stage it describes, so the band needs no
          label of its own. */}
      {/* Identical type and top offset to home's tagline (52px wrap padding,
          same clamp), so clicking "A camera for bits." morphs it in place into
          this line on typical viewports. Home drifts only on very tall windows
          where its hero re-centers. */}
      <h1 style={{
        textAlign: "center", fontSize: "clamp(31px, 7vw, 54px)", fontWeight: 800,
        letterSpacing: "-0.035em", lineHeight: 1.02, color: "#111827",
        margin: "0 0 clamp(28px, 5vw, 44px)",
      }}>
        The frame exists first.
      </h1>
      <CameraExplainer />
      {/* The closing thesis: the claim, then the reason, one sentence per
          line where they fit. */}
      <p style={{
        margin: "clamp(56px, 7vw, 84px) auto 0", maxWidth: 720, textAlign: "center",
        fontSize: 15, fontWeight: 500, lineHeight: 1.6, letterSpacing: "-0.006em", color: "#374151", textWrap: "balance",
      }}>
        <span style={{ display: "block" }}>Anyone can verify, anytime, offline: these exact bits, this frame, this moment.</span>
        <span style={{ display: "block" }}><strong style={{ color: "#111827", fontWeight: 700 }}>Because the frame came first, the record cannot be constructed after the fact.</strong></span>
      </p>
    </div>
  );
}
