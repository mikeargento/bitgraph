// Copyright (c) 2025-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * The BitGraph SDK's one object.
 *
 *   import { BitGraph } from "@mikeargento/bitgraph-sdk";
 *   const bg = new BitGraph();
 *   const r = await bg.record("run-042.log");
 *   console.log(r.made?.number, r.made?.nonce, r.files[0]?.proofPath);
 *
 * Four verbs. record makes BitGraphs exactly as the site's drop box does: one
 * new file is one BitGraph, several new files are one tree and one BitGraph,
 * and each file's proof is saved beside it. check and proof are read-only.
 * verify judges a proof, or a BitGraphed file, fully offline.
 *
 * Each BitGraph is one atomic action in the enclave: a fresh nonce that never
 * existed before takes count N, the SHA-256 is bound at N+1, both are signed
 * together, attested by AWS Nitro, and chained to the previous proof. The
 * nonce comes back in every result: content that includes it was made after
 * it existed.
 *
 * Files are read on this machine and never uploaded; only digests leave it.
 * A BitGraph is permanent: make one only of what was asked for.
 */

import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { verify, verifyAttested, verifyCarrier, createVerificationContext, parseCarrier, type CarrierClaim } from "@mikeargento/bitgraph-verify";
import { ApiError, batchCheck, configFromEnv, getProofDetail, search, type ApiConfig } from "./api.js";
import { fromUrlSafeB64, looksLikeDigest, mapConcurrent, toUrlSafeB64 } from "./encoding.js";
import { expandPaths, sniffC2paBytes, type ScannedFile } from "./scan.js";
import { carrierWindowView, classifyPath, type CarrierWindowView } from "./carrier-io.js";
import { lookupRecovered } from "./recovery.js";
import { proofPageUrl, recordFiles, type RecordOptions, type RecordResult } from "./record.js";
import type { BitGraphProof, ProofDetailResponse, SetMemberView } from "./types.js";

export type { MadeBitGraph, RecordedFile, RecordOptions, RecordResult } from "./record.js";

export interface BitGraphOptions {
  /** The site to record against. Default: BITGRAPH_API_URL, else https://bitgraph.ing. */
  baseUrl?: string;
  /** A licensee's key. Default: BITGRAPH_API_KEY. The public site needs none. */
  apiKey?: string;
  /** Which proofs a tree lookup accepts: BitGraph's published images (the default, also BITGRAPH_RECOVERY_TRUST), or "none" for the signature and tree alone (tests). */
  recoveryTrust?: "published" | "none";
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
  /** A BitGraphed file's judgment; null otherwise. */
  view: CarrierWindowView | null;
  reasons: string[];
  /** One result per claim, for a BitGraphed file. */
  claims: CarrierClaim[];
  /** Plain language, written from the result. */
  reading: string | null;
}

/** The verifier's own pins: the enclave images accepted (PCR0, hex) and, for tests, another attestation root. */
export interface VerifyOptions {
  pins?: { pcr0?: readonly string[]; rootDer?: Uint8Array };
}

const MAX_FILES = 100_000;

export class BitGraph {
  readonly config: ApiConfig;
  private readonly recoveryTrust: "published" | "none" | undefined;

  constructor(options: BitGraphOptions = {}) {
    this.recoveryTrust = options.recoveryTrust;
    const env = configFromEnv();
    const baseUrl = (options.baseUrl ?? env.baseUrl).replace(/\/+$/, "");
    const apiKey = options.apiKey ?? env.apiKey;
    this.config = apiKey !== undefined ? { baseUrl, apiKey } : { baseUrl };
  }

  proofUrl(standardDigest: string, counter?: string | null, epochId?: string | null): string {
    return proofPageUrl(this.config.baseUrl, standardDigest, counter, epochId);
  }

  /**
   * Make BitGraphs of the given files and folders (a folder is every regular
   * file under it, hidden entries and symbolic links left out). One new file
   * is one BitGraph of its own SHA-256; several new files are one tree and
   * one BitGraph of the tree's root. Each proof is saved beside its file as
   * <file>.bitgraph.json unless `write` is false. Files already on record
   * come back as "on record" and nothing is made for them; if the lookup
   * fails, nothing is made at all.
   */
  record(paths: string | readonly string[], opts: RecordOptions = {}): Promise<RecordResult> {
    return recordFiles(this.config, typeof paths === "string" ? [paths] : paths, opts);
  }

  /** Read-only: are these bytes on record? Paths, folders, raw digests or bytes; a BitGraphed file is judged offline and looked up by the committed bytes inside. */
  async check(inputs: string | Uint8Array | readonly string[]): Promise<CheckedInput[]> {
    const items: Array<{ label: string; digest: string; file?: ScannedFile; carrier?: CarrierWindowView; c2pa?: boolean; note?: string }> = [];
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
        if (c.kind === "plain") items.push({ label, digest: c.file.digestB64, file: c.file, ...(c.file.c2pa ? { c2pa: true } : {}) });
        else if (c.status === "ok" && c.innerDigestB64 !== null) items.push({ label, digest: c.innerDigestB64, ...(c.view ? { carrier: c.view } : {}), ...(c.c2pa ? { c2pa: true } : {}) });
        else items.push({ label, digest: "", note: c.reason ?? "unreadable BitGraphed file" });
      });
    }
    const lookable = [...new Set(items.filter((i) => i.digest !== "").map((i) => toUrlSafeB64(i.digest)))];
    const checked = lookable.length > 0 ? await batchCheck(this.config, lookable) : { results: {} };
    // Files of tree/1 trees are found through their sealed lookup entries
    // (recovery.ts), which the plain lookup above cannot see, so each plain
    // file's entry is asked too. Both lookups run for every plain file, so a
    // file bound alone AND in a tree lists both. A lookup that did not
    // complete is said, never read as "no".
    const plain = items.filter((i): i is typeof i & { file: ScannedFile } => i.file !== undefined);
    const recovered = plain.length > 0
      ? await lookupRecovered(plain.map((i) => i.file), this.config, this.recoveryTrust !== undefined ? { trust: this.recoveryTrust } : {})
      : null;
    return items.map((i) => {
      const plainRows = i.digest === "" ? [] : (checked.results[toUrlSafeB64(i.digest)]?.proofs ?? []);
      const treeRows = i.file !== undefined ? (recovered?.found.get(i.file.digestB64) ?? []) : [];
      const rows: Array<{ proof: BitGraphProof; member?: SetMemberView }> = [...plainRows, ...treeRows];
      const unknown = i.file !== undefined ? recovered?.unknown.get(i.file.digestB64) : undefined;
      const note = i.note ?? (rows.length === 0 && unknown !== undefined ? `whether this file is in a tree is unknown: ${unknown}` : undefined);
      const treeFirst = treeRows[0]?.proof;
      const treeUrl = treeFirst && typeof treeFirst.artifact?.digestB64 === "string" ? this.proofUrl(treeFirst.artifact.digestB64, treeFirst.commit?.counter ?? null, treeFirst.commit?.epochId ?? null) : null;
      return {
        input: i.label,
        digest: i.digest === "" ? "" : toUrlSafeB64(i.digest),
        onRecord: rows.length > 0,
        positions: rows.map((p) => ({
          counter: p.proof.commit?.counter ?? null,
          epoch: p.proof.commit?.epochId !== undefined ? toUrlSafeB64(p.proof.commit.epochId) : null,
          ...(p.member ? { member: p.member } : {}),
        })),
        proofUrl: plainRows.length > 0 ? this.proofUrl(i.digest) : treeUrl,
        ...(i.carrier ? { carrier: i.carrier } : {}),
        ...(i.c2pa ? { c2pa: true } : {}),
        ...(note !== undefined ? { note } : {}),
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
   * Fully offline judgment, no network ever. A BitGraphed file needs nothing
   * else; plain bytes need their proof (a tree member's own proof checks the
   * file's path to the tree's root as well).
   */
  async verify(input: string | Uint8Array, proof?: unknown, opts: VerifyOptions = {}): Promise<VerifyOutcome> {
    const bytes = typeof input === "string" ? new Uint8Array(await readFile(input)) : input;
    const parsed = parseCarrier(bytes);
    if (parsed.kind === "carrier" || parsed.kind === "corrupt") {
      const r = await verifyCarrier(bytes, opts.pins !== undefined ? { pins: opts.pins } : {});
      return { verdict: r.verdict, carrier: r.carrier === "none" ? "none" : r.carrier, view: r.carrier === "ok" ? carrierWindowView(r) : null, reasons: r.reasons, claims: r.claims, reading: r.reading };
    }
    if (proof === undefined || proof === null) {
      return { verdict: "UNDETERMINED", carrier: "none", view: null, reasons: ["plain bytes carry no proof inside; pass the proof to verify them"], claims: [], reading: null };
    }
    // The full check: the signature and counts, AND the AWS Nitro attestation with BitGraph's published images pinned
    // (or the caller's --pcr0 list). A signature alone is checked against the key the proof carries, which anyone can make.
    const r = await verifyAttested({ proof: proof as Parameters<typeof verify>[0]["proof"], bytes, ...(opts.pins?.pcr0 ? { pcr0: opts.pins.pcr0 } : {}), ...(opts.pins?.rootDer ? { rootDer: opts.pins.rootDer } : {}), context: createVerificationContext() });
    const reading = r.valid
      ? `${r.treeMember ? `These exact bytes are file ${r.treeMember.index + 1} of a tree of ${r.treeMember.files}, whose root was bound` : "These exact bytes were bound"} by ${r.image ? `BitGraph's published enclave image ${r.image.version}` : "an accepted enclave image"}, as the AWS Nitro hardware attests${r.attestedAtMs !== null ? `, at ${new Date(r.attestedAtMs).toISOString()}` : ""}. This says where and when the bytes were bound, not when or how they were made.`
      : null;
    return { verdict: r.valid ? "TRUE" : "FALSE", carrier: "none", view: null, reasons: r.valid ? [] : [r.reason ?? "the proof does not verify"], claims: [], reading };
  }
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
