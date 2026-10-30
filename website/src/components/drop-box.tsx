"use client";

// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * The drop box (2026-10-17): one place that is both a checker and a
 * maker. Drop files; each is hashed HERE, in the
 * browser, and only its SHA-256 ever leaves the machine.
 *
 *   Checker: every file is looked up by its hash. A file that is already a
 *   BitGraph gets its proof verified in this browser against the file's own
 *   bytes, and a link to its proof page.
 *   Maker: on /make, files that are not yet BitGraphs are made at once when
 *   dropped, with no further step (2026-10-17): one
 *   atomic action in the enclave each (a fresh nonce, then the file's digest).
 *   One file lands on its proof page.
 *   Each result shows the enclave's own signed time.
 *
 * A lookup that fails is "could not check", never "not a BitGraph"
 * (project_ledger_read_honesty).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { verifyAttested, createVerificationContext } from "@mikeargento/bitgraph-verify";
import { recordedMsOf } from "@/lib/recorded-time";
import { cacheArtifactToIDB } from "@/lib/file-cache";
import { setFreshProof } from "@/lib/fresh-proof";
import { useRouter } from "next/navigation";
import { zipSync, strToU8 } from "fflate";
import { attachEnvironments } from "@/lib/proof-environment";
import { findInTree, type FoundInTree } from "@/lib/tree-entries";
import { parseCarrier } from "@/lib/carrier";
import { DIGEST_TREE_FORMAT, baseBlockFileText, checkMember, leafOfDigest, memberBlocks, memberOf, rootTextBytes, withMember } from "@/lib/tree-member";
import { bindOne, digestOf, hashLeaves, latestBaseBlock, leavesOfDigests, parseDigestList, postTreeMembers, sortedLeaves, treeFromLeaves, type BaseBlock, type MerkleTree as PluginTree } from "@/lib/plugins";
import { publishFoundRecords, publishRecord } from "@/lib/trustmark/ledger";
import { makeThumb, THUMB_SUFFIX } from "@/lib/trustmark/thumb";
import { FoundThumb } from "@/components/found-thumb";
import { MAX_FINGERPRINTED, decodeForReading, decodeForRecord, fingerprintOf, isPhotographic, looksLikePhoto, recordBytesOf, recordFile, RECORD_SUFFIX, type Fingerprint } from "@/lib/trustmark/record";
import { judge as judgeLooks, opensAlone, type LooksVerdict, type Original } from "@/lib/trustmark/check";
import { setHeldCopy } from "@/lib/trustmark/held-copy";
/** A BitGraph's position: the earliest one of a picture, which a later record of it names (app/api/lineage). */
type FirstPosition = { digestB64: string; epochId: string; counter: string };
import { noteCopyOf, noteDroppedCopy } from "@/lib/trustmark/copy-note";
import { C2PA_SUFFIX, MAX_MANIFEST_BYTES, manifestStoreOf } from "@/lib/trustmark/c2pa-leaf";
import { MAX_GALLERY, handOriginal, setGallery, type Gallery, type GalleryItem } from "@/lib/gallery";
import { DropGallery } from "@/components/gallery";

const MAX_FILES = 25;

type Proof = Record<string, unknown> & { commit?: { counter?: string; atomic?: boolean; epochId?: string }; artifact?: { digestB64?: string } };

type Row = {
  key: string;
  name: string;
  size: number;
  digestB64?: string;
  bytes?: Uint8Array;
  state: "hashing" | "looking" | "found" | "in-tree" | "copy" | "new" | "making" | "made" | "error";
  /** The file is a member of a tree made on the Make page, proven here (lib/tree-entries.ts). */
  tree?: FoundInTree;
  /** A photo not on record that looks like a recorded original: which one, and how closely (lib/trustmark/check). */
  looks?: LooksVerdict;
  proof?: Proof;
  valid?: boolean;
  note?: string;
  /** A proof file was dropped, not the file it proves. */
  isProofFile?: boolean;
};

const toUrlSafe = (b64: string) => b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function b64(bytes: Uint8Array): string {
  let s = "";
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s);
}
function teeTime(proof: Proof): string | null {
  const ms = recordedMsOf(proof);
  if (ms === null) return null;
  const d = new Date(ms);
  return `${d.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" })}, ${d.toLocaleTimeString("en-US", { timeZone: "UTC", hour: "numeric", minute: "2-digit", second: "2-digit" })} UTC`;
}
const sizeLabel = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/** A dropped file that is itself a BitGraph proof (JSON with the artifact, commit and signer), or null. */
/** A dropped list of proofs (the drop box's "Download all" file), or null. Never made into a BitGraph itself. */
function proofListOf(f: File, bytes: Uint8Array): Proof[] | null {
  if (!/\.json$/i.test(f.name) || bytes.length > 500_000_000) return null;
  try {
    const o = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    if (!Array.isArray(o) || o.length === 0) return null;
    const ok = (p: unknown) => { const q = p as Proof & { signer?: unknown; version?: unknown }; return typeof q?.version === "string" && q.version.startsWith("bitgraph") && typeof q.artifact?.digestB64 === "string" && !!q.commit && !!q.signer; };
    return o.every(ok) ? (o as Proof[]) : null;
  } catch { return null; }
}

function proofFileOf(f: File, bytes: Uint8Array): Proof | null {
  if (bytes.length > 4_000_000 || !/\.json$/i.test(f.name)) return null;
  try {
    const o = JSON.parse(new TextDecoder().decode(bytes)) as Proof & { signer?: unknown };
    return typeof o.version === "string" && o.version.startsWith("bitgraph") && typeof o.artifact?.digestB64 === "string" && o.commit && o.signer ? o : null;
  } catch {
    return null;
  }
}

/** Every file in a drop, folders opened all the way down (2026-10-17: a folder of 10,000 files). The walk lists
 *  entries first and then opens up to 64 files at once, reporting as it goes: a 100,000-file folder read one file at a
 *  time, with nothing on screen, looked like a dead page (2026-10-18). */
async function filesOfDrop(dt: DataTransfer, onProgress?: (msg: string) => void): Promise<File[]> {
  const entries = Array.from(dt.items ?? []).map((i) => (i.kind === "file" ? i.webkitGetAsEntry?.() : null)).filter(Boolean) as FileSystemEntry[];
  if (entries.length === 0 || entries.every((e) => e.isFile)) return Array.from(dt.files);
  const found: FileSystemFileEntry[] = [];
  let shown = 0;
  const tell = (msg: string, n: number) => { if (onProgress && (n - shown >= 1000 || n === 0)) { shown = n; onProgress(msg); } };
  const walk = async (e: FileSystemEntry): Promise<void> => {
    if (e.isFile) { found.push(e as FileSystemFileEntry); tell(`Reading the folder: ${found.length.toLocaleString("en-US")} files found…`, found.length); return; }
    if (!e.isDirectory) return;
    const reader = (e as FileSystemDirectoryEntry).createReader();
    // readEntries returns at most ~100 entries a call: read until it returns none.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
      if (batch.length === 0) break;
      for (const c of batch) if (!c.name.startsWith(".")) await walk(c);
    }
  };
  onProgress?.("Reading the folder…");
  for (const e of entries) await walk(e);
  const out: File[] = new Array(found.length);
  let opened = 0; shown = 0;
  /* Opened in slices of 500 with a pause between them (2026-10-19: a 100,000-file drop hung, then the browser
     reported the page unresponsive). Opening a dropped file costs the page's main thread a little each time; 100,000 of them queued at
     once held it for seconds on end. A slice at a time, with a macrotask between slices, keeps the page answering. */
  const SLICE = 500;
  for (let from = 0; from < found.length; from += SLICE) {
    await pool(found.slice(from, from + SLICE), 16, async (fe, k) => {
      out[from + k] = await new Promise<File>((res, rej) => fe.file(res, rej));
      opened++;
      tell(`Opening ${opened.toLocaleString("en-US")} of ${found.length.toLocaleString("en-US")} files…`, opened);
    });
    await new Promise((r) => setTimeout(r, 0));
  }
  return out;
}

/** Run `fn` over `items` with at most `n` at once. */
/** At most `n` of these at once, the rest waiting their turn. */
function limiter(n: number) {
  let busy = 0; const queue: Array<() => void> = [];
  return async <T,>(fn: () => Promise<T>): Promise<T> => {
    if (busy >= n) await new Promise<void>((go) => queue.push(go));
    busy++;
    try { return await fn(); } finally { busy--; queue.shift()?.(); }
  };
}
// Reading photos for a pointer: two at a time. Each decoded photo is hundreds of MB and the pointer's models run on it;
// a drop of twenty read all at once ran the browser out of memory.
const photoRead = limiter(2);

async function pool<T>(items: T[], n: number, fn: (x: T, i: number) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    for (;;) { const i = next++; if (i >= items.length) return; await fn(items[i]!, i); }
  }));
}

/* ── A batch: files under one Merkle root (the tool at ~/Desktop/merkle-tool, RFC 6962, outside BitGraph). Drop a
   file (or several) with the batch's merkle-tree.json and merkle-root.txt: each file is walked up the tree to the
   root here, in the browser; the root must match merkle-root.txt; merkle-root.txt is looked up as a BitGraph
   (2026-10-17). ── */
type MerkleTree = { format: "rfc6962-sha256" | typeof DIGEST_TREE_FORMAT; files: number; root: string; leaves: Array<[string, string, ...string[]]>; levels: string[][] };
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const unhex = (h: string) => new Uint8Array(h.match(/../g)!.map((x) => parseInt(x, 16)));
async function sha256(...parts: Uint8Array[]): Promise<Uint8Array> {
  const n = parts.reduce((a, p) => a + p.length, 0), buf = new Uint8Array(n);
  let o = 0; for (const p of parts) { buf.set(p, o); o += p.length; }
  return new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
}
function treeOf(f: File, bytes: Uint8Array): MerkleTree | null {
  if (!/\.json$/i.test(f.name) || bytes.length > 200_000_000) return null;
  try {
    const o = JSON.parse(new TextDecoder().decode(bytes)) as Partial<MerkleTree>;
    return (o.format === "rfc6962-sha256" || o.format === DIGEST_TREE_FORMAT) && Array.isArray(o.leaves) && Array.isArray(o.levels) && typeof o.root === "string" ? (o as MerkleTree) : null;
  } catch { return null; }
}
/** The root a file's leaf reaches through the tree's levels (pairs of neighbours; an odd last node rises unchanged), or null if the leaf is not in the tree. */
async function rootFromLeaf(tree: MerkleTree, leafHex: string): Promise<{ root: string; index: number } | null> {
  const index = tree.leaves.findIndex((l) => l[1] === leafHex);
  if (index < 0) return null;
  const rows = [tree.leaves.map((l) => l[1]), ...tree.levels];
  let i = index;
  let h: Uint8Array = unhex(leafHex);
  for (let lv = 0; lv < rows.length - 1; lv++) {
    const row = rows[lv]!;
    if (i % 2 === 0) { if (i + 1 < row.length) h = await sha256(new Uint8Array([1]), h, unhex(row[i + 1]!)); }
    else h = await sha256(new Uint8Array([1]), unhex(row[i - 1]!), h);
    i = Math.floor(i / 2);
  }
  return { root: hex(h), index };
}

/** Each BitGraphed file (a proof block at the end, lib/carrier.ts) replaced by the file it wraps; every other file as is. */
async function unwrapBitGraphed(files: File[]): Promise<File[]> {
  const magic = [0x42, 0x47, 0x50, 0x52, 0x4f, 0x4f, 0x46, 0x01];
  // Sixteen tails at a time, never all at once: a 50,000-file folder drop started 50,000 reads together and the
  // browser gave up on the lot, and the drop handler then swallowed the error (2026-10-21: the page froze briefly,
  // then the drop did nothing).
  const out: File[] = files.slice();
  await pool(files, 16, async (f, i) => {
    if (f.size < 32 || f.size > 2_000_000_000) return;
    const tail = new Uint8Array(await f.slice(f.size - 8).arrayBuffer());
    if (!magic.every((b, k) => tail[k] === b)) return;
    const parsed = parseCarrier(new Uint8Array(await f.arrayBuffer()));
    if (parsed.kind !== "carrier") return;
    out[i] = new File([parsed.inner.slice()], f.name.replace(/\.bitgraph(\.[^./]+)?$/i, "$1") || f.name, { type: f.type, lastModified: f.lastModified });
  });
  return out;
}

/** Each photo's fingerprint and Content Credentials (lib/trustmark/record.ts), for the photos this browser can open, up
 *  to MAX_FINGERPRINTED; a record already in the drop (a folder dropped again with its records) is not made twice.
 *  Worked out from the pictures alone, so it runs while the drop is being hashed; the records take each photo's SHA-256
 *  once that is known (fingerprintRecords). */
// The browser decodes photos off the page's thread, so several run side by side; eight at once was no faster than four.
const PRINTS_AT_ONCE = 4;
type PhotoPrint = { name: string; index: number; fp: Fingerprint; store: Uint8Array | null; thumb: Uint8Array | null };
async function photoPrints(files: File[], onProgress?: (n: number, of: number) => void): Promise<PhotoPrint[]> {
  const names = new Set(files.map((f) => f.webkitRelativePath || f.name));
  const photos = files.map((f, index) => ({ f, index, name: f.webkitRelativePath || f.name }))
    .filter((p) => looksLikePhoto(p.f) && !p.name.endsWith(RECORD_SUFFIX) && !p.name.endsWith(THUMB_SUFFIX) && !names.has(`${p.name}${RECORD_SUFFIX}`));
  if (photos.length === 0 || photos.length > MAX_FINGERPRINTED) return [];
  // several photos at a time, each decoded straight to the fingerprint's size; the prints keep the drop's order
  const each: Array<PhotoPrint | null> = new Array(photos.length).fill(null);
  let n = 0;
  await pool(photos, PRINTS_AT_ONCE, async (p, i) => {
    const img = await decodeForRecord(p.f);
    // graphics are recorded as they are: the pointer shows on them (isPhotographic)
    if (img && isPhotographic(img)) {
      // its Content Credentials, when it carries them, go beside it (lib/trustmark/c2pa-leaf.ts)
      const store = manifestStoreOf(new Uint8Array(await p.f.arrayBuffer()));
      // and its reference thumbnail (lib/trustmark/thumb.ts), bound beside it and published with the record
      const thumb = await makeThumb(p.f).catch(() => null);
      each[i] = { name: p.name, index: p.index, fp: fingerprintOf(img), store: store && store.length <= MAX_MANIFEST_BYTES ? store : null, thumb };
    }
    n++;
    if (onProgress && (n % 10 === 0 || n === photos.length)) onProgress(n, photos.length);
  });
  return each.filter((x): x is PhotoPrint => x !== null);
}
/** The record files of a drop's photos, each with its photo's SHA-256 from the drop's leaves, as tree leaves. */
async function fingerprintRecords(prints: PhotoPrint[], leaves: Array<[string, string, string]>): Promise<{ leaves: Array<[string, string, string]>; records: Uint8Array[]; thumbs: Array<Uint8Array | null> }> {
  const made: Array<{ file: File; name: string }> = [];
  const records: Uint8Array[] = [], thumbs: Array<Uint8Array | null> = [];
  for (const p of prints) {
    const bytes = recordBytesOf(leaves[p.index]![2], p.fp);
    records.push(bytes); thumbs.push(p.thumb);
    made.push({ file: recordFile(p.name, bytes), name: `${p.name}${RECORD_SUFFIX}` });
    if (p.thumb) made.push({ file: new File([p.thumb as BlobPart], `${p.name}${THUMB_SUFFIX}`, { type: "image/jpeg" }), name: `${p.name}${THUMB_SUFFIX}` });
    if (p.store) made.push({ file: new File([p.store as BlobPart], `${p.name}${C2PA_SUFFIX}`, { type: "application/c2pa" }), name: `${p.name}${C2PA_SUFFIX}` });
  }
  // the leaf's name is the photo's path in the drop plus the suffix (a File's own name cannot hold the path)
  return { leaves: (await hashLeaves(made.map((m) => m.file))).map((l, i) => [made[i]!.name, l[1], l[2]]), records, thumbs };
}

/** A photo whose pixels carry a hidden pointer (a TrustMark): the BitGraph it points to, and, quietly, how closely
 *  this copy matches the picture that BitGraph bound (a visual match; the original's own bytes are what prove it). */
const proofHref = (o: Original) => `/proof/${toUrlSafe(o.photoDigestB64)}?counter=${encodeURIComponent(String(o.counter))}&epoch=${encodeURIComponent(toUrlSafe(o.epochId))}`;
/** copy: the row's own bytes, carried to the proof page it opens so that page shows the copy and its reference. */
function LooksLine({ v, copy }: { v: LooksVerdict; copy: { name: string; data: Uint8Array } | null }) {
  const router = useRouter();
  const all = useMemo(() => (v.verdict === "match" ? [{ original: v.original, score: v.score }, ...v.others] : []), [v]);
  const originals = useMemo(() => all.map((m) => m.original), [all]);
  if (v.verdict !== "match") return null;
  const open = (o: Original) => {
    if (copy) setHeldCopy(toUrlSafe(o.photoDigestB64), { name: copy.name, data: copy.data.slice().buffer as ArrayBuffer, kind: "copy", score: all.find((m) => m.original === o)?.score ?? v.score, found: o, others: all.map((m) => m.original).filter((x) => x !== o) });
    router.push(proofHref(o));
  };
  const link = (o: Original, label: React.ReactNode) => <a href={proofHref(o)} onClick={(e) => { e.preventDefault(); open(o); }}>{label}</a>;
  if (all.length === 1) {
    const o = v.original, href = proofHref(o);
    return (
      <>
        <span className="db-ok">Looks like {link(o, <>BitGraph #{o.counter.toLocaleString("en-US")}</>)}</span>
        <span className="db-size db-wrap">Your copy matches the picture this BitGraph recorded. Its proof page proves the original file.</span>
        <FoundThumb o={o} href={href} onOpen={() => open(o)} />
      </>
    );
  }
  // The same picture bound as more than one file (an export made twice): each is an original with its own proof, and
  // only the holder knows which they mean, so every one is listed, with its reference and whether its file is hosted.
  return (
    <>
      <span className="db-ok">Looks like a picture recorded {all.length} times</span>
      <span className="db-size db-wrap">The same picture was recorded as {all.length} different files, earliest first.</span>
      <ul className="db-looks-list">
        {all.map(({ original: o }) => {
          const href = proofHref(o);
          return (
            <li key={`${o.photoDigestB64}/${o.epochId}/${o.counter}`}>
              <span className="db-ok">{link(o, <>BitGraph #{o.counter.toLocaleString("en-US")}</>)}</span>
              <FoundThumb o={o} href={href} onOpen={() => open(o)} among={originals} />
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** The earliest of a file's BitGraphs, by the enclave's signed time, then by count. */
function earliestOf(entries: Array<{ proof: Proof; writeTime?: number | null }>): Proof | undefined {
  const when = (e: { proof: Proof; writeTime?: number | null }) => recordedMsOf(e.proof) ?? e.writeTime ?? Number.POSITIVE_INFINITY;
  return entries.slice().sort((a, b) => when(a) - when(b) || Number(a.proof.commit?.counter ?? 0) - Number(b.proof.commit?.counter ?? 0))[0]?.proof;
}

async function check(proof: Proof, bytes: Uint8Array): Promise<boolean> {
  const { proofHash: _h, ...p } = proof as Proof & { proofHash?: unknown };
  // A file of a tree, found by its own hash (lib/tree-member.ts): its hash must walk up to the root the proof binds, and
  // the proof is then checked against the root's text, the bytes it signs.
  const member = memberOf(proof);
  if (member) {
    const d = b64(await sha256(bytes));
    if (!checkMember(proof, d, member)) return false;
    bytes = rootTextBytes(member);
  }
  try {
    // The full check (2026-10-18 audit): signature and counts AND the AWS Nitro attestation, pinned to BitGraph's
    // published images. A signature alone is checked against the key the proof carries, which anyone can make.
    // The member's block is left out here: the walk above is done, and a verifier that walks members itself
    // (bitgraph-verify 1.24 on) would otherwise take the root text for the file.
    const plain = member ? { ...p, metadata: Object.fromEntries(Object.entries((p as { metadata?: Record<string, unknown> }).metadata ?? {}).filter(([k]) => k !== "bitgraph-tree-member/1")) } : p;
    const r = await verifyAttested({ proof: plain as never, bytes, context: createVerificationContext() });
    return r.valid === true;
  } catch {
    return false;
  }
}


/** mode "check" only looks files up and never makes anything (the ledger page); "make" looks them up, then
 *  offers to make the ones that are new (/make). */
/** canMake (the Proofs page): a check that offers to make a BitGraph of whatever is not on record yet, one press each
 *  drop, instead of making it at once as "make" does. */
/** Each file's first BitGraph, by its SHA-256 (standard base64), in one request per 2,000. */
async function firstsOf(digests: string[]): Promise<Map<string, Proof>> {
  const out = new Map<string, Proof>();
  for (let i = 0; i < digests.length; i += 2000) {
    const batch = digests.slice(i, i + 2000), keys = batch.map(toUrlSafe);
    try {
      const res = await fetch("/api/proofs/batch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ digests: keys }) });
      if (!res.ok) continue;
      const body = (await res.json()) as { results?: Record<string, { proofs?: Array<{ proof: Proof; envRef?: string }> }>; environments?: Record<string, Record<string, unknown>> };
      const results = body.results ?? {};
      attachEnvironments(results as never, body.environments);
      batch.forEach((d, k) => { const f = earliestOf(results[keys[k]!]?.proofs ?? []); if (f) out.set(d, f); });
    } catch { /* that batch opens the new BitGraph */ }
  }
  return out;
}

/** A checked photo as a gallery item: the BitGraph it leads to, and how its file is handed to that page. */
type Found = { file: File; item: GalleryItem; prepare: () => Promise<void> };
function foundOriginal(file: File, digest: string, proof: Proof): Found | null {
  const c = proof.commit as { counter?: string | number; epochId?: string } | undefined;
  if (c?.counter === undefined || !c.epochId) return null;
  const item = { digest, name: file.name, counter: String(c.counter), epochId: String(c.epochId) };
  return { file, item, prepare: () => handOriginal(file, digest, proof, item.counter, item.epochId) };
}
/** The checked photos of a drop as a gallery, each once, when there are two or more. */
function galleryOfFound(found: Found[]): Gallery | null {
  const seen = new Set<string>();
  const kept = found.filter((x) => { const k = `${x.item.digest}@${x.item.counter}`; return !seen.has(k) && !!seen.add(k); });
  if (kept.length < 2 || kept.length > MAX_GALLERY) return null;
  const g = { id: `check-${Date.now()}`, items: kept.map((x) => x.item) };
  setGallery(g, kept.map((x) => x.file), (i) => kept[i]!.prepare());
  return g;
}

export function DropBox({ mode = "make", variant = "zone", canMake = false }: { mode?: "make" | "check"; variant?: "zone" | "buttons"; canMake?: boolean }) {
  // The drop box on /make makes and checks (2026-10-17), both in one box. The ledger's search
  // (mode "check", variant "buttons": two Finder buttons, no box) only looks files up and never makes one.
  const [rows, setRows] = useState<Row[]>([]);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  /** One file at a time shows a single line in the box instead of a row list (2026-10-17: the list made it jump). */
  const [status, setStatus] = useState<string | null>(null);
  /** ?timer on the page's address shows the elapsed time of a big drop, live and final (2026-10-17: a speed test). */
  const [timer, setTimer] = useState(false);
  useEffect(() => { try { setTimer(new URLSearchParams(window.location.search).has("timer")); } catch { /* no timer */ } }, []);
  /** A big drop (more than MAX_FILES): counts and the proofs, never one row per file. */
  /** Proof files dropped with originals: each original paired with its proof by hash and checked here. */
  const [pairing, setPairing] = useState<{ proofs: number; files: number; valid: number; invalid: number; noProof: number; unusedProofs: number; done: boolean } | null>(null);
  const [batch, setBatch] = useState<{ root: string; total: number; rootFile: string | null; rootProof: Proof | null; rootDigest: string | null; rootState: "looking" | "found" | "missing" | "mismatch" | "absent"; rows: Array<{ name: string; index: number | null }> } | null>(null);
  const [bulk, setBulk] = useState<{ total: number; made: number; found: number; missing: number; failed: number; done: boolean; proofs: Proof[]; ms: number } | null>(null);
  // The files of a big check that are not on record yet, one per digest: on Proofs, offered to be made in one press.
  const [bulkNew, setBulkNew] = useState<File[]>([]);
  // A check of several photos: those that lead to a proof, as a gallery (as a drop of photos on Make).
  const [checked, setChecked] = useState<Gallery | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  /* Plugins (2026-10-18: toggles at the top of the section where a BitGraph is made): off by default; both
     sit on the plain bind (lib/plugins.ts). */
  const [plugError, setPlugError] = useState<string | null>(null);
  const [plug, setPlug] = useState<{
    fromList?: boolean; // the tree came from a hash list, no file opened (2026-10-21)
    tree: PluginTree | null; rootText: string | null; contentName: string; contentDigest: string; b: Proof & { proofHash?: string };
    block: BaseBlock | null; blockBytes: Uint8Array | null; a: (Proof & { proofHash?: string }) | null; ceiling: "waiting" | "written" | null; ceilingInfo: string | null;
    /** With ?timer: milliseconds spent hashing (the tree) and binding, from the drop to the proof. */
    ms?: { hash: number; bind: number; total: number };
    /** A tree's sealed lookup entries, one per file, so a file dropped later finds this tree. */
    lookup?: { stored: number; total: number; state: "sealing" | "saving" | "done" | "failed"; note?: string };
    /** The tree was already a BitGraph: nothing was bound, its index was finished (2026-10-20). */
    already?: boolean;
    /** Two or more photos in the drop: each one's proof, a page at a time or as a grid. */
    gallery?: Gallery;
  } | null>(null);

  const patch = (key: string, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));

  /** Bind the given rows (all new) in the enclave; returns the rows as they ended. */
  const makeRows = async (todo: Row[]): Promise<Row[]> => {
    if (todo.length === 0) return [];
    setBusy(true);
    for (const r of todo) patch(r.key, { state: "making" });
    const out: Row[] = [];
    const end = (r: Row, p: Partial<Row>) => { patch(r.key, p); out.push({ ...r, ...p }); };
    try {
      const res = await fetch("/api/commit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ digests: todo.map((r) => ({ digestB64: r.digestB64, hashAlg: "sha256" })), chainId: "bitgraph:main" }),
      });
      if (!res.ok) {
        const note = res.status === 503 ? "The enclave is restarting (it does once a day). Try again in a minute." : "The BitGraph could not be made just now. No BitGraph was made.";
        for (const r of todo) end(r, { state: "new", note });
        return out;
      }
      const raw = (await res.json()) as Proof[] | { proofs?: Proof[] };
      const proofs = Array.isArray(raw) ? raw : raw.proofs ?? [];
      for (const r of todo) {
        const p = proofs.find((x) => x.artifact?.digestB64 === r.digestB64);
        if (!p || !r.bytes) { end(r, { state: "error", note: "No proof came back for this file. Look it up on the ledger before trying again." }); continue; }
        end(r, { state: "made", proof: p, valid: await check(p, r.bytes) });
      }
    } catch {
      for (const r of todo) end(r, { state: "error", note: "The request did not finish. Look the file up on the ledger before trying again: it may already be a BitGraph." });
    } finally {
      setBusy(false);
    }
    return out;
  };

  /* A drop just does it, then opens the proof page (2026-10-17):
     every file is looked up; on /make the new ones are made at once; one file lands on its proof page. A dropped
     proof file (a .bitgraph.json) opens the proof it belongs to, and is never itself made into a BitGraph. */
  /* A big drop: hash everything here, then bind in batches of 50 (make) or look each up (check). Rate limits are
     waited out, never treated as failures; the enclave's daily restart (503) is waited out too. */
  const takeMany = useCallback(async (files: File[]) => {
    setRows([]); setStatus(null); setBulkNew([]); setChecked(null);
    const total = files.length;
    const t0 = performance.now();
    const st = { total, made: 0, found: 0, missing: 0, failed: 0, done: false, proofs: [] as Proof[], ms: 0 };
    const show = () => { st.ms = performance.now() - t0; setBulk({ ...st, proofs: st.proofs }); };
    show();
    const digests: string[] = new Array(total);
    let hashed = 0;
    await pool(files, 8, async (f, i) => {
      try { digests[i] = b64(new Uint8Array(await crypto.subtle.digest("SHA-256", await f.arrayBuffer()))); } catch { st.failed++; }
      hashed++;
      if (hashed % 250 === 0 || hashed === total) setStatus(`Hashed ${hashed.toLocaleString("en-US")} of ${total.toLocaleString("en-US")}…`);
    });
    const todo = digests.filter(Boolean);
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const unknown = new Set<string>(); // a lookup that failed: never made, since it may already be a BitGraph
    const firstOf = new Map<string, Proof>();
    {
      let looked = 0;
      // One request per 2,000 files, three at a time (2026-10-18: a 10,000 file drop was slow to
      // check): the batch route rules new files out from its digest index without reading the ledger, where one
      // request per file was 10,000 round trips. Attestations travel once per batch and are put back on each proof.
      const batches: string[][] = [];
      for (let i = 0; i < todo.length; i += 2000) batches.push(todo.slice(i, i + 2000));
      await pool(batches, 3, async (batch) => {
        const keys = batch.map(toUrlSafe);
        try {
          const res = await fetch("/api/proofs/batch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ digests: keys }) });
          if (!res.ok) throw new Error(String(res.status));
          const body = (await res.json()) as { results?: Record<string, { proofs?: Array<{ proof: Proof; envRef?: string }>; unavailable?: boolean }>; environments?: Record<string, Record<string, unknown>> };
          const results = body.results ?? {};
          attachEnvironments(results as never, body.environments);
          batch.forEach((d, i) => {
            const r = results[keys[i]!];
            const first = earliestOf(r?.proofs ?? []);
            if (!r || r.unavailable) { st.failed++; unknown.add(d); } else if (first) { st.found++; st.proofs.push(first); firstOf.set(d, first); } else st.missing++;
          });
        } catch { for (const d of batch) { st.failed++; unknown.add(d); } }
        looked += batch.length;
        setStatus(`Checked ${looked.toLocaleString("en-US")} of ${todo.length.toLocaleString("en-US")}…`); show();
      });
    }
    // Then make only the ones not on record yet (the box does both, as it used to).
    const fresh: string[] = [];
    {
      const seen = new Set<string>(st.proofs.map((p) => p.artifact?.digestB64 as string));
      for (const d of todo) if (!seen.has(d) && !unknown.has(d)) { fresh.push(d); seen.add(d); }
    }
    if (mode === "check" && canMake) {
      const want = new Set(fresh), picked: File[] = [];
      files.forEach((f, i) => { const d = digests[i]; if (d && want.delete(d)) picked.push(f); });
      setBulkNew(picked);
    }
    if (mode === "make" && fresh.length) { // the ledger's search only looks up
      const chunks: string[][] = [];
      for (let i = 0; i < fresh.length; i += 50) chunks.push(fresh.slice(i, i + 50));
      await pool(chunks, 3, async (chunk) => {
        for (let attempt = 0; attempt < 200; attempt++) {
          let res: Response;
          try {
            res = await fetch("/api/commit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ digests: chunk.map((d) => ({ digestB64: d, hashAlg: "sha256" })), chainId: "bitgraph:main" }) });
          } catch { await wait(5000); continue; }
          if (res.status === 429 || res.status === 503) {
            const after = Number(res.headers.get("retry-after")) || (res.status === 503 ? 30 : 15);
            setStatus(res.status === 429 ? `Rate limit reached: waiting ${after} s, then continuing (made ${st.made.toLocaleString("en-US")} of ${total.toLocaleString("en-US")})…` : `The enclave is restarting: waiting ${after} s (made ${st.made.toLocaleString("en-US")} of ${total.toLocaleString("en-US")})…`);
            await wait(after * 1000);
            continue;
          }
          if (!res.ok) { st.failed += chunk.length; show(); return; }
          const raw = (await res.json()) as Proof[] | { proofs?: Proof[] };
          const proofs = Array.isArray(raw) ? raw : raw.proofs ?? [];
          st.made += proofs.length; st.failed += Math.max(0, chunk.length - proofs.length);
          st.proofs.push(...proofs);
          setStatus(`Made ${st.made.toLocaleString("en-US")} of ${total.toLocaleString("en-US")}…`); show();
          return;
        }
        st.failed += chunk.length; show();
      });
    }
    st.done = true; setStatus(null); show();
    if (mode === "check") setChecked(galleryOfFound(files.flatMap((f, i) => { const d = digests[i], p = d ? firstOf.get(d) : undefined; const x = p && looksLikePhoto(f) ? foundOriginal(f, d!, p) : null; return x ? [x] : []; })));
  }, [mode, canMake]);

  const downloadAll = () => {
    if (!bulk) return;
    const blob = new Blob([JSON.stringify(bulk.proofs, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `bitgraphs-${bulk.proofs.length}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const takeBatch = useCallback(async (files: File[], tree: MerkleTree, treeFile: File) => {
    setRows([]); setBulk(null); setStatus("Checking against the batch…");
    const others = files.filter((f) => f !== treeFile);
    // merkle-root.txt: the file that was made a BitGraph; it must carry the tree's root.
    let rootFile: File | null = null, rootText = "";
    for (const f of others) { if (/\.txt$/i.test(f.name) && f.size < 4096) { const t = await f.text(); if (t.includes(tree.root) && /Merkle root/i.test(t)) { rootFile = f; rootText = t; break; } } }
    const members = others.filter((f) => f !== rootFile);
    const rows: Array<{ name: string; index: number | null }> = [];
    for (const f of members) {
      const data = new Uint8Array(await f.arrayBuffer());
      const leaf = tree.format === DIGEST_TREE_FORMAT ? hex(leafOfDigest(await sha256(data))) : hex(await sha256(new Uint8Array([0]), data));
      const r = await rootFromLeaf(tree, leaf);
      rows.push({ name: f.name, index: r && r.root === tree.root ? r.index : null });
    }
    let rootState: "looking" | "found" | "missing" | "mismatch" | "absent" = rootFile ? "looking" : "absent";
    let rootProof: Proof | null = null, rootDigest: string | null = null;
    setBatch({ root: tree.root, total: tree.files ?? tree.leaves.length, rootFile: rootFile?.name ?? null, rootProof, rootDigest, rootState, rows });
    if (rootFile) {
      if (!rootText.includes(tree.root)) rootState = "mismatch";
      else {
        rootDigest = b64(await sha256(new Uint8Array(await rootFile.arrayBuffer())));
        try {
          const res = await fetch(`/api/proofs/${toUrlSafe(rootDigest)}`);
          const body = res.ok ? ((await res.json()) as { proofs?: Array<{ proof: Proof }> }) : null;
          rootProof = body?.proofs?.[0]?.proof ?? null;
          rootState = rootProof ? "found" : "missing";
        } catch { rootState = "missing"; }
      }
    }
    setStatus(null);
    setBatch({ root: tree.root, total: tree.files ?? tree.leaves.length, rootFile: rootFile?.name ?? null, rootProof, rootDigest, rootState, rows });
  }, []);

  /* Proofs dropped as files (a list from "Download all", or single .bitgraph.json files), with or without the originals:
     each original is paired with its proof by its SHA-256 and checked in this browser. Nothing here is ever made or sent
     (2026-10-17: the grouped JSON did not work as a proof; it was read again instead). */
  const takePairing = useCallback(async (proofs: Map<string, Proof>, originals: File[]) => {
    setRows([]); setBulk(null); setBatch(null);
    const st = { proofs: proofs.size, files: originals.length, valid: 0, invalid: 0, noProof: 0, unusedProofs: 0, done: false };
    const show = () => setPairing({ ...st });
    show();
    const used = new Set<string>();
    let n = 0;
    await pool(originals, 8, async (f) => {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const d = b64(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource)));
      const p = proofs.get(d);
      if (!p) st.noProof++;
      else { used.add(d); if (await check(p, bytes)) st.valid++; else st.invalid++; }
      n++;
      if (n % 50 === 0 || n === originals.length) { setStatus(`Checked ${n.toLocaleString("en-US")} of ${originals.length.toLocaleString("en-US")}…`); show(); }
    });
    st.unusedProofs = proofs.size - used.size;
    st.done = true; setStatus(null); show();
  }, []);

  /* first: the earliest BitGraph of the picture this file shows, when the find knows one; the new BitGraph names it
     (app/api/lineage). Found below for a single picture; a caller may pass it. */
  const takePlugins = useCallback(async (files: File[], list?: Array<{ hex: string; name: string }>, first?: FirstPosition) => {
    setRows([]); setBulk(null); setBatch(null); setPairing(null); setPlug(null); setPlugError(null); setChecked(null); setBusy(true);
    // ?timer times the run from the drop to the proof (2026-10-18: for timing the 100,000-file tree).
    const t0 = performance.now();
    const secs = () => ((performance.now() - t0) / 1000).toFixed(1);
    let looksLater: Promise<Awaited<ReturnType<typeof judgeLooks>> | null> | null = null;
    let cachedLater: Promise<unknown> | null = null;
    const firstOfLooks = (v: Awaited<ReturnType<typeof judgeLooks>> | null): FirstPosition | undefined => {
      if (v?.verdict !== "match") return undefined;
      const all = [v.original, ...v.others.map((m) => m.original)];
      const when = (o: Original) => o.recordedMs ?? Number.POSITIVE_INFINITY;
      const o = all.slice().sort((a, b) => when(a) - when(b) || Number(a.counter) - Number(b.counter))[0]!;
      return { digestB64: o.photoDigestB64, epochId: o.epochId, counter: String(o.counter) };
    };
    try {
      /* One file that already has a BitGraph is not recorded again (2026-10-29): existence is one-directional, so a
         later record of the same bytes says less than the first and costs a count. Its oldest proof opens instead,
         with the file in hand. A folder is always a new tree, and a hash list is bulk. */
      if (!list && files.length === 1) {
        const f = files[0]!;
        setStatus("Checking the ledger…");
        const bytes = new Uint8Array(await f.arrayBuffer());
        const digest = await digestOf(bytes);
        // The looks check (below) starts now, beside the lookup and the hashing (2026-10-30): its answer is needed only
        // after the bind, to name the first BitGraph of the picture, so nothing waits on it.
        if (looksLikePhoto(f) && !first) looksLater = decodeForReading(f).catch(() => null).then((img) => (img ? judgeLooks(img, { search: true }).catch(() => null) : null));
        // The file is saved for its proof page now too, during the bind rather than after it.
        cachedLater = cacheArtifactToIDB(f, digest).catch(() => {});
        const res = await fetch(`/api/proofs/${toUrlSafe(digest)}`).catch(() => null);
        // never recorded blind: there is one BitGraph per file, and that cannot be known while the ledger is unreachable
        if (!res?.ok) { setStatus(null); setPlugError("Could not check the ledger just now. Try again in a moment."); return; }
        const before = (await res.json().catch(() => null)) as { proofs?: Array<{ proof: Proof; writeTime?: number | null; kind?: string }> } | null;
        const already = earliestOf((before?.proofs ?? []).filter((e) => !e.kind || e.kind === "recorded"));
        const fc = already?.commit as { counter?: string; epochId?: string } | undefined;
        if (fc?.counter && fc.epochId) {
          setStatus("Already a BitGraph. Opening its proof…");
          // the file goes with the page: saved before the proof opens, so it opens with the file in hand
          try { await Promise.race([cachedLater, new Promise((r) => setTimeout(r, 3000))]); } catch { /* the page still opens */ }
          router.push(`/proof/${toUrlSafe(digest)}?counter=${encodeURIComponent(fc.counter)}&epoch=${encodeURIComponent(toUrlSafe(fc.epochId))}`);
          return;
        }
        // One action (2026-10-29): new bytes are recorded, always. A picture that looks like one already recorded (a
        // re-export, a re-save, a copy) is recorded too, and the new BitGraph names the earliest one of that picture
        // (app/api/lineage), so its page says so; nothing is chosen for the holder and nothing opens in its place.
        // The find failing to answer costs only the note.
      }
      /* Every drop, one file or many, is one tree and one BitGraph (2026-10-20). Its first leaf is the latest Base
         block (base-block.json): the bound root holds that block's hash, so everything in the tree was bound after the
         block existed. Every BitGraph gets a Base ceiling too, so each file's proof carries a window, after block X and
         by block Y. The Base switch and its second BitGraph are gone. */
      const count = list ? list.length : files.length;
      setStatus(list ? `Reading 0 of ${count.toLocaleString("en-US")} hashes…` : `Hashing 0 of ${count.toLocaleString("en-US")}…`);
      // Everything that does not wait on the bind runs at once: the files are hashed, each photo's fingerprint is worked
      // out from its picture (lib/trustmark/record.ts, so a photo can later carry a pointer back here; up to
      // MAX_FINGERPRINTED a drop, a photo this browser cannot open is recorded as it is), and the latest Base block is
      // read for the floor. A folder is not looked up first: every folder drop is a new tree and a new BitGraph.
      const blockLater = latestBaseBlock();
      blockLater.catch(() => {});
      let hashed = 0, printed = 0, printing = 0;
      const say = () => setStatus(printing ? `Hashing ${hashed.toLocaleString("en-US")} of ${count.toLocaleString("en-US")}, fingerprinting ${printed.toLocaleString("en-US")} of ${printing.toLocaleString("en-US")} photos…${timer ? ` ${secs()} s` : ""}` : `Hashing ${hashed.toLocaleString("en-US")} of ${count.toLocaleString("en-US")}…${timer ? ` ${secs()} s` : ""}`);
      const [dropped, prints] = await Promise.all([
        list
          ? leavesOfDigests(list, (n) => setStatus(`Reading ${n.toLocaleString("en-US")} of ${count.toLocaleString("en-US")} hashes…${timer ? ` ${secs()} s` : ""}`))
          : hashLeaves(files, (n) => { hashed = n; say(); }),
        list ? Promise.resolve([] as PhotoPrint[]) : photoPrints(files, (n, of) => { printed = n; printing = of; say(); }),
      ]);
      const fp = prints.length ? await fingerprintRecords(prints, dropped) : { leaves: [], records: [], thumbs: [] };
      const leaves = fp.leaves.length ? [...dropped, ...fp.leaves] : dropped;
      // Files sorted by path, so the same folder always makes the same tree around its floor (2026-10-20).
      const fileLeaves = sortedLeaves(leaves);
      let tree: PluginTree | null = null, rootText = "", floorFile: string | null = null, block: BaseBlock | null = null;
      const already: Proof | null = null;
      const tHashed = performance.now();
      if (!already) {
        block = await blockLater;
        floorFile = baseBlockFileText(block);
        const [floorLeaf] = await hashLeaves([new File([floorFile], "base-block.json", { type: "application/json" })]);
        const t = await treeFromLeaves([floorLeaf!, ...fileLeaves]);
        tree = t.tree; rootText = t.rootText;
        setStatus("Making the BitGraph…");
      }
      const contentName = "merkle-root.txt", contentDigest = await digestOf(new TextEncoder().encode(rootText));
      const b = already ?? await bindOne(contentDigest, { ceiling: true, floorLeaf: true });
      void cacheArtifactToIDB(new File([rootText], contentName, { type: "text/plain" }), contentDigest).catch(() => {});
      const tDone = performance.now();
      const t = tree!, total = t.files;
      const blocks = memberBlocks(t, rootText, floorFile ?? undefined);
      // One file goes straight on to its proof page (below), so the tree's panel is never drawn for it: shown for the
      // moment its index is written, it would flash up under "Opening the proof…" before the page changes.
      const opensProof = !list && files.length === 1 && !timer;
      // The drop's photos, in the tree's order, as a gallery: each opens its own proof, handed over with its place in
      // the tree so it never waits on the index.
      let gallery: Gallery | undefined;
      if (!opensProof && !list) {
        const byDigest = new Map<string, File>();
        dropped.forEach((l, k) => { const f = files[k]!; if (looksLikePhoto(f) && !byDigest.has(l[2])) byDigest.set(l[2], f); });
        if (byDigest.size >= 2 && byDigest.size <= MAX_GALLERY && b.commit?.counter && b.commit?.epochId) {
          const seen = new Set<string>(), counter = String(b.commit.counter), epochId = String(b.commit.epochId);
          const at = t.leaves.flatMap((l, i) => (byDigest.has(l[2]) && !seen.has(l[2]) && seen.add(l[2]) ? [i] : []));
          gallery = { id: contentDigest, items: at.map((i) => ({ digest: t.leaves[i]![2], name: byDigest.get(t.leaves[i]![2])!.name, counter, epochId })) };
          const held = at.map((i) => byDigest.get(t.leaves[i]![2])!), g0 = gallery;
          // Each photo opens its first BitGraph, the one that counts: a photo bound before points there, and only a
          // photo new to the ledger opens this one. Looked up after the bind, so the bind never waits on it.
          const firsts = firstsOf(g0.items.map((it) => it.digest)).catch(() => new Map<string, Proof>());
          const isThis = (p: Proof) => String(p.commit?.counter) === counter && String(p.commit?.epochId) === epochId;
          const prepare = async (k: number) => {
            const it = g0.items[k]!, first = (await Promise.race([firsts, new Promise<null>((r) => setTimeout(() => r(null), 3000))]))?.get(it.digest);
            if (first && !isThis(first)) await handOriginal(held[k]!, it.digest, first, String(first.commit!.counter), String(first.commit!.epochId));
            else await handOriginal(held[k]!, it.digest, withMember(b as Record<string, unknown>, blocks[at[k]!]!), counter, epochId);
          };
          setGallery(g0, held, prepare);
          void firsts.then((m) => {
            if (![...m.values()].some((p) => !isThis(p))) return;
            const g1 = { ...g0, items: g0.items.map((it) => { const p = m.get(it.digest); return p && !isThis(p) ? { ...it, counter: String(p.commit!.counter), epochId: String(p.commit!.epochId) } : it; }) };
            setGallery(g1, held, prepare);
            setPlug((p) => (p && p.b === b ? { ...p, gallery: g1 } : p));
          });
        }
      }
      if (!opensProof) setPlug({ gallery, tree: t, rootText, contentName, contentDigest, b, block, blockBytes: null, a: null, ceiling: already ? null : "waiting", ceilingInfo: null, ms: { hash: tHashed - t0, bind: tDone - tHashed, total: tDone - t0 }, already: !!already, fromList: !!list });
      // Each file is indexed under its own hash with the tree's floor (lib/tree-member.ts): written after the proof is
      // shown, so the BitGraph never waits on it; the server checks every path to the root before it writes.
      type Lookup = { stored: number; total: number; state: "sealing" | "saving" | "done" | "failed"; note?: string };
      const lookup = (l: Lookup) => setPlug((p) => (p && p.b === b ? { ...p, lookup: l } : p));
      lookup({ stored: 0, total, state: "saving" });
      const indexed = (async () => {
        try {
          const stored = await postTreeMembers({ rootDigestB64: contentDigest, epochId: String(b.commit!.epochId), counter: String(b.commit!.counter), rootText, ...(blocks[0]?.floor ? { floor: blocks[0].floor } : {}) },
            t.leaves.map((l, i) => ({ digestB64: l[2], index: i, path: blocks[i]!.path })), (n) => lookup({ stored: n, total, state: "saving" }));
          lookup({ stored, total, state: stored >= total ? "done" : "failed", note: stored >= total ? undefined : `${(total - stored).toLocaleString("en-US")} could not be saved` });
          return stored >= total;
        } catch (e) { lookup({ stored: 0, total, state: "failed", note: (e as Error).message }); return false; }
      })();
      // Each photo's fingerprint record is published once the tree is indexed (the server checks each against the
      // tree before keeping it), so a copy with everything stripped can still find the original's proof by what it
      // looks like (lib/trustmark/check, on Check). The record is what the tree already binds, a pHash and a brightness grid, never the photo.
      if (fp.records.length) void indexed.then(async (ok) => {
        if (!ok) return;
        let next = 0;
        await Promise.all(Array.from({ length: 3 }, async () => { while (next < fp.records.length) { const i = next++; await publishRecord(fp.records[i]!, null, fp.thumbs[i]).catch(() => false); } }));
      });
      /* One file opens its own proof page, as a plain drop always has: its tree is two leaves (the floor and the file), so
         its index is written in a moment; the page opens with the proof in hand either way. */
      if (opensProof) {
        setStatus("Opening the proof…");
        const fileDigest = dropped[0]![2], i = t.leaves.findIndex((l) => l[2] === fileDigest);
        /* The proof opens the moment the bind is back (2026-10-30): the page is handed the proof below, so it never
           waited on the index. The index, the picture's record and the naming of the picture's first BitGraph finish
           behind it; the page re-reads the lineage for a while, so the name lands when it is written. The second ledger
           lookup is gone: the same bytes were looked up before anything was recorded. */
        const nc = b.commit as { counter?: string; epochId?: string } | undefined;
        void (async () => {
          if (!(await indexed) || !fp.records.length) return;
          const v = looksLater ? await looksLater : null;
          const named = first ?? firstOfLooks(v);
          if (!named) return;
          if (!(await publishRecord(fp.records[0]!, null, fp.thumbs[0]).catch(() => false)) || !nc?.counter || !nc.epochId) return;
          const body = JSON.stringify({ digest: toUrlSafe(fileDigest), epoch: toUrlSafe(nc.epochId), counter: String(nc.counter), firstDigest: toUrlSafe(named.digestB64), firstEpoch: toUrlSafe(named.epochId), firstCounter: named.counter });
          for (let attempt = 0; attempt < 6; attempt++) {
            const r = await fetch("/api/lineage", { method: "POST", headers: { "content-type": "application/json" }, body }).catch(() => null);
            if (r && r.status !== 404 && r.status < 500) break;
            await new Promise((res) => setTimeout(res, 2000));
          }
        })();
        // The file goes with the page (the proof opens with it in hand): its save started during the bind, so this is brief.
        try { await Promise.race([cachedLater ?? cacheArtifactToIDB(files[0]!, fileDigest), new Promise((r) => setTimeout(r, 1500))]); } catch { /* the page still opens; the reader can drop the file there */ }
        const commit = b.commit as { counter?: string; epochId?: string } | undefined;
        const epoch = commit?.epochId ? toUrlSafe(commit.epochId) : "";
        const sel = commit?.counter ? `?counter=${encodeURIComponent(commit.counter)}${epoch ? `&epoch=${encodeURIComponent(epoch)}` : ""}` : "";
        setFreshProof(toUrlSafe(fileDigest), { proofs: [{ proof: withMember(b as Record<string, unknown>, blocks[i]!) as Proof }], positions: commit?.counter ? [{ counter: commit.counter, epoch: epoch || null, lowerTime: null, upperTime: null }] : [], causalWindow: null, anchorBlock: null });
        router.push(`/proof/${toUrlSafe(fileDigest)}${sel ? `${sel}&` : "?"}${already ? "" : "fresh=1"}`);
        return;
      }
      setStatus(null);
    } catch (e) {
      setStatus(null); setPlugError((e as Error).message);
    } finally { setBusy(false); }
  }, [timer, router]);

  // Leaving the page while a tree's index is being written cuts it off (2026-10-20: a 50,000-file tree stopped at 6,500
  // when its proof was opened in the same tab), so the browser asks first.
  useEffect(() => {
    if (plug?.lookup?.state !== "saving" && plug?.lookup?.state !== "sealing") return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [plug?.lookup?.state]);

  // The Base ceiling: the host's writer puts BitGraph 2's proof hash in a later block; look for it now and then.
  useEffect(() => {
    if (plug?.ceiling !== "waiting" || !plug.b.proofHash) return;
    const id = toUrlSafe(plug.b.proofHash);
    let stop = false;
    const look = async () => {
      try {
        const res = await fetch(`/api/ceilings/${id}`, { cache: "no-store" });
        if (res.ok && !stop) { const t = await res.text(); setPlug((p) => (p ? { ...p, ceiling: "written", ceilingInfo: t } : p)); return true; }
      } catch { /* try again */ }
      return false;
    };
    // Every 2 s for the first minute (a batch lands in a few seconds), then every 15 s (2026-10-20: it sat on "waiting"
    // long after Base had it).
    let tries = 0, timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => { void look().then((done) => { if (!done && !stop) timer = setTimeout(tick, ++tries < 30 ? 2000 : 15000); }); };
    tick();
    return () => { stop = true; if (timer) clearTimeout(timer); };
  }, [plug?.ceiling, plug?.b.proofHash]);

  const downloadPlug = () => {
    if (!plug) return;
    const files: Record<string, Uint8Array> = {};
    const j = (o: unknown) => strToU8(JSON.stringify(o, null, 2) + "\n");
    const lines = ["BitGraph, with its tree and its window in public time.", ""];
    if (plug.blockBytes && plug.a) {
      files["base-block.json"] = plug.blockBytes; files["base-block.bitgraph.json"] = j(plug.a);
      lines.push(`base-block.json            BitGraph 1 (#${plug.a.commit?.counter}): the latest Base block when it was made (block ${plug.block?.number}).`, "base-block.bitgraph.json   Its proof.");
    }
    if (plug.tree && plug.rootText) {
      files["merkle-tree.json"] = j(plug.tree); files["merkle-root.txt"] = strToU8(plug.rootText);
      lines.push(`merkle-tree.json           The RFC 6962 tree over ${plug.tree.files.toLocaleString("en-US")} files (leaf = SHA-256(0x00 || file), node = SHA-256(0x01 || left || right)).`, "merkle-root.txt            The root, the file that was bound.");
    }
    files[`${plug.contentName}.bitgraph.json`] = j(plug.b);
    lines.push(`${plug.contentName}.bitgraph.json   ${plug.a ? "BitGraph 2" : "The BitGraph"} (#${plug.b.commit?.counter}): ${plug.tree ? "the root" : "the content"}${plug.a ? ", bound right after BitGraph 1; its proof hash is written to Base" : ""}.`);
    lines.push("", "Check a file: drop it on bitgraph.ing/make" + (plug.tree ? " with merkle-tree.json and merkle-root.txt." : ".") , "Check a proof: npx @mikeargento/bitgraph-sdk verify <file> --proof <file>.bitgraph.json");
    files["README.txt"] = strToU8(lines.join("\n") + "\n");
    const blob = new Blob([zipSync(files).slice()], { type: "application/zip" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `bitgraph-${plug.b.commit?.counter ?? "package"}.zip`; a.click(); URL.revokeObjectURL(a.href);
  };

  // The tree this page just made, for a file dropped before its lookup entries are all stored.
  const plugRef = useRef(plug);
  plugRef.current = plug;


  const take = useCallback(async (filesIn: File[]) => {
    // A BitGraphed file carries its proof after the file's own bytes: look up the file it wraps, never record the
    // wrapper as new bytes (2026-10-20). photo.bitgraph.jpg is checked as photo.jpg.
    const files = await unwrapBitGraphed(filesIn);
    setBatch(null); setPairing(null); setChecked(null);
    // Proof files in the drop: a list, or more than one single proof. They are paired with the rest, never made.
    const proofs = new Map<string, Proof>();
    const proofFiles = new Set<File>();
    for (const f of files) {
      if (!/\.json$/i.test(f.name)) continue;
      const bytes = new Uint8Array(await f.arrayBuffer());
      const list = proofListOf(f, bytes);
      if (list) { for (const p of list) proofs.set(p.artifact!.digestB64!, p); proofFiles.add(f); continue; }
      const one = files.length > 1 ? proofFileOf(f, bytes) : null;
      if (one) { proofs.set(one.artifact!.digestB64!, one); proofFiles.add(f); }
    }
    if (proofs.size > 0 && !(files.length === 1 && proofFiles.size === 0)) {
      await takePairing(proofs, files.filter((f) => !proofFiles.has(f)));
      return;
    }
    // A batch's tree in the drop turns this into a batch check, whatever else came with it.
    for (const f of files) {
      if (!/\.json$/i.test(f.name) || f.size < 64) continue;
      const tree = treeOf(f, new Uint8Array(await f.arrayBuffer()));
      if (tree) { await takeBatch(files, tree, f); return; }
    }
    // A hash list (shasum -a 256 output) dropped on Make: the files are already hashed, so the tree is built from the
    // list and no file is opened (2026-10-21: a million files, already hashed).
    if (mode === "make" && files.length === 1 && /\.(sha256|sha256sum|sha|txt)$/i.test(files[0]!.name) && files[0]!.size <= 200_000_000) {
      const list = parseDigestList(await files[0]!.text());
      if (list) { await takePlugins([], list); return; }
    }
    // Making, and more than one file (no proofs or tree among them, those are checks above): one tree, one BitGraph.
    // Making: every drop is bound at once, one file or many, as one tree and one BitGraph. One file that already has a
    // BitGraph opens its proof instead (takePlugins). A lone proof file opens the proof it belongs to.
    if (mode === "make" && !(files.length === 1 && proofFileOf(files[0]!, new Uint8Array(await files[0]!.arrayBuffer())))) { await takePlugins(files); return; }
    if (files.length > MAX_FILES) { await takeMany(files); return; }
    setBulk(null);
    const picked = files.slice(0, MAX_FILES);
    const single = picked.length === 1;
    const fresh: Row[] = picked.map((f, i) => ({ key: `${Date.now()}-${i}-${f.name}`, name: f.name, size: f.size, state: "hashing" }));
    setRows(single ? [] : fresh);
    if (single) setStatus("Checking…");
    const originals: Array<{ f: File; photoDigestB64: string; name: string }> = [];
    const ended: Row[] = await Promise.all(picked.map(async (f, i): Promise<Row> => {
      const row = fresh[i]!;
      const end = (p: Partial<Row>) => { patch(row.key, p); return { ...row, ...p } as Row; };
      try {
        const bytes = new Uint8Array(await f.arrayBuffer());
        const asProof = proofFileOf(f, bytes);
        if (asProof) return end({ state: "found", proof: asProof, digestB64: asProof.artifact!.digestB64!, isProofFile: true });
        const digestB64 = b64(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
        // A photo may be a copy of a recorded original (lib/trustmark/check): that read starts now, beside the ledger
        // lookup, and is waited for only if the lookup finds nothing. Early only for one file: started for many at
        // once, every photo would be decoded together.
        // read from the photo decoded at the reading size, never whole: a large photo whole is hundreds of MB
        // one picture also gets the search inside a framed screenshot; many at once would be a lookup per rectangle each
        const readLooks = () => photoRead(() => decodeForReading(f).then((img) => (img ? judgeLooks(img, { search: single }) : null))).catch(() => null);
        const early = looksLikePhoto(f) && single ? readLooks() : null;
        patch(row.key, { bytes, digestB64, state: "looking" });
        const res = await fetch(`/api/proofs/${toUrlSafe(digestB64)}`);
        if (!res.ok) return end({ bytes, digestB64, state: "error", note: "Could not check the ledger just now. Try again in a moment." });
        const body = (await res.json()) as { proofs?: Array<{ proof: Proof; writeTime?: number | null }> };
        // the file's first BitGraph, the one that counts; any later ones are listed on its proof page
        const first = earliestOf(body.proofs ?? []);
        if (!first) {
          // Not a BitGraph of its own: perhaps a file of a tree, found by its sealed entry and proven here.
          const inTree = await findInTree(bytes).catch(() => null);
          if (inTree) return end({ bytes, digestB64, state: "in-tree", tree: inTree });
          // Not on record by its bytes: a photo may still be a copy (recompressed, cropped, screenshotted) of a recorded
          // original, found by what it looks like. A check says so. Make records it all the same (recording only says
          // these bytes existed by then) and its proof page says whose copy it is. Not finding one never makes a photo
          // an original: a copy can differ too much to be found.
          if (looksLikePhoto(f)) {
            if (single) setStatus("Checking the ledger…");
            const v = await (early ?? readLooks());
            if (v?.verdict === "match" && mode === "check" && !single) return end({ bytes, digestB64, state: "copy", looks: v });
            if (v?.verdict === "match") {
              const o = v.original, href = `/proof/${toUrlSafe(o.photoDigestB64)}?counter=${encodeURIComponent(String(o.counter))}&epoch=${encodeURIComponent(toUrlSafe(o.epochId))}`;
              // One copy dropped on Make leads to its original, the earliest known recording, instead of being recorded.
              // (Not finding one says nothing, so those are recorded.)
              // Several recorded originals look like it (a picture exported twice): the earliest opens, and its page offers the rest.
              if (single) {
                if (opensAlone(v)) {
                  noteDroppedCopy(toUrlSafe(o.photoDigestB64), v.score);
                  // the copy itself opens in the original's file pane, labelled as a copy (lib/trustmark/held-copy)
                  setHeldCopy(toUrlSafe(o.photoDigestB64), { name: f.name, data: bytes.slice().buffer as ArrayBuffer, kind: "copy", score: v.score, found: o, others: v.others.map((m) => m.original) });
                  setStatus("Opening the original…");
                  router.push(href);
                }
                return end({ bytes, digestB64, state: "copy", looks: v });
              }
              noteCopyOf(toUrlSafe(digestB64), { counter: o.counter, href });
            }
            // the ledger could not be asked: said so, never read as "not a copy" (on Make, one file is not recorded blind)
            if (v?.verdict === "unavailable" && (mode === "check" || single)) return end({ bytes, digestB64, state: "error", note: "Could not check the ledger just now. Try again in a moment." });
            // 8. a picture this browser cannot decode (HEIC outside Safari, say) is said, not passed off as not a copy
            if (v === null && mode === "check" && !(await decodeForReading(f).catch(() => null))) return end({ bytes, digestB64, state: "error", note: "This browser cannot decode this image, so it could not be matched by its looks. Try Safari for HEIC, or drop a JPEG of it." });
          }
          return end({ bytes, digestB64, state: "new" });
        }
        // an original in hand: its record goes to the find index, so a copy of it can lead here (after the drop, never waited for)
        if (looksLikePhoto(f)) originals.push({ f, photoDigestB64: digestB64, name: f.name });
        return end({ bytes, digestB64, state: "found", proof: first, valid: await check(first, bytes) });
      } catch {
        return end({ state: "error", note: "This browser could not read or check that file." });
      }
    }));
    if (originals.length) void publishFoundRecords(originals).catch(() => {});
    // A file of the tree this page just made is that tree's, even before its index is written: it is shown in the tree,
    // never made again (2026-10-20: a file of a 50,000-file tree was re-recorded instead of checked).
    const pt = plugRef.current;
    const inPageTree = (d: string) => (pt?.tree && pt.b.commit?.counter && pt.b.commit?.epochId ? pt.tree.leaves.findIndex((l) => l[2] === d) : -1);
    const ended2: Row[] = ended.map((r) => {
      if (r.state !== "new" || !r.digestB64) return r;
      const i = inPageTree(r.digestB64);
      if (i < 0) return r;
      const p = { state: "in-tree" as const, tree: { files: pt!.tree!.files, leafIndex: i, name: pt!.tree!.leaves[i]![0], proof: { epochId: String(pt!.b.commit!.epochId), counter: String(pt!.b.commit!.counter), digestB64: pt!.contentDigest, proofHash: String(pt!.b.proofHash ?? "") } } };
      patch(r.key, p);
      return { ...r, ...p };
    });
    // Several photos checked: each that leads to a proof, its own first BitGraph, the original's for a copy, or its tree's
    if (!single) {
      setChecked(galleryOfFound(ended2.flatMap((r, k): Found[] => {
        const f = picked[k]!;
        if (!looksLikePhoto(f) || !r.digestB64) return [];
        if (r.state === "found" && r.proof && !r.isProofFile) { const x = foundOriginal(f, r.digestB64, r.proof); return x ? [x] : []; }
        if (r.state === "copy" && r.looks?.verdict === "match" && r.bytes) {
          const v = r.looks, o = v.original, bytes = r.bytes;
          const item = { digest: o.photoDigestB64, name: f.name, counter: String(o.counter), epochId: String(o.epochId) };
          return [{ file: f, item, prepare: async () => setHeldCopy(toUrlSafe(o.photoDigestB64), { name: f.name, data: bytes.slice().buffer as ArrayBuffer, kind: "copy", score: v.score, found: o, others: v.others.map((x) => x.original) }) }];
        }
        if (r.state === "in-tree" && r.tree) return [{ file: f, item: { digest: r.tree.proof.digestB64, name: f.name, counter: r.tree.proof.counter, epochId: r.tree.proof.epochId }, prepare: async () => {} }];
        return [];
      })));
    }
    if (single && ended2[0]?.state === "copy" && ended2[0]?.looks?.verdict === "match") {
      // led to its original; or, with several originals, listed them (the row stays, nothing is recorded)
      if (!opensAlone(ended2[0].looks)) { setRows(ended2); setStatus(null); }
      return;
    }
    if (single && (ended2[0]?.state === "in-tree" || ended2[0]?.state === "copy")) { setRows(ended2); setStatus(null); return; }
    const fresh_new = ended2.filter((r) => r.state === "new" && r.digestB64);
    // A new file is made the one way every drop is: a tree with the Base block as its floor (2026-10-20).
    if (mode === "make" && single && fresh_new.length === 1) { await takePlugins([picked[0]!]); return; }
    if (single && mode === "make" && fresh_new.length) setStatus("Making the BitGraph…");
    const made = mode === "make" ? await makeRows(fresh_new) : [];
    const final = ended2.map((r) => made.find((x) => x.key === r.key) ?? r);
    const one = single ? final[0]! : null;
    if (one && one.proof && one.digestB64) {
      setStatus("Opening the proof…");
      // Hand the file to the proof page (the browser-local cache it watches, keyed by the file's SHA-256), so the
      // page opens with the file already checked against the proof. Never for a dropped proof file: it has no file.
      if (!one.isProofFile) {
        try { await Promise.race([cacheArtifactToIDB(picked[0]!, one.digestB64), new Promise((r) => setTimeout(r, 3000))]); } catch { /* the page still opens; the reader can drop the file there */ }
      }
      // A BitGraph made just now opens with the circle check (?fresh=1, the signal the proof page and the old drop
      // flow use), pinned to its own counter and epoch so the page shows this binding.
      const commit = one.proof?.commit as { counter?: string; epochId?: string } | undefined;
      const epoch = commit?.epochId ? toUrlSafe(commit.epochId) : "";
      const sel = commit?.counter ? `?counter=${encodeURIComponent(commit.counter)}${epoch ? `&epoch=${encodeURIComponent(epoch)}` : ""}` : "";
      const fresh = one.state === "made" ? `${sel ? `${sel}&` : "?"}fresh=1` : sel;
      // Seed the proof page with the proof in hand (lib/fresh-proof, as the old drop flow did): it paints at once,
      // and a BitGraph made a second ago does not wait on the ledger's index.
      if (!one.isProofFile) setFreshProof(toUrlSafe(one.digestB64), { proofs: [{ proof: one.proof }], positions: commit?.counter ? [{ counter: commit.counter, epoch: epoch || null, lowerTime: null, upperTime: null }] : [], causalWindow: null, anchorBlock: null });
      router.push(`/proof/${toUrlSafe(one.digestB64)}${fresh}`);
      return;
    }
    if (single) { setStatus(null); setRows(final); }
  }, [mode, router, takeMany, takeBatch, takePairing, takePlugins]);

  const make = async () => { await makeRows(rows.filter((r) => r.state === "new" && r.digestB64)); };

  const download = (r: Row) => {
    if (!r.proof) return;
    const blob = new Blob([JSON.stringify(r.proof, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${r.name}.bitgraph.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const newCount = rows.filter((r) => r.state === "new").length;

  return (
    <div>
      {variant === "buttons" && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <button type="button" className="bg-action-link" style={{ margin: 0 }} onClick={() => inputRef.current?.click()}>Search by file</button>
          <button type="button" className="bg-action-link" style={{ margin: 0 }} onClick={() => folderRef.current?.click()}>Search by folder</button>
          {status && <span className="db-zone-sub" style={{ margin: 0 }}>{status}</span>}
          {status && <span className="bg-working is-left" style={{ margin: 0, display: "inline-block", width: 80 }} role="progressbar" aria-label={status} />}
          <input ref={inputRef} type="file" multiple style={{ display: "none" }} onChange={(e) => { void take(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
          {/* @ts-expect-error webkitdirectory is a non-standard attribute every current browser supports */}
          <input ref={folderRef} type="file" webkitdirectory="" multiple style={{ display: "none" }} onChange={(e) => { void take(Array.from(e.target.files ?? []).filter((f) => !f.name.startsWith("."))); e.target.value = ""; }} />
        </div>
      )}
      {variant === "zone" && <div
        role="button"
        tabIndex={0}
        aria-label={mode === "check" ? "Drop files to check them, or press to choose files" : "Drop files to make BitGraphs, or press to choose files"}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inputRef.current?.click(); } }}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); const dt = e.dataTransfer; setStatus("Reading the drop…"); void filesOfDrop(dt, setStatus).then((fs) => { if (fs.length === 0) { setStatus(null); return; } return take(fs); }).catch((err: unknown) => { setStatus(null); setPlugError(`Could not read the drop: ${err instanceof Error && err.message ? err.message : String(err)}. Try choosing the folder instead.`); }); }}
        className="db-zone"
        data-over={over ? "1" : undefined}
      >
        {/* The old drop prompt's two sheets (components/drop-prompt.tsx), back in the box (2026-10-18). */}
        <svg className="db-zone-icon" width="44" height="44" viewBox="0 0 44 44" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
          <path d="M16 12V8a3 3 0 0 1 3-3h11l8 8v17a3 3 0 0 1-3 3h-4" />
          <path d="M30 5v8h8" />
          <path d="M9 12h12l7 7v17a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3V15a3 3 0 0 1 3-3Z" />
          <path d="M21 12v7h7" />
        </svg>
        {/* With a plugin on, the box says what a drop will do (2026-10-18), instead of an explanation beside the switch. */}
        {/* A folder can be chosen as a folder (2026-10-21): the file picker only opened it, and every file then had to be selected. */}
        {/* A touch screen cannot drop a file or choose a folder: there the box only offers to choose files, and the
            whole box is the tap (globals.css, .db-zone-touch). */}
        <div className="db-zone-title">{status ?? <>
          <span className="db-zone-desk">{mode === "check" ? "Drop files here to check them, or choose" : "Drop files or a folder here, or choose"}{" "}
              <button type="button" className="db-zone-pick" onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}>files</button>
              {" · "}
              <button type="button" className="db-zone-pick" onClick={(e) => { e.stopPropagation(); folderRef.current?.click(); }}>a folder</button></span>
          <span className="db-zone-touch"><span className="db-zone-pick">Choose files</span>{mode === "check" ? " to check" : " to BitGraph"}</span></>}</div>
        {/* Something is happening: a thin moving bar under the line that says what (2026-10-18). */}
        {status && <div className="bg-working" role="progressbar" aria-label={status} />}
        <div className="db-zone-sub">Each file is hashed in your browser. <br className="sub-br" />Only its SHA-256 is&nbsp;sent.</div>
        <input ref={inputRef} type="file" multiple style={{ display: "none" }} onChange={(e) => { void take(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
        {/* @ts-expect-error webkitdirectory is a non-standard attribute every current browser supports */}
        <input ref={folderRef} type="file" webkitdirectory="" multiple style={{ display: "none" }} onChange={(e) => { void take(Array.from(e.target.files ?? []).filter((f) => !f.name.startsWith("."))); e.target.value = ""; }} />
      </div>}

      {plugError && <div className="db-reveal"><div><div className="db-rows"><div className="db-row"><div className="db-state"><span className="db-bad">{plugError}</span></div></div></div></div></div>}
      {/* The result, plainly (2026-10-18: the first version was cluttered): one row per BitGraph, a name and
          number, one quiet line under it, one link to its proof; the download lined up with the rows. It eases open. */}
      {plug && (<div className="db-reveal" key={String(plug.b.commit?.counter ?? "")}><div>
        <div className="plug-result">
          {plug.a && plug.block && (
            <div className="plug-row">
              <div>
                <div className="plug-title">BitGraph 1 <span className="plug-num">#{Number(plug.a.commit?.counter).toLocaleString("en-US")}</span></div>
                <div className="plug-sub">Base block <a href={`https://basescan.org/block/${plug.block.number}`} target="_blank" rel="noreferrer">{plug.block.number.toLocaleString("en-US")}</a></div>
              </div>
              <a className="bg-action-link plug-open" style={{ margin: 0, flex: "none" }} href={`/proof/${toUrlSafe(plug.a.artifact!.digestB64!)}?counter=${plug.a.commit?.counter}`} {...(plug.lookup && (plug.lookup.state === "saving" || plug.lookup.state === "sealing") ? { target: "_blank", rel: "noopener" } : {})}>View proof</a>
            </div>
          )}
          <div className="plug-row">
            <div>
              <div className="plug-title">{plug.a ? "BitGraph 2" : "BitGraph"} <span className="plug-num">#{Number(plug.b.commit?.counter).toLocaleString("en-US")}</span></div>
              <div className="plug-sub">
                {plug.tree ? `Tree of ${plug.tree.files.toLocaleString("en-US")}` : plug.contentName}
                {plug.ceiling === "waiting" && " · waiting for Base"}
                {plug.ceiling === "written" && " · written to Base"}
              </div>
            </div>
            <a className="bg-action-link plug-open" style={{ margin: 0, flex: "none" }} href={`/proof/${toUrlSafe(plug.contentDigest)}?counter=${plug.b.commit?.counter}`} {...(plug.lookup && (plug.lookup.state === "saving" || plug.lookup.state === "sealing") ? { target: "_blank", rel: "noopener" } : {})}>View proof</a>
          </div>
          {plug.already && (
            <div className="plug-row"><div className="plug-sub">This tree already has its BitGraph, so nothing new was bound. Its index is being finished.</div></div>
          )}
          {plug.lookup && (
            <div className="plug-row">
              <div className="plug-sub">
                {plug.lookup.state === "sealing" && "Indexing each file under its own hash…"}
                {plug.lookup.state === "saving" && `Indexing each file under its own hash: ${plug.lookup.stored.toLocaleString("en-US")} of ${plug.lookup.total.toLocaleString("en-US")}…`}
                {plug.lookup.state === "done" && `Each of the ${plug.lookup.total.toLocaleString("en-US")} files now looks up by its own hash, like a file made alone.`}
                {plug.lookup.state === "failed" && `Files dropped later may not find this tree: ${plug.lookup.note ?? "the entries could not be saved"}. The tree's own files still check it.`}
              </div>
            </div>
          )}
          {timer && plug.ms && (
            <div className="plug-row">
              <div className="plug-sub">
                {plug.tree ? `${plug.fromList ? "Read" : "Hashed"} ${plug.tree.files.toLocaleString("en-US")} ${plug.fromList ? "hashes" : "files"} in ${(plug.ms.hash / 1000).toFixed(2)} s · ` : ""}
                {plug.a ? "Two BitGraphs" : "BitGraph"} made in {(plug.ms.bind / 1000).toFixed(2)} s · drop to proof {(plug.ms.total / 1000).toFixed(2)} s
              </div>
            </div>
          )}
          {plug.gallery && <div className="plug-row plug-gallery"><DropGallery g={plug.gallery} /></div>}
          <div className="plug-foot">
            <button type="button" className="bg-action-link" style={{ margin: 0 }} onClick={downloadPlug}>Download everything</button>
          </div>
        </div>
      </div></div>)}

      {pairing && (
        <div className="db-rows">
          <div className="db-row">
            <div className="db-name"><span>{pairing.proofs.toLocaleString("en-US")} proofs</span>{pairing.files > 0 && <span className="db-size">{pairing.files.toLocaleString("en-US")} files</span>}</div>
            <div className="db-state">
              {pairing.files === 0
                ? <>Proofs only. Drop them with their files to check each one.</>
                : <>
                    <span className={pairing.invalid ? "db-bad" : "db-ok"}>{pairing.valid.toLocaleString("en-US")} paired and checked in this browser</span>
                    {pairing.invalid ? <span className="db-bad">, {pairing.invalid.toLocaleString("en-US")} did not check</span> : null}
                    {pairing.noProof ? `, ${pairing.noProof.toLocaleString("en-US")} ${pairing.noProof === 1 ? "file" : "files"} with no proof here` : ""}
                    {pairing.done && pairing.unusedProofs ? `, ${pairing.unusedProofs.toLocaleString("en-US")} ${pairing.unusedProofs === 1 ? "proof" : "proofs"} with no file` : ""}
                    {pairing.done ? "" : "…"}
                  </>}
            </div>
          </div>
        </div>
      )}

      {batch && (
        <div className="db-rows">
          <div className="db-row">
            <div className="db-name"><span>Batch root</span><span className="db-size">{batch.total.toLocaleString("en-US")} files</span></div>
            <div className="db-state">
              {batch.rootState === "absent" && <>Add the batch&rsquo;s merkle-root.txt to check that the root is a BitGraph.</>}
              {batch.rootState === "mismatch" && <span className="db-bad">merkle-root.txt does not carry this tree&rsquo;s root</span>}
              {batch.rootState === "looking" && "Checking the ledger…"}
              {batch.rootState === "missing" && <>{batch.rootFile} is not a BitGraph yet</>}
              {batch.rootState === "found" && batch.rootDigest && (
                <>
                  <span className="db-ok">{batch.rootFile} is BitGraph #{Number((batch.rootProof?.commit as { counter?: string } | undefined)?.counter ?? 0).toLocaleString("en-US")}</span>
                  <a href={`/proof/${toUrlSafe(batch.rootDigest)}`}>Proof</a>
                </>
              )}
            </div>
          </div>
          {batch.rows.length === 0 && <div className="db-row"><div className="db-state">Add one or more files from the batch to check them.</div></div>}
          {batch.rows.map((r) => (
            <div key={r.name} className="db-row">
              <div className="db-name"><span>{r.name}</span></div>
              <div className="db-state">
                {r.index !== null
                  ? <span className={batch.rootState === "found" ? "db-ok" : undefined}>In the batch (file {(r.index + 1).toLocaleString("en-US")} of {batch.total.toLocaleString("en-US")}){batch.rootState === "found" ? ", under that BitGraph" : ""}</span>
                  : <span className="db-bad">Not in this batch</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {bulk && (
        <div className="db-rows">
          <div className="db-row">
            <div className="db-name"><span>{bulk.total.toLocaleString("en-US")} files</span></div>
            <div className="db-state">
              {mode === "make"
                ? <>{bulk.found ? `${bulk.found.toLocaleString("en-US")} already BitGraphs, ` : ""}{bulk.made.toLocaleString("en-US")} made{bulk.failed ? `, ${bulk.failed.toLocaleString("en-US")} could not be checked or made` : ""}{bulk.done ? "" : "…"}{timer ? ` in ${(bulk.ms / 1000).toFixed(2)} s${bulk.done && bulk.made ? ` (${(bulk.made / (bulk.ms / 1000)).toFixed(1)} per second)` : ""}` : ""}</>
                : <>{bulk.found.toLocaleString("en-US")} are BitGraphs, {bulk.missing.toLocaleString("en-US")} are not{bulk.failed ? `, ${bulk.failed.toLocaleString("en-US")} could not be checked` : ""}{bulk.done ? "" : "…"}</>}
            </div>
          </div>
          {bulk.done && bulk.proofs.length > 0 && (
            <div className="db-row">
              <div className="db-state">
                <button type="button" className="db-link" onClick={downloadAll}>Download all {bulk.proofs.length.toLocaleString("en-US")} proofs</button>
                <a href="/ledger">See them on the ledger</a>
              </div>
            </div>
          )}
          {/* the files not on record yet, made as one drop is (a tree on the Base floor, photos with their fingerprints) */}
          {bulk.done && mode === "check" && canMake && bulkNew.length > 0 && (
            <div className="db-make">
              <button type="button" className="bg-action-link is-make" style={{ margin: 0 }} disabled={busy} onClick={() => { const fs = bulkNew; setBulk(null); setBulkNew([]); void takePlugins(fs); }}>
                {busy ? "Making…" : bulkNew.length === 1 ? (bulk.found ? "Make a BitGraph of the other file" : "Make a BitGraph") : `Make one BitGraph of ${bulk.found ? "the other" : "all"} ${bulkNew.length.toLocaleString("en-US")}`}
              </button>
            </div>
          )}
        </div>
      )}

      {checked && (rows.length > 0 || bulk) && <div className="plug-result"><div className="plug-row plug-gallery"><DropGallery g={checked} /></div></div>}
      {rows.length > 0 && (
        <div className="db-rows">
          {rows.map((r) => (
            <div key={r.key} className="db-row">
              <div className="db-name">
                <span>{r.name}</span>
                <span className="db-size">{sizeLabel(r.size)}</span>
              </div>
              <div className="db-state">
                {r.state === "hashing" && "Hashing…"}
                {r.state === "looking" && "Checking the ledger…"}
                {r.state === "new" && mode === "check" && "Not a BitGraph yet"}
                {r.state === "new" && mode === "make" && (r.note ?? "Not a BitGraph yet")}
                {r.state === "in-tree" && r.tree && (
                  <>
                    <span className="db-ok">In a tree of {r.tree.files.toLocaleString("en-US")} files (file {(r.tree.leafIndex + 1).toLocaleString("en-US")}), checked in this browser</span>
                    {/* Two clear buttons (2026-10-20): see the tree's BitGraph, or record this file on its own. */}
                    <span className="db-row-actions">
                      <a className="bg-action-link is-make" style={{ margin: 0 }} href={`/proof/${toUrlSafe(r.tree.proof.digestB64)}?counter=${encodeURIComponent(r.tree.proof.counter)}`}>View BitGraph #{Number(r.tree.proof.counter).toLocaleString("en-US")}</a>
                      {(mode === "make" || canMake) && <button type="button" className="bg-action-link" style={{ margin: 0 }} onClick={() => void takePlugins([new File([r.bytes!.slice()], r.name)])}>Make a new BitGraph</button>}
                    </span>
                  </>
                )}
                {r.state === "copy" && r.looks && <LooksLine v={r.looks} copy={r.bytes ? { name: r.name, data: r.bytes } : null} />}
                {r.state === "making" && "Binding…"}
                {r.state === "error" && r.note}
                {(r.state === "found" || r.state === "made") && r.proof && (
                  <>
                    <span className={r.valid || r.isProofFile ? "db-ok" : "db-bad"}>
                      {r.state === "made" ? "Made" : "A BitGraph"}
                      {r.isProofFile ? ": this is its proof file" : r.valid ? ", checked in this browser" : ", but the proof did not check against this file"}
                    </span>
                    {teeTime(r.proof) && <span className="db-size">{teeTime(r.proof)}, enclave time</span>}
                    <a href={`/proof/${toUrlSafe(r.digestB64 ?? "")}`}>Proof</a>
                    <button type="button" className="db-link" onClick={() => download(r)}>Download proof</button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {(mode === "make" || canMake) && newCount > 0 && (
        <div className="db-make">
          {/* On Proofs the new files are made as one drop is (a tree on the Base floor, photos with their fingerprints) */}
          <button type="button" className="bg-action-link is-make" style={{ margin: 0 }} disabled={busy} onClick={() => void (mode === "make" ? make() : takePlugins(rows.filter((r) => r.state === "new" && r.bytes).map((r) => new File([r.bytes!.slice()], r.name))))}>
            {busy ? "Making…" : newCount === 1 ? "Make a BitGraph" : mode === "make" ? `Make ${newCount} BitGraphs` : `Make one BitGraph of these ${newCount}`}
          </button>
        </div>
      )}
    </div>
  );
}
