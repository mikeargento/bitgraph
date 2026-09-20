import type { Metadata } from "next";
import Link from "next/link";
import { StateFigure } from "@/components/figures/state-figure";

export const metadata: Metadata = {
  title: "The protocol",
  description:
    "BitGraph stated precisely: the terms, the lifecycle of one recording step by step, the invariants the enclave and the verifier enforce, the enforcement tiers, and what is a deployment choice rather than a protocol rule.",
};

/**
 * The formal statement. The overview tells the story; this page defines the
 * terms, lists the lifecycle, and states each invariant with what enforces it
 * and where the evidence is in the published source. It adds no narrative.
 */
export default function ProtocolPage() {
  return (
    <article className="prose">
      <h1>The protocol</h1>
      <p className="lede">
        BitGraph is a protocol with one operation: a measured trusted execution environment allocates an unpredictable, single-use slot, signs it while it holds no digest, and later binds a SHA-256 digest to that slot, consuming it and emitting a portable signed proof linked to its predecessor. The same operation applied to an Ethereum block hash produces an anchor. This page states that precisely, for readers who want the definitions rather than the story.
      </p>

      <h2 id="plain">Five things, five words</h2>
      <div>
        <p>
          Every claim on this site is made with these, and each has one name here: what stays on your machine, what crosses to the enclave, what exists there before it arrives, the step that binds the two, and what you keep afterward.
        </p>
        <dl className="terms">
          <dt>The record</dt>
          <dd>Any file: a trust record, a log, an evaluation result, a model output. BitGraph never receives it.</dd>
          <dt>The fingerprint</dt>
          <dd>The record&rsquo;s SHA-256 digest, 32 bytes. The only thing about the record that is sent. Change one byte and the fingerprint changes.</dd>
          <dt>The position</dt>
          <dd>A place in a signed sequence, allocated by the enclave before it has received any fingerprint. The protocol calls an allocated position a <em>slot</em>.</dd>
          <dt>The commit</dt>
          <dd>The single step that binds the fingerprint to the slot, consumes the slot, and signs the result. A slot can be consumed once, and never reused.</dd>
          <dt>The BitGraph</dt>
          <dd>Also called the proof: the signed result of that commit, returned to whoever asked. It carries the signed slot, both counters, the signature, a hardware attestation and the floor.</dd>
        </dl>
        <StateFigure />
      </div>

      <h2 id="terms">Terms</h2>
      <div className="table-scroll">
        <table className="table-k">
          <thead><tr><th>Term</th><th>Definition</th></tr></thead>
          <tbody>
            <tr><td>Artifact</td><td>The byte sequence a user records. Never transmitted to the protocol.</td></tr>
            <tr><td>Exact bits</td><td>The precise bytes, with no normalisation or re-encoding. Byte identity is the unit of every claim.</td></tr>
            <tr><td>Digest</td><td>SHA-256 of the exact bits, standard base64. The only representation of the artifact the protocol handles. Fields: <code>artifact.hashAlg</code>, <code>artifact.digestB64</code>.</td></tr>
            <tr><td>Slot</td><td>A signed record allocated inside the boundary: a fresh nonce, a counter, the epoch identifier, the boundary&rsquo;s public key, an optional chain identifier and the latest anchor (present since enclave v7, required since v8). It contains no artifact data. Schema <code>bitgraph/slot/1</code>.</td></tr>
            <tr><td>Nonce</td><td>32 bytes from the Nitro hardware random number generator, drawn at allocation. Its generation before any digest is received is the authorisation event.</td></tr>
            <tr><td>Allocation</td><td>Creating and signing a slot. Advances the chain counter by one.</td></tr>
            <tr><td>Unused</td><td>A slot present in the boundary&rsquo;s in-memory pending table and not yet consumed. Expires after 120 seconds.</td></tr>
            <tr><td>Binding</td><td>Placing the digest and the hash of the slot record in one canonical body, signed by the boundary&rsquo;s Ed25519 key.</td></tr>
            <tr><td>Consumption</td><td>Deleting the slot from the pending table, synchronously, at the start of commit handling. Irreversible within the epoch.</td></tr>
            <tr><td>Commit</td><td>Binding and consumption together with signing and attestation, as one indivisible step. Advances the counter by one more, so one recording spans two counter values.</td></tr>
            <tr><td>Counter</td><td>A per-chain monotonic integer carried as a decimal string and compared as a big integer.</td></tr>
            <tr><td>Previous link</td><td><code>commit.prevB64</code>: SHA-256 of the canonical form of the entire previous proof on the same chain.</td></tr>
            <tr><td>Chain</td><td>An ordered series of proofs sharing a chain identifier. The public sequence is <code>bitgraph:main</code>.</td></tr>
            <tr><td>Epoch</td><td>One enclave lifecycle: a fresh keypair at boot, a counter at zero, and a key that is destroyed at shutdown. One UTC day in production.</td></tr>
            <tr><td>Epoch identifier</td><td><code>epochId</code> = base64(SHA-256(public key + &quot;:&quot; + boot nonce)).</td></tr>
            <tr><td>Proof</td><td>A <code>bitgraph/1</code> object. See <Link href="/docs/proof-format">proof format</Link>.</td></tr>
            <tr><td>Boundary</td><td>The AWS Nitro enclave process. Holds the signing key, the random number generator, the counters and the slot table.</td></tr>
            <tr><td>Measurement</td><td>The enclave image identity, PCR0, signed into every proof as <code>environment.measurement</code>.</td></tr>
            <tr><td>Attestation</td><td>A document signed by the Nitro hardware whose user data is SHA-256 of this proof&rsquo;s canonical signed body. Per proof, not per boot.</td></tr>
            <tr><td>Anchor</td><td>A proof on the same chain whose digest is derived from a recent Ethereum block hash, with the block number and hash signed into <code>commit.anchor</code>.</td></tr>
            <tr><td>Floor</td><td>The block named by the anchor that preceded a slot&rsquo;s allocation, signed into the slot record as <code>commit.slotAnchor</code>. A lower bound in time.</td></tr>
            <tr><td>Ceiling</td><td>The next anchor in the chain after a commit. A bound in position; it does not convert to a clock reading.</td></tr>
            <tr><td>Anchor witness</td><td>An Ethereum block header, re-encoded and self-checked, that lets a verifier read a block&rsquo;s time offline after confirming its keccak-256 equals the anchored hash.</td></tr>
            <tr><td>Verifier</td><td>Any party holding a proof, optionally the bytes, and a trust policy. Verification is offline and deterministic.</td></tr>
            <tr><td>Enforcement tier</td><td><code>stub</code>, <code>hw-key</code> or <code>measured-tee</code>. Signed, self-reported, and not self-authenticating.</td></tr>
          </tbody>
        </table>
      </div>

      <h2 id="lifecycle">The lifecycle of one recording</h2>
      <p>Steps marked <span className="tag">[boundary]</span> run inside the enclave. Everything else runs on an untrusted machine.</p>
      <ol className="steps">
        <li><strong>Initialisation <span className="tag">[boundary]</span></strong>The enclave boots, generates an Ed25519 keypair in memory, draws a boot nonce, computes the epoch identifier and reads PCR0. In production every boot is a fresh genesis; an epoch is never continued from a predecessor.</li>
        <li><strong>Allocation <span className="tag">[boundary]</span></strong>On request, the enclave advances the chain counter, draws a 32-byte nonce, and signs the slot body: version, nonce, counter, epoch, public key, chain, latest anchor. The slot is stored as unused, keyed by nonce, with a 120-second lifetime and a ceiling of 1,000 pending slots.</li>
        <li><strong>Digest computation</strong>Outside the boundary, the client hashes the artifact. On this site, in the SDK and in the MCP server, the bytes never leave the client.</li>
        <li><strong>Commit <span className="tag">[boundary]</span></strong>The enclave looks the slot up and deletes it before any asynchronous work, advances the counter again, assembles the signed body with the digest, both counters, the slot record&rsquo;s hash and the previous link, adds <code>attestationFormat</code>, canonicalises, hashes, requests a Nitro attestation over that hash, and signs the same bytes with Ed25519. Attestation and signature therefore cover byte-identical input.</li>
        <li><strong>Linking <span className="tag">[boundary]</span></strong>The chain&rsquo;s stored last-proof hash becomes the hash of this proof, so the next proof&rsquo;s previous link names it.</li>
        <li><strong>Anchoring</strong>An external anchor service submits recent Ethereum block hashes. The enclave verifies the service&rsquo;s signature against a key baked into its image and commits each as an ordinary proof on the same chain.</li>
        <li><strong>Export</strong>The proof travels as a sidecar JSON file, optionally with the artifact, both bounding anchors and their block-header witnesses.</li>
        <li><strong>Verification</strong>Anyone repeats the checks offline. See <Link href="/docs/verification">verification</Link>.</li>
      </ol>
      <p>Two orderings cannot be rearranged. Steps 2 and 3 must complete before step 4 begins, and within step 4 the attestation must be taken over the same bytes the signature covers. Reordering either breaks the guarantee rather than weakening it.</p>

      <h2 id="invariants">Invariants</h2>
      <p>Each invariant names what enforces it in the published source and what its violation would look like. The verifier is <code>packages/verify/src/verifier.ts</code>; the enclave is <code>server/commit-service/src/enclave/app.ts</code>.</p>
      <div className="table-scroll">
        <table>
          <thead><tr><th>Invariant</th><th>Enforced by</th><th>A violation looks like</th></tr></thead>
          <tbody>
            <tr><td className="k">Allocation precedes the digest</td><td>The slot body has no field for artifact data and is signed at allocation; the commit signature covers <code>slotHashB64</code>.</td><td>A slot record carrying artifact-derived data, or a commit whose slot hash does not match the embedded slot.</td></tr>
            <tr><td className="k">Slot freshness</td><td>32 bytes from the hardware RNG per slot.</td><td>Two slots sharing a nonce.</td></tr>
            <tr><td className="k">Single consumption</td><td>The slot is deleted synchronously after lookup; the event loop is single-threaded.</td><td>Two proofs sharing <code>commit.nonceB64</code> in one epoch.</td></tr>
            <tr><td className="k">Digest binding</td><td><code>artifact.digestB64</code> is inside the signed body; verifiers recompute and compare in constant time.</td><td>A digest mismatch, or a verifier that reports valid without comparing.</td></tr>
            <tr><td className="k">Signature integrity</td><td>Ed25519 over deterministic canonical JSON: recursive key sort, compact, UTF-8.</td><td>Any divergence between the signed body and the body a verifier reconstructs.</td></tr>
            <tr><td className="k">Ordering within an epoch</td><td>A per-chain counter and the previous-proof hash chain.</td><td>A broken previous link, or two proofs naming the same predecessor.</td></tr>
            <tr><td className="k">Epoch isolation</td><td>A new keypair per boot; the counter resets; the epoch identifier is in the signed body.</td><td>A proof under a destroyed key, which cannot exist.</td></tr>
            <tr><td className="k">Exact-bit identity</td><td>SHA-256 over raw bytes; no canonicalisation of artifact content anywhere.</td><td>A verifier that decodes, re-encodes or strips metadata before hashing.</td></tr>
            <tr><td className="k">No transformation inside the boundary</td><td>The commit path receives a digest and cannot transform anything.</td><td>An output digest that differs from what the caller believes it recorded.</td></tr>
            <tr><td className="k">Portable verification</td><td><code>verify()</code> performs no network calls; anchors and witnesses can be bundled.</td><td>A verification step that silently requires a lookup.</td></tr>
            <tr><td className="k">Explicit anchor semantics</td><td>Anchors are ordinary proofs on the chain; temporal reasoning uses the bounding anchors.</td><td>A one-sided bound presented as a timestamp.</td></tr>
            <tr><td className="k">Content claims separated from path claims</td><td>No field asserts anything about content. <code>attribution</code> is a claim; <code>metadata</code> is unsigned.</td><td>Copy or a label implying verified truth or authorship.</td></tr>
          </tbody>
        </table>
      </div>
      <p>
        Counter gaps are normal. Allocation advances the counter, and a slot that expires unused leaves its value with no proof behind it. Ordering rests on the previous link, not on counter contiguity, so a gap never indicates a missing record. A missing record can only be shown against an external expectation of what should be there.
      </p>

      <h2 id="parameters">Deployment choices, not protocol rules</h2>
      <p>These are current values and could change without changing the protocol.</p>
      <ul>
        <li>Two counter increments per recording (allocation and commit).</li>
        <li>The 120-second slot lifetime and the 1,000-slot ceiling.</li>
        <li>Ethereum as the anchored chain, and the anchor cadence.</li>
        <li>AWS Nitro as the boundary. Another attested environment could serve; the schema names no platform.</li>
        <li>The daily restart at 23:59 UTC, which makes an epoch one calendar day.</li>
        <li>BitGraph&rsquo;s public copy of proofs and anchors, under a ten-year compliance lock. A strong operational property, and a deployment property rather than a protocol guarantee.</li>
      </ul>

      <h2 id="tiers">Enforcement tiers</h2>
      <div className="table-scroll">
        <table>
          <thead><tr><th>Tier</th><th>Key location</th><th>Commit gate</th><th>Meaning</th></tr></thead>
          <tbody>
            <tr><td><code>measured-tee</code></td><td>Enclave memory</td><td>Inside the measured boundary</td><td>Full causal enforcement. Production, and the only tier bitgraph.ing issues.</td></tr>
            <tr><td><code>hw-key</code></td><td>HSM or secure element</td><td>Outside the boundary</td><td>Hardware-bound identity without causal enforcement: the host feeds digests to the key.</td></tr>
            <tr><td><code>stub</code></td><td>Process memory</td><td>Software</td><td>Development and testing only.</td></tr>
          </tbody>
        </table>
      </div>
      <p>
        The tier is signed, which prevents downgrade in transit, but it is self-reported. A verifier that needs enclave guarantees pins <code>measurement</code> to a known image and validates the attestation, which a software tier cannot produce.
      </p>

      <h2 id="properties">Structural properties of the commit path</h2>
      <dl className="terms">
        <dt>One route</dt>
        <dd>Every proof corresponds to exactly one commit through the boundary. Bytes that did not pass through it cannot acquire a valid proof, however they were made.</dd>
        <dt>Closure</dt>
        <dd>The set of proofs is exactly the set produced by commits. There is no second route into it.</dd>
        <dt>Atomicity</dt>
        <dd>Consumption, binding, signing and attestation are one indivisible transition. There is no observable state in which a slot is partly consumed or a body is bound but unsigned.</dd>
        <dt>Uniqueness</dt>
        <dd>Each commit produces a distinct proof. The same bytes committed twice occupy two different positions, neither of which outranks the other.</dd>
      </dl>

      <h2 id="next">Where next</h2>
      <ul className="doors">
        <li><Link href="/docs/proof-format">Proof format</Link><span>Every field of a bitgraph/1 proof, with what is signed and what is not.</span></li>
        <li><Link href="/docs/trust-model">Trust model</Link><span>What is assumed, what is prevented, what is detected, and what is neither.</span></li>
        <li><Link href="/docs/verification">Verification</Link><span>The checks a verifier runs and what each result means.</span></li>
        <li><a href="https://github.com/mikeargento/bitgraph" target="_blank" rel="noopener">The source</a><span>The enclave, the verifier and the audit tool, readable and reproducible.</span></li>
      </ul>
    </article>
  );
}
