"use client";

import { useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
// Nav is in root layout
import { hashFile, hashBytes, proofHashB64, type BitGraphProof } from "@/lib/bitgraph";
import { zipSync, strToU8 } from "fflate";
import { verifyNitroAttestation, type NitroVerifyResult } from "@/lib/nitro-verify";
import type { C2PAReadResult } from "@/lib/c2pa-reader";
// QR code removed — replaced with Ethereum Seal card

const mono = "var(--font-mono), 'SF Mono', SFMono-Regular, monospace";

// "sha256" -> "SHA-256", "sha-512" -> "SHA-512". Hyphenates the SHA family to
// the conventional spelling; anything else is just upper-cased.
function formatHashAlg(alg: string): string {
  const up = alg.toUpperCase();
  const m = up.match(/^SHA-?(\d+)$/);
  return m ? `SHA-${m[1]}` : up;
}

// Leading icon for the page's action buttons, so they read as controls rather
// than as bordered panels. Stroke style matches the title check mark.
function BtnIcon({ name, color = "#0065A4", size = 18 }: { name: "code" | "certificate" | "link" | "download"; color?: string; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: color, strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true, style: { flexShrink: 0 } };
  if (name === "code") return <svg {...common}><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg>;
  // Attestation = a signed credential: a document with a ribboned seal (the
  // Tabler "certificate" glyph).
  if (name === "certificate") return <svg {...common}><path d="M15 15m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0" /><path d="M13 17.5v4.5l2 -1.5l2 1.5v-4.5" /><path d="M10 19h-5a2 2 0 0 1 -2 -2v-10c0 -1.1 .9 -2 2 -2h14a2 2 0 0 1 2 2v10a2 2 0 0 1 -1 1.73" /><path d="M6 9l12 0" /><path d="M6 12l3 0" /><path d="M6 15l2 0" /></svg>;
  if (name === "link") return <svg {...common}><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" /><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" /></svg>;
  return <svg {...common}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>;
}

export default function ProofPage() {
  const params = useParams();
  const digestParam = params.digest as string;
  const [proof, setProof] = useState<BitGraphProof | null>(null);
  const [causalWindow, setCausalWindow] = useState<{
    anchorBefore: { counter: string; attrName: string; blockNumber: number | null; blockHash: string | null; etherscanUrl: string | null; blockTime?: string | null; digestB64?: string | null } | null;
    anchorAfter: { counter: string; attrName: string; blockNumber: number | null; blockHash: string | null; etherscanUrl: string | null; blockTime?: string | null; digestB64?: string | null } | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [cachedFile, setCachedFile] = useState<{ name: string; data: ArrayBuffer; c2pa?: C2PAReadResult | null; c2paChecked?: boolean } | null>(null);
  const [matchConfirmed, setMatchConfirmed] = useState(false);
  // The anchor's OWN Ethereum block (number + timestamp), for the "Recorded"
  // line on Ethereum-anchor pages. Null for user proofs.
  const [anchorBlock, setAnchorBlock] = useState<{ blockNumber: number | null; blockTime: string | null; etherscanUrl: string | null } | null>(null);

  // Nav visible on proof pages

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // 15s timeout guards against a stuck API route (e.g. a slow
        // Ethereum RPC inside the causal-window lookup). Without this the
        // page can hang indefinitely on "Loading proof..." if anything
        // downstream stalls.
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        let resp: Response;
        try {
          resp = await fetch(`/api/proofs/digest/${digestParam}`, { signal: controller.signal });
        } finally {
          clearTimeout(timeoutId);
        }
        if (!resp.ok) { setError("BitGraph not found"); setLoading(false); return; }
        const data = await resp.json();
        if (data.proofs?.[0]?.proof) {
          setProof(data.proofs[0].proof as BitGraphProof);
          if (data.causalWindow) setCausalWindow(data.causalWindow);
          if (data.anchorBlock) setAnchorBlock(data.anchorBlock);
          // Load the cached file from IndexedDB. The home page writes it in
          // the background after BitGraphing — bytes first, then a C2PA upgrade
          // once the ~6 MB toolkit has parsed — and that write can land AFTER
          // this page mounts. So poll briefly instead of reading once: pick up
          // the bytes as soon as they appear (image preview), then keep polling
          // until C2PA has been checked (card), bounded to a few seconds.
          let digestB64 = decodeURIComponent(digestParam).replace(/-/g, "+").replace(/_/g, "/");
          while (digestB64.length % 4 !== 0) digestB64 += "=";
          const readCached = async () => {
            try {
              const db = await new Promise<IDBDatabase>((resolve, reject) => {
                const req = indexedDB.open("bitgraph-files", 1);
                req.onupgradeneeded = () => req.result.createObjectStore("files");
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
              });
              const tx = db.transaction("files", "readonly");
              const file = await new Promise<{ name: string; data: ArrayBuffer; c2pa?: C2PAReadResult | null; c2paChecked?: boolean } | undefined>((resolve) => {
                const req = tx.objectStore("files").get(digestB64);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => resolve(undefined);
              });
              db.close();
              return file;
            } catch { return undefined; }
          };
          // Self-heal: drop a cached record whose bytes don't match this proof.
          // Older home-page builds cached the dropped proof.json itself under the
          // digest key; those bytes aren't the artifact and would otherwise hide
          // both the image and the bring-your-file box.
          const dropCached = async () => {
            try {
              const db = await new Promise<IDBDatabase>((resolve, reject) => {
                const req = indexedDB.open("bitgraph-files", 1);
                req.onupgradeneeded = () => req.result.createObjectStore("files");
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
              });
              const tx = db.transaction("files", "readwrite");
              tx.objectStore("files").delete(digestB64);
              await new Promise((r) => { tx.oncomplete = r; tx.onerror = r; });
              db.close();
            } catch { /* best effort */ }
          };
          // Non-blocking poll so it never delays first paint.
          void (async () => {
            let validated = false;
            for (let attempt = 0; attempt < 20 && !cancelled; attempt++) {
              const file = await readCached();
              if (file && !cancelled) {
                // Trust a cached file only if its bytes actually hash to this
                // proof's digest. A non-matching record (e.g. a stale cached
                // proof.json) is dropped so the bring-your-file box can show.
                if (!validated) {
                  let matches = false;
                  try { matches = (await hashBytes(new Uint8Array(file.data))) === digestB64; } catch { matches = false; }
                  if (!matches) { void dropCached(); break; }
                  validated = true;
                }
                setCachedFile(file);
                if (file.c2paChecked) break; // bytes + C2PA both settled
              }
              await new Promise((r) => setTimeout(r, 350));
            }
          })();
        } else setError("BitGraph not found");
      } catch { setError("Failed to load BitGraph"); }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [digestParam]);

  if (loading) return <Shell><div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "80vh", fontSize: 20, fontWeight: 600, color: "var(--c-text-tertiary)" }}>Loading BitGraph...</div></Shell>;
  if (error || !proof) return (
    <Shell>
      <div style={{ padding: "80px 20px", textAlign: "center" }}>
        <div style={{ fontSize: 16, color: "#f87171", marginBottom: 12 }}>{error || "BitGraph not found"}</div>
        <a href="/" style={{ fontSize: 14, color: "var(--c-accent)" }}>BitGraph</a>
      </div>
    </Shell>
  );

  const commit = proof.commit;
  const attr = proof.attribution as { name?: string; title?: string; message?: string } | undefined;
  const slot = (proof as unknown as Record<string, unknown>).slotAllocation as Record<string, unknown> | undefined;
  const isEth = attr?.name?.startsWith("Ethereum");
  const isTee = proof.environment?.enforcement === "measured-tee";
  const ts = (proof.timestamps as Record<string, Record<string, unknown>> | undefined)?.artifact;

  // Ethereum block number this anchor commits (parsed from the etherscan link),
  // used in the "Recorded" line and the Ethereum Block card.
  const ethBlockNum = isEth ? (attr?.title?.match(/\/block\/(\d+)/)?.[1] ?? null) : null;

  // "Recorded" summary, shown the same way on both page types. User BitGraph:
  // the two-sided ETH time window (committed after the earlier anchor, before
  // the later one). Ethereum anchor: its own block and that block's timestamp.
  // anchorBefore is the earlier block (lower bound), anchorAfter the later
  // (upper bound) — see the naming note on the BitGraphed After/Before cards.
  const lowerTime = causalWindow?.anchorBefore?.blockTime;
  const upperTime = causalWindow?.anchorAfter?.blockTime;
  let recordedLine: string | null = null;
  // Optional pre-formatted node so the Ethereum-anchor line breaks cleanly
  // between the block and its time (one line on desktop, time drops to line 2
  // on mobile) instead of wrapping mid-time/mid-date via wordBreak.
  let recordedNode: React.ReactNode = null;
  // The actual time/date values are emphasized in brand blue (the connector
  // words stay default gray), so the receipt's key temporal fact reads as the
  // focal point, consistent with how counters/block numbers are highlighted.
  const emStyle: React.CSSProperties = { color: "#0065A4", fontWeight: 600 };
  const Em = ({ children }: { children: React.ReactNode }) => <span style={emStyle}>{children}</span>;
  if (isEth && ethBlockNum) {
    const bt = anchorBlock?.blockTime;
    const blockPart = `Ethereum Block #${Number(ethBlockNum).toLocaleString()}`;
    if (bt) {
      const timeStr = new Date(bt).toLocaleTimeString();
      const dateStr = new Date(bt).toLocaleDateString();
      recordedLine = `${blockPart} at ${timeStr} on ${dateStr}`;
      recordedNode = (
        <>
          <span style={{ whiteSpace: "nowrap" }}>{blockPart}</span>{" "}
          <span style={{ whiteSpace: "nowrap" }}>at <Em>{timeStr}</Em> on <Em>{dateStr}</Em></span>
        </>
      );
    } else {
      recordedLine = blockPart;
    }
  } else if (!isEth && lowerTime && upperTime) {
    const t1 = new Date(lowerTime), t2 = new Date(upperTime);
    if (t1.toDateString() === t2.toDateString()) {
      recordedLine = `between ${t1.toLocaleTimeString()} and ${t2.toLocaleTimeString()} on ${t2.toLocaleDateString()}`;
      recordedNode = <>between <Em>{t1.toLocaleTimeString()}</Em> and <Em>{t2.toLocaleTimeString()}</Em> on <Em>{t2.toLocaleDateString()}</Em></>;
    } else {
      recordedLine = `between ${t1.toLocaleString()} and ${t2.toLocaleString()}`;
      recordedNode = <>between <Em>{t1.toLocaleString()}</Em> and <Em>{t2.toLocaleString()}</Em></>;
    }
  } else if (!isEth && lowerTime) {
    const t1 = new Date(lowerTime);
    recordedLine = `after ${t1.toLocaleTimeString()} on ${t1.toLocaleDateString()}`;
    recordedNode = <>after <Em>{t1.toLocaleTimeString()}</Em> on <Em>{t1.toLocaleDateString()}</Em></>;
  }

  async function exportZip() {
    try {
    const files: Record<string, Uint8Array> = {
      "proof.json": strToU8(JSON.stringify(proof, null, 2)),
    };
    // Include the original file if cached
    if (cachedFile) {
      files[cachedFile.name] = new Uint8Array(cachedFile.data);
    }
    // Fetch BOTH bounding ETH anchors. The proof was witnessed after the
    // "before" anchor and before the "after" anchor, which brackets it to one
    // anchor interval (~12s) of public Ethereum time. Both are required to read
    // the window: the after-anchor alone gives only an upper bound, the same
    // one-sided "existed by now" a plain blockchain timestamp gives.
    try {
      const counter = commit.counter;
      const enc = encodeURIComponent(commit.epochId || "");
      const [afterResp, beforeResp] = await Promise.all([
        fetch(`/api/proofs/anchors?counter=${counter}&epoch=${enc}&limit=1`),
        fetch(`/api/proofs/anchors?counter=${counter}&epoch=${enc}&before=1`),
      ]);
      if (afterResp.ok) {
        const data = await afterResp.json();
        if (Array.isArray(data.anchors) && data.anchors.length > 0) {
          files["ethereum-anchor-after.json"] = strToU8(JSON.stringify(data.anchors[0], null, 2));
        }
      }
      if (beforeResp.ok) {
        const data = await beforeResp.json();
        if (Array.isArray(data.anchors) && data.anchors.length > 0) {
          files["ethereum-anchor-before.json"] = strToU8(JSON.stringify(data.anchors[0], null, 2));
        }
      }
    } catch (_) { /* ignore */ }
    const zipped = zipSync(files, { level: 0 });
    const blob = new Blob([zipped as unknown as BlobPart], { type: "application/zip" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `bitgraph-proof-${commit.counter}.zip`; a.click();
    URL.revokeObjectURL(url);
    } catch (e) { console.error("[bitgraph] export error:", e); alert("Export failed: " + e); }
  }

  return (
    <Shell>
      <style>{`
        @keyframes fadeIn { from { opacity:0; transform:translateY(6px) } to { opacity:1; transform:translateY(0) } }
        .proof-fields > div:last-child { border-bottom: none !important; }
        @media print {
        }
      `}</style>

      <div style={{ width: "90%", maxWidth: 800, margin: "0 auto", padding: "40px 0 80px", animation: "fadeIn .3s ease-out" }}>

        <div className="proof-grid" style={{ display: "grid", gridTemplateColumns: "1fr", gap: 24 }}>

          {/* Lead card. No separate hero on any page: the card header is the
              check-marked "Verified BitGraph" trust statement on every page,
              since an anchor is a verified BitGraph too. Ethereum anchors add a
              caption naming the block and omit the Recorded window (an anchor is
              not bracketed; it IS the bracket). */}
          {(proof as BitGraphProof & { proofHash?: string }).proofHash && (
            <Card title={(
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 19, height: 19, borderRadius: 999, background: "#0065A4", flexShrink: 0 }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                </span>
                <span>Verified BitGraph</span>
              </span>
            )}>
              {recordedLine && <Field label="Recorded" value={recordedLine} valueNode={recordedNode} />}
              <Field label="Hash" value={(proof as BitGraphProof & { proofHash?: string }).proofHash!} mono />
            </Card>
          )}

          {/* 1. Slot — reserved first, before anything else */}
          {slot && (
            <Card title="Causal Slot">
              <Field label="Slot Counter" value={`#${slot.counter}`} highlight />
              {slot.nonceB64 ? <Field label="Nonce" value={String(slot.nonceB64)} mono /> : null}
              {slot.signatureB64 ? <Field label="Slot Signature" value={String(slot.signatureB64)} mono /> : null}
              {slot.epochId ? <Field label="Epoch ID" value={String(slot.epochId)} mono /> : null}
            </Card>
          )}

          {/* 2. Artifact — the thing BitGraphed, then hashed. For a user proof it
              is the file (digest = hash of the bytes). For an Ethereum anchor the
              artifact IS the block hash, so show it explicitly and label the
              digest as the SHA-256 of that block hash. */}
          <Card title="Artifact">
            {isEth && attr?.message && <Field label="Ethereum Block Hash" value={attr.message} mono />}
            <Field
              label={isEth && attr?.message
                ? `${formatHashAlg(proof.artifact.hashAlg)} of Block Hash`
                : `${formatHashAlg(proof.artifact.hashAlg)} Digest`}
              value={proof.artifact.digestB64}
              mono
            />
          </Card>

          {/* 3. Commit — the artifact digest bound to its own position, one past
              the reserved slot. commit.counter is a DISTINCT position from the
              slot's (slot reserved at N, the artifact commits at N+1), so it is
              labeled "Artifact Counter" to set it apart from the slot's counter.
              When the Causal Slot card above is present it already shows the
              Epoch ID, Nonce, and slot counter (commit.slotCounter is the same
              value), so those are not echoed here; the Slot Hash remains as the
              cryptographic link binding this commit to that slot. With no slot
              card, they surface here so nothing is hidden. */}
          <Card title="Commit">
            <Field label="Artifact Counter" value={`#${commit.counter}`} highlight />
            {!slot && commit.epochId && <Field label="Epoch ID" value={String(commit.epochId)} mono />}
            {commit.prevB64 && <Field label="Previous Hash" value={commit.prevB64} mono />}
            {!slot && commit.nonceB64 && <Field label="Nonce" value={commit.nonceB64} mono />}
            {!slot && commit.slotCounter != null && <Field label="Slot Counter" value={`#${commit.slotCounter}`} />}
            {commit.slotHashB64 && <Field label="Slot Hash" value={commit.slotHashB64} mono />}
          </Card>

          {/* 4. Signer — who signed it */}
          <Card title="Signer">
            <Field label="Public Key" value={proof.signer.publicKeyB64} mono />
            <Field label="Signature" value={proof.signer.signatureB64} mono />
          </Card>

          {/* 5. Environment — where it was signed */}
          <Card title="Environment">
            <Field label="Enforcement" value={isTee ? "Hardware Enclave (AWS Nitro)" : "Software"} />
            {proof.environment?.measurement && <Field label="PCR0 Measurement" value={proof.environment.measurement} mono />}
            {proof.environment?.attestation?.format && <Field label="Attestation Format" value={proof.environment.attestation.format} />}
            {proof.environment?.attestation?.reportB64 && proof.environment?.measurement && (
              <div style={{ padding: "14px 24px", borderBottom: "1px solid #e2e5e9" }}>
                <AttestationButton reportB64={proof.environment.attestation.reportB64} measurement={proof.environment.measurement} proof={proof} />
              </div>
            )}
          </Card>

          {/* Ethereum Seal */}
          {/* Ethereum info — single card for both anchor proofs and user proofs */}

          {/* BitGraphed After — the previous same-epoch anchor (lower time
              bound). Renders anchorBefore, the earlier block: the proof was
              witnessed AFTER this anchor. Shown above "BitGraphed Before" so the
              pair reads as a window: after this block, before that one. */}
          {!isEth && causalWindow?.anchorBefore && (
            <Card title="BitGraphed After">
              <Field
                label="Ethereum Block"
                value={
                  causalWindow.anchorBefore.blockNumber !== null
                    ? causalWindow.anchorBefore.blockNumber.toLocaleString()
                    : "—"
                }
                highlight
              />
              {causalWindow.anchorBefore.blockTime && (
                <Field label="Block Time" value={new Date(causalWindow.anchorBefore.blockTime).toLocaleString()} />
              )}
              {causalWindow.anchorBefore.etherscanUrl && (
                <Field label="Etherscan" value={causalWindow.anchorBefore.etherscanUrl} link />
              )}
              {causalWindow.anchorBefore.digestB64 && (
                <div style={{ padding: "14px 24px", borderBottom: "1px solid #e2e5e9" }}>
                  <a
                    href={`/proof/${encodeURIComponent((causalWindow.anchorBefore.digestB64 || "").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""))}`}
                    target="_blank" rel="noopener"
                    className="bg-btn-outline"
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 9,
                      width: "100%", height: 76, fontSize: 16, fontWeight: 500,
                      color: "#0065A4", background: "#f4f6f9",
                      border: "1px solid #0065A4", borderRadius: 0,
                      textDecoration: "none", cursor: "pointer",
                    }}
                  >
                    <BtnIcon name="link" />
                    <span>View Anchor BitGraph #{causalWindow.anchorBefore.counter} &rarr;</span>
                  </a>
                </div>
              )}
            </Card>
          )}

          {isEth && attr?.title ? (
            <Card title="Ethereum Block">
              <Field label="Block" value={ethBlockNum ? `#${Number(ethBlockNum).toLocaleString()}` : "#?"} highlight />
              <Field label="Etherscan" value={attr.title} link />
            </Card>
          ) : causalWindow?.anchorAfter ? (
            <Card title="BitGraphed Before">
              <Field
                label="Ethereum Block"
                value={
                  causalWindow.anchorAfter.blockNumber !== null
                    ? causalWindow.anchorAfter.blockNumber.toLocaleString()
                    : "—"
                }
                highlight
              />
              {causalWindow.anchorAfter.blockTime && (
                <Field label="Block Time" value={new Date(causalWindow.anchorAfter.blockTime).toLocaleString()} />
              )}
              {causalWindow.anchorAfter.etherscanUrl && (
                <Field label="Etherscan" value={causalWindow.anchorAfter.etherscanUrl} link />
              )}
              {causalWindow.anchorAfter.digestB64 && (
                <div style={{ padding: "14px 24px", borderBottom: "1px solid #e2e5e9" }}>
                  <a
                    href={`/proof/${encodeURIComponent((causalWindow.anchorAfter.digestB64 || "").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""))}`}
                    target="_blank" rel="noopener"
                    className="bg-btn-outline"
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 9,
                      width: "100%", height: 76, fontSize: 16, fontWeight: 500,
                      color: "#0065A4", background: "#f4f6f9",
                      border: "1px solid #0065A4", borderRadius: 0,
                      textDecoration: "none", cursor: "pointer",
                    }}
                  >
                    <BtnIcon name="link" />
                    <span>View Anchor BitGraph #{causalWindow.anchorAfter.counter} &rarr;</span>
                  </a>
                </div>
              )}
            </Card>
          ) : (
            <Card title="BitGraphed Before">
              <div style={{ padding: "18px 24px", fontSize: 14, color: "#6b7280" }}>
                Awaiting next Ethereum block…
              </div>
            </Card>
          )}

          {/* Submitter's Note — self-supplied, only for non-ETH proofs that carry
              it. These values are typed in by whoever made the proof and are NOT
              verified by BitGraph, so the card says so and never labels the name
              as "Creator". */}
          {attr && !isEth && (
            <Card title="Submitter's Note">
              <div style={{ padding: "12px 24px 4px", fontSize: 12.5, color: "#6b7280", lineHeight: 1.5 }}>
                Self-attributed, not verified by BitGraph.
              </div>
              {attr.name && <Field label="Submitted by" value={attr.name} />}
              {attr.message && <Field label="Note" value={attr.message} mono />}
              {attr.title && <Field label="Link" value={attr.title} link />}
            </Card>
          )}

          {/* Advisory timestamp — the Ethereum window above is the authoritative
              time mechanism. A TSA time, if present, is advisory only, so it is
              labeled as such and sits last. */}
          {ts && (
            <Card title="Advisory Timestamp">
              {ts.authority ? <Field label="Authority" value={String(ts.authority)} /> : null}
              {ts.time ? <Field label="TSA Time" value={String(ts.time)} /> : null}
              {ts.digestAlg ? <Field label="Digest Algorithm" value={String(ts.digestAlg)} /> : null}
            </Card>
          )}

          {/* Your file — moved to the bottom, just above the export action: the
              page reads as the BitGraph first, then "do you have the file?", then
              export. Green banner only after the visitor actively checks a file. */}
          {!isEth && matchConfirmed && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "13px 18px", background: "#f0fdf4", border: "1px solid #bbf7d0", color: "#16a34a", fontSize: 14, fontWeight: 700 }}>
              <span aria-hidden>✓</span> This file matches this BitGraph
            </div>
          )}
          {/* Show the artifact image when one is available; otherwise keep the
              bring-your-file checker visible so checking is always an option —
              until the visitor confirms a match, then drop the box. */}
          {!isEth && (isDisplayableImage(cachedFile, cachedFile?.c2pa)
            ? <PhotoCard cachedFile={cachedFile} c2pa={cachedFile?.c2pa ?? null} />
            : (matchConfirmed ? null : <BringYourFile proof={proof} onMatch={(rec) => { setCachedFile(rec); setMatchConfirmed(true); }} />))}

          {/* Content Credentials (C2PA) — sits right under the image it describes,
              just above the export button. */}
          {!isEth && cachedFile?.c2pa?.present && <C2PACard c2pa={cachedFile.c2pa} />}
        </div>

        {/* Export — the closing action. A receipt is read first and saved last,
            so the primary action sits below the cards. marginTop matches the grid
            `gap` so the spacing from the last card equals the spacing between
            cards. */}
        <div style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 8 }}>
          {/* Raw JSON sits with Export: both are "do something with the data"
              actions. Outline (inspect) above filled (download). */}
          <JsonSection proof={proof} />
          <button
            onClick={exportZip}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
              height: 76, fontSize: 16, fontWeight: 600,
              color: "#ffffff", background: "#0065A4",
              border: "none", borderRadius: 0,
              cursor: "pointer", letterSpacing: "-0.01em",
            }}
          >
            <BtnIcon name="download" color="#ffffff" />
            <span>{!isEth && cachedFile ? "Export BitGraph + File" : "Export BitGraph"}</span>
          </button>
          {/* The original file only ever lives on the device that holds it
              (never the server). When it is present the "+ File" label says
              enough; when it is not, this note explains the proof-only export. */}
          {!isEth && !cachedFile && (
            <div style={{ fontSize: 12.5, color: "#6b7280", textAlign: "center" }}>
              BitGraph only: the original file is not on this device
            </div>
          )}
        </div>

      </div>
    </Shell>
  );
}

/* ── Shell — uses same theme as maker page ── */

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--c-text)" }}>
      {children}
    </div>
  );
}

/* ── Card ── */

function Card({ title, children }: { title: React.ReactNode; accent?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #d0d5dd", borderRadius: 0, overflow: "hidden" }}>
      <div style={{
        fontSize: 14, fontWeight: 700, letterSpacing: "0.04em",
        color: "#0065A4", padding: "18px 24px",
        background: "rgba(0,101,164,0.04)",
        borderBottom: "1px solid #e2e5e9",
      }}>
        {title}
      </div>
      <div className="proof-fields" style={{ padding: "4px 0" }}>
        {children}
      </div>
    </div>
  );
}

/* ── Field with copy ── */

function Field({ label, value, valueNode, mono: isMono, highlight, link }: { label: string; value: string; valueNode?: React.ReactNode; mono?: boolean; highlight?: boolean; link?: boolean }) {
  const [copied, setCopied] = useState(false);

  return (
    <div
      onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      style={{
        display: "flex", flexDirection: "column", gap: 5,
        padding: "14px 24px", borderBottom: "1px solid #e2e5e9", cursor: "pointer",
      }}
    >
      <span style={{ fontSize: 14, color: "#374151", fontWeight: 700 }}>{label}</span>
      {link ? (
        <a href={value} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()} style={{
          fontSize: 13, color: "var(--c-accent)", textDecoration: "none", wordBreak: "break-all",
        }}>{value}</a>
      ) : (
        <span style={{
          fontSize: isMono ? 12 : 14,
          fontFamily: isMono ? mono : "inherit",
          color: copied ? "#0065A4" : highlight ? "var(--c-accent)" : "#1f2937",
          fontWeight: highlight ? 700 : 400,
          wordBreak: valueNode ? "normal" : "break-all",
          transition: "color .2s", lineHeight: 1.5,
        }}>
          {copied ? "Copied!" : (valueNode ?? value)}
        </span>
      )}
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  padding: "8px 16px", fontSize: 13, fontWeight: 600, color: "#ffffff",
  background: "#0065A4", border: "1px solid #0065A4", borderRadius: 0, cursor: "pointer",
};

function JsonSection({ proof }: { proof: BitGraphProof }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const json = JSON.stringify(proof, null, 2);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="bg-btn-outline"
        style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: 9,
          width: "100%", height: 76, fontSize: 16, fontWeight: 500,
          color: "#0065A4", background: "#f4f6f9",
          border: "1px solid #0065A4", borderRadius: 0,
          cursor: "pointer",
        }}
      >
        <BtnIcon name="code" />
        <span>View Raw JSON</span>
      </button>
      {open && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
          onClick={() => setOpen(false)}
        >
          <div
            style={{ width: "100%", maxWidth: 720, maxHeight: "85vh", display: "flex", flexDirection: "column", background: "#fff", borderRadius: 0, border: "1px solid #d0d5dd", overflow: "hidden" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "16px 20px", borderBottom: "1px solid #e5e7eb" }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: "var(--c-accent)" }}>Raw JSON</span>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    navigator.clipboard.writeText(json);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                  style={{ padding: "5px 12px", fontSize: 12, fontWeight: 600, color: "var(--c-accent)", background: "#fff", border: "1px solid var(--c-accent)", borderRadius: 0, cursor: "pointer" }}
                >
                  {copied ? "Copied" : "Copy"}
                </button>
                <button
                  onClick={() => setOpen(false)}
                  style={{ padding: "5px 12px", fontSize: 12, fontWeight: 600, color: "#fff", background: "var(--c-accent)", border: "none", borderRadius: 0, cursor: "pointer" }}
                >
                  Close
                </button>
              </div>
            </div>
            <div style={{ flex: 1, overflow: "auto", padding: "18px 20px" }}>
              <pre
                style={{
                  fontSize: 12,
                  lineHeight: 1.6,
                  color: "#374151",
                  padding: 14,
                  margin: 0,
                  background: "#f9fafb",
                  border: "1px solid #e5e7eb",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                  fontFamily: mono,
                }}
              >
                {json}
              </pre>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ── Bring-your-file checker — when no artifact is cached on this device, let
   the visitor supply the file. It is hashed in the browser and matched against
   the proof's digest; on a match the page fills in (image + C2PA), on a
   mismatch it says so. Nothing is uploaded. ── */

function BringYourFile({
  proof,
  onMatch,
}: {
  proof: BitGraphProof;
  onMatch: (rec: { name: string; data: ArrayBuffer; c2pa: C2PAReadResult | null; c2paChecked: boolean }) => void;
}) {
  const [state, setState] = useState<"idle" | "checking" | "mismatch">("idle");
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function check(file: File | undefined | null) {
    if (!file) return;
    setState("checking");
    try {
      const digest = await hashFile(file);
      if (digest !== proof.artifact.digestB64) { setState("mismatch"); return; }
      const data = await file.arrayBuffer();
      let c2pa: C2PAReadResult | null = null;
      try {
        const { readC2PA } = await import("@/lib/c2pa-reader");
        c2pa = await readC2PA(file);
      } catch (e) { console.warn("[bitgraph] c2pa read failed:", e); }
      // Persist to the same IndexedDB store the page reads, so it survives reloads.
      try {
        const db = await new Promise<IDBDatabase>((res, rej) => {
          const req = indexedDB.open("bitgraph-files", 1);
          req.onupgradeneeded = () => req.result.createObjectStore("files");
          req.onsuccess = () => res(req.result);
          req.onerror = () => rej(req.error);
        });
        const tx = db.transaction("files", "readwrite");
        tx.objectStore("files").put({ name: file.name, data, c2pa, c2paChecked: true }, proof.artifact.digestB64);
        await new Promise((r, j) => { tx.oncomplete = () => r(null); tx.onerror = () => j(tx.error); });
        db.close();
      } catch (e) { console.warn("[bitgraph] cache write failed:", e); }
      onMatch({ name: file.name, data, c2pa, c2paChecked: true });
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
        background: "#fff",
        border: `2px dashed ${mismatch ? "#dc2626" : dragOver ? "#0065A4" : "#c4c9d0"}`,
        padding: "34px 24px",
        textAlign: "center",
        cursor: "pointer",
        transition: "border-color .15s",
      }}
    >
      <input ref={inputRef} type="file" style={{ display: "none" }} onClick={(e) => e.stopPropagation()} onChange={(e) => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ""; check(f); }} />
      {state === "checking" ? (
        <div style={{ fontSize: 15, fontWeight: 600, color: "#6b7280" }}>Checking…</div>
      ) : mismatch ? (
        <>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#dc2626" }}>These bytes don&rsquo;t match this BitGraph</div>
          <div style={{ fontSize: 13, color: "#6b7280", marginTop: 6 }}>A single changed bit produces a completely different hash. Drop the exact original to check again.</div>
        </>
      ) : (
        <>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#111827" }}>Have the file? Check it against this BitGraph.</div>
          <div style={{ fontSize: 13, color: "#6b7280", marginTop: 6 }}>Drop it here or click to choose. Hashed in your browser, nothing is uploaded.</div>
        </>
      )}
    </div>
  );
}

/* ── Photo preview card — shows the artifact image when one is available ── */

function PhotoCard({
  cachedFile,
  c2pa,
}: {
  cachedFile: { name: string; data: ArrayBuffer } | null;
  c2pa?: C2PAReadResult | null;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);

  // Build an object URL for image preview if the cached file is an image.
  //
  //   1. Browser-native formats (JPEG, PNG, GIF, WebP, AVIF, BMP, TIFF) → blob URL
  //   2. HEIC/HEIF → convert to JPEG via heic2any (lazy-loaded ~500 KB).
  //      iPhones shoot HEIC by default.
  //   3. RAW camera formats (CR2, CR3, NEF, ARW, DNG, RAF, ORF, RW2, PEF,
  //      SRW, X3F) → extract the embedded JPEG preview from the raw bytes.
  //
  // The <img> onError handler clears previewUrl so an unsupported format
  // never renders as a broken image — it falls back to the C2PA thumbnail
  // or to nothing.
  useEffect(() => {
    if (!cachedFile) { setPreviewUrl(null); setPreviewFailed(false); return; }
    const name = cachedFile.name.toLowerCase();

    const isHeic = /\.(heic|heif)$/i.test(name);
    const isRaw = /\.(cr2|cr3|nef|arw|dng|raf|orf|rw2|pef|srw|raw|x3f)$/i.test(name);
    // Prefer the extension, but fall back to sniffing magic bytes so a
    // browser-renderable image still previews when the filename has no or an
    // odd extension (some AI exports / ChatGPT downloads arrive that way).
    const isNative =
      /\.(jpe?g|png|gif|webp|avif|bmp|tiff?)$/i.test(name) ||
      (!isHeic && !isRaw && sniffNativeImage(cachedFile.data));

    if (!isNative && !isHeic && !isRaw) {
      setPreviewUrl(null);
      return;
    }

    if (isRaw) {
      const rawData = new Uint8Array(cachedFile.data);
      const jpegBlob = extractJpegFromRaw(rawData);
      if (jpegBlob) {
        const url = URL.createObjectURL(jpegBlob);
        setPreviewUrl(url);
        return () => URL.revokeObjectURL(url);
      }
      setPreviewUrl(null);
      return;
    }

    let revoke: (() => void) | null = null;

    if (isHeic) {
      (async () => {
        try {
          const heic2any = (await import("heic2any")).default;
          const blob = new Blob([new Uint8Array(cachedFile.data)]);
          const result = await heic2any({ blob, toType: "image/jpeg", quality: 0.85 });
          const jpegBlob = Array.isArray(result) ? result[0] : result;
          const url = URL.createObjectURL(jpegBlob);
          setPreviewUrl(url);
          revoke = () => URL.revokeObjectURL(url);
        } catch (e) {
          console.warn("[bitgraph] heic2any conversion failed:", e);
          setPreviewUrl(null);
        }
      })();
    } else {
      const blob = new Blob([new Uint8Array(cachedFile.data)]);
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
      revoke = () => URL.revokeObjectURL(url);
    }

    setPreviewFailed(false);
    return () => { revoke?.(); };
  }, [cachedFile]);

  // Image source fallback chain:
  //   1. Local preview URL (converted if HEIC, blob if native)
  //   2. C2PA embedded thumbnail (covers RAW + shared links with no cached file)
  //   3. Nothing — the card is not rendered
  const imageSrc = (!previewFailed && previewUrl) || c2pa?.thumbnailDataUrl || "";
  if (!imageSrc) return null;

  const alt = cachedFile?.name || c2pa?.title || "Proof artifact";

  return (
    <div
      style={{
        background: "#ffffff",
        border: "1px solid #d0d5dd",
        borderRadius: 0,
        padding: 24,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageSrc}
        alt={alt}
        onError={() => { if (previewUrl) setPreviewFailed(true); }}
        style={{
          display: "block",
          maxWidth: "min(100%, 500px)",
          maxHeight: 500,
          width: "auto",
          height: "auto",
          objectFit: "contain",
          borderRadius: 0,
        }}
      />
    </div>
  );
}

/* ── Content Credentials (C2PA) card — the file's self-declared provenance ──
   Pass-through of the manifest embedded in the artifact bytes. BitGraph does
   not vouch for these claims; it pins the exact bytes that carry them. Only
   recognized IPTC source types get a friendly label, so an unknown code falls
   back to the generator line rather than guessing. */

const SOURCE_TYPE_LABELS: Record<string, string> = {
  trainedAlgorithmicMedia: "Generated by AI",
  compositeWithTrainedAlgorithmicMedia: "Contains AI-generated elements",
  digitalCapture: "Camera capture",
};

// Turn a raw C2PA generator into a human label, e.g.
// "lightroom_classic/15.3.1" -> "Lightroom Classic 15.3.1". Prefers the
// structured claimGeneratorInfo (clean name + version), falling back to the
// User-Agent-style claim_generator string. Only word-initial letters are
// cased, so acronyms like "ChatGPT" / "OpenAI" survive untouched.
function formatGenerator(c2pa: C2PAReadResult): string | undefined {
  const prettify = (s: string) =>
    s.replace(/[_-]+/g, " ").trim().replace(/\b\w/g, (ch) => ch.toUpperCase());
  const info = c2pa.claimGeneratorInfo?.find((g) => g.name);
  if (info?.name) return info.version ? `${prettify(info.name)} ${info.version}` : prettify(info.name);
  const raw = c2pa.claimGenerator;
  if (!raw) return undefined;
  const [namePart, version] = raw.split(/\s+/)[0].split("/");
  return version ? `${prettify(namePart)} ${version}` : prettify(namePart);
}

function C2PACard({ c2pa }: { c2pa: C2PAReadResult }) {
  const sourceText = c2pa.digitalSourceType ? SOURCE_TYPE_LABELS[c2pa.digitalSourceType] : undefined;
  const generator = formatGenerator(c2pa);
  const signed = c2pa.signatureValid === true;

  return (
    /* Trust status sits in the header. A CA-validated signature gets the same
       green check badge as the "Verified BitGraph" header (the "Signed by …"
       field below names the issuer, so the word "Signed" is redundant). A
       self-declared manifest keeps an explicit gray label, since that caveat is
       not conveyable by a glyph and a green check must never imply CA validation
       the manifest does not have. It never asserts the file is authentic. */
    <Card title={
      signed ? (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 19, height: 19, borderRadius: 999, background: "#0065A4", flexShrink: 0 }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
          </span>
          <span>Content Credentials (C2PA)</span>
        </span>
      ) : (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <span>Content Credentials (C2PA)</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700, letterSpacing: "normal", color: "#6b7280" }}>
            <span aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>○</span>
            Self-declared
          </span>
        </div>
      )
    }>
      {sourceText && <Field label="Source" value={sourceText} highlight />}
      {generator && <Field label="Made with" value={generator} />}
      {c2pa.creator && <Field label="Creator" value={c2pa.creator} />}
      {c2pa.signatureIssuer && <Field label="Signed by" value={c2pa.signatureIssuer} />}
    </Card>
  );
}

/* ── Sniff browser-renderable image types from magic bytes ──
   Lets the preview work when the filename has no usable extension (some AI
   exports / ChatGPT downloads arrive that way). Covers only the formats an
   <img> renders directly; HEIC and RAW are handled separately since they
   need conversion. */
/* Whether a cached file can actually be shown as an image. When it can't (e.g.
   a cached .txt arriving via the home "Open" link, or any non-image artifact),
   PhotoCard would render nothing, so the proof page should fall through to the
   bring-your-file checker instead of showing an empty slot. */
function isDisplayableImage(
  f: { name: string; data: ArrayBuffer } | null | undefined,
  c2pa?: C2PAReadResult | null,
): boolean {
  if (c2pa?.thumbnailDataUrl) return true;
  if (!f) return false;
  if (/\.(jpe?g|png|gif|webp|avif|bmp|tiff?|heic|heif|cr2|cr3|nef|arw|dng|raf|orf|rw2|pef|srw|raw|x3f)$/i.test(f.name)) return true;
  return sniffNativeImage(f.data);
}

function sniffNativeImage(buffer: ArrayBuffer): boolean {
  const b = new Uint8Array(buffer, 0, Math.min(16, buffer.byteLength));
  if (b.length < 4) return false;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return true; // PNG
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return true;                  // JPEG
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return true;                  // GIF
  if (b[0] === 0x42 && b[1] === 0x4d) return true;                                   // BMP
  if ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0x00) ||
      (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x00 && b[3] === 0x2a)) return true; // TIFF
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return true;  // RIFF/WEBP
  if (b.length >= 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70 &&
      b[8] === 0x61 && b[9] === 0x76 && b[10] === 0x69 && b[11] === 0x66) return true;  // ftyp 'avif'
  return false;
}

/* ── Extract embedded JPEG preview from RAW camera files ── */

/**
 * RAW camera files (CR2, NEF, ARW, DNG, RAF, etc.) embed one or more
 * JPEG previews for the camera's LCD screen. This function scans the
 * raw bytes for JPEG start (0xFF 0xD8) and end (0xFF 0xD9) markers
 * and returns the largest JPEG block found — which is typically the
 * full-resolution preview.
 *
 * No external dependency. Works for every major DSLR RAW format
 * because they all embed JPEG previews the same way.
 */
function extractJpegFromRaw(data: Uint8Array): Blob | null {
  // Find all JPEG SOI (Start of Image) markers
  const starts: number[] = [];
  for (let i = 0; i < data.length - 1; i++) {
    if (data[i] === 0xFF && data[i + 1] === 0xD8) {
      starts.push(i);
    }
  }
  if (starts.length === 0) return null;

  let bestStart = -1;
  let bestEnd = -1;
  let bestSize = 0;

  for (let s = 0; s < starts.length; s++) {
    const start = starts[s];
    // Search boundary: next JPEG SOI or end of file
    const boundary = s + 1 < starts.length ? starts[s + 1] : data.length;

    // Find the last JPEG EOI (End of Image) marker before the boundary
    let end = -1;
    for (let j = boundary - 2; j >= start + 2; j--) {
      if (data[j] === 0xFF && data[j + 1] === 0xD9) {
        end = j + 2;
        break;
      }
    }

    if (end < 0) continue;
    const size = end - start;
    // Skip tiny thumbnails (< 10 KB) — we want the full-res preview
    if (size > bestSize && size > 10000) {
      bestStart = start;
      bestEnd = end;
      bestSize = size;
    }
  }

  if (bestStart < 0) return null;
  return new Blob([data.slice(bestStart, bestEnd)], { type: "image/jpeg" });
}

/* ── Attestation Verifier (modal) ── */

function AttestationButton({ reportB64, measurement, proof }: { reportB64: string; measurement: string; proof: BitGraphProof }) {
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<NitroVerifyResult | null>(null);
  const [copiedReport, setCopiedReport] = useState(false);

  async function runVerify() {
    setRunning(true);
    setResult(null);
    // Yield to allow UI repaint
    await new Promise((r) => setTimeout(r, 50));
    try {
      // Recompute this proof's hash and require the attestation's user_data to
      // match it, so a genuine attestation can't be lifted onto a forged proof.
      const expectedUserData = await proofHashB64(proof);
      const r = await verifyNitroAttestation(reportB64, measurement, expectedUserData);
      setResult(r);
    } catch (e) {
      setResult({
        valid: false,
        checks: [{ name: "Verification Error", pass: false, detail: e instanceof Error ? e.message : String(e) }],
        pcrs: {},
      });
    }
    setRunning(false);
  }

  if (!open) {
    return (
      <button
        onClick={() => { setOpen(true); runVerify(); }}
        className="bg-btn-outline"
        style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: 9,
          width: "100%", height: 76, fontSize: 16, fontWeight: 500,
          color: "#0065A4", background: "#f4f6f9",
          border: "1px solid #0065A4", borderRadius: 0,
          cursor: "pointer",
        }}
      >
        <BtnIcon name="certificate" />
        <span>Verify Attestation</span>
      </button>
    );
  }

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
      onClick={() => setOpen(false)}
    >
      <div
        style={{ width: "100%", maxWidth: 720, maxHeight: "85vh", display: "flex", flexDirection: "column", background: "#fff", borderRadius: 0, border: "1px solid #d0d5dd", overflow: "hidden" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid #e5e7eb" }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--c-accent)" }}>AWS Nitro Attestation Verification</span>
          <button onClick={() => setOpen(false)} style={{ padding: "5px 12px", fontSize: 12, fontWeight: 600, color: "#fff", background: "var(--c-accent)", border: "none", borderRadius: 0, cursor: "pointer" }}>Close</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: "auto", padding: "18px 20px" }}>
          {running && (
            <div style={{ padding: "40px 20px", textAlign: "center", color: "#6b7280", fontSize: 14 }}>
              Verifying signature, certificate chain, and PCR0...
            </div>
          )}

          {result && (
            <>
              {/* Overall status */}
              <div style={{
                padding: "14px 18px", marginBottom: 16, borderRadius: 0,
                background: result.valid ? "#f0fdf4" : "#fef2f2",
                border: `1px solid ${result.valid ? "#bbf7d0" : "#fecaca"}`,
              }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: result.valid ? "#22c55e" : "#dc2626" }}>
                  {result.valid ? "Attestation Verified" : "Verification Failed"}
                </div>
                <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
                  {result.valid
                    ? "All checks passed. This BitGraph was signed inside an AWS Nitro Enclave with the displayed PCR0."
                    : "One or more verification steps failed. See details below."}
                </div>
              </div>

              {/* Checks */}
              <div style={{ marginBottom: 18 }}>
                {result.checks.map((c, i) => (
                  <div key={i} style={{ display: "flex", gap: 12, padding: "10px 0", borderBottom: i < result.checks.length - 1 ? "1px solid #f3f4f6" : "none" }}>
                    <span style={{ fontSize: 16, color: c.pass ? "#22c55e" : "#dc2626", flexShrink: 0 }}>{c.pass ? "✓" : "✗"}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>{c.name}</div>
                      <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2, wordBreak: "break-all" }}>{c.detail}</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Decoded fields */}
              {(result.moduleId || result.timestamp || result.certChainLength) && (
                <div style={{ marginBottom: 18, padding: "14px 18px", background: "#f9fafb", borderRadius: 0, border: "1px solid #e5e7eb" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>Decoded from Attestation Document</div>
                  {result.moduleId && (
                    <div style={{ fontSize: 12, color: "#374151", marginBottom: 4, wordBreak: "break-all" }}>
                      <span style={{ color: "#6b7280" }}>Module ID: </span>{result.moduleId}
                    </div>
                  )}
                  {result.timestamp && (
                    <div style={{ fontSize: 12, color: "#374151", marginBottom: 4 }}>
                      <span style={{ color: "#6b7280" }}>Timestamp: </span>{new Date(result.timestamp).toLocaleString()}
                    </div>
                  )}
                  {result.certChainLength && (
                    <div style={{ fontSize: 12, color: "#374151" }}>
                      <span style={{ color: "#6b7280" }}>Certificate Chain: </span>{result.certChainLength} certificates
                    </div>
                  )}
                </div>
              )}

              {/* Other PCRs */}
              {Object.keys(result.pcrs).length > 1 && (
                <div style={{ marginBottom: 18 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Other Active PCRs</div>
                  {Object.entries(result.pcrs)
                    .filter(([idx]) => idx !== "0")
                    .map(([idx, hex]) => (
                      <div key={idx} style={{ fontSize: 11, fontFamily: mono, color: "#6b7280", marginBottom: 4, wordBreak: "break-all" }}>
                        <span style={{ color: "#6b7280" }}>PCR{idx}: </span>{hex}
                      </div>
                    ))}
                </div>
              )}

              {/* Reproducible build */}
              <div style={{ padding: "14px 18px", background: "rgba(0,101,164,0.04)", border: "1px solid rgba(0,101,164,0.15)", borderRadius: 0, marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--c-accent)", marginBottom: 6 }}>What PCR0 proves</div>
                <div style={{ fontSize: 12, color: "#374151", lineHeight: 1.5, marginBottom: 8 }}>
                  PCR0 is the SHA-384 hash of the exact enclave image that signed this BitGraph, shown above. The enclave source is open and the build is bit-for-bit reproducible: you can rebuild it on any linux/amd64 host and re-derive this exact PCR0 yourself, trusting no one. You do not have to take BitGraph at its word for what runs inside the boundary.
                </div>
                <a href="/docs/self-host-tee" target="_blank" rel="noopener" style={{ fontSize: 12, fontWeight: 600, color: "var(--c-accent)", textDecoration: "none" }}>
                  Rebuild and verify this PCR0 &rarr;
                </a>
              </div>

              {/* Raw report */}
              <div style={{ padding: "12px 16px", background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 0 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.06em" }}>Raw Attestation Report</div>
                  <button
                    onClick={() => { navigator.clipboard.writeText(reportB64); setCopiedReport(true); setTimeout(() => setCopiedReport(false), 1500); }}
                    style={{ fontSize: 11, fontWeight: 600, color: "var(--c-accent)", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}
                  >
                    {copiedReport ? "Copied!" : "Copy"}
                  </button>
                </div>
                <div style={{ fontSize: 10, fontFamily: mono, color: "#6b7280", wordBreak: "break-all", maxHeight: 60, overflow: "hidden" }}>
                  {reportB64.slice(0, 200)}...
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
