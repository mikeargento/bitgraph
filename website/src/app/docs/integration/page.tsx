import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Integration Guide",
  description: "How to commit artifacts, verify proofs, and integrate BitGraph into your application.",
};

export default function IntegrationPage() {
  return (
    <article className="prose-doc">
      <h1 className="text-3xl sm:text-4xl font-semibold tracking-[-0.03em] mb-6">Integration Guide</h1>
      <p className="text-[#1f2937] mb-10">
        How to commit artifacts, verify proofs, and integrate BitGraph into your application.
        Connecting an AI agent instead? See <a href="/docs/mcp">MCP</a>. Building a no-code
        workflow? See <a href="/docs/automation">Zapier and Make</a>.
      </p>

      <h2 className="text-xl font-semibold mt-12 mb-4">Quick start: commit via API</h2>
      <p className="text-[#1f2937] mb-4">
        Hash your artifact locally, then send only the digest to the BitGraph endpoint:
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
        Send multiple digests in one request. The enclave allocates a slot and commits each digest sequentially. If using actor-bound proofs (passkey), all proofs in the batch receive actor identity.
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
  bytes: originalFileBytes,
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
        enclave build. The digest may be hex or base64, either form.
      </p>
      <p className="text-sm text-[#4b5563] mb-8">
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
        <li>• <strong className="text-text">Files are never uploaded.</strong> Only the SHA-256 digest crosses the network.</li>
        <li>• <strong className="text-text">Commit via bitgraph.ing.</strong> The site endpoint records every causal position of a file for later lookup. Committing to the enclave host directly skips that index, and your recordings will not be discoverable by digest.</li>
        <li>• <strong className="text-text">The proof is portable.</strong> Store it alongside the artifact or in a separate system.</li>
        <li>• <strong className="text-text">Verification is offline.</strong> No API calls needed to verify. Just the public key and original bytes.</li>
        <li>• <strong className="text-text">Pin measurements.</strong> For production, always pin allowedMeasurements and require attestation.</li>
        <li>• <strong className="text-text">Track counters.</strong> Store the last accepted counter value to prevent replay.</li>
        <li>• <strong className="text-text">Causal slots.</strong> Every proof includes a pre-allocated slot that proves the enclave committed to a counter position before seeing the artifact hash.</li>
        <li>• <strong className="text-text">Attribution is signed.</strong> Name, title, and message in the attribution field are covered by the Ed25519 signature and cannot be tampered with.</li>
      </ul>
    </article>
  );
}
