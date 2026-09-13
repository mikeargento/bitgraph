import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { bytesToBase64, computeSlotCommitment, inlineAttribution } from "@mikeargento/bitgraph-verify";
import type { SlotAllocation } from "@mikeargento/bitgraph-verify";
import { beginHosted, commitHostedTask, decodeTaskToken, decodeToken, encodeTaskToken, encodeToken, toBase64Url, type OpenState } from "../mcp/fuse-hosted.ts";

const slot = (): SlotAllocation => ({
  version: "bitgraph/slot/1",
  nonceB64: bytesToBase64(new Uint8Array(randomBytes(32))),
  counter: "4321",
  epochId: bytesToBase64(new Uint8Array(randomBytes(32))),
  publicKeyB64: bytesToBase64(new Uint8Array(randomBytes(32))),
  chainId: "bitgraph:main",
  signatureB64: bytesToBase64(new Uint8Array(randomBytes(64))),
});

const digestB64 = () => bytesToBase64(new Uint8Array(randomBytes(32)));

test("a task token round-trips, and is not a file token", () => {
  const s = slot();
  const token = encodeTaskToken({ v: 1, task: true, slot: s });
  const back = decodeTaskToken(token);
  assert.ok(back);
  assert.equal(back.slot.nonceB64, s.nonceB64);
  assert.equal(decodeToken(token), null, "the file-token decoder must refuse a task token");
  assert.equal(decodeTaskToken("not-a-token"), null);
  const fileState: OpenState = { v: 1, slot: s, placement: "trailer/1", origin: { digestB64: digestB64(), size: 3, name: "a.jpg" }, fusedName: "a.fused.jpg", frameName: "a.jpg.bitgraph-fuse.json" };
  assert.equal(decodeTaskToken(encodeToken(fileState)), null, "the task-token decoder must refuse a file token");
});

test("bitgraph_open with no files: a held slot, its commitment, and the floor from the ledger", async () => {
  const s = slot();
  const calls: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/api/fuse/allocate")) {
      assert.equal(init?.method, "POST");
      return new Response(JSON.stringify({ slotId: s.nonceB64, slot: s, chainId: "bitgraph:main" }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/api/proofs/anchors?")) {
      assert.match(url, /counter=4321/);
      assert.match(url, /before=1/);
      return new Response(JSON.stringify({ anchors: [{ commit: { anchor: { blockNumber: 25962561, blockHash: "0x" + "ab".repeat(32) } } }] }), { status: 200 });
    }
    if (url.includes("/api/proofs/witness?")) return new Response(JSON.stringify({ error: "no header here" }), { status: 404 });
    throw new Error(`unexpected ${url}`);
  }) as typeof fetch;
  try {
    const b = await beginHosted();
    assert.equal(b.slotCounter, "4321");
    assert.equal(b.commitmentB64, bytesToBase64(computeSlotCommitment(s)));
    assert.equal(b.commitment, toBase64Url(b.commitmentB64));
    assert.doesNotMatch(b.commitment, /[+/=]/);
    assert.deepEqual(b.floor, { block: 25962561, headerTime: null });
    assert.ok(decodeTaskToken(b.token));
    assert.ok(calls.some((u) => u.endsWith("/api/fuse/allocate")));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("bitgraph_commit with a task token sends the inline marker and no origin, and refuses a proof without it", async () => {
  const s = slot();
  const state = { v: 1 as const, task: true as const, slot: s };
  const artifact = digestB64();
  let sentBody: Record<string, unknown> | null = null;
  const realFetch = globalThis.fetch;
  const answer = (attribution: unknown) =>
    (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/fuse/commit")) {
        sentBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        const proof = {
          version: "bitgraph/1",
          artifact: { hashAlg: "sha256", digestB64: artifact },
          commit: { nonceB64: s.nonceB64, counter: "4322", slotCounter: s.counter, epochId: s.epochId },
          signer: { publicKeyB64: s.publicKeyB64, signatureB64: bytesToBase64(new Uint8Array(randomBytes(64))) },
          environment: { enforcement: "measured-tee", measurement: "00" },
          slotAllocation: s,
          attribution,
        };
        return new Response(JSON.stringify({ proof }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ proofs: [] }), { status: 200 });
    }) as typeof fetch;
  try {
    // The marker sent is the inline one; a returned proof carrying it reaches the integrity check (which this unsigned fixture fails).
    globalThis.fetch = answer(inlineAttribution());
    await assert.rejects(commitHostedTask(state, artifact), (err: Error & { code?: string }) => err.code === "verification-failed");
    assert.ok(sentBody);
    const body = sentBody as unknown as { attribution: { name: string; title: string; message?: string }; slotId: string; digests: Array<{ digestB64: string }> };
    assert.deepEqual(body.attribution, inlineAttribution());
    assert.equal(body.attribution.message, undefined, "a task has no original, so no origin digest");
    assert.equal(body.slotId, s.nonceB64);
    assert.equal(body.digests[0]?.digestB64, artifact);
    // A proof that comes back with a file marker instead is refused before any integrity check.
    globalThis.fetch = answer({ name: "bitgraph-fuse/1", title: "trailer/1", message: digestB64() });
    await assert.rejects(commitHostedTask(state, artifact), (err: Error & { code?: string }) => err.code === "marker-mismatch");
  } finally {
    globalThis.fetch = realFetch;
  }
});
