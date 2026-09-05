// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * The Merkle tree a set/2 commits to: RFC 6962 (Certificate Transparency)
 * hashing over an ordered list of leaf hashes, with the RFC 9162 inclusion
 * proof. Domain separation is the RFC's: a leaf hash is SHA-256 of 0x00 and
 * the leaf's bytes, an inner node SHA-256 of 0x01, left, right. A list of
 * n leaves splits at k, the largest power of two below n, so every list has
 * exactly one root and every leaf exactly one inclusion path of at most
 * ceil(log2 n) siblings. Nothing here knows what a leaf is; fuse.ts says.
 */

import { sha256 } from "@noble/hashes/sha256";

const LEAF_PREFIX = new Uint8Array([0x00]);
const NODE_PREFIX = new Uint8Array([0x01]);

function concat(...parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** SHA-256(0x00 || bytes): the hash of one leaf. */
export function merkleLeafHash(bytes: Uint8Array): Uint8Array {
  return sha256(concat(LEAF_PREFIX, bytes));
}

/** SHA-256(0x01 || left || right): one inner node. */
export function merkleNodeHash(left: Uint8Array, right: Uint8Array): Uint8Array {
  return sha256(concat(NODE_PREFIX, left, right));
}

/** The largest power of two strictly below n (n >= 2). */
function split(n: number): number {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
}

/**
 * The root over leaf HASHES (each already merkleLeafHash of its leaf), in
 * list order. Throws on an empty list; the root of one leaf hash is that
 * hash itself, as in RFC 6962.
 */
export function merkleRoot(leafHashes: readonly Uint8Array[]): Uint8Array {
  if (leafHashes.length === 0) throw new TypeError("a Merkle tree needs at least one leaf");
  for (const h of leafHashes) if (h.length !== 32) throw new TypeError("a leaf hash is 32 bytes");
  const build = (lo: number, hi: number): Uint8Array => {
    const n = hi - lo;
    if (n === 1) return leafHashes[lo]!;
    const k = split(n);
    return merkleNodeHash(build(lo, lo + k), build(lo + k, hi));
  };
  return build(0, leafHashes.length);
}

/**
 * The inclusion path of the leaf at `index`: its siblings from the leaf's
 * own level up to the root, in that order (RFC 6962 PATH). Empty for a tree
 * of one leaf.
 */
export function merklePath(leafHashes: readonly Uint8Array[], index: number): Uint8Array[] {
  const n = leafHashes.length;
  if (n === 0) throw new TypeError("a Merkle tree needs at least one leaf");
  if (!Number.isInteger(index) || index < 0 || index >= n) throw new RangeError("leaf index out of range");
  const path: Uint8Array[] = [];
  const walk = (lo: number, hi: number, m: number): void => {
    const size = hi - lo;
    if (size === 1) return;
    const k = split(size);
    const build = (a: number, b: number): Uint8Array => merkleRoot(leafHashes.slice(a, b));
    if (m < lo + k) {
      walk(lo, lo + k, m);
      path.push(build(lo + k, hi));
    } else {
      walk(lo + k, hi, m);
      path.push(build(lo, lo + k));
    }
  };
  walk(0, n, index);
  return path;
}

/**
 * Recompute the root from one leaf hash, its index, the tree size and its
 * path (RFC 9162 section 2.1.3.2). Null when the path does not fit the
 * index and size: too short, too long, or an index outside the tree. A
 * result that equals the committed root proves the leaf is at `index` in a
 * tree of `size` leaves with that root; nothing else is proven.
 */
export function merkleRootFromPath(leafHash: Uint8Array, index: number, size: number, path: readonly Uint8Array[]): Uint8Array | null {
  if (!Number.isInteger(index) || !Number.isInteger(size) || size < 1 || index < 0 || index >= size) return null;
  if (leafHash.length !== 32) return null;
  let fn = index;
  let sn = size - 1;
  let r = leafHash;
  for (const p of path) {
    if (p.length !== 32) return null;
    if (sn === 0) return null;
    if ((fn & 1) === 1 || fn === sn) {
      r = merkleNodeHash(p, r);
      if ((fn & 1) === 0) {
        while ((fn & 1) === 0 && fn !== 0) {
          fn >>>= 1;
          sn >>>= 1;
        }
      }
    } else {
      r = merkleNodeHash(r, p);
    }
    fn >>>= 1;
    sn >>>= 1;
  }
  if (sn !== 0) return null;
  return r;
}

/**
 * The whole tree over a list of leaf hashes, every subtree root computed
 * once, so the paths of all N leaves cost N log N hashes in total instead of
 * N per path. The split rule and the path order are merkleRoot's and
 * merklePath's exactly; a test pins them equal.
 */
export class MerkleTree {
  readonly size: number;
  readonly root: Uint8Array;
  private readonly leafHashes: readonly Uint8Array[];
  /** Subtree root by "lo:hi". */
  private readonly memo = new Map<string, Uint8Array>();

  constructor(leafHashes: readonly Uint8Array[]) {
    if (leafHashes.length === 0) throw new TypeError("a Merkle tree needs at least one leaf");
    for (const h of leafHashes) if (h.length !== 32) throw new TypeError("a leaf hash is 32 bytes");
    this.leafHashes = leafHashes;
    this.size = leafHashes.length;
    this.root = this.subtree(0, this.size);
  }

  private subtree(lo: number, hi: number): Uint8Array {
    const n = hi - lo;
    if (n === 1) return this.leafHashes[lo]!;
    const key = `${lo}:${hi}`;
    const known = this.memo.get(key);
    if (known !== undefined) return known;
    const k = split(n);
    const h = merkleNodeHash(this.subtree(lo, lo + k), this.subtree(lo + k, hi));
    this.memo.set(key, h);
    return h;
  }

  /** The inclusion path of the leaf at `index`, siblings from the leaf's level up. */
  path(index: number): Uint8Array[] {
    if (!Number.isInteger(index) || index < 0 || index >= this.size) throw new RangeError("leaf index out of range");
    const out: Uint8Array[] = [];
    const walk = (lo: number, hi: number): void => {
      const n = hi - lo;
      if (n === 1) return;
      const k = split(n);
      if (index < lo + k) {
        walk(lo, lo + k);
        out.push(this.subtree(lo + k, hi));
      } else {
        walk(lo + k, hi);
        out.push(this.subtree(lo, lo + k));
      }
    };
    walk(0, this.size);
    return out;
  }
}
