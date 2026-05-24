"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
// Nav is in root layout
import type { BitGraphProof } from "@/lib/bitgraph";
import { zipSync, strToU8 } from "fflate";
import { verifyNitroAttestation, type NitroVerifyResult } from "@/lib/nitro-verify";
import type { C2PAReadResult } from "@/lib/c2pa-reader";
// QR code removed — replaced with Ethereum Seal card

const mono = "var(--font-mono), 'SF Mono', SFMono-Regular, monospace";

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
  const [cachedFile, setCachedFile] = useState<{ name: string; data: ArrayBuffer; c2pa?: C2PAReadResult | null } | null>(null);
  // Simple view is the default entry for every proof page. The toggle to
  // technical view is intentionally ephemeral — it resets on navigation.
  // Previously this was persisted to localStorage, which caused new proofs
  // to silently skip the Simple view entirely once a user had clicked
  // "See details" on any prior proof. That was confusing.
  const [simpleView, setSimpleView] = useState<boolean>(true);

  // Nav visible on proof pages

  useEffect(() => {
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
        if (!resp.ok) { setError("Proof not found"); setLoading(false); return; }
        const data = await resp.json();
        if (data.proofs?.[0]?.proof) {
          setProof(data.proofs[0].proof as BitGraphProof);
          if (data.causalWindow) setCausalWindow(data.causalWindow);
          // Try to load cached file from IndexedDB
          try {
            let digestB64 = decodeURIComponent(digestParam).replace(/-/g, "+").replace(/_/g, "/");
            while (digestB64.length % 4 !== 0) digestB64 += "=";
            const db = await new Promise<IDBDatabase>((resolve, reject) => {
              const req = indexedDB.open("bitgraph-files", 1);
              req.onupgradeneeded = () => req.result.createObjectStore("files");
              req.onsuccess = () => resolve(req.result);
              req.onerror = () => reject(req.error);
            });
            const tx = db.transaction("files", "readonly");
            const file = await new Promise<{ name: string; data: ArrayBuffer; c2pa?: C2PAReadResult | null } | undefined>((resolve) => {
              const req = tx.objectStore("files").get(digestB64);
              req.onsuccess = () => resolve(req.result);
              req.onerror = () => resolve(undefined);
            });
            db.close();
            if (file) setCachedFile(file);
          } catch (_) { /* no cached file */ }
        } else setError("Proof not found");
      } catch { setError("Failed to load proof"); }
      setLoading(false);
    })();
  }, [digestParam]);

  if (loading) return <Shell><div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "80vh", fontSize: 20, fontWeight: 600, color: "var(--c-text-tertiary)" }}>Loading proof...</div></Shell>;
  if (error || !proof) return (
    <Shell>
      <div style={{ padding: "80px 20px", textAlign: "center" }}>
        <div style={{ fontSize: 16, color: "#f87171", marginBottom: 12 }}>{error || "Proof not found"}</div>
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

  async function exportZip() {
    try {
    const files: Record<string, Uint8Array> = {
      "proof.json": strToU8(JSON.stringify(proof, null, 2)),
    };
    // Include the original file if cached
    if (cachedFile) {
      files[cachedFile.name] = new Uint8Array(cachedFile.data);
    }
    // Fetch bounding ETH anchors
    try {
      const counter = commit.counter;
      const epoch = commit.epochId || "";
      const resp = await fetch(`/api/proofs/anchors?counter=${counter}&epoch=${encodeURIComponent(epoch)}&limit=1`);
      if (resp.ok) {
        const data = await resp.json();
        const anchors = data.anchors || [];
        if (Array.isArray(anchors) && anchors.length > 0) {
          files["ethereum-anchor.json"] = strToU8(JSON.stringify(anchors[0], null, 2));
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

        {/* Title bar — centered hero + stacked actions, matching home.
            marginBottom matches the grid `gap` below so the spacing from the
            last button to the first card equals the spacing between cards. */}
        <div style={{ marginBottom: 24, display: "flex", flexDirection: "column", alignItems: "stretch", gap: 24 }}>
          <div style={{ textAlign: "center", padding: "16px 0" }}>
            {isEth ? (
              <span style={{ fontSize: "min(36px, 5.5vw)", fontWeight: 800, letterSpacing: "-0.02em", color: "var(--c-accent)", whiteSpace: "nowrap" }}>
                Ethereum Anchor
              </span>
            ) : (
              <span style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 12,
                fontSize: "min(36px, 5.5vw)",
                fontWeight: 800,
                letterSpacing: "-0.02em",
                color: "#0065A4",
                whiteSpace: "nowrap",
                lineHeight: 1,
              }}>
                <span
                  aria-hidden="true"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 32,
                    height: 32,
                    borderRadius: 999,
                    border: "2.5px solid #0065A4",
                    flexShrink: 0,
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0065A4" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </span>
                <span>Verified BitGraph</span>
              </span>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <button
              onClick={exportZip}
              style={{
                height: 76, fontSize: 16, fontWeight: 600,
                color: "#ffffff", background: "#0065A4",
                border: "none", borderRadius: 0,
                cursor: "pointer", letterSpacing: "-0.01em",
              }}
            >
              Export Proof
            </button>
            {!isEth && (
              <button
                onClick={() => setSimpleView((v) => !v)}
                className="bg-btn-outline"
                style={{
                  height: 76, fontSize: 16, fontWeight: 500,
                  color: "#0065A4", background: "#fff",
                  border: "1px solid #0065A4", borderRadius: 0,
                  cursor: "pointer",
                }}
              >
                {simpleView ? "See details" : "← Overview"}
              </button>
            )}
          </div>
        </div>

        {simpleView && !isEth && (
          <SimpleView
            proof={proof}
            attr={attr}
            causalWindow={causalWindow}
            cachedFile={cachedFile}
            c2pa={cachedFile?.c2pa ?? null}
            isTee={isTee}
          />
        )}

        {/* No separate causal window or ethereum link — consolidated into Ethereum Seal card below */}

        {/* Cards grid — hidden in Simple view except on anchor proofs */}
        {(!simpleView || isEth) && (
        <div className="proof-grid" style={{ display: "grid", gridTemplateColumns: "1fr", gap: 24 }}>

          {/* BitGraph identity — top-level identifier, sits above the construction sequence */}
          {(proof as BitGraphProof & { proofHash?: string }).proofHash && (
            <Card title="BitGraph">
              <Field label="Proof Hash" value={(proof as BitGraphProof & { proofHash?: string }).proofHash!} mono highlight />
              <JsonSection proof={proof} />
            </Card>
          )}

          {/* 1. Slot — reserved first, before anything else */}
          {slot && (
            <Card title="Causal Slot">
              <Field label="Counter" value={`#${slot.counter}`} highlight />
              {slot.nonceB64 ? <Field label="Nonce" value={String(slot.nonceB64)} mono /> : null}
              {slot.signatureB64 ? <Field label="Signature" value={String(slot.signatureB64)} mono /> : null}
              {slot.epochId ? <Field label="Epoch ID" value={String(slot.epochId)} mono /> : null}
            </Card>
          )}

          {/* 2. Artifact — file hashed, digest computed */}
          <Card title="Artifact">
            <Field label="Digest" value={proof.artifact.digestB64} mono />
            <Field label="Algorithm" value={proof.artifact.hashAlg.toUpperCase()} />
          </Card>

          {/* 3. Commit — slot consumed, proof signed atomically */}
          <Card title="Commit">
            <Field label="Counter" value={`#${commit.counter}`} highlight />
            {commit.epochId && <Field label="Epoch ID" value={String(commit.epochId)} mono />}
            {commit.prevB64 && <Field label="Previous Hash" value={commit.prevB64} mono />}
            {commit.nonceB64 && <Field label="Nonce" value={commit.nonceB64} mono />}
            {commit.slotCounter != null && <Field label="Slot Counter" value={`#${commit.slotCounter}`} />}
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
                <AttestationButton reportB64={proof.environment.attestation.reportB64} measurement={proof.environment.measurement} />
              </div>
            )}
          </Card>

          {/* Ethereum Seal */}
          {/* Ethereum info — single card for both anchor proofs and user proofs */}
          {isEth && attr?.title ? (
            <Card title="Ethereum Block">
              <Field label="Block" value={`#${attr.title.match(/\/block\/(\d+)/)?.[1] || "?"}`} highlight />
              {attr.message && <Field label="Block Hash" value={attr.message} mono />}
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
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                      width: "100%", height: 76, fontSize: 16, fontWeight: 500,
                      color: "#0065A4", background: "#fff",
                      border: "1px solid #0065A4", borderRadius: 0,
                      textDecoration: "none", cursor: "pointer",
                    }}
                  >
                    View Anchor Proof #{causalWindow.anchorAfter.counter} &rarr;
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

          {/* Attribution — only show for non-ETH proofs that have it */}
          {attr && !isEth && (
            <Card title="Attribution">
              {attr.name && <Field label="Name" value={attr.name} />}
              {attr.message && <Field label="Data" value={attr.message} mono />}
              {attr.title && <Field label="Link" value={attr.title} link />}
            </Card>
          )}

          {ts && (
            <Card title="Timestamps">
              {ts.authority ? <Field label="Authority" value={String(ts.authority)} /> : null}
              {ts.time ? <Field label="TSA Time" value={String(ts.time)} /> : null}
              {ts.digestAlg ? <Field label="Digest Algorithm" value={String(ts.digestAlg)} /> : null}
            </Card>
          )}
        </div>
        )}


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

function Card({ title, children }: { title: string; accent?: string; children: React.ReactNode }) {
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

function Field({ label, value, mono: isMono, highlight, link }: { label: string; value: string; mono?: boolean; highlight?: boolean; link?: boolean }) {
  const [copied, setCopied] = useState(false);

  return (
    <div
      onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      style={{
        display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 16,
        padding: "14px 24px", borderBottom: "1px solid #e2e5e9", cursor: "pointer",
      }}
    >
      <span style={{ fontSize: 14, color: "#374151", fontWeight: 700, flexShrink: 0, minWidth: 80 }}>{label}</span>
      {link ? (
        <a href={value} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()} style={{
          fontSize: 13, color: "var(--c-accent)", textDecoration: "none", wordBreak: "break-all", textAlign: "right",
          maxWidth: "50%",
        }}>{value}</a>
      ) : (
        <span style={{
          fontSize: isMono ? 12 : 14,
          fontFamily: isMono ? mono : "inherit",
          color: copied ? "#0065A4" : highlight ? "var(--c-accent)" : "#1f2937",
          fontWeight: highlight ? 700 : 400,
          wordBreak: "break-all", textAlign: "right",
          maxWidth: "50%",
          transition: "color .2s", lineHeight: 1.4,
        }}>
          {copied ? "Copied!" : value}
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
      <div style={{ padding: "14px 24px", borderBottom: "1px solid #e2e5e9" }}>
        <button
          onClick={() => setOpen(true)}
          className="bg-btn-outline"
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: "100%", height: 76, fontSize: 16, fontWeight: 500,
            color: "#0065A4", background: "#fff",
            border: "1px solid #0065A4", borderRadius: 0,
            cursor: "pointer",
          }}
        >
          View Raw JSON
        </button>
      </div>
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

/* ── Simple View — plain-English proof page for non-technical visitors ── */

function SimpleView({
  proof,
  attr,
  causalWindow,
  cachedFile,
  c2pa,
  isTee,
}: {
  proof: BitGraphProof;
  attr?: { name?: string; title?: string; message?: string };
  causalWindow: {
    anchorAfter: { counter: string; blockNumber: number | null; etherscanUrl: string | null; blockTime?: string | null } | null;
  } | null;
  cachedFile: { name: string; data: ArrayBuffer } | null;
  c2pa?: C2PAReadResult | null;
  isTee: boolean;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);

  // Build an object URL for image preview if the cached file is an image.
  //
  // Three categories:
  //   1. Browser-native formats (JPEG, PNG, GIF, WebP, AVIF, BMP) → blob URL
  //   2. HEIC/HEIF → convert to JPEG via heic2any (lazy-loaded ~500 KB),
  //      then use the converted blob. iPhones shoot HEIC by default.
  //   3. RAW camera formats (CR2, CR3, NEF, ARW, DNG, RAF, ORF, RW2, PEF,
  //      SRW) → skip blob URL entirely, fall through to C2PA thumbnail.
  //      No good browser decoder exists for these.
  //
  // The <img> tag also has an onError handler that clears previewUrl so
  // unsupported formats never render as a broken image — they gracefully
  // fall back to the C2PA thumbnail or no image at all.
  useEffect(() => {
    if (!cachedFile) { setPreviewUrl(null); setPreviewFailed(false); return; }
    const name = cachedFile.name.toLowerCase();

    const isNative = /\.(jpe?g|png|gif|webp|avif|bmp|tiff?)$/i.test(name);
    const isHeic = /\.(heic|heif)$/i.test(name);
    // RAW formats — browsers can't decode these, but they almost always
    // contain an embedded JPEG preview (for the camera's LCD screen).
    // We extract the largest JPEG block from the raw bytes.
    const isRaw = /\.(cr2|cr3|nef|arw|dng|raf|orf|rw2|pef|srw|raw|x3f)$/i.test(name);

    if (!isNative && !isHeic && !isRaw) {
      setPreviewUrl(null);
      return;
    }

    if (isRaw) {
      // Extract the embedded JPEG preview from the RAW file bytes.
      const rawData = new Uint8Array(cachedFile.data);
      const jpegBlob = extractJpegFromRaw(rawData);
      if (jpegBlob) {
        const url = URL.createObjectURL(jpegBlob);
        setPreviewUrl(url);
        return () => URL.revokeObjectURL(url);
      }
      // No embedded JPEG found — fall through to C2PA thumbnail
      setPreviewUrl(null);
      return;
    }

    let revoke: (() => void) | null = null;

    if (isHeic) {
      // HEIC: convert to JPEG in the browser via heic2any (lazy-loaded).
      // Safari can render HEIC natively, but Chrome/Firefox cannot.
      (async () => {
        try {
          const heic2any = (await import("heic2any")).default;
          const blob = new Blob([new Uint8Array(cachedFile.data)]);
          const result = await heic2any({
            blob,
            toType: "image/jpeg",
            quality: 0.85,
          });
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
      // Browser-native format — direct blob URL.
      const blob = new Blob([new Uint8Array(cachedFile.data)]);
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
      revoke = () => URL.revokeObjectURL(url);
    }

    setPreviewFailed(false);
    return () => { revoke?.(); };
  }, [cachedFile]);

  // Pull the human-readable date from the Ethereum anchor block time when available
  const blockTime = causalWindow?.anchorAfter?.blockTime ?? null;
  const blockNumber = causalWindow?.anchorAfter?.blockNumber ?? null;
  const etherscanUrl = causalWindow?.anchorAfter?.etherscanUrl ?? null;
  // Anchored means the anchor exists in S3 (blockNumber present). blockTime is
  // cosmetic — fetched from a public Ethereum RPC and may be null if that RPC
  // is slow/down. Don't gate the anchor's existence on the cosmetic timestamp.
  const anchored = blockNumber !== null;

  // Format date and time separately, then join with a single breakable space
  // before "at". Spaces inside each half become non-breaking — that way the
  // line never breaks mid-time (e.g. orphaning "AM EDT" on mobile). On narrow
  // viewports the line wraps cleanly between the date and "at 10:59 AM EDT".
  const prettyDate = blockTime
    ? (() => {
        const d = new Date(blockTime);
        const datePart = d
          .toLocaleDateString(undefined, {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
          })
          .replace(/ /g, " ");
        const timePart = d
          .toLocaleTimeString(undefined, {
            hour: "numeric",
            minute: "2-digit",
            timeZoneName: "short",
          })
          .replace(/ /g, " ");
        return `${datePart} at ${timePart}`;
      })()
    : blockNumber !== null
      ? `Ethereum block #${blockNumber.toLocaleString()}`
      : "Awaiting Ethereum anchor…";

  // Short proofHash — matches the title pill
  const ph = (proof as BitGraphProof & { proofHash?: string });
  const fullHash = ph.proofHash || "";
  const shortHash = fullHash.replace(/[+/=]/g, "").slice(0, 12);

  // File hash (artifact digest) — the file's content fingerprint, distinct from the proof's hash
  const fullFileHash = proof.artifact.digestB64 || "";
  const shortFileHash = fullFileHash.replace(/[+/=]/g, "").slice(0, 12);

  // File info. Creator is intentionally not shown in the default Simple view
  // unless we can source it from a verified channel (C2PA manifest or an
  // agency/actor field). Self-attributed `attribution.name` is rendered in
  // a clearly labelled "Submitter's note" block below the facts instead —
  // the signed-caption semantics are preserved, the identity-claim framing
  // is not.
  const fileTitle =
    cachedFile?.name ||
    c2pa?.title ||
    (attr?.title && !attr.title.startsWith("http") ? attr.title : null) ||
    "Untitled file";

  const hasC2PA = !!(c2pa && c2pa.present);
  const hasSubmitterNote = !!(attr?.name?.trim() || attr?.message?.trim());

  // Image source fallback chain:
  // 1. Local preview URL (converted if HEIC, blob if native)
  // 2. C2PA embedded thumbnail (covers RAW + shared links without cached file)
  // 3. Nothing — photo card is hidden entirely
  const imageSrc = (!previewFailed && previewUrl) || c2pa?.thumbnailDataUrl || "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {imageSrc && (
        /* Photo card — full width so it matches the other fact cards
            below. The photo itself sits centered inside, constrained to
            500px on its largest dimension, with whatever whitespace on
            the sides is necessary to preserve its aspect ratio. */
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
            alt={fileTitle}
            onError={() => {
              // Browser can't render this blob — clear preview so imageSrc
              // falls through to C2PA thumbnail or hides the card entirely.
              if (previewUrl) setPreviewFailed(true);
            }}
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
      )}

      {/* Key facts */}
      <div
        style={{
          background: "#ffffff",
          border: "1px solid #d0d5dd",
          borderRadius: 0,
          overflow: "hidden",
        }}
      >
        <BigField label="File name" value={fileTitle} />
        <BigField
          label="File hash"
          value={shortFileHash}
          mono
          copyValue={fullFileHash}
          hint="SHA-256 of the file bytes. Click to copy the full hash."
        />
        <BigField
          label="BitGraph ID"
          value={shortHash}
          mono
          copyValue={fullHash}
          hint="Unique identifier for this BitGraph. Click to copy the full ID."
        />
        <BigField
          label="Zero bits have changed since"
          value={prettyDate}
          muted={!anchored}
        />
        {anchored && blockNumber !== null ? (
          <BigField
            label="BitGraphed before"
            value={`Ethereum block ${blockNumber.toLocaleString()}`}
            linkHref={etherscanUrl || undefined}
            linkLabel="View on Etherscan ↗"
            isLast
          />
        ) : (
          <BigField
            label="BitGraphed before"
            value="Awaiting next Ethereum block"
            muted
            isLast
          />
        )}
      </div>

      {/* C2PA card — only when the file actually contains a manifest */}
      {hasC2PA && <C2PACard c2pa={c2pa!} />}

      {/* Submitter's note — self-attributed caption, clearly labelled */}
      {hasSubmitterNote && (
        <div
          style={{
            background: "#ffffff",
            border: "1px solid #d0d5dd",
            borderRadius: 0,
            padding: "20px 24px",
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
            Submitter&apos;s note
          </div>
          {attr?.name && (
            <div style={{ fontSize: 15, color: "#111827", fontWeight: 600, marginBottom: 4 }}>
              {attr.name}
            </div>
          )}
          {attr?.message && (
            <div style={{ fontSize: 14, color: "#4b5563", lineHeight: 1.55, fontStyle: "italic" }}>
              &ldquo;{attr.message}&rdquo;
            </div>
          )}
          <div style={{ fontSize: 11, color: "#6b7280", marginTop: 8 }}>
            Self-attributed. Signed into the proof at commit time; identity is not verified.
          </div>
        </div>
      )}

      {/* "Verify this yourself" attestation action lives in the technical
          details view (inside the Environment card). Simple view stays
          minimal — status, facts, C2PA, explainer. */}

      {/* Tightened "What this means" — proofs are created at commit time,
          causal ordering, sealed into Ethereum. Neutral, concise. */}
      <div
        style={{
          background: "#ffffff",
          border: "1px solid #d0d5dd",
          borderRadius: 0,
          overflow: "hidden",
        }}
      >
        <div style={{
          fontSize: 14, fontWeight: 700, letterSpacing: "0.04em",
          color: "#0065A4", padding: "18px 24px",
          background: "rgba(0,101,164,0.04)",
          borderBottom: "1px solid #e2e5e9",
        }}>
          What this means
        </div>
        <p style={{ fontSize: 18, color: "#374151", lineHeight: 1.5, margin: 0, padding: "24px 24px" }}>
          Just as a photograph captures photons through the constraint of a single frame of film, a BitGraph captures bits through the constraint of a single mathematical slot.
        </p>
      </div>
    </div>
  );
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

/* ── C2PA card — top-level Content Credentials, shown when present ── */

function C2PACard({ c2pa }: { c2pa: C2PAReadResult }) {
  const claimGenerator =
    c2pa.claimGeneratorInfo?.[0]?.name ||
    c2pa.claimGenerator ||
    undefined;
  const claimGeneratorVersion = c2pa.claimGeneratorInfo?.[0]?.version;
  const hasSignature = Boolean(c2pa.signatureIssuer);
  const sigClean = c2pa.signatureValid !== false;

  return (
    <div
      style={{
        background: "#ffffff",
        border: "1px solid #d0d5dd",
        borderRadius: 0,
        overflow: "hidden",
      }}
    >
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 12, padding: "14px 24px",
        background: "rgba(0,101,164,0.04)",
        borderBottom: "1px solid #e2e5e9",
      }}>
        <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: "0.04em", color: "#0065A4" }}>
          Content Credentials (C2PA)
        </div>
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          fontSize: 11, fontWeight: 700, letterSpacing: "0.02em",
          color: "#ffffff",
          background: sigClean ? "#0065A4" : "#b45309",
          padding: "5px 10px 5px 7px", borderRadius: 999,
          lineHeight: 1,
          boxShadow: sigClean ? "0 1px 4px rgba(0,101,164,0.28)" : "none",
        }}>
          {sigClean && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 14,
                height: 14,
                borderRadius: 999,
                background: "rgba(255,255,255,0.22)",
              }}
            >
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </span>
          )}
          {sigClean ? "Signed" : "Unverified"}
        </div>
      </div>

      <div style={{ padding: "0 0 4px 0" }}>
        {c2pa.creator && <BigField label="Author" value={c2pa.creator} />}
        {claimGenerator && (
          <BigField
            label="Produced with"
            value={claimGeneratorVersion ? `${claimGenerator} ${claimGeneratorVersion}` : claimGenerator}
          />
        )}
        {c2pa.signatureIssuer && (
          <BigField label="Signed by" value={c2pa.signatureIssuer} />
        )}
        {(c2pa.ingredientCount ?? 0) > 0 && (
          <BigField
            label="Derived from"
            value={`${c2pa.ingredientCount} source file${c2pa.ingredientCount === 1 ? "" : "s"}`}
            isLast
          />
        )}
      </div>
    </div>
  );
}


/* ── Big human-readable field (Simple view) ── */

function BigField({
  label,
  value,
  mono: isMono,
  muted,
  copyValue,
  hint,
  linkHref,
  linkLabel,
  isLast,
}: {
  label: string;
  value: string;
  mono?: boolean;
  muted?: boolean;
  copyValue?: string;
  hint?: string;
  linkHref?: string;
  linkLabel?: string;
  isLast?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const clickable = Boolean(copyValue);

  return (
    <div
      onClick={() => {
        if (!clickable) return;
        navigator.clipboard.writeText(copyValue!);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: "20px 28px",
        borderBottom: isLast ? "none" : "1px solid #e5e7eb",
        cursor: clickable ? "pointer" : "default",
      }}
      title={clickable ? hint : undefined}
    >
      <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.08em" }}>
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <span
          style={{
            fontSize: isMono ? 22 : 20,
            fontFamily: isMono ? mono : "inherit",
            fontWeight: isMono ? 700 : 600,
            color: copied ? "#0065A4" : muted ? "#6b7280" : "#111827",
            letterSpacing: isMono ? "-0.01em" : "normal",
            wordBreak: "break-word",
            lineHeight: 1.3,
            transition: "color .2s",
          }}
        >
          {copied ? "Copied!" : value}
        </span>
        {linkHref && (
          <a
            href={linkHref}
            target="_blank"
            rel="noopener"
            onClick={(e) => e.stopPropagation()}
            style={{ fontSize: 13, fontWeight: 600, color: "#0065A4", textDecoration: "none", whiteSpace: "nowrap" }}
          >
            {linkLabel || linkHref}
          </a>
        )}
      </div>
    </div>
  );
}

/* ── Attestation Verifier (modal) ── */

function AttestationButton({ reportB64, measurement }: { reportB64: string; measurement: string }) {
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
      const r = await verifyNitroAttestation(reportB64, measurement);
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
          width: "100%", height: 76, fontSize: 16, fontWeight: 500,
          color: "#0065A4", background: "#fff",
          border: "1px solid #0065A4", borderRadius: 0,
          cursor: "pointer",
        }}
      >
        Verify Attestation
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
                    ? "All checks passed. This proof was signed inside an AWS Nitro Enclave with the displayed PCR0."
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
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--c-accent)", marginBottom: 6 }}>Reproducible Build</div>
                <div style={{ fontSize: 12, color: "#374151", lineHeight: 1.5, marginBottom: 8 }}>
                  PCR0 is the SHA-384 hash of the exact enclave image that signed this proof. To independently confirm what code ran, build the enclave from source and check that you get the same PCR0.
                </div>
                <a href="/docs/self-host-tee" target="_blank" rel="noopener" style={{ fontSize: 12, fontWeight: 600, color: "var(--c-accent)", textDecoration: "none" }}>
                  Build instructions →
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
