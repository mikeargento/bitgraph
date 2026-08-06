"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { proofPage, indexPage, blockTimeFromHeader, type ExportProof, type AnchorSide } from "@/lib/export-pages";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { FileDrop } from "@/components/file-drop";
import { SeeExample } from "@/components/see-example";
// Footer is in root layout
import {
  hashFile,
  commitDigest,
  commitBatch,
  isBitGraphProof,
  verifyProofSignature,
  proofHashB64,
  type BitGraphProof,
} from "@/lib/bitgraph";
import { toUrlSafeB64 } from "@/lib/explorer";
import { discoverDrop, startFolderCheck, findMatchInDrop, findMatchInFiles, type WalkedFile, type ExportCheckResult } from "@/lib/folder-check";
import { takePendingDrop } from "@/lib/pending-drop";
import { setFreshProof } from "@/lib/fresh-proof";
import { Zip, ZipPassThrough } from "fflate";
import type { C2PAReadResult } from "@/lib/c2pa-reader";

type Step = "drop" | "scanning" | "results" | "proving" | "exporting";

// Compact recorded time for a result row, e.g. "Jul 17, 9:22 PM" — the same
// format the Roll's rows use, so the two lists read as one system.
const fmtRowWhen = (ms?: number | null) =>
  ms ? new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";

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
}

// The results list survives leaving for a proof page: client-side navigation
// keeps the module alive, so browser-back restores the batch exactly as left
// (File objects intact — no serialization). A hard reload (the logo's
// documented "start over" gesture) still wipes it.
let cachedResults: FileItem[] | null = null;
// Same survival rule for a dropped folder's check verdicts (the File objects
// inside are only used again for click-through caching, so nothing serializes).
let cachedChecked: ExportCheckResult[] | null = null;

export default function BitGraphPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(() => (cachedResults?.length || cachedChecked?.length ? "results" : "drop"));
  const [items, setItems] = useState<FileItem[]>(() => cachedResults ?? []);
  // Verdicts for a dropped folder of BitGraph exports (the skeptic's drop):
  // one entry per export directory found in the drop, in walk order.
  const [checked, setChecked] = useState<ExportCheckResult[]>(() => cachedChecked ?? []);
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
  const [scanPhase, setScanPhase] = useState<"reading" | "checking">("reading");
  const [proveProgress, setProveProgress] = useState({ current: 0, total: 0 });
  // True while a commit is being held because the boundary is mid-rotation
  // (daily key renewal) or the fresh epoch's first anchor has not landed.
  // Files are already hashed; the record flow waits and retries on its own.
  const [teeRestarting, setTeeRestarting] = useState(false);
  const [proveAnimCount, setProveAnimCount] = useState(0);
  const proveAnimRef = useRef(0);
  const [, setExportProgress] = useState({ current: 0, total: 0 });
  const [animCount, setAnimCount] = useState(() =>
    cachedResults ? cachedResults.filter(i => i.status === "found" || i.status === "proved").length : 0);
  const [anchorCountdown, setAnchorCountdown] = useState(0);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Mirror the live batch into the module cache so browser-back from a proof
  // page restores this list (see cachedResults above).
  useEffect(() => {
    if (step === "results" && items.length > 0) cachedResults = items;
  }, [step, items]);
  useEffect(() => {
    if (step === "results" && checked.length > 0) cachedChecked = checked;
  }, [step, checked]);

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

  // Cleanup rAF on unmount only
  useEffect(() => {
    return () => { cancelAnimationFrame(rafRef.current); };
  }, []);

  // Files dropped on a proof page's camera strip arrive via the pending-drop
  // slot: pick them up on mount and run the normal drop flow.
  useEffect(() => {
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

  const found = items.filter(i => i.status === "found" || i.status === "proved");
  const unproven = items.filter(i => i.status === "new");
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
      const recProofs = rec?.proofs || [];
      const all = recProofs.map((x) => x.proof);
      if (all.length > 0) {
        const result = await verifyProofSignature(all[0]);
        // The ledger write moment rides along per recording so rows can show
        // a compact "when", same as the Roll. Legacy/backfilled entries have
        // none and just leave the slot blank.
        const times = recProofs.map((x) => (x as { writeTime?: number | null }).writeTime ?? null);
        return { file: f, digestB64: digest, proof: all[0], proofs: all, times, valid: result.valid, status: "found" as const };
      }
      return { file: f, digestB64: digest, proof: null, proofs: [], valid: null, status: "new" as const };
    }));

    return results;
  }

  async function handleFiles(files: File[]) {
    setStep("scanning");
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
      if (solo.status === "found" && solo.proof) {
        openProofPage(solo.proof, solo.file);
        return;
      }
      if (solo.status === "new" && solo.digestB64) {
        // Auto-record the lone new file, then open its fresh proof. Show the
        // proving spinner while the TEE signs (a second or two).
        setItems(results);
        setStep("proving");
        setProveProgress({ current: 0, total: 1 });
        try {
          // Through the rotation wrapper: a solo drop is the product's most
          // common gesture, and during the daily key renewal it must hold and
          // resume (the proving view shows the held message), not fail raw.
          const p = await commitThroughRotation(() => commitDigest(solo.digestB64));
          void announceRecorded([p]);
          openProofPage(p, solo.file, true);
          return;
        } catch {
          // Recording failed: fall back to the results card so the user can
          // retry via the explicit button instead of a dead end.
          setItems(prev => prev.map(i => i.digestB64 === solo.digestB64 ? { ...i, status: "new" as const } : i));
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
  async function handleFolder(walked: WalkedFile[]) {
    const scan = discoverDrop(walked);
    if (scan.exports.length === 0) {
      if (scan.strays.length) void handleFiles(scan.strays);
      return;
    }
    // The roll renders the moment the local scan finishes; verdicts stream
    // in per row behind it. No full-screen wait at all: browsing must be
    // instant, verification merely prompt.
    setFolderChecking(true);
    const { done } = startFolderCheck(scan.exports, {
      onRows: (rows) => {
        setChecked(rows);
        setItems([]);
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
      }).catch(() => { /* strays are secondary; the roll stands */ });
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

  // Hand each fresh recording straight to the Roll: the commit response
  // already knows the counter, so the dropper's own Roll shouldn't wait for
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

  async function proveRemaining() {
    const toProve = items.filter(i => i.status === "new");
    if (!toProve.length) return;

    setStep("proving");
    setProveProgress({ current: 0, total: toProve.length });
    setItems(prev => prev.map(i => i.status === "new" ? { ...i, status: "proving" as const } : i));

    try {
      if (toProve.length === 1) {
        const p = await commitThroughRotation(() => commitDigest(toProve[0].digestB64));
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
        // ~50 sign/sec, so progress ticks roughly every second.
        const CHUNK_SIZE = 50;
        // Yield to the event loop after each chunk so React paints the
        // progress update before the next batch starts (same pattern as the
        // exporting loop). Without this, fast batches can flush together.
        const tick = () => new Promise((r) => setTimeout(r, 0));
        for (let offset = 0; offset < toProve.length; offset += CHUNK_SIZE) {
          const chunk = toProve.slice(offset, offset + CHUNK_SIZE);
          const digests = chunk.map(t => ({ digestB64: t.digestB64, hashAlg: "sha256" as const }));
          const proofs = await commitThroughRotation(() => commitBatch(digests));
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
    } catch {
      setItems(prev => prev.map(i => i.status === "proving" ? { ...i, status: "error" as const } : i));
    }

    setStep("results");
    startAnchorCountdown();

    // Show the final count directly (see the note in handleFiles): the per-tick
    // animation re-rendered the whole list each increment and dragged on large
    // drops.
    setAnimCount(items.filter(i => i.status === "found").length + toProve.length);
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
    const wantsIndex = built.length > 1;
    for (const b of built) {
      // A recording named index.html gets no page: the zip entry would
      // collide with the artifact and the archive would carry the page
      // instead of the recorded bytes. Same rule the Folder applies.
      if (b.fileName === "index.html") continue;
      try {
        addText(b.dir ? `${b.dir}/index.html` : "index.html", proofPage({
          fileName: b.fileName,
          proof: b.proof as ExportProof,
          before: b.sides.before,
          after: b.sides.after,
          proofRaw: JSON.stringify(b.proof, null, 2),
          hasIndex: wantsIndex && !!b.dir,
        }));
      } catch (e) { console.error("[bitgraph] export page failed:", e); }
    }
    if (wantsIndex) {
      try {
        addText("index.html", indexPage(built.filter((b) => b.dir).map((b) => ({
          dir: b.dir,
          fileName: b.fileName,
          counter: (b.proof as ExportProof).commit?.counter ?? null,
          before: b.sides.before,
          after: b.sides.after,
        }))));
      } catch (e) { console.error("[bitgraph] export index failed:", e); }
    }

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

  // "See a BitGraph" — open the hosted example (a real photograph with C2PA
  // Content Credentials). It's a fixed, known proof, so we navigate STRAIGHT
  // to it — no fetch → hash → lookup drop pipeline first — and the page paints
  // at once off the warmed data. The photo is fetched and cached to IndexedDB
  // in the background under the known digest, so the proof page's poll shows it
   /* ── Styles ── */
  const card: React.CSSProperties = { border: "1px solid #d0d5dd", padding: "24px 20px", background: "#fff", borderRadius: 0, marginBottom: 16 };
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
        /* Drop step: the hero (tagline + box + "see an example") is centered in
           the space below the sticky nav. Subtracting ~72px (roughly the nav's
           height) makes the centering region the visible area under the nav, so
           the group sits balanced — equal air above and below — on both mobile
           and desktop. (An earlier bigger subtraction lifted it too high once
           the example link was added below the box.) The results view
           (bitgraph-results) overrides to top-aligned. */
        /* The hero's top offset is a FORMULA, not content-centering, and it is
           the SAME formula /camera uses for its headline: the tagline and "The
           frame exists first." land in the identical spot on every machine by
           construction (content-centering drifted with font metrics).

           The 318px constant is tied to the mobile camera height and is not free
           to move on its own. Because the offset rises at half the rate of the
           viewport, a constant-height box stays centered at every screen size,
           and 318 = (44px nav + 339px of hero that is not the box + 254px box)/2
           is what centers it. It was 306 when the box was 230. Change one, change
           the other, and change it in camera/page.tsx too or the morph drifts.
           Derivation and measurements live with .bitgraph-camera in globals.css. */
        .bitgraph-wrap { width: 90%; max-width: 800px; margin: 0 auto; padding: max(52px, calc(50dvh - 318px)) 0 32px; display: flex; flex-direction: column; align-items: stretch; justify-content: flex-start; gap: 24px; min-height: calc(100dvh - 72px); }
        @media (min-width: 769px) { .bitgraph-wrap { padding-top: max(52px, calc(50dvh - 386px)); } }
        .bitgraph-wrap.bitgraph-results { justify-content: flex-start; padding-top: 32px !important; padding-bottom: 48px; min-height: 0; }
        /* Drop step hero: the concept line ("A camera for bits.") stands alone,
           then the box (the tool), then the why/mechanics below it. This gap sits
           BETWEEN the tagline and the box, so give it real breathing room (the
           tagline is on its own now, no subhead bridging it) and let it scale. */
        .bitgraph-hero { display: flex; flex-direction: column; align-items: stretch; gap: clamp(26px, 4.5vw, 40px); }
        /* Sizing is driven by /camera's LONGER headline, never this one: "The
           frame exists first." must NEVER wrap, or it goes to two lines while
           this stays at one and the morph jumps. 9.3vw alone never wraps (the
           line needs ~9.17x the font size, the column gives 9.68x), so the only
           hazard was the old 36px floor, which overrode vw scaling below a 387px
           viewport and pushed 360px phones to two lines. The floor is now 24px,
           low enough that it cannot bind above a ~262px viewport, so vw governs
           on every real device and nothing above 387px changed at all.
           Keep /camera's h1 identical; re-measure at 320 and 360 if this or the
           weight or tracking ever moves. */
        .bitgraph-tagline { text-align: center; font-size: clamp(24px, 9.3vw, 54px); font-weight: 800; letter-spacing: -0.035em; line-height: 1.02; color: #111827; }
        .bitgraph-tagline .accent { color: inherit; }
        /* The tagline is a quiet door to the /camera explainer: a plain
           headline at rest that sweeps to brand blue on hover, so it never
           competes with the drop box for attention. */
        .bitgraph-tagline a { color: inherit; text-decoration: none; transition: color .15s ease; }
        .bitgraph-tagline a:hover, .bitgraph-tagline a:focus-visible { color: #0065A4; }
        /* The hero is two paired lines: the tagline (metaphor) and the "why" hook
           (promise) nested tight beneath it as a subhead, above the box. Keep the
           hook clearly subordinate to the tagline in size so it supports rather
           than competes. */
        .hero-head { display: flex; flex-direction: column; align-items: stretch; gap: clamp(12px, 2.5vw, 16px); }
        .hero-why { max-width: 600px; margin: 0 auto; text-align: center; font-size: clamp(15px, 3.6vw, 18px); line-height: 1.4; color: #1f2937; font-weight: 500; letter-spacing: -0.012em; text-wrap: balance; }
        .hero-why p { margin: 0; }
        /* ── "See a BitGraph" — a quiet link to a real example proof (an
           OpenAI-generated image whose C2PA credentials the proof page shows).
           A door to the output, not an explainer. ── */
        /* Explainer under the box: the one place the film/photograph metaphor is
           spelled out. Readable medium-gray, narrow measure, the quoted terms
           carry the emphasis (the blue accent stays reserved for "bits"). */
        /* One centered paragraph; text-wrap: balance equalizes the line
           lengths so the centered block reads symmetric, not ragged. */
        /* 15px matches the site's reading size (/subjects body prose) — this is
           the most load-bearing paragraph on the site and was set below it.
           15px also lands the 640px column at ~75 chars/line. Not 16px: that
           competes with the drop-zone hint and reads bloggy. */
        .hero-explainer { max-width: 640px; margin: 0 auto; text-align: center; font-size: 15px; line-height: 1.65; color: #374151; font-weight: 500; letter-spacing: -0.006em; }
        /* The one full-bleed text block on the page: without its own inset
           its balanced lines run closer to the glass than anything else on
           screen. 12px each side brings it to ~32px effective margin and a
           ~50-char mobile measure. */
        @media (max-width: 768px) { .hero-explainer { font-size: 13.5px; padding: 0 12px; } }
        /* Balance the line lengths so a centered paragraph breaks into roughly
           equal ragged lines at any width (mobile and desktop), not long-then-
           short. Recomputed per viewport by the browser. */
        .hero-explainer p { margin: 0; text-wrap: balance; }
        .see-example { text-align: center; }
        /* Enough space to read as a second offer rather than a second line of
           the first, without opening a gap the eye has to cross. */
        .see-example-second { margin-top: 10px; }
        .see-example-link { appearance: none; border: none; background: none; cursor: pointer; font-family: inherit; font-size: 14.5px; font-weight: 600; letter-spacing: -0.01em; color: #0065A4; display: inline-flex; align-items: center; gap: 7px; padding: 4px 6px; }
        .see-example-link .arrow { transition: transform .18s ease; }
        @media (hover: hover) { .see-example-link:hover .arrow { transform: translateX(3px); } }
        .see-example-link:focus-visible { outline: 2px solid #0065A4; outline-offset: 3px; }
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
      `}</style>
      {/* Nav is in root layout */}

      <div className={`bitgraph-wrap${step !== "drop" ? " bitgraph-results" : ""}`}>

        {/* ── Drop step: the hero. A concept line ("A camera for bits.") over
            the camera itself. Centered as one group by the wrap. The Roll lives
            on its own /roll page, linked from the nav. ── */}
        {step === "drop" && (
          <div className="bitgraph-hero" style={{ animation: "slideIn 0.3s ease-out" }}>
            {/* The two poetic lines pair as the hero: the metaphor, then the
                promise, tight together as a headline + subhead above the box. */}
            <div className="hero-head">
              <div className="bitgraph-tagline">
                <a href="/camera">A camera for <span className="accent">bits</span>.</a>
              </div>
              <div className="hero-why">
                <p>Give your data a place in space and time.</p>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "clamp(26px, 4.5vw, 40px)" }}>
              <div className="bitgraph-camera">
                <FileDrop
                  multiple
                  onFile={(f) => handleFiles([f])}
                  onFiles={handleFiles}
                  onFolder={handleFolder}
                  hint="Drag and drop, or click to choose."
                  subhint="Your file never leaves your device."
                />
              </div>
              {/* Mechanics below the box: how a frame is created, exposed once,
                  and later verified. */}
              <div className="hero-explainer">
                <p>Digital files have no unique place in space or time. BitGraph first creates a blank digital frame. Your file&rsquo;s exact bits are the light that exposes that frame. Your data itself never appears in it. Each frame can be exposed only once. The exposed frame becomes a portable record. Anyone with the file and its BitGraph can later verify, bit for bit, that those exact bits exposed that frame.</p>
              </div>
              {/* Two offers, stacked, in the order of commitment: the thing you
                  install to keep recording without coming back here, then the
                  thing you can just look at. The example spent a day on
                  /subjects and came back; a real BitGraph is worth more beside
                  the download than buried mid-page in an argument. */}
              <div className="see-example">
                <Link href="/docs/folder" className="see-example-link">
                  Download BitGraph Folder for macOS <span className="arrow" aria-hidden="true">&rarr;</span>
                </Link>
                <div className="see-example-second">
                  <SeeExample />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Scanning: read the files, then check the ledger. Both use the
            shared wait look; the bar appears only when there is a live count
            (always while reading, and for large ledger checks). ── */}
        {step === "scanning" && (scanPhase === "reading" ? (
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
            {proveProgress.total > 50 ? (
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

              {/* No drop box here: the results page is a terminal "here's what you
                  did" view, so it leads with the results themselves. To start a
                  new batch, the "BitGraph" logo in the nav returns to the drop
                  screen (it force-reloads home). Matches the proof page, which
                  also has no camera. */}

              {/* ── The folder's Roll: a dropped BitGraph folder loads HERE
                  instead of carrying its own generated sheet (Mike,
                  2026-08-05: "no index file at all... you drag and drop the
                  whole folder into the camera and it loads the Roll! and this
                  viewer can have small thumbs"). Roll grammar throughout: day
                  headers over causal order, rows with a small thumb made from
                  the dropped bytes themselves, the verdict in the two-outcome
                  colors — blue "matches the ledger", red naming the side that
                  differed. NO buttons: the drop triggered everything. ── */}
              {checked.length > 0 && <CheckedRoll checked={checked} onOpen={openCheckedRow} />}

              {/* The whole batch state lives in one receipt card (same anatomy
                  as the proof page's receipt): count + export in the body, and
                  when files remain unrecorded, a Record row in the arrow-link
                  style. No banners anywhere — the drop was the gesture. */}
              {/* Title sits above the card as a page heading, the same way the
                  proof page and the Roll title their content. Wrapped so the
                  column's 24px gap applies below the card, not under the title. */}
              {items.length > 0 && (<>
              <div>
              <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.02em", color: "#111827", marginBottom: 10 }}>
                BitGraph{items.length === 1 ? "" : "s"} Recorded
              </div>
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
                    // Names the CONTENTS, not the container, and is the exact
                    // plural of the proof page's "Export BitGraph + File". It
                    // was "Download .zip", which described the plumbing: a zip
                    // is what every export on the site already is, so saying so
                    // carried no information and made the two views, the same
                    // bundle from a batch and from one recording, speak
                    // differently. Both halves pluralize independently, because
                    // one file recorded at several causal positions really does
                    // export several BitGraphs of one file.
                    <button onClick={downloadZip} className="bg-action-link" style={{ padding: 0 }}>
                      <span>Export BitGraph{zipProofCount === 1 ? "" : "s"} + File{zipFileCount === 1 ? "" : "s"}</span>
                      <span className="arrow" aria-hidden>&rarr;</span>
                    </button>
                  ))}
                </div>
                {/* Files not yet on record get their action as a receipt row:
                    the same arrow-link voice as "See an example …" on the
                    drop screen. Writing to the ledger stays deliberate — a
                    line you read and choose, not a banner that shouts. */}
                {unproven.length > 0 && (
                  <div style={{ borderTop: "1px solid #eef0f1", padding: "0 16px" }}>
                    <button type="button" className="bg-action-link" onClick={proveRemaining}>
                      <span>Record {unproven.length} file{unproven.length === 1 ? "" : "s"}</span>
                      <span className="arrow" aria-hidden>&rarr;</span>
                    </button>
                  </div>
                )}
              </div>
              </div>

              {/* File list: one card per file separated by a gap so each file's
                  set of BitGraphs reads as a distinct block. Within a card,
                  recordings share hairline separators; the gap between cards is
                  the file boundary. 10px matches the explorer/Roll row gap, so
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
                  // Roll, so leaving this page loses nothing. Use the proof's digest
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
                    {rowProofs.length > 1 && (
                      <span style={{ flexShrink: 0, fontSize: 12.5, color: "#4b5563", whiteSpace: "nowrap" }}>
                        ({k + 1} of {rowProofs.length}{k === 0 ? " · original" : ""})
                      </span>
                    )}
                    {/* Right side matches the Roll's row anatomy: compact
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
      </div>
    </div>
  );
}

/* ── Cache an artifact's bytes (and any embedded C2PA manifest) to IndexedDB
   under the proof digest, so the proof page can render the image. The bytes are
   written first so the image appears immediately; C2PA parsing is best-effort
   (loads a ~6 MB WASM toolkit lazily) and never blocks caching the file. ── */
async function cacheArtifactToIDB(file: File, proofDigest: string) {
  const buf = await file.arrayBuffer();
  const writeRecord = async (c2pa: C2PAReadResult | null, c2paChecked: boolean) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("bitgraph-files", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("files");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const tx = db.transaction("files", "readwrite");
    tx.objectStore("files").put({ name: file.name, data: buf, c2pa, c2paChecked }, proofDigest);
    await new Promise((r, j) => { tx.oncomplete = r; tx.onerror = j; });
    db.close();
  };
  await writeRecord(null, false);
  let c2pa: C2PAReadResult | null = null;
  try {
    const { readC2PA } = await import("@/lib/c2pa-reader");
    c2pa = await readC2PA(file);
  } catch (e) {
    console.warn("[bitgraph] c2pa read failed:", e);
  }
  await writeRecord(c2pa, true);
}

/* ── The folder's Roll — the viewer a dropped BitGraph folder loads into.
   The Folder generates no browsing pages of its own (1.9.0); this is where a
   folder is browsed AND checked, in one surface the site renders. Day
   grouping and causal order are the sheet's exact keys, computed here from
   the exports' own proof.json and witness files; thumbnails are object URLs
   over the dropped bytes, never uploaded, revoked on unmount. ── */

const IMAGE_THUMB_EXT = ["jpg", "jpeg", "png", "gif", "webp", "avif", "bmp", "svg"];

function CheckedRoll({ checked, onOpen }: { checked: ExportCheckResult[]; onOpen: (r: ExportCheckResult) => void }) {
  // Causal order, newest first: lower-bound block, then counter; unsealed
  // (no block) lead. The same sort every surface in the product uses.
  const ordered = useMemo(() => [...checked].sort((x, y) => {
    const xb = x.block ?? 0, yb = y.block ?? 0;
    if (!xb !== !yb) return xb ? 1 : -1;
    if (xb !== yb) return yb - xb;
    return (parseInt(y.counter || "0", 10) || 0) - (parseInt(x.counter || "0", 10) || 0);
  }), [checked]);

  // Day groups along the causal walk: unsealed under today, ts-less sealed
  // rows inherit the open group. Local days, never UTC epochs.
  const groups = useMemo(() => {
    const out: Array<{ key: string; label: string; short: string; rows: ExportCheckResult[] }> = [];
    let openKey: string | null = null;
    for (const r of ordered) {
      const when = !r.block ? new Date() : r.ts ? new Date(r.ts * 1000) : null;
      if (when !== null) {
        const key = `${when.getFullYear()}-${when.getMonth()}-${when.getDate()}`;
        if (key !== openKey) {
          openKey = key;
          out.push({
            key,
            label: when.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }),
            short: when.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }),
            rows: [],
          });
        }
      }
      if (!out.length) {
        const now = new Date();
        out.push({
          key: `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`,
          label: now.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }),
          short: now.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }),
          rows: [],
        });
      }
      out[out.length - 1].rows.push(r);
    }
    return out;
  }, [ordered]);

  // The Roll's navigation, exactly (Mike: "i thought maybe you could just
  // use Roll exactly for this"): the default view is every recording newest
  // first, and past days are walked one at a time with dated steppers - not
  // scrolled past under inline headers. `day` is which slice is open; null
  // is the live view. Steppers move between RECORDED days (a folder is
  // sparse where the ledger is continuous - the same knowing deviation the
  // old sheet made).
  const [day, setDay] = useState<string | null>(null);
  // The shelf: the Roll's /rolls month-grid calendar, client-side. Not
  // important at two days, load-bearing at two hundred (Mike's call).
  const [shelf, setShelf] = useState(false);
  const dayIdx = day === null ? -1 : groups.findIndex((g) => g.key === day);
  const view = day === null ? null : groups[dayIdx] ?? null;
  const shownGroups = view ? [view] : groups;
  const older = day === null ? (groups.length > 1 ? groups[1] : null) : groups[dayIdx + 1] ?? null;
  const newer = day === null ? null : dayIdx > 0 ? groups[dayIdx - 1] : null;

  const stepLink: React.CSSProperties = { color: "#0065A4", fontWeight: 600, fontSize: 13.5, textDecoration: "none", background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" };

  // Real small thumbnails, generated from the dropped bytes: decode once,
  // draw at 96px (2x the 48px box), keep only the few-KB blob. An object URL
  // straight over the original was tried and was wrong twice over — a 26MB
  // photo per 48px cell, and the full-res decode never even started under
  // loading="lazy" here.
  //
  // Keyed by the FILE, not the row: verdicts stream in and replace the row
  // array many times per drop, and a [checked]-owned map restarted the whole
  // generation on every verdict (24 restarts for 24 exports — thumbs never
  // finished until the last one). The File objects are stable across
  // updates, so each thumb is made once, whichever rerun gets to it; URLs
  // are revoked only on unmount.
  const [thumbs, setThumbs] = useState<Map<File, string>>(() => new Map());
  const thumbMapRef = useRef<Map<File, string>>(new Map());
  useEffect(() => () => { for (const u of thumbMapRef.current.values()) URL.revokeObjectURL(u); }, []);
  useEffect(() => {
    let dead = false;
    void (async () => {
      for (const r of checked) {
        if (dead) return;
        const f = r.artifactFile;
        if (!f || thumbMapRef.current.has(f)) continue;
        const ext = f.name.slice(f.name.lastIndexOf(".") + 1).toLowerCase();
        if (!IMAGE_THUMB_EXT.includes(ext)) continue;
        try {
          const bmp = await createImageBitmap(f);
          const w = 96;
          const h = Math.max(1, Math.round((bmp.height / bmp.width) * w));
          const c = document.createElement("canvas");
          c.width = w; c.height = h;
          c.getContext("2d")?.drawImage(bmp, 0, 0, w, h);
          bmp.close();
          const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/jpeg", 0.75));
          if (!blob) continue;
          if (thumbMapRef.current.has(f)) continue; // a racing rerun got here first
          thumbMapRef.current.set(f, URL.createObjectURL(blob));
          setThumbs(new Map(thumbMapRef.current));
        } catch { /* a row without a thumb shows its type label */ }
      }
    })();
    return () => { dead = true; };
  }, [checked]);

  const okCount = checked.filter((c) => c.ok === true).length;
  const pending = checked.filter((c) => c.ok === null).length;

  return (
    <div>
      <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.02em", color: "#111827" }}>
        BitGraph Roll
      </div>
      <div style={{ fontSize: 13, color: "#4b5563", marginTop: 2, marginBottom: 10 }}>
        {view
          ? `The recordings for ${view.label}.`
          : `${checked.length} recording${checked.length === 1 ? "" : "s"} from your folder, newest first.`}
      </div>
      <div style={{ background: "#fff", border: "1px solid #d0d5dd", padding: "18px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 10 }}>
        {pending > 0 ? (
          <span style={{ fontSize: 15, fontWeight: 700, color: "#111827", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
            Checking {checked.length - pending} of {checked.length}&hellip;
          </span>
        ) : (
          <span style={{ fontSize: 15, fontWeight: 700, color: "#111827", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
            {okCount} of {checked.length} {okCount === 1 ? "matches" : "match"} the ledger
          </span>
        )}
        {okCount + pending < checked.length && (
          <span style={{ fontSize: 13, fontWeight: 600, color: "#dc2626", whiteSpace: "nowrap" }}>
            {checked.length - okCount - pending} {checked.length - okCount - pending === 1 ? "does" : "do"} not
          </span>
        )}
      </div>
      {groups.length > 1 && !shelf && (
        <nav style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, margin: "14px 0 4px" }}>
          <span style={{ display: "flex", gap: 20 }}>
            {older && (
              <button type="button" style={stepLink} onClick={() => setDay(older.key)}>
                <span aria-hidden>&larr;</span> {older.short}
              </button>
            )}
            {newer && (
              <button type="button" style={stepLink} onClick={() => setDay(newer.key)}>
                {newer.short} <span aria-hidden>&rarr;</span>
              </button>
            )}
          </span>
          <span style={{ display: "flex", gap: 20, marginLeft: "auto" }}>
            {view && (
              <button type="button" style={stepLink} onClick={() => setDay(null)}>
                All recordings <span aria-hidden>&rarr;</span>
              </button>
            )}
            <button type="button" style={stepLink} onClick={() => setShelf(true)}>
              All rolls <span aria-hidden>&rarr;</span>
            </button>
          </span>
        </nav>
      )}
      {shelf && (
        <CheckedShelf
          groups={groups}
          onPick={(key) => { setDay(key); setShelf(false); }}
          onLive={() => { setDay(null); setShelf(false); }}
        />
      )}
      {!shelf && shownGroups.map((g) => (
        <div key={g.key} style={{ marginTop: 10 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {g.rows.map((r, i) => {
              const clickable = r.onLedger && !!r.digestUrlSafe;
              const thumb = r.artifactFile ? thumbs.get(r.artifactFile) : undefined;
              const ext = r.fileName ? r.fileName.slice(r.fileName.lastIndexOf(".") + 1).toUpperCase() : "";
              return (
                <div key={r.dirName + i} className="bitgraph-file-card" data-clickable={clickable} style={{ border: "1px solid #d0d5dd", animation: `slideIn 0.2s ease-out ${Math.min(i, 12) * 0.03}s both` }}>
                  <div
                    role={clickable ? "button" : undefined}
                    tabIndex={clickable ? 0 : undefined}
                    onClick={clickable ? () => onOpen(r) : undefined}
                    onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(r); } } : undefined}
                    className={`bitgraph-result-row${clickable ? " bitgraph-file-row" : ""}`}
                    style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px 10px 10px", cursor: clickable ? "pointer" : "default" }}
                  >
                    {/* The small thumb, from the dropped bytes themselves. A
                        non-image shows its type the way the sheet's cells
                        did; square corners, the card's own border. */}
                    {thumb ? (
                      <img src={thumb} alt="" style={{ width: 48, height: 48, objectFit: "cover", flexShrink: 0, border: "1px solid #e2e5e9", display: "block" }} />
                    ) : (
                      <span style={{ width: 48, height: 48, flexShrink: 0, border: "1px solid #e2e5e9", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#6b7280", fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                        {ext.slice(0, 4)}
                      </span>
                    )}
                    <span style={{ flexShrink: 0, fontSize: 14, fontWeight: 700, color: r.ok === false ? "#dc2626" : "#0065A4", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                      {r.counter != null ? `#${Number(r.counter).toLocaleString()}` : "—"}
                    </span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 14, color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.fileName ?? r.dirName}
                    </span>
                    <span style={{ flexShrink: 0, fontSize: 12.5, color: "#4b5563", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }} className="bg-roll-when">
                      {fmtRowWhen(r.ts ? r.ts * 1000 : r.writeTime)}
                    </span>
                    <span style={{ flexShrink: 0, maxWidth: "40%", fontSize: 12.5, fontWeight: 600, color: r.ok === true ? "#0065A4" : r.ok === false ? "#dc2626" : "#9ca3af", textAlign: "right" }}>
                      {r.ok === true ? "matches the ledger" : r.ok === false ? r.failure : "checking\u2026"}
                    </span>
                    {clickable && (
                      <span aria-label="Open" style={{ display: "inline-flex", flexShrink: 0, color: "#0065A4" }}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="square" strokeLinejoin="miter"><path d="M9 6 L15 12 L9 18" /></svg>
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── The shelf — /rolls, translated to a dropped folder. One cell per day,
   months newest first from now back to the oldest recording; a day is a link
   when the folder recorded on it, today is the outlined open frame leading
   back to the live view, and everything else sits grey. Zero data beyond the
   links, same as the site's. ── */
function CheckedShelf({ groups, onPick, onLive }: {
  groups: Array<{ key: string; label: string; short: string; rows: ExportCheckResult[] }>;
  onPick: (key: string) => void;
  onLive: () => void;
}) {
  const now = new Date();
  const todayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  const recorded = new Map(groups.map((g) => [g.key, g]));
  const oldest = groups.length
    ? groups[groups.length - 1].key.split("-").map((x) => parseInt(x, 10))
    : [now.getFullYear(), now.getMonth()];
  const months: Array<{ label: string; y: number; m: number }> = [];
  for (let y = now.getFullYear(), m = now.getMonth();
       y > oldest[0] || (y === oldest[0] && m >= oldest[1]);
       m === 0 ? (y--, m = 11) : m--) {
    months.push({ label: new Date(y, m, 1).toLocaleDateString(undefined, { year: "numeric", month: "long" }), y, m });
  }
  const cell: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "center", aspectRatio: "1", fontSize: 13 };
  const mono = "ui-monospace, SFMono-Regular, Menlo, monospace";
  return (
    <div>
      {months.map(({ label, y, m }) => {
        const daysIn = new Date(y, m + 1, 0).getDate();
        const lead = new Date(y, m, 1).getDay();
        return (
          <section key={label} style={{ marginTop: 24, maxWidth: 340 }}>
            <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-0.01em", color: "#111827", marginBottom: 8 }}>{label}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", fontFamily: mono, fontVariantNumeric: "tabular-nums" }}>
              {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                <div key={`h${i}`} style={{ ...cell, fontSize: 10.5, color: "#9ca3af", aspectRatio: "auto", paddingBottom: 4 }}>{d}</div>
              ))}
              {Array.from({ length: lead }, (_, i) => <div key={`b${i}`} style={cell} />)}
              {Array.from({ length: daysIn }, (_, i) => {
                const d = i + 1;
                const key = `${y}-${m}-${d}`;
                if (key === todayKey) {
                  return (
                    <button key={key} type="button" onClick={onLive} aria-label="Today"
                      style={{ ...cell, color: "#0065A4", fontWeight: 600, background: "none", border: "none", cursor: "pointer", fontFamily: mono, boxShadow: "inset 0 0 0 1px #0065A4" }}>
                      {d}
                    </button>
                  );
                }
                if (recorded.has(key)) {
                  return (
                    <button key={key} type="button" onClick={() => onPick(key)}
                      className="bitgraph-shelf-day"
                      style={{ ...cell, color: "#0065A4", fontWeight: 600, background: "none", border: "none", cursor: "pointer", fontFamily: mono }}>
                      {d}
                    </button>
                  );
                }
                return <div key={key} style={{ ...cell, color: "#c7ccd1" }}>{d}</div>;
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

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
  async function check(source: DataTransfer | File[]) {
    setState("checking");
    setProgress({ done: 0, total: 0 });
    try {
      const { match, checked } = Array.isArray(source)
        ? await findMatchInFiles(source, proof.artifact.digestB64, (done, total) => setProgress({ done, total }))
        : await findMatchInDrop(source, proof.artifact.digestB64, (done, total) => setProgress({ done, total }));
      setCheckedCount(checked);
      if (!match) { setState("mismatch"); return; }
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
      onDrop={(e) => { e.preventDefault(); setDragOver(false); void check(e.dataTransfer); }}
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

/* trigger */
