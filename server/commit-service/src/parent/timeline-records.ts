// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * Reading the timeline's records back, for bundle export: the journal's lines not yet uploaded (pending.jsonl and
 * any batch-*.jsonl on disk) and the gzipped batches in the ledger bucket (timeline/<epoch>/<first>-<last>.jsonl.gz).
 * Between them every record is found, whether it was made a second ago or a month ago.
 *
 * A file is found by its digest in the local lines, else through the bucket's by-digest index (the earliest proof of
 * those bytes). The epoch's genesis record is kept beside the cursors (genesis-<epoch>.json) when the parent binds
 * it, since it may be far from the file in the sequence.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import type { TimelineLine } from "./timeline-journal.js";

/** Read access to the ledger bucket. */
export interface ObjectStore {
  /** Keys under `prefix`, in key order, after `startAfter`, until `until` returns true for a key (that key excluded). */
  list(prefix: string, startAfter: string, until: (key: string) => boolean): Promise<string[]>;
  get(key: string): Promise<Buffer | null>;
}

const safe = (b64: string): string => b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const pad = (c: bigint): string => (c < 0n ? 0n : c).toString().padStart(12, "0");
const parseLines = (text: string): TimelineLine[] =>
  text.split("\n").flatMap((l) => { if (!l.trim()) return []; try { return [JSON.parse(l) as TimelineLine]; } catch { return []; } });

export class TimelineRecords {
  constructor(private readonly journalDir: string, private readonly stateDir: string, private readonly store: ObjectStore | null) {}

  /** The lines still on this machine. */
  local(): TimelineLine[] {
    if (!existsSync(this.journalDir)) return [];
    const files = readdirSync(this.journalDir).filter((f) => f === "pending.jsonl" || /^batch-\d{13}\.jsonl$/.test(f));
    return files.flatMap((f) => parseLines(readFileSync(join(this.journalDir, f), "utf8")));
  }

  /** The epoch and count of a file's record: the latest local one, else the earliest one the ledger indexes. */
  async find(digestB64: string): Promise<{ epochId: string; counter: string } | null> {
    const mine = this.local().filter((l) => l.kind === "file" && l.proof.artifact?.digestB64 === digestB64);
    const l = mine[mine.length - 1];
    if (l) return { epochId: l.proof.commit.epochId!, counter: l.proof.commit.counter! };
    if (!this.store) return null;
    const body = await this.store.get(`by-digest/${safe(digestB64)}.json`);
    if (!body) return null;
    const p = JSON.parse(body.toString("utf8")) as { commit?: { epochId?: string; counter?: string } };
    return p.commit?.epochId && p.commit.counter ? { epochId: p.commit.epochId, counter: p.commit.counter } : null;
  }

  /** Every record of `epochId` within `span` counts of `counter`, from this machine and the bucket. */
  async around(epochId: string, counter: string, span = 2000n): Promise<TimelineLine[]> {
    const c = BigInt(counter);
    const inRange = (l: TimelineLine) => l.proof.commit?.epochId === epochId && BigInt(l.proof.commit.counter ?? "0") >= c - span && BigInt(l.proof.commit.counter ?? "0") <= c + span;
    const out = this.local().filter(inRange);
    if (this.store) {
      const prefix = `timeline/${safe(epochId)}/`;
      // A batch holds about a minute of records; start well before the window and stop past it.
      const keys = await this.store.list(prefix, prefix + pad(c - span - 100_000n), (k) => BigInt(k.slice(prefix.length, prefix.length + 12)) > c + span);
      for (const key of keys) {
        const m = /^(\d{12})-(\d{12})\.jsonl\.gz$/.exec(key.slice(prefix.length));
        if (!m || BigInt(m[2]!) < c - span) continue;
        const gz = await this.store.get(key);
        if (gz) out.push(...parseLines(gunzipSync(gz).toString("utf8")).filter(inRange));
      }
    }
    // The same record can be both local and uploaded: keep one of each count.
    const byCount = new Map<string, TimelineLine>();
    for (const l of out) byCount.set(l.proof.commit.counter!, l);
    return [...byCount.values()];
  }

  /** The epoch's genesis record, when this parent bound it. */
  genesis(epochId: string): TimelineLine | null {
    const p = join(this.stateDir, `genesis-${safe(epochId)}.json`);
    return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as TimelineLine) : null;
  }

  keepGenesis(line: TimelineLine): void {
    writeFileSync(join(this.stateDir, `genesis-${safe(line.proof.commit.epochId!)}.json`), JSON.stringify(line), { mode: 0o600 });
  }
}

/** The production ObjectStore: the ledger bucket, read only. */
export function s3ObjectStore(bucket: string, region: string): ObjectStore {
  type Sdk = {
    S3Client: new (c: { region: string }) => { send: (cmd: unknown) => Promise<unknown> };
    ListObjectsV2Command: new (p: Record<string, unknown>) => unknown;
    GetObjectCommand: new (p: Record<string, unknown>) => unknown;
  };
  let sdk: Sdk | undefined;
  let client: { send: (cmd: unknown) => Promise<unknown> } | undefined;
  const init = async () => {
    if (!sdk) { sdk = (await import("@aws-sdk/client-s3" as string)) as Sdk; client = new sdk.S3Client({ region }); }
    return { sdk, client: client! };
  };
  return {
    async list(prefix, startAfter, until) {
      const { sdk, client } = await init();
      const keys: string[] = [];
      let token: string | undefined;
      for (let page = 0; page < 50; page++) {
        const r = (await client.send(new sdk.ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, StartAfter: startAfter, ...(token ? { ContinuationToken: token } : {}) }))) as { Contents?: { Key?: string }[]; NextContinuationToken?: string; IsTruncated?: boolean };
        for (const o of r.Contents ?? []) {
          if (!o.Key) continue;
          if (until(o.Key)) return keys;
          keys.push(o.Key);
        }
        if (!r.IsTruncated || !r.NextContinuationToken) return keys;
        token = r.NextContinuationToken;
      }
      return keys;
    },
    async get(key) {
      const { sdk, client } = await init();
      try {
        const r = (await client.send(new sdk.GetObjectCommand({ Bucket: bucket, Key: key }))) as { Body?: { transformToByteArray(): Promise<Uint8Array> } };
        return r.Body ? Buffer.from(await r.Body.transformToByteArray()) : null;
      } catch (e) {
        const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        if (status === 404 || (e as { name?: string }).name === "NoSuchKey") return null;
        throw e;
      }
    },
  };
}
