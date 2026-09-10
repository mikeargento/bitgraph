// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * Looking, before anything is made.
 *
 * A drop is one gesture with two outcomes: bytes nothing has recorded get a
 * BitGraph, and bytes that already have one open it. Deciding which is a
 * question about the BYTES, so it is answered by hashing them, and it is
 * answered without a single request leaving the machine.
 *
 * ⚠️ A LOOKUP IS NOT A RECORDING. Nothing here allocates a slot, writes a
 * file, or touches the network.
 */

import { readdir, stat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { bytesToBase64, type BitGraphProof } from "@mikeargento/bitgraph-verify";
import { scanAll, type ScannedFile } from "./hash.js";
import { FolderIndex } from "./index-store.js";
import { pathsFor, BITGRAPHS_DIR, INDEX_FILE } from "./paths.js";
import { readEvidence, type Evidence } from "./evidence.js";
import { readMembers, evidenceFromMember, type MemberRow } from "./members.js";
import { walk } from "./check.js";

export interface Looked {
  path: string;
  name: string;
  rel: string;
  bytes: number;
  originDigestB64: string;
  placement: "trailer/1" | "container/2";
  /** Where this folder already holds these bytes, or null. */
  position: { epochId: string; counter: string } | null;
  /** The evidence file, when there is one. */
  evidencePath: string | null;
  /** The earlier file in this drop holding the same bytes, when there is one: this one counts once with it. */
  duplicateOf?: string;
}

/**
 * The most rows a look hands back.
 *
 * ⚠️ A WINDOWED LIST NEEDS THE ROWS ON SCREEN, NOT ALL OF THEM. 30,000 rows is
 * 8.9 MB on a single line, for a list that draws about thirty of them, and
 * every byte has to be built, written, read and decoded before anything
 * appears. What is capped is the SAMPLE. The counts are always the real ones.
 */
export const ROWS_SHOWN = 500;

export interface LookResult {
  /** The folder the evidence would go under: the common parent of everything looked at. */
  root: string;
  /** At most ROWS_SHOWN of them; `total` says how many there are. */
  files: Looked[];
  /** How many files were looked at, whatever is in `files`. */
  total: number;
  /** How many of the total this folder already holds. */
  recorded: number;
  /** True when `files` is a sample rather than the lot. */
  truncated: boolean;
  /** How many of the total are the same bytes as an earlier file in the drop. */
  duplicates: number;
}

/**
 * Read what was dropped, once.
 *
 * The scans come back with the answer, because the second half of the gesture
 * needs them: `makeScanned` takes these exact objects and never opens a file
 * again.
 */
export async function scanDrop(
  paths: readonly string[],
  onProgress?: (done: number, total: number) => void,
  /** Called as soon as the folder is known, before a byte is read. */
  onRoot?: (root: string, files: number) => void,
  /** Folders never entered: the BitGraph folder itself. */
  excluding: readonly string[] = [],
): Promise<{ root: string; scanned: ScannedFile[] }> {
  const { root, files } = await expand(paths, excluding);
  onRoot?.(root, files.length);
  const scanned = await scanAll(
    files.map((path) => ({ path, rel: relative(root, path).split(sep).join("/") })),
    onProgress,
  );
  return { root, scanned };
}

/** What the folder already knows about files that have just been read. */
export async function lookAt(indexIn: string, scanned: readonly ScannedFile[], reportRoot?: string): Promise<LookResult> {
  const root = reportRoot ?? indexIn;
  /* ⚠️ Asked of the LIBRARY, because that is where recordings are remembered:
   * dropping the same photo out of a different folder must still find it. */
  const index = await FolderIndex.open(join(indexIn, INDEX_FILE));
  const out: Looked[] = [];
  let recorded = 0;
  let duplicates = 0;
  const seen = new Map<string, string>();
  for (const s of scanned) {
    const originDigestB64 = bytesToBase64(s.originDigest);
    const row = index.rowsFor(originDigestB64)[0];
    if (row !== undefined) recorded++;
    /* The same bytes under an earlier name in this drop: counted once. */
    const earlier = row === undefined ? seen.get(originDigestB64) : undefined;
    if (earlier !== undefined) duplicates++;
    else if (row === undefined) seen.set(originDigestB64, s.rel);
    if (out.length >= ROWS_SHOWN) continue;
    out.push({
      ...(earlier !== undefined ? { duplicateOf: earlier } : {}),
      path: s.path,
      name: s.name,
      rel: s.rel,
      bytes: s.bytes,
      originDigestB64,
      placement: s.placement,
      position: row === undefined ? null : { epochId: row.epochId, counter: row.counter },
      /* Null when the set was too big to fan out: there is no file beside
       * this one, and the digest plus the position is the handle instead. */
      /* A recording's proof is in its bundle; a synced folder's is beside the
       * file. Either way, this is where to look. */
      evidencePath: row === undefined
        ? null
        : row.bundle !== undefined && row.bundle !== ""
          ? join(indexIn, ...row.bundle.split("/"), "proof.json")
          : row.evidence === "" ? null : join(pathsFor(root).bitgraphs, ...row.evidence.split("/")),
    });
  }
  return { root, files: out, total: scanned.length, recorded, truncated: scanned.length > out.length, duplicates };
}

/**
 * Hash what was dropped and say, for each file, whether this folder already
 * holds those bytes.
 */
export async function look(paths: readonly string[], onProgress?: (done: number, total: number) => void): Promise<LookResult> {
  const { root, scanned } = await scanDrop(paths, onProgress);
  return lookAt(root, scanned);
}

/** True when `path` is `folder` or sits anywhere inside it. */
export function isWithin(path: string, folder: string): boolean {
  if (folder === "") return false;
  const f = resolve(folder).replace(/\/+$/, "");
  const p = resolve(path).replace(/\/+$/, "");
  return p === f || p.startsWith(f + sep);
}

/**
 * Files named directly, plus everything inside any folder named, and the
 * folder their evidence belongs under.
 *
 * ⚠️ ONE DROP IS ONE SET AT ONE POSITION, so it needs ONE folder to write
 * under: the common parent of everything dropped. A drop whose common parent
 * is above the home folder is refused rather than scattering a folder called
 * BitGraphs somewhere nobody expects.
 */
export async function expand(paths: readonly string[], excluding: readonly string[] = []): Promise<{ root: string; files: string[] }> {
  if (paths.length === 0) throw new Error("nothing was dropped.");
  const files: string[] = [];
  const roots: string[] = [];
  for (const raw of paths) {
    const path = resolve(raw);
    /* ⚠️ Your BitGraph folder holds recordings; it is opened from the
     * calendar, never recorded again. */
    for (const folder of excluding) {
      if (isWithin(path, folder)) {
        throw new Error(`${path} is inside your BitGraph folder. What is in there is already recorded: open it from the Calendar.`);
      }
    }
    const s = await stat(path);
    if (s.isDirectory()) {
      roots.push(path);
      files.push(...(await walk(path, { excluding })));
    } else {
      roots.push(dirname(path));
      files.push(path);
    }
  }
  if (files.length === 0) throw new Error("there are no files in what was dropped.");
  const root = commonRoot(roots);
  refuseUnreasonableRoot(root);
  return { root, files: [...new Set(files)].sort() };
}

/**
 * Where a drop's evidence may not go.
 *
 * ⚠️ ONE DROP IS ONE SET AT ONE POSITION, so it needs ONE folder to write
 * under: the deepest folder everything dropped is inside. Usually that is the
 * folder they came from. Dragging from two places at once pushes it upwards,
 * and this is where it stops: nothing writes a BitGraphs folder at the root of
 * the disk, at the top of /Users, or at the mount point of a volume. Those are
 * not places a person keeps their work, and finding one there would be
 * alarming rather than useful.
 *
 * A home folder IS allowed. It is surprising, not wrong: the evidence mirrors
 * the paths beneath it and every file still gets its own BitGraph beside it.
 */
const FORBIDDEN_ROOTS = new Set(["/", "/Users", "/Volumes", "/System", "/Library", "/private", "/var", "/tmp", "/opt", "/usr", "/etc", "/Applications"]);

function refuseUnreasonableRoot(root: string): void {
  const trimmed = root.replace(/\/+$/, "") || "/";
  const segments = trimmed.split(sep).filter((s) => s !== "");
  const isVolumeRoot = segments.length === 2 && segments[0] === "Volumes";
  if (FORBIDDEN_ROOTS.has(trimmed) || segments.length === 0 || isVolumeRoot) {
    throw new Error(
      `these files have no folder in common except ${trimmed}, which is not somewhere to keep BitGraphs. ` +
        `Drop things that live nearer each other, or drop one folder.`,
    );
  }
}

/** The deepest directory every path is inside. */
export function commonRoot(dirs: readonly string[]): string {
  if (dirs.length === 0) return "";
  const split = dirs.map((d) => d.split(sep));
  const first = split[0]!;
  let i = 0;
  outer: for (; i < first.length; i++) {
    for (const parts of split) {
      if (parts[i] !== first[i]) break outer;
    }
  }
  const joined = first.slice(0, i).join(sep);
  return joined === "" ? sep : joined;
}

/**
 * Everything the proof view needs about one file, read from the folder.
 *
 * ⚠️ NOTHING IS FETCHED. The proof, the set it belongs to and the anchors are
 * whatever is on disk. What is missing says so.
 */
export interface Described {
  /** The file this page is about, on disk. For a recording folder, inside it. */
  filePath: string | null;
  evidence: Evidence | null;
  /**
   * The evidence file exactly as it is on disk.
   *
   * ⚠️ For a set/2 member the inclusion path in here is the ONLY thing that
   * puts this file inside that set: the proof commits to a root, not a list.
   * A page that shows the proof raw and not this is not showing everything.
   */
  evidenceRaw: string | null;
  proof: BitGraphProof | null;
  /** The committed artifact beside a set's proof, base64: the manifest or the root document. */
  committedB64: string | null;
  /** Every position this folder holds for these bytes, oldest first. */
  positions: Array<{ epochId: string; counter: string }>;
  /** A recording's files, the first 500, so the page can list what it holds and open any of them. */
  members?: Array<{ name: string; rel: string; bytes: number; originDigestB64: string }>;
  /** How many there really are. */
  memberCount?: number;
}

/**
 * What to describe: the evidence file, when there is one, or the member
 * itself, when the set was too big to fan out.
 */
export type DescribeTarget =
  | { evidencePath: string; originDigestB64?: string }
  | { originDigestB64: string; position: { epochId: string; counter: string } };

export async function describe(root: string, target: DescribeTarget | string): Promise<Described> {
  const { readFile } = await import("node:fs/promises");
  const t: DescribeTarget = typeof target === "string" ? { evidencePath: target } : target;

  let evidence: Evidence | null = null;
  let evidenceRaw: string | null = null;

  if ("evidencePath" in t) {
    /* ⚠️ A RECORDING FOLDER HAS NO EVIDENCE FILE. Its `proof.json` IS the
     * proof, which is the whole point of the shape, so a path ending there
     * means "read this bundle" rather than "read this evidence". */
    if (t.evidencePath.endsWith("/proof.json")) return describeBundle(dirname(t.evidencePath), t.originDigestB64);
    evidence = await readEvidence(t.evidencePath);
    evidenceRaw = evidence === null ? null : await readFile(t.evidencePath, "utf8").catch(() => null);
  } else {
    /* ⚠️ BUILT FROM members.jsonl, WHICH IS WHERE THE MEMBERSHIP LIVES. Above
     * a few thousand members nothing is written beside each file, so this is
     * the ordinary path for a big set, not a fallback. */
    const rows = await readMembers(root, t.position);
    const row = rows.get(t.originDigestB64);
    if (row !== undefined) {
      const ref = pathsFor(root).positionRef(t.position.epochId, t.position.counter);
      const kind: "set/1" | "set/2" = row.memberProof === undefined ? "set/1" : "set/2";
      evidence = evidenceFromMember(row, t.position, kind, rows.size, ref);
      evidenceRaw = JSON.stringify(evidence, null, 2);
    }
  }
  if (evidence === null) return { filePath: null, evidence: null, evidenceRaw: null, proof: null, committedB64: null, positions: [] };

  const paths = pathsFor(root);
  if (evidence.proof.kind === "inline") {
    return { filePath: null, evidence, evidenceRaw, proof: evidence.proof.proof, committedB64: null, positions: [evidence.position] };
  }
  const dir = paths.position(evidence.position.epochId, evidence.position.counter);
  let proof: BitGraphProof | null = null;
  let committedB64: string | null = null;
  try {
    proof = JSON.parse(await readFile(join(dir, "proof.json"), "utf8")) as BitGraphProof;
  } catch {
    proof = null;
  }
  try {
    committedB64 = Buffer.from(await readFile(join(dir, "manifest.json"))).toString("base64");
  } catch {
    committedB64 = null;
  }
  return { filePath: null, evidence, evidenceRaw, proof, committedB64, positions: [evidence.position] };
}

/**
 * A recording folder, read as it stands.
 *
 * Everything is right there: `proof.json` is the proof, `manifest.json` is
 * what it committed, `members.jsonl` says which file is which member. Nothing
 * points anywhere else, which is why the shape was worth going back to.
 */
async function describeBundle(dir: string, originDigestB64?: string): Promise<Described> {
  const { readFile } = await import("node:fs/promises");
  let proof: BitGraphProof | null = null;
  try {
    proof = JSON.parse(await readFile(join(dir, "proof.json"), "utf8")) as BitGraphProof;
  } catch {
    return { filePath: null, evidence: null, evidenceRaw: null, proof: null, committedB64: null, positions: [] };
  }
  const committed = await readFile(join(dir, "manifest.json")).catch(() => null);
  const committedB64 = committed === null ? null : Buffer.from(committed).toString("base64");

  const commit = (proof as { commit?: { epochId?: unknown; counter?: unknown } }).commit;
  const position = {
    epochId: typeof commit?.epochId === "string" ? commit.epochId : "",
    counter: typeof commit?.counter === "string" ? commit.counter : String(commit?.counter ?? ""),
  };

  /* A set says which member this file is; a lone recording is its own. */
  const rows: MemberRow[] = [];
  const text = await readFile(join(dir, "members.jsonl"), "utf8").catch(() => null);
  if (text !== null) {
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      try {
        rows.push(JSON.parse(line) as MemberRow);
      } catch {
        /* one member, not the file */
      }
    }
  }
  /* Opened from the ledger nobody names a member, so the first one stands
   * for the recording; the page says which of N it is. */
  const row = originDigestB64 !== undefined
    ? rows.find((r) => r.originDigestB64 === originDigestB64)
    : rows[0];
  const members = rows.slice(0, 500).map((r) => ({ name: r.name, rel: r.rel, bytes: r.bytes, originDigestB64: r.originDigestB64 }));
  const memberCount = rows.length;

  let filePath: string | null = row !== undefined ? join(dir, ...row.rel.split("/")) : null;
  if (filePath === null && rows.length === 0) {
    /* A lone recording: the one file in the folder that is not ours. */
    const own = new Set(["proof.json", "manifest.json", "members.jsonl", "anchors-status.json", "ethereum-anchors"]);
    const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => !own.has(n) && !n.startsWith("."));
    if (names.length === 1) filePath = join(dir, names[0]!);
  }

  let evidence: Evidence | null = null;
  if (row !== undefined) {
    const kind: "set/1" | "set/2" = row.memberProof === undefined ? "set/1" : "set/2";
    evidence = evidenceFromMember(row, position, kind, rows.length, ".");
  } else if (rows.length === 0) {
    /* A lone recording: the proof stands on its own and the file beside it is
     * the original. Named and sized from that file, so the evidence the page
     * shows raw is about something (it used to say name "" and 0 bytes). */
    const attribution = (proof as { attribution?: { message?: unknown; title?: unknown } }).attribution;
    const size = filePath === null ? 0 : await stat(filePath).then((s) => s.size).catch(() => 0);
    evidence = {
      version: "bitgraph-evidence/1",
      file: { name: filePath === null ? "" : filePath.split("/").pop() ?? "", bytes: size },
      placement: (typeof attribution?.title === "string" ? attribution.title : "trailer/1") as Evidence["placement"],
      originDigestB64: typeof attribution?.message === "string" ? attribution.message : "",
      artifactDigestB64: (proof as { artifact?: { digestB64?: string } }).artifact?.digestB64 ?? "",
      position,
      proof: { kind: "inline", proof },
      writtenAt: new Date().toISOString(),
    };
  }
  return {
    filePath,
    evidence,
    evidenceRaw: evidence === null ? null : JSON.stringify(evidence, null, 2),
    proof,
    committedB64,
    positions: [position],
    members,
    memberCount,
  };
}

/** Every file under a folder, for a drop of a folder. Re-exported so one module answers "what did they drop". */
export { walk, BITGRAPHS_DIR, readdir };
