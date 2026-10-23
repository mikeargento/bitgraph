/**
 * The hosted MCP under an enclave v10 boundary (the floor a Base block,
 * returned as `floor` with the position), offline: the token carries the Base
 * floor, the commitment is commitment/3, the tree commits under fuse/3 and
 * SPEC v2 with body.floor, the export's floor header is the Base header, and
 * the task form names the floor's chain. A stub boundary signs with a test
 * key and runs the site's real commit-route checks.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { sha256 } from "@noble/hashes/sha256";
import { TREE_SPEC_V2_HASH, bytesToBase64, computeSlotCommitment3, verifyExport } from "@mikeargento/bitgraph-verify";
import { assemble, beginHosted, commitHostedTree, decodeToken, decodeTaskToken, encodeToken, floorOfState, openHosted, specUrl, treeExportFor } from "../mcp/fuse-hosted.ts";
import { BASE_FLOOR, makeStub, utf8 } from "./tree1-helpers.ts";

async function withStub<T>(run: (stub: Awaited<ReturnType<typeof makeStub>>) => Promise<T>): Promise<T> {
  const stub = await makeStub({ baseFloor: true });
  const realFetch = globalThis.fetch;
  process.env.BITGRAPH_API_URL = "https://stub.test";
  globalThis.fetch = stub.fetch;
  try {
    return await run(stub);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.BITGRAPH_API_URL;
  }
}

test("hosted MCP on a Base floor: the token carries it, commitment/3, one tree under fuse/3 and SPEC v2, and the export's floor is the Base header", async () => {
  await withStub(async (stub) => {
    const bytes = utf8("a file on a Base floor\n");
    const opened = await openHosted({ name: "a.txt", size: bytes.length, digestB64: bytesToBase64(sha256(bytes)), head: bytes.subarray(0, 16) });
    assert.deepEqual(opened.state.floor, BASE_FLOOR);
    assert.equal(opened.state.anchor, undefined);
    assert.equal(opened.commitmentB64, bytesToBase64(computeSlotCommitment3(opened.state.slot, BASE_FLOOR.blockHash)));
    // The token round-trips with its Base floor; one naming both floors is refused.
    assert.deepEqual(floorOfState(decodeToken(opened.token)!), BASE_FLOOR);
    assert.equal(decodeToken(encodeToken({ ...opened.state, anchor: { counter: "1", blockNumber: 1, blockHash: "0x" + "ab".repeat(32) } })), null);

    const built = assemble(opened.recipe, bytes);
    const t = await commitHostedTree([{ state: opened.state, artifactDigestB64: bytesToBase64(sha256(built)) }]);
    const body = stub.commits[stub.commits.length - 1]!;
    assert.equal((body.attribution as { name: string }).name, "bitgraph-fuse/3");
    assert.equal((body.attribution as { message: string }).message, TREE_SPEC_V2_HASH);
    assert.deepEqual(body.floor, BASE_FLOOR);
    assert.equal(body.anchor, undefined);
    const ex = await treeExportFor(t);
    assert.equal(ex.export.floor?.chain, "base");
    const r = await verifyExport(ex.export, { bytes });
    assert.equal(r.claims.find((c) => c.id === "floor.header")?.result, "TRUE");
    assert.equal(specUrl(TREE_SPEC_V2_HASH), "https://stub.test/spec/SPEC-v2.md");
  });
});

test("hosted task form on a Base floor: the floor named is the Base block, read from the position, with no ledger read", async () => {
  await withStub(async (stub) => {
    const begun = await beginHosted();
    assert.deepEqual(begun.floor, { block: BASE_FLOOR.blockNumber, headerTime: BASE_FLOOR.blockTimestamp, chain: "base" });
    assert.ok(!stub.calls.includes("/api/proofs/anchors"), "no anchor is looked up for a Base floor");
    assert.deepEqual(floorOfState(decodeTaskToken(begun.token)!), BASE_FLOOR);
  });
});
