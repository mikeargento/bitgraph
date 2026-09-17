import type { Metadata } from "next";
import Link from "next/link";
import { CopyCode } from "@/components/copy-code";
import { Code } from "@/components/code";

export const metadata: Metadata = {
  title: "Proof format",
  description:
    "Normative specification of the bitgraph/1 proof: the schema field by field, the signed body, the slot binding, the anchor floor, fused artifacts and their placements, and canonical serialization.",
};

/**
 * Derived from the reference implementation (packages/verify). The schema
 * block, the signed body, the binding checks, the placements and the
 * canonical rules are normative and are kept verbatim; the field table and
 * the prose around them are explanation.
 */
export default function ProofFormatPage() {
  return (
    <article className="prose">
      <h1>Proof format</h1>
      <p className="lede">
        The normative specification of the <code>bitgraph/1</code> proof, the JSON a holder keeps beside a file. For anyone writing a verifier, a reader or a producer that must interoperate with the reference implementation, from which this page is derived.
      </p>

      <h2 id="schema">The proof</h2>
      <p>
        A proof is one JSON object. The comments mark what is required; the table after the block says what each field is and whether it is signed, self-authenticating or advisory.
      </p>
      <div className="code-block">
        <div className="code-block-header"><span>proof.json</span><CopyCode /></div>
        <Code lang="jsonc">{`{
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
    "slotAnchor": {                  // OPTIONAL - the chain's latest Ethereum anchor when the slot was allocated (since enclave v7; v8 is current)
      "counter":     "17",           //   counter of that anchor proof on this chain
      "blockNumber": 25921179,
      "blockHash":   "0x<hex>"       //   32 bytes, lowercase
    },
    "anchor": {                      // OPTIONAL - on Ethereum anchor proofs only: the block this proof anchors (since enclave v7; v8 is current)
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
}`}</Code>
      </div>

      <h3>Field by field</h3>
      <div className="table-scroll">
        <table className="table-k">
          <thead><tr><th>Field</th><th>What it is</th><th>Class</th></tr></thead>
          <tbody>
            <tr><td>version</td><td>The schema, exactly <code>bitgraph/1</code>.</td><td>Signed</td></tr>
            <tr><td>artifact.hashAlg</td><td>The hash applied to the file&rsquo;s bytes; only <code>sha256</code> in v1.</td><td>Signed</td></tr>
            <tr><td>artifact.digestB64</td><td>The file&rsquo;s fingerprint (SHA-256 digest), 32 bytes, standard base64. Any change to the file changes it.</td><td>Signed</td></tr>
            <tr><td>commit.nonceB64</td><td>The slot&rsquo;s nonce: at least 16 decoded bytes, 32 from the enclave&rsquo;s hardware random number generator.</td><td>Signed</td></tr>
            <tr><td>commit.counter</td><td>The commit&rsquo;s position in the epoch&rsquo;s sequence, a decimal string compared as a big integer.</td><td>Signed</td></tr>
            <tr><td>commit.slotCounter</td><td>The consumed slot&rsquo;s position; always below <code>commit.counter</code>.</td><td>Signed</td></tr>
            <tr><td>commit.slotHashB64</td><td>SHA-256 of the canonical slot body: binds the commit to that exact slot record.</td><td>Signed</td></tr>
            <tr><td>commit.time</td><td>Unix milliseconds from the enclave&rsquo;s clock. Not a trusted clock; order comes from the counters.</td><td>Signed, advisory value</td></tr>
            <tr><td>commit.prevB64</td><td>SHA-256 of the previous proof on the sequence: the link that makes the order checkable.</td><td>Signed</td></tr>
            <tr><td>commit.epochId</td><td>The enclave lifetime that signed this proof, hex SHA-256. Changes at every restart.</td><td>Signed</td></tr>
            <tr><td>commit.slotAnchor</td><td>The floor: the chain&rsquo;s latest Ethereum anchor when the slot was allocated.</td><td>Signed</td></tr>
            <tr><td>commit.anchor</td><td>On anchor proofs only: the block this proof anchors.</td><td>Signed</td></tr>
            <tr><td>signer.publicKeyB64</td><td>The enclave&rsquo;s Ed25519 key, 32 bytes.</td><td>Signed</td></tr>
            <tr><td>signer.signatureB64</td><td>Ed25519 signature over the canonical signed body, 64 bytes.</td><td>Self-authenticating</td></tr>
            <tr><td>environment.enforcement</td><td>The tier the producer reports; <code>measured-tee</code> in production. Not evidence of the tier on its own.</td><td>Signed</td></tr>
            <tr><td>environment.measurement</td><td>The enclave image&rsquo;s PCR0. A verifier pins it with an allowlist.</td><td>Signed</td></tr>
            <tr><td>environment.attestation.format</td><td>The attestation document format, <code>aws-nitro</code>.</td><td>Signed</td></tr>
            <tr><td>environment.attestation.reportB64</td><td>The hardware attestation, whose user data is the hash of this proof&rsquo;s signed body.</td><td>Self-authenticating (vendor-signed)</td></tr>
            <tr><td>slotAllocation</td><td>The slot record, signed by the enclave before any digest was received; bound to the commit through <code>commit.slotHashB64</code>.</td><td>Self-authenticating</td></tr>
            <tr><td>agency</td><td>Legacy actor envelope on some older proofs; its actor summary is signed, its authorization carries its own signature.</td><td>Legacy</td></tr>
            <tr><td>attribution</td><td>A claim the submitter made (name, title, message), or the fused marker below.</td><td>Signed</td></tr>
            <tr><td>timestamps</td><td>Optional RFC 3161 tokens. Never evidence of position.</td><td>Advisory</td></tr>
            <tr><td>metadata</td><td>Caller-supplied. A set proof carries its committed artifact here, counted only when it hashes to the signed digest.</td><td>Advisory</td></tr>
            <tr><td>claims</td><td>Caller-supplied.</td><td>Advisory</td></tr>
          </tbody>
        </table>
      </div>

      <h2 id="signed-body">Signed body</h2>
      <p>
        The Ed25519 signature covers the canonical serialization of a <code>SignedBody</code> object:
      </p>
      <div className="code-block">
        <div className="code-block-header"><span>SignedBody</span><CopyCode /></div>
        <Code lang="typescript">{`{
  version:           proof.version,
  artifact:          proof.artifact,
  actor:             proof.agency?.actor,        // legacy; when present
  attribution:       proof.attribution,          // when present
  commit:            proof.commit,               // ALL fields verbatim
  publicKeyB64:      proof.signer.publicKeyB64,
  enforcement:       proof.environment.enforcement,
  measurement:       proof.environment.measurement,
  attestationFormat: proof.environment.attestation?.format  // when present
}`}</Code>
      </div>
      <p>
        Everything in that object is detectably invalid if altered. The attestation report carries a hash of the same body, so the hardware vouches for exactly the bytes the key signed.
      </p>

      <h3>What is not signed</h3>
      <div className="table-scroll">
        <table className="table-k">
          <thead><tr><th>Field</th><th>Reason</th></tr></thead>
          <tbody>
            <tr><td>signatureB64</td><td>The signature cannot cover itself</td></tr>
            <tr><td>attestation.reportB64</td><td>Vendor-signed, self-authenticating separately</td></tr>
            <tr><td>slotAllocation</td><td>Self-authenticating (own Ed25519 signature); bound via commit.slotHashB64</td></tr>
            <tr><td>metadata</td><td>Advisory, never trusted as a field. A set proof carries its committed artifact here: the member manifest for placement set/1, the Merkle root document for set/2; a reader re-canonicalizes it and counts it only if it hashes to the signed artifact.digestB64. A set/2 member&rsquo;s evidence (its row, leaf index and path) may ride under bitgraph-fuse/1/member</td></tr>
            <tr><td>claims</td><td>Advisory, not trusted</td></tr>
          </tbody>
        </table>
      </div>

      <h2 id="slot">The slot and its binding</h2>
      <p>
        Every proof is bound to a slot allocated before it. The slot record is created and signed before the file&rsquo;s digest reaches the enclave, so the enclave committed to a nonce and a counter without having received the file&rsquo;s digest. A verifier checks four bindings between the record and the commit:
      </p>
      <div className="table-scroll">
        <table className="table-k">
          <thead><tr><th>Binding</th><th>How</th></tr></thead>
          <tbody>
            <tr><td>Nonce binding</td><td><code>commit.nonceB64 === slotAllocation.nonceB64</code></td></tr>
            <tr><td>Counter ordering</td><td><code>commit.slotCounter &lt; commit.counter</code></td></tr>
            <tr><td>Hash binding</td><td><code>commit.slotHashB64 === SHA-256(canonicalize(slotBody))</code></td></tr>
            <tr><td>Same enclave</td><td><code>slotAllocation.publicKeyB64 === signer.publicKeyB64</code></td></tr>
          </tbody>
        </table>
      </div>
      <p className="note">
        The slot has its own Ed25519 signature, so the enclave created it. The commit signature includes <code>slotHashB64</code>, which binds the proof to that exact slot; a swapped slot record breaks the commit signature.
      </p>

      <h3>Anchor floor</h3>
      <p>
        Since enclave v7 (2026-09-06) the enclave writes the chain&rsquo;s latest Ethereum anchor into every slot it allocates, and signs it into the proof as <code>commit.slotAnchor</code>. The floor is signed into the slot record at allocation; whoever presents the proof cannot move it. A reader checks it offline from the Ethereum block header: the header&rsquo;s keccak must equal <code>slotAnchor.blockHash</code>, and the time in the block header is then a lower bound on the proof. Since enclave v8 (2026-09-07) the enclave refuses to sign a proof whose slot carries no anchor, so the field is absent only on proofs from older enclaves.
      </p>
      <p>
        Anchor proofs themselves carry <code>commit.anchor</code>, holding the block number and hash the enclave signed. The enclave writes it only after verifying the anchor service&rsquo;s Ed25519 signature over the claim against a public key baked into the enclave image, and refuses the attribution name <code>Ethereum Anchor</code> without it. So a v7 or v8 proof whose attribution says anchor but lacks <code>commit.anchor</code> is not an anchor.
      </p>
      <p>
        <code>commit.anchor</code> is what identifies an anchor, and where its block should be read from. The attribution name is the older test and remains valid for proofs written before v7, which carry nothing else; it is not a requirement, and an anchor is free to spend its signed attribution on something else, such as the fuse marker below.
      </p>

      <h2 id="fused">Fused artifacts</h2>
      <p>
        A fused artifact is a file that carries a commitment to its slot record, written into the bytes before the file was finished. The proof is an ordinary <code>bitgraph/1</code> proof: <code>slotAllocation</code> is the slot the producer held, <code>commit.slotCounter</code> its counter, <code>commit.counter</code> the commit position, and <code>artifact.digestB64</code> the digest of the fused bytes. The signed <code>attribution</code> is the marker:
      </p>
      <div className="code-block">
        <div className="code-block-header"><span>attribution (fused)</span><CopyCode /></div>
        <Code lang="jsonc">{`{
  "name":    "bitgraph-fuse/1",      // fixed value; marks a fused proof
  "title":   "trailer/1",            // placement id, or the encoding id base64url
  "message": "<base64>"              // origin digest, SHA-256, standard base64
}`}</Code>
      </div>
      <p>
        The commitment is derived from the signed slot record. The raw nonce never enters the artifact:
      </p>
      <div className="code-block">
        <div className="code-block-header"><span>commitment</span><CopyCode /></div>
        <Code lang="typescript">{`slotRecordHash = SHA-256(canonicalize(slotBody))                            // = commit.slotHashB64
commitment     = SHA-256("bitgraph-fuse/1" || 0x00 || slotRecordHash || nonce)  // nonce: 32 raw bytes`}</Code>
      </div>
      <p>
        Two or more files made together are one set under one slot: the committed artifact is the set root, and each file is a member with its own row. Registered placements say, byte for byte, where the commitment sits:
      </p>
      <div className="table-scroll">
        <table className="table-k">
          <thead><tr><th>Placement</th><th>Bytes</th><th>Used for</th></tr></thead>
          <tbody>
            <tr><td>trailer/1</td><td>the original bytes, then the 8-byte magic <code>BGFUSE01</code>, 8 zero bytes, the 32-byte commitment</td><td>formats whose decoders ignore trailing bytes: JPEG, PNG, GIF, TIFF and TIFF-based raws, BMP, RIFF such as WebP</td></tr>
            <tr><td>container/1</td><td>an uncompressed ustar archive: <code>bitgraph-fuse/manifest.json</code>, then <code>bitgraph-fuse/original</code></td><td>older artifacts; readable, no longer made</td></tr>
            <tr><td>container/2</td><td>the same archive with <code>bitgraph-fuse/original</code> first, then <code>bitgraph-fuse/manifest.json</code>, so the file is hashed once and the digest finished later</td><td>everything else</td></tr>
            <tr><td>produced/1</td><td>a canonical JSON payload naming the commitment and an optional origin digest</td><td>artifacts produced without a source file; SDK and CLI only</td></tr>
            <tr><td>set/1</td><td>a canonical JSON manifest listing every member&rsquo;s fused digest, origin digest and placement; the manifest is the committed artifact</td><td>older sets; readable, no longer made</td></tr>
            <tr><td>set/2</td><td>a Merkle root document over the member rows; each member keeps its row, leaf index and inclusion path</td><td>two or more files made together: one slot, one position, each file a member</td></tr>
          </tbody>
        </table>
      </div>
      <p>
        The fused bytes are transient. The original plus the proof rebuilds them byte for byte with the declared placement, and verifying that reconstruction against the signed artifact digest is the evidence. A Frame file, <code>&lt;name&gt;.bitgraph-fuse.json</code>, carries the proof with an advisory manifest: <code className="break">{`{ type: "bitgraph-fuse/1", manifest: { placement, origin, artifact, fusedFile }, proof }`}</code>.
      </p>
      <p className="note">
        What this bound reaches: the fused bytes could not have been finished before the slot was allocated. What it does not reach: the original, which can be any age; the proof says only that it existed no later than the commit.
      </p>

      <h2 id="canonical">Canonical serialization</h2>
      <p>The signed body is serialized to bytes using a deterministic algorithm:</p>
      <ol className="steps">
        <li>Recursively sort all object keys in Unicode code-point order</li>
        <li>Serialize with <code>JSON.stringify()</code>, no whitespace</li>
        <li>Encode the resulting string as UTF-8 (no BOM)</li>
      </ol>
      <p>Top-level key order after sort:</p>
      <div className="code-block">
        <div className="code-block-header"><span>key order</span><CopyCode /></div>
        <Code lang="text">{`actor? → artifact → attestationFormat? → attribution? → commit → enforcement → measurement → publicKeyB64 → version`}</Code>
      </div>

      <h2 id="classes">Field classification</h2>
      <h3>Signed (security-critical)</h3>
      <p>These fields are in the SignedBody. Tampering invalidates the signature:</p>
      <p>
        <code>version</code>, <code>artifact.*</code>, <code>attribution.*</code> (when present), <code>commit.*</code>, <code>signer.publicKeyB64</code>, <code>environment.enforcement</code>, <code>environment.measurement</code>, <code>attestation.format</code>
      </p>
      <h3>Self-authenticating</h3>
      <p>Not in the signed body, but independently verifiable:</p>
      <p>
        <code>signatureB64</code> (Ed25519), <code>attestation.reportB64</code> (vendor-signed), <code>slotAllocation</code> (own Ed25519 signature)
      </p>
      <h3>Advisory (unsigned)</h3>
      <p>
        Not signed. Must not be used for security decisions: <code>timestamps</code>, <code>metadata</code>, <code>claims</code>.
      </p>

      <h2 id="algorithms">Algorithms</h2>
      <div className="table-scroll">
        <table className="table-k">
          <thead><tr><th>Purpose</th><th>Algorithm</th><th>Details</th></tr></thead>
          <tbody>
            <tr><td>Proof signature</td><td>Ed25519 (RFC 8032)</td><td>32-byte key, 64-byte signature</td></tr>
            <tr><td>Hash</td><td>SHA-256 (FIPS 180-4)</td><td>32 bytes, Base64 encoded</td></tr>
            <tr><td>Encoding</td><td>Base64 (RFC 4648 &sect;4)</td><td>Standard, with = padding</td></tr>
            <tr><td>Counter</td><td>Decimal string</td><td>BigInt-safe, no leading zeros</td></tr>
          </tbody>
        </table>
      </div>

      <h2 id="next">Where next</h2>
      <ul className="doors">
        <li><Link href="/docs/verification">Verification</Link><span>What a verifier checks, in order, and what each result means.</span></li>
        <li><Link href="/api-reference">API reference</Link><span>Every endpoint that produces or reads these proofs.</span></li>
        <li><Link href="/docs/integration">Integration guide</Link><span>Make a proof from the CLI, the SDK or two HTTP calls, and keep it.</span></li>
        <li><Link href="/docs/what-is-bitgraph">The protocol</Link><span>The same account in formal terms, with the invariants.</span></li>
      </ul>
    </article>
  );
}
