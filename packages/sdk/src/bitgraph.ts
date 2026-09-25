// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * The BitGraph SDK's one object.
 *
 *   import { BitGraph } from "@mikeargento/bitgraph-sdk";
 *   const bg = new BitGraph();
 *   const r = await bg.record("run-042.log");
 *   console.log(r.files[0].proofUrl);
 *
 * Six verbs. record makes ONE BitGraph of everything in a call (one file is
 * fused on its own slot; two or more become one set under one position).
 * check and proof are read-only. open holds a position BEFORE any work
 * exists, and its seal commits the task that carries the commitment. verify
 * judges proofs and BitGraphed files fully offline. bitgraphedFile and
 * complete build and close the file that carries its own proof.
 *
 * The ground rules every verb keeps:
 * - Files are read on this machine and never uploaded; only digests, the
 *   committed artifact and slot records leave it.
 * - Recording is permanent. Bytes already on record are not made again
 *   unless asked (`again`), and a BitGraphed file is NEVER minted: the
 *   envelope is not the recorded thing, the bytes inside are.
 * - One way to make a BitGraph: these are the same pipelines the site's
 *   drop box and the MCP server run.
 */

import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { verify, verifyCarrier, createVerificationContext, parseCarrier } from "@mikeargento/bitgraph-verify";
import { ApiError, batchCheck, configFromEnv, getProofDetail, search, type ApiConfig } from "./api.js";
import { fromUrlSafeB64, looksLikeDigest, mapConcurrent, toUrlSafeB64 } from "./encoding.js";
import { classifyPath, fuseFilePipeline, fuseSetPipeline, type CarrierRow, type ClassifiedPath, type FuseFileFn, type FuseSetFn, type SetSummary } from "./pipelines.js";
import { expandPaths, sniffC2paBytes, type ScannedFile } from "./scan.js";
import { carrierWindowView, type CarrierWindowView } from "./carrier-io.js";
import { beginTask, decodeTaskToken, sealTask, writeProofBeside, SLOT_TTL_SECONDS, type Begun, type SealedTask } from "./task.js";
import { buildBitGraphedFile, completeBitGraphedFile, type BuiltCarrier, type CompletedCarrier } from "./carrier-build.js";
import { MAX_SET_MEMBERS, type FuseSetProgress } from "@mikeargento/bitgraph";
import type { BitGraphProof, ProofDetailResponse, SetMemberView } from "./types.js";

export interface BitGraphOptions {
  /** The boundary to record against. Default: BITGRAPH_API_URL, else https://bitgraph.ing (anonymous). */
  baseUrl?: string;
  /** A licensee's key. Default: BITGRAPH_API_KEY. The public boundary needs none. */
  apiKey?: string;
  /** Test seams; the defaults are the site's own pipelines. */
  pipelines?: { fuseFile?: FuseFileFn; fuseSet?: FuseSetFn };
}

export interface RecordedFile {
  path: string;
  /** URL-safe SHA-256 of the file's own bytes; for a BitGraphed file, of the committed bytes inside. */
  digest: string;
  outcome: "recorded" | "on record" | "carried" | "refused";
  counter: string | null;
  epoch: string | null;
  proofUrl: string | null;
  placement: string | null;
  /** This file's row in the set made here (1-based), when a set was made. */
  member: number | null;
  memberCount: number | null;
  /** A BitGraphed file's offline judgment (verdict and window). */
  carrier?: CarrierWindowView;
  /** Content Credentials (C2PA) detected in the bytes. */
  c2pa?: boolean;
  error?: string;
}

export interface RecordResult {
  /** What this call made: one solo BitGraph, one set, or nothing (everything was already on record or carried). */
  made:
    | { kind: "solo"; counter: string | null; epoch: string | null; artifactDigest: string; proofUrl: string; proof: BitGraphProof; frame: unknown }
    | { kind: "set"; set: "set/1" | "set/2"; count: number; counter: string | null; epoch: string | null; artifactDigest: string; proofUrl: string; proof: BitGraphProof; members: SetSummary["members"] }
    | null;
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
}

/** A position held before the work exists. Put `commitment` into the task, then seal it within the TTL. */
export interface Slot {
  /** Unpadded base64url: the string to put INSIDE the task. */
  commitment: string;
  commitmentB64: string;
  slotCounter: string;
  epoch: string;
  floor: { block: number } | null;
  /** Survives process boundaries: `bitgraph seal --token ...` or BitGraph.seal(token, ...). */
  token: string;
  ttlSeconds: number;
  seal: (task: string | Uint8Array | { digestB64: string }) => Promise<SealedTask>;
}

const MAX_FILES = 100_000;

export class BitGraph {
  readonly config: ApiConfig;
  private readonly fuseFile: FuseFileFn;
  private readonly fuseSet: FuseSetFn;

  constructor(options: BitGraphOptions = {}) {
    const env = configFromEnv();
    const baseUrl = (options.baseUrl ?? env.baseUrl).replace(/\/+$/, "");
    const apiKey = options.apiKey ?? env.apiKey;
    this.config = apiKey !== undefined ? { baseUrl, apiKey } : { baseUrl };
    this.fuseFile = options.pipelines?.fuseFile ?? fuseFilePipeline;
    this.fuseSet = options.pipelines?.fuseSet ?? fuseSetPipeline;
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
   * Make ONE BitGraph of the given files and folders. A single fresh file is
   * fused on its own slot; two or more become one set under one position.
   * Files already on record come back as "on record" untouched (pass
   * `again: true` to make a new BitGraph regardless), and a BitGraphed file
   * is judged from the proof it carries and never minted.
   */
  async record(paths: string | readonly string[], opts: { again?: boolean; onProgress?: (p: FuseSetProgress) => void } = {}): Promise<RecordResult> {
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

    const toMint = (opts.again ? unique : unique.filter((d) => rowsFor(d).length === 0)).map((d) => (byDigest.get(d) as { file: ScannedFile }).file);

    let made: RecordResult["made"] = null;
    const memberOf = new Map<string, SetSummary["members"][number]>();
    if (toMint.length === 1) {
      const one = toMint[0] as ScannedFile;
      const solo = await this.fuseFile(one, this.config);
      const counter = solo.proof.commit?.counter ?? null;
      const epochId = solo.proof.commit?.epochId ?? null;
      made = {
        kind: "solo", counter, epoch: epochId !== null ? toUrlSafeB64(epochId) : null,
        artifactDigest: toUrlSafeB64(solo.artifactDigestB64),
        proofUrl: this.proofUrl(solo.artifactDigestB64, counter, epochId),
        proof: solo.proof, frame: solo.frame,
      };
      memberOf.set(one.digestB64, { index: 0, manifestIndex: 0, placement: solo.placement, originDigestB64: one.digestB64, artifactDigestB64: solo.artifactDigestB64 });
    } else if (toMint.length > 1) {
      const kind: "set/1" | "set/2" = toMint.length > MAX_SET_MEMBERS ? "set/2" : "set/1";
      const set = await this.fuseSet(toMint, this.config, {
        set: kind,
        ...(opts.onProgress !== undefined ? { onProgress: opts.onProgress } : {}),
      });
      const counter = set.proof.commit?.counter ?? null;
      const epochId = set.proof.commit?.epochId ?? null;
      made = {
        kind: "set", set: set.set, count: set.count, counter,
        epoch: epochId !== null ? toUrlSafeB64(epochId) : null,
        artifactDigest: toUrlSafeB64(set.artifactDigestB64),
        proofUrl: this.proofUrl(set.artifactDigestB64, counter, epochId),
        proof: set.proof, members: set.members,
      };
      for (const m of set.members) memberOf.set(m.originDigestB64, m);
    }

    const out: RecordedFile[] = [];
    for (const [digest, entry] of byDigest) {
      const minted = memberOf.get(digest);
      const prior = rowsFor(digest);
      for (const path of entry.paths) {
        const c2pa = entry.file.c2pa ? { c2pa: true as const } : {};
        if (minted !== undefined && made !== null) {
          out.push({
            path, digest: toUrlSafeB64(digest), outcome: "recorded",
            counter: made.counter, epoch: made.epoch,
            proofUrl: made.kind === "solo" ? made.proofUrl : this.proofUrl(digest, made.counter ?? undefined, undefined),
            placement: minted.placement,
            member: made.kind === "set" ? minted.manifestIndex + 1 : null,
            memberCount: made.kind === "set" ? made.count : null,
            ...c2pa,
          });
        } else if (prior.length > 0) {
          const first = prior[0] as { proof: BitGraphProof; member?: SetMemberView };
          out.push({
            path, digest: toUrlSafeB64(digest), outcome: "on record",
            counter: first.proof.commit?.counter ?? null,
            epoch: first.proof.commit?.epochId !== undefined ? toUrlSafeB64(first.proof.commit.epochId) : null,
            proofUrl: this.proofUrl(digest), placement: null,
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
      token: begun.token,
      ttlSeconds: SLOT_TTL_SECONDS,
      seal: (task) => this.seal(begun.token, task),
    };
  }

  /**
   * Fully offline judgment, no network ever. A BitGraphed file needs nothing
   * else; plain bytes need their proof.
   */
  async verify(input: string | Uint8Array, proof?: unknown): Promise<VerifyOutcome> {
    const bytes = typeof input === "string" ? new Uint8Array(await readFile(input)) : input;
    const parsed = parseCarrier(bytes);
    if (parsed.kind === "carrier" || parsed.kind === "corrupt") {
      const r = await verifyCarrier(bytes);
      return { verdict: r.verdict, carrier: r.carrier === "none" ? "none" : r.carrier, bounds: r.bounds !== null ? carrierWindowView(r) : null, reasons: r.reasons };
    }
    if (proof === undefined || proof === null) {
      return { verdict: "UNDETERMINED", carrier: "none", bounds: null, reasons: ["plain bytes carry no proof inside; pass the proof to verify them"] };
    }
    const r = await verify({ proof: proof as Parameters<typeof verify>[0]["proof"], bytes, context: createVerificationContext() });
    return { verdict: r.valid ? "TRUE" : "FALSE", carrier: "none", bounds: null, reasons: r.valid ? [] : [r.reason ?? "the proof does not verify"] };
  }

  /** Build the BitGraphed file for committed bytes already on record: the file that carries its own proof, floor inside, ceiling when it exists. */
  async bitgraphedFile(input: string | Uint8Array, opts: { fileName?: string; waitForCeilingMs?: number } = {}): Promise<BuiltCarrier> {
    const bytes = typeof input === "string" ? new Uint8Array(await readFile(input)) : input;
    const name = opts.fileName ?? (typeof input === "string" ? (input.split("/").pop() as string) : "artifact");
    return buildBitGraphedFile(this.config, bytes, name, opts.waitForCeilingMs !== undefined ? { waitForCeilingMs: opts.waitForCeilingMs } : {});
  }

  /** Fetch the closing anchor into an existing BitGraphed file. A ceiling already inside is never overwritten. */
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
