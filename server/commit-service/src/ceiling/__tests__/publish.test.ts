/**
 * The publish transaction: the parent's request in, one self-addressed transaction out ("BGP1", the epoch id, the
 * closing BitGraph's chain hash), the result file once mined.
 *
 *   node --import tsx/esm --test src/ceiling/__tests__/publish.test.ts
 */

import { test } from "node:test";
import * as assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { keccak256, type Hex } from "viem";
import { decodeEip1559, evmBytesToHex, evmHexToBytes } from "@mikeargento/bitgraph-verify";
import { PublishWriter, epochPublishCalldata, EPOCH_PUBLISH_REQUEST_FORMAT, EPOCH_PUBLISH_FORMAT, type PublishResult } from "../publish.js";
import { writePublishRequest, EPOCH_PUBLISH_REQUEST_FORMAT as PARENT_FORMAT } from "../../parent/epoch-end.js";
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
const closing = Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 7 + 3) & 0xff)).toString("base64");
const safe = epochId.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "publish-"));
  const chain = new MiniChain();
  const events: Record<string, unknown>[] = [];
  const w = new PublishWriter({ dir, chain, chainId: 84532, replaceAfterBlocks: 3, now: () => new Date(0), log: (e) => events.push(e) });
  return { dir, chain, w, events };
}

test("the calldata is 68 bytes: BGP1, the epoch id, the closing chain hash", () => {
  const d = epochPublishCalldata(epochId, closing);
  assert.equal(d.length, 68);
  assert.equal(Buffer.from(d.subarray(0, 4)).toString("latin1"), "BGP1");
  assert.equal(Buffer.from(d.subarray(4, 36)).toString("base64"), epochId);
  assert.equal(Buffer.from(d.subarray(36, 68)).toString("base64"), closing);
  assert.throws(() => epochPublishCalldata(epochId, "c2hvcnQ="), /32 bytes/);
});

test("the parent's request format is the one the writer reads", () => {
  assert.equal(PARENT_FORMAT, EPOCH_PUBLISH_REQUEST_FORMAT);
});

test("the parent's request becomes one transaction, then the result file", async () => {
  const { dir, chain, w, events } = setup();
  assert.equal(await w.pass(true), false, "nothing to do without a request");
  assert.equal(w.hasPending(), false);
  writePublishRequest(dir, epochId, closing, "4242", new Date("2026-11-07T23:59:00Z"));
  assert.equal(w.hasPending(), true);
  assert.equal(await w.pass(true), true, "sent, in flight");
  assert.equal(chain.broadcasts, 1);
  assert.ok(existsSync(join(dir, `${safe}.sent.json`)));
  chain.step();
  assert.equal(await w.pass(true), false, "mined: done");
  const r = JSON.parse(readFileSync(join(dir, `${safe}.json`), "utf8")) as PublishResult;
  assert.equal(r.format, EPOCH_PUBLISH_FORMAT);
  assert.equal(r.epochId, epochId);
  assert.equal(r.closingChainHashB64, closing);
  assert.equal(r.closingCounter, "4242");
  assert.equal(r.blockNumber, 101);
  assert.equal(r.writer, chain.writer);
  const mined = [...chain.mined.values()][0]!;
  assert.equal(mined.data, evmBytesToHex(epochPublishCalldata(epochId, closing)), "the mined calldata is the 68 bytes");
  assert.equal(r.calldata, mined.data);
  assert.deepEqual(events.map((e) => e["type"]), ["publish-send", "publish-write"]);
  assert.equal(await w.pass(true), false, "a completed request is not sent again");
  assert.equal(chain.broadcasts, 1);
  assert.equal(w.hasPending(), false);
});

test("it waits its turn and replaces a stalled transaction at a higher fee", async () => {
  const { dir, chain, w, events } = setup();
  writePublishRequest(dir, epochId, closing, "7");
  assert.equal(await w.pass(false), false, "something else is in flight: not sent yet");
  assert.equal(chain.broadcasts, 0);
  chain.mining = false;
  assert.equal(await w.pass(true), true);
  for (let i = 0; i < 3; i++) { chain.step(); await w.pass(true); }
  assert.ok(events.some((e) => e["type"] === "publish-replace"));
  chain.mining = true;
  chain.step();
  assert.equal(await w.pass(true), false, "the replacement mined");
});

test("a request with a bad hash is set aside, not retried forever", async () => {
  const { dir, chain, w, events } = setup();
  writeFileSync(join(dir, `${safe}.request.json`), JSON.stringify({ format: EPOCH_PUBLISH_REQUEST_FORMAT, epochId, closingChainHashB64: "c2hvcnQ=", closingCounter: "1", requestedAt: "2026-11-07T23:59:00Z" }));
  assert.equal(await w.pass(true), false);
  assert.equal(chain.broadcasts, 0);
  assert.equal(events[0]!["type"], "publish-error");
  assert.ok(readdirSync(dir).includes(`${safe}.request.bad`));
  assert.equal(w.hasPending(), false);
});
