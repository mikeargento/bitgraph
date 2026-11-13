// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * Where the publisher reads the line and keeps what it publishes.
 *
 * The line: the proofs the parent persisted to the ledger (proofs/<epoch>/<count, 12 digits>-<proof hash>.json), read
 * back in count order, and the epoch the parent has open (its GET /health).
 *
 * What it keeps, create-only and under the ledger's Object Lock like the proofs:
 *   publication/hours/<epoch>/<Base block, 12 digits>-<link, first 16 hex>.json   one bitgraph-hour/1 record per write, in write order
 *   publication/proofs/<epoch>/<count, 12 digits>.json                            one bitgraph-publication/1 block per BitGraph
 *   publication/floors/<epoch>/<count, 12 digits>.json                            one record per floor BitGraph: its note and the write it names
 *
 * Epochs in keys are URL-safe base64 without padding, as in proofs/.
 */

import { mkdirSync, existsSync, writeFileSync, readFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import type { HourRecord, PublicationBlock } from "@mikeargento/bitgraph-audit";

export interface StoredProof { counter: number; proof: Record<string, unknown> }

export interface Line {
  /** The epoch the parent has open, or null when it cannot be read. */
  openEpoch(): Promise<string | null>;
  /** Every proof of the epoch with a count above `after`, in count order. */
  proofs(epochId: string, after: number): Promise<StoredProof[]>;
}

/** A floor BitGraph, as the ledger lists it: which count it is, the note it binds, and the write that note names. */
export interface FloorRecord {
  format: "bitgraph-hour-floor/1";
  epochId: string;
  counter: string;
  digestB64: string;
  note: string;
  write: { chainId: number; blockNumber: number; blockHash: string; blockTimestamp: number; txHash: string; link: string };
}

export interface Store {
  putHour(epochId: string, record: HourRecord): Promise<void>;
  putBlock(epochId: string, counter: number, block: PublicationBlock): Promise<void>;
  putFloor(epochId: string, counter: number, record: FloorRecord): Promise<void>;
}

export const safeEpoch = (b64: string): string => b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const pad12 = (n: number): string => String(n).padStart(12, "0");
export const hourKey = (epochId: string, r: HourRecord): string => `publication/hours/${safeEpoch(epochId)}/${pad12(r.write.blockNumber)}-${r.link.slice(0, 16)}.json`;
export const blockKey = (epochId: string, counter: number): string => `publication/proofs/${safeEpoch(epochId)}/${pad12(counter)}.json`;
export const floorKey = (epochId: string, counter: number): string => `publication/floors/${safeEpoch(epochId)}/${pad12(counter)}.json`;

/** Proofs as stored carry `proofHash`, which the ledger added; the proof itself is everything else. */
function asProof(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const p = { ...(raw as Record<string, unknown>) };
  delete p["proofHash"];
  return p;
}

// ── The parent's open epoch ────────────────────────────────────────────────

/** The parent's open epoch: GET /health names it when the timeline runs, GET /key always does. */
export async function parentOpenEpoch(parentUrl: string): Promise<string | null> {
  const base = parentUrl.replace(/\/$/, "");
  for (const path of ["/health", "/key"]) {
    try {
      const r = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(10_000) });
      if (!r.ok) continue;
      const j = (await r.json()) as { epochId?: unknown };
      if (typeof j.epochId === "string" && j.epochId.length === 44) return j.epochId;
    } catch { /* try the next */ }
  }
  return null;
}

/** POST /commit for one digest; the proof the parent returns. */
export async function parentBind(parentUrl: string, digestB64: string, apiKey?: string): Promise<Record<string, unknown>> {
  const r = await fetch(`${parentUrl.replace(/\/$/, "")}/commit`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify({ digests: [{ digestB64, hashAlg: "sha256" }] }),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`POST /commit: HTTP ${r.status} ${text.slice(0, 200)}`);
  const j = JSON.parse(text) as unknown;
  const p = Array.isArray(j) ? j[0] : null;
  if (!p || typeof p !== "object") throw new Error("POST /commit returned no proof");
  return asProof(p)!;
}

// ── S3 ─────────────────────────────────────────────────────────────────────

type S3Sdk = {
  S3Client: new (c: { region: string }) => { send: (cmd: unknown) => Promise<unknown> };
  ListObjectsV2Command: new (p: Record<string, unknown>) => unknown;
  GetObjectCommand: new (p: Record<string, unknown>) => unknown;
  PutObjectCommand: new (p: Record<string, unknown>) => unknown;
};

async function s3(region: string): Promise<{ sdk: S3Sdk; client: { send: (cmd: unknown) => Promise<unknown> } }> {
  const sdk = (await import("@aws-sdk/client-s3" as string)) as S3Sdk;
  return { sdk, client: new sdk.S3Client({ region }) };
}

export function s3Line(o: { bucket: string; region: string; parentUrl: string }): Line {
  let c: Awaited<ReturnType<typeof s3>> | undefined;
  const get = async () => (c ??= await s3(o.region));
  return {
    openEpoch: () => parentOpenEpoch(o.parentUrl),
    async proofs(epochId, after) {
      const { sdk, client } = await get();
      const prefix = `proofs/${safeEpoch(epochId)}/`;
      const keys: string[] = [];
      let token: string | undefined;
      do {
        const r = (await client.send(new sdk.ListObjectsV2Command({
          Bucket: o.bucket, Prefix: prefix, StartAfter: `${prefix}${pad12(after)}-~`, ...(token ? { ContinuationToken: token } : {}),
        }))) as { Contents?: Array<{ Key?: string }>; IsTruncated?: boolean; NextContinuationToken?: string };
        for (const it of r.Contents ?? []) if (it.Key) keys.push(it.Key);
        token = r.IsTruncated ? r.NextContinuationToken : undefined;
      } while (token);
      const byCount = new Map<number, Record<string, unknown>>();
      // Read a few at a time; an hour is usually small, a burst can be thousands.
      for (let i = 0; i < keys.length; i += 16) {
        const got = await Promise.all(keys.slice(i, i + 16).map(async (Key) => {
          const r = (await client.send(new sdk.GetObjectCommand({ Bucket: o.bucket, Key }))) as { Body?: { transformToString(): Promise<string> } };
          return asProof(JSON.parse((await r.Body!.transformToString()) || "null"));
        }));
        for (const p of got) {
          const n = Number((p?.["commit"] as { counter?: string } | undefined)?.counter);
          if (p && Number.isSafeInteger(n) && n > after && !byCount.has(n)) byCount.set(n, p);
        }
      }
      return [...byCount.entries()].sort((a, b) => a[0] - b[0]).map(([counter, proof]) => ({ counter, proof }));
    },
  };
}

export function s3Store(o: { bucket: string; region: string; retainDays?: number }): Store {
  let c: Awaited<ReturnType<typeof s3>> | undefined;
  const put = async (Key: string, body: unknown): Promise<void> => {
    const { sdk, client } = (c ??= await s3(o.region));
    const retain = new Date();
    retain.setDate(retain.getDate() + (o.retainDays ?? 3650));
    try {
      await client.send(new sdk.PutObjectCommand({
        Bucket: o.bucket, Key, Body: JSON.stringify(body, null, 2) + "\n", ContentType: "application/json",
        ObjectLockMode: "COMPLIANCE", ObjectLockRetainUntilDate: retain, IfNoneMatch: "*",
      }));
    } catch (e) {
      // Already there from an earlier attempt: create-only, so the first copy stands.
      const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status !== 412 && status !== 409) throw e;
    }
  };
  return {
    putHour: (epochId, r) => put(hourKey(epochId, r), r),
    putBlock: (epochId, counter, b) => put(blockKey(epochId, counter), b),
    putFloor: (epochId, counter, r) => put(floorKey(epochId, counter), r),
  };
}

// ── Files (a local run, and tests) ─────────────────────────────────────────

export function fileStore(dir: string): Store {
  const put = (key: string, body: unknown): void => {
    const path = join(dir, key);
    if (existsSync(path)) return;
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(body, null, 2) + "\n");
    renameSync(tmp, path);
  };
  return {
    putHour: async (epochId, r) => put(hourKey(epochId, r), r),
    putBlock: async (epochId, counter, b) => put(blockKey(epochId, counter), b),
    putFloor: async (epochId, counter, r) => put(floorKey(epochId, counter), r),
  };
}

export function readJsonFile<T>(path: string): T | null {
  try { return JSON.parse(readFileSync(path, "utf8")) as T; } catch { return null; }
}
