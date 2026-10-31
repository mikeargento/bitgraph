/**
 * The timeline's block sources, Base and Ethereum. The fixtures are real blocks: Base 53309237 (mainnet.base.org) and
 * Ethereum 23673552 (ethereum-rpc.publicnode.com), served here by a fake HTTP layer.
 *
 *   cd server/commit-service && node --import tsx/esm --test src/parent/__tests__/chain-sources.test.ts
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { CrossChecked, EvmSource, timelineSourcesFromEnv, type BlockSource, type ChainHead, type Http } from "../chain-sources.js";
import type { RpcBlock } from "../base-head.js";

const fixture = (name: string): string => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const baseBlock = (JSON.parse(fixture("base-block.json")) as { result: RpcBlock }).result;
const ethBlock = (JSON.parse(fixture("ethereum-block.json")) as { result: RpcBlock }).result;

/** A JSON-RPC node holding these blocks; `latest` is the highest. */
function rpcNode(blocks: RpcBlock[], opts: { fail?: boolean; chainId?: number } = {}): Http & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async postJson(_url, body) {
      const { method, params } = body as { method: string; params: [string, boolean] };
      calls.push(`${method} ${params[0]}`);
      if (opts.fail) throw new Error("HTTP 503");
      const byNumber = (tag: string) => tag === "latest" ? blocks.reduce((a, b) => (parseInt(b.number, 16) > parseInt(a.number, 16) ? b : a)) : blocks.find((b) => parseInt(b.number, 16) === parseInt(tag, 16)) ?? null;
      if (method === "eth_getBlockByNumber") return { result: byNumber(params[0]) };
      if (method === "eth_getBlockByHash") return { result: blocks.find((b) => b.hash === params[0]) ?? null };
      if (method === "eth_chainId") return { result: "0x" + (opts.chainId ?? 8453).toString(16) };
      return { error: { message: "method not found" } };
    },
    async getText() { throw new Error("not served"); },
  };
}

test("real Base and Ethereum blocks reproduce their hashes and give their own number, time and parent", async () => {
  const base = await new EvmSource("base", "eip155:8453", "https://base.example/v2/SECRET", rpcNode([baseBlock])).latest();
  assert.deepEqual(base, { chain: "base", chainId: "eip155:8453", number: 53_309_237, hash: baseBlock.hash, parentHash: baseBlock.parentHash, timestamp: parseInt(baseBlock.timestamp, 16) });
  const eth = await new EvmSource("ethereum", "eip155:1", "https://eth.example", rpcNode([ethBlock])).at(23_673_552);
  assert.equal(eth.hash, ethBlock.hash);
  assert.equal(eth.timestamp, parseInt(ethBlock.timestamp, 16));
});

test("an EVM block whose fields do not reproduce its hash is refused, and the URL's key never shows", async () => {
  const forged = { ...baseBlock, timestamp: "0x" + (parseInt(baseBlock.timestamp, 16) - 600).toString(16) };
  const src = new EvmSource("base", "eip155:8453", "https://base.example/v2/SECRET", rpcNode([forged]));
  await assert.rejects(src.latest(), (e: Error) => /does not reproduce its hash/.test(e.message) && !e.message.includes("SECRET") && e.message.includes("https://base.example"));
});

test("an EVM node that answers for another height, or not yet, is refused", async () => {
  const src = new EvmSource("base", "eip155:8453", "https://base.example", rpcNode([baseBlock]));
  await assert.rejects(src.at(53_309_238), /no base block 53309238 yet/);
  const liar: Http = { ...rpcNode([baseBlock]), async postJson() { return { result: baseBlock }; } };
  await assert.rejects(new EvmSource("base", "eip155:8453", "https://base.example", liar).at(53_309_000), /answered with 53309237/);
});

test("an EVM block by hash says whether it is canonical", async () => {
  const src = new EvmSource("base", "eip155:8453", "https://base.example", rpcNode([baseBlock]));
  assert.equal((await src.byHash(baseBlock.hash))?.canonical, true);
  assert.equal(await src.byHash("0x" + "00".repeat(32)), null);
});

test("ready() refuses a node serving another chain", async () => {
  await new EvmSource("base", "eip155:8453", "https://base.example", rpcNode([baseBlock])).ready();
  await assert.rejects(new EvmSource("base", "eip155:8453", "https://base.example", rpcNode([baseBlock], { chainId: 84532 })).ready(), /serves chain 84532, not eip155:8453/);
  const cc = new CrossChecked(new EvmSource("ethereum", "eip155:1", "https://a.example", rpcNode([ethBlock], { chainId: 1 })), new EvmSource("ethereum", "eip155:1", "https://b.example", rpcNode([ethBlock], { chainId: 8453 })));
  await assert.rejects(cc.ready(), /b\.example: serves chain 8453/);
});

// ---------------------------------------------------------------------------
// Cross-checking two providers
// ---------------------------------------------------------------------------

const head = (number: number, hash = `0x${number.toString(16).padStart(64, "0")}`): ChainHead => ({ chain: "base", chainId: "eip155:8453", number, hash, parentHash: "0x" + "00".repeat(32), timestamp: 1_793_404_750 + 2 * number });

function stub(origin: string, tip: number, opts: { hashAt?: (n: number) => string; down?: boolean; canonical?: boolean } = {}): BlockSource & { asked: number[] } {
  const asked: number[] = [];
  const at = async (n: number) => {
    asked.push(n);
    if (opts.down) throw new Error(`${origin}: HTTP 503`);
    if (n > tip) throw new Error(`${origin}: no base block ${n} yet`);
    return head(n, opts.hashAt?.(n));
  };
  return {
    chain: "base", chainId: "eip155:8453", origin, asked,
    latest: () => at(tip),
    at,
    byHash: async (hash) => (opts.down ? Promise.reject(new Error(`${origin}: HTTP 503`)) : { head: { ...head(7), hash }, canonical: opts.canonical ?? true }),
    ready: async () => {},
  };
}

test("two providers that agree give the block; the second is asked at the first's height", async () => {
  const b = stub("https://b.example", 105);
  const cc = new CrossChecked(stub("https://a.example", 100), b);
  assert.equal((await cc.latest()).number, 100);
  assert.deepEqual(b.asked, [100]);
  assert.equal((await cc.at(42)).number, 42);
});

test("providers that disagree on a block's hash fail the read, naming both", async () => {
  const cc = new CrossChecked(stub("https://a.example", 100), stub("https://b.example", 100, { hashAt: (n) => "0x" + "ee".repeat(32) + String(n).slice(0, 0) }));
  await assert.rejects(cc.at(100), /base block 100: https:\/\/a\.example says .* https:\/\/b\.example says 0xeeee/);
});

test("one provider down means the chain is down; one behind means the read waits", async () => {
  await assert.rejects(new CrossChecked(stub("https://a.example", 100), stub("https://b.example", 100, { down: true })).latest(), /HTTP 503/);
  await assert.rejects(new CrossChecked(stub("https://a.example", 100), stub("https://b.example", 99)).latest(), /no base block 100 yet/);
});

test("a cross-check needs two providers of one chain, and both must agree on canonical", async () => {
  assert.throws(() => new CrossChecked(stub("https://a.example", 1), stub("https://a.example", 1)), /two providers/);
  const eth = new EvmSource("ethereum", "eip155:1", "https://eth.example", rpcNode([ethBlock]));
  assert.throws(() => new CrossChecked(stub("https://a.example", 1), eth), /same chain/);
  await assert.rejects(new CrossChecked(stub("https://a.example", 1), stub("https://b.example", 1, { canonical: false })).byHash("0x" + "07".repeat(32)), /disagree on whether it is canonical/);
});

test("configuration: two https URLs per chain, mainnet by default, problems named", () => {
  const ok = timelineSourcesFromEnv({
    TIMELINE_BASE_RPC_URLS: "https://api.developer.coinbase.com/rpc/v1/base/KEY, https://base-mainnet.g.alchemy.com/v2/KEY",
    TIMELINE_ETHEREUM_RPC_URLS: "https://ethereum-rpc.publicnode.com,https://eth-mainnet.g.alchemy.com/v2/KEY",
  });
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.sources.base?.chainId, "eip155:8453");
  assert.equal(ok.sources.ethereum?.origin, "https://ethereum-rpc.publicnode.com + https://eth-mainnet.g.alchemy.com");
  assert.ok(!ok.sources.base?.origin.includes("KEY"));

  const bad = timelineSourcesFromEnv({
    TIMELINE_BASE_RPC_URLS: "https://only.example",
    TIMELINE_ETHEREUM_RPC_URLS: "http://a.example,https://b.example",
  });
  assert.deepEqual(Object.keys(bad.sources), []);
  assert.match(bad.problems.join(), /base: TIMELINE_BASE_RPC_URLS needs exactly two URLs, has 1/);
  assert.match(bad.problems.join(), /ethereum: every URL .* must be https/);
  assert.match(timelineSourcesFromEnv({ TIMELINE_BASE_RPC_URLS: "https://a.example,https://b.example", TIMELINE_BASE_CHAIN_ID: "eip155:1" }).problems.join(), /base: eip155:1 is not one of/);
  assert.match(timelineSourcesFromEnv({ TIMELINE_BASE_RPC_URLS: "https://a.example/x,https://a.example/y" }).problems.join(), /two providers/);
});
