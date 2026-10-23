// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * A file of a tree, found by its own hash, like a file bound alone (Mike, 2026-10-20: "i drop 1000 files, it records as
 * one tree of 1000. however, when you go to choose that file individually to see if its been recorded, lookup is no
 * different than if it was 1 file dropped"; then "indexed by hash like single files").
 *
 * Trees made on the Make page from 2026-10-20 take each file's SHA-256 as its leaf data:
 *
 *   leaf  = SHA-256( 0x00 || SHA-256(file) )        node = SHA-256( 0x01 || left || right ), an odd last node rises
 *   bound = merkle-root.txt, whose text names the format (digestRootText below)
 *
 * so a file's ordinary hash, the one a single file's proof is looked up by, walks to the root by itself. Each file is
 * indexed under its hash (by-digest/<hash>/<position>.json) with the tree's proof and, in the proof's UNSIGNED metadata,
 * the member block:
 *
 *   metadata["bitgraph-tree-member/1"] = { format, files, index, path, rootText }
 *     path: base64 of the 32-byte siblings from the leaf up, concatenated (a level where the node rose has none)
 *
 * The block is never trusted for being there: checkMember rebuilds the leaf from the hash, walks the path to a root,
 * requires rootText to name that root and that count, and requires SHA-256(rootText) to be the digest the proof signs.
 * The server runs it before it writes an entry, and every reader runs it again.
 *
 * Trees made before 2026-10-20 hash the file's bytes into the leaf (lib/tree-entries.ts); their files are found with the
 * file in hand, through sealed entries, as before.
 */

import { sha256 } from "@noble/hashes/sha256";
import { pathOf, rootFromPath } from "./tree-entries.ts";

export const TREE_MEMBER_KEY = "bitgraph-tree-member/1" as const;
export const DIGEST_TREE_FORMAT = "rfc6962-sha256/file-digests" as const;
/** The tree's floor (2026-10-20): the latest Base block, read just before the bind, as the tree's first leaf. `file` is
 *  base-block.json's exact text; `index` and `path` place it in the same tree. Every member carries it, so each file's
 *  proof shows the window: bound after this block (its hash was unknowable before it existed), by the ceiling's block. */
export type TreeFloor = { file: string; index: number; path: string };
export type TreeMember = { format: typeof TREE_MEMBER_KEY; files: number; index: number; path: string; rootText: string; floor?: TreeFloor };
export const BASE_BLOCK_FORMAT = "bitgraph-base-block/1" as const;
export type BaseBlockInfo = { chain: string; chainId: number; number: number; hash: string; timestamp: number };

/** base-block.json for a tree's floor leaf. */
export const baseBlockFileText = (b: BaseBlockInfo): string =>
  JSON.stringify({ format: BASE_BLOCK_FORMAT, chain: b.chain, chainId: b.chainId, number: b.number, hash: b.hash, timestamp: b.timestamp, note: "The first leaf of a BitGraph tree. Everything in the tree was bound after this Base block existed." }, null, 2) + "\n";

function parseBaseBlockFile(text: string): BaseBlockInfo | null {
  try {
    const o = JSON.parse(text) as Partial<BaseBlockInfo> & { format?: string };
    if (o.format !== BASE_BLOCK_FORMAT || typeof o.chain !== "string" || !Number.isSafeInteger(o.chainId) || !Number.isSafeInteger(o.number) || typeof o.hash !== "string" || !/^0x[0-9a-f]{64}$/i.test(o.hash) || !Number.isSafeInteger(o.timestamp)) return null;
    return { chain: o.chain, chainId: o.chainId!, number: o.number!, hash: o.hash, timestamp: o.timestamp! };
  } catch { return null; }
}

const enc = new TextEncoder();
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const b64 = (u: Uint8Array) => { let s = ""; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]!); return btoa(s); };
function unb64(s: string): Uint8Array | null {
  try { return Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)); } catch { return null; }
}
const cat = (a: Uint8Array, b: Uint8Array) => { const o = new Uint8Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; };

/** The text a digest-leaf tree binds. Its first line names the format, so the bound bytes say how the tree was built. */
export const digestRootText = (files: number, rootHex: string): string =>
  `Merkle root (RFC 6962, SHA-256; each leaf is a file's SHA-256) of ${files} files:\n${rootHex}\n`;

export function parseDigestRootText(text: string): { files: number; root: string } | null {
  const m = /^Merkle root \(RFC 6962, SHA-256; each leaf is a file's SHA-256\) of (\d+) files:\n([0-9a-f]{64})\n$/.exec(text);
  if (!m) return null;
  const files = Number(m[1]);
  return Number.isSafeInteger(files) && files >= 1 ? { files, root: m[2]! } : null;
}

/** A file's leaf from its SHA-256 (32 bytes). */
export const leafOfDigest = (digest32: Uint8Array): Uint8Array => sha256(cat(new Uint8Array([0]), digest32));

/** Every member's block for a digest-leaf tree, in tree order. `leaves` are the leaf hashes (hex), `levels` each row above. */
export function memberBlocks(tree: { files: number; leaves: Array<[string, string, ...unknown[]]>; levels: string[][] }, rootText: string, floorFile?: string): TreeMember[] {
  const rows = [tree.leaves.map((l) => l[1]), ...tree.levels];
  const paths = tree.leaves.map((_, i) => b64(pathOf(rows, i)));
  // The floor is the first leaf when there is one (lib/plugins.ts puts base-block.json at index 0).
  const floor = floorFile !== undefined ? { file: floorFile, index: 0, path: paths[0]! } : undefined;
  return tree.leaves.map((_, i) => ({ format: TREE_MEMBER_KEY, files: tree.files, index: i, path: paths[i]!, rootText, ...(floor ? { floor } : {}) }));
}

/** The member block a proof carries, strictly parsed; null when absent or malformed. Unchecked: see checkMember. */
export function memberOf(proof: unknown): TreeMember | null {
  const m = (proof as { metadata?: Record<string, unknown> } | null)?.metadata?.[TREE_MEMBER_KEY] as Partial<TreeMember> | undefined;
  if (!m || typeof m !== "object") return null;
  if (m.format !== TREE_MEMBER_KEY || !Number.isSafeInteger(m.files) || !Number.isSafeInteger(m.index) || typeof m.path !== "string" || typeof m.rootText !== "string") return null;
  if (m.rootText.length > 512 || m.path.length > 4096) return null;
  if (m.floor !== undefined && (typeof m.floor !== "object" || m.floor === null)) return null;
  return m as TreeMember;
}

/**
 * Whether `digestB64` (the file's SHA-256, standard or url-safe base64) is a member of the tree whose root the proof
 * binds, by the member block given (or the one the proof carries). Checks the membership only; the proof's own
 * signature and attestation are checked as any proof's are, against the bytes of rootText.
 */
export function checkMember(proof: unknown, digestB64: string, member: TreeMember | null = memberOf(proof)): boolean {
  if (!member) return false;
  const parsed = parseDigestRootText(member.rootText);
  if (!parsed || parsed.files !== member.files || member.index < 0 || member.index >= member.files) return false;
  const bound = (proof as { artifact?: { digestB64?: string } } | null)?.artifact?.digestB64;
  if (typeof bound !== "string" || b64(sha256(enc.encode(member.rootText))) !== bound) return false;
  const d = unb64(digestB64), path = unb64(member.path);
  if (!d || d.length !== 32 || !path) return false;
  return rootFromPath(leafOfDigest(d), member.index, member.files, path) === parsed.root;
}

/**
 * The tree's floor block, when the member carries one and it is in the very tree the proof binds: base-block.json's hash
 * walks up its path to the root rootText names (and rootText is what the proof signs, as checkMember requires). Null
 * otherwise. Says nothing about Base itself: that the block exists with that hash and time is checked against Base.
 */
export function checkFloor(proof: unknown, member: TreeMember | null = memberOf(proof)): BaseBlockInfo | null {
  const f = member?.floor;
  if (!member || !f || typeof f.file !== "string" || typeof f.path !== "string" || !Number.isSafeInteger(f.index) || f.file.length > 2048) return null;
  const parsed = parseDigestRootText(member.rootText);
  const bound = (proof as { artifact?: { digestB64?: string } } | null)?.artifact?.digestB64;
  if (!parsed || parsed.files !== member.files || typeof bound !== "string" || b64(sha256(enc.encode(member.rootText))) !== bound) return null;
  const path = unb64(f.path);
  if (!path || treeRootOf(leafOfDigest(sha256(enc.encode(f.file))), f.index, member.files, path) !== parsed.root) return null;
  return parseBaseBlockFile(f.file);
}
const treeRootOf = (leaf: Uint8Array, index: number, files: number, path: Uint8Array) => rootFromPath(leaf, index, files, path);

/** The proof with a member block attached, as the index stores it under the member's hash. */
export function withMember(proof: Record<string, unknown>, member: TreeMember): Record<string, unknown> {
  const meta = proof.metadata && typeof proof.metadata === "object" && !Array.isArray(proof.metadata) ? (proof.metadata as Record<string, unknown>) : {};
  return { ...proof, metadata: { ...meta, [TREE_MEMBER_KEY]: member } };
}

export const rootTextBytes = (member: TreeMember): Uint8Array => enc.encode(member.rootText);
export { hex as toHex };
