import type { Metadata } from "next";
import Link from "next/link";
import { CopyCode } from "@/components/copy-code";
import { Code } from "@/components/code";
import { BoundaryFigure } from "@/components/figures/boundary-figure";

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
        <li><b>Packages</b><span><code>@mikeargento/bitgraph-sdk</code> 0.4.1 makes a BitGraph and ships the <code>bitgraph</code> command. <code>@mikeargento/bitgraph-verify</code> 1.16.0 checks one; it is MIT-licensed and makes no network call. <code>@mikeargento/bitgraph-audit</code> 0.9.0 is the deeper offline audit. The older <code>@mikeargento/bitgraph</code> package made the earlier form (set/1, set/2, the Frame file); what it made still verifies, but new integrations use the SDK.</span></li>
        <li><b>Account</b><span>None. The public endpoint at <code>https://bitgraph.ing</code> needs no key. A self-hosted enclave may require a Bearer token; see the <Link href="/api-reference">API reference</Link>.</span></li>
        <li><b>The file</b><span>Stays on your machine. What crosses the network is digests, the tree&rsquo;s 84-byte root document, the signed position record, and each file&rsquo;s sealed recovery entry. That is a property of each client on this page; the enclave never receives a file.</span></li>
        <li><b>The spec</b><span><a href="/spec">SPEC.md</a> is the normative text. Every proof pins the SHA-256 of the version it was made under, and the holder keeps a copy beside the export.</span></li>
      </ul>
      <h3>Words used on this page</h3>
      <dl className="terms">
        <dt>File</dt>
        <dd>Any bytes.</dd>
        <dt>Digest</dt>
        <dd>The file&rsquo;s SHA-256, 32 bytes, standard base64 inside a proof.</dd>
        <dt>Position</dt>
        <dd>A place in the enclave&rsquo;s sequence, allocated and signed before it receives any digest. The API calls its signed record a slot (<code>slot</code>, <code>slotId</code>).</dd>
        <dt>Commit</dt>
        <dd>The single step that binds a digest to the position and consumes it. Atomic: either a proof exists or nothing does.</dd>
        <dt>Proof</dt>
        <dd>The signed <code>bitgraph/1</code> JSON. It travels inside the export.</dd>
        <dt>Tree</dt>
        <dd>What one BitGraph is: a <code>tree/1</code> Merkle tree of files under one position (SPEC section 8). Each file is a leaf; one file is a tree of one.</dd>
        <dt>Export</dt>
        <dd>The <code>bitgraph-export/1</code> JSON the holder keeps beside the files, with SPEC.md: the proof, the tree evidence, the floor header, and the ceiling and settlement once they exist. It holds no copy of any file.</dd>
        <dt>Committed bytes</dt>
        <dd>New bytes built around a file that carry a position commitment. Virtual: rebuilt from the file and the proof whenever needed.</dd>
        <dt>Floor</dt>
        <dd>The newest Base block when a position opened, bound into it by the enclave and signed into the proof as <code>commit.slotFloor</code>: the record was made after it, a time. Earlier proofs stand on an Ethereum anchor instead (<code>commit.slotAnchor</code>), a position whose file was an Ethereum block hash.</dd>
        <dt>Epoch</dt>
        <dd>One enclave lifetime, one UTC day in production. The signing key is destroyed at the end of it.</dd>
      </dl>

      <h2 id="make">The recommended path: make a BitGraph</h2>
      <p>
        Making a BitGraph is one operation with four steps, and the order is the point.
      </p>
      <ol className="steps">
        <li><strong>Reserve a position.</strong> The enclave allocates an unused position in its sequence and signs a position record for it before it receives any digest. The record has no field that could hold one.</li>
        <li><strong>Build the committed bytes.</strong> Derive the 32-byte position commitment from the signed position record and its floor block, and write it into new bytes for each file at a registered placement. The original is never modified.</li>
        <li><strong>Build the tree.</strong> Each file becomes a 65-byte leaf (placement, the committed bytes&rsquo; digest, the original&rsquo;s digest). The leaves form a Merkle tree, and an 84-byte root document holds the count, the root and the commitment. One file is a tree of one.</li>
        <li><strong>Commit under the same position.</strong> The digest sent is the SHA-256 of the root document. The enclave binds it to the position and consumes it in one atomic step, signs the body, and attests it. If any part fails, no proof exists and the position is lost.</li>
      </ol>
      <p>
        The commitment is a function of a record that did not exist until the position was allocated, so the committed bytes could not have been finished before that moment, and the floor the enclave fixed at that moment puts a public time under them. That bound reaches the committed bytes. It does not reach the original: the original can be any age, and the proof says only that it existed no later than the commit. A file recorded as is (<code>--as-is</code>) has the record floor only: recorded after the block, its bytes themselves not dated.
      </p>

      <h3>A record you produce yourself</h3>
      <div>
        <p>
          The four steps above wrap a file that already exists. A format you write yourself, such as an AI system&rsquo;s audit record, carries the commitment in a field of its own instead, and the order changes: the commitment goes inside the record before the record is signed, so the finished record depends on a position that existed before it.
        </p>
        <ol className="steps">
          <li><strong>Take a position.</strong> The system asks BitGraph for a position and receives its position commitment.</li>
          <li><strong>Put the commitment in the record.</strong> It is written into the record like any other field, before signing.</li>
          <li><strong>Sign the record.</strong> Only now does the record&rsquo;s final fingerprint exist.</li>
          <li><strong>Commit the fingerprint to the same position.</strong> Within the 120-second window the position is consumed and the proof binds the two.</li>
        </ol>
        <p>
          The signed record now contains a commitment to a position that existed before the record&rsquo;s own fingerprint, and that position is committed by this exact record. The record could not have been finished before the position, and it cannot be moved to another place afterwards. An agent connected over <a href="/docs/mcp">MCP</a> does this for its own task records.
        </p>
        <BoundaryFigure />
      </div>

      <h3>What comes back</h3>
      <ul className="facts">
        <li><b>The proof</b><span>An ordinary <code>bitgraph/1</code> proof whose artifact digest is the SHA-256 of the root document. <code>slotAllocation</code> is the position record you held, <code>commit.slotCounter</code> its counter, <code>commit.counter</code> the commit position, and the signed <code>attribution</code> is the marker: name <code>bitgraph-fuse/3</code> (<code>bitgraph-fuse/2</code> on earlier proofs), title <code>tree/1</code>, message the SHA-256 of SPEC.md. The root document rides unsigned in <code>metadata["bitgraph-tree/1"]</code> as hex and must hash to the signed digest.</span></li>
        <li><b>The export</b><span>From the CLI and the SDK, <code>bitgraph-&lt;counter&gt;.bitgraph.json</code>, a <code>bitgraph-export/1</code> file holding the proof, the root document, every leaf and name, and the floor header. A member export (<code>&lt;name&gt;.bitgraph.json</code>) holds one file&rsquo;s leaf and path instead. SPEC.md is written beside them. The Base ceiling and its settlement are pending at first; <code>bitgraph export complete</code> fills them in later.</span></li>
        <li><b>The committed bytes</b><span>Virtual. Nothing is written beyond the export; the original plus the proof rebuilds them byte for byte whenever they are needed.</span></li>
        <li><b>Recovery entries</b><span>Each file gets sealed entries under names derived from its hash, so the file alone can find its proof again if the export is lost. The hash itself is never indexed. <code>--no-recovery</code> keeps none.</span></li>
      </ul>

      <h3>From the command line</h3>
      <div className="code-block">
        <div className="code-block-header"><span>Shell</span><CopyCode /></div>
        <Code lang="bash">{`npx @mikeargento/bitgraph-sdk record photo.jpg --out ./proofs
# one tree; writes ./proofs/bitgraph-<counter>.bitgraph.json and SPEC.md beside it
# --exports owner|members|both|none, --as-is, --again, --no-recovery

# Check the file against its export, offline: one line per claim
npx @mikeargento/bitgraph-sdk verify photo.jpg ./proofs/bitgraph-<counter>.bitgraph.json
# exit 0 TRUE, 2 FALSE or corrupt; --eth-rpc and --base-rpc confirm the blocks against nodes

# Later: add the Base ceiling and its Ethereum settlement once they exist
npx @mikeargento/bitgraph-sdk export complete ./proofs/bitgraph-<counter>.bitgraph.json`}</Code>
      </div>
      <p>
        Placements: <code>trailer/1</code> for formats whose decoders ignore trailing bytes (JPEG, PNG, GIF, TIFF and TIFF-based raws, BMP, RIFF such as WebP), <code>container/2</code> for everything else (a tar with the original first; the older <code>container/1</code> stays readable). The SDK chooses the placement from the bytes. The byte layout of each placement is on the <Link href="/docs/proof-format#fused">proof format</Link> page and in <a href="/spec">SPEC.md</a> section 7.
      </p>

      <h3>From the SDK</h3>
      <p>The same four steps from code:</p>
      <div className="code-block">
        <div className="code-block-header"><span>TypeScript</span><CopyCode /></div>
        <Code lang="typescript">{`import { BitGraph } from "@mikeargento/bitgraph-sdk";

const bg = new BitGraph();
const r = await bg.record(["photo.jpg", "notes.txt"], { exportDir: "./proofs", exports: "both" });

r.files[0].proofUrl;        // the record's public receipt
r.made?.exports?.owner;     // ./proofs/bitgraph-<counter>.bitgraph.json: keep it with the files

// Later, offline: the file with its export, one line per claim
await bg.verifyExport("./proofs/bitgraph-<counter>.bitgraph.json", "photo.jpg");

// Later, online: add the Base ceiling and its settlement once they exist
await bg.completeExport("./proofs/bitgraph-<counter>.bitgraph.json");`}</Code>
      </div>
      <p>
        Without <code>exportDir</code> nothing is written and <code>r.made</code> holds everything an export is built from. Files already on record come back as on record, untouched, unless you pass <code>again</code>.
      </p>

      <h3>Over HTTP</h3>
      <p>
        The same two calls are <code>POST /api/fuse/allocate</code> and <code>POST /api/fuse/commit</code> on <code>https://bitgraph.ing</code>. Over HTTP you build the committed bytes, the leaves and the root document yourself: the commitment, the placements and the tree are specified in <a href="/spec">SPEC.md</a> sections 6 to 8, and the SDK is a reference implementation.
      </p>
      <div className="code-block">
        <div className="code-block-header"><span>Shell</span><CopyCode /></div>
        <Code lang="bash">{`# 1. Reserve a position. No body. The response carries its signed record
#    ("slot"); slotId is its nonce, a bearer ticket until it is consumed.
curl -X POST https://bitgraph.ing/api/fuse/allocate
# {
#   "slotId": "gTME79qH3fXQ5qXX0JxX6T5oGhFRLLw2BIUoeQai9Z8=",
#   "slot": { "version": "bitgraph/slot/1", "nonceB64": "...", "counter": "277",
#             "epochId": "...", "publicKeyB64": "...", "chainId": "bitgraph:main", "signatureB64": "..." },
#   "chainId": "bitgraph:main",
#   "floor": { "chain": "base", "evmChainId": 8453, "blockNumber": 52271417,
#              "blockHash": "0x...", "blockTimestamp": 1791332181 }   # the Base block the commit will sign
# }

# 2. Build the committed bytes, the leaves and the 84-byte root document from
#    that record and the floor's blockHash (SPEC.md section 8), then commit the root document's hash under
#    the same position within 120 seconds. Exactly one digest per commit.
curl -X POST https://bitgraph.ing/api/fuse/commit \\
  -H "Content-Type: application/json" \\
  -d '{
    "slotId": "<slot.nonceB64>",
    "slot": <the position record from step 1, verbatim>,
    "digests": [{ "digestB64": "<SHA-256 of the root document, base64>", "hashAlg": "sha256" }],
    "chainId": "bitgraph:main",
    "attribution": {
      "name": "bitgraph-fuse/3",
      "title": "tree/1",
      "message": "<SHA-256 of SPEC.md, base64>"
    },
    "floor": <the floor from step 1, verbatim>,
    "metadata": { "bitgraph-tree/1": "<the root document, 84 bytes as hex>" }
  }'
# { "proof": { ... } }   an ordinary bitgraph/1 proof, committed under the position you reserved`}</Code>
      </div>
      <p>
        The route checks the marker, that it knows the spec hash, the exact metadata shape, the root document&rsquo;s commitment against the named position and floor, and its hash against the digest, all before the position is spent. The enclave signs the floor it fixed when the position opened, so a commitment built on any other block fails verification. A commit that fails is reported as a failure; it is never downgraded to an ordinary recording, and the route refuses to return a proof minted under any position other than the one you named. The earlier single-file marker (<code>bitgraph-fuse/1</code>, title a placement) is still accepted. Every request, response, status code and error is in the <Link href="/api-reference">API reference</Link>.
      </p>
      <p>
        An export and recovery entries are the client&rsquo;s work: the export is built from the proof and the tree you hold (SPEC.md section 12), and entries are written with <code>POST /api/recovery</code> and read back with <code>GET /api/recovery/&lt;address&gt;</code> or <code>POST /api/recovery/lookup</code> (section 13). Check them before making anything again: a file already on record is found, not made twice.
      </p>

      <h3>What you send and what you get back</h3>
      <div className="table-scroll">
        <table className="table-k">
          <thead><tr><th>Step</th><th>You send</th><th>You get back</th></tr></thead>
          <tbody>
            <tr><td>Allocate</td><td>Nothing. An empty <code>POST</code>.</td><td><code>slotId</code> (the nonce), <code>slot</code> (the signed record), <code>chainId</code>.</td></tr>
            <tr><td>Commit</td><td><code>slotId</code>, the <code>slot</code> record verbatim, the root document&rsquo;s digest, the marker attribution, and the root document in <code>metadata</code>.</td><td><code>{`{ proof }`}</code>: the <code>bitgraph/1</code> proof of the tree.</td></tr>
            <tr><td>CLI or SDK</td><td>One or more files.</td><td>The export <code>bitgraph-&lt;counter&gt;.bitgraph.json</code> with SPEC.md beside it, and recovery entries written for each file.</td></tr>
          </tbody>
        </table>
      </div>

      <h2 id="store">What to store</h2>
      <p>
        Keep the export and SPEC.md beside the files. Keep the files unchanged: the files plus the export are the durable state, and the committed bytes are rebuilt from them whenever someone needs to check them. An export holds no copy of any file and no anchor proofs; a tree/1 proof signs its own floor.
      </p>
      <p>
        The export returned at commit time is the record. The service keeps a copy of each proof and indexes it by digest as a convenience, but that copy is not the evidence, and a lookup that finds nothing is not evidence that bytes were never recorded. Store what comes back.
      </p>
      <p>
        Recovery is the net under a lost export. Each file&rsquo;s sealed entries sit under names derived from its hash, encrypted with a key derived from it too, so whoever holds the file can find and open them and nobody else can. The SDK, the CLI, the MCP server and the drop box consult them before anything is made again. Recovery is a convenience BitGraph runs; the export is the record.
      </p>
      <p>
        Never write the raw <code>slotId</code> into a file or a log. It is the position&rsquo;s nonce, and until the commit it is a bearer ticket; the file carries only the derived commitment. Store the last accepted <code>commit.counter</code> for each epoch you have seen, so a replayed proof from an earlier position is noticed.
      </p>

      <h2 id="verify">How to verify</h2>
      <p>
        Verification needs the evidence and an explicit trust policy. The evidence is the export (the proof, the tree evidence and the floor block&rsquo;s header), and the file (the original, or the committed bytes built from it). The policy is an allowlist of enclave measurements (PCR0 values) you accept, and a requirement that the hardware attestation be present. Without the allowlist, a proof from any enclave image would pass. A proof that pins a spec hash the verifier does not know is answered undetermined, never TRUE.
      </p>

      <h3>A file with its export: <code>verifyExport</code></h3>
      <p>
        The current form. One line per claim, each saying what it rests on, and three time claims never merged: the floor (a Base block, or an Ethereum block on earlier proofs; the record came after it), the ceiling in time (a Base block; the record existed by it) and its settlement (Ethereum&rsquo;s own record of that Base block). Order after the record, the next BitGraph in the chain, is a bound in position, never a clock time.
      </p>
      <div className="code-block">
        <div className="code-block-header"><span>TypeScript</span><CopyCode /></div>
        <Code lang="typescript">{`import { promises as fs } from "node:fs";
import { parseExport, verifyExport } from "@mikeargento/bitgraph-verify";

const exp = parseExport(await fs.readFile("bitgraph-4821.bitgraph.json", "utf8"));
if (exp === null) throw new Error("not a bitgraph-export/1 file");

const result = await verifyExport(exp, {
  bytes: await fs.readFile("photo.jpg"),   // the original or the committed bytes; without it the file claims are NOT_CARRIED
  pins: { pcr0: ["934feb8bb6f4f7e2d2f85d902a7d5edd0981f706d9d2385638988ac096a05ea0583c3d00eef2a7947865ec66efc1fcf8"] }, // enclave-v9; default is BitGraph's published images
});

result.verdict;       // "TRUE" | "FALSE" | "UNDETERMINED"
result.claims;        // one per claim: id, result, what it rests on
result.times;         // floor, ceilingBase, ceilingEthereum, each as established or null
result.reading;       // plain language, written from the claims`}</Code>
      </div>
      <p>
        <code>verifyTreeMember</code> from the same package checks one member&rsquo;s evidence against a proof and its root document when you hold them apart from an export. The same judgment from the shell, with no code of your own: <code>npx @mikeargento/bitgraph-sdk verify photo.jpg bitgraph-4821.bitgraph.json</code>. The deeper audit over a folder of exports is <code>npx @mikeargento/bitgraph-audit</code>.
      </p>

      <h3>A plain recording: <code>verify</code></h3>
      <div className="code-block">
        <div className="code-block-header"><span>TypeScript</span><CopyCode /></div>
        <Code lang="typescript">{`import { verify } from "@mikeargento/bitgraph-verify";

const result = await verify({
  proof: myProof,
  bytes: artifactBytes,
  trustAnchors: {
    requireEnforcement: "measured-tee",
    allowedMeasurements: ["934feb8bb6f4f7e2d2f85d902a7d5edd0981f706d9d2385638988ac096a05ea0583c3d00eef2a7947865ec66efc1fcf8"], // enclave-v9, see PINS.md
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
        Pin <code>allowedMeasurements</code> to the published PCR0 for the current enclave (v9, above) and set <code>requireAttestation</code>. The measurement is reproducible from the published source; the <Link href="/docs/self-host-tee">self-host</Link> page shows how to rebuild it.
      </p>

      <h3>An earlier single fused file: <code>verifyFuse</code></h3>
      <p>
        For a single fused file made in the earlier form (marker <code>bitgraph-fuse/1</code> or <code>/2</code> with a placement title, a Frame file beside it), use <code>verifyFuse</code> from the same package. It runs the same checks, then compares the commitment: <code>FUSED_DIRECT</code> when the bytes are the fused copy, <code>FUSED_FROM_ORIGIN</code> when they are the original and rebuild the committed file byte for byte, <code>RECORDED</code> for an ordinary proof, <code>NO_MATCH</code> when the bytes match neither digest. See <Link href="/docs/verification">Verification</Link> for the full outcome table.
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
#   "measurement": "934feb8bb6f4f7e2...c1fcf8",
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
        Hash your file locally, then send only the digest to the BitGraph endpoint. The enclave allocates a position and commits the digest under it in one request.
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
console.log(proof.slotAllocation);   // the position record
console.log(proof.attribution);      // signed creator metadata`}</Code>
      </div>
      <p>
        Name, title and message in <code>attribution</code> are covered by the Ed25519 signature: the proof is detectably invalid if they are altered. They are a claim the submitter made, not a verified identity. <code>metadata</code> is not signed and is advisory.
      </p>

      <h3>Several at once</h3>
      <p>
        Send multiple digests in one request. The enclave allocates a position and commits each digest sequentially. Still the compatibility path: each digest names bytes that already exist.
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
        <li><strong>Hash locally.</strong> The file never leaves your machine; only digests, the root document, the position record and sealed recovery entries are sent.</li>
        <li><strong>Check before you make.</strong> Consult the recovery entries first: a file already on record is found, not made twice. The SDK, CLI and MCP server do this on their own.</li>
        <li><strong>Commit through bitgraph.ing.</strong> The site endpoints sit behind the floor gate, so every position they issue carries a Base floor. Allocate, build, hash and commit within 120 seconds, and treat any failure as a failure: a tree commit is never downgraded to a plain recording.</li>
        <li><strong>Store the export and SPEC.md beside the files.</strong> Keep the files unchanged. The committed bytes are virtual and rebuildable; the export is portable and can also live in a separate system. Run <code>export complete</code> later to add the ceiling and settlement.</li>
        <li><strong>Never expose the slotId.</strong> Only the derived commitment goes into the committed bytes; the nonce goes nowhere.</li>
        <li><strong>Verify with a pinned policy.</strong> <code>verifyExport</code> with <code>pins.pcr0</code> set to the published PCR0, or the default list of BitGraph&rsquo;s published images. Read each claim, not only the verdict. Verification is offline: the export, the file and the public measurement are enough.</li>
        <li><strong>Track counters.</strong> Store the last accepted <code>commit.counter</code> per epoch to notice a replay.</li>
        <li><strong>Handle the retryable answers.</strong> <code>503 tee-restarting</code> and <code>503 ledger-unavailable</code> mean try again. On earlier <code>bitgraph-fuse/2</code> commits, <code>409 no-anchor-before-slot</code> and <code>409 floor-mismatch</code> were final for that position: reserve a new one.</li>
      </ol>

      <h2 id="next">Where next</h2>
      <ul className="doors">
        <li><a href="/spec">SPEC.md</a><span>The normative text: tree/1, the export, recovery, the floor, the ceiling and its settlement.</span></li>
        <li><Link href="/api-reference">API reference</Link><span>Every endpoint, request, response, status code and error.</span></li>
        <li><Link href="/docs/proof-format">Proof format</Link><span>The bitgraph/1 schema field by field, the signed body, and the fused placements.</span></li>
        <li><Link href="/docs/verification">Verification</Link><span>What a verifier checks, in order, and what each result means.</span></li>
        <li><Link href="/docs/mcp">MCP server</Link><span>Connect an agent with one URL and let it make proofs of its own files.</span></li>
      </ul>
    </article>
  );
}
