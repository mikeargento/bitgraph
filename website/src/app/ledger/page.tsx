import type { Metadata } from "next";
import { LedgerLookup } from "@/components/ledger-lookup";

/**
 * The ledger (Mike, 2026-10-17): every BitGraph is kept, and anyone can fetch a
 * proof whenever they want, by its hash. Private because the hash is the
 * lookup: nothing here lists records (the 2026-10-09 ruling against a browsable
 * ledger stands). Every proof is written to a compliance-locked store when it is
 * made; the same lookup is GET /api/proofs/<digest>.
 */

export const metadata: Metadata = {
  title: "Ledger",
  description: "Every BitGraph is kept. Find one by its hash: paste a SHA-256 or choose a file, hashed in your browser.",
};

export default function LedgerPage() {
  return (
    <div className="frame" style={{ paddingTop: 56, paddingBottom: 96 }}>
      <h1 style={{ fontSize: "clamp(32px, 4.6vw, 52px)", fontWeight: 700, lineHeight: 1.1, letterSpacing: "-0.02em", margin: 0 }}>Ledger</h1>
      <p style={{ fontSize: "clamp(17px, 1.9vw, 20px)", lineHeight: 1.55, margin: "18px 0 36px", maxWidth: 720 }}>
        Every BitGraph is kept, and its proof can be fetched whenever you want. The hash is the lookup, so the ledger is private:
        nothing here lists records, and a BitGraph is found only by someone who holds its bits or their&nbsp;SHA-256.
      </p>
      <LedgerLookup />
      <p style={{ marginTop: 40, fontSize: 15, maxWidth: 720 }}>
        The same lookup, for software: <code>GET https://bitgraph.ing/api/proofs/&lt;sha-256, base64url&gt;</code>
      </p>
    </div>
  );
}
