// Copyright (c) 2025-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

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
  bindFiles,
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

export const SERVER_VERSION = "0.12.0";

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
  /** Add structuredContent to markdown answers too (default: only response_format "json" carries it). */
  structuredAlways?: boolean;
  /** The bind (enclave v12's one way to make a BitGraph). Default: the SDK's bindFiles against the configured site. */
  bind?: typeof bindFiles;
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
        return `Nothing was BitGraphed: ${err.message}. This boundary does not return the floor block a tree needs (a Base block from enclave v10, an Ethereum anchor from v9); it is older than enclave v9, or the floor could not be read.`;
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
  /* A markdown answer goes out as text alone unless asked otherwise: clients that see structuredContent show it in
   * place of the text, so a markdown answer that carried it arrived as raw JSON (Claude Code, 2026-10-11).
   * response_format "json" always carries it; BITGRAPH_MCP_STRUCTURED=always (or deps) adds it to markdown too. */
  const structuredAlways = deps.structuredAlways ?? process.env.BITGRAPH_MCP_STRUCTURED === "always";
  const md = (text: string, structured: Record<string, unknown>): ToolResult => (structuredAlways ? ok(text, structured) : ok(text));
  const server = new McpServer(
    {
      name: "bitgraph-mcp-server",
      version: SERVER_VERSION,
    },
    {
      instructions:
        "BitGraph is one atomic action inside a hardware enclave: a fresh value nobody can see takes one count, and a file's SHA-256 is bound at the very next count, both signed together with the enclave's own time. It proves the bits were bound after a moment nobody could predict, and could not have been bound before it; it says nothing about how old the content is. " +
        "bitgraph_record is the one way to make a BitGraph: each file is hashed on this machine, never uploaded or changed, and its proof is saved beside it as <file>.bitgraph.json. BitGraphs are permanent: only make them of files the user asked for, and never generate content just to record it. " +
        "bitgraph_check and bitgraph_get_proof are read-only. Two BitGraphs bracket everything made between them: make one before the work, do the work, make one of the result.",
    }
  );

  server.registerTool(
    "bitgraph_record",
    {
      title: "Make a BitGraph",
      description:
        "Make a BitGraph of each file: one atomic action inside BitGraph's enclave per file, a fresh nonce nobody can see, then the file's SHA-256 at the very next count, signed together with the enclave's own time. " +
        "Proves the file's bits were bound after a moment nobody could predict. Files are hashed on this machine and never uploaded or changed; only the digest leaves. " +
        "Each proof is saved beside its file as <file>.bitgraph.json (write=false: not saved; the json result still carries it). " +
        "Give file paths, directory paths, or both (absolute paths preferred): a directory is every regular file under it, recursively, with hidden entries and symbolic links left out. " +
        "Permanent: only make BitGraphs of files the user asked for, and never generate content just to record it. " +
        "To bracket work, make a BitGraph before it (for example of the task) and one of the result after: everything between the two was bound after the first and before the second. " +
        "Use bitgraph_check instead when the user only wants to know whether files already have one.",
      inputSchema: {
        paths: z
          .array(z.string().min(1))
          .min(1)
          .max(MAX_PATHS)
          .describe(`File or directory paths, up to ${MAX_PATHS}; a directory expands to its files, up to ${MAX_MEMBERS} in all.`),
        write: z.boolean().default(true).describe("true (default): save each proof beside its file as <file>.bitgraph.json."),
        response_format: responseFormatSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ paths, write, response_format }) => {
      const config = configFromEnv();
      try {
        const bound = await (deps.bind ?? bindFiles)(config, { paths }, { write });
        const structured = {
          made: bound.map((b) => ({ path: b.path, digest: b.digestB64, number: b.number, counts: b.counts, proof_url: b.proofUrl, proof_path: b.wrote })),
        };
        if (response_format === "json") {
          return ok(capJson({ ...structured, proofs: bound.map((b) => b.proof) }).text, structured);
        }
        const lines = bound.map((b) => `- BitGraph #${b.number ?? "?"} (counts ${b.counts?.join(", ") ?? "?"}): ${b.path ?? b.digestB64}\n  ${b.wrote !== null ? `proof saved: ${b.wrote}` : "proof not saved (write=false)"}\n  ${b.proofUrl}`);
        return md(
          `Made ${bound.length} BitGraph${bound.length === 1 ? "" : "s"}:\n${lines.join("\n")}\n\nKeep each proof file whole and unedited beside its file: it verifies offline with @mikeargento/bitgraph-verify.`,
          structured
        );
      } catch (err) {
        const done = (err as { bound?: unknown[] }).bound;
        const partial = Array.isArray(done) && done.length > 0 ? ` ${done.length} were made before it stopped; check the rest with bitgraph_check before trying again.` : "";
        return fail(errorText(err) + partial);
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
        if (response_format === "json") return ok(capJson(structured).text, structured);
        return md(renderCheckMarkdown(outcomes), structured);
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
        "Fetch a BitGraph proof and its context: causal position, every position the same bytes occupy, the row a set member holds (one of N), and its window " +
        "(after the floor block's time, a Base block, or an Ethereum block on earlier proofs; existed by the Base ceiling block, on records from 2026-09-29 22:43 UTC on; earlier records have no ceiling in time). Look up by digest (base64, either form), by BitGraph number (e.g. '4523' or '#4,523', current epoch), or by file path (hashed locally). " +
        "A path to a BitGraphed file (bitgraph-carrier/1) looks up the committed bytes inside it, and when the ledger has no row the proof the file carries answers offline. " +
        "Exactly one of digest, number, or path is required. Read-only. " +
        "markdown returns a summary; json returns the full proof object with positions and window.",
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
            return md(`${renderProofMarkdown(synth, config.baseUrl)}\n\n${offlineNote}`, structured);
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
        const mdText = renderProofMarkdown(detail, config.baseUrl);
        const carrierNote = carrierRow?.view
          ? `\n\nThis file carries its own proof (carried proof ${carrierRow.view.verdict}, judged offline).`
          : "";
        return md(`${mdText}${carrierNote}`, detail as unknown as Record<string, unknown>);
      } catch (err) {
        return fail(errorText(err));
      }
    }
  );

  return server;
}
