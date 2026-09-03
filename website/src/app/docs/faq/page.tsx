import type { Metadata } from "next";
import { renderInline } from "@/lib/render-inline";

export const metadata: Metadata = {
  title: "FAQ",
  description: "Frequently asked questions about the BitGraph Protocol.",
};

const faqs = [
  {
    q: "Does BitGraph upload my file?",
    a: "No. Your file is hashed in your browser or application, and when the site builds a fused artifact from it, that happens in the browser too. Only SHA-256 digests (32 bytes each) reach the enclave. The file bytes never leave your machine, and the original is never modified.",
  },
  {
    q: "What happens when I drop a file?",
    a: "The dropped file is the origin. In your browser: the origin is hashed; the enclave allocates an unused slot before any artifact exists; a commitment to the signed slot record is derived; a new fused artifact is built from the origin under a registered placement; the fused artifact is hashed and its digest is committed into the same slot. The result is an ordinary `bitgraph/1` proof whose signed attribution names the placement and the origin digest under the profile identifier `bitgraph-fuse/1`. The origin is never modified and nothing is uploaded. The fused copy is offered as a download, but you only need to keep the origin: the origin plus the proof rebuilds the fused bytes byte for byte, and checking that reconstruction against the signed artifact digest is the evidence. The site's export holds the original, `proof.json`, the Frame, the fused copy and the Ethereum anchors. Recording existing bytes as they are remains available: the Record instead option on the results card, `POST /api/commit`, and the site's hosted MCP endpoint, which only ever receives digests. The npm MCP server makes BitGraphs the default way.",
  },
  {
    q: "What does a fused artifact establish?",
    a: "Two bounds on its bytes. They could not have been finalized before their slot was allocated, a lower bound tied to the anchored block before the slot, and they were committed no later than the commit position, an upper bound. By reconstruction, the original existed no later than the commit. None of this says when the content was created, whether it is authentic, or whether what it describes happened. A recording of existing bytes establishes only that those exact bytes existed no later than the commit. Existing proofs and older drops are not reinterpreted.",
  },
  {
    q: "Where does the slot commitment go?",
    a: "A registered placement says where. For formats whose decoders ignore trailing bytes (JPEG, PNG, GIF, TIFF and TIFF-based raws, BMP, and RIFF formats such as WebP) it is a 48-byte trailer (`trailer/1`). For everything else (PDF, ZIP-based documents, video, HEIC, text) it is a small tar container holding the unchanged file (`container/1`). The proof names the placement. The Frame file `<name>.bitgraph-fuse.json` carries the placement, the origin digest, the artifact digest and the nested proof.",
  },
  {
    q: "What do I find when I drop the original later?",
    a: "Recordings of those exact bytes, and every fused artifact that names them as origin, listed by position and placement. They are never ranked or read as versions. Dropping a fused artifact finds its own proof; its page names the origin and accepts the original by reconstruction.",
  },
  {
    q: "Can I make or check a fused artifact outside the browser?",
    a: "Yes. `@mikeargento/bitgraph` 1.2.0 exposes `fuse()` and the `bitgraph-fuse` command (`fuse <file> --placement trailer/1|container/1`, `produce`, `check`). `@mikeargento/bitgraph-verify` 1.4.0 adds `verifyFuse`, which reports FUSED_DIRECT, FUSED_FROM_ORIGIN, RECORDED, INVALID_SLOT_COMMITMENT, RECONSTRUCTION_MISMATCH or NO_MATCH. `bitgraph-play check` in `@mikeargento/bitgraph-player` 0.8.1 prints a fused line with the floor and span; `bitgraph_check` in `@mikeargento/bitgraph-mcp` 0.1.2 reports `fused_descendants`; `@mikeargento/bitgraph-audit` 0.4.1 is the matching audit release.",
  },
  {
    q: "Can I verify a proof without an internet connection?",
    a: "Yes. Core verification (digest match + Ed25519 signature) is fully offline. You need the artifact bytes, the proof JSON, and a verifier implementation. For a fused artifact either copy will do: the origin plus the proof rebuilds the fused bytes, and the rebuilt bytes are checked against the signed digest. No API calls required.",
  },
  {
    q: "What happens if the enclave restarts?",
    a: "A new epoch begins. The enclave generates a fresh Ed25519 keypair from hardware entropy, derives a new `epochId`, and resets the monotonic counter to 1. The previous epoch's signing key is destroyed and exists nowhere outside the terminated enclave. The first proof of the new epoch has no `prevB64`. Restarting is also a containment action: any undetected compromise is quarantined to the bounded window of a single epoch.",
  },
  {
    q: "If the TEE were compromised, would all my old proofs be invalid?",
    a: "No. Each epoch is a closed compartment with its own keypair. A compromise of the live epoch can only sign proofs under the live epoch's public key. It cannot retroactively forge proofs under any prior epoch's key, because that key was destroyed when its enclave terminated. Ethereum anchors tighten this further: every proof committed before an anchor is fixed in a public, immutable timeline. A breach is bounded on one side by the epoch boundary and on the other by the most recent Ethereum anchor that preceded it.",
  },
  {
    q: "Is this a blockchain?",
    a: "No. BitGraph has no distributed consensus, no global ledger, no tokens. It constrains a single execution boundary. Proof chaining (`prevB64`) is a local hash chain, not a distributed data structure.",
  },
  {
    q: "Does BitGraph prove who created the content?",
    a: "No. A proof attests which execution boundary committed specific bytes, not who created them. A signed attribution is a note bound into the proof, not a verified identity.",
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
    a: "BitGraph does not claim to prove absolute time. It proves causal order: every commit pre-allocates a slot inside the enclave before the artifact hash reaches it, and the monotonic counter establishes sequencing within an epoch. For an external time reference, the same enclave periodically commits the hash of a recent Ethereum block into the chain. A block hash does not exist before its block is produced, so everything chained after an anchor provably came after that block's public date, and the anchor's hash links fix the history behind it against rewrite. A fused artifact carries a commitment to its slot, so that lower bound reaches its bytes as well: they could not have been finalized before the slot, and the slot follows the anchored block before it.",
  },
  {
    q: "Can the same file produce different proofs?",
    a: "Yes. Each commit generates a fresh nonce, increments the counter, and produces a new signature. The artifact digest will be the same (same file = same SHA-256), but the commit context differs. This is correct behavior. Each is a distinct commit event. Dropping the same original again makes a new fused artifact with a new slot commitment, so its bytes and digest differ from the first; both name the same origin, and the origin's page lists them by position without ranking.",
  },
  {
    q: "What is `prevB64`?",
    a: "The SHA-256 hash of the previous complete proof in the chain. It creates a linked sequence within an epoch. If any proof in the chain is modified, deleted, or reordered, the hash chain breaks. The first proof of an epoch has no `prevB64`.",
  },
  {
    q: "How is this different from just signing a file?",
    a: "A standard digital signature proves someone with the private key signed the bytes. BitGraph additionally provides: a measured execution boundary (PCR0), a monotonic counter (ordering), causal slot pre-allocation (the position was reserved before the enclave received the content's hash), proof chaining (sequence integrity), hardware attestation (boundary evidence), and signed attribution (a bound note; for a fused artifact, the placement and the origin digest). A fused artifact also carries a commitment to its slot inside the bytes, so they could not have been finalized before the slot existed. The key never leaves the enclave.",
  },
  {
    q: "What is a causal slot?",
    a: "A slot is a pre-allocated nonce and counter pair created inside the enclave before any artifact hash reaches it. This proves the enclave committed to a specific position in its sequence without having seen the artifact. The slot has its own Ed25519 signature and is cryptographically bound to the final proof via `slotHashB64`. Every proof includes its slot allocation record. A fused artifact also carries a commitment to that signed slot record inside its bytes, which ties the bytes to the slot before they were finished.",
  },
  {
    q: "What is attribution?",
    a: "Attribution is optional creator metadata (name, title, message) that is included in the Ed25519-signed body. Unlike metadata (which is unsigned and advisory), attribution is cryptographically bound. Tampering with any attribution field invalidates the proof signature. For a fused artifact the fields are fixed: `name` is the profile identifier `bitgraph-fuse/1`, `title` is the placement, and `message` is the origin digest.",
  },
  {
    q: "Can I batch multiple artifacts?",
    a: "Yes. Send multiple digests in a single `POST /commit` request. The enclave allocates a slot and commits each digest sequentially. Each proof is independently verifiable.",
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
