import type { Metadata } from "next";
import { renderInline } from "@/lib/render-inline";

export const metadata: Metadata = {
  title: "FAQ",
  description: "Frequently asked questions about the BitGraph Protocol.",
};

const faqs = [
  {
    q: "Does BitGraph upload my file?",
    a: "No. Your file is hashed locally in your browser or application. Only the SHA-256 digest (32 bytes) is sent to the enclave. The actual file bytes never leave your machine.",
  },
  {
    q: "Can I verify a proof without an internet connection?",
    a: "Yes. Core verification (digest match + Ed25519 signature) is fully offline. You need the original bytes, the proof JSON, and a verifier implementation. No API calls required.",
  },
  {
    q: "What happens if the enclave restarts?",
    a: "A new epoch begins. The enclave generates a fresh Ed25519 keypair from hardware entropy, derives a new `epochId`, and resets the monotonic counter to 1. The previous epoch's signing key is destroyed and exists nowhere outside the terminated enclave. The first proof of the new epoch has no `prevB64`. Restarting is also a containment action: any undetected compromise is quarantined to the bounded window of a single epoch.",
  },
  {
    q: "If the TEE were compromised, would all my old proofs be invalid?",
    a: "No. Each epoch is a sealed compartment with its own keypair. A compromise of the live epoch can only sign proofs under the live epoch's public key — it cannot retroactively forge proofs under any prior epoch's key, because that key was destroyed when its enclave terminated. Ethereum anchors tighten this further: every proof committed before an anchor is fixed in a public, immutable timeline. A breach is bounded on one side by the epoch boundary and on the other by the most recent Ethereum anchor that preceded it.",
  },
  {
    q: "Is this a blockchain?",
    a: "No. BitGraph has no distributed consensus, no global ledger, no tokens. It constrains a single execution boundary. Proof chaining (`prevB64`) is a local hash chain, not a distributed data structure.",
  },
  {
    q: "Does BitGraph prove who created the content?",
    a: "A base proof attests which execution boundary committed specific bytes, not who created them. Actor-bound proofs (using device-bound biometric keys) can additionally attest that a specific person or device authorized the commitment.",
  },
  {
    q: "What if someone modifies the proof JSON?",
    a: "The Ed25519 signature covers the canonical signed body. Any modification to signed fields (artifact, commit, signer identity, environment) invalidates the signature. Unsigned fields (timestamps, metadata) are advisory and should not be trusted for security decisions.",
  },
  {
    q: "What is the measurement field?",
    a: "For AWS Nitro Enclaves, it is the PCR0 value, a SHA-384 hash of the enclave image. It uniquely identifies the exact code running inside the boundary. Verifiers should pin `allowedMeasurements` to known-good values.",
  },
  {
    q: "How does BitGraph establish time?",
    a: "BitGraph does not claim to prove absolute time. It proves causal order: every commit pre-allocates a slot inside the enclave before the artifact hash reaches it, and the monotonic counter establishes sequencing within an epoch. For an external time reference, the same enclave periodically commits the hash of a recent Ethereum block into the chain. A block hash does not exist before its block is produced, so everything chained after an anchor provably came after that block's public date, and the anchor's hash links fix the history behind it against rewrite.",
  },
  {
    q: "Can the same file produce different proofs?",
    a: "Yes. Each commit generates a fresh nonce, increments the counter, and produces a new signature. The artifact digest will be the same (same file = same SHA-256), but the commit context differs. This is correct behavior. Each is a distinct commit event.",
  },
  {
    q: "What is `prevB64`?",
    a: "The SHA-256 hash of the previous complete proof in the chain. It creates a linked sequence within an epoch. If any proof in the chain is modified, deleted, or reordered, the hash chain breaks. The first proof of an epoch has no `prevB64`.",
  },
  {
    q: "How is this different from just signing a file?",
    a: "A standard digital signature proves someone with the private key signed the bytes. BitGraph additionally provides: a measured execution boundary (PCR0), a monotonic counter (ordering), causal slot pre-allocation (the position was reserved before the enclave received the content's hash), proof chaining (sequence integrity), hardware attestation (boundary evidence), actor-bound proofs (device biometric authorization), and signed attribution (creator metadata). The key never leaves the enclave.",
  },
  {
    q: "What is a causal slot?",
    a: "A slot is a pre-allocated nonce and counter pair created inside the enclave before any artifact hash reaches it. This proves the enclave committed to a specific position in its sequence without having seen the artifact. The slot has its own Ed25519 signature and is cryptographically bound to the final proof via `slotHashB64`. Every proof includes its slot allocation record.",
  },
  {
    q: "What is attribution?",
    a: "Attribution is optional creator metadata (name, title, message) that is included in the Ed25519-signed body. Unlike metadata (which is unsigned and advisory), attribution is cryptographically sealed. Tampering with any attribution field invalidates the proof signature.",
  },
  {
    q: "Can I batch multiple artifacts?",
    a: "Yes. Send multiple digests in a single `POST /commit` request. The enclave allocates a slot and commits each digest sequentially. If using actor-bound proofs (passkey), all proofs in the batch receive actor identity via `batchContext`. Each proof is independently verifiable.",
  },
  {
    q: "What libraries does BitGraph use?",
    a: "The core library uses `@noble/ed25519` for signatures and `@noble/hashes` for SHA-256. Both are audited, pure TypeScript, zero-dependency libraries. No Node.js native bindings.",
  },
];

export default function FAQPage() {
  return (
    <article className="prose-doc">
      <h1 className="mb-6">FAQ</h1>
      <p className="text-[#1f2937] mb-10">
        Common questions about the BitGraph Protocol.
      </p>

      <div className="space-y-8">
        {faqs.map((faq) => (
          <div key={faq.q} className="border-b border-[#e5e7eb] pb-8">
            <h2 className="text-lg font-semibold mb-3">{renderInline(faq.q)}</h2>
            <p className="text-base text-[#1f2937] leading-relaxed">{renderInline(faq.a)}</p>
          </div>
        ))}
      </div>
    </article>
  );
}
