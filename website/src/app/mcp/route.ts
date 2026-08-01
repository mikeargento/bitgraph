/**
 * Remote MCP endpoint: https://bitgraph.ing/mcp (Streamable HTTP, stateless).
 *
 * The same three gestures as the stdio package (@mikeargento/bitgraph-mcp),
 * digests-only: a hosted server has no caller filesystem, so callers hash
 * their files where the files live and send SHA-256 digests. File contents
 * are never uploaded, which is also why this endpoint stays thin: it is a
 * translator in front of the site's own public API, nothing more.
 */

import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import {
  ApiError,
  PartialCommitError,
  apiBaseUrl,
  batchCheck,
  commitDigests,
  getProofDetail,
  search,
} from "@/lib/mcp/api";
import { fromUrlSafeB64, looksLikeDigest, toUrlSafeB64 } from "@/lib/mcp/encoding";
import {
  capJson,
  positionOf,
  proofUrl,
  renderCheckMarkdown,
  renderProofMarkdown,
  renderRecordMarkdown,
  type CheckOutcome,
  type RecordOutcome,
} from "@/lib/mcp/format";
import type { BitGraphProof } from "@/lib/mcp/types";

export const dynamic = "force-dynamic";
// One commit chunk of TEE work (~1s/digest) must finish inside this window.
export const maxDuration = 60;

const SERVER_VERSION = "0.1.0";

// Record stays under one commit chunk so a call is all-or-nothing per chunk
// and fits maxDuration. Check is a cheap S3 lookup; the batch endpoint's cap.
const MAX_RECORD = 40;
const MAX_CHECK = 500;

const DIGEST_HINT =
  "A digest is the SHA-256 of the file's bytes, base64-encoded (standard or URL-safe form both accepted), " +
  'e.g. shell: openssl dgst -sha256 -binary FILE | base64 · python: base64.b64encode(hashlib.sha256(data).digest()).decode()';

const responseFormatSchema = z
  .enum(["markdown", "json"])
  .default("markdown")
  .describe("markdown (default): human-readable summary. json: complete structured data.");

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

function ok(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
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

/** Validate digest strings; returns standard-base64 forms or a failure message. */
function normalizeDigests(inputs: readonly string[]): { standard: string[] } | { error: string } {
  const standard: string[] = [];
  for (const d of inputs) {
    const trimmed = d.trim();
    if (!looksLikeDigest(trimmed)) {
      return {
        error: `Error: "${d}" is not a base64 SHA-256 digest. ${DIGEST_HINT}`,
      };
    }
    standard.push(fromUrlSafeB64(trimmed));
  }
  return { standard };
}

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "bitgraph_record",
      {
        title: "Take a BitGraph",
        description:
          "Take a BitGraph: record SHA-256 digests of existing files at new causal positions in the BitGraph ledger (bitgraph.ing). " +
          DIGEST_HINT + ". " +
          "Only digests are sent; file contents are never uploaded. Hash an existing file where it lives; never generate content just to record it, and only record files the user asked to record: recordings are permanent (10-year retention, no deletes). " +
          "Digests already on record are NOT re-recorded by default; they come back as 'on record' with their existing proof. " +
          "Pass again=true to deliberately record already-recorded bytes at a new causal position (BitGraph Again). " +
          "Returns one outcome per digest: 'recorded' (newly minted) or 'on record' (was already there), with its position number and proof page URL. " +
          "Use bitgraph_check instead when the user only wants to know whether a file is on record.",
        inputSchema: z.object({
          digests: z
            .array(z.string().min(1).max(100))
            .min(1)
            .max(MAX_RECORD)
            .describe(`SHA-256 digests to record, base64 (either form), up to ${MAX_RECORD}.`),
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
              "false (default): digests already on record are returned as-is, nothing minted. true: record every digest at a new causal position even if already on record."
            ),
          response_format: responseFormatSchema,
        }),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      async ({ digests, attribution, again, response_format }) => {
        try {
          const normalized = normalizeDigests(digests);
          if ("error" in normalized) return fail(normalized.error);

          // Unique digests, first input string wins for display.
          const byDigest = new Map<string, string[]>();
          normalized.standard.forEach((d, i) => {
            const list = byDigest.get(d) ?? [];
            list.push(digests[i] as string);
            byDigest.set(d, list);
          });
          const unique = [...byDigest.keys()];

          const checked = await batchCheck(unique.map(toUrlSafeB64));
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
              minted = await commitDigests(toMint, attribution);
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

          const baseUrl = apiBaseUrl();
          const outcomes: RecordOutcome[] = [];
          for (const [digest, inputList] of byDigest) {
            const mintedProof = mintedByDigest.get(digest);
            const prior = existing.get(digest);
            for (const input of inputList) {
              if (mintedProof) {
                const { counter, epoch } = positionOf(mintedProof);
                outcomes.push({
                  input,
                  digest: toUrlSafeB64(digest),
                  outcome: "recorded",
                  counter,
                  epoch,
                  total_positions: (prior?.length ?? 0) + 1,
                  proof_url: proofUrl(baseUrl, digest, counter ?? undefined, mintedProof.commit?.epochId),
                });
              } else if (prior) {
                const first = prior[0]?.proof;
                const { counter, epoch } = first ? positionOf(first) : { counter: null, epoch: null };
                outcomes.push({
                  input,
                  digest: toUrlSafeB64(digest),
                  outcome: "on record",
                  counter,
                  epoch,
                  total_positions: prior.length,
                  proof_url: proofUrl(baseUrl, digest),
                });
              } else {
                // Neither minted nor previously on record: lost to a partial
                // failure. The honest outcome is "not recorded", never a claim.
                outcomes.push({
                  input,
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

          if (partial) {
            const unrecorded = toMint.length - minted.length;
            const retryGuidance = again
              ? `Some 'not recorded' digests MAY still have been recorded server-side if the failure was a timeout. Run bitgraph_check on the 'not recorded' digests first, then re-run bitgraph_record with again=true for only the digests still missing.`
              : `Re-run bitgraph_record with the same digests: already-recorded ones will come back as 'on record' and only the missing ones will mint.`;
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
            };
          }

          const structured = {
            results: outcomes,
            summary: {
              recorded: outcomes.filter((o) => o.outcome === "recorded").length,
              on_record: outcomes.filter((o) => o.outcome === "on record").length,
              not_recorded: outcomes.filter((o) => o.outcome === "not recorded").length,
            },
          };
          return ok(
            response_format === "json" ? capJson(structured).text : renderRecordMarkdown(outcomes)
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
          "Check whether SHA-256 digests are on record in the BitGraph ledger, without recording anything. " +
          DIGEST_HINT + ". " +
          "Returns, per digest: on record or not, every causal position (a file recorded more than once has several), and the proof page URL. " +
          "Read-only. Use bitgraph_record to record digests that turn out not to be on record.",
        inputSchema: z.object({
          digests: z
            .array(z.string().min(1).max(100))
            .min(1)
            .max(MAX_CHECK)
            .describe(`SHA-256 digests, base64 (standard or URL-safe form), up to ${MAX_CHECK}.`),
          response_format: responseFormatSchema,
        }),
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      async ({ digests, response_format }) => {
        try {
          const normalized = normalizeDigests(digests);
          if ("error" in normalized) return fail(normalized.error);

          const checked = await batchCheck(normalized.standard.map(toUrlSafeB64));

          const baseUrl = apiBaseUrl();
          const outcomes: CheckOutcome[] = normalized.standard.map((standardDigest, i) => {
            const entry = checked.results[toUrlSafeB64(standardDigest)];
            const proofs = entry?.proofs ?? [];
            const positions = proofs.map((p) => positionOf(p.proof));
            return {
              input: digests[i] as string,
              digest: toUrlSafeB64(standardDigest),
              on_record: proofs.length > 0,
              positions,
              proof_url: proofs.length > 0 ? proofUrl(baseUrl, standardDigest) : null,
            };
          });

          const structured = {
            results: outcomes,
            summary: {
              on_record: outcomes.filter((o) => o.on_record).length,
              not_on_record: outcomes.filter((o) => !o.on_record).length,
            },
          };
          return ok(
            response_format === "json" ? capJson(structured).text : renderCheckMarkdown(outcomes)
          );
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
          "('BitGraphed between X and Y'). Look up by digest (base64, either form) or by BitGraph number (e.g. '4523' or '#4,523', current epoch). " +
          "Exactly one of digest or number is required. Read-only. " +
          "markdown returns a summary; json returns the full proof object with positions and anchor window.",
        inputSchema: z.object({
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
          counter: z
            .string()
            .optional()
            .describe("Select a specific causal position by commit counter (with epoch)."),
          epoch: z
            .string()
            .optional()
            .describe("URL-safe epoch id qualifying the counter."),
          response_format: responseFormatSchema,
        }),
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      async ({ digest, number, counter, epoch, response_format }) => {
        try {
          const given = [digest, number].filter((v) => v !== undefined);
          if (given.length !== 1) {
            return fail("Error: pass exactly one of digest or number.");
          }

          let urlSafeDigest: string;
          let selCounter = counter;
          if (number !== undefined) {
            const result = await search(number);
            if (!result.found || result.digest === undefined) {
              return fail(
                `Error: no BitGraph found for number "${number}" in the current epoch. Numbers reset each epoch; look up older recordings by digest instead.`
              );
            }
            urlSafeDigest = result.digest;
            if (selCounter === undefined && result.counter != null) selCounter = result.counter;
          } else {
            const trimmed = (digest as string).trim();
            if (!looksLikeDigest(trimmed)) {
              return fail(`Error: "${digest}" is not a base64 SHA-256 digest. ${DIGEST_HINT}`);
            }
            urlSafeDigest = toUrlSafeB64(fromUrlSafeB64(trimmed));
          }

          // The route compares epochs in URL-safe form; accept either form here.
          const selEpoch = epoch !== undefined ? toUrlSafeB64(fromUrlSafeB64(epoch)) : undefined;
          const detail = await getProofDetail(urlSafeDigest, selCounter, selEpoch);
          if (detail.proofs.length === 0) {
            return fail(
              `Not on record: no proof exists for digest ${urlSafeDigest}. Use bitgraph_record to record the file.`
            );
          }

          if (response_format === "json") {
            return ok(capJson(detail).text);
          }
          return ok(renderProofMarkdown(detail, apiBaseUrl()));
        } catch (err) {
          return fail(errorText(err));
        }
      }
    );
  },
  {
    serverInfo: { name: "bitgraph", version: SERVER_VERSION },
    instructions:
      "BitGraph records SHA-256 digests of existing files at causal positions in a public ledger, bracketed by Ethereum anchors. " +
      "Only digests travel; file contents are never uploaded. Recordings are permanent: only record files the user asked to record, " +
      "and never generate content just to record it. bitgraph_check and bitgraph_get_proof are read-only.",
  }
);

export { handler as POST, handler as DELETE };

/**
 * One URL for both audiences. The protocol handler serves GET only to answer
 * 405 (stateless: no SSE stream to offer), so the only GETs worth routing to
 * it are ones that explicitly ask for MCP media types; every other GET is a
 * human pasting the URL into a browser and lands on the instructions page.
 * Matching on the MCP types rather than text/html survives proxies that
 * rewrite browser Accept headers (Vercel's edge does).
 */
export function GET(request: Request): Response | Promise<Response> {
  const accept = request.headers.get("accept") ?? "";
  if (accept.includes("text/event-stream") || accept.includes("application/json")) {
    return handler(request);
  }
  return Response.redirect(new URL("/docs/mcp", request.url), 302);
}
