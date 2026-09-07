/**
 * The drop's scan workers: one per core, each hashing one file at a time
 * with the state-saving hasher (scan-hash.ts), so a drop is hashed at disk
 * speed while the page stays responsive. A worker that fails is retired and
 * the file is hashed here instead; a platform without workers hashes here;
 * a platform without WebAssembly gets the native hasher, without a state.
 * Browser-only: it makes Workers.
 */
import { hashBlob, type ScanHash } from "./scan-hash";
import type { ScanReply, ScanRequest, ScanResult } from "./scan.worker";
import { placementForBytes } from "@mikeargento/bitgraph";
import { hashFile } from "./bitgraph";

export function scanPoolSize(): number {
  const cores = typeof navigator !== "undefined" && typeof navigator.hardwareConcurrency === "number" ? navigator.hardwareConcurrency : 4;
  return Math.max(2, Math.min(8, cores - 1));
}

interface Slot {
  worker: Worker;
  busy: boolean;
  /** The one job in flight on this worker. */
  job: { id: number; resolve: (r: ScanResult[]) => void; reject: (e: Error) => void } | null;
}

export class ScanPool {
  private slots: Slot[] = [];
  private waiters: Array<(s: Slot) => void> = [];
  private broken = typeof Worker === "undefined";
  private nextId = 1;

  readonly size: number;
  // A plain field, not a parameter property: node's type stripping refuses
  // those, and that alone made this file impossible to exercise from a test.
  constructor(size: number = scanPoolSize()) { this.size = size; }

  /** Hash one file. Never rejects for a hashing failure: the last resort is the native hasher, which leaves no state. */
  async hash(file: File): Promise<ScanHash> {
    return (await this.hashBatch([file]))[0];
  }

  /**
   * Hash many files in ONE worker round trip, answering in the order sent.
   *
   * ⚠️ The batch is the point. One file per message made a 48,000 file drop
   * 48,000 round trips to hash 57 bytes each, and the messaging was the wait:
   * 2.7MB of content took 6.9s (measured 2026-09-07). Never rejects for a
   * hashing failure, per file or for the batch: the last resort is the native
   * hasher, which leaves no state and so costs that file its fast fuse later,
   * but never the drop.
   */
  async hashBatch(files: File[]): Promise<ScanHash[]> {
    if (files.length === 0) return [];
    if (!this.broken) {
      const slot = await this.acquire();
      if (slot !== null) {
        try {
          const results = await this.run(slot, files);
          // Loud, not silent: a short or long batch would pair files with
          // other files' digests, which is worse than any slowness.
          if (results.length !== files.length) throw new Error(`scan worker answered ${results.length} of ${files.length}`);
          return await Promise.all(results.map((r, i) => (r.ok
            ? { digestB64: r.digestB64, placement: r.placement, state: r.state, bytes: r.bytes }
            : this.inPage(files[i]))));
        } catch {
          this.retire(slot);
        }
      }
    }
    return Promise.all(files.map((f) => this.inPage(f)));
  }

  private async inPage(file: File): Promise<ScanHash> {
    try {
      return await hashBlob(file);
    } catch {
      return nativeScan(file);
    }
  }

  close(): void {
    for (const s of this.slots) s.worker.terminate();
    this.slots = [];
  }

  private spawn(): Slot | null {
    try {
      const worker = new Worker(new URL("./scan.worker.ts", import.meta.url), { type: "module" });
      const slot: Slot = { worker, busy: false, job: null };
      worker.onmessage = (e: MessageEvent<ScanReply>) => {
        const job = slot.job;
        if (job === null || e.data.id !== job.id) return;
        slot.job = null;
        if (e.data.ok) job.resolve(e.data.results);
        else job.reject(new Error(e.data.error));
      };
      worker.onerror = (e) => {
        const job = slot.job;
        slot.job = null;
        job?.reject(new Error(e.message || "scan worker failed"));
      };
      this.slots.push(slot);
      if (this.slots.length === 1) console.info(`[scan] hashing in up to ${this.size} workers`);
      return slot;
    } catch (err) {
      // Said once, so a scan that hashes in the page instead of in workers can be told apart from one that did not.
      console.warn("[scan] no workers on this platform; hashing in the page:", err instanceof Error ? err.message : String(err));
      this.broken = true;
      return null;
    }
  }

  private acquire(): Promise<Slot | null> {
    const idle = this.slots.find((s) => !s.busy);
    if (idle !== undefined) {
      idle.busy = true;
      return Promise.resolve(idle);
    }
    if (this.slots.length < this.size) {
      const fresh = this.spawn();
      if (fresh === null) return Promise.resolve(null);
      fresh.busy = true;
      return Promise.resolve(fresh);
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private release(slot: Slot): void {
    const next = this.waiters.shift();
    if (next !== undefined) {
      next(slot);
      return;
    }
    slot.busy = false;
  }

  private retire(slot: Slot): void {
    console.warn("[scan] a scan worker failed and was retired; its file is hashed in the page");
    slot.worker.terminate();
    this.slots = this.slots.filter((s) => s !== slot);
    // Whoever was waiting for this worker gets a fresh one, or hashes here.
    const next = this.waiters.shift();
    if (next !== undefined) {
      const fresh = this.spawn();
      if (fresh !== null) {
        fresh.busy = true;
        next(fresh);
      } else {
        next(null as unknown as Slot);
      }
    }
  }

  private run(slot: Slot, files: File[]): Promise<ScanResult[]> {
    const id = this.nextId++;
    return new Promise<ScanResult[]>((resolve, reject) => {
      slot.job = { id, resolve, reject };
      const request: ScanRequest = { id, files };
      slot.worker.postMessage(request);
    }).finally(() => {
      if (this.slots.includes(slot)) this.release(slot);
    });
  }
}

/** The native hasher for a platform without WebAssembly: the digest, the placement from the first bytes, and no state. */
async function nativeScan(file: File): Promise<ScanHash> {
  const digestB64 = await hashFile(file);
  const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  return { digestB64, placement: placementForBytes(head), state: null, bytes: file.size };
}

let shared: ScanPool | null = null;
/** One pool per page; its workers idle between drops. */
export function scanPool(): ScanPool {
  if (shared === null) shared = new ScanPool();
  return shared;
}
