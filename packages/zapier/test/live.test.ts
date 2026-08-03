// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * Read-only checks against the real bitgraph.ing API.
 *
 * The rest of the suite runs on stubs, which means it can only prove the
 * connector is consistent with what this file assumes the API returns. These
 * checks are what keep that assumption honest: if a response shape moves, they
 * fail here rather than in someone's Zap.
 *
 * Nothing here records anything, and that is enforced rather than intended.
 * The `z` used below refuses to issue a POST to /api/commit at all, so no
 * future edit to this file can quietly start minting: the BitGraph ledger is
 * Object Lock COMPLIANCE storage with ten-year retention and no deletes, so a
 * test proof would be permanent and unremovable.
 *
 * Set BITGRAPH_SKIP_LIVE=1 to skip when offline.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bundle, ZObject } from "zapier-platform-core";
import { Readable } from "node:stream";
import { BitGraphClient } from "../src/lib/client";
import findProof from "../src/searches/find-proof";
import verifyBitGraph from "../src/creates/verify-bitgraph";
import { bundleOf } from "./helpers";

const skip = process.env["BITGRAPH_SKIP_LIVE"] === "1";

const EXAMPLE_URLSAFE = "mYNezUiNnzhS3V0xqDsGUWCg2ZsKshiftAI016JPBUc";
const EXAMPLE_B64 = "mYNezUiNnzhS3V0xqDsGUWCg2ZsKshiftAI016JPBUc=";
const EXAMPLE_COUNTER = "7910";
const EXAMPLE_EPOCH = "EQmlm7sZsGZeYmKlgVU6k0qd6cj79bsmhzhlzxlMF7o";

/** A `z` backed by real fetch, with writes physically barred. */
function realZ(): ZObject {
  const request = async (options: Record<string, unknown>) => {
    const url = String(options["url"] ?? "");
    const method = String(options["method"] ?? "GET").toUpperCase();

    if (method === "POST" && url.includes("/api/commit")) {
      throw new Error(
        "Blocked: the live test harness must never record. Recordings are permanent and cannot be deleted."
      );
    }

    const res = await fetch(url, {
      method,
      ...(options["headers"] !== undefined ? { headers: options["headers"] as Record<string, string> } : {}),
      ...(options["body"] !== undefined ? { body: options["body"] as string } : {}),
      signal: AbortSignal.timeout(30_000),
    });

    if (options["raw"] === true) {
      const buf = Buffer.from(await res.arrayBuffer());
      return { status: res.status, body: Readable.from(buf) };
    }
    const text = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: res.status, data };
  };

  class E extends Error {
    constructor(message: string) {
      super(message);
    }
  }
  return {
    request,
    errors: { Error: E, ThrottledError: E, HaltedError: E },
  } as unknown as ZObject;
}

const liveBundle = (input: Record<string, unknown>): Bundle => bundleOf(input, { apiKey: "" });

test("the batch endpoint still answers keyed by the digest exactly as sent", { skip }, async () => {
  const client = new BitGraphClient(realZ(), liveBundle({}));
  const res = await client.batchCheck([EXAMPLE_URLSAFE]);

  assert.ok(res.results, "response carries a results object");
  const entry = res.results[EXAMPLE_URLSAFE];
  assert.ok(entry, "keyed by the url-safe digest that was sent");
  assert.ok(entry.proofs.length > 0, "the public example is on record");
  assert.equal(entry.proofs[0]?.proof.artifact?.digestB64, EXAMPLE_B64);
});

test("the proof detail endpoint still carries the fields the connector maps", { skip }, async () => {
  const client = new BitGraphClient(realZ(), liveBundle({}));
  const detail = await client.proofDetail(EXAMPLE_URLSAFE, EXAMPLE_COUNTER, EXAMPLE_EPOCH);

  const proof = detail.proofs[0]?.proof;
  assert.ok(proof, "a proof came back");
  assert.equal(proof.version, "bitgraph/1");
  assert.equal(proof.commit?.counter, EXAMPLE_COUNTER);
  assert.equal(proof.commit?.chainId, "bitgraph:main");
  assert.ok(proof.commit?.epochId, "epochId present");
  assert.ok(proof.signer?.publicKeyB64 && proof.signer?.signatureB64, "signer present");
  assert.ok(proof.slotAllocation, "slotAllocation present, which the trust anchors require");

  // The naming inversion the whole time story rests on. If these two ever swap
  // meaning upstream, every "BitGraphed between" statement inverts with them.
  const w = detail.causalWindow;
  assert.ok(w?.anchorBefore?.blockTime && w?.anchorAfter?.blockTime, "a settled proof has both bounds");
  assert.ok(
    new Date(w.anchorBefore.blockTime).getTime() < new Date(w.anchorAfter.blockTime).getTime(),
    "anchorBefore must remain the EARLIER block"
  );
  assert.ok((detail.positions?.length ?? 0) >= 1);
});

test("Retrieve Proof works end to end against production", { skip }, async () => {
  const results = await findProof.operation.perform(
    realZ(),
    liveBundle({ digest: EXAMPLE_B64 })
  );
  assert.equal(results.length, 1);
  assert.equal(results[0]?.counter, EXAMPLE_COUNTER);
  assert.equal(results[0]?.bitgraphedAfter, "2026-07-29T16:54:11.000Z");
  assert.match(results[0]?.causalWindow ?? "", /BitGraphed between/);
});

test("Verify BitGraph verifies the live example against the live ledger", { skip }, async () => {
  const result = await verifyBitGraph.operation.perform(realZ(), liveBundle({ digest: EXAMPLE_B64 }));

  assert.equal(result.verified, true);
  assert.equal(result.status, "valid");
  assert.equal(result.artifactBinding, "checked");
  assert.equal(result.onRecord, true);
});

test("a digest that is not on record reports so without erroring", { skip }, async () => {
  // 32 bytes of a value nothing will ever hash to.
  const absent = Buffer.alloc(32, 0xab).toString("base64");
  const result = await verifyBitGraph.operation.perform(realZ(), liveBundle({ digest: absent }));

  assert.equal(result.status, "not on record");
  assert.equal(result.verified, false);
  assert.equal(result.onRecord, false);
});

test("the live harness refuses to record, by construction", { skip }, async () => {
  const client = new BitGraphClient(realZ(), liveBundle({}));
  await assert.rejects(client.commit([EXAMPLE_B64]), /must never record/);
});
