"use client";

import { useState, useEffect, useRef } from "react";
import { FileDrop } from "@/components/file-drop";
import { Explorer } from "@/components/explorer";
// Footer is in root layout
import {
  hashFile,
  commitDigest,
  commitBatch,
  isBitGraphProof,
  verifyProofSignature,
  type BitGraphProof,
} from "@/lib/bitgraph";
import { toUrlSafeB64 } from "@/lib/explorer";
import { Zip, ZipPassThrough } from "fflate";
import type { C2PAReadResult } from "@/lib/c2pa-reader";

type Step = "drop" | "scanning" | "results" | "proving" | "exporting";

interface FileItem {
  file: File;
  digestB64: string;
  proof: BitGraphProof | null;
  valid: boolean | null;
  status: "found" | "new" | "proving" | "proved" | "error";
  // True when this item came from a dropped proof.json rather than an artifact.
  // The `file` in hand is then the JSON, not the thing the proof is about, so we
  // offer an inline check to confirm the visitor holds the matching artifact.
  fromProofJson?: boolean;
  matchedFile?: File | null;
}


export default function BitGraphPage() {
  const [step, setStep] = useState<Step>("drop");
  const [items, setItems] = useState<FileItem[]>([]);
  const [scanProgress, setScanProgress] = useState({ current: 0, total: 0 });
  const [proveProgress, setProveProgress] = useState({ current: 0, total: 0 });
  const [proveAnimCount, setProveAnimCount] = useState(0);
  const proveAnimRef = useRef(0);
  const [exportProgress, setExportProgress] = useState({ current: 0, total: 0 });
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
    setScanProgress({ current: 0, total: files.length });
    const results: FileItem[] = [];

    for (let i = 0; i < files.length; i++) {
      setScanProgress({ current: i + 1, total: files.length });
      const f = files[i];
      try {
        // Only read as text if the file could plausibly be a proof JSON.
        // Reading a multi-MB photo as text allocates a UTF-16 copy of its bytes
        // and crashes iOS Safari after ~15 files.
        const couldBeProof =
          f.size <= 1_000_000 &&
          (f.type === "application/json" || /\.(json|proof)$/i.test(f.name));
        const proofJson = couldBeProof ? isBitGraphProof(await f.text()) : null;
        if (proofJson) {
          const result = await verifyProofSignature(proofJson);
          results.push({ file: f, digestB64: proofJson.artifact.digestB64, proof: proofJson, valid: result.valid, status: "found", fromProofJson: true });
          continue;
        }

        // Regular file: hash and look up
        const d = await hashFile(f);
        const resp = await fetch(`/api/proofs/${encodeURIComponent(toUrlSafeB64(d))}`);
        if (resp.ok) {
          const data = await resp.json();
          if (data.proofs?.length > 0) {
            const p = data.proofs[0].proof as BitGraphProof;
            const result = await verifyProofSignature(p);
            results.push({ file: f, digestB64: d, proof: p, valid: result.valid, status: "found" });
          } else {
            results.push({ file: f, digestB64: d, proof: null, valid: null, status: "new" });
          }
        } else {
          results.push({ file: f, digestB64: d, proof: null, valid: null, status: "new" });
        }
      } catch {
        const d = await hashFile(f).catch(() => "");
        results.push({ file: f, digestB64: d, proof: null, valid: null, status: "new" });
      }

      // Yield so iOS Safari can reclaim the previous file's buffer before the next iteration.
      if (i < files.length - 1) await new Promise((r) => setTimeout(r, 0));
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
          i.digestB64 === toProve[0].digestB64 ? { ...i, proof: p, valid: true, status: "proved" as const } : i
        ));
        setProveProgress({ current: 1, total: 1 });
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
            return p ? { ...i, proof: p, valid: true, status: "proved" as const } : i;
          }));
          setProveProgress({ current: Math.min(offset + CHUNK_SIZE, toProve.length), total: toProve.length });
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

    // Add files one at a time, updating progress between each
    for (let i = 0; i < withProofs.length; i++) {
      setExportProgress({ current: i + 1, total: totalSteps });
      await tick();
      const { file: f, proof: p } = withProofs[i];
      const base = f.name.replace(/\.[^.]+$/, "");
      const prefix = multi ? `${base}/` : "";

      // File entry
      const fileBytes = new Uint8Array(await f.arrayBuffer());
      const fileEntry = new ZipPassThrough(`${prefix}${f.name}`);
      z.add(fileEntry);
      fileEntry.push(fileBytes, true);

      // Proof entry
      const proofBytes = new TextEncoder().encode(JSON.stringify(p, null, 2));
      const proofEntry = new ZipPassThrough(`${prefix}proof.json`);
      z.add(proofEntry);
      proofEntry.push(proofBytes, true);
    }

    // Bracket the whole batch with BOTH bounding ETH anchors. The "after"
    // anchor follows the highest counter (upper time bound); the "before"
    // anchor precedes the lowest counter (lower time bound). Together they pin
    // every proof in the batch to a public Ethereum time window. Both are
    // required to read the window: the after-anchor alone is only "existed by
    // now," the same one-sided bound a plain blockchain timestamp gives.
    setExportProgress({ current: withProofs.length + 1, total: totalSteps });
    await tick();
    try {
      const last = withProofs.reduce((a, b) =>
        parseInt(b.proof?.commit?.counter || "0", 10) > parseInt(a.proof?.commit?.counter || "0", 10) ? b : a);
      const first = withProofs.reduce((a, b) =>
        parseInt(b.proof?.commit?.counter || "0", 10) < parseInt(a.proof?.commit?.counter || "0", 10) ? b : a);
      const lastCounter = last.proof?.commit?.counter || "0";
      const firstCounter = first.proof?.commit?.counter || "0";
      const epoch = last.proof?.commit?.epochId || "";
      if (!epoch) throw new Error("no epochId");
      const enc = encodeURIComponent(epoch);
      const [afterResp, beforeResp] = await Promise.all([
        fetch(`/api/proofs/anchors?counter=${lastCounter}&epoch=${enc}`),
        fetch(`/api/proofs/anchors?counter=${firstCounter}&epoch=${enc}&before=1`),
      ]);
      if (afterResp.ok) {
        const data = await afterResp.json();
        if (data.anchors?.length > 0) {
          const e = new ZipPassThrough("ethereum-anchor-after.json");
          z.add(e);
          e.push(new TextEncoder().encode(JSON.stringify(data.anchors[0], null, 2)), true);
        }
      }
      if (beforeResp.ok) {
        const data = await beforeResp.json();
        if (data.anchors?.length > 0) {
          const e = new ZipPassThrough("ethereum-anchor-before.json");
          z.add(e);
          e.push(new TextEncoder().encode(JSON.stringify(data.anchors[0], null, 2)), true);
        }
      }
    } catch { /* non-critical */ }
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
        .bitgraph-wrap .file-drop-container { height: 450px; }
        @media (max-width: 640px) { .bitgraph-wrap .file-drop-container { height: 280px; } }
        .bitgraph-actions { display: flex; flex-direction: column; gap: 12px; }
        @keyframes countPop { 0% { transform: scale(0.5); opacity: 0 } 50% { transform: scale(1.15) } 100% { transform: scale(1); opacity: 1 } }
        @keyframes slideIn { from { opacity: 0; transform: translateY(12px) } to { opacity: 1; transform: translateY(0) } }
        @keyframes popIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.4 } }
        @keyframes glow { 0%, 100% { box-shadow: none } 50% { box-shadow: none } }
      `}</style>
      {/* Nav is in root layout */}

      <div className={`bitgraph-wrap${step !== "drop" ? " bitgraph-results" : ""}`}>

        {/* ── Drop zone + What is BitGraph button ── */}
        {step === "drop" && (
          <>
            <div className="file-drop-container" style={{ animation: "slideIn 0.3s ease-out" }}>
              <FileDrop
                multiple
                onFile={(f) => handleFiles([f])}
                onFiles={handleFiles}
                hint=""
              />
            </div>
            <Explorer />
          </>
        )}

        {/* ── Scanning ── */}
        {step === "scanning" && (
          <div style={{ textAlign: "center", padding: "80px 24px", animation: "slideIn 0.3s ease-out" }}>
            <div style={{
              fontSize: "min(30px, 5vw)",
              fontWeight: 800,
              letterSpacing: "-0.02em",
              color: "#111827",
              whiteSpace: "nowrap",
              lineHeight: 1.2,
              animation: "pulse 1s ease-in-out infinite",
            }}>
              {scanProgress.current} of {scanProgress.total} checked
            </div>
            <div style={{ width: "40%", height: 2, borderRadius: 1, background: "var(--c-border-subtle)", overflow: "hidden", margin: "20px auto 0" }}>
              <div style={{ width: `${(scanProgress.current / scanProgress.total) * 100}%`, height: "100%", background: "#0065A4", transition: "width 0.2s", boxShadow: "none" }} />
            </div>
          </div>
        )}

        {/* ── Proving ── */}
        {step === "proving" && (
          <div style={{ textAlign: "center", padding: "80px 24px", animation: "slideIn 0.3s ease-out" }}>
            <div style={{
              fontSize: "min(30px, 5vw)",
              fontWeight: 800,
              letterSpacing: "-0.02em",
              color: "#111827",
              whiteSpace: "nowrap",
              lineHeight: 1.2,
              animation: "pulse 1s ease-in-out infinite",
            }}>
              {proveAnimCount} of {proveProgress.total} BitGraphed
            </div>
            <div style={{ width: "40%", height: 2, borderRadius: 1, background: "var(--c-border-subtle)", overflow: "hidden", margin: "20px auto 0" }}>
              <div style={{ width: `${proveProgress.total > 0 ? (proveAnimCount / proveProgress.total) * 100 : 0}%`, height: "100%", background: "#0065A4", transition: "width 0.15s", boxShadow: "none" }} />
            </div>
          </div>
        )}

        {/* ── Exporting ── */}
        {step === "exporting" && (
          <div style={{ textAlign: "center", padding: "80px 24px", animation: "slideIn 0.3s ease-out" }}>
            <div style={{
              fontSize: "min(30px, 5vw)",
              fontWeight: 800,
              letterSpacing: "-0.02em",
              color: "#111827",
              whiteSpace: "nowrap",
              lineHeight: 1.2,
              animation: "pulse 1s ease-in-out infinite",
            }}>
              {exportProgress.current} of {exportProgress.total} packaged
            </div>
            <div style={{ width: "40%", height: 2, borderRadius: 1, background: "var(--c-border-subtle)", overflow: "hidden", margin: "20px auto 0" }}>
              <div style={{ width: `${(exportProgress.current / exportProgress.total) * 100}%`, height: "100%", background: "#0065A4", transition: "width 0.15s", boxShadow: "none" }} />
            </div>
          </div>
        )}

        {/* ── Results ── */}
        {step === "results" && items.length > 0 && (
          <div style={{ animation: "slideIn 0.3s ease-out", display: "flex", flexDirection: "column", gap: 24 }}>

              {/* Choose new files — the same drop box as the home page, so you can
                  drag, paste, or click to start a fresh set. Dropping here re-runs
                  the scan and replaces the list. Sits on top. */}
              <div className="file-drop-container" style={{ animation: "slideIn 0.3s ease-out" }}>
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
                    {anchorCountdown > 0 ? <span style={{ fontSize: 14 }}>{`Anchoring to Ethereum... ${anchorCountdown}s`}</span> : zipCount > 1 ? `Download all ${zipCount} (.zip)` : "Download .zip"}
                  </button>
                )}
              </div>

              {/* File list as a card whose header is the count, like the proof
                  page cards. Compact ledger rows matching the explorer: hairline
                  separators, whole row tappable when a proof exists. */}
              <div style={{ border: "1px solid #d0d5dd", background: "#fff" }}>
              <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: "0.04em", color: "#0065A4", padding: "18px 24px", background: "rgba(0,101,164,0.04)", borderBottom: "1px solid #e2e5e9" }}>
                {animCount} of {items.length} {allDone ? "BitGraphed" : "found"}
              </div>
              {items.map((item, i) => {
                const clickable = !!item.proof;
                const openProof = () => {
                  if (!item.proof) return;
                  // Open immediately (synchronous) so mobile browsers don't block the popup.
                  // Use the proof's digest (from TEE) for the URL, not the browser-computed hash.
                  const proofDigest = item.proof.artifact.digestB64;
                  window.open(`/proof/${encodeURIComponent(toUrlSafeB64(proofDigest))}`, "_blank");
                  // Cache the artifact bytes (and any embedded C2PA manifest) so the proof
                  // page can render the image. For a dropped proof.json the file in hand is
                  // the JSON, not the artifact, so only cache a real file: a regular dropped
                  // artifact, or one the visitor matched via the inline check below.
                  const artifactFile = item.fromProofJson ? item.matchedFile : item.file;
                  if (artifactFile) {
                    cacheArtifactToIDB(artifactFile, proofDigest).catch((e) => console.error("[bitgraph] cache error:", e));
                  }
                };
                const dotColor = item.status === "found" || item.status === "proved" ? "#0065A4"
                  : item.status === "proving" ? "#f0c060"
                  : item.status === "error" ? "#dc2626"
                  : "#9ca3af";
                const statusLabel =
                  item.status === "found" && item.valid ? <span style={{ color: "#0065A4" }}>Signature valid</span>
                  : item.status === "proved" ? <span style={{ color: "#0065A4" }}>Just BitGraphed</span>
                  : item.status === "new" ? <>Not yet BitGraphed</>
                  : item.status === "proving" ? <>BitGraphing…</>
                  : item.status === "error" ? <span style={{ color: "#dc2626" }}>Error</span>
                  : null;
                return (
                  <div key={item.file.name + i}>
                  <div
                    role={clickable ? "button" : undefined}
                    tabIndex={clickable ? 0 : undefined}
                    onClick={clickable ? openProof : undefined}
                    onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openProof(); } } : undefined}
                    className={clickable ? "bitgraph-file-row" : undefined}
                    style={{
                      display: "flex", alignItems: "center", gap: 12,
                      padding: "14px 16px",
                      borderTop: i > 0 ? "1px solid #eef0f1" : "none",
                      animation: `slideIn 0.2s ease-out ${i * 0.04}s both`,
                      cursor: clickable ? "pointer" : "default",
                    }}
                  >
                    <span aria-hidden style={{ flexShrink: 0, width: 8, height: 8, borderRadius: 99, background: dotColor }} />
                    <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 500, color: "#111827", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.file.name}
                    </span>
                    <span style={{ flexShrink: 0, fontSize: 12, color: "#9ca3af", whiteSpace: "nowrap" }}>
                      {item.proof?.commit?.counter != null && (
                        <span style={{ color: "#374151" }}>BitGraph <span style={{ fontWeight: 700, color: "#0065A4", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>#{Number(item.proof.commit.counter).toLocaleString()}</span></span>
                      )}
                      {item.proof?.commit?.counter != null && statusLabel && <span style={{ margin: "0 6px", color: "#d0d5dd" }}>·</span>}
                      {statusLabel}
                    </span>
                    {clickable && (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "#0065A4", fontSize: 14, fontWeight: 600, flexShrink: 0, letterSpacing: "-0.01em" }}>
                        Open
                        <span aria-hidden="true" style={{ fontSize: 20, lineHeight: 1, fontWeight: 600 }}>›</span>
                      </span>
                    )}
                  </div>
                  {item.fromProofJson && item.proof && (
                    <div style={{ padding: "0 16px 14px" }}>
                      {item.matchedFile ? (
                        <div style={{ padding: "12px 14px", border: "1px solid #10b981", background: "#fff", fontSize: 13, fontWeight: 600, color: "#10b981", display: "flex", alignItems: "center", gap: 8 }}>
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
