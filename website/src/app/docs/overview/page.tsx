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
        A BitGraph is a proof that a file&rsquo;s fingerprint took a position that existed before the fingerprint arrived. This page builds that up in five steps: the basic state transition, what crosses the boundary, carrying the position inside a new file, where time comes from, and how a compromise is contained. The protocol vocabulary is introduced where it is first needed.
      </p>

      <h2 id="transition">1. One operation, two states</h2>
      <p>
        BitGraph does one thing. A trusted execution environment, in production an AWS Nitro enclave, allocates a position in a signed sequence and later binds a file&rsquo;s SHA-256 fingerprint to it. The protocol calls the fingerprint the <em>digest</em> and the allocated position a <em>slot</em>. The two events are separate, and their order is the whole point.
      </p>
      <HowFigure />
      <p>
        <strong>Allocation.</strong> The enclave draws 32 bytes from its hardware random number generator, advances a counter, and signs a small record: the nonce, the counter, the epoch identifier, its own public key and the latest Ethereum anchor it has authenticated (a field added in enclave version 7). This is the slot record. It has no field that could hold a digest, and it is signed before any digest is received, so anyone holding it can see that it was made without knowledge of the file. The slot is kept in enclave memory as unused.
      </p>
      <p>
        <strong>Commit.</strong> A digest arrives together with the slot&rsquo;s identifier. In one indivisible step the enclave deletes the slot from its table, binds the digest to it, records both counters and the hash of the slot record in a signed body, signs the body with its Ed25519 key, and obtains a hardware attestation over that exact body. If any part fails, no proof exists and the slot is simply lost. A slot is consumed once and never reused.
      </p>
      <p>
        <strong>The proof.</strong> What comes back is a JSON document: the digest, the commit fields, the signature, the enclave&rsquo;s measurement and attestation, and the slot record itself. It is returned to whoever asked and travels with the file. The service keeps a copy and indexes it by digest as a convenience; the copy is not the evidence, the file you hold is.
      </p>

      <h3>Why the order matters</h3>
      <p>
        Every neighbouring mechanism operates on a file that already exists. A signature is applied after the fact and can be applied to anything at any time. A timestamp is asserted by whoever holds a clock. Committing a hash to a blockchain shows the file existed no later than a block, but any file from any source can be committed, including one fabricated an hour earlier. In each case the record is a label attached to a finished thing.
      </p>
      <p>
        BitGraph inverts the order: the position exists before the file&rsquo;s digest is known to the boundary. There is no operation that produces a valid slot signature over a body containing a digest, so a position cannot be manufactured after the fact for bytes that are already in hand, and a position cannot be occupied twice. That is a claim about the position, not about the bytes: an old file can be committed today, and its position says nothing about when the bytes were made. Section 3 is how the bound reaches the bytes themselves.
      </p>

      <h2 id="boundary">2. What crosses the boundary</h2>
      <p>
        The enclave is a measured environment. Its image is identified by a hash, PCR0, that AWS computes at boot and that anyone can reproduce from the published source. The enclave&rsquo;s signing key is generated inside it and never leaves. Every proof carries an attestation document, signed by the Nitro hardware, whose user data is the hash of that proof&rsquo;s signed body. A verifier who pins the published PCR0 is therefore checking not only that some key signed the proof but that the key belonged to that specific code.
      </p>
      <p>
        The file itself never crosses. On the public site, in the MCP server and in the SDK the file is hashed where it is, and a 59-byte request carrying one digest is the only thing that mentions it. That is a property of each client rather than of the protocol: a client can send whatever it likes, and a verifier should read the client&rsquo;s source if it matters. The service sees the requester&rsquo;s address and the digest, and publishes the digest, the position and the anchors. It never sees the file.
      </p>
      <div className="callout is-limit">
        <span className="kicker">The limit of this claim</span>
        <p>
          A position is held for up to 120 seconds, and a caller can hold several open at once and decide which file fills which. What the enclave signs is that it issued the position before it received the digest, and then bound the two. It does not sign that the position was chosen in ignorance of the file. Ordering between proofs comes from the previous-proof hash and the counters, so the gaps that abandoned positions leave cost nothing.
        </p>
      </div>

      <h2 id="fused">3. Carrying the position inside the bytes</h2>
      <p>
        Recording an existing file, as in section 1, bounds the placement: those exact bytes existed no later than the commit. It says nothing about whether the bytes could have existed before the slot. The default operation on this site, in the SDK and in the MCP server goes one step further and builds a new file around the original that contains a commitment to the slot.
      </p>
      <FusedFigure />
      <p>
        The producer asks for a slot, derives a 32-byte commitment from the signed slot record, writes that commitment into a new file alongside the unchanged original, hashes the new file, and commits its digest under the same slot. The new bytes name the slot and the slot names the new bytes. Since the commitment is a function of a record that did not exist until the slot was allocated, the new file could not have been finished before that moment, and the anchor signed into the slot record puts a public time under it. The proof&rsquo;s signed attribution field carries the marker: the label <code>bitgraph-fuse/1</code>, the placement used, and the digest of the original.
      </p>
      <p>
        The original is never modified and the new file need not be kept: the original plus the proof rebuilds it byte for byte, and checking that reconstruction against the committed digest is the evidence. Two or more files made together become one set under one slot, with each file a member that keeps its own row and inclusion path. What this bound does not do is reach the original&rsquo;s content: the original can be any age, and the proof says only that it existed no later than the commit. The <Link href="/docs/proof-format#fused">proof format</Link> page has the byte-level placements.
      </p>

      <h2 id="time">4. Where time comes from</h2>
      <p>
        Nothing inside the sequence is a clock. Counters and previous-proof hashes give a total order within an epoch, and that order needs no time to be checked. Wall-clock statements come from outside, from Ethereum, which BitGraph reads and never writes to.
      </p>
      <AnchorFigure />
      <p>
        An <em>anchor</em> is an ordinary position whose file is the hash of a recent Ethereum block, committed by the same enclave, on the same sequence, with the same key. The enclave accepts an anchor only from an anchor service whose signature it verifies against a key baked into its image, and it records the block number and hash in the signed body. A block hash cannot be known before its block is mined, so an anchor, and everything the sequence placed after it, came after that block.
      </p>
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
        BitGraph assumes the boundary can be compromised and bounds the damage rather than claiming it cannot happen. The signing key exists only in enclave memory. Every restart destroys it and begins a new <em>epoch</em> with a fresh key and a counter at zero.
      </p>
      <EpochFigure />
      <p>
        Proofs from a closed epoch were signed by a key that no longer exists anywhere, so a compromise cannot reach backward. Forgery within the live epoch requires more than stealing a key: every proof carries an attestation whose user data is the hash of that exact proof, and only the enclave&rsquo;s hardware module can produce one, so a useful breach must execute inside the running enclave and dies at the next restart. Every proof names its epoch permanently, so a suspect window is identified exactly: the affected epoch is published as quarantined and every other epoch is untouched. What this does not give is detection: a perfect forger inside the enclave during its epoch mints proofs that verify. The <Link href="/docs/trust-model">trust model</Link> lists what is prevented, what is detected, and what is neither.
      </p>
      <p>
        Epochs cannot be chained by signature, because no key ever witnesses both sides of the boundary; the old key is destroyed on purpose. What orders one epoch against another is the anchors: if one epoch&rsquo;s last anchor names block N and the next epoch&rsquo;s first anchor names a later block, the first ran first, and anyone can check that against Ethereum without trusting either enclave. The resolution of that order is the anchor cadence. Two enclaves run by different operators would be two unrelated sequences, related to each other in the same way and no other.
      </p>

      <h2 id="contains">What a proof contains</h2>
      <div className="table-scroll">
        <table className="table-k">
          <thead><tr><th>Field</th><th>What it establishes</th></tr></thead>
          <tbody>
            <tr><td>artifact.digestB64</td><td>The exact bytes the proof is about. Any change to the file changes it.</td></tr>
            <tr><td>slotAllocation</td><td>The slot record: nonce, counter, epoch, key, signature. Made before any digest was received.</td></tr>
            <tr><td>commit.slotCounter, commit.counter</td><td>The slot&rsquo;s position and the commit&rsquo;s. The first is always smaller.</td></tr>
            <tr><td>commit.slotHashB64</td><td>Hash of the slot record, inside the signed body, so the slot cannot be swapped.</td></tr>
            <tr><td>commit.prevB64</td><td>Hash of the previous proof on the sequence: the link that makes the order checkable.</td></tr>
            <tr><td>commit.slotAnchor</td><td>The Ethereum block the floor rests on, signed into the slot record.</td></tr>
            <tr><td>signer, environment</td><td>The enclave&rsquo;s key and signature, its PCR0 measurement, and its hardware attestation over this body.</td></tr>
            <tr><td>attribution</td><td>Signed. On a fused file: the marker, the placement, the original&rsquo;s digest.</td></tr>
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
