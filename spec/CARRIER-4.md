# BitGraphed files, version 4: one member of a tree/1 BitGraph

Status: draft, 2026-10-11. Not pinned in any proof.

This text extends section 15.5 of SPEC.md (v1) and SPEC-v2.md (v2). Both of those specifications are frozen and are not changed by it: their hashes are signed into tree/1 proofs, and a BitGraphed file is never signed (it is an envelope around committed bytes, and its own hash is committed nowhere). Versions 1, 2 and 3 of the BitGraphed file stay exactly as section 15.5 defines them. This document defines version 4.

## 1. Why a fourth version

In a tree/1 BitGraph the signed digest is the SHA-256 of the tree's 84-byte root document (SPEC section 8), not of any file. A file is in the BitGraph through its leaf and the Merkle path from that leaf to the root, which export/1 carries as `tree.member`. Versions 1 to 3 require the SHA-256 of the committed bytes to equal `proof.artifact.digestB64`, so no tree member can travel in them. Version 4 carries the member's evidence in the block and replaces that one rule with the walk from the bytes to the signed digest.

It is a new version, not a field added to version 2 or 3, on purpose. A reader that knows versions 1 to 3 and ignored an extra field would hash the member's bytes against the root document's digest and call a good file FALSE. Given a version it does not know, the same reader reports the block unreadable (UNDETERMINED), which is never a verdict on the file.

## 2. Layout

The block is the one section 15.5 defines, found from the end of the file the same way:

```
file = committed bytes || "BGPROOF\x01" || u32be(L) || payload || u32be(L) || "BGPROOF\x01"
```

The committed bytes are the LEAF's committed bytes: the bytes whose SHA-256 is the leaf's artifact digest. For a leaf kept as is (code 0x00) that is the file itself. For a placed leaf (0x01 trailer/1, 0x02 container/1, 0x03 container/2) it is the file with the commitment placed in it, exactly as section 7 builds it; never the original.

## 3. Payload

```jsonc
{
  "carrier": "bitgraph-carrier/4",
  "proof": { ... },                        // the tree/1 proof, unchanged
  "tree": {
    "rootDocument": "<168 lowercase hex>", // the 84-byte root document
    "member": {                            // export/1's tree.member, exactly
      "index": 0, "count": 1,
      "leaf": "<130 lowercase hex>",       // the 65-byte leaf
      "path": ["<64 lowercase hex>", ...]  // sibling hashes from the leaf up
    }
  },
  "floor": ...,                            // the floor the proof signs, in its own shape:
                                           //   commit.slotAnchor: { "status": "present", "anchor": {...}, "witness": {...} } as version 2
                                           //   commit.slotFloor:  { "status": "present", "basis": "base-header", "header": "0x..." } as version 3
  "ceiling": ...,                          // over an Ethereum floor: { "status": "unfetched" } or a present counter-order anchor, as version 2
                                           // over a Base floor: { "status": "none", "basis": "hash-chain" }, as version 3
  "ceilingInTime": { ... },                // required, as version 2
  "settlement": { ... },                   // optional, as version 2 (the bitgraph-settlement/1 pointer)
  "pins": { ... },                         // optional, declared, never trusted, as version 2
  "attestation": { ... }                   // optional aws-nitro-witness/1, as version 2
}
```

`tree` holds exactly `rootDocument` and `member`; `member` holds exactly `index`, `count`, `leaf` and `path`; every hex string is lowercase; `index` is less than `count`. A payload that breaks any of these, has no `tree`, or pairs a floor with the other floor's ceiling shape is malformed (UNDETERMINED: a damaged block, not a forgery). A `tree` field on a version 1, 2 or 3 payload is not part of those versions and changes nothing about how they are read.

## 4. Verification

A reader judges a version 4 file by sections 3 to 11 with the discipline of section 12.1, as section 15.5 says for the earlier versions, with the bytes checked this way instead of against the signed digest:

1. **The spec.** The proof is tree/1 (`attribution.title`), marked `bitgraph-fuse/2` or `/3`, and pins in `attribution.message` a spec the reader knows, under the marker that spec requires. An unknown spec is UNDETERMINED with every tree claim resting on it, never FALSE (section 8.4).
2. **The root document.** It is 84 bytes of tree/1, its SHA-256 is `proof.artifact.digestB64`, and its commitment is the one recomputed from the proof's own position record and signed floor block (section 6).
3. **The path.** `member.count` equals the root document's count, and the leaf hashed (`SHA-256(0x00 || leaf)`) and walked up `member.path` at `member.index` (section 8.2) reaches the root document's root. A path proves this leaf only, never the order or uniqueness of the others.
4. **The bytes.** SHA-256 of the committed bytes is the leaf's artifact digest. For a placed leaf the bytes must also be a valid instance of the leaf's placement carrying this position's commitment, with the original inside hashing to the leaf's origin (section 7). Bytes that are the leaf's origin and only rebuild the committed bytes are not a version 4 file's committed bytes and are FALSE.
5. **Everything else** (the proof's signature and position record, the attestation and the measurement policy, the floor by the proof's signed `slotAnchor` or `slotFloor`, the ceilings, the settlement pointer, the pins, the confirmed level) exactly as for version 2 or 3.

The verdict is FALSE when any claim is FALSE, TRUE only when every carried claim holds, the image passes the measurement policy on a fully verified attestation, and the tree was judged (steps 1 to 3 TRUE), and UNDETERMINED otherwise.

## 5. What it says

The two floors of section 8.6, said of one member:

- **A placed leaf:** these exact bytes are leaf i of n in the committed tree and carry the commitment, so they were finished after the floor block (the content floor); an original inside them is not dated by it.
- **A leaf kept as is:** these exact bytes are leaf i of n in the committed tree, kept as is: they carry no commitment, so the bytes themselves are not dated (the record floor only).

Either way the record, and with it the leaf, was made after the floor block; the ceiling in position (an Ethereum floor's closing anchor) is a bound in position, never a clock time; the Base block and the Ethereum settlement, when carried, say the record existed by them. The reader states the file's own SHA-256 beside the committed bytes' and says the proof names the tree's root document.

## 6. Making one

A maker holds the member's committed bytes (or the original, from which section 7 rebuilds them) and the member's evidence (from the drop that made it, an export, the owner's list, recovery entries, or for a tree of one the file alone). It checks the bytes against the leaf and the leaf against the signed root before it writes the block, and appends the block to the committed bytes only for formats that ignore trailing data: those trailer/1 uses (JPEG, PNG, GIF, TIFF and the raws built on it, BMP, RIFF), a container placement's tar, and the formats section 15.5's makers already carry (PDF, ZIP-based files under the 60,000-byte block limit, MP4 and QuickTime). Text, SVG, JSON, XML, HTML and anything unrecognized, kept as is, travel with their export instead. A container leaf's BitGraphed file is a tar and is named as one (`name.ext.bitgraph.tar`).
