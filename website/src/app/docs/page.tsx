import type { Metadata } from "next";
import { CopyCode } from "@/components/copy-code";
import { PUBLISHED_PCR0 } from "@/lib/enclave-measurements";

/**
 * The docs, one page (Mike, 2026-10-17: "scrape the old docs and look for anything that would explain BitGraph in
 * this simple form and compress it into one new page called docs"). Mined from the seventeen pages removed in
 * 716a8407 (what-is-bitgraph, trust-model, verification, proof-format, what-bitgraph-is-not, faq, overview,
 * self-host-tee), keeping only what holds for the one primitive: two counts, one atomic action. Floors, ceilings,
 * anchors, Fuse, trees and exports are gone from here as they are from the product.
 *
 * Facts checked against the enclave source (server/commit-service/src/enclave/app.ts) on 2026-10-17: epochId =
 * base64(SHA-256(publicKeyB64 + ":" + bootNonceB64)); each epoch's counter starts at 0; an epoch's first proof
 * carries a signed epochLink to the previous epoch's last proof.
 */

export const metadata: Metadata = {
  title: "Docs",
  description:
    "How a BitGraph is made, what it proves and what it does not, what you trust, what a proof contains, and how to check one offline.",
};

const NITRO_ROOT_SHA256 = "641a0321a3e244efe456463195d606317ed7cdcc3c1756e09893f3c68f79bb5b";

function Code({ children }: { children: string }) {
  return (
    <div className="code-block mk-code">
      <pre className="hiw-code">{children}</pre>
      <CopyCode />
    </div>
  );
}

export default function DocsPage() {
  return (
    <div className="frame home home-typing prose home-scroll docs-page">
      <div className="home-hero">
        {/* No visible h1: it repeated the nav (Mike, 2026-10-17: "drop the h1's theyre basically redundant"). */}
        <h1 className="sr-only">How BitGraph works.</h1>
      </div>

      <section className="home-section" aria-labelledby="d-what">
        <p className="home-kicker">What a BitGraph is</p>
        <h2 id="d-what">One atomic action.</h2>
        <p>
          A BitGraph is made inside an AWS Nitro hardware enclave, a measured trusted execution environment. The enclave keeps one
          monotonic counter. Each BitGraph takes the next two counts in a single atomic action:
        </p>
        <ol className="docs-list">
          <li><strong>Count N, the nonce.</strong> 32 bytes from the Nitro hardware&rsquo;s random number generator, made inside the enclave and seen by nobody until the content is bound.</li>
          <li><strong>Count N+1, the content.</strong> The SHA-256 of your bits. The file itself never reaches BitGraph: it is hashed where it is.</li>
        </ol>
        <p>
          Both counts are signed together with the enclave&rsquo;s Ed25519 key and attested by the Nitro hardware, which names the
          exact enclave image that did it. There is no partial state: if any step fails, no proof exists and the counter does not move.
        </p>
        <p>
          Every BitGraph occupies two consecutive counts: nothing can be counted between its nonce and its content. The nonce is
          used once and never again, so every proof is one of a kind, at a position a correctly operating enclave cannot reuse. The
          same bytes made twice take two different positions; neither outranks the other.
        </p>
        <p>
          Two BitGraphs bracket an interval: anything bound between BitGraph A and BitGraph B was bound after A and before B. A
          question generated from A&rsquo;s revealed nonce could not have existed before A, except by an infeasible guess; bind
          the answer in B and the two proofs show the order. The interval orders commitments: when the computation between them ran is
          shown only as far as its output depends on A&rsquo;s value.
        </p>
      </section>

      <section className="home-section" aria-labelledby="d-proves">
        <p className="home-kicker">What it proves</p>
        <h2 id="d-proves">Where exact bits were bound. Nothing else.</h2>
        <p>
          A valid proof says these exact bytes were bound at this position in one sequence, after a value nobody could predict.
          Byte identity is the unit of every claim: change one byte and the proof no longer covers the file (barring a SHA-256 collision, which is infeasible).
        </p>
        <p>It does not prove:</p>
        <ul className="docs-list">
          <li><strong>Truth.</strong> The proof binds bytes, not their meaning.</li>
          <li><strong>Authorship.</strong> It attests the enclave that bound the digest, not the person or program that made the file.</li>
          <li><strong>Ownership.</strong> Nothing in the protocol touches rights.</li>
          <li><strong>First creation.</strong> The same bytes may have existed elsewhere before, and an old file can be bound today. What is fixed is the position the bytes took here, not how old they are.</li>
          <li><strong>Completeness.</strong> A record that was never made leaves no trace.</li>
          <li><strong>That an event happened.</strong> Whether something occurred is for whatever produced the record. BitGraph has no sensor path.</li>
          <li><strong>Correct input.</strong> If the software hashes the wrong bytes, BitGraph binds that digest faithfully.</li>
          <li><strong>Legal effect.</strong> Admissibility and weight are not something the protocol establishes.</li>
        </ul>
        <p>
          A record changed after it was bound is caught: its hash no longer matches. A record that was false when it was bound is not:
          nothing in a proof inspects content.
        </p>
      </section>

      <section className="home-section" aria-labelledby="d-trust">
        <p className="home-kicker">What you trust</p>
        <h2 id="d-trust">One vendor, one build.</h2>
        <p>To accept a proof, a reader trusts:</p>
        <ul className="docs-list">
          <li>The enclave image identified by its measurement (PCR0), which is published and reproducible from this repository&rsquo;s source.</li>
          <li>The AWS Nitro hardware and its security module, which draw the randomness and sign the attestations.</li>
          <li>The AWS Nitro root certificate, built into the verifier as a constant.</li>
          <li>Ed25519 and SHA-256.</li>
          <li>The verifier running on their own machine.</li>
        </ul>
        <p>
          A reader does not trust the host machine around the enclave (it only carries messages), the network, this website, BitGraph&rsquo;s
          stored copies of proofs (a convenience, not the evidence), or Argento Computing Inc. Accepting the hardware root is a one-time
          decision, not an ongoing dependency: a proof is portable and checks without asking anyone.
        </p>
        <p>
          The design prevents reusing a nonce, swapping positions, forging under a closed epoch&rsquo;s key, and changing any signed
          field. It does not protect against a malicious client or a compromised build pipeline. Each epoch signs with its own key,
          destroyed when the epoch ends; that limits what one key can expose, but a flaw in the enclave image would affect every epoch
          that runs it. The implementation has not had an independent security audit.
        </p>
        <p>
          BitGraph controls availability and publication. Anyone can verify a proof independently, but a proof alone cannot
          establish that every commitment has been disclosed. A proof withheld from the middle of the published sequence shows as a
          missing count; the most recent ones, withheld, would not show at all.
        </p>
        <p>
          Privacy: a digest is public once it is bound, and digests are not salted. Nobody can turn a hash back into a file, but anyone who
          can guess a file (a short text, a public document) can hash their own copy and see whether it is on the ledger.
        </p>
      </section>

      <section className="home-section" aria-labelledby="d-proof">
        <p className="home-kicker">The proof</p>
        <h2 id="d-proof">A small signed JSON document.</h2>
        <ul className="docs-list docs-fields">
          <li><code>artifact</code>: <code>hashAlg</code> (<code>sha256</code>) and <code>digestB64</code>, the content&rsquo;s SHA-256.</li>
          <li><code>commit.nonceB64</code>: the nonce, revealed now that the content is bound.</li>
          <li><code>commit.slotCounter</code>: the nonce&rsquo;s count (N). <code>commit.counter</code>: the content&rsquo;s count (N+1), a decimal string.</li>
          <li><code>commit.slotHashB64</code>: the SHA-256 of the nonce&rsquo;s signed position record, carried in <code>slotAllocation</code>.</li>
          <li><code>commit.prevB64</code>: the hash of the previous proof in the sequence, so proofs form a chain.</li>
          <li><code>commit.epochId</code>, <code>commit.chainId</code> (<code>bitgraph:main</code>), <code>commit.atomic</code> (<code>true</code>).</li>
          <li><code>signer</code>: the enclave&rsquo;s Ed25519 <code>publicKeyB64</code> and <code>signatureB64</code>.</li>
          <li><code>environment</code>: <code>enforcement</code> (<code>measured-tee</code>), <code>measurement</code> (PCR0) and the Nitro <code>attestation</code> document.</li>
          <li><code>proofHash</code>: the SHA-256 of the signed body, added after signing; it is the attestation&rsquo;s <code>user_data</code>.</li>
        </ul>
        <p>
          The signature covers the canonical form of the body: object keys sorted by Unicode code point, serialized with no whitespace,
          encoded as UTF-8. The nonce&rsquo;s record and the content&rsquo;s commit are bound four ways: the same nonce, the same key, the
          record&rsquo;s hash in the commit, and the nonce&rsquo;s count below the content&rsquo;s.
        </p>
      </section>

      <section className="home-section" aria-labelledby="d-check">
        <p className="home-kicker">Check it offline</p>
        <h2 id="d-check">No account, nothing of BitGraph&rsquo;s running.</h2>
        <p>With the file and its proof (download it from the proof page), pinning the enclave&rsquo;s measurement so nothing else is accepted:</p>
        <Code>{`npx @mikeargento/bitgraph-sdk verify <file> --proof <proof>.json --pcr0 ${PUBLISHED_PCR0}`}</Code>
        <p style={{ marginTop: 20 }}>What a full check does, in order:</p>
        <ol className="docs-list">
          <li>Hash the file and compare it with <code>artifact.digestB64</code>.</li>
          <li>Rebuild the signed body in canonical form and check the Ed25519 signature.</li>
          <li>Check the nonce&rsquo;s position record: its own signature, its hash in the commit, the same nonce and key, its count below the content&rsquo;s.</li>
          <li>Check the attestation: a COSE_Sign1 document signed with ES384, whose certificate chain ends at the AWS Nitro root; its PCR0 must equal <code>environment.measurement</code> and its <code>user_data</code> the proof hash.</li>
          <li>Pin the measurement: accept only an enclave image you have checked (the verify command&rsquo;s <code>--pcr0</code> flag). A verifier that accepts any measurement has verified a signature by an unknown key.</li>
        </ol>
        <p style={{ marginTop: 20 }}>The AWS Nitro root certificate&rsquo;s SHA-256:</p>
        <Code>{NITRO_ROOT_SHA256}</Code>
        <p style={{ marginTop: 20 }}>The enclave&rsquo;s published measurement (PCR0):</p>
        <Code>{PUBLISHED_PCR0}</Code>
        <p style={{ marginTop: 20 }}>
          Rebuild the enclave image yourself and compare. Any linux/amd64 machine with Docker and git; no Nitro hardware needed.
          The image file differs between builds (its header holds the build time); PCR0 does not.
        </p>
        <Code>{"git clone https://github.com/mikeargento/bitgraph.git\ncd bitgraph\n./server/commit-service/reproducible-build/build-eif.sh enclave-v11"}</Code>
        <p style={{ marginTop: 20 }}>
          A verdict from the service that made the proof is a convenience. The check that counts is the one you run.
        </p>
      </section>

      <section className="home-section" aria-labelledby="d-epochs">
        <p className="home-kicker">Epochs</p>
        <h2 id="d-epochs">A fresh key every day.</h2>
        <p>
          The enclave restarts once a day, at 23:59 UTC. Each run is an epoch: a new Ed25519 key made inside the enclave, a counter starting
          at zero, and an epoch ID that is the base64 SHA-256 of the public key and a fresh boot nonce. The key never leaves the enclave and
          is gone when the epoch ends, so nobody can sign as a closed epoch. Each epoch&rsquo;s first proof links, signed, to the preceding
          epoch&rsquo;s final published proof, so a verifier can follow the declared sequence across restarts. The enclave has no
          storage of its own: the counter&rsquo;s continuity is kept by the enclave&rsquo;s code within each run, not carried by the
          hardware from one run to the next. While the enclave restarts, requests fail closed; nothing is made.
        </p>
      </section>

      <section className="home-section" aria-labelledby="d-faq">
        <p className="home-kicker">Questions</p>
        <h2 id="d-faq">Short answers.</h2>
        <p><strong>Does BitGraph upload my file?</strong> No. Only its SHA-256 is sent. (A client you did not write could send more; this site&rsquo;s drop boxes and the published packages send only the hash.)</p>
        <p><strong>Can the same file get two proofs?</strong> Yes. Each is its own BitGraph at its own position, with its own nonce.</p>
        <p><strong>What if someone edits the proof?</strong> Any change to a signed field breaks the signature, and the check fails.</p>
        <p><strong>Why not just trust a timestamp?</strong> A time written by the party a check exists to catch is a claim, not evidence. A BitGraph&rsquo;s place comes from a counter and a value nobody could predict, signed by measured hardware.</p>
        <p><strong>If the enclave were compromised, would old proofs be worthless?</strong> A stolen key is contained to its epoch: earlier epochs&rsquo; keys no longer exist, so nobody can sign new proofs as them. A flaw in the enclave image itself would reach every epoch that ran it.</p>
        <p><strong>What does it cost to check?</strong> Nothing. Verification is free and permissionless.</p>
      </section>
    </div>
  );
}
