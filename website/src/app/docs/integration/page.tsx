import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Integration Guide",
  description: "How to fuse a file, record existing bytes, verify proofs, and integrate BitGraph into your application.",
};

export default function IntegrationPage() {
  return (
    <article className="prose-doc">
      <h1 className="mb-6">Integration Guide</h1>
      <p className="text-[#1f2937] mb-10">
        How to fuse a file, record existing bytes, verify proofs, and integrate BitGraph into your application.
        Connecting an AI agent instead? See <a href="/docs/mcp">MCP</a>. Building a no-code
        workflow? See <a href="/docs/mcp">MCP</a>.
      </p>

      <h2 className="text-xl font-semibold mt-12 mb-4">Quick start: fuse a file</h2>
      <p className="text-[#1f2937] mb-4">
        The default operation. Your file is the origin and is never modified. In order: allocate an unused slot (the slot exists before any hash reaches the enclave), build a fused artifact that carries a commitment to that slot, hash the fused artifact, and commit that digest into the same slot. The proof bounds the fused bytes from below (the slot) and from above (the commit). The fused bytes are transient: the original plus the proof rebuilds them.
      </p>
      <div className="code-block">
        <div className="code-block-header"><span>Shell</span></div>
        <pre className="text-xs font-mono leading-relaxed text-[#1f2937] overflow-x-auto">{`# The bitgraph-fuse command ships with @mikeargento/bitgraph
npx -p @mikeargento/bitgraph bitgraph-fuse fuse photo.jpg --placement trailer/1 --out ./out
# writes ./out/photo.jpg.bitgraph-fuse.json, the Frame (manifest + proof); --keep also writes the fused copy

# Check the Frame against the original or the fused copy
npx -p @mikeargento/bitgraph bitgraph-fuse check ./out/photo.jpg.bitgraph-fuse.json photo.jpg
# exit 0 fused or verified, 1 refused or contradicted, 2 undetermined, 64 usage`}</pre>
      </div>
      <p className="text-[#1f2937] mb-4">
        Placements: <code>trailer/1</code> for formats whose decoders ignore trailing bytes (JPEG, PNG, GIF, TIFF and TIFF-based raws, BMP, RIFF such as WebP), <code>container/1</code> for everything else. <code>produce</code> makes a <code>produced/1</code> artifact with no source file. The same four steps from code:
      </p>
      <div className="code-block">
        <div className="code-block-header"><span>TypeScript</span></div>
        <pre className="text-xs font-mono leading-relaxed text-[#1f2937] overflow-x-auto">{`import { fuse, builderFor } from "@mikeargento/bitgraph";

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
// to place the commitment inside a format you produce yourself.`}</pre>
      </div>
      <p className="text-[#1f2937] mb-4">
        Over HTTP the same two calls are <code>POST /api/fuse/allocate</code> and <code>POST /api/fuse/commit</code>; see the <a href="/api-reference">API reference</a>. A fused commit that fails is reported as a failure; it is never downgraded to an ordinary recording.
      </p>

      <h2 className="text-xl font-semibold mt-12 mb-4">Record existing bytes</h2>
      <p className="text-[#1f2937] mb-4">
        Ordinary recording remains for bytes that already exist: it selects them and gives them a position, which establishes that those exact bytes existed no later than the commit. Hash your artifact locally, then send only the digest to the BitGraph endpoint:
      </p>
      <div className="code-block">
        <div className="code-block-header"><span>Shell</span></div>
        <pre className="text-xs font-mono leading-relaxed text-[#1f2937] overflow-x-auto">{`# 1. Hash your file
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
  }'`}</pre>
      </div>

      <h2 className="text-xl font-semibold mt-12 mb-4">TypeScript / JavaScript</h2>
      <div className="code-block">
        <div className="code-block-header"><span>TypeScript</span></div>
        <pre className="text-xs font-mono leading-relaxed text-[#1f2937] overflow-x-auto">{`// Hash locally
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
console.log(proof.attribution);      // signed creator metadata`}</pre>
      </div>

      <h2 className="text-xl font-semibold mt-12 mb-4">Batch commit</h2>
      <p className="text-[#1f2937] mb-4">
        Send multiple digests in one request. The enclave allocates a slot and commits each digest sequentially.
      </p>
      <div className="code-block">
        <div className="code-block-header"><span>TypeScript</span></div>
        <pre className="text-xs font-mono leading-relaxed text-[#1f2937] overflow-x-auto">{`const resp = await fetch("https://bitgraph.ing/api/commit", {
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
// proofs[0], proofs[1], proofs[2] - one per digest`}</pre>
      </div>

      <h2 className="text-xl font-semibold mt-12 mb-4">Verify a proof</h2>
      <div className="code-block">
        <div className="code-block-header"><span>TypeScript</span></div>
        <pre className="text-xs font-mono leading-relaxed text-[#1f2937] overflow-x-auto">{`import { verify } from "@mikeargento/bitgraph";

const result = await verify({
  proof: myProof,
  bytes: artifactBytes,
  trustAnchors: {
    requireEnforcement: "measured-tee",
    allowedMeasurements: ["ac813febd1ac4261..."],
    requireAttestation: true,
    requireAttestationFormat: ["aws-nitro"],
  },
});

if (result.valid) {
  console.log("Proof verified successfully");
} else {
  console.error("Verification failed:", result.reason);
}`}</pre>
      </div>
      <p className="text-[#1f2937] mb-4 mt-6">
        For a fused artifact, use <code>verifyFuse</code> from <code>@mikeargento/bitgraph-verify</code> (MIT). It runs the same checks, then compares the commitment: <code>FUSED_DIRECT</code> when the bytes are the fused copy, <code>FUSED_FROM_ORIGIN</code> when they are the original and rebuild the committed artifact byte for byte, <code>RECORDED</code> for an ordinary proof, <code>NO_MATCH</code> when the bytes match neither digest. See <a href="/docs/verification">Verification</a> for the full outcome table.
      </p>
      <div className="code-block">
        <div className="code-block-header"><span>TypeScript</span></div>
        <pre className="text-xs font-mono leading-relaxed text-[#1f2937] overflow-x-auto">{`import { verifyFuse } from "@mikeargento/bitgraph-verify";

// bytes: the fused copy, or the original it was made from
const result = await verifyFuse({ proof: frame.proof, bytes, frame });

result.category;      // "FUSED_DIRECT" | "FUSED_FROM_ORIGIN" | "RECORDED" | "NO_MATCH" | ...
result.span;          // { slotCounter, commitCounter, epochId, chainId, positions }
result.statements;    // the bounded statements, verbatim`}</pre>
      </div>

      <h2 className="text-xl font-semibold mt-12 mb-4">Verify over HTTP</h2>
      <p className="text-[#1f2937] mb-4">
        For callers that cannot run a verifier: no-code automation platforms, shell scripts,
        anything without a JavaScript runtime. It delegates to the same package, so this
        endpoint and the offline verifier cannot disagree.
      </p>
      <div className="code-block">
        <div className="code-block-header"><span>Shell</span></div>
        <pre className="text-xs font-mono leading-relaxed text-[#1f2937] overflow-x-auto">{`DIGEST=$(openssl dgst -sha256 -binary myfile.pdf | base64)

curl -X POST https://bitgraph.ing/api/verify \\
  -H "Content-Type: application/json" \\
  -d '{"digest": "'$DIGEST'"}'

# {
#   "verified": true,
#   "status": "valid",
#   "artifactBinding": "checked",
#   "onRecord": true,
#   "counter": "7910",
#   "epochId": "...",
#   "proof": { ... }
# }`}</pre>
      </div>
      <p className="text-[#1f2937] mb-4">
        Send <code>proof</code> to check a proof you are carrying rather than whatever the
        ledger currently holds, and both together to check that the proof describes that exact
        file. Add <code>allowedMeasurements</code> to reject anything not signed by a specific
        enclave build. The digest may be hex or base64, either form. A digest that has only been
        named as the origin of fused artifacts, never recorded itself, comes back as not on record
        with <code>fusedDescendants</code> counting them; those bound the bytes from above only.
      </p>
      <p className="text-base text-[#4b5563] mb-8">
        <strong className="text-text">Read <code>artifactBinding</code>, not just <code>verified</code>.</strong>{" "}
        <code>checked</code> means the digest you sent matches the one inside the proof.
        <code> not-checked</code> means the proof is sound but nothing tied it to a file, which
        is what you get from a proof with no digest alongside it. <code>mismatch</code> means
        the proof is genuine and is for different bytes. A verdict from the service that issued
        the proof is a convenience; the proof comes back whole so you can redo the check
        yourself, which is the result that counts.
      </p>

      <h2 className="text-xl font-semibold mt-12 mb-4">Enclave info</h2>
      <div className="code-block">
        <div className="code-block-header"><span>Shell</span></div>
        <pre className="text-xs font-mono leading-relaxed text-[#1f2937] overflow-x-auto">{`# Get enclave public key and measurement
curl https://nitro.occproof.com/key

# Response:
# {
#   "publicKeyB64": "...",
#   "measurement": "ac813febd1ac4261...",
#   "enforcement": "measured-tee"
# }`}</pre>
      </div>

      <h2 className="text-xl font-semibold mt-12 mb-4">Important notes</h2>
      <ul className="space-y-2 text-sm text-[#1f2937]">
        <li>• <strong className="text-text">Files are never uploaded.</strong> Only SHA-256 digests and slot records cross the network.</li>
        <li>• <strong className="text-text">Commit via bitgraph.ing.</strong> The site endpoint records every causal position of a file for later lookup. A lookup by a file&apos;s digest lists its recordings and every fused artifact naming it as origin, by position, never ranked. Committing to the enclave host directly skips that index, and your recordings will not be discoverable by digest.</li>
        <li>• <strong className="text-text">The proof is portable.</strong> Store it alongside the artifact or in a separate system.</li>
        <li>• <strong className="text-text">Verification is offline.</strong> No API calls needed to verify. Just the public key and the bytes: the artifact, or the origin of a fused artifact.</li>
        <li>• <strong className="text-text">Pin measurements.</strong> For production, always pin allowedMeasurements and require attestation.</li>
        <li>• <strong className="text-text">Track counters.</strong> Store the last accepted counter value to prevent replay.</li>
        <li>• <strong className="text-text">Causal slots.</strong> Every proof includes a pre-allocated slot that proves the enclave committed to a counter position before seeing the artifact hash.</li>
        <li>• <strong className="text-text">Fused artifacts.</strong> The commitment inside a fused artifact names a slot that existed before the artifact was finished, so the slot is a lower bound and the commit an upper bound on those exact bytes. The fused bytes are transient; the original plus the proof rebuilds them.</li>
        <li>• <strong className="text-text">Attribution is signed.</strong> Name, title, and message in the attribution field are covered by the Ed25519 signature; the proof is detectably invalid if they are altered. On a fused proof the attribution is the marker: name <code>bitgraph-fuse/1</code>, title the placement, message the origin digest.</li>
      </ul>
    </article>
  );
}
