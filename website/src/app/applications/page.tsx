import type { Metadata } from "next";

/**
 * Applications (2026-10-27): where the recording step fits in products that already exist, by category. These are
 * integration patterns, not partnerships: no company is named. Watermark discovery and Content Credentials in one tree
 * run on this site today (Check, Make); the others are designs on the same interface.
 */
export const metadata: Metadata = {
  title: "Applications",
  description: "Where BitGraph's order sits under existing products: Content Credentials, finding the original from a copy, trusted capture, asset registries, AI agents, software supply chains and research records.",
};

type Pattern = { id: string; label: string; title: string; today: string; adds: string; binds: string; evidence: string; live?: { href: string; text: string } };

const PATTERNS: Pattern[] = [
  {
    id: "c2pa", label: "Content Credentials", title: "Signed history, plus an attested recording.",
    today: "A C2PA manifest carries signed assertions about an asset: who signed it, what tool made it, the edits.",
    adds: "An independent record that these exact bytes, asset and manifest together, were bound at a counted position, right after a value nobody could predict. The credential's own clock becomes one trust layer on that position, and a public witness another.",
    binds: "The asset's SHA-256 and the manifest store's, as two leaves of one tree, bound as one BitGraph. Nothing in the asset changes, so the manifest's own hashes stay valid.",
    evidence: "A BitGraph proof bound to the asset and its manifest, kept with them or referenced from your system; each leaf checks on its own.",
    live: { href: "/evaluate#e-ai", text: "a ChatGPT image and its OpenAI-signed credential, bound together and verifiable offline" },
  },
  {
    id: "watermark", label: "Finding the original", title: "A copy finds the record. The record proves the bytes.",
    today: "A watermark, or a perceptual search, leads from a copy back to an identity or a database entry: whatever the database says today.",
    adds: "The entry becomes a verifiable recording: the original's exact bytes and a perceptual fingerprint, bound together in the original's BitGraph. A match, by watermark or by looks, says a copy resembles the original; the original's bytes are what prove it.",
    binds: "The original's SHA-256 and a fingerprint record, in one tree. A watermark can carry a pointer to that BitGraph; the fingerprint lets a copy find it with no watermark at all.",
    evidence: "The original's proof, reached from any copy that still looks like it.",
    live: { href: "/make", text: "Make matches a picture to the earliest BitGraph it looks like and names it on the new record, with no watermark at all" },
  },
  {
    id: "capture", label: "Trusted capture", title: "How it was captured, and where it was recorded in order.",
    today: "A controlled capture pipeline produces evidence about how an image or recording was made, on what device.",
    adds: "Order for the capture artifact, with time layers bound to it, none resting on the device's clock or the vendor's database. BitGraph does not see or vouch for the physical event; it fixes where the artifact's bytes stand in a counted sequence.",
    binds: "The capture artifact's SHA-256, or its signed capture record, as soon as it leaves the device.",
    evidence: "A proof bound to the capture evidence; each can be checked without the other's issuer.",
  },
  {
    id: "registry", label: "Asset registries", title: "Registration events anyone can check outside the registry.",
    today: "Assets and their provenance records are registered and looked up inside one ecosystem.",
    adds: "Each registration, or each batch of them, gets a recording that verifies with an open tool and the published enclave measurement, independently of the registry's own servers.",
    binds: "A registration record's SHA-256, or the root of a batch of them.",
    evidence: "Per-registration proofs, or one proof per batch with an inclusion path for each entry.",
  },
  {
    id: "ai", label: "AI agents and audit", title: "What an agent did, bracketed and in order.",
    today: "Agent platforms keep logs of actions, tool calls and outputs, in their own storage.",
    adds: "Two BitGraphs bracket a run: everything bound between them came after the first and before the second, in counted order. Work made from the first one's nonce could not have existed before it.",
    binds: "Each action or log segment's SHA-256, or a log root per step. An MCP server makes this one tool call for any agent.",
    evidence: "A chain of proofs that orders the run and checks offline.",
    live: { href: "/exam", text: "The sealed exam: questions from A's nonce, answers bound as B" },
  },
  {
    id: "supply", label: "Software supply chain", title: "Artifacts recorded at build time.",
    today: "Build systems sign artifacts and publish attestations; transparency logs make those entries public.",
    adds: "An attested recording of the artifact or its bill of materials at a counted position, from hardware whose build is published. Signatures and transparency-log entries bind to it as trust layers rather than being replaced by it.",
    binds: "The artifact's SHA-256, or a release's tree of artifacts as one BitGraph.",
    evidence: "A proof per release, each artifact checkable on its own.",
  },
  {
    id: "records", label: "Research and enterprise records", title: "Large collections, one recording each.",
    today: "Lab notebooks, datasets, contracts and logs are kept in systems their own operators control.",
    adds: "A whole collection, thousands of files at a time, bound as one tree in one BitGraph; any single file proves its inclusion without the others being disclosed.",
    binds: "The root of an RFC 6962 Merkle tree over the files' SHA-256s.",
    evidence: "One proof for the collection and an inclusion path for each file.",
  },
];

export default function ApplicationsPage() {
  return (
    <div className="frame home home-typing prose home-scroll docs-page tools-page sx-page">
      <div className="home-hero"><h1 className="sr-only">Applications.</h1></div>

      <section className="home-section" aria-labelledby="app-h">
        <p className="home-kicker">Applications</p>
        <h2 id="app-h">Different products. One order&nbsp;underneath.</h2>
        <p>
          BitGraph does not replace a provenance product; it sits under one. Whatever your system already produces, an asset, a
          credential, a log entry, a release, its SHA-256 is bound by the enclave and the proof travels with it. These are integration
          patterns on the same interface. Two of them run on this site today.
        </p>
        <p className="sx-fine">Patterns, not partnerships: no company named or implied here uses BitGraph.</p>
      </section>

      {PATTERNS.map((p) => (
        <section key={p.id} id={p.id} className="home-section" aria-labelledby={`app-${p.id}`}>
          <p className="home-kicker">{p.label}</p>
          <h2 id={`app-${p.id}`}>{p.title}</h2>
          <div className="sx-table-wrap">
            <table className="sx-table" style={{ minWidth: 0 }}>
              <tbody>
                <tr><td style={{ width: "22%" }}>Today</td><td>{p.today}</td></tr>
                <tr><td>BitGraph adds</td><td>{p.adds}</td></tr>
                <tr><td>What is bound</td><td>{p.binds}</td></tr>
                <tr><td>What you get back</td><td>{p.evidence}</td></tr>
              </tbody>
            </table>
          </div>
          {p.live && <p className="sx-fine" style={{ marginTop: 14 }}>Running now: <a href={p.live.href}>{p.live.text}</a>.</p>}
        </section>
      ))}

      <section className="home-section" aria-labelledby="app-next">
        <p className="home-kicker">Your product</p>
        <h2 id="app-next">Something else in mind?</h2>
        <p>Anything that can be hashed can be recorded. Tell us what your product produces and where the recording step would sit.</p>
        <div className="sx-cta">
          <a className="bg-action-link is-make" href="/evaluate">Evaluate the technology</a>
          <a className="bg-action-link" href="/licensing#lic-form">Talk with us</a>
        </div>
      </section>
    </div>
  );
}
