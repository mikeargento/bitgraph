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
        The position is fixed first, and the record is bound to it afterward. What fills it is your file plus a commitment to the position, and nothing made before the position can contain that commitment. Your original file stays unchanged. This page explains the operation, what crosses the enclave boundary, how the commitment is carried, where time comes from, and how epochs contain a compromise.
      </p>

      {/* The contrast, before the mechanism: a visitor arriving from the home page has to
          know this is not the three things they already know about (Mike, 2026-09-21).
          Two bold leads, negative then positive, long beat then short, which is the same
          shape as the headline they just clicked through. "Earlier" rather than "before the
          file arrives": the file never arrives, only its digest, and section 2 says so. */}
      <p>
        <strong>BitGraph is not a signature, a timestamp, an append-only log, write-once storage, a notarization, or simply a hash written to a blockchain.</strong> Used the usual way, all of them begin with your file. They take bytes that already exist and attach something to them, so any of them can be applied to a record written an hour ago, or written after the incident it describes, and still carry today&rsquo;s date.
      </p>
      <p>
        <strong>BitGraph begins earlier.</strong> It starts with a random number that can be used only once, drawn and signed inside the enclave. That number takes a position in a signed sequence, and then, by default, your record is built to carry a commitment to it. Bytes carrying that commitment could not have been finished before the position existed, and the position itself sits after an Ethereum block that had already been mined.
      </p>
      <p>
        <strong>Every BitGraph starts from a random number nobody could predict.</strong> Build a result on it, and that result could not have been finished before the number existed.
      </p>

      <h2 id="transition">1. One operation, two states</h2>
      <p>
        BitGraph does one thing. It allocates a position in a signed sequence inside a trusted execution environment, which in production is an AWS Nitro enclave. Your device derives a commitment to that position and combines it with your file to produce new bytes. The enclave then binds the SHA-256 fingerprint of those bytes to the position and consumes it.
      </p>
      <p>
        The protocol calls the random number a <em>nonce</em> (number used once) and the fingerprint the <em>digest</em>; the proof&rsquo;s fields name the allocated position a <em>slot</em> (<code>slotAllocation</code>, <code>slotCounter</code>). Allocation comes first and the commit comes later; between them, your device builds the bytes that connect the two. Every BitGraph made on this site, in the SDK and in the MCP server is made this way.
      </p>
      <HowFigure />
      <p>
        <strong>Allocation.</strong> The enclave draws 32 bytes from its hardware random number generator, advances a counter, and signs a small record: the nonce, the counter, the epoch identifier, its own public key and the chain. This is the position record. Beside it, the enclave notes the latest Ethereum anchor it has authenticated; that becomes the floor, signed into the proof at commit. It has no field that could hold a digest and is signed before any digest reaches the enclave. The position is kept in enclave memory as unused.
      </p>
      <p>
        <strong>The new bytes.</strong> From the signed position record your device derives a 32-byte position commitment, builds the new bytes with it, and hashes them. Section 3 covers where the commitment goes in different kinds of file.
      </p>
      <p>
        <strong>Commit.</strong> The new bytes&rsquo; digest arrives together with the position&rsquo;s identifier. In one atomic step the enclave deletes the position from its table, binds the digest to it, records both counters and the hash of the position record in a signed body, signs the body with its Ed25519 key, and obtains a hardware attestation over that exact body. There is no partial state: if any part fails, no proof exists and the position is simply lost. A position is consumed once and never reused. An answer lost on the way back is different: the proof was made and still exists, and the clients read it back by its digest rather than make a second one. Storing BitGraph&rsquo;s public copy happens afterwards, outside that step.
      </p>
      <p>
        <strong>The proof.</strong> What comes back is a JSON document: the digest, the commit fields, the signature, the enclave&rsquo;s measurement and attestation, the position record itself, and a signed marker naming the form (<code>tree/1</code>) and the exact specification text it follows. It is returned to whoever asked inside an <em>export</em> (<code>bitgraph-export/1</code>), one JSON file kept beside the original with <code>SPEC.md</code>, the text the proof pins. BitGraph also keeps a public copy, indexed by digest, for retrieval. Verification uses the export you hold and does not require contacting the service.
      </p>

      <h3>Why the order matters</h3>
      <p>
        The commitment reverses the usual order: it makes the finished bytes depend on the position. Because the position record contains fresh randomness drawn at allocation, bytes carrying its commitment could not have been finished before it existed. Committing their digest then binds that exact version to the same position.
      </p>
      <p>
        That bound applies to the new bytes. The original inside them can be any age: making a BitGraph today does not establish when its content was created.
      </p>
      <p>
        This is still worth having for a file that already exists. From the commit on, its exact bytes hold a fixed place in the sequence: they existed no later than the commit, and no BitGraph made afterwards, of the same bytes or any others, can be committed at an earlier place in that epoch&rsquo;s sequence. The commitment in the new bytes and the fingerprint in the proof point at each other, so changing either breaks the pair, and the proof cannot be moved onto other bytes.
      </p>

      <h2 id="boundary">2. What crosses the boundary</h2>
      <p>
        The file itself never crosses. On the public site, in the MCP server and in the SDK, the new bytes are built and hashed where the file is. One exception: the hosted MCP server is told each file&rsquo;s name and size and sent its first 16 bytes, which decide how the commitment is placed, so a file shorter than 16 bytes is sent whole. Their digests become the leaves of a small Merkle tree, and the commit request carries only the hash of its 84-byte root document, the position record and the signed marker. That is a property of each client rather than of the protocol: a client can send whatever it likes, and a verifier should read the client&rsquo;s source if it matters. The service sees the requester&rsquo;s address and that one hash, and publishes them with the position and the anchors; it also receives the sealed recovery entries and the lookups described next. It never sees the file, apart from the hosted MCP&rsquo;s first 16 bytes.
      </p>
      <p>
        After the proof is written, the client also sends sealed <em>recovery entries</em>, up to two per file (one for the original&rsquo;s digest, one for the new bytes&rsquo;), stored under names derived from the file&rsquo;s hash; the hash itself is never indexed. Whoever knows the file&rsquo;s digest can derive the names and open the entries; without it an entry is opaque. That is how the file alone finds its proof again if the export is lost, as long as its entries were stored: the drop box, the CLI and the MCP server consult the entries before anything else. A lookup that did not complete is answered as unknown, and unknown is not new: no client makes a second recording of the file unless the person asks for one regardless.
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
        For a file that already exists, the new bytes wrap it: the commitment is added after the last byte for formats whose decoders ignore trailing data, such as JPEG and PNG, and for everything else the file goes first into a small container that holds the commitment. The original is never modified, and the new file need not be kept: the original plus the export rebuilds it byte for byte, and checking that reconstruction against the leaf the export names, and the leaf against the committed root, is the evidence. A file can also be kept as is, with no commitment inside it; it then takes the record&rsquo;s floor but its own bytes are not dated.
      </p>
      <FusedFigure />
      <p>
        A format you produce yourself, such as an AI system&rsquo;s audit record, can carry the commitment in a field of its own. Then there is nothing to rebuild: the record with its commitment is the file you keep.
      </p>
      <p>
        Either way, the new bytes name the position and the position names the new bytes, and the floor the enclave fixed when it allocated the position puts a public time under them. The proof&rsquo;s signed attribution field carries the marker: the name <code>bitgraph-fuse/2</code>, the title <code>tree/1</code>, and the SHA-256 of the <code>SPEC.md</code> the proof was made under. A verifier that does not know that hash answers undetermined, never valid.
      </p>
      <p>
        Making a BitGraph of one or more files yields one position: a <code>tree/1</code>. Each file is a leaf, named by its digest and its placement; one file is a tree of one. The committed artifact is the hash of an 84-byte root document holding the leaf count, the Merkle root and the position commitment, so the root, the count and the commitment are all signed. The owner&rsquo;s export lists every leaf and name; a member&rsquo;s export carries one file&rsquo;s leaf and its path to the root, so each file can be checked alone. Nothing can be added to a tree afterwards. Earlier recordings placed a single fused file directly, or two or more files as a set; they still verify. The <Link href="/docs/proof-format#fused">proof format</Link> page has the byte-level placements, and <a href="/spec">SPEC.md</a> section 8 is the normative text.
      </p>

      <h2 id="time">4. Where time comes from</h2>
      <p>
        Nothing inside the sequence is a clock. Counters and previous-proof hashes give a total order within an epoch, and that order needs no time to be checked. Wall-clock statements come from outside. The floor comes from Ethereum, which BitGraph reads and never writes to. The ceiling in time comes from Base, where BitGraph writes one small transaction per batch of records, carrying a Merkle root over their proof hashes.
      </p>
      <p>
        An <em>anchor</em> is an ordinary position whose file is the hash of a recent Ethereum block, committed by the same enclave, on the same sequence, with the same key. The enclave accepts an anchor only from an anchor service whose signature it verifies against a key baked into its image, and it records the block number and hash in the signed body. A block hash cannot be known before its block is mined, so an anchor, and everything the sequence placed after it, came after that block.
      </p>
      <AnchorFigure />
      <p>
        <strong>The floor.</strong> On the anchored sequence the enclave fixes a floor for every position at the moment it allocates it: the latest anchor, which it signs into the proof at commit (since enclave version 7). Since version 8 it refuses to sign a proof without one. The block that anchor names had been mined before the position existed, so its time is a lower bound on the position that nobody involved chose. A verifier reads the block&rsquo;s time from its header, which an export carries as <code>floor.header</code>, and can confirm the same block on any Ethereum explorer.
      </p>
      <p>
        <strong>The ceiling.</strong> A proof names two places in the sequence: the position it was allocated (<code>slotCounter</code>) and the place its commit took (<code>commit.counter</code>). The floor belongs to the first; the ceiling to the second. The first anchor the sequence took after the commit is the record&rsquo;s ceiling: the record was committed before that anchor took its place. That is a fact about order in the sequence and it does not convert to a clock reading. An anchor is made after the block it carries, so a record can sit after that block was mined and still before the anchor. No field in a proof is a trusted timestamp, and the proof itself makes no wall-clock upper-bound claim.
      </p>
      <p>
        <strong>The ceiling in time.</strong> A few seconds after a commit, BitGraph writes a Merkle root over the newest records&rsquo; proof hashes to Base, in one small transaction from a published address. The block that includes it is a clock the record cannot move: the record existed by that block&rsquo;s time, when that time passes two checks: it is not earlier than the floor block&rsquo;s own time, and it agrees with the time in the proof&rsquo;s hardware attestation. A Base time that fails either is not used (<a href="/spec">SPEC.md</a> section 10.4). The ceiling travels in the export, never inside the proof, and every write is listed on the Ceilings page.
      </p>
      <p>
        <strong>The settlement.</strong> About an hour later Ethereum records that Base block through Base&rsquo;s output root, and the export carries that record too (<code>bitgraph-output-root/1</code>). It proves the record existed by that Ethereum block, and no more: not that the Base block is final on Base, and not the Base block&rsquo;s time. An export written right after the commit has the ceiling and the settlement pending; <code>bitgraph export complete</code> fills them in once they have landed, and a verifier states a pending part as not carried, never as failure.
      </p>
      <p>
        The anchor cadence is a deployment setting, as frequent as one anchor per Ethereum block. Anchors are not confirmation-delayed: a chain reorganisation near an anchor can orphan the block it names. The block&rsquo;s header still checks out on its own, offline; only a lookup against the chain shows the block is no longer the chain&rsquo;s own, and a lookup that does makes the verdict false (<a href="/spec">SPEC.md</a> section 1). Ordering within the sequence is untouched by anything that happens to Ethereum.
      </p>

      <h2 id="epochs">5. Compromise and containment</h2>
      <p>
        BitGraph assumes the boundary can be compromised and bounds the damage rather than claiming it cannot happen. The signing key exists only in enclave memory. Every restart destroys it and begins a new <em>epoch</em> with a fresh key and a counter at zero; in production the enclave restarts every day at 23:59 UTC, so an epoch is normally one UTC day; any extra restart starts another.
      </p>
      <EpochFigure />
      <p>
        Proofs from a closed epoch were signed by a key that no longer exists anywhere, so a compromise that begins later cannot reach backward. Forgery within the live epoch requires more than stealing a key: every proof carries an attestation whose user data is the hash of that exact proof, and only the enclave&rsquo;s hardware module can produce one, so a useful breach must execute inside the running enclave, and a restart ends that foothold but not the flaw that allowed it: the same flaw could be used again in a later epoch, and proofs already forged stay valid. Every proof names its epoch permanently, so a suspect window is identified exactly: the affected epoch is published as quarantined, and epochs that were not themselves compromised are unaffected. What this does not give is detection: a perfect forger inside the enclave during its epoch mints proofs that verify. The <Link href="/docs/trust-model">trust model</Link> lists what is prevented, what is detected, and what is neither.
      </p>
      <p>
        Epochs are not chained by signature. A new epoch&rsquo;s key could sign a reference to the last proof of the one before, but that would show only that the old epoch came first, not when it stopped, and this deployment starts each epoch fresh; the old key is destroyed on purpose. What relates one epoch to another is Ethereum. An epoch&rsquo;s anchors give it a floor that anyone can check without trusting either enclave: it ran no earlier than the blocks they cite. They do not prove on their own that it ended before a later epoch began, because an enclave can be handed an old block hash; that side comes from observation, such as the write times of BitGraph&rsquo;s public copy or anyone who saw the anchors land. Two enclaves run by different operators would be two unrelated sequences, related to each other in the same way and no other.
      </p>

      <h2 id="contains">What a proof contains</h2>
      <div className="table-scroll">
        <table className="table-k">
          <thead><tr><th>Field</th><th>What it establishes</th></tr></thead>
          <tbody>
            <tr><td>artifact.digestB64</td><td>For tree/1, the hash of the 84-byte root document: leaf count, Merkle root over the files&rsquo; committed bytes, and the commitment. Any change to a file, the count or the commitment changes it.</td></tr>
            <tr><td>slotAllocation</td><td>The position record: nonce, counter, epoch, key, signature. Made before any digest was received.</td></tr>
            <tr><td>commit.slotCounter, commit.counter</td><td>The reserved position and the commit&rsquo;s. The first is always smaller.</td></tr>
            <tr><td>commit.slotHashB64</td><td>Hash of the position record, inside the signed body, so the position cannot be swapped.</td></tr>
            <tr><td>commit.prevB64</td><td>Hash of the previous proof on the sequence: the link that makes the order checkable.</td></tr>
            <tr><td>commit.slotAnchor</td><td>The Ethereum block the floor rests on: fixed by the enclave when the position was allocated, signed into the proof at commit.</td></tr>
            <tr><td>signer, environment</td><td>The enclave&rsquo;s key and signature, its PCR0 measurement, and its hardware attestation over this body.</td></tr>
            <tr><td>attribution</td><td>Signed. The marker: name <code>bitgraph-fuse/2</code>, title <code>tree/1</code>, message the SHA-256 of the pinned <code>SPEC.md</code>.</td></tr>
            <tr><td>metadata, timestamps</td><td>Unsigned and advisory, as the client supplies them. Never evidence. The time inside the hardware attestation is different: the Nitro hardware signs it and the verifier uses it. <code>metadata[&quot;bitgraph-tree/1&quot;]</code> echoes the root document in hex; a reader counts it only after it hashes to the signed digest.</td></tr>
          </tbody>
        </table>
      </div>
      <p className="note">Every field, its encoding and what is and is not signed: <Link href="/docs/proof-format">proof format</Link>. The same account in formal terms, with the invariants: <Link href="/docs/what-is-bitgraph">the protocol</Link>. The normative text for tree/1, the export and recovery: <a href="/spec">SPEC.md</a>.</p>

      <h2 id="next">Where next</h2>
      <ul className="doors">
        <li><Link href="/docs/try">Make a BitGraph</Link><span>Drop any file in your browser. The file never leaves your machine, and the proof comes back to you.</span></li>
        <li><Link href="/docs/integration">Integration guide</Link><span>The same operation from the SDK, the CLI, or two HTTP calls.</span></li>
        <li><Link href="/docs/verification">Verification</Link><span>What a verifier checks, in order, and what each result means.</span></li>
        <li><Link href="/docs/what-bitgraph-is-not">Limits</Link><span>Truth, authorship, first creation, exact time, a universal order.</span></li>
      </ul>
    </article>
  );
}
