/**
 * The file a make ends in.
 *
 * Once only anchors are written, this file IS the BitGraph, so the two things
 * that matter are that it stays small enough to save on every make, and that
 * what it holds is the part you cannot reconstruct.
 *
 * Run: node --test src/lib/__tests__/bitgraphs-file.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildBitGraphsFile, bitgraphsFileName, readBitGraphsFile, BITGRAPHS_VERSION,
} from "../bitgraphs-file.ts";
import type { BitGraphProof } from "../bitgraph.ts";

const EPOCH = "P1IPCIeBd/gbBGJnbQVSDhKFeI7wVzTzWYbfvzZlqcs=";
const proofAt = (counter: string, epochId = EPOCH) =>
  ({ version: "bitgraph/1", commit: { counter, epochId },
     artifact: { digestB64: `d${counter}` } } as unknown as BitGraphProof);
const row = (p: BitGraphProof) => ({ proof: p, proofs: [p] });

test("48,000 members of three sets write THREE proofs, not 48,000", () => {
  // A set is one position sharing one proof, whose committed digest IS the
  // manifest of every member. Writing it per member is the same mistake as
  // asking the ledger 48,000 times: it turns ~23 KB into hundreds of MB.
  const shared = ["1546", "1547", "1548"].map((c) => proofAt(c));
  const rows = Array.from({ length: 48_000 }, (_, i) => row(shared[i % 3]));
  const doc = buildBitGraphsFile(rows, "Photos 2024");
  assert.equal(doc.proofs.length, 3);
  // And it is genuinely small, which is what lets every make save one.
  assert.ok(JSON.stringify(doc).length < 4000, "a drop of any size stays instant to save");
});

test("the same counter in a different epoch is a different position", () => {
  const doc = buildBitGraphsFile(
    [row(proofAt("10")), row(proofAt("10", "another-epoch"))], null);
  assert.equal(doc.proofs.length, 2);
});

test("a file BitGraphed more than once keeps every position it holds", () => {
  const doc = buildBitGraphsFile([{ proof: proofAt("10"), proofs: [proofAt("10"), proofAt("11")] }], null);
  assert.deepEqual(doc.proofs.map((p) => p.commit?.counter), ["10", "11"]);
});

test("nothing lists the files, because matching is by content", () => {
  const doc = buildBitGraphsFile([row(proofAt("10"))], "Photos 2024");
  assert.deepEqual(Object.keys(doc).sort(), ["proofs", "savedAt", "source", "version"]);
  // A name or path in here would be a second source of truth that goes stale
  // the moment anyone renames anything. The site re-hashes what you drop.
  assert.ok(!JSON.stringify(doc).includes("\"name\""));
});

test("the name carries the folder, and says nothing it does not know", () => {
  assert.equal(bitgraphsFileName("Photos 2024"), "Photos 2024-bitgraphs.json");
  /* A drop of loose files has no folder name to borrow. It used to fall back
     to the bare "bitgraphs.json" and lean on the browser's de-duplication,
     which produced "bitgraphs (1).json" and told the reader nothing about what
     was in it or when. A timestamp is not a good name; it is a name. */
  const at = new Date(2026, 8, 8, 17, 46);
  assert.equal(bitgraphsFileName(null, at), "bitgraphs-2026-09-08-1746.json");
  assert.equal(bitgraphsFileName("  ", at), "bitgraphs-2026-09-08-1746.json");
  // Two loose drops a minute apart cannot collide.
  assert.notEqual(bitgraphsFileName(null, at), bitgraphsFileName(null, new Date(2026, 8, 8, 17, 47)));
  // Path separators and control characters cannot escape the filename.
  assert.equal(bitgraphsFileName("a/b:c*d"), "a b c d-bitgraphs.json");
});

test("a file that half-parses still yields the evidence it holds", () => {
  // Someone still holds proofs in it; refusing to read it helps nobody.
  const back = readBitGraphsFile(JSON.stringify(
    { version: BITGRAPHS_VERSION, proofs: [proofAt("10"), null, "nope"] }));
  assert.equal(back?.proofs.length, 1);
  assert.equal(readBitGraphsFile("not json"), null);
  assert.equal(readBitGraphsFile(JSON.stringify({ proofs: "no" })), null);
});

test("a round trip keeps every position", () => {
  const doc = buildBitGraphsFile([row(proofAt("10")), row(proofAt("11"))], "Drop");
  const back = readBitGraphsFile(JSON.stringify(doc));
  assert.deepEqual(back?.proofs.map((p) => p.commit?.counter), ["10", "11"]);
  assert.equal(back?.source, "Drop");
});
