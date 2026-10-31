/**
 * The timeline's block sources. The fixtures are real blocks: Base 53309237 (mainnet.base.org), Ethereum 23673552
 * (ethereum-rpc.publicnode.com) and Bitcoin 920000's header (mempool.space), served here by a fake HTTP layer.
 *
 *   cd server/commit-service && node --import tsx/esm --test src/parent/__tests__/chain-sources.test.ts
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { CrossChecked, EsploraSource, EvmSource, parseBitcoinHeader, type BlockSource, type ChainHead, type Http } from "../chain-sources.js";
import type { RpcBlock } from "../base-head.js";

const fixture = (name: string): string => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const baseBlock = (JSON.parse(fixture("base-block.json")) as { result: RpcBlock }).result;
const ethBlock = (JSON.parse(fixture("ethereum-block.json")) as { result: RpcBlock }).result;
const BTC_920000 = "000000000000000000005e9de5d9e008d923ced659896d9ad012e347882bdc87";
const btcHeader = fixture("bitcoin-920000.header").trim();

/** A JSON-RPC node holding these blocks; `latest` is the highest. */
function rpcNode(blocks: RpcBlock[], opts: { fail?: boolean } = {}): Http & { calls: string[] } {
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
      return { error: { message: "method not found" } };
    },
    async getText() { throw new Error("not an Esplora server"); },
  };
}

/** An Esplora server holding block 920000. */
function esplora(opts: { header?: string; inBest?: boolean } = {}): Http {
  const routes: Record<string, string> = {
    "/blocks/tip/height": "920000",
    "/block-height/920000": BTC_920000,
    [`/block/${BTC_920000}/header`]: opts.header ?? btcHeader,
    [`/block/${BTC_920000}/status`]: JSON.stringify({ in_best_chain: opts.inBest ?? true, height: 920000 }),
  };
  return {
    async postJson() { throw new Error("not JSON-RPC"); },
    async getText(url) {
      const path = new URL(url).pathname.replace(/^\/api/, "");
      if (!(path in routes)) throw new Error("HTTP 404");
      return routes[path]!;
    },
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

test("the real Bitcoin header checks against its hash and gives its time and parent", () => {
  const h = parseBitcoinHeader(btcHeader, BTC_920000);
  assert.equal(h.hash, BTC_920000);
  assert.match(h.parentHash, /^0{16}[0-9a-f]{48}$/);
  assert.ok(h.timestamp > 1_750_000_000 && h.timestamp < 1_800_000_000);
  assert.throws(() => parseBitcoinHeader(btcHeader, "00".repeat(32)), /hashes to/);
  assert.throws(() => parseBitcoinHeader(btcHeader.slice(0, 158), BTC_920000), /80 bytes/);
});

test("Esplora: tip, height and hash lookups, with the header checked every time", async () => {
  const src = new EsploraSource("https://mempool.space/api", esplora());
  const tip = await src.latest();
  assert.deepEqual([tip.chain, tip.chainId, tip.number, tip.hash], ["bitcoin", "bip122:000000000019d6689c085ae165831e93", 920000, BTC_920000]);
  assert.equal((await src.byHash(BTC_920000))?.canonical, true);
  assert.equal(await src.byHash("ab".repeat(32)), null);
  assert.equal((await new EsploraSource("https://mempool.space/api", esplora({ inBest: false })).byHash(BTC_920000))?.canonical, false);
  const tampered = btcHeader.slice(0, 136) + "00000000" + btcHeader.slice(144);
  await assert.rejects(new EsploraSource("https://blockstream.info/api", esplora({ header: tampered })).at(920000), /hashes to/);
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
  const btc = new EsploraSource("https://mempool.space/api", esplora());
  assert.throws(() => new CrossChecked(stub("https://a.example", 1), btc), /same chain/);
  await assert.rejects(new CrossChecked(stub("https://a.example", 1), stub("https://b.example", 1, { canonical: false })).byHash("0x" + "07".repeat(32)), /disagree on whether it is canonical/);
});

test("real Bitcoin through two Esplora providers", async () => {
  const cc = new CrossChecked(new EsploraSource("https://mempool.space/api", esplora()), new EsploraSource("https://blockstream.info/api", esplora()));
  assert.equal((await cc.latest()).hash, BTC_920000);
});
