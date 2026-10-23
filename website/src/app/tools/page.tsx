import type { Metadata } from "next";
import { CopyCode } from "@/components/copy-code";
import { PUBLISHED_PCR0 } from "@/lib/enclave-measurements";

/**
 * Tools (Mike, 2026-10-18: "make the docs page a tools page"; the home page is the explanation). What a builder needs,
 * in the order they need it: the MCP server, the SDK and CLI, the HTTP API, the offline check; then how a BitGraph is
 * made, the plugins, epochs, every limit and what you trust in full, and the reference. /docs redirects here.
 *
 * Facts checked against the enclave source (server/commit-service/src/enclave/app.ts) on 2026-10-17: epochId =
 * base64(SHA-256(publicKeyB64 + ":" + bootNonceB64)); each epoch's counter starts at 0; an epoch's first proof
 * carries a signed epochLink to the previous epoch's last proof. Enclave v12 (2026-10-18): bind is the only way to make
 * a BitGraph.
 */

export const metadata: Metadata = {
  title: "Tools",
  description:
    "Make and check BitGraphs from your own software: the MCP server for AI agents, the SDK and CLI, the HTTP API, and the offline verifier.",
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
    <div className="frame home home-typing prose home-scroll docs-page">
      <div className="home-hero">
        <h1 className="sr-only">Tools.</h1>
      </div>

      <section className="home-section" aria-labelledby="t-intro">
        <p className="home-kicker">Tools</p>
        <h2 id="t-intro">Make and check BitGraphs from your own software.</h2>
        <p>
          Every tool here does the same one thing the Make page does: it hashes your file where it is and sends only the SHA-256. The
          enclave binds it in one atomic action and the proof comes back to you. Checking a proof needs none of them, and nothing of
          BitGraph&rsquo;s running.
        </p>
      </section>

      <section className="home-section" aria-labelledby="t-mcp">
        <p className="home-kicker">For AI agents</p>
        <h2 id="t-mcp">The MCP server.</h2>
        <p>Claude Code, Claude Desktop and any MCP client. One line to add it:</p>
        <Code>{"claude mcp add bitgraph -- npx -y @mikeargento/bitgraph-mcp"}</Code>
        <ul className="docs-list" style={{ marginTop: 20 }}>
          <li><code>bitgraph_record</code> makes a BitGraph of each file or folder given; each proof is saved beside its file as <code>&lt;file&gt;.bitgraph.json</code>.</li>
          <li><code>bitgraph_check</code> says whether files or digests are on record, and where. Read-only.</li>
          <li><code>bitgraph_get_proof</code> fetches a proof by digest, BitGraph number or file path. Read-only.</li>
        </ul>
        <p>Clients that connect by URL can use the hosted server at <code>https://bitgraph.ing/mcp</code>.</p>
      </section>

      <section className="home-section" aria-labelledby="t-sdk">
        <p className="home-kicker">SDK and CLI</p>
        <h2 id="t-sdk">For any stack.</h2>
        <Code>{"npm install @mikeargento/bitgraph-sdk"}</Code>
        <Code>{`import { BitGraph } from "@mikeargento/bitgraph-sdk";

const [b] = await new BitGraph().bind("run-042.log");
console.log(b.number, b.proofUrl); // run-042.log.bitgraph.json is saved beside the file`}</Code>
        <p style={{ marginTop: 20 }}>The same verbs from any language that can run a command, with <code>--json</code> for machines:</p>
        <Code>{`npx -p @mikeargento/bitgraph-sdk bitgraph make run-042.log
npx -p @mikeargento/bitgraph-sdk bitgraph check run-042.log
npx -p @mikeargento/bitgraph-sdk bitgraph verify run-042.log
npx -p @mikeargento/bitgraph-sdk bitgraph serve   # the same on 127.0.0.1`}</Code>
      </section>

      <section className="home-section" aria-labelledby="t-api">
        <p className="home-kicker">HTTP API</p>
        <h2 id="t-api">Send a SHA-256, get the proof.</h2>
        <Code>{`curl -X POST https://bitgraph.ing/api/commit \\
  -H 'content-type: application/json' \\
  -d '{"digests":[{"digestB64":"<sha-256, base64>","hashAlg":"sha256"}]}'`}</Code>
        <p style={{ marginTop: 20 }}>Every BitGraph is kept. Fetch one by its hash:</p>
        <Code>{"curl https://bitgraph.ing/api/proofs/<sha-256, base64url>"}</Code>
        <p style={{ marginTop: 20 }}>
          Add <code>&quot;ceiling&quot;: true</code> to a commit to have its proof hash written to Base afterwards (the Base plugin, below).
        </p>
      </section>

      <section className="home-section" aria-labelledby="d-check">
        <p className="home-kicker">Check it offline</p>
        <h2 id="d-check">No account, nothing of BitGraph&rsquo;s running.</h2>
        <p>With the file and its proof (download it from the proof page), pinning the enclave&rsquo;s measurement so nothing else is accepted:</p>
        <Code>{`npx @mikeargento/bitgraph-sdk verify <file> --proof <proof>.json --pcr0 ${PUBLISHED_PCR0}`}</Code>
        <p style={{ marginTop: 20 }}>
          That is the whole check. What it does step by step, and how to rebuild the enclave image yourself, are under Reference at the
          end of this page. Rely on a check you run; a verdict on BitGraph&rsquo;s own pages is a convenience.
        </p>
      </section>

      <section className="home-section" aria-labelledby="d-what">
        <p className="home-kicker">How it&rsquo;s made</p>
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
          exact enclave image that did it. There is no partial state: if any step fails, no proof exists, the nonce is discarded without
          ever leaving the enclave, and the counter does not move.
        </p>
        <p>
          The nonce is used once, and the enclave never gives out the same count twice, so every proof is one of a kind.
        </p>
        <p>
          Two BitGraphs bracket an interval: anything bound between them was bound after the first and before the second. Work made from
          the first one&rsquo;s nonce could not have existed before it. Plugins, below, builds on this.
        </p>
      </section>

      <section className="home-section" aria-labelledby="d-plugins">
        <p className="home-kicker">Plugins</p>
        <h2 id="d-plugins">Built from ordinary BitGraphs.</h2>
        <p>
          Two switches on the Make page add to a BitGraph without changing it. Each plugin is made of ordinary BitGraphs, every one the same
          two counts; nothing about either one enters the enclave or the proof format.
        </p>

        <p style={{ marginTop: 24 }}><strong>One position for many files.</strong></p>
        <p>
          The files are hashed into a Merkle tree in your browser (RFC 6962, SHA-256: a leaf is SHA-256 of a zero byte and the file, a node
          is SHA-256 of a one byte and its two children, and an odd last node rises unchanged). One BitGraph is made of{" "}
          <code>merkle-root.txt</code>, a short text file holding the root. You keep <code>merkle-tree.json</code>, which lists every
          file&rsquo;s leaf and every level. One position covers a million files as well as one.
        </p>
        <p>
          To check a file: drop it on the Make page with <code>merkle-tree.json</code> and <code>merkle-root.txt</code> (switches off). The
          page walks the file up the tree to the root and looks the root file up as a BitGraph. By hand: hash the file as a leaf, combine it
          with its neighbours up the levels, compare with the root in <code>merkle-root.txt</code>, and verify <code>merkle-root.txt</code>{" "}
          against its proof like any file.
        </p>

        <p style={{ marginTop: 24 }}><strong>Base time window.</strong></p>
        <p>Three steps, two BitGraphs:</p>
        <ol className="docs-list">
          <li><strong>BitGraph 1 is the floor.</strong> The latest Base block (number, hash, time) is written to <code>base-block.json</code> and bound. A block hash cannot be known before its block exists.</li>
          <li><strong>BitGraph 2 is the content,</strong> bound right after BitGraph 1 in the same sequence.</li>
          <li><strong>The ceiling.</strong> BitGraph 2&rsquo;s proof hash is written to Base by BitGraph&rsquo;s writer, in a later block. The proof existed by then.</li>
        </ol>
        <p>
          The content was bound after the first block and before the second: a window in real time, read from a public chain, around a
          position. The site checks the pair before it records BitGraph 1 as BitGraph 2&rsquo;s floor: <code>base-block.json</code> hashes
          to BitGraph 1&rsquo;s digest, Base has that block with that hash and time, and both BitGraphs are in the ledger in the same epoch
          with BitGraph 2 after BitGraph 1. The record is kept beside the ledger and shown on BitGraph 2&rsquo;s proof page.
        </p>
        <p>To check a window yourself, with the download from the Make page:</p>
        <ol className="docs-list">
          <li>Verify both files against their proofs with the command above.</li>
          <li>Open the block in <code>base-block.json</code> on any Base explorer and compare its hash and time.</li>
          <li>Compare the two proofs&rsquo; <code>commit.epochId</code> (the same) and counts (BitGraph 2&rsquo;s after BitGraph 1&rsquo;s).</li>
          <li>Find BitGraph 2&rsquo;s Base transaction from its proof page and check that it carries the proof hash.</li>
        </ol>
        <p>
          Without the Base switch, a BitGraph is a position only: where your bits were bound in the sequence, with no claim about clock
          time.
        </p>
      </section>

      <section className="home-section" aria-labelledby="d-epochs">
        <p className="home-kicker">Epochs</p>
        <h2 id="d-epochs">A fresh key every day.</h2>
        <p>
          The enclave restarts once a day, at 23:59 UTC. Each run is an epoch: a new Ed25519 key made inside the enclave, a counter starting
          at zero, and an epoch ID that is the base64 SHA-256 of the public key and a fresh boot nonce. The key never leaves the enclave and
          is gone when the epoch ends, so an epoch that has ended cannot sign anything new (unless its key was stolen while it ran).
          Epochs are not chained to one another; each stands on its own key and its own attestation. Instead, each epoch&rsquo;s first
          BitGraph binds a fresh read of the latest Base block (<code>epoch-floor.json</code>), so the epoch provably began after that
          block, in public time, and no two epochs start from the same point. The enclave has no
          storage of its own: the counter&rsquo;s continuity is kept by the enclave&rsquo;s code within each run, not carried by the
          hardware from one run to the next. While the enclave restarts, requests fail closed; nothing is made.
        </p>
      </section>

      <section className="home-section" aria-labelledby="d-proves">
        <p className="home-kicker">Limits, in full</p>
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
          A reader does not trust the host machine around the enclave (it only carries messages), the network, this website, BitGraph&rsquo;s
          stored copies of proofs (a convenience, not the evidence), or Argento Computing Inc. Accepting the hardware root is a one-time
          decision, not an ongoing dependency: a proof is portable and checks without asking anyone.
        </p>
        <p>
          The design prevents reusing a nonce, swapping positions, changing any signed field, and signing new proofs as an epoch
          that has ended: its key is destroyed when the epoch ends, so only a key stolen while the epoch ran could. It does not protect
          against a malicious client or a compromised build pipeline, and a flaw in the enclave image would affect every epoch that runs
          it. The implementation has not had an independent security audit.
        </p>
        <p>
          BitGraph controls availability and publication. Anyone can verify a proof independently, but a proof alone cannot
          establish that every commitment has been disclosed. A proof withheld from the middle of the published sequence shows as a
          missing count; the most recent ones, withheld, would not show at all.
        </p>
        <p>
          Privacy: a digest is public once it is bound, and digests are not salted. A hash does not reveal the file, but a file someone can
          guess (a short text, a public document) can be identified by hashing the guess and looking it up.
        </p>
      </section>

      <section className="home-section" aria-labelledby="d-faq">
        <p className="home-kicker">Questions</p>
        <h2 id="d-faq">Short answers.</h2>
        <p><strong>Does BitGraph upload my file?</strong> No. Only its SHA-256 is sent. (A client you did not write could send more; this site&rsquo;s drop boxes and the published packages send only the hash.)</p>
        <p><strong>Can the same file get two proofs?</strong> Yes. Each is its own BitGraph at its own position, with its own nonce.</p>
        <p><strong>What if someone edits the proof?</strong> Any change to a signed field breaks the signature, and the check fails.</p>
        <p><strong>Why not just trust a timestamp?</strong> A time written by the party a check exists to catch is a claim, not evidence. A BitGraph&rsquo;s place comes from a counter and a value nobody could predict, signed by measured hardware.</p>
        <p><strong>Does the Base switch change the BitGraph?</strong> No. The bind is the same two counts. The window comes from a second BitGraph (the block) and a write to Base afterwards, both outside the bind.</p>
        <p><strong>Is a tree weaker than one BitGraph per file?</strong> Every file in it shares one position: they were all bound together, at that point in the sequence. To tell the files apart in order, make them separately.</p>
        <p><strong>What does it cost to check?</strong> Nothing. Verification is free and permissionless.</p>
      </section>

      <section className="home-section" aria-labelledby="d-ref">
        <p className="home-kicker">Reference</p>
        <h2 id="d-ref">The proof, and the full check.</h2>
        <p><strong>A small signed JSON document:</strong></p>
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
        <Code>{"git clone https://github.com/mikeargento/bitgraph.git\ncd bitgraph\n./server/commit-service/reproducible-build/build-eif.sh enclave-v12"}</Code>
      </section>
    </div>
  );
}
