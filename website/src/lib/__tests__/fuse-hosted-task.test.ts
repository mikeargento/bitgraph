import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
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

/**
 * BitGraph Postseason (live.bitgraph.ing, ~/Code/before-the-pitch, src/sealer.ts)
 * seals every at bat through the hosted MCP: bitgraph_open with no files,
 * then bitgraph_commit with { fuse_token, artifact_digest, carry: "base64url" }.
 * Its parser is strict about a handful of fields. They are pinned here, both
 * as the route's source (the answers are shaped inline in app/mcp/route.ts)
 * and as the parser itself run over an answer built the way the route builds
 * it, so a change to the hosted route that would break the Postseason fails
 * here before it ships.
 */
test("the Postseason sealer's fields are in the hosted route's answers, and its parser accepts an open answer built the route's way", async () => {
  const route = readFileSync(new URL("../../app/mcp/route.ts", import.meta.url), "utf8");
  // bitgraph_open, no files: what the sealer reads.
  for (const needle of [
    'outcome: "opened"',
    "slot_counter: begun.slotCounter",
    "epoch: begun.epochB64",
    "commitment: begun.commitment",
    "fuse_token: begun.token",
    "expires_in_seconds: SLOT_TTL_SECONDS",
    // The sealer reads block and header_time; chain was added beside them for a Base floor (enclave v10).
    'floor: begun.floor === null ? null : { chain: begun.floor.chain ?? "ethereum", block: begun.floor.block, header_time: begun.floor.headerTime }',
  ]) assert.ok(route.includes(needle), `bitgraph_open answer lost: ${needle}`);
  // bitgraph_commit with a task token: outcome "fused", counter, proof_url, and the proof whole in frames[].
  for (const needle of [
    "const c = await commitHostedTask(t.state, t.artifactDigestB64);",
    'outcomes[t.position] = { ...base, outcome: "fused", counter, epoch, proof_url: proofUrl(baseUrl, t.artifactDigestB64, counter ?? undefined, c.proof.commit?.epochId), positions: [{ counter, epoch }], recovered: c.recovered, error: null };',
    'frames.push({ name: "task.proof.json", frame: c.proof });',
    "results: outcomes,",
    "frames,",
  ]) assert.ok(route.includes(needle), `bitgraph_commit answer lost: ${needle}`);

  // The sealer's own check (src/sealer.ts open()), over an answer built as the route builds it.
  const s = slot();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/api/fuse/allocate")) return new Response(JSON.stringify({ slotId: s.nonceB64, slot: s, chainId: "bitgraph:main" }), { status: 200, headers: { "content-type": "application/json" } });
    if (url.includes("/api/proofs/anchors?")) return new Response(JSON.stringify({ anchors: [{ commit: { anchor: { blockNumber: 25962561, blockHash: "0x" + "ab".repeat(32) } } }] }), { status: 200 });
    return new Response(JSON.stringify({ error: "no" }), { status: 404 });
  }) as typeof fetch;
  try {
    const begun = await beginHosted();
    const r: Record<string, unknown> = {
      outcome: "opened",
      task: true,
      slot_counter: begun.slotCounter,
      epoch: begun.epochB64,
      commitment: begun.commitment,
      commitment_base64: begun.commitmentB64,
      floor: begun.floor === null ? null : { block: begun.floor.block, header_time: begun.floor.headerTime },
      fuse_token: begun.token,
      expires_in_seconds: 120,
    };
    // Verbatim from the sealer.
    assert.ok(!(r.outcome !== "opened" || typeof r.commitment !== "string" || typeof r.fuse_token !== "string"), "the sealer would throw: unexpected answer");
    const floor = (r.floor ?? {}) as { block?: number; header_time?: number };
    const pos = { slotCounter: String(r.slot_counter), epoch: String(r.epoch), commitment: r.commitment as string, floor: { block: floor.block ?? null, header_time: floor.header_time ?? null }, fuseToken: r.fuse_token as string, expiresInSeconds: Number(r.expires_in_seconds ?? 120) };
    assert.equal(pos.slotCounter, "4321");
    assert.equal(pos.floor.block, 25962561);
    assert.ok(decodeTaskToken(pos.fuseToken), "the token the sealer sends back is a task token");
    assert.doesNotMatch(pos.commitment, /[+/=]/, "the commitment the sealer puts into the task is base64url");
  } finally {
    globalThis.fetch = realFetch;
  }
});

// The hosted MCP on a Base floor (enclave v10) runs with this one under test:mcp.
import "./fuse-hosted-base.test.ts";
