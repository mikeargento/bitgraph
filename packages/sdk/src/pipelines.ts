// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * The make pipelines: ONE way to make a BitGraph (ruling 9). Since
 * 2026-10-03 that way is tree/1 (fuseTreePipeline): every file in a call is
 * one leaf of one Merkle tree under one position, a single file a tree of
 * one. Files are read on this machine; committed bytes are hashed and never
 * written; only digests, the root document, slot records and each file's
 * sealed recovery entry (recovery.ts; only a holder of the file can open it)
 * leave it. The
 * single-file and set pipelines below are superseded and kept so code that
 * imports them keeps working.
 *
 * These are the engine shared by the SDK class, the CLI, `bitgraph serve`,
 * and the MCP server, so every socket makes a BitGraph the same way.
 */

import { readFile } from "node:fs/promises";
import { stat } from "node:fs/promises";
import { fuse, fuseSet, fuseTree, builderFor, fusedNamesFor, type FuseSetMember, type FuseSetProgress, type FuseTreeMember, type FuseTreeProgress } from "@mikeargento/bitgraph";
import { bytesToBase64, bytesToHex, encodeTreeLeaves } from "@mikeargento/bitgraph-verify";
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

/** One tree/1 BitGraph as data: everything an export is built from, JSON-safe. */
export interface TreeSummary {
  proof: BitGraphProof;
  /** The committed artifact: the 84-byte root document, lowercase hex. */
  rootDocumentHex: string;
  /** SHA-256 of the root document, standard base64: the proof's signed digest. */
  artifactDigestB64: string;
  count: number;
  /** Every leaf in tree order, base64 (count x 65 bytes): the owner's list. */
  leavesB64: string;
  /** The floor block the proof signs (commit.slotAnchor). */
  floor: { counter: string; blockNumber: number; blockHash: string };
  recovered: boolean;
  /** True when the proof's metadata carries the root document; exports carry it either way. */
  rootDocumentEchoed: boolean;
  /** In the order the files were given. */
  members: Array<{ index: number; leafIndex: number; placement: string; originDigestB64: string; artifactDigestB64: string }>;
}

export type FuseTreeFn = (
  files: readonly ScannedFile[],
  config: ApiConfig,
  opts: { onProgress?: (p: FuseTreeProgress) => void; asIs?: boolean }
) => Promise<TreeSummary>;

/**
 * The tree pipeline (tree/1): ONE BitGraph of every file given, under one
 * position. With `asIs` every file goes in as is, by the digest its scan
 * took (the user's choice, never a size's). Otherwise each file is placed:
 * its committed digest is finished from the scan's open hasher for the
 * slot's commitment, or, when the scan left no state, it is read again after
 * the slot is held and checked against the scan's digest. The returned proof
 * is verified, with every member's leaf bound to its root, before it is
 * returned.
 */
export const fuseTreePipeline: FuseTreeFn = async (files, config, opts) => {
  const members: FuseTreeMember[] = files.map((f): FuseTreeMember =>
    opts.asIs === true
      ? { originDigest: f.originDigest, placement: "as-is", name: f.name }
      : f.state !== null
        ? { originDigest: f.originDigest, placement: f.placement, name: f.name, fusedDigest: ({ commitment }) => fusedDigestFor(f, commitment) }
        : { load: async () => new Uint8Array(await readFile(f.path)), originDigest: f.originDigest, placement: f.placement, name: f.name }
  );
  const r = await fuseTree(members, {
    ...(opts.onProgress !== undefined ? { onProgress: opts.onProgress } : {}),
    transport: { baseUrl: config.baseUrl, ...(config.apiKey ? { apiKey: config.apiKey } : {}) },
  });
  return {
    proof: r.proof as unknown as BitGraphProof,
    rootDocumentHex: bytesToHex(r.rootDocument),
    artifactDigestB64: r.artifactDigestB64,
    count: r.count,
    leavesB64: bytesToBase64(encodeTreeLeaves(r.leaves)),
    floor: r.floor,
    recovered: r.recovered,
    rootDocumentEchoed: r.rootDocumentEchoed,
    members: r.members.map((m) => ({ index: m.index, leafIndex: m.leafIndex, placement: m.placement, originDigestB64: m.originDigestB64, artifactDigestB64: m.artifactDigestB64 })),
  };
};

/**
 * One file, as a single drop on the site goes: its own slot, its own Frame,
 * and a Frame returned. The fused bytes are not kept. Superseded by
 * fuseTreePipeline (a single file is a tree of one).
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
 * Superseded by fuseTreePipeline (N files are one tree under one position).
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
