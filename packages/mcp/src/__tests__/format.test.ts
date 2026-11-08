// Copyright (c) 2025-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { toUrlSafeB64 } from "@mikeargento/bitgraph-sdk";
import { capJson, proofUrl, renderProofMarkdown, renderRecordMarkdown } from "../format.js";
import type { ProofDetailResponse } from "@mikeargento/bitgraph-sdk";

const DIGEST = createHash("sha256").update("bitgraph").digest("base64");
const EPOCH = createHash("sha256").update("epoch").digest("base64");

test("proofUrl pins a position with url-safe encodings", () => {
  const url = proofUrl("https://bitgraph.ing", DIGEST, "42", EPOCH);
  assert.ok(url.startsWith(`https://bitgraph.ing/proof/${encodeURIComponent(toUrlSafeB64(DIGEST))}`));
  assert.ok(url.includes("counter=42"));
  assert.ok(url.includes(`epoch=${encodeURIComponent(toUrlSafeB64(EPOCH))}`));
  assert.ok(!url.includes("+") && !url.includes("=="), "no raw standard-b64 leaks into the URL");
});

test("proofUrl without a position has no query string", () => {
  assert.ok(!proofUrl("https://bitgraph.ing", DIGEST).includes("?"));
});

const proof = (counter: string) => ({ artifact: { digestB64: DIGEST }, commit: { nonceB64: "Tk9OQ0U=", slotCounter: String(Number(counter) - 1), counter, epochId: EPOCH } });

test("record markdown names the BitGraph, its nonce and counts, then each file", () => {
  const made = { kind: "file" as const, number: "7", counts: ["6", "7"] as [string, string], nonce: "Tk9OQ0U=", epoch: EPOCH, prev: null, digestB64: DIGEST, proof: proof("7"), proofUrl: "https://bitgraph.ing/proof/x?counter=7", tree: null };
  const md = renderRecordMarkdown({ made, files: [{ path: "/a", digestB64: DIGEST, outcome: "made", number: "7", nonce: "Tk9OQ0U=", proof: proof("7"), proofUrl: made.proofUrl, proofPath: "/a.bitgraph.json", member: null }] });
  assert.ok(md.startsWith("Made BitGraph #7 of 1 file."), md);
  assert.ok(md.includes("- Nonce: Tk9OQ0U="), md);
  assert.ok(md.includes("- Counts: 6, 7 (the fresh nonce at the first, the file's SHA-256 at the next)"), md);
  assert.ok(md.includes("- made · /a\n  proof saved: /a.bitgraph.json"), md);
  assert.ok(!md.includes("\u2014"), "no em dashes");
  assert.doesNotMatch(md, /Base|anchor|ceiling|floor|fuse/i);
});

test("record markdown for a tree says how many files, which file each is, and what was already on record", () => {
  const made = { kind: "tree" as const, number: "9", counts: ["8", "9"] as [string, string], nonce: "Tk9OQ0U=", epoch: EPOCH, prev: null, digestB64: DIGEST, proof: proof("9"), proofUrl: "https://bitgraph.ing/proof/r?counter=9", tree: { files: 2, root: "00".repeat(32), rootText: "x", indexed: 2, indexError: null } };
  const md = renderRecordMarkdown({
    made,
    files: [
      { path: "/a", digestB64: DIGEST, outcome: "made", number: "9", nonce: "Tk9OQ0U=", proof: proof("9"), proofUrl: made.proofUrl, proofPath: "/a.bitgraph.json", member: { index: 0, files: 2 } },
      { path: "/b", digestB64: DIGEST, outcome: "made", number: "9", nonce: "Tk9OQ0U=", proof: proof("9"), proofUrl: made.proofUrl, proofPath: null, member: { index: 1, files: 2 } },
      { path: "/c", digestB64: DIGEST, outcome: "on record", number: "3", nonce: "T0xE", proof: proof("3"), proofUrl: "https://bitgraph.ing/proof/c", proofPath: null, member: null },
    ],
  });
  assert.ok(md.startsWith("Made BitGraph #9 of 2 files as one tree."), md);
  assert.ok(md.includes("Each file is indexed under its own hash (2 of 2)."), md);
  assert.ok(md.includes("- made · /a (file 1 of 2)"), md);
  assert.ok(md.includes("- made · /b (file 2 of 2)\n  proof not saved (write=false)"), md);
  assert.ok(md.includes("- already a BitGraph · #3 · /c\n  nonce T0xE"), md);
  assert.ok(renderRecordMarkdown({ made: null, files: [] }).startsWith("Nothing new was made."));
});

test("proof markdown states the nonce, the two counts and the tree position", () => {
  const detail: ProofDetailResponse = {
    proofs: [{ proof: { ...proof("42"), commit: { ...proof("42").commit, prevB64: "UFJFVg==" } } }],
    positions: [{ counter: "42", epoch: toUrlSafeB64(EPOCH), member: { index: 1, count: 3 } }],
  };
  const md = renderProofMarkdown(detail, "https://bitgraph.ing");
  assert.ok(md.includes("# BitGraph #42"));
  assert.ok(md.includes("- Nonce: Tk9OQ0U="), md);
  assert.ok(md.includes("- Counts: 41, 42"), md);
  assert.ok(md.includes("- Previous proof: UFJFVg=="), md);
  assert.ok(md.includes("- Tree: file 2 of 3"), md);
  assert.doesNotMatch(md, /Base|anchor|ceiling|floor|Etherscan/);
});

test("capJson elides large attestation reports before truncating", () => {
  const value = {
    proof: { environment: { attestation: { reportB64: "A".repeat(40_000) } }, note: "keep me" },
  };
  const { text, truncated } = capJson(value);
  assert.ok(truncated);
  assert.ok(text.includes("elided 40000 base64 chars"));
  assert.ok(text.includes("keep me"));
  assert.ok(text.length <= 25_000 + 200);
});
