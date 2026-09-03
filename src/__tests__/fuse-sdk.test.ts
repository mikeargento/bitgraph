// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * fuse() against a fake transport built from real fixture proofs (minted
 * through the local enclave harness). Every refusal path runs.
 */

import { describe, test } from "node:test";
import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fuse, builderFor, FuseError } from "../fuse.js";
import type { BitGraphProof, SlotAllocation } from "../fuse.js";

const FIX = fileURLToPath(new URL("../../src/__tests__/fuse-fixtures/", import.meta.url));
const bytes = (name: string) => new Uint8Array(readFileSync(FIX + name));
const proofOf = (name: string) => JSON.parse(readFileSync(FIX + name, "utf8")) as BitGraphProof;

interface Call { path: string; body: unknown }

/** A transport that hands out `slot` and answers the commit with `answer`. */
function fakeTransport(slot: SlotAllocation, answer: (calls: Call[], body: unknown) => { status: number; json: unknown }, lookup?: (calls: Call[]) => { status: number; json: unknown }) {
  const calls: Call[] = [];
  const f: typeof fetch = async (input, init) => {
    const url = String(input);
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, body });
    const reply = (r: { status: number; json: unknown }) => new Response(JSON.stringify(r.json), { status: r.status, headers: { "Content-Type": "application/json" } });
    if (path === "/api/fuse/allocate") return reply({ status: 200, json: { slotId: slot.nonceB64, slot, chainId: "bitgraph:main" } });
    if (path === "/api/fuse/commit") return reply(answer(calls, body));
    if (path.startsWith("/api/proofs/")) return reply(lookup ? lookup(calls) : { status: 200, json: { proofs: [] } });
    return reply({ status: 404, json: { error: "no route" } });
  };
  return { calls, transport: { baseUrl: "https://example.test", fetch: f, recoveryAttempts: 2, recoveryDelayMs: 1 } };
}

describe("fuse(): the four beats", () => {
  test("trailer/1 over an existing original: allocate, fuse, hash, fill; Frame carries the unchanged proof", async () => {
    const proof = proofOf("trailer.proof.json");
    const { calls, transport } = fakeTransport(proof.slotAllocation!, () => ({ status: 200, json: { proof } }));
    const original = bytes("original.txt");
    const r = await fuse(builderFor("trailer/1", original), { placement: "trailer/1", original, fusedFile: "photo.jpg", transport });
    assert.equal(r.artifactDigestB64, proof.artifact.digestB64);
    assert.deepEqual(r.proof, proof);
    assert.equal(r.frame.type, "bitgraph-fuse/1");
    assert.equal(r.frame.manifest.placement, "trailer/1");
    assert.equal(r.frame.manifest.fusedFile, "photo.jpg");
    assert.deepEqual(r.frame.proof, proof);
    assert.equal(r.recovered, false);
    assert.equal(r.verification.category, "FUSED_DIRECT");
    assert.equal(r.fusedBytes, undefined, "byte-exact placements evaporate by default");
    // The commit carried the placement and origin in the attribution, and named the slot.
    const commit = calls.find((c) => c.path === "/api/fuse/commit")!.body as Record<string, unknown>;
    assert.equal(commit.slotId, proof.slotAllocation!.nonceB64);
    assert.deepEqual(commit.attribution, { name: "BitGraph Fuse", title: "trailer/1", message: r.originDigestB64 });
    assert.deepEqual(commit.digests, [{ digestB64: proof.artifact.digestB64, hashAlg: "sha256" }]);
    assert.equal(commit.chainId, "bitgraph:main");
    // The raw nonce appears in no error and nowhere but the slot field it must ride in.
    assert.ok(!JSON.stringify(commit.attribution).includes(proof.slotAllocation!.nonceB64));
  });

  test("produced/1 keeps its bytes and its payload view in the Frame", async () => {
    const proof = proofOf("produced-origin.proof.json");
    const { transport } = fakeTransport(proof.slotAllocation!, () => ({ status: 200, json: [proof] }));
    const originDigest = new Uint8Array(Buffer.from(proof.attribution!.message!, "base64"));
    const r = await fuse(builderFor("produced/1"), { placement: "produced/1", originDigest, transport });
    assert.ok(r.fusedBytes, "Form C keeps the fused bytes");
    assert.deepEqual(r.fusedBytes, bytes("produced-origin.json"));
    assert.ok(r.frame.fusePayload);
    assert.equal(r.frame.fusePayload!.type, "bitgraph-fuse/1");
  });

  test("a builder that drops the commitment is refused BEFORE any commit; the slot is left to expire", async () => {
    const proof = proofOf("trailer.proof.json");
    const { calls, transport } = fakeTransport(proof.slotAllocation!, () => ({ status: 200, json: { proof } }));
    await assert.rejects(
      fuse(() => bytes("original.txt"), { placement: "trailer/1", original: bytes("original.txt"), transport }),
      (e: FuseError) => e.code === "commitment-missing",
    );
    assert.equal(calls.filter((c) => c.path === "/api/fuse/commit").length, 0, "no commit was attempted");
  });

  test("a proof under a different slot is never labelled fused", async () => {
    const proof = proofOf("trailer.proof.json");
    const other = proofOf("trailer-undeclared.proof.json");
    const { transport } = fakeTransport(proof.slotAllocation!, () => ({ status: 200, json: { proof: other } }));
    await assert.rejects(
      fuse(builderFor("trailer/1", bytes("original.txt")), { placement: "trailer/1", original: bytes("original.txt"), transport }),
      (e: FuseError) => e.code === "slot-mismatch",
    );
  });

  test("409 slot-unavailable: the proof is read back by digest and matched on slotHashB64; nothing is re-allocated", async () => {
    const proof = proofOf("trailer.proof.json");
    const decoy = proofOf("trailer-undeclared.proof.json");
    const { calls, transport } = fakeTransport(
      proof.slotAllocation!,
      () => ({ status: 409, json: { error: "gone", code: "slot-unavailable" } }),
      () => ({ status: 200, json: { proofs: [{ proof: decoy }, { proof }] } }),
    );
    const r = await fuse(builderFor("trailer/1", bytes("original.txt")), { placement: "trailer/1", original: bytes("original.txt"), transport });
    assert.equal(r.recovered, true);
    assert.deepEqual(r.proof, proof);
    assert.equal(calls.filter((c) => c.path === "/api/fuse/allocate").length, 1, "allocated exactly once");
  });

  test("409 with no matching proof on the ledger is reported as slot-unavailable, not retried into a new slot", async () => {
    const proof = proofOf("trailer.proof.json");
    const { calls, transport } = fakeTransport(proof.slotAllocation!, () => ({ status: 409, json: { error: "gone", code: "slot-unavailable" } }));
    await assert.rejects(
      fuse(builderFor("trailer/1", bytes("original.txt")), { placement: "trailer/1", original: bytes("original.txt"), transport }),
      (e: FuseError) => e.code === "slot-unavailable" && !e.message.includes(proof.slotAllocation!.nonceB64),
    );
    assert.equal(calls.filter((c) => c.path === "/api/fuse/allocate").length, 1);
  });

  test("tee-restarting on commit: read back first, then report; a network failure after send does the same", async () => {
    const proof = proofOf("trailer.proof.json");
    const a = fakeTransport(proof.slotAllocation!, () => ({ status: 503, json: { error: "restarting", code: "tee-restarting" } }), () => ({ status: 200, json: { proofs: [{ proof }] } }));
    const r = await fuse(builderFor("trailer/1", bytes("original.txt")), { placement: "trailer/1", original: bytes("original.txt"), transport: a.transport });
    assert.equal(r.recovered, true);
    const b = fakeTransport(proof.slotAllocation!, () => ({ status: 503, json: { error: "restarting", code: "tee-restarting" } }));
    await assert.rejects(fuse(builderFor("trailer/1", bytes("original.txt")), { placement: "trailer/1", original: bytes("original.txt"), transport: b.transport }), (e: FuseError) => e.code === "tee-restarting");
  });

  test("bad inputs are refused before any request", async () => {
    const proof = proofOf("trailer.proof.json");
    const { calls, transport } = fakeTransport(proof.slotAllocation!, () => ({ status: 200, json: { proof } }));
    await assert.rejects(fuse(builderFor("trailer/1", bytes("original.txt")), { placement: "xmp/9" as never, original: bytes("original.txt"), transport }), (e: FuseError) => e.code === "bad-placement");
    await assert.rejects(fuse(builderFor("trailer/1"), { placement: "trailer/1", transport }), (e: FuseError) => e.code === "bad-input");
    await assert.rejects(fuse(builderFor("produced/1"), { placement: "produced/1", original: bytes("original.txt"), transport }), (e: FuseError) => e.code === "bad-input");
    assert.equal(calls.length, 0);
    assert.throws(() => builderFor("nope/1" as never), (e: FuseError) => e.code === "bad-placement");
  });

  test("a slot off the anchored chain is refused", async () => {
    const proof = proofOf("trailer.proof.json");
    const { transport } = fakeTransport({ ...proof.slotAllocation!, chainId: "global" }, () => ({ status: 200, json: { proof } }));
    await assert.rejects(fuse(builderFor("trailer/1", bytes("original.txt")), { placement: "trailer/1", original: bytes("original.txt"), transport }), (e: FuseError) => e.code === "allocate-failed" && /anchored chain/.test(e.message));
  });
});
