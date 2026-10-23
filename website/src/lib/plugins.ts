// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

import { DIGEST_TREE_FORMAT, digestRootText } from "./tree-member.ts";

/**
 * The drop box's two plugins (Mike, 2026-10-18: toggles at the top of the Make section). Both sit on the plain bind
 * and never change what a proof is.
 *
 *   Tree: many files, one position. An RFC 6962 SHA-256 tree whose leaf data is each file's SHA-256 (leaf =
 *   SHA-256(0x00 || SHA-256(file)), node = SHA-256(0x01 || left || right), an odd last node rises unchanged; from
 *   2026-10-20, so a file's own hash finds it, lib/tree-member.ts). Only merkle-root.txt is bound.
 *
 *   Base: two BitGraphs and a write. BitGraph 1 binds base-block.json (the latest Base block, so what follows came
 *   after it); BitGraph 2 binds the content right after; BitGraph 2's proof hash is queued for Base (the ceiling: the
 *   host's writer puts it in a later block).
 */

/** leaves: [name, leaf hash hex, the file's SHA-256 base64]. */
export type MerkleTree = { format: typeof DIGEST_TREE_FORMAT; files: number; root: string; leaves: Array<[string, string, string]>; levels: string[][] };
export type Proof = Record<string, unknown> & { proofHash?: string; artifact?: { digestB64?: string }; commit?: { counter?: string; epochId?: string } };
export type BaseBlock = { chain: string; chainId: number; number: number; hash: string; timestamp: number };

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const unhex = (h: string) => new Uint8Array(h.match(/../g)!.map((x) => parseInt(x, 16)));
export const b64 = (u: Uint8Array) => { let s = ""; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]!); return btoa(s); };

async function sha256(...parts: Uint8Array[]): Promise<Uint8Array> {
  const n = parts.reduce((a, p) => a + p.length, 0), buf = new Uint8Array(n);
  let o = 0; for (const p of parts) { buf.set(p, o); o += p.length; }
  return new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
}

/** Each file's leaf, in the order given: [name, leaf hash hex, the file's SHA-256 base64]. Files are hashed 16 at a time,
 *  so a large drop is limited by reading the files, not by waiting on one hash at a time. */
export async function hashLeaves(files: File[], onProgress?: (done: number) => void): Promise<Array<[string, string, string]>> {
  const leaves: Array<[string, string, string]> = new Array(files.length);
  let next = 0, done = 0;
  const worker = async () => {
    for (let i = next++; i < files.length; i = next++) {
      const f = files[i]!;
      const digest = await sha256(new Uint8Array(await f.arrayBuffer()));
      leaves[i] = [f.webkitRelativePath || f.name, hex(await sha256(new Uint8Array([0]), digest)), b64(digest)];
      done++;
      if (onProgress && (done % 500 === 0 || done === files.length)) onProgress(done);
    }
  };
  await Promise.all(Array.from({ length: Math.min(16, files.length) }, worker));
  return leaves;
}

/** The tree over leaves in the order given, and the root text that is bound. */
export async function treeFromLeaves(leaves: Array<[string, string, string]>): Promise<{ tree: MerkleTree; rootText: string }> {
  const levels: string[][] = [];
  let row = leaves.map((l) => l[1]);
  while (row.length > 1) {
    const pairs = Math.ceil(row.length / 2), cur = row;
    const nextRow: string[] = await Promise.all(Array.from({ length: pairs }, (_, k) => {
      const i = 2 * k;
      return i + 1 < cur.length ? sha256(new Uint8Array([1]), unhex(cur[i]!), unhex(cur[i + 1]!)).then(hex) : Promise.resolve(cur[i]!);
    }));
    levels.push(nextRow);
    row = nextRow;
  }
  const root = row[0]!;
  return { tree: { format: DIGEST_TREE_FORMAT, files: leaves.length, root, leaves, levels }, rootText: digestRootText(leaves.length, root) };
}

/** Leaves sorted by name (the file's path in the drop), so the same folder always makes the same tree, whatever order a
 *  browser reads it in (2026-10-20: a re-dropped folder must find its tree, not make a new one). */
export const sortedLeaves = (leaves: Array<[string, string, string]>) => [...leaves].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0));

/** The tree over the files, sorted by path. */
export async function buildTree(files: File[], onProgress?: (done: number) => void): Promise<{ tree: MerkleTree; rootText: string }> {
  return treeFromLeaves(sortedLeaves(await hashLeaves(files, onProgress)));
}

export async function digestOf(bytes: Uint8Array): Promise<string> { return b64(await sha256(bytes)); }

/** The latest Base block, through the site (api/base/latest). */
export async function latestBaseBlock(): Promise<BaseBlock> {
  const res = await fetch("/api/base/latest", { cache: "no-store" });
  if (!res.ok) throw new Error("Base did not answer just now. Try again in a moment.");
  return (await res.json()) as BaseBlock;
}

/** One bind. Every bind gets a Base floor and ceiling from app/api/commit (2026-10-21); `floorLeaf` tells it this tree
 *  already carries the latest Base block as its first leaf, so it binds no second floor in front of it. */
export async function bindOne(digestB64: string, opts: { ceiling?: boolean; floorLeaf?: boolean } = {}): Promise<Proof> {
  const res = await fetch("/api/commit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ digests: [{ digestB64, hashAlg: "sha256" }], chainId: "bitgraph:main", ...(opts.ceiling ? { ceiling: true } : {}), ...(opts.floorLeaf ? { floorLeaf: true } : {}) }),
  });
  if (res.status === 503) throw new Error("The enclave is restarting (it does once a day). Try again in a minute.");
  if (!res.ok) throw new Error("The BitGraph could not be made just now. Nothing was recorded.");
  const raw = (await res.json()) as Proof[] | { proofs?: Proof[] };
  const p = (Array.isArray(raw) ? raw : raw.proofs ?? []).find((x) => x.artifact?.digestB64 === digestB64);
  if (!p) throw new Error("No proof came back. Look the file up on the ledger before trying again.");
  return p;
}

/** A hash list as `shasum -a 256` writes it, "<64 hex>  <name>" per line (a leading * before the name is allowed, as
 *  sha256sum writes binary mode). Null unless every non-empty line is one: a file that is not a list is a file. */
export function parseDigestList(text: string): Array<{ hex: string; name: string }> | null {
  const out: Array<{ hex: string; name: string }> = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^([0-9a-fA-F]{64})\s+\*?(.+)$/.exec(line);
    if (!m) return null;
    out.push({ hex: m[1]!.toLowerCase(), name: m[2]!.trim() });
  }
  return out.length > 0 ? out : null;
}

/** Leaves from digests already in hand (a hash list dropped on Make, 2026-10-21: "can it be hashed already?"), in the
 *  order given: [name, leaf hash hex, the file's SHA-256 base64], leaf = SHA-256(0x00 || digest), the same leaf a
 *  file's bytes would give, so the tree is the one the files themselves would make. */
export async function leavesOfDigests(list: Array<{ hex: string; name: string }>, onProgress?: (done: number) => void): Promise<Array<[string, string, string]>> {
  const leaves: Array<[string, string, string]> = new Array(list.length);
  let next = 0, done = 0;
  const worker = async () => {
    for (let i = next++; i < list.length; i = next++) {
      const d = unhex(list[i]!.hex);
      leaves[i] = [list[i]!.name, hex(await sha256(new Uint8Array([0]), d)), b64(d)];
      done++;
      if (onProgress && (done % 5000 === 0 || done === list.length)) onProgress(done);
    }
  };
  await Promise.all(Array.from({ length: Math.min(16, list.length) }, worker));
  return leaves;
}
