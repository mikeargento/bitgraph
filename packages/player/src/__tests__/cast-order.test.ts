// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { resolveRole } from "../cast.js";
import { compare } from "../order.js";
import { digestFor, makeAudit, proofHashOf } from "./fixtures.js";
import type { ObservedProof } from "@mikeargento/bitgraph-audit";

const D1 = digestFor("doc-one");
const D2 = digestFor("doc-two");

function proofByName(audit: ReturnType<typeof makeAudit>, name: string): ObservedProof {
  const p = audit.ingest.proofs.find((x) => x.proofHash === proofHashOf(name));
  assert.ok(p, `fixture proof ${name}`);
  return p as ObservedProof;
}

// ---------------------------------------------------------------------------
// Cast resolution: the multiplicity table.
// ---------------------------------------------------------------------------

test("exactly one verified match resolves", () => {
  const audit = makeAudit({
    proofs: [{ name: "a", digestB64: D1, epochId: "E1", counter: "10" }],
    partitions: [{ epochId: "E1", members: ["a"] }],
  });
  const res = resolveRole("doc", { digest: D1 }, audit);
  assert.equal(res.kind, "resolved");
});

test("zero matches: absent, optional vs required distinguished", () => {
  const audit = makeAudit({ proofs: [] });
  const required = resolveRole("doc", { digest: D1 }, audit);
  assert.deepEqual(required, { kind: "absent", role: "doc", optional: false });
  const optional = resolveRole("doc", { digest: D1, optional: true }, audit);
  assert.deepEqual(optional, { kind: "absent", role: "doc", optional: true });
});

test("two recordings of the same bits with no pin is ambiguous, never a silent pick", () => {
  const audit = makeAudit({
    proofs: [
      { name: "a1", digestB64: D1, epochId: "E1", counter: "10" },
      { name: "a2", digestB64: D1, epochId: "E2", counter: "3" },
    ],
    partitions: [
      { epochId: "E1", members: ["a1"] },
      { epochId: "E2", members: ["a2"], publicKeyB64: "key-B" },
    ],
  });
  const res = resolveRole("doc", { digest: D1 }, audit);
  assert.equal(res.kind, "ambiguous");
  assert.equal((res as { matchCount: number }).matchCount, 2);
});

test("a pin selects one occurrence among several", () => {
  const audit = makeAudit({
    proofs: [
      { name: "a1", digestB64: D1, epochId: "E1", counter: "10" },
      { name: "a2", digestB64: D1, epochId: "E2", counter: "3" },
    ],
  });
  const byHash = resolveRole("doc", { digest: D1, at: { proofHash: proofHashOf("a2") } }, audit);
  assert.equal(byHash.kind, "resolved");
  assert.equal((byHash as { proof: ObservedProof }).proof.proofHash, proofHashOf("a2"));

  const byPosition = resolveRole(
    "doc",
    { digest: D1, at: { epochId: "E1", counter: "10" } },
    audit
  );
  assert.equal(byPosition.kind, "resolved");
  assert.equal((byPosition as { proof: ObservedProof }).proof.proofHash, proofHashOf("a1"));
});

test("a pin matching nothing is invalid, not silently ignored", () => {
  const audit = makeAudit({
    proofs: [{ name: "a1", digestB64: D1, epochId: "E1", counter: "10" }],
  });
  const res = resolveRole("doc", { digest: D1, at: { proofHash: "nope" } }, audit);
  assert.equal(res.kind, "invalid");
});

test("matches that all fail verification are invalid, not absent", () => {
  // "Only broken recordings" and "no recordings" are different situations:
  // only the second supports a closed-world absence claim.
  const audit = makeAudit({
    proofs: [{ name: "a1", digestB64: D1, epochId: "E1", counter: "10", verified: false }],
  });
  const res = resolveRole("doc", { digest: D1, optional: true }, audit);
  assert.equal(res.kind, "invalid");
});

test("a failed-verification copy does not shadow the verified recording", () => {
  const audit = makeAudit({
    proofs: [
      { name: "bad", digestB64: D1, epochId: "E1", counter: "9", verified: false },
      { name: "good", digestB64: D1, epochId: "E1", counter: "10" },
    ],
  });
  const res = resolveRole("doc", { digest: D1 }, audit);
  assert.equal(res.kind, "resolved");
  assert.equal((res as { proof: ObservedProof }).proof.proofHash, proofHashOf("good"));
});

// ---------------------------------------------------------------------------
// Ordering: same partition.
// ---------------------------------------------------------------------------

test("a directed prevB64 path is chain-link, strict, both directions", () => {
  const audit = makeAudit({
    proofs: [
      { name: "a", digestB64: D1, epochId: "E1", counter: "10" },
      { name: "b", digestB64: D2, epochId: "E1", counter: "20", prev: "a" },
    ],
    partitions: [{ epochId: "E1", members: ["a", "b"], components: [["a", "b"]] }],
  });
  const ab = compare(proofByName(audit, "a"), proofByName(audit, "b"), audit);
  assert.equal(ab.relation, "before");
  assert.equal(ab.basis, "chain-link");
  assert.equal(ab.tier, "hash-linked");
  assert.equal(ab.weaker, false);
  assert.equal(ab.assumptionDependent, false);
  const ba = compare(proofByName(audit, "b"), proofByName(audit, "a"), audit);
  assert.equal(ba.relation, "after");
});

test("fork branches with no path between them are counter-order, NOT chain-link", () => {
  // Predecessor-reuse fork: x and y both link to g, no path between them.
  // Their relative order rests solely on counter discipline — which the
  // fork itself demonstrates is broken — so the hash-linked tier must not
  // be claimed even though all three share one undirected component.
  const audit = makeAudit({
    proofs: [
      { name: "g", digestB64: digestFor("genesis"), epochId: "E1", counter: "1" },
      { name: "x", digestB64: D1, epochId: "E1", counter: "2", prev: "g" },
      { name: "y", digestB64: D2, epochId: "E1", counter: "3", prev: "g" },
    ],
    partitions: [{ epochId: "E1", members: ["g", "x", "y"], components: [["g", "x", "y"]] }],
  });
  const xy = compare(proofByName(audit, "x"), proofByName(audit, "y"), audit);
  assert.equal(xy.relation, "before");
  assert.equal(xy.basis, "counter-order");
  assert.equal(xy.tier, "assumption-dependent");
  assert.equal(xy.weaker, true);
});

test("a verified path contradicted by the counters is an anomaly, not an order", () => {
  // b hash-links after a, but b's counter is SMALLER: link and counter
  // evidence disagree, so neither may answer.
  const audit = makeAudit({
    proofs: [
      { name: "a", digestB64: D1, epochId: "E1", counter: "20" },
      { name: "b", digestB64: D2, epochId: "E1", counter: "10", prev: "a" },
    ],
    partitions: [{ epochId: "E1", members: ["a", "b"], components: [["a", "b"]] }],
  });
  assert.equal(compare(proofByName(audit, "a"), proofByName(audit, "b"), audit).relation, "unordered");
});

test("non-decimal counters are no counter evidence: no crash, no fabricated order", () => {
  for (const bad of ["abc", "1e5", "0x10", "-3", " 7 ", ""]) {
    const audit = makeAudit({
      proofs: [
        { name: "a", digestB64: D1, epochId: "E1", counter: bad },
        { name: "b", digestB64: D2, epochId: "E1", counter: "20" },
      ],
      partitions: [{ epochId: "E1", members: ["a", "b"], components: [["a"], ["b"]] }],
    });
    const result = compare(proofByName(audit, "a"), proofByName(audit, "b"), audit);
    assert.equal(result.relation, "unordered", `counter ${JSON.stringify(bad)}`);
  }
});

test("different components in one partition: counter-order, assumption-dependent", () => {
  const audit = makeAudit({
    proofs: [
      { name: "a", digestB64: D1, epochId: "E1", counter: "10" },
      { name: "b", digestB64: D2, epochId: "E1", counter: "20" },
    ],
    partitions: [{ epochId: "E1", members: ["a", "b"], components: [["a"], ["b"]] }],
  });
  const ab = compare(proofByName(audit, "a"), proofByName(audit, "b"), audit);
  assert.equal(ab.relation, "before");
  assert.equal(ab.basis, "counter-order");
  assert.equal(ab.assumptionDependent, true);
  assert.equal(ab.weaker, true);
});

test("interleaved slot/commit ranges with clear commit order is BEFORE, not needless UNDETERMINED", () => {
  // A reserved its slot first (48) but committed second (51); B reserved
  // second (49) but committed first (50). The artifact position is the
  // commit position; commit order decides.
  const audit = makeAudit({
    proofs: [
      { name: "b", digestB64: D2, epochId: "E1", counter: "50", slotCounter: "49" },
      { name: "a", digestB64: D1, epochId: "E1", counter: "51", slotCounter: "48", prev: "b" },
    ],
    partitions: [{ epochId: "E1", members: ["a", "b"], components: [["a", "b"]] }],
  });
  const ba = compare(proofByName(audit, "b"), proofByName(audit, "a"), audit);
  assert.equal(ba.relation, "before");
  assert.equal(ba.basis, "chain-link");
});

test("equal commit counters on distinct recordings is an anomaly, not an order", () => {
  const audit = makeAudit({
    proofs: [
      { name: "a", digestB64: D1, epochId: "E1", counter: "10" },
      { name: "b", digestB64: D2, epochId: "E1", counter: "10" },
    ],
    partitions: [{ epochId: "E1", members: ["a", "b"], components: [["a"], ["b"]] }],
  });
  assert.equal(compare(proofByName(audit, "a"), proofByName(audit, "b"), audit).relation, "unordered");
});

test("same recording for both roles is 'same'", () => {
  const audit = makeAudit({
    proofs: [{ name: "a", digestB64: D1, epochId: "E1", counter: "10" }],
    partitions: [{ epochId: "E1", members: ["a"] }],
  });
  const p = proofByName(audit, "a");
  assert.equal(compare(p, p, audit).relation, "same");
});

// ---------------------------------------------------------------------------
// Ordering: across partitions and epochs.
// ---------------------------------------------------------------------------

test("same epochId under different signer keys is not counter-comparable", () => {
  const audit = makeAudit({
    proofs: [
      { name: "a", digestB64: D1, epochId: "E1", counter: "10", publicKeyB64: "key-A" },
      { name: "b", digestB64: D2, epochId: "E1", counter: "20", publicKeyB64: "key-B" },
    ],
    partitions: [
      { epochId: "E1", members: ["a"], publicKeyB64: "key-A" },
      { epochId: "E1", members: ["b"], publicKeyB64: "key-B" },
    ],
  });
  assert.equal(compare(proofByName(audit, "a"), proofByName(audit, "b"), audit).relation, "unordered");
});

test("a covered epochLink succession orders the pair at the hash-linked tier", () => {
  // a IS the referenced predecessor; b carries the link (successor key).
  const audit = makeAudit({
    proofs: [
      { name: "a", digestB64: D1, epochId: "E1", counter: "999", publicKeyB64: "key-A" },
      { name: "b", digestB64: D2, epochId: "E2", counter: "1", publicKeyB64: "key-B" },
    ],
    partitions: [
      { epochId: "E1", members: ["a"], publicKeyB64: "key-A" },
      { epochId: "E2", members: ["b"], publicKeyB64: "key-B" },
    ],
    edges: [{ predecessor: "a", via: "b" }],
  });
  const ab = compare(proofByName(audit, "a"), proofByName(audit, "b"), audit);
  assert.equal(ab.relation, "before");
  assert.equal(ab.basis, "epoch-lineage");
  assert.equal(ab.tier, "hash-linked");
  assert.equal(ab.assumptionDependent, false);
  const ba = compare(proofByName(audit, "b"), proofByName(audit, "a"), audit);
  assert.equal(ba.relation, "after");
});

test("lineage covers a path-linked ancestor of the referenced predecessor at hash-linked tier", () => {
  const audit = makeAudit({
    proofs: [
      { name: "a0", digestB64: digestFor("earlier"), epochId: "E1", counter: "5", publicKeyB64: "key-A" },
      { name: "p", digestB64: D1, epochId: "E1", counter: "999", publicKeyB64: "key-A", prev: "a0" },
      { name: "b", digestB64: D2, epochId: "E2", counter: "1", publicKeyB64: "key-B" },
    ],
    partitions: [
      { epochId: "E1", members: ["a0", "p"], publicKeyB64: "key-A", components: [["a0", "p"]] },
      { epochId: "E2", members: ["b"], publicKeyB64: "key-B" },
    ],
    edges: [{ predecessor: "p", via: "b" }],
  });
  const result = compare(proofByName(audit, "a0"), proofByName(audit, "b"), audit);
  assert.equal(result.relation, "before");
  assert.equal(result.tier, "hash-linked");
});

test("counter-only predecessor coverage downgrades lineage to the assumption-dependent tier", () => {
  // a1 is not path-linked to the referenced predecessor p; only its
  // smaller counter places it before p, so the whole answer rests on
  // counter discipline.
  const audit = makeAudit({
    proofs: [
      { name: "a1", digestB64: digestFor("unlinked"), epochId: "E1", counter: "7", publicKeyB64: "key-A" },
      { name: "p", digestB64: D1, epochId: "E1", counter: "999", publicKeyB64: "key-A" },
      { name: "b", digestB64: D2, epochId: "E2", counter: "1", publicKeyB64: "key-B" },
    ],
    partitions: [
      { epochId: "E1", members: ["a1", "p"], publicKeyB64: "key-A", components: [["a1"], ["p"]] },
      { epochId: "E2", members: ["b"], publicKeyB64: "key-B" },
    ],
    edges: [{ predecessor: "p", via: "b" }],
  });
  const result = compare(proofByName(audit, "a1"), proofByName(audit, "b"), audit);
  assert.equal(result.relation, "before");
  assert.equal(result.basis, "epoch-lineage");
  assert.equal(result.tier, "assumption-dependent");
});

test("lineage does NOT cover a recording after the referenced predecessor", () => {
  // a2's counter exceeds the referenced predecessor's: the link only
  // evidences that E2 began after p existed, which says nothing about a2.
  const audit = makeAudit({
    proofs: [
      { name: "p", digestB64: D1, epochId: "E1", counter: "10", publicKeyB64: "key-A" },
      { name: "a2", digestB64: digestFor("later"), epochId: "E1", counter: "999", publicKeyB64: "key-A" },
      { name: "b", digestB64: D2, epochId: "E2", counter: "1", publicKeyB64: "key-B" },
    ],
    partitions: [
      { epochId: "E1", members: ["p", "a2"], publicKeyB64: "key-A", components: [["p"], ["a2"]] },
      { epochId: "E2", members: ["b"], publicKeyB64: "key-B" },
    ],
    edges: [{ predecessor: "p", via: "b" }],
  });
  assert.equal(compare(proofByName(audit, "a2"), proofByName(audit, "b"), audit).relation, "unordered");
});

test("a self-declared epochId string cannot ride another epoch's lineage", () => {
  // evil declares epochId "E2" under its own key; the lineage edge covers
  // only the partition the via proof belongs to, so evil gets nothing.
  const audit = makeAudit({
    proofs: [
      { name: "a", digestB64: D1, epochId: "E1", counter: "10", publicKeyB64: "key-A" },
      { name: "b", digestB64: digestFor("real-successor"), epochId: "E2", counter: "1", publicKeyB64: "key-B" },
      { name: "evil", digestB64: D2, epochId: "E2", counter: "1", publicKeyB64: "key-EVIL" },
    ],
    partitions: [
      { epochId: "E1", members: ["a"], publicKeyB64: "key-A" },
      { epochId: "E2", members: ["b"], publicKeyB64: "key-B" },
      { epochId: "E2", members: ["evil"], publicKeyB64: "key-EVIL" },
    ],
    edges: [{ predecessor: "a", via: "b" }],
  });
  assert.equal(compare(proofByName(audit, "a"), proofByName(audit, "evil"), audit).relation, "unordered");
});

test("anchor bounds order cross-epoch recordings only on strict block inequality", () => {
  const audit = makeAudit({
    proofs: [
      { name: "a", digestB64: D1, epochId: "E1", counter: "5", publicKeyB64: "key-A" },
      { name: "b", digestB64: D2, epochId: "E2", counter: "5", publicKeyB64: "key-B" },
    ],
    partitions: [
      { epochId: "E1", members: ["a"], publicKeyB64: "key-A" },
      { epochId: "E2", members: ["b"], publicKeyB64: "key-B" },
    ],
    segments: [
      {
        members: ["a"],
        upperBounds: [{ blockNumber: "100", timestamp: 1000, basis: "causal-precedence" }],
      },
      {
        members: ["b"],
        lowerBounds: [{ blockNumber: "200", timestamp: 2000 }],
      },
    ],
  });
  const ab = compare(proofByName(audit, "a"), proofByName(audit, "b"), audit);
  assert.equal(ab.relation, "before");
  assert.equal(ab.basis, "anchor-bounds");
  assert.equal(ab.assumptionDependent, true);
  const ba = compare(proofByName(audit, "b"), proofByName(audit, "a"), audit);
  assert.equal(ba.relation, "after");
});

test("equal anchor blocks prove nothing: overlapping windows stay unordered", () => {
  const audit = makeAudit({
    proofs: [
      { name: "a", digestB64: D1, epochId: "E1", counter: "5", publicKeyB64: "key-A" },
      { name: "b", digestB64: D2, epochId: "E2", counter: "5", publicKeyB64: "key-B" },
    ],
    partitions: [
      { epochId: "E1", members: ["a"], publicKeyB64: "key-A" },
      { epochId: "E2", members: ["b"], publicKeyB64: "key-B" },
    ],
    segments: [
      { members: ["a"], upperBounds: [{ blockNumber: "100", timestamp: 1000 }] },
      { members: ["b"], lowerBounds: [{ blockNumber: "100", timestamp: 1000 }] },
    ],
  });
  assert.equal(compare(proofByName(audit, "a"), proofByName(audit, "b"), audit).relation, "unordered");
});

test("anchor bounds strict in BOTH directions are contradictory: unordered", () => {
  const audit = makeAudit({
    proofs: [
      { name: "a", digestB64: D1, epochId: "E1", counter: "5", publicKeyB64: "key-A" },
      { name: "b", digestB64: D2, epochId: "E2", counter: "5", publicKeyB64: "key-B" },
    ],
    partitions: [
      { epochId: "E1", members: ["a"], publicKeyB64: "key-A" },
      { epochId: "E2", members: ["b"], publicKeyB64: "key-B" },
    ],
    segments: [
      {
        members: ["a"],
        upperBounds: [{ blockNumber: "100", timestamp: 1000 }],
        lowerBounds: [{ blockNumber: "500", timestamp: 5000 }],
      },
      {
        members: ["b"],
        upperBounds: [{ blockNumber: "100", timestamp: 1000 }],
        lowerBounds: [{ blockNumber: "500", timestamp: 5000 }],
      },
    ],
  });
  assert.equal(compare(proofByName(audit, "a"), proofByName(audit, "b"), audit).relation, "unordered");
});

test("integrity-tier passes resolve: a proof verified without artifact bytes is a recording", () => {
  const audit = makeAudit({
    proofs: [{ name: "a", digestB64: D1, epochId: "E1", counter: "10", tier: "integrity" }],
    partitions: [{ epochId: "E1", members: ["a"] }],
  });
  const res = resolveRole("doc", { digest: D1 }, audit);
  assert.equal(res.kind, "resolved");
  assert.equal((res as { verificationTier: string }).verificationTier, "integrity");
});

test("weaker bound evidence propagates to the answer", () => {
  const audit = makeAudit({
    proofs: [
      { name: "a", digestB64: D1, epochId: "E1", counter: "5", publicKeyB64: "key-A" },
      { name: "b", digestB64: D2, epochId: "E2", counter: "5", publicKeyB64: "key-B" },
    ],
    partitions: [
      { epochId: "E1", members: ["a"], publicKeyB64: "key-A" },
      { epochId: "E2", members: ["b"], publicKeyB64: "key-B" },
    ],
    segments: [
      {
        members: ["a"],
        upperBounds: [{ blockNumber: "100", timestamp: 1000, evidence: "counter-order", weaker: true }],
      },
      { members: ["b"], lowerBounds: [{ blockNumber: "200", timestamp: 2000 }] },
    ],
  });
  const ab = compare(proofByName(audit, "a"), proofByName(audit, "b"), audit);
  assert.equal(ab.relation, "before");
  assert.equal(ab.weaker, true);
});

test("concurrent epochs with no evidence are unordered", () => {
  const audit = makeAudit({
    proofs: [
      { name: "a", digestB64: D1, epochId: "E1", counter: "5", publicKeyB64: "key-A" },
      { name: "b", digestB64: D2, epochId: "E2", counter: "5", publicKeyB64: "key-B" },
    ],
    partitions: [
      { epochId: "E1", members: ["a"], publicKeyB64: "key-A" },
      { epochId: "E2", members: ["b"], publicKeyB64: "key-B" },
    ],
  });
  assert.equal(compare(proofByName(audit, "a"), proofByName(audit, "b"), audit).relation, "unordered");
});

test("chainless recordings hold no causal position to compare", () => {
  const audit = makeAudit({
    proofs: [
      { name: "a", digestB64: D1 },
      { name: "b", digestB64: D2, epochId: "E1", counter: "5" },
    ],
    partitions: [{ epochId: "E1", members: ["b"] }],
    unchained: ["a"],
  });
  assert.equal(compare(proofByName(audit, "a"), proofByName(audit, "b"), audit).relation, "unordered");
});
