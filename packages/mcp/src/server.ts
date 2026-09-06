// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

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
import { expandPaths, fusedDigestFor, scanFile, type ScannedFile } from "./scan.js";
import type { BitGraphProof } from "./types.js";

export const SERVER_VERSION = "0.4.0";

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
        "BitGraph gives a file's bytes a causal position in a public ledger bracketed by Ethereum anchors. bitgraph_record makes ONE BitGraph of everything in a call, files and folders alike: a single file is fused on its own; two or more become one set under one slot, one position, every file's new fused bytes listed by digest in the committed artifact. " +
        "Files are read on this machine and never uploaded or modified; the new bytes are virtual and never written. Recordings are permanent: only make BitGraphs of files the user asked for, and never generate content just to record it. bitgraph_check and bitgraph_get_proof are read-only.",
    }
  );

  server.registerTool(
    "bitgraph_record",
    {
      title: "Make a BitGraph",
      description:
        "Make a BitGraph of files or folders. Everything in one call becomes ONE BitGraph, the way a drop on the site works: a single file is fused on its own slot; two or more files become a set under a single slot in the BitGraph ledger (bitgraph.ing), one position for all of them. " +
        "On this machine each file is read once for its SHA-256 (the origin) and a hasher state; an unused slot is allocated before any new file exists; every file's new fused bytes (the original plus a registered placement carrying the slot's commitment: a 48-byte trailer for JPEG, PNG, GIF, TIFF and TIFF-based raws, BMP, WebP, WAV and AVI, a small tar container with the original first for everything else) are hashed from that state without being written or held; and for a set the canonical list of those digests (above 2,000 files, a Merkle root over it) is committed under the same slot. " +
        "Files are never modified and never uploaded: only digests, the committed artifact and slot records leave the machine. " +
        "Give file paths, directory paths, or both (absolute paths preferred): a directory is every regular file under it, recursively, with hidden entries and symbolic links left out. " +
        "Files already on record (recorded, or the origin of a fused file) are NOT made again by default; they come back as 'on record' with their earliest position. Pass again=true to make a new BitGraph of them deliberately. " +
        "BitGraphs are permanent: the ledger has 10-year retention and no deletes, so only BitGraph files the user asked to, and never generate content just to record it. " +
        "Returns one outcome per file: 'fused' (for a set, its row, one of N, and the set's position and proof page; for a single file, its own position and Frame), 'on record', or 'not fused' (with the reason). A lookup by any file's own digest finds its BitGraph. " +
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
            "false (default): files already on record are returned as-is, nothing made. true: put every file in the set even if its bytes are already on record. Outcomes are per unique file content: two paths with identical bytes are one member."
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

        // 2. The scan: one pass per file.
        let scanned = 0;
        report(0, files.length, `hashing ${files.length} files`);
        const scans = await mapConcurrent(files, SCAN_CONCURRENCY, async (p) => {
          const s = await scanFile(p);
          scanned += 1;
          report(scanned, files.length, `hashed ${scanned} of ${files.length}`);
          return s;
        });

        // 3. Unique by content; the first path names the member, every path is reported.
        const byDigest = new Map<string, { file: ScannedFile; paths: string[] }>();
        for (const s of scans) {
          const entry = byDigest.get(s.digestB64) ?? { file: s, paths: [] };
          entry.paths.push(s.path);
          byDigest.set(s.digestB64, entry);
        }
        const unique = [...byDigest.keys()];

        // 4. What is on record already.
        report(0, 1, "checking the ledger");
        const checked = await batchCheck(config, unique.map(toUrlSafeB64));
        const existing = new Map<string, Array<{ proof: BitGraphProof }>>();
        for (const d of unique) {
          const entry = checked.results[toUrlSafeB64(d)];
          if (entry && entry.proofs.length > 0) existing.set(d, entry.proofs);
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
            const base = { path, digest: toUrlSafeB64(digest) };
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
        // Rows that need reading come first, so a cap drops fused rows, which all share one position.
        const order = { "not fused": 0, "on record": 1, fused: 2 } as const;
        outcomes.sort((a, b) => order[a.outcome] - order[b.outcome]);
        const listed = outcomes.slice(0, ROW_CAP);
        const omitted = outcomes.length - listed.length;
        const summary = {
          files: files.length,
          directories: expanded.directories,
          fused: outcomes.filter((o) => o.outcome === "fused").length,
          on_record: outcomes.filter((o) => o.outcome === "on record").length,
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
    "bitgraph_check",
    {
      title: "Check for BitGraphs",
      description:
        "Check whether files or digests are on record in the BitGraph ledger, without recording anything. " +
        `Accepts file paths and directory paths (every regular file under them, up to ${MAX_CHECK_FILES} in all; hashed locally, only digests are sent) and/or raw SHA-256 digests in standard or URL-safe base64. ` +
        "Returns, per item: on_record (the bytes are on record, as an exact recording, as the original a new file was made from, or as a member of a set), every position by counter, and the proof page URL. " +
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
        const inputs: Array<{ label: string; standardDigest: string }> = [];
        if (paths && paths.length > 0) {
          const { files } = await expandPaths(paths, MAX_CHECK_FILES);
          const hashed = await hashPaths(files);
          hashed.forEach((d, i) => inputs.push({ label: files[i] as string, standardDigest: d }));
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

        const checked = await batchCheck(
          config,
          inputs.map((i) => toUrlSafeB64(i.standardDigest))
        );

        const outcomes: CheckOutcome[] = inputs.map((input) => {
          const entry = checked.results[toUrlSafeB64(input.standardDigest)];
          const proofs = entry?.proofs ?? [];
          const positions = proofs.map((p) => ({ ...positionOf(p.proof), ...(p.member ? { member: p.member } : {}) }));
          return {
            input: input.label,
            digest: toUrlSafeB64(input.standardDigest),
            // A fused descendant that names these bytes as origin is not a recording of them.
            // The original and the new file made from it find the same proof.
            on_record: proofs.length > 0,
            positions,
            proof_url: proofs.length > 0 ? proofUrl(config.baseUrl, input.standardDigest) : null,
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
        "('BitGraphed between X and Y'). Look up by digest (base64, either form), by BitGraph number (e.g. '4523' or '#4,523', current epoch), or by file path (hashed locally). " +
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
          const hashed = await hashPaths([path]);
          urlSafeDigest = toUrlSafeB64(hashed[0] as string);
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
          return fail(
            `Not on record: no proof exists for digest ${urlSafeDigest}. Use bitgraph_record to make a BitGraph of the file.`
          );
        }

        if (response_format === "json") {
          const capped = capJson(detail);
          return ok(capped.text, detail as unknown as Record<string, unknown>);
        }
        return ok(renderProofMarkdown(detail, config.baseUrl), detail as unknown as Record<string, unknown>);
      } catch (err) {
        return fail(errorText(err));
      }
    }
  );

  return server;
}
