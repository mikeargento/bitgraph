import type { Metadata } from "next";
import Link from "next/link";
import { HowFigure } from "./how-figure";
import { FusedFigure } from "@/components/figures/fused-figure";
import { AnchorFigure } from "@/components/figures/anchor-figure";
import { EpochFigure } from "@/components/figures/epoch-figure";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "How a BitGraph is made, in five steps: the position allocated before the fingerprint arrives, what crosses the enclave boundary, carrying the position inside a new file, where time comes from, and how compromise is contained.",
};

/**
 * The full explanation, in the order a reader needs it. Each section adds
 * one mechanism and defines its terms on first use. Nothing here repeats the
 * home page's orientation; the protocol page states the same things formally.
 */
export default function OverviewPage() {
  return (
    <article className="prose">
      <h1>How it works</h1>
      <p className="lede">
        A BitGraph proves a simple order: a position came first, then your file filled it. What fills it is your file plus a commitment to the position, and nothing made before the position can contain that commitment. Your original file stays unchanged. This page explains the operation, what crosses the enclave boundary, how the commitment is carried, where time comes from, and how epochs contain a compromise.
      </p>

      {/* The contrast, before the mechanism: a visitor arriving from the home page has to
          know this is not the three things they already know about (Mike, 2026-09-21).
          Two bold leads, negative then positive, long beat then short, which is the same
          shape as the headline they just clicked through. "Earlier" rather than "before the
          file arrives": the file never arrives, only its digest, and section 2 says so. */}
      <p>
        <strong>BitGraph is not a signature, a timestamp, an append-only log, write-once storage, a notarization, or a hash written to a blockchain.</strong> All of them begin with your file. They take bytes that already exist and attach something to them, so any of them can be applied to a record written an hour ago, or written after the incident it describes, and still carry today&rsquo;s date.
      </p>
      <p>
        <strong>BitGraph begins earlier.</strong> It starts with a random number that can be used only once, drawn and signed inside the enclave. That number takes a position in a signed sequence, and then your record is built to carry a commitment to it. Bytes carrying that commitment could not have been finished before the position existed, and the position itself sits after an Ethereum block that had already been mined.
      </p>
      <p>
        <strong>Every BitGraph starts from a random number that never existed before.</strong> Seed a computation with it, and the computation could not have started earlier.
      </p>

      <h2 id="transition">1. One operation, two states</h2>
      <p>
        BitGraph does one thing. It allocates a position in a signed sequence inside a trusted execution environment, which in production is an AWS Nitro enclave. Your device derives a commitment to that position and combines it with your file to produce new bytes. The enclave then binds the SHA-256 fingerprint of those bytes to the position and consumes it.
      </p>
      <p>
        The protocol calls the random number a <em>nonce</em> (number used once), the fingerprint the <em>digest</em> and the allocated position a <em>slot</em>. Allocation comes first and the commit comes later; between them, your device builds the bytes that connect the two. Every BitGraph made on this site, in the SDK and in the MCP server is made this way.
      </p>
      <HowFigure />
      <p>
        <strong>Allocation.</strong> The enclave draws 32 bytes from its hardware random number generator, advances a counter, and signs a small record: the nonce, the counter, the epoch identifier, its own public key and the latest Ethereum anchor it has authenticated. This is the slot record. It has no field that could hold a digest and is signed before any digest reaches the enclave. The slot is kept in enclave memory as unused.
      </p>
      <p>
        <strong>The new bytes.</strong> From the signed slot record your device derives a 32-byte commitment, builds the new bytes with it, and hashes them. Section 3 covers where the commitment goes in different kinds of file.
      </p>
      <p>
        <strong>Commit.</strong> The new bytes&rsquo; digest arrives together with the slot&rsquo;s identifier. In one atomic step the enclave deletes the slot from its table, binds the digest to it, records both counters and the hash of the slot record in a signed body, signs the body with its Ed25519 key, and obtains a hardware attestation over that exact body. There is no partial state: if any part fails, no proof exists and the slot is simply lost. A slot is consumed once and never reused. Storing BitGraph&rsquo;s public copy happens afterwards, outside that step.
      </p>
      <p>
        <strong>The proof.</strong> What comes back is a JSON document: the digest, the commit fields, the signature, the enclave&rsquo;s measurement and attestation, the slot record itself, and a signed marker naming the original&rsquo;s digest. It is returned to whoever asked and travels with the original. BitGraph also keeps a public copy, indexed by digest, for retrieval. Verification uses the proof you hold and does not require contacting the service.
      </p>

      <h3>Why the order matters</h3>
      <p>
        The commitment reverses the usual order: it makes the finished bytes depend on the slot. Because the slot contains fresh randomness drawn at allocation, bytes carrying its commitment could not have been finished before it existed. Committing their digest then binds that exact version to the same slot.
      </p>
      <p>
        That bound applies to the new bytes. The original inside them can be any age: making a BitGraph today does not establish when its content was created.
      </p>
      <p>
        This is still worth having for a file that already exists. From the commit on, its exact bytes hold a fixed place in the sequence: they existed no later than the commit, and any later BitGraph of the same bytes can only take a later place. The commitment in the new bytes and the fingerprint in the proof point at each other, so changing either breaks the pair, and the proof cannot be moved onto other bytes.
      </p>

      <h2 id="boundary">2. What crosses the boundary</h2>
      <p>
        The file itself never crosses. On the public site, in the MCP server and in the SDK, the new bytes are built and hashed where the file is, and the commit request carries only their digest, the slot record and the signed marker with the original&rsquo;s digest. That is a property of each client rather than of the protocol: a client can send whatever it likes, and a verifier should read the client&rsquo;s source if it matters. The service sees the requester&rsquo;s address and those two digests, and publishes them with the position and the anchors. It never sees the file.
      </p>
      <p>
        The enclave is a measured environment. Its image is identified by a hash, PCR0, that AWS computes at boot and that anyone can reproduce from the published source. The enclave&rsquo;s signing key is generated inside it and never leaves. Every proof carries an attestation document, signed by the Nitro hardware, whose user data is the hash of that proof&rsquo;s signed body. A verifier who pins the published PCR0 is therefore checking not only that some key signed the proof but that the key belonged to that specific code.
      </p>
      <div className="callout is-limit">
        <span className="kicker">What the producer can and cannot choose</span>
        <p>
          A position stays open for up to 120 seconds, and a caller can hold several at once, choose which file fills which, or leave one unused. What a caller does not choose is the order of the positions: the enclave issues them one after another on a single counter, each proof naming the one before it, and a position left unused is lost rather than returned. The choice is which file takes a position, never where that position sits in the sequence.
        </p>
      </div>

      <p>
        Every workflow uses the same rules. An audit record and a photograph pass through the same measured enclave, with no customer-specific build. Workflow context is bound into the signed proof alongside the file&rsquo;s digest: a policy digest, a key identifying the actor, an attribution. The enclave seals that context without reading it, so it never changes how a position is issued or bound. A verifier can pin the published measurement and confirm that proofs from different workflows came from the same expected implementation.
      </p>

      <h2 id="fused">3. Carrying the position inside the bytes</h2>
      <p>
        For a file that already exists, the new bytes wrap it: the commitment is added after the last byte for formats whose decoders ignore trailing data, such as JPEG and PNG, and for everything else the file goes first into a small container that holds the commitment. The original is never modified, and the new file need not be kept: the original plus the proof rebuilds it byte for byte, and checking that reconstruction against the committed digest is the evidence.
      </p>
      <FusedFigure />
      <p>
        A format you produce yourself, such as an AI system&rsquo;s audit record, can carry the commitment in a field of its own. Then there is nothing to rebuild: the record with its commitment is the file you keep.
      </p>
      <p>
        Either way, the new bytes name the slot and the slot names the new bytes, and the anchor signed into the slot record puts a public time under them. The proof&rsquo;s signed attribution field carries the marker: the label <code>bitgraph-fuse/1</code>, the placement used and, for a wrapped file, the digest of the original.
      </p>
      <p>
        Two or more files made together become one set under one slot, with each file a member that keeps its own row and inclusion path. The <Link href="/docs/proof-format#fused">proof format</Link> page has the byte-level placements.
      </p>

      <h2 id="time">4. Where time comes from</h2>
      <p>
        Nothing inside the sequence is a clock. Counters and previous-proof hashes give a total order within an epoch, and that order needs no time to be checked. Wall-clock statements come from outside, from Ethereum, which BitGraph reads and never writes to.
      </p>
      <p>
        An <em>anchor</em> is an ordinary position whose file is the hash of a recent Ethereum block, committed by the same enclave, on the same sequence, with the same key. The enclave accepts an anchor only from an anchor service whose signature it verifies against a key baked into its image, and it records the block number and hash in the signed body. A block hash cannot be known before its block is mined, so an anchor, and everything the sequence placed after it, came after that block.
      </p>
      <AnchorFigure />
      <p>
        <strong>The floor.</strong> Every slot record on the anchored sequence names the latest anchor at the moment of allocation (since enclave version 7), and since version 8 the enclave refuses to sign a proof whose slot carries none. The block that anchor names had been mined before the slot existed, so its time is a lower bound on the position that nobody involved chose. A verifier reads the block&rsquo;s time from its header, which an export ships as a witness, and can confirm the same block on any Ethereum explorer.
      </p>
      <p>
        <strong>The ceiling.</strong> The next anchor the sequence took is the position&rsquo;s ceiling: the record was committed before that anchor took its place. That is a fact about order in the sequence and it does not convert to a clock reading. An anchor is made after the block it carries, so a record can sit after that block was mined and still before the anchor. No field in a proof is a trusted timestamp, and BitGraph makes no wall-clock upper-bound claim.
      </p>
      <p>
        The anchor cadence is a deployment setting, as frequent as one anchor per Ethereum block. Anchors are not confirmation-delayed: a chain reorganisation near an anchor can orphan the block it names, in which case the witness check fails and that temporal bound is lost rather than silently wrong. Ordering within the sequence is untouched by anything that happens to Ethereum.
      </p>

      <h2 id="epochs">5. Compromise and containment</h2>
      <p>
        BitGraph assumes the boundary can be compromised and bounds the damage rather than claiming it cannot happen. The signing key exists only in enclave memory. Every restart destroys it and begins a new <em>epoch</em> with a fresh key and a counter at zero; in production the enclave restarts every day at 23:59 UTC, so an epoch is one UTC day.
      </p>
      <EpochFigure />
      <p>
        Proofs from a closed epoch were signed by a key that no longer exists anywhere, so a compromise cannot reach backward. Forgery within the live epoch requires more than stealing a key: every proof carries an attestation whose user data is the hash of that exact proof, and only the enclave&rsquo;s hardware module can produce one, so a useful breach must execute inside the running enclave and dies at the next restart. Every proof names its epoch permanently, so a suspect window is identified exactly: the affected epoch is published as quarantined and every other epoch is untouched. What this does not give is detection: a perfect forger inside the enclave during its epoch mints proofs that verify. The <Link href="/docs/trust-model">trust model</Link> lists what is prevented, what is detected, and what is neither.
      </p>
      <p>
        Epochs cannot be chained by signature, because no key ever witnesses both sides of the boundary; the old key is destroyed on purpose. What relates one epoch to another is Ethereum. An epoch&rsquo;s anchors give it a floor that anyone can check without trusting either enclave: it ran no earlier than the blocks they cite. They do not prove on their own that it ended before a later epoch began, because an enclave can be handed an old block hash; that side comes from observation, such as the write times of BitGraph&rsquo;s public copy or anyone who saw the anchors land. Two enclaves run by different operators would be two unrelated sequences, related to each other in the same way and no other.
      </p>

      <h2 id="contains">What a proof contains</h2>
      <div className="table-scroll">
        <table className="table-k">
          <thead><tr><th>Field</th><th>What it establishes</th></tr></thead>
          <tbody>
            <tr><td>artifact.digestB64</td><td>The committed new bytes: your file plus the commitment. Any change to either changes the digest.</td></tr>
            <tr><td>slotAllocation</td><td>The slot record: nonce, counter, epoch, key, signature. Made before any digest was received.</td></tr>
            <tr><td>commit.slotCounter, commit.counter</td><td>The slot&rsquo;s position and the commit&rsquo;s. The first is always smaller.</td></tr>
            <tr><td>commit.slotHashB64</td><td>Hash of the slot record, inside the signed body, so the slot cannot be swapped.</td></tr>
            <tr><td>commit.prevB64</td><td>Hash of the previous proof on the sequence: the link that makes the order checkable.</td></tr>
            <tr><td>commit.slotAnchor</td><td>The Ethereum block the floor rests on, signed into the slot record.</td></tr>
            <tr><td>signer, environment</td><td>The enclave&rsquo;s key and signature, its PCR0 measurement, and its hardware attestation over this body.</td></tr>
            <tr><td>attribution</td><td>Signed. The marker, the placement and, for a wrapped file, the original&rsquo;s digest.</td></tr>
            <tr><td>metadata, timestamps</td><td>Unsigned and advisory. Never evidence.</td></tr>
          </tbody>
        </table>
      </div>
      <p className="note">Every field, its encoding and what is and is not signed: <Link href="/docs/proof-format">proof format</Link>. The same account in formal terms, with the invariants: <Link href="/docs/what-is-bitgraph">the protocol</Link>.</p>

      <h2 id="next">Where next</h2>
      <ul className="doors">
        <li><Link href="/docs/try">Make a BitGraph</Link><span>Drop any file in your browser. Only its fingerprint leaves your machine, and the proof comes back to you.</span></li>
        <li><Link href="/docs/integration">Integration guide</Link><span>The same operation from the SDK, the CLI, or two HTTP calls.</span></li>
        <li><Link href="/docs/verification">Verification</Link><span>What a verifier checks, in order, and what each result means.</span></li>
        <li><Link href="/docs/what-bitgraph-is-not">Limits</Link><span>Truth, authorship, first creation, exact time, a universal order.</span></li>
      </ul>
    </article>
  );
}
