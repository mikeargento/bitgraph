"use client";

// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * The drop box (Mike, 2026-10-17: "wheres the dropbox? there should be a
 * checker and a maker right?"). Drop files; each is hashed HERE, in the
 * browser, and only its SHA-256 ever leaves the machine.
 *
 *   Checker: every file is looked up by its hash. A file that is already a
 *   BitGraph gets its proof verified in this browser against the file's own
 *   bytes, and a link to its proof page.
 *   Maker: on /make, files that are not yet BitGraphs are made at once when
 *   dropped (Mike, 2026-10-17: "dropping bitgraph in should just do it"): one
 *   atomic action in the enclave each (a fresh nonce, then the file's digest).
 *   One file lands on its proof page.
 *   Each result shows the enclave's own signed time.
 *
 * A lookup that fails is "could not check", never "not a BitGraph"
 * (project_ledger_read_honesty).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { verifyAttested, createVerificationContext } from "@mikeargento/bitgraph-verify";
import { recordedMsOf } from "@/lib/recorded-time";
import { cacheArtifactToIDB } from "@/lib/file-cache";
import { setFreshProof } from "@/lib/fresh-proof";
import { useRouter } from "next/navigation";
import { zipSync, strToU8 } from "fflate";
import { attachEnvironments } from "@/lib/proof-environment";
import { findInTree, postTreeEntries, sealTreeEntries, type FoundInTree } from "@/lib/tree-entries";
import { bindOne, buildTree, digestOf, latestBaseBlock, type BaseBlock, type MerkleTree as PluginTree } from "@/lib/plugins";

const MAX_FILES = 25;

type Proof = Record<string, unknown> & { commit?: { counter?: string; atomic?: boolean; epochId?: string }; artifact?: { digestB64?: string } };

type Row = {
  key: string;
  name: string;
  size: number;
  digestB64?: string;
  bytes?: Uint8Array;
  state: "hashing" | "looking" | "found" | "in-tree" | "new" | "making" | "made" | "error";
  /** The file is a member of a tree made on the Make page, proven here (lib/tree-entries.ts). */
  tree?: FoundInTree;
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

/** Every file in a drop, folders opened all the way down (Mike, 2026-10-17: a folder of 10,000 files). The walk lists
 *  entries first and then opens up to 64 files at once, reporting as it goes: a 100,000-file folder read one file at a
 *  time, with nothing on screen, looked like a dead page (Mike, 2026-10-18). */
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
  await pool(found, 64, async (fe, k) => {
    out[k] = await new Promise<File>((res, rej) => fe.file(res, rej));
    opened++;
    tell(`Opening ${opened.toLocaleString("en-US")} of ${found.length.toLocaleString("en-US")} files…`, opened);
  });
  return out;
}

/** Run `fn` over `items` with at most `n` at once. */
async function pool<T>(items: T[], n: number, fn: (x: T, i: number) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    for (;;) { const i = next++; if (i >= items.length) return; await fn(items[i]!, i); }
  }));
}

/* ── A batch: files under one Merkle root (the tool at ~/Desktop/merkle-tool, RFC 6962, outside BitGraph). Drop a
   file (or several) with the batch's merkle-tree.json and merkle-root.txt: each file is walked up the tree to the
   root here, in the browser; the root must match merkle-root.txt; merkle-root.txt is looked up as a BitGraph
   (Mike, 2026-10-17: "so i drop a file and the merkle txt and the merkle json"). ── */
type MerkleTree = { format: "rfc6962-sha256"; files: number; root: string; leaves: Array<[string, string]>; levels: string[][] };
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
    return o.format === "rfc6962-sha256" && Array.isArray(o.leaves) && Array.isArray(o.levels) && typeof o.root === "string" ? (o as MerkleTree) : null;
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

async function check(proof: Proof, bytes: Uint8Array): Promise<boolean> {
  const { proofHash: _h, ...p } = proof as Proof & { proofHash?: unknown };
  try {
    // The full check (2026-10-18 audit): signature and counts AND the AWS Nitro attestation, pinned to BitGraph's
    // published images. A signature alone is checked against the key the proof carries, which anyone can make.
    const r = await verifyAttested({ proof: p as never, bytes, context: createVerificationContext() });
    return r.valid === true;
  } catch {
    return false;
  }
}

/** One plugin: its name and an iOS-style switch, nothing else (Mike, 2026-10-18: the i "its just messy", "remove hover"). */
function PluginSwitch({ label, on, set, disabled }: { label: string; on: boolean; set: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="db-switch-row" data-on={on ? "1" : undefined}>
      <span className="db-switch-label" onClick={() => !disabled && set(!on)}>{label}</span>
      {/* The switch at the row's right end, as in iOS Settings (Mike, 2026-10-18: "put them on right"). */}
      <button type="button" role="switch" aria-checked={on} aria-label={label} className="db-switch" data-on={on ? "1" : undefined} disabled={disabled} onClick={() => set(!on)}>
        <span className="db-switch-knob" />
      </button>
    </div>
  );
}

/** mode "check" only looks files up and never makes anything (the ledger page); "make" looks them up, then
 *  offers to make the ones that are new (/make). */
export function DropBox({ mode = "make", variant = "zone" }: { mode?: "make" | "check"; variant?: "zone" | "buttons" }) {
  // The drop box on /make makes and checks (Mike, 2026-10-17: "shouldnt the dropbox do both"). The ledger's search
  // (mode "check", variant "buttons": two Finder buttons, no box) only looks files up and never makes one.
  const [rows, setRows] = useState<Row[]>([]);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  /** One file at a time shows a single line in the box instead of a row list (Mike, 2026-10-17: it "jumps"). */
  const [status, setStatus] = useState<string | null>(null);
  /** ?timer on the page's address shows the elapsed time of a big drop, live and final (Mike, 2026-10-17: a speed test). */
  const [timer, setTimer] = useState(false);
  useEffect(() => { try { setTimer(new URLSearchParams(window.location.search).has("timer")); } catch { /* no timer */ } }, []);
  /** A big drop (more than MAX_FILES): counts and the proofs, never one row per file. */
  /** Proof files dropped with originals: each original paired with its proof by hash and checked here. */
  const [pairing, setPairing] = useState<{ proofs: number; files: number; valid: number; invalid: number; noProof: number; unusedProofs: number; done: boolean } | null>(null);
  const [batch, setBatch] = useState<{ root: string; total: number; rootFile: string | null; rootProof: Proof | null; rootDigest: string | null; rootState: "looking" | "found" | "missing" | "mismatch" | "absent"; rows: Array<{ name: string; index: number | null }> } | null>(null);
  const [bulk, setBulk] = useState<{ total: number; made: number; found: number; missing: number; failed: number; done: boolean; proofs: Proof[]; ms: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  /* Plugins (Mike, 2026-10-18: "toggles at the top in the section where you make a bitgraph"): off by default; both
     sit on the plain bind (lib/plugins.ts). */
  const [treeOn, setTreeOn] = useState(false);
  const [baseOn, setBaseOn] = useState(false);
  const [plugError, setPlugError] = useState<string | null>(null);
  const [plug, setPlug] = useState<{
    tree: PluginTree | null; rootText: string | null; contentName: string; contentDigest: string; b: Proof & { proofHash?: string };
    block: BaseBlock | null; blockBytes: Uint8Array | null; a: (Proof & { proofHash?: string }) | null; ceiling: "waiting" | "written" | null; ceilingInfo: string | null;
    /** With ?timer: milliseconds spent hashing (the tree) and binding, from the drop to the proof. */
    ms?: { hash: number; bind: number; total: number };
    /** A tree's sealed lookup entries, one per file, so a file dropped later finds this tree. */
    lookup?: { stored: number; total: number; state: "sealing" | "saving" | "done" | "failed"; note?: string };
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
        const note = res.status === 503 ? "The enclave is restarting (it does once a day). Try again in a minute." : "The BitGraph could not be made just now. Nothing was recorded.";
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
      for (const r of todo) end(r, { state: "error", note: "The request did not finish. Look the file up on the ledger before trying again: it may already be recorded." });
    } finally {
      setBusy(false);
    }
    return out;
  };

  /* A drop just does it (Mike, 2026-10-17: "dropping bitgraph in should just do it ... and open proof page"):
     every file is looked up; on /make the new ones are made at once; one file lands on its proof page. A dropped
     proof file (a .bitgraph.json) opens the proof it belongs to, and is never itself made into a BitGraph. */
  /* A big drop: hash everything here, then bind in batches of 50 (make) or look each up (check). Rate limits are
     waited out, never treated as failures; the enclave's daily restart (503) is waited out too. */
  const takeMany = useCallback(async (files: File[]) => {
    setRows([]); setStatus(null);
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
    {
      let looked = 0;
      // One request per 2,000 files, three at a time (Mike, 2026-10-18: a 10,000 file drop "takes quite a bit to
      // check"): the batch route rules new files out from its digest index without reading the ledger, where one
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
            const first = r?.proofs?.[0]?.proof;
            if (!r || r.unavailable) { st.failed++; unknown.add(d); } else if (first) { st.found++; st.proofs.push(first); } else st.missing++;
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
  }, [mode]);

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
      const leaf = hex(await sha256(new Uint8Array([0]), new Uint8Array(await f.arrayBuffer())));
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
     (Mike, 2026-10-17: the grouped JSON "doesnt function as a proof. it wants to read it again"). */
  const takePairing = useCallback(async (proofs: Map<string, Proof>, originals: File[]) => {
    setRows([]); setBulk(null); setBatch(null);
    const st = { proofs: proofs.size, files: originals.length, valid: 0, invalid: 0, noProof: 0, unusedProofs: 0, done: false };
    const show = () => setPairing({ ...st });
    show();
    const used = new Set<string>();
    let n = 0;
    await pool(originals, 8, async (f) => {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const d = b64(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
      const p = proofs.get(d);
      if (!p) st.noProof++;
      else { used.add(d); if (await check(p, bytes)) st.valid++; else st.invalid++; }
      n++;
      if (n % 50 === 0 || n === originals.length) { setStatus(`Checked ${n.toLocaleString("en-US")} of ${originals.length.toLocaleString("en-US")}…`); show(); }
    });
    st.unusedProofs = proofs.size - used.size;
    st.done = true; setStatus(null); show();
  }, []);

  const takePlugins = useCallback(async (files: File[]) => {
    setRows([]); setBulk(null); setBatch(null); setPairing(null); setPlug(null); setPlugError(null); setBusy(true);
    // ?timer times the run from the drop to the proof (Mike, 2026-10-18: time the 100,000-file tree).
    const t0 = performance.now();
    const secs = () => ((performance.now() - t0) / 1000).toFixed(1);
    try {
      // Many files with Base on become one tree inside the window, without a second switch (Mike, 2026-10-18).
      const asTree = treeOn || files.length > 1;
      let tree: PluginTree | null = null, rootText: string | null = null, contentName: string, contentBytes: Uint8Array;
      if (asTree) {
        setStatus(`Hashing 0 of ${files.length.toLocaleString("en-US")}…`);
        const t = await buildTree(files, (n) => setStatus(`Hashing ${n.toLocaleString("en-US")} of ${files.length.toLocaleString("en-US")}…${timer ? ` ${secs()} s` : ""}`));
        tree = t.tree; rootText = t.rootText; contentName = "merkle-root.txt"; contentBytes = new TextEncoder().encode(t.rootText);
      } else { contentName = files[0]!.name; contentBytes = new Uint8Array(await files[0]!.arrayBuffer()); }
      const tHashed = performance.now();
      let block: BaseBlock | null = null, blockBytes: Uint8Array | null = null, a: Proof | null = null;
      if (baseOn) {
        setStatus("Reading the latest Base block…");
        block = await latestBaseBlock();
        blockBytes = new TextEncoder().encode(JSON.stringify({ format: "bitgraph-base-floor/1", ...block, note: "BitGraph 1 of a Base window: the content in BitGraph 2 was bound after this block." }, null, 2) + "\n");
        setStatus("Making BitGraph 1: the Base block…");
        const aDigest = await digestOf(blockBytes);
        a = await bindOne(aDigest);
        void cacheArtifactToIDB(new File([blockBytes.slice()], "base-block.json", { type: "application/json" }), aDigest).catch(() => {});
      }
      setStatus(baseOn ? "Making BitGraph 2: the content…" : "Making the BitGraph…");
      const contentDigest = await digestOf(contentBytes);
      const b = await bindOne(contentDigest, { ceiling: baseOn });
      void cacheArtifactToIDB(asTree ? new File([contentBytes.slice()], contentName, { type: "text/plain" }) : files[0]!, contentDigest).catch(() => {});
      // The floor link: BitGraph 1 named as BitGraph 2's floor, checked and kept by the site (app/api/floors). The bind
      // stays two counts; the link is a record about the two (Mike, 2026-10-18).
      if (a && blockBytes) {
        const ref = (p: Proof, digestB64: string) => ({ digestB64, epochId: String(p.commit?.epochId ?? ""), counter: String(p.commit?.counter ?? "") });
        void fetch("/api/floors", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ a: ref(a, String(a.artifact?.digestB64 ?? "")), b: ref(b, contentDigest), blockFile: new TextDecoder().decode(blockBytes) }),
        }).catch(() => {});
      }
      const tDone = performance.now();
      setPlug({ tree, rootText, contentName, contentDigest, b, block, blockBytes, a, ceiling: baseOn ? "waiting" : null, ceilingInfo: null, ms: { hash: tHashed - t0, bind: tDone - tHashed, total: tDone - t0 } });
      // Every file gets a sealed entry that leads back to this tree (Mike, 2026-10-18): written after the proof is
      // shown, so the BitGraph never waits on it.
      if (tree && b.proofHash && b.commit?.counter && b.commit?.epochId) {
        const t = tree, total = t.files;
        type Lookup = { stored: number; total: number; state: "sealing" | "saving" | "done" | "failed"; note?: string };
        const lookup = (l: Lookup) => setPlug((p) => (p && p.b === b ? { ...p, lookup: l } : p));
        lookup({ stored: 0, total, state: "sealing" });
        void (async () => {
          try {
            const entries = await sealTreeEntries(t, { proofHash: b.proofHash!, epochId: String(b.commit!.epochId), counter: String(b.commit!.counter), digestB64: contentDigest });
            lookup({ stored: 0, total, state: "saving" });
            const stored = await postTreeEntries(entries, (n) => lookup({ stored: n, total, state: "saving" }));
            lookup({ stored, total, state: stored >= total ? "done" : "failed", note: stored >= total ? undefined : `${(total - stored).toLocaleString("en-US")} could not be saved` });
          } catch (e) { lookup({ stored: 0, total, state: "failed", note: (e as Error).message }); }
        })();
      }
      setStatus(null);
    } catch (e) {
      setStatus(null); setPlugError((e as Error).message);
    } finally { setBusy(false); }
  }, [treeOn, baseOn, timer]);

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
    const t = setInterval(() => { void look().then((done) => { if (done) clearInterval(t); }); }, 15000);
    void look();
    return () => { stop = true; clearInterval(t); };
  }, [plug?.ceiling, plug?.b.proofHash]);

  const downloadPlug = () => {
    if (!plug) return;
    const files: Record<string, Uint8Array> = {};
    const j = (o: unknown) => strToU8(JSON.stringify(o, null, 2) + "\n");
    const lines = ["BitGraph, made with plugins.", ""];
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
    a.href = URL.createObjectURL(blob); a.download = `bitgraph-${plug.b.commit?.counter ?? "plugins"}.zip`; a.click(); URL.revokeObjectURL(a.href);
  };

  const take = useCallback(async (files: File[]) => {
    if (mode === "make" && (treeOn || baseOn)) { await takePlugins(files); return; }
    setBatch(null); setPairing(null);
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
    if (files.length > MAX_FILES) { await takeMany(files); return; }
    setBulk(null);
    const picked = files.slice(0, MAX_FILES);
    const single = picked.length === 1;
    const fresh: Row[] = picked.map((f, i) => ({ key: `${Date.now()}-${i}-${f.name}`, name: f.name, size: f.size, state: "hashing" }));
    setRows(single ? [] : fresh);
    if (single) setStatus("Checking…");
    const ended: Row[] = await Promise.all(picked.map(async (f, i): Promise<Row> => {
      const row = fresh[i]!;
      const end = (p: Partial<Row>) => { patch(row.key, p); return { ...row, ...p } as Row; };
      try {
        const bytes = new Uint8Array(await f.arrayBuffer());
        const asProof = proofFileOf(f, bytes);
        if (asProof) return end({ state: "found", proof: asProof, digestB64: asProof.artifact!.digestB64!, isProofFile: true });
        const digestB64 = b64(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
        patch(row.key, { bytes, digestB64, state: "looking" });
        const res = await fetch(`/api/proofs/${toUrlSafe(digestB64)}`);
        if (!res.ok) return end({ bytes, digestB64, state: "error", note: "Could not check the ledger just now. Try again in a moment." });
        const body = (await res.json()) as { proofs?: Array<{ proof: Proof }> };
        const first = body.proofs?.[0]?.proof;
        if (!first) {
          // Not a BitGraph of its own: perhaps a file of a tree, found by its sealed entry and proven here.
          const inTree = await findInTree(bytes).catch(() => null);
          if (inTree) return end({ bytes, digestB64, state: "in-tree", tree: inTree });
          return end({ bytes, digestB64, state: "new" });
        }
        return end({ bytes, digestB64, state: "found", proof: first, valid: await check(first, bytes) });
      } catch {
        return end({ state: "error", note: "This browser could not read or check that file." });
      }
    }));
    const fresh_new = ended.filter((r) => r.state === "new" && r.digestB64);
    if (single && mode === "make" && fresh_new.length) setStatus("Making the BitGraph…");
    const made = mode === "make" ? await makeRows(fresh_new) : [];
    const final = ended.map((r) => made.find((x) => x.key === r.key) ?? r);
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
  }, [mode, router, takeMany, takeBatch, takePairing, treeOn, baseOn, takePlugins]);

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
      {variant === "zone" && mode === "make" && (
        <div className="db-plugins">
          {/* Apple-style switches (Mike, 2026-10-18). */}
          <PluginSwitch label="One position for many files" on={treeOn} set={setTreeOn} disabled={busy} />
          <PluginSwitch label="Base time window" on={baseOn} set={setBaseOn} disabled={busy} />
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
        onDrop={(e) => { e.preventDefault(); setOver(false); const dt = e.dataTransfer; setStatus("Reading the drop…"); void filesOfDrop(dt, setStatus).then((fs) => { if (fs.length === 0) { setStatus(null); return; } return take(fs); }).catch(() => setStatus(null)); }}
        className="db-zone"
        data-over={over ? "1" : undefined}
      >
        {/* The old drop prompt's two sheets (components/drop-prompt.tsx), back in the box (Mike, 2026-10-18). */}
        <svg className="db-zone-icon" width="44" height="44" viewBox="0 0 44 44" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
          <path d="M16 12V8a3 3 0 0 1 3-3h11l8 8v17a3 3 0 0 1-3 3h-4" />
          <path d="M30 5v8h8" />
          <path d="M9 12h12l7 7v17a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3V15a3 3 0 0 1 3-3Z" />
          <path d="M21 12v7h7" />
        </svg>
        {/* With a plugin on, the box says what a drop will do (Mike, 2026-10-18), instead of an explanation beside the switch. */}
        <div className="db-zone-title">{status ?? (mode === "check" ? "Drop files here to check them, or choose them"
          : treeOn && baseOn ? "Drop many files: one BitGraph between two Base blocks"
          : treeOn ? "Drop many files: one BitGraph for all of them"
          : baseOn ? "Drop a file: it is recorded between two Base blocks"
          : "Drop files here, or choose them")}</div>
        {/* Something is happening: a thin moving bar under the line that says what (Mike, 2026-10-18). */}
        {status && <div className="bg-working" role="progressbar" aria-label={status} />}
        <div className="db-zone-sub">Each file is hashed in your browser. <br className="sub-br" />Only its SHA-256 is&nbsp;sent.</div>
        <div className="db-zone-sub">The file never leaves your machine.</div>
        <input ref={inputRef} type="file" multiple style={{ display: "none" }} onChange={(e) => { void take(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
      </div>}

      {plugError && <div className="db-rows"><div className="db-row"><div className="db-state"><span className="db-bad">{plugError}</span></div></div></div>}
      {plug && (
        /* The result, plainly (Mike, 2026-10-18: the first version was "messy as fuck"): one row per BitGraph, a name and
           number, one quiet line under it, one link to its proof; the download lined up with the rows. */
        <div className="plug-result">
          {plug.a && plug.block && (
            <div className="plug-row">
              <div>
                <div className="plug-title">BitGraph 1 <span className="plug-num">#{Number(plug.a.commit?.counter).toLocaleString("en-US")}</span></div>
                <div className="plug-sub">Base block <a href={`https://basescan.org/block/${plug.block.number}`} target="_blank" rel="noreferrer">{plug.block.number.toLocaleString("en-US")}</a></div>
              </div>
              <a className="bg-action-link plug-open" style={{ margin: 0, flex: "none" }} href={`/proof/${toUrlSafe(plug.a.artifact!.digestB64!)}?counter=${plug.a.commit?.counter}`}>View proof</a>
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
            <a className="bg-action-link plug-open" style={{ margin: 0, flex: "none" }} href={`/proof/${toUrlSafe(plug.contentDigest)}?counter=${plug.b.commit?.counter}`}>View proof</a>
          </div>
          {plug.lookup && (
            <div className="plug-row">
              <div className="plug-sub">
                {plug.lookup.state === "sealing" && "Giving each file a way back to this tree…"}
                {plug.lookup.state === "saving" && `Giving each file a way back to this tree: ${plug.lookup.stored.toLocaleString("en-US")} of ${plug.lookup.total.toLocaleString("en-US")}…`}
                {plug.lookup.state === "done" && `Each of the ${plug.lookup.total.toLocaleString("en-US")} files can now find this tree when dropped.`}
                {plug.lookup.state === "failed" && `Files dropped later may not find this tree: ${plug.lookup.note ?? "the entries could not be saved"}. The tree's own files still check it.`}
              </div>
            </div>
          )}
          {timer && plug.ms && (
            <div className="plug-row">
              <div className="plug-sub">
                {plug.tree ? `Hashed ${plug.tree.files.toLocaleString("en-US")} files in ${(plug.ms.hash / 1000).toFixed(2)} s · ` : ""}
                {plug.a ? "Two BitGraphs" : "BitGraph"} made in {(plug.ms.bind / 1000).toFixed(2)} s · drop to proof {(plug.ms.total / 1000).toFixed(2)} s
              </div>
            </div>
          )}
          <div className="plug-foot">
            <button type="button" className="bg-action-link" style={{ margin: 0 }} onClick={downloadPlug}>Download everything</button>
          </div>
        </div>
      )}

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
              {batch.rootState === "missing" && <>{batch.rootFile} is not a BitGraph. <a href="/make">Make one</a></>}
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
        </div>
      )}

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
                {r.state === "new" && mode === "check" && <>Not a BitGraph. <a href="/make">Make one</a></>}
                {r.state === "new" && mode === "make" && (r.note ?? "Not a BitGraph yet")}
                {r.state === "in-tree" && r.tree && (
                  <>
                    <span className="db-ok">In a tree of {r.tree.files.toLocaleString("en-US")} files (file {(r.tree.leafIndex + 1).toLocaleString("en-US")}), checked in this browser</span>
                    <a href={`/proof/${toUrlSafe(r.tree.proof.digestB64)}?counter=${encodeURIComponent(r.tree.proof.counter)}`}>BitGraph #{Number(r.tree.proof.counter).toLocaleString("en-US")}</a>
                    {mode === "make" && <button type="button" className="db-link" onClick={() => void makeRows([{ ...r, state: "new" }])}>Make a new BitGraph anyway</button>}
                  </>
                )}
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

      {mode === "make" && newCount > 0 && (
        <div className="db-make">
          <button type="button" className="bg-action-link" style={{ margin: 0 }} disabled={busy} onClick={() => void make()}>
            {busy ? "Making…" : `Make ${newCount === 1 ? "a BitGraph" : `${newCount} BitGraphs`}`}
          </button>
          <span className="db-make-note">Making a BitGraph is permanent.</span>
        </div>
      )}
    </div>
  );
}
