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

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync, statSync, openSync, readSync, closeSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import {
  CEILING_VERSION, MerkleTree, ceilingLeaf, ceilingPayloadHash, encodeCeilingPayload, decodeHeader, verifySettlementPointer,
  evmBytesToHex as bytesToHex, evmHexToBytes as hexToBytes,
  type CeilingSidecar, type CeilingStatus, type SettlementPointer, type SettlementPins,
} from "@mikeargento/bitgraph-verify";
import type { CeilingQueueItem } from "../parent/ceiling-queue.js";
import type { SettlementFound } from "./settlement.js";
import { OutputRootSettler, type OutputRootMark, type OutputRootOptions } from "./output-root-settler.js";

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
  /** Header RLP for a floor block from its own chain, checked against its hash; null when unavailable. */
  floorHeader(blockHash: string, chain?: "ethereum" | "base"): Promise<{ blockNumber: number; blockTimestamp: number; headerRlp: string } | null>;
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
  /** The L1 data inclusion of this batch's Base block (bitgraph-settlement/1), once found. Never replaced. */
  settlement?: { pointer: SettlementPointer; foundAt: string; blobFiles: string[] };
  /** The search for it: how many tries, the last one, its error; `gaveUp` once the deadline passed. */
  settlementSearch?: { attempts: number; lastAt: string; lastError?: string; gaveUp?: boolean };
  /**
   * Settlement through Base's output root (bitgraph-output-root/1, output-root-settler.ts): the file
   * written for this batch's Base block, or "out-of-window" when no output root could cover it (the
   * blob settlement above still stands). Set once, never replaced.
   */
  outputRoot?: OutputRootMark;
}

/** What the writer knows about a batch's Base block when it asks for its settlement. */
export interface SettlementTarget { blockNumber: number; blockHash: string; blockTimestamp: number; parentHash: string; txHash: string }
export type SettlementFinder = (block: SettlementTarget) => Promise<SettlementFound | null>;

export interface WriterSettlementOptions {
  /** Find the L1 batch data carrying the block: null when not there yet (asked again later), a throw is logged and retried. */
  find: SettlementFinder;
  /** The pins the pointer must satisfy before it is written; a pointer that fails is refused and logged. */
  pins?: SettlementPins;
  /**
   * Publish blob bytes beside the sidecars (S3 `ceilings/blobs/<file>`); idempotent. The local copy under <state>/blobs is
   * written first. While a blob waits here, no sidecar or write record naming it is published (see flushPublish).
   */
  publishBlob?: (name: string, bytes: Uint8Array) => Promise<void>;
  /** Between settlement passes, in ms (default 60 000). */
  everyMs?: number;
  /** Stop asking this long after the batch reached safe (default 24 h). */
  giveUpAfterMs?: number;
  /**
   * Wall-clock budget for one pass, in ms (default 10 000). A pass always settles at least one
   * batch, stops after the batch that crosses the budget, and carries on next pass, so a backlog
   * (a restart, a beacon outage) never holds the writer's own work: on 2026-09-30 the first pass
   * walked 460 batches and no ceiling was written for the twenty minutes it took.
   */
  budgetMs?: number;
}

/** A sidecar as written: bitgraph-ceiling/1 with the settlement pointer in the slot reserved for it. */
type SidecarOut = Omit<CeilingSidecar, "settlement"> & { settlement: SettlementPointer | null };

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
  /**
   * Settlement on Ethereum (bitgraph-settlement/1): once a batch is safe,
   * find the L1 batcher transaction whose blobs carry its Base block, keep the
   * blob bytes, and put the pointer on every record's sidecar. Off when absent.
   */
  settlement?: WriterSettlementOptions;
  /**
   * Settlement through Base's output root (bitgraph-output-root/1), beside the blob settlement:
   * windows captured at Base's summary blocks, claims attached from Ethereum, files written
   * create-only. Off when absent. See output-root-settler.ts.
   */
  outputRoot?: OutputRootOptions;
}

const ZERO32 = "0x" + "00".repeat(32);

function safeName(b64: string): string {
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function atomicWrite(path: string, data: string | Uint8Array): void {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, data, { mode: 0o600 });
  renameSync(tmp, path);
}

/** Where a blob's bytes live beside the sidecars: `blobs/<versioned hash>.bin`, the pointer's `file` being the basename. */
export function blobFileName(versionedHash: string): string {
  if (!/^0x01[0-9a-f]{62}$/.test(versionedHash)) throw new TypeError(`not a versioned hash: ${versionedHash}`);
  return `${versionedHash}.bin`;
}

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function groupKey(i: CeilingQueueItem): string {
  return `${i.epochId}\u0000${i.chainId}`;
}

export class CeilingWriter {
  private readonly o: Required<Omit<WriterOptions, "minBalanceWei" | "publish" | "settlement" | "outputRoot">> & { minBalanceWei: bigint | null; publish: WriterOptions["publish"]; settlement: WriterOptions["settlement"]; outputRoot: WriterOptions["outputRoot"] };
  /** Sidecars written locally and not yet published, newest content per file. */
  private unpublished = new Map<string, string>();
  /** Blob bytes written locally and not yet published, and the names already published by this process. */
  private unpublishedBlobs = new Map<string, Uint8Array>();
  private publishedBlobs = new Set<string>();
  /** How many queued files the last flush held back for their blobs, so the hold is logged when it changes, not every tick. */
  private lastHeld = 0;
  private readonly dirs: { batches: string; sidecars: string; blobs: string };
  private backlog: CeilingQueueItem[] = [];
  private cursor = 0;
  private lastPayloadHash = ZERO32;
  private batches = new Map<string, Batch>();
  /** proofHash -> batch id, for every batch not dropped. */
  private anchored = new Map<string, string>();
  private floorCache = new Map<string, { blockNumber: number; blockTimestamp: number; headerRlp: string } | null>();
  private lastStatusPoll = 0;
  private lastBalancePoll = 0;
  private lastSettlementPass = 0;
  /** Batches whose sidecars on disk lack a floor header their items name; repaired a few per tick. */
  private floorRepair: string[] = [];
  private floorRepairTries = new Map<string, number>();
  /** Output-root settlement, when configured; its state lives under <state>/output-root/. */
  private readonly outputRootSettler: OutputRootSettler | null = null;
  private lastOutputRootPass = 0;

  constructor(opts: WriterOptions) {
    this.o = {
      replaceAfterBlocks: 3,
      log: (e) => console.log(JSON.stringify(e)),
      now: () => new Date(),
      ...opts,
      minBalanceWei: opts.minBalanceWei ?? null,
      publish: opts.publish,
      settlement: opts.settlement,
      outputRoot: opts.outputRoot,
    };
    this.dirs = { batches: join(opts.stateDir, "batches"), sidecars: join(opts.stateDir, "sidecars"), blobs: join(opts.stateDir, "blobs") };
    mkdirSync(this.dirs.batches, { recursive: true, mode: 0o700 });
    mkdirSync(this.dirs.sidecars, { recursive: true, mode: 0o700 });
    mkdirSync(this.dirs.blobs, { recursive: true, mode: 0o700 });
    this.load();
    if (opts.outputRoot) {
      // Built after load(): it reads the batches to finish any mark a stop left half-written.
      this.outputRootSettler = new OutputRootSettler({
        stateDir: opts.stateDir,
        batches: () => this.batches.values(),
        saveBatch: (b) => this.saveBatch(b),
        event: (e) => this.event(e),
        now: () => this.o.now(),
      }, opts.outputRoot);
    }
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
    for (const b of this.batches.values()) {
      if (!b.inclusion || b.state === "dropped") continue;
      if (b.items.some((i) => i.floor && !this.floorOnDisk(i))) this.floorRepair.push(b.id);
    }
    // Publishes pending when the process last stopped, re-read from disk. Without a journal (the
    // first start of this code) everything settled is queued again: the published copies of
    // those sidecars and records may predate their settlement, and a blob already published is
    // left alone by the publisher's HEAD.
    const journal = this.p("unpublished.json");
    const requeueFile = (name: string): void => {
      if (!this.o.publish) return;
      const local = name.endsWith(".ceiling.json") ? join(this.dirs.sidecars, name) : join(this.o.stateDir, name);
      if (existsSync(local)) this.unpublished.set(name, readFileSync(local, "utf8"));
    };
    const requeueBlob = (file: string): void => {
      if (!this.o.settlement?.publishBlob) return;
      const local = join(this.dirs.blobs, file);
      if (existsSync(local)) this.unpublishedBlobs.set(file, new Uint8Array(readFileSync(local)));
    };
    if (existsSync(journal)) {
      const j = readJson<{ files: string[]; blobs: string[] }>(journal, { files: [], blobs: [] });
      for (const name of j.files) requeueFile(name);
      for (const file of j.blobs) requeueBlob(file);
    } else if (this.o.publish || this.o.settlement?.publishBlob) {
      for (const b of this.batches.values()) {
        if (!b.settlement || !b.inclusion) continue;
        for (const i of b.items) requeueFile(`${safeName(i.proofHash)}.ceiling.json`);
        const rec = CeilingWriter.writeRecordName(b);
        if (rec) requeueFile(rec);
        for (const file of b.settlement.blobFiles) requeueBlob(file);
      }
      this.journalPublish();
    }
  }

  private saveBatch(b: Batch): void {
    this.batches.set(b.id, b);
    atomicWrite(join(this.dirs.batches, `${b.id}.json`), JSON.stringify(b, null, 2));
  }
  private saveBacklog(): void { atomicWrite(this.p("backlog.json"), JSON.stringify(this.backlog)); }
  private saveCursor(): void { atomicWrite(this.p("cursor.json"), JSON.stringify({ offset: this.cursor })); }
  private saveChain(): void { atomicWrite(this.p("chain.json"), JSON.stringify({ lastPayloadHash: this.lastPayloadHash })); }
  /** The names still to publish, kept on disk so a restart picks them up; the content is re-read from the local files. */
  private journalPublish(): void {
    if (!this.o.publish && !this.o.settlement?.publishBlob) return;
    atomicWrite(this.p("unpublished.json"), JSON.stringify({ files: [...this.unpublished.keys()], blobs: [...this.unpublishedBlobs.keys()] }));
  }
  /**
   * Every item's floor header in the cache before a sidecar is written: from the cache, else from
   * the sidecar already on disk (a restart empties the cache), else from the chain. On 2026-09-30
   * the settlement pass rewrote 683 sidecars after a restart with `floor: null`, the cache empty.
   */
  private async ensureFloors(items: CeilingQueueItem[]): Promise<void> {
    for (const i of items) {
      if (!i.floor || this.floorCache.get(i.floor.blockHash)) continue;
      const onDisk = this.floorOnDisk(i);
      if (onDisk) { this.floorCache.set(i.floor.blockHash, onDisk); continue; }
      const fetched = await this.o.chain.floorHeader(i.floor.blockHash, i.floor.chain ?? "ethereum").catch(() => null);
      if (fetched) this.floorCache.set(i.floor.blockHash, fetched);
    }
  }
  /** The floor header the sidecar on disk carries for this item, when it is the item's own block. */
  private floorOnDisk(i: CeilingQueueItem): { blockNumber: number; blockTimestamp: number; headerRlp: string } | null {
    if (!i.floor) return null;
    const path = this.sidecarPath(i.proofHash);
    if (!existsSync(path)) return null;
    try {
      const f = (JSON.parse(readFileSync(path, "utf8")) as { floor?: { blockNumber: number; blockHash: string; blockTimestamp: number; blockHeader: string } | null }).floor;
      return f && f.blockHash === i.floor.blockHash ? { blockNumber: f.blockNumber, blockTimestamp: f.blockTimestamp, headerRlp: f.blockHeader } : null;
    } catch { return null; }
  }
  /** Sidecars on disk written without their floor header: a few batches per tick, rewritten with it. */
  private async repairFloors(): Promise<void> {
    let n = 0;
    while (this.floorRepair.length > 0 && n < 10) {
      const b = this.batches.get(this.floorRepair.shift()!);
      n++;
      if (!b || !b.inclusion || b.state === "dropped") continue;
      await this.ensureFloors(b.items);
      const tree = new MerkleTree(b.items.map((i) => ceilingLeaf(i.proofHash)));
      for (const i of b.items) this.writeSidecar(i, b, tree, b.state as CeilingStatus);
      const stillMissing = b.items.filter((i) => i.floor && !this.floorCache.get(i.floor.blockHash)).length;
      this.event({ type: "floor-repair", batch: b.id, records: b.items.length, stillMissing });
      // A header the chain would not give (an RPC hiccup) is asked for again, a few times, at the back of the line.
      if (stillMissing > 0) {
        const tries = (this.floorRepairTries.get(b.id) ?? 0) + 1;
        this.floorRepairTries.set(b.id, tries);
        if (tries < 5) this.floorRepair.push(b.id);
      }
    }
  }
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
    if (this.o.settlement && t - this.lastSettlementPass > (this.o.settlement.everyMs ?? 60_000)) {
      this.lastSettlementPass = t;
      await this.settlementPass();
      await this.flushPublish();
    }
    if (this.outputRootSettler && t - this.lastOutputRootPass > (this.o.outputRoot?.everyMs ?? 30_000)) {
      this.lastOutputRootPass = t;
      // Its own failures stay its own: the floor repair below, and the next tick's sends, still run.
      try {
        await this.outputRootSettler.pass();
      } catch (e) {
        this.event({ type: "output-root-error", error: (e as Error).message.slice(0, 300) });
      }
    }
    if (this.floorRepair.length > 0) {
      await this.repairFloors();
      await this.flushPublish();
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
    await this.ensureFloors(b.items);
    for (const i of b.items) this.writeSidecar(i, b, tree, "included");
    this.writeRecord(b);
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
      await this.ensureFloors(b.items);
      for (const i of b.items) this.writeSidecar(i, b, tree, next as CeilingStatus);
      this.writeRecord(b);
      this.event({ type: "status", batch: b.id, status: next, blockNumber: inc.blockNumber });
    }
  }

  private reorged(b: Batch, canonical: string): void {
    this.event({ type: "reorg", batch: b.id, blockNumber: b.inclusion!.blockNumber, dropped: b.inclusion!.blockHash, canonical, records: b.items.length });
    b.state = "dropped";
    this.saveBatch(b);
    this.writeRecord(b); // the page shows it struck through, never silently gone
    for (const i of b.items) this.anchored.delete(i.proofHash);
    // Back to the FRONT of the queue; their sidecars say pending again.
    this.backlog = [...b.items, ...this.backlog.filter((x) => !b.items.some((i) => i.proofHash === x.proofHash))];
    this.saveBacklog();
    const tree = new MerkleTree(b.items.map((i) => ceilingLeaf(i.proofHash)));
    for (const i of b.items) this.writeSidecar(i, { ...b, inclusion: undefined, settlement: undefined } as Batch, tree, "pending");
  }

  // ── settlement on Ethereum (bitgraph-settlement/1) ──

  /**
   * For every safe or finalized batch without a settlement: ask where its
   * Base block's batch data is on Ethereum. Found: the blob bytes go to disk
   * (and to the publisher), the batch keeps the pointer, every record's
   * sidecar and the write record are rewritten with it. Not found yet: asked
   * again next pass, until the deadline. A settlement, once written, is never
   * replaced.
   */
  private async settlementPass(): Promise<void> {
    const s = this.o.settlement;
    if (!s) return;
    const giveUpAfter = s.giveUpAfterMs ?? 24 * 60 * 60 * 1000;
    const budget = s.budgetMs ?? 10_000;
    const started = Date.now();
    let asked = 0;
    for (const b of this.batches.values()) {
      if (b.state !== "safe" && b.state !== "finalized") continue;
      if (b.settlement || b.settlementSearch?.gaveUp || !b.inclusion) continue;
      if (asked > 0 && Date.now() - started > budget) break;
      asked++;
      const inc = b.inclusion;
      const now = this.o.now();
      const attempts = (b.settlementSearch?.attempts ?? 0) + 1;
      const sinceSafe = b.statusObserved.safe ? now.getTime() - Date.parse(b.statusObserved.safe) : 0;
      if (sinceSafe > giveUpAfter) {
        b.settlementSearch = { attempts: attempts - 1, lastAt: b.settlementSearch?.lastAt ?? now.toISOString(), gaveUp: true };
        this.saveBatch(b);
        this.event({ type: "settlement-gave-up", batch: b.id, blockNumber: inc.blockNumber, attempts: attempts - 1, sinceSafeMs: sinceSafe });
        continue;
      }
      let parentHash = "";
      try { parentHash = decodeHeader(hexToBytes(inc.headerRlp)).parentHash; } catch { /* the header was checked at inclusion; without a parent hash the finder checks less */ }
      let found: SettlementFound | null;
      try {
        found = await s.find({ blockNumber: inc.blockNumber, blockHash: inc.blockHash, blockTimestamp: inc.blockTimestamp, parentHash, txHash: inc.txHash });
      } catch (e) {
        const error = (e as Error).message.slice(0, 300);
        b.settlementSearch = { attempts, lastAt: now.toISOString(), lastError: error };
        this.saveBatch(b);
        this.event({ type: "settlement-error", batch: b.id, blockNumber: inc.blockNumber, attempts, error });
        continue;
      }
      if (b.settlement) continue; // never replaced, whatever the finder returned meanwhile
      if (!found) {
        b.settlementSearch = { attempts, lastAt: now.toISOString() };
        this.saveBatch(b);
        continue;
      }
      const pointer: SettlementPointer = {
        ...found.pointer,
        blobs: found.pointer.blobs.map((x) => ({ ...x, file: blobFileName(x.versionedHash) })),
      };
      if (s.pins) {
        const v = verifySettlementPointer(pointer, s.pins);
        if (!v.ok) {
          b.settlementSearch = { attempts, lastAt: now.toISOString(), lastError: `pointer refused: ${v.reason ?? "invalid"}` };
          this.saveBatch(b);
          this.event({ type: "settlement-refused", batch: b.id, blockNumber: inc.blockNumber, reason: v.reason ?? "invalid" });
          continue;
        }
      }
      const listed = new Map(found.blobs.map((x) => [x.versionedHash.toLowerCase(), x]));
      const blobFiles: string[] = [];
      for (const ref of pointer.blobs) {
        const blob = listed.get(ref.versionedHash.toLowerCase());
        if (!blob) {
          this.event({ type: "settlement-error", batch: b.id, blockNumber: inc.blockNumber, attempts, error: `no bytes for blob ${ref.versionedHash}` });
          blobFiles.length = 0;
          break;
        }
        const file = blobFileName(ref.versionedHash);
        // Already published by this process (a blob shared with an earlier batch): no staging copy, since
        // nothing would ever publish it and so nothing would ever delete it.
        if (!this.publishedBlobs.has(file)) {
          const local = join(this.dirs.blobs, file);
          if (!existsSync(local)) atomicWrite(local, blob.bytes);
          if (s.publishBlob) this.unpublishedBlobs.set(file, blob.bytes);
        }
        blobFiles.push(file);
      }
      if (blobFiles.length !== pointer.blobs.length) {
        b.settlementSearch = { attempts, lastAt: now.toISOString(), lastError: "blob bytes missing" };
        this.saveBatch(b);
        continue;
      }
      // The staged blobs are journaled before the batch takes the pointer, so a crash from here on cannot
      // leave a settled batch whose blobs no restart would publish.
      this.journalPublish();
      // On disk: blob bytes, then the batch, then the sidecars and write record carrying the pointer.
      // In S3, flushPublish holds back every sidecar and write record that names a blob not yet uploaded,
      // so with publishBlob set, no published pointer names bytes that are not already in S3 beside it.
      b.settlement = { pointer, foundAt: now.toISOString(), blobFiles };
      b.settlementSearch = { attempts, lastAt: now.toISOString() };
      this.saveBatch(b);
      await this.ensureFloors(b.items);
      const tree = new MerkleTree(b.items.map((i) => ceilingLeaf(i.proofHash)));
      for (const i of b.items) this.writeSidecar(i, b, tree, b.state as CeilingStatus);
      this.writeRecord(b);
      this.event({
        type: "settlement", batch: b.id, records: b.items.length, blockNumber: inc.blockNumber,
        l1BlockNumber: pointer.l1.blockNumber, l1BlockTimestamp: pointer.l1.blockTimestamp, l1TxHash: pointer.l1.txHash,
        blobs: blobFiles.length, channel: pointer.channel?.id ?? null, latencySeconds: pointer.l1.blockTimestamp - inc.blockTimestamp, attempts,
      });
    }
  }

  // ── write records (one per Base transaction, for the Base ceilings page) ──

  /** `writes/<UTC day of the block>/<block, 12 digits>-<tx hash head>.json`, relative to ceilings/. */
  static writeRecordName(b: Batch): string | null {
    const inc = b.inclusion;
    if (!inc) return null;
    const day = new Date(inc.blockTimestamp * 1000).toISOString().slice(0, 10);
    return `writes/${day}/${String(inc.blockNumber).padStart(12, "0")}-${inc.txHash.slice(2, 12)}.json`;
  }

  private writeRecord(b: Batch): void {
    const name = CeilingWriter.writeRecordName(b);
    if (!name || !b.inclusion) return;
    const inc = b.inclusion;
    const rec = {
      version: "bitgraph-ceiling-write/1",
      chainId: this.o.chain.chainId,
      writer: this.o.chain.writer,
      txHash: inc.txHash,
      blockNumber: inc.blockNumber,
      blockHash: inc.blockHash,
      blockTimestamp: inc.blockTimestamp,
      status: b.state,
      statusObserved: b.statusObserved,
      records: b.items.length,
      epochId: b.group.epochId,
      bitgraphChain: b.group.chainId,
      firstPos: b.firstPos,
      lastPos: b.lastPos,
      root: b.root,
      prev: b.prev,
      payload: b.payload,
      fees: inc.fees,
      attempts: b.sends.length,
      items: b.items.map((i) => ({ proofHash: i.proofHash, position: i.position, ...(i.digestB64 ? { digestB64: i.digestB64 } : {}) })),
      settlement: b.settlement ? {
        l1BlockNumber: b.settlement.pointer.l1.blockNumber,
        l1BlockHash: b.settlement.pointer.l1.blockHash,
        l1BlockTimestamp: b.settlement.pointer.l1.blockTimestamp,
        l1TxHash: b.settlement.pointer.l1.txHash,
        blobs: b.settlement.blobFiles,
        foundAt: b.settlement.foundAt,
      } : null,
    };
    const json = JSON.stringify(rec, null, 2);
    const local = join(this.o.stateDir, name);
    mkdirSync(join(local, ".."), { recursive: true, mode: 0o700 });
    atomicWrite(local, json);
    if (this.o.publish) { this.unpublished.set(name, json); this.journalPublish(); }
  }

  // ── sidecars ──

  sidecarPath(proofHash: string): string {
    return join(this.dirs.sidecars, `${safeName(proofHash)}.ceiling.json`);
  }

  private writeSidecar(i: CeilingQueueItem, b: Batch, tree: MerkleTree, status: CeilingStatus): void {
    const leafIndex = b.items.findIndex((x) => x.proofHash === i.proofHash);
    const inc = status === "pending" ? undefined : b.inclusion;
    const floor = i.floor ? this.floorCache.get(i.floor.blockHash) ?? this.floorOnDisk(i) : null;
    const s: SidecarOut = {
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
      floor: i.floor && floor ? { blockNumber: floor.blockNumber, blockHash: i.floor.blockHash, blockTimestamp: floor.blockTimestamp, blockHeader: floor.headerRlp, ...(i.floor.chain === "base" ? { chain: "base" as const } : {}) } : null,
      settlement: inc && b.settlement ? b.settlement.pointer : null,
    };
    const json = JSON.stringify(s, null, 2);
    atomicWrite(this.sidecarPath(i.proofHash), json);
    if (this.o.publish) { this.unpublished.set(`${safeName(i.proofHash)}.ceiling.json`, json); this.journalPublish(); }
  }

  /**
   * The blob files a queued sidecar or write record names: a sidecar's settlement pointer lists
   * `blobs[].file` (or only `versionedHash`), a write record's settlement lists file names.
   */
  private static blobsNamed(json: string): string[] {
    let blobs: unknown;
    try { blobs = (JSON.parse(json) as { settlement?: { blobs?: unknown } | null }).settlement?.blobs; } catch { return []; }
    if (!Array.isArray(blobs)) return [];
    const files: string[] = [];
    for (const x of blobs) {
      if (typeof x === "string") files.push(x);
      else if (x && typeof x === "object") {
        const r = x as { file?: unknown; versionedHash?: unknown };
        if (typeof r.file === "string") files.push(r.file);
        else if (typeof r.versionedHash === "string") files.push(`${r.versionedHash.toLowerCase()}.bin`);
      }
    }
    return files;
  }

  /**
   * Blobs first, then sidecars and write records. A file whose settlement names a blob still waiting
   * to be uploaded stays queued (and journaled) until a later flush finds that blob published, so a
   * failing blob upload holds its pointer back instead of publishing a pointer to bytes S3 lacks.
   * Files with no settlement, or whose blobs are all out, are not held. At most 20 blobs per flush;
   * held files wait a few ticks behind a long blob queue, and never block the files behind them.
   */
  private async flushPublish(): Promise<void> {
    const pending = this.unpublished.size + this.unpublishedBlobs.size;
    const publishBlob = this.o.settlement?.publishBlob;
    if (publishBlob && this.unpublishedBlobs.size > 0) {
      const batch = [...this.unpublishedBlobs.entries()].slice(0, 20);
      await Promise.all(batch.map(async ([file, bytes]) => {
        try {
          await publishBlob(`blobs/${file}`, bytes);
          this.publishedBlobs.add(file);
          this.unpublishedBlobs.delete(file);
          // The local copy was only ever the staging copy: published, it goes, and the host's disk stays flat.
          try { unlinkSync(join(this.dirs.blobs, file)); } catch { /* already gone */ }
        } catch (e) {
          this.event({ type: "publish-error", file: `blobs/${file}`, error: (e as Error).message.slice(0, 200) });
        }
      }));
    }
    if (this.o.publish && this.unpublished.size > 0) {
      let ready = [...this.unpublished.entries()];
      let held = 0;
      if (this.unpublishedBlobs.size > 0) {
        ready = ready.filter(([, json]) => {
          const waits = CeilingWriter.blobsNamed(json).some((f) => this.unpublishedBlobs.has(f));
          if (waits) held++;
          return !waits;
        });
      }
      if (held !== this.lastHeld) {
        this.lastHeld = held;
        this.event({ type: "publish-held", files: held, blobsWaiting: this.unpublishedBlobs.size });
      }
      const batch = ready.slice(0, 200);
      await Promise.all(batch.map(async ([name, json]) => {
        try {
          await this.o.publish!(name, json);
          if (this.unpublished.get(name) === json) this.unpublished.delete(name);
        } catch (e) {
          this.event({ type: "publish-error", file: name, error: (e as Error).message.slice(0, 200) });
        }
      }));
    } else if (this.lastHeld !== 0) {
      this.lastHeld = 0;
    }
    if (pending > 0) this.journalPublish();
  }

  // ── inspection ──

  snapshot(): { backlog: number; batches: Batch[]; lastPayloadHash: string; outputRoot: ReturnType<OutputRootSettler["snapshot"]> | null } {
    return { backlog: this.backlog.length, batches: [...this.batches.values()], lastPayloadHash: this.lastPayloadHash, outputRoot: this.outputRootSettler?.snapshot() ?? null };
  }
}
