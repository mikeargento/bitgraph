/**
 * Remote MCP endpoint: https://bitgraph.ing/mcp (Streamable HTTP, stateless).
 *
 * A hosted server has no caller filesystem, so it never holds a file. It does
 * not need to: making a BitGraph the default way is two steps here, and the
 * caller builds the new file itself. bitgraph_open sends the origin digest and
 * size and gets back a slot and a recipe (the exact bytes the new file adds
 * around the original); bitgraph_commit sends the digest of the file the
 * caller built and gets back the proof and the Frame, committed under that
 * exact slot. If a caller can hash a file it can build the virtual new file
 * and hash that (Mike, 2026-09-03). Only digests, sizes, a file's first bytes,
 * slot records and recipe bytes travel; file contents are never uploaded.
 *
 * bitgraph_record stays as the compatibility recording of digests alone. This
 * endpoint is a translator in front of the site's own public API, nothing more.
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
import {
  ASSEMBLY_INSTRUCTIONS,
  HEAD_MAX_BYTES,
  HostedFuseError,
  MAX_OPEN_FILES,
  MAX_ORIGIN_BYTES,
  commitHosted,
  decodeToken,
  openHosted,
  recipeJson,
  renderCommitMarkdown,
  renderOpenMarkdown,
  type CommitOutcome,
  type OpenOutcome,
} from "@/lib/mcp/fuse-hosted";
import type { BitGraphProof } from "@/lib/mcp/types";

export const dynamic = "force-dynamic";
// One commit chunk of TEE work (~1s/digest) must finish inside this window.
export const maxDuration = 60;

const SERVER_VERSION = "0.2.0";

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

/** A hosted open or commit failure, with what to do next. Never a success-looking line. */
function hostedErrorText(err: unknown): string {
  if (!(err instanceof HostedFuseError)) return err instanceof Error ? err.message : String(err);
  const retry = err.retryAfterSec !== null ? ` Retry after ${err.retryAfterSec} seconds.` : "";
  switch (err.code) {
    case "no-anchor-before-slot":
      return `${err.message} Nothing was committed; the slot is still held. Call bitgraph_commit again with the same fuse_token and digest in about 15 seconds.`;
    case "tee-restarting":
      return `${err.message} The boundary restarts once a day at 23:59 UTC; open the file again afterwards.${retry}`;
    case "slot-unavailable":
      return `${err.message} Call bitgraph_open again for this file and rebuild the new file from the new recipe.`;
    case "rotation-guard":
      return `${err.message}${retry}`;
    default:
      return `${err.message} (${err.code}${err.status !== null ? `, HTTP ${err.status}` : ""}).${retry}`;
  }
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
        title: "Make a BitGraph",
        description:
          "Compatibility recording: give SHA-256 digests of existing files a causal position in the BitGraph ledger (bitgraph.ing) without a new file. It establishes that the bytes existed no later than the commit. " +
          "Prefer bitgraph_open then bitgraph_commit whenever the file is at hand: that is making a BitGraph the default way (a new fused file under a slot that existed first), and it needs nothing more than the ability to hash. " +
          DIGEST_HINT + ". " +
          "Hash an existing file where it lives; never generate content just to record it, and only record files the user asked to record: recordings are permanent (10-year retention, no deletes). " +
          "Digests already on record are NOT re-recorded by default; they come back as 'on record' with their existing proof. " +
          "Pass again=true to deliberately record already-recorded bytes at a new causal position. " +
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
      "bitgraph_open",
      {
        title: "Make a BitGraph: open",
        description:
          "Step one of making a BitGraph the default way, for a caller that holds the file: open a slot for the new fused file and get the recipe to build that file locally. " +
          "Send, per file, its name, exact byte size and SHA-256 digest (base64, either form), plus head_base64: the file's first 16 bytes (the whole file when shorter), which decides the placement. " +
          "The boundary allocates an unused slot before the new file exists, and this returns per file a fuse_token, the placement, and the recipe: bytes to append after the original (trailer/1, for formats that ignore trailing data: JPEG, PNG, GIF, TIFF and raws, BMP, WebP, WAV, AVI) or to put before and after it (container/1, a tar that carries the original untouched, for everything else). " +
          "Then build the new file exactly as the recipe says, SHA-256 it, and call bitgraph_commit with the fuse_token and that digest. " +
          "File contents never travel: only digests, sizes, the first bytes and the recipe. Never alter the original. Only make BitGraphs of files the user asked for, and never generate content just to record it: recordings are permanent. " +
          "Files already on record (recorded, or the origin of a fused file) are not opened unless again=true; they come back as 'on record' with their proof URL. " +
          `Up to ${MAX_OPEN_FILES} files per call.`,
        inputSchema: z.object({
          files: z
            .array(
              z.object({
                name: z.string().min(1).max(255).describe("The file's name; the new file and its Frame are named from it."),
                size: z.number().int().min(0).max(MAX_ORIGIN_BYTES).describe("Exact byte length of the file."),
                digest: z.string().min(1).max(100).describe("SHA-256 of the file's bytes, base64 (standard or URL-safe)."),
                head_base64: z
                  .string()
                  .max(Math.ceil(HEAD_MAX_BYTES / 3) * 4)
                  .optional()
                  .describe("The file's first 16 bytes (up to 64), base64; the whole file when it is shorter than 16 bytes. Omit to place any file in a container."),
              })
            )
            .min(1)
            .max(MAX_OPEN_FILES),
          again: z
            .boolean()
            .default(false)
            .describe("false (default): files already on record are not opened. true: open a slot even for a file that is on record."),
          response_format: responseFormatSchema,
        }),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      async ({ files, again, response_format }) => {
        try {
          const normalized = normalizeDigests(files.map((f) => f.digest));
          if ("error" in normalized) return fail(normalized.error);
          const standard = normalized.standard;
          const checked = await batchCheck([...new Set(standard)].map(toUrlSafeB64));
          const baseUrl = apiBaseUrl();
          const outcomes: OpenOutcome[] = [];
          for (let i = 0; i < files.length; i++) {
            const f = files[i] as (typeof files)[number];
            const digest = standard[i] as string;
            const prior = checked.results[toUrlSafeB64(digest)]?.proofs ?? [];
            const base: Omit<OpenOutcome, "outcome"> = {
              name: f.name,
              digest: toUrlSafeB64(digest),
              placement: null,
              slot_counter: null,
              epoch: null,
              fused_name: null,
              frame_name: null,
              fuse_token: null,
              recipe: null,
              total_positions: prior.length,
              proof_url: prior.length > 0 ? proofUrl(baseUrl, digest) : null,
              error: null,
            };
            if (prior.length > 0 && !again) {
              outcomes.push({ ...base, outcome: "on record" });
              continue;
            }
            const head = f.head_base64 !== undefined ? new Uint8Array(Buffer.from(f.head_base64, "base64")) : null;
            try {
              const opened = await openHosted({ name: f.name, size: f.size, digestB64: digest, head });
              outcomes.push({
                ...base,
                outcome: "opened",
                placement: opened.state.placement,
                slot_counter: opened.slotCounter,
                epoch: opened.epochB64,
                fused_name: opened.state.fusedName,
                frame_name: opened.state.frameName,
                fuse_token: opened.token,
                recipe: recipeJson(opened.recipe),
              });
            } catch (err) {
              outcomes.push({ ...base, outcome: "not opened", error: hostedErrorText(err) });
            }
          }
          const structured = {
            results: outcomes,
            instructions: ASSEMBLY_INSTRUCTIONS,
            summary: {
              opened: outcomes.filter((o) => o.outcome === "opened").length,
              on_record: outcomes.filter((o) => o.outcome === "on record").length,
              not_opened: outcomes.filter((o) => o.outcome === "not opened").length,
            },
          };
          if (response_format === "json") return ok(capJson(structured).text);
          // The caller needs the token and the recipe to go on; markdown carries them too.
          const essentials = outcomes
            .filter((o) => o.outcome === "opened")
            .map((o) => ({ name: o.name, fused_name: o.fused_name, frame_name: o.frame_name, fuse_token: o.fuse_token, recipe: o.recipe }));
          const md = renderOpenMarkdown(outcomes) + (essentials.length > 0 ? "\n\n```json\n" + capJson(essentials).text + "\n```" : "");
          return ok(md);
        } catch (err) {
          return fail(errorText(err));
        }
      }
    );

    server.registerTool(
      "bitgraph_commit",
      {
        title: "Make a BitGraph: commit",
        description:
          "Step two of making a BitGraph the default way: commit the new file built from a bitgraph_open recipe. " +
          "Send, per file, the fuse_token from bitgraph_open and the SHA-256 digest (base64) of the new file you built from its recipe. " +
          "The boundary commits that digest under the exact slot the token names, with the signed marker (profile bitgraph-fuse/1, placement, origin digest), and this returns the proof and the Frame per file. " +
          "Save each Frame next to the original as frame_name. The new file is virtual: keep the original unchanged and the Frame, and any reader can rebuild the new file and check it. " +
          "Returns, per file, the position just made AND every position those bytes occupy: a file may be BitGraphed any number of times, so report the whole list, not only the newest. " +
          "A 'not fused' outcome says why and what to do (usually: commit again in a few seconds, or open again). Nothing is labelled fused unless the proof came back under the named slot and verified.",
        inputSchema: z.object({
          entries: z
            .array(
              z.object({
                fuse_token: z.string().min(1).max(8000).describe("The fuse_token bitgraph_open returned for this file."),
                artifact_digest: z.string().min(1).max(100).describe("SHA-256 of the new file you built from the recipe, base64 (either form)."),
              })
            )
            .min(1)
            .max(MAX_OPEN_FILES),
          response_format: responseFormatSchema,
        }),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      async ({ entries, response_format }) => {
        try {
          const baseUrl = apiBaseUrl();
          const outcomes: CommitOutcome[] = [];
          const frames: Array<{ name: string; frame: unknown }> = [];
          for (const e of entries) {
            const state = decodeToken(e.fuse_token);
            const trimmed = e.artifact_digest.trim();
            const digestOk = looksLikeDigest(trimmed);
            const artifact = digestOk ? fromUrlSafeB64(trimmed) : "";
            if (state === null || !digestOk) {
              outcomes.push({
                name: state?.origin.name ?? "(unknown file)",
                origin_digest: state ? toUrlSafeB64(state.origin.digestB64) : "",
                artifact_digest: digestOk ? toUrlSafeB64(artifact) : e.artifact_digest,
                outcome: "not fused",
                placement: state?.placement ?? "container/1",
                slot_counter: state?.slot.counter ?? null,
                counter: null,
                epoch: null,
                fused_name: state?.fusedName ?? "",
                frame_name: state?.frameName ?? "",
                proof_url: null,
                positions: [],
                recovered: false,
                error: state === null ? "fuse_token is not one issued by bitgraph_open" : `"${e.artifact_digest}" is not a base64 SHA-256 digest. ${DIGEST_HINT}`,
              });
              continue;
            }
            const common = {
              name: state.origin.name,
              origin_digest: toUrlSafeB64(state.origin.digestB64),
              artifact_digest: toUrlSafeB64(artifact),
              placement: state.placement,
              slot_counter: state.slot.counter,
              fused_name: state.fusedName,
              frame_name: state.frameName,
            };
            try {
              const c = await commitHosted(state, artifact);
              const { counter, epoch } = positionOf(c.proof);
              outcomes.push({
                ...common,
                outcome: "fused",
                counter,
                epoch,
                proof_url: proofUrl(baseUrl, artifact, counter ?? undefined, c.proof.commit?.epochId),
                positions: [],
                recovered: c.recovered,
                error: null,
              });
              frames.push({ name: state.frameName, frame: c.frame });
            } catch (err) {
              outcomes.push({ ...common, outcome: "not fused", counter: null, epoch: null, proof_url: null, positions: [], recovered: false, error: hostedErrorText(err) });
            }
          }
          /* One ledger read, after the writes, so a caller who asked to BitGraph
             a file AGAIN is told every position those bytes occupy and not only
             the one just made. The origin digest is what carries the history:
             the file and every new file made from it find the same proofs.

             The read is best-effort and additive. A digest's own fresh position
             is unioned in rather than trusted to the index, which is written
             after the proof and can lag a commit by a moment; and a read that
             fails leaves each outcome with just its own position, which is what
             the caller had before this existed. */
          const fusedOutcomes = outcomes.filter((o) => o.outcome === "fused");
          if (fusedOutcomes.length > 0) {
            const origins = [...new Set(fusedOutcomes.map((o) => o.origin_digest))];
            try {
              const back = await batchCheck(origins);
              for (const o of fusedOutcomes) {
                const proofs = back.results[o.origin_digest]?.proofs ?? [];
                const seen = proofs.map((p) => positionOf(p.proof));
                if (o.counter !== null && !seen.some((p) => p.counter === o.counter)) {
                  seen.push({ counter: o.counter, epoch: o.epoch });
                }
                seen.sort((a, b) => Number(a.counter ?? 0) - Number(b.counter ?? 0));
                o.positions = seen;
              }
            } catch {
              for (const o of fusedOutcomes) o.positions = [{ counter: o.counter, epoch: o.epoch }];
            }
          }

          const structured = {
            results: outcomes,
            frames,
            summary: {
              fused: fusedOutcomes.length,
              not_fused: outcomes.filter((o) => o.outcome === "not fused").length,
            },
          };
          if (response_format === "json") return ok(capJson(structured).text);
          const md = renderCommitMarkdown(outcomes) + (frames.length > 0 ? "\n\nFrames, one per fused file (save each as its frame_name):\n```json\n" + capJson(frames).text + "\n```" : "");
          return ok(md);
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
          "Returns, per digest: on_record (the bytes are on record, as an exact recording or as the original a new file was made from), every position by counter, and the proof page URL. " +
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
              // A fused descendant that names these bytes as origin is not a recording of them.
              // The original and the new file made from it find the same proof.
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
      "BitGraph gives a file's bytes a causal position in a public ledger bracketed by Ethereum anchors. Making a BitGraph the default way is two steps: bitgraph_open (a slot at the boundary, and a recipe for the new fused file) then bitgraph_commit (the digest of the new file you built from the recipe). " +
      "File contents never travel: only digests, sizes, a file's first bytes, slot records and recipe bytes. The new file is virtual; the original stays unchanged and the Frame rebuilds it. " +
      "Recordings are permanent: only make BitGraphs of files the user asked for, and never generate content just to record it. " +
      "bitgraph_record is the compatibility recording of digests alone. bitgraph_check and bitgraph_get_proof are read-only.",
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
