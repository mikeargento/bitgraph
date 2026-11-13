// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * The hourly publisher.
 *
 * Every interval (an hour in production, on the hour), one self-addressed transaction goes to Base carrying the root
 * of a tree over the published chain hashes of the BitGraphs made since the last write, the link of the last write,
 * and, on an epoch's first write that has a BitGraph to name it by, the epoch's public key (the bitgraph-hour/1
 * calldata in @mikeargento/bitgraph-audit). It goes out whether or not anything was made.
 *
 * When the write's block is confirmed (a number of blocks deep, and still the block at its height), the publisher keeps
 * its record (bitgraph-hour/1) and a bitgraph-publication/1 block for every BitGraph it covers, then binds a note naming
 * that block as an ordinary BitGraph through the parent: the floor. The floor is after the block (it binds the block's
 * hash), and every later BitGraph of its epoch is after the floor by its count. A floor is attached to a BitGraph only
 * when it can be checked: same epoch, before it, in this write's tree or the one this write links back to, and naming
 * exactly the write before the tree it sits in.
 *
 * Coverage runs count by count (each BitGraph takes two counts). A count not yet in the ledger stops the write there;
 * if it is still not there at the next write, it is recorded as missing and coverage goes on.
 *
 * When the parent opens a new epoch, the old one gets one last write after a short grace, and waits (up to a limit) for
 * the old epoch's closing BitGraph to reach the ledger; its floor lands in the new epoch, and the new epoch's writes
 * continue on the hour. Nothing is written for an epoch that has had its last write.
 *
 * State is one JSON file, written before anything leaves: a signed transaction is saved before it is broadcast, so a
 * restart rebroadcasts the same bytes instead of using a second nonce; a stalled one is replaced at a higher fee, and
 * one whose nonce was used by something else (none of its sends known to the chain, twice) is re-signed with a fresh nonce. Nothing here can stop a BitGraph from
 * being made; the publisher only reads the ledger and asks the parent to bind.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  encodeHourCalldata, hourLink, hourTree, floorNoteText, floorNoteDigestB64, parseFloorNote, publishedChainHash,
  HOUR_RECORD_FORMAT, PUBLICATION_METADATA_KEY,
  type HourRecord, type PublicationBlock, type WriteEvidence,
} from "@mikeargento/bitgraph-audit";
import { epochEndFileText } from "../parent/epoch-end.js";
import type { Chain } from "./base.js";
import type { FloorRecord, Line, Store } from "./ledger.js";

export interface PublisherOptions {
  stateDir: string;
  chain: Chain;
  line: Line;
  store: Store;
  /** Bind one digest through the parent; the proof it returns. */
  bind: (digestB64: string) => Promise<Record<string, unknown>>;
  /** Milliseconds between writes; writes fall on multiples of it (on the hour for 3_600_000). */
  intervalMs: number;
  /** Replace a write still unmined after this many blocks. */
  replaceAfterBlocks: number;
  /** A write's block must be this many blocks deep (and still canonical) before anything is kept from it. */
  confirmations: number;
  /** After a new epoch opens, wait this long before the old epoch's last write. */
  finalGraceMs: number;
  /** ...and up to this long for the old epoch's closing BitGraph to reach the ledger. */
  finalMaxWaitMs: number;
  now: () => number;
  log: (event: Record<string, unknown>) => void;
}

interface FloorState {
  counter: number;
  note: string;
  proof: Record<string, unknown>;
  chainHashB64: string;
  /** Where the floor sits once a write covers it, and whether its note names the write before that tree. */
  tree?: { calldata: string; link: string; leafIndex: number; path: string; ok: boolean };
  /** Whether its record (publication/floors/...) has been kept, so the ledger can name it. */
  indexed?: boolean;
}

interface EpochState {
  lastCovered: number;
  keyPublished: boolean;
  /** The first missing count at the last write sent; if it is still missing at the next, it is recorded as missing. */
  gapSeen?: number;
  floors: FloorState[];
  /** Whether the last BitGraph covered so far is the epoch's closing note: only then can a last write with nothing new close it. */
  lastIsClose?: boolean;
  done?: boolean;
}

interface SentRec { txHash: string; rawTx: string; nonce: number; sentAt: string; sentHead: number }

interface Pending {
  epochId: string;
  calldata: string;
  link: string;
  first: number;
  last: number;
  key: boolean;
  members: Array<{ counter: string; chainHashB64: string }>;
  missing: string[];
  final: boolean;
  lastIsClose: boolean;
  gap: number | null;
  nonce: number;
  sends: SentRec[];
  /** Consecutive checks that found the nonce used and none of the sends known to the chain. */
  lostChecks?: number;
}

interface PendingFloor { link: string; chainId: number; blockNumber: number; blockHash: string; blockTimestamp: number; txHash: string }

export interface PublisherState {
  version: 1;
  lastLink: string | null;
  current: string | null;
  epochs: Record<string, EpochState>;
  pending: Pending | null;
  pendingFloor: PendingFloor | null;
  lastWriteAt: number | null;
  epochChangeSeenAt: number | null;
}

const ZERO = "0".repeat(64);
const hex = (b: Uint8Array): string => "0x" + Buffer.from(b).toString("hex");
/** The digest the epoch's closing BitGraph binds (src/parent/epoch-end.ts). */
const closeDigest = (epochId: string): string => createHash("sha256").update(epochEndFileText(epochId), "utf8").digest("base64");
const digestOf = (p: Record<string, unknown>): string | undefined => (p["artifact"] as { digestB64?: string } | undefined)?.digestB64;

export class Publisher {
  private state: PublisherState;
  private readonly path: string;
  private busy = false;
  /** After a restart, the saved sends go out again once (they may never have left before the stop). */
  private rebroadcast: boolean;

  constructor(private readonly o: PublisherOptions) {
    mkdirSync(o.stateDir, { recursive: true });
    this.path = join(o.stateDir, "publisher.json");
    this.state = existsSync(this.path)
      ? (JSON.parse(readFileSync(this.path, "utf8")) as PublisherState)
      : { version: 1, lastLink: null, current: null, epochs: {}, pending: null, pendingFloor: null, lastWriteAt: null, epochChangeSeenAt: null };
    this.rebroadcast = this.state.pending !== null;
  }

  snapshot(): PublisherState { return JSON.parse(JSON.stringify(this.state)) as PublisherState; }

  private save(): void {
    const tmp = `${this.path}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    renameSync(tmp, this.path);
  }

  private epoch(id: string): EpochState {
    return (this.state.epochs[id] ??= { lastCovered: 0, keyPublished: false, floors: [] });
  }

  /** One step; safe to call often. Returns what it did, for logs and tests. */
  async tick(): Promise<string> {
    if (this.busy) return "busy";
    this.busy = true;
    try {
      await this.indexFloors();
      if (this.state.pending) return await this.progress();
      // A floor still to bind is tried first; if the parent cannot take it, the hour's write still goes out when due
      // (and gives the floor up, see write()).
      const floor = this.state.pendingFloor ? await this.bindFloor() : null;
      const did = await this.maybeWrite();
      return did === "idle" && floor !== null ? floor : did;
    } finally {
      this.busy = false;
    }
  }

  // ── making a write ────────────────────────────────────────────────────────

  private due(now: number): boolean {
    if (this.state.lastWriteAt === null) return true;
    const next = (Math.floor(this.state.lastWriteAt / this.o.intervalMs) + 1) * this.o.intervalMs;
    return now >= next;
  }

  private async maybeWrite(): Promise<string> {
    const now = this.o.now();
    const open = await this.o.line.openEpoch();
    if (this.state.current === null) {
      if (!open) return "no-epoch";
      this.state.current = open;
      this.save();
    }
    const cur = this.state.current;
    if (this.epoch(cur).done) {
      // The current epoch has had its last write: nothing more goes to it. Move on once the open epoch can be read.
      if (!open || open === cur) return "no-epoch";
      this.state.current = open;
      this.state.epochChangeSeenAt = null;
      this.save();
    } else if (open !== null && open !== cur) {
      if (this.state.epochChangeSeenAt === null) { this.state.epochChangeSeenAt = now; this.save(); }
      if (now - this.state.epochChangeSeenAt < this.o.finalGraceMs) return "waiting-for-close";
      return this.write(cur, true, now);
    }
    if (!this.due(now)) return "idle";
    return this.write(this.state.current, false, now);
  }

  private async write(epochId: string, final: boolean, now: number): Promise<string> {
    const es = this.epoch(epochId);
    const found = await this.o.line.proofs(epochId, es.lastCovered);
    const members: Array<{ counter: number; proof: Record<string, unknown> }> = [];
    const missing: number[] = [];
    let expect = es.lastCovered + 2; // an epoch's first BitGraph is count 2 (its nonce takes count 1)
    let gap: number | null = null;
    for (const p of found) {
      if (p.counter !== expect) {
        // Counts from expect up to this one are not in the ledger (yet). At an epoch's last write, or when the same
        // gap was already there at the last write sent, record them as missing and go on; otherwise stop and wait.
        if (final || es.gapSeen === expect) {
          for (let c = expect; c < p.counter; c += 2) missing.push(c);
        } else {
          gap = expect;
          break;
        }
      }
      members.push(p);
      expect = p.counter + 2;
    }
    // The closing note's text depends only on the epoch id, so anyone could bind the same digest earlier: a close counts
    // only as the epoch's last BitGraph.
    const close = closeDigest(epochId);
    const lastIsClose = members.length > 0 ? digestOf(members.at(-1)!.proof) === close : !!es.lastIsClose;
    if (final && !lastIsClose) {
      // The old epoch's closing BitGraph is not in the ledger yet: wait for it, up to a limit (an epoch that crashed has
      // none), and never past a scheduled write.
      const waited = now - (this.state.epochChangeSeenAt ?? now);
      if (waited < this.o.finalMaxWaitMs && !this.due(now)) return "waiting-for-close";
      this.o.log({ type: "close-missing", epochId, waitedMs: waited });
    }

    if (this.state.pendingFloor) {
      // The last write's floor never got bound (the parent was down): its place in the order is lost, say so and go on.
      this.o.log({ type: "floor-skipped", link: this.state.pendingFloor.link });
      this.state.pendingFloor = null;
    }
    const chainHashes = members.map((m) => publishedChainHash(m.proof));
    const tree = hourTree(chainHashes);
    const keyB64 = !es.keyPublished ? (members.find((m) => typeof (m.proof["signer"] as { publicKeyB64?: unknown } | undefined)?.publicKeyB64 === "string")?.proof["signer"] as { publicKeyB64: string } | undefined)?.publicKeyB64 : undefined;
    const first = members[0]?.counter ?? es.lastCovered;
    const last = members.at(-1)?.counter ?? es.lastCovered;
    const calldata = encodeHourCalldata({
      epochId, first, last, leaves: members.length, rootHex: tree.rootHex, prevLinkHex: this.state.lastLink ?? ZERO,
      ...(keyB64 ? { epochPublicKeyB64: keyB64 } : {}),
    });
    const nonce = await this.o.chain.nextNonce();
    const signed = await this.o.chain.sign(calldata, nonce, 0);
    const head = await this.o.chain.head();
    // Saved together, before anything leaves: the signed transaction and the gap it saw.
    this.state.pending = {
      epochId, calldata: hex(calldata), link: hourLink(calldata), first, last, key: !!keyB64,
      members: members.map((m, i) => ({ counter: String(m.counter), chainHashB64: chainHashes[i]! })),
      missing: missing.map(String), final, lastIsClose, gap, nonce,
      sends: [{ txHash: signed.txHash, rawTx: signed.rawTx, nonce, sentAt: new Date(now).toISOString(), sentHead: head }],
    };
    es.gapSeen = gap ?? undefined;
    this.state.lastWriteAt = now;
    this.save();
    await this.broadcast(signed.rawTx);
    this.o.log({ type: "write-sent", epochId, first, last, leaves: members.length, missing: missing.length, final, key: !!keyB64, nonce, txHash: signed.txHash });
    return final ? "final-sent" : "sent";
  }

  private async broadcast(rawTx: string): Promise<void> {
    try {
      await this.o.chain.broadcast(rawTx);
    } catch (e) {
      const msg = (e as Error).message;
      // "already known" is a rebroadcast; anything else is worth seeing, "nonce too low" included.
      if (!/known|already/i.test(msg)) this.o.log({ type: "broadcast-error", error: msg.slice(0, 300) });
    }
  }

  // ── a write in flight ─────────────────────────────────────────────────────

  private async progress(): Promise<string> {
    const p = this.state.pending!;
    if (this.rebroadcast) {
      this.rebroadcast = false;
      for (const s of p.sends) await this.broadcast(s.rawTx);
    }
    for (const s of p.sends) {
      const ev = await this.o.chain.evidence(s.txHash);
      if (!ev) continue;
      const head = await this.o.chain.head();
      if (head - ev.blockNumber < this.o.confirmations) return "confirming";
      const canonical = await this.o.chain.blockHashAt(ev.blockNumber);
      if (canonical !== ev.blockHash) {
        // The block it was in is no longer the block at that height: not mined after all, keep waiting.
        this.o.log({ type: "write-reorged", txHash: s.txHash, blockNumber: ev.blockNumber });
        continue;
      }
      await this.finish(p, ev);
      if (this.state.pendingFloor) await this.bindFloor();
      return "published";
    }
    const head = await this.o.chain.head();
    const lastSend = p.sends[p.sends.length - 1]!;
    if (head >= lastSend.sentHead + this.o.replaceAfterBlocks) {
      const calldata = new Uint8Array(Buffer.from(p.calldata.slice(2), "hex"));
      const confirmed = await this.o.chain.confirmedNonce();
      // The nonce counts as lost only if none of our sends is known to the chain (a send mined but slow to show its
      // receipt also moves the nonce), and only after two checks a replacement interval apart.
      let lost = false;
      if (confirmed > p.nonce) {
        const statuses = await Promise.all(p.sends.map((s) => this.o.chain.txStatus(s.txHash)));
        if (statuses.every((x) => x === "unknown")) {
          p.lostChecks = (p.lostChecks ?? 0) + 1;
          lost = p.lostChecks >= 2;
        } else {
          p.lostChecks = 0;
          this.o.log({ type: "waiting-for-receipt", epochId: p.epochId, nonce: p.nonce, statuses });
        }
      }
      if (confirmed > p.nonce && !lost) {
        lastSend.sentHead = head; // wait another interval before looking again
        this.save();
        return "pending";
      }
      if (lost) {
        // The nonce was used by a transaction that is none of ours (a manual send from the key, a restored state file):
        // none of these sends can ever be mined. Sign again with a fresh nonce.
        const fresh = await this.o.chain.nextNonce();
        const signed = await this.o.chain.sign(calldata, fresh, 0);
        this.o.log({ type: "nonce-lost", epochId: p.epochId, nonce: p.nonce, fresh });
        p.nonce = fresh;
        p.lostChecks = 0;
        p.sends.push({ txHash: signed.txHash, rawTx: signed.rawTx, nonce: fresh, sentAt: new Date(this.o.now()).toISOString(), sentHead: head });
        this.save();
        await this.broadcast(signed.rawTx);
        return "resigned";
      }
      const bump = p.sends.filter((s) => s.nonce === p.nonce).length;
      const signed = await this.o.chain.sign(calldata, p.nonce, bump);
      p.sends.push({ txHash: signed.txHash, rawTx: signed.rawTx, nonce: p.nonce, sentAt: new Date(this.o.now()).toISOString(), sentHead: head });
      this.save();
      await this.broadcast(signed.rawTx);
      this.o.log({ type: "write-replaced", epochId: p.epochId, nonce: p.nonce, attempt: p.sends.length });
      return "replaced";
    }
    return "pending";
  }

  private async finish(p: Pending, ev: WriteEvidence): Promise<void> {
    const es = this.epoch(p.epochId);
    const prevLink = this.state.lastLink ?? ZERO;
    const record: HourRecord = {
      format: HOUR_RECORD_FORMAT, calldata: p.calldata, link: p.link, write: ev, members: p.members, missing: p.missing,
      writtenAt: new Date(this.o.now()).toISOString(),
    };
    await this.o.store.putHour(p.epochId, record);

    // Floors this write covers now know their place, and whether a reader can check them there: the note must name the
    // write right before this one.
    const tree = hourTree(p.members.map((m) => m.chainHashB64));
    for (const f of es.floors) {
      if (f.tree) continue;
      const i = p.members.findIndex((m) => Number(m.counter) === f.counter);
      if (i < 0) continue;
      const ok = parseFloorNote(f.note)?.writeLinkHex === prevLink;
      if (!ok) this.o.log({ type: "floor-unusable", epochId: p.epochId, counter: f.counter, reason: "its note names a write other than the one before its tree" });
      f.tree = { calldata: p.calldata, link: p.link, leafIndex: i, path: tree.paths[i]!, ok };
    }
    // Each BitGraph's block: its path, this write, and its floor (the latest checkable floor before it whose tree is
    // this write or the one this write links back to).
    for (let i = 0; i < p.members.length; i++) {
      const m = p.members[i]!;
      const c = Number(m.counter);
      const f = [...es.floors].reverse().find((x) => x.counter < c && x.tree?.ok && (x.tree.link === p.link || x.tree.link === prevLink));
      const block: PublicationBlock = {
        format: PUBLICATION_METADATA_KEY, epochId: p.epochId, counter: m.counter, chainHashB64: m.chainHashB64,
        leafIndex: i, path: tree.paths[i]!, calldata: p.calldata, write: ev,
        floor: f && f.tree ? { proof: f.proof, note: f.note, hourCalldata: f.tree.calldata, leafIndex: f.tree.leafIndex, path: f.tree.path } : null,
      };
      await this.o.store.putBlock(p.epochId, c, block);
    }

    if (p.members.length > 0) es.lastCovered = p.last;
    if (p.key) es.keyPublished = true;
    if (p.members.length > 0) es.lastIsClose = p.lastIsClose;
    if (p.final) es.done = true;
    es.floors = es.floors.slice(-3);
    this.state.lastLink = p.link;
    this.state.pending = null;
    this.state.pendingFloor = { link: p.link, chainId: ev.chainId, blockNumber: ev.blockNumber, blockHash: ev.blockHash, blockTimestamp: ev.blockTimestamp, txHash: ev.txHash };
    if (p.final) {
      const open = await this.o.line.openEpoch();
      if (open && open !== p.epochId) { this.state.current = open; this.state.epochChangeSeenAt = null; }
    }
    this.save();
    this.o.log({ type: "write-published", epochId: p.epochId, first: p.first, last: p.last, leaves: p.members.length, blockNumber: ev.blockNumber, blockHash: ev.blockHash, txHash: ev.txHash, final: p.final });
  }

  // ── the floor ─────────────────────────────────────────────────────────────

  /** Keep a record of every floor not yet recorded: the ledger lists them by it, and a floor's page links its write. */
  private async indexFloors(): Promise<void> {
    let changed = false;
    for (const [epochId, es] of Object.entries(this.state.epochs)) {
      for (const f of es.floors) {
        if (f.indexed) continue;
        const n = parseFloorNote(f.note);
        if (!n) { f.indexed = true; changed = true; continue; }
        const record: FloorRecord = {
          format: "bitgraph-hour-floor/1", epochId, counter: String(f.counter), digestB64: floorNoteDigestB64(f.note), note: f.note,
          write: { chainId: n.chainId, blockNumber: n.blockNumber, blockHash: n.blockHash, blockTimestamp: n.blockTimestamp, txHash: n.txHash, link: n.writeLinkHex },
        };
        try {
          await this.o.store.putFloor(epochId, f.counter, record);
          f.indexed = true;
          changed = true;
        } catch (e) {
          this.o.log({ type: "floor-index-error", epochId, counter: f.counter, error: (e as Error).message.slice(0, 300) });
        }
      }
    }
    if (changed) this.save();
  }

  private async bindFloor(): Promise<string> {
    const pf = this.state.pendingFloor!;
    const note = floorNoteText({ chainId: pf.chainId, blockNumber: pf.blockNumber, blockHash: pf.blockHash, blockTimestamp: pf.blockTimestamp, txHash: pf.txHash, writeLinkHex: pf.link });
    let proof: Record<string, unknown>;
    try {
      proof = await this.o.bind(floorNoteDigestB64(note));
    } catch (e) {
      this.o.log({ type: "floor-bind-error", link: pf.link, error: (e as Error).message.slice(0, 300) });
      return "floor-retry";
    }
    const commit = proof["commit"] as { epochId?: string; counter?: string } | undefined;
    const epochId = commit?.epochId;
    const counter = Number(commit?.counter);
    if (!epochId || !Number.isSafeInteger(counter)) {
      this.o.log({ type: "floor-bind-error", link: pf.link, error: "the parent returned a proof with no epoch or count" });
      return "floor-retry";
    }
    const es = this.epoch(epochId);
    es.floors.push({ counter, note, proof, chainHashB64: publishedChainHash(proof) });
    es.floors = es.floors.slice(-3);
    this.state.pendingFloor = null;
    this.save();
    this.o.log({ type: "floor-bound", epochId, counter, blockNumber: pf.blockNumber, link: pf.link });
    await this.indexFloors();
    return "floor";
  }
}
