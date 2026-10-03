// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * bitgraph-export/1 files on this machine (2026-10-03): build them from a
 * tree just made, write them where the caller says, read them back,
 * complete them from the site, and derive one member's export from the
 * owner's. The builders and the completion are the core package's; this is
 * the file side.
 *
 * The export is how a file proves it is in its BitGraph: the proof commits
 * only the tree's root, so a member needs its leaf and path (a member's
 * export) or the whole list (the owner's export) beside it. Keep it.
 *
 * Names, the site's own (website/src/lib/fuse-tree.ts), so an export made
 * here and one downloaded from the drop box read the same:
 *   <dir>/bitgraph-<counter>.bitgraph.json         the owner's export: every leaf, a name per leaf
 *   <dir>/bitgraph-<counter>/<name>.bitgraph.json  one per member, on request, under the tree's names
 *   <dir>/SPEC.md                                  the rules the proof pins, when the site serves that exact text
 * Every file is written new: nothing existing is overwritten, and a name
 * already taken gets the epoch, then a number.
 */

import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { buildMemberExport, buildOwnerExport, completeExport, fetchFloorHeader, type CompletedExport, type ExportFloor, type TreeExportSource } from "@mikeargento/bitgraph";
import { base64ToBytes, decodeTreeLeaves, hexToBytes, MerkleTree, parseExport, treeLeafHash, type BitGraphExport } from "@mikeargento/bitgraph-verify";
import type { ApiConfig } from "./api.js";
import { toUrlSafeB64 } from "./encoding.js";
import type { TreeSummary } from "./pipelines.js";
import type { BitGraphProof } from "./types.js";

export type ExportKind = "owner" | "members" | "both" | "none";
export const EXPORT_KINDS: readonly ExportKind[] = ["owner", "members", "both", "none"];

/** What a tree's exports are built from, as a record result carries it: JSON-safe. */
export interface TreeExportData {
  proof: BitGraphProof;
  /** The 84-byte root document, lowercase hex. */
  rootDocument: string;
  /** Every leaf in tree order, base64 (count x 65 bytes). */
  leaves: string;
  /** A name per leaf, in tree order (unsigned, informational). */
  names: readonly string[];
  counter: string | null;
  /** URL-safe epoch id. */
  epoch: string | null;
  /** URL-safe digest of the root document. */
  artifactDigest: string;
  /** The floor block the proof signs; header null when it was not fetched. */
  floor: { blockNumber: number; blockHash: string; header: string | null };
}

/**
 * A tree just made, as export data. `paths` are the files in the order they
 * were given to the pipeline; each leaf is named by its file's path under the
 * deepest folder that holds them all. The floor block's header is fetched
 * from the site's witness route and kept only when it hashes to the floor the
 * proof signs; otherwise it is null, the export says the floor header is not
 * carried, and completing the export fetches it later. Never throws for the
 * header.
 */
export async function exportDataOf(tree: TreeSummary, paths: readonly string[], config: ApiConfig, fetcher: typeof fetch = fetch): Promise<TreeExportData> {
  const counter = tree.proof.commit?.counter ?? null;
  const epochId = tree.proof.commit?.epochId ?? null;
  const rel = relativeNames(paths);
  const names = new Array<string>(tree.count).fill("");
  for (const m of tree.members) names[m.leafIndex] = rel[m.index] ?? "";
  let header: string | null = null;
  try {
    header = (await fetchFloorHeader(tree.proof as unknown as Parameters<typeof fetchFloorHeader>[0], fetcher, { baseUrl: config.baseUrl }))?.header ?? null;
  } catch {
    header = null;
  }
  return {
    proof: tree.proof,
    rootDocument: tree.rootDocumentHex,
    leaves: tree.leavesB64,
    names,
    counter,
    epoch: epochId !== null ? toUrlSafeB64(epochId) : null,
    artifactDigest: toUrlSafeB64(tree.artifactDigestB64),
    floor: { blockNumber: tree.floor.blockNumber, blockHash: tree.floor.blockHash, header },
  };
}

/** The core builders' source: the bytes decoded and, for member exports, the tree built once. */
export function exportSourceOf(data: Pick<TreeExportData, "proof" | "rootDocument" | "leaves">, withTree = false): TreeExportSource {
  const rootDocument = hexToBytes(data.rootDocument);
  const list = base64ToBytes(data.leaves);
  const leaves = list === null ? null : decodeTreeLeaves(list);
  if (rootDocument === null || leaves === null) throw new TypeError("the tree data is not a root document and a list of 65-byte leaves");
  const source: TreeExportSource = { proof: data.proof as unknown as TreeExportSource["proof"], rootDocument, leaves };
  if (withTree) source.tree = new MerkleTree(leaves.map(treeLeafHash));
  return source;
}

function floorOf(data: Pick<TreeExportData, "floor">): ExportFloor | null {
  const f = data.floor;
  return f.header !== null ? { blockNumber: f.blockNumber, blockHash: f.blockHash, header: f.header } : null;
}

/** The owner's export: every leaf and a name per leaf; the ceiling and settlement pending. */
export function ownerExportOf(data: TreeExportData): BitGraphExport {
  return buildOwnerExport(exportSourceOf(data), { floor: floorOf(data), names: data.names });
}

/** One member's export, by its leaf in the tree; pass a source built once to make many. */
export function memberExportOf(data: TreeExportData, leafIndex: number, source?: TreeExportSource): BitGraphExport {
  return buildMemberExport(source ?? exportSourceOf(data, true), leafIndex, { floor: floorOf(data) });
}

/** bitgraph-<counter>: the owner's export is named for the position it holds, as the site names it. */
export function exportBaseName(data: Pick<TreeExportData, "counter" | "artifactDigest">): string {
  const id = data.counter !== null && /^[0-9]+$/.test(data.counter) ? data.counter : data.artifactDigest.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 12);
  return `bitgraph-${id}`;
}

/** The names a taken name falls back to, in order: the epoch's first 8 characters (counters restart each epoch), then a number. */
function fallbackNames(base: string, data: Pick<TreeExportData, "epoch" | "artifactDigest">): (n: number) => string {
  const day = (data.epoch ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 8) || data.artifactDigest.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 8);
  return (n) => (n === 0 ? base : n === 1 ? `${base}-${day}` : `${base}-${day}-${n}`);
}

/** A member export's file name: the file's own name and ".bitgraph.json", so the pair reads together. */
export function memberExportFileName(name: string): string {
  return `${name}.bitgraph.json`;
}

/** A tree name as a path under the members' folder: no root, no "." or "..", no control characters. */
export function safeRelativeName(name: string, leafIndex: number): string {
  const parts = name
    .split(/[\\/]+/)
    .map((s) => s.replace(/[\x00-\x1f\x7f]/g, " ").trim())
    .filter((s) => s.length > 0 && s !== "." && s !== "..");
  return parts.length > 0 ? join(...parts) : `leaf-${leafIndex}`;
}

/**
 * Names for the files of one tree: each path relative to the deepest folder
 * that holds them all, so a folder's members read as its own layout. One
 * file is its own name.
 */
export function relativeNames(paths: readonly string[]): string[] {
  if (paths.length === 0) return [];
  const abs = paths.map((p) => resolve(p));
  if (abs.length === 1) return [basename(abs[0]!)];
  let common = dirname(abs[0]!).split(sep);
  for (const p of abs.slice(1)) {
    const parts = dirname(p).split(sep);
    let i = 0;
    while (i < common.length && i < parts.length && common[i] === parts[i]) i++;
    common = common.slice(0, i);
  }
  const root = common.join(sep) || sep;
  return abs.map((p) => relative(root, p));
}

/** Write a new file under the first free name nameAt(0), nameAt(1), ...; never over an existing file. */
async function writeNew(nameAt: (attempt: number) => string, text: string | Uint8Array): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const path = nameAt(attempt);
    await mkdir(dirname(path), { recursive: true });
    try {
      await writeFile(path, text, { flag: "wx" });
      return path;
    } catch (err) {
      if ((err as { code?: unknown }).code !== "EEXIST") throw err;
    }
  }
  throw new Error(`no free name for ${nameAt(0)}: 100 are taken`);
}

/** The first of nameAt(0), nameAt(1), ... that does not exist yet, created empty. */
async function newFolder(nameAt: (attempt: number) => string): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const path = nameAt(attempt);
    const taken = await access(path).then(() => true, () => false);
    if (!taken) {
      await mkdir(path, { recursive: true });
      return path;
    }
  }
  throw new Error(`no free folder name for ${nameAt(0)}: 100 are taken`);
}

const sha256B64 = (b: Uint8Array) => createHash("sha256").update(b).digest("base64");

/**
 * SPEC.md as the site serves it (GET /spec/SPEC.md), kept only when its
 * SHA-256 is the spec hash the proof pins: shipping other text beside an
 * export would hand its reader the wrong rules under the right name. Null
 * when it cannot be had. Never throws.
 */
export async function fetchPinnedSpec(config: Pick<ApiConfig, "baseUrl">, specHashB64: string, fetcher: typeof fetch = fetch): Promise<Uint8Array | null> {
  try {
    const res = await fetcher(`${config.baseUrl.replace(/\/+$/, "")}/spec/SPEC.md`, { redirect: "error", signal: AbortSignal.timeout(20_000) });
    if (res.status !== 200) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    return sha256B64(bytes) === specHashB64 ? bytes : null;
  } catch {
    return null;
  }
}

/** Put SPEC.md beside the exports: reuse one already there with the same text, never replace a different one. */
async function writeSpecBeside(dir: string, spec: Uint8Array): Promise<string> {
  const want = sha256B64(spec);
  const at = (n: number) => join(dir, n === 0 ? "SPEC.md" : `SPEC-${toUrlSafeB64(want).slice(0, 8)}${n === 1 ? "" : `-${n}`}.md`);
  for (let n = 0; n < 100; n++) {
    const path = at(n);
    const existing = await readFile(path).then((b) => new Uint8Array(b), () => null);
    if (existing === null) {
      await mkdir(dir, { recursive: true });
      await writeFile(path, spec, { flag: "wx" });
      return path;
    }
    if (sha256B64(existing) === want) return path;
  }
  throw new Error(`no free name for ${at(0)}`);
}

export interface WrittenExports {
  dir: string;
  /** The owner's export, when written. */
  owner: string | null;
  /** The folder that holds the member exports, when written. */
  membersDir: string | null;
  /** One row per member export written, in tree order. */
  members: Array<{ leafIndex: number; name: string; path: string }>;
  /** SPEC.md beside the exports, when the pinned text was in hand. */
  spec: string | null;
}

/**
 * Write a tree's exports into `dir`: the owner's, one per member, both, or
 * none; and SPEC.md beside them when `spec` is given (it is written only when
 * its SHA-256 is the hash the proof pins).
 */
export async function writeTreeExports(data: TreeExportData, opts: { dir: string; kind: ExportKind; spec?: Uint8Array | null }): Promise<WrittenExports> {
  if (!EXPORT_KINDS.includes(opts.kind)) throw new TypeError(`exports must be one of ${EXPORT_KINDS.join(", ")}`);
  const dir = resolve(opts.dir);
  const out: WrittenExports = { dir, owner: null, membersDir: null, members: [], spec: null };
  if (opts.kind === "none") return out;
  const names = fallbackNames(exportBaseName(data), data);
  if (opts.kind === "owner" || opts.kind === "both") {
    const text = JSON.stringify(ownerExportOf(data), null, 2) + "\n";
    out.owner = await writeNew((n) => join(dir, `${names(n)}.bitgraph.json`), text);
  }
  if (opts.kind === "members" || opts.kind === "both") {
    const source = exportSourceOf(data, true);
    const membersDir = await newFolder((n) => join(dir, names(n)));
    out.membersDir = membersDir;
    for (let k = 0; k < source.leaves.length; k++) {
      const name = data.names[k] ?? "";
      const rel = safeRelativeName(name, k);
      const text = JSON.stringify(memberExportOf(data, k, source), null, 2) + "\n";
      const path = await writeNew((n) => join(membersDir, memberExportFileName(n === 0 ? rel : `${rel}.${k}${n === 1 ? "" : `-${n}`}`)), text);
      out.members.push({ leafIndex: k, name, path });
    }
  }
  const pinned = data.proof.attribution?.message;
  if (opts.spec && typeof pinned === "string" && sha256B64(opts.spec) === pinned) out.spec = await writeSpecBeside(dir, opts.spec);
  return out;
}

/** Read an export/1 file; throws when it is not one. */
export async function readExportFile(path: string): Promise<BitGraphExport> {
  const exp = parseExport(await readFile(path, "utf8"));
  if (exp === null) throw new TypeError(`${path} is not a bitgraph-export/1 file`);
  return exp;
}

/** True when the text parses as an export/1 document. */
export function looksLikeExport(text: string): boolean {
  return parseExport(text) !== null;
}

export interface CompletedExportFile extends Omit<CompletedExport, "export"> {
  path: string;
}

/**
 * Fetch what an export file is waiting for (the floor header, the Base
 * ceiling, its settlement on Ethereum), each verified before it is added,
 * and write the file back when anything was: in place, or to `out` (a new
 * file). Nothing already inside is replaced.
 */
export async function completeExportFile(config: ApiConfig, path: string, opts: { out?: string; waitMs?: number; fetcher?: typeof fetch } = {}): Promise<CompletedExportFile> {
  const exp = await readExportFile(path);
  const done = await completeExport(exp, opts.fetcher ?? fetch, { baseUrl: config.baseUrl, ...(opts.waitMs !== undefined ? { waitMs: opts.waitMs } : {}) });
  let target = path;
  const text = JSON.stringify(done.export, null, 2) + "\n";
  if (opts.out !== undefined) {
    target = opts.out;
    await writeFile(target, text, { flag: "wx" });
  } else if (done.changed) {
    await writeFile(target, text);
  }
  const { export: _exp, ...rest } = done;
  return { path: target, ...rest };
}

/**
 * One member's export from the owner's: the file's leaf is found in the list
 * by its digest (the committed bytes or the original), and its path built.
 * Null when the file is not in the list. The floor, ceiling and settlement
 * travel as the owner's export holds them.
 */
export function memberExportFromOwner(owner: BitGraphExport, bytes: Uint8Array): { export: BitGraphExport; leafIndex: number; name: string | null } | null {
  if (typeof owner.tree.leaves !== "string") throw new TypeError("not an owner's export: it lists no leaves");
  const source = exportSourceOf({ proof: owner.proof as unknown as BitGraphProof, rootDocument: owner.tree.rootDocument, leaves: owner.tree.leaves });
  const d = createHash("sha256").update(bytes).digest();
  const k = source.leaves.findIndex((l) => Buffer.from(l.artifact).equals(d) || Buffer.from(l.origin).equals(d));
  if (k < 0) return null;
  source.tree = new MerkleTree(source.leaves.map(treeLeafHash));
  const exp = buildMemberExport(source, k, { floor: owner.floor, ceiling: owner.ceiling, settlement: owner.settlement });
  return { export: exp, leafIndex: k, name: owner.tree.names?.[k] ?? null };
}
