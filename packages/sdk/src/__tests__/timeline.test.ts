/**
 * Timeline lookups over JSON-RPC: a stand-in node serving a real Base block (53309237, from mainnet.base.org; the
 * commit service's fixture), checked the way verifyTimelineBundle needs: the header reproduces the hash, the chain id
 * is the node's own, canonical when the block at that height is this one, and two nodes must agree.
 *
 *   cd packages/sdk && npx tsc && node --test dist/__tests__/timeline.test.js
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { rpcTimelineLookups } from "../timeline.js";

const block = (JSON.parse(readFileSync(new URL("../../../../server/commit-service/src/parent/__tests__/fixtures/base-block.json", import.meta.url), "utf8")) as { result: Record<string, string> }).result;
const TX = "0x" + "8f".repeat(32);

/** A JSON-RPC node: `blocks` by hash, `best` by number, and one transaction. */
function node(opts: { chainId?: number; blocks?: Record<string, string>[]; best?: Record<string, string> | null; tx?: Record<string, string> | null; down?: boolean } = {}) {
  const blocks = opts.blocks ?? [block];
  return async (_url: string, init: { body: string }) => {
    if (opts.down) throw new Error("connect ECONNREFUSED");
    const { method, params } = JSON.parse(init.body) as { method: string; params: string[] };
    let result: unknown = null;
    if (method === "eth_chainId") result = "0x" + (opts.chainId ?? 8453).toString(16);
    if (method === "eth_getBlockByHash") result = blocks.find((b) => b["hash"] === params[0]) ?? null;
    if (method === "eth_getBlockByNumber") result = opts.best !== undefined ? opts.best : blocks.find((b) => b["number"] === params[0]) ?? null;
    if (method === "eth_getTransactionByHash") result = params[0] === TX ? (opts.tx ?? null) : null;
    return { ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: 1, result }) };
  };
}

/** Two URLs served by different stand-ins. */
const pair = (a: ReturnType<typeof node>, b: ReturnType<typeof node>) => async (url: string, init: { method: string; headers: Record<string, string>; body: string }) => (url.includes("a.example") ? a : b)(url, init);

test("a real Base block: its own number, time and chain id, canonical", async () => {
  const l = rpcTimelineLookups({ base: ["https://a.example"], fetch: node() });
  assert.deepEqual(await l.block("base", "eip155:8453", block["hash"]!), {
    chainId: "eip155:8453", hash: block["hash"], number: 53_309_237, timestamp: parseInt(block["timestamp"]!, 16), canonical: true,
  });
  assert.equal(await l.block("base", "eip155:8453", "0x" + "00".repeat(32)), null);
});

test("a node answering for another chain says so in the chain id; the verifier then fails the read", async () => {
  const l = rpcTimelineLookups({ base: ["https://a.example"], fetch: node({ chainId: 84532 }) });
  assert.equal((await l.block("base", "eip155:8453", block["hash"]!))?.chainId, "eip155:84532");
});

test("a block that is not the one at its height is not canonical", async () => {
  const other = { ...block, hash: "0x" + "ab".repeat(32) };
  const l = rpcTimelineLookups({ base: ["https://a.example"], fetch: node({ best: other }) });
  assert.equal((await l.block("base", "eip155:8453", block["hash"]!))?.canonical, false);
});

test("a header that does not reproduce its hash is refused", async () => {
  const forged = { ...block, timestamp: "0x" + (parseInt(block["timestamp"]!, 16) - 600).toString(16) };
  const l = rpcTimelineLookups({ base: ["https://a.example"], fetch: node({ blocks: [forged] }) });
  await assert.rejects(l.block("base", "eip155:8453", block["hash"]!), /does not reproduce its hash/);
});

test("two nodes must agree; one down means the lookup could not be made", async () => {
  const agree = rpcTimelineLookups({ base: ["https://a.example", "https://b.example"], fetch: pair(node(), node()) });
  assert.equal((await agree.block("base", "eip155:8453", block["hash"]!))?.canonical, true);
  const split = rpcTimelineLookups({ base: ["https://a.example", "https://b.example"], fetch: pair(node(), node({ best: { ...block, hash: "0x" + "cd".repeat(32) } })) });
  await assert.rejects(split.block("base", "eip155:8453", block["hash"]!), /a\.example and https:\/\/b\.example disagree/);
  const down = rpcTimelineLookups({ base: ["https://a.example", "https://b.example"], fetch: pair(node(), node({ down: true })) });
  await assert.rejects(down.block("base", "eip155:8453", block["hash"]!), /b\.example: connect ECONNREFUSED/);
});

test("the genesis transaction and block come from Base", async () => {
  const tx = { from: "0xF3972408D853c975F86351C311f4310220bbF2a3", to: "0xF3972408D853c975F86351C311f4310220bbF2a3", input: "0x42474531", blockHash: block["hash"]!, blockNumber: block["number"]! };
  const l = rpcTimelineLookups({ base: ["https://a.example"], fetch: node({ tx }) });
  assert.deepEqual(await l.genesisTx!(TX), { from: tx.from.toLowerCase(), to: tx.to.toLowerCase(), input: "0x42474531", blockHash: block["hash"], blockNumber: 53_309_237 });
  assert.equal(await l.genesisTx!("0x" + "00".repeat(32)), null);
  assert.deepEqual(await l.genesisBlock!(block["hash"]!), { hash: block["hash"], number: 53_309_237, timestamp: parseInt(block["timestamp"]!, 16) });
});
