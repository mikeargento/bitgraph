// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * The timeline poller: one per chain (Base, Ethereum). It reads every block of its chain from two cross-checked
 * providers (chain-sources.ts) and binds each as a plain BitGraph of its bitgraph-block-read/1 file, straight to
 * the enclave through the parent's own client, never through /api/commit, so no floor leaf or base-floor.json is
 * ever added in front of it. Nothing here writes to any chain.
 *
 * No block is skipped. The poller keeps a cursor (the last block it bound) on disk, and each pass binds every block
 * from the cursor up to the head, in order. After an outage, a restart or a slow enclave it catches up the same way;
 * those reads lag their blocks and the verifier flags them, which is the point: they are still true floors.
 *
 * Reorgs: a block whose parent is not the cursor's block means the chain replaced blocks the poller already bound.
 * The poller walks back through the hashes it bound recently until the provider's chain agrees, and reads forward
 * from there, so the replacement blocks are bound too. The replaced reads stay in the record; the verifier passes
 * over any block that is not on the canonical chain.
 *
 * Each record is in the journal (timeline-journal.ts, fsynced) before the cursor moves. A crash between the two
 * re-reads that block on restart, which is harmless; a bind whose record was lost shows as a counter gap, as any
 * lost proof does.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { blockReadFileText, blockReadDigestB64 } from "@mikeargento/bitgraph-verify";
import type { BitGraphProof } from "bitgraph";
import type { BlockSource, ChainHead, TimelineChain } from "./chain-sources.js";
import type { TimelineLine } from "./timeline-journal.js";

/** Binds one digest in the enclave and returns its proof. */
export type DigestBinder = (digestB64: string) => Promise<BitGraphProof>;

interface Cursor {
  number: number;
  hash: string;
  /** The blocks bound most recently, oldest first, for walking back on a reorg. */
  recent: { number: number; hash: string }[];
}

export interface PollerStatus {
  chain: TimelineChain;
  last: { number: number; hash: string; timestamp: number; counter: string; boundAtMs: number } | null;
  /** The newest head the providers agreed on. */
  head: number | null;
  /** Blocks between the cursor and that head, still to read. */
  behind: number | null;
  reads: number;
  reorgs: number;
  lastError: string | null;
}

export interface PollerOptions {
  source: BlockSource;
  bind: DigestBinder;
  journal: { append(line: TimelineLine): void };
  stateDir: string;
  /** The open epoch's id, or null while the enclave is not open for binds. */
  epochId: () => string | null;
  /** Between passes when caught up (Base 1000, Ethereum 3000). */
  pollMs: number;
  /** At most this many blocks per pass, so a long catch-up yields between passes. */
  maxPerPass?: number;
  /** How many bound hashes to remember for reorgs. */
  keepRecent?: number;
  now?: () => number;
  log?: (msg: string) => void;
}

export class ChainPoller {
  readonly chain: TimelineChain;
  private cursor: Cursor | null;
  private readonly path: string;
  private ready = false;
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  readonly state: PollerStatus;

  constructor(private readonly o: PollerOptions) {
    this.chain = o.source.chain;
    mkdirSync(o.stateDir, { recursive: true });
    this.path = join(o.stateDir, `cursor-${this.chain}.json`);
    this.cursor = existsSync(this.path) ? (JSON.parse(readFileSync(this.path, "utf8")) as Cursor) : null;
    this.state = { chain: this.chain, last: null, head: null, behind: null, reads: 0, reorgs: 0, lastError: null };
  }

  /** One pass: bind every block from the cursor to the head, in order (up to maxPerPass). True when caught up. */
  async pass(): Promise<boolean> {
    const epochId = this.o.epochId();
    if (epochId === null) return true;
    if (!this.ready) {
      await this.o.source.ready();
      this.ready = true;
    }
    const head = await this.o.source.latest();
    this.state.head = head.number;

    if (this.cursor === null) {
      // First start: the timeline begins at the head; there is nothing earlier to catch up.
      await this.bindRead(head, epochId);
      this.state.behind = 0;
      return true;
    }
    if (head.number === this.cursor.number && head.hash !== this.cursor.hash) {
      await this.rewind();
      return false;
    }

    const max = this.o.maxPerPass ?? 500;
    let done = 0;
    while (this.cursor.number < head.number && done < max) {
      const n = this.cursor.number + 1;
      const b = n === head.number ? head : await this.o.source.at(n);
      if (b.parentHash !== this.cursor.hash) {
        await this.rewind();
        return false;
      }
      await this.bindRead(b, epochId);
      done++;
    }
    this.state.behind = head.number - this.cursor.number;
    return this.state.behind === 0;
  }

  private async bindRead(b: ChainHead, epochId: string): Promise<void> {
    const text = blockReadFileText({ epochId, chain: b.chain, chainId: b.chainId, number: b.number, hash: b.hash, timestamp: b.timestamp });
    const proof = await this.o.bind(blockReadDigestB64(text));
    this.o.journal.append({ kind: "block", proof, blockFile: text });
    const keep = this.o.keepRecent ?? 256;
    const recent = [...(this.cursor?.recent ?? []), { number: b.number, hash: b.hash }].slice(-keep);
    this.cursor = { number: b.number, hash: b.hash, recent };
    this.save();
    this.state.reads++;
    this.state.last = { number: b.number, hash: b.hash, timestamp: b.timestamp, counter: String(proof.commit?.counter ?? ""), boundAtMs: (this.o.now ?? Date.now)() };
  }

  /** Walk back to the newest bound block the chain still has, and continue from there. */
  private async rewind(): Promise<void> {
    const c = this.cursor!;
    for (let i = c.recent.length - 1; i >= 0; i--) {
      const r = c.recent[i]!;
      const now = await this.o.source.at(r.number);
      if (now.hash === r.hash) {
        const dropped = c.number - r.number;
        this.cursor = { number: r.number, hash: r.hash, recent: c.recent.slice(0, i + 1) };
        this.save();
        this.state.reorgs++;
        this.o.log?.(`[timeline] ${this.chain}: reorg, ${dropped} bound block(s) replaced after ${r.number}; reading the replacements`);
        return;
      }
    }
    // Deeper than the hashes kept: start again from the block before the oldest one remembered.
    const oldest = c.recent[0]?.number ?? c.number;
    const base = await this.o.source.at(oldest - 1);
    this.cursor = { number: base.number, hash: base.hash, recent: [{ number: base.number, hash: base.hash }] };
    this.save();
    this.state.reorgs++;
    this.o.log?.(`[timeline] ${this.chain}: reorg deeper than ${c.recent.length} remembered blocks; reading again from ${oldest}`);
  }

  private save(): void {
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.cursor), { mode: 0o600 });
    renameSync(tmp, this.path);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = async () => {
      let caughtUp = true;
      try {
        caughtUp = await this.pass();
        this.state.lastError = null;
      } catch (e) {
        this.state.lastError = e instanceof Error ? e.message : String(e);
      }
      if (!this.running) return;
      this.timer = setTimeout(loop, caughtUp || this.state.lastError ? this.o.pollMs : 0);
      this.timer.unref?.();
    };
    void loop();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
}
