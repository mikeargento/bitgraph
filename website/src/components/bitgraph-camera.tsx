"use client";

/**
 * The camera: one implementation, two pages.
 *
 * Home renders this with the plain commit; /actor renders it with the commit
 * that puts this device's key on the recording. Everything else (the drop, the
 * local hash, the one batched ledger lookup, the folder check, the results list
 * with every position the bytes hold, the export, the hold through the daily
 * key renewal) is the same instrument and lives here once.
 *
 * ⚠️ It was two implementations until 2026-08-19 (home's page and a 787-line
 * /actor), and the second one drifted into six bugs in one evening that the
 * first did not have. Mike: "give bitgraph actor the same functionality
 * exactly as homepage but with actor key credentials". The seam is the
 * CommitStrategy (lib/commit-strategy.ts); nothing else is a parameter except
 * the words on the page: the title, and the block under the frame.
 *
 * Doctrine that must survive any edit here:
 *   - A lookup is not a recording. Nothing navigates when nothing was minted.
 *   - A folder drop is a READ. Every step is a read; nothing in that path can
 *     record. (Getting this wrong on /actor nearly minted 15k positions.)
 *   - The box never prompts on its own. A first-time visitor drops a file and
 *     gets a proof, with no dialog and no decision. /actor's touch is a
 *     property of ITS strategy, not of the camera.
 */

import { useState, useEffect, useRef, type ReactNode } from "react";
import { blockTimeFromHeader, type AnchorSide } from "@/lib/export-pages";
import { useRouter } from "next/navigation";
import { FileDrop } from "@/components/file-drop";
import { useCameraFit } from "@/lib/use-camera-fit";
import {
  hashFile,
  isBitGraphProof,
  verifyProofSignature,
  proofHashB64,
  type BitGraphProof,
} from "@/lib/bitgraph";
import type { CommitStrategy } from "@/lib/commit-strategy";
import { toUrlSafeB64 } from "@/lib/explorer";
import { discoverDrop, startFolderCheck, findMatchInDrop, findMatchInFiles, captureDrop, type CapturedDrop, type WalkedFile, type ExportCheckResult } from "@/lib/folder-check";
import { CheckedList, fmtRowWhen, useFileThumbs } from "@/components/folder-list";
import { takePendingDrop } from "@/lib/pending-drop";
import { setFreshProof } from "@/lib/fresh-proof";
import { Zip, ZipPassThrough } from "fflate";
import { cacheArtifactToIDB } from "@/lib/file-cache";
import { fuseFile, isTeeRestarting, FuseTooLargeError, fusedMarkerOf, rebuildFromOrigin, type FusedOutcome } from "@/lib/fuse-client";

type Step = "drop" | "scanning" | "results" | "proving" | "exporting";

export interface BitGraphCameraProps {
  /** Which page this is, for the module-level caches below: each page keeps
   *  its own batch across a trip to a proof page and back, and never sees the
   *  other's. */
  id: "home";
  /** How a digest not yet on the ledger gets committed. The one seam. */
  strategy: CommitStrategy;
  /** The default gesture makes a fused artifact from the dropped file (profile bitgraph-fuse/1); ordinary recording stays reachable as its own row. */
  fuseByDefault?: boolean;
  /** The page title, inside the shared h1 (home's is a link, /actor's is a
   *  noun). */
  /** Omitted by a page that carries its own hero above the box. */
  title?: ReactNode;
  /** A block above the frame, in place of a title. It sits inside the wrap so
      the fit measurement counts it and the frame gives up exactly its height. */
  above?: ReactNode;
  /** The page's own block, and the class its row wears: UNDER the box,
   *  centred, while the page is the camera alone, and nowhere else. The page
   *  owns that class's CSS (its margin-top, 42 on both pages). Home: "What is
   *  a BitGraph →"; /actor: "Forget this device". One line each, so the two
   *  pages are one composition (Mike, 2026-08-19: "make the two pages home
   *  and actor match"). */
  below?: ReactNode;
  /** false when the page keeps scrolling under the frame: the fit measurement is
      released (its own contract) and the frame stops centring in the viewport. */
  fitViewport?: boolean;
  /** The box's own first line. Defaults to naming both functions; a page whose
      headline already names them passes the instruction instead. */
  dropHeadline?: string;
  /** The line under it. Empty when the headline has taken its words. */
  dropHint?: string;
  /** The quiet line under that. Empty when a page states it in its own copy. */
  dropSubhint?: ReactNode;
  /* Only meaningful alongside `below`: it is the selector useCameraFit measures
     for the row under the frame. Optional since 2026-09-04, when home moved its
     explainer inside the frame and stopped rendering anything below it. */
  belowClassName?: string;
  /** One line inside the frame under "Hashed in your browser, never uploaded",
   *  for a fact about the instrument: /actor's "Acting as …, key …". Home
   *  passes nothing. */
  frameNote?: ReactNode;
  /** Resolve an actor key on a proof to a name this page is entitled to
   *  print, or undefined to print the key. /actor passes its own key's label;
   *  home passes nothing. Identity is a property of the reader: a row never
   *  borrows this browser's name for someone else's key. */
  /** Pick up files dropped on a proof page's camera strip (they always go to
   *  home, which is the page that strip navigates to). */
  acceptsPendingDrop?: boolean;
}


interface FileItem {
  file: File;
  digestB64: string;
  proof: BitGraphProof | null;
  // Every proof recorded for these bytes, earliest causal position first.
  // The same bits can be BitGraphed more than once; `proof` is the earliest
  // (originating) one and drives the row's open/verify behavior.
  proofs: BitGraphProof[];
  // Ledger write moments per recording (ms), parallel to `proofs`. Null for
  // legacy/backfilled entries, which predate per-position write times.
  times?: (number | null)[];
  valid: boolean | null;
  status: "found" | "new" | "proving" | "proved" | "error";
  // True when this item came from a dropped proof.json rather than an artifact.
  // The `file` in hand is then the JSON, not the thing the proof is about, so we
  // offer an inline check to confirm the visitor holds the matching artifact.
  fromProofJson?: boolean;
  matchedFile?: File | null;
  /** Per proof in `proofs`: a recording of these exact bytes, or a fused artifact that names them as origin. */
  kinds?: Array<"recorded" | "fused">;
  /** Set when this drop fused the file: the transient fused bytes, for the export. */
  fused?: FusedOutcome;
}

// The results list survives leaving for a proof page: client-side navigation
// keeps the module alive, so browser-back restores the batch exactly as left
// (File objects intact — no serialization). A hard reload (the logo's
// documented "start over" gesture) still wipes it. Keyed by page: home's batch
// must not reappear on /actor or the other way round.
const cachedResults = new Map<string, FileItem[]>();
// Same survival rule for a dropped folder's check verdicts (the File objects
// inside are only used again for click-through caching, so nothing serializes).
const cachedChecked = new Map<string, ExportCheckResult[]>();

/** Drop a page's remembered batch. /actor calls this when the device is
 *  forgotten: rows looked up or recorded under a key that is gone should not
 *  greet whoever registers next. */
export function clearCameraCache(id: BitGraphCameraProps["id"]) {
  cachedResults.delete(id);
  cachedChecked.delete(id);
}


export function BitGraphCamera({ id, strategy, fuseByDefault = false, title, above, below, belowClassName, frameNote, acceptsPendingDrop, fitViewport = true, dropHeadline = "Make or check BitGraphs", dropHint = "Choose files, or drag in a whole folder.", dropSubhint = "Hashed in your browser, never uploaded." }: BitGraphCameraProps) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(() => (cachedResults.get(id)?.length || cachedChecked.get(id)?.length ? "results" : "drop"));
  const [items, setItems] = useState<FileItem[]>(() => cachedResults.get(id) ?? []);
  // Verdicts for a dropped folder of BitGraph exports (the skeptic's drop):
  // one entry per export directory found in the drop, in walk order.
  const [checked, setChecked] = useState<ExportCheckResult[]>(() => cachedChecked.get(id) ?? []);
  // True while checkExports is doing its per-export ledger work, so the
  // checking wait shows a live count even for small folders (each export is
  // its own round trips, unlike the one-request digest lookup).
  const [folderChecking, setFolderChecking] = useState(false);
  const [scanProgress, setScanProgress] = useState({ current: 0, total: 0 });
  // Ledger-check progress (digests looked up). Only meaningful when the check
  // is chunked (large drops); a single-request check has nothing to count.
  const [checkProgress, setCheckProgress] = useState({ current: 0, total: 0 });
  // The scan is two honest phases: hashing files locally ("reading"), then
  // one batch round trip to the ledger ("checking"). The label tracks them;
  // "N of N checked" sitting under a full bar while the lookup ran was a lie.
  // "walking" is the folder being READ off the disk, which has no total to
  // count against (you learn the size by finishing) and so shows a live file
  // count without a bar. The other two keep their progress bars.
  const [scanPhase, setScanPhase] = useState<"walking" | "reading" | "checking">("reading");
  const [walkCount, setWalkCount] = useState(0);
  const [proveProgress, setProveProgress] = useState({ current: 0, total: 0 });
  // True while a commit is being held because the boundary is mid-rotation
  // (daily key renewal) or the fresh epoch's first anchor has not landed.
  // Files are already hashed; the record flow waits and retries on its own.
  const [teeRestarting, setTeeRestarting] = useState(false);
  // What the strategy says it is waiting on, when that is not the ledger
  // ("Waiting for you" while /actor's touch prompt is up). Null means the
  // proving label is the plain one.
  const [recordStatus, setRecordStatus] = useState<string | null>(null);
  // The strategy's sentence about a failed run, shown in the receipt card
  // until the next run or drop. Home's strategy has none; its rows say Error.
  const [recordMessage, setRecordMessage] = useState<string | null>(null);
  // On a results page the box is CLOSED behind one link until asked for
  // (Mike, 2026-08-19: "what if there IS a link, and it says something like
  // make more, and it EXPANDS the dropbox full size"). Opened by the link, or
  // by a file drag entering the window, since a drag cannot click first and
  // dragging is the only way a folder arrives. Closes again when the next
  // drop starts, so every results page begins the same way.
  const [boxOpen, setBoxOpen] = useState(false);
  const [proveAnimCount, setProveAnimCount] = useState(0);
  const proveAnimRef = useRef(0);
  const [, setExportProgress] = useState({ current: 0, total: 0 });
  const [animCount, setAnimCount] = useState(() =>
    (cachedResults.get(id) ?? []).filter(i => i.status === "found" || i.status === "proved").length);
  const [anchorCountdown, setAnchorCountdown] = useState(0);

  // Mirror the live batch into the module cache so browser-back from a proof
  // page restores this list (see cachedResults above).
  useEffect(() => {
    if (step === "results" && items.length > 0) cachedResults.set(id, items);
  }, [id, step, items]);
  useEffect(() => {
    if (step === "results" && checked.length > 0) cachedChecked.set(id, checked);
  }, [id, step, checked]);

  // Start 15s countdown when proofs finish (waiting for next ETH anchor)
  const endTimeRef = useRef<number>(0);
  const rafRef = useRef<number>(0);
  const startAnchorCountdown = () => {
    endTimeRef.current = Date.now() + 15000;
    setAnchorCountdown(15);
    cancelAnimationFrame(rafRef.current);
    const tick = () => {
      const remaining = Math.ceil((endTimeRef.current - Date.now()) / 1000);
      if (remaining <= 0) {
        setAnchorCountdown(0);
      } else {
        setAnchorCountdown(remaining);
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  useEffect(() => {
    if (step !== "drop") window.scrollTo(0, 0);
  }, [step]);

  /* The frame's height measurement lives in lib/use-camera-fit.ts. The only
     thing that was ever page-specific is which two elements get observed for
     height: the shared title, and the page's own block under the frame.

     No shrinkBy. The two frames are the same size and the titles sit level
     because the chrome around each frame is the SAME chrome: a title row
     (the page's name, its one link on the right) over the box, and nothing
     under it. For a day /actor carried two lines under its frame and the
     frames had to give 26px back to compensate; Mike moved the identity line
     INTO the box and then the link up to the title row, so the compensation
     is gone with the cause. ⚠️ If a page ever puts a block under its frame
     again, that is the moment shrinkBy comes back, and it comes back for BOTH
     pages or the titles part.

     ⚠️ Gated on step === "drop" and it must stay so. The measurement sums
     every sibling of the frame into the chrome it has to fit around, so with
     a results list below it the frame gets squeezed flatter as the list
     grows (that exact bug shipped on /actor). Disabled, the hook clears its
     custom properties and the frame falls back to its CSS sizing, which is
     what a page that has stopped being viewport-fitted should use. */
  useCameraFit(fitViewport && step === "drop", ".bitgraph-tagline", belowClassName ? `.${belowClassName}` : ".bitgraph-nothing-below");

  // Cleanup rAF on unmount only
  useEffect(() => {
    return () => { cancelAnimationFrame(rafRef.current); };
  }, []);

  // Files dropped on a proof page's camera strip arrive via the pending-drop
  // slot: pick them up on mount and run the normal drop flow.
  useEffect(() => {
    if (!acceptsPendingDrop) return;
    const pending = takePendingDrop();
    if (pending?.length) void handleFiles(pending);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Smooth-tick the displayed proving counter toward each chunk's real value.
  // The TEE signs atomically per chunk, so the truthful count only updates every
  // CHUNK_SIZE items (every ~1.5s). We interpolate between those updates so the
  // number visibly ticks 1, 2, 3, … instead of jumping by 50.
  useEffect(() => {
    const target = proveProgress.current;
    if (target === 0) {
      setProveAnimCount(0);
      proveAnimRef.current = 0;
      return;
    }
    const startValue = proveAnimRef.current;
    if (startValue >= target) {
      setProveAnimCount(target);
      proveAnimRef.current = target;
      return;
    }
    let raf = 0;
    const startTime = performance.now();
    const tick = () => {
      const elapsed = performance.now() - startTime;
      const ratio = Math.min(elapsed / 1500, 1);
      const value = Math.round(startValue + (target - startValue) * ratio);
      proveAnimRef.current = value;
      setProveAnimCount(value);
      if (ratio < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [proveProgress.current]);

  // Results are on the page: the camera (title row, box) is closed behind
  // one link on the results heading until asked for (see the render).
  const showingResults = step === "results" && (items.length > 0 || checked.length > 0);

  // The one link on a closed results page. It sits on the right of the
  // first results heading (the folder's Ledger when there is one, else the
  // files' heading) and opens the whole camera, title and full-size box,
  // above the results. In the action-link voice; "Make or check BitGraphs"
  // is the box's own headline, so the link names exactly what it reveals
  // (Mike, 2026-08-19: "more BitGraphs", not "more": the noun stays).
  const openLink = showingResults && !boxOpen ? (
    <button type="button" className="bg-arrow-link" onClick={() => setBoxOpen(true)}
      style={{ appearance: "none", border: 0, background: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em", color: "#0065A4", whiteSpace: "nowrap", flexShrink: 0 }}>
      <span className="bg-long">Make or check more BitGraphs</span><span className="bg-short">More</span> <span className="arrow" aria-hidden="true">&rarr;</span>
    </button>
  ) : null;

  // A file drag entering the window opens the box, so a folder (or anything)
  // dragged at a results page finds its target without a click it cannot
  // make mid-drag. Files only: a dragged text selection is not a drop.
  useEffect(() => {
    if (!showingResults || boxOpen) return;
    const onDragEnter = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes("Files")) setBoxOpen(true);
    };
    window.addEventListener("dragenter", onDragEnter);
    return () => window.removeEventListener("dragenter", onDragEnter);
  }, [showingResults, boxOpen]);
  const found = items.filter(i => i.status === "found" || i.status === "proved");
  // Files the Record row offers: never recorded, or recorded and failed (an
  // errored file is still an unrecorded file; see proveRemaining).
  const unproven = items.filter(i => i.status === "new" || i.status === "error");
  // What the export label counts. These mirror downloadZip's own filter, so the
  // label always names what the zip actually holds: one entry per file, and one
  // proof.json per causal position that file occupies.
  const zipFileCount = items.filter(i => i.proof).length;
  const zipProofCount = items.reduce((n, i) => n + (i.proof ? (i.proofs.length || 1) : 0), 0);
  // Only files that actually have a BitGraph get a row (plus errors, so a
  // failure is never silent). A not-yet-recorded file is not a BitGraph, so it
  // is represented by the count banner and the "BitGraph N remaining" button,
  // never a blank pending row.
  const shown = items.filter(i => i.status === "found" || i.status === "proved" || i.status === "error");
  // Tiny thumbs from the dropped bytes, for recognition in the results list
  // (record and check alike): you dropped forty photos, the rows should look
  // like your photos, not forty filenames. For a dropped proof.json the
  // artifact is the matched file, when one was found.
  const resultThumbs = useFileThumbs(shown.map((it) => (it.fromProofJson ? it.matchedFile : it.file)));
  const allDone = items.length > 0 && items.every(i => i.status === "found" || i.status === "proved");

  /* ── Drop → Scan ── */

  // Phases 1-3 of a drop — hash locally, one batched ledger lookup, assemble
  // in drop order. Shared by the plain-file flow (handleFiles, which adds the
  // solo routing and auto-record) and the folder-check flow, whose stray
  // files ride the same scan with none of the routing.
  async function scanFiles(files: File[]): Promise<FileItem[]> {
    setScanPhase("reading");
    setScanProgress({ current: 0, total: files.length });

    // Phase 1 — local work: detect dropped proof.json files, hash everything.
    // A small worker pool: parallel enough to keep crypto.subtle busy, small
    // enough that only a few file buffers are in flight at once (iOS Safari
    // reclaims each buffer between tasks; reading a multi-MB photo as TEXT
    // allocates a UTF-16 copy and crashes it after ~15 files, hence the
    // couldBeProof gate).
    type Scanned = { f: File; digest: string; proofJson: BitGraphProof | null; valid: boolean | null };
    const scanned: Scanned[] = new Array(files.length);
    let hashed = 0;
    let nextFile = 0;
    const hashWorker = async () => {
      while (nextFile < files.length) {
        const i = nextFile++;
        const f = files[i];
        try {
          const couldBeProof =
            f.size <= 1_000_000 &&
            (f.type === "application/json" || /\.(json|proof)$/i.test(f.name));
          const proofJson = couldBeProof ? isBitGraphProof(await f.text()) : null;
          if (proofJson) {
            const result = await verifyProofSignature(proofJson);
            scanned[i] = { f, digest: proofJson.artifact.digestB64, proofJson, valid: result.valid };
          } else {
            scanned[i] = { f, digest: await hashFile(f), proofJson: null, valid: null };
          }
        } catch {
          scanned[i] = { f, digest: await hashFile(f).catch(() => ""), proofJson: null, valid: null };
        }
        hashed++;
        setScanProgress({ current: hashed, total: files.length });
        // Yield so the UI paints and Safari can reclaim the buffer.
        await new Promise((r) => setTimeout(r, 0));
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, files.length) }, hashWorker));

    // Phase 2 — batched ledger lookup. Small drops are ONE round trip (the
    // old one-request-per-file loop was the whole wait); large drops are
    // chunked 50 digests per request, same rhythm as recording, so the wait
    // shows REAL progress instead of an uncounted spinner. Falls back to the
    // per-digest endpoint, parallelized, if the batch endpoint is unavailable.
    const lookupKeys = [...new Set(
      scanned.filter((s) => !s.proofJson && s.digest).map((s) => toUrlSafeB64(s.digest)),
    )];
    const lookup: Record<string, { proofs?: Array<{ proof: BitGraphProof }> }> = {};
    setCheckProgress({ current: 0, total: 0 });
    setScanPhase("checking");
    if (lookupKeys.length) {
      try {
        if (lookupKeys.length > 50) {
          setCheckProgress({ current: 0, total: lookupKeys.length });
          const chunks: string[][] = [];
          for (let i = 0; i < lookupKeys.length; i += 50) chunks.push(lookupKeys.slice(i, i + 50));
          let done = 0;
          let nextChunk = 0;
          const chunkWorker = async () => {
            while (nextChunk < chunks.length) {
              const mine = chunks[nextChunk++];
              const r = await fetch("/api/proofs/batch", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ digests: mine }),
              });
              if (!r.ok) throw new Error();
              Object.assign(lookup, (await r.json()).results || {});
              done += mine.length;
              setCheckProgress({ current: done, total: lookupKeys.length });
            }
          };
          await Promise.all(Array.from({ length: Math.min(3, chunks.length) }, chunkWorker));
        } else {
          const r = await fetch("/api/proofs/batch", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ digests: lookupKeys }),
          });
          if (!r.ok) throw new Error();
          Object.assign(lookup, (await r.json()).results || {});
        }
      } catch {
        let nextKey = 0;
        const fetchWorker = async () => {
          while (nextKey < lookupKeys.length) {
            const k = lookupKeys[nextKey++];
            try {
              const resp = await fetch(`/api/proofs/${encodeURIComponent(k)}`);
              lookup[k] = resp.ok ? await resp.json() : { proofs: [] };
            } catch {
              lookup[k] = { proofs: [] };
            }
          }
        };
        await Promise.all(Array.from({ length: Math.min(6, lookupKeys.length) }, fetchWorker));
      }
    }

    // Phase 3 — assemble in drop order. The lookup returns EVERY proof
    // recorded for the bytes (earliest causal position first): the same bits
    // can occupy several positions when BitGraphed more than once. Signature
    // checks are WebCrypto, cheap to run together.
    const results: FileItem[] = await Promise.all(scanned.map(async (s) => {
      const { f, digest, proofJson, valid } = s;
      if (proofJson) {
        return { file: f, digestB64: digest, proof: proofJson, proofs: [proofJson], valid, status: "found" as const, fromProofJson: true };
      }
      const rec = digest ? lookup[toUrlSafeB64(digest)] : undefined;
      // "On record" means bitgraph/1 only — the same filter the Folder applies
      // at its response edge (1.10.0). The append-only ledger still answers
      // occ/1 proofs for pre-cutover bytes, but those can never verify under
      // the current chain, so treating them as "on record" here meant a drop
      // LOOKED UP a dead proof instead of recording the bytes properly. The
      // earliest bitgraph/1 position stays proofs[0], never re-derived.
      // Recordings of these exact bytes first, then the fused artifacts that
      // name them as origin (kind "fused"), each by position, none ranked.
      // Either kind answers the drop: a visitor who drops the original finds
      // the fused BitGraph it produced. A fused descendant is still not a
      // recording of the bytes themselves; the row's label says so and the
      // proof page says where the artifact came from.
      type Entry = { proof: BitGraphProof; kind?: string; writeTime?: number | null };
      const entries = ((rec?.proofs || []) as Entry[]).filter((x) => x.proof?.version === "bitgraph/1");
      const ordered = [...entries.filter((x) => x.kind !== "fused"), ...entries.filter((x) => x.kind === "fused")];
      if (ordered.length > 0) {
        const result = await verifyProofSignature(ordered[0].proof);
        // The ledger write moment rides along per row so rows can show a
        // compact "when", same as the ledger. Legacy/backfilled entries have
        // none and just leave the slot blank.
        const times = ordered.map((x) => x.writeTime ?? null);
        const kinds = ordered.map((x): "recorded" | "fused" => (x.kind === "fused" ? "fused" : "recorded"));
        return { file: f, digestB64: digest, proof: ordered[0].proof, proofs: ordered.map((x) => x.proof), kinds, times, valid: result.valid, status: "found" as const };
      }
      return { file: f, digestB64: digest, proof: null, proofs: [], valid: null, status: "new" as const };
    }));

    return results;
  }

  async function handleFiles(files: File[]) {
    setStep("scanning");
    // A new drop retires the last run's sentence; the rows are the answer now.
    setRecordMessage(null);
    setBoxOpen(false);
    const results = await scanFiles(files);

    // One file in, one page out. A single artifact drop always lands on its
    // proof page, with no button in between: the drop IS the shutter.
    //   - already recorded  → open its existing proof (a lookup).
    //   - not yet recorded  → record it now, then open the new proof.
    // The outcome (lookup vs record) is decided only by whether the bytes
    // already existed. Batches KEEP the explicit Record button (recording N
    // new files at once is a batch commitment, and the list is where you see
    // which are new vs on record). A dropped proof.json stays here too: its
    // check flow lives on this page.
    const solo = results.length === 1 ? results[0] : null;
    // fresh=true plays the capture flash on the proof page (a just-recorded
    // BitGraph), never on a lookup of something already on record.
    const openProofPage = (p: BitGraphProof, file: File, fresh = false) => {
      const proofDigest = p.artifact.digestB64;
      const c = p.commit?.counter;
      const epoch = p.commit?.epochId ? toUrlSafeB64(p.commit.epochId) : "";
      const sel = c ? `?counter=${encodeURIComponent(c)}${epoch ? `&epoch=${encodeURIComponent(epoch)}` : ""}${fresh ? "&fresh=1" : ""}` : (fresh ? "?fresh=1" : "");
      // Fire-and-forget: bytes land in IndexedDB while the client-side push
      // happens now; the proof page polls the cache, so navigation never waits
      // on the ~6 MB C2PA toolkit.
      void cacheArtifactToIDB(file, proofDigest).catch((e) => console.error("[bitgraph] cache error:", e));
      // On a fresh recording, hand the committed proof to the proof page so it
      // paints the record instantly (image + hash + "Recorded"), no skeleton.
      // The causal window / anchor stay pending until the background fetch fills
      // them in — correct, since a new proof's sealing anchor hasn't landed yet.
      if (fresh) {
        setFreshProof(toUrlSafeB64(proofDigest), {
          proofs: [{ proof: p }],
          positions: c ? [{ counter: c, epoch: epoch || null, lowerTime: null, upperTime: null }] : [],
          causalWindow: null,
          anchorBlock: null,
        });
      }
      router.push(`/proof/${encodeURIComponent(toUrlSafeB64(proofDigest))}${sel}`);
    };
    if (solo && !solo.fromProofJson) {
      /* ⚠️ A lone file ALREADY ON RECORD stays here (Mike, 2026-08-19). It used
         to open its existing proof, on the reading that a lookup's answer IS
         its proof page. The objection is that nothing happened: no slot was
         allocated, no position consumed, nothing recorded. Navigating on a
         drop that recorded something and navigating on a drop that recorded
         nothing makes the two outcomes look identical, when telling them apart
         is the entire job of this gesture (one gesture, two outcomes, and the
         RESULTS are what say which).

         The card is the honest answer and it is also the better one: it shows
         every position these bytes already hold, "1 of 5 · original" and the
         rest, which a single proof page cannot. The row is still one click
         from any of them. /actor was fixed the same way earlier today. */
      if (solo.status === "found" && solo.proof) {
        setItems(results);
        setStep("results");
        // ⚠️ The count travels with the step. Every other path into the results
        // view sets both on adjacent lines, and leaving it out here rendered
        // "0 of 1" over a file that plainly has a proof.
        setAnimCount(results.filter((r) => r.status === "found").length);
        return;
      }
      if (solo.status === "new" && solo.digestB64) {
        // Auto-record the lone new file, then open its fresh proof. Show the
        // proving spinner while the TEE signs (a second or two).
        setItems(results);
        setStep("proving");
        setProveProgress({ current: 0, total: 1 });
        // Through the rotation wrapper: a solo drop is the product's most
        // common gesture, and during the daily key renewal it must hold and
        // resume (the proving view shows the held message), not fail raw.
        // `begin` is inside the hold too: /actor's touch waits for a live
        // camera rather than signing a nonce the restart has already thrown
        // away.
        let begun = false;
        try {
          // Fuse by default: the dropped file is the origin, a slot is
          // allocated for it, and the fused bytes built in memory consume
          // that slot. The proof page then shows the visitor's own file,
          // which rebuilds the committed artifact (see BringYourFile).
          const p = fuseByDefault
            ? await fuseOrRecordOne(solo.file, solo.digestB64, () => { begun = true; })
            : await (async () => {
                await commitThroughRotation(() => beginRun([solo.digestB64]));
                begun = true;
                return commitThroughRotation(() => strategy.one(solo.digestB64));
              })();
          void announceRecorded([p]);
          openProofPage(p, solo.file, true);
          return;
        } catch (e) {
          // Recording failed: fall back to the results card so the user can
          // retry via the explicit button instead of a dead end. The file
          // stays "new" either way (a solo commit that fails mints nothing).
          setRecordMessage(strategy.errorMessage?.(e, begun ? "commit" : "begin") ?? null);
          setItems(prev => prev.map(i => i.digestB64 === solo.digestB64 ? { ...i, status: "new" as const } : i));
          setAnimCount(0);
          setStep("results");
          return;
        }
      }
    }

    setItems(results);
    setStep("results");

    // Show the count directly, no per-tick animation. The old setInterval
    // ticked the number up one at a time, and each tick re-rendered the whole
    // results list; for a large drop (1000+) that looked hung near the end and
    // took far too long. The final number just appears.
    setAnimCount(results.filter(r => r.status === "found").length);
  }

  /* ── Folder drop: the skeptic's drop ── */

  // The drop zone detected a directory. Discovery is by content, the same
  // rule as the Folder and bitgraph-audit: directories holding a proof.json
  // are exports and get the three-sided check (bytes vs proof, proof vs
  // ledger at the claimed position, anchors vs chain); a folder with no
  // proof.json anywhere is just files and takes the ordinary flow — which
  // also finally makes "drag the files/ folder itself" work without
  // select-all. Every step is a read; nothing here can record.
  function handleFolderScan(files: number, done: boolean) {
    if (done) return; // handleFolder takes the screen from here
    setScanPhase("walking");
    setWalkCount(files);
    setStep("scanning");
  }

  async function handleFolder(walked: WalkedFile[]) {
    setRecordMessage(null);
    setBoxOpen(false);
    const scan = discoverDrop(walked);
    if (scan.exports.length === 0) {
      // Hand off, or put the drop zone back: the reading state was raised
      // before anyone knew what was in the folder, so it has to be retired
      // here even when the answer is "nothing".
      if (scan.strays.length) void handleFiles(scan.strays);
      else setStep("drop");
      return;
    }
    // The day renders the moment the local scan finishes; verdicts stream
    // in per row behind it. No full-screen wait at all: browsing must be
    // instant, verification merely prompt.
    setFolderChecking(true);
    // Cleared ONCE, here, rather than inside onRows. Both halves of a mixed
    // drop are in flight at the same time, and onRows fires whenever the
    // export scan happens to finish — so clearing there raced the stray scan
    // and silently ate every loose file whenever the strays landed first.
    setItems([]);
    const { done } = startFolderCheck(scan.exports, {
      onRows: (rows) => {
        setChecked(rows);
        setStep("results");
      },
      onUpdate: (index, row) => {
        setChecked((prev) => prev.map((r, i) => (i === index ? row : r)));
      },
      onDone: (rows) => {
        setChecked(rows);
        setFolderChecking(false);
      },
    });
    void done.catch((e) => {
      console.error("[bitgraph] folder check failed:", e);
      setFolderChecking(false);
    });
    // Files in the drop that belong to no export are just files: hash and
    // look them up like any other drop (their card renders below the
    // verdicts), with none of the solo routing.
    if (scan.strays.length) {
      void scanFiles(scan.strays).then((strayItems) => {
        setItems(strayItems);
        setAnimCount(strayItems.filter((r) => r.status === "found").length);
      }).catch(() => { /* strays are secondary; the ledger stands */ });
    }
  }

  // Open a verdict row's proof page, pinned to the claimed position. The
  // artifact bytes are cached for the page only when they matched the proof —
  // caching differing bytes under the proof's digest would show the wrong
  // image on the record's own page.
  function openCheckedRow(r: ExportCheckResult) {
    if (!r.onLedger || !r.digestUrlSafe) return;
    if (r.matchedFile && r.proof) {
      void cacheArtifactToIDB(r.matchedFile, r.proof.artifact.digestB64).catch((e) => console.error("[bitgraph] cache error:", e));
    }
    const sel = r.counter
      ? `?counter=${encodeURIComponent(r.counter)}${r.epochUrlSafe ? `&epoch=${encodeURIComponent(r.epochUrlSafe)}` : ""}`
      : "";
    router.push(`/proof/${encodeURIComponent(r.digestUrlSafe)}${sel}`);
  }

  /* ── Prove unproven files ── */

  // Hand each fresh recording straight to the ledger: the commit response
  // already knows the counter, so the dropper's own Ledger shouldn't wait for
  // the next poll to show a mint it just watched happen. Fire-and-forget.
  async function announceRecorded(proofs: BitGraphProof[]) {
    try {
      const entries = await Promise.all(proofs.filter(Boolean).map(async (p) => ({
        counter: parseInt(String(p.commit?.counter ?? "0"), 10),
        type: "proof" as const,
        digest: toUrlSafeB64(p.artifact.digestB64),
        hashShort: toUrlSafeB64(await proofHashB64(p)).slice(0, 10),
        blockNumber: null,
        etherscanUrl: null,
        isNew: true as const,
        at: Date.now(),
      })));
      const valid = entries.filter((e) => e.counter > 0);
      if (valid.length) window.dispatchEvent(new CustomEvent("bitgraph:recorded", { detail: valid }));
    } catch { /* display-only, never block the prove flow */ }
    void fillRecordedTimes(proofs);
  }

  // A just-minted row had no "when" while every row around it did, which read
  // as missing data. The reason is real: the times these rows show are the
  // LEDGER's write moment, and a fresh proof came back from the boundary, not
  // from a ledger read, so there was nothing to show. The commit route writes
  // the by-digest entry before it answers, so one lookup right after recording
  // fills the slot with the same fact the neighbouring rows carry. Deliberately
  // NOT this browser's clock: the product does not assert time from an
  // untrusted source, and a row whose time came from the machine that made it
  // would be a different claim wearing the same clothes.
  async function fillRecordedTimes(proofs: BitGraphProof[]) {
    try {
      const digests = [...new Set(proofs.filter(Boolean).map((p) => toUrlSafeB64(p.artifact.digestB64)))];
      if (!digests.length) return;
      const r = await fetch("/api/proofs/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ digests }),
      });
      if (!r.ok) return;
      const results = ((await r.json()) as {
        results?: Record<string, { proofs?: Array<{ proof: BitGraphProof; writeTime?: number | null }> }>;
      }).results || {};
      setItems((prev) => prev.map((it) => {
        if (!it.digestB64) return it;
        const entry = results[toUrlSafeB64(it.digestB64)];
        if (!entry?.proofs?.length) return it;
        // Align to the rows actually rendered: each row's own position gets
        // its own write time, so a file recorded twice keeps them distinct.
        const rendered = it.proofs.length ? it.proofs : it.proof ? [it.proof] : [];
        const times = rendered.map((p) => {
          const c = p?.commit?.counter;
          const hit = entry.proofs?.find((e) => String(e.proof?.commit?.counter) === String(c));
          return hit?.writeTime ?? null;
        });
        return times.some((t) => t !== null) ? { ...it, times } : it;
      }));
    } catch { /* the row simply keeps its blank when */ }
  }

  // Retry a commit through the daily rotation window. Only the typed
  // "TeeRestartingError" is retried: on that path nothing was minted (the
  // proxy refused before forwarding, or the boundary was unreachable), so
  // retrying cannot double-record. The whole window is restart (~40s) plus
  // one anchor tick (~12s); 6s x 25 attempts gives 150s of patience before
  // surfacing a real error.
  async function commitThroughRotation<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        const out = await fn();
        setTeeRestarting(false);
        return out;
      } catch (e) {
        const held = e instanceof Error && e.name === "TeeRestartingError";
        if (!held || attempt >= 25) { setTeeRestarting(false); throw e; }
        setTeeRestarting(true);
        await new Promise((r) => setTimeout(r, 6000));
      }
    }
  }

  // The strategy's once-per-run step (/actor: the enclave's nonce and the one
  // touch), with its status wired to the proving label. Home's has none.
  // The default gesture: fuse the file (profile bitgraph-fuse/1) through this
  // site's own routes, in the browser. The visitor's file is the origin and is
  // never modified or uploaded; the fused bytes exist in memory only long
  // enough to be hashed and committed under the slot allocated for them, and
  // the original plus the signed proof rebuilds them at any time. Held through
  // the daily rotation like every other commit.
  async function fuseOne(file: File): Promise<FusedOutcome> {
    return commitThroughRotation(async () => {
      try {
        return await fuseFile(file);
      } catch (e) {
        if (isTeeRestarting(e)) { const held = new Error("The camera is restarting"); held.name = "TeeRestartingError"; throw held; }
        throw e;
      }
    });
  }
  // A file too large to build in memory is recorded as itself instead, the
  // compatibility operation, through the strategy's ordinary path.
  async function fuseOrRecordOne(file: File, digestB64: string, onBegun: () => void): Promise<BitGraphProof> {
    try {
      return (await fuseOne(file)).proof;
    } catch (e) {
      if (!(e instanceof FuseTooLargeError)) throw e;
    }
    await commitThroughRotation(() => beginRun([digestB64]));
    onBegun();
    return commitThroughRotation(() => strategy.one(digestB64));
  }
  async function beginRun(digests: string[]) {
    if (!strategy.begin) return;
    try {
      await strategy.begin(digests, setRecordStatus);
    } finally {
      setRecordStatus(null);
    }
  }

  // After a run failed partway: a failed WRITE is not a verdict on what was
  // written. Read the ledger once for every row still marked proving, so a
  // digest the enclave did mint before the failure shows as recorded (and is
  // not minted again when the visitor records the rest), and only the others
  // say Error. If the read itself fails, every pending row says Error, which
  // is what this view showed before the read existed. Returns how many the
  // read found recorded.
  async function settleAfterFailure(pending: FileItem[]): Promise<number> {
    type Entry = { proofs?: Array<{ proof: BitGraphProof; writeTime?: number | null }>; unavailable?: true };
    let found: Record<string, Entry> = {};
    try {
      const r = await fetch("/api/proofs/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ digests: [...new Set(pending.map((p) => toUrlSafeB64(p.digestB64)))] }),
      });
      if (r.ok) found = ((await r.json()) as { results?: Record<string, Entry> }).results || {};
    } catch { /* unread: see above */ }
    const recorded = new Map<string, Array<{ proof: BitGraphProof; writeTime?: number | null }>>();
    for (const p of pending) {
      const entry = found[toUrlSafeB64(p.digestB64)];
      // ⚠️ `unavailable` means the ledger could not be read, not that nothing
      // is there; such a row stays Error rather than being called recorded.
      const recs = entry && !entry.unavailable
        ? (entry.proofs || []).filter((x) => x.proof?.version === "bitgraph/1")
        : [];
      if (recs.length) recorded.set(p.digestB64, recs);
    }
    setItems((prev) => prev.map((i) => {
      if (i.status !== "proving") return i;
      const recs = recorded.get(i.digestB64);
      if (!recs) return { ...i, status: "error" as const };
      return {
        ...i,
        proof: recs[0].proof,
        proofs: recs.map((x) => x.proof),
        times: recs.map((x) => x.writeTime ?? null),
        valid: true,
        status: "proved" as const,
      };
    }));
    return recorded.size;
  }

  // The receipt row's action: fuse by default (home), ordinary recording on
  // /actor and always as its own compatibility row.
  function proveRemaining() { return fuseByDefault ? fuseRemaining() : recordRemaining(); }

  async function fuseRemaining() {
    const toProve = items.filter(i => i.status === "new" || i.status === "error");
    if (!toProve.length) return;
    setStep("proving");
    setRecordMessage(null);
    setProveProgress({ current: 0, total: toProve.length });
    setItems(prev => prev.map(i => i.status === "new" || i.status === "error" ? { ...i, status: "proving" as const } : i));
    let minted = 0;
    let lastOut: FusedOutcome | null = null;
    const tooLarge: FileItem[] = [];
    try {
      for (let n = 0; n < toProve.length; n++) {
        const t = toProve[n];
        try {
          const out = await fuseOne(t.file);
          lastOut = out;
          minted++;
          setItems(prev => prev.map(i => i.digestB64 === t.digestB64 ? { ...i, proof: out.proof, proofs: [out.proof], kinds: ["fused" as const], fused: out, valid: true, status: "proved" as const } : i));
          void announceRecorded([out.proof]);
        } catch (e) {
          if (e instanceof FuseTooLargeError) tooLarge.push(t); else throw e;
        }
        setProveProgress({ current: n + 1, total: toProve.length });
        await new Promise((r) => setTimeout(r, 0));
      }
      if (tooLarge.length) {
        await commitThroughRotation(() => beginRun(tooLarge.map((t) => t.digestB64)));
        for (let offset = 0; offset < tooLarge.length; offset += 50) {
          const chunk = tooLarge.slice(offset, offset + 50);
          const proofs = await commitThroughRotation(() => strategy.chunk(chunk.map((t) => t.digestB64), offset));
          minted += proofs.length;
          const chunkMap = new Map(chunk.map((t, i) => [t.digestB64, proofs[i]] as const));
          setItems(prev => prev.map(i => { const p = chunkMap.get(i.digestB64); return p ? { ...i, proof: p, proofs: [p], kinds: ["recorded" as const], valid: true, status: "proved" as const } : i; }));
          void announceRecorded(proofs);
        }
      }
      if (items.length === 1 && minted === 1 && lastOut !== null) {
        const proofDigest = lastOut.proof.artifact.digestB64;
        const c = lastOut.proof.commit?.counter;
        const epoch = lastOut.proof.commit?.epochId ? toUrlSafeB64(lastOut.proof.commit.epochId) : "";
        const sel = c ? `?counter=${encodeURIComponent(c)}${epoch ? `&epoch=${encodeURIComponent(epoch)}` : ""}&fresh=1` : "?fresh=1";
        void cacheArtifactToIDB(toProve[0].file, proofDigest).catch((e) => console.error("[bitgraph] cache error:", e));
        router.push(`/proof/${encodeURIComponent(toUrlSafeB64(proofDigest))}${sel}`);
        return;
      }
    } catch (e) {
      setRecordMessage(strategy.errorMessage?.(e, "commit") ?? (e instanceof Error ? e.message : null));
      setItems(prev => prev.map(i => i.status === "proving" ? { ...i, status: "new" as const } : i));
    }
    setStep("results");
    if (minted > 0) startAnchorCountdown();
    setAnimCount(items.filter(i => i.status === "found" || i.status === "proved").length + minted);
  }

  async function recordRemaining() {
    // Errored rows are still unrecorded files, so the button offers them
    // again; settleAfterFailure has already checked that they were not in
    // fact minted, so recording them again cannot double-record.
    const toProve = items.filter(i => i.status === "new" || i.status === "error");
    if (!toProve.length) return;

    setStep("proving");
    setRecordMessage(null);
    setProveProgress({ current: 0, total: toProve.length });
    setItems(prev => prev.map(i => i.status === "new" || i.status === "error" ? { ...i, status: "proving" as const } : i));

    // How many this run put on the ledger, for the count in the receipt. Not
    // assumed from toProve.length: a run can fail partway.
    let minted = 0;
    // Whether the failure, if any, came before or after the strategy's
    // once-per-run step: before it nothing was attempted, and the strategy's
    // sentence says so.
    let begun = false;
    try {
      // `begin` inside the hold: during the daily key renewal, /actor's touch
      // waits for a live camera rather than signing a nonce the restart has
      // already thrown away.
      await commitThroughRotation(() => beginRun(toProve.map((t) => t.digestB64)));
      begun = true;
      if (toProve.length === 1) {
        const p = await commitThroughRotation(() => strategy.one(toProve[0].digestB64));
        minted = 1;
        setItems(prev => prev.map(i =>
          i.digestB64 === toProve[0].digestB64 ? { ...i, proof: p, proofs: [p], valid: true, status: "proved" as const } : i
        ));
        setProveProgress({ current: 1, total: 1 });
        void announceRecorded([p]);
        // One file in, one page out, on the record path too: a lone fresh
        // recording goes straight to its new proof page (only when it was the
        // whole drop; in a mixed batch the results list is the context).
        if (items.length === 1) {
          const proofDigest = p.artifact.digestB64;
          const c = p.commit?.counter;
          const epoch = p.commit?.epochId ? toUrlSafeB64(p.commit.epochId) : "";
          // &fresh=1 → capture flash on arrival (this is a just-made recording).
          const sel = c ? `?counter=${encodeURIComponent(c)}${epoch ? `&epoch=${encodeURIComponent(epoch)}` : ""}&fresh=1` : "?fresh=1";
          void cacheArtifactToIDB(toProve[0].file, proofDigest).catch((e) => console.error("[bitgraph] cache error:", e));
          router.push(`/proof/${encodeURIComponent(toUrlSafeB64(proofDigest))}${sel}`);
          return;
        }
      } else {
        // Chunked batches so we can show real progress + stay under Vercel's
        // 60s function timeout. 50 per chunk ≈ 1s of TEE work per request at
        // ~50 sign/sec, so progress ticks roughly every second. The chunking
        // is the camera's; what a chunk costs is the strategy's.
        const CHUNK_SIZE = 50;
        // Yield to the event loop after each chunk so React paints the
        // progress update before the next batch starts (same pattern as the
        // exporting loop). Without this, fast batches can flush together.
        const tick = () => new Promise((r) => setTimeout(r, 0));
        for (let offset = 0; offset < toProve.length; offset += CHUNK_SIZE) {
          const chunk = toProve.slice(offset, offset + CHUNK_SIZE);
          const digests = chunk.map(t => t.digestB64);
          const proofs = await commitThroughRotation(() => strategy.chunk(digests, offset));
          minted += proofs.length;
          const chunkMap = new Map(chunk.map((t, i) => [t.digestB64, proofs[i]] as const));
          setItems(prev => prev.map(i => {
            const p = chunkMap.get(i.digestB64);
            return p ? { ...i, proof: p, proofs: [p], valid: true, status: "proved" as const } : i;
          }));
          setProveProgress({ current: Math.min(offset + CHUNK_SIZE, toProve.length), total: toProve.length });
          void announceRecorded(proofs);
          await tick();
        }
      }
    } catch (e) {
      setRecordMessage(strategy.errorMessage?.(e, begun ? "commit" : "begin") ?? null);
      if (begun) {
        // Some of the run may be on the ledger: read before saying Error.
        minted += await settleAfterFailure(toProve);
      } else {
        // Nothing was attempted: the files go back exactly as they were, and
        // the Record row offers them again.
        setItems(prev => prev.map(i => i.status === "proving" ? { ...i, status: "new" as const } : i));
      }
    }

    setStep("results");
    if (minted > 0) startAnchorCountdown();

    // Show the final count directly (see the note in handleFiles): the per-tick
    // animation re-rendered the whole list each increment and dragged on large
    // drops.
    setAnimCount(items.filter(i => i.status === "found" || i.status === "proved").length + minted);
  }

  /* ── Export zip with ETH anchors ── */

  async function downloadZip() {
    const withProofs = items.filter(i => i.proof);
    if (!withProofs.length) return;

    setStep("exporting");
    const totalSteps = withProofs.length + 2; // files + anchors + zip
    setExportProgress({ current: 0, total: totalSteps });
    const multi = withProofs.length > 1;

    // Streaming zip: chunks accumulate as each file is added
    const chunks: Uint8Array[] = [];
    let zipDone = false;
    let zipError: Error | null = null;
    const z = new Zip((err, chunk, final) => {
      if (err) { zipError = err; return; }
      if (chunk) chunks.push(chunk);
      if (final) zipDone = true;
    });

    // Helper: yield to event loop so React can repaint progress
    const tick = () => new Promise(r => setTimeout(r, 0));

    // Add a text entry to the zip
    const addText = (name: string, text: string) => {
      const entry = new ZipPassThrough(name);
      z.add(entry);
      entry.push(new TextEncoder().encode(text), true);
    };

    // One entry per proof folder, gathered as the zip is built so the pages
    // can be written at the end without re-fetching anything. `sides` is filled
    // by addAnchorsFor via the witness it downloads.
    const built: { dir: string; fileName: string; proof: Record<string, unknown>;
                   sides: { before: AnchorSide; after: AnchorSide } }[] = [];
    const sidesFor = new Map<string, { before: AnchorSide; after: AnchorSide }>();
    const sidesOf = (dir: string) => {
      let v = sidesFor.get(dir);
      if (!v) { v = { before: {}, after: {} }; sidesFor.set(dir, v); }
      return v;
    };

    // Fetch the two bounding ETH anchors for one recording and add them under
    // `dir`. The "after" anchor follows the counter (upper time bound), the
    // "before" anchor precedes it (lower time bound); together they pin the
    // recording to a public Ethereum time window. Both are required to read
    // the window: the after-anchor alone is only "existed by now," the same
    // one-sided bound a plain blockchain timestamp gives.
    // For one anchor, add a block-header witness so the anchor's Ethereum time
    // claim is verifiable fully offline: the audit recomputes keccak256(header)
    // and confirms it equals the anchor's signed block hash, then reads the
    // block timestamp from the header. The server re-encodes and self-checks
    // the header, so a witness is only returned when it hashes to the signed
    // block hash; on any failure we simply omit it (the bundle stays valid,
    // just without the offline time witness for that anchor).
    const addWitnessFor = async (name: string, anchor: Record<string, unknown>) => {
      try {
        const eth = anchor.ethereum as { blockNumber?: number; blockHash?: string } | undefined;
        const attr = anchor.attribution as { title?: string; message?: string } | undefined;
        const blockNumber = eth?.blockNumber ?? (attr?.title?.match(/\/block\/(\d+)/)?.[1] ? parseInt(attr.title.match(/\/block\/(\d+)/)![1], 10) : undefined);
        const blockHash = eth?.blockHash ?? attr?.message;
        if (blockNumber === undefined || !blockHash) return;
        const resp = await fetch(`/api/proofs/witness?block=${blockNumber}&hash=${encodeURIComponent(blockHash)}`);
        if (resp.ok) {
          const w = await resp.json();
          addText(name, JSON.stringify(w, null, 2));
          // The block time lives inside the header, not beside it.
          const dir = name.slice(0, name.indexOf("ethereum-anchors/"));
          const side = name.includes("before") ? sidesOf(dir).before : sidesOf(dir).after;
          side.block = blockNumber;
          if (w?.headerRlpHex) side.ts = blockTimeFromHeader(w.headerRlpHex) || null;
        }
      } catch { /* non-critical: the bundle is valid without the witness */ }
    };

    const addAnchorsFor = async (dir: string, afterCounter: string, beforeCounter: string, epoch: string) => {
      try {
        if (!epoch) return;
        const enc = encodeURIComponent(epoch);
        const [afterResp, beforeResp] = await Promise.all([
          fetch(`/api/proofs/anchors?counter=${afterCounter}&epoch=${enc}`),
          fetch(`/api/proofs/anchors?counter=${beforeCounter}&epoch=${enc}&before=1`),
        ]);
        // The four ETH anchor files (before/after anchor + their block-header
        // witnesses) live together in an ethereum-anchors/ subfolder so they
        // don't clutter the bundle root. Audit discovery is by schema shape,
        // not filename or path, so nesting is transparent to the verifier.
        const anchorDir = `${dir}ethereum-anchors/`;
        if (afterResp.ok) {
          const data = await afterResp.json();
          if (data.anchors?.length > 0) {
            addText(`${anchorDir}anchor-after.json`, JSON.stringify(data.anchors[0], null, 2));
            await addWitnessFor(`${anchorDir}anchor-after-witness.json`, data.anchors[0]);
          }
        }
        if (beforeResp.ok) {
          const data = await beforeResp.json();
          if (data.anchors?.length > 0) {
            addText(`${anchorDir}anchor-before.json`, JSON.stringify(data.anchors[0], null, 2));
            await addWitnessFor(`${anchorDir}anchor-before-witness.json`, data.anchors[0]);
          }
        }
      } catch { /* non-critical */ }
    };

    // Add files one at a time, updating progress between each
    const singles: BitGraphProof[] = [];
    for (let i = 0; i < withProofs.length; i++) {
      setExportProgress({ current: i + 1, total: totalSteps });
      await tick();
      const { file: f, proof: p } = withProofs[i];
      const base = f.name.replace(/\.[^.]+$/, "");
      const prefix = multi ? `${base}/` : "";
      const fileBytes = new Uint8Array(await f.arrayBuffer());
      // A single recording keeps the flat layout (file + proof.json, covered
      // by the batch-level anchor window below). Bytes that occupy SEVERAL
      // causal positions export each recording as its own complete unit,
      // exactly like separate files in a batch: bitgraph-{counter}/ holds its
      // own copy of the file, proof.json, and that recording's own bounding
      // anchors. A shared window spanning distant recordings would be
      // uselessly loose for the older ones.
      const allPositions = withProofs[i].proofs.length ? withProofs[i].proofs : p ? [p] : [];

      // A file fused in this drop exports as a package: the original the
      // visitor keeps and the new file beside it under new-file/. The new
      // file is virtual everywhere else; the export is the one moment it is
      // asked for, because that is when the BitGraph leaves the page for
      // someone who has neither the original nor a tool that rebuilds
      // (Mike, 2026-09-03). Same shape as a proof page's package.
      //
      // It sits INSIDE the export dir of the position that committed it. A
      // flat export has one dir and that position owns it; a file holding
      // several positions gives each its own complete unit, and new-file/
      // beside the set would belong to none of them: a folder dropped back in
      // reads it as a loose file sitting beside the verdicts, since a check
      // claims new-file/ only WITHIN an export. Only the flat case can arise
      // today, since a fuse leaves the file holding exactly the position it
      // just made, and the placement does not depend on that staying true.
      const fusedOut = withProofs[i].fused;
      if (fusedOut) {
        const own = allPositions.length > 1
          ? allPositions.find((pos) => pos.commit?.counter === fusedOut.proof.commit?.counter &&
                                       pos.commit?.epochId === fusedOut.proof.commit?.epochId)
          : null;
        // Its own position, or the export root when the positions do not name
        // it: a home that is merely imprecise beats dropping the bytes.
        const dir = own?.commit?.counter ? `${prefix}bitgraph-${own.commit.counter}/` : prefix;
        // No Frame: proof.json beside it already carries the same signed proof,
        // and the manifest a Frame adds is derivable from it apart from the new
        // file's name, which is this entry (Mike, 2026-09-03). That entry keeps
        // the original's own name and is told apart by its folder: it is the
        // same file plus 48 bytes, not a different thing.
        const fusedEntry = new ZipPassThrough(`${dir}new-file/${f.name}`);
        z.add(fusedEntry);
        fusedEntry.push(fusedOut.fusedBytes, true);
      }
      if (allPositions.length <= 1) {
        const fileEntry = new ZipPassThrough(`${prefix}${f.name}`);
        z.add(fileEntry);
        fileEntry.push(fileBytes, true);
        for (const pos of allPositions) {
          addText(`${prefix}proof.json`, JSON.stringify(pos, null, 2));
          singles.push(pos);
          built.push({ dir: prefix.replace(/\/$/, ""), fileName: f.name,
                       proof: pos as unknown as Record<string, unknown>, sides: sidesOf(prefix) });
        }
      } else {
        for (const pos of allPositions) {
          const c = pos.commit?.counter;
          const dir = `${prefix}bitgraph-${c ?? "unknown"}/`;
          const fileEntry = new ZipPassThrough(`${dir}${f.name}`);
          z.add(fileEntry);
          fileEntry.push(fileBytes, true);
          addText(`${dir}proof.json`, JSON.stringify(pos, null, 2));
          if (c) await addAnchorsFor(dir, c, c, pos.commit?.epochId || "");
          built.push({ dir: dir.replace(/\/$/, ""), fileName: f.name,
                       proof: pos as unknown as Record<string, unknown>, sides: sidesOf(dir) });
        }
      }
    }

    // Bracket the single-recording proofs with a batch-level anchor window:
    // "after" follows the highest counter, "before" precedes the lowest.
    // Multi-recording files already carry per-recording anchors above.
    setExportProgress({ current: withProofs.length + 1, total: totalSteps });
    await tick();
    if (singles.length > 0) {
      const last = singles.reduce((a, b) =>
        parseInt(b.commit?.counter || "0", 10) > parseInt(a.commit?.counter || "0", 10) ? b : a);
      const first = singles.reduce((a, b) =>
        parseInt(b.commit?.counter || "0", 10) < parseInt(a.commit?.counter || "0", 10) ? b : a);
      await addAnchorsFor("", last.commit?.counter || "0", first.commit?.counter || "0", last.commit?.epochId || "");
    }
    // Every proof folder gets its own page; only a collection gets the index
    // over them. A single recording has nothing to index, and the proof page is
    // already a link away. Same rule the BitGraph Folder applies.
    // ❄️ NO index.html, and no contact sheet across the batch. A batch export
    // used to carry a page per recording plus a sheet linking them; both are
    // gone, the same cut the Folder took in 1.12.0 and for the same reasons.
    // They were a second implementation of the proof page that drifted from
    // it, and the verdict they showed was computed by whoever built the
    // export rather than by the person reading it. Browsing a batch is a
    // drop: the whole folder onto bitgraph.ing, checked against the ledger in
    // the reader's own browser.

    setExportProgress({ current: totalSteps - 1, total: totalSteps });
    await tick();
    z.end();
    // Wait for streaming zip to finish (it's synchronous internally but need to drain)
    while (!zipDone && !zipError) await tick();
    if (zipError) throw zipError;

    setExportProgress({ current: totalSteps, total: totalSteps });
    const totalSize = chunks.reduce((s, c) => s + c.length, 0);
    const merged = new Uint8Array(totalSize);
    let offset = 0;
    for (const c of chunks) { merged.set(c, offset); offset += c.length; }
    const blob = new Blob([merged.buffer as ArrayBuffer], { type: "application/zip" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    // The Folder's naming, in both arities: one file is `BitGraph (name).zip`
    // exactly as its export folder would be called, and a batch says what it
    // holds instead of "batch". Two other schemes lived here before.
    a.download = withProofs.length === 1
      ? `BitGraph (${withProofs[0].file.name.replace(/[\x00-\x1f\x7f/]/g, " ").trim()}).zip`
      : `BitGraph (${withProofs.length} files).zip`;
    a.click();
    URL.revokeObjectURL(url);
    setStep("results");
  }


  // A visitor supplied a file that hashes to a dropped proof.json's digest. Mark
  // the row matched and cache the real artifact so opening the proof shows it.
  function handleMatched(index: number, file: File) {
    const proof = items[index]?.proof;
    setItems(prev => prev.map((it, j) => j === index ? { ...it, matchedFile: file } : it));
    if (proof) cacheArtifactToIDB(file, proof.artifact.digestB64).catch((e) => console.error("[bitgraph] cache error:", e));
  }

  /* ── Styles ── */
  /* ── One shared look for every wait state (read / check / prove / package):
     the same spinner, the same label, and a determinate bar whenever there is a
     live count to show. Keeps the whole drop→record flow cohesive: one gerund
     label "{Verb} {n} of {total}", one Unicode ellipsis, no stray percentages. ── */
  const waitSpinner: React.CSSProperties = { width: 32, height: 32, border: "3px solid #e2e5e9", borderTopColor: "#0065A4", borderRadius: "50%", animation: "spin 0.8s linear infinite" };
  const waitLabel: React.CSSProperties = { fontSize: 15, fontWeight: 700, color: "#111827", letterSpacing: "-0.01em", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
  const waitTrack: React.CSSProperties = { width: "min(260px, 72vw)", height: 2, borderRadius: 1, background: "#e2e5e9", overflow: "hidden" };
  const waitFill = (pct: number): React.CSSProperties => ({ width: `${pct}%`, height: "100%", background: "#0065A4", transition: "width 0.15s" });

  return (
    <div style={{ background: "var(--bg)", color: "var(--c-text)", display: "flex", flexDirection: "column" }}>
      <style>{`
        /* Drop step: the same column as /folder and /day, to the pixel —
           90% up to 800, 40px under the nav, top-aligned. The centered-hero
           formula (and its /camera morph pairing) is RETIRED with the hero:
           the page is a tool that starts at the top, like every other page.
           Mike: "less flashy, more utilitarian". */
        .bitgraph-wrap { width: 90%; max-width: 800px; margin: 0 auto; padding: 40px 0 80px; display: flex; flex-direction: column; align-items: stretch; justify-content: flex-start; gap: 24px; }
        /* The drop step fills the space under the nav and centres in it, so
           whatever the frame cannot use (the aspect ratio caps it whenever
           width binds) is split above and below instead of all falling to the
           bottom. Symmetric padding, or the content sits 20px high of centre.
           Scoped off the results view, which is a scrolling list and wants to
           start at the top. */
        .bitgraph-wrap:not(.bitgraph-results):not(.bitgraph-flow) { justify-content: center; min-height: var(--bg-wrap-min, auto); padding-bottom: 40px; }
        /* A page that keeps going under the frame: no viewport centring, and the
           frame is capped so the first section shows without scrolling for it. */
        .bitgraph-wrap.bitgraph-flow { padding: 10px 0 30px; }
        .bitgraph-wrap.bitgraph-flow .bitgraph-camera { max-height: 300px; }
        /* 40 under the nav, the same as the ledger and the docs pages (it was
           32, and the results heading sat tight: Mike, 2026-08-19: "should
           'bitgraphs found' breathe a bit more?"). */
        .bitgraph-wrap.bitgraph-results { padding-top: 40px; padding-bottom: 48px; }
        /* ── Results: the box is closed behind one link (Mike, 2026-08-19).
           At full size it was ~490px of empty dashed rectangle over the list
           the drop produced, with "BitGraph Found" below the first screen. It
           was a 176px strip for an hour; Mike's better idea: a link that
           EXPANDS the box to full size in place. The results lead, nothing
           leaves the page, and the box is one click away, or no clicks: a
           file drag entering the window opens it, so the folder gesture (drag
           is the only way a folder arrives) still lands. Closed means CLOSED:
           no title, no box, the results start at the top of the page (Mike's
           mock), and the link sits on the right of the first results heading.
           Opening brings "the whole thing header included": the hero mounts
           above the results exactly as the drop step has it. ── */
        .bitgraph-hero { display: flex; flex-direction: column; align-items: stretch; }
        /* The title takes its type from .bg-page-title (globals), the one
           page-title definition on the site. What is left here is the size
           exception below and the gap to the frame. */
        /* ── CENTRED, the title alone (Mike, 2026-08-19, evening: "now i feel
           like that should be centered"). It went left that afternoon, when
           the row also carried a link on its right and sat over a left-aligned
           "BitGraph Found"; with the link gone and home's title now the claim
           itself ("A BitGraph gives bits a place"), what is left is one
           sentence over a symmetric box, and a sentence like that reads as a
           statement, which wants the centre. Only the title: the box's own
           copy was always centred, and the block under the box (/actor's
           "Forget this device") stays where Mike put it, bottom left. ── */
        .bitgraph-tagline { text-align: center; }
        /* 36px, taken over from the deck that used to sit between this title
           and the frame (removed 2026-08-18: it read "a place in space and
           time", and both halves were wrong). The 12px here before
           was the title-to-deck gap, binding those two as one block; with the
           deck gone it would have left the headline three optical pixels above
           a box that opens a file dialog on a stray hit. 36 is the number that
           was already tuned against the frame, so the title inherits it rather
           than a new one being invented.

           No terminal period on the title, matching how it already renders in
           the tab title, the OpenGraph title and the Twitter card ("BitGraph |
           A camera for bits"). Docs pages keep theirs: those are prose, this
           is the app surface. */
        .bitgraph-tagline { margin: 0 0 36px; }
        /* The one place on the site that departs from the shared title size.
           .bg-page-title is clamp(26px, 6vw, 32px), which stops growing at a
           533px viewport, so on every desktop it is a flat 32px. That was fine
           while the page was fixed too. It is not now: the frame scales with
           the window, so the title shrank against it on every larger screen,
           and at 32px it lost the room to the drop box's own 26px headline,
           which is longer and sits in a white field.

           40, not 48. 48 cleared the drop box's headline easily but read as
           marketing-page big, which is the opposite of what this page is. At
           40 it outranks that headline by type size (40 against 26) and sits
           near parity with it in width, without shouting.

           The FLOOR moves too, 26 to 34, and this is the part that costs
           something. Raising only the cap fixed desktop and left the phone
           worse than before: the drop box's headline barely shrinks (26 to
           22), so at a 26px title the ratio fell to 1.18 and the title was
           NARROWER than the headline beneath it (189 against 257). 34 puts the
           phone at 1.55 and 0.96, matching desktop.

           The cost is real: home's title is now larger than its peers on
           phones as well as desktops, so the one-size rule is excepted at the
           size where pages are most often compared, not just where the shared
           rule had already flatlined. Deliberate, and the number to dial if it
           ever reads as too much. */
        /* ⚠️ The 34px floor above was for "A camera for bits" (17 characters).
           The title is now "A BitGraph gives bits a place" (29), which at 34px
           is ~450px wide and wraps to two lines in a phone's ~350px column
           (Mike, 2026-08-19: "on mobile it wraps. has to be smaller i suppose
           on mobile"). So on phones the size follows the viewport: the
           sentence measures 13.2x its font size in this face, the column is
           90vw, and 6.6vw keeps it on one line from a 360px viewport up (25.7px
           at 390, 23.8 at 360; 22 is the floor, which wraps only on 320px
           devices). Then, the same evening: "maybe it should match docs titles
           size?" Yes: that retires the one exception to the site's type
           ladder (.bg-page-title is clamp(26px, 6vw, 32px), a flat 32 on
           desktop; home had been 34..40 since the frame started scaling with
           the window). So: the docs size from 433px up, identical to every
           other title, and below that the floor is 22 rather than 26 only so
           the sentence holds one line on small phones (23.4px at 390, 22 at
           360; 26 would wrap at 375). Same rule on both camera pages. */
        .bitgraph-tagline { font-size: clamp(22px, 6vw, 32px); }
        .bitgraph-tagline .accent { color: inherit; }
        /* The block under the frame (home's one link, /actor's Rename ·
           Forget) is the page's: its class and its margin live in the page's
           own style. Both are 42px over one 16px line box, which is what
           keeps the two frames the same size (see useCameraFit above). */
        /* Waiting states (read/check/prove/export) all pin their center to the
           SAME viewport point the success checkmark uses (fixed, 44% down,
           horizontally centered), so every wait and the capture moment share
           one anchor. Fade only: a translate animation would fight the
           centering transform. */
        .bitgraph-wait { position: fixed; top: 44%; left: 50%; transform: translate(-50%, -50%); display: flex; flex-direction: column; align-items: center; gap: 16px; width: max-content; max-width: 92vw; animation: popIn 0.3s ease-out; }
        @keyframes countPop { 0% { transform: scale(0.5); opacity: 0 } 50% { transform: scale(1.15) } 100% { transform: scale(1); opacity: 1 } }
        @keyframes slideIn { from { opacity: 0; transform: translateY(12px) } to { opacity: 1; transform: translateY(0) } }
        @keyframes popIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.4 } }
        @keyframes spin { to { transform: rotate(360deg) } }
        @keyframes glow { 0%, 100% { box-shadow: none } 50% { box-shadow: none } }
        /* Freshly-created BitGraph row: slides up while a brand-tinted wash
           fades out, so the eye lands on the new #number. */
        @keyframes proveReveal { 0% { opacity: 0; transform: translateY(12px); background: rgba(0,101,164,0.16) } 55% { background: rgba(0,101,164,0.16) } 100% { opacity: 1; transform: translateY(0); background: rgba(0,101,164,0) } }
        /* Success header: the badge pops and the check strokes itself in — the
           canonical "done" cue — while the count tallies up beside it. */
        @keyframes headerReveal { from { opacity: 0 } to { opacity: 1 } }
        @keyframes checkDraw { from { stroke-dashoffset: 26 } to { stroke-dashoffset: 0 } }
        /* Short viewports: a phone in landscape. At ~380px of height the page
           broke its own no-scroll promise badly, 121px of overflow with the
           example link entirely below the fold, because the type and gaps are
           sized for a tall window and the frame's floor did the rest.

           Everything that is generous at full height gets tightened here, and
           the title switches from a vw basis to vh, since on a landscape phone
           the constraint is height, not width. Nothing is hidden: the whole
           composition still fits, just closer together. */
        @media (max-height: 520px) {
          .bitgraph-wrap:not(.bitgraph-results) { padding-top: 12px; padding-bottom: 12px; }
          .bitgraph-tagline { font-size: clamp(20px, 4.5vh, 30px); margin-bottom: 14px; }
        }
      `}</style>
      {/* Nav is in root layout */}

      {/* The id also rides as a class, so a page can style its own instance
          without reaching every other page that renders one. */}
      <div className={`bitgraph-wrap bitgraph-${id}${step !== "drop" ? " bitgraph-results" : !fitViewport ? " bitgraph-flow" : ""}`}>

        {/* ── The camera: the page's title, the box first thing, then the
            page's block under it. The ledger lives on its own /day page.

            ⚠️ IT STAYS ON THE RESULTS STEP TOO (Mike, 2026-08-19). It used to
            vanish, on the reasoning that results were a terminal "here is what
            you did" view and the nav logo was the way back. Once a solo lookup
            stopped navigating to a proof, the results view became somewhere a
            drop could LAND rather than only somewhere it finished, with no way
            to drop again short of a reload. A second drop REPLACES the list:
            a drop is a batch, and the list is that batch.

            ⚠️ useCameraFit stays gated on step === "drop" and must; see the
            note at the hook call. ── */}
        {(step === "drop" || (step === "results" && (!showingResults || boxOpen))) && (
          <div className="bitgraph-hero" style={{ animation: "slideIn 0.3s ease-out" }}>
            {/* No page title over a box summoned onto a results page (Mike,
                2026-08-19: "maybe we remove headings on results pages where
                youre making MORE bitgraphs. it will also save room and be
                cleaner"). The reader summoned the box from the results; a
                title over it is ceremony, and the heading row below it, whose
                job was to hold the link that opens the box, goes with it.
                Expanded over results is: the box, then the card and the rows. */}
            {/* A page that carries its own hero passes no title; the box then
                opens with its own first line and nothing is said twice. */}
            {!showingResults && title && <h1 className="bg-page-title bitgraph-tagline">{title}</h1>}
            {!showingResults && above}
            <div className="bitgraph-camera">
              <FileDrop
                multiple
                onFile={(f) => handleFiles([f])}
                onFiles={handleFiles}
                onFolder={handleFolder}
                onFolderScan={handleFolderScan}
                // The title names BOTH functions, because the box is one
                // gesture with two outcomes: a file not on the ledger gets
                // recorded, one already on it gets looked up, and the user
                // never picks which. Naming only the first ("Record a
                // BitGraph") read as though an already-recorded file had no
                // business here. Plural because a folder makes many at once.
                // The line under it names both gestures.
                // The folder half of that line is load-bearing: dragging is
                // the ONLY way a folder can arrive, since every browser's
                // click path to one raises a view-files or upload-files
                // warning on a page whose whole claim is that nothing is
                // uploaded. See the note in file-drop.tsx before cutting it.
                headline={dropHeadline}
                hint={dropHint}
                // "Hashed in your browser, never uploaded." (Mike, 2026-08-26,
                // replacing "Your file never leaves your device"): name the
                // mechanism, scope the denial to the file. The digest travels
                // to the ledger; the file never does, so the line stays true
                // with the network tab open, where "Nothing is uploaded"
                // would not have.
                subhint={dropSubhint}
                note={frameNote}
              />
            </div>
            {/* The page's block, under the box, left (Mike, 2026-08-19: "move
                Forget this device to bottom left on Actor"; home has none).
                Rendered only when the page gave one, so a page without it
                adds no height; the fit observes it by class when present. */}
            {!showingResults && below && <div className={belowClassName}>{below}</div>}
          </div>
        )}

        {/* ── Scanning: read the files, then check the ledger. Both use the
            shared wait look; the bar appears only when there is a live count
            (always while reading, and for large ledger checks). ── */}
        {step === "scanning" && (scanPhase === "walking" ? (
          <div className="bitgraph-wait">
            <div role="status" aria-label="Reading your folder" style={waitSpinner} />
            {/* No bar: the size of a folder is not known until it has been
                read, and a bar that cannot reach its end is worse than none.
                The count alone is enough to show the work is moving. */}
            <div style={waitLabel}>
              {walkCount > 0
                ? `Reading your folder… ${walkCount.toLocaleString()} file${walkCount === 1 ? "" : "s"}`
                : "Reading your folder…"}
            </div>
          </div>
        ) : scanPhase === "reading" ? (
          <div className="bitgraph-wait">
            <div role="status" aria-label="Reading files" style={waitSpinner} />
            <div style={waitLabel}>Reading {scanProgress.current} of {scanProgress.total}</div>
            <div style={waitTrack}>
              <div style={waitFill(scanProgress.total ? (scanProgress.current / scanProgress.total) * 100 : 0)} />
            </div>
          </div>
        ) : (
          <div className="bitgraph-wait">
            <div role="status" aria-label="Checking the ledger" style={waitSpinner} />
            {/* Digest lookups are one round trip and only worth counting when
                chunked; a folder check is per-export round trips, so its count
                is live from the first export. */}
            {checkProgress.total > 50 || (folderChecking && checkProgress.total > 0) ? (
              <>
                <div style={waitLabel}>Checking {checkProgress.current} of {checkProgress.total}</div>
                <div style={waitTrack}>
                  <div style={waitFill(checkProgress.total ? (checkProgress.current / checkProgress.total) * 100 : 0)} />
                </div>
              </>
            ) : (
              <div style={waitLabel}>Checking…</div>
            )}
          </div>
        ))}

        {/* ── Proving: a single chunk (up to 50 files) is one round trip with
            nothing to count, so it just spins; multi-chunk drops tick every
            ~1.5s and get the live count + bar so a big batch never reads as
            stuck. Same look as reading/checking. ── */}
        {step === "proving" && (
          <div className="bitgraph-wait">
            <div role="status" aria-label="BitGraphing" style={waitSpinner} />
            {/* The strategy's own wait comes first when it has one: /actor's
                "Waiting for you" while the touch prompt is up is not
                BitGraphing yet, and saying so is what tells the visitor why
                nothing is moving. */}
            {recordStatus ? (
              <div style={waitLabel}>{recordStatus}…</div>
            ) : proveProgress.total > 50 ? (
              <>
                <div style={waitLabel}>BitGraphing {proveAnimCount} of {proveProgress.total}</div>
                <div style={waitTrack}>
                  <div style={waitFill(proveProgress.total ? (proveAnimCount / proveProgress.total) * 100 : 0)} />
                </div>
              </>
            ) : (
              <div style={waitLabel}>BitGraphing…</div>
            )}
            {/* Shown only while a commit is held for the daily rotation.
                The files are hashed and safe; nothing is lost by waiting.
                One line, quiet gray, same voice as the drop hints. */}
            {teeRestarting && (
              <div style={{ fontSize: 13, color: "#4b5563", textAlign: "center", maxWidth: 420 }}>
                The camera is restarting for its daily key renewal. Your file is
                hashed and held; recording resumes automatically.
              </div>
            )}
          </div>
        )}

        {/* ── Exporting: the .zip step count doesn't map to the file count, so
            it just spins. Same look as the others. ── */}
        {step === "exporting" && (
          <div className="bitgraph-wait">
            <div role="status" aria-label="Packaging" style={waitSpinner} />
            <div style={waitLabel}>Packaging…</div>
          </div>
        )}

        {/* ── Results ── */}
        {step === "results" && (items.length > 0 || checked.length > 0) && (
          <div style={{ animation: "slideIn 0.3s ease-out", display: "flex", flexDirection: "column", gap: 24 }}>

              {/* The drop box now sits above this (see the camera block), so a
                  new batch is another drop rather than a trip through the nav.
                  ⚠️ A second drop REPLACES this list rather than appending,
                  which is where home still differs from /actor deliberately: a
                  drop here is a batch, and /actor's rows accumulate because
                  acting on files one at a time is its whole point.
                  Historical note: this view used to be terminal, and the
                  "BitGraph" logo in the nav returned to the drop
                  screen (it force-reloads home). Matches the proof page, which
                  also has no camera. */}

              {/* ── The folder's Ledger: a dropped BitGraph folder loads HERE
                  instead of carrying its own generated sheet (Mike,
                  2026-08-05: "no index file at all... you drag and drop the
                  whole folder into the camera and it loads the ledger! and this
                  viewer can have small thumbs"). Ledger grammar throughout: day
                  headers over causal order, rows with a small thumb made from
                  the dropped bytes themselves, the verdict in the two-outcome
                  colors — blue "matches the ledger", red naming the side that
                  differed. NO buttons: the drop triggered everything. ── */}
              {checked.length > 0 && <CheckedList checked={checked} onOpen={openCheckedRow} heading={boxOpen ? null : "BitGraphs in this folder"} aside={openLink} />}

              {/* The whole batch state lives in one receipt card (same anatomy
                  as the proof page's receipt): count + export in the body, and
                  when files remain unrecorded, a Record row in the arrow-link
                  style. No banners anywhere — the drop was the gesture. */}
              {/* Title sits above the card as a page heading, the same way the
                  proof page and the ledger title their content. Wrapped so the
                  column's 24px gap applies below the card, not under the title. */}
              {items.length > 0 && (<>
              <div>
              {/* The one title size every page header uses. 20px, not 10:
                  the proof page's identical title sits in a 10px-gap grid AND
                  carries a 10px margin, so it clears its card by 20. Here the
                  wrapper below deliberately absorbs the column gap, so the
                  margin has to carry the whole distance itself. */}
              {/* ⚠️ The heading states what the drop DID, which is not always
                  recording. It says Found until this page has actually minted
                  something (Mike, 2026-08-19: "make it say found until
                  something is recorded"). The earlier rule, Found only when
                  EVERY row was found, put "BitGraphs Recorded" over a batch
                  that still had its Record row waiting, with nothing recorded
                  yet. A lookup is not a recording, and neither is a list of
                  files that could be. */}
              {/* The heading row is the control row: it holds the link that
                  opens the box. With the box open it has nothing left to do
                  and is not rendered (see the note in the hero). */}
              {!boxOpen && (
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16, marginBottom: 24 }}>
                  <div className="bg-page-title">
                    BitGraph{items.length === 1 ? "" : "s"}{" "}
                    {items.some((i) => i.status === "proved") ? "Recorded" : "Found"}
                  </div>
                  {/* The link to reopen the camera, on the first heading only:
                      when a folder's Ledger is above this, it carries it. */}
                  {checked.length === 0 && openLink}
                </div>
              )}
              <div style={{ background: "#fff", border: "1px solid #d0d5dd" }}>
                <div style={{ padding: "18px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
                  <span key={`${allDone}-${items.length}`} style={{ fontSize: 15, fontWeight: 700, color: "#111827", fontVariantNumeric: "tabular-nums", animation: "headerReveal 0.4s ease-out both", whiteSpace: "nowrap" }}>
                    {animCount} of {items.length}
                  </span>
                  {found.length > 0 && (anchorCountdown > 0 ? (
                    <span style={{ fontSize: 13, color: "#4b5563", whiteSpace: "nowrap" }}>
                      Download in {anchorCountdown}s
                    </span>
                  ) : (
                    // Same action-link idiom as every other action in the
                    // product. Paired with the count on its left, so it hangs
                    // on the right the way "Open →" does on a file row.
                    // One name everywhere, the same as the proof page's, for
                    // the same object: the originals, their proofs, each new
                    // file under new-file/, and the Ethereum anchors. It
                    // no longer counts files and proofs in the label; the
                    // package is one thing whatever it holds, and the count
                    // sits on its left. It was "Download .zip" before that,
                    // which described the plumbing rather than the contents.
                    <button onClick={downloadZip} className="bg-action-link" style={{ padding: 0 }}>
                      <span>Export BitGraph package</span>
                      <span className="arrow" aria-hidden>&rarr;</span>
                    </button>
                  ))}
                </div>
                {/* Files not yet on record get their action as a receipt row:
                    the same arrow-link voice as "See an example …" on the
                    drop screen. Writing to the ledger stays deliberate — a
                    line you read and choose, not a banner that shouts.
                    ⚠️ ONE action, never two. A "Record N files instead" link
                    sat beside this one until 2026-09-04, from a reading in
                    which BitGraph had two ways of recording. It does not:
                    making a BitGraph is the operation, and the digest-only
                    commit is an API and MCP compatibility path, not a second
                    choice put in front of whoever dropped the files. */}
                {unproven.length > 0 && (
                  <div style={{ borderTop: "1px solid #eef0f1", padding: "0 16px" }}>
                    <button type="button" className="bg-action-link" onClick={proveRemaining}>
                      <span>{fuseByDefault ? "BitGraph" : "Record"} {unproven.length} file{unproven.length === 1 ? "" : "s"}</span>
                      <span className="arrow" aria-hidden>&rarr;</span>
                    </button>
                  </div>
                )}
                {/* What the strategy has to say about a run that did not
                    finish, in the card, under the row that offers the retry.
                    One sentence, the error colour, same voice as the hints. */}
                {recordMessage && (
                  <div style={{ borderTop: "1px solid #eef0f1", padding: "12px 16px", fontSize: 13, color: "#dc2626" }}>
                    {recordMessage}
                  </div>
                )}
              </div>
              </div>

              {/* File list: one card per file separated by a gap so each file's
                  set of BitGraphs reads as a distinct block. Within a card,
                  recordings share hairline separators; the gap between cards is
                  the file boundary. 10px matches the explorer/Ledger row gap, so
                  every openable-card surface spaces its cards identically. */}
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {shown.map((item, i) => {
                // One row per BitGraph. Chronological, ORIGINAL first: a
                // file's card reads as its provenance story (first existed at
                // #N, recorded again at #M), so the earliest causal position
                // leads and carries the "original" mark. Pending files are not
                // listed here; an errored file shows a single row.
                const rowProofs: Array<BitGraphProof | null> =
                  item.proofs.length ? item.proofs : item.proof ? [item.proof] : [null];
                const openProof = (p: BitGraphProof) => {
                  // Same-tab navigation: the recordings also live in the explorer/
                  // Ledger, so leaving this page loses nothing. Use the proof's digest
                  // (from TEE) for the URL, not the browser-computed hash;
                  // ?counter=&epoch= pins THIS row's causal position.
                  const proofDigest = p.artifact.digestB64;
                  const c = p.commit?.counter;
                  const epoch = p.commit?.epochId ? toUrlSafeB64(p.commit.epochId) : "";
                  const sel = c ? `?counter=${encodeURIComponent(c)}${epoch ? `&epoch=${encodeURIComponent(epoch)}` : ""}` : "";
                  // Cache the artifact bytes (and any embedded C2PA manifest) in the
                  // background; the client-side push keeps this JS context alive and
                  // the proof page polls IndexedDB, so navigation never waits on the
                  // ~6 MB C2PA toolkit. For a dropped proof.json the file in hand is
                  // the JSON, not the artifact, so only cache a real file.
                  const artifactFile = item.fromProofJson ? item.matchedFile : item.file;
                  if (artifactFile) {
                    void cacheArtifactToIDB(artifactFile, proofDigest).catch((e) => console.error("[bitgraph] cache error:", e));
                  }
                  router.push(`/proof/${encodeURIComponent(toUrlSafeB64(proofDigest))}${sel}`);
                };
                // Rows without a counter yet show their state in the left slot.
                const pendingLabel =
                  item.status === "new" ? "Not yet BitGraphed"
                  : item.status === "proving" ? "BitGraphing…"
                  : item.status === "error" ? "Error"
                  : null;
                // Every recording is the same explorer-style row: the # position
                // on the left, Open on the right. A file with SEVERAL recordings
                // (the same bytes BitGraphed again) stacks its rows in the one
                // card, each labelled "(k of N)" with the earliest marked as the
                // original, so the group reads as one file's provenance.
                const proofCount = item.proofs.length || (item.proof ? 1 : 0);
                return (
                  <div key={item.file.name + i} className="bitgraph-file-card" data-clickable={proofCount > 0} style={{ border: "1px solid #d0d5dd", animation: `slideIn 0.2s ease-out ${i * 0.04}s both` }}>
                  {rowProofs.map((p, k) => {
                    const clickable = !!p;
                    const counter = p?.commit?.counter;
                    return (
                  <div
                    key={`${item.file.name}-${counter ?? "pending"}-${k}`}
                    role={clickable ? "button" : undefined}
                    tabIndex={clickable ? 0 : undefined}
                    onClick={clickable ? () => openProof(p) : undefined}
                    onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openProof(p); } } : undefined}
                    className={`bitgraph-result-row${clickable ? " bitgraph-file-row" : ""}`}
                    style={{
                      display: "flex", alignItems: "center", gap: 12,
                      padding: "14px 16px",
                      // The card boundary + gap separates files; within a card,
                      // hairlines separate a file's recordings (k > 0).
                      borderTop: k > 0 ? "1px solid #eef0f1" : "none",
                      animation: item.status === "proved"
                        ? `proveReveal 1.1s ease-out ${(i + k) * 0.04}s both`
                        : undefined,
                      cursor: clickable ? "pointer" : "default",
                    }}
                  >
                    {/* The file's tiny thumb (or its type label), once per
                        card on the first row — recognition for a forty-photo
                        drop, same cell the checked day uses. Later rows of a
                        multi-recording card keep a spacer so the #s align. */}
                    {(() => {
                      const f = item.fromProofJson ? item.matchedFile : item.file;
                      if (k > 0) return <span style={{ width: 48, flexShrink: 0 }} aria-hidden />;
                      const thumb = f ? resultThumbs.get(f) : undefined;
                      const name = f?.name ?? item.file.name;
                      const ext = name.slice(name.lastIndexOf(".") + 1).toUpperCase().slice(0, 4);
                      return thumb ? (
                        <img src={thumb} alt="" style={{ width: 48, height: 48, objectFit: "cover", flexShrink: 0, border: "1px solid #e2e5e9", display: "block" }} />
                      ) : (
                        <span style={{ width: 48, height: 48, flexShrink: 0, border: "1px solid #e2e5e9", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#6b7280", fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                          {ext}
                        </span>
                      );
                    })()}
                    {/* Left — the position number (or the pending state for rows
                        not yet BitGraphed). No "BitGraph" prefix: everything on
                        this card is one, the # carries it. */}
                    <span style={{ flexShrink: 0, fontSize: 14, fontWeight: 400, color: counter != null ? "#374151" : item.status === "error" ? "#dc2626" : "#4b5563" }}>
                      {counter != null
                        ? <span style={{ fontWeight: 700, color: "#0065A4", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>#{Number(counter).toLocaleString()}</span>
                        : pendingLabel}
                    </span>
                    {/* When the same bytes were BitGraphed more than once, place
                        each row in the sequence "(k of N)" and mark the earliest
                        (k === 0) as the original. Single recordings show nothing
                        here, so an ordinary row stays just "# … Open". */}
                    {(() => {
                      // One kind of row: the original and the new file find the same
                      // proof, so a position is a position (Mike, 2026-09-03). With
                      // more than one, each keeps its ordinal and the earliest says so.
                      // "original" is reserved for the file a new file was made from.
                      const count = rowProofs.length;
                      if (count <= 1) return null;
                      return <span style={{ flexShrink: 0, fontSize: 12.5, color: "#4b5563", whiteSpace: "nowrap" }}>({k + 1} of {count}{k === 0 ? " · earliest" : ""})</span>;
                    })()}
                    {/* Whose key is on this recording, when one is. Read off
                        the proof itself, never assumed from the page: a name
                        appears only when the page is entitled to print one for
                        that key (/actor, its own); any other actor shows as
                        its key, and a recording with no actor shows nothing
                        rather than borrowing this browser's name. */}
                    {/* Right side matches the ledger's row anatomy: compact
                        anchor time, then the chevron. Unanchored rows (fresh
                        recordings) simply leave the time blank. */}
                    <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: "#4b5563", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {fmtRowWhen(item.times?.[k])}
                    </span>
                    {clickable && (
                      <span aria-label="Open" style={{ display: "inline-flex", flexShrink: 0, color: "#0065A4" }}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="square" strokeLinejoin="miter"><path d="M9 6 L15 12 L9 18" /></svg>
                      </span>
                    )}
                  </div>
                    );
                  })}
                  {item.fromProofJson && item.proof && (
                    <div style={{ padding: "0 16px 14px" }}>
                      {item.matchedFile ? (
                        <div style={{ padding: "12px 14px", border: "1px solid #0065A4", background: "#fff", fontSize: 13, fontWeight: 600, color: "#0065A4", display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontWeight: 700 }}>✓</span>
                          <span>This file matches the proof. Open to view it.</span>
                        </div>
                      ) : (
                        <FileMatchCheck proof={item.proof} onMatched={(f) => handleMatched(i, f)} />
                      )}
                    </div>
                  )}
                  </div>
                );
              })}
            </div>
            </>)}

          </div>
        )}

        {/* ❄️ Nothing at the foot of a results page, on either page (Mike:
            "What is a BitGraph → should simply be absent from results pages";
            then "make the two pages home and actor match"). The page's block
            belongs to the camera-alone composition: under the box, and only
            there. /actor's Forget is one click behind "Record or check more
            BitGraphs →" on a results page, which is where its box is too. */}
      </div>
    </div>
  );
}

/* The artifact-bytes handoff moved to lib/file-cache.ts so /folder can hand a
   clicked row's bytes to the proof page the same way the drop flow does. */


/* ── The shelf — /days, translated to a dropped folder. One cell per day,
   months newest first from now back to the oldest recording; a day is a link
   when the folder recorded on it, today is the outlined open frame leading
   back to the live view, and everything else sits grey. Zero data beyond the
   links, same as the site's. ── */

/* ── Inline file-match check — shown under a dropped proof.json so the visitor
   can confirm they hold the matching artifact. Hashed in the browser and
   compared to the proof's digest; nothing is uploaded. Mirrors the proof page's
   BringYourFile, scaled down to sit inside a results row. ── */
function FileMatchCheck({ proof, onMatched }: { proof: BitGraphProof; onMatched: (file: File) => void }) {
  const [state, setState] = useState<"idle" | "checking" | "mismatch">("idle");
  const [dragOver, setDragOver] = useState(false);
  const [checkedCount, setCheckedCount] = useState(0);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const inputRef = useRef<HTMLInputElement>(null);

  // Many files or whole folders in one drop; the match is found by hashing.
  // Same behavior as the proof page's BringYourFile.
  async function check(source: CapturedDrop | File[]) {
    setState("checking");
    setProgress({ done: 0, total: 0 });
    try {
      const { match, checked } = Array.isArray(source)
        ? await findMatchInFiles(source, proof.artifact.digestB64, (done, total) => setProgress({ done, total }))
        : await findMatchInDrop(source, proof.artifact.digestB64, (done, total) => setProgress({ done, total }));
      setCheckedCount(checked);
      if (!match) {
        // A fused proof is usually met with the ORIGINAL in hand. Find the
        // file that hashes to the signed origin digest, rebuild the fused
        // bytes with the registered placement, and accept it only when the
        // reconstruction reproduces the committed digest.
        const marker = fusedMarkerOf(proof);
        if (marker?.originDigestB64) {
          const origin = Array.isArray(source)
            ? await findMatchInFiles(source, marker.originDigestB64)
            : await findMatchInDrop(source, marker.originDigestB64);
          if (origin.match) {
            const rebuilt = await rebuildFromOrigin(proof, new Uint8Array(await origin.match.arrayBuffer()), origin.match.name);
            if (rebuilt.verification.category === "FUSED_FROM_ORIGIN") { onMatched(origin.match); return; }
          }
        }
        setState("mismatch");
        return;
      }
      onMatched(match);
    } catch {
      setState("mismatch");
    }
  }

  const mismatch = state === "mismatch";
  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      /* captureDrop synchronously, same rule as the proof page's box: one
         await later and the folders in a mixed drop are silently invisible. */
      onDrop={(e) => { e.preventDefault(); setDragOver(false); void check(captureDrop(e.dataTransfer)); }}
      style={{
        marginTop: 8,
        background: "#fff",
        border: `1.5px dashed ${mismatch ? "#dc2626" : dragOver ? "#0065A4" : "#c4c9d0"}`,
        padding: "18px 16px",
        textAlign: "center",
        cursor: "pointer",
        transition: "border-color .15s",
      }}
    >
      <input ref={inputRef} type="file" multiple style={{ display: "none" }} onClick={(e) => e.stopPropagation()} onChange={(e) => { const fs = Array.from(e.currentTarget.files || []); e.currentTarget.value = ""; if (fs.length) void check(fs); }} />
      {state === "checking" ? (
        <div style={{ fontSize: 14, fontWeight: 600, color: "#4b5563" }}>
          {progress.total > 1 ? `Checking ${progress.done} of ${progress.total}…` : "Checking…"}
        </div>
      ) : mismatch ? (
        <>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#dc2626" }}>
            {checkedCount > 1
              ? `None of the ${checkedCount.toLocaleString()} files match this proof`
              : "These bytes don’t match this proof"}
          </div>
          <div style={{ fontSize: 12.5, color: "#4b5563", marginTop: 5 }}>A single changed bit produces a completely different hash. Drop the exact original to check again.</div>
        </>
      ) : (
        <>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>Have the file? Check it matches this proof.</div>
          <div style={{ fontSize: 12.5, color: "#4b5563", marginTop: 5 }}>Drop files or a whole folder and the match is found by hash. In your browser; nothing is uploaded.</div>
        </>
      )}
    </div>
  );
}

