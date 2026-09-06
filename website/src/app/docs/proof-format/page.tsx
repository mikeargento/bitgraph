import type { Metadata } from "next";
import { CopyCode } from "@/components/copy-code";

export const metadata: Metadata = {
  // Colon, matching the h1 below. The parenthesised form was the last place
  // that spelling survived after the nav label shortened to "Proof Format"
  // (2026-08-09); the tab and the heading it opens should read alike.
  title: "Proof Format: bitgraph/1",
  description: "Wire format specification for the bitgraph/1 proof schema.",
};

export default function ProofFormatPage() {
  return (
    <article className="prose-doc">
      <h1 className="mb-6">Proof Format: bitgraph/1</h1>
      <p className="text-[#1f2937] mb-10">
        Normative specification for the <code className="text-xs font-mono bg-[#dbeafe] text-[#0065A4] px-1.5 py-0.5">bitgraph/1</code> proof format. Derived from the reference implementation.
      </p>

      <h2 className="text-xl font-semibold mt-12 mb-4">Proof JSON schema</h2>
      <div className="code-block mb-8">
        <div className="code-block-header"><span>proof.json</span><CopyCode /></div>
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
    "epochId":  "<hex>",             // OPTIONAL - SHA-256 hex
    "slotAnchor": {                  // OPTIONAL - the chain's latest Ethereum anchor when the slot was allocated (enclave v7)
      "counter":     "17",           //   counter of that anchor proof on this chain
      "blockNumber": 25921179,
      "blockHash":   "0x<hex>"       //   32 bytes, lowercase
    },
    "anchor": {                      // OPTIONAL - on Ethereum anchor proofs only: the block this proof anchors (enclave v7)
      "blockNumber": 25921180,
      "blockHash":   "0x<hex>"
    }
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
  "agency": { ... },                 // OPTIONAL - legacy; present on some older proofs
  "attribution": {                   // OPTIONAL - signed; creator metadata, or the fused marker (below)
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
        <div className="code-block-header"><span>SignedBody</span><CopyCode /></div>
        <pre className="text-[#1f2937]">{`{
  version:           proof.version,
  artifact:          proof.artifact,
  actor:             proof.agency?.actor,        // legacy; when present
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
              <td className="py-2">The signature cannot cover itself</td>
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
              <td className="py-2 pr-4"><code className="text-xs font-mono">metadata</code></td>
              <td className="py-2">Advisory, never trusted as a field. A set proof carries its committed artifact here: the member manifest for placement set/1, the Merkle root document for set/2; a reader re-canonicalizes it and counts it only if it hashes to the signed artifact.digestB64. A set/2 member's evidence (its row, leaf index and path) may ride under bitgraph-fuse/1/member</td>
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
        Every proof is causally bound to a pre-allocated slot. The slot is created <em>before</em> the artifact hash reaches the enclave, so the enclave committed to a nonce
          and counter without having seen the artifact.
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
      <p className="text-base text-[#4b5563] mb-8">
        The slot has its own Ed25519 signature proving the enclave created it. The commit signature includes <code className="text-xs font-mono">slotHashB64</code>, cryptographically binding the proof to that exact slot.
      </p>

      <h3 className="text-lg font-semibold mt-8 mb-3">Anchor floor</h3>
      <p className="text-[#1f2937] mb-4">
        Since enclave v7 (2026-09-06) the enclave writes the chain&apos;s latest Ethereum anchor into every slot it allocates, and signs it into the proof as <code className="text-xs font-mono">commit.slotAnchor</code>. The floor a proof stands on is chosen by the enclave at allocation, not by whoever presents the proof. A reader checks it offline from the Ethereum block header: the header&apos;s keccak must equal <code className="text-xs font-mono">slotAnchor.blockHash</code>, and the block&apos;s timestamp is then a lower bound on the proof. The field is absent when no anchor had landed on the chain yet in that epoch, and on proofs from older enclaves.
      </p>
      <p className="text-base text-[#4b5563] mb-8">
        Anchor proofs themselves carry <code className="text-xs font-mono">commit.anchor</code>. The enclave writes it only after verifying the anchor service&apos;s Ed25519 signature over the claim against a public key baked into the enclave image, and refuses the attribution name <code className="text-xs font-mono">Ethereum Anchor</code> without it. So a v7 proof whose attribution says anchor but lacks <code className="text-xs font-mono">commit.anchor</code> is not an anchor.
      </p>

      <h2 className="text-xl font-semibold mt-12 mb-4">Fused artifacts</h2>
      <p className="text-[#1f2937] mb-4">
        A fused artifact is a file that carries a commitment to its slot record, written into the bytes before the file was finished. The proof is an ordinary <code className="text-xs font-mono bg-[#dbeafe] text-[#0065A4] px-1.5 py-0.5">bitgraph/1</code> proof: <code className="text-xs font-mono">slotAllocation</code> is the slot the producer held, <code className="text-xs font-mono">commit.slotCounter</code> its counter, <code className="text-xs font-mono">commit.counter</code> the commit position, and <code className="text-xs font-mono">artifact.digestB64</code> the digest of the fused bytes. The signed <code className="text-xs font-mono">attribution</code> is the marker:
      </p>
      <div className="code-block mb-4">
        <div className="code-block-header"><span>attribution (fused)</span><CopyCode /></div>
        <pre className="text-[#1f2937]">{`{
  "name":    "bitgraph-fuse/1",      // fixed value; marks a fused proof
  "title":   "trailer/1",            // placement id
  "message": "<base64>"              // origin digest, SHA-256, standard base64
}`}</pre>
      </div>
      <p className="text-[#1f2937] mb-4">
        The commitment is derived from the signed slot record. The raw nonce never enters the artifact:
      </p>
      <div className="code-block mb-4">
        <pre className="text-[#1f2937]">{`slotRecordHash = SHA-256(canonicalize(slotBody))                            // = commit.slotHashB64
commitment     = SHA-256("bitgraph-fuse/1" || 0x00 || slotRecordHash || nonce)  // nonce: 32 raw bytes`}</pre>
      </div>
      <p className="text-[#1f2937] mb-4">Registered placements say, byte for byte, where the commitment sits:</p>
      <div className="overflow-x-auto mb-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#e5e7eb]">
              <th className="text-left py-2 pr-4 text-xs font-medium uppercase tracking-wider text-[#4b5563]">Placement</th>
              <th className="text-left py-2 pr-4 text-xs font-medium uppercase tracking-wider text-[#4b5563]">Bytes</th>
              <th className="text-left py-2 text-xs font-medium uppercase tracking-wider text-[#4b5563]">Used for</th>
            </tr>
          </thead>
          <tbody className="text-[#1f2937]">
            <tr className="border-b border-[#e5e7eb]">
              <td className="py-2 pr-4"><code className="text-xs font-mono">trailer/1</code></td>
              <td className="py-2 pr-4">the original bytes, then the 8-byte magic <code className="text-xs font-mono">BGFUSE01</code>, 8 zero bytes, the 32-byte commitment</td>
              <td className="py-2">formats whose decoders ignore trailing bytes: JPEG, PNG, GIF, TIFF and TIFF-based raws, BMP, RIFF such as WebP</td>
            </tr>
            <tr className="border-b border-[#e5e7eb]">
              <td className="py-2 pr-4"><code className="text-xs font-mono">container/1</code></td>
              <td className="py-2 pr-4">an uncompressed ustar archive: <code className="text-xs font-mono">bitgraph-fuse/manifest.json</code>, then <code className="text-xs font-mono">bitgraph-fuse/original</code></td>
              <td className="py-2">older artifacts; readable, no longer made</td>
            </tr>
            <tr className="border-b border-[#e5e7eb]">
              <td className="py-2 pr-4"><code className="text-xs font-mono">container/2</code></td>
              <td className="py-2 pr-4">the same archive with <code className="text-xs font-mono">bitgraph-fuse/original</code> first, then <code className="text-xs font-mono">bitgraph-fuse/manifest.json</code>, so the file is hashed once and the digest finished later</td>
              <td className="py-2">everything else</td>
            </tr>
            <tr>
              <td className="py-2 pr-4"><code className="text-xs font-mono">produced/1</code></td>
              <td className="py-2 pr-4">a canonical JSON payload naming the commitment and an optional origin digest</td>
              <td className="py-2">artifacts produced without a source file; SDK and CLI only</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-base text-[#4b5563] mb-8">
        The fused bytes are transient. The original plus the proof rebuilds them byte for byte with the declared placement, and verifying that reconstruction against the signed artifact digest is the evidence. A Frame file, <code className="text-xs font-mono">&lt;name&gt;.bitgraph-fuse.json</code>, carries the proof with an advisory manifest: <code className="text-xs font-mono">{`{ type: "bitgraph-fuse/1", manifest: { placement, origin, artifact, fusedFile }, proof }`}</code>.
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
      <p className="text-base text-[#1f2937] mb-2">
        These fields are in the SignedBody. Tampering invalidates the signature:
      </p>
      <div className="text-sm text-[#1f2937] mb-6">
        <code className="font-mono text-xs">version</code>, <code className="font-mono text-xs">artifact.*</code>, <code className="font-mono text-xs">attribution.*</code> (when present), <code className="font-mono text-xs">commit.*</code>, <code className="font-mono text-xs">signer.publicKeyB64</code>, <code className="font-mono text-xs">environment.enforcement</code>, <code className="font-mono text-xs">environment.measurement</code>, <code className="font-mono text-xs">attestation.format</code>
      </div>

      <h3 className="text-base font-semibold mt-6 mb-3">Self-authenticating</h3>
      <p className="text-base text-[#1f2937] mb-2">
        Not in the signed body, but independently verifiable:
      </p>
      <div className="text-sm text-[#1f2937] mb-6">
        <code className="font-mono text-xs">signatureB64</code> (Ed25519), <code className="font-mono text-xs">attestation.reportB64</code> (vendor-signed), <code className="font-mono text-xs">slotAllocation</code> (own Ed25519 signature)
      </div>

      <h3 className="text-base font-semibold mt-6 mb-3">Advisory (unsigned)</h3>
      <p className="text-base text-[#1f2937] mb-6">
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
