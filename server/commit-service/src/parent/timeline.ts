// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * The timeline, as the parent runs it: the journal (timeline-journal.ts) that every proof the enclave makes goes into,
 * in one sequence, and the records (timeline-records.ts) read back from it. server.ts starts it after the enclave is
 * open and hands it every proof: file binds and the epoch's closing record.
 *
 * Env (off unless TIMELINE=on):
 *   TIMELINE                    "on" to run it.
 *   TIMELINE_STATE_DIR          required: the journal (<dir>/journal) and per-epoch state.
 *   TIMELINE_UPLOAD_MS          default 60000: how often the journal's new lines go to S3.
 *   LEDGER_BUCKET, LEDGER_REGION  where the journal's gzipped batches go; without a bucket they stay on disk.
 *   TIMELINE_HARNESS_TIME       "on" only for the local harness: read its stand-in attestations' times.
 *
 * bundle() builds a file's bitgraph-timeline-bundle/1 from the records (timeline-records.ts) for GET /timeline/bundle.
 * A bundle needs block-read records around the file, so it can be built only for files whose epoch has them.
 * recent() and recentLines() serve GET /timeline/recent.
 */

import { join } from "node:path";
import type { BitGraphProof } from "bitgraph";
import { TimelineJournal, s3ObjectPut, type ObjectPut, type TimelineLine, type UploadStats } from "./timeline-journal.js";
import { TimelineRecords, s3ObjectStore, type ObjectStore } from "./timeline-records.js";
import { buildTimelineBundle, attestationTimeMs, type BuildTimelineBundleResult } from "@mikeargento/bitgraph-verify";

/** The local harness's stand-in attestation: LOCAL-HARNESS-ATTESTATION:<user_data hex>:<ms>. */
function harnessTimeMs(proof: BitGraphProof): number | null {
  const r = proof.environment?.attestation?.reportB64;
  if (typeof r !== "string") return null;
  const m = /^LOCAL-HARNESS-ATTESTATION:[0-9a-f]*:(\d+)$/.exec(Buffer.from(r, "base64").toString("utf8"));
  return m ? Number(m[1]) : null;
}

export interface TimelineStatus {
  /** What the timeline runs without, and why. */
  problems: string[];
  journal: UploadStats & { uploading: boolean };
}

export class Timeline {
  private constructor(
    private readonly journal: TimelineJournal,
    private readonly problems: string[],
    private readonly uploadMs: number | null,
    private readonly records: TimelineRecords,
    private readonly nitroTimeMs: (p: BitGraphProof) => number | null,
  ) {}

  /** Null when TIMELINE is not "on". Throws when it is on but cannot run (no state directory). */
  static fromEnv(opts: { env?: NodeJS.ProcessEnv; put?: ObjectPut; store?: ObjectStore | null } = {}): Timeline | null {
    const env = opts.env ?? process.env;
    if (env["TIMELINE"] !== "on") return null;
    const dir = env["TIMELINE_STATE_DIR"]?.trim();
    if (!dir) throw new Error("TIMELINE=on needs TIMELINE_STATE_DIR");
    const problems: string[] = [];
    const bucket = env["LEDGER_BUCKET"];
    const put = opts.put ?? (bucket ? s3ObjectPut(bucket, env["LEDGER_REGION"] || "us-east-2") : null);
    if (!put) problems.push("journal: no LEDGER_BUCKET, so batches stay on disk");
    const journal = new TimelineJournal(join(dir, "journal"), put ?? (async () => { throw new Error("no LEDGER_BUCKET"); }));
    const nitroTimeMs = env["TIMELINE_HARNESS_TIME"] === "on" ? harnessTimeMs : attestationTimeMs;
    const uploadMs = (() => { const v = Number(env["TIMELINE_UPLOAD_MS"] ?? 60_000); return Number.isFinite(v) && v >= 200 ? v : 60_000; })();
    const store = opts.store !== undefined ? opts.store : bucket ? s3ObjectStore(bucket, env["LEDGER_REGION"] || "us-east-2") : null;
    const records = new TimelineRecords(join(dir, "journal"), dir, store);
    return new Timeline(journal, problems, put ? uploadMs : null, records, nitroTimeMs);
  }

  start(): void {
    if (this.uploadMs !== null) this.journal.start(this.uploadMs);
  }

  stop(): void {
    this.journal.stop();
  }

  /** The epoch's closing record (server.ts, bindEpochEnd), with the note it binds. */
  recordEnd(proof: BitGraphProof, endFile: string): void {
    this.journal.append({ kind: "end", proof, endFile });
  }

  /** A file bind's proof. */
  record(proof: BitGraphProof): void {
    this.journal.append({ kind: "file", proof });
  }

  /** A file's bundle, by its digest (its latest record here, else the ledger's earliest) or by epoch and count. */
  async bundle(q: { digestB64?: string; epochId?: string; counter?: string }): Promise<BuildTimelineBundleResult & { found: boolean }> {
    const at = q.epochId && q.counter ? { epochId: q.epochId, counter: q.counter } : q.digestB64 ? await this.records.find(q.digestB64) : null;
    if (!at) return { ok: false, retryable: false, reason: "no timeline record of that file", found: false };
    // A closing record is an ordinary file bind as far as a bundle is concerned.
    type BundleInput = Parameters<typeof buildTimelineBundle>[0];
    const lines = (await this.records.around(at.epochId, at.counter)).map((l) => (l.kind === "end" ? { kind: "file" as const, proof: l.proof } : l)) as BundleInput["lines"];
    const r = buildTimelineBundle({ lines, counter: at.counter, genesis: this.records.genesis(at.epochId) as BundleInput["genesis"], nitroTimeMs: this.nitroTimeMs });
    return { ...r, found: true };
  }

  /**
   * The records still on this machine (not yet in an uploaded batch) after `after`, for the public ledger's live view:
   * each one's count, kind, block (for a read) and attested time. Nothing here is not already public: the same lines
   * reach the bucket within the minute.
   */
  recent(epochId: string, after: number, limit = 3000): { epochId: string; records: Array<{ counter: number; kind: string; digestB64?: string; chain?: string; number?: number; recordedMs: number | null }> } {
    const out = this.records.local()
      .filter((l) => l.proof.commit?.epochId === epochId && Number(l.proof.commit.counter) > after)
      .map((l) => {
        const r: { counter: number; kind: string; digestB64?: string; chain?: string; number?: number; recordedMs: number | null } = { counter: Number(l.proof.commit.counter), kind: l.kind, recordedMs: this.nitroTimeMs(l.proof) };
        if (l.proof.artifact?.digestB64) r.digestB64 = l.proof.artifact.digestB64;
        if (l.kind === "block" && l.blockFile) {
          try { const f = JSON.parse(l.blockFile) as { chain?: string; number?: number }; if (f.chain) r.chain = f.chain; if (typeof f.number === "number") r.number = f.number; } catch { /* listed without its block */ }
        }
        return r;
      })
      .sort((a, b) => a.counter - b.counter);
    const byCount = new Map<number, (typeof out)[number]>();
    for (const r of out) if (!(r.kind === "file" && byCount.get(r.counter)?.kind === "block")) byCount.set(r.counter, r);
    return { epochId, records: [...byCount.values()].slice(-limit) };
  }

  /** The same records in full (the proof and its file), for opening a block read made in the last minute. */
  recentLines(epochId: string, after: number, limit = 200): TimelineLine[] {
    const byCount = new Map<number, TimelineLine>();
    for (const l of this.records.local()) {
      const c = Number(l.proof.commit?.counter);
      if (l.proof.commit?.epochId === epochId && c > after) byCount.set(c, l);
    }
    return [...byCount.entries()].sort((a, b) => a[0] - b[0]).slice(0, limit).map(([, l]) => l);
  }

  async flush(): Promise<void> {
    await this.journal.flush();
  }

  status(): TimelineStatus {
    return { problems: [...this.problems], journal: { ...this.journal.stats, uploading: this.uploadMs !== null } };
  }
}
