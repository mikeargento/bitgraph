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
 *   1. bytes vs proof     hash the artifact, compare to proof.json's digest
 *   2. proof vs ledger    the ledger's copy at the CLAIMED position
 *   3. anchors vs chain   the folder's anchor + witness files against the
 *                         ledger's window for that position
 *
 * Everything here is a read: hashing is local, and every request is a lookup.
 * Nothing in this module can mint a recording.
 *
 * Discovery is BY CONTENT, the same rule the Folder and bitgraph-audit use:
 * a directory holding a proof.json is an export, whatever it is named. The
 * prune rules mirror droppable()/droppableUnder() in packages/folder/src/
 * export.js: dot-named entries are machinery everywhere, and files/ holds
 * hard links to bytes already inside the exports (walking it would count
 * every recording twice).
 */

import {
  hashFile,
  isBitGraphProof,
  verifyProofSignature,
  proofHashB64,
  type BitGraphProof,
} from "./bitgraph";
import { toUrlSafeB64 } from "./explorer";
import { blockTimeFromHeader } from "./export-pages";

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
export async function walkEntries(entries: EntryLike[]): Promise<WalkedFile[]> {
  const out: WalkedFile[] = [];
  const visit = async (entry: EntryLike, path: string[]): Promise<void> => {
    if (entry.name.startsWith(".")) return;
    const here = [...path, entry.name];
    if (entry.isFile) {
      const f = await fileOfEntry(entry);
      if (f) out.push({ file: f, path: here });
      return;
    }
    if (entry.isDirectory) {
      for (const child of await readAllEntries(entry)) await visit(child, here);
    }
  };
  for (const entry of entries) await visit(entry, []);
  return out;
}

/* ── Discovery by content ── */

export interface ExportCandidate {
  /** The export directory's own name, e.g. "BitGraph (sunset.jpg)". */
  dirName: string;
  proofFile: File;
  /** Files directly in the export dir that are not machinery — normally
   *  exactly one, the artifact. */
  artifactCandidates: File[];
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
      else if (rel[0] !== "index.html") cand.artifactCandidates.push(w.file);
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

/** Hash files until one matches `digestB64`. Short-circuits on the match;
 *  yields between files so the UI paints and Safari reclaims buffers. */
export async function findMatchInFiles(
  files: File[],
  digestB64: string,
  onProgress?: (done: number, total: number) => void,
): Promise<{ match: File | null; checked: number }> {
  let done = 0;
  for (const f of files) {
    const d = await hashFile(f).catch(() => null);
    done++;
    onProgress?.(done, files.length);
    if (d === digestB64) return { match: f, checked: done };
    await new Promise((r) => setTimeout(r, 0));
  }
  return { match: null, checked: done };
}

/** The "find it for me" version of the file-match check: a drop may hold many
 *  files AND folders, and the matching file is found by hashing, not by the
 *  person knowing which one it is. MUST be called synchronously from the drop
 *  handler (the entry capture dies after the first await). A browser cannot
 *  search the machine — but it can search whatever the person hands it. */
export async function findMatchInDrop(
  dt: DataTransfer,
  digestB64: string,
  onProgress?: (done: number, total: number) => void,
): Promise<{ match: File | null; checked: number }> {
  const entries = entriesFromDataTransfer(dt);
  const files = entries
    ? (await walkEntries(entries)).map((w) => w.file)
    : Array.from(dt.files);
  return findMatchInFiles(files, digestB64, onProgress);
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
  /** null while the verdict is still streaming in (the roll renders
   *  instantly from local data; verification catches up per row). */
  ok: boolean | null;
  /** The specific failing side, factual, one line. Null when ok/pending. */
  failure: string | null;
}

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

/* ── The check itself: instant rows, streaming verification ──
 *
 * The roll renders the moment the local scan finishes (proof.json fields and
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
});

/** The fast half: everything the roll needs to render, no hashing and no
 *  network. Structural failures (unreadable proof, no file at all) are
 *  verdicts already; everything else is pending (`ok: null`). */
async function scanExportsLocal(candidates: ExportCandidate[]): Promise<Working[]> {
  const working: Working[] = [];
  for (const cand of candidates) {
    const w: Working = {
      cand,
      dirName: cand.dirName,
      fileName: cand.artifactCandidates[0]?.name ?? null,
      matchedFile: null,
      artifactFile: cand.artifactCandidates[0] ?? null,
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
    if (cand.artifactCandidates.length === 0) {
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

export function startFolderCheck(
  candidates: ExportCandidate[],
  cb: FolderCheckCallbacks = {},
  apiBase = "",
): { done: Promise<ExportCheckResult[]> } {
  const done = (async () => {
    const working = await scanExportsLocal(candidates);
    cb.onRows?.(working.map(stripWorking));

    /* Ledger prefetch: every digest, 50 per request, three in flight. Each
     * row awaits only its own digest's promise. null = the lookup FAILED,
     * kept distinct from an empty answer: an unreachable ledger is our gap,
     * "not on the ledger" is a verdict about the folder. */
    const keys = [...new Set(working.map((w) => w.digestUrlSafe).filter((k): k is string => !!k))];
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
          try {
            const r = await fetch(`${apiBase}/api/proofs/batch`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ digests: mine }),
            });
            if (!r.ok) throw new Error(String(r.status));
            const results = ((await r.json()) as { results?: Record<string, { proofs?: LedgerEntry[] }> }).results || {};
            for (const k of mine) resolvers.get(k)?.(results[k]?.proofs || []);
          } catch {
            for (const k of mine) resolvers.get(k)?.(null);
          }
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
      for (const f of w.cand.artifactCandidates) {
        const digest = await hashFile(f).catch(() => null);
        if (digest && digest === w.proof.artifact.digestB64 && !w.matchedFile) {
          w.matchedFile = f;
          w.artifactFile = f;
          w.fileName = f.name;
        }
        // Yield so the UI paints and Safari can reclaim the buffer between
        // multi-MB reads.
        await new Promise((r) => setTimeout(r, 0));
      }
      if (!w.matchedFile) { w.failure = "bytes differ from the proof"; return; }

      // Side 2 — the ledger's copy at the CLAIMED position.
      const entries = await (ledgerFor.get(w.digestUrlSafe) ?? Promise.resolve(null));
      if (entries === null) { w.failure = "could not reach the ledger"; return; }
      const claimed = entries.find((e) => {
        const c = e.proof?.commit;
        if (!c) return false;
        if (normCounter(c.counter) !== normCounter(w.counter)) return false;
        return !w.epochId || c.epochId === w.epochId;
      });
      if (!claimed) {
        w.failure = entries.length === 0 ? "not on the ledger" : "not on the ledger at its claimed position";
        return;
      }
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
        w.failure = "proof differs from the ledger's copy";
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

    /* The verdict pool: five rows in flight. Each row's verdict lands the
     * moment its own work is done, in whatever order that happens. */
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(5, working.length) }, async () => {
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
        }
        cb.onUpdate?.(i, stripWorking(w));
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
