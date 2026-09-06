// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { toUrlSafeB64 } from "../encoding.js";
import { capJson, proofUrl, renderProofMarkdown, renderRecordMarkdown } from "../format.js";
import type { ProofDetailResponse } from "../types.js";

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

test("record markdown names the set once and its members by row", () => {
  const set = {
    set: "set/1" as const,
    count: 2,
    counter: "1386",
    epoch: toUrlSafeB64(EPOCH),
    artifact_digest: "c2V0",
    proof_url: "https://bitgraph.ing/proof/c2V0?counter=1386",
    manifest_echoed: true,
    recovered: false,
    index: null,
  };
  const row = { digest: toUrlSafeB64(DIGEST), counter: "1386", epoch: toUrlSafeB64(EPOCH), total_positions: 1, proof_url: "https://bitgraph.ing/proof/x", artifact_digest: "ZnVzZWQ", outcome: "fused" as const, member_count: 2 };
  const md = renderRecordMarkdown([{ ...row, path: "/a.png", placement: "trailer/1", member: 2 }, { ...row, path: "/b.txt", placement: "container/2", member: 1 }], set);
  assert.ok(md.startsWith("2 files BitGraphed as one set at #1386 (set of 2), 0 already on record."), md);
  assert.ok(md.includes("- #1386 · set of 2 · https://bitgraph.ing/proof/c2V0?counter=1386"), md);
  assert.ok(md.includes("- fused · /a.png (2 of 2, trailer/1)"), md);
  assert.ok(md.includes("- fused · /b.txt (1 of 2, container/2)"), md);
  const waiting = renderRecordMarkdown([{ ...row, path: "/a.png", placement: "trailer/1", member: 1 }], { ...set, set: "set/2", index: { written: 0, pending: 2 } });
  assert.ok(waiting.includes("not findable by hash"), waiting);
});

test("proof markdown states the window as between lower and upper", () => {
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
    md.includes("BitGraphed between 2026-07-01T00:00:00.000Z (Ethereum block 100) and 2026-07-01T00:00:12.000Z (block 101)"),
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
