// Copyright (c) 2025-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * @mikeargento/bitgraph-mcp: tool definitions.
 *
 * Three gestures, the same three the website has: make a BitGraph, check
 * whether bytes are on record, fetch a proof. Making one works exactly like
 * the site's drop box, through the SDK's record: each BitGraph is one atomic
 * action in the enclave, a fresh nonce at count N and the SHA-256 at N+1,
 * signed together, attested by AWS Nitro and chained to the previous proof.
 * One new file is one BitGraph; several new files are one tree and one
 * BitGraph. Files are hashed on this machine and never uploaded or changed;
 * each proof is saved beside its file.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  ApiError, batchCheck, configFromEnv, getProofDetail, search,
  fromUrlSafeB64, looksLikeDigest, mapConcurrent, toUrlSafeB64,
  expandPaths, type ScannedFile,
  type CarrierWindowView, classifyPath, type CarrierRow,
  lookupRecovered, recordFiles,
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
} from "./format.js";

export const SERVER_VERSION = "0.12.0";

const SCAN_CONCURRENCY = 4;
/** Paths per call; a directory counts once and expands to its files. */
const MAX_PATHS = 2000;
/** Files one record call may cover after directories expand. */
export const MAX_MEMBERS = 100_000;
/** Files one check may cover after directories expand. */
const MAX_CHECK_FILES = 10_000;
/** Rows the structured result lists in full. */
export const ROW_CAP = 500;

/** Server options; tests inject a stand-in for the record engine. */
export interface ServerDeps {
  /** Add structuredContent to markdown answers too (default: only response_format "json" carries it). */
  structuredAlways?: boolean;
  /** The record engine. Default: the SDK's recordFiles against the configured site. */
  record?: typeof recordFiles;
}

/** What every client is told about BitGraph. */
export const SERVER_INSTRUCTIONS =
  "A BitGraph is one atomic action inside a hardware enclave: a fresh nonce that never existed before takes one count, and a SHA-256 is bound at the very next count, both signed together, attested by AWS Nitro and chained to the previous proof. It proves the bits were bound after a value nobody could predict; it says nothing about how old the content is. " +
  "bitgraph_record is the one way to make a BitGraph, the same as the website's drop: one new file is one BitGraph, several new files are one tree and one BitGraph. Files are hashed on this machine, never uploaded or changed, and each proof is saved beside its file as <file>.bitgraph.json. Every result returns the BitGraph's nonce: put it into later content to show that content was made after it. " +
  "BitGraphs are permanent: only make them of files the user asked for, and never generate content just to record it. bitgraph_check and bitgraph_get_proof are read-only.";

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

export function buildServer(deps: ServerDeps = {}): McpServer {
  /* A markdown answer goes out as text alone unless asked otherwise: clients that see structuredContent show it in
   * place of the text, so a markdown answer that carried it would arrive as raw JSON.
   * response_format "json" always carries it; BITGRAPH_MCP_STRUCTURED=always (or deps) adds it to markdown too. */
  const structuredAlways = deps.structuredAlways ?? process.env.BITGRAPH_MCP_STRUCTURED === "always";
  const md = (text: string, structured: Record<string, unknown>): ToolResult => (structuredAlways ? ok(text, structured) : ok(text));
  const server = new McpServer(
    {
      name: "bitgraph-mcp-server",
      version: SERVER_VERSION,
    },
    {
      instructions: SERVER_INSTRUCTIONS,
    }
  );

  server.registerTool(
    "bitgraph_record",
    {
      title: "Make a BitGraph",
      description:
        "Make a BitGraph, the same way the website's drop does. Each BitGraph is one atomic action inside BitGraph's enclave: a fresh nonce that never existed before takes one count, and the SHA-256 is bound at the very next count, signed together, attested by AWS Nitro and chained to the previous proof. " +
        "One new file is one BitGraph of its own SHA-256. Several new files are one tree and one BitGraph: the files' SHA-256s are the leaves of one Merkle tree, its root is bound, and each file gets its own proof that verifies against the file alone. " +
        "Files that already have a BitGraph are not made again; if the lookup fails, nothing is made. Proof files (*.bitgraph.json) and BitGraphed files are never made. " +
        "Files are hashed on this machine and never uploaded or changed; only digests leave. Each new proof is saved beside its file as <file>.bitgraph.json (write=false: not saved; the json result still carries it). " +
        "The result returns the BitGraph's number, its two counts and its nonce. The nonce carries forward to the next BitGraph, and it can be put into content made afterward (a prompt, a seed, a field) to make that content unique and show it was made after the nonce existed. " +
        "Give file paths, directory paths, or both (absolute paths preferred): a directory is every regular file under it, recursively, with hidden entries and symbolic links left out. " +
        "Permanent: only make BitGraphs of files the user asked for, and never generate content just to record it. " +
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
        const r = await (deps.record ?? recordFiles)(config, paths, { write });
        const m = r.made;
        const structured = {
          made: m === null ? null : {
            kind: m.kind, number: m.number, counts: m.counts, nonce: m.nonce, epoch: m.epoch, prev: m.prev,
            digest: m.digestB64, proof_url: m.proofUrl,
            tree: m.tree === null ? null : { files: m.tree.files, root: m.tree.root, root_text: m.tree.rootText, indexed: m.tree.indexed, index_error: m.tree.indexError },
          },
          files: r.files.slice(0, ROW_CAP).map((f) => ({
            path: f.path, digest: f.digestB64, outcome: f.outcome, number: f.number, nonce: f.nonce,
            proof_url: f.proofUrl, proof_path: f.proofPath, member: f.member, ...(f.reason !== undefined ? { reason: f.reason } : {}),
          })),
          omitted: Math.max(0, r.files.length - ROW_CAP),
        };
        if (response_format === "json") {
          return ok(capJson({ ...structured, proof: m?.proof ?? null }).text, structured);
        }
        return md(renderRecordMarkdown(r), structured);
      } catch (err) {
        return fail(`${errorText(err)} Nothing was made.`);
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
        "Returns, per item: on_record (the bytes have a BitGraph of their own, or are a file of a tree that has one), every position by counter, and the proof page URL. " +
        "A BitGraphed file (one that carries its proof inside) is recognized by structure: the proof it carries is verified OFFLINE here and its verdict is reported, and the lookup uses the committed bytes inside, never the envelope. " +
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
        // Files of tree/1 trees are found through their sealed lookup entries, which the plain
        // lookup cannot see, so every plain file's entry is asked too. A digest alone carries no
        // bytes to verify a member with, so digests get the plain lookup only. A lookup that did
        // not complete is said, never read as "no".
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
        "Fetch a BitGraph proof and its context: its number, its two counts, its nonce, the previous proof it chains to, every position the same bytes occupy, and the file's place in a tree when it is one. " +
        "Look up by digest (base64, either form), by BitGraph number (e.g. '4523' or '#4,523', current epoch), or by file path (hashed locally). " +
        "A path to a BitGraphed file (one that carries its proof inside) looks up the committed bytes inside it, and when the ledger has no row the proof the file carries answers offline. " +
        "Exactly one of digest, number, or path is required. Read-only. " +
        "markdown returns a summary; json returns the full proof object with its positions.",
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
          .describe("Select a specific position by commit counter (with epoch)."),
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
            const synth: ProofDetailResponse = { proofs: [{ proof: carrierRow.proof as BitGraphProof }], positions: [] };
            const offlineNote = `Judged offline from the proof this BitGraphed file carries: carried proof ${v.verdict}. Not found in this ledger.`;
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
