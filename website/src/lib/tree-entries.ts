// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * Finding a file in its tree (Mike, 2026-10-18: "dropping a file from the merkle dropped 100k folder makes a new
 * bitgraph. shouldnt it be wired up to find the proof in the tree?").
 *
 * A tree made with the Make page's switch binds only merkle-root.txt, so a file from the tree has no BitGraph of its
 * own. When the tree is made, the browser writes one sealed entry per file into the site's recovery store (the same
 * store, routes and envelope as bitgraph-recovery/1, lib/recovery.ts); a file dropped later finds its entry, and the
 * page proves the file is in the tree before saying so. Format bitgraph-tree-entry/1:
 *
 *   leaf32    = SHA-256( 0x00 || file )                                   the file's RFC 6962 leaf hash
 *   address   = hex SHA-256( UTF-8 "bitgraph-tree-entry/1 address" || leaf32 )
 *   key       =     SHA-256( UTF-8 "bitgraph-tree-entry/1 key"     || leaf32 )          the AES-256-GCM key
 *   entryId   = hex SHA-256( UTF-8 "bitgraph-tree-entry/1 entry"   || leaf32 || proofHash32 || leafIndex u32 BE )
 *   objectKey = "recovery/v1/" + address + "/" + entryId, envelope as bitgraph-recovery/1 (AAD = objectKey)
 *   plaintext = UTF-8 JSON { format, proofHash, leafIndex, files, path, proof: { epochId, counter, digestB64 }, name? }
 *               path: base64 of the 32-byte siblings from the leaf up, concatenated; a level where the node rose (it was
 *               an odd last node) has none, which the reader knows from the index and the file count
 *
 * Keyed by the LEAF hash, not the file's plain SHA-256: an entry is found by whoever holds the file's bytes, and a
 * published file digest alone does not find it. The server stores envelopes it cannot open and never sees a hash.
 *
 * An entry is never trusted for being found: it is opened, parsed strictly, its entryId recomputed, its path walked
 * from this file's leaf to a root, merkle-root.txt rebuilt from that root and hashed to the proof's digest, and the
 * proof fetched and matched to the entry's proof hash. Someone holding the file can write an entry for it (that is
 * the rule working); they cannot make a wrong tree come back as this file's.
 */

import { sha256 } from "@noble/hashes/sha256";
import { openRecoveryEnvelope, recoveryObjectKey, sealRecoveryEnvelope, MAX_BATCH_ENTRIES, MAX_PLAINTEXT_BYTES } from "./recovery.ts";

export const TREE_ENTRY_FORMAT = "bitgraph-tree-entry/1" as const;
const enc = new TextEncoder();
const L_ADDRESS = enc.encode("bitgraph-tree-entry/1 address");
const L_KEY = enc.encode("bitgraph-tree-entry/1 key");
const L_ENTRY = enc.encode("bitgraph-tree-entry/1 entry");

export type TreeEntryProof = { proofHash: string; epochId: string; counter: string; digestB64: string };
export type TreeEntryPlain = { format: typeof TREE_ENTRY_FORMAT; proofHash: string; leafIndex: number; files: number; path: string; proof: { epochId: string; counter: string; digestB64: string }; name?: string };
export type FoundInTree = { files: number; leafIndex: number; name: string | null; proof: { epochId: string; counter: string; digestB64: string; proofHash: string } };

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const unhex = (h: string) => new Uint8Array(h.match(/../g)!.map((x) => parseInt(x, 16)));
const b64 = (u: Uint8Array) => { let s = ""; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]!); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
function cat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
const u32 = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, false); return b; };

export const leafOf = (file: Uint8Array): Uint8Array => sha256(cat(new Uint8Array([0]), file));
export const entryAddress = (leaf32: Uint8Array): string => hex(sha256(cat(L_ADDRESS, leaf32)));
const entryKey = (leaf32: Uint8Array): Uint8Array => sha256(cat(L_KEY, leaf32));
const entryId = (leaf32: Uint8Array, proofHash32: Uint8Array, leafIndex: number): string => hex(sha256(cat(L_ENTRY, leaf32, proofHash32, u32(leafIndex))));

/** The text bound for a tree (lib/plugins.ts buildTree writes the same). */
export const rootTextFor = (files: number, rootHex: string): string => `Merkle root (RFC 6962, SHA-256) of ${files} files:\n${rootHex}\n`;

/** The siblings from leaf `i` to the root, concatenated: `levels[0]` is the leaves' hashes (hex), each next level above it. */
export function pathOf(levels: string[][], i: number): Uint8Array {
  const sibs: Uint8Array[] = [];
  for (let k = 0, idx = i; levels[k]!.length > 1; k++, idx >>= 1) {
    const row = levels[k]!, sib = idx ^ 1;
    if (sib < row.length) sibs.push(unhex(row[sib]!));
  }
  return cat(...sibs);
}

/** Walk a leaf up its siblings (RFC 6962, an odd last node rising unchanged): the root, or null if they cannot be this leaf's. */
export function rootFromPath(leaf32: Uint8Array, leafIndex: number, files: number, siblings: Uint8Array): string | null {
  if (!Number.isInteger(leafIndex) || !Number.isInteger(files) || leafIndex < 0 || leafIndex >= files || siblings.length % 32 !== 0) return null;
  let h = leaf32, idx = leafIndex, n = files, at = 0;
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

/** Every file's sealed entry for a tree just bound. `levels0` is the leaves' hashes in tree order. */
export async function sealTreeEntries(
  tree: { files: number; leaves: Array<[string, string]>; levels: string[][] },
  proof: TreeEntryProof,
  onProgress?: (done: number) => void,
): Promise<Array<{ key: string; envelope: string }>> {
  const levels = [tree.leaves.map((l) => l[1]), ...tree.levels];
  const proofHash32 = unb64(proof.proofHash);
  const out: Array<{ key: string; envelope: string }> = new Array(tree.leaves.length);
  const CHUNK = 256;
  for (let start = 0; start < tree.leaves.length; start += CHUNK) {
    await Promise.all(tree.leaves.slice(start, start + CHUNK).map(async ([name, leafHex], j) => {
      const i = start + j, leaf32 = unhex(leafHex);
      const plain: TreeEntryPlain = { format: TREE_ENTRY_FORMAT, proofHash: proof.proofHash, leafIndex: i, files: tree.files, path: b64(pathOf(levels, i)), proof: { epochId: proof.epochId, counter: proof.counter, digestB64: proof.digestB64 } };
      let bytes = enc.encode(JSON.stringify({ ...plain, name: name.slice(0, 200) }));
      if (bytes.length > MAX_PLAINTEXT_BYTES) bytes = enc.encode(JSON.stringify(plain));
      const objectKey = recoveryObjectKey(entryAddress(leaf32), entryId(leaf32, proofHash32, i));
      out[i] = { key: objectKey, envelope: b64(await sealRecoveryEnvelope(entryKey(leaf32), objectKey, bytes)) };
    }));
    onProgress?.(Math.min(start + CHUNK, tree.leaves.length));
  }
  return out;
}

/** Store the entries, 500 a request, two at a time, waiting out a rate limit. Resolves with how many were stored. */
export async function postTreeEntries(entries: Array<{ key: string; envelope: string }>, onProgress?: (stored: number) => void): Promise<number> {
  const batches: Array<typeof entries> = [];
  for (let i = 0; i < entries.length; i += MAX_BATCH_ENTRIES) batches.push(entries.slice(i, i + MAX_BATCH_ENTRIES));
  let stored = 0, next = 0;
  const worker = async () => {
    for (let b = next++; b < batches.length; b = next++) {
      for (let attempt = 0; attempt < 8; attempt++) {
        const res = await fetch("/api/recovery", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ entries: batches[b] }) }).catch(() => null);
        if (res && res.ok) {
          const j = (await res.json().catch(() => null)) as { results?: Array<{ status: string }> } | null;
          stored += (j?.results ?? []).filter((r) => r.status === "created" || r.status === "exists").length;
          onProgress?.(stored);
          break;
        }
        if (res && res.status !== 429 && res.status < 500) throw new Error(`The lookup entries could not be stored (${res.status}).`);
        const wait = Number(res?.headers.get("Retry-After") ?? "") || 5;
        await new Promise((r) => setTimeout(r, wait * 1000));
      }
    }
  };
  await Promise.all([worker(), worker()]);
  return stored;
}

function parsePlain(bytes: Uint8Array): TreeEntryPlain | null {
  try {
    const o = JSON.parse(new TextDecoder().decode(bytes)) as TreeEntryPlain;
    if (o.format !== TREE_ENTRY_FORMAT || typeof o.proofHash !== "string" || !Number.isInteger(o.leafIndex) || !Number.isInteger(o.files) || typeof o.path !== "string") return null;
    if (typeof o.proof?.epochId !== "string" || typeof o.proof?.counter !== "string" || typeof o.proof?.digestB64 !== "string") return null;
    return o;
  } catch { return null; }
}

/** A file's place in a tree, proven here: every entry under the file's leaf is opened and checked; the first that holds is returned. */
export async function findInTree(file: Uint8Array): Promise<FoundInTree | null> {
  const leaf32 = leafOf(file), address = entryAddress(leaf32), key = entryKey(leaf32);
  const res = await fetch("/api/recovery/lookup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ addresses: [address] }) });
  if (!res.ok) return null;
  const body = (await res.json()) as { results?: Array<{ address: string; entries?: Array<{ key: string; envelope: string }> }> };
  for (const e of body.results?.[0]?.entries ?? []) {
    const opened = await openRecoveryEnvelope(key, e.key, unb64(e.envelope)).catch(() => null);
    const p = opened ? parsePlain(opened) : null;
    if (!p) continue;
    if (e.key !== recoveryObjectKey(address, entryId(leaf32, unb64(p.proofHash), p.leafIndex))) continue;
    const root = rootFromPath(leaf32, p.leafIndex, p.files, unb64(p.path));
    if (!root || b64(sha256(enc.encode(rootTextFor(p.files, root)))) !== p.proof.digestB64) continue;
    // The proof itself, bound to the entry by its hash: the tree is a real BitGraph, not just a claim in an entry.
    const urlSafe = p.proof.digestB64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const pr = await fetch(`/api/proofs/${urlSafe}`).catch(() => null);
    const proofs = pr && pr.ok ? ((await pr.json()) as { proofs?: Array<{ proof: { proofHash?: string; commit?: { counter?: string } } }> }).proofs ?? [] : [];
    if (!proofs.some((x) => x.proof.proofHash === p.proofHash && String(x.proof.commit?.counter) === p.proof.counter)) continue;
    return { files: p.files, leafIndex: p.leafIndex, name: typeof p.name === "string" ? p.name : null, proof: { ...p.proof, proofHash: p.proofHash } };
  }
  return null;
}
