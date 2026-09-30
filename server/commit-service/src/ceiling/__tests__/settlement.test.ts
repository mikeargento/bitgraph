/**
 * Settlement of a Base ceiling on Ethereum: the finder against a fake L1
 * (JSON-RPC and beacon API behind an injected fetch) whose batcher posts a
 * channel built here from scratch, and the writer's settlement pass against
 * a stub finder. Real data where the repo carries it: Ethereum block
 * 26,088,463's header and its two Base batcher transactions as the RPC
 * returned them, and blob 0 of channel 0x42b5…f4b5 (the audit's fixture).
 * Nothing here touches a network.
 *
 *   node --import tsx/esm --test src/ceiling/__tests__/settlement.test.ts
 */

import { test, describe } from "node:test";
import * as assert from "node:assert/strict";
import { readFileSync, existsSync, mkdtempSync, appendFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { brotliCompressSync } from "node:zlib";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { keccak256 as vk, parseTransaction, type Hex } from "viem";
import {
  decodeEip4844, verifySettlementPointer, versionedHashOf, keccak256, rlpEncode, txTrieProof, decodeEip1559, decodeHeader,
  evmBytesToHex as bytesToHex, evmHexToBytes as hexToBytes,
  type SettlementPointer, type SettlementPins, type CeilingSidecar,
} from "@mikeargento/bitgraph-verify";
import { checkedHeaderRlp, encodeHeaderRlp, type RpcBlock } from "../block.js";
import {
  findSettlement, rawTxFromJson, decodeOpBlob, parseFrames, decompressChannel, decodeBatches, createSettlementCache, settlementEndpointsFromEnv,
  BASE_MAINNET_ROLLUP, BLOB_BYTES, type FetchLike, type SettlementFound,
} from "../settlement.js";
import { CeilingWriter, blobFileName, type Chain, type Inclusion, type SettlementTarget } from "../writer.js";
import type { CeilingQueueItem } from "../../parent/ceiling-queue.js";

const here = new URL("./fixtures/settlement/", import.meta.url);
const l1Fixture = JSON.parse(readFileSync(new URL("l1-26088463.json", here), "utf8")) as { block: RpcBlock; txs: Array<Record<string, unknown>> };
const REAL_BLOB_PATH = new URL("../../../../../packages/audit/src/__tests__/fixtures/settlement/0x018efc046e94610e2530344caf1574e507a3182e1a975fb25b032ec1434a3f5c.bin", import.meta.url);
const BATCHER = "0x5050f69a9786f081509234f1a7f4684b5e5b76c9";
const INBOX = "0xff00000000000000000000000000000000008453";
const L1_HASH = "0x8608654cd9d6d66c2ce8a80108db7e5202a6d9ad0072f8c81353cc988d3a93f2";
const TX0 = "0xcb575f2482a33ce5678997adcb082d4b68f7927c932a07a7a89090e61c6ea63a";
const TX1 = "0x6165d90f2133ad9154d99c46fdc734af9ab5e84ce63710b5997363e222db0190";
/** The real ceiling transaction of Base block 51,979,918 (record position 4546), as the batch carries it. */
const CEILING_RAW = "0x02f8c082210581f3830f424083a7d8c082721594f3972408d853c975f86351c311f4310220bbf2a380b85442474331dbd541269066e97c8086b20644de7a849db0e6870c6a99be5d102c7a5a72ed378ba45845d1e6e1f87b07275c96aed4b0dfe64d88ef6a654d8029915798526c2f00000000000011c200000000000011c2c001a0e5af8d93a6d54d30963c11ca829d957cd11ee66531caa49c0ffde149bb5f00cca00a390e583140cf6c1050c432659d36312f5557d947e2981ca65d79f0967753bb";
const CEILING_TX = "0x72cc33632237a96db749836905e92e45bd5cc4167403bc7970a69f250b3e9450";

describe("real data", () => {
  test("the L1 header re-encodes to its hash; both batcher transactions re-encode to theirs", () => {
    assert.equal(bytesToHex(keccak256(checkedHeaderRlp(l1Fixture.block))), L1_HASH);
    const [t0, t1] = l1Fixture.txs as [never, never];
    const raw0 = rawTxFromJson(t0);
    const raw1 = rawTxFromJson(t1);
    assert.equal(bytesToHex(keccak256(raw0)), TX0);
    assert.equal(bytesToHex(keccak256(raw1)), TX1);
    assert.equal(decodeEip4844(raw0).from, BATCHER);
    assert.equal(decodeEip4844(raw1).to, INBOX);
    assert.equal(bytesToHex(keccak256(hexToBytes(CEILING_RAW))), CEILING_TX);
  });

  test("the real blob decodes to frame 0 of the channel and re-encodes byte for byte", () => {
    const blob = new Uint8Array(readFileSync(REAL_BLOB_PATH));
    assert.equal(blob.length, BLOB_BYTES);
    const data = decodeOpBlob(blob);
    const frames = parseFrames(data);
    assert.equal(frames.length, 1);
    assert.equal(frames[0]!.channelId, "0x42b5f4f4249919699b40a61bc497f4b5");
    assert.equal(frames[0]!.frameNumber, 0);
    assert.deepEqual(encodeOpBlob(data), blob, "the encoder used to build synthetic blobs is the decoder's inverse on a real blob");
    // Frame 0 alone: a prefix of the channel, three whole batches before the cut.
    const prefix = decompressChannel(frames[0]!.frameData, false);
    assert.equal(prefix.compression, "brotli");
    assert.equal(prefix.bytes.length, 577321);
    assert.throws(() => decodeBatches(prefix.bytes, BASE_MAINNET_ROLLUP, 8453n), /runs past the channel/);
  });

  test("endpoints come from the environment, publicnode by default", () => {
    assert.deepEqual(settlementEndpointsFromEnv({}), { l1Rpc: "https://ethereum-rpc.publicnode.com", beaconApi: "https://ethereum-beacon-api.publicnode.com" });
    assert.deepEqual(settlementEndpointsFromEnv({ CEILING_L1_RPC_URL: "http://l1", CEILING_BEACON_URL: "http://beacon" }), { l1Rpc: "http://l1", beaconApi: "http://beacon" });
  });
});

// ── a synthetic world: a channel, blobs, batcher transactions, an L1 ────────

/** OP Stack blob encoding version 0 (the batcher's FromData), for building blobs to serve. */
function encodeOpBlob(data: Uint8Array): Uint8Array {
  if (data.length > 130044) throw new Error("too much data for one blob");
  const blob = new Uint8Array(BLOB_BYTES);
  let readOffset = 0;
  let writeOffset = 0;
  const buf31 = new Uint8Array(31);
  const read1 = (): number => (readOffset >= data.length ? 0 : data[readOffset++]!);
  const read31 = (): void => {
    buf31.fill(0);
    if (readOffset >= data.length) return;
    const n = Math.min(31, data.length - readOffset);
    buf31.set(data.subarray(readOffset, readOffset + n));
    readOffset += n;
  };
  const write1 = (v: number): void => { blob[writeOffset++] = v; };
  const write31 = (): void => { blob.set(buf31, writeOffset); writeOffset += 31; };
  for (let round = 0; round < 1024 && readOffset < data.length; round++) {
    if (round === 0) {
      buf31.fill(0);
      buf31[1] = (data.length >> 16) & 0xff;
      buf31[2] = (data.length >> 8) & 0xff;
      buf31[3] = data.length & 0xff;
      const n = Math.min(27, data.length);
      buf31.set(data.subarray(0, n), 4);
      readOffset += n;
    } else {
      read31();
    }
    const x = read1();
    write1(x & 0x3f); write31();
    read31();
    const y = read1();
    write1((y & 0x0f) | ((x & 0xc0) >> 2)); write31();
    read31();
    const z = read1();
    write1(z & 0x3f); write31();
    read31();
    write1(((z & 0xc0) >> 2) | ((y & 0xf0) >> 4)); write31();
  }
  return blob;
}

const u = (n: number | bigint): Uint8Array => {
  let h = BigInt(n).toString(16);
  if (h === "0") return new Uint8Array(0);
  if (h.length % 2) h = "0" + h;
  return hexToBytes(h);
};
const hex = (n: number | bigint): string => "0x" + BigInt(n).toString(16);
const rnd = (n: number): Uint8Array => new Uint8Array(randomBytes(n));

/** A singular batch as one RLP byte string in the channel: rlp(0x00 ++ rlp([parent, epoch, epochHash, ts, txs])). */
function singularBatch(parentHash: Uint8Array, timestamp: number, txs: Uint8Array[]): Uint8Array {
  const content = rlpEncode([parentHash, u(26088450), rnd(32), u(timestamp), txs]);
  return rlpEncode(new Uint8Array([0x00, ...content]));
}

function frameBytes(channelId: Uint8Array, num: number, data: Uint8Array, isLast: boolean): Uint8Array {
  const len = data.length;
  return new Uint8Array([0x00, ...channelId, num >> 8, num & 0xff, (len >>> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff, ...data, isLast ? 1 : 0]);
}

const N = 51979918;
const L2TS = BASE_MAINNET_ROLLUP.l2GenesisTime + BASE_MAINNET_ROLLUP.blockTime * N;
const BASE_HASH_N = bytesToHex(rnd(32));
const PARENT_N = bytesToHex(rnd(32));
const L1_URL = "http://l1.test/rpc";
const BEACON_URL = "http://beacon.test";
const L1_T0 = { number: 26088463, timestamp: 1790749235 }; // the real block's number and time anchor the fake grid
const l1Time = (n: number): number => L1_T0.timestamp + 12 * (n - L1_T0.number);
const slotOf = (n: number): number => (l1Time(n) - 1606824023) / 12;
const HEAD = 26088520;

/**
 * A channel of three Base blocks (N-1 with 150 KB of incompressible filler, N
 * holding the ceiling transaction at index 2, N+1 small), compressed and cut
 * into frames at the given compressed offsets. Random filler compresses to
 * about its own size, so a cut below 150,000 lands inside block N-1's batch
 * and a cut a few hundred bytes from the end lands after the ceiling
 * transaction's bytes.
 */
function buildChannel(cuts: number[]): { frames: Uint8Array[]; channelId: Uint8Array; ceilingIndex: number } {
  const filler = Array.from({ length: 15 }, () => rnd(10_000));
  const batches = [
    singularBatch(rnd(32), L2TS - 2, filler),
    singularBatch(hexToBytes(PARENT_N), L2TS, [rnd(1000), rnd(1000), hexToBytes(CEILING_RAW), rnd(500)]),
    singularBatch(hexToBytes(BASE_HASH_N), L2TS + 2, [rnd(200)]),
  ];
  const channel = new Uint8Array(batches.reduce((n, b) => n + b.length, 0));
  let o = 0;
  for (const b of batches) { channel.set(b, o); o += b.length; }
  const compressed = new Uint8Array([0x01, ...brotliCompressSync(channel)]);
  const channelId = rnd(16);
  // A negative cut counts from the end of the compressed stream.
  const bounds = [0, ...cuts.map((c) => (c < 0 ? compressed.length + c : c)), compressed.length];
  const frames: Uint8Array[] = [];
  for (let i = 0; i + 1 < bounds.length; i++) frames.push(frameBytes(channelId, i, compressed.subarray(bounds[i]!, bounds[i + 1]!), i + 2 === bounds.length));
  return { frames, channelId, ceilingIndex: 2 };
}

interface Sidecar { index: string; blob: string; kzg_commitment: string; kzg_proof: string }
interface World { pins: SettlementPins; fetch: FetchLike; calls: string[]; txHashes: string[]; blockHash: (n: number) => string; served: Map<string, Uint8Array> }

/** The fake L1: every block on a 12 s grid; the given batcher transactions (each a list of blob data payloads) in their blocks. */
function world(placements: Array<{ l1Block: number; blobDatas: Uint8Array[] }>, tamper: { wrongCommitment?: boolean } = {}): Promise<World> {
  return makeWorld(placements, tamper, privateKeyToAccount(generatePrivateKey()));
}

async function makeWorld(
  placements: Array<{ l1Block: number; blobDatas: Uint8Array[] }>,
  tamper: { wrongCommitment?: boolean },
  account: ReturnType<typeof privateKeyToAccount>,
): Promise<World> {
  const pins: SettlementPins = { l1ChainId: 1, batchInbox: INBOX, batcher: account.address.toLowerCase() };
  const blocks = new Map<number, RpcBlock & { transactions: Array<Record<string, unknown>> }>();
  const rawByHash = new Map<string, string>();
  const sidecars = new Map<number, Sidecar[]>();
  const txHashes: string[] = [];
  const served = new Map<string, Uint8Array>();
  const z32 = "0x" + "00".repeat(32);
  const makeBlock = (n: number, txs: Array<Record<string, unknown>>, raws: Uint8Array[]): void => {
    const root = raws.length ? bytesToHex(txTrieProof(raws, 0).root) : "0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421";
    const b = {
      parentHash: z32, sha3Uncles: "0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347", miner: "0x" + "00".repeat(20), stateRoot: z32,
      transactionsRoot: root, receiptsRoot: z32, logsBloom: "0x" + "00".repeat(256), difficulty: "0x0", number: hex(n), gasLimit: "0x1c9c380",
      gasUsed: "0x5208", timestamp: hex(l1Time(n)), extraData: "0x", mixHash: z32, nonce: "0x0000000000000000", baseFeePerGas: "0x7",
      withdrawalsRoot: z32, blobGasUsed: "0x0", excessBlobGas: "0x0", parentBeaconBlockRoot: z32, requestsHash: z32,
      hash: "", transactions: txs,
    };
    b.hash = bytesToHex(keccak256(encodeHeaderRlp(b as unknown as RpcBlock)));
    blocks.set(n, b as never);
  };
  let nonce = 0;
  const byBlock = new Map<number, Array<{ blobDatas: Uint8Array[] }>>();
  for (const p of placements) byBlock.set(p.l1Block, [...(byBlock.get(p.l1Block) ?? []), p]);
  for (const [n, txsHere] of byBlock) {
    const jsonTxs: Array<Record<string, unknown>> = [];
    const raws: Uint8Array[] = [];
    const scs: Sidecar[] = [];
    const push = (json: Record<string, unknown>, raw: Uint8Array): void => { jsonTxs.push({ ...json, transactionIndex: hex(jsonTxs.length) }); raws.push(raw); };
    // The two real batcher transactions, from the REAL batcher (not this world's), and one of a type the re-encoder does not know.
    push(l1Fixture.txs[0]!, rawTxFromJson(l1Fixture.txs[0] as never));
    const odd = hexToBytes("0x05" + "aa".repeat(40));
    rawByHash.set(bytesToHex(keccak256(odd)), bytesToHex(odd));
    push({ hash: bytesToHex(keccak256(odd)), type: "0x5", from: "0x" + "77".repeat(20), to: "0x" + "88".repeat(20), r: "0x1", s: "0x1" }, odd);
    for (const t of txsHere) {
      const commitments = t.blobDatas.map(() => new Uint8Array([0xc0 | randomBytes(1)[0]!, ...rnd(47)]));
      const vhs = commitments.map((c) => versionedHashOf(c));
      const raw = hexToBytes(await account.signTransaction({
        type: "eip4844", chainId: 1, nonce: nonce++, to: INBOX, value: 0n, data: "0x", gas: 21000n,
        maxFeePerGas: 7_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n, maxFeePerBlobGas: 1_000_000_000n, blobVersionedHashes: vhs as Hex[],
      }));
      const p = parseTransaction(bytesToHex(raw) as Hex);
      const hash = bytesToHex(keccak256(raw));
      txHashes.push(hash);
      push({
        hash, type: "0x3", chainId: "0x1", nonce: hex(p.nonce!), gas: hex(p.gas!), maxFeePerGas: hex(p.maxFeePerGas!), maxPriorityFeePerGas: hex(p.maxPriorityFeePerGas!),
        to: INBOX, value: "0x0", input: "0x", accessList: [], maxFeePerBlobGas: hex(p.maxFeePerBlobGas!), blobVersionedHashes: vhs,
        yParity: hex(p.yParity!), v: hex(p.yParity!), r: p.r, s: p.s, from: account.address.toLowerCase(),
      }, raw);
      t.blobDatas.forEach((data, i) => {
        const blob = encodeOpBlob(data);
        served.set(vhs[i]!, blob);
        const c = tamper.wrongCommitment ? new Uint8Array([0xc0, ...rnd(47)]) : commitments[i]!;
        scs.push({ index: String(scs.length), blob: bytesToHex(blob), kzg_commitment: bytesToHex(c), kzg_proof: "0xc0" + "00".repeat(47) });
      });
    }
    push(l1Fixture.txs[1]!, rawTxFromJson(l1Fixture.txs[1] as never));
    makeBlock(n, jsonTxs, raws);
    sidecars.set(slotOf(n), scs);
  }
  const blockAt = (n: number) => {
    if (n < 0 || n > HEAD) return null;
    if (!blocks.has(n)) makeBlock(n, [], []);
    return blocks.get(n)!;
  };
  const calls: string[] = [];
  const reply = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
  const fetch: FetchLike = async (url, init) => {
    if (url === L1_URL) {
      const req = JSON.parse(init!.body!) as { id: number; method: string; params: unknown[] };
      let result: unknown = null;
      if (req.method === "eth_getBlockByNumber") {
        const [tag, full] = req.params as [string, boolean];
        const n = tag === "latest" ? HEAD : parseInt(tag, 16);
        calls.push(`${req.method}:${full ? "full" : "hashes"}:${n}`);
        const b = blockAt(n);
        result = b ? (full ? b : { ...b, transactions: b.transactions.map((t) => (t as { hash: string }).hash) }) : null;
      } else if (req.method === "eth_getRawTransactionByHash") {
        calls.push(req.method);
        result = rawByHash.get((req.params[0] as string).toLowerCase()) ?? null;
      } else {
        return reply({ jsonrpc: "2.0", id: req.id, error: { message: `no ${req.method} here` } });
      }
      return reply({ jsonrpc: "2.0", id: req.id, result });
    }
    if (url.startsWith(BEACON_URL)) {
      const m = /\/eth\/v1\/beacon\/blob_sidecars\/(\d+)$/.exec(url);
      calls.push(`beacon:${m?.[1]}`);
      return reply({ data: sidecars.get(Number(m?.[1])) ?? [] });
    }
    throw new Error(`unexpected url ${url}`);
  };
  return { pins, fetch, calls, txHashes, blockHash: (n) => blockAt(n)!.hash, served };
}

/** `tx: null` asks for no transaction to be located. */
const find = (w: World, extra: Partial<Parameters<typeof findSettlement>[2]> = {}, target: { n?: number; hash?: string; parent?: string; tx?: string | null } = {}) =>
  findSettlement(target.n ?? N, target.hash ?? BASE_HASH_N, {
    l1Rpc: L1_URL, beaconApi: BEACON_URL, pins: w.pins, fetch: w.fetch,
    base: {
      blockTimestamp: BASE_MAINNET_ROLLUP.l2GenesisTime + 2 * (target.n ?? N), parentHash: target.parent ?? PARENT_N,
      ...(target.tx === null ? {} : { txHash: target.tx ?? CEILING_TX }),
    },
    ...extra,
  });

describe("findSettlement against a fake L1", () => {
  test("one transaction carrying the whole channel: pointer, blobs, channel, located; the pointer layer accepts it", async () => {
    const { frames, channelId, ceilingIndex } = buildChannel([100_000]);
    const w = await world([{ l1Block: 26088463, blobDatas: frames }]);
    const found = (await find(w))!;
    assert.ok(found, "found");
    const p = found.pointer;
    assert.equal(p.version, "bitgraph-settlement/1");
    assert.equal(p.baseBlockNumber, N);
    assert.equal(p.baseBlockHash, BASE_HASH_N);
    assert.equal(p.l1.chainId, 1);
    assert.equal(p.l1.txHash, w.txHashes[0]);
    assert.equal(p.l1.blockNumber, 26088463);
    assert.equal(p.l1.blockHash, w.blockHash(26088463));
    assert.equal(p.l1.blockTimestamp, 1790749235);
    assert.equal(p.l1.txIndex, 2);
    assert.equal(decodeHeader(hexToBytes(p.l1.blockHeader)).hash, p.l1.blockHash);
    assert.equal(p.blobs.length, 2);
    assert.deepEqual(p.blobs.map((b) => b.index), [0, 1]);
    for (const b of p.blobs) {
      assert.equal(b.file, `${b.versionedHash}.bin`);
      assert.equal(versionedHashOf(hexToBytes(b.kzgCommitment)), b.versionedHash);
    }
    assert.deepEqual(p.channel, { id: bytesToHex(channelId), frames: 2, compression: "brotli", firstBaseBlock: N - 1, lastBaseBlock: N + 1 });
    assert.deepEqual(p.located, { baseTxIndex: ceilingIndex, txHash: CEILING_TX });
    assert.deepEqual(found.blobs.map((b) => b.versionedHash), p.blobs.map((b) => b.versionedHash));
    for (const b of found.blobs) assert.deepEqual(b.bytes, w.served.get(b.versionedHash));
    const v = verifySettlementPointer(p, w.pins);
    assert.equal(v.ok, true, v.reason);
    assert.equal(v.existedBy!.blockNumber, 26088463);
    // The unknown-type transaction was fetched raw; the real batcher transactions re-encoded without it.
    assert.equal(w.calls.filter((c) => c === "eth_getRawTransactionByHash").length, 1);
  });

  test("frame 0 in one transaction, the last frame in another: the pointer names the transaction that completes the ceiling's bytes", async () => {
    const { frames } = buildChannel([100_000]);
    const w = await world([{ l1Block: 26088463, blobDatas: [frames[0]!] }, { l1Block: 26088464, blobDatas: [frames[1]!] }]);
    const found = (await find(w))!;
    assert.equal(found.pointer.l1.txHash, w.txHashes[1], "frame 0 alone stops inside block N-1's filler, so frame 1's transaction is the evidence");
    assert.equal(found.pointer.l1.blockNumber, 26088464);
    assert.equal(found.pointer.blobs.length, 1);
    assert.equal(found.pointer.channel!.frames, 2);
    assert.equal(verifySettlementPointer(found.pointer, w.pins).ok, true);
  });

  test("frames 0 and 1 reach the ceiling's bytes: the pointer names frame 0's transaction even though the channel ends in another", async () => {
    const { frames } = buildChannel([60_000, -300]);
    assert.equal(frames.length, 3);
    const w = await world([{ l1Block: 26088463, blobDatas: [frames[0]!, frames[1]!] }, { l1Block: 26088465, blobDatas: [frames[2]!] }]);
    const found = (await find(w))!;
    assert.equal(found.pointer.l1.txHash, w.txHashes[0]);
    assert.equal(found.pointer.blobs.length, 2);
    assert.equal(found.pointer.channel!.frames, 3);
  });

  test("a channel that opened before the Base block's time is found by scanning back", async () => {
    const { frames } = buildChannel([100_000]);
    const w = await world([{ l1Block: 26088455, blobDatas: [frames[0]!] }, { l1Block: 26088461, blobDatas: [frames[1]!] }]);
    const found = (await find(w))!;
    assert.equal(found.pointer.l1.blockNumber, 26088461);
  });

  test("an incomplete channel is not a settlement yet: null, to be asked again", async () => {
    const { frames } = buildChannel([100_000]);
    const w = await world([{ l1Block: 26088463, blobDatas: [frames[0]!] }]);
    assert.equal(await find(w, { scanForward: 30 }), null);
  });

  test("a beacon blob whose commitment is not what the signed transaction lists is refused", async () => {
    const { frames } = buildChannel([100_000]);
    const w = await world([{ l1Block: 26088463, blobDatas: frames }], { wrongCommitment: true });
    await assert.rejects(find(w), /has no blob for/);
  });

  test("verifyBlob, when supplied, can refuse the bytes", async () => {
    const { frames } = buildChannel([100_000]);
    const w = await world([{ l1Block: 26088463, blobDatas: frames }]);
    await assert.rejects(find(w, { verifyBlob: () => false }), /do not verify against the commitment/);
    assert.ok(await find(w, { verifyBlob: () => true }));
  });

  test("a batch that contradicts what the writer saw on Base is an error, not a settlement", async () => {
    const { frames } = buildChannel([100_000]);
    const w = await world([{ l1Block: 26088463, blobDatas: frames }]);
    await assert.rejects(find(w, {}, { parent: "0x" + "ee".repeat(32) }), /has parent .*the block's parent is/);
    await assert.rejects(find(w, {}, { hash: "0x" + "dd".repeat(32) }), /names parent .*not the block's hash/);
    await assert.rejects(find(w, {}, { tx: "0x" + "cc".repeat(32) }), /is not among the 4 transactions batched/);
    await assert.rejects(find(w, { rollup: { l2GenesisTime: 1, blockTime: 2 } }), /not on the rollup's block grid/);
  });

  test("a block of the same channel, asked next with the same cache, needs no L1 block fetched again", async () => {
    const { frames } = buildChannel([100_000]);
    const w = await world([{ l1Block: 26088463, blobDatas: frames }]);
    const cache = createSettlementCache();
    assert.ok(await find(w, { cache }));
    const before = w.calls.length;
    const again = await find(w, { cache }, { n: N + 1, hash: "0x" + "ab".repeat(32), parent: BASE_HASH_N, tx: null });
    assert.ok(again);
    assert.equal(again.pointer.located, undefined);
    assert.equal(w.calls.slice(before).filter((c) => c.includes(":full:")).length, 0, "full blocks come from the cache");
    assert.equal(w.calls.slice(before).filter((c) => c.startsWith("beacon:")).length, 0, "blobs come from the cache");
  });
});

// ── the writer's settlement pass ───────────────────────────────────────────

class FakeChain implements Chain {
  chainId = 84532;
  writer: string;
  private account = privateKeyToAccount(generatePrivateKey());
  height = 100;
  mempool = new Map<number, string>();
  mined = new Map<string, Inclusion>();
  blocks = new Map<number, string>();
  nonce = 0;
  safe = 0;
  finalized = 0;
  constructor() { this.writer = this.account.address.toLowerCase(); }
  async head() { return this.height; }
  async nextNonce() { return this.nonce; }
  async sign(data: Uint8Array, nonce: number, bump: number) {
    const tip = 1_000_000n * BigInt(1 + bump);
    const rawTx = await this.account.signTransaction({
      type: "eip1559", chainId: this.chainId, nonce, to: this.account.address, value: 0n,
      data: bytesToHex(data) as Hex, gas: 30_000n, maxFeePerGas: 2_000_000_000n + tip, maxPriorityFeePerGas: tip,
    });
    return { rawTx, txHash: vk(rawTx), maxFeePerGas: String(2_000_000_000n + tip), maxPriorityFeePerGas: String(tip) };
  }
  async broadcast(rawTx: string) { this.mempool.set(Number(decodeEip1559(hexToBytes(rawTx)).nonce), rawTx); }
  step() {
    this.height++;
    const raw = this.mempool.get(this.nonce);
    const txs = [hexToBytes("0x7e01")];
    if (raw) txs.push(hexToBytes(raw));
    const { root, proof } = txTrieProof(txs, txs.length - 1);
    const hdr = rlpEncode([hexToBytes("0x" + "ab".repeat(32)), new Uint8Array(32), new Uint8Array(20), new Uint8Array(32), root, new Uint8Array(32),
      new Uint8Array(256), u(0), u(this.height), u(1), u(1), u(1_790_000_000 + this.height * 2), new Uint8Array(0), new Uint8Array(32), new Uint8Array(8)]);
    const hash = bytesToHex(keccak256(hdr));
    this.blocks.set(this.height, hash);
    if (raw) {
      this.mempool.delete(this.nonce);
      this.nonce++;
      this.mined.set(vk(raw as Hex), {
        blockNumber: this.height, blockHash: hash, blockTimestamp: 1_790_000_000 + this.height * 2, headerRlp: bytesToHex(hdr),
        txIndex: 1, txInclusionProof: proof.map(bytesToHex), fees: { l2Wei: "21000", l1Wei: "5", totalWei: "21005", gasUsed: "21000" },
      });
    }
  }
  async inclusion(txHash: string) { return this.mined.get(txHash.toLowerCase()) ?? null; }
  async blockHashAt(n: number) { return this.blocks.get(n) ?? null; }
  async safeHead() { return this.safe; }
  async finalizedHead() { return this.finalized; }
  async balanceWei() { return 10n ** 18n; }
  async floorHeader() { return null; }
}

let seq = 0;
function item(): CeilingQueueItem {
  seq++;
  return { proofHash: createHash("sha256").update(`s${seq}`).digest("base64"), position: String(1000 + seq), epochId: "E1", chainId: "bitgraph:main", committedAt: new Date(Date.UTC(2026, 8, 30) + seq).toISOString(), floor: null };
}

const VH_A = "0x01" + "aa".repeat(31);
const VH_B = "0x01" + "bb".repeat(31);
function fakeFound(target: SettlementTarget, l1Block = 26088463): SettlementFound {
  const pointer: SettlementPointer = {
    version: "bitgraph-settlement/1", baseBlockNumber: target.blockNumber, baseBlockHash: target.blockHash,
    l1: { chainId: 1, txHash: "0x" + "11".repeat(32), rawTx: "0x03c0", blockNumber: l1Block, blockHash: "0x" + "22".repeat(32), blockTimestamp: target.blockTimestamp + 50, blockHeader: "0xc0", txIndex: 3, txInclusionProof: ["0xc0"] },
    blobs: [{ versionedHash: VH_A, kzgCommitment: "0x" + "c0".repeat(48), index: 0 }, { versionedHash: VH_B, kzgCommitment: "0x" + "c1".repeat(48), index: 1 }],
    channel: { id: "0x" + "33".repeat(16), frames: 2, compression: "brotli", firstBaseBlock: target.blockNumber - 1, lastBaseBlock: target.blockNumber + 1 },
    located: { baseTxIndex: 0, txHash: target.txHash },
  };
  return { pointer, blobs: [{ versionedHash: VH_A, kzgCommitment: pointer.blobs[0]!.kzgCommitment, index: 0, bytes: new Uint8Array([1, 2, 3]) }, { versionedHash: VH_B, kzgCommitment: pointer.blobs[1]!.kzgCommitment, index: 1, bytes: new Uint8Array([4, 5, 6]) }] };
}

function setup(find: (t: SettlementTarget) => Promise<SettlementFound | null>, extra: { giveUpAfterMs?: number; pins?: SettlementPins } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ceiling-settlement-"));
  const queuePath = join(dir, "queue.jsonl");
  const chain = new FakeChain();
  const published: string[] = [];
  let clock = Date.UTC(2026, 8, 30, 12);
  const now = () => new Date(clock);
  const mk = () => new CeilingWriter({
    stateDir: dir, queuePath, chain, log: () => {}, now,
    settlement: { find, everyMs: -1, publishBlob: async (name) => { published.push(name); }, ...extra },
  });
  const push = (...items: CeilingQueueItem[]) => appendFileSync(queuePath, items.map((i) => JSON.stringify(i) + "\n").join(""));
  const sidecar = (i: CeilingQueueItem) => JSON.parse(readFileSync(join(dir, "sidecars", i.proofHash.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") + ".ceiling.json"), "utf8")) as Omit<CeilingSidecar, "settlement"> & { settlement: SettlementPointer | null };
  const events = () => (existsSync(join(dir, "events.jsonl")) ? readFileSync(join(dir, "events.jsonl"), "utf8") : "").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
  const record = () => { const days = readdirSync(join(dir, "writes")); return days.flatMap((d) => readdirSync(join(dir, "writes", d)).map((f) => JSON.parse(readFileSync(join(dir, "writes", d, f), "utf8")) as Record<string, unknown>)); };
  const advance = (ms: number) => { clock += ms; };
  /** Queue, send, mine, include, then reach safe: the point at which settlement is asked for. */
  const toSafe = async (w: CeilingWriter, i: CeilingQueueItem) => {
    push(i);
    await w.tick();
    chain.step();
    await w.tick();
    chain.safe = sidecar(i).anchor!.blockNumber;
    (w as unknown as { lastStatusPoll: number }).lastStatusPoll = 0;
    await w.tick();
    assert.equal(sidecar(i).status, "safe");
  };
  return { dir, chain, mk, push, sidecar, events, record, published, advance, toSafe };
}

describe("the writer's settlement pass", () => {
  test("a safe batch gets its settlement: blobs on disk and published, the pointer on every sidecar and the write record", async () => {
    const calls: SettlementTarget[] = [];
    const { dir, mk, sidecar, events, record, published, toSafe, chain } = setup(async (t) => { calls.push(t); return fakeFound(t); });
    const w = mk();
    const a = item();
    await toSafe(w, a);
    const s = sidecar(a);
    assert.ok(s.settlement, "the sidecar carries the pointer");
    assert.equal(s.settlement!.baseBlockNumber, s.anchor!.blockNumber);
    assert.deepEqual(s.settlement!.blobs.map((b) => b.file), [`${VH_A}.bin`, `${VH_B}.bin`]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.txHash, s.anchor!.txHash);
    assert.equal(calls[0]!.parentHash, "0x" + "ab".repeat(32), "the parent hash is read from the carried header");
    assert.deepEqual(new Uint8Array(readFileSync(join(dir, "blobs", `${VH_A}.bin`))), new Uint8Array([1, 2, 3]));
    assert.deepEqual(published.sort(), [`blobs/${VH_A}.bin`, `blobs/${VH_B}.bin`]);
    const rec = record().find((r) => r["settlement"]) as { settlement: Record<string, unknown> };
    assert.equal(rec.settlement["l1BlockNumber"], 26088463);
    assert.deepEqual(rec.settlement["blobs"], [`${VH_A}.bin`, `${VH_B}.bin`]);
    const ev = events().find((e) => e["type"] === "settlement")!;
    assert.equal(ev["latencySeconds"], 50);
    assert.equal(ev["blobs"], 2);
    // Finalized keeps it; the finder is not asked again.
    chain.finalized = s.anchor!.blockNumber;
    (w as unknown as { lastStatusPoll: number }).lastStatusPoll = 0;
    await w.tick();
    assert.equal(sidecar(a).status, "finalized");
    assert.deepEqual(sidecar(a).settlement, s.settlement);
    assert.equal(calls.length, 1);
  });

  test("a settlement is never replaced, and blobs shared by batches are written and published once", async () => {
    let round = 0;
    const { mk, sidecar, published, toSafe } = setup(async (t) => fakeFound(t, 26088463 + round++));
    const w = mk();
    const a = item();
    await toSafe(w, a);
    const first = sidecar(a).settlement!;
    assert.equal(first.l1.blockNumber, 26088463);
    const b = item();
    await toSafe(w, b);
    assert.equal(sidecar(b).settlement!.l1.blockNumber, 26088464, "a second batch gets its own find");
    assert.deepEqual(sidecar(a).settlement, first, "the first batch keeps what it had");
    assert.equal(published.length, 2, "the same two blobs, published once");
  });

  test("not found yet is asked again; a throwing finder is logged and asked again; the deadline ends it", async () => {
    let answer: "null" | "throw" | "found" = "null";
    let calls = 0;
    const { mk, sidecar, events, advance, toSafe } = setup(async (t) => { calls++; if (answer === "throw") throw new Error("beacon down"); return answer === "found" ? fakeFound(t) : null; }, { giveUpAfterMs: 3_600_000 });
    const w = mk();
    const a = item();
    await toSafe(w, a);
    assert.equal(sidecar(a).settlement, null);
    assert.equal(calls, 1);
    answer = "throw";
    await w.tick();
    assert.equal(calls, 2);
    assert.match(String(events().find((e) => e["type"] === "settlement-error")!["error"]), /beacon down/);
    assert.equal(sidecar(a).settlement, null);
    answer = "null";
    advance(4_000_000);
    await w.tick();
    assert.equal(calls, 2, "past the deadline the finder is not asked");
    assert.ok(events().some((e) => e["type"] === "settlement-gave-up"));
    answer = "found";
    await w.tick();
    assert.equal(calls, 2);
    assert.equal(sidecar(a).settlement, null);
  });

  test("with pins, a pointer that does not verify is refused and logged", async () => {
    const { mk, sidecar, events, toSafe } = setup(async (t) => fakeFound(t), { pins: { l1ChainId: 1, batchInbox: INBOX, batcher: BATCHER } });
    const w = mk();
    const a = item();
    await toSafe(w, a);
    assert.equal(sidecar(a).settlement, null);
    assert.match(String(events().find((e) => e["type"] === "settlement-refused")!["reason"]), /^header:/);
  });

  test("a restart keeps the settlement and asks for nothing", async () => {
    let calls = 0;
    const { mk, sidecar, toSafe } = setup(async (t) => { calls++; return fakeFound(t); });
    let w = mk();
    const a = item();
    await toSafe(w, a);
    const before = sidecar(a).settlement;
    w = mk();
    await w.tick();
    await w.tick();
    assert.deepEqual(sidecar(a).settlement, before);
    assert.equal(calls, 1);
  });

  test("blobFileName is the versioned hash plus .bin, and nothing else", () => {
    assert.equal(blobFileName(VH_A), `${VH_A}.bin`);
    assert.throws(() => blobFileName("0x02" + "aa".repeat(31)), /not a versioned hash/);
    assert.throws(() => blobFileName("../x"), /not a versioned hash/);
  });
});
