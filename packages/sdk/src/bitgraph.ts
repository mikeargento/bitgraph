// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * The BitGraph SDK's one object.
 *
 *   import { BitGraph } from "@mikeargento/bitgraph-sdk";
 *   const bg = new BitGraph();
 *   const r = await bg.record("run-042.log");
 *   console.log(r.files[0].proofUrl);
 *
 * Six verbs. record makes ONE BitGraph of everything in a call: since
 * 2026-10-03 a tree/1, every file one leaf of one Merkle tree under one
 * position (one file is a tree of one; a file over 256 MiB goes in as is),
 * with the export/1 files that let each file prove it is in it. check and
 * proof are read-only. open holds a position BEFORE any work exists, and its
 * seal commits the task that carries the commitment. verify judges proofs,
 * exports and BitGraphed files fully offline. bitgraphedFile and complete
 * build and close the file that carries its own proof; completeExport fills
 * an export's ceiling and settlement once they exist.
 *
 * The ground rules every verb keeps:
 * - Files are read on this machine and never uploaded; only digests, the
 *   committed artifact, slot records and each file's sealed recovery entry
 *   (only a holder of that file can open it) leave it.
 * - Recording is permanent. Bytes already on record are not made again
 *   unless asked (`again`), and a BitGraphed file is NEVER minted: the
 *   envelope is not the recorded thing, the bytes inside are.
 * - One way to make a BitGraph: these are the same pipelines the site's
 *   drop box and the MCP server run.
 */

import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { verify, verifyCarrier, verifyExport as verifyExportDocument, parseExport, createVerificationContext, parseCarrier, type BitGraphExport, type CarrierClaim, type CarrierVerifyOptions, type ExportVerifyOptions, type ExportVerifyResult } from "@mikeargento/bitgraph-verify";
import { ApiError, batchCheck, configFromEnv, getProofDetail, search, type ApiConfig } from "./api.js";
import { fromUrlSafeB64, looksLikeDigest, mapConcurrent, toUrlSafeB64 } from "./encoding.js";
import { classifyPath, fuseTreePipeline, type CarrierRow, type ClassifiedPath, type FuseFileFn, type FuseSetFn, type FuseTreeFn, type TreeSummary } from "./pipelines.js";
import { expandPaths, sniffC2paBytes, type ScannedFile } from "./scan.js";
import { carrierWindowView, type CarrierWindowView } from "./carrier-io.js";
import { beginTask, decodeTaskToken, sealTask, writeProofBeside, SLOT_TTL_SECONDS, type Begun, type SealedTask } from "./task.js";
import { buildBitGraphedFile, completeBitGraphedFile, type BuiltCarrier, type CompletedCarrier } from "./carrier-build.js";
import { completeExportFile, exportDataOf, fetchPinnedSpec, memberExportOf, ownerExportOf, writeTreeExports, type CompletedExportFile, type ExportKind, type TreeExportData, type WrittenExports } from "./exports.js";
import { MAX_FUSE_BYTES, type FuseTreeProgress } from "@mikeargento/bitgraph";
import { keepRecoveryEntries, lookupRecovered, type RecoveredRow, type RecoveryWriteResult } from "./recovery.js";
import type { BitGraphProof, ProofDetailResponse, SetMemberView } from "./types.js";

export interface BitGraphOptions {
  /** The boundary to record against. Default: BITGRAPH_API_URL, else https://bitgraph.ing (anonymous). */
  baseUrl?: string;
  /** A licensee's key. Default: BITGRAPH_API_KEY. The public boundary needs none. */
  apiKey?: string;
  /** Test seams; the default is the tree pipeline. fuseFile and fuseSet are superseded: accepted so existing callers compile, and ignored. */
  pipelines?: { fuseTree?: FuseTreeFn; fuseFile?: FuseFileFn; fuseSet?: FuseSetFn };
}

export interface RecordedFile {
  path: string;
  /** URL-safe SHA-256 of the file's own bytes; for a BitGraphed file, of the committed bytes inside. */
  digest: string;
  outcome: "recorded" | "on record" | "carried" | "refused";
  counter: string | null;
  epoch: string | null;
  proofUrl: string | null;
  /** How the file went into the tree made here: "as-is", or the placement of its committed bytes. */
  placement: string | null;
  /** This file's leaf in the tree made here (1-based), or its row in an earlier set the ledger reports. */
  member: number | null;
  memberCount: number | null;
  /** The member's own export file, when member exports were written. */
  export?: string;
  /** A BitGraphed file's offline judgment (verdict and window). */
  carrier?: CarrierWindowView;
  /** Content Credentials (C2PA) detected in the bytes. */
  c2pa?: boolean;
  error?: string;
}

/** The one tree/1 BitGraph a record call made, as data: the proof, the root document, every leaf and a name per leaf. */
export interface TreeMade extends TreeExportData {
  kind: "tree";
  format: "tree/1";
  count: number;
  proofUrl: string;
  recovered: boolean;
  rootDocumentEchoed: boolean;
  /** The export files this call wrote (record with exportDir); null when none were asked for. */
  exports: WrittenExports | null;
  /** The tree's recovery entries (SPEC section 13): written, already there, blocked, or pending and why. Null when recovery was turned off. */
  recovery: RecoveryWriteResult | null;
}

export interface RecordResult {
  /** What this call made: ONE tree of every fresh file, or nothing (everything was already on record or carried). */
  made: TreeMade | null;
  files: RecordedFile[];
}

export interface CheckedInput {
  input: string;
  digest: string;
  onRecord: boolean;
  positions: Array<{ counter: string | null; epoch: string | null; member?: SetMemberView }>;
  proofUrl: string | null;
  carrier?: CarrierWindowView;
  c2pa?: boolean;
  note?: string;
}

export interface VerifyOutcome {
  verdict: "TRUE" | "FALSE" | "UNDETERMINED";
  /** "ok" when the input was a BitGraphed file; "none" for plain bytes with a proof; "corrupt" for an unreadable block. */
  carrier: "ok" | "none" | "corrupt";
  bounds: CarrierWindowView | null;
  reasons: string[];
  /** One result per claim, each saying what it rests on (a BitGraphed file, or an export). */
  claims: CarrierClaim[];
  /** Plain language, written from the claims. */
  reading: string | null;
  /** An export only: the leaf the file matched (or the export's own member). */
  member?: ExportVerifyResult["member"];
  /** An export only: the three time claims as established (floor, Base ceiling, Ethereum settlement); null fields were not. */
  times?: ExportVerifyResult["times"];
}

/** For the confirmed level: nodes that answer the one online question per chain, and the verifier's own pins. */
export type VerifyOptions = CarrierVerifyOptions;

/** A position held before the work exists. Put `commitment` into the task, then seal it within the TTL. */
export interface Slot {
  /** Unpadded base64url: the string to put INSIDE the task. */
  commitment: string;
  commitmentB64: string;
  slotCounter: string;
  epoch: string;
  floor: { block: number } | null;
  /** 2 when the commitment binds the floor block (bitgraph-fuse/2), else 1. */
  fuseVersion: 1 | 2;
  /** Survives process boundaries: `bitgraph seal --token ...` or BitGraph.seal(token, ...). */
  token: string;
  ttlSeconds: number;
  seal: (task: string | Uint8Array | { digestB64: string }) => Promise<SealedTask>;
}

const MAX_FILES = 100_000;

export class BitGraph {
  readonly config: ApiConfig;
  private readonly fuseTree: FuseTreeFn;

  constructor(options: BitGraphOptions = {}) {
    const env = configFromEnv();
    const baseUrl = (options.baseUrl ?? env.baseUrl).replace(/\/+$/, "");
    const apiKey = options.apiKey ?? env.apiKey;
    this.config = apiKey !== undefined ? { baseUrl, apiKey } : { baseUrl };
    this.fuseTree = options.pipelines?.fuseTree ?? fuseTreePipeline;
  }

  proofUrl(standardDigest: string, counter?: string | null, epochId?: string | null): string {
    let url = `${this.config.baseUrl}/proof/${encodeURIComponent(toUrlSafeB64(standardDigest))}`;
    if (typeof counter === "string") {
      url += `?counter=${encodeURIComponent(counter)}`;
      if (typeof epochId === "string") url += `&epoch=${encodeURIComponent(toUrlSafeB64(epochId))}`;
    }
    return url;
  }

  /**
   * Make ONE BitGraph of the given files and folders: a tree/1, every fresh
   * file one leaf under one position (a single file is a tree of one; a file
   * over 256 MiB goes in as is). Files already on record come back as "on
   * record" untouched (pass `again: true` to make a new BitGraph
   * regardless), and a BitGraphed file is judged from the proof it carries
   * and never minted. With `exportDir`, the export/1 files are written there
   * (`exports`: the owner's, one per member, both or none; default the
   * owner's); without it, `made` holds everything they are built from.
   * A file in an earlier tree is found by its sealed recovery entry before it
   * is called fresh, and each file made here gets one (`made.recovery` says
   * which were written); `recovery: false` does neither.
   */
  async record(
    paths: string | readonly string[],
    opts: { again?: boolean; onProgress?: (p: FuseTreeProgress) => void; exportDir?: string; exports?: ExportKind; recovery?: boolean } = {}
  ): Promise<RecordResult> {
    const list = typeof paths === "string" ? [paths] : [...paths];
    const { files } = await expandPaths(list, MAX_FILES);
    if (files.length === 0) throw new ApiError(400, "nothing to record: the given directories hold no regular files");

    const classified: ClassifiedPath[] = await mapConcurrent(files, 4, (p) => classifyPath(p));
    const plains = classified.filter((c): c is { kind: "plain"; file: ScannedFile } => c.kind === "plain").map((c) => c.file);
    const carriers = classified.filter((c): c is CarrierRow => c.kind === "carrier");

    // Unique by content; the first path names the member.
    const byDigest = new Map<string, { file: ScannedFile; paths: string[] }>();
    for (const f of plains) {
      const entry = byDigest.get(f.digestB64) ?? { file: f, paths: [] };
      entry.paths.push(f.path);
      byDigest.set(f.digestB64, entry);
    }
    const unique = [...byDigest.keys()];
    const carrierInner = [...new Set(carriers.filter((c) => c.innerDigestB64 !== null).map((c) => c.innerDigestB64 as string))];
    const lookups = [...new Set([...unique, ...carrierInner])];
    const checked = lookups.length > 0 ? await batchCheck(this.config, lookups.map(toUrlSafeB64)) : { results: {} as Record<string, { proofs: Array<{ proof: BitGraphProof; member?: SetMemberView }> }> };
    const rowsFor = (d: string) => checked.results[toUrlSafeB64(d)]?.proofs ?? [];

    // A file made inside a tree is never indexed by its plain hash, so the
    // ledger's silence is not "new": its sealed recovery entry is asked first
    // (recovery.ts). A file verified there is on record and not made again.
    const recovered = opts.recovery !== false && !opts.again
      ? await lookupRecovered(unique.filter((d) => rowsFor(d).length === 0).map((d) => (byDigest.get(d) as { file: ScannedFile }).file), this.config)
      : null;
    const knownRows = (d: string): Array<{ proof: BitGraphProof; member?: SetMemberView } | RecoveredRow> => (rowsFor(d).length > 0 ? rowsFor(d) : recovered?.found.get(d) ?? []);

    const fresh = (opts.again ? unique : unique.filter((d) => knownRows(d).length === 0)).map((d) => (byDigest.get(d) as { file: ScannedFile }).file);
    // A file over the cap goes in as is by the digest its scan took; when its
    // length changed while it was read, that digest is not the file's.
    const unstable = new Set(fresh.filter((f) => f.state === null && f.size > MAX_FUSE_BYTES).map((f) => f.digestB64));
    const toMint = fresh.filter((f) => !unstable.has(f.digestB64));

    let made: TreeMade | null = null;
    const memberOf = new Map<string, TreeSummary["members"][number]>();
    const exportOf = new Map<number, string>();
    if (toMint.length > 0) {
      const tree = await this.fuseTree(toMint, this.config, opts.onProgress !== undefined ? { onProgress: opts.onProgress } : {});
      made = await this.madeFrom(tree, toMint);
      // The tree's recovery entries, written after the proof is in hand and never in its way.
      if (opts.recovery !== false) made.recovery = await keepRecoveryEntries({ proof: made.proof, rootDocumentHex: made.rootDocument, leavesB64: made.leaves, names: made.names }, this.config);
      for (const m of tree.members) memberOf.set((toMint[m.index] as ScannedFile).digestB64, m);
      const kind = opts.exports ?? "owner";
      if (opts.exportDir !== undefined && kind !== "none") {
        const spec = await fetchPinnedSpec(this.config, made.proof.attribution?.message ?? "");
        made.exports = await writeTreeExports(made, { dir: opts.exportDir, kind, spec });
        for (const m of made.exports.members) exportOf.set(m.leafIndex, m.path);
      }
    }

    const out: RecordedFile[] = [];
    for (const [digest, entry] of byDigest) {
      const minted = memberOf.get(digest);
      const prior = knownRows(digest);
      for (const path of entry.paths) {
        const c2pa = entry.file.c2pa ? { c2pa: true as const } : {};
        if (minted !== undefined && made !== null) {
          const memberExport = exportOf.get(minted.leafIndex);
          out.push({
            path, digest: toUrlSafeB64(digest), outcome: "recorded",
            counter: made.counter, epoch: made.epoch,
            proofUrl: made.proofUrl,
            placement: minted.placement,
            member: minted.leafIndex + 1,
            memberCount: made.count,
            ...(memberExport !== undefined ? { export: memberExport } : {}),
            ...c2pa,
          });
        } else if (unstable.has(digest)) {
          out.push({ path, digest: toUrlSafeB64(digest), outcome: "refused", counter: null, epoch: null, proofUrl: null, placement: null, member: null, memberCount: null, error: `the file changed while it was read and is over ${MAX_FUSE_BYTES / (1024 * 1024)} MiB, so its digest is not the file's; record it again when it is still`, ...c2pa });
        } else if (prior.length > 0) {
          const first = prior[0] as { proof: BitGraphProof; member?: SetMemberView; tree?: true };
          out.push({
            path, digest: toUrlSafeB64(digest), outcome: "on record",
            counter: first.proof.commit?.counter ?? null,
            epoch: first.proof.commit?.epochId !== undefined ? toUrlSafeB64(first.proof.commit.epochId) : null,
            // A tree member is never indexed by its own hash: its proof page is the tree's.
            proofUrl: first.tree && typeof first.proof.artifact?.digestB64 === "string" ? this.proofUrl(first.proof.artifact.digestB64, first.proof.commit?.counter ?? null, first.proof.commit?.epochId ?? null) : this.proofUrl(digest), placement: null,
            member: first.member ? first.member.index + 1 : null,
            memberCount: first.member ? first.member.count : null,
            ...c2pa,
          });
        } else {
          out.push({ path, digest: toUrlSafeB64(digest), outcome: "refused", counter: null, epoch: null, proofUrl: null, placement: null, member: null, memberCount: null, error: "not attempted", ...c2pa });
        }
      }
    }
    for (const c of carriers) {
      if (c.status !== "ok" || c.innerDigestB64 === null) {
        out.push({ path: c.path, digest: "", outcome: "refused", counter: null, epoch: null, proofUrl: null, placement: null, member: null, memberCount: null, error: c.reason ?? "unreadable BitGraphed file" });
        continue;
      }
      const rows = rowsFor(c.innerDigestB64);
      const first = rows[0] as { proof: BitGraphProof; member?: SetMemberView } | undefined;
      out.push({
        path: c.path, digest: toUrlSafeB64(c.innerDigestB64),
        outcome: first !== undefined ? "on record" : "carried",
        counter: first?.proof.commit?.counter ?? null,
        epoch: first?.proof.commit?.epochId !== undefined ? toUrlSafeB64(first.proof.commit.epochId) : null,
        proofUrl: first !== undefined ? this.proofUrl(c.innerDigestB64) : null,
        placement: null, member: null, memberCount: null,
        ...(c.view ? { carrier: c.view } : {}), ...(c.c2pa ? { c2pa: true as const } : {}),
      });
    }
    return { made, files: out };
  }

  /**
   * A tree as data (exportDataOf): names under the deepest folder holding
   * every file, and the floor block's header when the site has it (null
   * otherwise; `bitgraph export complete` fetches it later).
   */
  private async madeFrom(tree: TreeSummary, files: readonly ScannedFile[]): Promise<TreeMade> {
    const data = await exportDataOf(tree, files.map((f) => f.path), this.config);
    return {
      kind: "tree",
      format: "tree/1",
      count: tree.count,
      ...data,
      proofUrl: this.proofUrl(tree.artifactDigestB64, data.counter, tree.proof.commit?.epochId ?? null),
      recovered: tree.recovered,
      rootDocumentEchoed: tree.rootDocumentEchoed,
      exports: null,
      recovery: null,
    };
  }

  /** The owner's export of a tree this SDK made: every leaf and a name per leaf. */
  ownerExport(made: TreeExportData): BitGraphExport {
    return ownerExportOf(made);
  }

  /** One member's export of a tree this SDK made, by its leaf (RecordedFile.member - 1). */
  memberExport(made: TreeExportData, leafIndex: number): BitGraphExport {
    return memberExportOf(made, leafIndex);
  }

  /** Write a made tree's exports into a folder: the owner's (default), one per member, or both, with SPEC.md beside them when the site serves the pinned text. Never over an existing file. */
  async writeExports(made: TreeExportData, dir: string, kind: ExportKind = "owner"): Promise<WrittenExports> {
    const spec = kind === "none" ? null : await fetchPinnedSpec(this.config, made.proof.attribution?.message ?? "");
    return writeTreeExports(made, { dir, kind, spec });
  }

  /**
   * Fetch what an export file is waiting for (the floor header, the Base
   * ceiling, its settlement on Ethereum), each verified before it is added;
   * the file is written back when anything was, or to `out`.
   */
  completeExport(path: string, opts: { out?: string; waitMs?: number } = {}): Promise<CompletedExportFile> {
    return completeExportFile(this.config, path, opts);
  }

  /**
   * Check an export/1 offline, one claim per line, with the file it is about
   * when given (its original or its committed bytes). The export is a path,
   * its JSON text, or the parsed object. The lookups and pins confirm the
   * blocks and name the images and the ceiling writer accepted.
   */
  async verifyExport(input: string | object, file?: string | Uint8Array, opts: VerifyOptions = {}): Promise<VerifyOutcome> {
    let exp: unknown = input;
    if (typeof input === "string") exp = input.trimStart().startsWith("{") ? input : await readFile(input, "utf8");
    if (parseExport(exp) === null) throw new ApiError(400, "not a bitgraph-export/1 document");
    const bytes = file === undefined ? undefined : typeof file === "string" ? new Uint8Array(await readFile(file)) : file;
    const pins = opts.pins;
    const exportPins: NonNullable<ExportVerifyOptions["pins"]> = {
      ...(pins?.pcr0 !== undefined ? { pcr0: pins.pcr0 } : {}),
      ...(pins?.ceilingWriter !== undefined ? { ceilingWriter: pins.ceilingWriter } : {}),
      ...(pins?.baseChainId !== undefined ? { baseChainId: pins.baseChainId } : {}),
    };
    const r = await verifyExportDocument(exp, {
      ...(bytes !== undefined ? { bytes } : {}),
      ...(opts.lookups !== undefined ? { lookups: opts.lookups } : {}),
      ...(Object.keys(exportPins).length > 0 ? { pins: exportPins } : {}),
    });
    return { verdict: r.verdict, carrier: "none", bounds: null, reasons: r.reasons, claims: r.claims, reading: r.reading, member: r.member, times: r.times };
  }

  /** Read-only: are these bytes on record? Paths, folders, raw digests or bytes; a BitGraphed file is judged offline and looked up by the committed bytes inside. */
  async check(inputs: string | Uint8Array | readonly string[]): Promise<CheckedInput[]> {
    const items: Array<{ label: string; digest: string; carrier?: CarrierWindowView; c2pa?: boolean; note?: string }> = [];
    const list = inputs instanceof Uint8Array ? [inputs] : typeof inputs === "string" ? [inputs] : [...inputs];
    const pathsToExpand: string[] = [];
    for (const input of list) {
      if (input instanceof Uint8Array) {
        const digest = createHash("sha256").update(input).digest("base64");
        items.push({ label: "(bytes)", digest, ...(sniffC2paBytes(input) ? { c2pa: true } : {}) });
      } else if (looksLikeDigest(input.trim()) && !(await pathExists(input))) {
        items.push({ label: input, digest: fromUrlSafeB64(input.trim()) });
      } else {
        pathsToExpand.push(input);
      }
    }
    if (pathsToExpand.length > 0) {
      const { files } = await expandPaths(pathsToExpand, MAX_FILES);
      const classified = await mapConcurrent(files, 4, (p) => classifyPath(p));
      classified.forEach((c, i) => {
        const label = files[i] as string;
        if (c.kind === "plain") items.push({ label, digest: c.file.digestB64, ...(c.file.c2pa ? { c2pa: true } : {}) });
        else if (c.status === "ok" && c.innerDigestB64 !== null) items.push({ label, digest: c.innerDigestB64, ...(c.view ? { carrier: c.view } : {}), ...(c.c2pa ? { c2pa: true } : {}) });
        else items.push({ label, digest: "", note: c.reason ?? "unreadable BitGraphed file" });
      });
    }
    const lookable = [...new Set(items.filter((i) => i.digest !== "").map((i) => toUrlSafeB64(i.digest)))];
    const checked = lookable.length > 0 ? await batchCheck(this.config, lookable) : { results: {} };
    return items.map((i) => {
      const rows = i.digest === "" ? [] : (checked.results[toUrlSafeB64(i.digest)]?.proofs ?? []);
      return {
        input: i.label,
        digest: i.digest === "" ? "" : toUrlSafeB64(i.digest),
        onRecord: rows.length > 0,
        positions: rows.map((p) => ({
          counter: p.proof.commit?.counter ?? null,
          epoch: p.proof.commit?.epochId !== undefined ? toUrlSafeB64(p.proof.commit.epochId) : null,
          ...(p.member ? { member: p.member } : {}),
        })),
        proofUrl: rows.length > 0 ? this.proofUrl(i.digest) : null,
        ...(i.carrier ? { carrier: i.carrier } : {}),
        ...(i.c2pa ? { c2pa: true } : {}),
        ...(i.note !== undefined ? { note: i.note } : {}),
      };
    });
  }

  /** Fetch a proof and its context by digest, path, or BitGraph number. A path to a BitGraphed file looks up the committed bytes inside it. */
  async proof(sel: { digest?: string; path?: string; number?: string; counter?: string; epoch?: string }): Promise<ProofDetailResponse & { carrier?: CarrierWindowView }> {
    const given = [sel.digest, sel.path, sel.number].filter((v) => v !== undefined);
    if (given.length !== 1) throw new ApiError(400, "pass exactly one of digest, path, or number");
    let urlSafeDigest: string;
    let counter = sel.counter;
    let carrierView: CarrierWindowView | undefined;
    if (sel.number !== undefined) {
      const r = await search(this.config, sel.number);
      if (!r.found || r.digest === undefined) throw new ApiError(404, `no BitGraph found for number "${sel.number}" in the current epoch`);
      urlSafeDigest = r.digest;
      if (counter === undefined && r.counter != null) counter = r.counter;
    } else if (sel.path !== undefined) {
      const c = await classifyPath(sel.path);
      if (c.kind === "carrier") {
        if (c.status !== "ok" || c.innerDigestB64 === null) throw new ApiError(400, c.reason ?? "unreadable BitGraphed file");
        urlSafeDigest = toUrlSafeB64(c.innerDigestB64);
        if (c.view) carrierView = c.view;
      } else {
        urlSafeDigest = toUrlSafeB64(c.file.digestB64);
      }
    } else {
      const trimmed = (sel.digest as string).trim();
      if (!looksLikeDigest(trimmed)) throw new ApiError(400, "not a base64 SHA-256 digest");
      urlSafeDigest = toUrlSafeB64(fromUrlSafeB64(trimmed));
    }
    const epoch = sel.epoch !== undefined ? toUrlSafeB64(fromUrlSafeB64(sel.epoch)) : undefined;
    const detail = await getProofDetail(this.config, urlSafeDigest, counter, epoch);
    if (detail.proofs.length === 0) throw new ApiError(404, `not on record: no proof exists for digest ${urlSafeDigest}`);
    return carrierView !== undefined ? { ...detail, carrier: carrierView } : detail;
  }

  /**
   * Hold a position BEFORE the work exists. Put `commitment` into the task
   * (the prompt, a seed, a line in the document), then `seal` the task bytes
   * within the TTL: the task then could not have existed before the
   * position's floor, and outputs recorded afterwards sit later.
   */
  async open(): Promise<Slot> {
    const begun: Begun = await beginTask(this.config);
    return this.slotFrom(begun);
  }

  /** Seal with a token from another process (`bitgraph open` printed it). */
  async seal(token: string, task: string | Uint8Array | { digestB64: string }): Promise<SealedTask> {
    const state = decodeTaskToken(token);
    if (state === null) throw new ApiError(400, "not a task token from open()");
    return sealTask(this.config, state, normalizeTask(task));
  }

  private slotFrom(begun: Begun): Slot {
    return {
      commitment: begun.commitment,
      commitmentB64: begun.commitmentB64,
      slotCounter: begun.slotCounter,
      epoch: begun.epoch,
      floor: begun.floor,
      fuseVersion: begun.fuseVersion,
      token: begun.token,
      ttlSeconds: SLOT_TTL_SECONDS,
      seal: (task) => this.seal(begun.token, task),
    };
  }

  /**
   * Fully offline judgment, no network ever. A BitGraphed file needs nothing
   * else; plain bytes need their proof, or their export/1 (passed in place of
   * the proof, as the object or its JSON text), which verifyExport answers.
   */
  async verify(input: string | Uint8Array, proof?: unknown, opts: VerifyOptions = {}): Promise<VerifyOutcome> {
    const bytes = typeof input === "string" ? new Uint8Array(await readFile(input)) : input;
    if (proof !== undefined && proof !== null && parseExport(proof) !== null) return this.verifyExport(proof as string | object, bytes, opts);
    const parsed = parseCarrier(bytes);
    if (parsed.kind === "carrier" || parsed.kind === "corrupt") {
      const r = await verifyCarrier(bytes, opts);
      return { verdict: r.verdict, carrier: r.carrier === "none" ? "none" : r.carrier, bounds: r.bounds !== null ? carrierWindowView(r) : null, reasons: r.reasons, claims: r.claims, reading: r.reading };
    }
    if (proof === undefined || proof === null) {
      return { verdict: "UNDETERMINED", carrier: "none", bounds: null, reasons: ["plain bytes carry no proof inside; pass the proof to verify them"], claims: [], reading: null };
    }
    const r = await verify({ proof: proof as Parameters<typeof verify>[0]["proof"], bytes, context: createVerificationContext() });
    return { verdict: r.valid ? "TRUE" : "FALSE", carrier: "none", bounds: null, reasons: r.valid ? [] : [r.reason ?? "the proof does not verify"], claims: [], reading: null };
  }

  /** Build the BitGraphed file (bitgraph-carrier/2) for committed bytes already on record: the proof, the floor, both ceilings when they exist, and the attestation as openssl-checkable evidence, all inside. */
  async bitgraphedFile(input: string | Uint8Array, opts: { fileName?: string; waitForCeilingMs?: number } = {}): Promise<BuiltCarrier> {
    const bytes = typeof input === "string" ? new Uint8Array(await readFile(input)) : input;
    const name = opts.fileName ?? (typeof input === "string" ? (input.split("/").pop() as string) : "artifact");
    return buildBitGraphedFile(this.config, bytes, name, opts.waitForCeilingMs !== undefined ? { waitForCeilingMs: opts.waitForCeilingMs } : {});
  }

  /** Fetch what followed the commit into an existing BitGraphed file: the closing anchor and, on a /2 file, the Base block. Nothing already inside is overwritten. */
  async complete(input: string | Uint8Array, opts: { waitForCeilingMs?: number } = {}): Promise<CompletedCarrier> {
    const bytes = typeof input === "string" ? new Uint8Array(await readFile(input)) : input;
    return completeBitGraphedFile(this.config, bytes, opts.waitForCeilingMs !== undefined ? { waitForCeilingMs: opts.waitForCeilingMs } : {});
  }

  /** Write a sealed task's proof beside its file, whole, exactly as returned. */
  writeProofBeside = writeProofBeside;
}

function normalizeTask(task: string | Uint8Array | { digestB64: string }): { path: string } | { bytes: Uint8Array } | { digestB64: string } {
  if (typeof task === "string") return { path: task };
  if (task instanceof Uint8Array) return { bytes: task };
  return task;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    const { access } = await import("node:fs/promises");
    await access(p);
    return true;
  } catch {
    return false;
  }
}
