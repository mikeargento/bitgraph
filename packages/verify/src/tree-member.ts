// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * A file of a tree, checked by its own hash (bitgraph-tree-member/1, the format bitgraph.ing's Make page writes from
 * 2026-10-20: a drop of many files is one tree, one BitGraph, and each file is found and checked like a file bound
 * alone).
 *
 *   leaf  = SHA-256( 0x00 || SHA-256(file) )        node = SHA-256( 0x01 || left || right ); an odd last node rises
 *   bound = the root's text, exactly:  "Merkle root (RFC 6962, SHA-256; each leaf is a file's SHA-256) of N files:\n<root hex>\n"
 *
 * A member's proof is the tree's proof with, in its UNSIGNED metadata:
 *
 *   metadata["bitgraph-tree-member/1"] = { format, files, index, path, rootText }
 *     path: base64 of the 32-byte siblings from the leaf up, concatenated (a level where the node rose has none)
 *
 * The block is advisory until checked: the file's hash is walked up the path to a root, rootText must name that root
 * and that count, and SHA-256(rootText) must be the digest the proof signs. The proof is then verified against
 * rootText's bytes like any proof against its file (verifyAttested does both).
 */

import { sha256 } from "@noble/hashes/sha256";

export const TREE_MEMBER_METADATA_KEY = "bitgraph-tree-member/1" as const;
/** The tree's floor (bitgraph.ing, 2026-10-20): base-block.json, the latest Base block read just before the bind, as the
 *  tree's first leaf; `file` is its exact text, `index` and `path` place it in the same tree. */
export interface TreeFloor { file: string; index: number; path: string }
export interface TreeMemberBlock { format: typeof TREE_MEMBER_METADATA_KEY; files: number; index: number; path: string; rootText: string; floor?: TreeFloor }
export const BASE_BLOCK_FORMAT = "bitgraph-base-block/1" as const;
export interface TreeFloorBlock { chain: string; chainId: number; number: number; hash: string; timestamp: number }

const enc = new TextEncoder();
const HEX = "0123456789abcdef";
const hex = (b: Uint8Array): string => { let s = ""; for (const x of b) s += HEX[x >> 4]! + HEX[x & 15]!; return s; };
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function b64(u: Uint8Array): string {
  let s = "";
  for (let i = 0; i < u.length; i += 3) {
    const n = (u[i]! << 16) | ((u[i + 1] ?? 0) << 8) | (u[i + 2] ?? 0);
    s += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + (i + 1 < u.length ? B64[(n >> 6) & 63]! : "=") + (i + 2 < u.length ? B64[n & 63]! : "=");
  }
  return s;
}
function unb64(s: string): Uint8Array | null {
  const t = s.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  if (!/^[A-Za-z0-9+/]*$/.test(t) || t.length % 4 === 1) return null;
  const out: number[] = [];
  let buf = 0, bits = 0;
  for (const c of t) { buf = (buf << 6) | B64.indexOf(c); bits += 6; if (bits >= 8) { bits -= 8; out.push((buf >> bits) & 255); } }
  return new Uint8Array(out);
}
const cat = (...p: Uint8Array[]): Uint8Array => { const o = new Uint8Array(p.reduce((a, x) => a + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };

/** The text a digest-leaf tree binds. */
export const digestTreeRootText = (files: number, rootHex: string): string =>
  `Merkle root (RFC 6962, SHA-256; each leaf is a file's SHA-256) of ${files} files:\n${rootHex}\n`;

export function parseDigestTreeRootText(text: string): { files: number; root: string } | null {
  const m = /^Merkle root \(RFC 6962, SHA-256; each leaf is a file's SHA-256\) of (\d+) files:\n([0-9a-f]{64})\n$/.exec(text);
  if (!m) return null;
  const files = Number(m[1]);
  return Number.isSafeInteger(files) && files >= 1 ? { files, root: m[2]! } : null;
}

/** Walk a leaf up its siblings (RFC 6962, an odd last node rising unchanged): the root as hex, or null if they cannot be this leaf's. */
export function treeRootFromPath(leaf32: Uint8Array, index: number, files: number, siblings: Uint8Array): string | null {
  if (!Number.isSafeInteger(index) || !Number.isSafeInteger(files) || index < 0 || index >= files || siblings.length % 32 !== 0) return null;
  let h = leaf32, idx = index, n = files, at = 0;
  while (n > 1) {
    if (!(idx === n - 1 && idx % 2 === 0)) {
      if (at + 32 > siblings.length) return null;
      const s = siblings.subarray(at, at + 32); at += 32;
      h = sha256(cat(new Uint8Array([1]), idx % 2 === 1 ? s : h, idx % 2 === 1 ? h : s));
    }
    idx >>= 1; n = Math.ceil(n / 2);
  }
  return at === siblings.length ? hex(h) : null;
}

/** The member block a proof carries, strictly parsed; null when absent or malformed. Unchecked: see checkTreeMember. */
export function treeMemberOf(proof: unknown): TreeMemberBlock | null {
  const m = (proof as { metadata?: Record<string, unknown> } | null)?.metadata?.[TREE_MEMBER_METADATA_KEY] as Partial<TreeMemberBlock> | undefined;
  if (!m || typeof m !== "object") return null;
  if (m.format !== TREE_MEMBER_METADATA_KEY || !Number.isSafeInteger(m.files) || !Number.isSafeInteger(m.index) || typeof m.path !== "string" || typeof m.rootText !== "string") return null;
  if (m.rootText.length > 512 || m.path.length > 4096) return null;
  return m as TreeMemberBlock;
}

/**
 * Whether a file with this SHA-256 (32 bytes, or base64 of them) is the block's member of the tree whose root text the
 * proof signs. The membership only: the proof itself is verified against rootText's bytes (treeRootTextBytes).
 */
export function checkTreeMember(proof: unknown, fileDigest: Uint8Array | string, block: TreeMemberBlock | null = treeMemberOf(proof)): boolean {
  if (!block) return false;
  const parsed = parseDigestTreeRootText(block.rootText);
  if (!parsed || parsed.files !== block.files || block.index < 0 || block.index >= block.files) return false;
  const bound = (proof as { artifact?: { digestB64?: string } } | null)?.artifact?.digestB64;
  if (typeof bound !== "string" || unb64(bound) === null || b64(sha256(enc.encode(block.rootText))) !== b64(unb64(bound)!)) return false;
  const d = typeof fileDigest === "string" ? unb64(fileDigest) : fileDigest;
  const path = unb64(block.path);
  if (!d || d.length !== 32 || !path) return false;
  return treeRootFromPath(sha256(cat(new Uint8Array([0]), d)), block.index, block.files, path) === parsed.root;
}

/**
 * The tree's floor block, when the member carries one and base-block.json is in the very tree the proof binds (its hash
 * walks up its path to the root rootText names, and SHA-256(rootText) is what the proof signs). Null otherwise. That the
 * block exists on Base with that hash and time is a separate check, against Base.
 */
export function checkTreeFloor(proof: unknown, block: TreeMemberBlock | null = treeMemberOf(proof)): TreeFloorBlock | null {
  const f = block?.floor;
  if (!block || !f || typeof f.file !== "string" || typeof f.path !== "string" || !Number.isSafeInteger(f.index) || f.file.length > 2048) return null;
  const parsed = parseDigestTreeRootText(block.rootText);
  const bound = (proof as { artifact?: { digestB64?: string } } | null)?.artifact?.digestB64;
  if (!parsed || parsed.files !== block.files || typeof bound !== "string" || unb64(bound) === null || b64(sha256(enc.encode(block.rootText))) !== b64(unb64(bound)!)) return null;
  const path = unb64(f.path);
  if (!path || treeRootFromPath(sha256(cat(new Uint8Array([0]), sha256(enc.encode(f.file)))), f.index, block.files, path) !== parsed.root) return null;
  try {
    const o = JSON.parse(f.file) as Partial<TreeFloorBlock> & { format?: string };
    if (o.format !== BASE_BLOCK_FORMAT || typeof o.chain !== "string" || !Number.isSafeInteger(o.chainId) || !Number.isSafeInteger(o.number) || typeof o.hash !== "string" || !/^0x[0-9a-f]{64}$/i.test(o.hash) || !Number.isSafeInteger(o.timestamp)) return null;
    return { chain: o.chain, chainId: o.chainId!, number: o.number!, hash: o.hash, timestamp: o.timestamp! };
  } catch { return null; }
}

/** The bytes a member's proof signs: its root text. */
export const treeRootTextBytes = (block: TreeMemberBlock): Uint8Array => enc.encode(block.rootText);
