// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * The block timeline, as the parent runs it: a poller per chain (timeline-poller.ts) over cross-checked sources
 * (chain-sources.ts), and the journal (timeline-journal.ts) every record goes into. server.ts starts it after the
 * enclave is open and hands it every proof the enclave makes, so file binds, block reads and the genesis record are
 * all in the journal, in one sequence.
 *
 * Env (off unless TIMELINE=on):
 *   TIMELINE                    "on" to run it.
 *   TIMELINE_STATE_DIR          required: cursors and the journal (<dir>/journal).
 *   TIMELINE_BASE_RPC_URLS, TIMELINE_ETHEREUM_RPC_URLS, TIMELINE_*_CHAIN_ID   see chain-sources.ts.
 *   TIMELINE_BASE_POLL_MS       default 1000 (Base makes a block every 2 s; its lag limit is 5 s).
 *   TIMELINE_ETHEREUM_POLL_MS   default 3000 (a block every 12 s; lag limit 60 s).
 *   TIMELINE_UPLOAD_MS          default 60000: how often the journal's new lines go to S3.
 *   LEDGER_BUCKET, LEDGER_REGION  where the journal's gzipped batches go; without a bucket they stay on disk.
 *   TIMELINE_HARNESS_TIME       "on" only for the local harness: read its stand-in attestations' times.
 *
 * bundle() builds a file's bitgraph-timeline-bundle/1 from the records (timeline-records.ts) for GET /timeline/bundle.
 *
 * A chain without two configured providers is not read, and says why in status(). Base down at runtime is the
 * same as any outage: the Base poller catches up when it answers, and the Ethereum poller goes on meanwhile.
 */

import { join } from "node:path";
import type { BitGraphProof } from "bitgraph";
import { timelineSourcesFromEnv, defaultHttp, type Http } from "./chain-sources.js";
import { ChainPoller, type DigestBinder, type PollerStatus } from "./timeline-poller.js";
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
  chains: PollerStatus[];
  /** Chains not read, and why. */
  problems: string[];
  journal: UploadStats & { uploading: boolean };
}

export class Timeline {
  private constructor(
    private readonly pollers: ChainPoller[],
    private readonly journal: TimelineJournal,
    private readonly problems: string[],
    private readonly uploadMs: number | null,
    private readonly records: TimelineRecords,
    private readonly nitroTimeMs: (p: BitGraphProof) => number | null,
  ) {}

  /** Null when TIMELINE is not "on". Throws when it is on but cannot run (no state directory). */
  static fromEnv(opts: { bind: DigestBinder; epochId: () => string | null; env?: NodeJS.ProcessEnv; http?: Http; put?: ObjectPut; store?: ObjectStore | null; log?: (m: string) => void }): Timeline | null {
    const env = opts.env ?? process.env;
    if (env["TIMELINE"] !== "on") return null;
    const dir = env["TIMELINE_STATE_DIR"]?.trim();
    if (!dir) throw new Error("TIMELINE=on needs TIMELINE_STATE_DIR");
    const { sources, problems } = timelineSourcesFromEnv(env, opts.http ?? defaultHttp());
    const bucket = env["LEDGER_BUCKET"];
    const put = opts.put ?? (bucket ? s3ObjectPut(bucket, env["LEDGER_REGION"] || "us-east-2") : null);
    if (!put) problems.push("journal: no LEDGER_BUCKET, so batches stay on disk");
    const journal = new TimelineJournal(join(dir, "journal"), put ?? (async () => { throw new Error("no LEDGER_BUCKET"); }));
    const pollMs = (k: string, d: number) => { const v = Number(env[k] ?? d); return Number.isFinite(v) && v >= 200 ? v : d; };
    const pollers = (["base", "ethereum"] as const).flatMap((chain) => {
      const source = sources[chain];
      if (!source) return [];
      return [new ChainPoller({
        source, bind: opts.bind, journal, stateDir: dir, epochId: opts.epochId,
        pollMs: pollMs(`TIMELINE_${chain.toUpperCase()}_POLL_MS`, chain === "base" ? 1000 : 3000),
        ...(opts.log ? { log: opts.log } : {}),
      })];
    });
    const store = opts.store !== undefined ? opts.store : bucket ? s3ObjectStore(bucket, env["LEDGER_REGION"] || "us-east-2") : null;
    const records = new TimelineRecords(join(dir, "journal"), dir, store);
    return new Timeline(pollers, journal, problems, put ? pollMs("TIMELINE_UPLOAD_MS", 60_000) : null, records, env["TIMELINE_HARNESS_TIME"] === "on" ? harnessTimeMs : attestationTimeMs);
  }

  start(): void {
    for (const p of this.pollers) p.start();
    if (this.uploadMs !== null) this.journal.start(this.uploadMs);
  }

  stop(): void {
    for (const p of this.pollers) p.stop();
    this.journal.stop();
  }

  /** A file bind's proof, or the genesis record with its file. */
  record(proof: BitGraphProof, genesisFile?: string): void {
    const line: TimelineLine = genesisFile !== undefined ? { kind: "genesis", proof, genesisFile } : { kind: "file", proof };
    this.journal.append(line);
    if (line.kind === "genesis") this.records.keepGenesis(line);
  }

  /** A file's bundle, by its digest (its latest record here, else the ledger's earliest) or by epoch and count. */
  async bundle(q: { digestB64?: string; epochId?: string; counter?: string }): Promise<BuildTimelineBundleResult & { found: boolean }> {
    const at = q.epochId && q.counter ? { epochId: q.epochId, counter: q.counter } : q.digestB64 ? await this.records.find(q.digestB64) : null;
    if (!at) return { ok: false, retryable: false, reason: "no timeline record of that file", found: false };
    const lines = await this.records.around(at.epochId, at.counter);
    const r = buildTimelineBundle({ lines, counter: at.counter, genesis: this.records.genesis(at.epochId), nitroTimeMs: this.nitroTimeMs });
    return { ...r, found: true };
  }

  async flush(): Promise<void> {
    await this.journal.flush();
  }

  status(): TimelineStatus {
    return { chains: this.pollers.map((p) => ({ ...p.state })), problems: [...this.problems], journal: { ...this.journal.stats, uploading: this.uploadMs !== null } };
  }
}
