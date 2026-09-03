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
  const fresh = renderRecordMarkdown([{ ...base, path: "/a", outcome: "fused", artifact_digest: "ZnVzZWQ", placement: "container/1" }]);
  assert.ok(!fresh.includes("again=true"));
  const mixed = renderRecordMarkdown([
    { ...base, path: "/a", outcome: "fused", artifact_digest: "ZnVzZWQ", placement: "container/1" },
    { ...base, path: "/b", outcome: "on record", artifact_digest: null, placement: null },
  ]);
  assert.ok(mixed.includes("again=true"));
  assert.ok(mixed.startsWith("1 fused, 1 already on record."));
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
