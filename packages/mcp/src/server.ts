// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * @mikeargento/bitgraph-mcp: tool definitions.
 *
 * Three gestures, the same three the website has: make a BitGraph, check
 * whether bytes are on record, fetch a proof. Making a BitGraph is one
 * gesture for any number of files, the way a drop on the site is: a single
 * file is fused on its own slot, and two or more become members of ONE set
 * under ONE slot. For a set each file is read once, on this machine, for its
 * digest and a hasher state; the new fused bytes are never written and never
 * held, their digest is finished from that state once the slot exists; and
 * the set's committed artifact is hashed and committed under the same slot.
 * Only digests, that artifact and slot records leave the machine. File
 * contents are never uploaded and files are never modified.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import { FuseError, MAX_SET_MEMBERS, builderFor, fuse, fuseSet, fusedNamesFor, type FuseSetMember, type FuseSetProgress } from "@mikeargento/bitgraph";
import {
  ApiError,
  batchCheck,
  configFromEnv,
  getProofDetail,
  indexSetMembers,
  search,
  type ApiConfig,
} from "./api.js";
import {
  fromUrlSafeB64,
  looksLikeDigest,
  mapConcurrent,
  sha256FileB64,
  toUrlSafeB64,
} from "./encoding.js";
import {
  capJson,
  positionOf,
  proofUrl,
  renderCheckMarkdown,
  renderProofMarkdown,
  renderRecordMarkdown,
  type CheckOutcome,
  type RecordOutcome,
  type SetOutcome,
} from "./format.js";
import { expandPaths, fusedDigestFor, scanFile, sniffC2paBytes, type ScannedFile } from "./scan.js";
import { readCarrierFile, sniffCarrierTail, type CarrierWindowView } from "./carrier-io.js";
import { stat } from "node:fs/promises";
import { SLOT_TTL_SECONDS, TASK_INSTRUCTIONS, beginTask, decodeTaskToken, sealTask, writeProofBeside } from "./task.js";
import type { BitGraphProof, ProofDetailResponse } from "./types.js";

export const SERVER_VERSION = "0.6.0";

const SCAN_CONCURRENCY = 4;
/** Paths per call; a directory counts once and expands to its files. */
const MAX_PATHS = 2000;
/** Files one call may BitGraph after directories expand: one set. The site's own ceiling for a set/2. */
export const MAX_MEMBERS = 100_000;
/** Files one check may cover after directories expand. */
const MAX_CHECK_FILES = 10_000;
/** A file whose length changed while it was read is fused from its bytes instead; above this it is left out rather than held in memory. */
const MAX_LOADED_BYTES = 256 * 1024 * 1024;
/** A single file up to this size is fused on its own, in memory, with its Frame; a larger one is a set of one, never held. */
const MAX_SOLO_BYTES = 256 * 1024 * 1024;
/** Rows the structured result lists in full; every fused row shares the set's position. */
export const ROW_CAP = 500;
/** Members' evidence per set-index request: the site's own chunk. */
export const SET_INDEX_CHUNK = 2500;

/** What one set yields, in the shape the tool reports; tests inject a stand-in. */
export interface SetSummary {
  set: "set/1" | "set/2";
  proof: BitGraphProof;
  /** Standard base64: the committed artifact's digest. */
  artifactDigestB64: string;
  count: number;
  manifestEchoed: boolean;
  recovered: boolean;
  /** In the order the files were given. */
  members: Array<{
    index: number;
    /** The row's ordinal in the committed artifact. */
    manifestIndex: number;
    placement: string;
    originDigestB64: string;
    artifactDigestB64: string;
    /** set/2 only: the member's evidence, for the site's index. */
    memberProof?: unknown;
  }>;
}
export type FuseSetFn = (
  files: readonly ScannedFile[],
  config: ApiConfig,
  opts: { set: "set/1" | "set/2"; onProgress?: (p: FuseSetProgress) => void }
) => Promise<SetSummary>;

/** What fusing one file on its own yields. */
export interface FusedSummary {
  proof: BitGraphProof;
  frame: unknown;
  placement: string;
  artifactDigestB64: string;
  originDigestB64: string;
}
export type FuseFileFn = (file: ScannedFile, config: ApiConfig) => Promise<FusedSummary>;

export interface ServerDeps {
  /** The set pipeline; tests inject a stand-in. Default: the core package's fuseSet() against the configured site. */
  fuseSet?: FuseSetFn;
  /** The single-file pipeline; tests inject a stand-in. Default: the core package's fuse() against the configured site. */
  fuseFile?: FuseFileFn;
}

/**
 * A single file, the way a single drop on the site goes: the bytes in hand,
 * the placement chosen from them, one slot, the fused bytes built in memory
 * and hashed, committed under that exact slot, verified against the bytes,
 * and a Frame returned. The fused bytes are not kept.
 */
async function fuseFileDefault(file: ScannedFile, config: ApiConfig): Promise<FusedSummary> {
  const bytes = new Uint8Array(await readFile(file.path));
  const placement = file.placement;
  const { fusedName } = fusedNamesFor(file.name, placement);
  const r = await fuse(builderFor(placement, bytes), {
    placement,
    original: bytes,
    fusedFile: fusedName,
    keepFused: false,
    transport: { baseUrl: config.baseUrl, ...(config.apiKey ? { apiKey: config.apiKey } : {}) },
  });
  return {
    proof: r.proof as unknown as BitGraphProof,
    frame: r.frame,
    placement,
    artifactDigestB64: r.artifactDigestB64,
    originDigestB64: r.originDigestB64 ?? file.digestB64,
  };
}

/**
 * The default pipeline, the one the site's drop runs: one slot for the set,
 * every member a hashed member whose fused digest is finished from the
 * scan's open hasher with its placement's suffix for that slot, the set's
 * manifest (or, for a set/2, its root document) committed under the same
 * slot, and the returned proof verified against the committed artifact with
 * every member bound to it by digest. A file whose length changed during the
 * scan is a loaded member: read again when it is its turn, checked against
 * the scan's digest, fused in memory, hashed and released.
 */
async function fuseSetDefault(
  files: readonly ScannedFile[],
  config: ApiConfig,
  opts: { set: "set/1" | "set/2"; onProgress?: (p: FuseSetProgress) => void }
): Promise<SetSummary> {
  const members: FuseSetMember[] = files.map((f) =>
    f.state !== null
      ? { originDigest: f.originDigest, placement: f.placement, name: f.name, fusedDigest: ({ commitment }) => fusedDigestFor(f, commitment) }
      : { load: async () => new Uint8Array(await readFile(f.path)), originDigest: f.originDigest, placement: f.placement, name: f.name }
  );
  const r = await fuseSet(members, {
    set: opts.set,
    keepFused: false,
    ...(opts.onProgress !== undefined ? { onProgress: opts.onProgress } : {}),
    transport: { baseUrl: config.baseUrl, ...(config.apiKey ? { apiKey: config.apiKey } : {}) },
  });
  return {
    set: r.set,
    proof: r.proof as unknown as BitGraphProof,
    artifactDigestB64: r.artifactDigestB64,
    count: r.members.length,
    manifestEchoed: r.manifestEchoed,
    recovered: r.recovered,
    members: r.members.map((m) => ({
      index: m.index,
      manifestIndex: m.manifestIndex,
      placement: m.placement,
      originDigestB64: m.originDigestB64,
      artifactDigestB64: m.artifactDigestB64,
      ...(m.memberProof !== undefined ? { memberProof: m.memberProof } : {}),
    })),
  };
}

/**
 * A path is either plain bytes to scan or a BitGraphed file (bitgraph-carrier/1),
 * decided by one 8-byte tail read. A BitGraphed file is judged OFFLINE from the
 * proof it carries, its lookups use the digest of the committed bytes inside,
 * and it is never minted: the envelope is not the recorded thing, the bytes
 * inside are. That is the same structural guarantee the site's drop box gives.
 */
interface CarrierRow {
  kind: "carrier";
  path: string;
  status: "ok" | "corrupt" | "too-large";
  /** Standard base64 SHA-256 of the committed bytes inside (status "ok"). */
  innerDigestB64: string | null;
  view: CarrierWindowView | null;
  /** The carried bitgraph/1 proof, for offline answers when the ledger has no row. */
  proof: unknown | null;
  c2pa: boolean;
  reason: string | null;
}
type ClassifiedPath = { kind: "plain"; file: ScannedFile } | CarrierRow;

async function classifyPath(p: string): Promise<ClassifiedPath> {
  const info = await stat(p);
  if (info.isFile() && (await sniffCarrierTail(p, info.size))) {
    if (info.size > MAX_LOADED_BYTES) {
      return {
        kind: "carrier", path: p, status: "too-large", innerDigestB64: null, view: null, proof: null, c2pa: false,
        reason: `a BitGraphed file larger than this tool loads (${Math.round(MAX_LOADED_BYTES / (1024 * 1024))} MiB); judge it offline with: npx @mikeargento/bitgraph-audit "${p}"`,
      };
    }
    const r = await readCarrierFile(p);
    if (r.status === "corrupt" || r.innerDigestB64 === null) {
      return {
        kind: "carrier", path: p, status: "corrupt", innerDigestB64: null, view: null, proof: null, c2pa: false,
        reason: `a carrier block was found at the end of the file but is unreadable: ${r.corruptReason ?? "unspecified"}. A corrupted block, not a forgery; nothing was minted for it.`,
      };
    }
    return {
      kind: "carrier", path: p, status: "ok", innerDigestB64: r.innerDigestB64, view: r.view,
      proof: r.result?.payload?.proof ?? null, c2pa: r.inner !== null && sniffC2paBytes(r.inner), reason: null,
    };
  }
  return { kind: "plain", file: await scanFile(p) };
}

/** Hash the given paths (bounded concurrency). Throws before any network call. */
async function hashPaths(paths: readonly string[]): Promise<string[]> {
  const failures: string[] = [];
  const digests = await mapConcurrent(paths, SCAN_CONCURRENCY, async (p) => {
    try {
      return await sha256FileB64(p);
    } catch (err) {
      failures.push(`${p}: ${err instanceof Error ? err.message : String(err)}`);
      return "";
    }
  });
  if (failures.length > 0) {
    throw new Error(
      `Could not read ${failures.length} file(s); nothing was checked.\n${failures.join("\n")}\nUse absolute paths to existing regular files.`
    );
  }
  return digests;
}

const responseFormatSchema = z
  .enum(["markdown", "json"])
  .default("markdown")
  .describe("markdown (default): human-readable summary. json: complete structured data.");

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

function ok(text: string, structured?: Record<string, unknown>): ToolResult {
  const result: ToolResult = { content: [{ type: "text", text }] };
  if (structured !== undefined) result.structuredContent = structured;
  return result;
}

function fail(message: string): ToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    const retry = err.retryAfterSec !== null ? ` Retry after ${err.retryAfterSec} seconds.` : "";
    return `Error: BitGraph API responded ${err.status}: ${err.message}.${retry}`;
  }
  return `Error: ${err instanceof Error ? err.message : String(err)}`;
}

/** Why the set was not made, and what to do next. Never a success-looking line. */
function setFailureText(err: unknown): string {
  if (err instanceof FuseError) {
    const where = err.member !== null ? ` (member ${err.member})` : "";
    switch (err.code) {
      case "tee-restarting":
        return `Nothing was BitGraphed: ${err.message}. The boundary restarts once a day at 23:59 UTC; run bitgraph_record again with the same paths in a minute.`;
      case "network":
      case "transport":
        return `Nothing is known to be BitGraphed: ${err.message}. Run bitgraph_record again with the same paths: files a set did land come back as on record and are not made again.`;
      default:
        return `Nothing was BitGraphed${where}: ${err.message} (${err.code}). Run bitgraph_record again with the same paths.`;
    }
  }
  return `Nothing was BitGraphed: ${err instanceof Error ? err.message : String(err)}. Run bitgraph_record again with the same paths.`;
}

type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>;
type Report = (progress: number, total: number, message: string) => void;

/** Progress notifications, when the client asked for them with a progress token; a no-op otherwise. */
function progressReporter(extra: Extra): Report {
  const token = extra._meta?.progressToken;
  if (token === undefined) return () => {};
  return (progress, total, message) => {
    void extra.sendNotification({ method: "notifications/progress", params: { progressToken: token, progress, total, message } }).catch(() => {});
  };
}

const PHASES: Record<FuseSetProgress["phase"], string> = {
  hash: "checking members",
  fuse: "fusing",
  tree: "building the tree",
  commit: "committing",
  verify: "verifying",
};

/**
 * A set/2's members are indexed on the site after the commit, evidence by
 * evidence, so a lookup by any member's own digest finds the set. Evidence
 * the site could not take waits here for the life of this process and is
 * sent again before anything else is made: a member the site cannot find
 * by hash would otherwise look new and be made again.
 */
interface PendingIndex {
  setDigest: string;
  epoch: string;
  counter: string;
  members: unknown[];
}
const pendingIndex: PendingIndex[] = [];

/** How many members' evidence is waiting to be indexed (tests read it). */
export function pendingIndexCount(): number {
  return pendingIndex.reduce((n, p) => n + p.members.length, 0);
}

/** Send pending evidence in chunks; what fails stays pending. */
async function flushIndex(config: ApiConfig, report: Report): Promise<{ written: number; pending: number }> {
  const total = pendingIndexCount();
  let written = 0;
  let stopped = false;
  for (const set of pendingIndex) {
    while (set.members.length > 0 && !stopped) {
      const chunk = set.members.slice(0, SET_INDEX_CHUNK);
      let ok = false;
      for (let attempt = 0; attempt < 2 && !ok; attempt++) {
        try {
          await indexSetMembers(config, { setDigest: set.setDigest, epoch: set.epoch, counter: set.counter, members: chunk });
          ok = true;
        } catch {
          ok = false;
        }
      }
      if (!ok) {
        stopped = true;
        break;
      }
      set.members.splice(0, chunk.length);
      written += chunk.length;
      report(written, total, `indexing ${written} of ${total}`);
    }
    if (stopped) break;
  }
  const left = pendingIndex.filter((s) => s.members.length > 0);
  pendingIndex.length = 0;
  pendingIndex.push(...left);
  return { written, pending: total - written };
}

export function buildServer(deps: ServerDeps = {}): McpServer {
  const fuseSetPipeline = deps.fuseSet ?? fuseSetDefault;
  const fuseFilePipeline = deps.fuseFile ?? fuseFileDefault;
  const server = new McpServer(
    {
      name: "bitgraph-mcp-server",
      version: SERVER_VERSION,
    },
    {
      instructions:
        "BitGraph gives a file's bytes a causal position in a public sequence bracketed by Ethereum anchors. bitgraph_record makes ONE BitGraph of everything in a call, files and folders alike: a single file is fused on its own; two or more become one set under one slot, one position, every file's new fused bytes listed by digest in the committed artifact. " +
        "Files are read on this machine and never uploaded or modified; the new bytes are virtual and never written. Recordings are permanent: only make BitGraphs of files the user asked for, and never generate content just to record it. bitgraph_check and bitgraph_get_proof are read-only. " +
        "A BitGraphed file (one that carries its own proof, bitgraph-carrier/1) is recognized by its structure: bitgraph_check judges it offline from the proof inside and states the window, and bitgraph_record never re-mints it, because the envelope is not the recorded thing, the bytes inside are. " +
        "To do work INSIDE a BitGraph, call bitgraph_open BEFORE starting: it returns a position and its commitment; put the commitment string into the task, seal the task with bitgraph_commit within 120 seconds, then record the outputs with bitgraph_record. The task then could not have existed before the position's floor block, and the outputs sit after it.",
    }
  );

  server.registerTool(
    "bitgraph_record",
    {
      title: "Make a BitGraph",
      description:
        "Make a BitGraph of files or folders. Everything in one call becomes ONE BitGraph, the way a drop on the site works: a single file is fused on its own slot; two or more files become a set under a single slot on BitGraph (bitgraph.ing), one position for all of them. " +
        "On this machine each file is read once for its SHA-256 (the origin) and a hasher state; an unused slot is allocated before any new file exists; every file's new fused bytes (the original plus a registered placement carrying the slot's commitment: a 48-byte trailer for JPEG, PNG, GIF, TIFF and TIFF-based raws, BMP, WebP, WAV and AVI, a small tar container with the original first for everything else) are hashed from that state without being written or held; and for a set the canonical list of those digests (above 2,000 files, a Merkle root over it) is committed under the same slot. " +
        "Files are never modified and never uploaded: only digests, the committed artifact and slot records leave the machine. " +
        "Give file paths, directory paths, or both (absolute paths preferred): a directory is every regular file under it, recursively, with hidden entries and symbolic links left out. " +
        "Files already on record are NOT made again by default; they come back as 'on record' with their earliest position. A file can also hold a BitGraph its holder keeps, which no lookup sees. Pass again=true to make a new BitGraph regardless. " +
        "A BitGraphed file (bitgraph-carrier/1, a file that carries its own proof) is never minted, with or without again: its carried proof is judged offline and reported, because the envelope is not the recorded thing, the bytes inside are. " +
        "Positions are permanent and the proof comes back to you to keep, so only BitGraph files the user asked to, and never generate content just to record it. " +
        "Returns one outcome per file: 'fused' (for a set, its row, one of N, and the set's position and proof page; for a single file, its own position and Frame), 'on record', or 'not fused' (with the reason). Keep the proof beside the files; BitGraph does not index it. " +
        "Use bitgraph_check instead when the user only wants to know whether files are on record.",
      inputSchema: {
        paths: z
          .array(z.string().min(1))
          .min(1)
          .max(MAX_PATHS)
          .describe(`File or directory paths to BitGraph, up to ${MAX_PATHS}; a directory expands to its files, up to ${MAX_MEMBERS} in all.`),
        again: z
          .boolean()
          .default(false)
          .describe(
            "false (default): files already on record are returned as-is, nothing made. true: put every file in the set regardless. Outcomes are per unique file content: two paths with identical bytes are one member."
          ),
        response_format: responseFormatSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ paths, again, response_format }, extra) => {
      const config = configFromEnv();
      const report = progressReporter(extra);
      try {
        // 0. Paths to files, before any network call.
        const expanded = await expandPaths(paths, MAX_MEMBERS);
        const files = expanded.files;
        if (files.length === 0) {
          return fail("Error: nothing to BitGraph: the given directories hold no regular files (hidden entries and symbolic links are left out).");
        }

        // 1. Evidence from an earlier set that the site has not indexed yet goes first.
        if (pendingIndexCount() > 0) {
          const flushed = await flushIndex(config, report);
          if (flushed.pending > 0) {
            return fail(
              `Error: ${flushed.pending} members of an earlier set are still waiting to be indexed and the site could not take them; nothing was BitGraphed. Run bitgraph_record again in a moment: the waiting evidence is sent first.`
            );
          }
        }

        // 2. The scan: one pass per file. A BitGraphed file is set aside here,
        //    judged from the proof it carries, and never enters the mint below.
        let scanned = 0;
        report(0, files.length, `hashing ${files.length} files`);
        const classified = await mapConcurrent(files, SCAN_CONCURRENCY, async (p) => {
          const c = await classifyPath(p);
          scanned += 1;
          report(scanned, files.length, `hashed ${scanned} of ${files.length}`);
          return c;
        });
        const scans = classified.filter((c): c is { kind: "plain"; file: ScannedFile } => c.kind === "plain").map((c) => c.file);
        const carriers = classified.filter((c): c is CarrierRow => c.kind === "carrier");

        // 3. Unique by content; the first path names the member, every path is reported.
        const byDigest = new Map<string, { file: ScannedFile; paths: string[] }>();
        for (const s of scans) {
          const entry = byDigest.get(s.digestB64) ?? { file: s, paths: [] };
          entry.paths.push(s.path);
          byDigest.set(s.digestB64, entry);
        }
        const unique = [...byDigest.keys()];

        // 4. What is on record already. A BitGraphed file is looked up by the
        //    digest of its committed bytes, never by the envelope's.
        report(0, 1, "checking BitGraph's copy");
        const carrierInner = [...new Set(carriers.filter((c) => c.innerDigestB64 !== null).map((c) => c.innerDigestB64 as string))];
        const lookups = [...new Set([...unique, ...carrierInner])];
        const checked = lookups.length > 0 ? await batchCheck(config, lookups.map(toUrlSafeB64)) : { results: {} as Record<string, { proofs: Array<{ proof: BitGraphProof }> }> };
        const existing = new Map<string, Array<{ proof: BitGraphProof }>>();
        for (const d of unique) {
          const entry = checked.results[toUrlSafeB64(d)];
          if (entry && entry.proofs.length > 0) existing.set(d, entry.proofs);
        }
        const carrierLedger = new Map<string, Array<{ proof: BitGraphProof }>>();
        for (const d of carrierInner) {
          const entry = checked.results[toUrlSafeB64(d)];
          if (entry && entry.proofs.length > 0) carrierLedger.set(d, entry.proofs);
        }

        // 5. The set: every fresh file (every file, with again), one call.
        const excluded = new Map<string, string>();
        const toMint: ScannedFile[] = [];
        for (const d of again ? unique : unique.filter((x) => !existing.has(x))) {
          const f = (byDigest.get(d) as { file: ScannedFile }).file;
          if (f.state === null && f.size > MAX_LOADED_BYTES) {
            excluded.set(d, "the file changed while it was read and is too large to read again in memory; run bitgraph_record again for it");
            continue;
          }
          toMint.push(f);
        }
        const attempted = new Set(toMint.map((f) => f.digestB64));
        let made: SetSummary | null = null;
        let solo: (FusedSummary & { file: ScannedFile }) | null = null;
        let failure: string | null = null;
        const one = toMint.length === 1 ? (toMint[0] as ScannedFile) : null;
        if (one !== null && one.size <= MAX_SOLO_BYTES) {
          // One file, as a single drop on the site goes: its own slot, its own Frame.
          report(0, 1, "fusing");
          try {
            solo = { ...(await fuseFilePipeline(one, config)), file: one };
          } catch (err) {
            failure = setFailureText(err);
          }
        } else if (toMint.length > 0) {
          const kind: "set/1" | "set/2" = toMint.length > MAX_SET_MEMBERS ? "set/2" : "set/1";
          try {
            made = await fuseSetPipeline(toMint, config, {
              set: kind,
              onProgress: (p) => report(p.done, p.total, `${PHASES[p.phase]} ${p.done} of ${p.total}`),
            });
          } catch (err) {
            failure = setFailureText(err);
          }
        }

        // 6. A set/2 lands with only its root on the ledger; its members are indexed afterwards.
        let index: SetOutcome["index"] = null;
        if (made !== null && made.set === "set/2") {
          const counter = made.proof.commit?.counter;
          const epochId = made.proof.commit?.epochId;
          const members = made.members.map((m) => m.memberProof).filter((e) => e !== undefined);
          if (counter !== undefined && epochId !== undefined && members.length > 0) {
            pendingIndex.push({ setDigest: toUrlSafeB64(made.artifactDigestB64), epoch: toUrlSafeB64(epochId), counter, members });
            index = await flushIndex(config, report);
          }
        }

        // 7. Outcomes.
        let setOutcome: SetOutcome | null = null;
        const memberOf = new Map<string, SetSummary["members"][number]>();
        if (made !== null) {
          for (const m of made.members) memberOf.set(m.originDigestB64, m);
          const { counter, epoch } = positionOf(made.proof);
          setOutcome = {
            set: made.set,
            count: made.count,
            counter,
            epoch,
            artifact_digest: toUrlSafeB64(made.artifactDigestB64),
            proof_url: proofUrl(config.baseUrl, made.artifactDigestB64, counter ?? undefined, made.proof.commit?.epochId),
            manifest_echoed: made.manifestEchoed,
            recovered: made.recovered,
            index,
          };
        }
        const frames: Record<string, unknown> = {};
        if (solo !== null) frames[toUrlSafeB64(solo.artifactDigestB64)] = solo.frame;
        const outcomes: RecordOutcome[] = [];
        for (const [digest, entry] of byDigest) {
          const m = memberOf.get(digest);
          const prior = existing.get(digest);
          for (const path of entry.paths) {
            const base = { path, digest: toUrlSafeB64(digest), ...(entry.file.c2pa ? { c2pa: true as const } : {}) };
            if (solo !== null && solo.file.digestB64 === digest) {
              const { counter, epoch } = positionOf(solo.proof);
              outcomes.push({
                ...base,
                outcome: "fused",
                artifact_digest: toUrlSafeB64(solo.artifactDigestB64),
                placement: solo.placement,
                counter,
                epoch,
                member: null,
                member_count: null,
                total_positions: (prior?.length ?? 0) + 1,
                proof_url: proofUrl(config.baseUrl, solo.artifactDigestB64, counter ?? undefined, solo.proof.commit?.epochId),
              });
            } else if (m !== undefined && made !== null && setOutcome !== null) {
              outcomes.push({
                ...base,
                outcome: "fused",
                artifact_digest: toUrlSafeB64(m.artifactDigestB64),
                placement: m.placement,
                counter: setOutcome.counter,
                epoch: setOutcome.epoch,
                member: m.manifestIndex + 1,
                member_count: made.count,
                total_positions: (prior?.length ?? 0) + 1,
                proof_url: proofUrl(config.baseUrl, digest, setOutcome.counter ?? undefined, made.proof.commit?.epochId),
              });
            } else if (prior && !attempted.has(digest) && !excluded.has(digest)) {
              const first = prior[0];
              const { counter, epoch } = first ? positionOf(first.proof) : { counter: null, epoch: null };
              const row = (first as { member?: { index: number; count: number } } | undefined)?.member;
              outcomes.push({
                ...base,
                outcome: "on record",
                artifact_digest: null,
                placement: null,
                counter,
                epoch,
                member: row ? row.index + 1 : null,
                member_count: row ? row.count : null,
                total_positions: prior.length,
                proof_url: proofUrl(config.baseUrl, digest),
              });
            } else {
              outcomes.push({
                ...base,
                outcome: "not fused",
                artifact_digest: null,
                placement: null,
                counter: null,
                epoch: null,
                member: null,
                member_count: null,
                total_positions: prior?.length ?? 0,
                proof_url: null,
                error: excluded.get(digest) ?? failure ?? "not attempted",
              });
            }
          }
        }
        // 7b. BitGraphed files: judged from the proof inside, never minted.
        for (const c of carriers) {
          if (c.status !== "ok" || c.innerDigestB64 === null) {
            outcomes.push({
              path: c.path, digest: "", outcome: "not fused", artifact_digest: null, placement: null,
              counter: null, epoch: null, member: null, member_count: null, total_positions: 0, proof_url: null,
              error: c.reason ?? "unreadable BitGraphed file",
            });
            continue;
          }
          const inner = c.innerDigestB64;
          const rows = carrierLedger.get(inner);
          const extras = { ...(c.view ? { carrier: c.view } : {}), ...(c.c2pa ? { c2pa: true as const } : {}) };
          if (rows !== undefined && rows.length > 0) {
            const first = rows[0] as { proof: BitGraphProof; member?: { index: number; count: number } };
            const { counter, epoch } = positionOf(first.proof);
            outcomes.push({
              path: c.path, digest: toUrlSafeB64(inner), outcome: "on record", artifact_digest: null, placement: null,
              counter, epoch, member: first.member ? first.member.index + 1 : null, member_count: first.member ? first.member.count : null,
              total_positions: rows.length, proof_url: proofUrl(config.baseUrl, inner), ...extras,
            });
          } else {
            outcomes.push({
              path: c.path, digest: toUrlSafeB64(inner), outcome: "carried", artifact_digest: null, placement: null,
              counter: null, epoch: null, member: null, member_count: null, total_positions: 0, proof_url: null, ...extras,
            });
          }
        }
        // Rows that need reading come first, so a cap drops fused rows, which all share one position.
        const order = { "not fused": 0, "on record": 1, carried: 2, fused: 3 } as const;
        outcomes.sort((a, b) => order[a.outcome] - order[b.outcome]);
        const listed = outcomes.slice(0, ROW_CAP);
        const omitted = outcomes.length - listed.length;
        const summary = {
          files: files.length,
          directories: expanded.directories,
          fused: outcomes.filter((o) => o.outcome === "fused").length,
          on_record: outcomes.filter((o) => o.outcome === "on record").length,
          carried: outcomes.filter((o) => o.outcome === "carried").length,
          not_fused: outcomes.filter((o) => o.outcome === "not fused").length,
        };
        const structured = {
          set: setOutcome,
          results: listed as unknown as Record<string, unknown>[],
          frames,
          omitted,
          summary,
        };
        const markdown = renderRecordMarkdown(outcomes, setOutcome, omitted);
        if (summary.not_fused > 0) {
          return {
            isError: true,
            content: [{ type: "text", text: `${failure ?? `${summary.not_fused} file(s) were left out.`}\n\n${markdown}` }],
            structuredContent: structured,
          };
        }
        if (response_format === "json") {
          const full = { ...structured, set: setOutcome !== null && made !== null ? { ...setOutcome, proof: made.proof } : null };
          return ok(capJson(full).text, structured);
        }
        return ok(markdown, structured);
      } catch (err) {
        return fail(errorText(err));
      }
    }
  );

  server.registerTool(
    "bitgraph_open",
    {
      title: "Open a position before the work",
      description:
        "Ask for a BitGraph position BEFORE starting a task, so the task can be done inside the BitGraph. Returns a fuse_token, the position, its floor block, and the slot's commitment as a string. " +
        "Put the commitment string into the task before running it (the prompt or request you send, a seed, a line in the document, text that must appear in the output), then call bitgraph_commit with the fuse_token and the task file's path within " + SLOT_TTL_SECONDS + " seconds. " +
        "What that gives a stranger: the task could not have existed before the floor block (the commitment did not exist before the position did), and the outputs, recorded afterwards with bitgraph_record, sit at later positions. " +
        "Nothing about the task is sent here; only its digest is, at commit. Positions are permanent: open one only when a task is about to run.",
      inputSchema: {
        response_format: responseFormatSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ response_format }) => {
      const config = configFromEnv();
      try {
        const b = await beginTask(config);
        const structured = { outcome: "opened", task: true, slot_counter: b.slotCounter, epoch: b.epoch, commitment: b.commitment, commitment_base64: b.commitmentB64, floor: b.floor, fuse_token: b.token, expires_in_seconds: SLOT_TTL_SECONDS, instructions: TASK_INSTRUCTIONS };
        if (response_format === "json") return ok(JSON.stringify(structured, null, 2), structured);
        return ok(
          `Opened position ${b.slotCounter} before any work exists. Floor: ${b.floor ? `not before block ${b.floor.block}` : "the sealed proof will carry the signed floor"}.\n\n` +
            `Commitment (put this string into the task): ${b.commitment}\n\n${TASK_INSTRUCTIONS}\n\n` +
            "```json\n" + JSON.stringify({ fuse_token: b.token, commitment: b.commitment, slot_counter: b.slotCounter, epoch: b.epoch, floor: b.floor }, null, 2) + "\n```",
          structured
        );
      } catch (err) {
        return fail(errorText(err));
      }
    }
  );

  server.registerTool(
    "bitgraph_commit",
    {
      title: "Seal the task under its position",
      description:
        "Step two of doing work inside a BitGraph: seal the task bytes that carry the commitment under the position bitgraph_open returned. Give the fuse_token and the path of the task file (the exact request, prompt or document that contains the commitment string), or its SHA-256 (base64) when the bytes are elsewhere. " +
        "With a path, the file is read on this machine, the commitment string is looked for inside it BEFORE anything is sent (a task that does not carry it is refused and the slot stays held), and only the digest travels. " +
        "Returns the proof: keep it beside the task bytes. Then record the outputs with bitgraph_record. Must be called within " + SLOT_TTL_SECONDS + " seconds of bitgraph_open.",
      inputSchema: {
        fuse_token: z.string().min(1).max(8000).describe("The fuse_token bitgraph_open returned."),
        path: z.string().min(1).optional().describe("Path of the task file that contains the commitment string."),
        digest: z.string().min(1).max(100).optional().describe("Instead of a path: SHA-256 of the task bytes, base64 (either form)."),
        response_format: responseFormatSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ fuse_token, path, digest, response_format }) => {
      const config = configFromEnv();
      const state = decodeTaskToken(fuse_token);
      if (state === null) return fail("Error: fuse_token is not one issued by bitgraph_open.");
      if (path === undefined && digest === undefined) return fail("Error: give the task file's path, or its SHA-256 digest.");
      try {
        const sealed = await sealTask(config, state, path !== undefined ? { path } : { digestB64: fromUrlSafeB64(digest!.trim()) });
        const counter = sealed.proof.commit?.counter ?? null;
        const epoch = sealed.proof.commit?.epochId ?? null;
        const floor = sealed.proof.commit?.slotAnchor?.blockNumber ?? null;
        /* The proof goes beside the sealed file, written here, whole. Given
         * only a digest there is no file to put it beside, so it is handed
         * back with the one instruction that matters. */
        let proofPath: string | null = null;
        let proofNote = "";
        if (path !== undefined) {
          try {
            proofPath = await writeProofBeside(path, sealed.proof);
            proofNote = `The proof is written at ${proofPath}, whole; leave it as written. `;
          } catch (err) {
            proofNote = `The proof could not be written beside the file (${errorText(err)}); save the JSON below whole and unedited, every field. `;
          }
        } else {
          proofNote = "Save the JSON below as a file beside the task bytes, whole and unedited, every field, including environment.attestation.reportB64, the long base64 string, copied exactly: a proof missing slotAllocation, environment, or the attestation cannot be verified. ";
        }
        const structured = { outcome: "sealed", slot_counter: state.slot.counter, counter, epoch: epoch ? toUrlSafeB64(epoch) : null, floor_block: floor, artifact_digest: toUrlSafeB64(sealed.artifactDigestB64), commitment_offsets: sealed.offsets, proof_path: proofPath, instructions: proofNote.trim(), proof: sealed.proof };
        if (response_format === "json") return ok(JSON.stringify(structured, null, 2), structured);
        return ok(
          `Sealed the task at position ${counter ?? "?"} (slot ${state.slot.counter}).${floor !== null ? ` Not before block ${floor}.` : ""} ` +
            (sealed.offsets !== null ? `The commitment string was found in the sealed bytes at offset ${sealed.offsets[0]}. ` : "The bytes were not read here; a verifier looks for the commitment string in them. ") +
            proofNote +
            "Record the outputs with bitgraph_record when they exist." +
            (proofPath === null ? "\n\n```json\n" + JSON.stringify(sealed.proof, null, 2) + "\n```" : ""),
          structured
        );
      } catch (err) {
        return fail(errorText(err));
      }
    }
  );

  server.registerTool(
    "bitgraph_check",
    {
      title: "Check for BitGraphs",
      description:
        "Check whether files or digests are on record in BitGraph's copy, without recording anything. " +
        `Accepts file paths and directory paths (every regular file under them, up to ${MAX_CHECK_FILES} in all; hashed locally, only digests are sent) and/or raw SHA-256 digests in standard or URL-safe base64. ` +
        "Returns, per item: on_record (the bytes are on record, as an exact recording, as the original a new file was made from, or as a member of a set), every position by counter, and the proof page URL. " +
        "A BitGraphed file (bitgraph-carrier/1) is recognized by structure: the proof it carries is verified OFFLINE here (signatures, floor identity, block-header witnesses) and its verdict and window are reported, and the lookup uses the committed bytes inside, never the envelope. " +
        "Read-only. Use bitgraph_record to BitGraph files that turn out not to be on record.",
      inputSchema: {
        paths: z
          .array(z.string().min(1))
          .max(MAX_PATHS)
          .optional()
          .describe("File or directory paths to check."),
        digests: z
          .array(z.string().min(1).max(100))
          .max(MAX_CHECK_FILES)
          .optional()
          .describe("SHA-256 digests, base64 (standard or URL-safe form)."),
        response_format: responseFormatSchema,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ paths, digests, response_format }) => {
      const config = configFromEnv();
      try {
        const inputs: Array<{ label: string; standardDigest: string; carrier?: CarrierWindowView; c2pa?: boolean; note?: string }> = [];
        if (paths && paths.length > 0) {
          const { files } = await expandPaths(paths, MAX_CHECK_FILES);
          const classified = await mapConcurrent(files, SCAN_CONCURRENCY, classifyPath);
          classified.forEach((c, i) => {
            const label = files[i] as string;
            if (c.kind === "plain") {
              inputs.push({ label, standardDigest: c.file.digestB64, ...(c.file.c2pa ? { c2pa: true } : {}) });
            } else if (c.status === "ok" && c.innerDigestB64 !== null) {
              inputs.push({ label, standardDigest: c.innerDigestB64, ...(c.view ? { carrier: c.view } : {}), ...(c.c2pa ? { c2pa: true } : {}) });
            } else {
              inputs.push({ label, standardDigest: "", note: c.reason ?? "unreadable BitGraphed file" });
            }
          });
        }
        for (const d of digests ?? []) {
          const trimmed = d.trim();
          if (!looksLikeDigest(trimmed)) {
            return fail(
              `Error: "${d}" is not a base64 SHA-256 digest. Pass 32-byte digests in standard or URL-safe base64, or use paths to hash files locally.`
            );
          }
          inputs.push({ label: d, standardDigest: fromUrlSafeB64(trimmed) });
        }
        if (inputs.length === 0) {
          return fail("Error: provide at least one of paths or digests.");
        }
        if (inputs.length > MAX_CHECK_FILES) {
          return fail(`Error: ${inputs.length} items; check at most ${MAX_CHECK_FILES} at a time.`);
        }

        const lookable = [...new Set(inputs.filter((i) => i.standardDigest !== "").map((i) => toUrlSafeB64(i.standardDigest)))];
        const checked = lookable.length > 0 ? await batchCheck(config, lookable) : { results: {} };

        const outcomes: CheckOutcome[] = inputs.map((input) => {
          const entry = input.standardDigest === "" ? undefined : checked.results[toUrlSafeB64(input.standardDigest)];
          const proofs = entry?.proofs ?? [];
          const positions = proofs.map((p) => ({ ...positionOf(p.proof), ...(p.member ? { member: p.member } : {}) }));
          return {
            input: input.label,
            digest: input.standardDigest === "" ? "" : toUrlSafeB64(input.standardDigest),
            // A fused descendant that names these bytes as origin is not a recording of them.
            // The original and the new file made from it find the same proof.
            on_record: proofs.length > 0,
            positions,
            proof_url: proofs.length > 0 ? proofUrl(config.baseUrl, input.standardDigest) : null,
            ...(input.carrier ? { carrier: input.carrier } : {}),
            ...(input.c2pa ? { c2pa: true } : {}),
            ...(input.note !== undefined ? { note: input.note } : {}),
          };
        });

        const structured = {
          results: outcomes as unknown as Record<string, unknown>[],
          summary: {
            on_record: outcomes.filter((o) => o.on_record).length,
            not_on_record: outcomes.filter((o) => !o.on_record).length,
          },
        };
        const text =
          response_format === "json" ? capJson(structured).text : renderCheckMarkdown(outcomes);
        return ok(text, structured);
      } catch (err) {
        return fail(errorText(err));
      }
    }
  );

  server.registerTool(
    "bitgraph_get_proof",
    {
      title: "Get a BitGraph proof",
      description:
        "Fetch a BitGraph proof and its context: causal position, every position the same bytes occupy, the row a set member holds (one of N), and the two-sided Ethereum anchor window " +
        "(after the floor block's time; before the ANCHORING of the later block, a position bound, never that block's mine time). Look up by digest (base64, either form), by BitGraph number (e.g. '4523' or '#4,523', current epoch), or by file path (hashed locally). " +
        "A path to a BitGraphed file (bitgraph-carrier/1) looks up the committed bytes inside it, and when the ledger has no row the proof the file carries answers offline. " +
        "Exactly one of digest, number, or path is required. Read-only. " +
        "markdown returns a summary; json returns the full proof object with positions and anchor window.",
      inputSchema: {
        digest: z
          .string()
          .min(1)
          .max(100)
          .optional()
          .describe("SHA-256 digest, standard or URL-safe base64."),
        number: z
          .string()
          .min(1)
          .max(30)
          .optional()
          .describe("BitGraph counter number in the current epoch, e.g. '4523' or '#4,523'."),
        path: z.string().min(1).optional().describe("File path; hashed locally."),
        counter: z
          .string()
          .optional()
          .describe("Select a specific causal position by commit counter (with epoch)."),
        epoch: z
          .string()
          .optional()
          .describe("URL-safe epoch id qualifying the counter."),
        response_format: responseFormatSchema,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ digest, number, path, counter, epoch, response_format }) => {
      const config = configFromEnv();
      try {
        const given = [digest, number, path].filter((v) => v !== undefined);
        if (given.length !== 1) {
          return fail("Error: pass exactly one of digest, number, or path.");
        }

        let urlSafeDigest: string;
        let selCounter = counter;
        let carrierRow: CarrierRow | null = null;
        if (number !== undefined) {
          const result = await search(config, number);
          if (!result.found || result.digest === undefined) {
            return fail(
              `Error: no BitGraph found for number "${number}" in the current epoch. Numbers reset each epoch; look up older recordings by digest or path instead.`
            );
          }
          urlSafeDigest = result.digest;
          if (selCounter === undefined && result.counter != null) selCounter = result.counter;
        } else if (path !== undefined) {
          const c = await classifyPath(path);
          if (c.kind === "carrier") {
            if (c.status !== "ok" || c.innerDigestB64 === null) {
              return fail(`Error: ${c.reason ?? "unreadable BitGraphed file"}`);
            }
            carrierRow = c;
            urlSafeDigest = toUrlSafeB64(c.innerDigestB64);
          } else {
            urlSafeDigest = toUrlSafeB64(c.file.digestB64);
          }
        } else {
          const trimmed = (digest as string).trim();
          if (!looksLikeDigest(trimmed)) {
            return fail(
              `Error: "${digest}" is not a base64 SHA-256 digest. Pass a 32-byte digest in standard or URL-safe base64.`
            );
          }
          urlSafeDigest = toUrlSafeB64(fromUrlSafeB64(trimmed));
        }

        // The route compares epochs in URL-safe form; accept either form here.
        const selEpoch = epoch !== undefined ? toUrlSafeB64(fromUrlSafeB64(epoch)) : undefined;
        const detail = await getProofDetail(config, urlSafeDigest, selCounter, selEpoch);
        if (detail.proofs.length === 0) {
          if (carrierRow !== null && carrierRow.view !== null && carrierRow.proof !== null) {
            // The ledger has no row, and the file answers for itself.
            const v = carrierRow.view;
            const synth: ProofDetailResponse = {
              proofs: [{ proof: carrierRow.proof as BitGraphProof }],
              positions: [],
              causalWindow: {
                anchorBefore: v.not_before
                  ? { blockNumber: v.not_before.block, blockHash: v.not_before.hash, etherscanUrl: `https://etherscan.io/block/${v.not_before.block}`, blockTime: v.not_before.time }
                  : null,
                anchorAfter: v.not_after
                  ? { blockNumber: v.not_after.block, blockHash: v.not_after.hash, etherscanUrl: `https://etherscan.io/block/${v.not_after.block}`, blockTime: v.not_after.time }
                  : null,
              },
            };
            const offlineNote = `Judged offline from the proof this BitGraphed file carries: carried proof ${v.verdict}${v.not_after === null ? ", closing anchor NOT FETCHED" : ""}. Not found in this ledger.`;
            const structured = { ...synth, carrier: v } as unknown as Record<string, unknown>;
            if (response_format === "json") return ok(capJson(structured).text, structured);
            return ok(`${renderProofMarkdown(synth, config.baseUrl)}\n\n${offlineNote}`, structured);
          }
          return fail(
            `Not on record: no proof exists for digest ${urlSafeDigest}. Use bitgraph_record to make a BitGraph of the file.`
          );
        }

        if (response_format === "json") {
          const withCarrier = carrierRow?.view ? ({ ...detail, carrier: carrierRow.view } as unknown) : detail;
          const capped = capJson(withCarrier);
          return ok(capped.text, withCarrier as Record<string, unknown>);
        }
        const md = renderProofMarkdown(detail, config.baseUrl);
        const carrierNote = carrierRow?.view
          ? `\n\nThis file carries its own proof (carried proof ${carrierRow.view.verdict}, judged offline).`
          : "";
        return ok(`${md}${carrierNote}`, detail as unknown as Record<string, unknown>);
      } catch (err) {
        return fail(errorText(err));
      }
    }
  );

  return server;
}
