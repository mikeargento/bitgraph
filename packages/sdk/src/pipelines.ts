// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * The make pipelines, the same ones the site's drop runs: ONE way to make a
 * BitGraph (ruling 9). A single file is fused on its own slot; two or more
 * files become members of one set under one slot, one position. Files are
 * read on this machine; fused bytes are hashed and never written; only
 * digests, the committed artifact and slot records leave it.
 *
 * These are the engine shared by the SDK class, the CLI, `bitgraph serve`,
 * and the MCP server, so every socket makes a BitGraph the same way.
 */

import { readFile } from "node:fs/promises";
import { stat } from "node:fs/promises";
import { fuse, fuseSet, builderFor, fusedNamesFor, type FuseSetMember, type FuseSetProgress } from "@mikeargento/bitgraph";
import type { ApiConfig } from "./api.js";
import { scanFile, fusedDigestFor, sniffC2paBytes, type ScannedFile } from "./scan.js";
import { readCarrierFile, sniffCarrierTail, type CarrierWindowView } from "./carrier-io.js";
import type { BitGraphProof } from "./types.js";

/** Files above this are not loaded whole into memory by the pipelines. */
export const MAX_LOADED_BYTES = 256 * 1024 * 1024;

export interface FusedSummary {
  proof: BitGraphProof;
  frame: unknown;
  placement: string;
  artifactDigestB64: string;
  originDigestB64: string;
}

export interface SetSummary {
  set: "set/1" | "set/2";
  proof: BitGraphProof;
  artifactDigestB64: string;
  count: number;
  manifestEchoed: boolean;
  recovered: boolean;
  members: Array<{
    index: number;
    manifestIndex: number;
    placement: string;
    originDigestB64: string;
    artifactDigestB64: string;
    memberProof?: unknown;
  }>;
}

export type FuseFileFn = (file: ScannedFile, config: ApiConfig) => Promise<FusedSummary>;
export type FuseSetFn = (
  files: readonly ScannedFile[],
  config: ApiConfig,
  opts: { set: "set/1" | "set/2"; onProgress?: (p: FuseSetProgress) => void }
) => Promise<SetSummary>;

/**
 * One file, as a single drop on the site goes: its own slot, its own Frame,
 * and a Frame returned. The fused bytes are not kept.
 */
export const fuseFilePipeline: FuseFileFn = async (file, config) => {
  const bytes = new Uint8Array(await readFile(file.path));
  const placement = file.placement;
  const { fusedName } = fusedNamesFor(file.name, placement);
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
    originDigestB64: r.originDigestB64 ?? file.digestB64,
  };
};

/**
 * The set pipeline: one slot for the set, every member's fused digest
 * finished from the scan's open hasher for that slot, the manifest (or, for
 * a set/2, its root document) committed under the same slot, and the
 * returned proof verified with every member bound to it by digest.
 */
export const fuseSetPipeline: FuseSetFn = async (files, config, opts) => {
  const members: FuseSetMember[] = files.map((f) =>
    f.state !== null
      ? { originDigest: f.originDigest, placement: f.placement, name: f.name, fusedDigest: ({ commitment }) => fusedDigestFor(f, commitment) }
      : { load: async () => new Uint8Array(await readFile(f.path)), originDigest: f.originDigest, placement: f.placement, name: f.name }
  );
  const r = await fuseSet(members, {
    set: opts.set,
    keepFused: false,
    ...(opts.onProgress !== undefined ? { onProgress: opts.onProgress } : {}),
    transport: { baseUrl: config.baseUrl, ...(config.apiKey ? { apiKey: config.apiKey } : {}) },
  });
  return {
    set: r.set,
    proof: r.proof as unknown as BitGraphProof,
    artifactDigestB64: r.artifactDigestB64,
    count: r.members.length,
    manifestEchoed: r.manifestEchoed,
    recovered: r.recovered,
    members: r.members.map((m) => ({
      index: m.index,
      manifestIndex: m.manifestIndex,
      placement: m.placement,
      originDigestB64: m.originDigestB64,
      artifactDigestB64: m.artifactDigestB64,
      ...(m.memberProof !== undefined ? { memberProof: m.memberProof } : {}),
    })),
  };
};

/**
 * A path is either plain bytes to scan or a BitGraphed file
 * (bitgraph-carrier/1), decided by one 8-byte tail read. A BitGraphed file
 * is judged OFFLINE from the proof it carries, its lookups use the digest of
 * the committed bytes inside, and it is never minted: the envelope is not
 * the recorded thing, the bytes inside are.
 */
export interface CarrierRow {
  kind: "carrier";
  path: string;
  status: "ok" | "corrupt" | "too-large";
  /** Standard base64 SHA-256 of the committed bytes inside (status "ok"). */
  innerDigestB64: string | null;
  view: CarrierWindowView | null;
  /** The carried bitgraph/1 proof, for offline answers when the ledger has no row. */
  proof: unknown | null;
  c2pa: boolean;
  reason: string | null;
}
export type ClassifiedPath = { kind: "plain"; file: ScannedFile } | CarrierRow;

export async function classifyPath(p: string): Promise<ClassifiedPath> {
  const info = await stat(p);
  if (info.isFile() && (await sniffCarrierTail(p, info.size))) {
    if (info.size > MAX_LOADED_BYTES) {
      return {
        kind: "carrier", path: p, status: "too-large", innerDigestB64: null, view: null, proof: null, c2pa: false,
        reason: `a BitGraphed file larger than this tool loads (${Math.round(MAX_LOADED_BYTES / (1024 * 1024))} MiB); judge it offline with: npx @mikeargento/bitgraph-audit "${p}"`,
      };
    }
    const r = await readCarrierFile(p);
    if (r.status === "corrupt" || r.innerDigestB64 === null) {
      return {
        kind: "carrier", path: p, status: "corrupt", innerDigestB64: null, view: null, proof: null, c2pa: false,
        reason: `a carrier block was found at the end of the file but is unreadable: ${r.corruptReason ?? "unspecified"}. A corrupted block, not a forgery; nothing was minted for it.`,
      };
    }
    return {
      kind: "carrier", path: p, status: "ok", innerDigestB64: r.innerDigestB64, view: r.view,
      proof: r.result?.payload?.proof ?? null, c2pa: r.inner !== null && sniffC2paBytes(r.inner), reason: null,
    };
  }
  return { kind: "plain", file: await scanFile(p) };
}
