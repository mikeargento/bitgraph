// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * @mikeargento/bitgraph-mcp: tool definitions.
 *
 * Three gestures, the same three the website has: make a BitGraph, check
 * whether bytes are on record, fetch a proof. Making a BitGraph is one
 * gesture for any number of files: since 2026-10-03 every call makes ONE
 * tree/1, every file one leaf of one Merkle tree under one position (a
 * single file is a tree of one). Each file is read once, on this machine,
 * for its digest and a hasher state; its committed bytes are never written
 * and never held, their digest finished from that state once the slot and
 * its floor exist; with as_is every file goes in as is; and the tree's root
 * document is committed under the same slot. Only digests, that document,
 * slot records and each file's sealed recovery entry (SPEC section 13: anyone
 * who knows the file's SHA-256 can open it, nobody else) leave the machine. File contents are never
 * uploaded and files are never modified. The export/1 file written beside the
 * inputs is how each file proves it is in the BitGraph; the recovery entry is
 * how the file finds its proof again when the export is lost.
 */

import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { FuseError, type FuseTreeProgress } from "@mikeargento/bitgraph";
import {
  ApiError, batchCheck, configFromEnv, getProofDetail, search,
  fromUrlSafeB64, looksLikeDigest, mapConcurrent, sha256FileB64, toUrlSafeB64,
  expandPaths, scanFile, type ScannedFile,
  type CarrierWindowView,
  classifyPath, fuseTreePipeline,
  type CarrierRow, type FuseTreeFn, type FuseFileFn, type FuseSetFn, type TreeSummary,
  exportDataOf, fetchPinnedSpec, writeTreeExports, EXPORT_KINDS, type WrittenExports,
  lookupRecovered, keepRecoveryEntries, flushRecoveryJobs, FLUSH_ON_RECORD_BUDGET_MS, type RecoveredRow,
  SLOT_TTL_SECONDS, beginTask, decodeTaskToken, sealTask, writeProofBeside,
  type BitGraphProof, type ProofDetailResponse,
} from "@mikeargento/bitgraph-sdk";
import {
  capJson,
  positionOf,
  proofUrl,
  renderCheckMarkdown,
  renderProofMarkdown,
  renderRecordMarkdown,
  type CheckOutcome,
  type RecordOutcome,
  type TreeOutcome,
} from "./format.js";
import { TASK_INSTRUCTIONS } from "./instructions.js";

export type { FuseTreeFn, TreeSummary, FuseFileFn, FuseSetFn, FusedSummary, SetSummary } from "@mikeargento/bitgraph-sdk";

export const SERVER_VERSION = "0.9.2";

const SCAN_CONCURRENCY = 4;
/** Paths per call; a directory counts once and expands to its files. */
const MAX_PATHS = 2000;
/** Files one call may BitGraph after directories expand: one tree. */
export const MAX_MEMBERS = 100_000;
/** Files one check may cover after directories expand. */
const MAX_CHECK_FILES = 10_000;
/** Rows the structured result lists in full; every recorded row shares the tree's position. */
export const ROW_CAP = 500;

/** The make pipeline; tests inject a stand-in. */
export interface ServerDeps {
  /** The tree pipeline. Default: the SDK's fuseTreePipeline (the core's fuseTree) against the configured site. */
  fuseTree?: FuseTreeFn;
  /** Superseded (set/1 and set/2); no longer used. Kept so callers that pass it still type-check. */
  fuseSet?: FuseSetFn;
  /** Superseded (the single-file Frame); no longer used. Kept so callers that pass it still type-check. */
  fuseFile?: FuseFileFn;
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

/** Why the tree was not made, and what to do next. Never a success-looking line. */
function makeFailureText(err: unknown): string {
  if (err instanceof FuseError) {
    const where = err.member !== null ? ` (member ${err.member})` : "";
    switch (err.code) {
      case "tee-restarting":
        return `Nothing was BitGraphed: ${err.message}. The boundary restarts once a day at 23:59 UTC; run bitgraph_record again with the same paths in a minute.`;
      case "floor-missing":
        return `Nothing was BitGraphed: ${err.message}. This boundary does not return the floor block a tree needs; it is older than enclave v9.`;
      case "network":
      case "transport":
        return `Nothing is known to be BitGraphed: ${err.message}. Run bitgraph_record again with the same paths: if the tree did land, its files come back as on record once the site indexes them; otherwise they are made again.`;
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

const PHASES: Record<FuseTreeProgress["phase"], string> = {
  hash: "checking members",
  fuse: "placing",
  tree: "building the tree",
  commit: "committing",
  verify: "verifying",
};

export function buildServer(deps: ServerDeps = {}): McpServer {
  const runFuseTree = deps.fuseTree ?? fuseTreePipeline;
  const server = new McpServer(
    {
      name: "bitgraph-mcp-server",
      version: SERVER_VERSION,
    },
    {
      instructions:
        "BitGraph gives a file's bytes a causal position in a public sequence bracketed by Ethereum anchors. bitgraph_record makes ONE BitGraph of everything in a call, files and folders alike: one Merkle tree under one position (tree/1), every file one leaf, a single file a tree of one; with as_is=true the files are recorded as they are. " +
        "Files are read on this machine and never uploaded or modified; the committed bytes are virtual and never written. bitgraph_record writes the BitGraph's export (bitgraph-export/1) beside what was recorded: keep it, because a file proves it is in the BitGraph with its export, the proof alone commits only the tree's root. Recordings are permanent: only make BitGraphs of files the user asked for, and never generate content just to record it. bitgraph_check and bitgraph_get_proof are read-only. " +
        "A BitGraphed file (one that carries its own proof, bitgraph-carrier/1) is recognized by its structure: bitgraph_check judges it offline from the proof inside and states the window, and bitgraph_record never re-mints it, because the envelope is not the recorded thing, the bytes inside are. " +
        "To do work INSIDE a BitGraph, call bitgraph_open BEFORE starting: it returns a position and its commitment; put the commitment string into the task, seal the task with bitgraph_commit within 120 seconds, then record the outputs with bitgraph_record. The task then could not have existed before the position's floor block, and the outputs sit after it.",
    }
  );

  server.registerTool(
    "bitgraph_record",
    {
      title: "Make a BitGraph",
      description:
        "Make a BitGraph of files or folders. Everything in one call becomes ONE BitGraph on bitgraph.ing: one Merkle tree under one position (tree/1), every file one leaf; a single file is a tree of one. " +
        "On this machine each file is read once for its SHA-256 (the origin) and a hasher state; an unused position and its floor block are allocated before any new file exists; every file's committed bytes (the original plus a registered placement carrying the position commitment: a 48-byte trailer for JPEG, PNG, GIF, TIFF and TIFF-based raws, BMP, WebP, WAV and AVI, a small tar container with the original first for everything else) are hashed from that state without being written or held; with as_is=true every file goes in as is (its own digest is its leaf: recorded after the floor block, the bytes themselves not dated), the user's choice and never a size's; and the tree's 84-byte root document is committed under the same position. " +
        "Files are never modified and never uploaded: only digests, the root document, position records and each file's sealed recovery entry (which anyone who knows the file's SHA-256 can open, and nobody else) leave the machine. " +
        "Give file paths, directory paths, or both (absolute paths preferred): a directory is every regular file under it, recursively, with hidden entries and symbolic links left out. " +
        "Files already on record are NOT made again by default; they come back as 'on record' with their earliest position, including a file in an earlier tree, found through its sealed recovery entry and verified from its own bytes. A file can also hold a BitGraph its holder keeps, which no lookup sees. Pass again=true to make a new BitGraph regardless. " +
        "A BitGraphed file (bitgraph-carrier/1, a file that carries its own proof) is never minted, with or without again: its carried proof is judged offline and reported, because the envelope is not the recorded thing, the bytes inside are. " +
        "The BitGraph's export (bitgraph-export/1) is written into export_dir, by default the folder that holds the first path given (a folder's export goes beside the folder, never inside it): the owner's export lists every file's leaf and name, and with a file it proves that file is in this BitGraph with nothing of BitGraph's required; exports='members' or 'both' also writes one export per file. The proof alone commits only the tree's root, so keep the export. " +
        "Positions are permanent, so only BitGraph files the user asked to, and never generate content just to record it. " +
        "Returns one outcome per file: 'fused' (its leaf's committed bytes carry the position commitment), 'recorded' (recorded as is), 'on record', 'carried', or 'not fused' (with the reason), with the file's leaf (one of N), the tree's position and proof page, and the export's path. " +
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
            "false (default): files already on record are returned as-is, nothing made. true: put every file in the tree regardless. Outcomes are per unique file content: two paths with identical bytes are one leaf."
          ),
        export_dir: z
          .string()
          .min(1)
          .optional()
          .describe("Where to write the export files (absolute path preferred). Default: the folder that holds the first path given."),
        exports: z
          .enum(["owner", "members", "both", "none"])
          .default("owner")
          .describe("owner (default): one export listing every file's leaf and name. members: one export per file, each proving that file alone. both. none: write nothing (the json result still carries the leaves)."),
        as_is: z
          .boolean()
          .default(false)
          .describe("false (default): every file is placed, its committed bytes carrying the position commitment (the content floor). true: every file goes in as it is, its own digest its leaf: recorded after the floor block, but the bytes themselves are not dated. For files that must stay byte-identical or that the user does not own; never chosen for the user."),
        recovery: z
          .boolean()
          .default(true)
          .describe("true (default): keep a sealed recovery entry for each file made here, so the file finds its proof again from its bytes alone. false: keep none. Either way a file is looked for in earlier trees before it is called new; only again=true skips that."),
        response_format: responseFormatSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ paths, again, export_dir, exports, as_is, recovery, response_format }, extra) => {
      const config = configFromEnv();
      const report = progressReporter(extra);
      try {
        // 0. Paths to files, before any network call.
        const expanded = await expandPaths(paths, MAX_MEMBERS);
        const files = expanded.files;
        if (files.length === 0) {
          return fail("Error: nothing to BitGraph: the given directories hold no regular files (hidden entries and symbolic links are left out).");
        }

        // 1. The scan: one pass per file. A BitGraphed file is set aside here,
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

        // 2. Unique by content; the first path names the member, every path is reported.
        const byDigest = new Map<string, { file: ScannedFile; paths: string[] }>();
        for (const s of scans) {
          const entry = byDigest.get(s.digestB64) ?? { file: s, paths: [] };
          entry.paths.push(s.path);
          byDigest.set(s.digestB64, entry);
        }
        const unique = [...byDigest.keys()];

        // 3. What is on record already. A BitGraphed file is looked up by the
        //    digest of its committed bytes, never by the envelope's.
        // Entries an earlier record left pending (a site that took no writes,
        // a run cut short) are finished first, inside a small budget.
        if (recovery !== false) {
          report(0, 1, "finishing earlier recovery entries");
          await flushRecoveryJobs(config, { budgetMs: FLUSH_ON_RECORD_BUDGET_MS });
        }
        report(0, 1, "checking BitGraph's copy");
        const carrierInner = [...new Set(carriers.filter((c) => c.innerDigestB64 !== null).map((c) => c.innerDigestB64 as string))];
        const lookups = [...new Set([...unique, ...carrierInner])];
        const checked = lookups.length > 0 ? await batchCheck(config, lookups.map(toUrlSafeB64)) : { results: {} as Record<string, { proofs: Array<{ proof: BitGraphProof }> }> };
        const existing = new Map<string, Array<{ proof: BitGraphProof; member?: { index: number; count: number } } | RecoveredRow>>();
        for (const d of unique) {
          const entry = checked.results[toUrlSafeB64(d)];
          if (entry && entry.proofs.length > 0) existing.set(d, entry.proofs);
        }
        // A tree member is never indexed by its plain hash: before a file is
        // called new, its sealed recovery entry is asked, and a file verified
        // there from its own bytes is on record (the SDK's recovery.ts).
        // A file whose lookup did not complete is neither found nor new (a
        // member of an earlier tree would look exactly like it): refused with
        // the reason, unless again=true asks for a new BitGraph regardless.
        const excluded = new Map<string, string>();
        if (!again) {
          const unknown = unique.filter((d) => !existing.has(d)).map((d) => (byDigest.get(d) as { file: ScannedFile }).file);
          if (unknown.length > 0) {
            report(0, 1, "checking recovery entries");
            const found = await lookupRecovered(unknown, config);
            for (const [d, rows] of found.found) existing.set(d, rows);
            for (const [d, reason] of found.unknown) excluded.set(d, `whether this file is already in a tree is unknown: ${reason}; run bitgraph_record again when the site answers, or with again=true to make a new BitGraph regardless`);
          }
        }
        const carrierLedger = new Map<string, Array<{ proof: BitGraphProof }>>();
        for (const d of carrierInner) {
          const entry = checked.results[toUrlSafeB64(d)];
          if (entry && entry.proofs.length > 0) carrierLedger.set(d, entry.proofs);
        }

        // 4. The tree: every fresh file (every file, with again), one call.
        const toMint: ScannedFile[] = [];
        for (const d of again ? unique : unique.filter((x) => !existing.has(x) && !excluded.has(x))) {
          let f = (byDigest.get(d) as { file: ScannedFile }).file;
          if (f.state === null && !as_is) {
            // Its length changed while it was read: scanned again before any
            // position is opened; still changing, it is refused, whatever its size.
            const rescan = await scanFile(f.path).catch(() => null);
            if (rescan === null || rescan.state === null || rescan.digestB64 !== f.digestB64) {
              excluded.set(d, "the file changed while it was read, twice, so its digest is not the file's; run bitgraph_record again for it when it is still");
              continue;
            }
            f = rescan;
          }
          toMint.push(f);
        }
        const attempted = new Set(toMint.map((f) => f.digestB64));
        let made: TreeSummary | null = null;
        let failure: string | null = null;
        if (toMint.length > 0) {
          try {
            made = await runFuseTree(toMint, config, {
              onProgress: (p) => report(p.done, p.total, `${PHASES[p.phase]} ${p.done} of ${p.total}`),
              ...(as_is ? { asIs: true } : {}),
            });
          } catch (err) {
            failure = makeFailureText(err);
          }
        }

        // 5. The export, beside what was recorded. The tree is made either way;
        //    a write that fails is stated, with what to do, never hidden.
        let tree: TreeOutcome | null = null;
        let written: WrittenExports | null = null;
        const memberExports = new Map<number, string>();
        if (made !== null) {
          const data = await exportDataOf(made, toMint.map((f) => f.path), config);
          const kind = EXPORT_KINDS.includes(exports) ? exports : "owner";
          const dir = export_dir ?? dirname(resolve(paths[0] as string));
          let exportError: string | null = null;
          if (kind !== "none") {
            // SPEC.md goes beside the export when the site serves the very text the proof pins.
            const spec = await fetchPinnedSpec(config, made.proof.attribution?.message ?? "");
            try {
              written = await writeTreeExports(data, { dir, kind, spec });
            } catch (err) {
              // The tree is made and permanent; its export is not lost with the folder that refused it.
              exportError = err instanceof Error ? err.message : String(err);
              const fallback = join(tmpdir(), "bitgraph-exports");
              try {
                written = await writeTreeExports(data, { dir: fallback, kind, spec });
                exportError += `; written to ${written.dir} instead, move it beside the files`;
              } catch (again) {
                exportError += `; the fallback ${fallback} failed too (${again instanceof Error ? again.message : String(again)}); call bitgraph_record again with export_dir set to a folder that can be written and again=true`;
              }
            }
            for (const m of written?.members ?? []) memberExports.set(m.leafIndex, m.path);
          }
          // The tree's recovery entries, after the proof is in hand and never in its way.
          const kept = recovery !== false
            ? await keepRecoveryEntries({ proof: made.proof, rootDocumentHex: made.rootDocumentHex, leavesB64: made.leavesB64, names: data.names }, config)
            : null;
          const { counter, epoch } = positionOf(made.proof);
          tree = {
            format: "tree/1",
            count: made.count,
            counter,
            epoch,
            artifact_digest: toUrlSafeB64(made.artifactDigestB64),
            proof_url: proofUrl(config.baseUrl, made.artifactDigestB64, counter ?? undefined, made.proof.commit?.epochId),
            root_document: made.rootDocumentHex,
            floor_block: made.floor.blockNumber,
            root_document_echoed: made.rootDocumentEchoed,
            recovered: made.recovered,
            export: {
              kind,
              dir: written?.dir ?? (kind === "none" ? null : resolve(dir)),
              owner: written?.owner ?? null,
              members_dir: written?.membersDir ?? null,
              members: written?.members.length ?? 0,
              spec: written?.spec ?? null,
              floor_header: data.floor.header !== null,
              ...(exportError !== null ? { error: exportError } : {}),
            },
            recovery: kept === null ? null : {
              entries: kept.entries,
              kept: kept.kept,
              written: kept.written,
              already_there: kept.alreadyThere,
              salted: kept.salted,
              blocked: kept.blocked,
              pending: kept.pending,
              reason: kept.reason,
              job: kept.job,
            },
          };
        }

        // 6. Outcomes.
        const memberOf = new Map<string, TreeSummary["members"][number]>();
        if (made !== null) for (const m of made.members) memberOf.set((toMint[m.index] as ScannedFile).digestB64, m);
        const outcomes: RecordOutcome[] = [];
        for (const [digest, entry] of byDigest) {
          const m = memberOf.get(digest);
          const prior = existing.get(digest);
          for (const path of entry.paths) {
            const base = { path, digest: toUrlSafeB64(digest), ...(entry.file.c2pa ? { c2pa: true as const } : {}) };
            if (m !== undefined && made !== null && tree !== null) {
              const own = memberExports.get(m.leafIndex);
              outcomes.push({
                ...base,
                outcome: m.placement === "as-is" ? "recorded" : "fused",
                artifact_digest: toUrlSafeB64(m.artifactDigestB64),
                placement: m.placement,
                counter: tree.counter,
                epoch: tree.epoch,
                member: m.leafIndex + 1,
                member_count: made.count,
                total_positions: (prior?.length ?? 0) + 1,
                proof_url: tree.proof_url,
                ...(own !== undefined ? { export: own } : {}),
              });
            } else if (prior && !attempted.has(digest) && !excluded.has(digest)) {
              const first = prior[0];
              const { counter, epoch } = first ? positionOf(first.proof) : { counter: null, epoch: null };
              const row = first?.member;
              // A tree member found through its recovery entry: its proof page is the tree's.
              const treeArtifact = first !== undefined && "tree" in first ? first.proof.artifact?.digestB64 : undefined;
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
                proof_url: treeArtifact !== undefined ? proofUrl(config.baseUrl, treeArtifact, counter ?? undefined, first?.proof.commit?.epochId) : proofUrl(config.baseUrl, digest),
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
        // 6b. BitGraphed files: judged from the proof inside, never minted.
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
        // Rows that need reading come first, so a cap drops recorded rows, which all share one position.
        const order = { "not fused": 0, "on record": 1, carried: 2, recorded: 3, fused: 4 } as const;
        outcomes.sort((a, b) => order[a.outcome] - order[b.outcome]);
        const listed = outcomes.slice(0, ROW_CAP);
        const omitted = outcomes.length - listed.length;
        const summary = {
          files: files.length,
          directories: expanded.directories,
          fused: outcomes.filter((o) => o.outcome === "fused").length,
          recorded: outcomes.filter((o) => o.outcome === "recorded").length,
          on_record: outcomes.filter((o) => o.outcome === "on record").length,
          carried: outcomes.filter((o) => o.outcome === "carried").length,
          not_fused: outcomes.filter((o) => o.outcome === "not fused").length,
        };
        const structured = {
          tree,
          results: listed as unknown as Record<string, unknown>[],
          omitted,
          summary,
        };
        const markdown = renderRecordMarkdown(outcomes, tree, omitted);
        if (summary.not_fused > 0) {
          return {
            isError: true,
            content: [{ type: "text", text: `${failure ?? `${summary.not_fused} file(s) were left out.`}\n\n${markdown}` }],
            structuredContent: structured,
          };
        }
        if (response_format === "json") {
          const full = { ...structured, tree: tree !== null && made !== null ? { ...tree, proof: made.proof } : null };
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
        "Ask for a BitGraph position BEFORE starting a task, so the task can be done inside the BitGraph. Returns a fuse_token, the position, its floor block, and its position commitment as a string. " +
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
        "With a path, the file is read on this machine, the commitment string is looked for inside it BEFORE anything is sent (a task that does not carry it is refused and the position stays held), and only the digest travels. " +
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
          `Sealed the task at position ${counter ?? "?"} (reserved at ${state.slot.counter}).${floor !== null ? ` Not before block ${floor}.` : ""} ` +
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
        const inputs: Array<{ label: string; standardDigest: string; file?: ScannedFile; carrier?: CarrierWindowView; c2pa?: boolean; note?: string }> = [];
        if (paths && paths.length > 0) {
          const { files } = await expandPaths(paths, MAX_CHECK_FILES);
          const classified = await mapConcurrent(files, SCAN_CONCURRENCY, classifyPath);
          classified.forEach((c, i) => {
            const label = files[i] as string;
            if (c.kind === "plain") {
              inputs.push({ label, standardDigest: c.file.digestB64, file: c.file, ...(c.file.c2pa ? { c2pa: true } : {}) });
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
        // A tree's members are never indexed by their own hash (SPEC section 13), so the plain
        // lookup cannot see them: every plain file's sealed recovery entry is asked too, as
        // bitgraph_record asks before making anything (0.9.2; until then this tool called a tree
        // member "not on record", and showed only an older solo position for a file in both).
        // A digest alone carries no bytes to verify a member with, so digests get the plain
        // lookup only. A lookup that did not complete is said, never read as "no".
        const plainFiles = inputs.filter((i): i is typeof i & { file: ScannedFile } => i.file !== undefined).map((i) => i.file);
        const recovered = plainFiles.length > 0 ? await lookupRecovered(plainFiles, config) : null;

        const outcomes: CheckOutcome[] = inputs.map((input) => {
          const entry = input.standardDigest === "" ? undefined : checked.results[toUrlSafeB64(input.standardDigest)];
          const proofs = entry?.proofs ?? [];
          const treeRows = input.file !== undefined ? (recovered?.found.get(input.file.digestB64) ?? []) : [];
          const rows = [...proofs, ...treeRows];
          const unknown = input.file !== undefined ? recovered?.unknown.get(input.file.digestB64) : undefined;
          const note = input.note ?? (rows.length === 0 && unknown !== undefined ? `whether this file is in a tree is unknown: ${unknown}` : undefined);
          const positions = rows.map((p) => ({ ...positionOf(p.proof), ...(p.member ? { member: p.member } : {}) }));
          const treeFirst = treeRows[0]?.proof;
          return {
            input: input.label,
            digest: input.standardDigest === "" ? "" : toUrlSafeB64(input.standardDigest),
            // A fused descendant that names these bytes as origin is not a recording of them.
            // The original and the new file made from it find the same proof.
            on_record: rows.length > 0,
            positions,
            proof_url: proofs.length > 0 ? proofUrl(config.baseUrl, input.standardDigest) : treeFirst && typeof treeFirst.artifact?.digestB64 === "string" ? proofUrl(config.baseUrl, treeFirst.artifact.digestB64, treeFirst.commit?.counter ?? undefined, treeFirst.commit?.epochId) : null,
            ...(input.carrier ? { carrier: input.carrier } : {}),
            ...(input.c2pa ? { c2pa: true } : {}),
            ...(note !== undefined ? { note } : {}),
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
