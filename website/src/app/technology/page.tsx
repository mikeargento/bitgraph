import type { Metadata } from "next";
import { CopyCode } from "@/components/copy-code";
import { PUBLISHED_PCR0 } from "@/lib/enclave-measurements";

/**
 * Technology (2026-10-27): the mechanism, for a CTO or security architect, from the code. Sources: the v13 enclave
 * (server/commit-service/src/enclave/app.ts, the enclave-v13 branch), the verifier (packages/verify: attested.ts,
 * verifier.ts, stretch.ts, nitro.ts, tree-member.ts, ceiling.ts), the host (parent/server.ts, rate-limit.ts) and the
 * build pins (server/commit-service/reproducible-build/PINS.md). A claim that is not in that code is not on this page.
 */
export const metadata: Metadata = {
  title: "Technology",
  description: "How BitGraph records: one atomic action inside a measured AWS Nitro enclave binds a fresh hardware nonce and a SHA-256 at consecutive counts, signed, attested, chained, and checkable offline. The guarantees, the threat model, and how it compares.",
};

function Code({ children }: { children: string }) {
  return (
    <div className="code-block mk-code">
      <pre className="hiw-code">{children}</pre>
      <CopyCode />
    </div>
  );
}

const SECTIONS = [
  ["t-proves", "What it establishes"],
  ["t-mech", "The mechanism"],
  ["t-atomic", "Atomic by construction"],
  ["t-seq", "The sequence"],
  ["t-attest", "The measured enclave"],
  ["t-time", "Time"],
  ["t-trees", "Collections"],
  ["t-format", "The proof"],
  ["t-verify", "Verification"],
  ["t-threat", "Threat model"],
  ["t-trust", "What you trust"],
  ["t-compare", "Comparisons"],
] as const;

export default function TechnologyPage() {
  return (
    <div className="frame home home-typing prose home-scroll docs-page tools-page sx-page">
      <div className="home-hero"><h1 className="sr-only">Technology.</h1></div>

      <section className="home-section" aria-labelledby="t-intro">
        <p className="home-kicker">Technology</p>
        <h2 id="t-intro">One atomic action, inside measured&nbsp;hardware.</h2>
        <p>
          A BitGraph is made inside an AWS Nitro enclave running a published, reproducible build. In one indivisible step the enclave
          takes two consecutive counts of its sequence: a fresh nonce from the hardware&rsquo;s random number generator at the first,
          the SHA-256 of your data at the second. Both are signed together, attested by the hardware, and chained to the record before.
          The result is a small JSON proof anyone can check offline.
        </p>
        <p>The content itself never reaches BitGraph. Only its 32-byte digest does.</p>
      </section>

      <div className="tl-body">
        <nav className="tl-toc" aria-label="On this page">
          <p className="tl-label">On this page</p>
          <ul>{SECTIONS.map(([id, t]) => <li key={id}><a href={`#${id}`}>{t}</a></li>)}</ul>
        </nav>

        <div className="tl-main">
          <section className="home-section" aria-labelledby="t-proves">
            <p className="home-kicker">What it establishes</p>
            <h2 id="t-proves">Three statements, each checkable.</h2>
            <ol className="tl-steps">
              <li><strong>Position.</strong> These exact bytes, by SHA-256, were bound at count N+1 of one enclave&rsquo;s sequence, immediately after a fresh hardware nonce at count N, in a single signed action. Nothing was counted between them, and no count is ever given out twice.</li>
              <li><strong>Origin of the record.</strong> The binding was performed by a specific enclave build whose measurement (PCR0) is published, as AWS Nitro hardware attests in a document signed for that exact proof.</li>
              <li><strong>Time.</strong> The binding happened by the time in the hardware&rsquo;s signed attestation. Through bitgraph.ing it also falls inside a window of public time: after a named Base block, and before the block where the proof&rsquo;s hash was written.</li>
            </ol>
            <h3 className="tl-h3">What it does not establish</h3>
            <ul className="docs-list">
              <li><strong>When the content was created.</strong> An old file can be bound today. The proof fixes when it was bound.</li>
              <li><strong>Who made it, or whether it is true.</strong> It binds bytes, not authorship or meaning.</li>
              <li><strong>That nothing else exists.</strong> It proves a record was made, not that no other record was.</li>
              <li><strong>Order across epochs</strong> from the enclave alone. Each epoch is its own sequence; epochs are placed in time by Base, not by each other.</li>
            </ul>
          </section>

          <section className="home-section" aria-labelledby="t-mech">
            <p className="home-kicker">The mechanism</p>
            <h2 id="t-mech">What happens when a digest arrives.</h2>
            <ol className="tl-steps">
              <li><strong>Gate.</strong> The enclave refuses to bind until the host has initialised it, and accepts only a canonical 32-byte SHA-256.</li>
              <li><strong>Nonce.</strong> 32 bytes are drawn from the Nitro Secure Module&rsquo;s hardware RNG, after the digest arrives and inside the enclave. Nobody, the host included, sees it before the proof is released.</li>
              <li><strong>Count N: the slot.</strong> A slot record (nonce, count N, epoch, key) is signed with the enclave&rsquo;s Ed25519 key and hashed.</li>
              <li><strong>Count N+1: the content.</strong> The commit names the digest, count N+1, the slot&rsquo;s count and hash, the epoch, and the hash of the previous proof.</li>
              <li><strong>Attest, then sign.</strong> The hardware is asked for an attestation whose user data is the SHA-256 of the canonical signed body; the body is then signed.</li>
              <li><strong>Advance.</strong> Only now does the counter move to N+1 and the chain hash update. The proof is released.</li>
            </ol>
            <p>
              Why the nonce: it is what makes the position its own. Because it is drawn after the digest arrives, a position cannot be
              reserved in advance and filled later, and every proof carries a value no one could have known before it existed. Work made
              from one BitGraph&rsquo;s published nonce could not have existed before that BitGraph, which is how two BitGraphs bracket
              work between them.
            </p>
          </section>

          <section className="home-section" aria-labelledby="t-atomic">
            <p className="home-kicker">Atomic by construction</p>
            <h2 id="t-atomic">There is no partial state.</h2>
            <p>
              Every step that can fail (the random draw, the signature, the attestation) comes before the counter moves. If any fails,
              nothing is released, the counter stays where it was, and the drawn nonce is discarded without ever leaving the enclave.
              Requests are serialised inside the enclave, so two binds cannot interleave.
            </p>
            <p className="sx-fine">
              Tested on the unmodified enclave code with injected faults in the RNG, the signer and the attestation:{" "}
              <code>server/commit-service/src/enclave/__tests__/bind-failure.test.ts</code>.
            </p>
          </section>

          <section className="home-section" aria-labelledby="t-seq">
            <p className="home-kicker">The sequence</p>
            <h2 id="t-seq">Counted, chained, gaps visible.</h2>
            <p>
              Every proof after an epoch&rsquo;s first carries <code>prevB64</code>, the SHA-256 of the whole previous proof. Within an
              epoch the counts climb by two per BitGraph, nonce then content. Given a run of proofs, the verifier checks that each is
              atomic, that counts are consecutive and that each links to the one before; a missing proof shows as a gap
              (<code>verifyStretch</code>). Anything bound between BitGraph A and BitGraph B was bound after A and before B
              (<code>verifyBetween</code>).
            </p>
            <h3 className="tl-h3">Epochs</h3>
            <p>
              The enclave&rsquo;s key and counter live only in its memory, so each start is a new epoch: a new key, a counter from zero,
              and an <code>epochId</code> signed into every proof. Epochs are independent sequences. Each one&rsquo;s first BitGraph
              binds a record of the Base blockchain, which places that epoch&rsquo;s start in public time.
            </p>
          </section>

          <section className="home-section" aria-labelledby="t-attest">
            <p className="home-kicker">The measured enclave</p>
            <h2 id="t-attest">The hardware names the code that made each proof.</h2>
            <p>
              Each proof carries an AWS Nitro attestation document, signed by AWS&rsquo;s hardware (ES384, certificate chain to the AWS
              Nitro root). It states the enclave image&rsquo;s measurement, PCR0, and carries as its user data the SHA-256 of the exact
              signed body of that proof. The signing key is generated inside the enclave at start and never exported; it is tied to the
              hardware through that per-proof attestation.
            </p>
            <p>The current image, v13, measures:</p>
            <p className="sx-mono">{PUBLISHED_PCR0}</p>
            <p>
              It is reproducible: two independent builds from the <code>enclave-v13</code> branch produced this PCR0. (The image file
              itself differs build to build because its header holds a build time; the measurement does not.) Every published image back
              to the first is listed in the verifier, and only those are accepted by default.
            </p>
          </section>

          <section className="home-section" aria-labelledby="t-time">
            <p className="home-kicker">Time</p>
            <h2 id="t-time">The hardware&rsquo;s clock, then a public window.</h2>
            <p>
              The enclave adds no clock of its own. The time in a proof is the attestation&rsquo;s timestamp, set and signed by the AWS
              Nitro Secure Module.
            </p>
            <p>Through bitgraph.ing, every BitGraph is also placed in the time of a public chain BitGraph does not operate:</p>
            <ul className="docs-list">
              <li><strong>Floor.</strong> The latest Base block is read just before the bind and bound with it (in a collection, as its first leaf). A block hash cannot be known before its block exists.</li>
              <li><strong>Ceiling.</strong> After the bind, the proof&rsquo;s hash is batched into a Merkle root and written to Base in a self-addressed transaction. The proof existed by that block.</li>
            </ul>
            <p>No blockchain is needed to verify a proof. Base is only needed to check the floor and ceiling claims.</p>
          </section>

          <section className="home-section" aria-labelledby="t-trees">
            <p className="home-kicker">Collections</p>
            <h2 id="t-trees">A million files, one BitGraph.</h2>
            <p>
              Many items are recorded at once as an RFC 6962 Merkle tree over their SHA-256s (leaf = SHA-256(0x00 ‖ digest), node =
              SHA-256(0x01 ‖ left ‖ right)). One BitGraph binds a short text naming the root and the count. Each item then proves its
              own inclusion with a path of sibling hashes, without the others being disclosed. The format allows up to 1,000,000 items in
              a tree.
            </p>
            <p className="sx-fine">
              Measured 2026-10-12, two runs: one million synthetic files hashed in 4.2 to 4.4 s on an 8-core Apple M3 laptop, and the
              proof back 10.5 to 16 s after the drop. Those runs used an earlier bind flow; the current one has not yet been benchmarked
              at that size.
            </p>
          </section>

          <section className="home-section" aria-labelledby="t-format">
            <p className="home-kicker">The proof</p>
            <h2 id="t-format">Small, self-contained JSON.</h2>
            <Code>{`{
  "version": "bitgraph/1",
  "artifact":  { "hashAlg": "sha256", "digestB64": "…" },
  "commit": {
    "nonceB64": "…", "counter": "16", "slotCounter": "15", "slotHashB64": "…",
    "epochId": "…", "atomic": true, "prevB64": "…", "chainId": "bitgraph:main"
  },
  "signer":      { "publicKeyB64": "…", "signatureB64": "…" },
  "environment": { "enforcement": "measured-tee", "measurement": "<PCR0>",
                   "attestation": { "format": "aws-nitro", "reportB64": "…" } },
  "slotAllocation": { "version": "bitgraph/slot/1", "nonceB64": "…", "counter": "15", … }
}`}</Code>
            <p className="sx-fine">
              The signature covers a canonical serialisation of the body. A collection member also carries its inclusion path, as
              unsigned metadata that is checked, not trusted. <a href="/evaluate/sample.txt.bitgraph.json" download>Download a real proof</a>, or <a href="/evaluate">verify it</a>.
            </p>
          </section>

          <section className="home-section" aria-labelledby="t-verify">
            <p className="home-kicker">Verification</p>
            <h2 id="t-verify">Offline, with an open verifier.</h2>
            <p>The verifier is MIT-licensed. It needs the data, the proof, and nothing of BitGraph&rsquo;s running:</p>
            <Code>{`npx @mikeargento/bitgraph-sdk verify <file> --proof <file>.bitgraph.json --pcr0 ${PUBLISHED_PCR0}`}</Code>
            <ol className="tl-steps">
              <li>The attestation verifies: AWS signature, certificate chain to the pinned Nitro root, PCR0 equal to the proof&rsquo;s measurement, user data equal to the hash of the proof&rsquo;s signed body.</li>
              <li>The PCR0 is a published image the verifier accepts.</li>
              <li>For a collection member, the data&rsquo;s hash walks up its path to the bound root.</li>
              <li>The data&rsquo;s SHA-256 matches the digest; the Ed25519 signature over the canonical body checks.</li>
              <li>The slot record checks: its own signature, the same nonce, key and epoch, and content at exactly the slot&rsquo;s count plus one.</li>
            </ol>
            <p className="sx-fine">
              A key anyone can generate can sign a body that passes a signature check alone. It fails the attested check, because no AWS
              document covers it. The verifier&rsquo;s own test does exactly this: <code>packages/verify/src/__tests__/attested.test.ts</code>.
            </p>
          </section>

          <section className="home-section" aria-labelledby="t-threat">
            <p className="home-kicker">Threat model</p>
            <h2 id="t-threat">What each party can and cannot do.</h2>
            <div className="sx-table-wrap">
              <table className="sx-table">
                <thead><tr><th>Party</th><th>Cannot</th><th>Can</th></tr></thead>
                <tbody>
                  <tr>
                    <td>The host operator (BitGraph included)</td>
                    <td>Forge a proof that passes the attested check; see or choose a nonce; reuse a count; insert or reorder proofs inside a sequence without breaking the counts and hash links; change a proof&rsquo;s attested time by releasing it late.</td>
                    <td>Choose the order in which it submits digests; delay or refuse submissions; withhold released proofs (gaps then show to anyone holding the neighbours); restart the enclave to begin a new epoch; choose which recent Base block is read as the floor; decline to write ceilings.</td>
                  </tr>
                  <tr>
                    <td>A client</td>
                    <td>Get a position without binding a digest; get its digest bound at a count of its choosing.</td>
                    <td>Bind any 32-byte digest, including one of content it does not own. Binding says nothing about authorship.</td>
                  </tr>
                  <tr>
                    <td>Someone holding a proof</td>
                    <td>Edit any signed field, swap the digest, the counter, the previous-proof link or the measurement, without the check failing.</td>
                    <td>Withhold it, or show it out of context. A proof shows its own position, not what else was bound.</td>
                  </tr>
                  <tr>
                    <td>A stolen enclave key</td>
                    <td>Pass the attested check. Keys are per epoch and live only in enclave memory.</td>
                    <td>Sign bodies that pass a signature-only check. Always verify with attestation.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section className="home-section" aria-labelledby="t-trust">
            <p className="home-kicker">What you trust</p>
            <h2 id="t-trust">The hardware root, the published build, standard cryptography.</h2>
            <ul className="docs-list">
              <li><strong>AWS Nitro.</strong> The Secure Module&rsquo;s RNG, clock and attestation key, and the Nitro root certificate. A flaw in Nitro is a flaw in every proof.</li>
              <li><strong>The enclave image.</strong> Its source is public on the <code>enclave-v13</code> branch and its measurement reproduces, so what it does can be read and rebuilt rather than taken on trust.</li>
              <li><strong>SHA-256, Ed25519, ES384.</strong></li>
            </ul>
            <p>
              Not trusted: BitGraph&rsquo;s website, its servers, its storage, or its word. A proof that checks offline against the
              published measurement checks whether or not BitGraph is still running.
            </p>
          </section>

          <section className="home-section" aria-labelledby="t-compare">
            <p className="home-kicker">Comparisons</p>
            <h2 id="t-compare">Where it differs, and where it fits beside.</h2>
            <p>
              These systems answer different questions, and most products combine several. The aim here is the difference in what is
              enforced, not a ranking.
            </p>
            <div className="sx-table-wrap">
              <table className="sx-table">
                <thead><tr><th>System</th><th>What it proves</th><th>What you trust</th><th>Where BitGraph differs or fits</th></tr></thead>
                <tbody>
                  <tr><td>Digital signature</td><td>A key holder signed these bytes.</td><td>The key holder, and whoever holds the key.</td><td>Says nothing about when, or where in any sequence. A BitGraph is a signature made by attested hardware at a counted position.</td></tr>
                  <tr><td>Timestamp authority (RFC 3161)</td><td>A TSA signed this hash with this time.</td><td>The TSA&rsquo;s key, clock and honesty; it could issue a token with any time.</td><td>BitGraph&rsquo;s issuer is measured hardware whose code is published, its time is the hardware&rsquo;s, and its records are counted and chained. A product can carry both.</td></tr>
                  <tr><td>Transparency log (CT, Sigstore, SCITT)</td><td>An entry is included in an append-only log; consistency proofs expose rewrites to anyone monitoring.</td><td>The log operator&rsquo;s signing, plus monitors and witnesses.</td><td>The log proves inclusion after the fact; BitGraph constrains the issuing step itself inside an enclave. A BitGraph proof can itself be a log entry.</td></tr>
                  <tr><td>Blockchain anchoring</td><td>A hash existed by a block.</td><td>The chain&rsquo;s consensus.</td><td>Block time is coarse and each anchor costs a transaction. BitGraph proves each record at once and offline, and uses Base only for a batched public-time window.</td></tr>
                  <tr><td>Content Credentials (C2PA)</td><td>A signer made these assertions about an asset.</td><td>The signer&rsquo;s certificate, and its clock or TSA.</td><td>Complementary: binding the asset and its manifest gives the credential an independent recording.</td></tr>
                  <tr><td>Remote attestation alone</td><td>Certain code is running in an enclave.</td><td>The hardware vendor.</td><td>Attestation is the root; BitGraph is a specific mechanism on it that produces counted, chained, per-record evidence.</td></tr>
                </tbody>
              </table>
            </div>
          </section>

          <section className="home-section" aria-labelledby="t-next">
            <p className="home-kicker">Next</p>
            <h2 id="t-next">Check it yourself.</h2>
            <p>The evaluation guide walks through making a BitGraph, verifying it offline, and watching each kind of tampering fail.</p>
            <div className="sx-cta">
              <a className="bg-action-link is-make" href="/evaluate">Evaluate the technology</a>
              <a className="bg-action-link" href="/integrate">Integrate</a>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
