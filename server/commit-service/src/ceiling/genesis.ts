// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * The genesis transaction: an epoch opens with a write to Base (bitgraph-epoch-genesis/1, packages/verify).
 *
 * The parent cannot send it, because the parent never holds the Base key; the ceiling writer does. So the parent
 * drops a request file in the genesis directory when a fresh epoch reports counter 0, and this module, run from the
 * writer's tick, sends one self-addressed transaction carrying "BGE1" and the epoch id, waits for it to be mined,
 * and writes the result file. The parent polls for that file and binds its SHA-256 as the epoch's first BitGraph.
 *
 * Files, all under <stateDir>/genesis, named by the epoch id in URL-safe base64:
 *   <epoch>.request.json   the parent's ask ({ format, epochId, requestedAt })
 *   <epoch>.sent.json      the writer's record of the transaction(s) it signed, persisted before they leave
 *   <epoch>.json           the result, bitgraph-epoch-genesis/1, written once the transaction is mined
 *
 * One genesis is in flight at a time, and only when no ceiling batch is in flight, so the writer's nonce
 * sequence stays single-file. A stalled transaction is replaced at a higher fee after replaceAfterBlocks, as
 * batches are. Between sends the writer only watches for inclusion; it does not rebroadcast the same bytes.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EPOCH_GENESIS_REQUEST_FORMAT, epochGenesisCalldata, epochGenesisFileText } from "@mikeargento/bitgraph-verify";
import type { Chain, SentTx } from "./writer.js";

export interface GenesisRequest { format: typeof EPOCH_GENESIS_REQUEST_FORMAT; epochId: string; requestedAt: string }

interface SentRecord { epochId: string; nonce: number; sends: SentTx[] }

export interface GenesisWriterOptions {
  dir: string;
  chain: Chain;
  chainId: 8453 | 84532;
  replaceAfterBlocks: number;
  now: () => Date;
  log: (event: Record<string, unknown>) => void;
}

const safeName = (b64: string): string => b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function atomicWrite(path: string, data: string): void {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, data, { mode: 0o600 });
  renameSync(tmp, path);
}

function readJson<T>(path: string): T | null {
  try { return JSON.parse(readFileSync(path, "utf8")) as T; } catch { return null; }
}

export class GenesisWriter {
  constructor(private readonly o: GenesisWriterOptions) {
    mkdirSync(o.dir, { recursive: true });
  }

  /** Requests with no result yet, oldest first. */
  private pending(): GenesisRequest[] {
    const out: GenesisRequest[] = [];
    for (const name of readdirSync(this.o.dir)) {
      if (!name.endsWith(".request.json")) continue;
      const safe = name.slice(0, -".request.json".length);
      if (existsSync(join(this.o.dir, `${safe}.json`))) continue;
      const r = readJson<GenesisRequest>(join(this.o.dir, name));
      if (!r || r.format !== EPOCH_GENESIS_REQUEST_FORMAT || typeof r.epochId !== "string" || safeName(r.epochId) !== safe) continue;
      out.push(r);
    }
    out.sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
    return out;
  }

  /**
   * One step. Returns true while a genesis transaction is in flight (sent, not yet mined), so the caller holds
   * its own sends. `canSend` is false while the caller has a transaction of its own in flight.
   */
  async pass(canSend: boolean): Promise<boolean> {
    const reqs = this.pending();
    if (reqs.length === 0) return false;
    const req = reqs[0]!;
    const safe = safeName(req.epochId);
    const sentPath = join(this.o.dir, `${safe}.sent.json`);
    const sent = readJson<SentRecord>(sentPath);
    if (!sent) {
      if (!canSend) return false;
      let data: Uint8Array;
      try { data = epochGenesisCalldata(req.epochId); } catch (e) {
        this.o.log({ type: "genesis-error", epochId: req.epochId, error: (e as Error).message });
        // A bad request never completes; move it aside so it stops being first in line.
        renameSync(join(this.o.dir, `${safe}.request.json`), join(this.o.dir, `${safe}.request.bad`));
        return false;
      }
      const nonce = await this.o.chain.nextNonce();
      const signed = await this.o.chain.sign(data, nonce, 0);
      const head = await this.o.chain.head();
      const rec: SentRecord = { epochId: req.epochId, nonce, sends: [{ ...signed, sentAt: this.o.now().toISOString(), sentHead: head }] };
      atomicWrite(sentPath, JSON.stringify(rec, null, 2));
      await this.broadcast(rec, signed.rawTx);
      this.o.log({ type: "genesis-send", epochId: req.epochId, nonce, txHash: signed.txHash });
      return true;
    }
    for (const s of sent.sends) {
      const inc = await this.o.chain.inclusion(s.txHash);
      if (!inc) continue;
      const text = epochGenesisFileText({
        epochId: sent.epochId, chainId: this.o.chainId, writer: this.o.chain.writer, txHash: s.txHash,
        blockNumber: inc.blockNumber, blockHash: inc.blockHash, blockTimestamp: inc.blockTimestamp,
      });
      atomicWrite(join(this.o.dir, `${safe}.json`), text);
      this.o.log({ type: "genesis-write", epochId: sent.epochId, txHash: s.txHash, blockNumber: inc.blockNumber, blockTimestamp: inc.blockTimestamp, attempts: sent.sends.length, fees: inc.fees });
      return false;
    }
    const head = await this.o.chain.head();
    const last = sent.sends[sent.sends.length - 1]!;
    if (head >= last.sentHead + this.o.replaceAfterBlocks) {
      const signed = await this.o.chain.sign(epochGenesisCalldata(sent.epochId), sent.nonce, sent.sends.length);
      const s: SentTx = { ...signed, sentAt: this.o.now().toISOString(), sentHead: head };
      sent.sends.push(s);
      atomicWrite(sentPath, JSON.stringify(sent, null, 2));
      this.o.log({ type: "genesis-replace", epochId: sent.epochId, nonce: sent.nonce, attempt: sent.sends.length });
      await this.broadcast(sent, s.rawTx);
    }
    return true;
  }

  private async broadcast(rec: SentRecord, rawTx: string): Promise<void> {
    try {
      await this.o.chain.broadcast(rawTx);
    } catch (e) {
      const msg = (e as Error).message;
      if (!/known|already|nonce too low/i.test(msg)) this.o.log({ type: "genesis-broadcast-error", epochId: rec.epochId, error: msg.slice(0, 300) });
    }
  }
}
