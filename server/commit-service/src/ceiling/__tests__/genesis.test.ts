/**
 * The genesis transaction: a request file in, one self-addressed transaction out, the result file once mined.
 *
 *   node --import tsx/esm --test src/ceiling/__tests__/genesis.test.ts
 */

import { test } from "node:test";
import * as assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { keccak256, type Hex } from "viem";
import { decodeEip1559, evmBytesToHex, evmHexToBytes, epochIdOfCalldata, parseEpochGenesisFile, EPOCH_GENESIS_REQUEST_FORMAT } from "@mikeargento/bitgraph-verify";
import { GenesisWriter } from "../genesis.js";
import type { Chain, Inclusion } from "../writer.js";

/** Enough of a chain for a genesis: signs, holds a mempool, mines on step(). */
class MiniChain implements Chain {
  chainId = 84532;
  writer: string;
  private account = privateKeyToAccount(generatePrivateKey());
  height = 100;
  nonce = 0;
  mining = true;
  mempool = new Map<number, string>();
  mined = new Map<string, Inclusion & { data: string }>();
  broadcasts = 0;
  constructor() { this.writer = this.account.address.toLowerCase(); }
  async head() { return this.height; }
  async nextNonce() { return this.nonce; }
  async sign(data: Uint8Array, nonce: number, bump: number) {
    const tip = 1_000_000n * BigInt(1 + bump);
    const rawTx = await this.account.signTransaction({
      type: "eip1559", chainId: this.chainId, nonce, to: this.account.address, value: 0n,
      data: evmBytesToHex(data) as Hex, gas: 30_000n, maxFeePerGas: 2_000_000_000n + tip, maxPriorityFeePerGas: tip,
    });
    return { rawTx, txHash: keccak256(rawTx), maxFeePerGas: String(2_000_000_000n + tip), maxPriorityFeePerGas: String(tip) };
  }
  async broadcast(rawTx: string) {
    this.broadcasts++;
    const n = Number(decodeEip1559(evmHexToBytes(rawTx)).nonce);
    this.mempool.set(n, rawTx);
  }
  step() {
    this.height++;
    const raw = this.mining ? this.mempool.get(this.nonce) : undefined;
    if (!raw) return;
    this.mempool.delete(this.nonce);
    this.nonce++;
    const tx = decodeEip1559(evmHexToBytes(raw));
    this.mined.set(keccak256(raw as Hex), {
      blockNumber: this.height, blockHash: "0x" + this.height.toString(16).padStart(64, "0"), blockTimestamp: 1_790_000_000 + this.height * 2,
      headerRlp: "0x", txIndex: 1, txInclusionProof: [], fees: { l2Wei: "21000", l1Wei: "5", totalWei: "21005", gasUsed: "21000" },
      data: evmBytesToHex(tx.data),
    });
  }
  async inclusion(txHash: string) { return this.mined.get(txHash.toLowerCase()) ?? null; }
  async blockHashAt(n: number) { return "0x" + n.toString(16).padStart(64, "0"); }
  async safeHead() { return 0; }
  async finalizedHead() { return 0; }
  async balanceWei() { return 10n ** 18n; }
  async floorHeader() { return null; }
}

const epochId = Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 13 + 1) & 0xff)).toString("base64");
const safe = epochId.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "genesis-"));
  const chain = new MiniChain();
  const events: Record<string, unknown>[] = [];
  const w = new GenesisWriter({ dir, chain, chainId: 84532, replaceAfterBlocks: 3, now: () => new Date(0), log: (e) => events.push(e) });
  const request = () => writeFileSync(join(dir, `${safe}.request.json`), JSON.stringify({ format: EPOCH_GENESIS_REQUEST_FORMAT, epochId, requestedAt: "2026-10-23T00:00:00.000Z" }));
  return { dir, chain, w, events, request };
}

test("a request becomes one transaction carrying the epoch id, then the result file", async () => {
  const { dir, chain, w, events, request } = setup();
  assert.equal(await w.pass(true), false, "nothing to do without a request");
  request();
  assert.equal(await w.pass(true), true, "sent, in flight");
  assert.equal(chain.broadcasts, 1);
  assert.ok(existsSync(join(dir, `${safe}.sent.json`)));
  assert.equal(await w.pass(true), true, "still in flight before a block");
  chain.step();
  assert.equal(await w.pass(true), false, "mined: done");
  const text = readFileSync(join(dir, `${safe}.json`), "utf8");
  const g = parseEpochGenesisFile(text);
  assert.ok(g);
  assert.equal(g.epochId, epochId);
  assert.equal(g.chain, "base-sepolia");
  assert.equal(g.writer, chain.writer);
  assert.equal(g.blockNumber, 101);
  const mined = [...chain.mined.values()][0]!;
  assert.equal(epochIdOfCalldata(mined.data), epochId, "the calldata is BGE1 and the epoch id");
  assert.equal(g.txHash, [...chain.mined.keys()][0]);
  assert.deepEqual(events.map((e) => e["type"]), ["genesis-send", "genesis-write"]);
  assert.equal(await w.pass(true), false, "a completed request is not sent again");
  assert.equal(chain.broadcasts, 1);
});

test("it waits its turn and replaces a stalled transaction at a higher fee", async () => {
  const { dir, chain, w, events, request } = setup();
  request();
  assert.equal(await w.pass(false), false, "a ceiling batch is in flight: not sent yet");
  assert.equal(chain.broadcasts, 0);
  chain.mining = false;
  assert.equal(await w.pass(true), true);
  for (let i = 0; i < 3; i++) { chain.step(); await w.pass(true); }
  assert.ok(events.some((e) => e["type"] === "genesis-replace"), "replaced after replaceAfterBlocks");
  const sent = JSON.parse(readFileSync(join(dir, `${safe}.sent.json`), "utf8")) as { sends: { maxPriorityFeePerGas: string }[] };
  assert.equal(sent.sends.length, 2);
  assert.ok(BigInt(sent.sends[1]!.maxPriorityFeePerGas) > BigInt(sent.sends[0]!.maxPriorityFeePerGas), "the replacement pays more");
  chain.mining = true;
  chain.step();
  assert.equal(await w.pass(true), false, "the replacement mined");
});

test("a malformed request is set aside, not retried forever", async () => {
  const { dir, w, events } = setup();
  writeFileSync(join(dir, `${safe}.request.json`), JSON.stringify({ format: EPOCH_GENESIS_REQUEST_FORMAT, epochId, requestedAt: "x" }).replace(epochId, "not-an-id"));
  // The name no longer matches the id inside, so it is ignored outright.
  assert.equal(await w.pass(true), false);
  assert.equal(events.length, 0);
});
