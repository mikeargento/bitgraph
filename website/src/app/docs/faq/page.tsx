import type { Metadata } from "next";
import { renderInline } from "@/lib/render-inline";

export const metadata: Metadata = {
  title: "FAQ",
  description: "Frequently asked questions about the BitGraph Protocol.",
};

const faqs = [
  {
    q: "Does BitGraph upload my file?",
    a: "No. Your file is hashed on your own machine, by BitGraph Recorder, the MCP server or your own code, and the fused artifact is built there too. Only SHA-256 digests (32 bytes each) reach the enclave. The file bytes never leave your machine, and the original is never modified.",
  },
  {
    q: "What happens when I record a file?",
    a: "The file is the origin. On your machine: the origin is hashed; the enclave allocates an unused slot before any artifact exists; a commitment to the signed slot record is derived; a new fused artifact is built from the origin under a registered placement; the fused artifact is hashed and its digest is committed into the same slot. The result is an ordinary `bitgraph/1` proof whose signed attribution names the placement and the origin digest under the profile identifier `bitgraph-fuse/1`. The origin is never modified and nothing is uploaded. The fused bytes are virtual: you only need to keep the origin, because the origin plus the proof rebuilds them byte for byte, and checking that reconstruction against the signed artifact digest is the evidence. In BitGraph Recorder a drop becomes a recording, one folder holding the file, `proof.json` and the Ethereum anchors as they land; its export writes the rebuilt file beside them. The MCP servers and the two-call API do the same for your own tools; file contents never travel, only digests, sizes, a file's first bytes for the placement choice, the slot record and the placement id.",
  },
  {
    q: "What does a BitGraph prove, exactly?",
    a: "One narrow thing: these exact bytes occupy this position in one sequence, the position existed before the enclave received their hash, and the position sits after a named Ethereum block. Three neighbouring claims do not follow, and a reader tends to assume them. Truth: a recorded document can be wrong in exactly the form it was recorded. Authorship: the proof names the boundary that committed the hash, not the person who made the file. First creation: the same bytes may have existed elsewhere beforehand; what is fixed is the position they took here.",
  },
  {
    q: "What is a floor?",
    a: "A lower bound on when a set of bytes could have been finalized. Fusing gives bytes a floor of their own: the new file carries a commitment to its slot inside its bytes, so it cannot predate that slot, and it carries that floor with it wherever it goes, as an independent object. The slot's own floor comes from Ethereum. Every proof on the anchored chain sits on a slot allocated after an anchor, and the enclave refuses to sign one that is not, anchors themselves excepted. An anchor is a position whose bytes are the hash of a recent block, and a block hash does not exist before its block is produced. So the floor runs in one direction: fused file, then its slot, then the anchor before the slot, then a public Ethereum block. The block is where the floor enters the system, which is why anchors are recorded as they are and never fused: they already have one. None of it is something BitGraph asserts on its own: anyone can read the block's hash and time on an Ethereum explorer without trusting this service. Floors accumulate. When a later anchor lands, a checker gains a tighter bound on later positions; the earlier check stands beside it and is never replaced.",
  },
  {
    q: "What does a fused artifact establish?",
    a: "Two bounds on its bytes. They could not have been finalized before their slot was allocated, a lower bound tied to the anchored block before the slot, and they were committed no later than the commit position, an upper bound within the sequence. By reconstruction, the original existed no later than the commit. None of this says when the content was created, whether it is authentic, or whether what it describes happened. A recording of existing bytes establishes only that those exact bytes existed no later than the commit. Existing proofs and older recordings are not reinterpreted.",
  },
  {
    q: "Where does the slot commitment go?",
    a: "A registered placement says where. For formats whose decoders ignore trailing bytes (JPEG, PNG, GIF, TIFF and TIFF-based raws, BMP, and RIFF formats such as WebP) it is a 48-byte trailer (`trailer/1`). For everything else (PDF, ZIP-based documents, video, HEIC, text) it is a small tar container holding the unchanged file, original first (`container/2`; artifacts made under the older `container/1`, manifest first, stay readable). The proof names the placement. The Frame file `<name>.bitgraph-fuse.json` carries the placement, the origin digest, the artifact digest and the nested proof.",
  },
  {
    q: "Why is the position allocated before the hash arrives?",
    a: "Because that is what makes it evidence rather than a claim. If the position were assigned when the hash arrived, whoever ran the service could choose it. Instead the enclave hands out a slot from hardware entropy, signs it, and only then receives a hash to bind into it. The claim is precisely the enclave's own view: it had not received the hash when it signed the slot. It says nothing about what anyone else knew. Two consequences follow. An attempt consumes a position whether or not anyone likes the result, so a run cannot quietly discard nine tries and present the tenth as the only one. And a slot lives for at most two minutes before it expires, a limit set in the attested code, so a holder can delay a commit by at most that much, or choose among the slots it holds open, and the verifier can see the slot counter and the commit counter side by side.",
  },
  {
    q: "Why not just trust a timestamp?",
    a: "A timestamp is written by the same key that signs the record. If that key is ever compromised, or its holder is simply dishonest, backdating costs nothing and leaves no trace inside the record. A value signed by the party a check exists to catch is a claim, not evidence, however good the signature. Order in a sequence the signer does not control survives the compromise of that key. This is why every timestamp inside a proof is advisory, and why the only time BitGraph relies on comes from outside: the Ethereum block an anchor names, signed by nobody involved.",
  },
  {
    q: "How does this relate to execution attestation records for AI agents?",
    a: "They are complementary, and they answer different questions. An attestation record proves what happened inside its own boundary: which model ran, under which policy, on which measured hardware. What it structurally cannot give is order across parties, a position that predates its own artifact, or a check that needs neither the issuer nor the log operator present. BitGraph is a separate trust domain such a record can reference. The producer takes a slot before the run finishes, carries the slot commitment inside the signed record, and commits the record's digest into that slot. Any verifier who chooses to read the proof carried with the record gets the record's position and its floor; a verifier who does not is unaffected. The record binds the slot, and the slot binds the record, so pasting one record's commitment into another fails: the slot was consumed by a different digest.",
  },
  {
    q: "Can an agent's run be recorded as a whole?",
    a: "Yes. Each action leaves bytes: a call, a result, a file. Recording them together makes one set at one position, each file a member with its own row in the committed manifest. The record is by content, so nothing about who or what produced the bytes changes it, and no agent has to run inside an enclave to have its outputs placed in order.",
  },
  {
    q: "What happens when I drop the original again later?",
    a: "In BitGraph Recorder a file already on record opens its recording instead of making a second one, and a folder somebody sends you checks on its own: verified, failed, could not be checked, or not recorded, per file. A fused artifact carries its own commitment, so it is checked directly; its proof names the origin and accepts the original by reconstruction. Recordings are never ranked or read as versions.",
  },
  {
    q: "Can I make or check a BitGraph without the app?",
    a: "Yes. `@mikeargento/bitgraph` exposes `fuse()` and the `bitgraph-fuse` command (`fuse <file> --placement trailer/1|container/2`, `produce`, `check`). `@mikeargento/bitgraph-verify` exposes `verifyFuse`, which reports, among others, FUSED_DIRECT, FUSED_FROM_ORIGIN, RECORDED, INVALID_SLOT_COMMITMENT, RECONSTRUCTION_MISMATCH or NO_MATCH. `npx @mikeargento/bitgraph-audit` checks a whole bundle, anchors and attestation included, from a terminal. `@mikeargento/bitgraph-mcp` gives any MCP client the same making.",
  },
  {
    q: "Can I verify a proof without an internet connection?",
    a: "Yes. Verification is offline: the digest, the Ed25519 signature, the attestation chain to the AWS Nitro root, the slot binding and the floor in the signed body. You need the artifact bytes, the proof JSON, and a verifier implementation. For a fused artifact either copy will do: the origin plus the proof rebuilds the fused bytes, and the rebuilt bytes are checked against the signed digest. The floor can be checked offline too when the anchor travels with the proof, which a recording's folder and an export both provide. The export ships the block header, so the floor checks offline as well; confirming the same block on a public explorer is optional corroboration and needs nothing from this service.",
  },
  {
    q: "What happens if the enclave restarts?",
    a: "A new epoch begins. The enclave generates a fresh Ed25519 keypair from hardware entropy, derives a new `epochId`, and resets the monotonic counter to 1. The previous epoch's signing key is destroyed and exists nowhere outside the terminated enclave. The first proof of the new epoch has no `prevB64`. Restarting is also a containment action: any undetected compromise is quarantined to the bounded window of a single epoch. Epochs relate to each other only through Ethereum: the last anchor of one and the first anchor of the next name blocks, and the blocks are in order.",
  },
  {
    q: "If the TEE were compromised, would all my old proofs be invalid?",
    a: "No. Each epoch is a closed compartment with its own keypair. A compromise of the live epoch can only sign proofs under the live epoch's public key. It cannot retroactively forge proofs under any prior epoch's key, because that key was destroyed when its enclave terminated. Ethereum anchors bound it further: every slot allocated after an anchor carries that anchor as its floor, so a breach cannot place a proof before a block that had not yet been produced. A breach is bounded on one side by the epoch boundary and on the other by the most recent anchor that preceded it.",
  },
  {
    q: "Is this a blockchain?",
    a: "No. BitGraph has no distributed consensus, no global ledger, no tokens. It constrains a single execution boundary. Proof chaining (`prevB64`) is a local hash chain, not a distributed data structure. Ethereum is read, never written: an anchor commits the hash of a block into BitGraph's sequence, and no transaction, wallet or contract is involved.",
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
    a: "For AWS Nitro Enclaves, it is the PCR0 value, a SHA-384 hash of the enclave image. It uniquely identifies the exact code running inside the boundary, and the image is built reproducibly, so two independent builds of the published source arrive at the same value. Verifiers should pin `allowedMeasurements` to known-good values. The Recorder and the player report a proof signed under a measurement they do not carry as could not be checked, never as valid; a verifier that pins `allowedMeasurements` rejects it outright.",
  },
  {
    q: "How does BitGraph establish time?",
    a: "BitGraph does not claim to prove absolute time. It proves causal order: every commit pre-allocates a slot inside the enclave before the artifact hash reaches it, and the monotonic counter establishes sequencing within an epoch. For an external time reference, the same enclave periodically commits the hash of a recent Ethereum block into the chain. A block hash does not exist before its block is produced, so everything chained after an anchor provably came after that block's public date, and the anchor's hash links fix the history behind it against rewrite. The bound runs in one direction only, no earlier than; BitGraph never claims a public no-later-than, because nothing is written to Ethereum. A fused artifact carries a commitment to its slot, so the lower bound reaches its bytes as well: they could not have been finalized before the slot, and the slot follows the anchored block before it.",
  },
  {
    q: "Can the same file produce different proofs?",
    a: "Yes. Each recording takes a fresh slot, whose nonce came from hardware entropy at allocation, advances the counter, and produces a new signature. The artifact digest will be the same (same file = same SHA-256), but the commit context differs. This is correct behavior. Each is a distinct commit event. Recording the same original again through the two-call API, or through an MCP server with `again=true`, makes a new fused artifact with a new slot commitment, so its bytes and digest differ from the first; both name the same origin, and neither outranks the other. BitGraph Recorder opens an existing recording rather than making a second one. The MCP servers make a new BitGraph when asked: BitGraph no longer indexes proofs, so whether a file already has one is known only to whoever holds its proof.",
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
    q: "Can I record many files at once?",
    a: "Yes. Two or more files become one set: one slot, one position, every file a member listed by digest in the manifest, with an inclusion path of its own. What is committed is the root over those rows, so the whole set is one BitGraph and each member can be checked on its own. Membership and the floor are inseparable: a member cannot be added after the fact, because the root was committed with the rows it had.",
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
