// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * @mikeargento/bitgraph-mcp: tool definitions.
 *
 * Three gestures, the same three the website has: make a BitGraph of a file,
 * check whether bytes are on record, fetch a proof. Making a BitGraph builds a
 * fused artifact from the file in memory, on this machine, and commits its
 * digest under a slot allocated for it; only SHA-256 digests and slot records
 * ever leave the machine. File contents are never uploaded.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import { fuse, builderFor, placementForBytes, fusedNamesFor } from "@mikeargento/bitgraph";
import {
  ApiError,
  batchCheck,
  configFromEnv,
  getProofDetail,
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
} from "./format.js";
import type { BitGraphProof } from "./types.js";

export const SERVER_VERSION = "0.2.0";

const HASH_CONCURRENCY = 4;
const MAX_FILES = 500;
/** Files above this are refused: the fused artifact is built in memory. */
const MAX_FUSE_BYTES = 256 * 1024 * 1024;

/** What making a BitGraph of one file yields. */
export interface FusedSummary {
  proof: BitGraphProof;
  frame: unknown;
  placement: string;
  artifactDigestB64: string;
  originDigestB64: string;
}
export type FuseFileFn = (bytes: Uint8Array, name: string, config: ApiConfig) => Promise<FusedSummary>;
export interface ServerDeps {
  /** The fuse pipeline; tests inject a stand-in. Default: the core package's fuse() against the configured site. */
  fuseFile?: FuseFileFn;
}

/**
 * The default pipeline, the same one the site's drop and the bitgraph-fuse
 * command run: choose the placement from the bytes, allocate a slot, derive
 * the commitment, build the fused bytes, hash them, commit under that exact
 * slot, verify the returned proof against the bytes.
 */
async function fuseFileDefault(bytes: Uint8Array, name: string, config: ApiConfig): Promise<FusedSummary> {
  const placement = placementForBytes(bytes);
  const { fusedName } = fusedNamesFor(name, placement);
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
    originDigestB64: r.originDigestB64 ?? "",
  };
}

/** Read the given paths whole (bounded concurrency). Throws before any network call. */
async function readPaths(paths: readonly string[]): Promise<Array<{ bytes: Uint8Array; digestB64: string }>> {
  const failures: string[] = [];
  const out = await mapConcurrent(paths, HASH_CONCURRENCY, async (p) => {
    try {
      const buf = await readFile(p);
      if (buf.length > MAX_FUSE_BYTES) throw new Error(`larger than ${MAX_FUSE_BYTES / (1024 * 1024)} MB; the fused artifact is built in memory`);
      const bytes = new Uint8Array(buf);
      const digestB64 = await sha256FileB64(p);
      return { bytes, digestB64 };
    } catch (err) {
      failures.push(`${p}: ${err instanceof Error ? err.message : String(err)}`);
      return { bytes: new Uint8Array(0), digestB64: "" };
    }
  });
  if (failures.length > 0) {
    throw new Error(
      `Could not read ${failures.length} file(s); nothing was BitGraphed.\n${failures.join("\n")}\nUse absolute paths to existing regular files under ${MAX_FUSE_BYTES / (1024 * 1024)} MB.`
    );
  }
  return out;
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

/** Hash the given paths (bounded concurrency). Throws before any network call. */
async function hashPaths(paths: readonly string[]): Promise<string[]> {
  const failures: string[] = [];
  const digests = await mapConcurrent(paths, HASH_CONCURRENCY, async (p) => {
    try {
      return await sha256FileB64(p);
    } catch (err) {
      failures.push(`${p}: ${err instanceof Error ? err.message : String(err)}`);
      return "";
    }
  });
  if (failures.length > 0) {
    throw new Error(
      `Could not read ${failures.length} file(s); nothing was recorded.\n${failures.join("\n")}\nUse absolute paths to existing regular files.`
    );
  }
  return digests;
}

export function buildServer(deps: ServerDeps = {}): McpServer {
  const fuseFile = deps.fuseFile ?? fuseFileDefault;
  const server = new McpServer({
    name: "bitgraph-mcp-server",
    version: SERVER_VERSION,
  });

  server.registerTool(
    "bitgraph_record",
    {
      title: "Make a BitGraph",
      description:
        "Make a BitGraph of one or more files. For each file, on this machine: hash it (the origin), allocate an unused slot in the BitGraph ledger (bitgraph.ing) before any artifact exists, build a new fused artifact from the file in memory with a registered placement (a 48-byte trailer for formats that ignore trailing bytes such as JPEG, PNG, TIFF, WebP; a small tar container otherwise), hash it, and commit that digest under the same slot. " +
        "The file is never modified and never uploaded; only digests and slot records leave the machine. The fused bytes are not kept: the original plus the proof rebuilds them, and the Frame for each file is returned in the structured result. " +
        "Files whose bytes are already on record, as a recording or as the origin of a fused artifact, are NOT BitGraphed again by default; they come back as 'on record' with their earliest position. " +
        "Pass again=true to deliberately make a new fused artifact from a file already on record. " +
        "BitGraphs are permanent: the ledger has 10-year retention and no deletes, so only BitGraph files the user asked to. " +
        "Returns one outcome per file: 'fused' (a new fused artifact, with its placement, position and proof page URL), 'on record', or 'not fused' (with the error). " +
        "Use bitgraph_check instead when the user only wants to know whether a file is on record.",
      inputSchema: {
        paths: z
          .array(z.string().min(1))
          .min(1)
          .max(MAX_FILES)
          .describe(`File paths to BitGraph (absolute paths preferred), up to ${MAX_FILES}.`),
        again: z
          .boolean()
          .default(false)
          .describe(
            "false (default): files already on record are returned as-is, nothing minted. true: make a new fused artifact from every file even if its bytes are already on record. Outcomes are per unique file content: two paths with identical bytes yield one artifact."
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
    async ({ paths, again, response_format }) => {
      const config = configFromEnv();
      try {
        const read = await readPaths(paths);
        // Unique by content, first path wins for the artifact's name; extra paths listed too.
        const byDigest = new Map<string, { bytes: Uint8Array; paths: string[] }>();
        read.forEach((r, i) => {
          const entry = byDigest.get(r.digestB64) ?? { bytes: r.bytes, paths: [] };
          entry.paths.push(paths[i] as string);
          byDigest.set(r.digestB64, entry);
        });
        const unique = [...byDigest.keys()];
        const checked = await batchCheck(config, unique.map(toUrlSafeB64));
        const existing = new Map<string, Array<{ proof: BitGraphProof }>>();
        for (const d of unique) {
          const entry = checked.results[toUrlSafeB64(d)];
          if (entry && entry.proofs.length > 0) existing.set(d, entry.proofs);
        }
        const toMint = again ? unique : unique.filter((d) => !existing.has(d));
        const fused = new Map<string, FusedSummary>();
        const failed = new Map<string, string>();
        for (const d of toMint) {
          const entry = byDigest.get(d) as { bytes: Uint8Array; paths: string[] };
          const name = (entry.paths[0] as string).split(/[\\/]/).pop() ?? "file";
          try {
            fused.set(d, await fuseFile(entry.bytes, name, config));
          } catch (err) {
            failed.set(d, err instanceof Error ? err.message : String(err));
          }
        }
        const outcomes: RecordOutcome[] = [];
        const frames: Record<string, unknown> = {};
        for (const [digest, entry] of byDigest) {
          const made = fused.get(digest);
          const prior = existing.get(digest);
          for (const path of entry.paths) {
            if (made) {
              const { counter, epoch } = positionOf(made.proof);
              frames[toUrlSafeB64(made.artifactDigestB64)] = made.frame;
              outcomes.push({
                path,
                digest: toUrlSafeB64(digest),
                outcome: "fused",
                artifact_digest: toUrlSafeB64(made.artifactDigestB64),
                placement: made.placement,
                counter,
                epoch,
                total_positions: (prior?.length ?? 0) + 1,
                proof_url: proofUrl(config.baseUrl, made.artifactDigestB64, counter ?? undefined, made.proof.commit?.epochId),
              });
            } else if (prior && !failed.has(digest)) {
              const first = prior[0]?.proof;
              const { counter, epoch } = first ? positionOf(first) : { counter: null, epoch: null };
              outcomes.push({
                path,
                digest: toUrlSafeB64(digest),
                outcome: "on record",
                artifact_digest: null,
                placement: null,
                counter,
                epoch,
                total_positions: prior.length,
                proof_url: proofUrl(config.baseUrl, digest),
              });
            } else {
              outcomes.push({
                path,
                digest: toUrlSafeB64(digest),
                outcome: "not fused",
                artifact_digest: null,
                placement: null,
                counter: null,
                epoch: null,
                total_positions: prior?.length ?? 0,
                proof_url: null,
                error: failed.get(digest) ?? "not attempted",
              });
            }
          }
        }
        const structured = {
          results: outcomes as unknown as Record<string, unknown>[],
          frames,
          summary: {
            fused: outcomes.filter((o) => o.outcome === "fused").length,
            on_record: outcomes.filter((o) => o.outcome === "on record").length,
            not_fused: outcomes.filter((o) => o.outcome === "not fused").length,
          },
        };
        if (failed.size > 0) {
          const guidance = again
            ? "A file marked 'not fused' MAY still have been BitGraphed if the failure was a timeout: run bitgraph_check on it first, then re-run bitgraph_record with again=true for only the files still missing."
            : "Re-run bitgraph_record with the same paths: files already on record come back as 'on record' and only the missing ones are BitGraphed.";
          return {
            isError: true,
            content: [{ type: "text", text: `${fused.size} of ${toMint.length} files were BitGraphed; ${failed.size} failed. ${guidance}\n\n${renderRecordMarkdown(outcomes)}` }],
            structuredContent: structured,
          };
        }
        const text = response_format === "json" ? capJson(structured).text : renderRecordMarkdown(outcomes);
        return ok(text, structured);
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
        "Accepts file paths (hashed locally; only digests are sent) and/or raw SHA-256 digests in standard or URL-safe base64. " +
        "Returns, per item: on_record (the bytes are on record, as an exact recording or as the original a new file was made from), every position by counter, and the proof page URL. " +
        "Read-only. Use bitgraph_record to BitGraph files that turn out not to be on record.",
      inputSchema: {
        paths: z
          .array(z.string().min(1))
          .max(MAX_FILES)
          .optional()
          .describe("File paths to check."),
        digests: z
          .array(z.string().min(1).max(100))
          .max(MAX_FILES)
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
          const hashed = await hashPaths(paths);
          hashed.forEach((d, i) => inputs.push({ label: paths[i] as string, standardDigest: d }));
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

        const checked = await batchCheck(
          config,
          inputs.map((i) => toUrlSafeB64(i.standardDigest))
        );

        const outcomes: CheckOutcome[] = inputs.map((input) => {
          const entry = checked.results[toUrlSafeB64(input.standardDigest)];
          const proofs = entry?.proofs ?? [];
          const positions = proofs.map((p) => positionOf(p.proof));
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
        "Fetch a BitGraph proof and its context: causal position, every position the same bytes occupy, and the two-sided Ethereum anchor window " +
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
            `Not on record: no proof exists for digest ${urlSafeDigest}. Use bitgraph_record to record the file.`
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
