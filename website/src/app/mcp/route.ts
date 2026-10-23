/**
 * Remote MCP endpoint: https://bitgraph.ing/mcp (Streamable HTTP, stateless).
 *
 * One TEE, two steps, one atomic action (2026-10-17). A hosted server
 * holds no files, and needs none: the caller sends SHA-256 digests and gets
 * back proofs. bitgraph_bind is the one way to make a BitGraph (inside the
 * enclave: a fresh nonce, then the digest at the very next count, signed
 * together with the enclave's time); bitgraph_check and bitgraph_get_proof are
 * read-only. File contents never travel. This endpoint is a translator in
 * front of the site's own public API, nothing more.
 */

import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import {
  ApiError,
  apiBaseUrl,
  batchCheck,
  commitDigests,
  getProofDetail,
  PartialCommitError,
  search,
} from "@/lib/mcp/api";
import { fromUrlSafeB64, looksLikeDigest, toUrlSafeB64 } from "@/lib/mcp/encoding";
import {
  capJson,
  positionOf,
  proofUrl,
  renderCheckMarkdown,
  renderProofMarkdown,
  type CheckOutcome,
} from "@/lib/mcp/format";
import { recordedMsOf } from "@/lib/recorded-time";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SERVER_VERSION = "0.5.0";

const MAX_CHECK = 500;
const MAX_BIND = 100;

const DIGEST_HINT =
  "A digest is the SHA-256 of the file's bytes, base64-encoded (standard or URL-safe form both accepted), " +
  'e.g. shell: openssl dgst -sha256 -binary FILE | base64 · python: base64.b64encode(hashlib.sha256(data).digest()).decode()';

/** Said with every proof handed back. */
const PROOF_KEEPING = "Save each proof whole and unedited, every field, beside the bytes it is about, including environment.attestation.reportB64, copied exactly: a proof missing slotAllocation, environment, or the attestation cannot be verified.";

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
      return { error: `Error: "${d}" is not a base64 SHA-256 digest. ${DIGEST_HINT}` };
    }
    standard.push(fromUrlSafeB64(trimmed));
  }
  return { standard };
}

function utc(ms: number | null): string {
  return ms === null ? "unknown" : new Date(ms).toISOString().replace(".000Z", "Z");
}

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "bitgraph_bind",
      {
        title: "Make a BitGraph",
        description:
          "Make a BitGraph of each SHA-256 digest: one atomic action inside BitGraph's enclave per digest, a fresh nonce nobody can see, then the digest at the very next count, signed together with the enclave's own time. " +
          "Proves the bits were bound after a moment nobody could predict. Permanent: only make BitGraphs of files the user asked for, and never generate content just to record it. " +
          DIGEST_HINT + `. Up to ${MAX_BIND} digests per call; each becomes its own BitGraph.`,
        inputSchema: z.object({
          digests: z
            .array(z.string().min(1).max(100))
            .min(1)
            .max(MAX_BIND)
            .describe(`SHA-256 digests, base64 (standard or URL-safe form), up to ${MAX_BIND}.`),
          response_format: responseFormatSchema,
        }),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      async ({ digests, response_format }) => {
        const normalized = normalizeDigests(digests);
        if ("error" in normalized) return fail(normalized.error);
        let proofs;
        try {
          proofs = await commitDigests(normalized.standard);
        } catch (err) {
          if (err instanceof PartialCommitError && err.minted.length > 0) {
            proofs = err.minted;
          } else {
            return fail(errorText(err instanceof PartialCommitError ? err.cause2 : err));
          }
        }
        const baseUrl = apiBaseUrl();
        const made = proofs.map((p) => {
          const d = p.artifact?.digestB64 ?? "";
          const c = p.commit;
          return {
            digest: toUrlSafeB64(d),
            number: c?.counter ?? null,
            counts: c?.slotCounter && c?.counter ? [c.slotCounter, c.counter] : null,
            enclave_time: utc(recordedMsOf(p)),
            proof_url: proofUrl(baseUrl, d),
            proof: p,
          };
        });
        if (response_format === "json") {
          return ok(capJson({ made, requested: normalized.standard.length, note: PROOF_KEEPING }).text);
        }
        const lines = made.map((m) => `- BitGraph #${m.number ?? "?"} (counts ${m.counts?.join(", ") ?? "?"}), ${m.enclave_time} enclave time: ${m.proof_url}`);
        const partial = made.length < normalized.standard.length ? `\n\nOnly ${made.length} of ${normalized.standard.length} were made; the rest were not. Check them with bitgraph_check before trying again.` : "";
        return ok(`Made ${made.length} BitGraph${made.length === 1 ? "" : "s"}:\n${lines.join("\n")}${partial}\n\n${PROOF_KEEPING} The json format returns each proof whole.`);
      }
    );


    server.registerTool(
      "bitgraph_check",
      {
        title: "Check for BitGraphs",
        description:
          "Check whether BitGraph holds a proof for these SHA-256 digests, without making anything. " +
          DIGEST_HINT + ". " +
          "Returns, per digest: on_record, and every BitGraph of those bytes by number. " +
          "Read-only. A miss does not mean the file has no BitGraph: ask whoever holds the file for its proof before making a new one with bitgraph_bind.",
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

          const unique = [...new Set(normalized.standard)];
          const checked = await batchCheck(unique.map(toUrlSafeB64));
          const baseUrl = apiBaseUrl();
          const outcomes: CheckOutcome[] = normalized.standard.map((standardDigest, i) => {
            const entry = checked.results[toUrlSafeB64(standardDigest)];
            const proofs = entry?.proofs ?? [];
            const rows = proofs;
            const positions = rows.map((p) => ({ ...positionOf(p.proof), ...(p.member ? { member: p.member } : {}) }));
            return {
              input: digests[i] as string,
              digest: toUrlSafeB64(standardDigest),
              on_record: rows.length > 0,
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
          "Fetch a BitGraph proof: its number, its two counts, the enclave's time, and every BitGraph of the same bytes. " +
          "Look up by digest (base64, either form) or by BitGraph number (e.g. '4523' or '#4,523', current epoch). " +
          "Exactly one of digest or number is required. Read-only. " +
          "markdown returns a summary; json returns the full proof object.",
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
                `Error: no BitGraph found for number "${number}" in the current epoch. Numbers reset each epoch; look up older BitGraphs by digest instead.`
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
              `Not found: BitGraph's copy holds no proof for digest ${urlSafeDigest}. That is not a finding: a proof may live only with its holder. Ask whoever holds the file for its BitGraph before making one with bitgraph_bind.`
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
      "BitGraph is one atomic action inside a hardware enclave: a fresh value nobody can see takes one count, and a SHA-256 digest is bound at the very next count, both signed together with the enclave's own time. It proves the bits were bound after a moment nobody could predict, and could not have been bound before it; it says nothing about how old the content is. " +
      "bitgraph_bind is the only way to make a BitGraph: send the SHA-256 of each file the user asked for. File contents never travel. BitGraphs are permanent: never generate content just to record it. " +
      "bitgraph_check and bitgraph_get_proof are read-only. Two BitGraphs bracket everything bound between them: bind a start, do the work, bind the result.",
  }
);

export { handler as POST, handler as DELETE };

/**
 * One URL for both audiences. The protocol handler serves GET only to answer
 * 405 (stateless: no SSE stream to offer), so the only GETs worth routing to
 * it are ones that explicitly ask for MCP media types; every other GET is a
 * human pasting the URL into a browser and lands on the page that explains it.
 */
export function GET(request: Request): Response | Promise<Response> {
  const accept = request.headers.get("accept") ?? "";
  if (accept.includes("text/event-stream") || accept.includes("application/json")) {
    return handler(request);
  }
  return Response.redirect(new URL("/how-it-works", request.url), 302);
}
