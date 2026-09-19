import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Trust model",
  description:
    "What a BitGraph proof assumes, what it guarantees and under which assumptions, what an attacker is prevented from doing, what is only detected, what is neither, what a verifier is responsible for, and what has not been independently reviewed.",
};

/**
 * For the sceptical evaluator. Assumptions, guarantees by class, the threat
 * model in three lists, privacy exposures, and the verifier's duties. Limits
 * sit next to the claims they qualify.
 */
export default function TrustModelPage() {
  return (
    <article className="prose">
      <h1>Trust model</h1>
      <p className="lede">
        This page is for the reader who wants to know exactly what enforces each claim and what happens when an assumption fails. It is organised so the limits can be found without reading everything: what is trusted, what is assumed, what is guaranteed and by what, what an attacker is prevented from doing, what is only detected, what is neither, and what the verifier has to do for any of it to hold.
      </p>

      <h2 id="trusted">What is trusted, and what is not</h2>
      <div className="home-two">
        <div>
          <h3>Trusted</h3>
          <ul>
            <li>The enclave image identified by its PCR0 measurement, which is published and reproducible from source.</li>
            <li>The AWS Nitro hardware root of trust and its security module, which draws the entropy and signs the attestations.</li>
            <li>The AWS Nitro Root CA G1, embedded in the verifier as a constant.</li>
            <li>Ed25519 and SHA-256.</li>
            <li>The verifier&rsquo;s own execution, on the reader&rsquo;s machine.</li>
          </ul>
        </div>
        <div>
          <h3>Not trusted</h3>
          <ul>
            <li>The EC2 host the enclave runs on. It is a transport.</li>
            <li>The network, this website, and the anchor service.</li>
            <li>BitGraph&rsquo;s copy of proofs and anchors. It is a convenience under a compliance lock, not the evidence.</li>
            <li>The client that hashes the file, including this site&rsquo;s own page. A client can hash whatever it likes.</li>
            <li>The operator, Argento Computing Inc.</li>
          </ul>
        </div>
      </div>
      <p>
        The trust root is one vendor and one build: Amazon&rsquo;s hardware and the published enclave image. Accepting that root is a one-time decision by the reader, not an ongoing dependency. After it, a proof stands on its own, in as many copies as it is made, with nothing of BitGraph&rsquo;s required to be online. The word for that is portable and independently verifiable, not decentralised.
      </p>

      <h2 id="assumptions">Assumptions, and what fails with them</h2>
      <div className="table-scroll">
        <table>
          <thead><tr><th>Assumption</th><th>If it fails</th></tr></thead>
          <tbody>
            <tr><td className="k">Boundary isolation</td><td>If the enclave&rsquo;s memory or key can be read from outside, every guarantee under that epoch&rsquo;s key collapses. Earlier epochs are untouched: their keys no longer exist.</td></tr>
            <tr><td className="k">Honest measurement</td><td>If the hardware misreports PCR0, an image other than the published one could pass as it. This is delegated to the vendor and is why the root is Amazon&rsquo;s.</td></tr>
            <tr><td className="k">Reproducible build</td><td>If the pinned build stops reproducing the published PCR0, the measurement means only &ldquo;some image AWS measured&rdquo;. The build pins every input and can be checked by anyone; a lapse is a defect to report.</td></tr>
            <tr><td className="k">Nonce freshness</td><td>A predictable or repeated nonce would let a position be precomputed or replayed within an epoch. The nonce is 32 bytes from the hardware generator.</td></tr>
            <tr><td className="k">Monotonic counter</td><td>If the counter repeated or moved backward within an epoch, positions inside it would be ambiguous. The counter is per chain, single-threaded, and in enclave memory.</td></tr>
            <tr><td className="k">Slot before digest</td><td>If a slot could be minted after a digest was known, the position would be a label. The slot body has no field for a digest and is signed at allocation; the commit signature covers its hash.</td></tr>
            <tr><td className="k">Honest Ethereum block times</td><td>The floor is the time in a block header. If block times were wrong, the floor would be too. A reorganisation near an anchor orphans its block; the witness check then fails and that bound is lost rather than silently wrong.</td></tr>
            <tr><td className="k">A strict verifier policy</td><td>A verifier that accepts any measurement, or skips the attestation, has verified a signature by an unknown key. Everything below the cryptographic class depends on the reader pinning PCR0.</td></tr>
          </tbody>
        </table>
      </div>

      <h2 id="guarantees">What is guaranteed, by class</h2>
      <p>Each class names what it assumes and what weakens it. They are not interchangeable, and a verifier that checks one has not checked the others.</p>
      <dl className="terms">
        <dt>Cryptographic</dt>
        <dd>The Ed25519 signature is valid over the canonical signed body under the proof&rsquo;s public key. Assumes the security of Ed25519 and SHA-256 and correct canonicalisation. Trusts nothing beyond the mathematics and the reconstruction logic.</dd>
        <dt>Causal ordering</dt>
        <dd>A slot existed, signed and without a digest, before this digest was bound to it. Assumes the boundary is uncompromised and is the published image. Weakened to &ldquo;some key asserted this&rdquo; by any verifier that does not pin the measurement.</dd>
        <dt>Sequence</dt>
        <dd>This proof occupies a position linked to its predecessor by the previous-proof hash, within a named epoch. Assumes the reader holds the neighbouring proofs to check the links. Counters alone do not establish order across a gap.</dd>
        <dt>Integrity</dt>
        <dd>Every field in the signed body is tamper-evident. <code>metadata</code>, <code>timestamps</code> and <code>claims</code> sit outside the signature and are advisory; the attestation, the agency envelope and the slot record are outside it but self-authenticating.</dd>
        <dt>Exact bits</dt>
        <dd>The proof is about one byte sequence. Any transformation that changes a byte produces a file the proof does not cover.</dd>
        <dt>Privacy</dt>
        <dd>Only the digest is committed. Assumes the client hashes locally, which is true of this site, the SDK and the MCP server and is a property of each client, not of the protocol. Recording is not private: the digest, the position and the anchors are published.</dd>
        <dt>Portability</dt>
        <dd>Verification is offline and requires no BitGraph service. The one external reference is that the anchored block is canonical Ethereum, checkable against any node or explorer.</dd>
        <dt>Temporal</dt>
        <dd>One direction. The position was placed after the block its slot record names was mined: a floor that needs no trust in the anchor service, because a block hash cannot precede its block. The position also preceded the next anchor in the chain: a ceiling in position, which does not convert to a wall-clock bound and is not claimed as one.</dd>
        <dt>Attestation</dt>
        <dd>The Nitro document&rsquo;s user data equals SHA-256 of this proof&rsquo;s signed body, and the document chains to the AWS Nitro Root CA G1. Assumes the reader parses and validates it; the core verifier deliberately leaves that to the audit package.</dd>
        <dt>Deployment</dt>
        <dd>Proofs from the public service carry <code>enforcement: &quot;measured-tee&quot;</code> and the published PCR0. BitGraph&rsquo;s copy is under a ten-year compliance lock, so the operator cannot delete what it holds. That is an operational fact about this deployment, not a protocol guarantee.</dd>
      </dl>

      <h2 id="threats">Threats</h2>
      <h3>Prevented: impossible without breaking an assumption above</h3>
      <ul>
        <li><strong>Retroactive slot fabrication.</strong> No operation produces a slot signature over a body containing a digest.</li>
        <li><strong>Double consumption.</strong> The slot is deleted synchronously on lookup; the event loop is single-threaded.</li>
        <li><strong>Slot swapping.</strong> The slot record&rsquo;s hash is inside the signed body.</li>
        <li><strong>Forgery under a closed epoch&rsquo;s key.</strong> Keys live only in enclave memory and are destroyed at restart.</li>
        <li><strong>Silent epoch continuation.</strong> Initialisation is fail-closed; a genesis must be explicit.</li>
        <li><strong>Tampering with signed fields in transit.</strong> Any edit breaks the signature.</li>
        <li><strong>Downgrading the tier field.</strong> <code>enforcement</code> is signed.</li>
      </ul>
      <h3>Detected: possible, but leaves evidence</h3>
      <ul>
        <li><strong>Forked epochs.</strong> A verifier that has seen both successors of one predecessor rejects the second. The registry is per verifier process, so a fork whose branches are never seen together is not detected; this is detection, not prevention.</li>
        <li><strong>Rollback of the chain.</strong> A replayed predecessor produces two proofs naming the same previous hash, which the audit tool reports.</li>
        <li><strong>Substitution or backdating within a sequence.</strong> An entry cannot occupy a position earlier than the one it took.</li>
        <li><strong>Attestation failure.</strong> Reported by the audit tool, never silently ignored.</li>
      </ul>
      <h3>Neither prevented nor reliably detected</h3>
      <ul>
        <li><strong>Compromise of the boundary or its key.</strong> Forged proofs under that epoch&rsquo;s identity are indistinguishable from real ones. The damage is contained to one epoch, identified permanently by its identifier, and recovered by quarantining it. It is not retroactively repairable.</li>
        <li><strong>A malicious client.</strong> It hashes whatever it wants; BitGraph positions that digest faithfully.</li>
        <li><strong>A compromised build pipeline.</strong> Mitigated only by the reproducible build. If that lapses, PCR0 means &ldquo;some image AWS measured&rdquo;.</li>
        <li><strong>Measurement drift.</strong> A legitimate rebuild changes PCR0. Verifiers pinning the old value reject valid proofs; there is no automated allowlist distribution, so a reader obtains the current measurement out of band.</li>
        <li><strong>A malicious operator.</strong> Can refuse service, decline to anchor, or lose its copy. Cannot forge or, given the compliance lock, delete what the copy holds.</li>
        <li><strong>Anchor censorship or outage.</strong> Ordering within an epoch survives; temporal bounds degrade to one-sided or absent. Across epochs, anchors are the only common reference, so a sustained outage leaves a new epoch unrelatable to the old one by public evidence.</li>
        <li><strong>Collusion among independent boundaries.</strong> Two enclaves are two sequences with no global order. The protocol does not arbitrate between them.</li>
        <li><strong>Omission.</strong> A record that was never made leaves no trace. Counter gaps are expected, so a gap never shows an omission; only an external expectation of what should be there can.</li>
        <li><strong>A malicious verifier.</strong> It can lie to its own user. The mitigation is that anyone can repeat the verification.</li>
        <li><strong>Denial of service.</strong> Rate limits exist at the host and are not a security boundary.</li>
      </ul>

      <h2 id="privacy">Privacy exposures</h2>
      <ul>
        <li><strong>Public digests.</strong> Every recorded digest, position and anchor is published, permanently.</li>
        <li><strong>Dictionary confirmation.</strong> Digests are not salted. For a low-entropy file, such as a short document from a known template, anyone can hash candidates and confirm whether one was recorded. State this to anyone with sensitive low-entropy content.</li>
        <li><strong>Correlation.</strong> Recording many files from one workflow leaves an adjacency pattern in the counters, even though contents do not.</li>
        <li><strong>Operator visibility.</strong> The host sees source addresses and digests.</li>
        <li><strong>Attribution is permanent.</strong> The signed attribution field, and any metadata a client attaches, cannot be removed later. Put nothing private there.</li>
        <li><strong>No deletion.</strong> The lock on BitGraph&rsquo;s copy applies to everyone, including the operator.</li>
      </ul>

      <h2 id="verifier">What a verifier is responsible for</h2>
      <ol className="steps">
        <li><strong>Pin the measurement.</strong> Set <code>allowedMeasurements</code> to the PCR0 you accept and require <code>measured-tee</code>. The published value is <code className="break">eccfc1c78006f4b74f929c992785575c908a0f60eca08ff638cd6c0842f993f182ebb002457b8ef3e732a6a10805c72b</code>, and you can rebuild it yourself.</li>
        <li><strong>Require and validate the attestation.</strong> The core verifier does not parse it; the audit package does, chaining to the embedded Nitro root and checking user data against the signed body.</li>
        <li><strong>Check the artifact binding.</strong> A result whose <code>artifactBinding</code> is <code>not-checked</code> has not tied the proof to any file.</li>
        <li><strong>Hold the neighbours for chain claims.</strong> Order across a gap is not established by counters alone.</li>
        <li><strong>Hold both anchors and their witnesses for temporal claims.</strong> The floor needs the block header; the ceiling needs the following anchor. An export includes both.</li>
        <li><strong>Treat unsigned fields as advisory.</strong> <code>metadata</code>, <code>timestamps</code> and <code>claims</code> are never evidence.</li>
        <li><strong>Refuse debug enclaves.</strong> A measurement of all zeros means a debug-mode enclave; treat its proofs as software tier.</li>
      </ol>

      <h2 id="review">Review status</h2>
      <p>
        The properties above are argued from the published source and from the reproducible measurement. The implementation has not had an independent security audit. In particular, single-use consumption under concurrency is argued from the runtime&rsquo;s single-threaded event loop rather than tested adversarially, and fork detection is per verifier process. Anyone evaluating BitGraph for a setting where these matter should read the source, rebuild the measurement, and run the negative cases against the verifier before relying on it.
      </p>

      <h2 id="next">Where next</h2>
      <ul className="doors">
        <li><Link href="/docs/what-bitgraph-is-not">Limits</Link><span>The non-claims, stated one by one.</span></li>
        <li><Link href="/docs/self-host-tee">Self-host a TEE</Link><span>Rebuild the enclave image and confirm the published PCR0 yourself.</span></li>
        <li><Link href="/docs/verification">Verification</Link><span>The checks, the results, and what they cannot conclude.</span></li>
        <li><Link href="/docs/audit">Audit a bundle</Link><span>Check many proofs, their order and their anchors, offline.</span></li>
      </ul>
    </article>
  );
}
