/**
 * The ledger that replaces the hosted one.
 *
 * Its whole job is answering "do I already hold a BitGraph for these bytes?"
 * and the only dangerous way to be wrong is to answer YES when it should be no
 * — that would show someone a proof that is not about their file. Answering NO
 * when it should be yes is merely a missed convenience, and under the ruling
 * of 2026-09-08 (a clock ticks every time you ask) it is not even a bug.
 *
 * Run: node --test src/lib/__tests__/local-ledger.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyLedger, addProofs, heldFor, stateLine, isBitGraphsFileName,
} from "../local-ledger.ts";
import type { BitGraphProof } from "../bitgraph.ts";

const EPOCH = "P1IPCIeBd/gbBGJnbQVSDhKFeI7wVzTzWYbfvzZlqcs=";
const proof = (counter: string, digest: string, epochId = EPOCH) =>
  ({ version: "bitgraph/1", commit: { counter, epochId },
     artifact: { digestB64: digest } } as unknown as BitGraphProof);

test("bytes it holds are found; bytes it does not are not invented", () => {
  const l = addProofs(emptyLedger(), [proof("10", "AAA="), proof("11", "BBB=")]);
  assert.equal(heldFor(l, "AAA=").length, 1);
  assert.equal(heldFor(l, "CCC=").length, 0, "an unknown digest must never resolve");
});

test("the same position added twice is held once", () => {
  // Dropping the same BitGraphs file twice, or two files that overlap, must
  // not double the count the box states.
  let l = addProofs(emptyLedger(), [proof("10", "AAA=")]);
  l = addProofs(l, [proof("10", "AAA=")]);
  assert.equal(l.proofs.length, 1);
  assert.equal(heldFor(l, "AAA=").length, 1);
});

test("the same counter in a different epoch is a different position", () => {
  const l = addProofs(emptyLedger(), [proof("10", "AAA="), proof("10", "AAA=", "other")]);
  assert.equal(l.proofs.length, 2);
  assert.equal(heldFor(l, "AAA=").length, 2, "both positions these bytes hold");
});

test("bytes BitGraphed more than once report every position", () => {
  const l = addProofs(emptyLedger(), [proof("10", "AAA="), proof("11", "AAA=")]);
  assert.deepEqual(heldFor(l, "AAA=").map((p) => p.commit?.counter), ["10", "11"]);
});

test("adding is immutable, so a failed read cannot corrupt what is connected", () => {
  const before = addProofs(emptyLedger(), [proof("10", "AAA=")]);
  const after = addProofs(before, [proof("11", "BBB=")]);
  assert.equal(before.proofs.length, 1, "the previous ledger is untouched");
  assert.equal(after.proofs.length, 2);
});

test("the state line is a count, never a dot, and never alarming", () => {
  assert.equal(stateLine(emptyLedger(), null), "Drag your BitGraphs folder to connect it");
  assert.equal(stateLine(addProofs(emptyLedger(), [proof("10", "A")]), null), "1 BitGraph connected");
  const many = addProofs(emptyLedger(), Array.from({ length: 1240 }, (_, i) => proof(String(i), `d${i}`)));
  assert.equal(stateLine(many, null), "1,240 BitGraphs connected");
  assert.equal(stateLine(many, 4300), "Reading 4,300…");
  // Nothing here may read as a fault: not-connected is the normal first state.
  for (const s of [stateLine(emptyLedger(), null), stateLine(many, null)]) {
    assert.ok(!/error|fail|missing|not found/i.test(s), s);
  }
});

test("a BitGraphs file is recognised by name, and only by name as a first pass", () => {
  assert.ok(isBitGraphsFileName("bitgraphs.json"));
  assert.ok(isBitGraphsFileName("Photos 2024-bitgraphs.json"));
  assert.ok(!isBitGraphsFileName("bitgraphs.json.txt"));
  assert.ok(!isBitGraphsFileName("proof.json"));
  assert.ok(!isBitGraphsFileName("holiday.jpg"));
});
