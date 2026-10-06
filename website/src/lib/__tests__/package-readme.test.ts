// The download package's README (outside review, 2026-10-02): the blob bytes the settlement
// pointer names travel in base-ceiling/blobs/, the README says where else they live, and it
// says plainly that the BitGraphed file's own SHA-256 is not the committed digest.
import { test } from "node:test";
import * as assert from "node:assert/strict";
import { packageReadme, type ReadmeInput } from "../package-layout.ts";

const base: ReadmeInput = {
  recordName: "BitGraph #13,284", epochId: "YF/jPxIu", proofUrl: "https://bitgraph.ing/proof/x",
  committedPath: "committed/IMG.jpeg", originalPath: "original/IMG.jpeg", carrierPath: "bitgraphed-file/IMG.bitgraph.jpeg",
  committedSha256Hex: "c4b6", originalSha256Hex: "aaaa", recordedIso: "2026-10-02T21:11:03.179Z",
  floor: { block: 26107237, iso: "2026-10-02T21:10:35.000Z" },
  ceilingInTime: { block: 52093059, iso: "2026-10-02T21:11:05.000Z", txHash: "0x8c61", reportedStatus: "finalized" },
  settlement: { block: 26107241, iso: "2026-10-02T21:11:23.000Z", txHash: "0x0504" },
  ceilingInPosition: { anchorCounter: "13286", block: 26107238, iso: "2026-10-02T21:10:47.000Z" },
  pcr0: "934f", enclaveTag: "enclave-v9", writer: "0xf397", hasAnchorsBefore: true, hasAnchorsAfter: true,
  versions: { verify: "1.15.1", audit: "0.8.0", sdk: "0.3.0" },
};

test("with every blob in the package, the README lists the folder and says the settlement checks offline in full", () => {
  const t = packageReadme({ ...base, settlementBlobs: { inPackage: ["0x01aa.bin", "0x01bb.bin"], missing: [] } });
  assert.match(t, /- base-ceiling\/blobs\/\n  The Ethereum blob data that carries the Base batch \(2 files/);
  assert.match(t, /The blob bytes are in base-ceiling\/blobs\/\. bitgraph-audit checks each one against its KZG commitment/);
  assert.match(t, /https:\/\/bitgraph\.ing\/api\/ceilings\/blobs\/<versioned hash>\.bin/);
  assert.match(t, /Checked offline from this folder: yes, the pointer and the blob bytes/);
});

test("a blob that could not be fetched is named, with where to get it", () => {
  const t = packageReadme({ ...base, settlementBlobs: { inPackage: ["0x01aa.bin"], missing: ["0x01bb"] } });
  assert.match(t, /1 of the blob files could not be fetched when this package was built \(0x01bb\)/);
  assert.match(t, /Put them in base-ceiling\/blobs\/ and run the audit again/);
  assert.doesNotMatch(t, /yes, the pointer and the blob bytes/);
});

test("the README says the BitGraphed file's own hash is not the committed digest", () => {
  const t = packageReadme({ ...base, settlementBlobs: null });
  assert.match(t, /Its own SHA-256 is not the committed digest and is not supposed to be/);
  assert.match(t, /- bitgraphed-file\/IMG\.bitgraph\.jpeg\n  Its own SHA-256 is not the artifact digest/);
  assert.doesNotMatch(t, /^- base-ceiling\/blobs\/$/m, "no blobs folder entry when no blobs are in the package");
  assert.match(t, /The blob bytes are not in this package\./);
});

test("a Base stamp after the recorded time is stated as the time the record existed by", () => {
  const t = packageReadme({ ...base, settlementBlobs: null });
  assert.match(t, /existed by Base block 52,093,059 \(2026-10-02 21:11:05 UTC\)\./);
  assert.doesNotMatch(t, /not a time bound for this record/i);
});

test("a Base block stamped in the past, as after a halt, is named but its time is never stated as a bound", () => {
  // Recorded 21:11:03; Base refilled a halt with a block stamped 21:11:00, after the floor but 3 s before the record.
  const t = packageReadme({ ...base, settlementBlobs: null, ceilingInTime: { ...base.ceilingInTime!, iso: "2026-10-02T21:11:00.000Z" } });
  assert.doesNotMatch(t, /existed by Base block 52,093,059 \(/, "the claim never pairs the block with its stamp");
  assert.match(t, /existed by Base block 52,093,059\. That block's own time is not a bound for this record: Base stamped this block 2026-10-02T21:11:00Z, more than 2 s before the attestation document was made/);
  assert.match(t, /Not a time bound for this record: Base stamped this block/);
  assert.doesNotMatch(t, /the Base block is the upper bound in time/, "no step calls a withheld stamp the bound");
  // A stamp before the floor block is withheld too, for that reason.
  const early = packageReadme({ ...base, settlementBlobs: null, ceilingInTime: { ...base.ceilingInTime!, iso: "2026-10-02T21:05:01.000Z" } });
  assert.match(early, /before the floor block's own time/);
  // Two seconds of slack (one Base block) is still a bound.
  const edge = packageReadme({ ...base, settlementBlobs: null, ceilingInTime: { ...base.ceilingInTime!, iso: "2026-10-02T21:11:02.000Z" } });
  assert.doesNotMatch(edge, /not a time bound for this record/i);
});
