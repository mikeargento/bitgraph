import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "API Reference",
  description: "BitGraph Protocol API reference: commit, verify, key, and health endpoints.",
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
        <p className="text-sm text-text-secondary mb-4">{description}</p>
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
        <h1 className="text-3xl font-semibold tracking-[-0.03em] mb-4">
          BitGraph Protocol API
        </h1>
        <p className="text-lg leading-relaxed text-text-secondary max-w-xl">
          REST API for committing artifacts and verifying proofs. The commit
          endpoint runs inside an AWS Nitro Enclave.
        </p>
        <div className="mt-6 terminal-glow border border-border-subtle bg-bg-elevated p-4">
          <div className="text-[11px] font-medium uppercase tracking-[0.15em] text-text-tertiary mb-2">
            Base URL
          </div>
          <code className="text-sm font-mono text-text">
            https://nitro.occproof.com
          </code>
        </div>
      </div>

      {/* Authentication */}
      <div className="mb-12">
        <h2 className="text-xl font-semibold mb-4">Authentication</h2>
        <p className="text-sm text-text-secondary mb-4">
          Authentication is optional. If the server is configured with API keys,
          include a Bearer token:
        </p>
        <CodeBlock
          title="Authorization header"
          code={`Authorization: Bearer <your-api-key>`}
        />
        <p className="text-sm text-text-secondary">
          If no API keys are configured on the server, all endpoints are open.
          The public demo endpoint does not require authentication.
        </p>
      </div>

      {/* Endpoints */}
      <div className="space-y-10">
        <h2 className="text-xl font-semibold mb-4">Endpoints</h2>

        {/* POST /commit */}
        <Endpoint
          method="POST"
          path="/commit"
          description="Commit one or more artifact digests. For each digest, the enclave allocates a causal slot (nonce + counter), then commits the artifact against that slot. Returns a complete BitGraph proof for each digest. Requires API key if configured."
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
  "agency": { ... },                 // optional - actor-bound proof (passkey/WebAuthn)
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
          description="Pre-allocate a causal slot before committing an artifact. The slot reserves a nonce and counter position, proving the enclave committed to a sequence position independently of any artifact content. Public endpoint."
        >
          <h4 className="text-[11px] font-medium uppercase tracking-[0.15em] text-text-tertiary mb-2">
            Request body
          </h4>
          <CodeBlock code={`{}`} />

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
    "time": 1741496392800,
    "epochId": "a1b2c3d4e5f6...",
    "publicKeyB64": "...",
    "signatureB64": "..."
  }
}`}
          />
          <p className="text-xs text-text-tertiary mt-3">
            Note: POST /commit handles slot allocation internally. This endpoint is for clients that want direct control over the 2-RTT protocol.
          </p>
        </Endpoint>

        {/* POST /challenge */}
        <Endpoint
          method="POST"
          path="/challenge"
          description="Request a fresh challenge nonce from the enclave for actor-bound proofs (passkey/WebAuthn). The challenge must be signed by the device key and included in the agency envelope of a commit request. Public endpoint."
        >
          <h4 className="text-[11px] font-medium uppercase tracking-[0.15em] text-text-tertiary mb-2">
            Request body
          </h4>
          <CodeBlock code={`{}`} />

          <h4 className="text-[11px] font-medium uppercase tracking-[0.15em] text-text-tertiary mb-2 mt-6">
            Response (200)
          </h4>
          <CodeBlock
            code={`{
  "challenge": "R2FtbWEgUmF5IEJ1cnN0..."   // base64, 60s TTL, single-use
}`}
          />
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
        <h2 className="text-xl font-semibold mb-6">Type definitions</h2>

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
  agency?: {                         // actor-bound proof
    actor: {
      keyId: string;
      publicKeyB64: string;
      algorithm: "ES256";
      provider: string;              // e.g. "passkey"
    };
    authorization: {
      purpose: "bitgraph/commit-authorize/v1";
      actorKeyId: string;
      artifactHash: string;
      challenge: string;
      timestamp: number;
      signatureB64: string;          // P-256 ECDSA
    };
    batchContext?: {                  // present on batch proofs
      batchSize: number;
      batchIndex: number;
      batchDigests: string[];
    };
  };
  attribution?: {                    // signed creator metadata
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

  // Actor-bound proof policy
  requireActor?: boolean;
  allowedActorKeyIds?: string[];
  allowedActorProviders?: string[];
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
        <h2 className="text-xl font-semibold mb-6">Error responses</h2>
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
