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
 *
 * Roll mode (WriterOptions.rollRoot). An epoch is a roll: its records are
 * ordered by construction, each one after the one before it, and that order
 * needs nothing from Base. So in this mode a record is not written to Base
 * when it is bound. The queue keeps filling, and the writer holds an epoch's
 * records until that roll is closed. A roll is closed on request (close.ts):
 * whoever is about to stop the enclave asks, and every record of the roll
 * becomes one Merkle root in one transaction while the enclave is still
 * running. So an epoch has two writes, one when it opens and one when it
 * closes, and every record in it lies between them. A roll nobody asked to
 * close (the host went down, say) is closed once the genesis transaction of a
 * later epoch is mined, so no record is left without a root. Until its roll
 * closes a record has no sidecar, and its bound from outside is its Base
 * floor below and, above, the write that closes its roll.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { join } from "node:path";
import {
  CEILING_VERSION, MerkleTree, ceilingLeaf, ceilingPayloadHash, encodeCeilingPayload, decodeHeader,
  evmBytesToHex as bytesToHex, evmHexToBytes as hexToBytes,
  type CeilingSidecar, type CeilingStatus, type SettlementPointer,
} from "@mikeargento/bitgraph-verify";
import type { CeilingQueueItem } from "../parent/ceiling-queue.js";
import { GenesisWriter } from "./genesis.js";
import { CloseRequests, EPOCH_CLOSE_FORMAT } from "./close.js";

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
  /**
   * Where this batch's Base block was found in Ethereum's blob data (bitgraph-settlement/1). The writer does not
   * look for it; a batch file may carry one, and then its sidecars and write record carry it unchanged.
   */
  settlement?: { pointer: SettlementPointer; foundAt: string; blobFiles: string[] };
  /** Kept as found in a batch file; not read. */
  settlementSearch?: { attempts: number; lastAt: string; lastError?: string; gaveUp?: boolean };
  /** Kept as found in a batch file (bitgraph-output-root/1); not read. */
  outputRoot?: unknown;
}

/** A sidecar as written: bitgraph-ceiling/1 with the batch's stored settlement pointer, if any, in the slot reserved for it. */
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
   * Epoch genesis transactions (bitgraph-epoch-genesis/1, genesis.ts): the directory the parent drops its requests
   * in and reads the results from. Off when absent.
   */
  genesisDir?: string;
  /**
   * One write per roll instead of one per burst (see the header). Needs `genesisDir`: a mined genesis is how the
   * writer learns that a roll nobody asked to close is over. Off by default: a batch is cut as soon as records are queued.
   */
  rollRoot?: boolean;
  /** Close requests (bitgraph-epoch-close-request/1, close.ts): the directory they are left in and answered in. Off when absent. */
  closeDir?: string;
  /**
   * Roll mode: once the oldest held record has waited this long, a `roll-held` event is logged, at most once an
   * hour (default 36 h). Nothing is written early; the event says a roll has not been closed when one was due.
   */
  rollHeldAlertMs?: number;
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

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function groupKey(i: CeilingQueueItem): string {
  return `${i.epochId}\u0000${i.chainId}`;
}

export class CeilingWriter {
  private readonly o: Required<Omit<WriterOptions, "minBalanceWei" | "publish" | "genesisDir" | "closeDir">> & { minBalanceWei: bigint | null; publish: WriterOptions["publish"]; genesisDir?: WriterOptions["genesisDir"] };
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
  /** Batches whose sidecars on disk lack a floor header their items name; repaired a few per tick. */
  private floorRepair: string[] = [];
  private floorRepairTries = new Map<string, number>();
  private readonly genesis: GenesisWriter | null = null;
  private lastRollHeldEvent = 0;
  private closes?: CloseRequests;

  constructor(opts: WriterOptions) {
    this.o = {
      replaceAfterBlocks: 3,
      log: (e) => console.log(JSON.stringify(e)),
      now: () => new Date(),
      ...opts,
      rollRoot: opts.rollRoot ?? false,
      rollHeldAlertMs: opts.rollHeldAlertMs ?? 36 * 60 * 60 * 1000,
      minBalanceWei: opts.minBalanceWei ?? null,
      publish: opts.publish,
    };
    this.dirs = { batches: join(opts.stateDir, "batches"), sidecars: join(opts.stateDir, "sidecars") };
    mkdirSync(this.dirs.batches, { recursive: true, mode: 0o700 });
    mkdirSync(this.dirs.sidecars, { recursive: true, mode: 0o700 });
    if (opts.genesisDir && (opts.chain.chainId === 8453 || opts.chain.chainId === 84532)) {
      this.genesis = new GenesisWriter({
        dir: opts.genesisDir, chain: opts.chain, chainId: opts.chain.chainId, replaceAfterBlocks: this.o.replaceAfterBlocks,
        now: () => this.o.now(), log: (e) => this.event(e as { type: string } & Record<string, unknown>),
      });
    }
    // Without the genesis directory nothing would ever say a roll is over, and every record would wait for good.
    if (this.o.rollRoot && !this.genesis) throw new TypeError("rollRoot needs genesisDir on Base (8453 or 84532)");
    if (opts.closeDir) this.closes = new CloseRequests(opts.closeDir);
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
    for (const b of this.batches.values()) {
      if (!b.inclusion || b.state === "dropped") continue;
      if (b.items.some((i) => i.floor && !this.floorOnDisk(i))) this.floorRepair.push(b.id);
    }
    // Publishes pending when the process last stopped, re-read from disk. The journal may also list
    // blob files from an older version of this program; they are not this program's to publish.
    const journal = this.p("unpublished.json");
    if (this.o.publish && existsSync(journal)) {
      const j = readJson<{ files?: unknown }>(journal, {});
      for (const name of Array.isArray(j.files) ? j.files : []) {
        if (typeof name !== "string") continue;
        const local = name.endsWith(".ceiling.json") ? join(this.dirs.sidecars, name) : join(this.o.stateDir, name);
        if (existsSync(local)) this.unpublished.set(name, readFileSync(local, "utf8"));
      }
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
    if (!this.o.publish) return;
    atomicWrite(this.p("unpublished.json"), JSON.stringify({ files: [...this.unpublished.keys()] }));
  }
  /**
   * Every item's floor header in the cache before a sidecar is written: from the cache, else from
   * the sidecar already on disk (a restart empties the cache), else from the chain, so a sidecar
   * rewritten after a restart never loses its floor.
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
      this.writeSidecars(b, tree, b.state as CeilingStatus);
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
    // The backlog file is rewritten whole each time. In roll mode it holds a roll's records until the roll closes,
    // so the bytes written over a day grow with the square of the day's records: nothing at hundreds a day, worth
    // an append-only file before tens of thousands.
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
    // A genesis transaction and a ceiling batch never fly together: one nonce sequence, one in flight.
    const genesisInFlight = this.genesis ? await this.genesis.pass(!act) : false;
    if (act) await this.advance(act);
    else if (!genesisInFlight && this.backlog.length > 0) {
      const key = this.o.rollRoot ? this.closedGroup() : groupKey(this.backlog[0]!);
      if (key !== null) await this.startBatch(key);
      else this.noteHeld();
    }
    this.answerCloses();
    await this.flushPublish();
    const t = Date.now();
    if (t - this.lastStatusPoll > 4_000) { this.lastStatusPoll = t; await this.pollStatus(); }
    if (this.o.minBalanceWei !== null && t - this.lastBalancePoll > 60_000) {
      this.lastBalancePoll = t;
      const bal = await this.o.chain.balanceWei();
      if (bal < this.o.minBalanceWei) this.event({ type: "low-balance", balanceWei: bal.toString(), thresholdWei: this.o.minBalanceWei.toString() });
    }
    if (this.floorRepair.length > 0) {
      await this.repairFloors();
      await this.flushPublish();
    }
  }

  /**
   * Roll mode: the (epoch, chain) group in the backlog whose roll is over, in backlog order, or null while every
   * queued record belongs to a roll still open. A roll is over once its close was asked for after the newest of
   * the group's queued records was bound. Failing that, it is over once the genesis transaction of another epoch
   * is mined and that genesis was asked for after the newest of the group's queued records was bound. Every time
   * compared is the host's clock (a record's committedAt, a request's requestedAt), so no chain time is compared
   * with host time. It is read from disk every tick and nothing is remembered, so a restart neither cuts early
   * nor forgets. A record of a closed epoch that turns up afterwards (a reorg, a late queue line) is cut the same way.
   */
  private closedGroup(): string | null {
    const asked = this.closes?.requests() ?? [];
    const mined = (this.genesis?.openings() ?? []).filter((g) => g.mined);
    if (asked.length === 0 && mined.length === 0) return null;
    const newest = new Map<string, { epochId: string; ms: number }>();
    for (const i of this.backlog) {
      const t = Date.parse(i.committedAt);
      const ms = Number.isFinite(t) ? t : 0;
      const k = groupKey(i);
      const g = newest.get(k);
      if (!g) newest.set(k, { epochId: i.epochId, ms });
      else if (ms > g.ms) g.ms = ms;
    }
    for (const [k, g] of newest) {
      if (asked.some((r) => r.epochId === g.epochId && r.requestedAtMs >= g.ms)) return k;
    }
    for (const [k, g] of newest) {
      if (mined.some((m) => m.epochId !== g.epochId && m.requestedAtMs > g.ms)) return k;
    }
    return null;
  }

  /**
   * Answer the close requests that can be answered: the result file is what the asker waits for before it stops
   * the enclave. A request is answered once none of its epoch's records is still queued and none of its writes is
   * still in flight: with the write that covers the epoch's last position, or with `records: 0` for an epoch that
   * had nothing queued. A result is written once. Should Base later replace that block, the root is written again
   * as any reorged write is, and the sidecars carry the block that stands.
   */
  private answerCloses(): void {
    if (!this.closes) return;
    for (const r of this.closes.requests()) {
      if (r.done) continue;
      if (this.backlog.some((i) => i.epochId === r.epochId)) continue;
      let last: Batch | undefined;
      let inFlight = false;
      for (const b of this.batches.values()) {
        if (b.group.epochId !== r.epochId || b.state === "dropped") continue;
        if (!b.inclusion) { inFlight = true; break; }
        if (!last || BigInt(b.lastPos) > BigInt(last.lastPos)) last = b;
      }
      if (inFlight) continue;
      const inc = last?.inclusion;
      this.closes.finish({
        format: EPOCH_CLOSE_FORMAT, epochId: r.epochId, requestedAt: r.requestedAt,
        records: last ? last.items.length : 0,
        ...(last && inc ? {
          batch: last.id, root: last.root, firstPos: last.firstPos, lastPos: last.lastPos, chainId: this.o.chain.chainId,
          txHash: inc.txHash, blockNumber: inc.blockNumber, blockHash: inc.blockHash, blockTimestamp: inc.blockTimestamp,
        } : {}),
      });
      this.event({ type: "roll-closed", epochId: r.epochId, requestedAt: r.requestedAt, records: last ? last.items.length : 0, ...(last && inc ? { batch: last.id, blockNumber: inc.blockNumber, txHash: inc.txHash } : {}) });
    }
  }

  /** Roll mode, nothing to cut: say so when the oldest held record has waited longer than a roll should last. */
  private noteHeld(): void {
    const t = Date.now();
    if (t - this.lastRollHeldEvent < 60 * 60 * 1000) return;
    let oldest = Infinity;
    for (const i of this.backlog) {
      const ms = Date.parse(i.committedAt);
      if (Number.isFinite(ms) && ms < oldest) oldest = ms;
    }
    const waited = this.o.now().getTime() - oldest;
    if (!(waited > this.o.rollHeldAlertMs)) return;
    this.lastRollHeldEvent = t;
    this.event({ type: "roll-held", records: this.backlog.length, oldestCommittedAt: new Date(oldest).toISOString(), heldHours: Math.round(waited / 3_600_000) });
  }

  private async startBatch(key: string): Promise<void> {
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
    if (this.o.rollRoot) this.event({ type: "roll-close", batch: b.id, epochId: b.group.epochId, bitgraphChain: b.group.chainId, records: items.length, firstPos: b.firstPos, lastPos: b.lastPos });
    this.writeSidecars(b, tree, "pending");
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
    this.writeSidecars(b, tree, "included");
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
      this.writeSidecars(b, tree, next as CeilingStatus);
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
    this.writeSidecars({ ...b, inclusion: undefined, settlement: undefined } as Batch, tree, "pending");
  }

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

  /**
   * Every record's sidecar for a batch. A roll's batch can hold a whole day of records, so each record's leaf index
   * is its place in the loop, not a search, and the publish journal is written once at the end, not once a record.
   */
  private writeSidecars(b: Batch, tree: MerkleTree, status: CeilingStatus): void {
    for (let n = 0; n < b.items.length; n++) this.writeSidecar(b.items[n]!, n, b, tree, status);
    if (this.o.publish && b.items.length > 0) this.journalPublish();
  }

  private writeSidecar(i: CeilingQueueItem, leafIndex: number, b: Batch, tree: MerkleTree, status: CeilingStatus): void {
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
    if (this.o.publish) this.unpublished.set(`${safeName(i.proofHash)}.ceiling.json`, json);
  }

  /** Up to 200 queued sidecars and write records per flush; one that fails stays queued for the next. */
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
    this.journalPublish();
  }

  // ── inspection ──

  snapshot(): { backlog: number; batches: Batch[]; lastPayloadHash: string } {
    return { backlog: this.backlog.length, batches: [...this.batches.values()], lastPayloadHash: this.lastPayloadHash };
  }
}
