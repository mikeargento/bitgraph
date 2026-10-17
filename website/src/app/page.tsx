import type { Metadata } from "next";
import Link from "next/link";
import { FlowFigure } from "@/components/primitive-figures";
import { DropBox } from "@/components/drop-box";

/**
 * Home is the primitive and nothing else (Mike, 2026-10-17: "turn off and strip
 * away everything on the site that isnt just this"), then one picture (Mike,
 * same night: "thats a simpler graphic the others are complex"): content, its
 * digest, the enclave's one action, the proof. The two detailed pictures (the
 * payloads, the A/B sandwich) live on /how-it-works.
 *
 * ⚠️ Claim discipline: bound AFTER a moment, never "at" it; the claim is about
 * when the bits were bound, never how old the content is.
 */

export const metadata: Metadata = {
  title: "BitGraph",
  description:
    "Inside a hardware enclave, one atomic action counts twice: a fresh value nobody can see or predict, then your bits. They were bound after that moment and could not have been bound before it.",
};

export default function HomePage() {
  return (
    <div className="frame" style={{ paddingTop: 56, paddingBottom: 88 }}>
      <h1 style={{ fontSize: "clamp(34px, 5.4vw, 60px)", fontWeight: 700, lineHeight: 1.08, letterSpacing: "-0.02em", margin: 0, maxWidth: 900 }}>
        Bound after a moment nobody could&nbsp;predict.
      </h1>
      <p style={{ fontSize: "clamp(18px, 2vw, 22px)", lineHeight: 1.5, color: "var(--dim)", margin: "20px 0 0", maxWidth: 760 }}>
        Inside a hardware enclave, one atomic action counts twice: first a fresh value nobody can see or predict, then your bits.
        They were bound after that moment, and could not have been bound before&nbsp;it.
      </p>

      {/* Mike's own picture (2026-10-17: "why not just use the png i gave you"), at full width on wide screens.
          Its text is about 7 px at phone width, so phones get the same picture drawn in HTML, stacked. */}
      <div style={{ marginTop: 56 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="flow-img" src="/figures/bitgraph-flow.webp" width={2000} height={559}
          alt="Any bits are hashed to a SHA-256 digest. Inside the enclave, one atomic action: step 1 draws an unpredictable nonce, step 2 binds the digest and signs it. The result is a proof anyone can check offline." />
        <div className="flow-html"><FlowFigure /></div>
      </div>

      {/* The maker and the checker (Mike, 2026-10-17: "wheres the dropbox?"). */}
      <h2 id="make" style={{ fontSize: "clamp(24px, 3vw, 34px)", fontWeight: 700, letterSpacing: "-0.01em", margin: "80px 0 20px" }}>
        Make or check a&nbsp;BitGraph
      </h2>
      <DropBox />

      <p style={{ marginTop: 72, display: "flex", gap: 28, flexWrap: "wrap", fontSize: 18 }}>
        <Link href="/how-it-works">How it works</Link>
        <Link href="/ledger">Find a BitGraph</Link>
      </p>
    </div>
  );
}
