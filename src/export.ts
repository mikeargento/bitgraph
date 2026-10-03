// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * bitgraph-export/1 from the producer's side (2026-10-03): the JSON file
 * that, with the file it is about, checks a tree/1 BitGraph with nothing of
 * BitGraph's required. The verify package defines the format (buildExport,
 * parseExport, verifyExport); this module builds one from what fuseTree
 * returned and completes one later from public, read-only GETs.
 *
 * Two kinds, one format:
 *   a member's export   tree.member: one leaf, its index and its path. It
 *                       shows nothing of the other files but sibling hashes.
 *   the owner's export  tree.leaves: every leaf (count x 65 bytes, base64)
 *                       and tree.names beside them. Any member's evidence is
 *                       rebuilt from it, and it lists every file, so it is
 *                       the owner's to keep.
 *
 * At make time the floor header can be in hand (the site's witness route);
 * the ceiling (a Base block, seconds after the commit) and the settlement
 * (Base's output root on Ethereum, much later) cannot, so they start as
 * { status: "pending" }. completeExport fetches all three. Nothing fetched is
 * embedded before it verifies here: the floor header must hash to the floor
 * block the proof signs, the ceiling must pass verifyCeiling for this proof,
 * and the settlement must pass verifyOutputRootSettlement for the ceiling's
 * own Base block. Nothing already in an export is ever overwritten.
 */

import { sha256 } from "@noble/hashes/sha256";
import {
  base64ToBytes,
  BASE_MAINNET_CHAIN_ID,
  BITGRAPH_CEILING_WRITER,
  buildExport,
  buildTreeMemberEvidence,
  bytesEqual,
  bytesToBase64,
  bytesToHex,
  computeProofHash,
  decodeHeader,
  encodeTreeLeaves,
  evmHexToBytes,
  MerkleTree,
  OUTPUT_ROOT_VERSION,
  parseExport,
  parseTreeRootDocument,
  treeLeafHash,
  treeRootFromMember,
  verifyCeiling,
  verifyOutputRootSettlement,
  verifyTreeLeaves,
  CEILING_VERSION,
} from "@mikeargento/bitgraph-verify";
import type { BitGraphExport, BitGraphProof, CeilingSidecar, OutputRootSettlement, TreeLeaf } from "@mikeargento/bitgraph-verify";
import type { FuseTreeResult } from "./fuse.js";

/** An export's floor: the Ethereum block the proof signs as commit.slotAnchor, with its RLP header (0x hex). */
export type ExportFloor = NonNullable<BitGraphExport["floor"]>;

/** What an export is built from. A FuseTreeResult is one; so is the same data read back from an owner's export. */
export interface TreeExportSource {
  proof: BitGraphProof;
  /** The 84-byte root document the proof commits. */
  rootDocument: Uint8Array;
  /** Every leaf, in tree order. */
  leaves: readonly TreeLeaf[];
  /** The tree over those leaves, when already built (reused across many member exports). */
  tree?: MerkleTree;
}

/** The parts beside the tree. Each defaults to the make-time state: no floor header, ceiling and settlement pending. */
export interface ExportParts {
  floor?: ExportFloor | null;
  ceiling?: BitGraphExport["ceiling"];
  settlement?: BitGraphExport["settlement"];
}

/** Throws unless the root document is the one the proof signs and states this many leaves; returns its parse. */
function boundDocument(source: TreeExportSource): { count: number; root: Uint8Array } {
  const doc = parseTreeRootDocument(source.rootDocument);
  if (doc === null) throw new TypeError("the root document is not 84 bytes of tree/1");
  const signed = base64ToBytes(source.proof.artifact?.digestB64 ?? "");
  if (signed === null || !bytesEqual(sha256(source.rootDocument), signed)) throw new TypeError("the root document does not hash to the proof's signed artifact digest");
  if (doc.count !== source.leaves.length) throw new TypeError(`the root document states ${doc.count} leaves; ${source.leaves.length} were given`);
  return doc;
}

function parts(p: ExportParts): Pick<BitGraphExport, "floor" | "ceiling" | "settlement"> {
  return {
    floor: p.floor ?? null,
    ceiling: p.ceiling === undefined ? { status: "pending" } : p.ceiling,
    settlement: p.settlement === undefined ? { status: "pending" } : p.settlement,
  };
}

/**
 * One member's export: its leaf, its index and its path, and nothing of the
 * other files but sibling hashes. The path is checked against the committed
 * root before the export is built, so no export contradicts itself.
 */
export function buildMemberExport(source: TreeExportSource, leafIndex: number, extras: ExportParts = {}): BitGraphExport {
  const doc = boundDocument(source);
  if (!Number.isInteger(leafIndex) || leafIndex < 0 || leafIndex >= source.leaves.length) throw new RangeError(`leaf ${leafIndex} is not in a tree of ${source.leaves.length}`);
  const tree = source.tree ?? new MerkleTree(source.leaves.map(treeLeafHash));
  const leaf = source.leaves[leafIndex]!;
  const path = tree.path(leafIndex);
  const reached = treeRootFromMember(leaf, leafIndex, doc.count, path);
  if (reached === null || !bytesEqual(reached, doc.root)) throw new TypeError(`leaf ${leafIndex}'s path does not recompute the committed root`);
  return buildExport({
    proof: source.proof,
    tree: { rootDocument: bytesToHex(source.rootDocument), member: buildTreeMemberEvidence(leaf, leafIndex, doc.count, path) },
    ...parts(extras),
  });
}

/**
 * The owner's export: every leaf in tree order and, when given, a name per
 * leaf (unsigned, informational). The whole list is checked against the
 * committed root first: sorted, without duplicates, rebuilding the root.
 */
export function buildOwnerExport(source: TreeExportSource, extras: ExportParts & { names?: readonly string[] } = {}): BitGraphExport {
  boundDocument(source);
  const list = encodeTreeLeaves(source.leaves);
  const check = verifyTreeLeaves(source.rootDocument, list);
  if (!check.ok) throw new TypeError(`the leaves do not make the committed tree: ${check.reason ?? "invalid"}`);
  const names = extras.names;
  if (names !== undefined && (names.length !== source.leaves.length || names.some((n) => typeof n !== "string"))) {
    throw new TypeError(`names must be one string per leaf (${source.leaves.length})`);
  }
  return buildExport({
    proof: source.proof,
    tree: { rootDocument: bytesToHex(source.rootDocument), leaves: bytesToBase64(list), ...(names !== undefined ? { names: [...names] } : {}) },
    ...parts(extras),
  });
}

/** A name per leaf, in tree order, from a tree's members ("" for a member made without one). */
export function namesByLeaf(result: Pick<FuseTreeResult, "members" | "count">): string[] {
  const names = new Array<string>(result.count).fill("");
  for (const m of result.members) names[m.leafIndex] = m.name ?? "";
  return names;
}

/**
 * The floor for an export from a block header, or null unless the header
 * decodes and hashes to the block the proof signs as its floor, at that
 * height. The header is never trusted for anything it does not hash to.
 */
export function floorFromHeader(proof: BitGraphProof, headerHex: string): ExportFloor | null {
  const signed = proof.commit?.slotAnchor;
  if (!signed || typeof headerHex !== "string") return null;
  try {
    const h = decodeHeader(evmHexToBytes(headerHex));
    if (h.hash !== signed.blockHash.toLowerCase() || h.number !== signed.blockNumber) return null;
    const hex = headerHex.toLowerCase();
    return { blockNumber: h.number, blockHash: h.hash, header: hex.startsWith("0x") ? hex : `0x${hex}` };
  } catch {
    return null;
  }
}

export interface ExportFetchOptions {
  /** The site to read from. Default https://bitgraph.ing. */
  baseUrl?: string;
  /** Per request. Default 20 s. */
  timeoutMs?: number;
}

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

const DEFAULT_SITE = "https://bitgraph.ing";

function siteOf(opts: ExportFetchOptions): string {
  return (opts.baseUrl ?? DEFAULT_SITE).replace(/\/+$/, "");
}

/** One read-only GET: status and parsed JSON, or the reason it failed. Never throws. */
async function getJson(fetcher: Fetcher, url: string, timeoutMs: number): Promise<{ status: number; json: unknown } | { error: string }> {
  try {
    const res = await fetcher(url, { method: "GET", headers: { accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { status: res.status, json };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * The floor header for a proof, from the site's witness route
 * (GET /api/proofs/witness?block=N&hash=0x...), checked against the floor
 * the proof signs. Null when the proof signs no floor, the route has no
 * header, or the header is not that block's.
 */
export async function fetchFloorHeader(proof: BitGraphProof, fetcher: Fetcher = fetch, opts: ExportFetchOptions = {}): Promise<ExportFloor | null> {
  const signed = proof.commit?.slotAnchor;
  if (!signed) return null;
  const r = await getJson(fetcher, `${siteOf(opts)}/api/proofs/witness?block=${signed.blockNumber}&hash=${encodeURIComponent(signed.blockHash)}`, opts.timeoutMs ?? 20_000);
  if ("error" in r || r.status !== 200) return null;
  return floorFromHeader(proof, witnessHeader(r.json) ?? "");
}

/** The header in a witness answer: the bitgraph-anchor-witness/1 object, or the same inside a { witness } envelope. */
function witnessHeader(json: unknown): string | null {
  const j = json as { headerRlpHex?: unknown; witness?: { headerRlpHex?: unknown } } | null;
  const h = j?.headerRlpHex ?? j?.witness?.headerRlpHex;
  return typeof h === "string" ? h : null;
}

function isCeiling(c: BitGraphExport["ceiling"]): c is CeilingSidecar {
  return c !== null && typeof c === "object" && (c as { version?: unknown }).version === CEILING_VERSION && (c as CeilingSidecar).anchor != null;
}

function isSettlement(s: BitGraphExport["settlement"]): s is OutputRootSettlement {
  return s !== null && typeof s === "object" && (s as { version?: unknown }).version === OUTPUT_ROOT_VERSION;
}

export interface CompleteExportOptions extends ExportFetchOptions {
  /** The ceiling writer the verifier accepts. Default BitGraph's published writer on Base. */
  writerAddress?: string;
  /** Default Base mainnet (8453). */
  baseChainId?: number;
  /** Keep asking while something is still pending, up to this long. Default 0: one pass. */
  waitMs?: number;
}

export interface CompletedExport {
  export: BitGraphExport;
  /** True when anything was added. */
  changed: boolean;
  floor: "present" | "absent";
  ceiling: "present" | "pending";
  settlement: "present" | "pending";
  /** What was asked and not embedded, and why: a route that failed, or evidence that did not verify. */
  notes: string[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fill what an export is waiting for, from read-only GETs on the site:
 *   floor       GET /api/proofs/witness?block=N&hash=0x...  (or the ceiling sidecar's own floor header)
 *   ceiling     GET /api/ceilings/<proofHash, URL-safe>      404: still pending
 *   settlement  GET /api/ceilings/settlement/<Base block>    404: still pending
 * Each is verified here before it is embedded, and nothing already present is
 * overwritten. The fetcher is injectable; it defaults to the global fetch.
 */
export async function completeExport(input: BitGraphExport, fetcher: Fetcher = fetch, opts: CompleteExportOptions = {}): Promise<CompletedExport> {
  const exp = parseExport(input);
  if (exp === null) throw new TypeError("not a bitgraph-export/1 document");
  const site = siteOf(opts);
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const writerAddress = opts.writerAddress ?? BITGRAPH_CEILING_WRITER;
  const chainId = opts.baseChainId ?? BASE_MAINNET_CHAIN_ID;
  const proof = exp.proof;
  const signedFloor = proof.commit?.slotAnchor;
  const notes = new Set<string>();
  let floor: BitGraphExport["floor"] = exp.floor ?? null;
  let ceiling: BitGraphExport["ceiling"] = exp.ceiling ?? null;
  let settlement: BitGraphExport["settlement"] = exp.settlement ?? null;
  let changed = false;
  const deadline = Date.now() + (opts.waitMs ?? 0);

  for (;;) {
    // 1. The floor header: the witness route, checked against the signed floor.
    if (floor === null && signedFloor) {
      const r = await getJson(fetcher, `${site}/api/proofs/witness?block=${signedFloor.blockNumber}&hash=${encodeURIComponent(signedFloor.blockHash)}`, timeoutMs);
      if ("error" in r) notes.add(`floor header: ${r.error}`);
      else if (r.status !== 200) notes.add(`floor header: the witness route answered ${r.status}`);
      else {
        const f = floorFromHeader(proof, witnessHeader(r.json) ?? "");
        if (f !== null) {
          floor = f;
          changed = true;
        } else notes.add("floor header: the witness route answered a header that is not the floor block the proof signs; not embedded");
      }
    }

    // 2. The ceiling on Base: the sidecar, verified for this proof and writer.
    if (!isCeiling(ceiling)) {
      const r = await getJson(fetcher, `${site}/api/ceilings/${encodeURIComponent(urlSafe(computeProofHash(proof)))}`, timeoutMs);
      if ("error" in r) notes.add(`ceiling: ${r.error}`);
      else if (r.status === 404) {
        if (ceiling === null) {
          ceiling = { status: "pending" };
          changed = true;
        }
      } else if (r.status !== 200) notes.add(`ceiling: the ceiling route answered ${r.status}`);
      else {
        const sidecar = r.json as CeilingSidecar;
        const v = await verifyCeiling(proof, sidecar, { writerAddress, chainId });
        if (v.ok) {
          ceiling = sidecar;
          changed = true;
          // The sidecar can carry the floor header too; it is checked the same way.
          if (floor === null && typeof sidecar.floor?.blockHeader === "string") {
            const f = floorFromHeader(proof, sidecar.floor.blockHeader);
            if (f !== null) floor = f;
          }
        } else if (v.status === "pending") {
          if (ceiling === null) {
            ceiling = { status: "pending" };
            changed = true;
          }
        } else notes.add(`ceiling: the sidecar the site served does not verify (${v.reason ?? "invalid"}); not embedded`);
      }
    }

    // 3. The settlement on Ethereum, for the ceiling's own Base block.
    if (!isSettlement(settlement)) {
      if (isCeiling(ceiling)) {
        const base = ceiling.anchor!;
        const pending = { status: "pending" as const, baseBlock: base.blockNumber };
        const r = await getJson(fetcher, `${site}/api/ceilings/settlement/${base.blockNumber}`, timeoutMs);
        const answer = "error" in r ? null : (r.json as { settlement?: unknown; status?: unknown } | null);
        const s = (answer !== null && typeof answer === "object" && answer.settlement !== undefined ? answer.settlement : answer) as OutputRootSettlement | { status?: unknown } | null;
        if ("error" in r) notes.add(`settlement: ${r.error}`);
        else if (r.status === 404 || (r.status === 200 && (s as { status?: unknown } | null)?.status === "pending")) {
          if (!samePending(settlement, pending)) {
            settlement = pending;
            changed = true;
          }
        } else if (r.status !== 200) notes.add(`settlement: the settlement route answered ${r.status}`);
        else {
          const so = s as OutputRootSettlement;
          const v = verifyOutputRootSettlement(so);
          const linked = so?.base?.blockNumber === base.blockNumber && typeof so.base.blockHash === "string" && so.base.blockHash.toLowerCase() === base.blockHash.toLowerCase();
          if (v.ok && linked) {
            settlement = so;
            changed = true;
          } else notes.add(`settlement: ${v.ok ? "it settles a different Base block than the ceiling's" : `it does not verify (${v.reason ?? "invalid"})`}; not embedded`);
        }
      } else if (settlement === null) {
        settlement = { status: "pending" };
        changed = true;
      }
    }

    const complete = floor !== null && isCeiling(ceiling) && isSettlement(settlement);
    if (complete || Date.now() + 2_000 > deadline) break;
    await sleep(2_000);
  }

  return {
    export: buildExport({ proof, tree: exp.tree, floor, ceiling, settlement }),
    changed,
    floor: floor !== null ? "present" : "absent",
    ceiling: isCeiling(ceiling) ? "present" : "pending",
    settlement: isSettlement(settlement) ? "present" : "pending",
    notes: [...notes],
  };
}

function samePending(s: BitGraphExport["settlement"], p: { status: "pending"; baseBlock: number }): boolean {
  return s !== null && (s as { status?: unknown }).status === "pending" && (s as { baseBlock?: unknown }).baseBlock === p.baseBlock;
}

function urlSafe(b64: string): string {
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
