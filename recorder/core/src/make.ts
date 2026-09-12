// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * Making a BitGraph, and writing it beside the file.
 *
 * ⚠️ THE WRITE IS THE COMMIT'S COMPLETION, NOT A STEP AFTER IT. A proof that
 * was minted and not written is a consumed position with no evidence. Every
 * failure below is loud.
 *
 * ⚠️ THE ORIGINAL IS NEVER MODIFIED AND NEVER MOVED. The fused bytes are not
 * written either: they are virtual, and the proof with the original rebuilds
 * them on demand.
 *
 * ONE FILE IS FUSED ON ITS OWN. TWO OR MORE BECOME ONE SET under one slot:
 * one position, each file a member with its row. That is the site's rule and
 * it does not change here.
 */

import { readFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import {
  fuse,
  fuseSet,
  builderFor,
  fusedNamesFor,
  FuseError,
  MAX_SET_MEMBERS,
  type FuseSetHashedMember,
  type FuseTransport,
} from "@mikeargento/bitgraph";
import { bytesToBase64, type BitGraphProof, type PlacementId, type SetMemberProof } from "@mikeargento/bitgraph-verify";
import { scanAll, type ScannedFile } from "./hash.js";
import { pathsFor, INDEX_FILE } from "./paths.js";
import { writeBundle } from "./bundle.js";
import { FolderIndex, INDEX_ROW_VERSION, type IndexRow } from "./index-store.js";

/**
 * The largest file handed to `fuse()` whole.
 *
 * ⚠️ A SOLO MAKE HOLDS THE FILE IN MEMORY, and it is the one place in this app
 * that does. `fuse()` needs the finished bytes three times over: to locate the
 * commitment inside them, to hash them, and to hand them to the verifier
 * before it will call the result a proof. The set path does not: its members
 * go through the hashed form, which reads each file once and holds none of it.
 *
 * A file past this does NOT get a lesser recording and is NOT refused. It is
 * made as a set of one: the same slot, the same position, the same enclave,
 * the committed artifact being a one row manifest instead of the file's own
 * fused digest. The published verifier settles it through verifyFuseMember
 * exactly as it settles any other member.
 *
 * ⚠️ This is the whole reason the app exists rather than the page. The browser
 * stops fusing at 256 MB and falls back to a digest-only recording without
 * telling anyone, which is a degraded product rather than a slow one. Here a
 * 4 GB video gets a real BitGraph, and the shape it took is written down in
 * its own evidence file where a reader can see it.
 *
 * Removing the distinction entirely needs a streamed form of `fuse()` in
 * @mikeargento/bitgraph, which is a change to a published package.
 */
export const MAX_SOLO_BYTES = 1_500_000_000;

/** Above this many members a set commits a Merkle root instead of the whole list. */
export const SET1_LIMIT = MAX_SET_MEMBERS;

export type MakePhase = "hash" | "fuse" | "tree" | "commit" | "write";

export interface MakeProgress {
  phase: MakePhase;
  done: number;
  total: number;
}

export interface MakeOptions {
  transport?: FuseTransport;
  /**
   * Record these bytes even if this folder already has. Dedup is a
   * convenience for the watcher, never a rule: a clock that ticks when you ask
   * ticks every time you ask.
   */
  again?: boolean;
  onProgress?: (p: MakeProgress) => void;
  /** How long to keep holding through an enclave restart. */
  restartWindowMs?: number;
  /**
   * The largest file handed to `fuse()` whole; past it a lone file is made as
   * a set of one. Defaults to MAX_SOLO_BYTES. Lower it on a machine with
   * little memory to spare; it changes the SHAPE of a large file's proof, never
   * whether it gets one.
   */
  soloCeiling?: number;
  /**
   * Write ONE recording folder instead of evidence beside the files.
   *
   * ⚠️ THIS IS WHAT A DROP DOES NOW. BitGraph Recorder's shape, which is one
   * self-contained folder per recording: the files, `proof.json`, and the
   * anchors when they land. Nothing points at anything, and the whole thing
   * moves as a unit. The files go in as HARD LINKS on the same volume, so it
   * costs no bytes and your originals never move.
   *
   * Absent, the older shape is written: evidence beside each file, under
   * BitGraphs/. That is what a synced folder still does, because a folder
   * being kept up to date is not a recording somebody hands over.
   */
  bundle?: { library: string; source: string };

}

export interface MadeFile {
  path: string;
  name: string;
  bytes: number;
  placement: PlacementId;
  originDigestB64: string;
  artifactDigestB64: string;
  /** What the fused file would be called if anyone asked for it. It is not written. */
  fusedName: string;
  /** Where this file's evidence landed. */
  evidencePath: string;
  /** The member's index in the committed manifest; null for a solo make. */
  manifestIndex: number | null;
}

export interface SkippedFile {
  path: string;
  name: string;
  originDigestB64: string;
  /** Why nothing was made for it: on record already, or the same bytes as another file in this drop. */
  reason: "already-recorded" | "same-bytes";
  /** For `same-bytes`: the file in this drop that stands for these bytes. */
  sameAs?: string;
  /** The positions this folder already holds for these bytes. */
  positions: Array<{ epochId: string; counter: string }>;
  /**
   * True when this file did not have evidence beside it and now does.
   *
   * A BitGraph is about BYTES, not about a name, so a second copy of a
   * recorded file is covered by the position the first one took. It gets its
   * own evidence file pointing at that position rather than a second position
   * of its own: "if you see it, it's a BitGraph" has to be true of the copy
   * too, and minting again for identical bytes would be a tick nobody asked
   * for.
   */
  attached: boolean;
}

export interface MakeResult {
  kind: "solo" | "set";
  /** The recording folder, when the drop made one. */
  bundlePath?: string;
  /** Whether its files went in as hard links or as copies. */
  bundleHow?: "linked" | "copied";
  set: "set/1" | "set/2" | null;
  proof: BitGraphProof;
  position: { epochId: string; counter: string };
  files: MadeFile[];
  /** Where the shared proof landed; null for a solo make, whose proof is inside its own evidence file. */
  proofPath: string | null;
  /** The committed set manifest bytes, as committed; null for a solo make. */
  manifestPath: string | null;
  /** True when the commit response was lost and the proof was read back by digest. */
  recovered: boolean;
}

/**
 * Record files into a folder. Everything written lands under
 * <root>/BitGraphs; nothing outside it is touched.
 */
export async function makeFiles(root: string, filePaths: readonly string[], options: MakeOptions = {}): Promise<{ made: MakeResult | null; skipped: SkippedFile[] }> {
  if (filePaths.length === 0) throw new Error("nothing to record");
  const inputs = filePaths.map((p) => {
    const rel = relative(root, p);
    if (rel === "" || rel.startsWith("..")) throw new Error(`${p} is not inside ${root}`);
    return { path: p, rel };
  });
  const scanned = await scanAll(inputs, (done, total) => options.onProgress?.({ phase: "hash", done, total }));
  return makeScanned(root, scanned, options);
}

/**
 * The same, over files that have already been read.
 *
 * ⚠️ THIS IS WHY A DROP READS EVERY FILE ONCE. The app looks before it makes:
 * it has to know whether a lone dropped file is new (record it) or already has
 * a BitGraph (open it), and that is a question about the bytes. Handing the
 * scans forward means the second half of the gesture costs no disk at all.
 * Hashing 48,000 files twice to answer one question is exactly the shape of
 * mistake this codebase keeps making.
 */
export async function makeScanned(root: string, files: readonly ScannedFile[], options: MakeOptions = {}): Promise<{ made: MakeResult | null; skipped: SkippedFile[] }> {
  if (files.length === 0) throw new Error("nothing to record");
  const paths = pathsFor(root);
  /* A recording goes in the library and is remembered there; a synced folder
   * remembers its own. */
  const index = await FolderIndex.open(options.bundle !== undefined ? join(options.bundle.library, INDEX_FILE) : paths.index);

  const scanned: ScannedFile[] = [];
  const already: Array<{ file: ScannedFile; originB64: string }> = [];
  const twice: Array<{ file: ScannedFile; originB64: string; sameAs: string }> = [];
  /* ⚠️ THE SAME BYTES TWICE IN ONE DROP ARE ONE MEMBER. A set lists each
   * fused artifact once and the verifier refuses one that does not, so
   * Mike's ten-file drop with two identical photographs threw and made
   * nothing (2026-09-09). The first path stands for the bytes; every other
   * path holding them is reported, and covered, since the record is by
   * content. */
  const seen = new Map<string, string>();
  for (const s of files) {
    const originB64 = bytesToBase64(s.originDigest);
    if (options.again !== true && index.has(originB64)) { already.push({ file: s, originB64 }); continue; }
    const first = seen.get(originB64);
    if (first !== undefined) { twice.push({ file: s, originB64, sameAs: first }); continue; }
    seen.set(originB64, s.rel);
    scanned.push(s);
  }

  /**
   * ⚠️ NOTHING AT ALL FOR A FILE ALREADY ON RECORD.
   *
   * This used to be the slowest thing the app did: every already-recorded file
   * went through an attach that appended its own index row with its own fsync,
   * so re-dropping a 30,000 file folder was 60,000 fsyncs and took over twenty
   * seconds. It was the same bug already fixed in the make path, still sitting
   * in the skip path, and it only appeared when somebody dropped the same
   * folder twice, which is the most ordinary thing to do.
   *
   * With one shape there is nothing to attach either: the recording holding
   * those bytes is in the library and complete. A re-drop is a read.
   */
  const skipped: SkippedFile[] = already.map(({ file, originB64 }) => ({
    path: file.path,
    name: file.name,
    originDigestB64: originB64,
    reason: "already-recorded" as const,
    /* ⚠️ Deduped by POSITION: one recording is one position, however many
     * paths hold those bytes. */
    positions: distinctPositions(index.rowsFor(originB64)),
    attached: false,
  }));
  for (const { file, originB64, sameAs } of twice) {
    skipped.push({ path: file.path, name: file.name, originDigestB64: originB64, reason: "same-bytes", sameAs, positions: [], attached: false });
  }

  if (scanned.length === 0) return { made: null, skipped };

  /* ⚠️ ONE SHAPE. Every recording is a folder in the library: the files, the
   * proof, the anchors, moving as a unit. A second shape used to live here,
   * evidence written beside each file, and two shapes in one app is two sets
   * of rules and every seam somebody hits. The READ path for the old shape is
   * still in check and describe, because folders recorded that way are real
   * and have to keep opening; nothing writes it any more. */
  const solo = scanned.length === 1 && scanned[0]!.bytes <= (options.soloCeiling ?? MAX_SOLO_BYTES);
  const bundle = options.bundle ?? { library: dirname(paths.index), source: scanned[0]!.rel.split("/").pop() ?? "drop" };
  return { made: await makeBundle(root, index, scanned, solo, { ...options, bundle }), skipped };
}

/**
 * Fuse, then write ONE recording folder: the files, the proof, the committed
 * artifact, the member list. BitGraph Recorder's shape.
 *
 * ⚠️ NOTHING IS WRITTEN WHERE THE FILES CAME FROM. The drop leaves no trace in
 * the folder you dragged out of, which is the whole difference between a
 * recording and a synced folder.
 */
async function makeBundle(root: string, index: FolderIndex, files: readonly ScannedFile[], solo: boolean, options: MakeOptions): Promise<MakeResult> {
  const library = options.bundle!.library;
  const source = options.bundle!.source;

  let proof: BitGraphProof;
  let manifestBytes: Uint8Array | null = null;
  let memberRows: Iterable<unknown> | null = null;
  let recovered = false;
  let kind: "solo" | "set";
  let setKind: "set/1" | "set/2" | null = null;
  const made: MadeFile[] = [];

  if (solo) {
    const file = files[0]!;
    options.onProgress?.({ phase: "fuse", done: 0, total: 1 });
    const original = new Uint8Array(await readFile(file.path));
    const { fusedName } = fusedNamesFor(file.name, file.placement);
    const r = await holdingThroughRestart(
      () => fuse(builderFor(file.placement, original), {
        placement: file.placement,
        original,
        fusedFile: fusedName,
        keepFused: false,
        ...(options.transport !== undefined ? { transport: options.transport } : {}),
      }),
      options,
    );
    options.onProgress?.({ phase: "commit", done: 1, total: 1 });
    proof = r.proof;
    recovered = r.recovered;
    kind = "solo";
    made.push({
      path: file.path, name: file.name, bytes: file.bytes, placement: file.placement,
      originDigestB64: r.originDigestB64 ?? bytesToBase64(file.originDigest),
      artifactDigestB64: r.artifactDigestB64, fusedName, evidencePath: "", manifestIndex: null,
    });
  } else {
    const members: FuseSetHashedMember[] = files.map((f) => ({
      originDigest: f.originDigest,
      placement: f.placement,
      name: f.name,
      fusedDigest: ({ commitment }) => f.fusedDigest(commitment),
    }));
    const r = await holdingThroughRestart(
      () => fuseSet(members, {
        set: files.length <= SET1_LIMIT ? "set/1" : "set/2",
        keepFused: false,
        ...(options.transport !== undefined ? { transport: options.transport } : {}),
        onProgress: (p) => options.onProgress?.({ phase: p.phase === "verify" ? "commit" : p.phase, done: p.done, total: p.total }),
      }),
      options,
    );
    proof = r.proof;
    manifestBytes = r.manifestBytes;
    /* Lazily, one row at a time as the bundle writes them (bundle.ts). */
    const rows = r.members;
    memberRows = {
      *[Symbol.iterator]() {
        for (const m of rows) {
          yield {
            name: files[m.index]!.name, rel: files[m.index]!.rel, bytes: files[m.index]!.bytes,
            placement: m.placement, originDigestB64: m.originDigestB64, artifactDigestB64: m.artifactDigestB64,
            manifestIndex: m.manifestIndex,
            ...(m.memberProof !== undefined ? { memberProof: m.memberProof } : {}),
          };
        }
      },
    };
    recovered = r.recovered;
    kind = "set";
    setKind = r.set;
    for (const m of r.members) {
      const f = files[m.index]!;
      made.push({
        path: f.path, name: f.name, bytes: f.bytes, placement: m.placement,
        originDigestB64: m.originDigestB64, artifactDigestB64: m.artifactDigestB64,
        fusedName: fusedNamesFor(f.name, m.placement).fusedName, evidencePath: "", manifestIndex: m.manifestIndex,
      });
    }
  }

  const position = positionOf(proof);
  options.onProgress?.({ phase: "write", done: 0, total: files.length });
  const bundle = await writeBundle({
    library,
    files: files.map((f) => ({ path: f.path, rel: f.rel, bytes: f.bytes })),
    onFile: (done, total) => options.onProgress?.({ phase: "write", done, total }),
    proof,
    manifestBytes,
    memberRows,
    source,
    position,
  });
  options.onProgress?.({ phase: "write", done: files.length, total: files.length });

  const bundleRel = relative(library, bundle.path).split(sep).join("/");
  for (const m of made) m.evidencePath = join(bundle.path, "proof.json");
  await index.append(files.map((f, i) => ({
    ...rowFor(f, made[i]!.artifactDigestB64, position, "", setKind, made[i]!.manifestIndex ?? undefined),
    bundle: bundleRel,
    from: root,
  })));

  return {
    kind, set: setKind, proof, position, files: made,
    proofPath: join(bundle.path, "proof.json"),
    manifestPath: manifestBytes === null ? null : join(bundle.path, "manifest.json"),
    recovered,
    bundlePath: bundle.path,
    bundleHow: bundle.how,
  };
}


// ---------------------------------------------------------------------------

/**
 * The enclave restarts daily at about 23:59 UTC with a new keypair and a
 * counter reset, and it also refuses to allocate before the epoch's first
 * anchor has landed. Both answer 503 `tee-restarting`, which is not an error:
 * it is a door that opens again shortly.
 *
 * ⚠️ A commit that fails this way may have lost its slot, whose TTL is 120
 * seconds. The whole make is retried from allocation, never the commit alone.
 */
async function holdingThroughRestart<T>(run: () => Promise<T>, options: MakeOptions): Promise<T> {
  const window = options.restartWindowMs ?? 15 * 60_000;
  const deadline = Date.now() + window;
  let wait = 2_000;
  for (;;) {
    try {
      return await run();
    } catch (err) {
      const retryable = err instanceof FuseError && (err.code === "tee-restarting" || err.code === "slot-unavailable");
      if (!retryable || Date.now() + wait > deadline) throw err;
      await new Promise((r) => setTimeout(r, wait));
      wait = Math.min(wait * 2, 60_000);
    }
  }
}

function positionOf(proof: BitGraphProof): { epochId: string; counter: string } {
  const commit = proof.commit as { epochId?: unknown; counter?: unknown } | undefined;
  const epochId = typeof commit?.epochId === "string" ? commit.epochId : "";
  const counter = typeof commit?.counter === "string" ? commit.counter : String(commit?.counter ?? "");
  if (epochId === "" || counter === "") throw new Error("the returned proof names no position");
  return { epochId, counter };
}

function distinctPositions(rows: readonly { epochId: string; counter: string }[]): Array<{ epochId: string; counter: string }> {
  const seen = new Map<string, { epochId: string; counter: string }>();
  for (const r of rows) seen.set(`${r.epochId} ${r.counter}`, { epochId: r.epochId, counter: r.counter });
  return [...seen.values()];
}

function rowFor(f: ScannedFile, artifactDigestB64: string, position: { epochId: string; counter: string }, evidence: string, set: "set/1" | "set/2" | null, manifestIndex?: number): IndexRow {
  return {
    v: INDEX_ROW_VERSION,
    originDigestB64: bytesToBase64(f.originDigest),
    artifactDigestB64,
    name: f.name,
    rel: f.rel,
    bytes: f.bytes,
    mtimeMs: f.modifiedAt.getTime(),
    placement: f.placement,
    epochId: position.epochId,
    counter: position.counter,
    /* Empty when the set was too big to fan out: the member's evidence is
     * built from members.jsonl when it is wanted. */
    evidence,
    set,
    ...(manifestIndex !== undefined ? { manifestIndex } : {}),
    recordedAt: new Date().toISOString(),
  };
}
