// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * The drop box's two plugins (Mike, 2026-10-18: toggles at the top of the Make section). Both sit on the plain bind
 * and never change what a proof is.
 *
 *   Tree: many files, one position. An RFC 6962 SHA-256 tree (leaf = SHA-256(0x00 || file), node = SHA-256(0x01 ||
 *   left || right), an odd last node rises unchanged), the same merkle-tree.json and merkle-root.txt the drop box
 *   already checks a batch with. Only merkle-root.txt is bound.
 *
 *   Base: two BitGraphs and a write. BitGraph 1 binds base-block.json (the latest Base block, so what follows came
 *   after it); BitGraph 2 binds the content right after; BitGraph 2's proof hash is queued for Base (the ceiling: the
 *   host's writer puts it in a later block).
 */

export type MerkleTree = { format: "rfc6962-sha256"; files: number; root: string; leaves: Array<[string, string]>; levels: string[][] };
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

/** The tree over the files, in drop order, and the root file that is bound. Files are hashed 16 at a time and each
 *  level's pairs together, so a large drop is limited by reading the files, not by waiting on one hash at a time. */
export async function buildTree(files: File[], onProgress?: (done: number) => void): Promise<{ tree: MerkleTree; rootText: string }> {
  const leaves: Array<[string, string]> = new Array(files.length);
  let next = 0, done = 0;
  const worker = async () => {
    for (let i = next++; i < files.length; i = next++) {
      const f = files[i]!;
      leaves[i] = [f.webkitRelativePath || f.name, hex(await sha256(new Uint8Array([0]), new Uint8Array(await f.arrayBuffer())))];
      done++;
      if (onProgress && (done % 500 === 0 || done === files.length)) onProgress(done);
    }
  };
  await Promise.all(Array.from({ length: Math.min(16, files.length) }, worker));
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
  const tree: MerkleTree = { format: "rfc6962-sha256", files: files.length, root, leaves, levels };
  return { tree, rootText: `Merkle root (RFC 6962, SHA-256) of ${files.length} files:\n${root}\n` };
}

export async function digestOf(bytes: Uint8Array): Promise<string> { return b64(await sha256(bytes)); }

/** The latest Base block, through the site (api/base/latest). */
export async function latestBaseBlock(): Promise<BaseBlock> {
  const res = await fetch("/api/base/latest", { cache: "no-store" });
  if (!res.ok) throw new Error("Base did not answer just now. Try again in a moment.");
  return (await res.json()) as BaseBlock;
}

/** One bind; with ceiling, the host also queues the proof hash for Base. */
export async function bindOne(digestB64: string, opts: { ceiling?: boolean } = {}): Promise<Proof> {
  const res = await fetch("/api/commit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ digests: [{ digestB64, hashAlg: "sha256" }], chainId: "bitgraph:main", ...(opts.ceiling ? { ceiling: true } : {}) }),
  });
  if (res.status === 503) throw new Error("The enclave is restarting (it does once a day). Try again in a minute.");
  if (!res.ok) throw new Error("The BitGraph could not be made just now. Nothing was recorded.");
  const raw = (await res.json()) as Proof[] | { proofs?: Proof[] };
  const p = (Array.isArray(raw) ? raw : raw.proofs ?? []).find((x) => x.artifact?.digestB64 === digestB64);
  if (!p) throw new Error("No proof came back. Look the file up on the ledger before trying again.");
  return p;
}
