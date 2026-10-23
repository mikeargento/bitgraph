# BitGraph Specification, version 2

Status: version 2. It adds the Base floor (enclave v10, 2026-10-06): the floor block is a Base block the enclave fixes when a position opens and signs as `commit.slotFloor`, bound into commitments by `bitgraph-fuse/3`. Version 1 (`spec/SPEC.md`, frozen 2026-10-04) defines the Ethereum floor and stays in force for every proof that pins it. The SHA-256 of this exact file is pinned, in base64, in the signed `attribution.message` of every tree/1 proof made under it (section 8.4); once frozen it is recorded in `spec/FROZEN.json` and never changes. Any edit is a new spec version with a new hash, added beside this one; verifiers keep every hash they have ever accepted.

This document says how to check a BitGraph from bytes alone: the proof, the file it is about, and public block data. Nothing in it requires a service, a server or a software package of BitGraph's. A second implementation written from this text, in another language, is in `spec/tools/check.py`; it reproduces every vector in `spec/vectors/` and a production proof end to end.

The key words MUST, MUST NOT, SHOULD and MAY are used as in RFC 2119.

---

## 0. Notation and encodings

- `||` is byte concatenation. `0x00` is one zero byte. `u32be(n)` is n as 4 bytes big-endian; `u64be(n)` as 8 bytes.
- **SHA-256** is FIPS 180-4. **Keccak-256** is the original Keccak with padding byte `0x01` (Ethereum's hash), not SHA3-256. `keccak256("")` = `c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470`.
- **hex** means lowercase hexadecimal. EVM values (block hashes, addresses, transactions) are written `0x` + hex.
- **B64** means RFC 4648 section 4 base64, standard alphabet, with `=` padding, in canonical form: decoding then re-encoding MUST reproduce the input exactly. That rejects the URL-safe alphabet, missing padding, whitespace and non-zero pad bits. **B64URL** means the URL-safe alphabet without padding (used only where stated).
- **DEC** means a decimal integer written as a string, for counters.
- A **digest field** in JSON is exactly `{"algorithm":"sha256","digest":"<64 hex>"}`: two keys, lowercase hex.
- Times are Unix seconds unless stated. Block times are read from block headers, never from any other field.

---

## 1. What a BitGraph claims

A BitGraph is a signed record that gives some bytes a **position** in a sequence kept by a measured AWS Nitro enclave. Before the bytes are finished, the enclave hands out a position (a "slot") with a secret nonce and fixes the newest Base block it has been given (the **floor block**), from a header it hashes itself. The bytes are then made to carry a **commitment** that depends on that position and that block, and the enclave signs the commit. (Proofs made under version 1 of this document carry an Ethereum floor instead; section 14.)

Three time claims, never merged:

| Claim | Statement | Rests on |
|---|---|---|
| Record floor | The record was made after Base block N. | The enclave fixed N when the position opened and signed the root document after it, and the root document carries the commitment to N; so every leaf, as-is leaves included, inherits it. Rests on the signature and the attestation, plus N being a real Base block. |
| Content floor | These committed bytes were finished after Base block N. | The commitment is inside the bytes. Placed leaves only (codes 0x01 to 0x03): an as-is leaf has none, and no leaf construction can give it one. Rests on hashes alone, plus N. |
| Base ceiling | The record existed by Base block B, at B's timestamp. | A Base transaction carrying a Merkle root over the record, plus B being a real Base block. Until B is checked against Base, its time is provisional, and a stamp earlier than the floor block or the attestation document is never used as a bound (section 10.4). |
| Ethereum ceiling | The record existed by Ethereum block H. | Base's output root on Ethereum committing to B, plus H being a real Ethereum block. Base's honesty is not needed. |

What a BitGraph does not claim: when content was first created, who made it, who owns it, or whether what it shows is true. The floor dates the recording of the committed bytes, not the content inside them: a file fused years after it was made has a floor on the day it was fused, and only bytes fused at the moment of their creation have a floor equal to it. For an as-is leaf the floor dates the record alone: recorded after block N; the bytes themselves are not dated.

A reader makes these trust decisions, and no others:

1. **Chain canonicality.** Whether a given block hash is part of the chain the network agreed on. A block header is self-consistent bytes, and anyone can build a self-consistent fake chain offline, so this is a fact about the network that no file can carry. It is checked once, against whatever node or consensus source the reader chooses; that source is part of the reader's trust model. A lookup that says a block is not the chain's own refutes every time read from that block: the verdict is false (section 12.1).
2. **The AWS Nitro root.** The certificate chain in each attestation ends at the AWS Nitro Enclaves Root CA G1 (section 5.5).
3. **Which image is BitGraph's, and what it measures.** An attestation says which enclave image signed, but only that some AWS Nitro enclave signed: anyone can run one. Which images count as BitGraph's is a measurement policy, by default the published images of section 16; a proof from any other image is not a BitGraph (section 5.6). Knowing what an image does requires its source, built reproducibly to the same PCR0.

---

## 2. Canonical JSON

Signed and hashed JSON is serialized by one algorithm. It MUST be reproduced exactly, including the behaviours below that differ from RFC 8785; it is not RFC 8785.

```
canonicalize(v) = UTF-8( S(v) ), no byte-order mark, no trailing newline
S(null) = "null"; S(true) = "true"; S(false) = "false"
S(number) = the ECMAScript Number::toString of the value (rules below)
S(string) = the ECMAScript JSON.stringify of the string (rules below)
S(array)  = "[" + S(e0) + "," + S(e1) ... + "]"          order kept, no whitespace
S(object) = "{" + K(k0) + ":" + S(v0) + "," ... + "}"    keys ordered as below, no whitespace
```

**Object key order.** Keys whose value is undefined are dropped (they never occur in parsed JSON). The remaining keys are emitted in two groups:

1. **Array-index keys** first, in ascending numeric order. A key is an array index exactly when it equals the decimal string of an integer n with 0 <= n <= 4294967294 and no leading zeros (`"0"`, `"2"`, `"10"`; not `"01"`, `"-1"`, `"1.5"`, `"4294967295"`).
2. **All other keys**, sorted by their UTF-16 code units (not by Unicode code points). For example, U+1F600 (surrogates `D83D DE00`) sorts before U+FFFD.

So `{"10":0,"2":0,"b":0,"a":0}` serializes as `{"2":0,"10":0,"a":0,"b":0}`.

**Strings.** `"` becomes `\"`, `\` becomes `\\`; U+0008, U+0009, U+000A, U+000C, U+000D become `\b`, `\t`, `\n`, `\f`, `\r`; every other code point below U+0020 becomes `\u00xx` with lowercase hex; an unpaired surrogate becomes `\udxxx` (lowercase). Everything else is written as itself in UTF-8, including `/`, U+007F, U+2028 and U+2029. No Unicode normalization.

**Numbers.** The shortest decimal that round-trips to the same IEEE 754 double, written as ECMAScript does: integers below 10^21 without exponent (`1.0` is `1`, `-0` is `0`); exponent form `1e+21`, `1e-7` (no leading zeros in the exponent) for exponents >= 21 or < -6; NaN and infinities become `null`. Every number in a BitGraph proof is a non-negative integer below 2^53.

**Vectors.** `{"s":"q\"b\\n\nl" + U+2028 + "c" + U+0007 + "e" + U+00E9 + "}"` canonicalizes to the bytes `7b2273223a22715c22625c5c6e5c6e6ce280a8635c753030303765c3a9227d`.

**Where these rules matter.** All keys in BitGraph's own documents are ASCII and non-numeric, so for them the result equals sorted-key JSON. Fields a caller may fill freely (`policy`, `agency.actor`, unsigned `metadata`) can contain anything, and the rules above decide their bytes.

---

## 3. The signed proof, `bitgraph/1`

### 3.1 Structure

| Field | Required | Content |
|---|---|---|
| `version` | yes | exactly `"bitgraph/1"` |
| `artifact.hashAlg` | yes | exactly `"sha256"` |
| `artifact.digestB64` | yes | B64 of the 32-byte SHA-256 of the committed artifact |
| `commit.nonceB64` | yes | B64 of the slot nonce (32 bytes) |
| `commit.counter` | in production | DEC, this commit's position |
| `commit.slotCounter` | with a slot | DEC, the slot's position |
| `commit.slotHashB64` | with a slot | B64 of slotRecordHash (section 4) |
| `commit.epochId` | in production | B64, the enclave's lifetime identifier |
| `commit.chainId` | when not `"global"` | the chain name, `"bitgraph:main"` for user records |
| `commit.prevB64` | except first of chain | B64 SHA-256 of the previous proof on the same chain and epoch (section 3.7) |
| `commit.slotFloor` | in production (enclave v10) | the floor block: `{chain: "base", evmChainId: 8453, blockNumber: integer, blockHash: "0x"+64 hex, blockTimestamp: integer}` (section 9) |
| `commit.slotAnchor` | earlier proofs | the Ethereum floor of version 1: `{counter: DEC, blockNumber: integer, blockHash: "0x"+64 hex}` (section 14). A proof carries `slotFloor` or `slotAnchor`, never both. |
| `commit.anchor` | anchor proofs only | `{blockNumber, blockHash}` (section 14) |
| `signer.publicKeyB64` | yes | B64 of the raw 32-byte Ed25519 public key |
| `signer.signatureB64` | yes | B64 of the 64-byte Ed25519 signature |
| `environment.enforcement` | yes | `"stub"`, `"hw-key"` or `"measured-tee"` (production: `"measured-tee"`) |
| `environment.measurement` | yes | production: hex of PCR0 (96 characters) |
| `environment.attestation` | in production | `{format: "aws-nitro", reportB64: B64 of the COSE_Sign1 document}` |
| `slotAllocation` | in production | the position record (section 4) |
| `attribution` | optional | `{name?, title?, message?}`: signed markers (sections 6, 8) |
| `agency`, `policy` | optional | signed actor binding and policy reference (section 15.6) |
| `metadata` | optional | unsigned; any content |
| `proofHash`, `ethereum` | added by the ledger | unsigned convenience fields |

Every other field is ignored by verification.

### 3.2 The signed body

```
S = { "version":      P.version,
      "artifact":     P.artifact,                      (the whole object)
      "commit":       P.commit,                        (the whole object)
      "publicKeyB64": P.signer.publicKeyB64,
      "enforcement":  P.environment.enforcement,
      "measurement":  P.environment.measurement }
if P.environment.attestation is present: S.attestationFormat = P.environment.attestation.format
if P.agency is present:                  S.actor = P.agency.actor
if P.policy is present:                  S.policy = P.policy
if P.attribution is present:             S.attribution = P.attribution
M = canonicalize(S)
```

"Present" means the key exists; a JSON `null` value is present and is signed as `null`.

### 3.3 The signature

The signature MUST verify as Ed25519 (RFC 8032) with public key `B64dec(signer.publicKeyB64)` over the message **M itself** (not over a hash of M). The reference verifier uses the ZIP-215 rules (cofactored equation, non-canonical point encodings accepted, S < L required); honestly made signatures satisfy both ZIP-215 and strict RFC 8032.

What the signature covers: everything in S, so every key inside `artifact` and `commit` (including `slotFloor` or `slotAnchor`), the attribution, the actor and the policy. What it does not cover: `signer.signatureB64`, `attestation.reportB64`, `agency.authorization`, `slotAllocation` (bound through `commit.slotHashB64`), `metadata`, `proofHash`, `ethereum`.

### 3.4 The signed-body hash

`signedBodyHash = SHA-256(M)`. The enclave puts exactly these 32 bytes in the attestation's `user_data` (section 5.7).

### 3.5 proofHash

```
H = { version, artifact, commit,
      publicKeyB64: signer.publicKeyB64,
      enforcement:  environment.enforcement,
      measurement:  environment.measurement }
if attribution is present and not empty:  H.attribution = attribution
if environment.attestation is present:    H.attestationFormat = environment.attestation.format
proofHash = SHA-256(canonicalize(H))            written as B64
```

proofHash omits `actor` and `policy` on purpose (a frozen subset). It equals signedBodyHash for any proof without `agency` and `policy`. proofHash is the leaf of the Base ceiling (section 10) and names the proof in storage; it MUST NOT be used for the attestation binding.

### 3.6 Counters, epochs and chains

`commit.counter` and `slotCounter` are positions on one chain within one enclave epoch; every allocation and every commit takes the next position, so gaps are normal. `epochId` changes at every enclave restart and is opaque (it is derived from a boot nonce that is never disclosed). Positions on different chains or epochs are not comparable by counter; anchors relate them (section 14).

### 3.7 The chain hash

```
chainHash(P) = SHA-256(canonicalize(P without its top-level "proofHash" and "ethereum" keys))
```

A proof's `commit.prevB64` is the B64 chainHash of the previous proof on the same chain and epoch, exactly as the enclave assembled it (signature, attestation, slot record, metadata included). Verifying a single proof does not check `prevB64`; an audit over many proofs does.

---

## 4. The position record

`slotAllocation` is the slot the enclave issued before the bytes were finished.

```
slotBody = { "version": "bitgraph/slot/1", "nonceB64": N, "counter": DEC,
             ["time": number, only if present], "epochId": E, "publicKeyB64": K,
             ["chainId": C, only if present and not empty] }
slotAllocation = slotBody + { "signatureB64": B64(Ed25519 over canonicalize(slotBody)) }
slotRecordHash = SHA-256(canonicalize(slotBody))
```

For BitGraph's user chain the hashed bytes are exactly
`{"chainId":"bitgraph:main","counter":"<DEC>","epochId":"<B64>","nonceB64":"<B64>","publicKeyB64":"<B64>","version":"bitgraph/slot/1"}`.

When a proof carries `slotAllocation`, a verifier MUST check, with s = slotAllocation and c = commit:

1. **Structure.** `s.version == "bitgraph/slot/1"`; `nonceB64`, `counter`, `epochId`, `publicKeyB64`, `signatureB64` are non-empty strings; `time` is absent or a finite number >= 0.
2. **Slot signature.** Ed25519 over `canonicalize(slotBody)` rebuilt from s's own fields, with key `B64dec(s.publicKeyB64)` (32 bytes) and signature `B64dec(s.signatureB64)` (64 bytes).
3. **Binding.** `c.slotHashB64` is present and `SHA-256(canonicalize(slotBody)) == B64dec(c.slotHashB64)`.
4. **Nonce.** `s.nonceB64 == c.nonceB64` (string equality).
5. **Order.** `c.slotCounter == s.counter` (string equality) and `int(s.counter) < int(c.counter)`.
6. **Same key.** `s.publicKeyB64 == signer.publicKeyB64`.
7. **Same epoch.** If `c.epochId` is present, `s.epochId == c.epochId`.

The reference verifier also runs a defensive check that the slot body holds no artifact fields; it cannot fail on a rebuilt body. The reference parses counters leniently (any string BigInt accepts); a strict verifier SHOULD require DEC strings matching `^(0|[1-9][0-9]*)$`. `s.chainId` is not compared with `c.chainId`.

---

## 5. The attestation (AWS Nitro)

`environment.attestation.reportB64` is the AWS Nitro attestation document: B64 of a COSE_Sign1 structure (RFC 9052). The ordinary signature check (section 3) does not read it; a verifier MUST check it as follows.

### 5.1 Decoding

The document is a CBOR array (tags, if any, are skipped) of at least four items: `[protected (bstr), unprotected (map), payload (bstr), signature (bstr)]`. Production documents are an untagged four-item array whose protected header is `{1: -35}` (ES384). The payload is a CBOR map; the fields used are `timestamp` (milliseconds), `pcrs` (map index to bstr), `certificate` (DER), `cabundle` (array of DER) and `user_data` (bstr).

### 5.2 Signature

```
Sig_structure = CBOR array ["Signature1", bstr(protected as received), bstr(empty), bstr(payload as received)]
valid iff ECDSA P-384 with SHA-384 verifies the 96-byte signature (r || s) over Sig_structure
          with the public key of the certificate in the payload
```

### 5.3 Certificate chain

`chain = cabundle[0], cabundle[1], ..., certificate`. `chain[0]` MUST be signed by the AWS root's key (section 5.5), and each later certificate by the one before it (ECDSA P-384, SHA-384, over its TBSCertificate). An empty cabundle fails.

### 5.4 Validity window

Each certificate in the chain MUST satisfy `notBefore <= t <= notAfter`, where t is the document's own `timestamp`, never the reader's clock. This is an archival policy: leaf certificates live about three hours, and judging them at the document's instant is what keeps a proof checkable forever. It is not a freshness check.

### 5.5 The root

The AWS Nitro Enclaves Root CA G1 (CN=aws.nitro-enclaves, O=Amazon, OU=AWS, C=US; P-384; valid 2019-10-28 to 2049-10-28). SHA-256 of its DER encoding:
`641a0321a3e244efe456463195d606317ed7cdcc3c1756e09893f3c68f79bb5b`. A verifier MUST embed this certificate and compare it by this hash; it is published by AWS.

### 5.6 PCR0

`hex(pcrs[0])` MUST equal `environment.measurement` (lowercase comparison); a measurement that is not a hex string names no image and fails.

A verifier MUST then apply a **measurement policy**, a set of accepted PCR0 values. Its default is BitGraph's published images (section 16, and any image BitGraph publishes after this version by the same means: a tagged source revision with a reproducible build, listed in the repository's `PINS.md` and in the published verifier's measurement list). The PCR0 judged is the one inside the attestation document, and only once the document has verified in full (signature, chain, root, validity, PCR0 and binding, sections 5.2 to 5.7): the proof's declared `environment.measurement` is a claim, never hardware evidence, and a document that does not decode fails the signature check rather than leaving it open. A PCR0 outside the policy is FALSE: the attestation is genuine, but the proof is not BitGraph's. A reader who rebuilt an image from its tagged source and accepts exactly that may use a list of their own. An empty policy accepts nothing, and the claim (and so the verdict) is UNDETERMINED.

### 5.7 Binding to this proof

`user_data` MUST be present and equal to `signedBodyHash = SHA-256(canonicalize(S))` from section 3.4. Without this check, a genuine attestation from another proof could be attached to an unrelated signature. The document's `public_key` and `nonce` fields are not used.

---

## 6. Commitments

The commitment ties bytes to one position. It is computed from the position record and, for versions 2 and 3, the floor block.

```
DOMAIN1 = UTF-8("bitgraph-fuse/1") || 0x00          (16 bytes)
DOMAIN2 = UTF-8("bitgraph-fuse/2") || 0x00          (16 bytes)
DOMAIN3 = UTF-8("bitgraph-fuse/3") || 0x00          (16 bytes)
nonce   = B64dec(slotAllocation.nonceB64), exactly 32 bytes
commitment/1 = SHA-256(DOMAIN1 || slotRecordHash || nonce)
commitment/2 = SHA-256(DOMAIN2 || slotRecordHash || nonce || anchorBlockHash)
commitment/3 = SHA-256(DOMAIN3 || slotRecordHash || nonce || floorBlockHash)
anchorBlockHash = the 32 bytes of commit.slotAnchor.blockHash ("0x" prefix removed, hex decoded)
floorBlockHash  = the 32 bytes of commit.slotFloor.blockHash
```

Which one a proof uses is decided only by its **signed** `attribution.name`: `"bitgraph-fuse/1"` means commitment/1, `"bitgraph-fuse/2"` means commitment/2 (and requires `commit.slotAnchor`, an Ethereum floor), `"bitgraph-fuse/3"` means commitment/3 (and requires `commit.slotFloor` naming `chain: "base"` and `evmChainId: 8453`). Any other name means the proof is not fused. A proof that carries both `commit.slotAnchor` and `commit.slotFloor` is ambiguous: no commitment is computed for it, and every check that rests on one fails. A producer uses commitment/3 when the enclave returned a Base floor with the slot (enclave v10), commitment/2 when it returned an Ethereum floor anchor (enclave v9); an allocation that returns both is refused.

Because commitments 2 and 3 include the floor block's hash, bytes carrying one could not have been finished before that block existed, by hashing alone. The domains differ, so the same block under the two markers gives two different commitments. The nonce never appears in the bytes; only the commitment does.

**Vectors** (synthetic slot from `src/__tests__/fuse-fixtures/vectors.json`): slotRecordHash `0315c24fcbd94e8e6506b237861ece939666cd81902e1a926a146c8a665c37a0`, commitment/1 `0e658007a8aaecce318b2f594581b880e8ecc34af0ff54cd0c85624b42cb94b7`, commitment/2 with floor hash `0x22`*32 `96e602ad102782377845b03debfc63f4a054e21996b9d848c63dcbf61a2f23c3`, commitment/3 with floor hash `0x22`*32 `8e44c4eae6be9cfd184209bb763081326182979970d24af8c0e3305886038dbd`. A real commitment/3, from a slot the enclave signed with a Base floor: `src/__tests__/fuse3-fixtures/trailer3.vector.json`. More in `spec/vectors/tree-1.json`.

---

## 7. Placements

A placement says, byte for byte, how a commitment is put into an existing file (the **original**), producing the **committed bytes** whose SHA-256 a proof names. Each placement is a deterministic function of (original, commitment), so a holder of the original can rebuild the committed bytes, and a holder of the committed bytes can recover the original.

### 7.1 trailer/1

```
committed = original || "BGFUSE01" || 0x00 * 8 || commitment          (original length + 48)
```

To locate: the last 48 bytes MUST be `"BGFUSE01"` (`42 47 46 55 53 45 30 31`), eight zero bytes, then the 32-byte commitment; the original is everything before them.

### 7.2 The container manifest

```
manifest = canonicalize({ "origin":         {"algorithm":"sha256","digest": hex(SHA-256(original))},
                          "slotCommitment": {"algorithm":"sha256","digest": hex(commitment)},
                          "type":           "bitgraph-fuse/1" })                (always 250 bytes)
```

The `type` literal is `bitgraph-fuse/1` under both commitment versions.

### 7.3 ustar headers

Each entry header is 512 bytes, all zero except:

| Offset | Length | Value |
|---|---|---|
| 0 | 100 | the entry name in UTF-8, zero-filled |
| 100 | 8 | `"0000644\0"` |
| 108 | 8 | `"0000000\0"` |
| 116 | 8 | `"0000000\0"` |
| 124 | 12 | the size as 11 octal digits, then `"\0"` |
| 136 | 12 | `"00000000000\0"` (time zero) |
| 148 | 8 | checksum: with these 8 bytes set to spaces, the sum of all 512 bytes as unsigned values, written as 6 octal digits, then `"\0 "` |
| 156 | 1 | `"0"` (regular file) |
| 257 | 6 | `"ustar\0"` |
| 263 | 2 | `"00"` |

Entry names: `bitgraph-fuse/manifest.json` and `bitgraph-fuse/original`. `pad(n)` is `(512 - n mod 512) mod 512` zero bytes. An entry is at most 8,589,934,591 bytes.

### 7.4 container/1 and container/2

```
container/1 = hdr(manifest, 250) || manifest || pad(250) || hdr(original, n) || original || pad(n) || 0x00 * 1024
container/2 = hdr(original, n) || original || pad(n) || hdr(manifest, 250) || manifest || pad(250) || 0x00 * 1024
```

Both are plain ustar archives any tar tool can list. To locate: parse exactly two entries with these names in this order, parse the manifest strictly (exact keys, lowercase hex, equal to its own canonical rebuild), require the whole archive to equal its rebuild from (original, manifest) byte for byte, and require the SHA-256 of the original entry's bytes to equal the origin digest the manifest names. An archive that fails any of these carries no commitment: a verifier never takes the declared origin on the archive's word.

**Vectors.** Original `"hello"`, commitment `0x11`*32: trailer/1 SHA-256 `8dccc9720e90b1b10bb2b7332f462d0482ff64af0c27f2ff71a48b66c0329d6c`; container/1 (3,072 bytes) `d841f147cb3dcabc938bc5abb9f651d530eb6ee620ec560787adc847e784d6d6`; container/2 (3,072 bytes) `9fe94c83852be05d8817e7f86302b1b96876400a3028fbbd6203a03419587843`.

### 7.5 Which placement producers choose

trailer/1 when the file starts with a JPEG (`FF D8 FF`), PNG (`89 50 4E 47 0D 0A 1A 0A`), GIF (`47 49 46 38`), TIFF (`49 49 2A 00` or `4D 4D 00 2A`), BMP (`42 4D`, at least 14 bytes) or RIFF (`52 49 46 46`, at least 12 bytes) signature; container/2 for everything else up to 8,589,934,591 bytes (the ustar entry limit, section 7.3); trailer/1 for any file above that, whatever its bytes (the committed bytes are virtual, so a trailer costs the file nothing). The protocol has no size in it: a producer MUST NOT choose as is (code 0x00) by size or by default. As is is the user's choice, for a file that must stay byte-identical or that they do not own, and every producer offers it as such. New BitGraphs never use container/1; verifiers MUST still accept it.

---

## 8. tree/1: the BitGraph format

Every new BitGraph is a Merkle tree of files under one position. A single file is a tree of one.

### 8.1 Leaves

```
leaf = placement (1 byte) || artifact (32 bytes) || origin (32 bytes)          65 bytes
  artifact = SHA-256 of the committed bytes
  origin   = SHA-256 of the file as it was handed in
```

| Code | Placement | Committed bytes |
|---|---|---|
| `0x00` | as is | the file itself; `artifact` MUST equal `origin`. The user's choice, never a producer's default: recorded after the floor block, the bytes themselves are not dated |
| `0x01` | trailer/1 | section 7.1 |
| `0x02` | container/1 | section 7.4 |
| `0x03` | container/2 | section 7.4 |

Any other code is invalid. Leaves are listed in strictly ascending byte order of `artifact`, with no two leaves sharing an `artifact`. The same original may appear under two placements (two leaves, two artifacts).

### 8.2 The tree

RFC 6962 hashing:

```
leafHash(leaf) = SHA-256(0x00 || leaf)
node(L, R)     = SHA-256(0x01 || L || R)
MTH([h])       = h
MTH(h[0..n))   = node(MTH(h[0..k)), MTH(h[k..n)))   with k the largest power of two strictly below n
```

A member's **path** is the list of sibling subtree hashes from the leaf level up (RFC 6962 PATH). To verify a path for leaf hash `r` at `index` in a tree of `size` leaves (RFC 9162 section 2.1.3.2):

```
fail unless 0 <= index < size
fn = index; sn = size - 1
for p in path:
    fail if sn == 0
    if fn is odd or fn == sn:
        r = node(p, r)
        if fn is even: while fn is even and fn != 0: fn >>= 1; sn >>= 1
    else:
        r = node(r, p)
    fn >>= 1; sn >>= 1
fail unless sn == 0
the result is r
```

### 8.3 The root document

```
rootDocument = UTF-8("bitgraph-tree/1") || 0x00 || u32be(count) || root (32) || commitment (32)     84 bytes
proof.artifact.digestB64 = B64(SHA-256(rootDocument))
```

`count` is the number of leaves, from 1 to 1,000,000. `commitment` is commitment/2 (section 6) for this proof's position and floor block. Because the root document's hash is the signed artifact digest, the count, the root and the commitment are all signed.

The proof carries the root document, unsigned, as `proof.metadata["bitgraph-tree/1"] = hex(rootDocument)`. A verifier MUST accept it from there or from an export, and in either case MUST check that it hashes to the signed digest before reading it.

### 8.4 The signed marker

```
attribution = { "name": "bitgraph-fuse/3", "title": "tree/1", "message": B64(SHA-256(this file)) }
```

The title selects these rules. Under this version the name MUST be `bitgraph-fuse/3`: tree/1 always binds the floor block, and here the floor is a Base block (section 9). Each version of this document requires its own marker: a proof that pins version 1 MUST be marked `bitgraph-fuse/2`, and one that pins this version MUST be marked `bitgraph-fuse/3`; a marker that disagrees with its spec is refused. The message pins the version of this document the proof follows, and is signed by the enclave like everything in the attribution. A verifier MUST know the spec hash (it keeps a list of every version it supports). A proof that pins a hash the verifier does not know is not judged by these rules: the verifier reports it as undetermined, never as passing and never as false, and the same holds for every check that rests on the tree's rules (section 12.1).

### 8.5 A member's evidence, and the owner's list

```
member evidence (JSON) = { "index": integer, "count": integer, "leaf": hex(65 bytes), "path": [hex(32 bytes), ...] }
owner's list           = every leaf, in tree order, concatenated (count x 65 bytes)
```

The member evidence MUST have exactly these four keys, `0 <= index < count`, `count` equal to the root document's, a valid leaf, and 32-byte path nodes in lowercase hex. The owner's list needs no paths: the root and every path rebuild from it. File names, when kept, live beside the list, unsigned, and are never part of the tree.

### 8.6 Verifying a member

Given a proof, its root document, a member's evidence and a file:

1. Check the proof (sections 3 to 5).
2. Check the marker (section 8.4) and recompute the commitment it names (section 6).
3. Check the root document: 84 bytes, the domain, `1 <= count <= 1,000,000`, SHA-256 equal to the signed digest, and its commitment equal to the recomputed one.
4. Check the evidence (section 8.5) and that its leaf and path reach the root document's root (section 8.2).
5. Match the file to the leaf, with `d = SHA-256(file)`:
   - code `0x00` and `d == artifact`: **member, as is**. The file existed by the commit; nothing bounds it from below.
   - `d == origin` (codes `0x01` to `0x03`): rebuild the committed bytes with the placement and the commitment; their SHA-256 MUST equal `artifact`. **Member, from its original.**
   - `d == artifact` (codes `0x01` to `0x03`): locate the commitment in the file by the placement; it MUST equal the recomputed commitment, and any origin the bytes carry MUST equal the leaf's `origin`. **Member, committed bytes.**
   - otherwise the file is not this member.

What each result establishes:

- **Two floors.** Every member has the record floor: the root document, and so every leaf, was signed after the floor block. A placed member (codes `0x01` to `0x03`) also has the content floor: its committed bytes carry the commitment, so they were finished after that block. The original inside them, and an as-is file (code `0x00`), carry no commitment and have no content floor; their bytes could be years older. A verifier MUST state the two apart, and for an as-is member MUST say: recorded after block N; the bytes themselves are not dated.
- **A path proves one leaf.** A member's evidence cannot show that the rest of the list is sorted or free of duplicates; only a check of the owner's whole list (sorted, unique, rebuilding the root) establishes that, and a member check MUST NOT claim it.
- **One list, one root.** One fixed list of leaves has exactly one root. The same originals under different placements or commitments give different leaves and a different root.

### 8.7 Verifying the owner's list

The list MUST be a whole number of valid 65-byte leaves, exactly `count` of them, strictly ascending by `artifact` with no duplicate, and MUST rebuild the root document's root.

---

## 9. The floor (Base)

`commit.slotFloor = {chain: "base", evmChainId: 8453, blockNumber, blockHash, blockTimestamp}` is the newest Base block the enclave had been given when it issued the slot, fixed at allocation and signed at commit. Its block is the floor.

**What the enclave checks at allocation.** The parent process hands the enclave the header's raw bytes with the allocation; nothing else about the block is taken from outside. The enclave decodes the header (below), computes `blockHash = keccak256(header)` and reads the number and time from the same bytes, and refuses the header unless: its time is exactly Base mainnet's schedule for its number, `timestamp == 1686789347 + 2 * number` (block times on Base are fixed by height); its time is not later than the enclave's own clock; and its number is not lower than the last floor fixed on that chain in that epoch. On the user chain (`bitgraph:main`) a position is never issued without a floor. The enclave cannot tell a header Base produced from one built to fit the schedule: that is the reader's lookup (below), exactly as it was for an Ethereum floor. If Base's block time ever changes, the schedule check fails closed and a new enclave version is needed.

**What a verifier checks.** To read the floor's time offline, an export carries the floor block's header (RLP), named `chain: "base"`. A verifier MUST check `keccak256(header) == slotFloor.blockHash`, that the header's number equals `slotFloor.blockNumber`, that its timestamp equals `slotFloor.blockTimestamp`, and that the timestamp is on Base mainnet's schedule; a header given as one chain's block for a proof that signs the other chain's floor fails. The floor's time is stated as a bound only when it is not later than the attestation document's `timestamp` (section 5): a floor stamped after the document cannot be a "not before" for a record that already existed. When it is later, the block hash still floors the record, the time is withheld, and the reason is stated.

**Header decoding.** The header is an RLP list (strict RLP: canonical lengths, no trailing bytes) of at least 15 items. The fields used are `parentHash` = item 0, `stateRoot` = item 3, `transactionsRoot` = item 4, `number` = item 8 and `timestamp` = item 11, the last two as unsigned big-endian integers with no leading zero byte. Later forks append fields; any count of at least 15 is accepted, because the hash covers every byte.

Whether the floor block is canonical is the reader's lookup (section 1): ask a Base node for the block AT THE FLOOR'S NUMBER and compare its hash with `slotFloor.blockHash`. Finding a block with that hash somewhere is not enough. A floor block that Base later replaced (a reorganisation) is not confirmed: a reader MAY instead confirm its parent (the header's `parentHash`, item 0) at number N-1 with time 2 seconds earlier, and then state the floor as that parent, labelled as such; a reader MUST NOT describe a header it cannot find on Base as a replaced block.

**Earlier proofs.** A proof that signs `commit.slotAnchor` instead has an Ethereum floor (version 1, section 14); its header is an Ethereum header, checked the same way without the schedule and timestamp rules, and confirmed against an Ethereum node.

---

## 10. The ceiling on Base, `bitgraph-ceiling/1`

After each commit, a separate writer (not the enclave) batches new records, builds an RFC 6962 tree over their proofHash values, and sends the root to Base in a transaction to itself. The writer's one power is delay: a proofHash does not exist before its commit, so a ceiling can be late but never early.

### 10.1 The sidecar

```
{ "version": "bitgraph-ceiling/1",
  "proofHash": B64, "leafIndex": n, "leafCount": n, "merklePath": ["0x"+hex, ...], "root": "0x"+hex,
  "anchor": null | { "chainId": 8453, "writer": address, "txHash", "rawTx", "payload",
                     "blockNumber", "blockHash", "blockTimestamp", "blockHeader", "txIndex", "txInclusionProof": [...] },
  "status": "pending" | "included" | "safe" | "finalized",
  "statusObserved": {...}, "floor"?: {...}, "settlement"?: ... }
```

`status`, `statusObserved`, `anchor.writer` and everything in `floor` except its header are the writer's own notes: unverified, and never a basis for a claim.

### 10.2 Checks

1. `computeProofHash(proof)` (section 3.5) equals `proofHash`.
2. The leaf `SHA-256(0x00 || B64dec(proofHash))` with `leafIndex`, `leafCount` and `merklePath` reaches `root` (section 8.2).
3. `anchor` is not null (null means pending).
4. The payload is 84 bytes:

   | Offset | Length | Field |
   |---|---|---|
   | 0 | 4 | `"BGC1"` |
   | 4 | 32 | root |
   | 36 | 32 | prev: SHA-256 of the writer's previous payload (zeros for the first) |
   | 68 | 8 | first position, u64be |
   | 76 | 8 | last position, u64be |

   Its root MUST equal the sidecar's root. `prev`, first and last are the writer's chain and are not otherwise checked.
5. `rawTx` is an EIP-1559 transaction: `0x02 || RLP([chainId, nonce, maxPriorityFeePerGas, maxFeePerGas, gas, to, value, data, accessList, yParity, r, s])`. Its sender is recovered with secp256k1 from `keccak256(0x02 || RLP(first nine fields))`, `r`, `s` (low s) and `yParity`, as `keccak256(uncompressed public key without its 0x04 prefix)[12..32]`. The sender and `to` MUST both equal the writer address the verifier pins (section 16), `chainId` MUST be 8453, `data` MUST equal the payload, and `keccak256(rawTx)` MUST equal `txHash`.
6. `keccak256(blockHeader) == blockHash`, and the header's number and timestamp equal `blockNumber` and `blockTimestamp` (section 9 decoding).
7. The transaction is in the block: the Merkle-Patricia proof (section 10.3) for key `RLP(txIndex)` under the header's `transactionsRoot` returns exactly `rawTx`. `txIndex` counts every transaction in the block, deposits included.
8. `floor` is null (no floor carried) or an object whose `blockHeader` is a non-empty hex string that passes section 9's header checks against the proof's signed floor (`commit.slotFloor`, or `commit.slotAnchor` on an earlier proof). The object names `chain: "base"` for a Base floor; absent means Ethereum, and a chain that is not the signed floor's fails. A carried part that does not hold, an empty or missing header included, fails the sidecar; it is never skipped.

The checks run in order and stop at the first failure. The ceiling's time is the Base header's timestamp. It is provisional until block B is checked against Base (section 1); the Ethereum ceiling (section 11) does not depend on that check.

### 10.3 Merkle-Patricia inclusion proofs

```
key nibbles = the key's bytes, high nibble first
want = root; depth = 0; i = 0
loop:
    if want is 32 bytes: node = proof[i]; i += 1; require keccak256(node) == want
    else:                node = want                          (an inline child, under 32 bytes)
    decode node as an RLP list
    17 items (branch): if depth == key length: return item 16 (must be non-empty)
                       child = item[nibble[depth]]; depth += 1; empty child means absent
                       want = child if it is bytes, else RLP(child)
    2 items:           decode item 0 by hex-prefix: flag = first nibble (0..3); leaf if flag >= 2;
                       odd if flag is odd (the path starts after the flag), else skip the flag and a zero nibble
                       the path segment MUST match the key's next nibbles; depth += its length
                       leaf: depth MUST equal the key length; return item 1
                       extension: want = item 1 if bytes, else RLP(item 1)
    otherwise: fail
```

`RLP(i)` for a transaction index is the RLP of i's minimal big-endian bytes: 0 is `0x80`, 1 to 127 is the byte itself, 128 to 255 is `0x81 xx`, and so on.

### 10.4 The Base time as a bound

Base fixes each block's timestamp by its number, two seconds apart. After a halt it refills the missed time with blocks stamped in the past: in Base's halts of 2026-06-25 (blocks 47,806,547 to 47,808,791, stamped 15:47:21 to 17:02:09 UTC) and 2026-06-26 (blocks 47,849,207 to 47,849,619) those blocks were empty, but nothing in the protocol requires it. So the Base stamp is used as an "existed by" time only when:

- it is not earlier than the floor block's own timestamp (section 9), and
- it is not more than 2 seconds (one Base block) earlier than the attestation document's `timestamp` (section 5), taken only when the document's signature, chain and root hold. The document's time is milliseconds on the AWS Nitro hypervisor's clock at the document's creation; the document is made after the signed body it binds (section 5.7), and the writer posts the ceiling only after the proof exists, so an honest stamp is seconds to minutes later. The 2-second slack covers block sealing and clock skew.

The floor's time is read from the floor header the export carries (section 12), or else from the verified header the sidecar carries (check 8). This is a consistency check, not a proof of the stamp's accuracy: it assumes the hypervisor's clock is within the slack of real time, and a stamp that passes is only not known to be wrong. When the stamp fails either comparison, the inclusion (`ceiling.base`) still holds, the ceiling's time is withheld as a bound, every result that states an "existed by" time omits it, and the reason is stated. A passing stamp stays provisional until B is checked against Base, and only the Ethereum ceiling (section 11) is a bound that does not rest on Base.

---

## 11. Settlement on Ethereum

### 11.1 `bitgraph-output-root/1` (current)

Base posts an **output root** for one of its blocks P to Ethereum about every 600 Base blocks, as the `rootClaim` of a dispute game (factory `0x43edb88c4b80fdd2adff2412a7bebf9df42cb40e` on Ethereum mainnet):

```
outputRoot = keccak256(version (32 zero bytes) || stateRoot_P || messagePasserStorageRoot_P || blockHash_P)
```

Base runs the EIP-2935 history contract (`0x0000f90827f1c53a10cb7a02335b175320002935`), which keeps the hashes of the previous 8,191 blocks in its storage. So the hash of the ceiling's block B is provable from P's state when `1 <= P - B <= 8191`, and when `B = P` the output root names it directly.

```
{ "version": "bitgraph-output-root/1",
  "base": { "chainId": 8453, "blockNumber": B, "blockHash": "0x..." },
  "outputRoot": { "blockNumber": P, "version": "0x00..00", "stateRoot", "messagePasserStorageRoot", "blockHash" },
  "history": null | { "address": "0x0000f908...2935", "slot": "0x"+64 hex, "accountProof": [...], "storageProof": [...] },
  "ethereum": { "chainId": 1, "blockNumber": H, "blockHash", "blockTimestamp", "header", "txHash", "txIndex", "rawTx", "txInclusionProof": [...] },
  "game"?: { informational, never checked } }
```

Checks, in order:

0. `base.chainId` is 8453 and `ethereum.chainId` is 1 (or the chains the verifier pins); these labels are checked, never echoed.
1. `version` (the output-root field) is 32 zero bytes. Compute `outputRoot`.
2. **B = P:** `history` MUST be null and `outputRoot.blockHash` MUST equal `base.blockHash`.
   **B < P:** `1 <= P - B <= 8191`; `history.address` is the EIP-2935 contract; `history.slot` is `u256be(B mod 8191)`; the account proof (section 10.3, key `keccak256(address)`) under `stateRoot_P` returns the account `RLP([nonce, balance, storageRoot, codeHash])`; the storage proof under that `storageRoot` with key `keccak256(slot)` returns `RLP(value)`, and `value`, left-padded to 32 bytes, equals `base.blockHash`.
3. `keccak256(ethereum.header) == ethereum.blockHash`, and its number and timestamp equal the stated ones.
4. `keccak256(rawTx) == txHash`; the chain id signed inside `rawTx` (field 0 of a typed transaction, or EIP-155's `v` for a legacy one) equals `ethereum.chainId`, and a transaction that names no chain fails; and the Merkle-Patricia proof for key `RLP(txIndex)` under the header's `transactionsRoot` returns exactly `rawTx`.
5. The bytes of `rawTx` contain the 32 bytes of `outputRoot`.
6. `base.blockNumber` and `base.blockHash` equal the ceiling's block (section 10).

**What it proves.** The output root is a hash of a preimage that contains P's state root, which commits to B's hash, which commits to B's header, which contains the ceiling transaction, which carries the root over the record. An Ethereum transaction that contains the output root therefore proves the record existed by Ethereum block H, whoever sent it and whether or not Base's claim is ever upheld. The sender and the game's outcome are deliberately not checked. What it does not prove: that B is canonical on Base, or B's timestamp.

**Timing.** Base posts a claim about 40 minutes after its block P, so this settlement lands about an hour after the commit. An export made sooner carries `{"status":"pending"}` (section 12).

**Vector.** `spec/vectors/output-root-1.json`: a BitGraph ceiling transaction in Base block 52,107,106, settled through game 23386 (P = 52,109,160) whose claim is in Ethereum block 26,110,095.

### 11.2 `bitgraph-settlement/1` (blob data, earlier)

Earlier ceilings were settled by pointing to the Ethereum blob transaction that carried Base's batch data. A verifier SHOULD support it for those proofs:

- The pointer gives the Ethereum block (header, transaction, inclusion proof) and the blob versioned hashes. The transaction MUST be a type-3 transaction from Base's batcher `0x5050f69a9786f081509234f1a7f4684b5e5b76c9` to its inbox `0xff00000000000000000000000000000000008453`, and each listed versioned hash MUST be in it and equal `0x01 || SHA-256(kzgCommitment)[1..32]`.
- To go further, the blob bytes (131,072 bytes each; Ethereum keeps them about 18 days, so they must be archived) are checked against their KZG commitments with the EIP-4844 trusted setup, decoded per the OP Stack blob encoding (version 0), split into frames, assembled into a channel, decompressed (brotli or zlib), and read as batches until the ceiling transaction is found in Base block B.

This path needs the KZG trusted setup and archived blob bytes. tree/1 exports use section 11.1 instead.

---

## 12. The export, `bitgraph-export/1`

One JSON file which, with the file it is about, lets anyone check a tree/1 BitGraph.

```
{ "format": "bitgraph-export/1",
  "spec": B64(SHA-256(SPEC.md)),                         informational; the signed attribution.message decides
  "proof": the signed proof,
  "tree": { "rootDocument": hex(84 bytes),
            "member": member evidence                      one file's export
         or "leaves": B64(count x 65 bytes), "names"?: [...] },   the owner's export
  "floor": { "chain"?: "base", "blockNumber", "blockHash", "header" } | null,     chain absent = Ethereum (earlier proofs)
  "ceiling": bitgraph-ceiling/1 sidecar | { "status": "pending" } | null,
  "settlement": bitgraph-output-root/1 | { "status": "pending", "baseBlock"?: B } | null }
```

`SPEC.md` (this file, byte for byte) travels beside the export. Copies are kept where BitGraph does not control them, so the text outlives BitGraph; its hash in the signed proof says which text applies.

**Pending and completion.** An export made right after the commit has a pending ceiling (minutes) and a pending settlement (about an hour). Pending sections are reported as not carried, never as failures. Completing an export means filling those sections later, from public chain data or from any copy of the writer's published evidence, and writing a new export; nothing already in the export changes meaning.

**What an export does not contain.** No copy of the file: the file travels separately, and the committed bytes rebuild from it. No anchors and no blob bytes: a tree/1 proof signs its floor, and its settlement uses section 11.1. There is no ceiling in position: order after a record is the chain of proof hashes (section 3.7), and the time ceiling is the Base write (section 10).

### 12.1 Verification

A verifier reports one result per claim (TRUE, FALSE, UNDETERMINED, or NOT_CARRIED), each saying what it rests on:

| Claim | Check |
|---|---|
| format | the document is export/1 |
| proof.signature | sections 3 and 4 |
| attestation.* | section 5: signature, chain, root, validity at the document's instant, PCR0, binding |
| attestation.pins | PCR0 against the verifier's measurement policy (section 5.6), by default BitGraph's published images; UNDETERMINED for an empty policy |
| spec.pin | section 8.4 (UNDETERMINED for a spec the verifier does not know) |
| tree.root | section 8.6 step 3 |
| tree.member / tree.leaves | section 8.5 or 8.7 |
| bytes.member | section 8.6 step 5 (NOT_CARRIED without the file) |
| floor.record | section 8.6: the record was made after the signed floor block (every member) |
| floor.content | section 8.6: the committed bytes were finished after the floor block; NOT_CARRIED for an as-is member, whose bytes are not dated |
| floor.header | section 9 (and the floor's time withheld when it is later than the attestation document) |
| ceiling.base | section 10 (its time used only as section 10.4 allows) |
| ceiling.ethereum | section 11.1 |
| confirmed.* | the reader's own lookups of the floor block (on its own chain, by number), the Base ceiling block and Ethereum block H |

The verdict is FALSE if any claim is FALSE, a lookup the reader made included: a node that says a block is not the chain's own refutes every time read from it. Otherwise it is UNDETERMINED if any offline claim is UNDETERMINED (`attestation.pins` included), and TRUE if none is. A confirmed claim left UNDETERMINED because the reader made no lookup does not change the verdict; the reading then says that each header is taken as given until it is checked.

The three time claims are always stated separately. A time is stated as fact only when nothing refutes it; the Base time is labelled provisional until `confirmed.ceiling.base` is TRUE, and is withheld when section 10.4 does not allow it.

An optional part (`floor`, `ceiling`, `settlement`) that is null or missing is NOT_CARRIED. A pending ceiling is an object without `anchor` whose `status` is `"pending"`; a pending settlement is `{"status":"pending"}`. Any other value of an optional part, and an export that names `bitgraph-export/1` without a proof object and a hex `tree.rootDocument`, is malformed: FALSE, never an error. The export's own `tree.rootDocument` is the one checked; the proof's unsigned echo of it under `metadata` is never used in its place. The unsigned `spec` label, `tree.names` and the proof's `metadata` are advisory and change no claim.

FALSE means a check ran and failed. A part in a format the verifier does not know is UNDETERMINED, never FALSE:

- a proof that pins a spec hash the verifier does not know (section 8.4): spec.pin, tree.root, tree.member, tree.leaves and bytes.member are UNDETERMINED;
- a ceiling whose `version` is not `bitgraph-ceiling/1`: ceiling.base is UNDETERMINED, and so is ceiling.ethereum when a settlement that verifies cannot be linked to it;
- a settlement whose `version` is not `bitgraph-output-root/1`, including the earlier blob settlement (section 11.2), which an export does not carry: ceiling.ethereum is UNDETERMINED.

A part that names a format the verifier knows and does not verify is FALSE.

---

## 13. Recovery entries

Recovery is a convenience BitGraph runs, not part of verification: if an export is lost, anyone holding the file can get its proof back. It uses BitGraph's storage; checking an export does not.

For each member of a tree, up to two entries: one for the `origin` digest and one for the `artifact` digest (one entry when they are equal, code `0x00`). With `d` the raw 32-byte digest, `proofHash32` the raw 32 bytes of the tree proof's proofHash, `leafIndex` the member's index, and `salt32` 32 random bytes (salted entries only, below):

```
address   = hex(SHA-256(UTF-8("bitgraph-lookup") || d))
entryId   = hex(SHA-256(UTF-8("bitgraph-lookup-entry") || d || proofHash32 || u32be(leafIndex)))
saltedId  = hex(SHA-256(UTF-8("bitgraph-lookup-entry/salted") || d || proofHash32 || u32be(leafIndex) || salt32))
key       = SHA-256(UTF-8("bitgraph-lookup-key") || d)                       (an AES-256 key)
objectKey = "recovery/v1/" + address + "/" + entryId        or, for a salted entry, + saltedId
envelope  = 0x01 || nonce (12 random bytes, fresh for every entry) || AES-256-GCM ciphertext || tag (16)
            with additional authenticated data = UTF-8(objectKey)
plaintext = canonicalize({ "format": "bitgraph-recovery/1", "proofHash": B64, "leafIndex": n,
                           "rootDocument": hex, "member": member evidence,
                           "proof": { "epochId": B64, "counter": decimal, "artifactDigestB64": B64 },
                           "salt"?: B64 (salted entries only), "name"?: string })
```

The four labels differ and every input after a label has a fixed length, so the four preimages (47, 51, 89 and 128 bytes) can never be confused with one another. The plaintext is canonical JSON exactly as section 2 defines it (so its keys are in sorted order); a reader accepts the keys in any order. `salt` is present exactly when the entry sits under a `saltedId`, and a reader accepts an entry only under the name its own plaintext derives: `saltedId` when it carries a salt, `entryId` when it does not.

**What a reader accepts.** A plaintext is exactly the keys above, no others, with `format` the string shown; `proofHash` and `artifactDigestB64` canonical standard base64 of 32 bytes (section 0); `leafIndex` an integer with 0 <= n < 2^32; `rootDocument` lowercase hex of the 84-byte root document (section 8.3); `member` the member evidence of section 8.5 (its `index` equal to `leafIndex`, its `leaf` a 65-byte leaf naming `d` as its origin or its artifact, its `path` reaching the root document's root); `salt` canonical base64 of 32 bytes; `name` a non-empty string of at most 512 UTF-8 bytes, advisory and unsigned. The locator is three of the proof's own signed fields, in the proof's own encodings: `epochId` is `commit.epochId`, canonical standard base64 of 32 bytes (44 characters, padding included); `counter` is `commit.counter`, decimal digits with no leading zero, at most 20; `artifactDigestB64` is `artifact.digestB64`. An entry that does not open, does not parse, sits under a name its plaintext does not derive, or names a leaf that is not `d` is somebody else's and is skipped.

**Binding the entry to its proof.** The proof is read from the ledger by its artifact digest: `GET /api/proofs/<artifactDigestB64 in URL-safe base64, unpadded>` answers `{ proofs: [{ proof, ... }] }`, every proof the ledger holds under that digest, earliest position first; `{ proofs: [] }` with no `discovery` field is a complete negative answer (no proof under that digest), while any other status, any other shape, and `{ proofs: [], discovery: "retired" }` (the index no longer kept) are failed reads. Among the proofs answered, the entry's proof is the one whose proofHash (section 3.5, recomputed) equals the plaintext's `proofHash`; it MUST also satisfy `proof.commit.epochId == epochId`, `proof.commit.counter == counter`, `proof.artifact.digestB64 == artifactDigestB64` and `SHA-256(rootDocument) == proof.artifact.digestB64`, or the entry is not accepted. A member then counts as RECOVERED only when section 8.6 holds for it: steps 1 to 4 for every candidate, bytes or no bytes (the proof in full, sections 3 to 5, its attestation verified and binding it, the signed tree marker, the recomputed commitment, the root document, the evidence and its path), and step 5 when the file's bytes are in hand. The measurement policy is section 5.6's, with BitGraph's published images (section 16) as the default; a reader whose policy is empty has judged nothing, and such a candidate is UNRESOLVED (below), never negative. A proof that pins a spec hash the reader does not know (section 8.4) is likewise unresolved. A client that has only the digest (the hosted MCP) accepts a member whose `artifact` is the digest (the tree commits to exactly those bytes) and treats a member that names the digest only as its `origin` as UNKNOWN: a leaf's origin is whatever its maker declared.

**Wire answers and candidates are different things.** A malformed answer from the service (a listing item that is not `{ key, envelope }` under the address in canonical base64, a proof answer that is not `{ proofs: [...] }`, a batch answer missing an address, a cursor that does not advance, any status but 200) is a failed read, and a failed read is never an answer. An entry that was served well-formed and merely fails to open or to bind is a rejected candidate: skipped, and no reason not to call the listing complete.

- **One entry per member of each recording.** Recording a file twice, or listing the same original twice in one tree under two placements, gives distinct entry ids under one address; recovery lists the address and returns them all. An entry id shares nothing across a batch, so listing storage does not link the members of one tree. A reader that meets the same member under two names (its `entryId` and a `saltedId`, or two salted copies) lists it once; two entries that name the same proof and leaf but describe different members are both listed, and binding each to its proof decides between them.
- **Create-only writes.** An entry is written only if absent. When storage reports that it already exists, the writer counts it as written only after reading it back, decrypting it, and finding the same member under its own name: the same proofHash, leafIndex, root document, member evidence and locator (the name is advisory and not compared), AND a plaintext that derives the key's own name exactly as a reader demands. Without the second condition a copy of the member's plaintext with a salt in it, parked at the `entryId`, would pass as the writer's own entry while no reader accepts it, and the file would be marked recoverable and be unrecoverable. A conflicting concurrent write is retried. Storage MUST refuse deletes under `recovery/` and MUST refuse any write there that is not create-only, and no expiry rule may cover `recovery/`; otherwise a delete marker or an unconditional write could let a second version in.
- **Squatting, and the salted name.** Because keys are deterministic and writes create-only, someone who holds a file and sees its proof before the owner's entry lands can occupy that member's `entryId` first. They can deny that one name; they cannot make a wrong proof come back, because a reader checks every entry, binds it to its proof and verifies the member. A writer that finds a different member at the `entryId` first lists the address for an entry of this member already there under a salted name (from an earlier run whose salt was not kept); found, it counts, and its salt is kept. Otherwise the writer writes the same plaintext, plus a fresh `salt`, under the `saltedId`, keeping the salt BEFORE that write, with the rest of its progress, so a retry lands on the same name instead of leaving a second copy. An address that cannot be read leaves the side pending: nothing is guessed. Only when the salted name is held too does the writer report that side blocked. The site's own writer for hosted trees keeps its salt in memory for the request only; two concurrent runs over one tree can leave two salted copies, which a reader lists once.
- **The service.** Three routes, all answering JSON. `POST /api/recovery` with `{ entries: [{ key, envelope }] }` (1 to 500 entries, each key `recovery/v1/<64 hex>/<64 hex>` lowercase, each envelope canonical standard base64 of 30 to 4,096 bytes with version byte 0x01, no key twice; the whole body is checked before any entry is written) answers `{ results: [...] }` in request order, one per entry: `{ key, status: "created" }`, `{ key, status: "exists", envelope }` with the stored envelope (the client decides whose it is), `{ key, status: "conflict" }` (a concurrent write; try again) or `{ key, status: "error" }`; 400 for a bad body, 413 over 4,000,000 bytes, 429 when rate-limited, 503 while writes are off. `GET /api/recovery/<address>?after=<entryId>&limit=<1..100>` answers `{ address, entries: [{ key, envelope }], next }` ascending by entry id, strictly after `after`, at most `limit` (default 100) entries, `next` the last entry id of the page when more follow, else null; 400 for a bad address or query, 503 when the store cannot be read (never an empty page). `POST /api/recovery/lookup` with `{ addresses: [<64 hex>, ...] }` (1 to 1,000 addresses, each once, body at most 131,072 bytes) answers `{ results: [...] }` in request order: `{ address, entries, next }` for the first page of at most 20 entries, `{ address, truncated: true }` for an address the answer's byte budget could not take (list it one by one), or `{ address, error: "unavailable" }` for one the store could not read; the answer stays under 3,500,000 bytes. A client with the batch route unavailable (404, 405, 501) asks address by address; a 404 from the listing route is a failed read like any other.
- **Looking up many files at once.** One request names the addresses that were looked up together, a linkage that one-by-one requests only hint at by timing. The application logs counts and error names, never addresses or object keys, and keeps no record of which addresses were asked together; the hosting platform's request logs record request paths as they do for any URL, which is one reason the batch route carries its addresses in the body.
- **Unknown is not new.** Three outcomes, in this order of precedence. ON RECORD: at least one candidate verified as above (from the store, or from the client's own saved work, below); it stands whatever else was left unread or unresolved. UNKNOWN: no candidate verified, and something was not settled: a page not read, a candidate whose proof could not be read or whose trust was not judged (an empty policy, an unknown spec pin), a listing of more than 200 distinct members (counted after the listing is reduced to one entry per member, section above, and before any proof is read; two descriptions of the same proof and leaf count as two), a batch answer missing an address, the client's own records unreadable or damaged (a saved list that no longer rebuilds its root: a recording happened, and which files it covered can no longer be read). NEW: every source answered completely and negatively: the listing read to its end with every candidate rejected, the proof index's complete negative answers, the client's own saved work readable and holding no such member. A client does not record an unknown file unless the person asks for a new BitGraph regardless; the SDK, CLI and MCP refuse it with the reason, and the drop box asks. Opting out of recovery entries (below) changes none of this: only the explicit "record regardless" does.
- **Limits.** An envelope is 30 to 4,096 bytes; a name is at most 512 UTF-8 bytes and is dropped rather than the entry when space runs out. The version byte is checked strictly but sits outside the AAD; a later version should bind it.
- **Never in the way of the proof.** The proof is signed and the export prepared before any entry is written: the CLI and SDK write the export to disk first, the drop box hands it to the page, and the hosted MCP returns it in its answer and writes its entries only after that answer. A client may wait a bounded time for the entries before answering. In the browser and in the CLI/SDK the work is saved BEFORE the first entry is written and survives a closed tab or an interrupted command: one progress byte per member and the salts chosen so far, in a form private to each implementation (BitGraph's own two writers share one shape). The hosted writer saves nothing beyond its request: if it is interrupted, what survives is the export its caller received, from which every entry can be rebuilt (`bitgraph recovery keep <owner export>`), and a repeated run may leave a second salted copy where a salt was in flight. A file is shown as recoverable only after its writes land.
- **What recovery can and cannot promise.** Anyone who knows a file's digest can write under its address, and nothing there is ever removed. So someone can bury an address under entries that are well-formed and open but are not the file's (or under enough of them to pass the 200-member limit or the 1,000-page limit), and every reader then answers unknown for that file, indefinitely: the owner's entries remain stored and the export still verifies, but normal recovery is denied, and recording the file again does not cure it (the new entries land under the same address). The same limits can be reached honestly by a file recorded very many times. Recovery is the convenience it says it is; the export is the record.
- **Privacy.** The address and the key derive from the digest, so anyone who knows a file's digest (holding the file, a published digest, or guessing among a few likely files) can find and read its entries. That is the same ability recovery needs, and it is all an entry gives away: without the digest, an entry is opaque, and a member's entry holds its own path, never the rest of its batch. Entry counts, envelope sizes and access timing are visible to whoever runs or watches the storage. This covers these sealed entries only, not older indexes.
- **Opting out.** A tree may be marked "keep no recovery copy"; then no entry is written for it, and a lost export cannot be recovered. The check for earlier trees before a file is called new still runs.

---

## 14. Anchors and the Ethereum floor (earlier evidence)

An **anchor** is an ordinary proof that records an Ethereum block hash on the user chain. Proofs made before the Base floor (enclave v10, version 2 of this document) carry an Ethereum floor: `commit.slotAnchor = {counter, blockNumber, blockHash}`, the newest Ethereum anchor the enclave had authenticated when it issued the slot, fixed at allocation and signed at commit (enclave v7 to v9). Its header is checked as section 9 says for Ethereum headers (`keccak256(header) == slotAnchor.blockHash`, the number equal, the time read from the header), and it is confirmed against an Ethereum node. Proofs from before the floor was signed into the commit, and before Base ceilings existed (2026-09-29 22:43 UTC), rely on anchors as below. Enclave v10 still authenticates anchor claims, but never signs `slotAnchor` beside a Base floor.

- **Identification.** A proof is an authenticated anchor when `commit.anchor = {blockNumber, blockHash}` is present (enclave v7 and later); before that, when its signed `attribution.name` is `"Ethereum Anchor"` (reserved). The anchored artifact is `SHA-256(UTF-8(blockHash as lowercase "0x" hex text))`.
- **Witness.** `{"version":"bitgraph-anchor-witness/1","headerRlpHex","blockNumber","blockHash","network"?}`; `keccak256(header) == blockHash`, and item 8 is the block number, item 11 the time.
- **Floor by anchor** (proofs that sign no floor at all, from before enclave v7): the latest anchor on the same chain, epoch and key with a lower counter. Never used for a proof that signs `slotFloor` or `slotAnchor`.
- **Ceiling in position:** an anchor on the same chain, epoch and key with a higher counter than the commit proves the commit preceded that anchor's recording. It is an order, not a clock time, and rests on the enclave's counter (PCR0). For a Base-floored proof the same order is given by any later proof on the chain (section 3.7); a later proof's floor block is a floor for that proof only, never a time ceiling for an earlier one.

---

## 15. Earlier formats

Verifiers SHOULD support every earlier format, so every proof ever issued keeps verifying.

### 15.1 Plain recordings

No fused marker in the signed attribution. The file's SHA-256 equals `artifact.digestB64`. The record was made after the signed floor block when the proof carries one (`commit.slotFloor`, or `commit.slotAnchor` on earlier proofs); the bytes carry no commitment, so the bytes themselves are not dated.

### 15.2 A single fused file

Signed attribution `{name: "bitgraph-fuse/1", "/2" or "/3", title: placement id, message: B64(SHA-256(original))}`. The artifact digest is the SHA-256 of the committed bytes (section 7). A file matching the digest is checked by locating the commitment; a file matching the origin is rebuilt with the placement and must reproduce the digest.

- **Carried inline** (title `"base64url"`): the artifact was made with the commitment inside it, as the B64URL text of the 32 commitment bytes (43 characters). Check that the file's SHA-256 is the digest and that it contains that text.
- **Produced** (title `"produced/1"`): the artifact is the canonical manifest of section 7.2 itself (with or without `origin`).

### 15.3 set/1

The artifact digest is the SHA-256 of a canonical manifest:
`{"members":[ROW,...],"placement":"set/1","slotCommitment":{digest field},"type":"bitgraph-fuse/1"}` with each `ROW = {"artifact":{digest},"origin":{digest},"placement":"<id>"}`, rows strictly ascending by artifact hex, no duplicate artifacts, at most 2,000 rows. It rides in `proof.metadata["bitgraph-fuse/1"]`; it MUST hash to the signed digest and carry the recomputed commitment.

### 15.4 set/2

The artifact digest is the SHA-256 of `{"count":N,"placement":"set/2","root":{digest},"slotCommitment":{digest},"type":"bitgraph-fuse/1"}`. The tree is section 8.2 over leaves `SHA-256(0x00 || canonicalize(ROW))`, rows sorted as in set/1. A member's evidence is `{"count","index","member":ROW,"path":[hex],"placement":"set/2","type":"bitgraph-fuse/1"}`.

### 15.5 BitGraphed files (carriers)

```
file = committed bytes || "BGPROOF\x01" || u32be(L) || payload (L bytes, UTF-8 JSON) || u32be(L) || "BGPROOF\x01"
```

The magic is `42 47 50 52 4f 4f 46 01`; L is at most 8,388,608. The payload names `bitgraph-carrier/1`, `/2` or `/3`. Versions 1 and 2 carry the proof, the floor anchor and witness, the ceiling in position, and for version 2 the Base ceiling sidecar, a settlement pointer, declared pins and an attestation witness. Version 3 is for a Base-floored proof: its floor is `{"status":"present","basis":"base-header","header":"0x"+RLP}`, checked as section 9 says against `commit.slotFloor`; its ceiling in position is `{"status":"none","basis":"hash-chain"}` (there is no closing anchor); everything else is as version 2. A version 3 payload with an anchor floor or any other ceiling, a version 2 payload with a `basis` field, and a Base-floored proof inside a version 1 or 2 payload are malformed. The committed bytes are everything before the block, and their SHA-256 is the proof's digest; the file's own hash is committed nowhere.

A reader judges a BitGraphed file by the rules of sections 3 to 11 with the same discipline as section 12.1: TRUE only when the image passes the measurement policy (section 5.6) on a fully verified attestation, FALSE when any check (a reader's lookup included) fails, malformed parts FALSE and never an error, and the Base time withheld as section 10.4 says, so that no stated bound carries it.

### 15.6 Agency and policy

`agency.actor` (an ES256 key, its key id `hex(SHA-256(SPKI))` and provider) is signed as `actor`; `agency.authorization` is a P-256 signature (direct, or WebAuthn with user presence and verification) over the artifact digest, checked against the actor key. `policy` is signed verbatim and carries a policy reference; its contents are not interpreted.

---

## 16. Constants

| Name | Value |
|---|---|
| AWS Nitro Root CA G1, SHA-256 of DER | `641a0321a3e244efe456463195d606317ed7cdcc3c1756e09893f3c68f79bb5b` |
| Base ceiling writer | `0xf3972408D853c975F86351C311f4310220bbF2a3` |
| Base mainnet chain id | 8453 |
| Base mainnet schedule | block n is stamped `1686789347 + 2 * n` (Unix seconds) |
| Fused marker for a Base floor | `bitgraph-fuse/3` |
| Ethereum mainnet chain id | 1 |
| Base dispute game factory (Ethereum) | `0x43edb88c4b80fdd2adff2412a7bebf9df42cb40e` (OptimismPortal `0x49048044D57e1C92A77f79988d21Fa8fAF74E97e`) |
| L2ToL1MessagePasser (Base) | `0x4200000000000000000000000000000000000016` |
| EIP-2935 history contract | `0x0000f90827f1c53a10cb7a02335b175320002935`, window 8,191 blocks |
| Base batcher / inbox (blob settlement) | `0x5050f69a9786f081509234f1a7f4684b5e5b76c9` / `0xff00000000000000000000000000000000008453` |
| User chain name | `bitgraph:main` |
| Anchor attribution name | `Ethereum Anchor` |

Published enclave measurements (PCR0):

| Version | From | PCR0 |
|---|---|---|
| genesis | 2026-05-15 | `8530a6399399c4f23d89f5a1faa2e8bf2e09a5959f117070fca08148377f92c902c695fc926c17f67f35f110327dca92` |
| v2 | 2026-06-27 | `bb9dd158703603ec222fe565495ceaa7edc08f665da5c1cddad91442ac2211731390267036d79deb720d13fb704f648a` |
| v4 | 2026-07-05 | `e2fccbae77ee40aac4830e84f195e05d69eb4547bbd961f4d3459feba10807140424aca42ad03810354982598c86b9cb` |
| v5 | 2026-07-29 | `6483cedffed74680ffb287507744a398b288c3fb943eb3f2e4fe889f8b60b3d575ad8942350360b69a1bd7bf713df27f` |
| v6 | 2026-09-05 | `cd8ba52d340fb1be78610b59953ded2ceca23be1cfcc7ab504a26b8fdcd7ba92090f49e28a32d008df046ec4212f77bf` |
| v7 | 2026-09-06 | `394c3cf515651dc27187d85e4716c12dfeb99c1227f1fe0eacfaa427d80018e1a28ebba9469e99c7936601f901d74e1d` |
| v8 | 2026-09-07 | `eccfc1c78006f4b74f929c992785575c908a0f60eca08ff638cd6c0842f993f182ebb002457b8ef3e732a6a10805c72b` |
| v9 | 2026-09-30 | `934feb8bb6f4f7e2d2f85d902a7d5edd0981f706d9d2385638988ac096a05ea0583c3d00eef2a7947865ec66efc1fcf8` |

Each measurement corresponds to a tagged source revision (`enclave-v9` for v9) and a reproducible build recipe; keeping that source available is what lets a reader learn what a PCR0 measures. The first image that fixes a Base floor (`enclave-v10`) is not in this table, and cannot be: its image contains the verifier, which pins this document's hash, so this document is final before that image is built. Its PCR0 is published with its release, by the means section 5.6 names.

---

## 17. Behaviour of the reference implementation worth knowing

These are properties of BitGraph's own verifier as of 2026-10-06. A second implementation should match the first group and be aware of the second.

Match these:

- Canonical JSON key order and number formatting are as in section 2, not RFC 8785.
- Ed25519 follows ZIP-215 (section 3.3).
- Attestation certificate validity is judged at the document's own timestamp (section 5.4).
- The Base ceiling's `status`, `statusObserved`, `anchor.writer`, and the payload's `prev`, first and last positions are not verified.
- A member's path does not establish the order or uniqueness of the other leaves (section 8.6).

Be aware of these:

- Counters are parsed leniently by the reference (section 4); a strict verifier may reject non-canonical decimal strings.
- The reference accepts a set/2 root document whose stated count exceeds the real number of leaves for members that are present; tree/1 has the same property, and only an owner's-list check (section 8.7) catches it.
- The enclave signs any artifact digest whose lenient base64 decode is 32 bytes, while the verifier requires canonical base64; a non-canonical digest fails verification.

---

## 18. Test vectors

| File | Covers |
|---|---|
| `spec/vectors/tree-1.json` | a position record, commitment/2, five files across every placement code (including an empty file and one kept as is), their committed bytes, leaves, the tree, the root document and every member's evidence |
| `spec/vectors/export-1.json` | a member's export and the owner's export, signed with a published test key (not a BitGraph), with the expected result of every offline claim |
| `spec/vectors/tree-1-negative.json` | a signed tree whose leaves are containers that name one original and hold another: for each, the archive, the original it names and the original it holds, none of which is that member |
| `spec/vectors/output-root-1.json` | a real ceiling transaction settled on Ethereum through Base's output root, captured from the live chains |
| `packages/verify/src/__tests__/fixtures/carrier2/` | production proof #4,546: its AWS attestation, its Base ceiling, and a commitment carried inline |
| `src/__tests__/fuse3-fixtures/` | proofs from the enclave v10 code with a Base floor: commitment/3 (`trailer3.vector.json`), a fused file, a file made with the commitment inline, a fuse/2 marker over a Base floor and a fuse/3 marker over a fuse/1 commitment (both refused), and the floor block's header (`floor-base-52271417.*`) |

`spec/tools/check.py` is the independent implementation that checks all of them.
