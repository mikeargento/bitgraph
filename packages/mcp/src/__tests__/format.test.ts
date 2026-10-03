// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

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

test("record markdown mentions again=true only when something was already on record", () => {
  const base = {
    digest: toUrlSafeB64(DIGEST),
    counter: "7",
    epoch: toUrlSafeB64(EPOCH),
    total_positions: 1,
    proof_url: "https://bitgraph.ing/proof/x",
  };
  const fresh = renderRecordMarkdown([{ ...base, path: "/a", outcome: "fused", artifact_digest: "ZnVzZWQ", placement: "container/2", member: 1, member_count: 1 }]);
  assert.ok(!fresh.includes("again=true"));
  const mixed = renderRecordMarkdown([
    { ...base, path: "/a", outcome: "fused", artifact_digest: "ZnVzZWQ", placement: "container/2", member: 1, member_count: 1 },
    { ...base, path: "/b", outcome: "on record", artifact_digest: null, placement: null, member: null, member_count: null },
  ]);
  assert.ok(mixed.includes("again=true"));
  assert.ok(mixed.startsWith("1 fused, 1 already on record."));
});

test("record markdown names the tree once, its files by leaf, as is apart, and the export with what completes it", () => {
  const tree = {
    format: "tree/1" as const,
    count: 3,
    counter: "1386",
    epoch: toUrlSafeB64(EPOCH),
    artifact_digest: "dHJlZQ",
    proof_url: "https://bitgraph.ing/proof/dHJlZQ?counter=1386",
    root_document: "00".repeat(84),
    floor_block: 25_000_000,
    root_document_echoed: true,
    recovered: false,
    export: { kind: "owner" as const, dir: "/photos-parent", owner: "/photos-parent/bitgraph-1386.bitgraph.json", members_dir: null, members: 0, spec: "/photos-parent/SPEC.md", floor_header: true },
    recovery: { entries: 5, written: 5, already_there: 0, blocked: 0, pending: 0, reason: null },
  };
  const row = { digest: toUrlSafeB64(DIGEST), counter: "1386", epoch: toUrlSafeB64(EPOCH), total_positions: 1, proof_url: tree.proof_url, artifact_digest: "ZnVzZWQ", outcome: "fused" as const, member_count: 3 };
  const rows = [
    { ...row, path: "/a.png", placement: "trailer/1", member: 2 },
    { ...row, path: "/b.txt", placement: "container/2", member: 1 },
    { ...row, path: "/c.mov", placement: "as-is", member: 3, outcome: "recorded" as const },
  ];
  const md = renderRecordMarkdown(rows, tree);
  assert.ok(md.startsWith("3 files BitGraphed as one tree at #1386 (tree of 3), 0 already on record."), md);
  assert.ok(md.includes("- #1386 · tree of 3 · https://bitgraph.ing/proof/dHJlZQ?counter=1386"), md);
  assert.ok(md.includes("  Export, every file's leaf and name (keep it with the files): /photos-parent/bitgraph-1386.bitgraph.json"), md);
  assert.ok(md.includes("  The rules the proof pins (SPEC.md), beside it: /photos-parent/SPEC.md"), md);
  assert.ok(md.includes('bitgraph export complete "/photos-parent/bitgraph-1386.bitgraph.json"'), md);
  assert.ok(md.includes("  Each file finds this proof again from its own bytes (5 sealed recovery entries kept)."), md);
  const pending = renderRecordMarkdown(rows, { ...tree, recovery: { entries: 5, written: 0, already_there: 0, blocked: 0, pending: 5, reason: "bitgraph.ing is not taking recovery writes yet" } });
  assert.ok(pending.includes("  Not yet recoverable from the files alone: bitgraph.ing is not taking recovery writes yet."), pending);
  assert.ok(!renderRecordMarkdown(rows, { ...tree, recovery: null }).includes("recover"), "recovery off says nothing");
  assert.ok(!md.includes("and the floor block's header"), "the floor header is in hand");
  assert.ok(md.includes("- fused · /a.png (2 of 3, trailer/1)"), md);
  assert.ok(md.includes("- fused · /b.txt (1 of 3, container/2)"), md);
  assert.ok(md.includes("- recorded as is · /c.mov (3 of 3)"), md);
  assert.ok(md.includes("nothing bounds it from below"), md);
  assert.ok(md.includes("The proof commits only the tree's root: keep the export with the files"), md);
  assert.ok(!md.includes("\u2014"), "no em dashes");
  const noHeader = renderRecordMarkdown(rows.slice(0, 2), { ...tree, export: { ...tree.export, floor_header: false } });
  assert.ok(noHeader.includes("and the floor block's header"), noHeader);
  assert.ok(!noHeader.includes("recorded as is"), "nothing as is, nothing said about it");
  const none = renderRecordMarkdown(rows.slice(0, 1), { ...tree, export: { ...tree.export, kind: "none", dir: null, owner: null, spec: null } });
  assert.ok(!none.includes("SPEC.md"), none);
  assert.ok(none.includes("No export was written (exports='none')"), none);
});

test("proof markdown states the floor in time and the ceiling in position", () => {
  const detail: ProofDetailResponse = {
    proofs: [{ proof: { artifact: { digestB64: DIGEST }, commit: { counter: "42", epochId: EPOCH } } }],
    positions: [{ counter: "42", epoch: toUrlSafeB64(EPOCH), lowerTime: null, upperTime: null }],
    causalWindow: {
      anchorBefore: { blockTime: "2026-07-01T00:00:00.000Z", blockNumber: 100 },
      anchorAfter: { blockTime: "2026-07-01T00:00:12.000Z", blockNumber: 101 },
    },
  };
  const md = renderProofMarkdown(detail, "https://bitgraph.ing");
  assert.ok(
    md.includes("BitGraphed after 2026-07-01T00:00:00.000Z (Ethereum block 100), and before the anchoring of block 101 (that block mined 2026-07-01T00:00:12.000Z)."),
    md
  );
  assert.ok(md.includes("# BitGraph #42"));
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
