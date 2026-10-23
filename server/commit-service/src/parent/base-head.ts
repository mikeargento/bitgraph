// Copyright (c) 2024-2026 Argento Computing Inc. All rights reserved.

/**
 * The newest Base block header, held in memory for the Base floor (enclave
 * v10, 2026-10-06). Every allocation hands the enclave this header; the
 * enclave hashes it and fixes that block as the slot's floor. Nothing here is
 * written anywhere: it is a reading of the chain, refreshed every second.
 *
 * The header is rebuilt from the RPC's JSON and kept only when its keccak-256
 * reproduces the block hash the node reported, the same self-check the Base
 * ceiling writer uses (src/ceiling/block.ts), so a field this encoder does not
 * know about is a loud refusal, never a wrong floor. Self-contained because
 * the parent is built from src/parent alone.
 *
 * Env:
 *   BASE_FLOOR            "on" to fetch and send headers (default off, so the
 *                         parent can be deployed ahead of the v10 enclave).
 *   BASE_FLOOR_RPC_URLS   comma-separated Base RPC endpoints, tried in order
 *                         (default https://mainnet.base.org). With two or more,
 *                         a head counts only when a second endpoint agrees.
 *   BASE_FLOOR_POLL_MS    refresh interval (default 1000).
 */

import { keccak_256 } from "@noble/hashes/sha3";

export interface RpcBlock {
  hash: string; parentHash: string; sha3Uncles: string; miner: string; stateRoot: string;
  transactionsRoot: string; receiptsRoot: string; logsBloom: string;
  difficulty: string; number: string; gasLimit: string; gasUsed: string;
  timestamp: string; extraData: string; mixHash: string; nonce: string;
  baseFeePerGas?: string; withdrawalsRoot?: string; blobGasUsed?: string;
  excessBlobGas?: string; parentBeaconBlockRoot?: string; requestsHash?: string;
}

export interface BaseHead {
  headerB64: string;
  blockNumber: number;
  blockHash: string;
  blockTimestamp: number;
  /** When this parent read it (ms). */
  readAtMs: number;
}

function hexToBytes(hex: string): Uint8Array {
  let h = hex.replace(/^0x/i, "");
  if (h.length % 2) h = "0" + h;
  if (!/^[0-9a-fA-F]*$/.test(h)) throw new Error("not hex");
  return Uint8Array.from(Buffer.from(h, "hex"));
}
function toHex(b: Uint8Array): string {
  return "0x" + Buffer.from(b).toString("hex");
}
/** Integer field: minimal big-endian, no leading zeros (0 -> empty). */
function q(hex: string | undefined): Uint8Array {
  if (hex == null) return new Uint8Array(0);
  const h = hex.replace(/^0x/i, "").replace(/^0+/, "");
  return h === "" ? new Uint8Array(0) : hexToBytes(h);
}
/** Fixed-width data field: exact bytes. */
function d(hex: string | undefined): Uint8Array {
  return hex == null ? new Uint8Array(0) : hexToBytes(hex);
}
function concat(parts: Uint8Array[]): Uint8Array {
  return Uint8Array.from(Buffer.concat(parts.map((p) => Buffer.from(p))));
}
function encodeLength(len: number, offset: number): Uint8Array {
  if (len < 56) return Uint8Array.of(offset + len);
  const lenBytes: number[] = [];
  for (let n = len; n > 0; n = Math.floor(n / 256)) lenBytes.unshift(n % 256);
  return Uint8Array.of(offset + 55 + lenBytes.length, ...lenBytes);
}
function rlpBytes(b: Uint8Array): Uint8Array {
  if (b.length === 1 && b[0]! < 0x80) return b;
  return concat([encodeLength(b.length, 0x80), b]);
}
function rlpList(items: Uint8Array[]): Uint8Array {
  const body = concat(items.map(rlpBytes));
  return concat([encodeLength(body.length, 0xc0), body]);
}

/** The header RLP, field for field (no check). */
export function encodeBaseHeaderRlp(b: RpcBlock): Uint8Array {
  const fields = [
    d(b.parentHash), d(b.sha3Uncles), d(b.miner), d(b.stateRoot), d(b.transactionsRoot),
    d(b.receiptsRoot), d(b.logsBloom), q(b.difficulty), q(b.number), q(b.gasLimit),
    q(b.gasUsed), q(b.timestamp), d(b.extraData), d(b.mixHash), d(b.nonce),
  ];
  if (b.baseFeePerGas != null) fields.push(q(b.baseFeePerGas));
  if (b.withdrawalsRoot != null) fields.push(d(b.withdrawalsRoot));
  if (b.blobGasUsed != null) fields.push(q(b.blobGasUsed));
  if (b.excessBlobGas != null) fields.push(q(b.excessBlobGas));
  if (b.parentBeaconBlockRoot != null) fields.push(d(b.parentBeaconBlockRoot));
  if (b.requestsHash != null) fields.push(d(b.requestsHash));
  return rlpList(fields);
}

/** The header RLP, or an error when it does not reproduce the block's own hash. */
export function checkedBaseHeaderRlp(b: RpcBlock): Uint8Array {
  const rlp = encodeBaseHeaderRlp(b);
  if (toHex(keccak_256(rlp)) !== b.hash.toLowerCase()) {
    throw new Error(`Base header for block ${parseInt(b.number, 16)} does not reproduce its hash (unknown header field?)`);
  }
  return rlp;
}

export function baseFloorEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["BASE_FLOOR"] === "on";
}

type Fetcher = (url: string, body: string) => Promise<unknown>;

const defaultFetcher: Fetcher = async (url, body) => {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

/** Follows the Base head. `latest()` is the newest checked header, or undefined before the first read. */
/** Saves a floor header durably before it is first used (the ledger, in production). */
export type HeaderSaver = (head: BaseHead) => Promise<void>;

export class BaseHeadFeed {
  private head: BaseHead | undefined;
  /** The head before the current one: sent when the newest is stamped ahead of a clock. */
  private prevHead: BaseHead | undefined;
  private readonly saved = new Set<string>();
  private saver: HeaderSaver | undefined;
  private timer: NodeJS.Timeout | undefined;
  private lastError: string | undefined;
  private readonly urls: string[];
  private readonly pollMs: number;

  constructor(
    opts: { urls?: string[]; pollMs?: number; fetcher?: Fetcher; now?: () => number } = {},
    private readonly fetcher: Fetcher = opts.fetcher ?? defaultFetcher,
    private readonly now: () => number = opts.now ?? Date.now,
  ) {
    this.urls = opts.urls && opts.urls.length > 0 ? opts.urls : ["https://mainnet.base.org"];
    this.pollMs = opts.pollMs ?? 1000;
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): BaseHeadFeed {
    const urls = (env["BASE_FLOOR_RPC_URLS"] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const pollMs = Number(env["BASE_FLOOR_POLL_MS"] ?? 1000);
    return new BaseHeadFeed({ urls, pollMs: Number.isFinite(pollMs) && pollMs >= 200 ? pollMs : 1000 });
  }

  latest(): BaseHead | undefined {
    return this.head;
  }

  setSaver(saver: HeaderSaver | undefined): void {
    this.saver = saver;
  }

  /**
   * The header to fix as the next slot's floor: the newest one stamped at or
   * before `nowMs`, else the one before it. `older` asks for the previous head
   * outright (after the enclave refused the newest as ahead of its clock).
   */
  forAllocation(nowMs: number, older = false): BaseHead | undefined {
    const nowS = Math.floor(nowMs / 1000);
    const candidates = older ? [this.prevHead] : [this.head, this.prevHead];
    return candidates.find((h): h is BaseHead => h !== undefined && h.blockTimestamp <= nowS);
  }

  /** Make sure this header is saved before a proof can stand on it. Once per header; throws when it cannot be saved. */
  async ensureSaved(head: BaseHead): Promise<void> {
    if (!this.saver || this.saved.has(head.blockHash)) return;
    let lastErr: unknown;
    for (let i = 0; i < 3; i++) {
      try {
        await this.saver(head);
        this.saved.add(head.blockHash);
        if (this.saved.size > 10_000) this.saved.clear();
        return;
      } catch (e) {
        lastErr = e;
      }
    }
    throw new Error(`the Base floor header for block ${head.blockNumber} could not be saved: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
  }

  status(nowMs: number = this.now()): { head: Omit<BaseHead, "headerB64"> | null; ageS: number | null; lastError: string | null } {
    const h = this.head;
    return {
      head: h ? { blockNumber: h.blockNumber, blockHash: h.blockHash, blockTimestamp: h.blockTimestamp, readAtMs: h.readAtMs } : null,
      ageS: h ? Math.max(0, Math.floor(nowMs / 1000) - h.blockTimestamp) : null,
      lastError: this.lastError ?? null,
    };
  }

  private async block(url: string, tag: string): Promise<RpcBlock> {
    const j = (await this.fetcher(url, JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBlockByNumber", params: [tag, false] }))) as {
      result?: RpcBlock | null;
      error?: { message?: string };
    };
    if (j.error) throw new Error(j.error.message ?? "rpc error");
    if (!j.result) throw new Error(`no block ${tag}`);
    return j.result;
  }

  /**
   * One read of the head. Keeps the newer of what it had and what it read;
   * never moves backwards. With two or more endpoints, a head is kept only
   * when a second endpoint reports the same hash at that height.
   */
  async refresh(): Promise<void> {
    let lastErr: unknown;
    for (let i = 0; i < this.urls.length; i++) {
      const url = this.urls[i]!;
      try {
        const b = await this.block(url, "latest");
        const rlp = checkedBaseHeaderRlp(b);
        const blockNumber = parseInt(b.number, 16);
        if (this.head && blockNumber <= this.head.blockNumber) {
          this.lastError = undefined;
          return;
        }
        if (this.urls.length >= 2) {
          const other = this.urls[(i + 1) % this.urls.length]!;
          const c = await this.block(other, b.number);
          if (c.hash.toLowerCase() !== b.hash.toLowerCase()) {
            throw new Error(`block ${blockNumber}: ${new URL(url).host} and ${new URL(other).host} disagree on its hash`);
          }
        }
        const j = { result: b };
        this.prevHead = this.head;
        this.head = {
          headerB64: Buffer.from(rlp).toString("base64"),
          blockNumber,
          blockHash: j.result.hash.toLowerCase(),
          blockTimestamp: parseInt(j.result.timestamp, 16),
          readAtMs: this.now(),
        };
        this.lastError = undefined;
        return;
      } catch (e) {
        lastErr = e;
      }
    }
    this.lastError = lastErr instanceof Error ? lastErr.message : String(lastErr);
  }

  start(): void {
    if (this.timer) return;
    const tick = async () => {
      await this.refresh();
      this.timer = setTimeout(tick, this.pollMs);
      this.timer.unref?.();
    };
    void tick();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
}
