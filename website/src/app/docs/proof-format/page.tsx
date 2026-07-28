import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Proof Format (bitgraph/1)",
  description: "Wire format specification for the bitgraph/1 proof schema.",
};

export default function ProofFormatPage() {
  return (
    <article className="prose-doc">
      <h1 className="text-3xl sm:text-4xl font-semibold tracking-[-0.03em] mb-6">Proof Format: bitgraph/1</h1>
      <p className="text-[#1f2937] mb-10">
        Normative specification for the <code className="text-xs font-mono bg-[#dbeafe] text-[#0065A4] px-1.5 py-0.5">bitgraph/1</code> proof format. Derived from the reference implementation.
      </p>

      <h2 className="text-xl font-semibold mt-12 mb-4">Proof JSON schema</h2>
      <div className="code-block mb-8">
        <div className="code-block-header"><span>proof.json</span></div>
        <pre className="text-[#1f2937]">{`{
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
  "metadata": { },                   // OPTIONAL - NOT signed, advisory
  "claims": { }                      // OPTIONAL - NOT signed, advisory
}`}</pre>
      </div>

      <h2 className="text-xl font-semibold mt-12 mb-4">Signed body</h2>
      <p className="text-[#1f2937] mb-4">
        The Ed25519 signature covers the canonical serialization of a <code className="text-xs font-mono bg-[#dbeafe] text-[#0065A4] px-1.5 py-0.5">SignedBody</code> object:
      </p>
      <div className="code-block mb-4">
        <div className="code-block-header"><span>SignedBody</span></div>
        <pre className="text-[#1f2937]">{`{
  version:           proof.version,
  artifact:          proof.artifact,
  actor:             proof.agency?.actor,        // when present
  attribution:       proof.attribution,          // when present
  commit:            proof.commit,               // ALL fields verbatim
  publicKeyB64:      proof.signer.publicKeyB64,
  enforcement:       proof.environment.enforcement,
  measurement:       proof.environment.measurement,
  attestationFormat: proof.environment.attestation?.format  // when present
}`}</pre>
      </div>

      <h3 className="text-lg font-semibold mt-8 mb-4">What is NOT signed</h3>
      <div className="overflow-x-auto mb-8">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#e5e7eb]">
              <th className="text-left py-2 pr-4 text-xs font-medium uppercase tracking-wider text-[#4b5563]">Field</th>
              <th className="text-left py-2 text-xs font-medium uppercase tracking-wider text-[#4b5563]">Reason</th>
            </tr>
          </thead>
          <tbody className="text-[#1f2937]">
            <tr className="border-b border-[#e5e7eb]">
              <td className="py-2 pr-4"><code className="text-xs font-mono">signatureB64</code></td>
              <td className="py-2">The seal -- cannot sign itself</td>
            </tr>
            <tr className="border-b border-[#e5e7eb]">
              <td className="py-2 pr-4"><code className="text-xs font-mono">attestation.reportB64</code></td>
              <td className="py-2">Vendor-signed, self-authenticating separately</td>
            </tr>
            <tr className="border-b border-[#e5e7eb]">
              <td className="py-2 pr-4"><code className="text-xs font-mono">slotAllocation</code></td>
              <td className="py-2">Self-authenticating (own Ed25519 signature); bound via commit.slotHashB64</td>
            </tr>
            <tr className="border-b border-[#e5e7eb]">
              <td className="py-2 pr-4"><code className="text-xs font-mono">agency</code></td>
              <td className="py-2">P-256 signature independently verifiable; actor identity IS in signed body</td>
            </tr>
            <tr className="border-b border-[#e5e7eb]">
              <td className="py-2 pr-4"><code className="text-xs font-mono">metadata</code></td>
              <td className="py-2">Advisory, not trusted</td>
            </tr>
            <tr>
              <td className="py-2 pr-4"><code className="text-xs font-mono">claims</code></td>
              <td className="py-2">Advisory, not trusted</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2 className="text-xl font-semibold mt-12 mb-4">Causal slot allocation</h2>
      <p className="text-[#1f2937] mb-4">
        Every proof is causally bound to a pre-allocated slot. The slot is created <em>before</em> the artifact hash is known, proving the enclave committed to a nonce and counter independently of the artifact content.
      </p>
      <div className="overflow-x-auto mb-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#e5e7eb]">
              <th className="text-left py-2 pr-4 text-xs font-medium uppercase tracking-wider text-[#4b5563]">Binding</th>
              <th className="text-left py-2 text-xs font-medium uppercase tracking-wider text-[#4b5563]">How</th>
            </tr>
          </thead>
          <tbody className="text-[#1f2937]">
            <tr className="border-b border-[#e5e7eb]">
              <td className="py-2 pr-4">Nonce binding</td>
              <td className="py-2"><code className="text-xs font-mono">commit.nonceB64 === slotAllocation.nonceB64</code></td>
            </tr>
            <tr className="border-b border-[#e5e7eb]">
              <td className="py-2 pr-4">Counter ordering</td>
              <td className="py-2"><code className="text-xs font-mono">commit.slotCounter &lt; commit.counter</code></td>
            </tr>
            <tr className="border-b border-[#e5e7eb]">
              <td className="py-2 pr-4">Hash binding</td>
              <td className="py-2"><code className="text-xs font-mono">commit.slotHashB64 === SHA-256(canonicalize(slotBody))</code></td>
            </tr>
            <tr>
              <td className="py-2 pr-4">Same enclave</td>
              <td className="py-2"><code className="text-xs font-mono">slotAllocation.publicKeyB64 === signer.publicKeyB64</code></td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-sm text-[#636a78] mb-8">
        The slot has its own Ed25519 signature proving the enclave created it. The commit signature includes <code className="text-xs font-mono">slotHashB64</code>, cryptographically binding the proof to that exact slot.
      </p>

      <h2 className="text-xl font-semibold mt-12 mb-4">Canonical serialization</h2>
      <p className="text-[#1f2937] mb-4">
        The signed body is serialized to bytes using a deterministic algorithm:
      </p>
      <ol className="space-y-2 mb-6 text-sm text-[#1f2937]">
        <li>1. Recursively sort all object keys in Unicode code-point order</li>
        <li>2. Serialize with <code className="text-xs font-mono bg-[#dbeafe] text-[#0065A4] px-1">JSON.stringify()</code> -- no whitespace</li>
        <li>3. Encode the resulting string as UTF-8 (no BOM)</li>
      </ol>
      <p className="text-[#1f2937] mb-4">Top-level key order after sort:</p>
      <div className="code-block mb-8">
        <pre className="text-[#1f2937]">
          actor? &rarr; artifact &rarr; attestationFormat? &rarr; attribution? &rarr; commit &rarr; enforcement &rarr; measurement &rarr; publicKeyB64 &rarr; version
        </pre>
      </div>

      <h2 className="text-xl font-semibold mt-12 mb-4">Field classification</h2>
      <h3 className="text-base font-semibold mt-6 mb-3">Signed (security-critical)</h3>
      <p className="text-sm text-[#1f2937] mb-2">
        These fields are in the SignedBody. Tampering invalidates the signature:
      </p>
      <div className="text-sm text-[#1f2937] mb-6">
        <code className="font-mono text-xs">version</code>, <code className="font-mono text-xs">artifact.*</code>, <code className="font-mono text-xs">agency.actor</code> (when present), <code className="font-mono text-xs">attribution.*</code> (when present), <code className="font-mono text-xs">commit.*</code>, <code className="font-mono text-xs">signer.publicKeyB64</code>, <code className="font-mono text-xs">environment.enforcement</code>, <code className="font-mono text-xs">environment.measurement</code>, <code className="font-mono text-xs">attestation.format</code>
      </div>

      <h3 className="text-base font-semibold mt-6 mb-3">Self-authenticating</h3>
      <p className="text-sm text-[#1f2937] mb-2">
        Not in the signed body, but independently verifiable:
      </p>
      <div className="text-sm text-[#1f2937] mb-6">
        <code className="font-mono text-xs">signatureB64</code> (Ed25519), <code className="font-mono text-xs">attestation.reportB64</code> (vendor-signed), <code className="font-mono text-xs">slotAllocation</code> (own Ed25519 signature), <code className="font-mono text-xs">agency.authorization</code> (P-256)
      </div>

      <h3 className="text-base font-semibold mt-6 mb-3">Advisory (unsigned)</h3>
      <p className="text-sm text-[#1f2937] mb-6">
        Not signed. Must not be used for security decisions: <code className="font-mono text-xs">timestamps</code>, <code className="font-mono text-xs">metadata</code>, <code className="font-mono text-xs">claims</code>.
      </p>

      <h2 className="text-xl font-semibold mt-12 mb-4">Algorithms</h2>
      <div className="overflow-x-auto mb-8">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#e5e7eb]">
              <th className="text-left py-2 pr-4 text-xs font-medium uppercase tracking-wider text-[#4b5563]">Purpose</th>
              <th className="text-left py-2 pr-4 text-xs font-medium uppercase tracking-wider text-[#4b5563]">Algorithm</th>
              <th className="text-left py-2 text-xs font-medium uppercase tracking-wider text-[#4b5563]">Details</th>
            </tr>
          </thead>
          <tbody className="text-[#1f2937]">
            <tr className="border-b border-[#e5e7eb]">
              <td className="py-2 pr-4">Proof signature</td>
              <td className="py-2 pr-4">Ed25519 (RFC 8032)</td>
              <td className="py-2">32-byte key, 64-byte signature</td>
            </tr>
            <tr className="border-b border-[#e5e7eb]">
              <td className="py-2 pr-4">Agency signature</td>
              <td className="py-2 pr-4">ECDSA P-256 / ES256</td>
              <td className="py-2">WebAuthn or direct; device-bound key</td>
            </tr>
            <tr className="border-b border-[#e5e7eb]">
              <td className="py-2 pr-4">Hash</td>
              <td className="py-2 pr-4">SHA-256 (FIPS 180-4)</td>
              <td className="py-2">32 bytes, Base64 encoded</td>
            </tr>
            <tr className="border-b border-[#e5e7eb]">
              <td className="py-2 pr-4">Encoding</td>
              <td className="py-2 pr-4">Base64 (RFC 4648 &sect;4)</td>
              <td className="py-2">Standard, with = padding</td>
            </tr>
            <tr>
              <td className="py-2 pr-4">Counter</td>
              <td className="py-2 pr-4">Decimal string</td>
              <td className="py-2">BigInt-safe, no leading zeros</td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>
  );
}
