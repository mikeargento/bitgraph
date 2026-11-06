// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * Closing a roll: an epoch ends with a write to Base, made while its enclave is still running.
 *
 * An epoch opens with one write (genesis.ts) and closes with one: the root of every record bound in it. The close
 * is asked for by whoever is about to stop the enclave (the nightly rotation), after it has stopped taking drops:
 * it leaves a request file here, and waits for the result file before it shuts the enclave down. The writer sees
 * the request on its next tick, writes the root, and once that transaction is mined writes the result.
 *
 * Files, all under <stateDir>/close, named by the epoch id in URL-safe base64:
 *   <epoch>.request.json   the ask ({ format, epochId, requestedAt })
 *   <epoch>.json           the result, written once: the root's transaction and block, or `records: 0` for an
 *                          epoch with nothing queued
 *
 * Whoever asks does not wait for ever. A close that is late (Base is slow, the writer is down) is still written
 * when it can be, and says nothing false: it covers the same records, by a later block.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const EPOCH_CLOSE_REQUEST_FORMAT = "bitgraph-epoch-close-request/1";
export const EPOCH_CLOSE_FORMAT = "bitgraph-epoch-close/1";

export interface CloseRequest { format: typeof EPOCH_CLOSE_REQUEST_FORMAT; epochId: string; requestedAt: string }

export interface CloseResult {
  format: typeof EPOCH_CLOSE_FORMAT;
  epochId: string;
  requestedAt: string;
  /** Records under the root; 0 when the epoch had nothing queued, and then the fields below are absent. */
  records: number;
  batch?: string;
  root?: string;
  firstPos?: string;
  lastPos?: string;
  chainId?: number;
  txHash?: string;
  blockNumber?: number;
  blockHash?: string;
  blockTimestamp?: number;
}

const safeName = (b64: string): string => b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export class CloseRequests {
  /** Request files already parsed, by file name. A request is written once and never changed; null marks a bad one. */
  private readonly seen = new Map<string, CloseRequest | null>();

  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  /** Every close asked for here: for which epoch, when (the asker's clock), and whether its result is written. */
  requests(): { epochId: string; requestedAt: string; requestedAtMs: number; done: boolean }[] {
    const names = new Set(readdirSync(this.dir));
    const out: { epochId: string; requestedAt: string; requestedAtMs: number; done: boolean }[] = [];
    for (const name of names) {
      if (!name.endsWith(".request.json")) continue;
      const safe = name.slice(0, -".request.json".length);
      let r = this.seen.get(name);
      if (r === undefined) {
        let read: CloseRequest | null = null;
        try { read = JSON.parse(readFileSync(join(this.dir, name), "utf8")) as CloseRequest; } catch { read = null; }
        r = read && read.format === EPOCH_CLOSE_REQUEST_FORMAT && typeof read.epochId === "string" && safeName(read.epochId) === safe ? read : null;
        this.seen.set(name, r);
      }
      if (!r) continue;
      const requestedAtMs = Date.parse(r.requestedAt);
      if (!Number.isFinite(requestedAtMs)) continue;
      out.push({ epochId: r.epochId, requestedAt: r.requestedAt, requestedAtMs, done: names.has(`${safe}.json`) });
    }
    return out;
  }

  /** Write a request's result. Written once: a result already there is left as it is. */
  finish(result: CloseResult): void {
    const path = join(this.dir, `${safeName(result.epochId)}.json`);
    if (existsSync(path)) return;
    const tmp = `${path}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(result, null, 2) + "\n", { mode: 0o644 });
    renameSync(tmp, path);
  }
}
