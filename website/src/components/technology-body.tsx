// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

import Link from "next/link";
import { CopyCode } from "@/components/copy-code";
import { MechanismFigure } from "@/components/mechanism-figure";
import { PUBLISHED_PCR0 } from "@/lib/enclave-measurements";
import { codeLang } from "@/lib/code-lang";

/**
 * The mechanism, for a CTO or security architect, from the code: the body of the home page under its headline, with
 * its own contents list. Its first section is the short statement of what a BitGraph is; the mechanism and its figure
 * come second. Sources:
 * the v13 enclave (server/commit-service/src/enclave/app.ts, the enclave-v13 branch), the verifier (packages/verify:
 * attested.ts, verifier.ts, stretch.ts, nitro.ts, tree-member.ts), the host (parent/server.ts, rate-limit.ts) and the
 * build pins (server/commit-service/reproducible-build/PINS.md). A claim that is not in that code is not in this text.
 * It was the Technology page until 2026-11-12; /technology now redirects home.
 */
function Code({ children }: { children: string }) {
  return (
    <div className="code-block mk-code" data-lang={codeLang(children)}>
      <pre className="hiw-code">{children}</pre>
      <CopyCode />
    </div>
  );
}

const SECTIONS = [
  ["t-intro", "Technology"],
  ["t-mech", "The mechanism"],
  ["t-proves", "What it establishes"],
  ["t-atomic", "Atomic by construction"],
  ["t-seq", "The sequence"],
  ["t-attest", "The measured enclave"],
  ["t-time", "Time"],
  ["t-publish", "Hourly publication"],
  ["t-trees", "Collections"],
  ["t-redact", "Without disclosure"],
  ["t-format", "The proof"],
  ["t-verify", "Verification"],
  ["t-threat", "Threat model"],
  ["t-trust", "What you trust"],
  ["t-compare", "Comparisons"],
] as const;

export function TechnologyBody() {
  return (
    <div className="tl-body">
      <nav className="tl-toc" aria-label="On this page">
        <p className="tl-label">On this page</p>
        <ul>{SECTIONS.map(([id, t]) => <li key={id}><a href={`#${id}`}>{t}</a></li>)}</ul>
      </nav>

      <div className="tl-main">
          <section className="home-section" aria-labelledby="t-intro">
            <p className="home-kicker">Technology</p>
            <h2 id="t-intro">One atomic action, inside measured&nbsp;hardware.</h2>
            <p>A BitGraph is an attested record made inside an AWS Nitro enclave running a published, reproducible build.</p>
            <p>
              In one atomic operation, the enclave records a fresh hardware-generated nonce at count N and binds your data&rsquo;s
              SHA-256 digest at count N+1. The two records are signed into one proof, attested by the hardware and linked to the
              previous proof.
            </p>
            <p>
              The result is a self-contained JSON proof that anyone can verify offline. Your content stays with you; only its 32-byte
              digest reaches BitGraph.
            </p>
          </section>

          <section className="home-section" aria-labelledby="t-mech">
            <p className="home-kicker">The mechanism</p>
            <h2 id="t-mech">How a receipt is made.</h2>
            <MechanismFigure />
            <ol className="tl-steps">
              <li><strong>Gate.</strong> The enclave refuses to bind until the host has initialized it, and accepts only a canonical 32-byte&nbsp;SHA-256.</li>
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

        <section className="home-section" aria-labelledby="t-proves">
          <p className="home-kicker">What it establishes</p>
          <h2 id="t-proves">Two statements, each checkable.</h2>
          <ol className="tl-steps">
            <li><strong>Position.</strong> These exact bytes, by SHA-256, were bound at count N+1 of one enclave&rsquo;s sequence, immediately after a fresh hardware nonce at count N, in a single signed action. Nothing was counted between them. Within an epoch, no count is assigned to more than one released record.</li>
            <li><strong>Origin of the record.</strong> The binding was performed by a specific enclave build whose measurement (PCR0) is published, as AWS Nitro hardware attests in a document signed for that exact proof.</li>
          </ol>
          <p>
            That is the whole of the mechanism: order, from attested hardware. Making a BitGraph reads no clock and no blockchain.
            Everything else a record can carry, a time, an identity, a public witness, is a trust layer bound on top of that
            position. Two come built in: the hardware&rsquo;s own signed time in every attestation, and the{" "}
            <a href="#t-publish">hourly publication</a> of the line on Base. Both can be checked; neither is what a proof&rsquo;s
            validity rests on.
          </p>
          <h3 className="tl-h3">What it does not establish</h3>
          <ul className="docs-list">
            <li><strong>When the content was created.</strong> An old file can be bound today. The proof fixes where in the sequence its digest was recorded; a time layer bound to that position associates it with a timestamp or a time window. Either way, that is when the digest was recorded, not when the content was made.</li>
            <li><strong>Who made it, or whether it is true.</strong> It binds bytes, not authorship or meaning.</li>
            <li><strong>That nothing else exists.</strong> It proves a record was made, not that no other record was.</li>
            <li><strong>Order across epochs</strong> from the counts alone. Counts start again with each epoch. The hourly publication on Base puts the epochs in order, and the attested time in each proof is further evidence.</li>
          </ul>
        </section>


        <section className="home-section" aria-labelledby="t-atomic">
          <p className="home-kicker">Atomic by construction</p>
          <h2 id="t-atomic">There is no partial state.</h2>
          <p>
            Every step that can fail (the random draw, the signature, the attestation) comes before the counter moves. If any fails,
            nothing is released, the counter stays where it was, and the drawn nonce is discarded without ever leaving the enclave.
            Requests are serialized inside the enclave, so two binds cannot interleave.
          </p>
          <p className="sx-fine">
            Tested on the unmodified enclave code with injected faults in the RNG, the signer and the attestation:{" "}
            <span className="nb"><code>server/commit-service/src/enclave/__tests__/bind-failure.test.ts</code>.</span>
          </p>
        </section>

        <section className="home-section" aria-labelledby="t-seq">
          <p className="home-kicker">The sequence</p>
          <h2 id="t-seq">Counted, chained, gaps visible.</h2>
          <p>
            Every proof after an epoch&rsquo;s first carries <span className="nb"><code>prevB64</code>,</span> the SHA-256 of the whole previous proof. Within an
            epoch the counts climb by two per BitGraph, nonce then content. Given a run of proofs, the verifier checks that each is
            atomic, that counts are consecutive and that each links to the one before; a missing proof shows as a gap
            (<code>verifyStretch</code>). Anything bound between BitGraph A and BitGraph B was bound after A and before B
            (<code>verifyBetween</code>).
          </p>
          <h3 className="tl-h3">Epochs</h3>
          <p>
            The enclave&rsquo;s key and counter live only in its memory, so each start is a new epoch: a new key, a counter from zero,
            and an <code>epochId</code> signed into every proof. No key carries over from one epoch to the next; the{" "}
            <a href="#t-publish">hourly publication</a> is what links them. On bitgraph.ing an epoch runs for one UTC day and ends
            with a closing BitGraph inside its own line.
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
            itself differs build to build because its header holds a build time; the measurement does not.) By default the verifier
            accepts only published images.
          </p>
        </section>

        <section className="home-section" aria-labelledby="t-time">
          <p className="home-kicker">Trust layers</p>
          <h2 id="t-time">Order from the enclave. Time, and the rest, bound on top.</h2>
          <p>
            A BitGraph establishes a position in an enclave&rsquo;s sequence. A trust layer is anything that says more about that position: when it happened, who stood
            behind it, that the public saw it. The rule for every layer is the same. It must be cryptographically bound to the
            position, in one direction or both: the layer&rsquo;s own record bound inside the BitGraph (so the BitGraph came after
            it), or the BitGraph&rsquo;s hash carried inside the layer (so the BitGraph existed by it). A layer placed beside a
            BitGraph, with neither bond, says nothing about it.
          </p>
          <p>
            The enclave adds no clock of its own. The time in a proof is the attestation&rsquo;s timestamp, set and signed by the AWS
            Nitro Secure Module: the first layer, from the hardware itself. A timestamp authority, a certificate, a transparency
            log or a Content Credential can be bound the same way, by whoever already issues it.
          </p>
          <p>
            Inside an epoch the order needs nothing outside the enclave. Each BitGraph comes after the one before it, by
            construction, and the time in each proof is the hardware&rsquo;s. An epoch is one run, from its first BitGraph to its last:
          </p>
          <ul className="docs-list">
            <li><strong>When an epoch opens.</strong> The enclave starts with a new key and a counter at zero, and signs the new epoch&rsquo;s id into every proof it makes.</li>
            <li><strong>Every file in between.</strong> Each file is one atomic step on the next two counts: a fresh nonce at count N, the file&rsquo;s SHA-256 at count N+1, attested by AWS Nitro with AWS&rsquo;s signed time and linked to the proof before it. Nothing leaves the enclave but the proof.</li>
            <li><strong>When an epoch closes.</strong> At the end of the UTC day the enclave makes a closing BitGraph in its own line, binding a short note naming the epoch. Nothing is bound after it, and its proof names the hash of the one before, so the whole sequence ends there.</li>
          </ul>
          <p>
            One public layer is built in: every hour the line is published on Base and that publication is bound back into the
            line, as the next section describes. Anyone who wants another outside anchor can add their own: an RFC&nbsp;3161
            timestamp authority, a transparency log, or another chain.
          </p>
          <div className="sx-cards is-3">
            <article className="tl-card">
              <h3>Your file stays with you.</h3>
              <p>Only the file&rsquo;s 32-byte SHA-256 reaches the enclave, and only the proof leaves it.</p>
            </article>
            <article className="tl-card">
              <h3>Time from the hardware.</h3>
              <p>The time on a proof is the attestation&rsquo;s timestamp, signed by AWS for that exact proof.</p>
            </article>
            <article className="tl-card">
              <h3>Independently verifiable.</h3>
              <p>Check the hardware attestation, signatures and counted sequence offline, with no service and no network.</p>
            </article>
          </div>
        </section>

        <section className="home-section" aria-labelledby="t-publish">
          <p className="home-kicker">Hourly publication</p>
          <h2 id="t-publish">Once an hour, the line goes on public record.</h2>
          <p>
            The enclave gives every BitGraph its place in line. Once an hour, BitGraph publishes that line on Base, a public
            blockchain that settles on Ethereum, so its order is also held on a record BitGraph does not run and cannot edit. The
            write goes out on the hour (UTC) whether or not anything was made, so a skipped hour shows.
          </p>
          <ol className="tl-steps">
            <li><strong>Fingerprint.</strong> The BitGraphs made since the last write are hashed into one tree (RFC&nbsp;6962, SHA-256), each leaf the hash of a whole proof. The tree&rsquo;s root stands for all of them, in order.</li>
            <li><strong>Write.</strong> One small transaction on Base carries the root, the epoch, the first and last counts it covers, how many BitGraphs that is, and the hash of the write before it. An epoch&rsquo;s first write also names the epoch&rsquo;s public key.</li>
            <li><strong>Confirm.</strong> The write is kept once ten more blocks have been built on top of it and its block is still part of the chain.</li>
            <li><strong>Bind back.</strong> BitGraph then makes one ordinary BitGraph of a short note naming that transaction and its block. On the <Link href="/ledger">Ledger</Link> that row reads &ldquo;Published on Base&rdquo;. Every BitGraph after it was made after that block.</li>
          </ol>
          <h3 className="tl-h3">What it gives</h3>
          <ul className="docs-list">
            <li><strong>Two public marks around every BitGraph.</strong> It was made after the Base block named by the last publication before it, and it existed by the block of the write that covers it. The two are about an hour apart. An epoch&rsquo;s first BitGraphs, made before its first publication is bound, have the second mark only. Both are places on a public chain; neither is the age of the file.</li>
            <li><strong>The days in one line.</strong> Each write names the one before it, and that holds across the daily change of key, so the epochs follow one another on public record.</li>
            <li><strong>A past that cannot be changed quietly.</strong> An hour that was altered, forked or replaced would contradict what is already on Base, and a proof made later cannot be placed in an hour already published.</li>
          </ul>
          <h3 className="tl-h3">What it does not change</h3>
          <p>
            Making a BitGraph reads nothing from a chain and waits on none. A proof still checks offline against the enclave&rsquo;s
            measurement and AWS&rsquo;s signature, and that check does not use Base. The publication answers a different question:
            where a BitGraph sits in the whole public line. BitGraphs made since the last write rest on the enclave alone until the
            next one, at most about an hour.
          </p>
          <h3 className="tl-h3">Checking it</h3>
          <p>
            Once its hour is written, a proof&rsquo;s page shows the block it was published in and the block it was made after, each
            linked to a block explorer. The downloaded proof carries the evidence with it: its path to the hour&rsquo;s root, the
            transaction, and the block&rsquo;s header. With those, anyone can check offline that the proof is in the hour&rsquo;s tree,
            that the root is in the transaction, and that the transaction is in the block (<code>verifyPublication</code> in the
            open{" "}
            <a href="https://github.com/mikeargento/bitgraph/blob/main/packages/audit/src/publication.ts" target="_blank" rel="noopener">audit package</a>).
            Whether that block is part of Base is a question for any Base node or explorer. Every write BitGraph has made is listed
            at{" "}
            <a href="https://basescan.org/address/0xf3972408D853c975F86351C311f4310220bbF2a3" target="_blank" rel="noopener">the publisher&rsquo;s address</a>.
          </p>
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
            Measured 2026-10-28 on the current flow, in Node on an 8-core Apple M3 laptop: one million files hashed in 1.9 s, the
            tree built in 2.4 s, and the root bound 6.1 s after the drop. Open the result as{" "}
            <a href="/proof/l4eT6Fpyu9_6YmlFOOoC9BaYrHNQLJpDsnWJJcxfgJI?counter=34&amp;epoch=NihRUA1VRsV4cqmwWDO_4viNR7YhJRdCb75lGASeV3E">BitGraph #34</a>, or
            download the run&rsquo;s files: <a href="/benchmark/2026-10-28/timings.json" download>timings</a>,{" "}
            <a href="/benchmark/2026-10-28/seed.txt" download>corpus seed</a>, <a href="/benchmark/2026-10-28/merkle-root.txt" download>root text</a> and{" "}
            <a href="/benchmark/2026-10-28/merkle-root.txt.bitgraph.json" download>proof file</a>. Reproduce it with{" "}
            <span className="nb"><code>website/scripts/bench-million.mjs</code>.</span>
          </p>
        </section>

        <section className="home-section" aria-labelledby="t-redact">
          <p className="home-kicker">Without disclosure</p>
          <h2 id="t-redact">Prove a record exists without showing what it bound.</h2>
          <p>
            Each proof holds two signed records: the slot at count N, with the nonce, epoch and key and no field from the content; and the
            binding at count N+1, which names the digest. The slot record is signed on its own. So a holder can withhold the binding and
            the content entirely and still show the slot: an auditor checks its signature under the same key as an attested proof from
            that epoch, and learns that the measured enclave established that position, without learning what was bound there.
          </p>
          <p className="sx-fine">
            Built into the proof format today. The check uses the verifier&rsquo;s existing signature and canonical-encoding steps; it is not
            yet a one-line&nbsp;command.
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
            The signature covers a canonical serialization of the body. A collection member also carries its inclusion path, as
            unsigned metadata that is checked, not trusted. <a href="/proof/7roNTix7clHFjNuPKoI2pEOfXcCN5seMP2JgCgTWhrg?counter=58&epoch=2EnGlBWWcEPyBfn1N2oMZgtGgxh3nQ3MD69rqDIX0Xw">See a real proof</a>, or <a href="/evaluate">verify it</a>.
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
            document covers it. The verifier&rsquo;s own test does exactly this: <span className="nb"><code>packages/verify/src/__tests__/attested.test.ts</code>.</span>
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
                  <td>Forge a proof that passes the attested check; see or choose a nonce; reuse a count; insert or reorder proofs inside a sequence without breaking the counts and hash links; change a proof&rsquo;s attested time by releasing it late; alter an hour already published on Base without contradicting that record.</td>
                  <td>Choose the order in which it submits digests; delay or refuse submissions; withhold released proofs (gaps then show to anyone holding the neighbors); restart the enclave to begin a new epoch.</td>
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
          <p>
            The hourly publication adds one thing to rely on, for one question only. Where a BitGraph sits among other epochs, and
            that its hour has not been rewritten, rests on Base&rsquo;s history. Whether a proof is valid does not.
          </p>
        </section>

        <section className="home-section" aria-labelledby="t-compare">
          <p className="home-kicker">Comparisons</p>
          <h2 id="t-compare">How BitGraph fits.</h2>
          <p>
            These systems provide different kinds of evidence and can be used together. Each attaches something to content that
            already exists: a signature, a token, a log entry, a block. What BitGraph adds is the place itself. Each count comes
            with a nonce nobody could predict, drawn at the moment the place is taken, so no place in line can be prepared for,
            reserved, or reused.
          </p>
          <div className="sx-table-wrap">
            <table className="sx-table">
              <thead><tr><th>System</th><th>What it establishes</th><th>What you trust</th><th>How BitGraph fits</th></tr></thead>
              <tbody>
                <tr><td><a href="https://csrc.nist.gov/pubs/fips/186-5/final" target="_blank" rel="noopener">Digital signature</a></td><td>These bytes were signed with a particular private key.</td><td>The key&rsquo;s security and any claimed link between that key and an identity.</td><td>BitGraph adds a counted position enforced by measured enclave code, with hardware attestation bound to each proof.</td></tr>
                <tr><td><a href="https://www.rfc-editor.org/rfc/rfc3161.html" target="_blank" rel="noopener">Timestamp authority (RFC&nbsp;3161)</a></td><td>A TSA issued a signed token associating a digest with a stated time.</td><td>The TSA&rsquo;s signing key, time source and operating practices.</td><td>BitGraph provides counted, chained records and carries Nitro&rsquo;s signed attestation time. A TSA token can be bound as additional time evidence.</td></tr>
                <tr><td><a href="https://docs.sigstore.dev/logging/overview/" target="_blank" rel="noopener">Transparency log (CT, Sigstore&rsquo;s Rekor, SCITT)</a></td><td>An entry is included in a signed log state. Consistency proofs allow checks of append-only growth.</td><td>The log&rsquo;s signing key, consistency checks, and the monitors or witnesses used to detect conflicting views.</td><td>BitGraph enforces each binding inside an attested enclave. Its proofs can also be published in a transparency log.</td></tr>
                <tr><td><a href="https://opentimestamps.org/" target="_blank" rel="noopener">Blockchain anchoring</a></td><td>A digest, directly or through a batch commitment, is linked to a commitment included in a particular block.</td><td>The chain&rsquo;s consensus, finality and rules for interpreting block time.</td><td>BitGraph does this itself, once an hour, for the whole line. What BitGraph adds is the position: a counted place in line, bound with a fresh hardware nonce, made without reading a chain or waiting on one.</td></tr>
                <tr><td><a href="https://spec.c2pa.org/specifications/specifications/2.5/specs/C2PA_Specification.html" target="_blank" rel="noopener">Content Credentials (C2PA)</a></td><td>A signer signed assertions cryptographically bound to an asset.</td><td>The signer, certificate trust chain and any timestamp authority used.</td><td>BitGraph can bind the asset and its manifest to a counted position, adding independently verifiable recording evidence.</td></tr>
                <tr><td><a href="https://docs.aws.amazon.com/enclaves/latest/user/set-up-attestation.html" target="_blank" rel="noopener">Remote attestation</a></td><td>A platform signed evidence identifying measured software and associated attested data.</td><td>The platform&rsquo;s security and the hardware vendor&rsquo;s attestation root.</td><td>BitGraph uses attestation for a specific recording protocol: atomic binding, fresh nonces, consecutive counts and linked proofs.</td></tr>
              </tbody>
            </table>
          </div>
          <p className="sx-fine">
            All comparisons assume sound cryptography and correct verification. BitGraph&rsquo;s own trust assumptions include AWS
            Nitro, the accepted enclave build and the cryptography used in its proofs.
          </p>
        </section>

        <section className="home-section" aria-labelledby="t-next">
          <p className="home-kicker">Next</p>
          <h2 id="t-next">Check it yourself.</h2>
          <p>The evaluation guide walks through making a BitGraph, verifying it offline, and watching each kind of tampering fail.</p>
          <div className="sx-cta">
            <a className="bg-action-link is-make" href="/evaluate">Evaluate the technology</a>
            <a className="bg-action-link" href="/applications">Where it fits</a>
            <a className="bg-action-link" href="/integrate">For developers</a>
          </div>
        </section>
      </div>
    </div>
  );
}
