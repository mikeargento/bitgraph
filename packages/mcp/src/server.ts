// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * @mikeargento/bitgraph-mcp: tool definitions.
 *
 * Three gestures, the same three the website has: record a file (take a
 * BitGraph), check whether bytes are on record, fetch a proof. Only SHA-256
 * digests ever leave the machine; file contents are never uploaded.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  ApiError,
  PartialCommitError,
  batchCheck,
  commitDigests,
  configFromEnv,
  getProofDetail,
  search,
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

export const SERVER_VERSION = "0.1.1";

const HASH_CONCURRENCY = 4;
const MAX_FILES = 500;

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

export function buildServer(): McpServer {
  const server = new McpServer({
    name: "bitgraph-mcp-server",
    version: SERVER_VERSION,
  });

  server.registerTool(
    "bitgraph_record",
    {
      title: "Take a BitGraph",
      description:
        "Take a BitGraph of one or more files: record each file's SHA-256 digest at a new causal position in the BitGraph ledger (bitgraph.ing). " +
        "Only the digest leaves the machine; file contents are never uploaded. " +
        "Files whose bytes are already on record are NOT re-recorded by default; they come back as 'on record' with their existing proof. " +
        "Pass again=true to deliberately record already-recorded bytes at a new causal position (BitGraph Again). " +
        "Recordings are permanent: the ledger has 10-year retention and no deletes, so only record files the user asked to record. " +
        "Returns one outcome per file: 'recorded' (newly minted) or 'on record' (was already there), with its position number and proof page URL. " +
        "Use bitgraph_check instead when the user only wants to know whether a file is on record.",
      inputSchema: {
        paths: z
          .array(z.string().min(1))
          .min(1)
          .max(MAX_FILES)
          .describe(`File paths to record (absolute paths preferred), up to ${MAX_FILES}.`),
        attribution: z
          .object({
            name: z.string().max(200).optional().describe("Submitter's name (self-attributed)."),
            title: z.string().max(200).optional(),
            message: z.string().max(2000).optional(),
          })
          .optional()
          .describe(
            "Optional self-attributed submitter's note, stored in the signed proof. Rendered as a note, never as verified identity."
          ),
        again: z
          .boolean()
          .default(false)
          .describe(
            "false (default): files already on record are returned as-is, nothing minted. true: record every file at a new causal position even if already on record. Positions are per unique file content: two paths with identical bytes yield one position."
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
    async ({ paths, attribution, again, response_format }) => {
      const config = configFromEnv();
      try {
        const digests = await hashPaths(paths);

        // Unique digests, first path wins for display; extra paths listed too.
        const byDigest = new Map<string, string[]>();
        digests.forEach((d, i) => {
          const list = byDigest.get(d) ?? [];
          list.push(paths[i] as string);
          byDigest.set(d, list);
        });
        const unique = [...byDigest.keys()];

        const checked = await batchCheck(config, unique.map(toUrlSafeB64));
        const existing = new Map<string, Array<{ proof: BitGraphProof }>>();
        for (const d of unique) {
          const entry = checked.results[toUrlSafeB64(d)];
          if (entry && entry.proofs.length > 0) existing.set(d, entry.proofs);
        }

        const toMint = again ? unique : unique.filter((d) => !existing.has(d));

        let minted: BitGraphProof[] = [];
        let partial: PartialCommitError | null = null;
        if (toMint.length > 0) {
          try {
            minted = await commitDigests(config, toMint, attribution);
            // A 200 with fewer proofs than digests is still a partial failure;
            // never let it reach the success path looking complete.
            if (minted.length < toMint.length) {
              partial = new PartialCommitError(
                minted,
                toMint.length,
                new Error("commit returned fewer proofs than digests sent")
              );
            }
          } catch (err) {
            if (err instanceof PartialCommitError) {
              minted = err.minted;
              partial = err;
            } else {
              throw err;
            }
          }
        }

        const mintedByDigest = new Map<string, BitGraphProof>();
        for (const p of minted) {
          const d = p.artifact?.digestB64;
          if (d !== undefined) mintedByDigest.set(d, p);
        }

        const outcomes: RecordOutcome[] = [];
        for (const [digest, pathList] of byDigest) {
          const mintedProof = mintedByDigest.get(digest);
          const prior = existing.get(digest);
          for (const path of pathList) {
            if (mintedProof) {
              const { counter, epoch } = positionOf(mintedProof);
              outcomes.push({
                path,
                digest: toUrlSafeB64(digest),
                outcome: "recorded",
                counter,
                epoch,
                total_positions: (prior?.length ?? 0) + 1,
                proof_url: proofUrl(
                  config.baseUrl,
                  digest,
                  counter ?? undefined,
                  mintedProof.commit?.epochId
                ),
              });
            } else if (prior) {
              const first = prior[0]?.proof;
              const { counter, epoch } = first ? positionOf(first) : { counter: null, epoch: null };
              outcomes.push({
                path,
                digest: toUrlSafeB64(digest),
                outcome: "on record",
                counter,
                epoch,
                total_positions: prior.length,
                proof_url: proofUrl(config.baseUrl, digest),
              });
            } else {
              // Neither minted nor previously on record: lost to a partial
              // failure. The honest outcome is "not recorded", never a claim.
              outcomes.push({
                path,
                digest: toUrlSafeB64(digest),
                outcome: "not recorded",
                counter: null,
                epoch: null,
                total_positions: 0,
                proof_url: null,
              });
            }
          }
        }

        const structured = {
          results: outcomes as unknown as Record<string, unknown>[],
          summary: {
            recorded: outcomes.filter((o) => o.outcome === "recorded").length,
            on_record: outcomes.filter((o) => o.outcome === "on record").length,
            not_recorded: outcomes.filter((o) => o.outcome === "not recorded").length,
          },
        };

        if (partial) {
          const unrecorded = toMint.length - minted.length;
          const retryGuidance = again
            ? `Some 'not recorded' files MAY still have been recorded server-side if the failure was a timeout. Run bitgraph_check on the 'not recorded' paths first, then re-run bitgraph_record with again=true for only the paths still missing.`
            : `Re-run bitgraph_record with the same paths: already-recorded files will come back as 'on record' and only the missing ones will mint.`;
          return {
            isError: true,
            content: [
              {
                type: "text",
                text:
                  `${errorText(partial.cause2)}\n` +
                  `${minted.length} of ${toMint.length} digests were recorded before the failure (those recordings are permanent); ${unrecorded} were not. ` +
                  `${retryGuidance}\n\n` +
                  renderRecordMarkdown(outcomes),
              },
            ],
            structuredContent: structured,
          };
        }

        const text =
          response_format === "json"
            ? capJson(structured).text
            : renderRecordMarkdown(outcomes);
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
        "Returns, per item: on record or not, every causal position (a file recorded more than once has several), and the proof page URL. " +
        "Read-only. Use bitgraph_record to record files that turn out not to be on record.",
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
            on_record: proofs.some((p) => (p as { kind?: string }).kind !== "fused"),
            fused_descendants: proofs.filter((p) => (p as { kind?: string }).kind === "fused").length,
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
