import type { Metadata } from "next";
import Link from "next/link";
import { PrimitiveFigure, SandwichFigure } from "@/components/primitive-figures";

/**
 * Home is the primitive and nothing else (Mike, 2026-10-17: "turn off and strip
 * away everything on the site that isnt just this"). Two pictures: the one
 * atomic action (count 1 the nonce, count 2 the payload) and the sandwich (two
 * BitGraphs bracket everything bound between them).
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

      <div style={{ marginTop: 48 }}>
        <PrimitiveFigure />
      </div>

      <h2 style={{ fontSize: "clamp(24px, 3vw, 34px)", fontWeight: 700, letterSpacing: "-0.01em", margin: "88px 0 0" }}>
        Two BitGraphs make an&nbsp;interval.
      </h2>
      <div style={{ marginTop: 32 }}>
        <SandwichFigure />
      </div>

      <p style={{ marginTop: 72, display: "flex", gap: 28, flexWrap: "wrap", fontSize: 18 }}>
        <Link href="/how-it-works">How it works</Link>
        <Link href="/ledger">Find a BitGraph</Link>
      </p>
    </div>
  );
}
