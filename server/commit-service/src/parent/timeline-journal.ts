// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * The timeline's storage: every record goes into a local JSONL journal first, and once a minute the lines written
 * since the last upload go to S3 as one gzipped object per epoch, not one object per record.
 *
 * A line is { kind, proof, blockFile? }: the proof exactly as the enclave returned it, attestation and all (the next
 * proof's prevB64 covers it), and for a block read the block file it binds. Appends are fsynced before append()
 * returns, so a record the caller goes on to use is on disk.
 *
 * Uploading: pending.jsonl is renamed to batch-<ms>.jsonl (new appends start a fresh pending file), split by epoch,
 * gzipped and uploaded under
 *
 *   timeline/<epoch>/<first counter>-<last counter>.jsonl.gz
 *
 * (URL-safe epoch, 12-digit counters). The batch file is deleted only after every part has uploaded; a batch left
 * by a crash or a failed upload is retried on the next pass, oldest first, before any newer one. Uploads are
 * create-only, so a retry of a part that did land is not an error.
 */

import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import type { BitGraphProof } from "bitgraph";

export interface TimelineLine {
  kind: "block" | "file";
  proof: BitGraphProof;
  /** The bitgraph-block-read/1 file a block read binds. */
  blockFile?: string;
}

/** Puts one object; resolves when it is stored or already was (create-only). */
export type ObjectPut = (key: string, body: Buffer) => Promise<void>;

export interface UploadStats {
  batches: number;
  objects: number;
  rawBytes: number;
  gzipBytes: number;
  /** rawBytes / gzipBytes, once anything has uploaded. */
  ratio: number | null;
  lastUploadAtMs: number | null;
  lastError: string | null;
}

const safe = (b64: string): string => b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const pad = (c: string): string => c.padStart(12, "0");

export class TimelineJournal {
  private readonly pending: string;
  readonly stats: UploadStats = { batches: 0, objects: 0, rawBytes: 0, gzipBytes: 0, ratio: null, lastUploadAtMs: null, lastError: null };
  private uploading = false;
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly dir: string, private readonly put: ObjectPut, private readonly now: () => number = Date.now) {
    mkdirSync(dir, { recursive: true });
    this.pending = join(dir, "pending.jsonl");
  }

  /** Append one record, durably. */
  append(line: TimelineLine): void {
    const fd = openSync(this.pending, "a", 0o600);
    try {
      writeSync(fd, JSON.stringify(line) + "\n");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }

  /** Upload every batch on disk, oldest first, after closing the pending file into a new batch. */
  async flush(): Promise<void> {
    if (this.uploading) return;
    this.uploading = true;
    try {
      if (existsSync(this.pending) && readFileSync(this.pending).length > 0) {
        renameSync(this.pending, join(this.dir, `batch-${String(this.now()).padStart(13, "0")}.jsonl`));
      }
      const batches = readdirSync(this.dir).filter((f) => /^batch-\d{13}\.jsonl$/.test(f)).sort();
      for (const name of batches) {
        await this.uploadBatch(join(this.dir, name));
        unlinkSync(join(this.dir, name));
        this.stats.batches++;
      }
      this.stats.lastError = null;
    } catch (e) {
      this.stats.lastError = e instanceof Error ? e.message : String(e);
    } finally {
      this.uploading = false;
    }
  }

  private async uploadBatch(path: string): Promise<void> {
    const byEpoch = new Map<string, { lines: string[]; first: bigint; last: bigint }>();
    for (const raw of readFileSync(path, "utf8").split("\n")) {
      if (raw.trim() === "") continue;
      let line: TimelineLine;
      try { line = JSON.parse(raw) as TimelineLine; } catch { continue; } // a torn last line from a crash mid-append
      const epoch = line.proof?.commit?.epochId ?? "unknown";
      const counter = BigInt(line.proof?.commit?.counter ?? "0");
      const g = byEpoch.get(epoch) ?? { lines: [], first: counter, last: counter };
      g.lines.push(raw);
      if (counter < g.first) g.first = counter;
      if (counter > g.last) g.last = counter;
      byEpoch.set(epoch, g);
    }
    for (const [epoch, g] of byEpoch) {
      const body = Buffer.from(g.lines.join("\n") + "\n", "utf8");
      const gz = gzipSync(body, { level: 9 });
      await this.put(`timeline/${safe(epoch)}/${pad(String(g.first))}-${pad(String(g.last))}.jsonl.gz`, gz);
      this.stats.objects++;
      this.stats.rawBytes += body.length;
      this.stats.gzipBytes += gz.length;
      this.stats.ratio = this.stats.rawBytes / this.stats.gzipBytes;
      this.stats.lastUploadAtMs = this.now();
    }
  }

  /** Flush every `intervalMs` (default one minute). */
  start(intervalMs = 60_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.flush(), intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}

/** The production ObjectPut: S3, create-only, Object Lock COMPLIANCE for ten years like the proofs. */
export function s3ObjectPut(bucket: string, region: string): ObjectPut {
  let client: { send: (cmd: unknown) => Promise<void> } | undefined;
  let Put: (new (p: Record<string, unknown>) => unknown) | undefined;
  return async (key, body) => {
    if (!client || !Put) {
      const sdk = (await import("@aws-sdk/client-s3" as string)) as {
        S3Client: new (c: { region: string }) => { send: (cmd: unknown) => Promise<void> };
        PutObjectCommand: new (p: Record<string, unknown>) => unknown;
      };
      client = new sdk.S3Client({ region });
      Put = sdk.PutObjectCommand;
    }
    const retain = new Date();
    retain.setDate(retain.getDate() + 3650);
    try {
      await client.send(new Put({
        Bucket: bucket, Key: key, Body: body, ContentType: "application/gzip",
        ObjectLockMode: "COMPLIANCE", ObjectLockRetainUntilDate: retain, IfNoneMatch: "*",
      }));
    } catch (e) {
      const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status !== 412 && status !== 409) throw e;
    }
  };
}

/** For tests and tools: the lines of one uploaded object. */
export function readTimelineObject(gz: Buffer): TimelineLine[] {
  return gunzipSync(gz).toString("utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as TimelineLine);
}
