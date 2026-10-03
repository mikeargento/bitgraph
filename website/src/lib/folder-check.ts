/* The skeptic's drop: the receiving half of the Folder's party trick.
 *
 * The BitGraph Folder records a dragged-in directory, which a browser cannot.
 * A browser CAN walk a dragged-in directory read-only, so the site gets to
 * CHECK one. The person this serves is the stranger who is handed an export
 * folder and would otherwise have to either trust the folder's own page
 * (which the folder wrote about itself) or run a CLI tool.
 *
 * Three tools each see one side of an export today; this walks all three in
 * one gesture, entirely client-side reads:
 *
 *   1. bytes vs proof     hash the artifact, compare to proof.json's digest;
 *                         a fused export is settled by its ORIGINAL, rebuilt
 *                         with the registered placement; a set member the
 *                         same way, through the manifest its proof carries
 *   2. proof vs ledger    the ledger's copy at the CLAIMED position
 *   3. anchors vs chain   the folder's anchor + witness files against the
 *                         ledger's window for that position
 *
 * Everything here is a read: hashing is local, and every request is a lookup.
 * Nothing in this module can mint a recording.
 *
 * Discovery is BY CONTENT, the same rule bitgraph-audit uses: a directory
 * holding a proof.json is an export, whatever it is named. The prune rules
 * came from droppable()/droppableUnder() in the retired BitGraph Folder
 * (removed 2026-09-01; see tag folder-v1.15.1 for the source): dot-named
 * entries are machinery everywhere, and files/ holds hard links to bytes
 * already inside the exports (walking it would count every recording twice).
 * They stand alone now and are no longer mirroring anything.
 *
 * An export dir holds at most three things beside the artifact: proof.json,
 * ethereum-anchors/, and, for a fused recording, new-file/ — the bytes the
 * proof's digest actually describes, written whole by the site's own export
 * (bitgraph-camera downloadZip, and the proof page's package). It is part of
 * the export, not a loose file in the drop: treating it as one both robbed
 * the export of the only bytes that hash to its proof and left a second,
 * unrelated card sitting under the row.
 *
 * A set (N files under one slot, placement set/1) exports one such unit per
 * member, each carrying the SAME proof.json: the set proof, whose signed
 * digest is the manifest of every member's fused digest and whose metadata
 * carries that manifest. No file in the unit hashes to the digest; a member
 * is judged by the manifest, and the manifest by hashing to the signature.
 *
 * A tree/1 BitGraph (2026-10-03, everything the site makes now) exports none
 * of that: no folder, no proof.json, no copy of the file. Its export is ONE
 * JSON file, bitgraph-export/1, with SPEC.md beside it, and it is checked by
 * verifyExport against whichever files it covers in the same drop (the end of
 * this module: readTreeExports, checkTreeExports). The package checks above
 * are untouched and still read every package made before then.
 */

import { PKG_COMMITTED_DIR, PKG_ORIGINAL_DIR, PKG_LEGACY_NEW_FILE_DIR, PKG_README, PKG_KNOWN_DIRS } from "./package-layout.ts";
import { isFuseName } from "./fuse-core.ts";
// Explicit .ts specifiers, so node's test runner can load this module (the
// export/1 check below is tested there); the bundler reads them the same way.
import {
  hashFile,
  isBitGraphProof,
  verifyProofSignature,
  proofHashB64,
  type BitGraphProof,
} from "./bitgraph.ts";
import { toUrlSafeB64 } from "./explorer.ts";
import { blockTimeFromHeader } from "./export-pages.ts";
import {
  FUSE_ATTRIBUTION_NAME,
  KNOWN_TREE_SPEC_HASHES,
  MerkleTree,
  SET_PLACEMENT_ID,
  SET2_PLACEMENT_ID,
  SET_MEMBER_METADATA_KEY,
  TREE_MEMBER_CATEGORIES,
  base64ToBytes,
  buildTreeMemberEvidence,
  bytesToBase64,
  decodeTreeLeaves,
  hexToBytes,
  parseExport,
  parseTreeMemberEvidence,
  readFuseAttribution,
  readSetMetadata,
  treeLeafHash,
  verifyExport,
  verifyFuse,
  verifyFuseMember,
  verifyTreeMember,
  type BitGraphExport,
  type BitGraphProof as VerifyProof,
  type ExportClaim,
  type ExportLookups,
  type ExportVerifyResult,
  type TreeLeaf,
  type TreeMemberEvidence,
  type TreeVerifyResult,
} from "@mikeargento/bitgraph-verify";

/* The site keeps its own looser proof type (version: string); the reader
 * package narrows it. Same cast fuse-client.ts makes, for the same reason. */
const asVerify = (proof: BitGraphProof): VerifyProof => proof as unknown as VerifyProof;

/* A set proof, by its signed marker only: the profile id as the attribution
 * name and the set placement as the title. Nothing unsigned (the metadata
 * manifest) decides this; the manifest is read only once the proof says it
 * is a set, and then only through verifyFuseMember, which binds it to the
 * signed digest before reading a row. */
const isSetProof = (proof: BitGraphProof): boolean =>
  isFuseName(proof.attribution?.name) && (proof.attribution?.title === SET_PLACEMENT_ID || proof.attribution?.title === SET2_PLACEMENT_ID);
const isSet2Proof = (proof: BitGraphProof): boolean =>
  isFuseName(proof.attribution?.name) && proof.attribution?.title === SET2_PLACEMENT_ID;

/* ── Walking the dropped tree ── */

/** One file out of the dropped tree. `path` is segments relative to the drop:
 *  the first segment is the dropped item's own name. */
export interface WalkedFile {
  file: File;
  path: string[];
}

/* Structural view of FileSystemEntry, so the walk (and its tests) depend only
 * on the shape webkitGetAsEntry actually provides, not on DOM lib types. */
export interface EntryLike {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (ok: (f: File) => void, err?: (e: unknown) => void) => void;
  createReader?: () => {
    readEntries: (ok: (e: EntryLike[]) => void, err?: (e: unknown) => void) => void;
  };
}

/**
 * Capture the drop's FileSystemEntry handles. MUST be called synchronously
 * inside the drop handler: DataTransferItemList is neutered after the first
 * await, and webkitGetAsEntry returns null from then on.
 *
 * Returns null when nothing in the drop is a directory — plain files keep the
 * existing dataTransfer.files path, which this module has no business in.
 */
export function entriesFromDataTransfer(dt: DataTransfer): EntryLike[] | null {
  const items = dt.items;
  if (!items || items.length === 0) return null;
  const entries: EntryLike[] = [];
  let hasDirectory = false;
  for (let i = 0; i < items.length; i++) {
    const getEntry = (items[i] as DataTransferItem & {
      webkitGetAsEntry?: () => unknown;
    }).webkitGetAsEntry;
    const entry = typeof getEntry === "function" ? (getEntry.call(items[i]) as EntryLike | null) : null;
    if (!entry) continue;
    entries.push(entry);
    if (entry.isDirectory) hasDirectory = true;
  }
  return hasDirectory ? entries : null;
}

const readAllEntries = (dir: EntryLike): Promise<EntryLike[]> =>
  new Promise((resolve) => {
    const reader = dir.createReader?.();
    if (!reader) return resolve([]);
    const all: EntryLike[] = [];
    // ⚠️ readEntries returns AT MOST 100 entries per call in every browser —
    // it must be called again until it answers with an empty batch, or a
    // 150-recording folder silently loses a third of its exports.
    const next = () =>
      reader.readEntries(
        (batch) => {
          if (batch.length === 0) return resolve(all);
          all.push(...batch);
          next();
        },
        () => resolve(all),
      );
    next();
  });

const fileOfEntry = (entry: EntryLike): Promise<File | null> =>
  new Promise((resolve) => {
    if (!entry.file) return resolve(null);
    entry.file(
      (f) => resolve(f),
      () => resolve(null),
    );
  });

/**
 * Walk dropped entries into a flat file list with relative paths. Dot-named
 * entries (\.bitgraph/, .thumbs/, .DS_Store, .bitgraph-pending.json) are
 * machinery or OS noise everywhere and are pruned without descending — the
 * same `-name '.*'` rule the Folder's own walker applies.
 */
export async function walkEntries(
  entries: EntryLike[],
  /** Called with the running file count. A whole-folder drop spends seconds
   *  in here before anything can be rendered (a 2000-recording folder is
   *  ~10,000 files and one round trip per directory), and with no signal at
   *  all that reads as a dead drop zone. Throttled: this fires on a schedule,
   *  not per file, so it cannot itself become the cost. */
  onProgress?: (files: number) => void,
): Promise<WalkedFile[]> {
  const out: WalkedFile[] = [];
  let lastTick = 0;
  const tick = () => {
    if (!onProgress) return;
    const now = Date.now();
    if (now - lastTick < 120) return;
    lastTick = now;
    onProgress(out.length);
  };
  const visit = async (entry: EntryLike, path: string[]): Promise<void> => {
    if (entry.name.startsWith(".")) return;
    const here = [...path, entry.name];
    if (entry.isFile) {
      const f = await fileOfEntry(entry);
      if (f) out.push({ file: f, path: here });
      tick();
      return;
    }
    if (entry.isDirectory) {
      for (const child of await readAllEntries(entry)) await visit(child, here);
    }
  };
  for (const entry of entries) await visit(entry, []);
  onProgress?.(out.length);
  return out;
}

/* ── Choosing a folder without the word "upload" ──
 *
 * A webkitdirectory input makes the browser put up its own confirmation, and
 * that dialog says UPLOAD: "Upload N files to this site?" in Chrome, the same
 * word in Safari and Firefox. It is the browser's wording for reading a
 * directory and it cannot be suppressed or reworded, which is intolerable on
 * a page whose entire claim is that nothing is uploaded. The browser
 * contradicts the product in the browser's own voice.
 *
 * showDirectoryPicker asks a different question: "Let this site view files?"
 * That is what actually happens, so it is the ONLY way a folder is ever
 * chosen here. There is no webkitdirectory fallback: warning about that
 * dialog in advance confused people more than the dialog did, and showing it
 * alarmed them, so it is simply never triggered. Where this API is missing
 * (Safari, Firefox, and Brave, which is Chromium with the File System Access
 * API off for privacy) the folder link is not rendered at all. Dragging a
 * folder in works in every browser and raises nothing, which is why the copy
 * leads with "Drag a folder".
 */

export type DirHandle = {
  kind: "file" | "directory";
  name: string;
  entries: () => AsyncIterableIterator<[string, DirHandle]>;
  getFile: () => Promise<File>;
  /** Chromium's permission pair. A stored handle answers "granted" on later
   *  visits when the person told Chrome to allow it every time; "prompt"
   *  means one requestPermission inside a click puts it back to granted.
   *  Optional because only real handles carry them. */
  queryPermission?: (d: { mode: "read" }) => Promise<PermissionState>;
  requestPermission?: (d: { mode: "read" }) => Promise<PermissionState>;
};

/** Walk a directory HANDLE into the walk's shape. The handle is the re-usable
 *  form of a hand-over: unlike a drop's entries, it can be stored and asked
 *  to read again later, which is what makes "sync again without a drag"
 *  possible at all. Same prunes as everywhere. */
export async function walkDirectoryHandle(
  root: DirHandle,
  onProgress?: (files: number) => void,
): Promise<WalkedFile[]> {
  const out: WalkedFile[] = [];
  let lastTick = 0;
  const visit = async (dir: DirHandle, path: string[]): Promise<void> => {
    for await (const [name, handle] of dir.entries()) {
      if (name.startsWith(".")) continue;
      const here = [...path, name];
      if (handle.kind === "file") {
        try { out.push({ file: await handle.getFile(), path: here }); } catch { continue; }
        const now = Date.now();
        if (onProgress && now - lastTick >= 120) { lastTick = now; onProgress(out.length); }
      } else {
        await visit(handle, here);
      }
    }
  };
  await visit(root, [root.name]);
  onProgress?.(out.length);
  return out;
}

export const supportsDirectoryPicker = () =>
  typeof window !== "undefined" &&
  typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === "function";

/**
 * Read a directory the person chooses, no upload wording anywhere.
 * Returns null when they cancel. Same prunes and same shape as the walk.
 */
export async function pickDirectory(onProgress?: (files: number) => void): Promise<{ walked: WalkedFile[]; handle: DirHandle } | null> {
  const show = (window as unknown as { showDirectoryPicker: () => Promise<DirHandle> }).showDirectoryPicker;
  let root: DirHandle;
  try {
    root = await show();
  } catch {
    return null; // cancelled, or permission refused
  }
  return { walked: await walkDirectoryHandle(root, onProgress), handle: root };
}

/* ── Discovery by content ── */

export interface ExportCandidate {
  /** The export directory's own name, e.g. "BitGraph (sunset.jpg)". */
  dirName: string;
  proofFile: File;
  /** Files directly in the export dir that are not machinery — normally
   *  exactly one, the artifact. For a fused recording this is the ORIGINAL:
   *  what the proof commits is `newFile` below. For a set member it is the
   *  member's original, and what the proof commits is the set's manifest. */
  artifactCandidates: File[];
  /** new-file/<name>, for a fused export: the bytes the proof's digest
   *  describes. Absent from an export whose keeper kept only the original,
   *  which is the durable state and still verifies (by reconstruction). */
  newFile?: File;
  /** member.json, for a set/2 member: its row, leaf index, count and path,
   *  which the verifier needs to place it under the committed root. A set/1
   *  export has none; its proof.json carries the whole list. */
  memberEvidence?: File;
  /** The export's own index.html, held aside rather than discarded: when it
   *  is the ONLY file beside proof.json it may BE the artifact — an export
   *  whose recorded file is itself named index.html carries no receipt (the
   *  generator refuses to overwrite the very bytes the proof describes). */
  receipt?: File;
  anchors: {
    before?: File;
    after?: File;
    beforeWitness?: File;
    afterWitness?: File;
  };
}

export interface DropScan {
  exports: ExportCandidate[];
  /** Files belonging to no export. With no exports anywhere this is the whole
   *  drop and the caller runs the ordinary hash-and-check flow over it. */
  strays: File[];
}

const dirKeyOf = (path: string[]) => path.slice(0, -1).join("/");

/**
 * Sort the walked files into exports and strays.
 *
 * A dir directly holding a proof.json is an export. Its direct children split
 * into the proof, its own page (index.html, derived, rebuilt on every pass —
 * hashing it would only report honest-but-useless "not on record" noise), the
 * ethereum-anchors/ evidence, and the artifact.
 *
 * Only once exports are found do two more prunes apply, both scoped to the
 * top of the drop: `files/` (hard links to bytes already inside the exports —
 * counting them again would double every verdict) and the root contact sheet
 * index.html (the folder's own derived page). A dropped folder with NO
 * proof.json anywhere gets no pruning at all: it is just files, including a
 * folder that happens to be named files — dragging files/ itself in is the
 * one gesture that finally works without select-all.
 */
export function discoverDrop(walked: WalkedFile[]): DropScan {
  const exportDirs = new Set<string>();
  for (const w of walked) {
    if (w.path[w.path.length - 1] === "proof.json") exportDirs.add(dirKeyOf(w.path));
  }

  const byDir = new Map<string, ExportCandidate>();
  const strays: File[] = [];

  for (const w of walked) {
    const name = w.path[w.path.length - 1];

    // Longest export-dir prefix that owns this file, if any.
    let owner: string | null = null;
    for (let end = w.path.length - 1; end > 0; end--) {
      const key = w.path.slice(0, end).join("/");
      if (exportDirs.has(key)) { owner = key; break; }
    }

    if (owner === null) {
      if (exportDirs.size > 0) {
        // files/ at the top of the drop: same bytes as the artifacts.
        const filesIdx = w.path.indexOf("files");
        if (filesIdx === 0 || filesIdx === 1) continue;
        // The root contact sheet (dropped alone or one level inside the
        // dropped folder). Deeper index.html files are someone's own.
        if (name === "index.html" && w.path.length <= 2) continue;
      }
      strays.push(w.file);
      continue;
    }

    let cand = byDir.get(owner);
    if (!cand) {
      const segs = owner.split("/");
      cand = { dirName: segs[segs.length - 1], proofFile: w.file, artifactCandidates: [], anchors: {} };
      byDir.set(owner, cand);
    }
    const rel = w.path.slice(owner.split("/").length);

    if (rel.length === 1) {
      if (rel[0] === "proof.json") cand.proofFile = w.file;
      else if (rel[0] === "index.html") cand.receipt = w.file;
      else if (rel[0] === "member.json") cand.memberEvidence = w.file;
      else if (rel[0] === PKG_README) { /* the package's own explanation: not a recording, not a stray */ }
      else cand.artifactCandidates.push(w.file);
    } else if (rel.length === 2 && (rel[0] === PKG_COMMITTED_DIR || rel[0] === PKG_LEGACY_NEW_FILE_DIR)) {
      // committed/ since 2026-10-01; new-file/ in every package made before it.
      cand.newFile = w.file;
    } else if (rel.length === 2 && rel[0] === PKG_ORIGINAL_DIR) {
      // The original the committed file was made from: a candidate exactly as it was at the top level.
      cand.artifactCandidates.push(w.file);
    } else if (rel.length === 2 && PKG_KNOWN_DIRS.has(rel[0]!)) {
      // The ceiling files and the BitGraphed copy: evidence that travels with the package.
    } else if (rel.length === 2 && rel[0] === "ethereum-anchors") {
      if (rel[1] === "anchor-before.json") cand.anchors.before = w.file;
      else if (rel[1] === "anchor-after.json") cand.anchors.after = w.file;
      else if (rel[1] === "anchor-before-witness.json") cand.anchors.beforeWitness = w.file;
      else if (rel[1] === "anchor-after-witness.json") cand.anchors.afterWitness = w.file;
      // anything else in ethereum-anchors/ is not evidence we know; ignore.
    } else {
      // A subfolder someone put inside an export dir: just files.
      strays.push(w.file);
    }
  }

  // Exports in walk order (insertion order of the map follows the walk).
  return { exports: [...byDir.values()], strays };
}

/* ── Find a file by digest in a drop ── */

/** Hash files until one's digest is in `digests` (standard base64, the
 *  alphabet hashFile answers in). One hashing pass whatever the size of the
 *  set: a set proof's page hands over every member's origin and fused digest
 *  at once, and hashing a Pictures folder once per digest would be the cost.
 *  Short-circuits on the match; yields between files so the UI paints and
 *  Safari reclaims buffers. `digest` names which one matched. */
export async function findAnyMatchInFiles(
  files: File[],
  digests: ReadonlySet<string>,
  onProgress?: (done: number, total: number) => void,
  /**
   * Filled with digest -> file as the pass goes, when the caller wants to keep
   * what this cost. Hashing a folder is the expensive part of every one of
   * these searches, and a set's page needs the same digests again straight
   * afterwards to ask the ledger which file is its member. Without this it
   * hashed everything twice and then looked at only the first 2,000 files
   * (Mike, 2026-09-07: "it gets hung on that first 30k of 30k screen").
   * Partial when the pass short-circuits on a match, which is fine: the second
   * use only happens when there was none.
   */
  collect?: Map<string, File>,
): Promise<{ match: File | null; digest: string | null; checked: number }> {
  let done = 0;
  for (const f of files) {
    const d = await hashFile(f).catch(() => null);
    done++;
    onProgress?.(done, files.length);
    if (d !== null) {
      if (collect && !collect.has(d)) collect.set(d, f);
      if (digests.has(d)) return { match: f, digest: d, checked: done };
    }
    await new Promise((r) => setTimeout(r, 0));
  }
  return { match: null, digest: null, checked: done };
}

/** Hash files until one matches `digestB64`. The one-digest form of
 *  findAnyMatchInFiles, which is what every existing caller wants. */
export async function findMatchInFiles(
  files: File[],
  digestB64: string,
  onProgress?: (done: number, total: number) => void,
  collect?: Map<string, File>,
): Promise<{ match: File | null; checked: number }> {
  const { match, checked } = await findAnyMatchInFiles(files, new Set([digestB64]), onProgress, collect);
  return { match, checked };
}

/** The "find it for me" version of the file-match check: a drop may hold many
 *  files AND folders, and the matching file is found by hashing, not by the
 *  person knowing which one it is. MUST be called synchronously from the drop
 *  handler (the entry capture dies after the first await). A browser cannot
 *  search the machine — but it can search whatever the person hands it. */
/** A drop, read out of the DataTransfer while that is still legal. */
export interface CapturedDrop {
  /** Directory entries, when the drop held any. Null means plain files. */
  entries: EntryLike[] | null;
  /** dataTransfer.files, the fallback when no directory was in the drop. */
  files: File[];
}

/**
 * Read a drop into something that survives an await. MUST be called
 * synchronously inside the drop handler.
 *
 * This exists as its own function so the rule cannot be broken by accident.
 * findMatchInDrop used to take the DataTransfer itself and do this on its
 * first line, which was correct but only as long as every caller kept it out
 * of an async tail — and the failure is silent and awful when someone does
 * not: DataTransferItemList is neutered once the handler returns, so
 * webkitGetAsEntry starts answering null, entriesFromDataTransfer reports "no
 * directories here", and the whole thing degrades to dataTransfer.files.
 *
 * That fallback is not merely smaller, it is misleading. A mixed drop's
 * .files holds the loose files PLUS one 0-byte pseudo-file per folder, so a
 * dump of six files and three folders looks like nine files, hashes nine
 * things, finds nothing, and reports that it searched everything you gave it.
 * The folders' actual contents are never read. Taking the captured drop as a
 * parameter makes the capture the caller's visible job.
 */
export function captureDrop(dt: DataTransfer): CapturedDrop {
  return { entries: entriesFromDataTransfer(dt), files: Array.from(dt.files) };
}

export async function findAnyMatchInDrop(
  captured: CapturedDrop,
  digests: ReadonlySet<string>,
  onProgress?: (done: number, total: number) => void,
  /** Running file count while the folder is being READ, before hashing can
   *  begin. Dropping a Pictures folder here is the case this box is for, and
   *  the read is the longest silent stretch of it. */
  onWalk?: (files: number) => void,
  collect?: Map<string, File>,
): Promise<{ match: File | null; digest: string | null; checked: number }> {
  const files = captured.entries
    ? (await walkEntries(captured.entries, onWalk)).map((w) => w.file)
    : captured.files;
  return findAnyMatchInFiles(files, digests, onProgress, collect);
}

/** The one-digest form of findAnyMatchInDrop. */
export async function findMatchInDrop(
  captured: CapturedDrop,
  digestB64: string,
  onProgress?: (done: number, total: number) => void,
  onWalk?: (files: number) => void,
  collect?: Map<string, File>,
): Promise<{ match: File | null; checked: number }> {
  const { match, checked } = await findAnyMatchInDrop(captured, new Set([digestB64]), onProgress, onWalk, collect);
  return { match, checked };
}

/* ── The check itself ── */

export interface ExportCheckResult {
  dirName: string;
  fileName: string | null;
  /** The artifact whose bytes matched the proof — cached for the proof page
   *  on click-through. Null when the bytes differ or no file was found. */
  matchedFile: File | null;
  /** The file sitting beside proof.json whether or not its bytes match —
   *  the viewer thumbnails it either way (a red row still shows what is
   *  there). Null only when the export holds no file at all. */
  artifactFile: File | null;
  /** The lower-bound anchor's Ethereum block and its timestamp (unix
   *  seconds), decoded from the export's own witness file; the upper bound
   *  stands in when the lower is missing. The viewer's causal sort and day
   *  grouping — the sheet's exact keys, computed client-side now. */
  block: number | null;
  ts: number | null;
  proof: BitGraphProof | null;
  counter: string | null;
  epochUrlSafe: string | null;
  digestUrlSafe: string | null;
  /** Ledger write moment (ms) for the claimed position, when known. */
  writeTime: number | null;
  /** True when the claimed position exists on the ledger — the proof page
   *  link is meaningful even for a row that failed a later side. */
  onLedger: boolean;
  /** null while the verdict is still streaming in (the day renders
   *  instantly from local data; verification catches up per row). */
  ok: boolean | null;
  /** The specific failing side, factual, one line. Null when ok/pending. */
  failure: string | null;
  /** proof.json's walk-time size and mtime, facts about the export. */
  proofSize: number | null;
  proofMtime: number | null;
}

/**
 * The one `failure` string that is NOT a claim about the file.
 *
 * Every other failure says something went wrong with THIS recording; this one
 * says the check did not happen. Callers must keep it out of any "does not
 * match" tally, or a bad afternoon on the network reads as hundreds of
 * forgeries. Exported so the row and the summary agree on which is which.
 */
export const LEDGER_UNREACHABLE = "could not reach BitGraph's copy";

/** True when the row has no verdict because the ledger could not be read. */
export const isUnchecked = (r: { ok: boolean | null; failure: string | null }) =>
  r.ok === false && r.failure === LEDGER_UNREACHABLE;

export interface CheckProgress {
  onHash?: (done: number, total: number) => void;
  onCheck?: (done: number, total: number) => void;
}

type LedgerEntry = { proof: BitGraphProof; writeTime: number | null };

const normCounter = (c: unknown) => String(parseInt(String(c ?? ""), 10));

/* An anchor's Ethereum block lives in TWO shapes depending on when it was
 * written. Modern: ethereum.blockNumber / ethereum.blockHash. Pre-`ethereum`
 * field (early 2026): attribution.title holds an etherscan URL with the
 * number in it, attribution.message holds the block hash. Reading only one
 * shape is the bug that made old exports say "sealing" forever (1.3.8). */
function anchorBlockOf(anchor: Record<string, unknown> | null): { blockNumber: number | null; blockHash: string | null } {
  if (!anchor) return { blockNumber: null, blockHash: null };
  const eth = anchor.ethereum as { blockNumber?: number; blockHash?: string } | undefined;
  const proof = anchor.proof as Record<string, unknown> | undefined;
  const attr = (proof?.attribution ?? anchor.attribution) as { title?: string; message?: string } | undefined;
  const fromTitle = attr?.title?.match(/\/block\/(\d+)/)?.[1];
  const blockNumber = eth?.blockNumber ?? (fromTitle ? parseInt(fromTitle, 10) : null);
  const blockHash = eth?.blockHash ?? attr?.message ?? null;
  return {
    blockNumber: typeof blockNumber === "number" && Number.isFinite(blockNumber) ? blockNumber : null,
    blockHash: typeof blockHash === "string" ? blockHash.toLowerCase() : null,
  };
}

async function parseJsonFile(f: File): Promise<Record<string, unknown> | null> {
  try {
    const obj = JSON.parse(await f.text());
    return obj && typeof obj === "object" && !Array.isArray(obj) ? (obj as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Side 1 for a set proof: the member beside proof.json, judged through the
 *  manifest. verifyFuseMember binds the manifest first (strict parse, hash
 *  to the signed digest, commitment to the slot record) and only then reads
 *  a row, so a forged or tampered manifest can never name a member. The
 *  ORIGINAL settles the row (SET_MEMBER_FROM_ORIGIN: rebuilt with the row's
 *  placement, the rebuild has to reproduce the row's fused digest); new-file/
 *  answers (SET_MEMBER_DIRECT) only when no original is present, the direct
 *  pass's rule, so an intact new-file/ never carries a corrupted original to
 *  green. Yields between files as the other passes do. Null when nothing in
 *  the unit is a member. */
async function findSetMember(proof: BitGraphProof, cand: ExportCandidate, member: unknown): Promise<File | null> {
  const fromOrigin = cand.artifactCandidates.length > 0;
  const files = fromOrigin ? cand.artifactCandidates : cand.newFile ? [cand.newFile] : [];
  const accepted = fromOrigin ? "SET_MEMBER_FROM_ORIGIN" : "SET_MEMBER_DIRECT";
  for (const f of files) {
    const bytes = await f.arrayBuffer().catch(() => null);
    if (bytes) {
      const v = await verifyFuseMember({ proof: asVerify(proof), bytes: new Uint8Array(bytes), ...(member !== null ? { member } : {}) }).catch(() => null);
      if (v?.category === accepted) return f;
    }
    await new Promise((res) => setTimeout(res, 0));
  }
  return null;
}

/** A set/2 member's evidence: member.json beside proof.json, else the copy proof.json itself carries under metadata; null when neither. */
async function memberEvidenceFor(proof: BitGraphProof, cand: ExportCandidate): Promise<unknown> {
  if (cand.memberEvidence) {
    const text = await cand.memberEvidence.text().catch(() => null);
    if (text !== null) {
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return null;
      }
    }
  }
  const md = (proof as unknown as { metadata?: Record<string, unknown> }).metadata;
  return md && typeof md === "object" ? md[SET_MEMBER_METADATA_KEY] ?? null : null;
}

/* ── The check itself: instant rows, streaming verification ──
 *
 * The day renders the moment the local scan finishes (proof.json fields and
 * the witness timestamps are all the rows need); hashing, signatures and the
 * ledger sides stream in per row afterwards. It was one sequential pass that
 * blocked rendering on the slowest network call, which read as "kind of
 * slow" the first time a real 157-export folder was dropped: browsing must
 * be instant, verification merely prompt.
 *
 * Read-only throughout. Batch lookups run 50 digests per request, three
 * requests in flight (the same shape the home drop uses against the same
 * endpoint); the per-position window lookups run five exports at a time —
 * CDN-cached for settled proofs. `apiBase` exists so Node harnesses can run
 * the pipeline against the live site.
 */

type Working = ExportCheckResult & {
  cand: ExportCandidate;
  claimedDigest: string | null;
  epochId: string | null;
  ledgerProof: BitGraphProof | null;
};

const stripWorking = (w: Working): ExportCheckResult => ({
  dirName: w.dirName,
  fileName: w.fileName,
  matchedFile: w.matchedFile,
  artifactFile: w.artifactFile,
  block: w.block,
  ts: w.ts,
  proof: w.proof,
  counter: w.counter,
  epochUrlSafe: w.epochUrlSafe,
  digestUrlSafe: w.digestUrlSafe,
  writeTime: w.writeTime,
  onLedger: w.onLedger,
  ok: w.ok,
  failure: w.failure,
  proofSize: w.proofSize,
  proofMtime: w.proofMtime,
});

/* Both page generators (the Folder's export.js and this site's
 * export-pages.ts) emit exactly this head, byte for byte, and a hand-written
 * page is vanishingly unlikely to. What it decides: an export whose only file
 * beside proof.json is an index.html holds either a recorded file that
 * happens to be named index.html (no receipt is written for those — writing
 * one would overwrite the artifact) or an orphaned receipt whose artifact
 * went missing. Bytes that match this signature are machinery, so the export
 * is missing its file; bytes that do not are the artifact. */
const RECEIPT_PREFIX =
  '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1"><title>';
const RECEIPT_CACHE_META =
  '</title><meta http-equiv="cache-control" content="no-cache, no-store, must-revalidate">';

async function looksLikeReceipt(f: File): Promise<boolean> {
  const head = await f.slice(0, 400).text().catch(() => "");
  return head.startsWith(RECEIPT_PREFIX) && head.includes(RECEIPT_CACHE_META);
}

/** The fast half: everything the day needs to render, no hashing and no
 *  network. Structural failures (unreadable proof, no file at all) are
 *  verdicts already; everything else is pending (`ok: null`). */
async function scanExportsLocal(candidates: ExportCandidate[]): Promise<Working[]> {
  const working: Working[] = [];
  for (const cand of candidates) {
    // A sole index.html beside proof.json is the artifact unless it is
    // provably a receipt; see RECEIPT_PREFIX. Promoted before the row is
    // built so fileName and the thumbnail read from it like any other file.
    if (cand.artifactCandidates.length === 0 && cand.receipt &&
        !(await looksLikeReceipt(cand.receipt))) {
      cand.artifactCandidates.push(cand.receipt);
    }
    // The row shows the file the person has in the folder: for a fused
    // export that is the ORIGINAL, which is also the only one of the pair a
    // container placement can thumbnail. new-file/ stands in when the
    // original is the part that went missing.
    const shown = cand.artifactCandidates[0] ?? cand.newFile ?? null;
    const w: Working = {
      cand,
      dirName: cand.dirName,
      fileName: shown?.name ?? null,
      matchedFile: null,
      artifactFile: shown,
      block: null,
      ts: null,
      proof: null,
      counter: null,
      epochUrlSafe: null,
      digestUrlSafe: null,
      writeTime: null,
      onLedger: false,
      ok: null,
      failure: null,
      proofSize: cand.proofFile.size,
      proofMtime: cand.proofFile.lastModified,
      claimedDigest: null,
      epochId: null,
      ledgerProof: null,
    };
    working.push(w);

    // The causal keys, straight from the export's own witness files: the
    // lower-bound block orders across epochs (counters restart daily), its
    // header carries the timestamp the day grouping reads.
    for (const side of [cand.anchors.beforeWitness, cand.anchors.afterWitness]) {
      if (w.block !== null || !side) continue;
      const witness = await parseJsonFile(side);
      const header = typeof witness?.headerRlpHex === "string" ? (witness.headerRlpHex as string) : null;
      const num = typeof witness?.blockNumber === "number" ? (witness.blockNumber as number) : null;
      if (num !== null) w.block = num;
      if (header) w.ts = blockTimeFromHeader(header) || null;
    }

    const proof = isBitGraphProof(await cand.proofFile.text().catch(() => ""));
    if (!proof) {
      w.ok = false;
      w.failure = "proof.json is not a BitGraph proof";
      continue;
    }
    w.proof = proof;
    w.claimedDigest = proof.artifact.digestB64;
    w.digestUrlSafe = toUrlSafeB64(proof.artifact.digestB64);
    w.counter = proof.commit?.counter ?? null;
    w.epochId = proof.commit?.epochId ?? null;
    w.epochUrlSafe = w.epochId ? toUrlSafeB64(w.epochId) : null;
    if (cand.artifactCandidates.length === 0 && !cand.newFile) {
      w.ok = false;
      w.failure = "no file beside proof.json";
    }
  }
  return working;
}

export interface FolderCheckCallbacks {
  /** The full row set, renderable, before any verification has run. */
  onRows?: (rows: ExportCheckResult[]) => void;
  /** One row's verdict landed. */
  onUpdate?: (index: number, row: ExportCheckResult) => void;
  /** Every verdict is in. */
  onDone?: (rows: ExportCheckResult[]) => void;
}

/* The fingerprint memo (skip unchanged exports having read nothing) lived
 * here 2026-08-06 to 2026-08-07 for the /folder browser's remembered syncs
 * and was removed with that page: every drop is now checked in full, from
 * the bytes in hand. */
export function startFolderCheck(
  candidates: ExportCandidate[],
  cb: FolderCheckCallbacks = {},
  apiBase = "",
): { done: Promise<ExportCheckResult[]> } {
  const done = (async () => {
    const working = await scanExportsLocal(candidates);
    cb.onRows?.(working.map(stripWorking));

    /* Ledger prefetch: every digest still needing a verdict, 50 per request,
     * three in flight. Each row awaits only its own digest's promise. null =
     * the lookup FAILED, kept distinct from an empty answer: an unreachable
     * ledger is our gap, "not on the ledger" is a verdict about the folder.
     * Memo-settled rows (ok already true) are not asked about at all — on a
     * settled folder the whole prefetch is nothing. */
    const keys = [...new Set(working.filter((w) => w.ok === null).map((w) => w.digestUrlSafe).filter((k): k is string => !!k))];
    const resolvers = new Map<string, (v: LedgerEntry[] | null) => void>();
    const ledgerFor = new Map<string, Promise<LedgerEntry[] | null>>();
    for (const k of keys) ledgerFor.set(k, new Promise((res) => resolvers.set(k, res)));
    void (async () => {
      const chunks: string[][] = [];
      for (let i = 0; i < keys.length; i += 50) chunks.push(keys.slice(i, i + 50));
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(3, chunks.length) }, async () => {
        while (next < chunks.length) {
          const mine = chunks[next++];
          // A whole folder arrives as dozens of these at once, and a burst is
          // exactly when a lookup is most likely to fail transiently. Giving
          // up on the first error marked 50 recordings at a time as unchecked
          // (and, before the server stopped conflating the two, as NOT ON THE
          // LEDGER). Three tries with backoff, then honestly unknown.
          let answered = false;
          for (let attempt = 0; attempt < 3 && !answered; attempt++) {
            if (attempt) await new Promise((r) => setTimeout(r, 400 * attempt * attempt));
            try {
              const r = await fetch(`${apiBase}/api/proofs/batch`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ digests: mine }),
              });
              if (!r.ok) throw new Error(String(r.status));
              const results = ((await r.json()) as {
                results?: Record<string, { proofs?: LedgerEntry[]; unavailable?: boolean }>;
              }).results || {};
              // `unavailable` is the server saying it could not read, per
              // digest. null carries that through as "we do not know", which
              // is a different row than "not on the ledger".
              for (const k of mine) {
                const entry = results[k];
                resolvers.get(k)?.(entry?.unavailable ? null : entry?.proofs || []);
              }
              answered = true;
            } catch { /* retry, then fall through to null below */ }
          }
          if (!answered) for (const k of mine) resolvers.get(k)?.(null);
        }
      }));
    })();

    const witnessCache = new Map<string, Promise<string | null>>();
    const fetchWitnessHeader = (blockNumber: number, blockHash: string): Promise<string | null> => {
      const key = `${blockNumber}:${blockHash}`;
      let p = witnessCache.get(key);
      if (!p) {
        p = (async () => {
          try {
            const r = await fetch(`${apiBase}/api/proofs/witness?block=${blockNumber}&hash=${encodeURIComponent(blockHash)}`);
            if (r.ok) return ((await r.json()) as { headerRlpHex?: string }).headerRlpHex?.toLowerCase() ?? null;
          } catch { /* witness unavailable — the check is skipped, not failed */ }
          return null;
        })();
        witnessCache.set(key, p);
      }
      return p;
    };

    async function verifyOne(w: Working): Promise<void> {
      if (!w.proof || !w.digestUrlSafe) return;

      const sig = await verifyProofSignature(w.proof).catch(() => ({ valid: false }));
      if (!sig.valid) { w.failure = "proof signature does not verify"; return; }

      // Side 1 — bytes vs proof. The artifact is whichever candidate matches;
      // one candidate that does not match is the headline tamper case.
      //
      // A set proof commits the manifest of its members' fused digests, so
      // nothing in the unit hashes to it: the member is settled through the
      // manifest, which proof.json carries UNSIGNED in its metadata and which
      // binds only by hashing to the signed digest. First, because for a
      // member's bytes the fused pass below answers NO_MATCH. Once settled,
      // the row falls through to side 2 and the other passes are skipped.
      if (isSetProof(w.proof)) {
        if (readSetMetadata(asVerify(w.proof)) === null) {
          // Reserved for the ABSENT manifest (or root document). A tampered
          // one is present and fails to bind underneath, which reads as
          // differing bytes: a forged manifest never earns the softer sentence.
          w.failure = isSet2Proof(w.proof) ? "proof.json carries no set root" : "proof.json carries no set manifest";
          return;
        }
        // A set/2 member is placed under the root by its evidence: member.json
        // beside proof.json, or the copy proof.json carries. Without it the
        // floor may hold but membership cannot be shown, and that is its own
        // honest sentence, distinct from tampered bytes.
        const evidence = isSet2Proof(w.proof) ? await memberEvidenceFor(w.proof, w.cand) : null;
        if (isSet2Proof(w.proof) && evidence === null) { w.failure = "no member.json beside proof.json"; return; }
        const member = await findSetMember(w.proof, w.cand, evidence);
        if (!member) { w.failure = "bytes differ from the proof"; return; }
        w.matchedFile = member;
        w.artifactFile = member;
        w.fileName = member.name;
      }
      // A fused proof commits the NEW file's digest, so the original beside
      // proof.json can never match it by hash. It settles this side the other
      // way round: the registered placement rebuilds the new bytes from it,
      // and the rebuild has to reproduce the committed digest. Tried first,
      // so a package holding both files is judged — and thumbnailed, and
      // handed to the proof page — by the file its keeper actually has.
      if (!w.matchedFile && readFuseAttribution(asVerify(w.proof))) {
        for (const f of w.cand.artifactCandidates) {
          const bytes = await f.arrayBuffer().catch(() => null);
          if (bytes) {
            const rebuilt = await verifyFuse({ proof: asVerify(w.proof), bytes: new Uint8Array(bytes) }).catch(() => null);
            if (rebuilt?.category === "FUSED_FROM_ORIGIN") {
              w.matchedFile = f;
              w.artifactFile = f;
              w.fileName = f.name;
              break;
            }
          }
          await new Promise((res) => setTimeout(res, 0));
        }
      }
      // The direct pass: an ordinary recording's file, or the new file itself.
      //
      // ⚠️ new-file/ answers ONLY for a package whose original is gone. A
      // fused export that still holds its original is judged BY that original
      // and nothing else: letting an intact new-file/ carry the row would
      // turn a corrupted original into a green verdict on the very file the
      // row names and hands to the proof page.
      if (!w.matchedFile) {
        const direct = w.cand.artifactCandidates.length > 0
          ? w.cand.artifactCandidates
          : w.cand.newFile ? [w.cand.newFile] : [];
        for (const f of direct) {
          const digest = await hashFile(f).catch(() => null);
          if (digest && digest === w.proof.artifact.digestB64 && !w.matchedFile) {
            w.matchedFile = f;
            w.artifactFile = f;
            w.fileName = f.name;
          }
          // Yield so the UI paints and Safari can reclaim the buffer between
          // multi-MB reads.
          await new Promise((res) => setTimeout(res, 0));
        }
      }
      if (!w.matchedFile) { w.failure = "bytes differ from the proof"; return; }

      // Side 2 — the ledger's copy at the CLAIMED position.
      const entries = await (ledgerFor.get(w.digestUrlSafe) ?? Promise.resolve(null));
      if (entries === null) { w.failure = LEDGER_UNREACHABLE; return; }
      const claimed = entries.find((e) => {
        const c = e.proof?.commit;
        if (!c) return false;
        if (normCounter(c.counter) !== normCounter(w.counter)) return false;
        return !w.epochId || c.epochId === w.epochId;
      });
      /* ⚠️ "NOT ON THE LEDGER" IS NO LONGER A FAULT, AND SAYING IT WOULD BE
       * THE WORST THING THIS SCREEN CAN DO.
       *
       * It was a real finding while every proof was written to the bucket: a
       * validly signed proof that the ledger did not hold meant something was
       * wrong. Since 2026-09-08 the bucket keeps only anchors, so a proof
       * absent from it is the ORDINARY case — it is a BitGraph whose evidence
       * lives, correctly, in the folder you are looking at.
       *
       * And the proof does not need the ledger to stand up: the signature, the
       * attestation to the AWS root, the slot binding and the floor are all
       * checked above, from the bytes in hand. So an absence simply ends this
       * side with nothing to compare, and the verdict is unchanged.
       *
       * The comparison below still runs for the three million proofs written
       * before the cutover, where it remains worth making. */
      if (!claimed) return;
      w.onLedger = true;
      w.writeTime = claimed.writeTime ?? null;
      w.ledgerProof = claimed.proof;

      // Same signed body, same signature — the folder's proof.json is the
      // ledger's, byte-meaning for byte-meaning.
      const [localHash, ledgerHash] = await Promise.all([
        proofHashB64(w.proof),
        proofHashB64(claimed.proof),
      ]);
      if (localHash !== ledgerHash || w.proof.signer.signatureB64 !== claimed.proof.signer.signatureB64) {
        w.failure = "proof differs from BitGraph's copy";
        return;
      }

      // Side 3 — anchors vs chain. The pinned digest route resolves the
      // causal window server-side (both anchor shapes).
      // ⚠️ The server FALLS BACK to its earliest proof for a position it does
      // not have, so the answer is only trusted after its own counter and
      // epoch are compared against what was asked (the 1.3.7 rule).
      const hasLocalAnchors = !!(w.cand.anchors.before || w.cand.anchors.after);
      const hasLocalWitness = !!(w.cand.anchors.beforeWitness || w.cand.anchors.afterWitness);
      if (!hasLocalAnchors && !hasLocalWitness) return; // still sealing — sides 1-2 carried it

      type Side = { blockNumber: number | null; blockHash: string | null } | null;
      let windowBefore: Side = null;
      let windowAfter: Side = null;
      try {
        const sel = `?counter=${encodeURIComponent(normCounter(w.counter))}${w.epochUrlSafe ? `&epoch=${encodeURIComponent(w.epochUrlSafe)}` : ""}`;
        const r = await fetch(`${apiBase}/api/proofs/digest/${encodeURIComponent(w.digestUrlSafe)}${sel}`);
        if (r.ok) {
          const data = (await r.json()) as {
            proofs?: Array<{ proof: BitGraphProof }>;
            causalWindow?: {
              anchorBefore?: { blockNumber: number | null; blockHash: string | null } | null;
              anchorAfter?: { blockNumber: number | null; blockHash: string | null } | null;
            } | null;
          };
          const echoed = data.proofs?.[0]?.proof?.commit;
          const echoOk =
            !!echoed &&
            normCounter(echoed.counter) === normCounter(w.counter) &&
            (!w.epochId || echoed.epochId === w.epochId);
          if (echoOk) {
            windowBefore = data.causalWindow?.anchorBefore
              ? { blockNumber: data.causalWindow.anchorBefore.blockNumber, blockHash: data.causalWindow.anchorBefore.blockHash?.toLowerCase() ?? null }
              : null;
            windowAfter = data.causalWindow?.anchorAfter
              ? { blockNumber: data.causalWindow.anchorAfter.blockNumber, blockHash: data.causalWindow.anchorAfter.blockHash?.toLowerCase() ?? null }
              : null;
          }
        }
      } catch { /* window unavailable — compare what can be compared */ }

      for (const side of ["before", "after"] as const) {
        const anchorFile = w.cand.anchors[side];
        const witnessFile = side === "before" ? w.cand.anchors.beforeWitness : w.cand.anchors.afterWitness;
        const ledgerSide = side === "before" ? windowBefore : windowAfter;

        let localBlock: { blockNumber: number | null; blockHash: string | null } | null = null;
        if (anchorFile) {
          localBlock = anchorBlockOf(await parseJsonFile(anchorFile));
          // Both sides known → the same Ethereum block. A local anchor the
          // ledger's window does not corroborate is left uncompared, not
          // failed: an unresolved window is our gap, not the folder's.
          if (
            ledgerSide &&
            localBlock.blockNumber !== null &&
            ledgerSide.blockNumber !== null &&
            (localBlock.blockNumber !== ledgerSide.blockNumber ||
              (localBlock.blockHash && ledgerSide.blockHash && localBlock.blockHash !== ledgerSide.blockHash))
          ) {
            w.failure = "anchors differ from the chain";
            return;
          }
        }

        if (witnessFile) {
          const localWitness = await parseJsonFile(witnessFile);
          const localHeader = typeof localWitness?.headerRlpHex === "string" ? (localWitness.headerRlpHex as string).toLowerCase() : null;
          // Ask the chain about the block the LEDGER names (falling back to
          // the local anchor's claim when the window is unresolved). The
          // server only returns a witness whose header hashes to that block
          // hash, so header equality is equality with the real chain.
          const blockNumber = ledgerSide?.blockNumber ?? localBlock?.blockNumber ?? null;
          const blockHash = ledgerSide?.blockHash ?? localBlock?.blockHash ?? null;
          if (localHeader && blockNumber !== null && blockHash && /^0x[0-9a-f]{64}$/.test(blockHash)) {
            const chainHeader = await fetchWitnessHeader(blockNumber, blockHash);
            if (chainHeader && chainHeader !== localHeader) {
              w.failure = "witness differs from the chain";
              return;
            }
          }
        }
      }
    }

    /* The verdict pool: eight rows in flight (was five; a cold pass over a
     * big folder ran ~2.5 rows a second and each row's wall time is mostly
     * awaited network, so width is nearly free throughput). Each row's
     * verdict lands the moment its own work is done, in whatever order that
     * happens. Only rows verified THIS pass emit an update — memo rows and
     * structural verdicts were already whole in onRows, and emitting 2,000
     * no-op updates cloned the row array 2,000 times for nothing. */
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(8, working.length) }, async () => {
      while (next < working.length) {
        const i = next++;
        const w = working[i];
        if (w.ok === null) {
          try {
            await verifyOne(w);
          } catch {
            if (!w.failure) w.failure = "check did not complete";
          }
          w.ok = !w.failure;
          cb.onUpdate?.(i, stripWorking(w));
        }
      }
    }));

    const rows = working.map(stripWorking);
    cb.onDone?.(rows);
    return rows;
  })();
  return { done };
}

/** The one-shot form: resolves once every verdict is in. What the Node
 *  harness and any non-streaming caller uses. */
export async function checkExports(
  candidates: ExportCandidate[],
  progress: CheckProgress = {},
  apiBase = "",
): Promise<ExportCheckResult[]> {
  let doneCount = 0;
  progress.onCheck?.(0, candidates.length);
  return startFolderCheck(candidates, {
    onUpdate: () => progress.onCheck?.(++doneCount, candidates.length),
  }, apiBase).done;
}

/* ── export/1: a tree/1 BitGraph's one JSON file ──
 *
 * What a holder keeps for a BitGraph made since 2026-10-03 is a single
 * bitgraph-export/1 file beside the file itself (SPEC.md section 12): the
 * proof, the root document, the member's evidence (one file's export) or the
 * whole list of leaves (the owner's export), and the three time sections.
 * Dropped alone it is checked on its own; dropped with the files it covers,
 * each file is checked against its leaf. Everything here is a read, and none
 * of it asks BitGraph anything: the verdict rests on the bytes in the drop.
 *
 * ⚠️ A FILE AN EXPORT COVERS IS NEVER A NEW FILE. Before this, a photo dropped
 * with its export read as "not yet BitGraphed" (its digest is no key anywhere:
 * a tree's members are not indexed) and a lone one was made AGAIN at a fresh
 * position. The caller takes `covered` out of the drop before anything can
 * offer to make it, and SPEC.md, which travels beside every export, with it.
 */

/** The first bytes buildExport writes are the format line; read before parsing anything large. */
const EXPORT_SNIFF_BYTES = 4096;
/** Small JSON files are parsed whole, whatever their key order. */
const EXPORT_PARSE_ANY_BYTES = 2 * 1024 * 1024;
/** An owner's export of 1,000,000 leaves is about 90 MB of base64; nothing larger is read as text. */
const EXPORT_MAX_BYTES = 192 * 1024 * 1024;

export interface DroppedExport {
  file: File;
  exp: BitGraphExport;
}

/**
 * Take the export/1 files out of a drop. A .json file is opened only when it
 * is small, or when its first bytes carry the format line, so a folder of
 * ordinary large JSON is never read as text. Everything else comes back in
 * `rest`, in drop order.
 */
export async function readTreeExports(files: File[]): Promise<{ exports: DroppedExport[]; rest: File[] }> {
  const exports: DroppedExport[] = [];
  const rest: File[] = [];
  for (const f of files) {
    const jsonish = /\.json$/i.test(f.name) || f.type === "application/json";
    if (!jsonish || f.size > EXPORT_MAX_BYTES || f.size < 16) { rest.push(f); continue; }
    try {
      if (f.size > EXPORT_PARSE_ANY_BYTES) {
        const head = await f.slice(0, EXPORT_SNIFF_BYTES).text();
        if (!head.includes('"bitgraph-export/1"')) { rest.push(f); continue; }
      }
      const exp = parseExport(await f.text());
      if (exp) exports.push({ file: f, exp }); else rest.push(f);
    } catch {
      rest.push(f);
    }
  }
  return { exports, rest };
}

/** One row of an export check: one covered file against its leaf, or an export with none of its files in the drop. */
export interface TreeExportRow {
  key: string;
  /** The export file's name. */
  exportName: string;
  /** "file": a file in the drop was checked against its leaf. "export": the export alone. */
  scope: "file" | "export";
  /** The covered file in the drop, when one was checked. */
  file: File | null;
  /** The file's name in the drop, else the name the owner's export lists for the leaf. */
  fileName: string | null;
  verdict: "TRUE" | "FALSE" | "UNDETERMINED";
  /** The leaf, once its path reached the committed root. */
  member: { index: number; count: number; placement: string } | null;
  /** The tree's size from the bound root document, when it bound. */
  count: number | null;
  /** For a checked file: "committed-bytes" when the floor covers its committed bytes, "none" when it was recorded as is. */
  floorCovers: "content" | "record" | null;
  times: ExportVerifyResult["times"];
  /** Whether the export carries each later section at all ("pending" counts as carried-but-pending). */
  ceiling: "present" | "pending" | "absent";
  settlement: "present" | "pending" | "absent";
  claims: ExportClaim[];
  /** Offline claims that failed or could not be decided, one line each. */
  problems: string[];
  proof: BitGraphProof;
  /** The export's root document, hex: handed to the proof page beside the proof (unsigned; the page binds it by hash). */
  rootDocumentHex: string;
  /** The checked file's evidence, when its path reached the root: lets the proof page show the file as the member it is. */
  evidence: TreeMemberEvidence | null;
  counter: string | null;
  epochUrlSafe: string | null;
  /** The proof's artifact digest (the root document's), URL-safe: the proof page's address. */
  digestUrlSafe: string;
  /** SPEC.md in the drop: "pinned" when one is the text this proof pins, "other" when a SPEC.md is there but is not. */
  spec: "pinned" | "other" | null;
}

/** export.ts's verdict rule, exactly: FALSE on any offline FALSE, UNDETERMINED on any offline UNDETERMINED but the pins. */
function verdictOf(claims: ExportClaim[]): TreeExportRow["verdict"] {
  const offline = claims.filter((c) => c.level === "offline");
  if (offline.some((c) => c.result === "FALSE")) return "FALSE";
  if (offline.some((c) => c.result === "UNDETERMINED" && c.id !== "attestation.pins")) return "UNDETERMINED";
  return "TRUE";
}

/**
 * The three claims about one file, written exactly as verifyExport writes
 * them for a file in hand, from the same verifyTreeMember result. The owner's
 * export is checked ONCE without a file (signature, attestation, list, root,
 * floor, ceilings) and these replace that run's NOT_CARRIED lines for each
 * file, so a drop of thousands of files is not thousands of full checks. A
 * test holds the merged claims equal to verifyExport's own, file by file.
 */
export function memberClaimsFor(tr: TreeVerifyResult, floorBlockNumber?: number): ExportClaim[] {
  const out: ExportClaim[] = [];
  const add = (id: string, name: string, result: ExportClaim["result"], restsOn: string, detail: string) => out.push({ id, name, result, restsOn, detail, level: "offline" });
  const rootOk = tr.tree !== null;
  const pathOk = tr.member !== null;
  add("tree.member", "The file's leaf is in the committed tree", pathOk ? "TRUE" : rootOk ? "FALSE" : "UNDETERMINED", "SHA-256 (RFC 9162 path)",
    pathOk ? `leaf ${tr.member!.index} of ${tr.member!.count}; a path proves this leaf only, not the order of the others` : tr.reason);
  const isMember = (TREE_MEMBER_CATEGORIES as readonly string[]).includes(tr.category);
  add("bytes.member", "The file in hand is that member", isMember ? "TRUE" : tr.member !== null ? "FALSE" : "UNDETERMINED", tr.category === "TREE_MEMBER_FROM_ORIGIN" ? "the placement rule, rebuilt here" : "SHA-256",
    `${tr.category}: ${tr.reason}`);
  if (isMember) {
    // Two floors, stated apart (SPEC 8.6), word for word as verifyExport states them.
    const block = typeof floorBlockNumber === "number" ? `Ethereum block ${floorBlockNumber}` : "the signed floor block";
    add("floor.record", "The record was made after the floor block", "TRUE", "the signed root document, which carries the commitment to the floor block",
      `recorded after ${block}: the tree this file is a leaf of was signed after it`);
    if (tr.floorCovers === "content") {
      add("floor.content", "The committed bytes were finished after the floor block", "TRUE", "SHA-256: the commitment is inside the committed bytes",
        `the committed bytes carry the commitment to ${block}, so they were finished after it; the original inside them is not dated by it`);
    } else {
      add("floor.content", "The committed bytes were finished after the floor block", "NOT_CARRIED", "",
        "recorded as is: the bytes carry no commitment, so the bytes themselves are not dated");
    }
  }
  return out;
}

/** The export-level claims with one file's three in place of the file-less run's. */
export function mergeMemberClaims(base: ExportClaim[], member: ExportClaim[]): ExportClaim[] {
  const out: ExportClaim[] = [];
  for (const c of base) {
    if (c.id === "tree.member") out.push(member.find((m) => m.id === "tree.member") ?? c);
    else if (c.id === "bytes.member") out.push(...member.filter((m) => m.id === "bytes.member" || m.id === "floor.record" || m.id === "floor.content"));
    else if (c.id !== "floor.record" && c.id !== "floor.content") out.push(c);
  }
  return out;
}

const sectionOf = (part: unknown, presentWhen: (p: Record<string, unknown>) => boolean): "present" | "pending" | "absent" => {
  if (part === null || typeof part !== "object") return "absent";
  const p = part as Record<string, unknown>;
  if (p.status === "pending") return "pending";
  return presentWhen(p) ? "present" : "pending";
};

/**
 * Check every dropped export against the files in the same drop.
 *
 *   one file's export   its leaf's two digests (artifact, origin) find the
 *                       file; verifyExport runs with the file's bytes.
 *   the owner's export  verifyExport runs once without a file; every dropped
 *                       file whose digest is a leaf's is then placed by a
 *                       path built from the list, and verifyTreeMember judges
 *                       it, the same call verifyExport makes for one file.
 *   no file found       one row for the export itself: the proof, the root
 *                       and the times hold or not, and the file is not
 *                       carried, which is said rather than failed.
 *
 * `files` are the drop's other files with their SHA-256 (standard base64),
 * as the scan left them. Returns the rows, the files an export covers (never
 * to be offered as new) and the SPEC.md copies found beside them.
 */
export async function checkTreeExports(
  exports: DroppedExport[],
  files: Array<{ file: File; digestB64: string }>,
  opts: {
    lookups?: ExportLookups;
    /** The verifier's own allowlists (the published PCR0s, in the camera). Without them, PCR0 is reported, not judged. */
    pins?: { pcr0?: string[]; ceilingWriter?: string; baseChainId?: number };
    extraSpecHashes?: readonly string[];
    onProgress?: (done: number, total: number) => void;
  } = {},
): Promise<{ rows: TreeExportRow[]; covered: Set<File>; specFiles: Set<File> }> {
  const rows: TreeExportRow[] = [];
  const covered = new Set<File>();
  const specFiles = new Set<File>();
  const byDigest = new Map<string, File[]>();
  for (const f of files) {
    if (!f.digestB64) continue;
    const at = byDigest.get(f.digestB64);
    if (at) at.push(f.file); else byDigest.set(f.digestB64, [f.file]);
    if (exports.length > 0 && KNOWN_TREE_SPEC_HASHES.includes(f.digestB64)) specFiles.add(f.file);
  }
  const specNamed = files.some((f) => f.file.name.toLowerCase() === "spec.md");
  const verifyOpts = { ...(opts.lookups ? { lookups: opts.lookups } : {}), ...(opts.pins ? { pins: opts.pins } : {}), ...(opts.extraSpecHashes ? { extraSpecHashes: opts.extraSpecHashes } : {}) };

  // Pass 1: which dropped files each export covers, from its own leaves.
  // Nothing is verified yet; this only decides what pass 2 reads.
  type Plan =
    | { kind: "member"; targets: File[]; all: File[] }
    | { kind: "owner"; leaves: TreeLeaf[]; hits: Array<[number, File[]]> }
    | { kind: "alone" };
  const plans: Plan[] = exports.map(({ exp }) => {
    const tree = exp.tree;
    if (tree.member !== undefined) {
      const ev = parseTreeMemberEvidence(tree.member);
      if (ev === null) return { kind: "alone" };
      // The file in either form: its committed bytes, or the original they were made from.
      const digests = [...new Set([bytesToBase64(ev.leaf.artifact), bytesToBase64(ev.leaf.origin)])];
      const targets = digests.flatMap((d) => (byDigest.get(d) ?? []).slice(0, 1));
      const all = digests.flatMap((d) => byDigest.get(d) ?? []);
      return targets.length > 0 ? { kind: "member", targets, all } : { kind: "alone" };
    }
    if (typeof tree.leaves === "string") {
      const bytes = base64ToBytes(tree.leaves);
      const leaves = bytes === null ? null : decodeTreeLeaves(bytes);
      if (leaves === null) return { kind: "alone" };
      const index = new Map<string, number>();
      leaves.forEach((l, k) => {
        index.set(bytesToBase64(l.artifact), k);
        const o = bytesToBase64(l.origin);
        if (!index.has(o)) index.set(o, k);
      });
      const hits = new Map<number, File[]>();
      for (const [d, fs] of byDigest) {
        const k = index.get(d);
        if (k === undefined) continue;
        const at = hits.get(k);
        if (at) at.push(...fs); else hits.set(k, [...fs]);
      }
      return hits.size > 0 ? { kind: "owner", leaves, hits: [...hits.entries()].sort((a, b) => a[0] - b[0]) } : { kind: "alone" };
    }
    return { kind: "alone" };
  });
  const total = plans.reduce((n, p) => n + (p.kind === "member" ? p.targets.length : p.kind === "owner" ? p.hits.length : 1), 0);
  let done = 0;
  const tick = async () => {
    opts.onProgress?.(++done, total);
    // Hand the page a frame now and then on a drop of thousands.
    if (done % 25 === 0) await new Promise((r) => setTimeout(r, 0));
  };

  // Pass 2: verify.
  for (let e = 0; e < exports.length; e++) {
    const { file: exportFile, exp } = exports[e]!;
    const plan = plans[e]!;
    const proof = exp.proof as unknown as BitGraphProof;
    const pin = typeof exp.proof.attribution?.message === "string" ? exp.proof.attribution.message : null;
    const spec: TreeExportRow["spec"] = pin !== null && (byDigest.get(pin)?.length ?? 0) > 0 ? "pinned" : specNamed ? "other" : null;
    const base = await verifyExport(exp, verifyOpts);
    const rootDocument = hexToBytes(exp.tree.rootDocument);
    const rootOk = base.claims.some((c) => c.id === "tree.root" && c.result === "TRUE");
    const count = rootOk && rootDocument !== null && rootDocument.length === 84 ? new DataView(rootDocument.buffer, rootDocument.byteOffset).getUint32(16, false) : null;
    const rowOf = (key: string, scope: TreeExportRow["scope"], file: File | null, fileName: string | null, claims: ExportClaim[], member: TreeVerifyResult["member"], evidence: TreeMemberEvidence | null = null): TreeExportRow => {
      const isMember = claims.some((c) => c.id === "bytes.member" && c.result === "TRUE");
      return {
        key,
        exportName: exportFile.name,
        scope,
        file,
        fileName,
        verdict: verdictOf(claims),
        member: member ? { index: member.index, count: member.count, placement: member.placement } : null,
        count,
        floorCovers: isMember && member ? (member.placement === "as-is" ? "record" : "content") : null,
        times: base.times,
        ceiling: sectionOf(exp.ceiling, (p) => typeof p.anchor === "object" && p.anchor !== null),
        settlement: sectionOf(exp.settlement, (p) => p.version !== undefined),
        claims,
        problems: claims.filter((c) => c.level === "offline" && (c.result === "FALSE" || (c.result === "UNDETERMINED" && c.id !== "attestation.pins"))).map((c) => `${c.name}: ${c.detail}`),
        proof,
        rootDocumentHex: exp.tree.rootDocument,
        evidence: member ? evidence : null,
        counter: proof.commit?.counter ?? null,
        epochUrlSafe: proof.commit?.epochId ? toUrlSafeB64(proof.commit.epochId) : null,
        digestUrlSafe: toUrlSafeB64(proof.artifact.digestB64),
        spec,
      };
    };

    if (plan.kind === "member") {
      for (const f of plan.targets) {
        const r = await verifyExport(exp, { bytes: new Uint8Array(await f.arrayBuffer()), ...verifyOpts });
        rows.push(rowOf(`${e}:${exportFile.name}:${f.name}`, "file", f, f.name, r.claims, r.member, exp.tree.member ?? null));
        await tick();
      }
      for (const f of plan.all) covered.add(f);
    } else if (plan.kind === "owner" && rootDocument !== null && base.claims.some((c) => c.id === "tree.leaves" && c.result === "TRUE")) {
      const leaves = plan.leaves;
      const merkle = new MerkleTree(leaves.map(treeLeafHash));
      const proofOk = base.claims.some((c) => c.id === "proof.signature" && c.result === "TRUE");
      const names = Array.isArray(exp.tree.names) ? exp.tree.names : [];
      for (const [k, fs] of plan.hits) {
        const f = fs[0]!;
        const evidence = buildTreeMemberEvidence(leaves[k]!, k, leaves.length, merkle.path(k));
        const tr = await verifyTreeMember({
          proof: exp.proof,
          bytes: new Uint8Array(await f.arrayBuffer()),
          member: evidence,
          rootDocument,
          proofAlreadyVerified: proofOk,
          ...(opts.extraSpecHashes ? { extraSpecHashes: opts.extraSpecHashes } : {}),
        });
        const claims = mergeMemberClaims(base.claims, memberClaimsFor(tr, exp.proof.commit?.slotAnchor?.blockNumber));
        rows.push(rowOf(`${e}:${exportFile.name}:${k}:${f.name}`, "file", f, f.name || (typeof names[k] === "string" ? names[k]! : null), claims, tr.member, evidence));
        for (const c of fs) covered.add(c);
        await tick();
      }
    } else {
      // The export alone: its file is not in the drop (or its list does not hold, which base already says).
      const claims = typeof exp.tree.leaves === "string"
        ? base.claims.map((c) => (c.id === "tree.member" && c.result === "NOT_CARRIED" ? { ...c, detail: "no file of this tree was in the drop" } : c))
        : base.claims;
      rows.push(rowOf(`${e}:${exportFile.name}:export`, "export", null, null, claims, base.member, exp.tree.member ?? null));
      // An owner's export whose list failed still names its files: they are not new.
      if (plan.kind === "owner") for (const [, fs] of plan.hits) for (const c of fs) covered.add(c);
      await tick();
    }
  }
  return { rows, covered, specFiles };
}
