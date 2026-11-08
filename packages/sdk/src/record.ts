// Copyright (c) 2025-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * record: make BitGraphs of files, the way the site's drop box does.
 *
 * Each BitGraph is one atomic action in the enclave: a fresh nonce that never
 * existed before takes count N, the SHA-256 is bound at count N+1, both are
 * signed together with the enclave's time and attested by AWS Nitro, and the
 * proof chains to the previous one by commit.prevB64.
 *
 *   One new file   one BitGraph of the file's own SHA-256. The proof is saved
 *                  beside it as <file>.bitgraph.json.
 *   Several        one tree and one BitGraph: an RFC 6962 tree whose leaves are
 *                  the files' SHA-256s (leaf = SHA-256(0x00 || digest), node =
 *                  SHA-256(0x01 || left || right), an odd last node rises
 *                  unchanged), files sorted by name so the same folder makes
 *                  the same tree. The tree's root text is what is bound. Each
 *                  file's proof is the tree's proof with its member block
 *                  (bitgraph-tree-member/1: its index and path to the root) in
 *                  the unsigned metadata, saved beside it, and each file is
 *                  indexed on the site under its own hash.
 *
 * Files are hashed on this machine; only digests leave it. Every file is
 * looked up first: bytes that already have a BitGraph are not made again, and
 * if any part of the lookup fails nothing is made, since a file that could
 * not be looked up may already have one. Proof files (*.bitgraph.json) and
 * BitGraphed files (a proof carried inside the file) are never made.
 */

import { createHash } from "node:crypto";
import { stat, writeFile } from "node:fs/promises";
import { dirname, relative, sep } from "node:path";
import { digestTreeRootText, TREE_MEMBER_METADATA_KEY } from "@mikeargento/bitgraph-verify";
import { ApiError, batchCheck, bindDigest, postTreeMembers, type ApiConfig, type TreeMemberRow } from "./api.js";
import { sniffCarrierTail } from "./carrier-io.js";
import { mapConcurrent, sha256FileB64, toUrlSafeB64 } from "./encoding.js";
import { expandPaths } from "./scan.js";
import type { BitGraphProof } from "./types.js";

const MAX_FILES = 100_000;
const HASH_CONCURRENCY = 8;

/** The one BitGraph a record call made. */
export interface MadeBitGraph {
  /** "file": one file's own SHA-256 was bound. "tree": the root text of a tree of the files was bound. */
  kind: "file" | "tree";
  /** The BitGraph's number: the count the content was bound at (N+1). */
  number: string | null;
  /** The nonce's count and the content's, one after the other: [N, N+1]. */
  counts: [string, string] | null;
  /** The fresh nonce this BitGraph made (standard base64). Put it in later content to show that content was made after it. */
  nonce: string | null;
  /** The enclave lifecycle the counts belong to (standard base64). */
  epoch: string | null;
  /** The hash of the previous proof this one chains to (standard base64), when the enclave sets it. */
  prev: string | null;
  /** The SHA-256 that was bound (standard base64): the file's, or the tree's root text's. */
  digestB64: string;
  /** The proof as the enclave signed it. */
  proof: BitGraphProof;
  proofUrl: string;
  /** For a tree: its size, root, the exact text bound, and how many files the site indexed under their own hashes. */
  tree: { files: number; root: string; rootText: string; indexed: number; indexError: string | null } | null;
}

export interface RecordedFile {
  path: string;
  /** SHA-256 of the file, standard base64 (empty for a skipped file). */
  digestB64: string;
  /** "made": in the BitGraph this call made. "on record": these bytes already had one, and nothing was made for them. "skipped": never made (a proof file, or a BitGraphed file). */
  outcome: "made" | "on record" | "skipped";
  /** The BitGraph's number (the content's count). */
  number: string | null;
  /** That BitGraph's nonce (standard base64). */
  nonce: string | null;
  /** The file's proof: for a tree member, the tree's proof with this file's member block in its metadata. */
  proof: BitGraphProof | null;
  proofUrl: string | null;
  /** Where the proof was saved beside the file; null when not saved. */
  proofPath: string | null;
  /** This file's place in the tree, when it is a tree member (index is 0-based). */
  member: { index: number; files: number } | null;
  reason?: string;
}

export interface RecordResult {
  /** The BitGraph this call made, or null when every file already had one (or was skipped). */
  made: MadeBitGraph | null;
  files: RecordedFile[];
}

export interface RecordOptions {
  /** Save each new proof beside its file as <file>.bitgraph.json (default true). */
  write?: boolean;
}

/** Where a file's proof is saved beside it. */
export function proofPathFor(path: string): string {
  return `${path}.bitgraph.json`;
}

/** A proof file, never itself made into a BitGraph. */
export function isProofFile(path: string): boolean {
  return path.toLowerCase().endsWith(".bitgraph.json");
}

/** The site's proof page for a digest, pinned to one position when the counter is known. */
export function proofPageUrl(baseUrl: string, standardDigest: string, counter?: string | null, epochId?: string | null): string {
  let url = `${baseUrl}/proof/${encodeURIComponent(toUrlSafeB64(standardDigest))}`;
  if (typeof counter === "string" && counter.length > 0) {
    url += `?counter=${encodeURIComponent(counter)}`;
    if (typeof epochId === "string" && epochId.length > 0) url += `&epoch=${encodeURIComponent(toUrlSafeB64(epochId))}`;
  }
  return url;
}

// ── The tree ────────────────────────────────────────────────────────────────

/** [name, leaf hash hex, the file's SHA-256 base64], as the site keeps a leaf. */
export type TreeLeafRow = [string, string, string];

export interface DigestTree {
  files: number;
  root: string;
  rootText: string;
  /** Leaves in tree order. */
  leaves: TreeLeafRow[];
  /** Each row above the leaves, hex. */
  levels: string[][];
}

const sha256 = (...parts: Uint8Array[]): Buffer => {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  return h.digest();
};

/** A file's leaf from its SHA-256 (standard or URL-safe base64): SHA-256(0x00 || digest), hex. */
export function leafOfDigest(digestB64: string): string {
  return sha256(Uint8Array.of(0), Buffer.from(digestB64, "base64")).toString("hex");
}

/** Leaves sorted by name, then by digest, so the same files always make the same tree. */
export function sortedLeaves(leaves: readonly TreeLeafRow[]): TreeLeafRow[] {
  return [...leaves].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0));
}

/** The tree over leaves in the order given, and the root text that is bound. */
export function treeFromLeaves(leaves: readonly TreeLeafRow[]): DigestTree {
  if (leaves.length === 0) throw new Error("a tree needs at least one file");
  const levels: string[][] = [];
  let row = leaves.map((l) => l[1]);
  while (row.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < row.length; i += 2) {
      next.push(i + 1 < row.length ? sha256(Uint8Array.of(1), Buffer.from(row[i]!, "hex"), Buffer.from(row[i + 1]!, "hex")).toString("hex") : row[i]!);
    }
    levels.push(next);
    row = next;
  }
  const root = row[0]!;
  return { files: leaves.length, root, rootText: digestTreeRootText(leaves.length, root), leaves: [...leaves], levels };
}

/** A leaf's path to the root: its siblings from the leaf up, concatenated, base64 (a level where the node rose has none). */
export function memberPath(tree: DigestTree, index: number): string {
  const rows = [tree.leaves.map((l) => l[1]), ...tree.levels];
  const sibs: Buffer[] = [];
  for (let k = 0, idx = index; rows[k]!.length > 1; k++, idx >>= 1) {
    const r = rows[k]!, sib = idx ^ 1;
    if (sib < r.length) sibs.push(Buffer.from(r[sib]!, "hex"));
  }
  return Buffer.concat(sibs).toString("base64");
}

/** The member block a tree member's proof carries in its unsigned metadata. */
export interface TreeMemberBlock {
  format: typeof TREE_MEMBER_METADATA_KEY;
  files: number;
  index: number;
  path: string;
  rootText: string;
}

/** The tree's proof with one member's block attached, as the member's own proof. */
export function withMember(proof: BitGraphProof, member: TreeMemberBlock): BitGraphProof {
  const meta = proof.metadata && typeof proof.metadata === "object" && !Array.isArray(proof.metadata) ? (proof.metadata as Record<string, unknown>) : {};
  return { ...proof, metadata: { ...meta, [TREE_MEMBER_METADATA_KEY]: member } };
}

/** Names relative to the deepest folder holding every file, with "/" between parts. */
export function leafNames(paths: readonly string[]): string[] {
  if (paths.length === 0) return [];
  let common = dirname(paths[0]!).split(sep);
  for (const p of paths.slice(1)) {
    const parts = dirname(p).split(sep);
    let i = 0;
    while (i < common.length && i < parts.length && common[i] === parts[i]) i++;
    common = common.slice(0, i);
  }
  const base = common.join(sep) || sep;
  return paths.map((p) => relative(base, p).split(sep).join("/"));
}

// ── The ledger lookup ───────────────────────────────────────────────────────

/** The earliest of a digest's BitGraphs, by the enclave's signed time, then by count. */
function earliestOf(proofs: readonly BitGraphProof[]): BitGraphProof | undefined {
  const when = (p: BitGraphProof) => (typeof p.commit?.time === "number" ? p.commit.time : Number.POSITIVE_INFINITY);
  const count = (p: BitGraphProof) => { try { return BigInt(p.commit?.counter ?? "0"); } catch { return 0n; } };
  return [...proofs].sort((a, b) => when(a) - when(b) || (count(a) < count(b) ? -1 : count(a) > count(b) ? 1 : 0))[0];
}

/** Each digest's first BitGraph. Throws when any part of the ledger could not be read. */
async function firstsOf(config: ApiConfig, digests: readonly string[]): Promise<Map<string, BitGraphProof>> {
  const out = new Map<string, BitGraphProof>();
  if (digests.length === 0) return out;
  const keys = digests.map(toUrlSafeB64);
  let checked;
  try {
    checked = await batchCheck(config, keys);
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    throw new ApiError(err instanceof ApiError ? err.status : 503, `the ledger could not be checked, so nothing was made (${why}); try again in a moment`, err instanceof ApiError ? err.retryAfterSec : null);
  }
  digests.forEach((d, i) => {
    const r = checked.results[keys[i]!];
    if (r === undefined || r.unavailable === true) throw new ApiError(503, "part of the ledger could not be read, so nothing was made; try again in a moment");
    const recorded = r.proofs.filter((e) => e.kind === undefined || e.kind === "recorded").map((e) => {
      const env = e.envRef !== undefined ? checked.environments?.[e.envRef] : undefined;
      return env !== undefined && e.proof.environment === undefined ? { ...e.proof, environment: env as NonNullable<BitGraphProof["environment"]> } : e.proof;
    });
    const first = earliestOf(recorded);
    if (first !== undefined) out.set(d, first);
  });
  return out;
}

// ── record ──────────────────────────────────────────────────────────────────

const commitOf = (p: BitGraphProof) => ({
  number: p.commit?.counter ?? null,
  nonce: typeof p.commit?.nonceB64 === "string" ? p.commit.nonceB64 : null,
  epoch: p.commit?.epochId ?? null,
  prev: typeof p.commit?.prevB64 === "string" ? p.commit.prevB64 : null,
  counts: (p.commit?.slotCounter !== undefined && p.commit?.counter !== undefined ? [p.commit.slotCounter, p.commit.counter] : null) as [string, string] | null,
});

/** The proof as it is saved: whole, as the enclave signed it, without the site's own proofHash field. */
function savedText(proof: BitGraphProof): string {
  const { proofHash: _ph, ...whole } = proof;
  return JSON.stringify(whole, null, 2) + "\n";
}

/**
 * Make BitGraphs of the given files and folders (a folder is every regular
 * file under it). One new file is one BitGraph; several new files are one
 * tree and one BitGraph. Files already on record are reported, not made
 * again.
 */
export async function recordFiles(config: ApiConfig, paths: readonly string[], opts: RecordOptions = {}): Promise<RecordResult> {
  const write = opts.write !== false;
  const { files: expanded } = await expandPaths(paths, MAX_FILES);
  const files: RecordedFile[] = [];
  const candidates: string[] = [];
  for (const p of expanded) {
    if (isProofFile(p)) {
      files.push({ path: p, digestB64: "", outcome: "skipped", number: null, nonce: null, proof: null, proofUrl: null, proofPath: null, member: null, reason: "a proof file is never made into a BitGraph" });
      continue;
    }
    candidates.push(p);
  }
  const carriers = await mapConcurrent(candidates, HASH_CONCURRENCY, async (p) => sniffCarrierTail(p, (await stat(p)).size));
  const plain = candidates.filter((_, i) => !carriers[i]);
  for (const p of candidates.filter((_, i) => carriers[i])) {
    files.push({ path: p, digestB64: "", outcome: "skipped", number: null, nonce: null, proof: null, proofUrl: null, proofPath: null, member: null, reason: "a BitGraphed file carries its own proof and is never made again" });
  }
  if (plain.length === 0) {
    if (files.length === 0) throw new ApiError(400, "nothing to record: no regular files");
    return { made: null, files };
  }

  const digests = await mapConcurrent(plain, HASH_CONCURRENCY, (p) => sha256FileB64(p));
  const firsts = await firstsOf(config, [...new Set(digests)]);

  const rows = plain.map((path, i) => ({ path, digestB64: digests[i]! }));
  for (const r of rows) {
    const first = firsts.get(r.digestB64);
    if (first === undefined) continue;
    const c = commitOf(first);
    files.push({ path: r.path, digestB64: r.digestB64, outcome: "on record", number: c.number, nonce: c.nonce, proof: first, proofUrl: proofPageUrl(config.baseUrl, r.digestB64, c.number, c.epoch), proofPath: null, member: null });
  }
  const fresh = rows.filter((r) => !firsts.has(r.digestB64));
  const distinct = new Set(fresh.map((r) => r.digestB64));
  if (distinct.size === 0) return { made: null, files };

  // One new file (or copies of the same bytes): its own SHA-256 is bound, no tree.
  if (distinct.size === 1) {
    const digestB64 = fresh[0]!.digestB64;
    const proof = await bindDigest(config, digestB64);
    const c = commitOf(proof);
    const proofUrl = proofPageUrl(config.baseUrl, digestB64, c.number, c.epoch);
    for (const r of fresh) {
      let proofPath: string | null = null;
      if (write) {
        proofPath = proofPathFor(r.path);
        await writeFile(proofPath, savedText(proof));
      }
      files.push({ path: r.path, digestB64, outcome: "made", number: c.number, nonce: c.nonce, proof, proofUrl, proofPath, member: null });
    }
    return { made: { kind: "file", ...c, digestB64, proof, proofUrl, tree: null }, files };
  }

  // Several new files: one tree, one BitGraph of its root text.
  const names = leafNames(fresh.map((r) => r.path));
  const tree = treeFromLeaves(sortedLeaves(fresh.map((r, i) => [names[i]!, leafOfDigest(r.digestB64), r.digestB64] as TreeLeafRow)));
  const rootDigestB64 = createHash("sha256").update(tree.rootText, "utf8").digest("base64");
  const proof = await bindDigest(config, rootDigestB64);
  const c = commitOf(proof);
  const memberPaths = tree.leaves.map((_, i) => memberPath(tree, i));

  // Each file under its own hash on the site, checked there against the root the proof binds. The BitGraph exists either way.
  let indexed = 0;
  let indexError: string | null = null;
  if (c.number !== null && c.epoch !== null) {
    const members: TreeMemberRow[] = tree.leaves.map((l, i) => ({ digestB64: l[2], index: i, path: memberPaths[i]! }));
    try {
      indexed = await postTreeMembers(config, { rootDigestB64, epochId: c.epoch, counter: c.number, rootText: tree.rootText }, members);
      if (indexed < members.length) indexError = `${members.length - indexed} of ${members.length} files could not be indexed`;
    } catch (err) {
      indexError = err instanceof Error ? err.message : String(err);
    }
  } else {
    indexError = "the proof carries no counter or epoch to index the files under";
  }

  // Each path is one leaf (names are unique, one per path); copies of the same bytes are separate leaves, as on the site.
  const leafOfName = new Map<string, number>(tree.leaves.map((l, i) => [l[0], i]));

  for (const [k, r] of fresh.entries()) {
    const index = leafOfName.get(names[k]!)!;
    const own = withMember(proof, { format: TREE_MEMBER_METADATA_KEY, files: tree.files, index, path: memberPaths[index]!, rootText: tree.rootText });
    let proofPath: string | null = null;
    if (write) {
      proofPath = proofPathFor(r.path);
      await writeFile(proofPath, savedText(own));
    }
    files.push({ path: r.path, digestB64: r.digestB64, outcome: "made", number: c.number, nonce: c.nonce, proof: own, proofUrl: proofPageUrl(config.baseUrl, r.digestB64, c.number, c.epoch), proofPath, member: { index, files: tree.files } });
  }
  return {
    made: { kind: "tree", ...c, digestB64: rootDigestB64, proof, proofUrl: proofPageUrl(config.baseUrl, rootDigestB64, c.number, c.epoch), tree: { files: tree.files, root: tree.root, rootText: tree.rootText, indexed, indexError } },
    files,
  };
}
