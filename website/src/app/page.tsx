"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { FileDrop } from "@/components/file-drop";
import { Explorer } from "@/components/explorer";
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
import { takePendingDrop } from "@/lib/pending-drop";
import { Zip, ZipPassThrough } from "fflate";
import type { C2PAReadResult } from "@/lib/c2pa-reader";

type Step = "drop" | "scanning" | "results" | "proving" | "exporting";

interface FileItem {
  file: File;
  digestB64: string;
  proof: BitGraphProof | null;
  // Every proof recorded for these bytes, earliest causal position first.
  // The same bits can be BitGraphed more than once; `proof` is the earliest
  // (originating) one and drives the row's open/verify behavior.
  proofs: BitGraphProof[];
  valid: boolean | null;
  status: "found" | "new" | "proving" | "proved" | "error";
  // True when this item came from a dropped proof.json rather than an artifact.
  // The `file` in hand is then the JSON, not the thing the proof is about, so we
  // offer an inline check to confirm the visitor holds the matching artifact.
  fromProofJson?: boolean;
  matchedFile?: File | null;
}


export default function BitGraphPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("drop");
  const [items, setItems] = useState<FileItem[]>([]);
  const [scanProgress, setScanProgress] = useState({ current: 0, total: 0 });
  // The scan is two honest phases: hashing files locally ("reading"), then
  // one batch round trip to the ledger ("checking"). The label tracks them;
  // "N of N checked" sitting under a full bar while the lookup ran was a lie.
  const [scanPhase, setScanPhase] = useState<"reading" | "checking">("reading");
  const [proveProgress, setProveProgress] = useState({ current: 0, total: 0 });
  const [proveAnimCount, setProveAnimCount] = useState(0);
  const proveAnimRef = useRef(0);
  const [, setExportProgress] = useState({ current: 0, total: 0 });
  const [animCount, setAnimCount] = useState(0);
  const [anchorCountdown, setAnchorCountdown] = useState(0);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
  const allDone = items.length > 0 && items.every(i => i.status === "found" || i.status === "proved");
  // Exactly what the .zip bundles (each file + its proof.json + the ETH anchors).
  const zipCount = items.filter(i => i.proof).length;

  /* ── Drop → Scan ── */

  async function handleFiles(files: File[]) {
    setStep("scanning");
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

    // Phase 2 — ONE round trip for every ledger lookup (the old one-request-
    // per-file loop was the whole wait). Falls back to the per-digest
    // endpoint, parallelized, if the batch endpoint is unavailable.
    const lookupKeys = [...new Set(
      scanned.filter((s) => !s.proofJson && s.digest).map((s) => toUrlSafeB64(s.digest)),
    )];
    const lookup: Record<string, { proofs?: Array<{ proof: BitGraphProof }> }> = {};
    setScanPhase("checking");
    if (lookupKeys.length) {
      try {
        const r = await fetch("/api/proofs/batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ digests: lookupKeys }),
        });
        if (!r.ok) throw new Error();
        Object.assign(lookup, (await r.json()).results || {});
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
      const all = (digest && lookup[toUrlSafeB64(digest)]?.proofs || []).map((x) => x.proof);
      if (all.length > 0) {
        const result = await verifyProofSignature(all[0]);
        return { file: f, digestB64: digest, proof: all[0], proofs: all, valid: result.valid, status: "found" as const };
      }
      return { file: f, digestB64: digest, proof: null, proofs: [], valid: null, status: "new" as const };
    }));

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
          const p = await commitDigest(solo.digestB64);
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

    // Animate the count
    const total = results.filter(r => r.status === "found").length;
    if (total > 0) {
      let c = 0;
      const interval = setInterval(() => {
        c++;
        setAnimCount(c);
        if (c >= total) clearInterval(interval);
      }, Math.min(150, 600 / total));
    }
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
      })));
      const valid = entries.filter((e) => e.counter > 0);
      if (valid.length) window.dispatchEvent(new CustomEvent("bitgraph:recorded", { detail: valid }));
    } catch { /* display-only, never block the prove flow */ }
  }

  async function proveRemaining() {
    const toProve = items.filter(i => i.status === "new");
    if (!toProve.length) return;

    setStep("proving");
    setProveProgress({ current: 0, total: toProve.length });
    setItems(prev => prev.map(i => i.status === "new" ? { ...i, status: "proving" as const } : i));

    try {
      if (toProve.length === 1) {
        const p = await commitDigest(toProve[0].digestB64);
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
          const proofs = await commitBatch(digests);
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

    const newTotal = items.filter(i => i.status === "found").length + toProve.length;
    let c = items.filter(i => i.status === "found").length;
    const interval = setInterval(() => {
      c++;
      setAnimCount(c);
      if (c >= newTotal) clearInterval(interval);
    }, Math.min(150, 600 / toProve.length));
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
        if (resp.ok) addText(name, JSON.stringify(await resp.json(), null, 2));
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
    a.download = withProofs.length === 1 ? `${withProofs[0].file.name.replace(/\.[^.]+$/, "")}-bitgraph.zip` : "bitgraph-proof-batch.zip";
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
  const card: React.CSSProperties = { border: "1px solid #d0d5dd", padding: "24px 20px", background: "#fff", borderRadius: 0, marginBottom: 16 };
  const btnFill: React.CSSProperties = { height: 76, fontSize: 16, fontWeight: 600, border: "none", borderRadius: 0, background: "#0065A4", color: "#ffffff", cursor: "pointer", letterSpacing: "-0.01em" };
  const btnOut: React.CSSProperties = { height: 76, fontSize: 16, fontWeight: 500, borderRadius: 0, cursor: "pointer", border: "1px solid #0065A4", background: "#f4f6f9", color: "#0065A4" };

  return (
    <div style={{ background: "var(--bg)", color: "var(--c-text)", display: "flex", flexDirection: "column" }}>
      <style>{`
        .bitgraph-wrap { width: 90%; max-width: 800px; margin: 0 auto; padding: 32px 0 0; display: flex; flex-direction: column; align-items: stretch; justify-content: flex-start; gap: 24px; min-height: calc(100dvh - 57px); }
        .bitgraph-wrap.bitgraph-results { justify-content: flex-start; padding-top: 32px; padding-bottom: 48px; min-height: 0; }
        .bitgraph-actions { display: flex; flex-direction: column; gap: 12px; }
        /* Waiting states (read/check/prove/export) center on the page like
           everything else, instead of hugging the top under fixed padding. */
        .bitgraph-wait { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; min-height: calc(100dvh - 260px); padding: 24px; animation: slideIn 0.3s ease-out; }
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

        {/* ── Drop zone + What is BitGraph button ── */}
        {step === "drop" && (
          <>
            <div className="bitgraph-camera" style={{ animation: "slideIn 0.3s ease-out" }}>
              <FileDrop
                multiple
                onFile={(f) => handleFiles([f])}
                onFiles={handleFiles}
                hint="Files already BitGraphed are looked up"
              />
            </div>
            {/* The roll, right under the camera. Explorer renders the heading
                row so the anchors toggle can sit beside the title. A touch
                more air than the wrap's 24px gap so the sections breathe. */}
            <div style={{ marginTop: 14 }}>
              <Explorer title={
                <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.01em", color: "#111827" }}>
                  BitGraph Roll
                </div>
              } />
            </div>
          </>
        )}

        {/* ── Scanning — reading gets a real progress bar (per-file work),
            checking is one indeterminate round trip, so it gets the same
            spinner the zip export uses. ── */}
        {step === "scanning" && (scanPhase === "reading" ? (
          <div className="bitgraph-wait" style={{ textAlign: "center" }}>
            <div style={{
              fontSize: "min(22px, 4.5vw)",
              fontWeight: 800,
              letterSpacing: "-0.02em",
              color: "#111827",
              whiteSpace: "nowrap",
              lineHeight: 1.2,
              animation: "pulse 1s ease-in-out infinite",
            }}>
              {scanProgress.current} of {scanProgress.total} read
            </div>
            <div style={{ width: "40%", height: 2, borderRadius: 1, background: "var(--c-border-subtle)", overflow: "hidden" }}>
              <div style={{ width: `${(scanProgress.current / scanProgress.total) * 100}%`, height: "100%", background: "#0065A4", transition: "width 0.2s", boxShadow: "none" }} />
            </div>
          </div>
        ) : (
          <div className="bitgraph-wait">
            <div role="status" aria-label="Checking for BitGraphs" style={{ width: 36, height: 36, border: "3px solid #e2e5e9", borderTopColor: "#0065A4", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
            <div style={{ fontSize: 14, color: "#6b7280" }}>Checking for BitGraphs…</div>
          </div>
        ))}

        {/* ── Proving — spinner always; a single chunk (up to 50 files) is one
            round trip with nothing honest to count, so it stays plain. Multi-
            chunk drops tick every ~1.5s, so they get a live count + percent +
            bar under the spinner: a 500-file batch must never read as stuck. ── */}
        {step === "proving" && (
          <div className="bitgraph-wait">
            <div role="status" aria-label="BitGraphing" style={{ width: 36, height: 36, border: "3px solid #e2e5e9", borderTopColor: "#0065A4", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
            <div style={{ fontSize: 14, color: "#6b7280" }}>
              BitGraphing {proveProgress.total} file{proveProgress.total === 1 ? "" : "s"}…
            </div>
            {proveProgress.total > 50 && (
              <>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#111827", fontVariantNumeric: "tabular-nums" }}>
                  {proveAnimCount} of {proveProgress.total} BitGraphed · {proveProgress.total > 0 ? Math.round((proveAnimCount / proveProgress.total) * 100) : 0}%
                </div>
                <div style={{ width: "40%", height: 2, borderRadius: 1, background: "var(--c-border-subtle)", overflow: "hidden" }}>
                  <div style={{ width: `${proveProgress.total > 0 ? (proveAnimCount / proveProgress.total) * 100 : 0}%`, height: "100%", background: "#0065A4", transition: "width 0.15s", boxShadow: "none" }} />
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Exporting ── */}
        {step === "exporting" && (
          <div className="bitgraph-wait">
            {/* Packaging the .zip is quick and the step count (files + anchors +
                zip) doesn't map to the file count, so show a plain spinner. */}
            <div role="status" aria-label="Packaging" style={{ width: 36, height: 36, border: "3px solid #e2e5e9", borderTopColor: "#0065A4", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
            <div style={{ fontSize: 14, color: "#6b7280" }}>Packaging…</div>
          </div>
        )}

        {/* ── Results ── */}
        {step === "results" && items.length > 0 && (
          <div style={{ animation: "slideIn 0.3s ease-out", display: "flex", flexDirection: "column", gap: 24 }}>

              {/* Choose new files — the same drop box as the home page, so you can
                  drag, paste, or click to start a fresh set. Dropping here re-runs
                  the scan and replaces the list. Sits on top. */}
              <div className="bitgraph-camera" style={{ animation: "slideIn 0.3s ease-out" }}>
                <FileDrop
                  multiple
                  onFile={(f) => handleFiles([f])}
                  onFiles={handleFiles}
                  hint=""
                />
              </div>

              {/* Actions — the BitGraph-remaining CTA (while files are unproven),
                  then Download. The count is the header of the list card below. */}
              <div className="bitgraph-actions">
                {unproven.length > 0 && (
                  <button onClick={proveRemaining} style={{ ...btnFill, background: "var(--c-accent)", color: "#ffffff" }}>
                    BitGraph {unproven.length} remaining
                  </button>
                )}
                {found.length > 0 && (
                  <button
                    onClick={anchorCountdown > 0 ? undefined : downloadZip}
                    className={anchorCountdown > 0 || !allDone ? "bg-btn-outline" : undefined}
                    style={{
                      ...(anchorCountdown > 0 ? { ...btnOut, opacity: 0.5, cursor: "default" } : allDone ? btnFill : btnOut),
                    }}
                  >
                    {anchorCountdown > 0 ? <span style={{ fontSize: 14 }}>{`BitGraphing the next Ethereum block hash... ${anchorCountdown}s`}</span> : zipCount > 1 ? `Download all ${zipCount} (.zip)` : "Download .zip"}
                  </button>
                )}
              </div>

              {/* File list: a count banner, then one card per file separated by
                  a gap so each file's set of BitGraphs reads as a distinct
                  block. Within a card, recordings share hairline separators;
                  the gap between cards is the file boundary. */}
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {/* 16px horizontal padding matches the file cards below, so the
                  banner text and card headers share one left edge. */}
              <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: "0.04em", color: "#0065A4", padding: "18px 16px", background: "rgba(0,101,164,0.04)", border: "1px solid #d0d5dd", display: "flex", alignItems: "center", gap: 8 }}>
                {allDone && (
                  <span key={`badge-${items.length}`} aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 17, height: 17, borderRadius: 999, background: "#0065A4", flexShrink: 0, animation: "countPop 0.4s ease-out both" }}>
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" style={{ strokeDasharray: 26, animation: "checkDraw 0.35s ease-out 0.18s both" }} /></svg>
                  </span>
                )}
                <span key={`${allDone}-${items.length}`} style={{ animation: "headerReveal 0.4s ease-out both" }}>
                  {animCount} of {items.length} {allDone ? "BitGraphed" : "found"}
                </span>
              </div>
              {items.map((item, i) => {
                // One row per BitGraph. Chronological, ORIGINAL first: a
                // file's card reads as its provenance story (first existed at
                // #N, recorded again at #M), so the earliest causal position
                // leads and carries the "original" mark. A file with no proof
                // yet renders one pending row.
                const rowProofs: Array<BitGraphProof | null> =
                  item.proofs.length ? item.proofs : item.proof ? [item.proof] : [null];
                const openProof = (p: BitGraphProof) => {
                  // Same-tab navigation (the camera strip on the proof page keeps the
                  // flow going). Use the proof's digest (from TEE) for the URL, not the
                  // browser-computed hash; ?counter=&epoch= pins THIS row's causal
                  // position.
                  const proofDigest = p.artifact.digestB64;
                  const c = p.commit?.counter;
                  const epoch = p.commit?.epochId ? toUrlSafeB64(p.commit.epochId) : "";
                  const sel = c ? `?counter=${encodeURIComponent(c)}${epoch ? `&epoch=${encodeURIComponent(epoch)}` : ""}` : "";
                  // Cache the artifact bytes (and any embedded C2PA manifest) in the
                  // background; the client-side push keeps this JS context alive and
                  // the proof page polls IndexedDB, so navigation never waits on the
                  // ~6 MB C2PA toolkit. For a dropped proof.json the file in hand is
                  // the JSON, not the artifact, so only cache a real file: a regular
                  // dropped artifact, or one the visitor matched via the inline check
                  // below.
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
                // Every recording is the same explorer-style row: counter left,
                // outcome tag, filename right, Open. A file with SEVERAL
                // recordings just stacks more of them in the one card, sharing
                // its border and outcome rail; the filename and tag appear on
                // the first row only, so continuation rows read as "same file,
                // another position". (A filename-header + indented-rows tier
                // was tried and looked like a different species of card.)
                const proofCount = item.proofs.length || (item.proof ? 1 : 0);
                // One gesture, two outcomes, told by color: a file that was
                // already in the ledger is a CHECK (trust green, "on record");
                // one recorded just now is a RECORD (brand blue, "recorded").
                const outcome =
                  item.status === "found" ? { color: "#10b981", word: "on record" }
                  : item.status === "proved" ? { color: "#0065A4", word: "recorded" }
                  : null;
                return (
                  <div key={item.file.name + i} className="bitgraph-file-card" data-clickable={proofCount > 0} style={{ border: "1px solid #d0d5dd", borderLeft: outcome ? `3px solid ${outcome.color}` : undefined, animation: `slideIn 0.2s ease-out ${i * 0.04}s both` }}>
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
                    <span style={{ flexShrink: 0, fontSize: 14, fontWeight: 400, color: counter != null ? "#374151" : item.status === "error" ? "#dc2626" : "#6b7280" }}>
                      {counter != null
                        ? <span style={{ fontWeight: 700, color: "#0065A4", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>#{Number(counter).toLocaleString()}</span>
                        : pendingLabel}
                    </span>
                    {/* Every recording row carries the outcome word; when the
                        same bytes hold several positions, a grey count places
                        the row in the sequence and the earliest is marked as
                        the original recording. Filename stays on the first
                        row only. */}
                    {outcome && (
                      <span style={{ flexShrink: 0, fontSize: 12, whiteSpace: "nowrap" }}>
                        <span style={{ fontWeight: 700, color: outcome.color }}>{outcome.word}</span>
                        {rowProofs.length > 1 && (
                          <span style={{ fontWeight: 400, color: "#6b7280" }}>
                            {` · ${k + 1} of ${rowProofs.length}${k === 0 ? " · original" : ""}`}
                          </span>
                        )}
                      </span>
                    )}
                    {k === 0 ? (
                      <span className="bg-row-name" style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 500, color: "#111827", textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {item.file.name}
                      </span>
                    ) : (
                      <span style={{ flex: 1 }} />
                    )}
                    {clickable && (
                      <span className="bitgraph-open-pill">
                        Open
                        <span aria-hidden="true" style={{ fontSize: 17, lineHeight: 1, fontWeight: 600 }}>›</span>
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

/* ── Inline file-match check — shown under a dropped proof.json so the visitor
   can confirm they hold the matching artifact. Hashed in the browser and
   compared to the proof's digest; nothing is uploaded. Mirrors the proof page's
   BringYourFile, scaled down to sit inside a results row. ── */
function FileMatchCheck({ proof, onMatched }: { proof: BitGraphProof; onMatched: (file: File) => void }) {
  const [state, setState] = useState<"idle" | "checking" | "mismatch">("idle");
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function check(file: File | undefined | null) {
    if (!file) return;
    setState("checking");
    try {
      const digest = await hashFile(file);
      if (digest !== proof.artifact.digestB64) { setState("mismatch"); return; }
      onMatched(file);
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
      onDrop={(e) => { e.preventDefault(); setDragOver(false); check(e.dataTransfer.files?.[0]); }}
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
      <input ref={inputRef} type="file" style={{ display: "none" }} onClick={(e) => e.stopPropagation()} onChange={(e) => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ""; check(f); }} />
      {state === "checking" ? (
        <div style={{ fontSize: 14, fontWeight: 600, color: "#6b7280" }}>Checking…</div>
      ) : mismatch ? (
        <>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#dc2626" }}>These bytes don&rsquo;t match this proof</div>
          <div style={{ fontSize: 12.5, color: "#6b7280", marginTop: 5 }}>A single changed bit produces a completely different hash. Drop the exact original to check again.</div>
        </>
      ) : (
        <>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>Have the file? Check it matches this proof.</div>
          <div style={{ fontSize: 12.5, color: "#6b7280", marginTop: 5 }}>Drop it here or click to choose. Hashed in your browser, nothing is uploaded.</div>
        </>
      )}
    </div>
  );
}

/* trigger */
