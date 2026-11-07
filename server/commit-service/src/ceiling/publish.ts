// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * The publish transaction: an epoch ends with a write to Base that fixes where its line stopped.
 *
 * When the nightly rotation stops the parent, the parent binds the epoch's closing BitGraph (parent/epoch-end.ts) and
 * drops a request here carrying that BitGraph's chain hash: the hash the next record's prevB64 would carry, which
 * commits to the closing BitGraph and, through each prevB64 before it, to every record of the epoch. This module, run
 * from the writer's tick, sends one self-addressed transaction carrying "BGP1", the epoch id and that hash (68 bytes),
 * waits for it to be mined, and writes the result file. From then on nothing can be added to the epoch and still sit
 * before the publish: every record of the epoch existed by the publish block.
 *
 * Files, all under <stateDir>/publish, named by the epoch id in URL-safe base64:
 *   <epoch>.request.json   the parent's ask ({ format, epochId, closingChainHashB64, closingCounter, requestedAt })
 *   <epoch>.sent.json      the writer's record of the transaction(s) it signed, persisted before they leave
 *   <epoch>.json           the result, bitgraph-epoch-publish/1, written once the transaction is mined
 *
 * The write is the same size at the same time each day, whatever the epoch held: nothing about volume reaches Base.
 * One publish is in flight at a time, never alongside a genesis or a ceiling batch, so the writer's nonce sequence
 * stays single-file. A stalled transaction is replaced at a higher fee after replaceAfterBlocks.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Chain, SentTx } from "./writer.js";

export const EPOCH_PUBLISH_REQUEST_FORMAT = "bitgraph-epoch-publish-request/1";
export const EPOCH_PUBLISH_FORMAT = "bitgraph-epoch-publish/1";
/** "BGP1": BitGraph epoch publish, version 1. */
export const EPOCH_PUBLISH_MAGIC = new Uint8Array([0x42, 0x47, 0x50, 0x31]);

export interface PublishRequest {
  format: typeof EPOCH_PUBLISH_REQUEST_FORMAT;
  epochId: string;
  closingChainHashB64: string;
  closingCounter: string;
  requestedAt: string;
}

export interface PublishResult {
  format: typeof EPOCH_PUBLISH_FORMAT;
  epochId: string;
  closingChainHashB64: string;
  closingCounter: string;
  chain: "base";
  chainId: number;
  writer: string;
  txHash: string;
  blockNumber: number;
  blockHash: string;
  blockTimestamp: number;
  calldata: string;
  note: string;
}

interface SentRecord { epochId: string; nonce: number; sends: SentTx[] }

export interface PublishWriterOptions {
  dir: string;
  chain: Chain;
  chainId: 8453 | 84532;
  replaceAfterBlocks: number;
  now: () => Date;
  log: (event: Record<string, unknown>) => void;
}

const safeName = (b64: string): string => b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function b64To32(b64: string, what: string): Uint8Array {
  const bytes = new Uint8Array(Buffer.from(b64.replace(/-/g, "+").replace(/_/g, "/"), "base64"));
  if (bytes.length !== 32) throw new TypeError(`${what} is not 32 bytes`);
  return bytes;
}

/** The 68 bytes the publish transaction carries: "BGP1", the epoch id, the closing BitGraph's chain hash. */
export function epochPublishCalldata(epochId: string, closingChainHashB64: string): Uint8Array {
  const out = new Uint8Array(68);
  out.set(EPOCH_PUBLISH_MAGIC, 0);
  out.set(b64To32(epochId, "the epoch id"), 4);
  out.set(b64To32(closingChainHashB64, "the closing chain hash"), 36);
  return out;
}

const hex = (b: Uint8Array): string => "0x" + Buffer.from(b).toString("hex");

function atomicWrite(path: string, data: string): void {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, data, { mode: 0o644 });
  renameSync(tmp, path);
}

function readJson<T>(path: string): T | null {
  try { return JSON.parse(readFileSync(path, "utf8")) as T; } catch { return null; }
}

export class PublishWriter {
  constructor(private readonly o: PublishWriterOptions) {
    mkdirSync(o.dir, { recursive: true });
  }

  /** Requests with no result yet, oldest first. */
  private pending(): PublishRequest[] {
    const out: PublishRequest[] = [];
    for (const name of readdirSync(this.o.dir)) {
      if (!name.endsWith(".request.json")) continue;
      const safe = name.slice(0, -".request.json".length);
      if (existsSync(join(this.o.dir, `${safe}.json`))) continue;
      const r = readJson<PublishRequest>(join(this.o.dir, name));
      if (!r || r.format !== EPOCH_PUBLISH_REQUEST_FORMAT || typeof r.epochId !== "string" || safeName(r.epochId) !== safe
        || typeof r.closingChainHashB64 !== "string" || typeof r.closingCounter !== "string") continue;
      out.push(r);
    }
    out.sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
    return out;
  }

  /** Whether a publish is waiting to be sent or mined. */
  hasPending(): boolean { return this.pending().length > 0; }

  /**
   * One step. Returns true while a publish transaction is in flight (sent, not yet mined), so the caller holds its own
   * sends. `canSend` is false while the caller has a transaction of its own in flight.
   */
  async pass(canSend: boolean): Promise<boolean> {
    const reqs = this.pending();
    if (reqs.length === 0) return false;
    const req = reqs[0]!;
    const safe = safeName(req.epochId);
    const sentPath = join(this.o.dir, `${safe}.sent.json`);
    const sent = readJson<SentRecord>(sentPath);
    let data: Uint8Array;
    try { data = epochPublishCalldata(req.epochId, req.closingChainHashB64); } catch (e) {
      this.o.log({ type: "publish-error", epochId: req.epochId, error: (e as Error).message });
      // A bad request never completes; move it aside so it stops being first in line.
      renameSync(join(this.o.dir, `${safe}.request.json`), join(this.o.dir, `${safe}.request.bad`));
      return false;
    }
    if (!sent) {
      if (!canSend) return false;
      const nonce = await this.o.chain.nextNonce();
      const signed = await this.o.chain.sign(data, nonce, 0);
      const head = await this.o.chain.head();
      const rec: SentRecord = { epochId: req.epochId, nonce, sends: [{ ...signed, sentAt: this.o.now().toISOString(), sentHead: head }] };
      atomicWrite(sentPath, JSON.stringify(rec, null, 2));
      await this.broadcast(rec, signed.rawTx);
      this.o.log({ type: "publish-send", epochId: req.epochId, nonce, txHash: signed.txHash });
      return true;
    }
    for (const s of sent.sends) {
      const inc = await this.o.chain.inclusion(s.txHash);
      if (!inc) continue;
      const result: PublishResult = {
        format: EPOCH_PUBLISH_FORMAT,
        epochId: req.epochId,
        closingChainHashB64: req.closingChainHashB64,
        closingCounter: req.closingCounter,
        chain: "base",
        chainId: this.o.chainId,
        writer: this.o.chain.writer,
        txHash: s.txHash,
        blockNumber: inc.blockNumber,
        blockHash: inc.blockHash,
        blockTimestamp: inc.blockTimestamp,
        calldata: hex(data),
        note: "Every BitGraph of this epoch existed by this block: the closing BitGraph's chain hash commits to each record before it.",
      };
      atomicWrite(join(this.o.dir, `${safe}.json`), JSON.stringify(result, null, 2) + "\n");
      this.o.log({ type: "publish-write", epochId: req.epochId, txHash: s.txHash, blockNumber: inc.blockNumber, blockTimestamp: inc.blockTimestamp, attempts: sent.sends.length, fees: inc.fees });
      return false;
    }
    const head = await this.o.chain.head();
    const last = sent.sends[sent.sends.length - 1]!;
    if (head >= last.sentHead + this.o.replaceAfterBlocks) {
      const signed = await this.o.chain.sign(data, sent.nonce, sent.sends.length);
      const s: SentTx = { ...signed, sentAt: this.o.now().toISOString(), sentHead: head };
      sent.sends.push(s);
      atomicWrite(sentPath, JSON.stringify(sent, null, 2));
      this.o.log({ type: "publish-replace", epochId: sent.epochId, nonce: sent.nonce, attempt: sent.sends.length });
      await this.broadcast(sent, s.rawTx);
    }
    return true;
  }

  private async broadcast(rec: SentRecord, rawTx: string): Promise<void> {
    try {
      await this.o.chain.broadcast(rawTx);
    } catch (e) {
      const msg = (e as Error).message;
      if (!/known|already|nonce too low/i.test(msg)) this.o.log({ type: "publish-broadcast-error", epochId: rec.epochId, error: msg.slice(0, 300) });
    }
  }
}
