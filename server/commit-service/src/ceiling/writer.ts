// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * The ceiling writer: turns queued records into Base transactions and
 * per-record sidecars (bitgraph-ceiling/1).
 *
 * One loop, one transaction in flight. When nothing is pending and records
 * are queued, all queued records of one (epoch, chain) become one Merkle
 * root, one 84-byte payload, one self-addressed transaction. Records that
 * arrive while it is pending go into the next batch, so a burst coalesces.
 *
 * Everything lives on disk under the state directory, written before it is
 * acted on: a batch file holds its signed transaction BEFORE broadcast, so a
 * restart rebroadcasts the same bytes instead of minting a second nonce. A
 * record anchored twice is harmless and is logged.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { join } from "node:path";
import {
  CEILING_VERSION, MerkleTree, ceilingLeaf, ceilingPayloadHash, encodeCeilingPayload,
  evmBytesToHex as bytesToHex, evmHexToBytes as hexToBytes,
  type CeilingSidecar, type CeilingStatus,
} from "@mikeargento/bitgraph-verify";
import type { CeilingQueueItem } from "../parent/ceiling-queue.js";

// ── The chain, as the writer needs it (viem in production, a fake in tests) ──

export interface SentTx { txHash: string; rawTx: string; maxFeePerGas: string; maxPriorityFeePerGas: string; sentAt: string; sentHead: number }
export interface Inclusion {
  blockNumber: number; blockHash: string; blockTimestamp: number; headerRlp: string;
  txIndex: number; txInclusionProof: string[];
  fees: { l2Wei: string; l1Wei: string; totalWei: string; gasUsed: string };
}
export interface Chain {
  chainId: number;
  writer: string;
  head(): Promise<number>;
  /** Sign a self-addressed transaction carrying `data`. `bump` > 0 raises fees for a replacement. */
  sign(data: Uint8Array, nonce: number, bump: number): Promise<{ rawTx: string; txHash: string; maxFeePerGas: string; maxPriorityFeePerGas: string }>;
  nextNonce(): Promise<number>;
  broadcast(rawTx: string): Promise<void>;
  /** Null until mined. */
  inclusion(txHash: string): Promise<Inclusion | null>;
  /** The canonical block hash at a height, null when the node does not have it. */
  blockHashAt(n: number): Promise<string | null>;
  safeHead(): Promise<number>;
  finalizedHead(): Promise<number>;
  balanceWei(): Promise<bigint>;
  /** Ethereum header RLP for a floor block, checked against its hash; null when unavailable. */
  floorHeader(blockHash: string): Promise<{ blockNumber: number; blockTimestamp: number; headerRlp: string } | null>;
}

// ── State ──────────────────────────────────────────────────────────────────

type BatchState = "sending" | "pending" | "included" | "safe" | "finalized" | "dropped";

export interface Batch {
  id: string;
  group: { epochId: string; chainId: string };
  items: CeilingQueueItem[];
  root: string;
  prev: string;
  payload: string;
  firstPos: string;
  lastPos: string;
  nonce: number;
  sends: SentTx[];
  state: BatchState;
  createdAt: string;
  inclusion?: Inclusion & { txHash: string; rawTx: string; observedAt: string };
  statusObserved: { included: string | null; safe: string | null; finalized: string | null };
}

export interface WriterOptions {
  stateDir: string;
  queuePath: string;
  chain: Chain;
  /** Blocks to wait before replacing an unmined transaction. */
  replaceAfterBlocks?: number;
  minBalanceWei?: bigint;
  log?: (event: Record<string, unknown>) => void;
  now?: () => Date;
  /**
   * Publish a sidecar where readers can fetch it (S3 `ceilings/` in
   * production). Retried every tick until it succeeds; the local file is
   * always written first and is the writer's own record.
   */
  publish?: (fileName: string, json: string) => Promise<void>;
}

const ZERO32 = "0x" + "00".repeat(32);

function safeName(b64: string): string {
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function atomicWrite(path: string, data: string): void {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, data, { mode: 0o600 });
  renameSync(tmp, path);
}

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function groupKey(i: CeilingQueueItem): string {
  return `${i.epochId}\u0000${i.chainId}`;
}

export class CeilingWriter {
  private readonly o: Required<Omit<WriterOptions, "minBalanceWei" | "publish">> & { minBalanceWei: bigint | null; publish: WriterOptions["publish"] };
  /** Sidecars written locally and not yet published, newest content per file. */
  private unpublished = new Map<string, string>();
  private readonly dirs: { batches: string; sidecars: string };
  private backlog: CeilingQueueItem[] = [];
  private cursor = 0;
  private lastPayloadHash = ZERO32;
  private batches = new Map<string, Batch>();
  /** proofHash -> batch id, for every batch not dropped. */
  private anchored = new Map<string, string>();
  private floorCache = new Map<string, { blockNumber: number; blockTimestamp: number; headerRlp: string } | null>();
  private lastStatusPoll = 0;
  private lastBalancePoll = 0;

  constructor(opts: WriterOptions) {
    this.o = {
      replaceAfterBlocks: 3,
      log: (e) => console.log(JSON.stringify(e)),
      now: () => new Date(),
      ...opts,
      minBalanceWei: opts.minBalanceWei ?? null,
      publish: opts.publish,
    };
    this.dirs = { batches: join(opts.stateDir, "batches"), sidecars: join(opts.stateDir, "sidecars") };
    mkdirSync(this.dirs.batches, { recursive: true, mode: 0o700 });
    mkdirSync(this.dirs.sidecars, { recursive: true, mode: 0o700 });
    this.load();
  }

  // ── persistence ──

  private p(name: string): string { return join(this.o.stateDir, name); }

  private load(): void {
    this.cursor = readJson<{ offset: number }>(this.p("cursor.json"), { offset: 0 }).offset;
    this.backlog = readJson<CeilingQueueItem[]>(this.p("backlog.json"), []);
    this.lastPayloadHash = readJson<{ lastPayloadHash: string }>(this.p("chain.json"), { lastPayloadHash: ZERO32 }).lastPayloadHash;
    for (const f of readdirSync(this.dirs.batches)) {
      if (!f.endsWith(".json")) continue;
      const b = JSON.parse(readFileSync(join(this.dirs.batches, f), "utf8")) as Batch;
      this.batches.set(b.id, b);
      if (b.state !== "dropped") for (const i of b.items) this.anchored.set(i.proofHash, b.id);
    }
  }

  private saveBatch(b: Batch): void {
    this.batches.set(b.id, b);
    atomicWrite(join(this.dirs.batches, `${b.id}.json`), JSON.stringify(b, null, 2));
  }
  private saveBacklog(): void { atomicWrite(this.p("backlog.json"), JSON.stringify(this.backlog)); }
  private saveCursor(): void { atomicWrite(this.p("cursor.json"), JSON.stringify({ offset: this.cursor })); }
  private saveChain(): void { atomicWrite(this.p("chain.json"), JSON.stringify({ lastPayloadHash: this.lastPayloadHash })); }
  private event(e: Record<string, unknown>): void {
    const line = { at: this.o.now().toISOString(), ...e };
    appendFileSync(this.p("events.jsonl"), JSON.stringify(line) + "\n", { mode: 0o600 });
    this.o.log(line);
  }

  // ── queue ──

  /** Read complete new lines from the queue file; keep any partial tail for next time. */
  ingest(): number {
    if (!existsSync(this.o.queuePath)) return 0;
    const size = statSync(this.o.queuePath).size;
    if (size <= this.cursor) return 0;
    const fd = openSync(this.o.queuePath, "r");
    const buf = Buffer.alloc(size - this.cursor);
    try { readSync(fd, buf, 0, buf.length, this.cursor); } finally { closeSync(fd); }
    const text = buf.toString("utf8");
    const lastNl = text.lastIndexOf("\n");
    if (lastNl < 0) return 0;
    const complete = text.slice(0, lastNl + 1);
    let added = 0;
    const inBacklog = new Set(this.backlog.map((i) => i.proofHash));
    for (const line of complete.split("\n")) {
      if (!line.trim()) continue;
      let item: CeilingQueueItem;
      try { item = JSON.parse(line) as CeilingQueueItem; } catch { this.event({ type: "queue-bad-line", line: line.slice(0, 200) }); continue; }
      if (inBacklog.has(item.proofHash)) continue;
      const prior = this.anchored.get(item.proofHash);
      if (prior) { this.event({ type: "duplicate", proofHash: item.proofHash, batch: prior }); continue; }
      this.backlog.push(item);
      inBacklog.add(item.proofHash);
      added++;
    }
    // Backlog first, cursor second: a crash between them re-reads lines, and re-reads dedupe.
    this.saveBacklog();
    this.cursor += Buffer.byteLength(complete, "utf8");
    this.saveCursor();
    return added;
  }

  // ── the loop ──

  private active(): Batch | undefined {
    for (const b of this.batches.values()) if (b.state === "sending" || b.state === "pending") return b;
    return undefined;
  }

  async tick(): Promise<void> {
    this.ingest();
    await this.flushPublish();
    const act = this.active();
    if (act) await this.advance(act);
    else if (this.backlog.length > 0) await this.startBatch();
    await this.flushPublish();
    const t = Date.now();
    if (t - this.lastStatusPoll > 4_000) { this.lastStatusPoll = t; await this.pollStatus(); }
    if (this.o.minBalanceWei !== null && t - this.lastBalancePoll > 60_000) {
      this.lastBalancePoll = t;
      const bal = await this.o.chain.balanceWei();
      if (bal < this.o.minBalanceWei) this.event({ type: "low-balance", balanceWei: bal.toString(), thresholdWei: this.o.minBalanceWei.toString() });
    }
  }

  private async startBatch(): Promise<void> {
    const key = groupKey(this.backlog[0]!);
    const items = this.backlog.filter((i) => groupKey(i) === key);
    items.sort((a, b) => (BigInt(a.position) < BigInt(b.position) ? -1 : BigInt(a.position) > BigInt(b.position) ? 1 : 0));
    const tree = new MerkleTree(items.map((i) => ceilingLeaf(i.proofHash)));
    const firstPos = BigInt(items[0]!.position);
    const lastPos = BigInt(items[items.length - 1]!.position);
    const payload = encodeCeilingPayload({ root: tree.root, prev: hexToBytes(this.lastPayloadHash), firstPos, lastPos });
    const nonce = await this.o.chain.nextNonce();
    const signed = await this.o.chain.sign(payload, nonce, 0);
    const head = await this.o.chain.head();
    const now = this.o.now().toISOString();
    const b: Batch = {
      id: `${now.replace(/[:.]/g, "-")}-${nonce}`,
      group: { epochId: items[0]!.epochId, chainId: items[0]!.chainId },
      items,
      root: bytesToHex(tree.root),
      prev: this.lastPayloadHash,
      payload: bytesToHex(payload),
      firstPos: firstPos.toString(),
      lastPos: lastPos.toString(),
      nonce,
      sends: [{ ...signed, sentAt: now, sentHead: head }],
      state: "sending",
      createdAt: now,
      statusObserved: { included: null, safe: null, finalized: null },
    };
    // Persist the signed bytes BEFORE they leave, and take the items out of the backlog.
    this.saveBatch(b);
    const ids = new Set(items.map((i) => i.proofHash));
    this.backlog = this.backlog.filter((i) => !ids.has(i.proofHash));
    this.saveBacklog();
    for (const i of items) this.anchored.set(i.proofHash, b.id);
    this.lastPayloadHash = bytesToHex(ceilingPayloadHash(payload));
    this.saveChain();
    for (const i of items) this.writeSidecar(i, b, tree, "pending");
    await this.send(b, signed.rawTx);
  }

  private async send(b: Batch, rawTx: string): Promise<void> {
    try {
      await this.o.chain.broadcast(rawTx);
    } catch (e) {
      const msg = (e as Error).message;
      // Already known / already mined: the receipt check decides. Anything else is logged and retried next tick.
      if (!/known|already|nonce too low/i.test(msg)) this.event({ type: "broadcast-error", batch: b.id, error: msg.slice(0, 300) });
    }
    if (b.state === "sending") { b.state = "pending"; this.saveBatch(b); }
  }

  private async advance(b: Batch): Promise<void> {
    if (b.state === "sending") { await this.send(b, b.sends[b.sends.length - 1]!.rawTx); return; }
    for (const s of b.sends) {
      const inc = await this.o.chain.inclusion(s.txHash);
      if (inc) { await this.included(b, s, inc); return; }
    }
    const head = await this.o.chain.head();
    const last = b.sends[b.sends.length - 1]!;
    if (head >= last.sentHead + this.o.replaceAfterBlocks) {
      const payload = hexToBytes(b.payload);
      const signed = await this.o.chain.sign(payload, b.nonce, b.sends.length);
      const s: SentTx = { ...signed, sentAt: this.o.now().toISOString(), sentHead: head };
      b.sends.push(s);
      this.saveBatch(b);
      this.event({ type: "replace", batch: b.id, nonce: b.nonce, attempt: b.sends.length, maxPriorityFeePerGas: s.maxPriorityFeePerGas });
      await this.send(b, s.rawTx);
    }
  }

  private async included(b: Batch, s: SentTx, inc: Inclusion): Promise<void> {
    const observedAt = this.o.now().toISOString();
    b.inclusion = { ...inc, txHash: s.txHash, rawTx: s.rawTx, observedAt };
    b.state = "included";
    b.statusObserved.included = observedAt;
    this.saveBatch(b);
    const tree = new MerkleTree(b.items.map((i) => ceilingLeaf(i.proofHash)));
    const latencies = b.items.map((i) => inc.blockTimestamp * 1000 - Date.parse(i.committedAt));
    for (const i of b.items) {
      if (i.floor && !this.floorCache.has(i.floor.blockHash)) {
        this.floorCache.set(i.floor.blockHash, await this.o.chain.floorHeader(i.floor.blockHash).catch(() => null));
      }
      this.writeSidecar(i, b, tree, "included");
    }
    this.event({
      type: "write", batch: b.id, records: b.items.length, blockNumber: inc.blockNumber, blockTimestamp: inc.blockTimestamp,
      txHash: s.txHash, attempts: b.sends.length, fees: inc.fees, latencyMs: latencies,
      firstPos: b.firstPos, lastPos: b.lastPos,
    });
    this.addCost(inc.fees.totalWei);
  }

  private addCost(wei: string): void {
    const path = this.p("costs.json");
    const all = readJson<Record<string, { writes: number; wei: string }>>(path, {});
    const day = this.o.now().toISOString().slice(0, 10);
    const d = all[day] ?? { writes: 0, wei: "0" };
    all[day] = { writes: d.writes + 1, wei: (BigInt(d.wei) + BigInt(wei)).toString() };
    atomicWrite(path, JSON.stringify(all, null, 2));
  }

  /** Walk every tracked batch forward: included → safe → finalized, or back to the queue on a reorg. */
  private async pollStatus(): Promise<void> {
    const open = [...this.batches.values()].filter((b) => b.state === "included" || b.state === "safe");
    if (open.length === 0) return;
    const safe = await this.o.chain.safeHead();
    const fin = await this.o.chain.finalizedHead();
    for (const b of open) {
      const inc = b.inclusion!;
      const canon = await this.o.chain.blockHashAt(inc.blockNumber);
      if (canon !== null && canon.toLowerCase() !== inc.blockHash.toLowerCase()) {
        if (b.state === "included") { this.reorged(b, canon); continue; }
        this.event({ type: "reorg-after-safe", batch: b.id, blockNumber: inc.blockNumber, ours: inc.blockHash, canonical: canon });
        continue;
      }
      const now = this.o.now().toISOString();
      let next: BatchState = b.state;
      if (inc.blockNumber <= fin) next = "finalized";
      else if (inc.blockNumber <= safe) next = "safe";
      if (next === b.state) continue;
      if (next === "safe" || next === "finalized") b.statusObserved.safe ??= now;
      if (next === "finalized") b.statusObserved.finalized = now;
      b.state = next;
      this.saveBatch(b);
      const tree = new MerkleTree(b.items.map((i) => ceilingLeaf(i.proofHash)));
      for (const i of b.items) this.writeSidecar(i, b, tree, next as CeilingStatus);
      this.event({ type: "status", batch: b.id, status: next, blockNumber: inc.blockNumber });
    }
  }

  private reorged(b: Batch, canonical: string): void {
    this.event({ type: "reorg", batch: b.id, blockNumber: b.inclusion!.blockNumber, dropped: b.inclusion!.blockHash, canonical, records: b.items.length });
    b.state = "dropped";
    this.saveBatch(b);
    for (const i of b.items) this.anchored.delete(i.proofHash);
    // Back to the FRONT of the queue; their sidecars say pending again.
    this.backlog = [...b.items, ...this.backlog.filter((x) => !b.items.some((i) => i.proofHash === x.proofHash))];
    this.saveBacklog();
    const tree = new MerkleTree(b.items.map((i) => ceilingLeaf(i.proofHash)));
    for (const i of b.items) this.writeSidecar(i, { ...b, inclusion: undefined } as Batch, tree, "pending");
  }

  // ── sidecars ──

  sidecarPath(proofHash: string): string {
    return join(this.dirs.sidecars, `${safeName(proofHash)}.ceiling.json`);
  }

  private writeSidecar(i: CeilingQueueItem, b: Batch, tree: MerkleTree, status: CeilingStatus): void {
    const leafIndex = b.items.findIndex((x) => x.proofHash === i.proofHash);
    const inc = status === "pending" ? undefined : b.inclusion;
    const floor = i.floor ? this.floorCache.get(i.floor.blockHash) ?? null : null;
    const s: CeilingSidecar = {
      version: CEILING_VERSION,
      proofHash: i.proofHash,
      leafIndex,
      leafCount: b.items.length,
      merklePath: tree.path(leafIndex).map(bytesToHex),
      root: b.root,
      anchor: inc ? {
        chainId: this.o.chain.chainId,
        writer: this.o.chain.writer,
        txHash: inc.txHash,
        rawTx: inc.rawTx,
        payload: b.payload,
        blockNumber: inc.blockNumber,
        blockHash: inc.blockHash,
        blockTimestamp: inc.blockTimestamp,
        blockHeader: inc.headerRlp,
        txIndex: inc.txIndex,
        txInclusionProof: inc.txInclusionProof,
      } : null,
      status,
      statusObserved: inc ? { ...b.statusObserved } : { included: null, safe: null, finalized: null },
      floor: i.floor && floor ? { blockNumber: floor.blockNumber, blockHash: i.floor.blockHash, blockTimestamp: floor.blockTimestamp, blockHeader: floor.headerRlp } : null,
      settlement: null,
    };
    const json = JSON.stringify(s, null, 2);
    atomicWrite(this.sidecarPath(i.proofHash), json);
    if (this.o.publish) this.unpublished.set(`${safeName(i.proofHash)}.ceiling.json`, json);
  }

  private async flushPublish(): Promise<void> {
    if (!this.o.publish || this.unpublished.size === 0) return;
    const batch = [...this.unpublished.entries()].slice(0, 200);
    await Promise.all(batch.map(async ([name, json]) => {
      try {
        await this.o.publish!(name, json);
        if (this.unpublished.get(name) === json) this.unpublished.delete(name);
      } catch (e) {
        this.event({ type: "publish-error", file: name, error: (e as Error).message.slice(0, 200) });
      }
    }));
  }

  // ── inspection ──

  snapshot(): { backlog: number; batches: Batch[]; lastPayloadHash: string } {
    return { backlog: this.backlog.length, batches: [...this.batches.values()], lastPayloadHash: this.lastPayloadHash };
  }
}
