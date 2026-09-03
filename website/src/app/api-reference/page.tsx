import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "API Reference",
  description: "BitGraph Protocol API reference: fuse, commit, lookup, verify, key, and health endpoints.",
};

function Endpoint({
  method,
  path,
  description,
  children,
}: {
  method: string;
  path: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card-hover border border-border-subtle overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-5 border-b border-border-subtle bg-bg-elevated">
        <span className={`method-badge ${method === "POST" ? "bg-info/10 text-info" : "bg-success/10 text-success"}`}>
          {method}
        </span>
        <code className="text-sm font-mono text-text">{path}</code>
      </div>
      <div className="px-6 py-6">
        <p className="text-base text-text-secondary mb-4">{description}</p>
        {children}
      </div>
    </div>
  );
}

function CodeBlock({ title, code }: { title?: string; code: string }) {
  return (
    <div className="terminal-glow border border-border-subtle bg-bg-elevated overflow-hidden mb-4">
      {title && (
        <div className="px-4 py-3 border-b border-border-subtle">
          <span className="text-xs font-mono text-text-tertiary">{title}</span>
        </div>
      )}
      <pre className="p-5 overflow-x-auto text-xs font-mono leading-relaxed text-text-secondary">
        {code}
      </pre>
    </div>
  );
}

export default function APIReferencePage() {
  return (
    <div style={{ maxWidth: 1120, margin: "0 auto", padding: "32px 24px 64px" }}>
      <div className="mb-16">
        <span className="inline-block text-[11px] font-medium uppercase tracking-[0.15em] text-text-tertiary mb-4">
          API Reference
        </span>
        <h1 className="bg-page-title mb-4">
          BitGraph Protocol API
        </h1>
        <p className="text-base leading-relaxed text-text-secondary max-w-xl">
          REST API for fusing and committing artifacts, looking up proofs by
          digest, and verifying proofs. The commit path runs inside an AWS
          Nitro Enclave.
        </p>
        <div className="mt-6 terminal-glow border border-border-subtle bg-bg-elevated p-4">
          <div className="text-[11px] font-medium uppercase tracking-[0.15em] text-text-tertiary mb-2">
            Base URL
          </div>
          <code className="text-sm font-mono text-text">
            https://nitro.occproof.com
          </code>
          <p className="text-xs text-text-tertiary mt-3">
            The enclave host. Routes under <code className="font-mono">/api/</code> are served by the site at <code className="font-mono">https://bitgraph.ing</code>.
          </p>
        </div>
      </div>

      {/* Authentication */}
      <div className="mb-12">
        <h2 className="text-[1.375rem] font-semibold mb-4">Authentication</h2>
        <p className="text-base text-text-secondary mb-4">
          Authentication is optional. If the server is configured with API keys,
          include a Bearer token:
        </p>
        <CodeBlock
          title="Authorization header"
          code={`Authorization: Bearer <your-api-key>`}
        />
        <p className="text-base text-text-secondary">
          If no API keys are configured on the server, all endpoints are open.
          The public demo endpoint does not require authentication.
        </p>
      </div>

      {/* Endpoints */}
      <div className="space-y-10">
        <h2 className="text-[1.375rem] font-semibold mb-4">Endpoints</h2>

        {/* POST /commit */}
        <Endpoint
          method="POST"
          path="/commit"
          description="Record existing bytes: commit one or more artifact digests. For each digest, the enclave allocates a causal slot (nonce + counter), then commits the artifact against that slot. Returns a complete BitGraph proof for each digest. For a fused artifact use /api/fuse/allocate and /api/fuse/commit instead. Requires API key if configured."
        >
          <h4 className="text-[11px] font-medium uppercase tracking-[0.15em] text-text-tertiary mb-2">
            Request body
          </h4>
          <CodeBlock
            code={`{
  "digests": [
    {
      "digestB64": "jYl9NHJP0VcRVh6OMEIU5VAGva6cu5kdrnPrlNr/RnU=",
      "hashAlg": "sha256"
    }
  ],
  "attribution": {                   // optional - signed creator metadata
    "name": "Jane Doe",
    "title": "Sunset at Malibu",
    "message": "Original RAW capture"
  },
  "metadata": {                      // optional, advisory (NOT signed)
    "source": "my-app",
    "fileName": "document.pdf"
  }
}`}
          />

          <h4 className="text-[11px] font-medium uppercase tracking-[0.15em] text-text-tertiary mb-2 mt-6">
            Response (200)
          </h4>
          <CodeBlock
            code={`[
  {
    "version": "bitgraph/1",
    "artifact": {
      "hashAlg": "sha256",
      "digestB64": "jYl9NHJP0VcRVh6OMEIU5VAGva6cu5kdrnPrlNr/RnU="
    },
    "commit": {
      "nonceB64": "gTME79qH3fXQ5qXX0JxX6T5oGhFRLLw2BIUoeQai9Z8=",
      "counter": "278",
      "slotCounter": "277",
      "slotHashB64": "...",
      "time": 1741496392841,
      "epochId": "a1b2c3d4e5f6..."
    },
    "signer": {
      "publicKeyB64": "...",
      "signatureB64": "..."
    },
    "environment": {
      "enforcement": "measured-tee",
      "measurement": "ac813febd1ac4261...",
      "attestation": {
        "format": "aws-nitro",
        "reportB64": "..."
      }
    },
    "slotAllocation": {
      "version": "bitgraph/slot/1",
      "nonceB64": "gTME79qH3fXQ5qXX0JxX6T5oGhFRLLw2BIUoeQai9Z8=",
      "counter": "277",
      "time": 1741496392800,
      "epochId": "a1b2c3d4e5f6...",
      "publicKeyB64": "...",
      "signatureB64": "..."
    },
    "timestamps": {
      "artifact": {
        "authority": "http://freetsa.org/tsr",
        "time": "2026-03-07T12:00:00Z",
        "digestAlg": "sha256",
        "digestB64": "...",
        "tokenB64": "..."
      }
    }
  }
]`}
          />

          <h4 className="text-[11px] font-medium uppercase tracking-[0.15em] text-text-tertiary mb-2 mt-6">
            Example: curl
          </h4>
          <CodeBlock
            code={`DIGEST=$(openssl dgst -sha256 -binary myfile.pdf | base64)

curl -X POST https://nitro.occproof.com/commit \\
  -H "Content-Type: application/json" \\
  -d '{
    "digests": [{
      "digestB64": "'$DIGEST'",
      "hashAlg": "sha256"
    }]
  }'`}
          />

          <h4 className="text-[11px] font-medium uppercase tracking-[0.15em] text-text-tertiary mb-2 mt-6">
            Example: TypeScript
          </h4>
          <CodeBlock
            code={`const bytes = new Uint8Array(await file.arrayBuffer());
const hashBuf = await crypto.subtle.digest("SHA-256", bytes);
const digestB64 = btoa(String.fromCharCode(...new Uint8Array(hashBuf)));

const resp = await fetch("https://nitro.occproof.com/commit", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    digests: [{ digestB64, hashAlg: "sha256" }],
  }),
});

const proofs = await resp.json();
// proofs[0] is a complete BitGraphProof`}
          />
        </Endpoint>

        {/* POST /allocate-slot */}
        <Endpoint
          method="POST"
          path="/allocate-slot"
          description="Pre-allocate a causal slot before committing an artifact. The slot reserves a nonce and counter position, proving the enclave signed a sequence position before receiving any artifact content. Same key policy as /commit; metered per address in slots (a bare allocation holds one of the enclave's pending-slot entries for up to 120 seconds). The chain is bound at allocation and defaults to the anchored chain."
        >
          <h4 className="text-[11px] font-medium uppercase tracking-[0.15em] text-text-tertiary mb-2">
            Request body (optional)
          </h4>
          <CodeBlock code={`{ "chainId": "bitgraph:main" }`} />

          <h4 className="text-[11px] font-medium uppercase tracking-[0.15em] text-text-tertiary mb-2 mt-6">
            Response (200)
          </h4>
          <CodeBlock
            code={`{
  "slotId": "gTME79qH3fXQ5qXX0JxX6T5oGhFRLLw2BIUoeQai9Z8=",
  "slot": {
    "version": "bitgraph/slot/1",
    "nonceB64": "gTME79qH3fXQ5qXX0JxX6T5oGhFRLLw2BIUoeQai9Z8=",
    "counter": "277",
    "epochId": "a1b2c3d4e5f6...",
    "publicKeyB64": "...",
    "chainId": "bitgraph:main",
    "signatureB64": "..."
  },
  "chainId": "bitgraph:main"
}`}
          />
          <p className="text-xs text-text-tertiary mt-3">
            Note: POST /commit handles slot allocation internally. A slot record carries no clock. The slotId is the slot&apos;s nonce: a bearer ticket until it is consumed, so do not disclose it before commit. Consuming a held slot over HTTP (POST /commit with slotId) is available only where the service enables it; a slot that is never consumed expires after 120 seconds. 429 with Retry-After when the per-address allocation budget is spent.
          </p>
        </Endpoint>

        {/* POST /api/fuse/allocate */}
        <Endpoint
          method="POST"
          path="/api/fuse/allocate"
          description="Allocate an unused slot for a fused artifact, before the artifact exists. No body. The slot exists before any hash reaches the enclave; the producer writes a commitment to the signed slot record into the artifact, then commits the artifact's digest under the same slot with POST /api/fuse/commit. Served by the site at https://bitgraph.ing. The route sits behind the anchor-first gate and a rotation guard: until the current epoch has an anchor, and in the window before the daily restart, it answers 503 tee-restarting."
        >
          <h4 className="text-[11px] font-medium uppercase tracking-[0.15em] text-text-tertiary mb-2">
            Request body
          </h4>
          <CodeBlock code={`(none)`} />

          <h4 className="text-[11px] font-medium uppercase tracking-[0.15em] text-text-tertiary mb-2 mt-6">
            Response (200)
          </h4>
          <CodeBlock
            code={`{
  "slotId": "gTME79qH3fXQ5qXX0JxX6T5oGhFRLLw2BIUoeQai9Z8=",
  "slot": {
    "version": "bitgraph/slot/1",
    "nonceB64": "gTME79qH3fXQ5qXX0JxX6T5oGhFRLLw2BIUoeQai9Z8=",
    "counter": "277",
    "epochId": "a1b2c3d4e5f6...",
    "publicKeyB64": "...",
    "chainId": "bitgraph:main",
    "signatureB64": "..."
  },
  "chainId": "bitgraph:main"
}`}
          />
          <p className="text-xs text-text-tertiary mt-3">
            The slotId is the slot&apos;s nonce, a bearer ticket until it is consumed: write only the derived commitment into the artifact, never the nonce, and do not log it. The commitment is SHA-256 over the domain string bitgraph-fuse/1, a zero byte, the SHA-256 of the canonical slot record and the nonce. A slot that is never consumed expires after 120 seconds. 429 with Retry-After when the per-address allocation budget is spent.
          </p>
        </Endpoint>

        {/* POST /api/fuse/commit */}
        <Endpoint
          method="POST"
          path="/api/fuse/commit"
          description="Commit the fused artifact's digest under the slot from /api/fuse/allocate. Exactly one digest. The signed attribution is the fused marker: name bitgraph-fuse/1, title the placement id, message the origin digest. An anchor must precede the slot in its epoch, otherwise 409 no-anchor-before-slot; that failure is final for the slot, so allocate again. The route refuses to return a proof minted under any other slot (502 slot-mismatch). Served by the site at https://bitgraph.ing."
        >
          <h4 className="text-[11px] font-medium uppercase tracking-[0.15em] text-text-tertiary mb-2">
            Request body
          </h4>
          <CodeBlock
            code={`{
  "slotId": "gTME79qH3fXQ5qXX0JxX6T5oGhFRLLw2BIUoeQai9Z8=",   // the slot's nonce
  "slot": { ... },                   // the slot record from /api/fuse/allocate, verbatim
  "digests": [{
    "digestB64": "<SHA-256 of the fused bytes>",
    "hashAlg": "sha256"
  }],
  "chainId": "bitgraph:main",
  "attribution": {
    "name": "bitgraph-fuse/1",       // fixed value; marks a fused proof
    "title": "trailer/1",            // placement id: trailer/1 | container/1 | produced/1
    "message": "<origin digest, standard base64>"
  }
}`}
          />

          <h4 className="text-[11px] font-medium uppercase tracking-[0.15em] text-text-tertiary mb-2 mt-6">
            Response (200)
          </h4>
          <CodeBlock
            code={`{
  "proof": {
    "version": "bitgraph/1",
    "artifact": { "hashAlg": "sha256", "digestB64": "<SHA-256 of the fused bytes>" },
    "commit": { "nonceB64": "...", "counter": "278", "slotCounter": "277", "slotHashB64": "...", "epochId": "..." },
    "attribution": { "name": "bitgraph-fuse/1", "title": "trailer/1", "message": "..." },
    "slotAllocation": { ... },       // the held slot
    ...
  }
}`}
          />
          <p className="text-xs text-text-tertiary mt-3">
            An ordinary bitgraph/1 proof: slotAllocation is the held slot, commit.slotCounter its counter, commit.counter the commit position. If the response is lost, read the proof back by the fused digest and match commit.slotHashB64 against the hash of the slot record you hold. Errors: 400 body shape; 409 no-anchor-before-slot; 502 slot-mismatch; 503 tee-restarting or ledger-unavailable, retry.
          </p>
        </Endpoint>

        {/* GET /key */}
        <Endpoint
          method="GET"
          path="/key"
          description="Returns the enclave's current Ed25519 public key, platform measurement, and enforcement tier. Useful for pinning allowedMeasurements and allowedPublicKeys in verification policy."
        >
          <h4 className="text-[11px] font-medium uppercase tracking-[0.15em] text-text-tertiary mb-2">
            Response (200)
          </h4>
          <CodeBlock
            code={`{
  "publicKeyB64": "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE...",
  "measurement": "ac813febd1ac4261eff4a6c059f78a5ecfc8c577...",
  "enforcement": "measured-tee"
}`}
          />
        </Endpoint>

        {/* POST /verify */}
        <Endpoint
          method="POST"
          path="/verify"
          description="Server-side verification of a proof against an optional policy. Note: verification can also be done entirely client-side. No API call required."
        >
          <h4 className="text-[11px] font-medium uppercase tracking-[0.15em] text-text-tertiary mb-2">
            Request body
          </h4>
          <CodeBlock
            code={`{
  "proof": { ... },                  // complete BitGraphProof
  "policy": {                        // optional VerificationPolicy
    "requireEnforcement": "measured-tee",
    "allowedMeasurements": ["ac813febd1ac4261..."],
    "requireAttestation": true,
    "minCounter": "100"
  }
}`}
          />

          <h4 className="text-[11px] font-medium uppercase tracking-[0.15em] text-text-tertiary mb-2 mt-6">
            Response (200)
          </h4>
          <CodeBlock
            code={`// Success
{ "valid": true }

// Failure
{ "valid": false, "reason": "measurement not in allowed set" }`}
          />
        </Endpoint>

        {/* GET /api/proofs/digest/{digest} */}
        <Endpoint
          method="GET"
          path="/api/proofs/digest/{digest}"
          description="Every causal position of a digest (url-safe base64, no padding). By the original's digest: its recordings and every fused artifact naming it as origin, by position, never ranked. By a fused artifact's digest: that proof with its origin. ?counter= (and ?epoch=) selects which position the lead proof describes; the default is the earliest recording. Served by the site at https://bitgraph.ing."
        >
          <h4 className="text-[11px] font-medium uppercase tracking-[0.15em] text-text-tertiary mb-2">
            Response (200)
          </h4>
          <CodeBlock
            code={`{
  "proofs": [{ "proof": { ... } }],   // the selected position; [] when the ledger holds nothing
  "lookupKind": "recorded",           // "recorded" | "origin-only" (only fused descendants exist)
  "positions": [
    {
      "counter": "278",
      "epoch": "<url-safe>",
      "lowerTime": "2026-03-07T12:00:00.000Z",   // anchor before, or null
      "upperTime": "2026-03-07T12:00:12.000Z",   // anchor after, or null
      "kind": "recorded",             // "recorded" | "fused"
      "artifactDigest": "<url-safe>"
    },
    {
      "counter": "301",
      "epoch": "<url-safe>",
      "lowerTime": "...",
      "upperTime": "...",
      "kind": "fused",
      "artifactDigest": "<url-safe>", // the fused artifact's own digest
      "placement": "trailer/1",
      "fusedOrigin": "<url-safe>"     // the origin digest named by the signed marker
    }
  ],
  "causalWindow": { "anchorBefore": { ... }, "anchorAfter": { ... } },
  "anchorBlock": null
}`}
          />
          <p className="text-xs text-text-tertiary mt-3">
            An empty proofs list means the ledger holds nothing for this digest. 503 with &quot;ledger unavailable&quot; means the ledger could not be read; it is not an answer about the bytes.
          </p>
        </Endpoint>

        {/* POST /api/proofs/batch */}
        <Endpoint
          method="POST"
          path="/api/proofs/batch"
          description="Batch form of the lookup: one round trip for up to 500 url-safe digests. Each entry lists that digest's positions with their kind. Served by the site at https://bitgraph.ing."
        >
          <h4 className="text-[11px] font-medium uppercase tracking-[0.15em] text-text-tertiary mb-2">
            Request body
          </h4>
          <CodeBlock code={`{ "digests": ["<digest-a>", "<digest-b>", "<digest-c>"] }`} />

          <h4 className="text-[11px] font-medium uppercase tracking-[0.15em] text-text-tertiary mb-2 mt-6">
            Response (200)
          </h4>
          <CodeBlock
            code={`{
  "results": {
    "<digest-a>": {
      "proofs": [
        { "proof": { ... }, "writeTime": 1741496392841, "kind": "recorded" },
        { "proof": { ... }, "writeTime": 1741496410207, "kind": "fused" }
      ]
    },
    "<digest-b>": { "proofs": [] },                        // nothing on the ledger
    "<digest-c>": { "proofs": [], "unavailable": true }    // the read failed; not an answer
  }
}`}
          />
        </Endpoint>

        {/* GET /health */}
        <Endpoint
          method="GET"
          path="/health"
          description="Health check. Returns 200 if the parent server is running and can communicate with the enclave."
        >
          <h4 className="text-[11px] font-medium uppercase tracking-[0.15em] text-text-tertiary mb-2">
            Response (200)
          </h4>
          <CodeBlock code={`{ "ok": true }`} />
        </Endpoint>
      </div>

      {/* Types */}
      <div className="section-divider mt-16 mb-16" />
      <div className="pt-0">
        <h2 className="text-[1.375rem] font-semibold mb-6">Type definitions</h2>

        <h3 className="text-lg font-semibold mb-3">BitGraphProof</h3>
        <CodeBlock
          title="TypeScript"
          code={`interface BitGraphProof {
  version: "bitgraph/1";
  artifact: {
    hashAlg: "sha256";
    digestB64: string;
  };
  commit: {
    nonceB64: string;
    counter?: string;          // decimal, monotonic
    slotCounter?: string;      // slot's counter (< commit counter)
    slotHashB64?: string;      // SHA-256 of canonical slot body
    time?: number;             // Unix ms
    prevB64?: string;          // chain link
    epochId?: string;          // hex SHA-256
  };
  signer: {
    publicKeyB64: string;      // Ed25519, 32 bytes
    signatureB64: string;      // Ed25519, 64 bytes
  };
  environment: {
    enforcement: "stub" | "hw-key" | "measured-tee";
    measurement: string;
    attestation?: {
      format: string;          // e.g. "aws-nitro"
      reportB64: string;
    };
  };
  slotAllocation?: {                 // causal slot record
    version: string;                 // "bitgraph/slot/1"
    nonceB64: string;
    counter: string;
    time: number;
    epochId: string;
    publicKeyB64: string;            // same enclave key
    signatureB64: string;            // Ed25519 over canonical slot body
  };
  agency?: unknown;                  // legacy; present on some older proofs
  attribution?: {                    // signed; creator metadata, or the fused marker:
                                     //   name "bitgraph-fuse/1", title placement id, message origin digest
    name?: string;
    title?: string;
    message?: string;
  };
  timestamps?: {
    artifact?: TsaToken;
    proof?: TsaToken;
  };
  metadata?: Record<string, unknown>;
  claims?: Record<string, unknown>;
}`}
        />

        <h3 className="text-lg font-semibold mt-8 mb-3">VerificationPolicy</h3>
        <CodeBlock
          title="TypeScript"
          code={`interface VerificationPolicy {
  requireEnforcement?: "stub" | "hw-key" | "measured-tee";
  allowedMeasurements?: string[];
  allowedPublicKeys?: string[];
  requireAttestation?: boolean;
  requireAttestationFormat?: string[];
  minCounter?: string;
  maxCounter?: string;
  minTime?: number;
  maxTime?: number;
  requireEpochId?: boolean;
  requireActor?: boolean;            // legacy
}`}
        />

        <h3 className="text-lg font-semibold mt-8 mb-3">TsaToken</h3>
        <CodeBlock
          title="TypeScript"
          code={`interface TsaToken {
  authority: string;
  time: string;               // ISO 8601
  digestAlg: string;
  digestB64: string;
  tokenB64: string;           // DER-encoded RFC 3161
}`}
        />
      </div>

      {/* Error codes */}
      <div className="mt-12 border-t border-border-subtle pt-12">
        <h2 className="text-[1.375rem] font-semibold mb-6">Error responses</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle">
                <th className="text-left py-3 pr-4 text-[11px] font-medium uppercase tracking-[0.15em] text-text-tertiary">Status</th>
                <th className="text-left py-3 pr-4 text-[11px] font-medium uppercase tracking-[0.15em] text-text-tertiary">Cause</th>
                <th className="text-left py-3 text-[11px] font-medium uppercase tracking-[0.15em] text-text-tertiary">Body</th>
              </tr>
            </thead>
            <tbody className="text-text-secondary">
              <tr className="border-b border-border-subtle">
                <td className="py-3 pr-4">400</td>
                <td className="py-3 pr-4">Invalid request body</td>
                <td className="py-3"><code className="text-xs font-mono">{`{ "error": "..." }`}</code></td>
              </tr>
              <tr className="border-b border-border-subtle">
                <td className="py-3 pr-4">401</td>
                <td className="py-3 pr-4">Missing or invalid API key</td>
                <td className="py-3"><code className="text-xs font-mono">{`{ "error": "unauthorized" }`}</code></td>
              </tr>
              <tr className="border-b border-border-subtle">
                <td className="py-3 pr-4">413</td>
                <td className="py-3 pr-4">Payload too large</td>
                <td className="py-3"><code className="text-xs font-mono">{`{ "error": "Image too large. Max 2 MB." }`}</code></td>
              </tr>
              <tr className="border-b border-border-subtle">
                <td className="py-3 pr-4">409</td>
                <td className="py-3 pr-4">No anchor precedes the slot in its epoch (fuse commit); allocate again</td>
                <td className="py-3"><code className="text-xs font-mono">{`{ "error": "...", "code": "no-anchor-before-slot" }`}</code></td>
              </tr>
              <tr className="border-b border-border-subtle">
                <td className="py-3 pr-4">502</td>
                <td className="py-3 pr-4">The boundary committed under a different slot (fuse commit)</td>
                <td className="py-3"><code className="text-xs font-mono">{`{ "error": "...", "code": "slot-mismatch" }`}</code></td>
              </tr>
              <tr className="border-b border-border-subtle">
                <td className="py-3 pr-4">503</td>
                <td className="py-3 pr-4">Boundary restarting or not yet anchored, or the ledger could not be read; retry</td>
                <td className="py-3"><code className="text-xs font-mono">{`{ "error": "...", "code": "tee-restarting" }`}</code></td>
              </tr>
              <tr>
                <td className="py-3 pr-4">500</td>
                <td className="py-3 pr-4">Enclave / internal error</td>
                <td className="py-3"><code className="text-xs font-mono">{`{ "error": "internal server error" }`}</code></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
