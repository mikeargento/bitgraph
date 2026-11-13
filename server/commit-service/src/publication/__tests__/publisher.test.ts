// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * The hourly publisher against a fake Base node (real signed transactions, real headers and transaction tries), an
 * in-memory line standing in for the ledger and the parent, and a file store. Every publication block it keeps is
 * checked with the audit package's offline check, as a reader would.
 */

import { test, describe, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { checkPublication, checkHourChain, decodeHourCalldata, type HourRecord, type PublicationBlock } from "@mikeargento/bitgraph-audit";
import { epochEndFileText } from "../../parent/epoch-end.js";
import { BaseChain, type Chain } from "../base.js";
import { fileStore, safeEpoch, type Line, type StoredProof } from "../ledger.js";
import { Publisher, type PublisherOptions } from "../publisher.js";
import { FakeBase } from "./fake-base.js";

const HOUR = 3_600_000;
const CONFIRM = 2;
const E1 = Buffer.alloc(32, 1).toString("base64");
const E2 = Buffer.alloc(32, 2).toString("base64");
const KEY1 = Buffer.alloc(32, 11).toString("base64");
const KEY2 = Buffer.alloc(32, 12).toString("base64");
const closeDigest = (e: string) => createHash("sha256").update(epochEndFileText(e), "utf8").digest("base64");

/** The ledger and the parent, in memory: proofs per epoch, the open epoch, and binds that make the next proof. */
class MemLine implements Line {
  open: string | null = E1;
  byEpoch = new Map<string, StoredProof[]>();
  hidden = new Set<string>();
  private keyOf = (e: string) => (e === E1 ? KEY1 : KEY2);
  next(e: string): number { const l = this.byEpoch.get(e) ?? []; return (l.at(-1)?.counter ?? 0) + 2; }
  make(digestB64 = Buffer.alloc(32, Math.floor(Math.random() * 255)).toString("base64"), e = this.open ?? E1): Record<string, unknown> {
    const counter = this.next(e);
    const proof = {
      version: "bitgraph/1",
      artifact: { hashAlg: "sha256", digestB64 },
      commit: { nonceB64: Buffer.alloc(32, counter & 255).toString("base64"), counter: String(counter), slotCounter: String(counter - 1), epochId: e, atomic: true },
      signer: { publicKeyB64: this.keyOf(e), signatureB64: "AA==" },
    };
    const l = this.byEpoch.get(e) ?? [];
    l.push({ counter, proof });
    this.byEpoch.set(e, l);
    return proof;
  }
  hide(e: string, c: number): void { this.hidden.add(`${e}:${c}`); }
  show(e: string, c: number): void { this.hidden.delete(`${e}:${c}`); }
  async openEpoch() { return this.open; }
  async proofs(e: string, after: number) { return (this.byEpoch.get(e) ?? []).filter((p) => p.counter > after && !this.hidden.has(`${e}:${p.counter}`)); }
}

let fake: FakeBase;
let dir: string;
let line: MemLine;
let now: number;
let events: Array<Record<string, unknown>>;
const account = privateKeyToAccount(generatePrivateKey());
const writer = account.address.toLowerCase();

function publisher(over: Partial<PublisherOptions> = {}): Publisher {
  return new Publisher({
    stateDir: join(dir, "state"),
    chain: new BaseChain({ chainId: 8453, rpcUrl: fake.url, account }),
    line,
    store: fileStore(join(dir, "store")),
    bind: async (d) => line.make(d),
    intervalMs: HOUR,
    replaceAfterBlocks: 3,
    confirmations: CONFIRM,
    finalGraceMs: 120_000,
    finalMaxWaitMs: 600_000,
    now: () => now,
    log: (e) => events.push(e),
    ...over,
  });
}

function block(e: string, counter: number): PublicationBlock | null {
  try { return JSON.parse(readFileSync(join(dir, "store", "publication", "proofs", safeEpoch(e), `${String(counter).padStart(12, "0")}.json`), "utf8")) as PublicationBlock; } catch { return null; }
}
function proofWithBlock(e: string, counter: number): Record<string, unknown> {
  const p = line.byEpoch.get(e)!.find((x) => x.counter === counter)!.proof;
  return { ...p, metadata: { "bitgraph-publication/1": block(e, counter) } };
}
function hours(e: string): HourRecord[] {
  const d = join(dir, "store", "publication", "hours", safeEpoch(e));
  return readdirSync(d).sort().map((f) => JSON.parse(readFileSync(join(d, f), "utf8")) as HourRecord);
}
const checks = (e: string, c: number) => checkPublication(proofWithBlock(e, c), { writer });
/** Every block kept for an epoch checks. */
function allCheck(e: string): number {
  let n = 0;
  for (const { counter } of line.byEpoch.get(e) ?? []) {
    if (!block(e, counter)) continue;
    assert.deepEqual(checks(e, counter).problems, [], `${e === E1 ? "E1" : "E2"} #${counter}`);
    n++;
  }
  return n;
}

/** Mine, wait out the confirmations, finish. */
async function land(p: Publisher): Promise<void> {
  fake.mine();
  assert.equal(await p.tick(), "confirming");
  fake.skip(CONFIRM);
  assert.equal(await p.tick(), "published");
}
/** Send, mine, confirm, finish: one whole hour. */
async function hour(p: Publisher, advance = true): Promise<void> {
  if (advance) now += HOUR;
  assert.match(await p.tick(), /sent/);
  await land(p);
}

beforeEach(async () => {
  fake = new FakeBase();
  await fake.start();
  dir = mkdtempSync(join(tmpdir(), "bg-publication-"));
  line = new MemLine();
  now = Date.UTC(2026, 10, 13, 0, 0, 30);
  events = [];
});
afterEach(() => { fake.stop(); rmSync(dir, { recursive: true, force: true }); });

describe("hourly publication", () => {
  test("hours, floors, a quiet hour and a BitGraph made while a write was landing all check", async () => {
    const p = publisher();
    for (let i = 0; i < 3; i++) line.make(); // #2 #4 #6
    await hour(p, false);
    const first = hours(E1)[0]!;
    assert.equal(decodeHourCalldata(Buffer.from(first.calldata.slice(2), "hex"))!.epochPublicKeyB64, KEY1);
    assert.equal(line.next(E1), 10, "the floor was bound as #8");
    for (const c of [2, 4, 6]) assert.equal(checks(E1, c).floor, null, "nothing before the epoch's first floor has one");

    line.make(); line.make(); // #10 #12
    assert.equal(await p.tick(), "idle", "not due until the next hour");
    await hour(p); // covers #8 (the floor) to #12; floor #14
    const r12 = checks(E1, 12);
    assert.equal(r12.floor?.blockNumber, hours(E1)[0]!.write.blockNumber, "#12 is after the first write's block");
    assert.equal(r12.ceiling?.blockNumber, hours(E1)[1]!.write.blockNumber, "and existed by the second's");

    await hour(p); // a quiet hour: only the floor #14
    assert.equal(hours(E1)[2]!.members.length, 1);

    now += HOUR;
    assert.match(await p.tick(), /sent/);
    line.make(); // #18, made while the fourth write lands: before its floor #20, so its floor is #16
    await land(p);
    line.make(); // #22
    await hour(p);
    assert.equal(checks(E1, 18).floor?.floorCounter, "16");
    assert.equal(checks(E1, 22).floor?.floorCounter, "20");
    assert.ok(allCheck(E1) >= 11);
    assert.deepEqual(checkHourChain(hours(E1)).problems, [], "the records list in write order");
    // Every floor has its record, naming the write its note names.
    const floors = readdirSync(join(dir, "store", "publication", "floors", safeEpoch(E1))).sort();
    assert.deepEqual(floors, ["000000000008.json", "000000000014.json", "000000000016.json", "000000000020.json", "000000000024.json"]);
    const f8 = JSON.parse(readFileSync(join(dir, "store", "publication", "floors", safeEpoch(E1), "000000000008.json"), "utf8"));
    assert.equal(f8.write.blockNumber, hours(E1)[0]!.write.blockNumber);
    assert.equal(f8.write.txHash, hours(E1)[0]!.write.txHash);
  });

  test("a gap waits one hour, then is recorded as missing; an epoch's first count is not skipped", async () => {
    const p = publisher();
    line.make(); line.make(); line.make(); line.make(); // #2 #4 #6 #8
    line.hide(E1, 2);
    await hour(p, false);
    assert.equal(hours(E1)[0]!.members.length, 0, "#2 not in the ledger yet: nothing after it is covered");
    await hour(p);
    assert.deepEqual(hours(E1)[1]!.missing, ["2"], "the same gap an hour later is recorded");
    line.hide(E1, 12); // the second floor, #12, goes missing from the ledger
    await hour(p); // nothing after #12 yet: nothing to see
    await hour(p); // #14 is there: the gap at #12 is seen, and waited on
    assert.ok(!hours(E1).some((h) => h.missing.includes("12")));
    await hour(p); // still not there an hour later: recorded
    assert.ok(hours(E1).some((h) => h.missing.includes("12")));
    allCheck(E1);
    assert.deepEqual(checkHourChain(hours(E1)).problems, []);
  });

  test("a write that fails to sign does not turn a late count into a missing one", async () => {
    let fail = true;
    const real = new BaseChain({ chainId: 8453, rpcUrl: fake.url, account });
    const flaky: Chain = Object.assign(Object.create(Object.getPrototypeOf(real)), real, {
      sign: async (...a: Parameters<Chain["sign"]>) => { if (fail) { fail = false; throw new Error("rpc down"); } return real.sign(...a); },
    });
    const p = publisher({ chain: flaky });
    line.make(); line.make(); line.make(); // #2 #4 #6
    line.hide(E1, 4);
    await assert.rejects(p.tick());
    assert.match(await p.tick(), /sent/, "retried at once");
    await land(p);
    assert.deepEqual(hours(E1)[0]!.members.map((m) => m.counter), ["2"]);
    assert.deepEqual(hours(E1)[0]!.missing, [], "#4 is waited for, not given up");
  });

  test("a floor whose note names a write other than the one before its tree is not attached", async () => {
    const p = publisher();
    line.make(); line.make(); // #2 #4
    await hour(p, false); // W1; floor F1 = #6 names W1
    line.make(); // #8
    line.hide(E1, 6); // F1 is late in the ledger
    await hour(p); // W2 stops at the gap (empty); its floor F2 = #10 names W2
    line.make(); // #12
    line.show(E1, 6);
    await hour(p); // W3 covers #6..#12; F1 is in W3's tree but names W1, while W3 links back to W2
    assert.ok(events.some((e) => e["type"] === "floor-unusable" && e["counter"] === 6));
    assert.equal(checks(E1, 8).floor, null, "#8 would have had F1; it gets none rather than a wrong one");
    assert.equal(checks(E1, 12).floor?.floorCounter, "10", "#12 gets F2, which names W2");
    allCheck(E1);
  });

  test("a new epoch: the old one's last write waits for its closing BitGraph, then the hours run on", async () => {
    const p = publisher();
    line.make(); line.make(); // E1 #2 #4
    await hour(p, false); // floor E1 #6
    line.open = E2;
    line.make(undefined, E2); // E2 #2
    assert.equal(await p.tick(), "waiting-for-close", "the grace starts when the new epoch is seen");
    now += 130_000;
    assert.equal(await p.tick(), "waiting-for-close", "past the grace, but E1's closing BitGraph is not in the ledger");
    line.make(closeDigest(E1), E1); // E1 #8: the closing BitGraph
    assert.equal(await p.tick(), "final-sent");
    await land(p);
    assert.deepEqual(hours(E1).at(-1)!.members.map((m) => m.counter), ["6", "8"]);
    assert.equal(line.next(E2), 6, "the old epoch's last floor was bound in the new epoch as #4");
    line.make(undefined, E2); // E2 #6
    await hour(p);
    const e2 = hours(E2)[0]!;
    assert.equal(decodeHourCalldata(Buffer.from(e2.calldata.slice(2), "hex"))!.epochPublicKeyB64, KEY2);
    assert.equal(decodeHourCalldata(Buffer.from(e2.calldata.slice(2), "hex"))!.prevLinkHex, hours(E1).at(-1)!.link, "the hours chain across the epochs");
    assert.equal(checks(E2, 2).floor, null);
    assert.equal(checks(E2, 6).floor?.blockNumber, hours(E1).at(-1)!.write.blockNumber, "after the old epoch's last write");
    allCheck(E1); allCheck(E2);
    assert.deepEqual(checkHourChain([...hours(E1), ...hours(E2)]).problems, []);
  });

  test("an epoch that crashed has no closing BitGraph: its last write goes out after the longest wait", async () => {
    const p = publisher();
    line.make(); // E1 #2
    await hour(p, false);
    line.open = E2;
    assert.equal(await p.tick(), "waiting-for-close");
    now += 130_000;
    assert.equal(await p.tick(), "waiting-for-close");
    now += 600_000;
    assert.equal(await p.tick(), "final-sent");
    assert.ok(events.some((e) => e["type"] === "close-missing"));
  });

  test("nothing more is written to an epoch after its last write, even if the open epoch cannot be read", async () => {
    const p = publisher();
    line.make(); // E1 #2
    await hour(p, false);
    line.open = E2;
    line.make(closeDigest(E1), E1);
    assert.equal(await p.tick(), "waiting-for-close");
    now += 130_000;
    assert.equal(await p.tick(), "final-sent");
    line.open = null; // the parent cannot be read
    await land(p);
    now += 3 * HOUR;
    assert.equal(await p.tick(), "no-epoch");
    assert.equal(p.snapshot().pending, null, "no write to the finished epoch");
    line.open = E2;
    assert.match(await p.tick(), /sent/);
    assert.equal(p.snapshot().pending!.epochId, E2);
  });

  test("a restart mid-write sends nothing new, and a stalled write is replaced at a higher fee", async () => {
    line.make();
    let p = publisher();
    fake.stall = true;
    assert.match(await p.tick(), /sent/);
    p = publisher(); // restart: the saved transaction is waited on, not signed again
    assert.equal(await p.tick(), "pending");
    fake.skip(3);
    assert.equal(await p.tick(), "replaced");
    fake.stall = false;
    await land(p);
    assert.notEqual(hours(E1)[0]!.write.txHash, events.find((e) => e["type"] === "write-sent")!["txHash"], "the replacement is the one that landed");
    assert.equal(events.filter((e) => e["type"] === "write-sent").length, 1, "one write, one nonce");
    allCheck(E1);
  });

  test("a nonce used by something else is re-signed with a fresh one", async () => {
    line.make();
    const p = publisher();
    fake.stall = true;
    assert.match(await p.tick(), /sent/);
    fake.consumeNonce(writer); // a manual send from the same key took the nonce
    fake.skip(3);
    assert.equal(await p.tick(), "pending", "the first check only notes it");
    fake.skip(3);
    assert.equal(await p.tick(), "resigned", "the second, an interval later, re-signs");
    fake.stall = false;
    await land(p);
    assert.ok(events.some((e) => e["type"] === "nonce-lost"));
    allCheck(E1);
  });

  test("a write that is mined but slow to show its receipt is waited for, not sent twice", async () => {
    line.make();
    const p = publisher();
    assert.match(await p.tick(), /sent/);
    fake.mine();
    fake.hideReceipts = true;
    for (let i = 0; i < 3; i++) { fake.skip(3); assert.equal(await p.tick(), "pending"); }
    fake.hideReceipts = false;
    assert.equal(await p.tick(), "published");
    assert.equal(events.filter((e) => e["type"] === "write-sent").length, 1);
    assert.ok(!events.some((e) => e["type"] === "nonce-lost" || e["type"] === "write-replaced"), "no second transaction");
    assert.ok(events.some((e) => e["type"] === "waiting-for-receipt"));
    allCheck(E1);
  });

  test("after a restart, a write saved but never sent goes out at once", async () => {
    line.make();
    const real = new BaseChain({ chainId: 8453, rpcUrl: fake.url, account });
    const dropping: Chain = Object.assign(Object.create(Object.getPrototypeOf(real)), real, { broadcast: async () => { throw new Error("connection reset"); } });
    let p = publisher({ chain: dropping });
    assert.match(await p.tick(), /sent/, "saved, but it never left");
    p = publisher(); // restart
    assert.equal(await p.tick(), "pending");
    await land(p);
    assert.ok(!events.some((e) => e["type"] === "write-replaced"), "no fee bump was needed");
    allCheck(E1);
  });

  test("a BitGraph of the closing note's digest made mid-epoch does not count as the close", async () => {
    const p = publisher();
    line.make(); line.make(closeDigest(E1)); // #2, and #4: someone bound the closing note's digest early
    await hour(p, false); // covers #2 #4; its floor #6 follows, so #4 is not the epoch's last
    line.open = E2;
    assert.equal(await p.tick(), "waiting-for-close");
    now += 130_000;
    assert.equal(await p.tick(), "waiting-for-close", "the real close is not in the ledger yet");
    line.make(closeDigest(E1), E1); // #8, the real close
    assert.equal(await p.tick(), "final-sent");
    await land(p);
    assert.deepEqual(hours(E1).at(-1)!.members.map((m) => m.counter), ["6", "8"]);
  });

  test("waiting for the close never skips a scheduled write", async () => {
    now = Date.UTC(2026, 10, 13, 23, 0, 30);
    const p = publisher({ finalMaxWaitMs: 30 * 60_000 });
    line.make();
    await hour(p, false); // 23:00
    now = Date.UTC(2026, 10, 13, 23, 58, 0);
    line.open = E2;
    assert.equal(await p.tick(), "waiting-for-close");
    now += 130_000; // 00:00:10, under the longest wait, but the 00:00 write is due
    assert.equal(await p.tick(), "final-sent");
    assert.ok(events.some((e) => e["type"] === "close-missing"));
  });

  test("a block that is reorged away before it is confirmed is not kept", async () => {
    line.make();
    const p = publisher({ replaceAfterBlocks: 10 });
    assert.match(await p.tick(), /sent/);
    fake.mine();
    assert.equal(await p.tick(), "confirming");
    fake.reorg(); // the block with the write is replaced; the write goes back to waiting
    fake.skip(CONFIRM);
    assert.equal(await p.tick(), "pending");
    await land(p);
    const h = hours(E1)[0]!;
    assert.equal(h.write.blockNumber > 38_000_000, true);
    allCheck(E1);
  });

  test("a floor that cannot be bound is retried, then given up at the next write", async () => {
    let fail = true;
    const p = publisher({ bind: async (d) => { if (fail) throw new Error("parent down"); return line.make(d); } });
    line.make();
    await hour(p, false);
    assert.equal(await p.tick(), "floor-retry");
    now += HOUR;
    line.make();
    assert.match(await p.tick(), /sent/);
    fail = false;
    await land(p);
    assert.ok(events.some((e) => e["type"] === "floor-skipped"));
    allCheck(E1);
    assert.deepEqual(checkHourChain(hours(E1)).problems, []);
  });
});
