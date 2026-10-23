// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * Settlement through Base's output root (bitgraph-output-root/1), in the
 * ceiling writer's loop, beside the blob settlement (bitgraph-settlement/1),
 * which keeps running and keeps archiving blobs. Added 2026-10-03.
 *
 * Why the writer does this itself, and when: Base posts an output root for
 * summary block P to Ethereum every 600 Base blocks (20 minutes), as the
 * rootClaim of a dispute game, about 36 to 40 minutes after P. The settlement
 * for a ceiling block B needs P's state (the EIP-2935 storage proof of B's
 * hash), and public Base RPCs serve state for recent blocks only (about an
 * hour back on mainnet.base.org, varying by backend). So the window is
 * captured AT P, while it is recent, and the Ethereum claim is attached when
 * it lands and is final.
 *
 * The state machine, per pass (every `everyMs`, default 30 s; nothing at all,
 * no request, while no ceiling is unsettled and no window is waiting):
 *
 *   1. scan     Ethereum's FINALIZED blocks for the factory's DisputeGameCreated
 *               events since the last scan (one eth_getLogs per 500 blocks, at
 *               most every `scanEveryMs`), and each new game's summary block
 *               (`l2SequenceNumber()`). The games teach the cadence: the spacing
 *               is the most common P_i - P_(i-1), the anchor the newest P; with
 *               no games, 600 and game 23386's P = 52,109,160.
 *   2. match    every window awaiting its claim against the games: a game whose
 *               rootClaim equals the window's computed output root is its claim
 *               (attached: one bitgraph-output-root/1 per ceiling block, each
 *               verified by verifyOutputRootSettlement and checked against the
 *               batch's own block hash, written create-only); a game for the same
 *               P with ANOTHER root is logged loudly (severity "alert") and the
 *               window waits on (the ceilings are already in the next windows).
 *               A window ends when games two summary blocks past it exist and
 *               none matched it ("passed-over" / "contradicted"), or after
 *               `watchMs` (24 h).
 *   3. capture  the next summary block P after the last one handled, once Base's
 *               clock and head are `marginBlocks` (15 blocks, 30 s) past it:
 *               every unsettled ceiling block B with 0 <= P - B <= 8191 goes into
 *               the window, so a ceiling sits in each window from its first until
 *               one of their claims settles it, and a mismatching or missing
 *               claim costs nothing but waiting for the next. A P whose state no
 *               endpoint holds any more (and which is older than `minMissAgeMs`)
 *               is "missed": logged, and the next P is tried at once. A ceiling
 *               whose evidence does not hold together is left out ("skip").
 *   4. drop     a ceiling block no window can cover any more (B + 8191 < the next
 *               P) and in no window still waiting is "out-of-window": logged and
 *               marked on its batches. It keeps its blob settlement.
 *   5. store    create-only writes of what the passes produced; a failed write is
 *               tried again next pass (the local files are the journal).
 *
 * OPERATOR NOTE
 *
 *   Env (main.ts):  CEILING_OUTPUT_ROOT=off      turns it off (on by default on Base mainnet only)
 *                   CEILING_BASE_RPC_URLS        comma-separated Base RPCs, asked in turn
 *                                                (default CEILING_RPC_URL, else https://mainnet.base.org)
 *                   CEILING_L1_RPC_URLS          comma-separated Ethereum RPCs
 *                                                (default CEILING_L1_RPC_URL, else ethereum-rpc.publicnode.com)
 *                   CEILING_BASE_RPC_INTERVAL_MS / CEILING_L1_RPC_INTERVAL_MS
 *                                                spacing between requests to one endpoint (1000 / 100)
 *   S3 (create-only, PutObject If-None-Match "*", immutable; the local copy under
 *   the state directory has the same path without "ceilings/"):
 *                   ceilings/settlements/output-root/windows/<P>.json   one per captured window
 *                                                (bitgraph-output-root-window/1: P's preimage, the output
 *                                                root, each ceiling's history proof)
 *                   ceilings/settlements/output-root/<B>.json           one per settled ceiling block
 *                                                (bitgraph-output-root/1), served by /api/ceilings/settlement/<B>
 *   Local state:    <state>/output-root/state.json (games seen, scan cursor, last P handled, trackFrom),
 *                   <state>/output-root/windows/<P>.json (each window's progress); batches/<id>.json
 *                   carry `outputRoot` once settled or out of window.
 *   RPC per day, at most 72 windows, and none while nothing is pending:
 *     Base: per captured window 1 eth_blockNumber + 1 eth_getProof (message passer) + 1
 *     eth_getBlockByNumber + 1 eth_getProof per unsettled ceiling block in range. A block sits in
 *     about 3 windows before its first claim is final, so about 3 * 72 + 3 * (ceiling blocks per
 *     day): 216 + 600 = ~820 for 200 ceiling blocks. A missed window costs 1. Answers already
 *     received for a P are kept across passes, so a rate limit costs a retry, never a re-fetch.
 *     Ethereum: 2 requests a minute (finalized block, eth_getLogs) = up to 2,880, plus 1 eth_call per
 *     new game (72), plus per settled window 2-9 eth_calls (game index) and one full block
 *     (eth_getBlockByHash with transactions, about 700 KB: about 50 MB a day at 72).
 *   Rate limits: mainnet.base.org let about one eth_getProof through per pass after a burst
 *     (measured 2026-10-03); a capture keeps what it got, so a window of N ceiling blocks takes about
 *     N passes (30 s each) there, well inside the hour P's state is served for a handful of blocks.
 *     A keyed endpoint first in CEILING_BASE_RPC_URLS is the fix for a busy writer.
 *   Outages: Base RPC down or rate-limited, the capture is retried each pass while P's state is
 *     served; once no endpoint holds it, P is missed and the next one is tried, and a ceiling whose
 *     every window (about 4.5 hours) is missed is logged "output-root-out-of-window" and keeps only
 *     its blob settlement. Ethereum RPC down: claims wait; nothing is lost while the scan can catch
 *     up (`maxLookback`, 1,800 blocks or 6 hours; past that the gap is logged and windows whose claim
 *     fell in it end "passed-over"). S3 down: writes wait in the local files and go out later.
 *     Writer down: on return, summary blocks whose state is gone, or whose claim the scan never
 *     read, are skipped ("output-root-missed", reason "state-gone" / "no-claim").
 *     Alerts to grep for: "severity":"alert" (a claim with another root, a stored object with
 *     other content, a settlement that did not verify).
 *   Checking a stored settlement by hand, from the repo root with packages/verify built (the
 *   published bitgraph-verify 1.15.2 predates output-root/1):
 *     curl -s https://bitgraph.ing/api/ceilings/settlement/<B> -o s.json
 *     node -e 'import("./packages/verify/dist/index.js").then(v => { const r = v.verifyOutputRootSettlement(JSON.parse(require("fs").readFileSync("s.json", "utf8"))); console.log(r.ok, JSON.stringify(r.existedBy), r.outputRootHex) })'
 *     must print true and Ethereum block H. Then: base.blockHash equals the ceiling sidecar's
 *     anchor.blockHash (/api/ceilings/<proofHash>); block H has hash existedBy.blockHash on
 *     etherscan.io; and, optionally, the factory's game `game.index` has rootClaim = the printed
 *     output root.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { HISTORY_SERVE_WINDOW, BASE_DISPUTE_GAME_FACTORY, verifyOutputRootSettlement, type OutputRootSettlement } from "@mikeargento/bitgraph-verify";
import type { BlockEvidence, Rpc } from "./block.js";
import {
  attachClaim, captureWindow, gameIndexOf, gameLogs, gameSummaryBlock, learnCadence, nextSummaryBlock, FALLBACK_CADENCE,
  type Cadence, type CaptureResult, type CapturedWindow, type GameSeen,
} from "./output-root-capture.js";
import { RpcError, rpcErrorKind } from "./rpc-pool.js";
import { BASE_MAINNET_ROLLUP } from "./settlement.js";
import type { Batch } from "./writer.js";

/** Where the writer stores what this file produces, relative to `ceilings/` in S3 and to the state directory locally. */
export const OUTPUT_ROOT_PREFIX = "settlements/output-root";
export const WINDOW_VERSION = "bitgraph-output-root-window/1" as const;
export function settlementKey(baseBlock: number): string { return `${OUTPUT_ROOT_PREFIX}/${baseBlock}.json`; }
export function windowKey(p: number): string { return `${OUTPUT_ROOT_PREFIX}/windows/${p}.json`; }

/** S3 in production, a Map in tests. Keys are relative to `ceilings/`. */
export interface CreateOnlyStore {
  /** Write only if nothing is there: "created", or "exists" when an object already is (never overwritten). Throws on anything else. */
  createOnly(key: string, body: string): Promise<"created" | "exists">;
  /** The stored text (null when absent), to compare with an object that already exists. */
  read?(key: string): Promise<string | null>;
}

export interface OutputRootOptions {
  /** Base JSON-RPC (an rpcPool over CEILING_BASE_RPC_URLS in production). */
  base: Rpc;
  /** Ethereum JSON-RPC (an rpcPool over CEILING_L1_RPC_URLS in production). */
  l1: Rpc;
  /** Absent: the files are written under the state directory only. */
  store?: CreateOnlyStore;
  /** The claim transaction's evidence (default: blockEvidence over `l1`). Tests replay the vector's. */
  evidence?: (blockHash: string, txHash: string) => Promise<BlockEvidence>;
  factory?: string;
  /** Base block number to time (default Base mainnet: genesis 1686789347, 2 s). */
  rollup?: { l2GenesisTime: number; blockTime: number };
  /** Cadence before any game is seen (default P = 52,109,160 and 600). */
  fallback?: { anchor: number; spacing: number };
  /** Between passes (default 30 000 ms). */
  everyMs?: number;
  /** Between scans of Ethereum (default 60 000 ms). */
  scanEveryMs?: number;
  /** Capture P once Base is this many blocks past it, by clock and by head (default 15). */
  marginBlocks?: number;
  /** A "state not held" answer for a P younger than this is retried, not a miss (default 300 000 ms). */
  minMissAgeMs?: number;
  /** A window waiting longer than this for its claim ends (default 24 h). */
  watchMs?: number;
  /**
   * Wall-clock budget for captures, and for attaches, in one pass (default 10 000 ms, the blob settlement's):
   * no new request starts past it, at least one attach runs, and a capture cut short resumes next pass.
   */
  budgetMs?: number;
  /** Ethereum blocks read back on the first scan (default 900, three hours). */
  initialLookback?: number;
  /** Ethereum blocks the scan catches up at most after an outage (default 1800, six hours). */
  maxLookback?: number;
  /** Ethereum blocks per eth_getLogs (default 500). */
  chunkBlocks?: number;
  /** Where loud events go besides the event log (default console.error). */
  alert?: (event: Record<string, unknown>) => void;
}

/** What a batch carries once its block is handled: the settlement written, or why there is none. Never replaced. */
export type OutputRootMark =
  | { status: "settled"; p: number; key: string; l1BlockNumber: number; l1BlockHash: string; l1BlockTimestamp: number; l1TxHash: string; gameIndex: number; at: string }
  | { status: "out-of-window"; windows: number[]; at: string };

/** What the settler needs from the writer. */
export interface SettlerHost {
  stateDir: string;
  batches(): Iterable<Batch>;
  saveBatch(b: Batch): void;
  event(e: Record<string, unknown>): void;
  now(): Date;
}

type WindowStatus = "awaiting-claim" | "settled" | "ended";

/** The writer's own record of a window (local only); the captured data is the stored window file. */
export interface WindowRecord {
  p: number;
  status: WindowStatus;
  outputRoot: string;
  /** The ceiling blocks the window covers. */
  ceilings: number[];
  capturedAt: string;
  /** windows/<P>.json is in the store. */
  stored: boolean;
  /** Ceiling blocks whose settlement file waits for the store. */
  storePending: number[];
  /** Games for this P whose rootClaim is not the computed output root. */
  mismatches: Array<{ txHash: string; l1BlockNumber: number; rootClaim: string; proxy: string; gameType: number; seenAt: string }>;
  claim?: { txHash: string; l1BlockNumber: number; l1BlockHash: string; proxy: string; gameType: number; gameIndex: number; foundAt: string };
  /** The ceiling blocks this window's claim settled. */
  settled?: number[];
  attachErrors?: number;
  lastError?: string;
  ended?: { reason: "passed-over" | "contradicted" | "timeout"; at: string };
}

interface SettlerState {
  version: 1;
  /** Ceilings in blocks below this were never tracked (set at the first pass: anything older is out of reach). */
  trackFrom: number | null;
  /** The last summary block handled (captured, missed, or with nothing to capture). */
  lastP: number | null;
  /** The last Ethereum block whose game events were read. */
  l1Cursor: number | null;
  /** The newest games seen, oldest first. */
  games: GameSeen[];
}

interface PendingCeiling { blockNumber: number; blockHash: string; blockTimestamp: number; batches: Batch[] }

const MAX_GAMES = 256;
const MAX_CHUNKS_PER_SCAN = 8;
const MAX_STORES_PER_FLUSH = 50;

function atomicWrite(path: string, data: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, data, { mode: 0o600 });
  renameSync(tmp, path);
}

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** A ceiling block is the pair (number, hash): two batches naming one height with two hashes are kept apart, and the history proof decides. */
function ckey(blockNumber: number, blockHash: string): string {
  return `${blockNumber}:${blockHash.toLowerCase()}`;
}

export class OutputRootSettler {
  private readonly o: Required<Omit<OutputRootOptions, "store" | "evidence">> & Pick<OutputRootOptions, "store" | "evidence">;
  private readonly host: SettlerHost;
  private readonly dir: string;
  private state: SettlerState;
  private readonly windows = new Map<number, WindowRecord>();
  private lastScan = Number.NEGATIVE_INFINITY;
  private lastCadence = "";
  /**
   * Base's answers for a summary block still being captured, kept across passes. mainnet.base.org
   * refused eth_getProof four passes in a row on 2026-10-03 even at 1.5 s spacing; a window needs
   * 2 + N of them, so a capture cut short by a rate limit (or by the pass budget) resumes with what
   * it already has instead of asking for all of it again. P's state never changes, so a kept answer
   * stays right; failures are not kept. Dropped once P is captured or missed.
   */
  private readonly captureMemo = new Map<number, Map<string, unknown>>();

  constructor(host: SettlerHost, opts: OutputRootOptions) {
    this.host = host;
    this.o = {
      factory: BASE_DISPUTE_GAME_FACTORY,
      rollup: BASE_MAINNET_ROLLUP,
      fallback: FALLBACK_CADENCE,
      everyMs: 30_000,
      scanEveryMs: 60_000,
      marginBlocks: 15,
      minMissAgeMs: 300_000,
      watchMs: 24 * 60 * 60 * 1000,
      budgetMs: 10_000,
      initialLookback: 900,
      maxLookback: 1800,
      chunkBlocks: 500,
      alert: (e) => console.error(JSON.stringify(e)),
      ...opts,
    };
    this.dir = join(host.stateDir, "output-root");
    mkdirSync(join(this.dir, "windows"), { recursive: true, mode: 0o700 });
    this.state = readJson<SettlerState>(join(this.dir, "state.json"), { version: 1, trackFrom: null, lastP: null, l1Cursor: null, games: [] });
    for (const f of readdirSync(join(this.dir, "windows"))) {
      if (!f.endsWith(".json")) continue;
      const w = JSON.parse(readFileSync(join(this.dir, "windows", f), "utf8")) as WindowRecord;
      this.windows.set(w.p, w);
    }
    this.repairMarks();
  }

  // ── persistence ──

  private saveState(): void { atomicWrite(join(this.dir, "state.json"), JSON.stringify(this.state)); }
  private saveWindow(w: WindowRecord): void {
    this.windows.set(w.p, w);
    atomicWrite(join(this.dir, "windows", `${w.p}.json`), JSON.stringify(w, null, 2));
  }
  private local(key: string): string { return join(this.host.stateDir, key); }
  private readWindow(p: number): CapturedWindow {
    const j = JSON.parse(readFileSync(this.local(windowKey(p)), "utf8")) as CapturedWindow & { version?: string };
    return { p: j.p, outputRoot: j.outputRoot, ceilings: j.ceilings, capturedAt: j.capturedAt };
  }
  private alert(e: Record<string, unknown>): void {
    const line = { severity: "alert", ...e };
    this.host.event(line);
    this.o.alert({ at: this.host.now().toISOString(), ...line });
  }

  /** A settlement file on disk that verifies for this exact block, or null. */
  private localSettlement(blockNumber: number, blockHash: string): OutputRootSettlement | null {
    const path = this.local(settlementKey(blockNumber));
    if (!existsSync(path)) return null;
    try {
      const s = JSON.parse(readFileSync(path, "utf8")) as OutputRootSettlement;
      const v = verifyOutputRootSettlement(s);
      if (v.ok && s.base.blockNumber === blockNumber && s.base.blockHash.toLowerCase() === blockHash.toLowerCase()) return s;
    } catch { /* not a settlement */ }
    return null;
  }

  private mark(s: OutputRootSettlement): OutputRootMark {
    return {
      status: "settled", p: s.outputRoot.blockNumber, key: settlementKey(s.base.blockNumber),
      l1BlockNumber: s.ethereum.blockNumber, l1BlockHash: s.ethereum.blockHash, l1BlockTimestamp: s.ethereum.blockTimestamp, l1TxHash: s.ethereum.txHash,
      gameIndex: s.game?.index ?? -1, at: this.host.now().toISOString(),
    };
  }

  /**
   * At start: a window recorded as settled whose batches never took their mark (a stop between
   * the two writes) marks them now, from the settlement file on disk.
   */
  private repairMarks(): void {
    const settled = new Set<number>();
    for (const w of this.windows.values()) for (const b of w.settled ?? []) settled.add(b);
    if (settled.size === 0) return;
    for (const b of this.host.batches()) {
      const inc = b.inclusion;
      if (!inc || b.outputRoot || b.state === "dropped" || !settled.has(inc.blockNumber)) continue;
      const s = this.localSettlement(inc.blockNumber, inc.blockHash);
      if (!s) continue;
      b.outputRoot = this.mark(s);
      this.host.saveBatch(b);
      this.host.event({ type: "output-root-repair", batch: b.id, blockNumber: inc.blockNumber });
    }
  }

  // ── the pass ──

  private timeOfMs(blockNumber: number): number {
    return (this.o.rollup.l2GenesisTime + blockNumber * this.o.rollup.blockTime) * 1000;
  }
  private cadence(): Cadence { return learnCadence(this.state.games, this.o.fallback); }

  /** Every ceiling block with a live batch and no mark yet, at or above trackFrom. */
  private pending(): Map<string, PendingCeiling> {
    const m = new Map<string, PendingCeiling>();
    for (const b of this.host.batches()) {
      const inc = b.inclusion;
      if (!inc || b.outputRoot) continue;
      if (b.state !== "included" && b.state !== "safe" && b.state !== "finalized") continue;
      if (this.state.trackFrom !== null && inc.blockNumber < this.state.trackFrom) continue;
      const k = ckey(inc.blockNumber, inc.blockHash);
      const g = m.get(k);
      if (g) g.batches.push(b);
      else m.set(k, { blockNumber: inc.blockNumber, blockHash: inc.blockHash.toLowerCase(), blockTimestamp: inc.blockTimestamp, batches: [b] });
    }
    return m;
  }

  async pass(): Promise<void> {
    const started = Date.now();
    if (this.state.trackFrom === null) this.begin();
    await this.flushStores();
    const pending = this.pending();
    const waiting = [...this.windows.values()].some((w) => w.status === "awaiting-claim");
    if (pending.size === 0 && !waiting) return;
    try {
      await this.scan();
    } catch (e) {
      this.host.event({ type: "output-root-scan-error", kind: rpcErrorKind(e), error: (e as Error).message.slice(0, 300) });
    }
    await this.matchClaims(pending, started);
    try {
      await this.captureDue(pending);
    } catch (e) {
      this.host.event({ type: "output-root-capture-error", kind: rpcErrorKind(e), error: (e as Error).message.slice(0, 300) });
    }
    this.dropOutOfWindow(pending);
    await this.flushStores();
  }

  /**
   * The first pass of this code on a state directory: ceilings older than two history windows
   * (about nine hours) are never tracked, so the batches written before output-root settlement
   * existed are not walked through windows that are long gone. One line says how many.
   */
  private begin(): void {
    const nowSec = Math.floor(this.host.now().getTime() / 1000);
    const head = Math.floor((nowSec - this.o.rollup.l2GenesisTime) / this.o.rollup.blockTime);
    this.state.trackFrom = Math.max(0, head - 2 * HISTORY_SERVE_WINDOW);
    let untracked = 0;
    for (const b of this.host.batches()) if (b.inclusion && b.state !== "dropped" && b.inclusion.blockNumber < this.state.trackFrom) untracked++;
    this.saveState();
    this.host.event({ type: "output-root-start", trackFrom: this.state.trackFrom, untrackedBatches: untracked });
  }

  // 1. Ethereum's record of the games.
  private async scan(): Promise<void> {
    if (Date.now() - this.lastScan < this.o.scanEveryMs) return;
    this.lastScan = Date.now();
    const fin = (await this.o.l1("eth_getBlockByNumber", ["finalized", false])) as { number?: string } | null;
    if (!fin?.number) throw new Error("eth_getBlockByNumber finalized: no block");
    const finalized = parseInt(fin.number, 16);
    let from = this.state.l1Cursor === null ? finalized - this.o.initialLookback + 1 : this.state.l1Cursor + 1;
    if (finalized - from + 1 > this.o.maxLookback) {
      const resume = finalized - this.o.maxLookback + 1;
      if (this.state.l1Cursor !== null) {
        this.host.event({ type: "output-root-scan-gap", fromBlock: from, toBlock: resume - 1, waiting: [...this.windows.values()].filter((w) => w.status === "awaiting-claim").map((w) => w.p) });
      }
      from = resume;
    }
    const to = Math.min(finalized, from + this.o.chunkBlocks * MAX_CHUNKS_PER_SCAN - 1);
    for (let a = from; a <= to; a += this.o.chunkBlocks) {
      const b = Math.min(to, a + this.o.chunkBlocks - 1);
      const logs = await gameLogs(this.o.l1, a, b, this.o.factory);
      for (const g of logs) {
        if (this.state.games.some((x) => x.proxy === g.proxy)) continue;
        const p = await gameSummaryBlock(this.o.l1, g.proxy);
        this.state.games.push({ ...g, p });
      }
      this.state.l1Cursor = b;
      if (this.state.games.length > MAX_GAMES) this.state.games = this.state.games.slice(-MAX_GAMES);
      this.saveState();
    }
    const c = this.cadence();
    const key = `${c.spacing}/${((c.anchor % c.spacing) + c.spacing) % c.spacing}/${c.learned}/${c.irregular}`;
    if (key !== this.lastCadence) {
      this.lastCadence = key;
      this.host.event({ type: "output-root-cadence", spacing: c.spacing, anchor: c.anchor, learned: c.learned, irregular: c.irregular, games: this.state.games.length });
    }
  }

  /** The newest summary block among games of the newest game's type. */
  private newestP(): number | null {
    const withP = this.state.games.filter((g) => g.p !== null);
    if (withP.length === 0) return null;
    const type = withP[withP.length - 1]!.gameType;
    return Math.max(...withP.filter((g) => g.gameType === type).map((g) => g.p!));
  }

  // 2. Claims.
  private async matchClaims(pending: Map<string, PendingCeiling>, started: number): Promise<void> {
    const cad = this.cadence();
    const newest = this.newestP();
    const nowMs = this.host.now().getTime();
    let attached = 0;
    for (const w of [...this.windows.values()].sort((a, b) => a.p - b.p)) {
      if (w.status !== "awaiting-claim") continue;
      for (const g of this.state.games) {
        if (g.p !== w.p || g.rootClaim === w.outputRoot) continue;
        if (w.mismatches.some((m) => m.proxy === g.proxy)) continue;
        w.mismatches.push({ txHash: g.txHash, l1BlockNumber: g.l1BlockNumber, rootClaim: g.rootClaim, proxy: g.proxy, gameType: g.gameType, seenAt: new Date(nowMs).toISOString() });
        this.saveWindow(w);
        this.alert({
          type: "output-root-mismatch", p: w.p, computed: w.outputRoot, claimed: g.rootClaim, l1BlockNumber: g.l1BlockNumber, l1TxHash: g.txHash,
          proxy: g.proxy, gameType: g.gameType, ceilings: w.ceilings,
          message: "a dispute game for this summary block claims another output root than the one captured; nothing is settled from it, the ceilings wait for the next summary block",
        });
      }
      // The claim is the game carrying the computed root, whatever P it names: the root commits to P's hash.
      const match = this.state.games.find((g) => g.rootClaim === w.outputRoot);
      if (match) {
        if (attached > 0 && Date.now() - started > this.o.budgetMs) continue;
        attached++;
        try {
          await this.attach(w, match, pending);
        } catch (e) {
          w.attachErrors = (w.attachErrors ?? 0) + 1;
          w.lastError = (e as Error).message.slice(0, 300);
          this.saveWindow(w);
          this.host.event({ type: "output-root-attach-error", p: w.p, l1TxHash: match.txHash, attempts: w.attachErrors, kind: rpcErrorKind(e), error: w.lastError });
          // A claim that will not attach (evidence that never holds together) is not asked about forever.
          if (nowMs - Date.parse(w.capturedAt) > this.o.watchMs) this.endWindow(w, "timeout");
        }
        continue;
      }
      if (newest !== null && newest >= w.p + 2 * cad.spacing) this.endWindow(w, w.mismatches.length > 0 ? "contradicted" : "passed-over");
      else if (nowMs - Date.parse(w.capturedAt) > this.o.watchMs) this.endWindow(w, "timeout");
    }
  }

  private endWindow(w: WindowRecord, reason: "passed-over" | "contradicted" | "timeout"): void {
    w.status = "ended";
    w.ended = { reason, at: this.host.now().toISOString() };
    this.saveWindow(w);
    this.host.event({ type: "output-root-window-ended", p: w.p, reason, ceilings: w.ceilings, mismatches: w.mismatches.length });
  }

  /**
   * One claim, landed and final: a settlement for every ceiling of the window still unsettled. The
   * order of writes is the journal: settlement files on disk (create-only: an earlier valid one
   * stays), then the window record naming them, then each batch's mark. A stop in between is
   * finished at the next start (repairMarks) or by the next claim covering the block.
   */
  private async attach(w: WindowRecord, g: GameSeen, pending: Map<string, PendingCeiling>): Promise<void> {
    const captured = this.readWindow(w.p);
    const now = this.host.now().toISOString();
    const targets = captured.ceilings.filter((c) => pending.has(ckey(c.blockNumber, c.blockHash)));
    const claim = { txHash: g.txHash, l1BlockNumber: g.l1BlockNumber, l1BlockHash: g.l1BlockHash, proxy: g.proxy, gameType: g.gameType, gameIndex: -1, foundAt: now };
    if (targets.length === 0) {
      w.status = "settled";
      w.claim = claim;
      w.settled = [];
      this.saveWindow(w);
      this.host.event({ type: "output-root-claim", p: w.p, l1BlockNumber: g.l1BlockNumber, l1TxHash: g.txHash, settled: 0, note: "every ceiling of this window was already settled or dropped" });
      return;
    }
    try {
      claim.gameIndex = await gameIndexOf(this.o.l1, g.proxy, this.o.factory);
    } catch {
      claim.gameIndex = -1; // informational only
    }
    const all = await attachClaim(
      this.o.l1, { ...captured, ceilings: targets },
      { txHash: g.txHash, blockNumber: g.l1BlockNumber, blockHash: g.l1BlockHash, gameProxy: g.proxy, gameType: g.gameType },
      { gameIndex: claim.gameIndex, ...(this.o.evidence ? { evidence: this.o.evidence } : {}) },
    );
    const done: Array<{ c: PendingCeiling; s: OutputRootSettlement }> = [];
    for (const s of all) {
      const c = pending.get(ckey(s.base.blockNumber, s.base.blockHash));
      if (!c) continue;
      const v = verifyOutputRootSettlement(s);
      if (!v.ok || v.outputRootHex !== w.outputRoot || s.base.blockHash !== c.blockHash) {
        this.alert({ type: "output-root-refused", p: w.p, blockNumber: s.base.blockNumber, reason: v.reason ?? "not this ceiling's block", message: "a settlement built from a matching claim did not verify; nothing was written for this block" });
        continue;
      }
      const path = this.local(settlementKey(c.blockNumber));
      if (existsSync(path)) {
        const kept = this.localSettlement(c.blockNumber, c.blockHash);
        if (!kept) {
          this.alert({ type: "output-root-local-conflict", blockNumber: c.blockNumber, file: settlementKey(c.blockNumber), message: "a settlement file already on disk does not verify for this block; it was left as it is" });
          continue;
        }
        done.push({ c, s: kept });
        continue;
      }
      atomicWrite(path, JSON.stringify(s, null, 2));
      done.push({ c, s });
    }
    w.status = "settled";
    w.claim = claim;
    w.settled = done.map((d) => d.c.blockNumber);
    if (this.o.store) w.storePending = [...new Set([...w.storePending, ...w.settled])];
    this.saveWindow(w);
    for (const { c, s } of done) {
      const mark = this.mark(s);
      for (const b of c.batches) {
        if (b.outputRoot) continue;
        b.outputRoot = mark;
        this.host.saveBatch(b);
      }
      pending.delete(ckey(c.blockNumber, c.blockHash));
    }
    this.host.event({
      type: "output-root-settlement", p: w.p, ceilings: done.map((d) => d.c.blockNumber), records: done.reduce((n, d) => n + d.c.batches.reduce((m, b) => m + b.items.length, 0), 0),
      l1BlockNumber: g.l1BlockNumber, l1TxHash: g.txHash, gameType: g.gameType, gameIndex: claim.gameIndex,
      latencySeconds: done.map((d) => d.s.ethereum.blockTimestamp - d.c.blockTimestamp),
    });
  }

  /** Base, as one capture of P sees it: kept answers first, and no new request once the pass's capture budget is spent. */
  private captureRpc(p: number, started: number): Rpc {
    let memo = this.captureMemo.get(p);
    if (!memo) { memo = new Map(); this.captureMemo.set(p, memo); }
    const kept = memo;
    return async (method, params) => {
      const k = `${method}:${JSON.stringify(params)}`;
      if (kept.has(k)) return kept.get(k);
      if (Date.now() - started > this.o.budgetMs) throw new RpcError("the pass's capture budget is spent; the capture resumes next pass", "transient");
      const r = await this.o.base(method, params);
      kept.set(k, r);
      return r;
    };
  }

  // 3. Windows.
  private async captureDue(pending: Map<string, PendingCeiling>): Promise<void> {
    const cad = this.cadence();
    // Captures get their own budget, so a slow scan never starves them; a capture cut short resumes next pass.
    const started = Date.now();
    for (const p of this.captureMemo.keys()) if (this.state.lastP !== null && p <= this.state.lastP) this.captureMemo.delete(p);
    let head: number | null = null;
    for (let n = 0; n < 64 && pending.size > 0; n++) {
      if (n > 0 && Date.now() - started > this.o.budgetMs) break;
      const nowMs = this.host.now().getTime();
      let minB = Number.POSITIVE_INFINITY;
      for (const c of pending.values()) minB = Math.min(minB, c.blockNumber);
      const p = nextSummaryBlock(cad.anchor, Math.max(minB, (this.state.lastP ?? Number.NEGATIVE_INFINITY) + 1), cad.spacing);
      if (nowMs < this.timeOfMs(p + this.o.marginBlocks)) break;
      const inRange = [...pending.values()].filter((c) => c.blockNumber <= p && p - c.blockNumber <= HISTORY_SERVE_WINDOW);
      if (inRange.length === 0 || this.windows.has(p)) {
        this.state.lastP = p;
        this.saveState();
        continue;
      }
      // Late (after an outage, or the first start): games two summary blocks past P are already read and
      // none is for P, so its claim is outside what the scan read, or was never posted. A window captured
      // now could never be matched; it costs no request and the next P is tried.
      const newest = this.newestP();
      if (newest !== null && newest >= p + 2 * cad.spacing && !this.state.games.some((g) => g.p === p)) {
        this.host.event({ type: "output-root-missed", p, ceilings: inRange.map((c) => c.blockNumber), reason: "no-claim", error: "no game for this summary block among those read, and later ones are" });
        this.state.lastP = p;
        this.saveState();
        continue;
      }
      if (head === null) head = Number(BigInt((await this.o.base("eth_blockNumber", [])) as string));
      if (head < p + this.o.marginBlocks) break;
      let res: CaptureResult;
      try {
        res = await captureWindow(this.captureRpc(p, started), p, inRange.map((c) => ({ blockNumber: c.blockNumber, blockHash: c.blockHash })), { skipBad: true, now: () => this.host.now() });
      } catch (e) {
        const kind = rpcErrorKind(e);
        const error = (e as Error).message.slice(0, 300);
        if (kind === "state" && nowMs - this.timeOfMs(p) >= this.o.minMissAgeMs) {
          // No endpoint holds P's state any more: this window is gone; the next one is asked at once.
          this.captureMemo.delete(p);
          this.host.event({ type: "output-root-missed", p, ceilings: inRange.map((c) => c.blockNumber), reason: "state-gone", error });
          this.state.lastP = p;
          this.saveState();
          continue;
        }
        this.host.event({ type: "output-root-capture-error", p, kind, error, kept: this.captureMemo.get(p)?.size ?? 0 });
        break;
      }
      this.captureMemo.delete(p);
      const { window, skipped } = res;
      for (const s of skipped) this.host.event({ type: "output-root-skip", p, blockNumber: s.blockNumber, blockHash: s.blockHash, reason: s.reason });
      if (window.ceilings.length > 0) {
        // The window file first (it is what the record points to), then the record, then lastP.
        atomicWrite(this.local(windowKey(p)), JSON.stringify({ version: WINDOW_VERSION, ...window }, null, 2));
        this.saveWindow({
          p, status: "awaiting-claim", outputRoot: window.outputRoot, ceilings: window.ceilings.map((c) => c.blockNumber),
          capturedAt: window.capturedAt, stored: !this.o.store, storePending: [], mismatches: [],
        });
        this.host.event({ type: "output-root-window", p, outputRoot: window.outputRoot, ceilings: window.ceilings.map((c) => c.blockNumber), skipped: skipped.length });
      }
      this.state.lastP = p;
      this.saveState();
    }
  }

  // 4. Ceilings no window can reach.
  private dropOutOfWindow(pending: Map<string, PendingCeiling>): void {
    if (this.state.lastP === null) return;
    const cad = this.cadence();
    const nextP = nextSummaryBlock(cad.anchor, this.state.lastP + 1, cad.spacing);
    const waiting = new Set<number>();
    for (const w of this.windows.values()) if (w.status === "awaiting-claim") for (const b of w.ceilings) waiting.add(b);
    for (const [k, c] of pending) {
      if (c.blockNumber + HISTORY_SERVE_WINDOW >= nextP || waiting.has(c.blockNumber)) continue;
      const windows = [...this.windows.values()].filter((w) => w.ceilings.includes(c.blockNumber)).map((w) => w.p).sort((a, b) => a - b);
      const mark: OutputRootMark = { status: "out-of-window", windows, at: this.host.now().toISOString() };
      for (const b of c.batches) {
        b.outputRoot = mark;
        this.host.saveBatch(b);
      }
      pending.delete(k);
      this.host.event({
        type: "output-root-out-of-window", blockNumber: c.blockNumber, batches: c.batches.map((b) => b.id), windows,
        blobSettlement: c.batches.every((b) => !!b.settlement),
        message: "no Base output root can cover this block any more; it keeps its blob settlement",
      });
    }
  }

  // 5. The store.
  private async flushStores(): Promise<void> {
    if (!this.o.store) return;
    let n = 0;
    for (const w of [...this.windows.values()].sort((a, b) => a.p - b.p)) {
      if (w.stored && w.storePending.length === 0) continue;
      if (!w.stored) {
        if (n++ >= MAX_STORES_PER_FLUSH) return;
        if (!(await this.storeOne(windowKey(w.p)))) return;
        w.stored = true;
        this.saveWindow(w);
      }
      for (const b of [...w.storePending]) {
        if (n++ >= MAX_STORES_PER_FLUSH) return;
        if (!(await this.storeOne(settlementKey(b)))) return;
        w.storePending = w.storePending.filter((x) => x !== b);
        this.saveWindow(w);
      }
    }
  }

  /** One create-only write of a local file: true when it is in the store (now or already), false to try again later. */
  private async storeOne(key: string): Promise<boolean> {
    const path = this.local(key);
    if (!existsSync(path)) {
      this.host.event({ type: "output-root-store-error", key, error: "no local copy to store" });
      return true;
    }
    const body = readFileSync(path, "utf8");
    let r: "created" | "exists";
    try {
      r = await this.o.store!.createOnly(key, body);
    } catch (e) {
      this.host.event({ type: "output-root-store-error", key, error: (e as Error).message.slice(0, 200) });
      return false;
    }
    if (r === "created") {
      this.host.event({ type: "output-root-stored", key });
      return true;
    }
    let same: boolean | null = null;
    try {
      if (this.o.store!.read) same = (await this.o.store!.read(key)) === body;
    } catch {
      same = null; // could not compare; the object there stays either way
    }
    if (same === false) this.alert({ type: "output-root-store-differs", key, message: "an object is already stored under this key with other content; it was left as it is (create-only)" });
    else this.host.event({ type: "output-root-store-exists", key, same });
    return true;
  }

  // ── inspection ──

  snapshot(): { trackFrom: number | null; lastP: number | null; l1Cursor: number | null; games: number; cadence: Cadence; windows: WindowRecord[] } {
    return {
      trackFrom: this.state.trackFrom, lastP: this.state.lastP, l1Cursor: this.state.l1Cursor, games: this.state.games.length,
      cadence: this.cadence(), windows: [...this.windows.values()].sort((a, b) => a.p - b.p),
    };
  }
}
