import type { Metadata } from "next";
import Link from "next/link";
import { CopyCode } from "@/components/copy-code";
import { Code } from "@/components/code";

export const metadata: Metadata = {
  title: "Integration guide",
  description:
    "A correct first integration: what to install, how to make a BitGraph from the CLI, the SDK or two HTTP calls, what comes back, what to store, and how to verify it.",
};

/**
 * One operation, shown three ways, then what to keep and how to check it.
 * Recording bytes that already exist is a compatibility operation and is
 * kept below the recommended path, clearly labelled, so a first reader does
 * not take it for the normal way in. Every figure in the allocate-to-commit
 * section is read from the shipped enclave: SLOT_TTL_MS = 120_000 and
 * MAX_PENDING_SLOTS = 1000 in server/commit-service/src/enclave/app.ts.
 */
export default function IntegrationPage() {
  return (
    <article className="prose">
      <h1>Integration guide</h1>
      <p className="lede">
        How to make a BitGraph from your own code, keep what comes back, and check it later. Written for an engineer doing a first integration: one operation, shown from the CLI, the SDK and two HTTP calls, all producing the same proof on the same sequence. Connecting an AI agent instead? See the <Link href="/docs/mcp">MCP server</Link>.
      </p>

      <h2 id="need">What you need</h2>
      <ul className="facts">
        <li><b>Runtime</b><span>Node 20 or later for the CLI and the SDK. The HTTP calls need only an HTTP client and a SHA-256 implementation.</span></li>
        <li><b>Packages</b><span><code>@mikeargento/bitgraph</code> 1.9.0 makes a BitGraph. <code>@mikeargento/bitgraph-verify</code> 1.11.0 checks one; it is MIT-licensed and makes no network call.</span></li>
        <li><b>Account</b><span>None. The public endpoint at <code>https://bitgraph.ing</code> needs no key. A self-hosted enclave may require a Bearer token; see the <Link href="/api-reference">API reference</Link>.</span></li>
        <li><b>The file</b><span>Stays on your machine. What crosses the network is its fingerprint (SHA-256 digest) and the signed slot record. That is a property of each client on this page; the enclave never receives a file.</span></li>
      </ul>
      <h3>Words used on this page</h3>
      <dl className="terms">
        <dt>File</dt>
        <dd>Any bytes.</dd>
        <dt>Digest</dt>
        <dd>The file&rsquo;s SHA-256, 32 bytes, standard base64 inside a proof.</dd>
        <dt>Slot</dt>
        <dd>A position the enclave allocates and signs before it receives any digest.</dd>
        <dt>Commit</dt>
        <dd>The single step that binds a digest to the slot and consumes it. Atomic: either a proof exists or nothing does.</dd>
        <dt>Proof</dt>
        <dd>The <code>bitgraph/1</code> JSON the holder keeps beside the file.</dd>
        <dt>Fused file</dt>
        <dd>New bytes built around the original that carry a commitment to the slot.</dd>
        <dt>Anchor</dt>
        <dd>A position whose file is an Ethereum block hash. The anchor before a position is its floor, a time; the one after is its ceiling, a place in the sequence, not a clock reading.</dd>
        <dt>Epoch</dt>
        <dd>One enclave lifetime, one UTC day in production. The signing key is destroyed at the end of it.</dd>
      </dl>

      <h2 id="make">The recommended path: make a BitGraph</h2>
      <p>
        Making a BitGraph is one operation with four steps, and the order is the point.
      </p>
      <ol className="steps">
        <li><strong>Allocate a slot.</strong> The enclave allocates an unused position in its sequence and signs a slot record for it before it receives any digest. The record has no field that could hold one.</li>
        <li><strong>Build the fused file.</strong> Derive a 32-byte commitment from the signed slot record and write it into a new file at a registered placement, beside the unchanged original. The original is never modified.</li>
        <li><strong>Hash the fused file.</strong> SHA-256 over the new bytes.</li>
        <li><strong>Commit under the same slot.</strong> The enclave binds the digest to the slot and consumes it in one atomic step, signs the body, and attests it. If any part fails, no proof exists and the slot is lost.</li>
      </ol>
      <p>
        The commitment is a function of a record that did not exist until the slot was allocated, so the fused bytes could not have been finished before that moment, and the anchor signed into the slot record puts a public time under them. That bound reaches the fused bytes. It does not reach the original: the original can be any age, and the proof says only that it existed no later than the commit.
      </p>

      <h3>What comes back</h3>
      <ul className="facts">
        <li><b>The proof</b><span>An ordinary <code>bitgraph/1</code> proof of the fused bytes. <code>slotAllocation</code> is the slot you held, <code>commit.slotCounter</code> its counter, <code>commit.counter</code> the commit position, and the signed <code>attribution</code> is the marker: name <code>bitgraph-fuse/1</code>, title the placement, message the original&rsquo;s digest.</span></li>
        <li><b>The Frame</b><span>From the CLI and the SDK, a file named <code>&lt;name&gt;.bitgraph-fuse.json</code> holding <code>{`{ type: "bitgraph-fuse/1", manifest, proof }`}</code>. The manifest (placement, origin, artifact, fusedFile) is advisory; the proof inside it is the evidence.</span></li>
        <li><b>The new file</b><span>Virtual. The CLI writes it only with <code>--keep</code>; the original plus the proof rebuilds it byte for byte whenever it is needed.</span></li>
      </ul>

      <h3>From the command line</h3>
      <div className="code-block">
        <div className="code-block-header"><span>Shell</span><CopyCode /></div>
        <Code lang="bash">{`npx -p @mikeargento/bitgraph bitgraph-fuse fuse photo.jpg --placement trailer/1 --out ./out
# writes ./out/photo.jpg.bitgraph-fuse.json, the Frame (manifest + proof); --keep also writes the new file

# Check the Frame against the original or the new file
npx -p @mikeargento/bitgraph bitgraph-fuse check ./out/photo.jpg.bitgraph-fuse.json photo.jpg
# exit 0 fused or verified, 1 refused or contradicted, 2 undetermined, 64 usage`}</Code>
      </div>
      <p>
        Placements: <code>trailer/1</code> for formats whose decoders ignore trailing bytes (JPEG, PNG, GIF, TIFF and TIFF-based raws, BMP, RIFF such as WebP), <code>container/2</code> for everything else (a tar with the original first; the older <code>container/1</code> stays readable). <code>produce</code> makes a <code>produced/1</code> artifact with no source file. The byte layout of each placement is on the <Link href="/docs/proof-format#fused">proof format</Link> page.
      </p>

      <h3>From the SDK</h3>
      <p>The same four steps from code:</p>
      <div className="code-block">
        <div className="code-block-header"><span>TypeScript</span><CopyCode /></div>
        <Code lang="typescript">{`import { fuse, builderFor } from "@mikeargento/bitgraph";

const original = new Uint8Array(await file.arrayBuffer());
const result = await fuse(builderFor("trailer/1", original), {
  placement: "trailer/1",
  original,
  fusedFile: "photo.fused.jpg",   // advisory, recorded in the Frame manifest
});

result.proof;          // an ordinary bitgraph/1 proof of the fused bytes
result.frame;          // { type: "bitgraph-fuse/1", manifest, proof }
result.verification;   // verifyFuse over the fused bytes, run locally: FUSED_DIRECT

// A builder receives the commitment, never the raw nonce. Write your own
// to place the commitment inside a format you produce yourself.`}</Code>
      </div>
      <p>
        <code>result.verification</code> is <code>verifyFuse</code> run locally over the fused bytes, so the SDK checks its own work before it returns.
      </p>

      <h3>Over HTTP</h3>
      <p>
        The same two calls are <code>POST /api/fuse/allocate</code> and <code>POST /api/fuse/commit</code> on <code>https://bitgraph.ing</code>. Over HTTP you build the fused file yourself: the commitment derivation is specified on the proof format page, and the SDK&rsquo;s <code>builderFor</code> is a reference for the placements.
      </p>
      <div className="code-block">
        <div className="code-block-header"><span>Shell</span><CopyCode /></div>
        <Code lang="bash">{`# 1. Allocate a slot. No body. The response carries the signed slot record;
#    slotId is the slot's nonce, a bearer ticket until the slot is consumed.
curl -X POST https://bitgraph.ing/api/fuse/allocate
# {
#   "slotId": "gTME79qH3fXQ5qXX0JxX6T5oGhFRLLw2BIUoeQai9Z8=",
#   "slot": { "version": "bitgraph/slot/1", "nonceB64": "...", "counter": "277",
#             "epochId": "...", "publicKeyB64": "...", "chainId": "bitgraph:main", "signatureB64": "..." },
#   "chainId": "bitgraph:main"
# }

# 2. Build the fused file from the slot record, hash it, and commit that digest
#    under the same slot within 120 seconds. Exactly one digest per commit.
curl -X POST https://bitgraph.ing/api/fuse/commit \\
  -H "Content-Type: application/json" \\
  -d '{
    "slotId": "<slot.nonceB64>",
    "slot": <the slot record from step 1, verbatim>,
    "digests": [{ "digestB64": "<SHA-256 of the fused bytes, base64>", "hashAlg": "sha256" }],
    "chainId": "bitgraph:main",
    "attribution": {
      "name": "bitgraph-fuse/1",
      "title": "trailer/1",
      "message": "<SHA-256 of the original, base64>"
    }
  }'
# { "proof": { ... } }   an ordinary bitgraph/1 proof, committed under the slot you allocated`}</Code>
      </div>
      <p>
        A fused commit that fails is reported as a failure; it is never downgraded to an ordinary recording, and the route refuses to return a proof minted under any slot other than the one you named. Every request, response, status code and error is in the <Link href="/api-reference">API reference</Link>.
      </p>

      <h3>What you send and what you get back</h3>
      <div className="table-scroll">
        <table className="table-k">
          <thead><tr><th>Step</th><th>You send</th><th>You get back</th></tr></thead>
          <tbody>
            <tr><td>Allocate</td><td>Nothing. An empty <code>POST</code>.</td><td><code>slotId</code> (the nonce), <code>slot</code> (the signed record), <code>chainId</code>.</td></tr>
            <tr><td>Commit</td><td><code>slotId</code>, the <code>slot</code> record verbatim, the fused file&rsquo;s digest, and the marker attribution.</td><td><code>{`{ proof }`}</code>: the <code>bitgraph/1</code> proof of the fused bytes.</td></tr>
            <tr><td>CLI or SDK</td><td>The original file and a placement.</td><td>The proof, wrapped in the Frame <code>&lt;name&gt;.bitgraph-fuse.json</code>, and on request the new file.</td></tr>
          </tbody>
        </table>
      </div>

      <h2 id="store">What to store</h2>
      <p>
        Keep the proof, or the Frame that carries it, beside the original. Keep the original unchanged: the original plus the proof is the durable state, and the new file is rebuilt from them whenever someone needs to check it. Keep the new file only if you want a copy to hand out.
      </p>
      <p>
        The proof returned at commit time is the record. The service keeps a copy of each proof and indexes it by digest as a convenience, but that copy is not the evidence, and a lookup that finds nothing is not evidence that bytes were never recorded. Store what comes back.
      </p>
      <p>
        Never write the raw <code>slotId</code> into a file or a log. It is the slot&rsquo;s nonce, and until the commit it is a bearer ticket; the file carries only the derived commitment. Store the last accepted <code>commit.counter</code> for each epoch you have seen, so a replayed proof from an earlier position is noticed.
      </p>

      <h2 id="verify">How to verify</h2>
      <p>
        Verification needs the evidence and an explicit trust policy. The evidence is the proof, the bytes (the fused file, or the original it was built from), and for the floor, the anchor and its block header witness. The policy is an allowlist of enclave measurements (PCR0 values) you accept, and a requirement that the hardware attestation be present. Without the allowlist, a proof from any enclave image would pass.
      </p>

      <h3>A recorded file: <code>verify</code></h3>
      <div className="code-block">
        <div className="code-block-header"><span>TypeScript</span><CopyCode /></div>
        <Code lang="typescript">{`import { verify } from "@mikeargento/bitgraph-verify";

const result = await verify({
  proof: myProof,
  bytes: artifactBytes,
  trustAnchors: {
    requireEnforcement: "measured-tee",
    allowedMeasurements: ["eccfc1c78006f4b74f929c992785575c908a0f60eca08ff638cd6c0842f993f182ebb002457b8ef3e732a6a10805c72b"], // enclave-v8, see PINS.md
    requireAttestation: true,
    requireAttestationFormat: ["aws-nitro"],
  },
});

if (result.valid) {
  console.log("Proof verified successfully");
} else {
  console.error("Verification failed:", result.reason);
}`}</Code>
      </div>
      <p>
        Pin <code>allowedMeasurements</code> to the published PCR0 for the current enclave (v8, above) and set <code>requireAttestation</code>. The measurement is reproducible from the published source; the <Link href="/docs/self-host-tee">self-host</Link> page shows how to rebuild it.
      </p>

      <h3>A fused file: <code>verifyFuse</code></h3>
      <p>
        For a fused file, use <code>verifyFuse</code> from the same package. It runs the same checks, then compares the commitment: <code>FUSED_DIRECT</code> when the bytes are the fused copy, <code>FUSED_FROM_ORIGIN</code> when they are the original and rebuild the committed file byte for byte, <code>RECORDED</code> for an ordinary proof, <code>NO_MATCH</code> when the bytes match neither digest. See <Link href="/docs/verification">Verification</Link> for the full outcome table.
      </p>
      <div className="code-block">
        <div className="code-block-header"><span>TypeScript</span><CopyCode /></div>
        <Code lang="typescript">{`import { verifyFuse } from "@mikeargento/bitgraph-verify";

// bytes: the new file, or the original it was made from
const result = await verifyFuse({ proof: frame.proof, bytes, frame });

result.category;      // "FUSED_DIRECT" | "FUSED_FROM_ORIGIN" | "RECORDED" | "NO_MATCH" | ...
result.span;          // { slotCounter, commitCounter, epochId, chainId, positions }
result.statements;    // the bounded statements, verbatim`}</Code>
      </div>

      <h3>Over HTTP</h3>
      <p>
        For callers that cannot run a verifier: shell scripts, anything without a JavaScript runtime. The endpoint delegates to the same package, so it and the offline verifier cannot disagree.
      </p>
      <div className="code-block">
        <div className="code-block-header"><span>Shell</span><CopyCode /></div>
        <Code lang="bash">{`DIGEST=$(openssl dgst -sha256 -binary myfile.pdf | base64)

curl -X POST https://bitgraph.ing/api/verify \\
  -H "Content-Type: application/json" \\
  -d '{"proof": '"$(cat proof.json)"', "digest": "'$DIGEST'"}'

# {
#   "verified": true,
#   "status": "valid",
#   "artifactBinding": "checked",
#   "counter": "7910",
#   "epochId": "...",
#   "proof": { ... }
# }`}</Code>
      </div>
      <p>
        Send <code>proof</code> and <code>digest</code> together to check that the proof describes that exact file. Add <code>allowedMeasurements</code> to reject anything not signed by a specific enclave build. The digest may be hex or base64, either form. A digest alone is looked up in the service&rsquo;s index; a miss there is not a verdict about the bytes, so send the proof when you hold it.
      </p>
      <p>
        <strong>Read <code>artifactBinding</code>, not just <code>verified</code>.</strong> <code>checked</code> means the digest you sent matches the one inside the proof. <code>not-checked</code> means the proof is sound but nothing tied it to a file, which is what you get from a proof with no digest alongside it. <code>mismatch</code> means the proof is genuine and is for different bytes. A verdict from the service that issued the proof is a convenience; the proof comes back whole so you can redo the check yourself, which is the result that counts.
      </p>

      <h3>The enclave&rsquo;s key and measurement</h3>
      <div className="code-block">
        <div className="code-block-header"><span>Shell</span><CopyCode /></div>
        <Code lang="bash">{`# Get enclave public key and measurement
curl https://nitro.occproof.com/key

# Response:
# {
#   "publicKeyB64": "...",
#   "measurement": "eccfc1c78006f4b7...05c72b",
#   "epochId": "...",
#   "enforcement": "measured-tee"
# }`}</Code>
      </div>

      {/* One method above, and this below it. Until 2026-09-03 the guide gave
          recording three peer sections of its own, so a reader could
          reasonably conclude it was the normal way in. It is not. It is what
          you use when the bytes exist already and cannot be rebuilt. */}
      <h2 id="compat">Compatibility: bytes that already exist</h2>
      <div className="callout is-limit">
        <span className="kicker">Compatibility operation</span>
        <p>
          Use this only when the bytes are already final and cannot be rebuilt around a position: an archive, a signed document, something a third party handed you. It gives those bytes a position, which establishes that the exact bytes existed no later than that position in the sequence. The floor bounds the placement, not the bytes.
        </p>
      </div>
      <p>
        Hash your file locally, then send only the digest to the BitGraph endpoint. The enclave allocates a slot and commits the digest under it in one request.
      </p>
      <div className="code-block">
        <div className="code-block-header"><span>Shell</span><CopyCode /></div>
        <Code lang="bash">{`# 1. Hash your file
DIGEST=$(openssl dgst -sha256 -binary myfile.pdf | base64)

# 2. Send to BitGraph endpoint
curl -X POST https://bitgraph.ing/api/commit \\
  -H "Content-Type: application/json" \\
  -d '{
    "digests": [{
      "digestB64": "'$DIGEST'",
      "hashAlg": "sha256"
    }],
    "chainId": "bitgraph:main",
    "metadata": {
      "source": "my-app"
    }
  }'`}</Code>
      </div>

      <h3>The same from TypeScript</h3>
      <div className="code-block">
        <div className="code-block-header"><span>TypeScript</span><CopyCode /></div>
        <Code lang="typescript">{`// Hash locally
const bytes = new Uint8Array(await file.arrayBuffer());
const hashBuf = await crypto.subtle.digest("SHA-256", bytes);
const digestB64 = btoa(String.fromCharCode(...new Uint8Array(hashBuf)));

// Commit through the BitGraph endpoint (with optional attribution)
const resp = await fetch("https://bitgraph.ing/api/commit", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    digests: [{ digestB64, hashAlg: "sha256" }],
    chainId: "bitgraph:main",
    attribution: { name: "Jane Doe", title: "Project Photo" },
    metadata: { source: "my-app", fileName: file.name },
  }),
});

const [proof] = await resp.json();
// proof is a complete BitGraphProof JSON object
console.log(proof.commit.counter);
console.log(proof.slotAllocation);   // causal slot record
console.log(proof.attribution);      // signed creator metadata`}</Code>
      </div>
      <p>
        Name, title and message in <code>attribution</code> are covered by the Ed25519 signature: the proof is detectably invalid if they are altered. They are a claim the submitter made, not a verified identity. <code>metadata</code> is not signed and is advisory.
      </p>

      <h3>Several at once</h3>
      <p>
        Send multiple digests in one request. The enclave allocates a slot and commits each digest sequentially. Still the compatibility path: each digest names bytes that already exist.
      </p>
      <div className="code-block">
        <div className="code-block-header"><span>TypeScript</span><CopyCode /></div>
        <Code lang="typescript">{`const resp = await fetch("https://bitgraph.ing/api/commit", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    digests: [
      { digestB64: digest1, hashAlg: "sha256" },
      { digestB64: digest2, hashAlg: "sha256" },
      { digestB64: digest3, hashAlg: "sha256" },
    ],
    chainId: "bitgraph:main",
    attribution: { name: "Jane Doe" },
    metadata: { source: "my-app", batchId: "abc123" },
  }),
});

const proofs = await resp.json();
// proofs[0], proofs[1], proofs[2] - one per digest`}</Code>
      </div>

      {/* The question a serious evaluator asks first, and every number is read
          from the shipped enclave: SLOT_TTL_MS = 120_000 and
          MAX_PENDING_SLOTS = 1000 in server/commit-service/src/enclave/app.ts,
          the counter advances inside handleAllocateSlot, pendingSlots is an
          in-memory Map so allocation persists nothing, and that file's own
          header documents the gaps. The last paragraph is the honest limit of
          the claim. Do not soften it: a caller CAN hold several positions open
          inside the window, and saying so is worth more than the claim it
          gives up. */}
      <h2 id="between">What happens between allocate and commit</h2>
      <p>
        A position is held for 120 seconds. Up to 1,000 can be open at once across the whole enclave. Allocating one advances the counter immediately, so a position that is never committed leaves a permanent gap in the sequence. Nothing is written when a position is allocated, so an abandoned position is simply that gap. An enclave restart begins a new epoch and voids every position still open.
      </p>
      <div className="callout is-limit">
        <span className="kicker">The limit of the claim</span>
        <p>
          Inside that window a caller can hold several positions open and decide which file fills which. What the enclave signs is that it issued the position before it received the digest, and then bound the two. It does not sign that the position was chosen without knowledge of the file. Ordering between proofs comes from the previous-proof hash and the counters, so the gaps abandoned positions leave cost nothing.
        </p>
      </div>

      <h2 id="checklist">Checklist</h2>
      <ol className="steps">
        <li><strong>Hash locally.</strong> The file never leaves your machine; only digests and the slot record are sent.</li>
        <li><strong>Commit through bitgraph.ing.</strong> The site endpoints sit behind the anchor-first gate, so every position they issue carries a floor. Allocate, build, hash and commit within 120 seconds, and treat any failure as a failure: a fused commit is never downgraded to a plain recording.</li>
        <li><strong>Store the proof beside the original.</strong> Keep the original unchanged. The new file is virtual and rebuildable; the proof is portable and can also live in a separate system.</li>
        <li><strong>Never expose the slotId.</strong> Only the derived commitment goes into the file; the nonce goes nowhere.</li>
        <li><strong>Verify with a pinned policy.</strong> <code>allowedMeasurements</code> set to the published PCR0, <code>requireAttestation: true</code>. Read <code>artifactBinding</code>, not only <code>verified</code>. Verification is offline: the proof, the bytes and the public measurement are enough.</li>
        <li><strong>Track counters.</strong> Store the last accepted <code>commit.counter</code> per epoch to notice a replay.</li>
        <li><strong>Handle the retryable answers.</strong> <code>503 tee-restarting</code> and <code>503 ledger-unavailable</code> mean try again. <code>409 no-anchor-before-slot</code> is final for that slot: allocate a new one.</li>
      </ol>

      <h2 id="next">Where next</h2>
      <ul className="doors">
        <li><Link href="/api-reference">API reference</Link><span>Every endpoint, request, response, status code and error.</span></li>
        <li><Link href="/docs/proof-format">Proof format</Link><span>The bitgraph/1 schema field by field, the signed body, and the fused placements.</span></li>
        <li><Link href="/docs/verification">Verification</Link><span>What a verifier checks, in order, and what each result means.</span></li>
        <li><Link href="/docs/mcp">MCP server</Link><span>Connect an agent with one URL and let it make proofs of its own files.</span></li>
      </ul>
    </article>
  );
}
