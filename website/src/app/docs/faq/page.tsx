import type { Metadata } from "next";
import Link from "next/link";
import { renderInline } from "@/lib/render-inline";

export const metadata: Metadata = {
  title: "FAQ",
  description: "Short answers to the questions people ask about BitGraph, each pointing at the page that answers it fully.",
};

/**
 * Short answers only. Each entry links to the page that owns the topic, so
 * this page never becomes a second explanation of the protocol.
 */
const faqs: { q: string; a: string; href?: string; label?: string }[] = [
  {
    q: "Does BitGraph upload my file?",
    a: "No. The file is hashed where it is, by your browser, the SDK, the MCP server or your own code, and only its SHA-256 digest reaches the enclave. The new fused file is built on your machine too. That is a property of each client; a client you did not write could send more, so read its source if it matters.",
    href: "/docs/overview#boundary", label: "What crosses the boundary",
  },
  {
    q: "What does a proof establish, exactly?",
    a: "That these exact bytes were committed at this position in one sequence, that the position was allocated before their digest arrived, and that the position was placed after the Ethereum block its slot record names. Not truth, not authorship, not first creation, not an exact time.",
    href: "/docs/what-bitgraph-is-not", label: "Limits",
  },
  {
    q: "Why allocate the position before the digest arrives?",
    a: "Because a position assigned when the digest arrives could be chosen by whoever runs the service. A slot drawn from hardware entropy and signed before any digest is received cannot be manufactured afterwards for bytes already in hand, and cannot be occupied twice. The claim is the enclave's own: it had not received the digest when it signed the slot. It says nothing about what anyone else knew.",
    href: "/docs/overview#transition", label: "One operation, two states",
  },
  {
    q: "Why not just trust a timestamp?",
    a: "A timestamp is written by the same key that signs the record. If that key is compromised or its holder is dishonest, backdating costs nothing and leaves no trace. A value signed by the party a check exists to catch is a claim, not evidence. BitGraph's only time comes from outside: the Ethereum block an anchor names, signed by nobody involved.",
    href: "/docs/overview#time", label: "Where time comes from",
  },
  {
    q: "What is a floor, and is there a ceiling?",
    a: "The floor is the Ethereum block named in the slot record: it was mined before the slot existed, so the position was placed after that block's time. The ceiling is the next anchor in the sequence: a place, not a clock reading. There is no wall-clock upper bound.",
    href: "/docs/overview#time", label: "Where time comes from",
  },
  {
    q: "Is this a blockchain?",
    a: "No. There is no consensus, no token and no global ledger. One enclave constrains one sequence, and `prevB64` is a local hash chain. Ethereum is read, never written: an anchor commits the hash of a block into BitGraph's sequence, and no transaction, wallet or contract is involved.",
    href: "/docs/what-bitgraph-is-not#neighbours", label: "Systems BitGraph is mistaken for",
  },
  {
    q: "What is a fused file?",
    a: "A new file built around the original that carries a 32-byte commitment to the slot record. Its digest is what gets committed, so the new bytes could not have been finished before the slot was allocated. The original is never modified, and the original plus the proof rebuilds the new file byte for byte, so it need not be kept.",
    href: "/docs/overview#fused", label: "Carrying the position inside the bytes",
  },
  {
    q: "Can an AI agent use it?",
    a: "Yes. Both MCP servers let an agent make proofs of files it names, and `bitgraph_open` with no files hands it a position and its commitment before a task starts, so the task's record can carry the commitment and be committed when it finishes. Only digests and slot records travel.",
    href: "/docs/mcp", label: "MCP server",
  },
  {
    q: "Can I verify a proof without an internet connection?",
    a: "Yes. The digest, the Ed25519 signature, the attestation chain to the AWS Nitro root and the slot binding are all checked from the proof and the bytes. The floor is checked offline too when the anchor and its block-header witness travel with the proof, which an export includes.",
    href: "/docs/verification", label: "Verification",
  },
  {
    q: "What happens when the enclave restarts?",
    a: "A new epoch begins: a fresh key, a counter at zero, and the old key destroyed. In production that happens every day at 23:59 UTC. Proofs from a closed epoch remain verifiable forever; nothing can be signed under its key again. Epochs relate to each other through the Ethereum blocks their anchors name.",
    href: "/docs/overview#epochs", label: "Compromise and containment",
  },
  {
    q: "If the enclave were compromised, would my old proofs be worthless?",
    a: "No. A compromise can sign only under the live epoch's key. Earlier epochs were signed by keys that no longer exist. The affected epoch is identified permanently by its identifier and can be quarantined; every other epoch is untouched. A forgery within the live epoch, by code running inside the enclave, is not detectable from the proofs.",
    href: "/docs/trust-model#threats", label: "Trust model",
  },
  {
    q: "Can the same file get two proofs?",
    a: "Yes. Each commit takes a fresh slot and a new position. The digest is the same; the position, the counters and the signature differ. Neither proof outranks the other.",
  },
  {
    q: "Can I record many files at once?",
    a: "Yes. Two or more files made together become one set under one slot: one position, every file a member with its own row and inclusion path. A member cannot be added afterwards, because the committed root was made with the rows it had.",
    href: "/docs/proof-format#fused", label: "Proof format",
  },
  {
    q: "What if someone edits the proof JSON?",
    a: "The signature covers the canonical signed body, so any change to a signed field invalidates it. `metadata`, `timestamps` and `claims` are unsigned and advisory; a verifier must not rely on them.",
    href: "/docs/proof-format", label: "Proof format",
  },
  {
    q: "What is the measurement field?",
    a: "For AWS Nitro it is PCR0, a hash of the enclave image. It identifies the exact code that produced the proof, and the image builds reproducibly, so two builds of the published source give the same value. Verifiers should pin it.",
    href: "/docs/self-host-tee", label: "Self-host a TEE",
  },
  {
    q: "Does the service keep my proof?",
    a: "The service writes each proof to its ledger and indexes it by digest, as a convenience for lookups and proof pages. The proof returned to you is the record; keep it beside the file. A lookup that finds nothing is not evidence that bytes were never recorded.",
    href: "/api-reference", label: "API reference",
  },
  {
    q: "What does it cost, and what is licensed?",
    a: "Verification is free and permissionless: the verifier, the audit tool and the player are MIT. Making proofs inside your own product or systems is licensed by agreement with Argento Computing Inc. Evaluation and ordinary individual use are free.",
    href: "/terms", label: "Terms",
  },
];

export default function FAQPage() {
  return (
    <article className="prose faq">
      <h1>FAQ</h1>
      <p className="lede">Short answers. Each one points at the page that owns the topic.</p>
      {faqs.map((f) => (
        <section key={f.q}>
          <h2>{f.q}</h2>
          <p>{renderInline(f.a)}</p>
          {f.href && <p className="note">More: <Link href={f.href}>{f.label}</Link>.</p>}
        </section>
      ))}
    </article>
  );
}
