import type { Metadata } from "next";
import Link from "next/link";
import { CopyCode } from "@/components/copy-code";
import { PUBLISHED_PCR0 } from "@/lib/enclave-measurements";

/**
 * Tools (2026-10-18: the docs page became a tools page; the home page is the explanation). What a builder needs,
 * in the order they need it: the MCP server, the SDK and CLI, the HTTP API, the offline check; then how a BitGraph is
 * made, the plugins, epochs, every limit and what you trust in full, and the reference. /docs redirects here.
 *
 * Facts checked against the enclave source (server/commit-service/src/enclave/app.ts) on 2026-10-17: epochId =
 * base64(SHA-256(publicKeyB64 + ":" + bootNonceB64)); each epoch's counter starts at 0. Enclave v13 (2026-10-19): epochs
 * are not chained; each one's first BitGraph binds epoch-floor.json, a fresh read of the latest Base block.
 *
 * Layout (2026-10-30 split): the four ways in live on /integrate; this page is the reference. The offline check as one
 * wide card at the top, then the reference beside a contents list that stays in view on desktop. Questions fold open; the proof's fields are a table.
 */

export const metadata: Metadata = {
  title: "Docs",
  description:
    "What a BitGraph is and how it checks: the atomic action, trees and trust layers, epochs, limits, and the full check step by step.",
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

export default function ToolsPage() {
  return (
    <div className="frame home home-typing prose home-scroll docs-page tools-page">
      <div className="home-hero">
        <h1 className="sr-only">Docs.</h1>
      </div>

      <section className="home-section" aria-labelledby="t-intro">
        <p className="home-kicker">Docs</p>
        <h2 id="t-intro">What a BitGraph is, and how it checks.</h2>
        <p>
          The mechanism, its trees and trust layers, its epochs, its limits, and the full check, step by step. The ways to call it,
          MCP, SDK, CLI and HTTP, are on <Link href="/integrate">Integrate</Link>. Checking a proof needs none of them, and nothing of
          BitGraph&rsquo;s running.
        </p>

        <div className="tl-grid">
          <article className="tl-card tl-wide" aria-labelledby="d-check">
            <p className="tl-label">Check it offline</p>
            <h3 id="d-check">No account, nothing of BitGraph&rsquo;s running.</h3>
            <p>
              With the file and its proof (download it from the proof page), pinning the enclave&rsquo;s measurement so nothing else is
              accepted. Rely on a check you run; a verdict on BitGraph&rsquo;s own pages is a convenience.
            </p>
            <Code>{`npx @mikeargento/bitgraph-sdk verify <file> --proof <proof>.json --pcr0 ${PUBLISHED_PCR0}`}</Code>
            <p className="tl-note">What it checks, step by step, and how to rebuild the enclave image yourself: <a href="#d-ref">Reference</a>.</p>
          </article>
        </div>
      </section>

      <div className="tl-body">
        <nav className="tl-toc" aria-label="On this page">
          <p className="tl-label">On this page</p>
          <ul>
            <li><a href="#d-what">How it&rsquo;s made</a></li>
            <li><a href="#d-plugins">Trees and trust layers</a></li>
            <li><a href="#d-epochs">Epochs</a></li>
            <li><a href="#d-proves">Limits</a></li>
            <li><a href="#d-trust">What you trust</a></li>
            <li><a href="#d-faq">Questions</a></li>
            <li><a href="#d-ref">Reference</a></li>
          </ul>
        </nav>

        <div className="tl-main">
          <section className="home-section" aria-labelledby="d-what">
            <p className="home-kicker">How it&rsquo;s made</p>
            <h2 id="d-what">One atomic action.</h2>
            <p>
              A BitGraph is made inside an AWS Nitro hardware enclave, a measured trusted execution environment. The enclave keeps one
              monotonic counter. Each BitGraph takes the next two counts in a single atomic action:
            </p>
            <ol className="tl-steps">
              <li><strong>Count N, the nonce.</strong> 32 bytes from the Nitro hardware&rsquo;s random number generator, made inside the enclave and seen by nobody until the content is bound.</li>
              <li><strong>Count N+1, the content.</strong> The SHA-256 of your bits. The file itself never reaches BitGraph: it is hashed where it is.</li>
            </ol>
            <p>
              Both counts are signed together with the enclave&rsquo;s Ed25519 key and attested by the Nitro hardware, which names the
              exact enclave image that did it. There is no partial state: if any step fails, no proof exists, the nonce is discarded without
              ever leaving the enclave, and the counter does not move.
            </p>
            <p>The nonce is used once, and the enclave never gives out the same count twice, so every proof is one of a kind.</p>
            <p>
              Two BitGraphs bracket an interval: anything bound between them was bound after the first and before the second. Work made from
              the first one&rsquo;s nonce could not have existed before it. Trees and time, below, build on this.
            </p>
          </section>

          <section className="home-section" aria-labelledby="d-plugins">
            <p className="home-kicker">Trees and trust layers</p>
            <h2 id="d-plugins">Built from ordinary BitGraphs.</h2>
            <p>
              Two things build on a BitGraph without changing it: a drop of many files becomes one tree, and through bitgraph.ing, Base, the reference trust layer,
              places each BitGraph in public time. Each is made of ordinary BitGraphs, every one the same two counts; nothing about either
              one enters the enclave or the proof format.
            </p>

            <h3 className="tl-h3">Many files, one BitGraph</h3>
            <p>
              Drop more than one file on the Proofs page and make them, and they become one BitGraph: the drop is one moment, so they take one position.
              The files are hashed into a Merkle tree in your browser (RFC 6962, SHA-256: a leaf is SHA-256 of a zero byte and the file, a
              node is SHA-256 of a one byte and its two children, and an odd last node rises unchanged). One BitGraph is made of{" "}
              <span className="nb"><code>merkle-root.txt</code>,</span> a short text file holding the root. You keep <span className="nb"><code>merkle-tree.json</code>,</span> which lists every
              file&rsquo;s leaf and every level. One position covers a million files as well as one.
            </p>
            <p>
              To check a file, drop it on the Proofs page by itself. When the tree is made, each file gets a sealed entry that only its own
              bytes can open; the page finds it, walks the file up the tree to the root, and checks the root against its BitGraph. With{" "}
              <code>merkle-tree.json</code> and <code>merkle-root.txt</code> it works without any entry. By hand: hash the file as a leaf,
              combine it with its neighbours up the levels, compare with the root in <span className="nb"><code>merkle-root.txt</code>,</span> and verify{" "}
              <code>merkle-root.txt</code> against its proof like any file.
            </p>

            <h3 className="tl-h3">Base, the reference trust layer</h3>
            <p>
              The sequence is a closed system. Inside it, order is certain: every BitGraph names the one before it, the counter only goes
              up, and the hardware&rsquo;s time is signed into each proof. What a closed system cannot do is place itself in the world&rsquo;s
              time on its own word; a clock inside the box is still the box&rsquo;s clock. So BitGraph reads a public chain it does not
              operate, before and after each bind, and the window between the two reads is time nobody inside the box could have chosen.
              Every BitGraph made through this site gets it. Base is the reference layer for this site, not a dependency; another
              witness bound the same way would serve. Three steps, two BitGraphs:
            </p>
            <ol className="tl-steps">
              <li><strong>BitGraph 1 is the floor.</strong> The latest Base block (number, hash, time) is written to <code>base-floor.json</code> and bound, in the same request as the content. A block hash cannot be known before its block exists. (A tree carries the block as its first leaf instead, <span className="nb"><code>base-block.json</code>,</span> so the root itself holds the floor.)</li>
              <li><strong>BitGraph 2 is the content,</strong> bound right after BitGraph 1 in the same sequence.</li>
              <li><strong>The ceiling.</strong> BitGraph 2&rsquo;s proof hash is written to Base by BitGraph&rsquo;s writer, in a later block. The proof existed by then.</li>
            </ol>
            <p>
              The content was bound after the first block and before the second: a window in real time, read from a public chain, around a
              position. The site checks the pair before it records BitGraph 1 as BitGraph 2&rsquo;s floor: <code>base-floor.json</code>{" "}
              hashes to BitGraph 1&rsquo;s digest, Base has that block with that hash and time, both proofs verify in full, and BitGraph 2
              comes after BitGraph 1 in the same epoch. The record is kept with the ledger and shown on both proof pages.
            </p>
            <p>To check a window yourself, with the download from the Proofs page:</p>
            <ol className="tl-steps">
              <li>Verify both files against their proofs with the offline check above.</li>
              <li>Open the block in <code>base-floor.json</code> on any Base explorer and compare its hash and time.</li>
              <li>Compare the two proofs&rsquo; <code>commit.epochId</code> (the same) and counts (BitGraph 2&rsquo;s after BitGraph 1&rsquo;s).</li>
              <li>Find BitGraph 2&rsquo;s Base transaction from its proof page and check that it carries the proof hash.</li>
            </ol>
            <p>
              Base adds nothing to the bind and takes nothing from it. Strip the window away and a BitGraph is still a position: where your
              bits were bound in the sequence, with the hardware attestation&rsquo;s timestamp bound in as its first layer, and no public claim about clock time. The window
              is what lets someone who trusts neither BitGraph nor its clock still place the bind between two public blocks.
            </p>
          </section>

          <section className="home-section" aria-labelledby="d-epochs">
            <p className="home-kicker">Epochs</p>
            <h2 id="d-epochs">A fresh key every day.</h2>
            <p>
              The enclave restarts once a day, at 23:59 UTC. Each run is an epoch: a new Ed25519 key made inside the enclave, a counter
              starting at zero, and an epoch ID that is the base64 SHA-256 of the public key and a fresh boot nonce. The key never leaves the
              enclave and is gone when the epoch ends, so an epoch that has ended cannot sign anything new (unless its key was stolen while it
              ran).
            </p>
            <p>
              Epochs are not chained to one another; each stands on its own key and its own attestation. Instead, each epoch opens with a
              write to Base: the ceiling writer sends a transaction carrying the new epoch&rsquo;s id, and the epoch&rsquo;s first BitGraph
              binds a record of that mined transaction (<code>epoch-genesis.json</code>). The transaction could not exist before the
              epoch&rsquo;s key, since the id is derived from it, and no BitGraph of the epoch could exist before the transaction&rsquo;s
              block, so epochs order by their genesis blocks. Base is the witness here because this deployment binds it; the rule is
              the same for any trust layer: bound into the record, or carrying the record&rsquo;s hash, never merely placed beside it. Epochs opened before 2026-10-23 bound a read of the latest
              Base block instead (<code>epoch-floor.json</code>), which proves the same &ldquo;after&rdquo; with the block chosen by the host.
            </p>
            <p>
              The enclave has no storage of its own: the counter&rsquo;s continuity is kept by the enclave&rsquo;s code within each run, not
              carried by the hardware from one run to the next. While the enclave restarts, requests fail closed; nothing is made.
            </p>
          </section>

          <section className="home-section" aria-labelledby="d-proves">
            <p className="home-kicker">Limits, in full</p>
            <h2 id="d-proves">Where exact bits were bound. Nothing else.</h2>
            <p>
              A valid proof says these exact bytes were bound at this position in one sequence, after a value nobody could predict. Byte
              identity is the unit of every claim: change one byte and the proof no longer covers the file (barring a SHA-256 collision,
              which is infeasible).
            </p>
            <p>It does not prove:</p>
            <dl className="tl-defs">
              <dt>Truth</dt><dd>The proof binds bytes, not their meaning.</dd>
              <dt>Authorship</dt><dd>It attests the enclave that bound the digest, not the person or program that made the file.</dd>
              <dt>Ownership</dt><dd>Nothing in the protocol touches rights.</dd>
              <dt>First creation</dt><dd>The same bytes may have existed elsewhere before, and an old file can be bound today. What is fixed is the position the bytes took here, not how old they are.</dd>
              <dt>Completeness</dt><dd>A record that was never made leaves no trace.</dd>
              <dt>That an event happened</dt><dd>Whether something occurred is for whatever produced the record. BitGraph has no sensor path.</dd>
              <dt>Correct input</dt><dd>If the software hashes the wrong bytes, BitGraph binds that digest faithfully.</dd>
            </dl>
            <p>
              A record changed after it was bound is caught: its hash no longer matches. A record that was false when it was bound is not:
              nothing in a proof inspects content.
            </p>
          </section>

          <section className="home-section" aria-labelledby="d-trust">
            <p className="home-kicker">What you trust, in full</p>
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
              A reader does not trust the host machine around the enclave (it only carries messages), the network, this website,
              BitGraph&rsquo;s stored copies of proofs (a convenience, not the evidence), or Argento Computing Inc. Accepting the hardware root
              is a one-time decision, not an ongoing dependency: a proof is portable and checks without asking anyone.
            </p>
            <p>
              The design prevents reusing a nonce, swapping positions, changing any signed field, and signing new proofs as an epoch that has
              ended: its key is destroyed when the epoch ends, so only a key stolen while the epoch ran could. It does not protect against a
              malicious client or a compromised build pipeline, and a flaw in the enclave image would affect every epoch that runs it. The
              implementation has not had an independent security audit.
            </p>
            <p>
              BitGraph controls availability and publication. Anyone can verify a proof independently, but a proof alone cannot establish that
              every commitment has been disclosed. A proof withheld from the middle of the published sequence shows as a missing count; the
              most recent ones, withheld, would not show at all.
            </p>
            <p>
              Privacy: a digest is public once it is bound, and digests are not salted. A hash does not reveal the file, but a file someone can
              guess (a short text, a public document) can be identified by hashing the guess and looking it up.
            </p>
          </section>

          <section className="home-section" aria-labelledby="d-faq">
            <p className="home-kicker">Questions</p>
            <h2 id="d-faq">Short answers.</h2>
            <div className="tl-faq">
              <details>
                <summary>Does BitGraph upload my file?</summary>
                <p>No. Only its SHA-256 is sent. (A client you did not write could send more; this site&rsquo;s drop boxes and the published packages send only the hash.)</p>
              </details>
              <details>
                <summary>Can the same file get two proofs?</summary>
                <p>Yes. Each is its own BitGraph at its own position, with its own nonce.</p>
              </details>
              <details>
                <summary>What if someone edits the proof?</summary>
                <p>Any change to a signed field breaks the signature, and the check fails.</p>
              </details>
              <details>
                <summary>Why not just trust a timestamp?</summary>
                <p>A time written by the party a check exists to catch is a claim, not evidence. A BitGraph&rsquo;s place comes from a counter and a value nobody could predict, signed by measured hardware.</p>
              </details>
              <details>
                <summary>Does Base change the BitGraph?</summary>
                <p>No. The bind is the same two counts. The window comes from a second BitGraph (the block) and a write to Base afterwards, both outside the bind.</p>
              </details>
              <details>
                <summary>Is a tree weaker than one BitGraph per file?</summary>
                <p>Every file in it shares one position: they were all bound together, at that point in the sequence. To tell the files apart in order, make them separately.</p>
              </details>
              <details>
                <summary>What does it cost to check?</summary>
                <p>Nothing. Verification is free and permissionless.</p>
              </details>
            </div>
          </section>

          <section className="home-section" aria-labelledby="d-ref">
            <p className="home-kicker">Reference</p>
            <h2 id="d-ref">The proof, and the full check.</h2>
            <p>A small signed JSON document:</p>
            <dl className="tl-fields">
              <dt><code>artifact</code></dt><dd><code>hashAlg</code> (<code>sha256</code>) and <span className="nb"><code>digestB64</code>,</span> the content&rsquo;s SHA-256.</dd>
              <dt><code>commit.nonceB64</code></dt><dd>The nonce, revealed now that the content is bound.</dd>
              <dt><code>commit.slotCounter</code></dt><dd>The nonce&rsquo;s count (N).</dd>
              <dt><code>commit.counter</code></dt><dd>The content&rsquo;s count (N+1), a decimal string.</dd>
              <dt><code>commit.slotHashB64</code></dt><dd>The SHA-256 of the nonce&rsquo;s signed position record, carried in <span className="nb"><code>slotAllocation</code>.</span></dd>
              <dt><code>commit.prevB64</code></dt><dd>The previous BitGraph: the hash of the BitGraph before this one. Every BitGraph names the one before it inside its signed body, so the sequence is a chain that only the enclave can extend, and nothing can be inserted or removed without breaking it.</dd>
              <dt><code>commit.epochId</code></dt><dd>The epoch: the base64 SHA-256 of its public key and boot nonce.</dd>
              <dt><code>commit.chainId</code></dt><dd><span className="nb"><code>bitgraph:main</code>.</span></dd>
              <dt><code>commit.atomic</code></dt><dd><code>true</code>: the nonce and the content were bound in one action.</dd>
              <dt><code>signer</code></dt><dd>The enclave&rsquo;s Ed25519 <code>publicKeyB64</code> and <span className="nb"><code>signatureB64</code>.</span></dd>
              <dt><code>environment</code></dt><dd><code>enforcement</code> (<code>measured-tee</code>), <code>measurement</code> (PCR0) and the Nitro <code>attestation</code> document.</dd>
              <dt><code>proofHash</code></dt><dd>The SHA-256 of the signed body, added after signing; it is the attestation&rsquo;s <span className="nb"><code>user_data</code>.</span></dd>
            </dl>
            <p>
              The signature covers the canonical form of the body: object keys sorted by Unicode code point, serialized with no whitespace,
              encoded as UTF-8. The nonce&rsquo;s record and the content&rsquo;s commit are bound four ways: the same nonce, the same key,
              the record&rsquo;s hash in the commit, and the nonce&rsquo;s count below the content&rsquo;s.
            </p>

            <h3 className="tl-h3">What a full check does, in order</h3>
            <ol className="tl-steps">
              <li>Hash the file and compare it with <span className="nb"><code>artifact.digestB64</code>.</span></li>
              <li>Rebuild the signed body in canonical form and check the Ed25519 signature.</li>
              <li>Check the nonce&rsquo;s position record: its own signature, its hash in the commit, the same nonce and key, its count below the content&rsquo;s.</li>
              <li>Check the attestation: a COSE_Sign1 document signed with ES384, whose certificate chain ends at the AWS Nitro root; its PCR0 must equal <code>environment.measurement</code> and its <code>user_data</code> the proof hash.</li>
              <li>Pin the measurement: accept only an enclave image you have checked (the verify command&rsquo;s <code>--pcr0</code> flag). A verifier that accepts any measurement has verified a signature by an unknown key.</li>
            </ol>

            <h3 className="tl-h3">Pins</h3>
            <p>The AWS Nitro root certificate&rsquo;s SHA-256:</p>
            <Code>{NITRO_ROOT_SHA256}</Code>
            <p>The enclave&rsquo;s published measurement (PCR0):</p>
            <Code>{PUBLISHED_PCR0}</Code>
            <p>
              Rebuild the enclave image yourself and compare. Any linux/amd64 machine with Docker and git; no Nitro hardware needed. The
              image file differs between builds (its header holds the build time); PCR0 does not.
            </p>
            <Code>{"git clone https://github.com/mikeargento/bitgraph.git\ncd bitgraph\n./server/commit-service/reproducible-build/build-eif.sh enclave-v13"}</Code>
          </section>
        </div>
      </div>
    </div>
  );
}
