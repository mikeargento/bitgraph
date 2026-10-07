/**
 * Remote MCP endpoint: https://bitgraph.ing/mcp (Streamable HTTP, stateless).
 *
 * A hosted server has no caller filesystem, so it never holds a file. It does
 * not need to: making a BitGraph the default way is two steps here, and the
 * caller builds the new file itself. bitgraph_open sends the origin digest and
 * size and gets back a slot and a recipe (the exact bytes the new file adds
 * around the original); bitgraph_commit sends the digest of the file the
 * caller built and gets back its export (the proof, and the file's place in
 * the tree), committed under that exact slot. If a caller can hash a file it
 * can build the virtual new file and hash that (Mike, 2026-09-03). Only
 * digests, sizes, a file's first bytes, slot records and recipe bytes travel;
 * file contents are never uploaded.
 *
 * Two or more files opened together are ONE BitGraph (2026-09-06): one slot
 * for all of them, one commit, one position, the way a drop on the site works.
 * Since 2026-10-03 that BitGraph is a tree/1 (fuse-hosted.ts, commitHostedTree):
 * every file a leaf, a single file a tree of one, and ONE export/1 per tree
 * comes back. A token opened without a floor (an enclave before v9) still
 * commits the earlier way: a set's manifest, or a single fused file and its
 * Frame.
 *
 * There is no digest-only tool here (2026-09-06): every model handed one
 * reached for it and made a plain recording of a file it could have fused.
 * The compatibility recording of a digest alone stays on the HTTP API
 * (POST /api/commit) for clients that hold no bytes. This endpoint is a
 * translator in front of the site's own public API, nothing more.
 */

import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import {
  ApiError,
  apiBaseUrl,
  batchCheck,
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
  type CheckOutcome,
} from "@/lib/mcp/format";

/**
 * Said with every proof handed back. An agent that "tidied" a task proof
 * dropped slotAllocation and environment, and the signature no longer had a
 * body to be checked against (Grok, 2026-09-13).
 */
const PROOF_KEEPING = "Save each proof whole and unedited, every field, beside the bytes it is about, including environment.attestation.reportB64, the long base64 string, copied exactly: a proof missing slotAllocation, environment, or the attestation cannot be verified.";
/** Said with every export handed back (tree/1). */
const EXPORT_KEEPING = "Save each export exactly as it is (it carries the proof, attestation included), with the spec its proof pins beside it as SPEC.md: https://bitgraph.ing/spec/SPEC-v2.md for a Base floor, https://bitgraph.ing/spec/SPEC.md for an Ethereum floor; its SHA-256 is the one the proof pins.";
import {
  beginHosted,
  commitHostedTask,
  floorOfState,
  decodeTaskToken,
  TASK_INSTRUCTIONS,
  ASSEMBLY_INSTRUCTIONS,
  HEAD_MAX_BYTES,
  HostedFuseError,
  MAX_OPEN_FILES,
  MAX_ORIGIN_BYTES,
  SET_INSTRUCTIONS,
  SLOT_TTL_SECONDS,
  choosePlacement,
  commitHosted,
  commitHostedSet,
  commitHostedTree,
  treeExportFor,
  decodeToken,
  groupCommitEntries,
  openHosted,
  openHostedSet,
  recipeJson,
  renderCommitMarkdown,
  renderOpenMarkdown,
  type CommitOutcome,
  type OpenInput,
  type OpenOutcome,
  type Opened,
  type OpenState,
  type SetOutcome,
} from "@/lib/mcp/fuse-hosted";
import { after } from "next/server";
import { AFTER_ANSWER_NOTE, inProcessRecoveryFetch, keepTreeOnSite, recoveredOnSite, type SiteRecovered } from "@/lib/recovery-server";
import { s3RecoveryStore } from "@/lib/recovery-store-s3";
import { getProofsByDigest } from "@/lib/s3";

/** Milliseconds the after-answer continuation spends writing a tree's recovery entries (lib/recovery-server.ts); the export is the record either way. */
const HOSTED_RECOVERY_BUDGET_MS = 45_000;

/** The site reading its own recovery entries, in this process: the store's handlers and the ledger's by-digest read. */
const siteRecoveryFetch = () => inProcessRecoveryFetch(s3RecoveryStore(), async (d) => (await getProofsByDigest(fromUrlSafeB64(d))).map((e) => e.proof));

export const dynamic = "force-dynamic";
// One commit chunk of TEE work (~1s/digest) must finish inside this window.
export const maxDuration = 60;

// 0.4.0 (2026-10-03): an anchored commit makes tree/1 and returns its export/1 in exports[].
const SERVER_VERSION = "0.4.0";

// Check is a cheap S3 lookup; the batch endpoint's cap.
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
      return `${err.message} Nothing was committed; the position is still held. Call bitgraph_commit again with the same fuse_token and digest in about 15 seconds.`;
    case "tee-restarting":
      return `${err.message} The boundary restarts once a day at 23:59 UTC; open the file again afterwards.${retry}`;
    case "slot-unavailable":
      return `${err.message} The position was consumed by an earlier commit, expired (${SLOT_TTL_SECONDS} seconds after open), or the boundary restarted. Call bitgraph_open again for this file (together with the others it should share a set with) and rebuild the new file from the new recipe.`;
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
      "bitgraph_open",
      {
        title: "Make a BitGraph: open",
        description:
          "Step one of making a BitGraph, for a caller that holds the files: open a position and get, per file, the recipe to build its new fused file locally. " +
          "Everything opened in one call is ONE BitGraph: the files share a single position and become one Merkle tree (tree/1), each file a leaf; a single file is a tree of one. Open a batch together, never one file at a time. " +
          "Send, per file, its name, exact byte size and SHA-256 digest (base64, either form), plus head_base64: the file's first 16 bytes (the whole file when shorter), which decides the placement. " +
          "The boundary allocates an unused position before any new file exists, and this returns per file a fuse_token, the placement, and the recipe: bytes to append after the original (trailer/1, for formats that ignore trailing data: JPEG, PNG, GIF, TIFF and raws, BMP, WebP, WAV, AVI) or to put before and after it (container/2, a tar that carries the original untouched and first, for everything else). " +
          `Then build each new file exactly as its recipe says, SHA-256 it, and call bitgraph_commit ONCE with every fuse_token and digest, within ${SLOT_TTL_SECONDS} seconds of opening. ` +
          "File contents never travel: only digests, sizes, the first bytes and the recipe. Never alter the original. Only make BitGraphs of files the user asked for, and never generate content just to record it: recordings are permanent. " +
          "Files already on record are not opened unless again=true; they come back as 'on record'. A file can also hold a BitGraph its holder keeps, which no lookup sees; ask before making another. " +
          `Up to ${MAX_OPEN_FILES} files per call; folders of any size are the stdio package's job (npx @mikeargento/bitgraph-mcp), on the machine that holds them.`,
        inputSchema: z.object({
          files: z
            .array(
              z.object({
                name: z.string().min(1).max(255).describe("The file's name; the new file and its export are named from it."),
                size: z.number().int().min(0).max(MAX_ORIGIN_BYTES).describe("Exact byte length of the file."),
                digest: z.string().min(1).max(100).describe("SHA-256 of the file's bytes, base64 (standard or URL-safe)."),
                head_base64: z
                  .string()
                  .max(Math.ceil(HEAD_MAX_BYTES / 3) * 4)
                  .optional()
                  .describe("The file's first 16 bytes (up to 64), base64; the whole file when it is shorter than 16 bytes. Omit to place any file in a container."),
                as_is: z
                  .boolean()
                  .optional()
                  .describe("true: record the file as it is, the user's choice (for a file that must stay byte-identical, or one they do not own): its own digest is its leaf, nothing is built, and the commit is that digest. Recorded after the floor block; the bytes themselves are not dated. Never choose this for the user."),
              })
            )
            .max(MAX_OPEN_FILES)
            .optional()
            .describe("The files to open, with their digests. OMIT this (or send an empty list) to open a position BEFORE the work exists: you get its position commitment to put into the task, and seal the task under it with bitgraph_commit."),
          again: z
            .boolean()
            .default(false)
            .describe("false (default): files already on record are not opened. true: open a position regardless. BitGraph's copy is a convenience for lookups; a BitGraph its holder keeps is just as good."),
          response_format: responseFormatSchema,
        }),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      async ({ files: filesIn, again, response_format }) => {
        try {
          // No files: the task form. A held position and its commitment, before any work exists.
          if (filesIn === undefined || filesIn.length === 0) {
            let begun;
            try {
              begun = await beginHosted();
            } catch (err) {
              return fail(`Error: ${hostedErrorText(err)}`);
            }
            const floorLine = begun.floor === null ? "the sealed proof will carry the signed floor" : `not before ${begun.floor.chain === "base" ? "Base" : "Ethereum"} block ${begun.floor.block}${begun.floor.headerTime !== null ? ` (header time ${new Date(begun.floor.headerTime * 1000).toISOString().replace(".000Z", "Z")})` : ""}`;
            const structured = {
              outcome: "opened",
              task: true,
              slot_counter: begun.slotCounter,
              epoch: begun.epochB64,
              commitment: begun.commitment,
              commitment_base64: begun.commitmentB64,
              floor: begun.floor === null ? null : { chain: begun.floor.chain ?? "ethereum", block: begun.floor.block, header_time: begun.floor.headerTime },
              fuse_token: begun.token,
              expires_in_seconds: SLOT_TTL_SECONDS,
              instructions: TASK_INSTRUCTIONS,
            };
            if (response_format === "json") return ok(capJson(structured).text);
            return ok(
              `Opened position ${begun.slotCounter} before any work exists. Floor: ${floorLine}.\n\n` +
                `Commitment (put this string into the task): ${begun.commitment}\n\n${TASK_INSTRUCTIONS}\n\n` +
                "```json\n" + capJson({ fuse_token: begun.token, commitment: begun.commitment, slot_counter: begun.slotCounter, epoch: begun.epochB64, floor: structured.floor }).text + "\n```"
            );
          }
          const files = filesIn;
          const normalized = normalizeDigests(files.map((f) => f.digest));
          if ("error" in normalized) return fail(normalized.error);
          const standard = normalized.standard;
          const checked = await batchCheck([...new Set(standard)].map(toUrlSafeB64));
          // A tree member is never indexed by its plain hash: a file already
          // in a tree is found through its sealed recovery entry, read here
          // from the store (lib/recovery-server.ts). A lookup that did not
          // complete leaves the file UNKNOWN, and unknown is not new (SPEC
          // section 13): it is not opened without again=true.
          const notIndexed = again ? [] : [...new Set(standard)].filter((d) => (checked.results[toUrlSafeB64(d)]?.proofs ?? []).length === 0);
          const inTrees = notIndexed.length > 0 ? await recoveredOnSite(notIndexed, siteRecoveryFetch()) : { found: new Map<string, SiteRecovered[]>(), unknown: new Map<string, string>() };
          const baseUrl = apiBaseUrl();
          const outcomes: OpenOutcome[] = new Array<OpenOutcome>(files.length);
          // Two passes: what each file is (on record, refused, or a candidate)
          // costs no slot; then ONE slot for every candidate at once.
          const candidates: Array<{ i: number; input: OpenInput }> = [];
          const seen = new Set<string>();
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
              outcomes[i] = { ...base, outcome: "on record" };
              continue;
            }
            const inTree = inTrees.found.get(digest);
            if (inTree !== undefined && inTree.length > 0) {
              // Its proof page is the tree's: a member is reached through the tree's artifact digest and position.
              const t = inTree[0]!.proof as { artifact?: { digestB64?: string }; commit?: { counter?: string; epochId?: string } };
              outcomes[i] = { ...base, outcome: "on record", total_positions: inTree.length, proof_url: proofUrl(baseUrl, t.artifact?.digestB64 ?? digest, t.commit?.counter ?? undefined, t.commit?.epochId) };
              continue;
            }
            const unknownWhy = inTrees.unknown.get(digest);
            if (unknownWhy !== undefined) {
              outcomes[i] = { ...base, outcome: "not opened", error: `whether this file is already in a tree is unknown: ${unknownWhy}; call again when the site answers, or with again=true to open a position regardless` };
              continue;
            }
            if (seen.has(digest)) {
              outcomes[i] = { ...base, outcome: "not opened", error: "the same bytes were listed twice in this call; one member is enough" };
              continue;
            }
            const head = f.head_base64 !== undefined ? new Uint8Array(Buffer.from(f.head_base64, "base64")) : null;
            const placement = choosePlacement(head, f.size);
            if (typeof placement !== "string") {
              outcomes[i] = { ...base, outcome: "not opened", error: placement.error };
              continue;
            }
            seen.add(digest);
            outcomes[i] = { ...base, outcome: "not opened", error: "not opened" };
            candidates.push({ i, input: { name: f.name, size: f.size, digestB64: digest, head, ...(f.as_is === true ? { asIs: true } : {}) } });
          }
          const openedOutcome = (i: number, o: Opened, set: boolean): OpenOutcome => ({
            ...(outcomes[i] as OpenOutcome),
            outcome: "opened",
            error: null,
            ...(set ? { set: true } : {}),
            ...(floorOfState(o.state) ? { tree: true } : {}),
            placement: o.state.asIs ? "as-is" : o.state.placement,
            slot_counter: o.slotCounter,
            epoch: o.epochB64,
            fused_name: o.state.fusedName,
            frame_name: o.state.frameName,
            fuse_token: o.token,
            recipe: recipeJson(o.recipe),
          });
          try {
            if (candidates.length === 1) {
              const c = candidates[0] as (typeof candidates)[number];
              outcomes[c.i] = openedOutcome(c.i, await openHosted(c.input), false);
            } else if (candidates.length > 1) {
              const opened = await openHostedSet(candidates.map((c) => c.input));
              candidates.forEach((c, k) => {
                outcomes[c.i] = openedOutcome(c.i, opened.members[k] as Opened, true);
              });
            }
          } catch (err) {
            const text = hostedErrorText(err);
            for (const c of candidates) outcomes[c.i] = { ...(outcomes[c.i] as OpenOutcome), outcome: "not opened", error: text };
          }
          const openedRows = outcomes.filter((o) => o.outcome === "opened");
          const asSet = openedRows.length > 1;
          const structured = {
            results: outcomes,
            set: asSet ? { slot_counter: openedRows[0]?.slot_counter ?? null, epoch: openedRows[0]?.epoch ?? null, count: openedRows.length } : null,
            instructions: asSet ? `${ASSEMBLY_INSTRUCTIONS} ${SET_INSTRUCTIONS}` : ASSEMBLY_INSTRUCTIONS,
            summary: {
              opened: openedRows.length,
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
          "Step two of making a BitGraph: commit the new files built from bitgraph_open recipes. " +
          "Send, per file, the fuse_token from bitgraph_open and the SHA-256 digest (base64) of the new file you built from its recipe. Send every file opened together in ONE call: they share a position and become one BitGraph, and it is whatever this call carries. " +
          "Every file becomes a leaf of one Merkle tree (tree/1; a single file is a tree of one): the tree is built here from the digests, its root document is committed under the shared position with the tree/1 marker, and the returned proof is verified before any file is called fused. " +
          "It comes back as ONE export per tree in exports[] (bitgraph-export/1: the proof, the root document, and the file's own leaf and path, or for several files every leaf and name). Save each export exactly as it is beside the files, with the spec its proof pins as SPEC.md (https://bitgraph.ing/spec/SPEC-v2.md for a Base floor, https://bitgraph.ing/spec/SPEC.md for an Ethereum floor); with the file it checks with nothing of BitGraph's. " +
          "New files are virtual: keep the originals unchanged and the export, and any reader can rebuild a new file and check it. BitGraph does not index a tree's files. " +
          "(A fuse_token from an older open, without a floor, still commits the earlier way: a set with sets[].proof, or one file with its Frame in frames[].) " +
          "Returns, per file, the position just made, plus any earlier position BitGraph's copy holds. Positions held elsewhere are in their holder's proofs. " +
          "A 'not fused' outcome says why and what to do (usually: commit again in a few seconds, or open again). Nothing is labelled fused unless the proof came back under the named position and verified.",
        inputSchema: z.object({
          entries: z
            .array(
              z.object({
                fuse_token: z.string().min(1).max(8000).describe("The fuse_token bitgraph_open returned for this file."),
                artifact_digest: z.string().min(1).max(100).describe("SHA-256 of the new file you built from the recipe, base64 (either form). For a task token: SHA-256 of the task bytes that carry the commitment string."),
                carry: z.enum(["base64url"]).optional().describe("Task tokens only: how the task bytes carry the commitment. base64url means the commitment's unpadded base64url string appears verbatim inside the bytes."),
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
          const outcomes: CommitOutcome[] = new Array<CommitOutcome>(entries.length);
          const frames: Array<{ name: string; frame: unknown }> = [];
          const sets: Array<SetOutcome & { proof: unknown }> = [];
          // tree/1: one summary and one export per tree (the export carries the proof).
          const trees: SetOutcome[] = [];
          const exportsOut: Array<{ name: string; export: unknown; notes: string[] }> = [];
          const treeGroups: Array<Array<{ position: number; state: OpenState; artifactDigestB64: string }>> = [];
          const decoded: Array<{ position: number; state: OpenState; artifactDigestB64: string }> = [];
          const tasks: Array<{ position: number; state: import("@/lib/mcp/fuse-hosted").TaskState; artifactDigestB64: string }> = [];
          for (let position = 0; position < entries.length; position++) {
            const e = entries[position] as (typeof entries)[number];
            const taskState = decodeTaskToken(e.fuse_token);
            if (taskState !== null) {
              const trimmedT = e.artifact_digest.trim();
              if (!looksLikeDigest(trimmedT)) {
                outcomes[position] = { name: "(task)", origin_digest: "", artifact_digest: e.artifact_digest, outcome: "not fused", placement: "base64url", slot_counter: taskState.slot.counter, counter: null, epoch: null, fused_name: "", frame_name: "", proof_url: null, positions: [], recovered: false, error: `"${e.artifact_digest}" is not a base64 SHA-256 digest. ${DIGEST_HINT}` };
                continue;
              }
              tasks.push({ position, state: taskState, artifactDigestB64: fromUrlSafeB64(trimmedT) });
              continue;
            }
            const state = decodeToken(e.fuse_token);
            const trimmed = e.artifact_digest.trim();
            const digestOk = looksLikeDigest(trimmed);
            const artifact = digestOk ? fromUrlSafeB64(trimmed) : "";
            if (state === null || !digestOk) {
              outcomes[position] = {
                name: state?.origin.name ?? "(unknown file)",
                origin_digest: state ? toUrlSafeB64(state.origin.digestB64) : "",
                artifact_digest: digestOk ? toUrlSafeB64(artifact) : e.artifact_digest,
                outcome: "not fused",
                placement: state?.placement ?? "container/2",
                slot_counter: state?.slot.counter ?? null,
                counter: null,
                epoch: null,
                fused_name: state?.fusedName ?? "",
                frame_name: state?.frameName ?? "",
                proof_url: null,
                positions: [],
                recovered: false,
                error: state === null ? "fuse_token is not one issued by bitgraph_open" : `"${e.artifact_digest}" is not a base64 SHA-256 digest. ${DIGEST_HINT}`,
              };
              continue;
            }
            decoded.push({ position, state, artifactDigestB64: artifact });
          }
          const commonOf = (state: OpenState, artifact: string) => ({
            name: state.origin.name,
            origin_digest: toUrlSafeB64(state.origin.digestB64),
            artifact_digest: toUrlSafeB64(artifact),
            placement: state.asIs ? ("as-is" as const) : state.placement,
            slot_counter: state.slot.counter,
            fused_name: state.fusedName,
            frame_name: state.frameName,
          });
          const notFused = (state: OpenState, artifact: string, error: string): CommitOutcome => ({
            ...commonOf(state, artifact),
            outcome: "not fused",
            counter: null,
            epoch: null,
            proof_url: null,
            positions: [],
            recovered: false,
            error,
          });
          // Tasks: the task bytes' digest under the held slot, with the inline marker.
          for (const t of tasks) {
            const base = { name: "(task)", origin_digest: "", artifact_digest: toUrlSafeB64(t.artifactDigestB64), placement: "base64url" as const, slot_counter: t.state.slot.counter, fused_name: "", frame_name: "" };
            try {
              const c = await commitHostedTask(t.state, t.artifactDigestB64);
              const { counter, epoch } = positionOf(c.proof);
              outcomes[t.position] = { ...base, outcome: "fused", counter, epoch, proof_url: proofUrl(baseUrl, t.artifactDigestB64, counter ?? undefined, c.proof.commit?.epochId), positions: [{ counter, epoch }], recovered: c.recovered, error: null };
              frames.push({ name: "task.proof.json", frame: c.proof });
            } catch (err) {
              outcomes[t.position] = { ...base, outcome: "not fused", counter: null, epoch: null, proof_url: null, positions: [], recovered: false, error: hostedErrorText(err) };
            }
          }
          const groups = groupCommitEntries(decoded);
          // A token opened under a floor (every enclave since v9) makes tree/1:
          // one file is a tree of one, files opened together are one tree. A
          // token without one keeps the earlier making, below.
          // Single files: each under its own slot, as before.
          for (const s of groups.solos) {
            if (floorOfState(s.state)) { treeGroups.push([s]); continue; }
            try {
              const c = await commitHosted(s.state, s.artifactDigestB64);
              const { counter, epoch } = positionOf(c.proof);
              outcomes[s.position] = {
                ...commonOf(s.state, s.artifactDigestB64),
                outcome: "fused",
                counter,
                epoch,
                proof_url: proofUrl(baseUrl, s.artifactDigestB64, counter ?? undefined, c.proof.commit?.epochId),
                positions: [],
                recovered: c.recovered,
                error: null,
              };
              frames.push({ name: s.state.frameName, frame: c.frame });
            } catch (err) {
              outcomes[s.position] = notFused(s.state, s.artifactDigestB64, hostedErrorText(err));
            }
          }
          // Sets: every member that shares a slot, one manifest, one commit, one position.
          for (const g of groups.sets) {
            if (g.entries[0] && floorOfState(g.entries[0].state)) { treeGroups.push(g.entries); continue; }
            try {
              const c = await commitHostedSet(g.entries);
              const { counter, epoch } = positionOf(c.proof);
              const setDigest = toUrlSafeB64(c.artifactDigestB64);
              sets.push({
                slot_counter: g.slot.counter,
                counter,
                epoch,
                count: c.count,
                artifact_digest: setDigest,
                proof_url: proofUrl(baseUrl, c.artifactDigestB64, counter ?? undefined, c.proof.commit?.epochId),
                manifest_echoed: c.manifestEchoed,
                recovered: c.recovered,
                proof: c.proof,
              });
              g.entries.forEach((e, k) => {
                outcomes[e.position] = {
                  ...commonOf(e.state, e.artifactDigestB64),
                  outcome: "fused",
                  counter,
                  epoch,
                  proof_url: proofUrl(baseUrl, e.state.origin.digestB64, counter ?? undefined, c.proof.commit?.epochId),
                  positions: [],
                  recovered: c.recovered,
                  error: null,
                  member: (c.rowOf[k] as number) + 1,
                  member_count: c.count,
                  set_digest: setDigest,
                };
              });
            } catch (err) {
              const text = hostedErrorText(err);
              for (const e of g.entries) outcomes[e.position] = notFused(e.state, e.artifactDigestB64, text);
            }
          }
          // Trees: every file's leaf, one root document, one commit, one position, one export.
          for (const g of treeGroups) {
            try {
              const t = await commitHostedTree(g);
              const ex = await treeExportFor(t);
              // Each file's sealed recovery entries are written AFTER this answer
              // (lib/recovery-server.ts, Next's after()): the proof and the export
              // come first, as SPEC section 13 says, and nothing here waits on the
              // store. The continuation is not durable; the export is the record.
              const recoveryInput = { proof: t.proof as never, rootDocument: t.rootDocument, leaves: t.leaves, names: t.names };
              ex.notes.push(AFTER_ANSWER_NOTE);
              after(async () => {
                const kept = await keepTreeOnSite(recoveryInput, s3RecoveryStore, { budgetMs: HOSTED_RECOVERY_BUDGET_MS });
                // Counts and sanitized reasons only (lib/recovery-server.ts never puts a store message in a reason).
                console.log(`[mcp] recovery entries after the answer: kept=${kept.kept} of ${kept.entries} pending=${kept.pending} blocked=${kept.blocked}${kept.reason !== null ? ` (${kept.reason})` : ""}`);
              });
              const { counter, epoch } = positionOf(t.proof);
              const treeDigest = t.proof.artifact?.digestB64 ?? "";
              const url = proofUrl(baseUrl, treeDigest, counter ?? undefined, t.proof.commit?.epochId);
              exportsOut.push({ name: ex.name, export: ex.export, notes: ex.notes });
              if (t.count > 1) {
                trees.push({ slot_counter: g[0]!.state.slot.counter, counter, epoch, count: t.count, artifact_digest: toUrlSafeB64(treeDigest), proof_url: url, manifest_echoed: t.echoed, recovered: t.recovered, tree: true, export_name: ex.name });
              }
              g.forEach((e, k) => {
                outcomes[e.position] = {
                  ...commonOf(e.state, e.artifactDigestB64),
                  outcome: "fused",
                  counter,
                  epoch,
                  proof_url: url,
                  positions: [],
                  recovered: t.recovered,
                  error: null,
                  ...(t.count > 1 ? { member: (t.leafOf[k] as number) + 1, member_count: t.count, set_digest: toUrlSafeB64(treeDigest) } : {}),
                  export_name: ex.name,
                };
              });
            } catch (err) {
              const text = hostedErrorText(err);
              for (const e of g) outcomes[e.position] = notFused(e.state, e.artifactDigestB64, text);
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
          const fusedOutcomes = outcomes.filter((o) => o.outcome === "fused" && o.placement !== "base64url");
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
            sets,
            trees,
            exports: exportsOut,
            frames,
            instructions: exportsOut.length > 0 ? `${PROOF_KEEPING} ${EXPORT_KEEPING}` : PROOF_KEEPING,
            summary: {
              fused: outcomes.filter((o) => o.outcome === "fused").length,
              not_fused: outcomes.filter((o) => o.outcome === "not fused").length,
              sets: sets.length,
              trees: exportsOut.length,
            },
          };
          if (response_format === "json") return ok(capJson(structured).text);
          const setSummaries: SetOutcome[] = sets.map((s) => ({ slot_counter: s.slot_counter, counter: s.counter, epoch: s.epoch, count: s.count, artifact_digest: s.artifact_digest, proof_url: s.proof_url, manifest_echoed: s.manifest_echoed, recovered: s.recovered }));
          let md = renderCommitMarkdown(outcomes, [...setSummaries, ...trees]);
          if (exportsOut.length > 0) md += `\n\nExports, one per tree (save each as its name beside the files). ${EXPORT_KEEPING}\n` + "```json\n" + capJson(exportsOut.map((x) => ({ name: x.name, export: x.export }))).text + "\n```";
          if (sets.length > 0) md += "\n\nSet proofs, one per set (save each beside its originals):\n```json\n" + capJson(sets).text + "\n```";
          if (frames.length > 0) md += "\n\nProofs, one per single fused file or task (save each as its name). " + PROOF_KEEPING + "\n```json\n" + capJson(frames).text + "\n```";
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
          "Check whether BitGraph's copy holds a proof for these SHA-256 digests (recordings and anchors), without recording anything. A miss is not a finding: a proof may live only with its holder. " +
          DIGEST_HINT + ". " +
          "Returns, per digest: on_record (the bytes are on record, as an exact recording, as the original a new file was made from, or as a member of a set), every indexed position by counter with a set member's row. " +
          "Read-only. A miss does not mean the file has no BitGraph: ask whoever holds the file for its proof before making a new one with bitgraph_open then bitgraph_commit.",
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
          // A tree's members are never indexed by their own hash (SPEC section 13), so the plain
          // lookup cannot see them: every digest's sealed recovery entries are asked too, as
          // bitgraph_open asks before opening anything (2026-10-04; until then this tool called a
          // tree member "not on record"). Without the bytes a member cannot be verified from
          // them, so recoveredOnSite answers from the entry alone: a match on the committed
          // bytes or an as-is leaf is on record, an origin-only match is unknown. A lookup that
          // did not complete is said, never read as "no".
          const inTrees = await recoveredOnSite(unique, siteRecoveryFetch());

          const baseUrl = apiBaseUrl();
          const outcomes: CheckOutcome[] = normalized.standard.map((standardDigest, i) => {
            const entry = checked.results[toUrlSafeB64(standardDigest)];
            const proofs = entry?.proofs ?? [];
            const treeRows = (inTrees.found.get(standardDigest) ?? []).map((t) => ({ proof: t.proof as unknown as Parameters<typeof positionOf>[0], member: t.member }));
            const rows = [...proofs, ...treeRows];
            const unknown = inTrees.unknown.get(standardDigest);
            const positions = rows.map((p) => ({ ...positionOf(p.proof), ...(p.member ? { member: p.member } : {}) }));
            const treeFirst = treeRows[0]?.proof;
            return {
              input: digests[i] as string,
              digest: toUrlSafeB64(standardDigest),
              // A fused descendant that names these bytes as origin is not a recording of them.
              // The original and the new file made from it find the same proof.
              on_record: rows.length > 0,
              positions,
              proof_url: proofs.length > 0 ? proofUrl(baseUrl, standardDigest) : treeFirst && typeof treeFirst.artifact?.digestB64 === "string" ? proofUrl(baseUrl, treeFirst.artifact.digestB64, treeFirst.commit?.counter ?? undefined, treeFirst.commit?.epochId) : null,
              ...(rows.length === 0 && unknown !== undefined ? { note: `whether these bytes are in a tree is unknown: ${unknown}` } : {}),
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
          "Fetch a BitGraph proof from BitGraph's copy (a recording or an anchor) and its context: its position, every position the copy holds for the same bytes, and its floor " +
          "('placed no earlier than Base block X', or an Ethereum block on earlier proofs). Look up by digest (base64, either form) or by BitGraph number (e.g. '4523' or '#4,523', current epoch). " +
          "Exactly one of digest or number is required. Read-only. " +
          "markdown returns a summary; json returns the full proof object with positions and its floor.",
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
              `Not found: BitGraph's copy holds no proof for digest ${urlSafeDigest}. That is not a finding: a proof may live only with its holder. Ask whoever holds the file for its BitGraph before making one with bitgraph_open then bitgraph_commit.`
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
      "BitGraph gives a file's bytes a position in an ordered sequence, with a floor: a Base block the enclave fixes when the position opens (Ethereum on earlier proofs); the bytes were placed no earlier than their floor. Making a BitGraph is two steps: bitgraph_open (a position at the boundary, and a recipe per file for its new fused file) then bitgraph_commit (the digest of each new file you built). " +
      "Open every file of a batch in ONE call and commit them in ONE call: they share one position and become one BitGraph, a set, each file a member with its row. A single file is fused on its own. " +
      "File contents never travel: only digests, sizes, a file's first bytes, position records and recipe bytes. New files are virtual; the originals stay unchanged and the proof rebuilds them. " +
      "Positions are permanent, and the proof comes back to you to keep: only make BitGraphs of files the user asked for, and never generate content just to record it. " +
      "There is no digest-only recording here: a BitGraph is made with bitgraph_open then bitgraph_commit. bitgraph_check and bitgraph_get_proof are read-only. " +
      "To do work INSIDE a BitGraph, call bitgraph_open with no files BEFORE starting: it returns a position and its commitment; put the commitment into the task, seal the task with bitgraph_commit (carry base64url) within 120 seconds, then record the outputs afterwards. The task then could not have existed before the position's floor block, and the outputs sit after it.",
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
