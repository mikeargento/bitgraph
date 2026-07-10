# BitGraph Documentation

## What is BitGraph

BitGraph is a protocol that produces portable cryptographic proof when bytes are committed through an authorized execution boundary. The proof attests that a specific digital state was demonstrably possessed and committed in a specific form, by a specific boundary, no later than a specific moment.

### The core idea

Most systems produce artifacts first and try to prove things about them later, attaching signatures, metadata, timestamps, or ledger entries after the fact.

BitGraph inverts this. Valid proof can only exist if the artifact was committed through a protected path. The proof is not added to the artifact. It is caused by the act of committing through the authorized boundary.

> If proof exists, the authorized commit path was traversed.

### How it works

Authorization, cryptographic binding, and commit happen as one indivisible operation:

1. **Allocate** - The enclave pre-allocates a causal slot (nonce + counter) before the artifact hash is known, proving the commitment position was reserved independently.
2. **Bind** - The artifact's SHA-256 digest is bound to the pre-allocated slot, combined with the monotonic counter, and signed with Ed25519 inside the TEE.
3. **Commit** - The artifact and its proof are produced together. Fail-closed: if any step fails, nothing is produced. The proof includes the signed slot record as causal evidence.

### What you get

A BitGraph proof is a JSON object (schema version `bitgraph/1`) containing:

- **artifact** - SHA-256 digest of the committed bytes
- **commit** - fresh nonce, monotonic counter, slot binding (slotCounter, slotHashB64), epoch identity, optional chain link
- **signer** - Ed25519 public key and signature over the canonical signed body
- **environment** - enforcement tier, platform measurement (PCR0), hardware attestation
- **slotAllocation** - the pre-allocated causal slot record, independently signed by the enclave
- **agency** - optional actor-bound proof via device biometrics (passkey/WebAuthn), with batch support
- **attribution** - optional signed creator metadata (name, title, message)
- **timestamps** - optional RFC 3161 TSA timestamps from an independent time authority

### Key properties

- **Portable** -- a self-contained JSON object. Any verifier can check it offline with only the public key and the original bytes.
- **Atomic** -- fail-closed. Either a complete, valid proof is produced, or nothing is.
- **Causal** -- every proof is bound to a pre-allocated slot created before the artifact hash was known.
- **Ordered** -- monotonic counter within its epoch. Counter + epoch + chain link establish sequencing.
- **Measured** -- binds to a specific execution environment via measurement (PCR0 on Nitro, MRENCLAVE on SGX).
- **Verifiable** -- Ed25519 signature, SHA-256 digest, canonical serialization. Standard cryptographic primitives.

### Enforcement tiers

| Tier | Key Location | Boundary | Use Case |
|------|-------------|----------|----------|
| `stub` | Process memory | Software | Development, testing |
| `hw-key` | HSM / Secure Enclave | Software | Key custody |
| `measured-tee` | TEE memory | Hardware enclave | Production, highest assurance |

### Formal properties

The commit path satisfies these structural properties:

(See the Commit Path Diagram on the website for the visual representation.)

---

## What BitGraph is Not

Precise distinctions matter for a protocol that makes specific cryptographic claims. Here is what BitGraph does not claim and does not do.

### BitGraph is not a blockchain

BitGraph does not use distributed consensus, a global ledger, or tokens. It constrains a single execution boundary. There is no mining, no gas, no network of validators. Proof chaining (prevB64) creates a local hash chain within one boundary, not a distributed data structure.

### BitGraph is not a watermark

BitGraph does not embed anything in the artifact bytes. The artifact is hashed, not modified. The proof is a separate JSON object that travels alongside the artifact. Removing the proof does not change the artifact; it only removes the evidence of the commit event.

### BitGraph is not DRM

BitGraph does not prevent copying, sharing, or redistribution of artifact bytes. It prevents the authoritative proof lineage from being duplicated within a policy domain. The artifact itself is freely copyable, but only the original proof will verify against it.

### BitGraph is not proof of truth

BitGraph proves that specific bytes were committed through an authorized boundary. The content of those bytes may be factually wrong, misleading, or fabricated. An LLM committed through BitGraph is still an LLM. It can hallucinate. BitGraph proves the commit event, not the content semantics.

### BitGraph is not proof of authorship

A base proof attests which boundary committed an artifact, not who created the underlying content. Actor-bound proofs can additionally attest that a specific person or device authorized the commitment, but this is actor-binding, not authorship attribution.

### BitGraph is not proof of first creation

BitGraph does not prove that these bytes never existed before this commit. The same content could have been created elsewhere earlier. BitGraph proves that this specific boundary committed these bytes at this point in its counter sequence. Nothing more.

### BitGraph is not attestation

Attestation is evidence that BitGraph carries, not what BitGraph is. A TEE attestation report (e.g., AWS Nitro) proves that specific code is running inside a specific hardware boundary. BitGraph is the proof architecture that attestation fits into, the framework for atomic commit events where attestation provides environmental evidence.

### BitGraph is not notarization

Traditional notarization involves a trusted third party witnessing a signing event. BitGraph is a self-contained proof system. The proof is verifiable offline using only the public key and the original bytes. No trusted third party is required for core verification. TSA timestamps are optional, advisory evidence.

---

## Proof Format: bitgraph/1

Normative specification for the `bitgraph/1` proof format. Derived from the reference implementation.

### Proof JSON schema

```json
// proof.json
{
  "version": "bitgraph/1",                // REQUIRED - exact value
  "artifact": {
    "hashAlg": "sha256",             // REQUIRED - "sha256" only in v1
    "digestB64": "<base64>"          // REQUIRED - SHA-256, 32 decoded bytes
  },
  "commit": {
    "nonceB64": "<base64>",          // REQUIRED - >=16 decoded bytes
    "counter":  "42",                // OPTIONAL - decimal string, monotonic
    "slotCounter": "41",             // OPTIONAL - slot's counter (< commit counter)
    "slotHashB64": "<base64>",       // OPTIONAL - SHA-256 of canonical slot body
    "time":     1700000000000,       // OPTIONAL - Unix ms
    "prevB64":  "<base64>",          // OPTIONAL - chain link, 32 bytes
    "epochId":  "<hex>"              // OPTIONAL - SHA-256 hex
  },
  "signer": {
    "publicKeyB64":  "<base64>",     // REQUIRED - Ed25519, 32 bytes
    "signatureB64":  "<base64>"      // REQUIRED - Ed25519, 64 bytes
  },
  "environment": {
    "enforcement": "measured-tee",   // REQUIRED - "stub"|"hw-key"|"measured-tee"
    "measurement": "<opaque>",       // REQUIRED - non-empty string
    "attestation": {                 // OPTIONAL
      "format":    "aws-nitro",      // REQUIRED when parent present
      "reportB64": "<base64>"        // REQUIRED when parent present
    }
  },
  "slotAllocation": {                // OPTIONAL - causal slot record
    "version":      "bitgraph/slot/1",
    "nonceB64":     "<base64>",      // same as commit.nonceB64
    "counter":      "41",            // same as commit.slotCounter
    "time":         1700000000000,
    "epochId":      "<hex>",
    "publicKeyB64": "<base64>",      // enclave Ed25519 key
    "signatureB64": "<base64>"       // Ed25519 over canonical slot body
  },
  "agency": {                         // OPTIONAL - actor-bound proof
    "actor": { keyId, publicKeyB64, algorithm, provider },
    "authorization": { purpose, actorKeyId, artifactHash, challenge, timestamp, signatureB64 },
    "batchContext": {                 // OPTIONAL - present on batch proofs
      "batchSize": 8,
      "batchIndex": 0,
      "batchDigests": ["<base64>", ...]
    }
  },
  "attribution": {                   // OPTIONAL - signed creator metadata
    "name":    "string",
    "title":   "string",
    "message": "string"
  },
  "timestamps": {                    // OPTIONAL - external timestamps
    "artifact": { TsaToken },
    "proof":    { TsaToken }
  },
  "metadata": { },                   // OPTIONAL - NOT signed, advisory
  "claims": { }                      // OPTIONAL - NOT signed, advisory
}
```

### Signed body

The Ed25519 signature covers the canonical serialization of a `SignedBody` object:

```json
// SignedBody
{
  version:           proof.version,
  artifact:          proof.artifact,
  actor:             proof.agency?.actor,        // when present
  attribution:       proof.attribution,          // when present
  commit:            proof.commit,               // ALL fields verbatim
  publicKeyB64:      proof.signer.publicKeyB64,
  enforcement:       proof.environment.enforcement,
  measurement:       proof.environment.measurement,
  attestationFormat: proof.environment.attestation?.format  // when present
}
```

#### What is NOT signed

| Field | Reason |
|-------|--------|
| `signatureB64` | The seal -- cannot sign itself |
| `attestation.reportB64` | Vendor-signed, self-authenticating separately |
| `slotAllocation` | Self-authenticating (own Ed25519 signature); bound via commit.slotHashB64 |
| `agency` | P-256 signature independently verifiable; actor identity IS in signed body |
| `timestamps` | Added post-signature by external TSA |
| `metadata` | Advisory, not trusted |
| `claims` | Advisory, not trusted |

### Causal slot allocation

Every proof is causally bound to a pre-allocated slot. The slot is created *before* the artifact hash is known, proving the enclave committed to a nonce and counter independently of the artifact content.

| Binding | How |
|---------|-----|
| Nonce binding | `commit.nonceB64 === slotAllocation.nonceB64` |
| Counter ordering | `commit.slotCounter < commit.counter` |
| Hash binding | `commit.slotHashB64 === SHA-256(canonicalize(slotBody))` |
| Same enclave | `slotAllocation.publicKeyB64 === signer.publicKeyB64` |

The slot has its own Ed25519 signature proving the enclave created it. The commit signature includes `slotHashB64`, cryptographically binding the proof to that exact slot.

### Canonical serialization

The signed body is serialized to bytes using a deterministic algorithm:

1. Recursively sort all object keys in Unicode code-point order
2. Serialize with `JSON.stringify()` -- no whitespace
3. Encode the resulting string as UTF-8 (no BOM)

Top-level key order after sort:

```
actor? -> artifact -> attestationFormat? -> attribution? -> commit -> enforcement -> measurement -> publicKeyB64 -> version
```

### Field classification

#### Signed (security-critical)

These fields are in the SignedBody. Tampering invalidates the signature:

`version`, `artifact.*`, `agency.actor` (when present), `attribution.*` (when present), `commit.*`, `signer.publicKeyB64`, `environment.enforcement`, `environment.measurement`, `attestation.format`

#### Self-authenticating

Not in the signed body, but independently verifiable:

`signatureB64` (Ed25519), `attestation.reportB64` (vendor-signed), `slotAllocation` (own Ed25519 signature), `agency.authorization` (P-256)

#### Advisory (unsigned)

Not signed. Must not be used for security decisions: `timestamps`, `metadata`, `claims`.

### Algorithms

| Purpose | Algorithm | Details |
|---------|-----------|---------|
| Proof signature | Ed25519 (RFC 8032) | 32-byte key, 64-byte signature |
| Agency signature | ECDSA P-256 / ES256 | WebAuthn or direct; device-bound key |
| Hash | SHA-256 (FIPS 180-4) | 32 bytes, Base64 encoded |
| Encoding | Base64 (RFC 4648 S4) | Standard, with = padding |
| Counter | Decimal string | BigInt-safe, no leading zeros |

---

## Verification

BitGraph verification is deterministic and runs offline. No network calls, no API keys, no accounts.

### Five-step algorithm

Input: a proof (`BitGraphProof`), the original bytes (`Uint8Array`), and an optional verification policy.

**1. Structural validation**

Check that all required fields are present with correct types. version must be "bitgraph/1", hashAlg must be "sha256", enforcement must be one of the valid tiers, all base64 fields must decode correctly.

**2. Artifact digest verification**

Compute SHA-256 of the provided bytes. Compare against proof.artifact.digestB64 using constant-time comparison. If they don't match, the proof does not apply to these bytes.

**3. Signed body reconstruction**

Build the SignedBody object from the proof fields (including actor identity from agency, attribution, and attestation format when present). Canonicalize to sorted-key JSON, encode as UTF-8 bytes. This is what the Ed25519 signature covers.

**4. Ed25519 signature verification**

Decode publicKeyB64 (must be 32 bytes) and signatureB64 (must be 64 bytes). Verify the Ed25519 signature against the canonical bytes. If invalid, the proof has been tampered with.

**5. Policy checks**

If a VerificationPolicy is provided, enforce its constraints: enforcement tier, allowed measurements, allowed public keys, attestation requirements, counter range, time range, epoch requirements.

### Verification policy

```typescript
interface VerificationPolicy {
  requireEnforcement?: "stub" | "hw-key" | "measured-tee";
  allowedMeasurements?: string[];     // exact match
  allowedPublicKeys?: string[];       // exact match
  requireAttestation?: boolean;
  requireAttestationFormat?: string[];
  minCounter?: string;                // BigInt-safe
  maxCounter?: string;
  minTime?: number;                   // Unix ms
  maxTime?: number;
  requireEpochId?: boolean;

  // Actor-bound proof policy
  requireActor?: boolean;             // reject proofs without agency
  allowedActorKeyIds?: string[];      // exact match
  allowedActorProviders?: string[];   // e.g. ["apple-secure-enclave"]
}
```

#### Trust anchor hierarchy

- `requireEnforcement` alone - prevents in-transit downgrade only
- `requireEnforcement + allowedMeasurements` - pins to specific enclave image
- `+ requireAttestation` - full trust (vendor-attested hardware boundary)

### What the verifier does NOT check

| Item | Why |
|------|-----|
| Attestation report content | Vendor-signed; platform-specific verification is caller responsibility |
| prevB64 chain integrity | Chain traversal is application-layer logic |
| Counter continuity | Gap detection is application-layer logic |
| Slot allocation validity | Slot signature and hash binding are structural checks; application can verify slotHashB64 matches canonicalized slot body |
| Key provenance | Requires attestation verification |
| Batch context completeness | Verifying all proofs in a batch is application-layer logic |
| Timestamp validity | TSA token parsing is out of scope |

---

## Trust Model

> BitGraph guarantees single-successor semantics within the verifier-accepted measurement and monotonicity domain of the enforcing boundary.

### Assumptions

| Assumption | If it fails |
|-----------|-------------|
| Boundary isolation - TEE prevents external key access | All guarantees collapse |
| Key secrecy - Ed25519 private key never leaves boundary | Proof forgery becomes possible |
| Nonce freshness - >=128 bits, never reused | Replay within a session |
| Honest measurement - hardware correctly measures enclave | Delegated to TEE vendor |
| Monotonic counter durability - survives restarts | Anti-rollback degrades to single session |
| Causal slot integrity - slot allocated before artifact hash known | Without pre-allocation, commit order could be forged |
| Strict verifier policy - caller pins measurements + counters | Weak policy accepts more than intended |

### Threat model

#### In-scope threats

- **Proof replay** - minCounter in policy rejects old proofs
- **Measurement substitution** - allowedMeasurements pins exact values
- **Signature forgery** - Ed25519 unforgeability
- **Downgrade attack** - Enforcement tier is signed; requireEnforcement rejects weaker tiers
- **Chain gap insertion** - prevB64 chaining: any removed link breaks hash continuity
- **Counter position forgery** - Causal slot pre-allocation: slotHashB64 binding + slotCounter < counter ordering proves pre-allocation
- **Agency replay across batches** - Single-use challenge consumed on first validation; batch context scoped to declared digests

#### Out-of-scope threats

- Signing key exfiltration - assumes boundary is secure
- TEE firmware vulnerability - delegated to hardware vendor
- Weak verifier policy - caller responsibility
- Physical access to enclave host - outside threat model

### Non-goals

- **Global ordering** - no total ordering across independent boundaries
- **Cross-boundary double-spend** - same artifact can be submitted to separate boundaries
- **Copy prevention** - BitGraph does not prevent raw byte copying
- **Consensus replacement** - BitGraph constrains a single boundary, not distributed parties
- **Metadata integrity** - the metadata field is advisory and unsigned

---

## Integration Guide

How to commit artifacts, verify proofs, and integrate BitGraph into your application.

### Quick start: commit via API

Hash your artifact locally, then send only the digest to the BitGraph endpoint:

```bash
# 1. Hash your file
DIGEST=$(openssl dgst -sha256 -binary myfile.pdf | base64)

# 2. Send to BitGraph endpoint
curl -X POST https://nitro.occproof.com/commit \
  -H "Content-Type: application/json" \
  -d '{
    "digests": [{
      "digestB64": "'$DIGEST'",
      "hashAlg": "sha256"
    }],
    "metadata": {
      "source": "my-app"
    }
  }'
```

### TypeScript / JavaScript

```typescript
// Hash locally
const bytes = new Uint8Array(await file.arrayBuffer());
const hashBuf = await crypto.subtle.digest("SHA-256", bytes);
const digestB64 = btoa(String.fromCharCode(...new Uint8Array(hashBuf)));

// Commit to enclave (with optional attribution)
const resp = await fetch("https://nitro.occproof.com/commit", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    digests: [{ digestB64, hashAlg: "sha256" }],
    attribution: { name: "Jane Doe", title: "Project Photo" },
    metadata: { source: "my-app", fileName: file.name },
  }),
});

const [proof] = await resp.json();
// proof is a complete BitGraphProof JSON object
console.log(proof.commit.counter);
console.log(proof.slotAllocation);   // causal slot record
console.log(proof.attribution);      // signed creator metadata
```

### Batch commit

Send multiple digests in one request. The enclave allocates a slot and commits each digest sequentially. If using actor-bound proofs (passkey), all proofs in the batch receive actor identity.

```typescript
const resp = await fetch("https://nitro.occproof.com/commit", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    digests: [
      { digestB64: digest1, hashAlg: "sha256" },
      { digestB64: digest2, hashAlg: "sha256" },
      { digestB64: digest3, hashAlg: "sha256" },
    ],
    attribution: { name: "Jane Doe" },
    metadata: { source: "my-app", batchId: "abc123" },
  }),
});

const proofs = await resp.json();
// proofs[0], proofs[1], proofs[2] - one per digest
```

### Verify a proof

```typescript
import { verify } from "bitgraph";

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
}
```

### Enclave info

```bash
# Get enclave public key and measurement
curl https://nitro.occproof.com/key

# Response:
# {
#   "publicKeyB64": "...",
#   "measurement": "ac813febd1ac4261...",
#   "enforcement": "measured-tee"
# }
```

### Important notes

- **Files are never uploaded.** Only the SHA-256 digest crosses the network.
- **The proof is portable.** Store it alongside the artifact or in a separate system.
- **Verification is offline.** No API calls needed to verify. Just the public key and original bytes.
- **Pin measurements.** For production, always pin allowedMeasurements and require attestation.
- **Track counters.** Store the last accepted counter value to prevent replay.
- **Causal slots.** Every proof includes a pre-allocated slot that proves the enclave committed to a counter position before seeing the artifact hash.
- **Attribution is signed.** Name, title, and message in the attribution field are covered by the Ed25519 signature and cannot be tampered with.

---

## Agent SDK

Wrap any tool call with a portable, cryptographic execution receipt. The SDK normalizes inputs and outputs, hashes them into a canonical envelope, and commits the digest through BitGraph. Raw data never leaves your runtime.

### Install

```bash
npm install bitgraph-agent
```

### Quick start

The built-in `fetch_url` tool is ready to use. Wrap it, call it, and get back your output with a BitGraph proof attached.

```typescript
import { wrapTool, fetchUrlTool } from "bitgraph-agent";

const verifiedFetch = wrapTool(fetchUrlTool, {
  apiUrl: "https://nitro.occproof.com",
});

const result = await verifiedFetch({ url: "https://api.example.com/data" });

result.output;            // normal fetch response
result.executionEnvelope; // canonical execution record
result.bitgraphProof;          // portable BitGraph proof
```

### How it works

Every call follows the same six-step pipeline:

1. **Normalize input** - deterministic JSON representation of the tool input
2. **Hash input** - SHA-256 of the canonical input bytes
3. **Execute** - run the tool function
4. **Normalize and hash output** - same process for the response
5. **Build envelope** - canonical JSON with tool name, version, both hashes, timestamp
6. **Commit** - SHA-256 of the envelope is sent to BitGraph. The enclave signs it and returns a proof.

> Only the 32-byte envelope digest crosses the network. The enclave never sees your input, output, or tool logic.

### Define a custom tool

Any async function can become a verified tool. Define the execution logic and normalization functions. The SDK handles the rest.

```typescript
import { wrapTool } from "bitgraph-agent";
import type { ToolDefinition } from "bitgraph-agent";

const summarizeTool: ToolDefinition<
  { text: string },
  { summary: string }
> = {
  name: "summarize",
  version: "1.0.0",
  execute: async (input) => {
    const response = await callLLM(input.text);
    return { summary: response };
  },
  normalizeInput: (input) => ({ text: input.text }),
  normalizeOutput: (output) => ({ summary: output.summary }),
};

const verifiedSummarize = wrapTool(summarizeTool, {
  apiUrl: "https://nitro.occproof.com",
});

const result = await verifiedSummarize({ text: "..." });
// result.output.summary - the LLM response
// result.bitgraphProof - cryptographic proof of execution
```

### One-shot execution

For single calls without creating a reusable wrapper:

```typescript
import { runVerifiedTool, fetchUrlTool } from "bitgraph-agent";

const result = await runVerifiedTool(
  fetchUrlTool,
  { url: "https://httpbin.org/json" },
  { apiUrl: "https://nitro.occproof.com" },
);
```

### Export a receipt

Save the execution envelope and BitGraph proof as a portable JSON document. Raw tool output is intentionally excluded. It stays in your runtime.

```typescript
import { exportReceipt, loadReceipt } from "bitgraph-agent";

// Export to JSON string
const json = exportReceipt(result);
await fs.writeFile("receipt.json", json);

// Load it back
const receipt = loadReceipt(await fs.readFile("receipt.json", "utf8"));
// receipt.envelope - the execution envelope
// receipt.proof    - the BitGraph proof
```

> The receipt format is `bitgraph-agent/receipt/1`. It contains everything needed for offline verification. Hand it to anyone and they can verify without contacting BitGraph.

### Verify a receipt

Verification is offline. Given an envelope and proof, anyone can check that the execution was committed through BitGraph. Works with a `VerifiedToolResult` or a loaded receipt.

```typescript
import { verifyExecutionReceipt, loadReceipt } from "bitgraph-agent";

// From a VerifiedToolResult
const verification = await verifyExecutionReceipt(
  result.executionEnvelope,
  result.bitgraphProof,
);

// Or from an exported receipt
const receipt = loadReceipt(json);
const v = await verifyExecutionReceipt(receipt.envelope, receipt.proof);

v.valid;                    // true/false
v.checks.envelopeHashMatch; // digest matches artifact
v.checks.signatureValid;    // Ed25519 signature valid
```

### Execution envelope

The canonical execution record committed to BitGraph:

```json
{
  "type": "tool-execution",
  "tool": "fetch_url",
  "toolVersion": "1.0.0",
  "runtime": "agent-skills",
  "adapter": "bitgraph-agent",
  "inputHashB64": "65ZIM1fa4oixyj6qdsQe...",
  "outputHashB64": "Y+aesdCj8/940fyda2T0...",
  "timestamp": 1773464119585
}
```

Fields are sorted alphabetically and serialized without whitespace before hashing. This ensures any implementation produces the same digest for the same execution.

### API reference

#### wrapTool(tool, config)

Returns an async function that executes the tool and returns a `VerifiedToolResult`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `tool` | `ToolDefinition` | Tool with name, version, execute, normalize functions |
| `config.apiUrl` | `string` | BitGraph commit service URL |
| `config.apiKey` | `string?` | Optional Bearer token for authenticated endpoints |
| `config.runtime` | `string?` | Runtime identifier (default: "agent-skills") |

#### ToolDefinition

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Tool identifier (e.g. "fetch_url") |
| `version` | `string` | Semver version string |
| `execute` | `(input) => Promise` | The actual tool logic |
| `normalizeInput` | `(input) => unknown` | Deterministic input representation for hashing |
| `normalizeOutput` | `(output) => unknown` | Deterministic output representation for hashing |

### Privacy model

- **Hashes only.** Only SHA-256 digests are sent to BitGraph. Raw input and output stay in your runtime.
- **No reverse engineering.** SHA-256 is preimage-resistant. The digest reveals nothing about the original data.
- **Metadata is optional.** Tool name and runtime are included in the commit metadata, but this is configurable.
- **Verification is offline.** Anyone with the envelope and proof can verify without contacting BitGraph.

### Source

[github.com/mikeargento/bitgraph/packages/bitgraph-agent](https://github.com/mikeargento/bitgraph/tree/main/packages/bitgraph-agent) | [npm](https://www.npmjs.com/package/bitgraph-agent)

---

## Self-Host TEE

Deploy your own BitGraph Trusted Execution Environment using AWS Nitro Enclaves. This guide assumes no prior TEE experience.

### Architecture

The BitGraph TEE consists of three components running on a single EC2 instance:

- **Enclave** -- isolated TEE that holds the Ed25519 signing key and produces cryptographically signed proofs. The key is generated inside the enclave and never leaves.
- **Parent server** -- HTTP server running on the EC2 host. Receives proof requests, forwards them to the enclave via vsock, returns signed proofs.
- **Vsock bridge** -- socat process that bridges TCP (parent) to vsock (enclave). Required because Node.js doesn't support AF_VSOCK natively.

Communication flow:

```
Client (HTTPS) -> Parent Server (port 8080) -> Socat (TCP:9000 <-> Vsock:5000) -> Enclave App
```

### Prerequisites

- AWS account with EC2 access
- A Nitro-capable EC2 instance (c5, c6, m5, m6, r5, r6 families -- **not** t2/t3)
- At least 2 vCPUs and 4 GB RAM (the enclave needs dedicated CPU/memory)
- Docker installed on the instance
- Node.js 20+ installed on the instance

### Step 1: Launch EC2 Instance

Launch a Nitro-capable instance with enclave support enabled:

```bash
# Example: c6a.xlarge (4 vCPU, 8 GB RAM)
# AMI: Amazon Linux 2023

# IMPORTANT: Enable "Nitro Enclave" in Advanced Details when launching
# Or via CLI:
aws ec2 run-instances \
  --instance-type c6a.xlarge \
  --image-id ami-0abcdef1234567890 \
  --enclave-options Enabled=true \
  --key-name your-key-pair
```

Security group -- allow inbound:

| Port | Protocol | Source | Purpose |
|------|----------|--------|---------|
| 22 | TCP | Your IP | SSH |
| 8080 | TCP | Your app server | Parent HTTP API |

### Step 2: Install Dependencies

SSH into the instance and install everything:

```bash
# Install Nitro CLI
sudo amazon-linux-extras install aws-nitro-enclaves-cli -y
sudo yum install aws-nitro-enclaves-cli-devel -y

# Install Docker
sudo yum install docker -y
sudo systemctl start docker
sudo systemctl enable docker
sudo usermod -aG docker $USER

# Install Node.js 20
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo yum install nodejs -y

# Install socat
sudo yum install socat -y

# Install build tools (for NSM helper)
sudo yum install gcc musl-devel -y

# Start the Nitro enclave allocator
sudo systemctl start nitro-enclaves-allocator
sudo systemctl enable nitro-enclaves-allocator

# Add yourself to the enclave group
sudo usermod -aG ne $USER

# IMPORTANT: Log out and back in for group changes
exit
```

### Step 3: Configure Enclave Resources

The enclave needs dedicated CPU and memory allocated from the host. Edit the allocator config:

```yaml
# /etc/nitro_enclaves/allocator.yaml
# Allocate 2 CPUs and 1024 MB to the enclave
memory_mib: 1024
cpu_count: 2
```

```bash
# Restart allocator after changes
sudo systemctl restart nitro-enclaves-allocator
```

### Step 4: Clone and Build

```bash
# Clone the repo
git clone https://github.com/mikeargento/bitgraph.git
cd bitgraph

# Install dependencies
npm ci

# Build the Docker image for the enclave
# Context must be the repo root (monorepo build)
cd server/commit-service
docker build -f Dockerfile.enclave -t bitgraph-enclave ../../
```

### Step 5: Build the Enclave Image (EIF)

The EIF (Enclave Image Format) is a sealed binary that runs inside the Nitro Enclave. The build process measures the image and produces a PCR0 hash -- this is the enclave's identity.

```bash
# Build the EIF from the Docker image
nitro-cli build-enclave \
  --docker-uri bitgraph-enclave \
  --output-file enclave.eif

# Output will show:
# Enclave Image successfully created.
# {
#   "Measurements": {
#     "HashAlgorithm": "Sha384 { ... }",
#     "PCR0": "abc123def456...",   <- SAVE THIS
#     "PCR1": "...",
#     "PCR2": "..."
#   }
# }

# IMPORTANT: Save the PCR0 value.
# This is the measurement that proves which code is running.
# Verifiers use this to confirm proofs came from YOUR enclave.
```

### Step 6: Launch the Enclave

```bash
# Terminate any existing enclave
nitro-cli terminate-enclave --all 2>/dev/null

# Launch the enclave
nitro-cli run-enclave \
  --eif-path enclave.eif \
  --cpu-count 2 \
  --memory 1024

# Verify it's running
nitro-cli describe-enclaves
# Should show: State: "RUNNING", EnclaveCID: <number>

# Save the CID -- you need it for the vsock bridge
ENCLAVE_CID=$(nitro-cli describe-enclaves | jq -r '.[0].EnclaveCID')
```

### Step 7: Start the Vsock Bridge

The bridge connects the parent server (TCP) to the enclave (vsock):

```bash
# Start socat bridge in background
nohup socat TCP-LISTEN:9000,fork,reuseaddr \
  VSOCK-CONNECT:$ENCLAVE_CID:5000 \
  > /tmp/socat-bridge.log 2>&1 &

# Verify it's listening
ss -tlnp | grep 9000
# Should show: LISTEN 0 5 0.0.0.0:9000
```

### Step 8: Build and Start the Parent Server

```bash
# Build the parent server (TypeScript -> JavaScript)
cd /path/to/bitgraph/server/commit-service
npx tsc -p tsconfig.parent.json

# Set environment variables
export PORT=8080
export VSOCK_BRIDGE_PORT=9000
export API_KEYS="your-secret-api-key-here"

# Start the parent server
nohup node dist/parent/server.js > /tmp/parent.log 2>&1 &
```

### Step 9: Verify

```bash
# Health check
curl http://localhost:8080/health
# { "ok": true }

# Get the enclave's public key and measurement
curl http://localhost:8080/key
# {
#   "publicKeyB64": "...",
#   "measurement": "abc123...",
#   "enforcement": "measured-tee"
# }

# Test a commit
DIGEST=$(echo -n "hello world" | openssl dgst -sha256 -binary | base64)
curl -X POST http://localhost:8080/commit \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-secret-api-key-here" \
  -d "{
    \"digests\": [{\"digestB64\": \"$DIGEST\", \"hashAlg\": \"sha256\"}]
  }"
# Returns: signed BitGraph proof with TEE attestation
```

### Step 10: Point BitGraph Dashboard at Your TEE

By default, the hosted dashboard at occ.bitgraph.ing points to `nitro.occproof.com`. To use your own TEE, set the `TEE_URL` environment variable on your hosted server:

```bash
# In your hosted server environment (Railway, etc.)
TEE_URL=https://your-tee-domain.com
```

The hosted server at `packages/hosted/src/authorization.ts` reads this variable:

```javascript
const TEE_URL = process.env.TEE_URL || "https://nitro.occproof.com";
```

### Production Checklist

- Put an ALB or CloudFront in front of port 8080 with TLS termination
- Restrict security group to only allow your app server's IP
- Set strong API keys via the `API_KEYS` environment variable
- Save the PCR0 measurement -- this is your enclave's identity for verification
- Set up monitoring on `/health` endpoint
- Configure log rotation for parent server and socat logs
- The enclave generates a new keypair on each restart -- a new epochId begins, the counter resets, and the first proof of the new epoch has no prevB64. Cross-epoch ordering comes from the Ethereum anchors

### Using the Deploy Script

For automated deployment, use the included script:

```bash
cd bitgraph/server/commit-service
./deploy.sh

# This runs all steps automatically:
# 1. Builds Docker image
# 2. Builds EIF
# 3. Terminates existing enclave
# 4. Launches new enclave
# 5. Starts vsock bridge
# 6. Builds and starts parent server
```

### Key Files

| File | Purpose |
|------|---------|
| `server/commit-service/Dockerfile.enclave` | Builds the enclave Docker image |
| `server/commit-service/src/enclave/app.ts` | Enclave application -- proof signing, slot management |
| `server/commit-service/src/parent/server.ts` | Parent HTTP API -- commit, key, health endpoints |
| `server/commit-service/src/parent/vsock-client.ts` | TCP bridge client to enclave |
| `server/commit-service/deploy.sh` | Automated deployment script |
| `packages/adapter-nitro/src/nitro-host.ts` | NSM device interface -- attestation, measurement |
| `packages/hosted/src/authorization.ts` | Dashboard integration -- calls TEE_URL |

### How the Enclave Works Internally

On startup, the enclave:

1. Generates a fresh Ed25519 keypair in memory (never exported)
2. Fetches the PCR0 measurement from the NSM device (`/dev/nsm`)
3. Generates a boot nonce from the NSM hardware RNG
4. Computes `epochId = SHA-256(publicKeyB64 + ":" + bootNonceB64)`
5. Listens on a Unix socket for proof requests

For each proof request:

1. Validates the slot exists (BitGraph causal gate -- no slot, no proof)
2. Increments the chain counter
3. Builds the signed body: artifact, commit, policy, principal
4. Signs with Ed25519
5. Gets a Nitro attestation report from the NSM device
6. Returns the complete BitGraph proof with attestation embedded

### Epoch Transitions

When the enclave restarts (deploy, crash, reboot):

- A new keypair is generated -> new `epochId`
- The counter resets: the first slot of the new epoch takes counter 1, and the first commit takes counter 2
- The first proof of the new epoch has no `prevB64`. Each epoch is an independent hash chain; `prevB64` never bridges epochs
- Cross-epoch lineage can ride in the optional `commit.epochLink` field, which binds the new epoch's first proof to the previous epoch's terminal proof. The verifier checks `epochLink` when present; the deployed parent does not currently exercise it
- Cross-epoch ordering comes from the Ethereum anchors woven into each epoch's chain: they tie each epoch to the public Ethereum timeline, which is how epochs are ordered against each other
- During restart, all actions are denied (fail closed)

---

## FAQ

Common questions about the BitGraph Protocol.

### Does BitGraph upload my file?

No. Your file is hashed locally in your browser or application. Only the SHA-256 digest (32 bytes) is sent to the enclave. The actual file bytes never leave your machine.

### Can I verify a proof without an internet connection?

Yes. Core verification (digest match + Ed25519 signature) is fully offline. You need the original bytes, the proof JSON, and a verifier implementation. No API calls required.

### What happens if the enclave restarts?

A new epoch begins: new Ed25519 keypair, new epochId, and the counter resets (the first slot of the new epoch takes counter 1, the first commit takes counter 2). The first proof of the new epoch has no prevB64 (chain link). Cross-epoch lineage can ride in the optional commit.epochLink field, and cross-epoch ordering comes from the Ethereum anchors.

### Is this a blockchain?

No. BitGraph has no distributed consensus, no global ledger, no tokens. It constrains a single execution boundary. Proof chaining (prevB64) is a local hash chain, not a distributed data structure.

### Does BitGraph prove who created the content?

A base proof attests which execution boundary committed specific bytes, not who created them. Actor-bound proofs (using device-bound biometric keys) can additionally attest that a specific person or device authorized the commitment.

### What if someone modifies the proof JSON?

The Ed25519 signature covers the canonical signed body. Any modification to signed fields (artifact, commit, signer identity, environment) invalidates the signature. Unsigned fields (timestamps, metadata) are advisory and should not be trusted for security decisions.

### What is the measurement field?

For AWS Nitro Enclaves, it is the PCR0 value, a SHA-384 hash of the enclave image. It uniquely identifies the exact code running inside the boundary. Verifiers should pin allowedMeasurements to known-good values.

### Are timestamps signed?

No. RFC 3161 timestamps are added post-signature by the parent server via an external Time Stamping Authority. They are independently verifiable (via the TSA certificate) but are not covered by the Ed25519 signature. Use them as advisory evidence, not as primary trust.

### Can the same file produce different proofs?

Yes. Each commit generates a fresh nonce, increments the counter, and produces a new signature. The artifact digest will be the same (same file = same SHA-256), but the commit context differs. This is correct behavior. Each is a distinct commit event.

### What is prevB64?

The SHA-256 hash of the previous complete proof in the chain. It creates a linked sequence within an epoch. If any proof in the chain is modified, deleted, or reordered, the hash chain breaks. The first proof of an epoch has no prevB64.

### How is this different from just signing a file?

A standard digital signature proves someone with the private key signed the bytes. BitGraph additionally provides: a measured execution boundary (PCR0), a monotonic counter (ordering), causal slot pre-allocation (proves commitment position was reserved before content was known), proof chaining (sequence integrity), hardware attestation (boundary evidence), actor-bound proofs (device biometric authorization), and signed attribution (creator metadata). The key never leaves the enclave.

### What is a causal slot?

A slot is a pre-allocated nonce and counter pair created inside the enclave before any artifact hash is known. This proves the enclave committed to a specific position in its sequence independently of the artifact content. The slot has its own Ed25519 signature and is cryptographically bound to the final proof via slotHashB64. Every proof includes its slot allocation record.

### What is attribution?

Attribution is optional creator metadata (name, title, message) that is included in the Ed25519-signed body. Unlike metadata (which is unsigned and advisory), attribution is cryptographically sealed. Tampering with any attribution field invalidates the proof signature.

### Can I batch multiple artifacts?

Yes. Send multiple digests in a single POST /commit request. The enclave allocates a slot and commits each digest sequentially. If using actor-bound proofs (passkey), all proofs in the batch receive actor identity via batchContext. Each proof is independently verifiable.

### What libraries does BitGraph use?

The core library uses @noble/ed25519 for signatures and @noble/hashes for SHA-256. Both are audited, pure TypeScript, zero-dependency libraries. No Node.js native bindings.

---

## Whitepaper: BitGraph

Proof as a Reachability Property

Michael James Argento -- Patent Pending

### Abstract

Modern computing systems permit durable digital state to be created freely and attempt to establish trust only after that state already exists. This architecture introduces fundamental weaknesses in provenance, AI outputs, sensor data, logs, and media, because authenticity is optional and structurally bypassable. All existing approaches -- signatures, metadata, watermarking, registries, and provenance standards -- operate after content has been instantiated and therefore cannot constrain the creation path itself.

This paper introduces a different enforcement model. **BitGraph** relocates trust to the commit path. Authenticated durable state is reachable only through enforced finalization via a protected commit interface. An artifact is authenticated if and only if cryptographic binding and authorization occur inside an atomic execution boundary at the moment durable state is created.

We first present the **Trusted Origin Token Architecture**, in which authenticated creation requires consumption of a pre-existing single-use authorization unit at finalization. We then generalize this into BitGraph, in which equivalent origin control is achieved without pre-existing tokens by generating boundary-fresh cryptographic output inside the atomic execution boundary. The enforcement principle that links authorization, binding, and durable commit into a single indivisible event is called **Atomic Causality**.

We provide a formal model based on labeled transition systems and closure algebras, define a security game capturing the adversarial model, and systematically distinguish this architecture from existing approaches including attested execution, post-hoc provenance, and content credential systems. We show that BitGraph defines a new enforcement primitive: authentication as a *reachability property* of system structure, not a property attached to artifacts after creation.

### 1 Introduction

Digital systems increasingly mediate information relied upon for scientific, legal, medical, financial, and political decisions. At the same time, synthetic generation, automated manipulation, and adversarial pipelines have become routine. Despite this shift, most computing systems retain an architectural model in which creation is unrestricted and trust is applied only after the fact.

Files are written, messages are emitted, and model outputs are exported without intrinsic authentication. Trust is later inferred through signatures, metadata, watermarking, or registry lookups. These mechanisms can indicate that an artifact has not been modified since some point in time, but they cannot prove that the artifact originated from an enforced creation process. Post-hoc trust systems permit syntactically indistinguishable artifacts to exist both with and without provenance guarantees. Downstream systems must therefore rely on voluntary compliance with provenance mechanisms.

Several concurrent developments have made this structural gap acutely consequential. Generative AI systems now produce synthetic artifacts at scale that are indistinguishable from human-authored or sensor-captured content. Regulatory frameworks -- including the EU AI Act and evolving compliance mandates -- increasingly require that AI-generated and machine-mediated outputs be structurally identifiable, not merely voluntarily labeled. Automated decision pipelines in finance, healthcare, and public administration increasingly consume digital artifacts without human intermediation, removing the informal gatekeeping that previously compensated for weak provenance. These pressures converge on a single architectural deficiency: the absence of structural enforcement at the point where digital state is created.

This paper proposes that the architectural response to this problem is not better verification of existing artifacts, but *structural enforcement at the point where digital state becomes durable or externally visible*. Trust must be enforced at creation, not inferred afterward.

A corollary of this principle is that enforcement and verification are architecturally distinct: enforcement determines whether authenticated state exists; verification determines whether that status can be demonstrated to a third party. This separation is developed formally in Section 9.4.

BitGraph is not a replacement for attestation, provenance, or access control. It is a *lower-layer enforcement primitive* that existing systems can adopt to close the structural gap between trusted code execution and controlled state creation. Systems that already implement TEEs, content credentials, or hardware roots of trust can implement BitGraph to strengthen the enforcement guarantees those mechanisms provide.

> **Non-Goal.** This architecture does not attempt to establish the semantic truth, correctness, or factual validity of content. It enforces only whether content has been admitted into authenticated durable state through protected finalization semantics.

### 2 The Problem: Uncontrolled Digital State Creation

In contemporary computing systems, any process capable of reaching commit paths -- writes to persistent storage, publications to output channels, exports of artifacts -- can create durable digital state. Authentication mechanisms are typically external to these creation paths and are applied only if the producing system elects to use them.

This architectural pattern creates several failure modes that no amount of improved verification can resolve:

#### No enforced origin point.

The first instance of an artifact has no cryptographically constrained birth event. Content enters the world without any structural evidence of how, where, or under what conditions it was created.

#### Post-hoc wrapping is indistinguishable from legitimate origin.

Synthetic or replayed data can be introduced and later wrapped in authenticity claims -- signatures, attestations, metadata -- that are structurally indistinguishable from claims attached at genuine creation time.

#### Trusted pipelines are bypassable.

Even when secure creation paths exist, alternative unauthenticated paths typically remain available. Untrusted components can bypass trusted capture or generation pipelines while still producing durable outputs that appear valid to downstream systems.

#### Authenticity is optional.

Because creation is unrestricted, authenticity signals are voluntary. Systems degrade into environments where authenticated and unauthenticated artifacts coexist, and downstream consumers cannot reliably distinguish them by structural properties.

The common thread across these failure modes is that *post-hoc provenance secures history but does not constrain birth*. The question is not whether we can build better verification after the fact, but whether we can enforce the conditions under which authenticated digital state is permitted to exist at all.

#### 2.1 A Concrete Example: Why Attestation Is Not Enough

To make these failure modes precise, consider a system that appears to solve the problem using current best practices but does not.

A secure camera device contains a Trusted Execution Environment. The camera pipeline feeds sensor data into the TEE. Inside the TEE, trusted code hashes the image, signs the hash with a hardware-protected key, and emits a signed manifest alongside the image file. A verifier can confirm that the image was processed by trusted code running on authentic hardware. This is a well-designed attestation system.

Now consider the attack. The adversary does not compromise the TEE. Instead, the adversary feeds synthetic frames into the camera pipeline's input buffer -- upstream of the TEE, at the sensor interface. The TEE faithfully processes the synthetic data: it hashes the synthetic image, signs the hash, and emits a valid signed manifest. From the verifier's perspective, the attestation is correct. Trusted code did execute on authentic hardware. The signature is valid. But the image is synthetic.

The attestation answered the question it was designed to answer: *"Did trusted code produce this signed output?"* Yes. But the system failed because attestation does not answer a different question: *"Could signed output have been produced for content that did not originate from the intended source?"* The attested pipeline was not bypassed -- it was correctly traversed with adversarial input, because alternative input paths to the attested process were not closed.

This is not a flaw in the TEE or in the attestation protocol. It is a structural gap in the system architecture. The commit path -- the path by which authenticated state comes into existence -- was not exclusively controlled. The TEE enforced the integrity of its own execution but did not enforce that the only way to reach authenticated output was through a creation path that included genuine sensor capture.

#### 2.2 A Second Example: Provenance Without Enforcement

Consider a parallel failure in provenance systems. A photographer captures an image with a C2PA-enabled camera. The camera attaches a signed content credential manifest describing the capture device, timestamp, and edit history. A news platform verifies the manifest and publishes the image with provenance intact.

A social media platform then ingests the published image, strips the C2PA manifest (as most platforms currently do), and redistributes it. A downstream consumer receives the image without provenance metadata. Under C2PA, the image is now indistinguishable from an unsigned image. The provenance was real but impermanent -- it depended on the manifest traveling with the artifact through every intermediary. When the manifest was stripped, the provenance guarantee evaporated.

The underlying issue is the same as the camera example: the system authenticated an artifact at one point in time but did not structurally constrain how authenticated state persists or is verified across distribution. Provenance was a property of the packaging, not a property of the artifact's relationship to its genesis event.

#### 2.3 A Third Example: Ledger Registration Without Creation Constraint

Consider a document notarization service backed by a blockchain or append-only ledger. A user submits a document hash to the service. The service records the hash with a consensus-verified timestamp, producing an immutable ledger entry proving that the hash existed at a specific time. A verifier can later confirm that the document's hash was registered and has not been altered since registration.

Now consider the gap. The adversary generates a synthetic document -- fabricated financial records, a forged legal instrument, or AI-generated imagery -- and submits its hash to the same notarization service. The ledger faithfully records the hash with an accurate timestamp. The notarization is genuine: the hash was indeed registered at the stated time. But the document is fabricated.

The ledger answered the question it was designed to answer: *"Did this hash exist at this time?"* Yes. But it did not answer a different question: *"Was this document produced through an authorized creation process?"* The notarization system provides strong *history* guarantees -- immutability, ordering, non-repudiation of registration -- but imposes no constraint on how the artifact came into existence before registration. Any content, from any source, produced by any process, can be notarized. The creation path is uncontrolled.

These three examples -- in attestation, provenance, and ledger-based notarization -- illustrate the same architectural gap from different angles. The security-relevant question is not whether a trusted process ran, whether a manifest was attached, or whether a hash was recorded. It is whether *authenticated state is structurally unreachable except through authorized creation paths*, and whether that relationship between artifact and genesis can survive distribution.

### 3 Definitions and Terminology

> **Definition 3.1** (Atomic Execution Boundary). A protected execution domain that enforces isolation and ordering constraints for finalization, such that cryptographic computation, authorization, and durable commit occur as one indivisible operation or not at all. If the operation fails, no authenticated durable artifact is produced.

> **Definition 3.2** (Protected Commit Interface). The sole interface permitted to finalize authenticated durable state. Untrusted code cannot produce authenticated durable state except by invoking this interface, which transfers control into the atomic execution boundary.

> **Definition 3.3** (Boundary-Held Capability). A capability available only inside the boundary and required to complete authenticated finalization. Possession of data outside the boundary is insufficient to reproduce or invoke it.

> **Definition 3.4** (Boundary-Fresh Cryptographic Computation). Cryptographic computation performed inside the boundary using one or more freshness sources (secure randomness, monotonic counters, protected clocks, or boundary-internal state), such that the resulting output was not available before the finalization event and cannot be feasibly reproduced outside the boundary. Freshness may be expressed using logical time (epochs or counters) or protected physical clocks. No global wall-clock synchronization is required.

> **Definition 3.5** (Candidate Digital State). Transient, internal, mutable representations of content prior to finalization. Candidate state may be created freely and may be adversarial.

> **Definition 3.6** (Authenticated Durable State). Externally visible or persistent digital state whose authenticated form includes verification material evidencing enforced finalization through a protected commit interface.

> **Definition 3.7** (Binding). A cryptographic construction that combines boundary-fresh output with a content-dependent value (e.g., a hash of the artifact bytes) to produce verification material.

> **Definition 3.8** (Verification Material). Data bound to content and to boundary-fresh output that enables a verifier to distinguish authenticated durable state from unauthenticated state using pre-distributed trust anchors, without querying an external registry of artifacts.

> **Definition 3.9** (Authorization). Successful use of a boundary-held capability via the protected commit interface to complete authenticated finalization. Authorization here refers to enforced finalization capability, not to post-hoc policy claims attached to content.

### 4 System Invariants

If BitGraph is correctly implemented, the following invariants hold:

> **Invariant 4.1** (Authenticated Reachability). Authenticated durable state exists if and only if a successful finalization event occurred inside an approved atomic execution boundary.

> **Invariant 4.2** (Binding Evidence). Every authenticated artifact has associated verification material -- produced at genesis -- that binds its content to boundary-fresh cryptographic output and to a specific boundary identity. This material may be co-located with the artifact, held at a reference point, or both. (A reference point stores verification evidence produced at genesis; it does not confer authenticated status and plays no role in enforcement. See Section 9.5.)

> **Invariant 4.3** (Policy-Anchored Verification). An artifact verifies if and only if its verification material validates under accepted trust anchors and applicable policy constraints.

> **Invariant 4.4** (Distinguishability). Durable state not produced via boundary finalization cannot satisfy verification and is therefore distinguishable from authenticated durable state.

> **Invariant 4.5** (Authenticity as Reachability). Authenticated durable state is defined by enforced state transitions, not by post-hoc claims, metadata, or byte-level identity.

The significance of Invariant 4.5 deserves emphasis. In conventional systems, authenticity is a *label*: a property that can be attached to, claimed about, or inferred from an artifact after it exists. Under BitGraph, authenticity is a *reachability property*: a consequence of the state transitions that produced the artifact. An artifact does not become authenticated by having the right metadata. It is authenticated because it could only have come into existence through a path that enforced authorization, cryptographic binding, and durable commit as a single indivisible event. The authenticated state space is closed under authorized genesis -- nothing else can produce it.

This is the central claim of the paper: if authenticated digital state can only come into existence through a controlled creation path, then the existence of an authenticated artifact is itself proof that the creation path was traversed. Authentication becomes a reachability property of system architecture -- a consequence of how state transitions are structured -- rather than a label applied to artifacts after the fact.

Returning to the camera example from Section 2.1: under BitGraph, the system would not merely attest that trusted code ran. It would enforce that authenticated image output is *structurally unreachable* except through a commit path that includes sensor capture within the atomic execution boundary. The adversary's synthetic frames would not produce authenticated output, because the commit path would require that sensor acquisition, hashing, binding, and durable commit all occur within the same indivisible boundary event. Feeding synthetic data to the input buffer would bypass the authorized creation path entirely, and the protected commit interface would never be invoked through the sensor-capture path for that data. The result: no authenticated artifact is produced.

Returning to the provenance example from Section 2.2: under BitGraph with reference-based verification (described in Section 9.5), the downstream consumer could still verify the stripped image by computing its content hash and querying a reference point for the verification material produced at genesis. Authentication would survive distribution because it was established by the artifact's structural relationship to its creation event, not by metadata co-traveling with the artifact.

### 5 Trusted Origin Token Architecture

We begin with a concrete model that makes the enforcement principle tangible before generalizing.

The Trusted Origin Token Architecture addresses uncontrolled digital state creation by introducing a pre-creation authorization requirement. Authenticated creation requires consumption of a pre-existing single-use authorization unit -- a *Trusted Origin Token* -- at the moment of finalization. Tokens are generated in advance, tracked as unused or consumed, and cannot be reused.

Under this model, a system may prepare candidate data freely, but finalization into authenticated durable form is permitted only if a valid unused token is consumed during the same atomic operation that commits the artifact.

The key insight is best understood through analogy. Before digital cameras, a photograph could only exist if film existed first. The film did not merely record the image -- it *enforced* whether the image could exist at all. No film, no photograph, regardless of the camera, the scene, or the photographer's intent. The Trusted Origin Token Architecture enforces the same constraint digitally: no token, no authenticated artifact.

#### 5.1 Functional Properties

> **Property 5.1** (Scarcity). Each authenticated artifact corresponds to exactly one token that existed prior to creation.

> **Property 5.2** (Non-Replay). Tokens cannot be reused. Each token authorizes exactly one finalization event.

> **Property 5.3** (Non-Retroactivity). Tokens cannot be applied after durable state already exists. Authorization must occur at the moment of finalization, not afterward.

> **Property 5.4** (Commit-Path Enforcement). Token consumption and finalization occur within the same indivisible operation.

The Trusted Origin Token Architecture ensures that authenticated durable state cannot exist unless a pre-authorized unit is irreversibly consumed at birth.

#### 5.2 Limits of Token-Based Enforcement

While the token model provides a clear and intuitive model of origin control, it introduces operational complexity. Tokens must be generated, stored, distributed, tracked, and reconciled across systems. Registries or equivalent state-tracking mechanisms must exist to enforce single-use guarantees. Offline operation requires reconciliation logic, and token provisioning becomes infrastructure-coupled to production systems.

More importantly, *tokens are not the fundamental source of trust*. What matters is not the consumption of a specific pre-existing object, but that an irreversible, non-repeatable authorization event occurred at the moment of finalization and could not be replayed or forged. This observation motivates a more general enforcement principle.

### 6 BitGraph and Atomic Causality

The Trusted Origin Token Architecture reveals a structural principle that is more general than tokens. What enforced origin control in TOTA was not the token itself -- it was the fact that authenticated state was structurally unreachable without traversing a protected commit path that combined authorization, binding, and commit into a single indivisible event. Tokens enforced this by requiring consumption of a pre-existing resource. But any mechanism that makes authenticated state unreachable without an irreversible authorization event at the commit boundary achieves the same enforcement.

BitGraph generalizes this principle. Instead of consuming a pre-generated token, the enforcement component generates a *boundary-fresh cryptographic value* N during the atomic finalization event. Cryptographic unpredictability and negligible collision probability prevent precomputation, reuse, or accidental duplication.

The reader should note what changed and what did not. What changed is the mechanism: tokens are replaced by boundary-fresh generation. What did *not* change is the enforcement invariant: authenticated durable state remains structurally unreachable without an irreversible authorization event inside the atomic execution boundary. The invariant is the primitive. The mechanism is an implementation detail.

This value serves the same functional role as a consumed authorization unit:

- It could not have existed prior to the finalization event.
- It could not have been predicted or precomputed.
- It cannot be recreated after the event.
- Its existence constitutes cryptographic evidence that a specific, irreversible finalization event occurred.

The equivalence shown in Figure 1 is structural, not operational. The reader should resist the interpretation that BitGraph merely replaces physical tokens with virtual ones. The insight is the reverse: TOTA is a special case of BitGraph in which the authorization event happens to be reified as a consumable object. BitGraph reveals that the underlying enforcement primitive is not the token but the structural constraint -- that authenticated state is unreachable without an irreversible authorization event at the commit boundary. Tokens enforce this by depletion; boundary-fresh generation enforces it by cryptographic causality. The primitive is the constraint, not the mechanism.

Similarly, the boundary-fresh value N should not be understood as merely a "nonce for replay protection." In conventional protocols, nonces prevent message replay. In BitGraph, the boundary-fresh value is *the authorization event itself* -- its generation inside the boundary constitutes the irreversible act that gates the creation of authenticated state. Producing valid verification material is proof that this act occurred, not merely that a unique value was included.

#### 6.1 Atomic Causality

Under Atomic Causality, three operations are linked into a single indivisible event inside an atomic execution boundary, completed only through a protected commit interface requiring a boundary-held capability:

1. **Authorization**: A boundary-held capability is exercised.
2. **Cryptographic binding**: Boundary-fresh output is bound to a content-dependent value.
3. **Durable commit**: The authenticated artifact is committed to persistent storage or an output channel.

Authenticated durable state is reachable only if these operations occur together, in order, within the same atomic execution boundary. If any step fails, no authenticated artifact is produced.

#### 6.2 Why This Is Not Attested Execution

This enforcement model is not equivalent to conventional attested execution followed by signing. The distinction is precise and consequential.

Attestation-based systems can demonstrate that particular trusted code executed and produced particular signed outputs. This answers the question: *"Was this artifact produced by trusted code?"* But attestation does not answer a different and more fundamental question: *"Could an artifact not produced by trusted code have entered this trust domain through any available commit path?"*

In most attestation-based systems, enforcement is advisory. Trusted processes may produce signed outputs, while untrusted processes may still produce durable state that enters downstream systems through alternative commit paths. The enforcement gap is not in the attested path -- it is in the unattested paths that remain open.

BitGraph closes this gap. Authenticated durable state is reachable *only* through protected commit paths that enforce atomic binding, authorization, and durable commit at the moment of finalization. Valid verification material implies not merely that trusted code ran, but that *no alternative path to authenticated state exists*. This is a structural property of the commit architecture, not a property of any single attested process.

#### 6.3 Token-Equivalence of Boundary-Fresh Generation

Token-equivalence does not arise from uniqueness alone. It arises from atomic, attested finalization that combines several properties: boundary isolation ensures the fresh output is generated only inside the atomic execution boundary; unpredictability prevents adversaries from predicting or precomputing valid values; binding ties the fresh output to a content-dependent value before commit; a boundary-held authorization capability gates finalization; and attestation or signing produces verification material validatable under accepted trust anchors.

Together, these properties ensure that producing valid verification material implies that a specific authorization event occurred inside the boundary at finalization time. The fresh value N functions as a consumed authorization unit whose existence is cryptographic evidence of an irreversible finalization event -- not merely a unique identifier. To be precise: the fresh value alone does not constitute authorization. Authorization arises from the indivisible combination of boundary isolation, capability-gated access, atomic binding, and freshness -- no single property is sufficient, and removing any one breaks the enforcement guarantee.

Functionally, the space of possible boundary-fresh outputs acts as an effectively inexhaustible universe of unused authorization units, and generating one during finalization constitutes irreversible consumption. Each accepted artifact necessarily corresponds to exactly one irreducible authorization event, making boundary-fresh outputs operationally equivalent to single-use tokens even without explicit allocation or tracking.

### 7 Formal Model

We formalize BitGraph using a labeled transition system and closure algebra. This formalization captures the essential properties of the architecture and enables precise comparison with existing enforcement models.

#### 7.1 State Space and Transition System

> **Definition 7.1** (BitGraph System). A BitGraph system is a labeled transition system (Sigma, ->, E) where: Sigma is the state space, partitioned into Sigma_auth and Sigma_unauth; -> is the transition relation labeled by events E; E_auth is the set of authorization events; C is the *genesis constructor relation*.

The genesis constructor relation C captures the protected commit interface: it is the only relation that produces elements of Sigma_auth. Candidate state in Sigma_unauth may be created freely by any process.

#### 7.2 Core Invariants

A BitGraph-compliant system enforces three invariants:

> **Invariant 7.2** (Constructibility -- Closure Property). Every element of the authenticated state space was produced by a genesis constructor under an authorized event.

> **Invariant 7.3** (Constructor Completeness -- Unforgeability). All transitions into the authenticated state space are genesis constructors under authorized events. There is no transition into Sigma_auth that bypasses C.

> **Invariant 7.4** (Atomic Causality -- Indivisibility). authorize(e), bind(e), commit(s') occur in a single atomic transition with no intermediate states observable outside the protected boundary. Authorization, cryptographic binding, and durable commit are inseparable within the atomic execution boundary.

#### 7.3 Authenticated State as Closure Algebra

The authenticated state space Sigma_auth forms a *closure space* generated by authorization events through genesis constructors. The invariant Sigma_auth = Cl_C(E_auth) states that the authenticated state space is exactly the closure under authorized genesis. This makes authentication a *topological property* of the system's state space rather than a local property of individual artifacts.

This formulation connects to existing mathematical structures:

- **Order theory**: Sigma_auth forms a Moore family (closed under arbitrary intersections of compliant subsets).
- **Type theory**: Genesis constructors are the sole constructors of an abstract data type; Sigma_auth has private constructors.
- **Provenance**: Unlike provenance semirings, which annotate data with origin information, BitGraph *enforces* that authenticated state can only exist if it has authorized genesis -- enforcement, not annotation.

#### 7.4 Token-Nonce Duality

The Trusted Origin Token Architecture and BitGraph enforce the same injective genesis invariant through dual mechanisms:

> **Definition 7.5** (Injective Genesis). A system enforces injective genesis if and only if the map phi: E_auth -> Sigma_auth is an injection. Each authorization event produces at most one authenticated artifact, and each authenticated artifact corresponds to exactly one authorization event.

**Token Conservation (TOTA).** Authorization events are reified as consumable tokens. Consumption tracking enforces |tokens consumed| = |Sigma_auth|. This is a *depletable resource* model analogous to affine types in linear logic.

**Boundary-Fresh Uniqueness (BitGraph).** Authorization events are boundary-generated values whose cryptographic freshness ensures uniqueness. Each value appears in exactly one authenticated artifact. This is a *unique generator* model analogous to existential types with freshness guarantees.

Under perfect cryptography and uncompromised boundary assumptions, these mechanisms are *cryptographic duals*: they enforce the same cardinality constraint |E_auth| = |Sigma_auth| through isomorphic algebraic structures -- consumable resources versus generative uniqueness. The token model makes injectivity definitional; the boundary-fresh model makes injectivity derived from collision resistance and freshness guarantees.

> **Remark 7.6** (Structural Non-Reusability). Injective genesis ensures that no authorization event can contribute to more than one authenticated artifact, and no authenticated artifact can exist without a unique authorization event. Authorization events are irreversible state transitions -- once an event has produced an authenticated artifact, it is permanently consumed by that production and cannot be replayed, redirected, or shared. This is a structural property of the genesis constructor, not a bookkeeping constraint enforced by external tracking.

### 8 Adversarial Model and Security Game

We define a security game that captures the adversarial setting in which BitGraph operates.

#### 8.1 Threat Model

The adversary A is assumed to possess: full control of application code executing outside the atomic execution boundary; control of storage systems and network transport; the ability to replay, substitute, or synthesize candidate data; access to all previously produced authenticated artifacts and their verification material.

The adversary does *not* possess: the ability to execute code inside the atomic execution boundary; access to boundary-held capabilities (signing keys, capability tokens); the ability to predict or reproduce boundary-fresh cryptographic output.

#### 8.2 Security Game: Origin Forgery

> **Definition 8.1** (Origin Forgery Game). The game Forge_A^BitGraph(lambda) proceeds as follows: 1. Setup -- the challenger initializes a BitGraph system. 2. Query phase -- the adversary may submit candidate data and observe results. 3. Forgery -- the adversary outputs a candidate artifact and verification material. 4. Win condition -- A wins if the output verifies under trust anchors and was not produced by any query to the protected commit interface.

> **Definition 8.2** (BitGraph Security). A BitGraph system is *secure* if for all probabilistic polynomial-time adversaries A: Pr[Forge_A^BitGraph(lambda) = 1] <= negl(lambda).

> **Proposition 8.3** (Security Reduction). If the signature scheme is existentially unforgeable under chosen-message attack (EUF-CMA) and the freshness source is collision-resistant, then the BitGraph system is secure under Definition 8.1.

**Proof sketch.** Suppose adversary A wins the Origin Forgery Game with non-negligible probability. Then A has produced verification material (a*, v*) that validates under trust anchors TA without invoking the protected commit interface. The verification material includes a signature over a binding of boundary-fresh output N* and a content-dependent value H*. Since A did not invoke the boundary, either: (a) A forged the signature, contradicting EUF-CMA security; or (b) A reused a boundary-fresh value N from a previous query with different content, contradicting binding integrity; or (c) A replayed an exact (a, v) pair from a previous query, which fails the win condition. Therefore no PPT adversary wins with non-negligible probability.

This reduction relies on two distinct classes of assumption: cryptographic assumptions (EUF-CMA signature security, collision resistance of the freshness source) and architectural assumptions (boundary isolation, non-extractability of signing keys, atomicity of the commit operation).

#### 8.3 Falsifiable Distinctions

The following tests distinguish BitGraph-compliant systems from systems that appear similar but fail to enforce origin control.

**F1: Post-hoc Annotation.** If there exists a function that promotes unauthenticated state to authenticated state while preserving content, the system is not BitGraph-compliant. This test fails for any system where content is created first and authentication is applied afterward -- signing, blockchain registration, provenance database entry, or metadata attachment. These are *annotation systems*, not origin enforcement.

**F2: Unconfined Constructor.** If the genesis constructor can be invoked from contexts outside the protected boundary, the system violates constructor completeness. This test fails when signing keys are accessible to application code, when the commit interface is a public API without boundary isolation, or when trusted and untrusted code share execution context.

**F3: Authorization Forgery.** If an adversary without boundary access can produce events satisfying authorized(e) = true, the system violates unforgeability. This test fails when signing keys are extractable, when tokens can be synthesized without authority, or when capabilities can be delegated outside the boundary.

**F4: Observable Atomicity Break.** If the genesis transition can be decomposed into externally observable intermediate steps -- authorization at time t1, binding at t2 > t1, commit at t3 > t2 -- the system violates Atomic Causality. This test fails for systems where authorization checking, signing, and storage commit are separate API calls, creating time-of-check-to-time-of-use vulnerabilities.

**F5: Retroactive Authentication.** If durable state can be created first and then promoted to authenticated form by any post-hoc operation that preserves content, the system is implementing annotation, not origin control. This is the most direct test: if the content bytes can exist before the authorization event, the system does not enforce BitGraph.

### 9 Architecture

#### 9.1 State Transition Model

BitGraph distinguishes between candidate digital state and authenticated durable state. Candidate state may exist anywhere and may be adversarial. Authenticated durable state consists of externally visible or persistent artifacts whose authenticated form includes verification material produced by enforced finalization.

The transition from candidate to authenticated occurs at *commit paths*: file writes, storage uploads, message publication, model output export, sensor data release, and log entry creation.

This transition is mediated by four architectural components: an atomic execution boundary, boundary-fresh cryptographic computation, a protected commit interface, and a boundary-held capability. Outside the boundary, systems may generate arbitrary data. The authenticated durable form is unreachable without successful finalization.

#### 9.2 Atomic Finalization Protocol

Atomic finalization proceeds as a single ordered operation:

1. Candidate state is prepared outside the boundary.
2. The request enters the protected commit interface and crosses into the atomic execution boundary.
3. Boundary-fresh cryptographic output N is generated.
4. A content-dependent value H is computed (e.g., a cryptographic hash of the artifact).
5. Binding material is produced over (H, N).
6. Authorization is performed using a boundary-held capability.
7. Authenticated durable state and verification material are committed.

If any step fails, no authenticated durable state is produced. The system is *fail-closed*: failures prevent authenticated creation rather than producing ambiguous or partially authenticated outputs.

#### 9.3 Verification Model

Verification relies on cryptographic attestation produced by the atomic execution boundary over the binding between content and boundary-fresh output. Concretely, the boundary produces verification material covering: the content-dependent value H, the boundary-fresh output N, and optional policy or context metadata. This material is signed or attested using boundary-held cryptographic keys.

Verifiers accept artifacts only if the verification material validates under approved trust anchors, which may include pinned boundary public keys, manufacturer or platform roots certifying boundary identities, or signed domain policy manifests specifying acceptable boundary identities, epochs, and validity windows.

No registry of artifacts is required. Verifiers need not identify the producing application -- only that the artifact could not have been finalized outside an approved boundary under accepted policy.

#### 9.4 Enforcement and Verification Are Separate Architectural Layers

A distinction fundamental to BitGraph must be stated explicitly. Enforcement determines whether authenticated durable state *exists*. Verification determines whether a third party can *demonstrate* that authenticated durable state exists. These are different properties operating at different architectural layers.

Enforcement is irrevocable. Once candidate state has been finalized through the protected commit interface -- once authorization, binding, and durable commit have occurred as a single atomic event inside the boundary -- the resulting artifact is authenticated. This is a historical fact about the artifact's genesis, not a claim that depends on the continued availability of any proof material.

Verification is operationally contingent. A verifier can confirm an artifact's authenticated status only if verification material is accessible -- either co-traveling with the artifact or retrievable from a reference point. If all copies of verification material are lost, the artifact becomes *unverifiable* but does not become *unauthenticated*. The genesis event still occurred. The enforcement invariants still held at the moment of creation. The artifact's authenticated status is a property of its creation path, not a property of currently available evidence.

This separation is what distinguishes BitGraph from verification systems, provenance frameworks, and attestation protocols. Those systems define authenticity in terms of what can currently be checked. BitGraph defines authenticity in terms of what was structurally enforced at creation. Verification is one mechanism for observing the consequences of enforcement, but it is not the enforcement itself.

#### 9.5 Verification Independence from Proof Transport

A critical architectural property of BitGraph is that the enforcement invariants described in Section 4 hold at genesis and are not contingent on any subsequent verification event, proof transport mechanism, or reference infrastructure availability. Verification is a mechanism for demonstrating that enforcement occurred. It is not a component of enforcement.

The verification model is therefore independent of how verification material reaches the verifier. BitGraph supports multiple verification models, and the choice among them is a deployment decision, not an architectural constraint. No verification model choice affects whether the enforcement invariants hold.

**Portable proof.** Verification material travels with the artifact -- embedded in file metadata, carried in a sidecar file, or included in a manifest bundle. This is compatible with existing provenance formats such as C2PA and enables self-contained verification without external dependencies.

**Reference-based verification.** Verification material is held at one or more canonical reference points operated by the producing boundary, a trusted third party, or a federated network. When a verifier encounters an artifact without co-traveling proof, the verifier computes the artifact's content hash and queries the reference point to obtain the verification material produced at genesis. The artifact carries nothing. Its content hash is its lookup key.

**Hybrid verification.** Artifacts carry verification material when the distribution channel preserves it. Reference points serve as authoritative fallback for stripped, reformatted, or re-distributed artifacts. Both modes validate against the same trust anchors and enforce the same invariants.

This property has significant practical consequences. BitGraph-authenticated artifacts can be freely copied, reformatted, compressed, transcoded, or distributed through channels that strip metadata -- and their authenticated status is permanent regardless of what happens to metadata during distribution. *Verifiability* -- the ability for a third party to confirm authenticated status -- requires that either co-traveling proof or a reference point is available and that the content-preserving hash can be recomputed. But the artifact's authenticated status, as defined by the enforcement invariants, is an irrevocable consequence of its genesis and does not depend on proof availability.

A clarification regarding content transforms is warranted. Verification depends on recomputing a content-dependent hash that matches the hash bound at genesis. Lossless operations that preserve byte-identical content -- copying, re-hosting, metadata stripping, container rewrapping -- leave this hash intact and verification proceeds directly. Lossy transforms -- recompression, transcoding, cropping, resolution scaling -- alter the content bytes and therefore invalidate the original binding. Under BitGraph, a lossy transform produces new candidate state. If the transformed output must itself be authenticated, it requires a new finalization event at a protected transform boundary, producing fresh verification material for the new content.

A reference point is not an artifact registry. A registry implies centralized control over all authenticated artifacts and creates a single point of failure for the entire system. A reference point is a service that holds verification material produced by a specific boundary and can be replicated, federated, or operated by the producing boundary itself. Multiple reference points can hold verification material for the same artifact. The trust model does not change: verifiers validate against trust anchors, not against the reference point's authority. Reference points play no role in the enforcement layer.

#### 9.6 Boundary Compromise and Recovery

If the atomic execution boundary or its signing keys are compromised, the system cannot distinguish forged authenticated artifacts from legitimate ones under that boundary identity. Trust collapses to the compromised boundary, not to the entire system. Recovery is handled operationally by revoking or rotating trust anchors, introducing new boundary identities, and enforcing epoch or policy constraints on acceptable verification material. No artifact registry or retroactive correction mechanism is required.

The critical architectural property is that *enforcement strength scales with key isolation strength*. Software boundaries provide enforcement convenience and deployment accessibility but are inherently weaker against key extraction. Hardware-backed boundaries -- secure enclaves, HSMs, trusted execution environments -- provide structural guarantees by enforcing both key non-extractability and constrained usage semantics.

#### 9.7 Security Properties

> **Property 9.1** (Non-Retroactivity). Authenticated durable state cannot be produced after the fact for pre-existing data.

> **Property 9.2** (Creation-Path Exclusivity). Authenticated durable state is structurally reachable only through the protected commit interface and cannot be produced by any alternative code path or post-hoc process.

> **Property 9.3** (Content Integrity). Verification material binds authenticated state to specific content bytes.

> **Property 9.4** (Replay Resistance). Boundary-fresh cryptographic output prevents reuse of prior authorization events.

### 10 Related Work

#### 10.1 Trusted Execution and Remote Attestation

Trusted Execution Environments (Intel SGX, ARM TrustZone, AMD SEV, RISC-V Keystone) and remote attestation protocols (DICE, RATS/RFC 9334) provide hardware-enforced isolation and cryptographic proof that specific code executed in a measured environment. These mechanisms establish that a particular software image ran on genuine hardware and that its outputs were produced by attested code.

These systems answer the question: *"Did specific trusted code execute?"* BitGraph asks a different question: *"Is authenticated durable state reachable only through enforced commit paths?"* Attestation authenticates a pipeline. BitGraph constrains the commit architecture so that alternative pipelines cannot produce authenticated state. TEEs are one possible implementation substrate for BitGraph boundaries, but attestation alone does not close unprotected commit paths that exist alongside the attested process.

#### 10.2 Content Provenance and Credential Systems

The Coalition for Content Provenance and Authenticity (C2PA) and related provenance standards define how to represent claims about an artifact's origin, edits, and attribution, and how to transport that information across tools and platforms.

BitGraph targets a different architectural layer. Provenance standards are a *packaging and disclosure layer*: they define what claims look like and how to verify them. BitGraph is an *enforcement layer*: it determines whether authenticated durable state can be finalized at all unless creation-time conditions were met.

BitGraph and provenance are complementary. BitGraph strengthens provenance by making provenance verifiability a prerequisite for admission into protected domains. Provenance remains the interoperability layer that carries claims across ecosystems; BitGraph supplies the mechanism by which systems enforce that only authenticated artifacts become trusted durable state.

#### 10.3 Reference Monitors and Access Control

The classical reference monitor concept (Anderson, 1972) mediates all operations on existing objects. BitGraph is strictly stronger in one dimension: it controls not merely which *operations* on objects are permitted, but which *objects are permitted to exist* in authenticated form. Classical access control assumes object creation is uncontrolled and focuses on subsequent access. BitGraph constrains creation itself.

The key difference: a reference monitor assumes objects exist and mediates access. A genesis monitor constrains which authenticated objects can exist at all. This is *mandatory constructor security*, analogous to mandatory access control but applied to object generation rather than object access.

#### 10.4 Capability-Based Security

Object-capability models (Dennis & Van Horn, 1966; Miller, 2006) enforce that access to objects requires possession of an unforgeable capability. BitGraph shares the emphasis on structural enforcement through unforgeable references but applies it at a different layer. Capabilities control *reachability of existing objects*. BitGraph controls *constructibility of new authenticated state*.

#### 10.5 Information Flow Control

Mandatory information flow control (Goguen & Meseguer, 1982; Myers & Liskov, 1997) constrains how information propagates through a system. BitGraph enforces a related but distinct property: it constrains how authenticated state is *generated*, not how information flows between existing states.

#### 10.6 Blockchain and Distributed Consensus

Blockchain systems enforce that state changes require consensus among distributed participants. The architectural parallel to BitGraph is real: both create structural bottlenecks through which state transitions must pass. However, blockchain achieves consensus through economic coordination among mutually distrustful parties, while BitGraph achieves origin enforcement through boundary isolation and cryptographic causality at a single enforcement point. BitGraph generalizes the structural bottleneck principle to arbitrary protected boundaries without requiring distributed consensus, economic incentives, or global coordination.

#### 10.7 Delay-Tolerant Networking and Interplanetary Protocols

The Bundle Protocol (RFC 9171) and DTN architecture provide store-and-forward transport for environments with extreme latency and intermittent connectivity. Bundle security (BPSec, RFC 9172) provides integrity and confidentiality at the bundle layer but does not constrain how authenticated payloads are created -- it secures transport, not genesis. BitGraph complements DTN by enforcing that bundle payloads finalized through a protected commit interface carry portable verification material validatable offline against pre-distributed trust anchors, with no return path to the origin required.

#### 10.8 Summary of Structural Distinctions

| Property | Digital Signing | TEE / Attested Exec. | Provenance (C2PA) | Blockchain / Ledger | BitGraph |
|----------|----------------|---------------------|-------------------|--------------------|----|
| Enforces creation-path exclusivity | No | No | No | No | **Yes** |
| Prevents post-hoc auth. wrapping | No | No | No | No | **Yes** |
| Binds authorization to commit atomically | No | Partial | No | Partial | **Yes** |
| Proof survives metadata stripping | No | No | No | Yes | **Yes** |
| Requires registry or ledger infrastructure | No | No | No | Yes | **No** |
| Enforces admission control (not traceability) | No | No | No | No | **Yes** |

### 11 Worked Examples

We present two worked examples demonstrating BitGraph in distinct domains.

#### 11.1 Secure Media Capture

Consider a device capturing photos or video for evidentiary or provenance-sensitive use. Candidate image or video data is produced by the camera sensor and image processing pipeline. This data may exist in memory or temporary buffers. It is not authenticated.

When a capture is to be finalized, the device invokes the protected commit interface for media output. Inside the atomic execution boundary:

1. A boundary-fresh value N is generated.
2. A hash H of the media content is computed.
3. Verification material is produced by signing over (H, N) together with device identity and capture metadata.
4. Authorization is performed using a boundary-held capability.
5. The media file and verification material are committed to durable storage.

Any media not finalized through this boundary cannot produce valid verification material and is rejected as unauthenticated -- even if it is visually or byte-identical to an authenticated capture.

#### 11.2 AI Output Export Pipeline

Consider an AI inference service exporting model outputs to downstream consumers. Candidate outputs are produced by model execution and may exist in memory or temporary buffers. They are not authenticated.

When an output is to be released, the system invokes the protected commit interface for output export. Inside the atomic execution boundary:

1. A boundary-fresh value N is generated.
2. A hash H of the output is computed.
3. Verification material is produced by signing over (H, N) together with model identity and policy metadata.
4. Authorization is performed using a boundary-held capability.
5. The output and verification material are committed.

Any AI output not finalized through this boundary cannot produce valid verification material and is rejected as unauthenticated -- even if it is byte-identical to an authenticated output. This is particularly relevant for regulatory compliance frameworks such as the EU AI Act, which require AI-generated content to be identifiable.

### 12 Instantiations of the Atomic Boundary

The atomic execution boundary is an architectural abstraction. Concrete implementations vary by platform, deployment environment, and assurance requirements. Possible instantiations include:

- **Device-level TEEs or secure enclaves** gating camera output, sensor release, or local file creation.
- **Kernel-mediated commit paths** controlling writes to protected namespaces.
- **HSM-backed services** finalizing logs, media, or datasets in backend systems.
- **Operating system services** that mediate all protected commit paths, centralizing admission policy and proof generation.
- **Gateway or pipeline enforcement** at ingestion points where data enters trusted domains.
- **Secure pipeline stages** in CI/CD or regulated data ingestion workflows.

These mechanisms differ in construction, but the enforcement invariant is the same: authenticated durable state can be finalized only through a protected commit interface that performs boundary-fresh cryptographic binding and authorization inside an atomic execution boundary.

BitGraph does not prevent the construction of unauthorized boundaries. Any party can build a boundary and produce verification material. However, artifacts produced by unauthorized boundaries fail verification under accepted trust anchors, because those boundaries' identities are not in the approved set.

#### 12.1 Enforcement Tier Semantics

Three enforcement tiers capture the practically relevant points in the assurance space:

> **Definition 12.1** (Enforcement Tiers).

- **Software-only** (tau_sw). The commit gate, signing key, nonce source, and counter are all held in ordinary process memory. No hardware isolation separates them from application code. Suitable for development and integration testing; does not satisfy the Boundary Isolation invariant against a privileged-process adversary.

- **Hardware-bound key** (tau_hw). The signing key is held in a hardware security boundary (Secure Enclave, TPM, HSM) and is non-exportable. However, the commit gate runs outside the measured boundary. This provides hardware-bound identity but does not provide causal enforcement: a compromised host can submit arbitrary digests and receive valid signatures without passing through the protected commit interface.

- **Measured TEE** (tau_tee). The commit gate, key management, nonce generation, monotonic counter, and signing all execute inside the attested enclave boundary. The host is treated as untrusted and cannot influence the commit decision or observe intermediate cryptographic state. The enclave's identity is a hardware-measured value that cannot be forged by user-space code. A verifier who pins acceptable measurements and validates the attestation report is guaranteed, under the hardware trust model, that the enforcement invariants held at genesis.

The enforcement tier is included in the signed body of every BitGraph proof, making it tamper-evident in transit. However, the tier field is *self-reported* by the boundary adapter. Actual trust in a declared tier requires independent corroboration: pinning acceptable measurements and validating hardware attestation reports.

> **Remark 12.2** (Hardware-Bound Key is Not Causal Enforcement). The tau_hw tier provides meaningful security against key extraction but does not satisfy commit-path exclusivity. Application code feeding arbitrary digests to the hardware signer can produce valid signatures for any content without traversal of the protected commit interface.

### 13 Admission of Pre-Existing Data

BitGraph defines authenticity in terms of enforced finalization events, not in terms of historical existence of content bytes.

Candidate data may exist prior to authenticated finalization and may be externally sourced, duplicated, replayed, or synthesized. Such prior existence is outside the trust model and carries no authenticity semantics.

Authenticated durable state is created only when candidate data is finalized through the protected commit interface and bound to boundary-fresh cryptographic output produced inside the atomic execution boundary.

The same content may be finalized multiple times in separate authorization events, each producing distinct verification material. Each such event constitutes an independent origin -- a distinct enforced admission into authenticated durable state.

#### 13.1 Enforced Provenance Chains

When content traverses multiple BitGraph-enforced boundaries, each boundary produces independent verification material for the same content. The result is a structurally enforced provenance chain: an ordered sequence of admission events, each cryptographically bound to the content at its respective boundary. Unlike voluntary provenance annotations, each link in this chain is the product of an enforced finalization event and could not have been produced without traversing the corresponding boundary.

### 14 Implementation Considerations

**Latency.** Creation-time enforcement must be fast enough to run on capture and export paths without degrading user experience or pipeline throughput. Modern signing operations (Ed25519, ECDSA P-256) complete in microseconds on current hardware.

**Offline operation.** Environments requiring offline creation can generate proofs locally and defer admission into trusted domains until connectivity is available.

**Failure handling.** Systems must define failure behavior. For high-assurance domains, fail-closed behavior is required: if proof generation fails, finalization is blocked. For consumer deployments, staged enforcement may begin with fail-open at selected boundaries and evolve toward fail-closed.

**Verification material formats and transport.** Verification material may be embedded within the artifact, carried in a sidecar file, included in a bundle manifest, transmitted as an authenticated envelope, or held at a reference point for query-based verification.

**Key rotation and revocation.** Operational deployments require key rotation policies and revocation mechanisms. When a boundary is compromised, trust anchors can be revoked or rotated, new boundary identities introduced, and epoch constraints enforced on acceptable verification material. No artifact registry is required for rotation or recovery.

**Interoperability with provenance systems.** BitGraph coexists with provenance and credentialing systems that focus on post-creation traceability. Provenance chains can be attached to artifacts finalized under BitGraph, providing richer downstream traceability.

### 15 Deployment and Adoption

BitGraph is best understood as an enforcement primitive that can be introduced incrementally. Most environments cannot transition from fully permissive creation to strict admissibility in a single step.

**Phased rollout.** A practical deployment begins with visibility: attaching verification material when available and surfacing authenticated versus unauthenticated status. The next phase requires authenticated finalization for selected high-assurance workflows while allowing unauthenticated outputs in a separate untrusted lane. Over time, enforcement expands to additional repositories, export paths, and regulated domains.

**Policy-driven boundaries.** The decisive question in most deployments is not whether an artifact can be produced, but whether it can be admitted into a domain that confers legitimacy, downstream impact, or compliance standing.

**Institutional adoption incentives.** Adoption is accelerated when benefits are concrete: reduced downstream moderation burden, improved auditability, clearer liability boundaries, and the ability to define and enforce admissible content policies.

**End state.** The end state is not universal prevention of unauthenticated creation, but reliable exclusion of unauthenticated durable state from the systems and pipelines where legitimacy, compliance, and downstream impact are determined.

### 16 Applications

BitGraph applies wherever systems must distinguish admissible durable outputs from arbitrary durable outputs produced outside trusted pipelines. The pattern arises across domains:

1. **AI training and inference pipelines**, where only authenticated outputs may be admitted into datasets or downstream automation.
2. **Media capture and evidentiary systems**, where admissibility depends on verified creation conditions.
3. **Compliance logging and telemetry**, where audit records must resist post-hoc fabrication.
4. **Scientific instruments and simulations**, where experimental results must be traceable to controlled execution environments.
5. **Regulated data processing** in finance, healthcare, safety monitoring, and government systems.
6. **Digital identity and credential issuance**, where credentials must be structurally unforgeable.
7. **Supply chain verification**, where provenance must be enforced at each handoff rather than reconstructed afterward.
8. **Authorization transfer and ledger-independent scarcity**, where transfer of digital value or authority is enforced by a single atomic transition that both irreversibly de-authorizes the sender capability and generates the receiver capability within a protected execution boundary. This is a direct application of the birth-death semantics: the prior authority undergoes verifiable death, and the successor undergoes verifiable birth, within a single atomic event. This preserves scarcity invariants structurally and implies double-spend resistance without global ledgers, distributed consensus, or registry-based settlement infrastructure.
9. **Interplanetary and delay-tolerant systems**, where authentication must be non-interactive, verification must occur offline, and proofs must travel with data across store-and-forward networks with minutes-to-hours latency.

### 17 Birth-Death Semantics

BitGraph enforces what we term *birth-death semantics* for digital state. Under this model, every authoritative state transition has exactly one verifiable moment of creation (birth), and every transfer or succession requires cryptographic evidence that the prior authority has been irreversibly consumed (death).

Traditional provenance systems operate in a *detect-after* model: artifacts are produced freely, and conflicts such as replay, duplication, or double-spend are identified retrospectively through logs, ledgers, or consensus. BitGraph instead constrains the execution path such that invalid successor states are structurally unreachable within the enforcing boundary.

#### 17.1 Construction

Within a verifier-accepted measured boundary, a valid BitGraph commit requires the atomic execution of the following steps:

- Policy authorization of the requested operation
- Generation and atomic consumption of a fresh, non-replayable commitment value (either an unpredictable nonce or a strictly monotonic counter)
- Collision-resistant binding of the artifact digest to the consumed value
- Durable commit of the resulting signed proof

No intermediate state is externally observable, and partial completion yields no valid proof. The consumed value establishes a forward-only lineage: any valid successor must reference a strictly later state within the boundary's monotonic domain.

#### 17.2 Single-Successor Property

Given correct enforcement of measurement and monotonicity within the boundary, BitGraph guarantees:

> **Property (Single-Successor).** At most one valid successor can be produced from any given parent authority within the verifier-accepted measurement and monotonicity domain of the enforcing boundary.

If two purported successors are observed downstream, at least one of the following must hold:

- The enforcing boundary was compromised or misconfigured
- Monotonic state or anti-rollback guarantees were violated
- The verifier accepted an out-of-policy measurement
- The usage context exceeded the declared trust model

This reframes failure analysis from probabilistic conflict resolution to deterministic boundary integrity verification.

#### 17.3 Relationship to Double-Spend

Birth-death semantics targets the core primitive underlying double-spend failures: the ability to produce multiple valid successor states from a single authority. By making such forks structurally unreachable at commit time within the stated trust envelope, BitGraph reduces reliance on global ordering for single-holder and provenance-sensitive workflows.

BitGraph does not claim global uniqueness across mutually distrustful, permissionless environments without additional coordination. Instead, it provides strong local authority guarantees that higher-level systems may compose with federation or consensus where global agreement is required.

#### 17.4 Trust Envelope

The guarantees above hold only within the verifier-accepted measurement and monotonicity domain of the enforcing boundary. In particular:

- A protected execution boundary is required for enforcement
- Monotonic state must be resistant to rollback within that boundary
- Verifiers must enforce measurement policy and counter monotonicity
- BitGraph does not prevent byte-level copying of artifacts outside the authority model

Within this envelope, birth-death semantics converts post-facto detection problems into construction-time exclusion properties.

### 18 Single-Transfer Value Without Consensus

BitGraph enables single-transfer digital value by binding authority to a consumptive, cryptographically enforced state transition rather than to a ledger entry. This is a concrete instantiation of the birth-death semantics described in Section 17: each transfer atomically consumes (kills) the prior holder's authority and produces (births) a new verifiable successor. Each artifact carries a proof that can only be produced through a protected commit path, where authorization, binding, and durable commit occur atomically inside a trusted execution boundary. When value is transferred, the prior holder's permission is provably consumed and the new state is independently verifiable offline using public keys and hash lineage. The bytes themselves may be copied, but the authoritative right cannot be duplicated, because the single-successor property guarantees that only one unspent lineage can exist at a time within the enforcing boundary. In this model, uniqueness and transfer integrity come from enforced execution semantics instead of global consensus, allowing blockchain-free, verifiable digital handoff.

### 19 Conclusion

The Trusted Origin Token Architecture demonstrates that origin control can be enforced by consuming authorization units at finalization. BitGraph generalizes this result by showing that equivalent enforcement is achieved using boundary-fresh cryptographic computation and protected commit paths, without requiring tracked tokens.

Atomic Causality links authorization, cryptographic binding, and durable commit into a single indivisible event. Authenticated durable state is defined by structural reachability -- by the state transitions that produced it -- not by historical claims, metadata, or post-hoc annotation.

The formal model presented here shows that BitGraph defines a new enforcement primitive: a *genesis access control mechanism* that constrains which authenticated objects are permitted to exist, rather than mediating operations on objects that already exist. This is strictly stronger than classical reference monitors and formally distinct from attested execution, information flow control, and capability-based security.

By securing creation rather than history, BitGraph establishes an architectural primitive for trustworthy digital systems. It does not replace provenance, verification, or access control. It provides the structural foundation that makes those mechanisms enforceable at the boundaries where legitimacy is conferred.

### References

[1] J. P. Anderson, "Computer security technology planning study," Tech. Rep. ESD-TR-73-51, Electronic Systems Division, AFSC, 1972.

[2] W. Y. Arms, "Digital libraries," MIT Press, 2000.

[3] Coalition for Content Provenance and Authenticity (C2PA), "C2PA Technical Specification v2.1," 2024.

[4] V. Costan and S. Devadas, "Intel SGX explained," IACR Cryptology ePrint Archive, Report 2016/086, 2016.

[5] J. B. Dennis and E. C. Van Horn, "Programming semantics for multiprogrammed computations," Communications of the ACM, vol. 9, no. 3, pp. 143-155, 1966.

[6] Trusted Computing Group, "DICE Layered Architecture," 2020.

[7] J. A. Goguen and J. Meseguer, "Security policies and security models," in Proc. IEEE Symposium on Security and Privacy, pp. 11-20, 1982.

[8] T. J. Green, G. Karvounarakis, and V. Tannen, "Provenance semirings," in Proc. ACM SIGMOD-SIGACT-SIGART Symposium on Principles of Database Systems (PODS), pp. 31-40, 2007.

[9] IETF, "Remote ATtestation procedureS (RATS) Architecture," RFC 9334, 2023.

[10] C. B. Jones, "Tentative steps toward a development method for interfering programs," ACM Transactions on Programming Languages and Systems, vol. 5, no. 4, pp. 596-619, 1983.

[11] B. W. Lampson, "Protection," in Proc. 5th Princeton Symposium on Information Sciences and Systems, pp. 437-443, 1971.

[12] M. S. Miller, "Robust composition: Towards a unified approach to access control and concurrency control," Ph.D. dissertation, Johns Hopkins University, 2006.

[13] A. C. Myers and B. Liskov, "A decentralized model for information flow control," in Proc. 16th ACM Symposium on Operating Systems Principles (SOSP), pp. 129-142, 1997.

[14] G. C. Necula, "Proof-carrying code," in Proc. 24th ACM SIGPLAN-SIGACT Symposium on Principles of Programming Languages (POPL), pp. 106-119, 1997.

[15] S. Burleigh, K. Fall, and V. Cerf, "Delay-Tolerant Networking Architecture," RFC 4838, 2007.

[16] K. Scott, S. Burleigh, et al., "Bundle Protocol Version 7," RFC 9171, 2022.

[17] E. Birrane III and K. McKeever, "Bundle Protocol Security (BPSec)," RFC 9172, 2022.
