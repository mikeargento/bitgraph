import type { Metadata } from "next";
import Link from "next/link";
import { CopyCode } from "@/components/copy-code";
import { Code } from "@/components/code";

export const metadata: Metadata = {
  title: "Proof format",
  description:
    "The bitgraph/1 proof field by field: the signed body, the position binding, the Base floor (and the earlier Ethereum anchor floor), the tree/1 marker and its placements, the ceiling file, and canonical serialization. The normative text is SPEC.md.",
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
        The <code>bitgraph/1</code> proof, field by field, for anyone writing a verifier, a reader or a producer that must interoperate with the reference implementation. The normative text is <a href="/spec">SPEC.md</a> (rendered at <Link href="/spec">/spec</Link>); every tree/1 proof pins its SHA-256. What a holder keeps beside a file is not the bare proof but an export, <code>bitgraph-export/1</code>, which carries the proof with the file&rsquo;s leaf and the blocks that bound it, and SPEC.md itself.
      </p>

      <h2 id="schema">The proof</h2>
      <p>
        A proof is one JSON object. The comments mark what is required; the table after the block says what each field is and whether it is signed, self-authenticating or advisory.
      </p>
      <div className="code-block">
        <div className="code-block-header"><span>bitgraph/1</span><CopyCode /></div>
        <Code lang="jsonc">{`{
  "version": "bitgraph/1",                // REQUIRED - exact value
  "artifact": {
    "hashAlg": "sha256",             // REQUIRED - "sha256" only in v1
    "digestB64": "<base64>"          // REQUIRED - SHA-256, 32 decoded bytes
  },
  "commit": {
    "nonceB64": "<base64>",          // REQUIRED - >=16 decoded bytes
    "counter":  "42",                // OPTIONAL - decimal string, monotonic
    "slotCounter": "41",             // OPTIONAL - the reserved position's counter (< commit counter)
    "slotHashB64": "<base64>",       // OPTIONAL - SHA-256 of the canonical position record
    "time":     1700000000000,       // OPTIONAL - Unix ms
    "prevB64":  "<base64>",          // OPTIONAL - chain link, 32 bytes
    "epochId":  "<base64>",          // OPTIONAL - the epoch identifier, 32 bytes
    "chainId":  "bitgraph:main",     // OPTIONAL - the sequence this proof is on
    "slotFloor": {                   // OPTIONAL - the Base block bound into the position when it opened (since enclave v10, current)
      "chain":          "base",
      "evmChainId":     8453,         //   Base mainnet; the EVM chain id, not commit.chainId
      "blockNumber":    52271417,
      "blockHash":      "0x<hex>",    //   32 bytes, lowercase: keccak-256 of the header the enclave hashed
      "blockTimestamp": 1791332181    //   Unix seconds, read from the header
    },
    "slotAnchor": {                  // OPTIONAL - EARLIER floor (enclave v7 to v9): the chain's latest Ethereum anchor when the position was allocated; never beside slotFloor
      "counter":     "17",           //   counter of that anchor proof on this chain
      "blockNumber": 25921179,
      "blockHash":   "0x<hex>"       //   32 bytes, lowercase
    },
    "anchor": {                      // OPTIONAL - on earlier Ethereum anchor proofs only: the block this proof anchors (enclave v7 to v9)
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
  "slotAllocation": {                // OPTIONAL - the position record
    "version":      "bitgraph/slot/1",
    "nonceB64":     "<base64>",      // same as commit.nonceB64
    "counter":      "41",            // same as commit.slotCounter
    "epochId":      "<base64>",      // same as commit.epochId
    "publicKeyB64": "<base64>",      // enclave Ed25519 key
    "chainId":      "bitgraph:main", // OPTIONAL - same as commit.chainId
    "signatureB64": "<base64>"       // Ed25519 over the canonical position record (every field above except this one)
  },                                 // no floor and no time: the enclave allocates without a clock, and the floor is signed at commit as commit.slotFloor (commit.slotAnchor on earlier proofs)
  "agency": { ... },                 // OPTIONAL - legacy; present on some older proofs
  "attribution": {                   // OPTIONAL - signed; creator metadata, or the marker (below): for a tree/1 it names the spec the proof pins
    "name":    "string",
    "title":   "string",
    "message": "string"
  },
  "metadata": { },                   // OPTIONAL - NOT signed, advisory; a tree/1 carries its root document here as metadata["bitgraph-tree/1"], counted only when it hashes to the signed digest
  "claims": { },                     // OPTIONAL - NOT signed, advisory
  "proofHash": "<base64>"            // OPTIONAL - NOT signed; added by the ledger after signing (see commit.prevB64)
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
            <tr><td>commit.nonceB64</td><td>The position&rsquo;s nonce: at least 16 decoded bytes, 32 from the enclave&rsquo;s hardware random number generator.</td><td>Signed</td></tr>
            <tr><td>commit.counter</td><td>The commit&rsquo;s position in the epoch&rsquo;s sequence, a decimal string compared as a big integer.</td><td>Signed</td></tr>
            <tr><td>commit.slotCounter</td><td>The reserved position, consumed by this commit; always below <code>commit.counter</code>.</td><td>Signed</td></tr>
            <tr><td>commit.slotHashB64</td><td>SHA-256 of the canonical position record: binds the commit to that exact record.</td><td>Signed</td></tr>
            <tr><td>commit.time</td><td>Unix milliseconds from the enclave&rsquo;s clock. Not a trusted clock; order comes from the counters.</td><td>Signed, advisory value</td></tr>
            <tr><td>commit.prevB64</td><td>SHA-256 of the previous proof on the sequence, canonicalized whole, after removing the two top-level fields added outside the enclave after signing (<code>proofHash</code> and <code>ethereum</code>): the link that makes the order checkable.</td><td>Signed</td></tr>
            <tr><td>commit.epochId</td><td>The enclave lifetime that signed this proof, hex SHA-256. Changes at every restart.</td><td>Signed</td></tr>
            <tr><td>commit.slotFloor</td><td>The floor: the Base block the enclave bound into the position when it opened, from a header it hashed and checked itself.</td><td>Signed</td></tr>
            <tr><td>commit.slotAnchor</td><td>The earlier floor (enclave v7 to v9): the chain&rsquo;s latest Ethereum anchor when the position was allocated. A proof carries one floor, never both.</td><td>Signed</td></tr>
            <tr><td>commit.anchor</td><td>On earlier anchor proofs only: the Ethereum block this proof anchors.</td><td>Signed</td></tr>
            <tr><td>signer.publicKeyB64</td><td>The enclave&rsquo;s Ed25519 key, 32 bytes.</td><td>Signed</td></tr>
            <tr><td>signer.signatureB64</td><td>Ed25519 signature over the canonical signed body, 64 bytes.</td><td>Self-authenticating</td></tr>
            <tr><td>environment.enforcement</td><td>The tier the producer reports; <code>measured-tee</code> in production. Not evidence of the tier on its own.</td><td>Signed</td></tr>
            <tr><td>environment.measurement</td><td>The enclave image&rsquo;s PCR0. A verifier pins it with an allowlist.</td><td>Signed</td></tr>
            <tr><td>environment.attestation.format</td><td>The attestation document format, <code>aws-nitro</code>.</td><td>Signed</td></tr>
            <tr><td>environment.attestation.reportB64</td><td>The hardware attestation, whose user data is the hash of this proof&rsquo;s signed body.</td><td>Self-authenticating (vendor-signed)</td></tr>
            <tr><td>slotAllocation</td><td>The position record, signed by the enclave before any digest was received; bound to the commit through <code>commit.slotHashB64</code>.</td><td>Self-authenticating</td></tr>
            <tr><td>agency</td><td>Legacy actor envelope on some older proofs; its actor summary is signed, its authorization carries its own signature.</td><td>Legacy</td></tr>
            <tr><td>attribution</td><td>A claim the submitter made (name, title, message), or the signed marker below: for a tree/1, the commitment version, the word <code>tree/1</code>, and the SHA-256 of the SPEC.md the proof was made under.</td><td>Signed</td></tr>
            <tr><td>timestamps</td><td>Optional RFC 3161 tokens. Never evidence of position.</td><td>Advisory</td></tr>
            <tr><td>metadata</td><td>Caller-supplied. A tree/1 proof carries its committed artifact here, the 84-byte root document as <code>metadata[&quot;bitgraph-tree/1&quot;]</code> in hex, counted only when it hashes to the signed digest; earlier set proofs carried theirs the same way.</td><td>Advisory</td></tr>
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
  policy:            proof.policy,               // when present
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
      <p>
        <code>proofHash</code>, which the ledger adds after signing, is a different and narrower value: the SHA-256 of the canonical JSON of the signed body without <code>actor</code> and <code>policy</code> (that is, <code>version</code>, <code>artifact</code>, <code>commit</code>, <code>publicKeyB64</code>, <code>enforcement</code>, <code>measurement</code>, and <code>attribution</code> and <code>attestationFormat</code> when present), base64 encoded. It names the proof in the ledger and in a ceiling file. For a proof with no <code>actor</code> and no <code>policy</code>, which is every proof made today, it equals the hash of the full signed body and the attestation&rsquo;s <code>user_data</code>; for older proofs that carry either, it does not, so the signature and the attestation are always checked against the full body.
      </p>

      <h3>What is not signed</h3>
      <div className="table-scroll">
        <table className="table-k">
          <thead><tr><th>Field</th><th>Reason</th></tr></thead>
          <tbody>
            <tr><td>signatureB64</td><td>The signature cannot cover itself</td></tr>
            <tr><td>attestation.reportB64</td><td>Vendor-signed, self-authenticating separately</td></tr>
            <tr><td>slotAllocation</td><td>Self-authenticating (own Ed25519 signature); bound via commit.slotHashB64</td></tr>
            <tr><td>metadata</td><td>Advisory, never trusted as a field. A tree/1 proof carries its committed artifact here, the root document under <code>bitgraph-tree/1</code> in hex; a reader counts it only if it hashes to the signed artifact.digestB64. Earlier set proofs carried their manifest (set/1) or root document (set/2) the same way, and a set/2 member&rsquo;s evidence may ride under bitgraph-fuse/1/member. A tree member&rsquo;s own evidence, its leaf and path, never rides in the proof: it is in the export.</td></tr>
            <tr><td>claims</td><td>Advisory, not trusted</td></tr>
          </tbody>
        </table>
      </div>

      <h2 id="slot">The position and its binding</h2>
      <p>
        Every proof is bound to a position allocated before it. The position record is created and signed before the file&rsquo;s digest reaches the enclave, so the enclave committed to a nonce and a counter without having received the file&rsquo;s digest. A verifier checks four bindings between the record and the commit:
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
        The position record has its own Ed25519 signature, so the enclave created it. The commit signature includes <code>slotHashB64</code>, which binds the proof to that exact record; a swapped position record breaks the commit signature.
      </p>

      <h3>Base floor</h3>
      <p>
        Since enclave v10 the enclave binds a public floor into every position when it opens it. The host hands it the header of the newest Base block (Coinbase&rsquo;s Ethereum layer-2, a block every 2 seconds). The enclave hashes the header itself and checks it: the hash is the block hash; the block&rsquo;s time is Base mainnet&rsquo;s schedule for its number; the time is not after the enclave&rsquo;s own clock; and the number is not below the last floor fixed on the chain, so floors never go backwards. It keeps the block beside the position and signs its number, hash and time into the proof at commit as <code>commit.slotFloor</code>, naming the chain, so a verifier never reads it as an Ethereum floor. It refuses to open a position on <code>bitgraph:main</code> without one. The position record itself (<code>slotAllocation</code>) does not carry the floor; the <code>bitgraph-fuse/3</code> commitment derived from it does (below). Whoever presents the proof cannot move the floor, because it is inside the commit signature. The record was made after that block. Offline, a reader checks that the header hashes to <code>slotFloor.blockHash</code> and reads the time from it; that the block is Base&rsquo;s own is one lookup on Base, by block number, comparing the hash. Coinbase runs Base&rsquo;s sequencer.
      </p>

      <h3>Earlier: Ethereum anchor floor</h3>
      <p>
        Proofs made before the switch to the Base floor carry an Ethereum floor instead, and verify exactly as before. Since enclave v7 (2026-09-06) the enclave noted the chain&rsquo;s latest Ethereum anchor at the moment it allocated each position, kept it beside the position inside the enclave, and signed it into the proof at commit as <code>commit.slotAnchor</code>. The position record itself (<code>slotAllocation</code>) does not carry it, and neither does a <code>bitgraph-fuse/1</code> commitment derived from that record (a <code>bitgraph-fuse/2</code> commitment does, below). Whoever presents the proof cannot move the floor, because it is inside the commit signature. That it was the latest anchor when the position was allocated rests on the measured enclave, the same trust root as the counter: <code>slotAnchor.counter</code> is below <code>commit.slotCounter</code>, and the anchor proof at that counter carries the same block. The commit itself is placed after the block by hash alone, since its <code>prevB64</code> chain runs back through that anchor proof; bytes that carry the position commitment are placed after it through the enclave&rsquo;s counter. A reader checks the time offline from the Ethereum block header: the header&rsquo;s keccak must equal <code>slotAnchor.blockHash</code>, and the time in the block header is then a lower bound on the proof. From enclave v8 (2026-09-07) to v9 the enclave refused to sign a proof on the anchored chain without a floor, so on those proofs the field is absent only on unanchored chains.
      </p>
      <p>
        Anchor proofs themselves carry <code>commit.anchor</code>, holding the block number and hash the enclave signed. The enclave wrote it only after verifying the anchor service&rsquo;s Ed25519 signature over the claim against a public key baked into the enclave image, and refused the attribution name <code>Ethereum Anchor</code> without it. So a v7 or v8 proof whose attribution says anchor but lacks <code>commit.anchor</code> is not an anchor.
      </p>
      <p>
        <code>commit.anchor</code> is what identifies an anchor, and where its block should be read from. The attribution name is the older test and remains valid for proofs written before v7, which carry nothing else; it is not a requirement, and an anchor is free to spend its signed attribution on something else, such as the fuse marker below.
      </p>

      <h2 id="fused">Fused artifacts</h2>
      <p>
        A fused artifact is a file that carries its position commitment, written into the bytes before the file was finished. The proof is an ordinary <code>bitgraph/1</code> proof: <code>slotAllocation</code> is the position record the producer held, <code>commit.slotCounter</code> its counter, <code>commit.counter</code> the commit position, and <code>artifact.digestB64</code> the digest of the fused bytes. The signed <code>attribution</code> is the marker:
      </p>
      <div className="code-block">
        <div className="code-block-header"><span>attribution (fused)</span><CopyCode /></div>
        <Code lang="jsonc">{`{
  "name":    "bitgraph-fuse/3",      // the commitment version: bitgraph-fuse/3 now; bitgraph-fuse/1 or bitgraph-fuse/2 on earlier proofs
  "title":   "tree/1",               // "tree/1" for every BitGraph made now; a placement id or encoding id on earlier single-file proofs
  "message": "<base64>"              // tree/1: SHA-256 of SPEC.md, standard base64, the spec this proof pins; earlier proofs: the origin digest
}`}</Code>
      </div>
      <p>
        The position commitment is derived from the signed position record. The raw nonce never enters the artifact. The allocation also returns the floor the enclave will sign at commit, and the producer binds that block&rsquo;s hash into the commitment. Since enclave v10 the floor is a Base block and the commitment is marked <code>bitgraph-fuse/3</code>; from 2026-09-30 (enclave v9) until then it was an Ethereum anchor, marked <code>bitgraph-fuse/2</code>:
      </p>
      <div className="code-block">
        <div className="code-block-header"><span>commitment</span><CopyCode /></div>
        <Code lang="typescript">{`slotRecordHash = SHA-256(canonicalize(slotBody))                                              // = commit.slotHashB64
commitment/1   = SHA-256("bitgraph-fuse/1" || 0x00 || slotRecordHash || nonce)                    // nonce: 32 raw bytes
commitment/2   = SHA-256("bitgraph-fuse/2" || 0x00 || slotRecordHash || nonce || floorBlockHash)   // earlier: the 32 raw bytes of commit.slotAnchor.blockHash
commitment/3   = SHA-256("bitgraph-fuse/3" || 0x00 || slotRecordHash || nonce || floorBlockHash)   // the 32 raw bytes of commit.slotFloor.blockHash (a Base block)`}</Code>
      </div>
      <p>
        A verifier chooses the formula by the signed marker name and recomputes commitment/3 from the proof&rsquo;s own signed <code>commit.slotFloor.blockHash</code> (commitment/2 from <code>commit.slotAnchor.blockHash</code>), so a producer can neither tighten nor loosen the floor. A proof carrying both floors is ambiguous and binds nothing. What /2 and /3 add: a block&rsquo;s hash exists only once the block does, so bytes carrying the commitment were finished after that block by the hash alone; with /1, that step rested on the enclave&rsquo;s counter order (the anchor before the position). Placements, payloads and set documents are unchanged between the versions; a set&rsquo;s documents keep the <code>bitgraph-fuse/1</code> type and metadata key, and the commitment version is the signed attribution name. A verifier that knows only /1 sees a /2 or /3 proof as an ordinary valid proof and says nothing about the file. tree/1 under SPEC.md version 2 uses /3; under version 1, /2.
      </p>
      <p>
        Every BitGraph made now is a <strong>tree/1</strong>, whether it holds one file or a hundred thousand: one position, each file a leaf. A leaf is the hash of the file&rsquo;s committed bytes with its placement code (<code>0x00</code> kept as is, <code>0x01</code> trailer/1, <code>0x02</code> container/1, <code>0x03</code> container/2), the leaves form an RFC 9162 tree, and the committed artifact is an 84-byte root document naming the root and the count; <code>artifact.digestB64</code> is its hash. The proof alone commits the root. A file proves it is in the tree with its export, which carries its leaf and path (SPEC.md <a href="/spec">sections 8 and 12</a>). A verifier that does not know the pinned spec hash answers &ldquo;undetermined&rdquo;, never true. Before tree/1, two or more files were a set under one position (set/1, set/2 below); those positions still verify. Registered placements say, byte for byte, where a file&rsquo;s commitment sits:
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
            <tr><td>set/2</td><td>a Merkle root document over the member rows; each member keeps its row, leaf index and inclusion path</td><td>older sets of two or more files; readable, no longer made</td></tr>
            <tr><td>tree/1</td><td>an 84-byte root document over the leaves; each file&rsquo;s leaf and path travel in its export, never in the proof</td><td>every BitGraph made now, one file or many</td></tr>
          </tbody>
        </table>
      </div>
      <p>
        The fused bytes are transient. The original plus the proof rebuilds them byte for byte with the declared placement, and verifying that reconstruction against the leaf, and the leaf against the signed root, is the evidence. What travels with the file is its export, <code>bitgraph-export/1</code>: the proof, the file&rsquo;s leaf and path (the owner&rsquo;s export holds every leaf and name), the floor block&rsquo;s header, and the Base ceiling and its Ethereum settlement once they exist. An export holds no copy of the file and no anchor proofs (earlier proofs&rsquo; anchors are read from their headers); SPEC.md travels beside it. Earlier single-file proofs travelled as a Frame file, <code>&lt;name&gt;.bitgraph-fuse.json</code>, with an advisory manifest; those still verify.
      </p>
      <p className="note">
        What this bound reaches: the fused bytes could not have been finished before the position was allocated. What it does not reach: the original, which can be any age; the proof says only that it existed no later than the commit.
      </p>

      <h2 id="ceiling">Ceiling file</h2>
      <p>
        A ceiling in time is carried beside the proof, in its own file (<code>bitgraph-ceiling/1</code>), never inside it. Seconds after a commit, a writer process on BitGraph&rsquo;s host puts a Merkle root over the new records&rsquo; <code>proofHash</code> values into one Base transaction. The file lets anyone check, offline, that one record is under that root and that the transaction is in a particular Base block, whose time the record existed by.
      </p>
      <div className="code-block">
        <div className="code-block-header"><span>ceiling.json</span><CopyCode /></div>
        <Code lang="jsonc">{`{
  "version":    "bitgraph-ceiling/1",
  "proofHash":  "<base64>",          // the record's proofHash (above)
  "leafIndex":  0,                   // this record's place in the batch
  "leafCount":  1,                   // the batch size
  "merklePath": ["0x<hex>", ...],    // sibling hashes, leaf level up
  "root":       "0x<hex>",           // the batch root
  "anchor": {                        // null until the transaction is included
    "chainId":          8453,        // Base mainnet
    "writer":           "0x<address>",
    "txHash":           "0x<hex>",
    "rawTx":            "0x<hex>",   // the signed EIP-1559 transaction
    "payload":          "0x<hex>",   // its data, 84 bytes (below)
    "blockNumber":      51979918,
    "blockHash":        "0x<hex>",
    "blockTimestamp":   1790749183,
    "blockHeader":      "0x<hex>",   // RLP; hashes to blockHash
    "txIndex":          39,
    "txInclusionProof": ["0x<hex>", ...]  // Merkle-Patricia proof into the header's transactionsRoot
  },
  "status":         "safe",          // pending | included | safe | finalized: reported, not proven (below)
  "statusObserved": { ... },         // when BitGraph's Base node reported each status
  "floor": {                         // the proof's signed floor block, with its header: commit.slotFloor (Base),
                                     //   or commit.slotAnchor (Ethereum) on earlier proofs, as in this example
    "blockNumber": 26088457, "blockHash": "0x<hex>", "blockTimestamp": 1790749163, "blockHeader": "0x<hex>"
  },
  "settlement": null                 // filled in later, when Ethereum carries the block (below)
}`}</Code>
      </div>
      <p>
        <strong>The payload</strong> is the transaction&rsquo;s data, 84 bytes: the ASCII magic <code>BGC1</code> (4 bytes); the Merkle root (32); <code>prev</code>, the SHA-256 of the writer&rsquo;s previous payload, all zeros for the first (32); then the first and the last position in the batch, each an unsigned 64-bit big-endian integer (8 and 8). The root is the binding. The positions are an index for people: they carry no epoch, and a verifier does not check them. <code>prev</code> chains the writes, so a write missing from a copy of the list shows as a break.
      </p>
      <p>
        <strong>The tree</strong> hashes as RFC 9162 does: a leaf is SHA-256 of the byte <code>0x00</code> followed by the 32 raw bytes of the record&rsquo;s <code>proofHash</code>, and an inner node is SHA-256 of <code>0x01</code>, the left child and the right child. Because <code>proofHash</code> leaves out <code>actor</code> and <code>policy</code>, a verifier also checks the proof&rsquo;s own signature, which covers them.
      </p>
      <p>
        <strong>A verifier checks, offline:</strong> the proof&rsquo;s signature; that the record&rsquo;s leaf and path reach the root; that the payload carries that root; that the raw transaction is signed by the writer the verifier names, sent to that same address, on the expected chain, carrying the payload, and hashes to <code>txHash</code>; that the header hashes to <code>blockHash</code> and the transaction is in it; and that the floor header hashes to the proof&rsquo;s signed floor block (<code>commit.slotFloor</code>, or <code>commit.slotAnchor</code> on earlier proofs). The block time is read from the header, never from the file&rsquo;s own field. Offline, that shows the header is the one with that hash; that it is Base&rsquo;s own block is one lookup on any Base node or explorer, at any time.
      </p>
      <p>
        <strong>What the file does not prove.</strong> <code>status</code> is what BitGraph&rsquo;s Base node reported when the file was written: included by Base&rsquo;s sequencer, <code>safe</code> once Base had posted the block&rsquo;s data to Ethereum, <code>finalized</code> once that Ethereum block was final. Ask any Base node for its safe or finalized block to check it yourself.
      </p>
      <p>
        <strong>Settlement</strong> is the proof of that step: Ethereum&rsquo;s own record of the Base block, filled in once it exists. The current form, <code>bitgraph-output-root/1</code>, is Base&rsquo;s output root: Base posts to Ethereum, about once an hour, a root over its state that covers a run of blocks, and the settlement carries that root&rsquo;s claim on Ethereum (the dispute game that proposed it, with the Ethereum block and transaction), together with the proof from Base&rsquo;s block header to the root. Offline, a verifier recomputes the output root from the Base header it already holds and matches it to the claim. That shows the Base block existed by that Ethereum block, whatever happens to the block&rsquo;s bytes later; a tree/1 export carries exactly this. The earlier form, <code>bitgraph-settlement/1</code>, pointed at the Ethereum block that committed the Base batch data, its raw header, the batcher&rsquo;s blob transaction with its inclusion proof, and the KZG commitments of the blobs. Ethereum prunes blob bytes after about 18 days, so the older proof packages kept them beside the ceiling file and <code>bitgraph-audit</code> checks each blob against its commitment, decodes the batch and locates the ceiling transaction inside it; exports carry no blob bytes. What neither form proves: that Base&rsquo;s derivation accepted the batch, and that the Ethereum header is canonical, which is one lookup on any node, said and never implied.
      </p>
      <p>
        <strong>The floor it names</strong> is always the proof&rsquo;s signed floor block: <code>commit.slotFloor</code>, or <code>commit.slotAnchor</code> on earlier proofs. A record whose own bytes quote a later block, as the earlier demonstration file on the home page quotes the anchor recorded right after its position opened, has a tighter floor of its own, which a reader checks from that quote.
      </p>
      <p>
        <strong>The writer.</strong> The key is an ordinary Ethereum key generated on BitGraph&rsquo;s host and held by the operator, outside the enclave. Holding it lets the operator make a ceiling late, or skip one, but never make one early: a <code>proofHash</code> does not exist before its commit. The batch&rsquo;s position range is the operator&rsquo;s statement; the root is not. The writer address sends nothing but ceiling writes, each a zero-value transaction to itself carrying one payload, and account nonces have no gaps, so reading its transactions from nonce 0 lists every ceiling ever written. That is an operating rule, not something the chain enforces: the chain shows whether it has held.
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
        <li><Link href="/spec">SPEC.md</Link><span>The normative text, rendered, with the hash every tree/1 proof pins. The bytes are at <a href="/spec">/spec/SPEC.md</a>.</span></li>
        <li><Link href="/docs/verification">Verification</Link><span>What a verifier checks, in order, and what each result means.</span></li>
        <li><Link href="/api-reference">API reference</Link><span>Every endpoint that produces or reads these proofs.</span></li>
        <li><Link href="/docs/integration">Integration guide</Link><span>Make a proof from the CLI, the SDK or two HTTP calls, and keep it.</span></li>
        <li><Link href="/docs/what-is-bitgraph">The protocol</Link><span>The same account in formal terms, with the invariants.</span></li>
      </ul>
    </article>
  );
}
