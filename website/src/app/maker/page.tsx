"use client";

import { useState, useEffect, useCallback } from "react";
import { FileDrop } from "@/components/file-drop";
import { Nav } from "@/components/nav";
import {
  hashFile,
  hashBytes,
  commitDigest,
  commitBatch,
  formatFileSize,
  isBitGraphProof,
  verifyProofSignature,
  type BitGraphProof,
  type AgencyEnvelope,
  type ActorIdentity,
  type ProofVerifyResult,
} from "@/lib/bitgraph";
import { toUrlSafeB64, relativeTime } from "@/lib/explorer";
import { zipSync } from "fflate";

/* ── Types ── */

type Mode = "make" | "verify";
type MakeStep = "drop" | "hashing" | "signing" | "done" | "error";
type VerifyStep = "drop" | "checking" | "result";

interface ProofEntry {
  globalId: number;
  digest: string;
  counter?: string;
  enforcement: string;
  time?: number;
  attribution?: string;
  signer: string;
}

/* ── WebAuthn / Biometric helpers ── */

async function createBiometricAuthorization(digestB64: string): Promise<AgencyEnvelope | undefined> {
  if (!window.PublicKeyCredential) return undefined;

  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const credential = await navigator.credentials.get({
      publicKey: {
        challenge,
        timeout: 60000,
        userVerification: "required",
        rpId: window.location.hostname,
        allowCredentials: [],
      },
    }) as PublicKeyCredential | null;

    if (!credential) return undefined;

    const response = credential.response as AuthenticatorAssertionResponse;
    const sigBytes = new Uint8Array(response.signature);
    const sigB64 = btoa(String.fromCharCode(...sigBytes));
    const authData = new Uint8Array(response.authenticatorData);
    const authDataB64 = btoa(String.fromCharCode(...authData));
    const clientDataJSON = new TextDecoder().decode(response.clientDataJSON);
    const challengeB64 = btoa(String.fromCharCode(...challenge));

    const actor: ActorIdentity = {
      keyId: credential.id,
      publicKeyB64: "", // would need stored key
      algorithm: "ES256",
      provider: "webauthn",
    };

    return {
      actor,
      authorization: {
        format: "webauthn.get",
        purpose: "bitgraph/commit-authorize/v1",
        actorKeyId: credential.id,
        artifactHash: digestB64,
        challenge: challengeB64,
        timestamp: Date.now(),
        signatureB64: sigB64,
        clientDataJSON,
        authenticatorDataB64: authDataB64,
      },
    };
  } catch {
    return undefined; // biometrics declined or unavailable
  }
}

/* ── Main Page ── */

export default function MakerPage() {
  const [mode, setMode] = useState<Mode>("make");

  // Make state
  const [makeStep, setMakeStep] = useState<MakeStep>("drop");
  const [makeFiles, setMakeFiles] = useState<File[]>([]);
  const [makeDigest, setMakeDigest] = useState("");
  const [makeProofs, setMakeProofs] = useState<BitGraphProof[]>([]);
  const [makeError, setMakeError] = useState("");
  const [makeProgress, setMakeProgress] = useState({ current: 0, total: 0, fileName: "" });
  const [copied, setCopied] = useState(false);
  const [useBiometrics, setUseBiometrics] = useState(false);
  const [attribution, setAttribution] = useState("");

  // Verify state
  const [verifyStep, setVerifyStep] = useState<VerifyStep>("drop");
  const [verifyFile, setVerifyFile] = useState<File | null>(null);
  const [verifyProof, setVerifyProof] = useState<BitGraphProof | null>(null);
  const [verifyResult, setVerifyResult] = useState<ProofVerifyResult | null>(null);
  const [fileDigestMatch, setFileDigestMatch] = useState<boolean | null>(null);

  // Public ledger
  const [ledger, setLedger] = useState<ProofEntry[]>([]);
  const [ledgerTotal, setLedgerTotal] = useState(0);
  const [ledgerPage, setLedgerPage] = useState(1);
  const [ledgerViewMode, setLedgerViewMode] = useState<"normal" | "timeonly">("normal");

  // Fetch public ledger
  const fetchLedger = useCallback(async (page: number) => {
    try {
      const resp = await fetch(`/api/proofs?page=${page}&limit=15`);
      if (!resp.ok) return;
      const data = await resp.json();
      const entries: ProofEntry[] = (data.proofs || []).map((p: Record<string, unknown>) => ({
        globalId: (p.id as number) || 0,
        digest: (p.digestB64 as string) || "—",
        counter: (p.counter as string) || undefined,
        enforcement: (p.enforcement as string) === "measured-tee" ? "Hardware Enclave" : "Software",
        time: p.commitTime ? Number(p.commitTime) : undefined,
        attribution: (p.attrName as string) || undefined,
        signer: ((p.signerPub as string) || "").slice(0, 12) || "—",
      }));
      setLedger(entries);
      setLedgerTotal(data.total || 0);
      setLedgerPage(page);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    fetchLedger(1);
    // Auto-refresh ledger every 15 seconds
    const interval = setInterval(() => fetchLedger(1), 15000);
    return () => clearInterval(interval);
  }, [fetchLedger]);

  /* ── Make handlers ── */

  async function handleMakeFiles(files: File[]) {
    setMakeFiles(files);
    setMakeStep("hashing");
    setMakeError("");
    try {
      if (files.length === 1) {
        const f = files[0];
        const d = await hashFile(f);
        setMakeDigest(d);
        setMakeStep("signing");

        let agency: AgencyEnvelope | undefined;
        if (useBiometrics) {
          agency = await createBiometricAuthorization(d);
        }

        const attr = attribution.trim() ? { name: attribution.trim() } : undefined;
        const p = await commitDigest(d, undefined, agency, attr);
        setMakeProofs([p]);
        setMakeStep("done");

        // Refresh ledger after short delay to ensure indexing is complete
        setTimeout(() => fetchLedger(1), 1500);
      } else {
        // Batch mode
        const digests: Array<{ digestB64: string; hashAlg: "sha256" }> = [];
        for (let i = 0; i < files.length; i++) {
          const f = files[i];
          setMakeProgress({ current: i + 1, total: files.length, fileName: f.name });
          const d = await hashFile(f);
          digests.push({ digestB64: d, hashAlg: "sha256" });
        }
        setMakeDigest(digests[0].digestB64);
        setMakeStep("signing");
        setMakeProgress({ current: 0, total: files.length, fileName: "" });

        let agency: AgencyEnvelope | undefined;
        if (useBiometrics) {
          agency = await createBiometricAuthorization(digests[0].digestB64);
        }

        const attr = attribution.trim() ? { name: attribution.trim() } : undefined;
        const proofs = await commitBatch(digests, undefined, agency, attr);
        setMakeProofs(proofs);
        setMakeStep("done");

        // Refresh ledger after short delay to ensure indexing is complete
        setTimeout(() => fetchLedger(1), 1500);
      }
    } catch (err) {
      setMakeError(err instanceof Error ? err.message : "Something went wrong");
      setMakeStep("error");
    }
  }

  function resetMake() {
    setMakeFiles([]);
    setMakeStep("drop");
    setMakeDigest("");
    setMakeProofs([]);
    setMakeError("");
  }

  function copyProof() {
    const json = makeProofs.length === 1
      ? JSON.stringify(makeProofs[0], null, 2)
      : JSON.stringify(makeProofs, null, 2);
    navigator.clipboard.writeText(json);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function downloadZip() {
    if (!makeProofs.length || !makeFiles.length) return;
    const zipFiles: Record<string, Uint8Array> = {};

    for (let i = 0; i < makeFiles.length; i++) {
      const f = makeFiles[i];
      const p = makeProofs[i] || makeProofs[0];
      zipFiles[f.name] = new Uint8Array(await f.arrayBuffer());
      const proofName = makeFiles.length > 1 ? `proof-${i + 1}.json` : "proof.json";
      zipFiles[proofName] = new TextEncoder().encode(JSON.stringify(p, null, 2));
    }
    // Fetch the bounding ETH anchor (highest counter in this batch = future boundary).
    try {
      const last = makeProofs.reduce((a, b) => {
        const ac = parseInt(String(a?.commit?.counter ?? "0"), 10);
        const bc = parseInt(String(b?.commit?.counter ?? "0"), 10);
        return bc > ac ? b : a;
      });
      const lastCounter = last?.commit?.counter ?? "0";
      const lastEpoch = last?.commit?.epochId ?? "";
      if (lastEpoch) {
        const resp = await fetch(`/api/proofs/anchors?counter=${lastCounter}&epoch=${encodeURIComponent(lastEpoch)}&limit=1`);
        if (resp.ok) {
          const data = await resp.json();
          if (Array.isArray(data.anchors) && data.anchors.length > 0) {
            zipFiles["ethereum-anchor.json"] = new TextEncoder().encode(JSON.stringify(data.anchors[0], null, 2));
          }
        }
      }
    } catch (_) { /* non-critical */ }

    const zipped = zipSync(zipFiles);
    const blob = new Blob([zipped.buffer as ArrayBuffer], { type: "application/zip" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = makeFiles.length === 1
      ? `${makeFiles[0].name.replace(/\.[^.]+$/, "")}-bitgraph-proof.zip`
      : "bitgraph-proof-batch.zip";
    a.click();
    URL.revokeObjectURL(url);
  }

  /* ── Verify handlers ── */

  async function handleVerifyFile(f: File) {
    setVerifyFile(f);
    setVerifyStep("checking");
    setFileDigestMatch(null);
    setVerifyResult(null);
    setVerifyProof(null);

    try {
      const text = await f.text();
      const proof = isBitGraphProof(text);

      if (proof) {
        // User dropped a proof.json — verify the signature
        setVerifyProof(proof);
        const result = await verifyProofSignature(proof);
        setVerifyResult(result);
        setVerifyStep("result");
      } else {
        // User dropped a regular file — hash it and check against the ledger
        const d = await hashFile(f);
        const resp = await fetch(`/api/proofs/${encodeURIComponent(toUrlSafeB64(d))}`);
        if (resp.ok) {
          const data = await resp.json();
          if (data.proofs?.length > 0) {
            const p = data.proofs[0].proof as BitGraphProof;
            setVerifyProof(p);
            setFileDigestMatch(true);
            const result = await verifyProofSignature(p);
            setVerifyResult(result);
          } else {
            setFileDigestMatch(false);
          }
        } else {
          setFileDigestMatch(false);
        }
        setVerifyStep("result");
      }
    } catch {
      setVerifyStep("result");
      setFileDigestMatch(false);
    }
  }

  function resetVerify() {
    setVerifyFile(null);
    setVerifyStep("drop");
    setVerifyProof(null);
    setVerifyResult(null);
    setFileDigestMatch(null);
  }

  /* ── Styles ── */

  const cardStyle: React.CSSProperties = {
    border: "1px solid var(--c-border-subtle)",
    padding: "32px 24px",
    background: "var(--bg-elevated)",
    marginBottom: 16,
  };

  const btnOutline: React.CSSProperties = {
    height: 48, fontSize: 15, fontWeight: 500,
    border: "1px solid var(--c-border)", borderRadius: 0,
    background: "transparent", color: "var(--c-text)", cursor: "pointer",
    flex: 1,
  };

  const btnSolid: React.CSSProperties = {
    ...btnOutline,
    border: "none", background: "var(--c-text)", color: "var(--bg)",
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--c-text)" }}>
      <Nav />

      <div style={{ maxWidth: 1120, margin: "0 auto", padding: "60px 36px" }}>
        {/* Header */}
        <h1 style={{ fontSize: 36, fontWeight: 700, letterSpacing: "-0.03em", marginBottom: 8 }}>
          Maker
        </h1>
        <p style={{ fontSize: 16, color: "var(--c-text-secondary)", marginBottom: 32, lineHeight: 1.5 }}>
          Create and verify cryptographic proofs signed inside a hardware enclave.
        </p>

        {/* Mode toggle */}
        <div style={{
          display: "flex", gap: 0, marginBottom: 32,
          border: "1px solid var(--c-border)", borderRadius: 0, overflow: "hidden",
        }}>
          {(["make", "verify"] as Mode[]).map((m) => (
            <button key={m} onClick={() => setMode(m)} style={{
              flex: 1, height: 44, fontSize: 14, fontWeight: 600,
              border: "none", cursor: "pointer",
              background: mode === m ? "var(--c-text)" : "transparent",
              color: mode === m ? "var(--bg)" : "var(--c-text-secondary)",
              textTransform: "capitalize", letterSpacing: "0.02em",
            }}>
              {m === "make" ? "Create proof" : "Verify proof"}
            </button>
          ))}
        </div>

        {/* ═══ MAKE MODE ═══ */}
        {mode === "make" && (
          <>
            {makeStep === "drop" && (
              <>
                <FileDrop
                  multiple
                  onFile={(f) => handleMakeFiles([f])}
                  onFiles={handleMakeFiles}
                  hint="Drop file(s). Hashed locally — nothing uploaded. Supports batch."
                />
                {/* Options below the drop zone */}
                <div style={{
                  display: "flex", alignItems: "center", gap: 20, marginTop: 16,
                  padding: "12px 16px",
                  border: "1px solid var(--c-border-subtle)", background: "var(--bg-elevated)",
                }}>
                  <input
                    type="text"
                    value={attribution}
                    onChange={(e) => setAttribution(e.target.value)}
                    placeholder="Author name (optional)"
                    style={{
                      flex: 1, height: 32, padding: "0 10px",
                      fontSize: 13, border: "1px solid var(--c-border)", borderRadius: 0,
                      background: "transparent", color: "var(--c-text)",
                    }}
                  />
                  <label style={{
                    display: "flex", alignItems: "center", gap: 6,
                    fontSize: 13, color: "var(--c-text-secondary)", cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}>
                    <input
                      type="checkbox"
                      checked={useBiometrics}
                      onChange={(e) => setUseBiometrics(e.target.checked)}
                      style={{ accentColor: "var(--accent)" }}
                    />
                    Biometric authorship
                  </label>
                </div>
              </>
            )}

            {makeStep === "hashing" && (
              <div style={{ ...cardStyle, textAlign: "center", padding: "48px 24px" }}>
                <div style={{ fontSize: 14, color: "var(--c-text-secondary)", marginBottom: 12 }}>
                  Hashing {makeFiles.length > 1 ? `${makeProgress.current} / ${makeProgress.total}` : ""} file{makeFiles.length !== 1 ? "s" : ""}...
                </div>
                {makeFiles.length > 1 && makeProgress.total > 0 && (
                  <>
                    <div style={{
                      width: "100%", height: 4, borderRadius: 2,
                      background: "var(--c-border)", overflow: "hidden", marginBottom: 8,
                    }}>
                      <div style={{
                        width: `${(makeProgress.current / makeProgress.total) * 100}%`,
                        height: "100%", borderRadius: 2,
                        background: "#0065A4", transition: "width 0.2s ease",
                      }} />
                    </div>
                    <div style={{ fontSize: 12, color: "var(--c-text-tertiary)", fontFamily: "monospace" }}>
                      {makeProgress.fileName}
                    </div>
                  </>
                )}
              </div>
            )}

            {makeStep === "signing" && (
              <div style={{ ...cardStyle, textAlign: "center", padding: "48px 24px" }}>
                <div style={{ fontSize: 14, color: "var(--c-text-secondary)", marginBottom: 8 }}>
                  Signing {makeFiles.length > 1 ? `${makeFiles.length} files` : ""} in hardware enclave...
                </div>
                <div style={{ fontSize: 12, color: "var(--c-text-tertiary)", fontFamily: "monospace" }}>
                  {makeDigest.slice(0, 32)}...
                </div>
              </div>
            )}

            {makeStep === "error" && (
              <div style={{ ...cardStyle, textAlign: "center", borderColor: "#ff453a" }}>
                <div style={{ fontSize: 14, color: "#ff453a", marginBottom: 16 }}>{makeError}</div>
                <button onClick={resetMake} style={btnOutline}>Try again</button>
              </div>
            )}

            {makeStep === "done" && makeProofs.length > 0 && (
              <div>
                <div style={cardStyle}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                    <span style={{ color: "#30d158", fontSize: 20 }}>●</span>
                    <span style={{ fontSize: 16, fontWeight: 600 }}>
                      {makeProofs.length === 1 ? "Proof created" : `${makeProofs.length} proofs created`}
                    </span>
                  </div>
                  {makeFiles.map((f, i) => (
                    <div key={f.name + i} style={{ marginBottom: i < makeFiles.length - 1 ? 12 : 0 }}>
                      <div style={{ fontSize: 13, color: "var(--c-text-secondary)", marginBottom: 2 }}>
                        {f.name} · {formatFileSize(f.size)}
                      </div>
                      <div style={{
                        fontSize: 12, fontFamily: "monospace", color: "#30d158",
                        wordBreak: "break-all", lineHeight: 1.5,
                      }}>
                        {makeProofs[i]?.artifact.digestB64}
                      </div>
                    </div>
                  ))}
                  <div style={{ display: "flex", gap: 12, fontSize: 12, color: "var(--c-text-tertiary)", marginTop: 16 }}>
                    <span>Counter #{makeProofs[0].commit.counter}</span>
                    <span>·</span>
                    <span>{makeProofs[0].environment?.enforcement === "measured-tee" ? "Hardware Enclave" : "Software"}</span>
                    <span>·</span>
                    <span>{makeProofs[0].commit.time ? new Date(makeProofs[0].commit.time).toLocaleString(undefined, { timeZoneName: "short" }) : ""}</span>
                  </div>
                </div>

                {/* Proof JSON */}
                <div style={cardStyle}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "var(--c-text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      Proof JSON
                    </span>
                    <button onClick={copyProof} style={{
                      fontSize: 12, fontWeight: 500, padding: "4px 12px",
                      border: "1px solid var(--c-border)", borderRadius: 0,
                      background: "transparent", color: copied ? "#30d158" : "var(--c-text-secondary)", cursor: "pointer",
                    }}>
                      {copied ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <pre style={{
                    fontSize: 11, fontFamily: "monospace", lineHeight: 1.5,
                    color: "#30d158", background: "#0a0a0a",
                    padding: 16, borderRadius: 0, overflow: "auto", maxHeight: 400,
                  }}>
                    {makeProofs.length === 1
                      ? JSON.stringify(makeProofs[0], null, 2)
                      : JSON.stringify(makeProofs, null, 2)}
                  </pre>
                </div>

                <div style={{ display: "flex", gap: 12 }}>
                  <button onClick={downloadZip} style={btnSolid}>Download .zip</button>
                  <button onClick={resetMake} style={btnOutline}>Create another</button>
                </div>
              </div>
            )}
          </>
        )}

        {/* ═══ VERIFY MODE ═══ */}
        {mode === "verify" && (
          <>
            {verifyStep === "drop" && (
              <FileDrop
                onFile={handleVerifyFile}
                hint="Drop a proof.json to verify its signature, or drop any file to check if it has a proof on the ledger."
              />
            )}

            {verifyStep === "checking" && (
              <div style={{ ...cardStyle, textAlign: "center", padding: "48px 24px" }}>
                <div style={{ fontSize: 14, color: "var(--c-text-secondary)" }}>
                  Checking {verifyFile?.name}...
                </div>
              </div>
            )}

            {verifyStep === "result" && (
              <div>
                {/* Signature verification */}
                {verifyResult && (
                  <div style={cardStyle}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                      <span style={{ color: verifyResult.valid ? "#30d158" : "#ff453a", fontSize: 20 }}>●</span>
                      <span style={{ fontSize: 16, fontWeight: 600 }}>
                        {verifyResult.valid ? "Signature valid" : "Signature invalid"}
                      </span>
                    </div>
                    {verifyResult.checks.map((c, i) => (
                      <div key={i} style={{
                        display: "flex", alignItems: "baseline", gap: 8,
                        fontSize: 13, marginBottom: 6, color: "var(--c-text-secondary)",
                      }}>
                        <span style={{
                          color: c.status === "pass" ? "#30d158" : c.status === "fail" ? "#ff453a" : "var(--c-text-tertiary)",
                          fontFamily: "monospace", fontSize: 12,
                        }}>
                          {c.status === "pass" ? "✓" : c.status === "fail" ? "✗" : "—"}
                        </span>
                        <span>{c.label}</span>
                        {c.detail && <span style={{ color: "var(--c-text-tertiary)", fontSize: 12 }}>{c.detail}</span>}
                      </div>
                    ))}
                  </div>
                )}

                {/* File digest match */}
                {fileDigestMatch !== null && !verifyProof && (
                  <div style={cardStyle}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ color: fileDigestMatch ? "#30d158" : "#ff6b35", fontSize: 20 }}>●</span>
                      <span style={{ fontSize: 16, fontWeight: 600 }}>
                        {fileDigestMatch ? "File found on ledger" : "No proof found for this file"}
                      </span>
                    </div>
                  </div>
                )}

                {/* Show the proof if found */}
                {verifyProof && (
                  <div style={cardStyle}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--c-text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 12 }}>
                      Proof details
                    </div>
                    <div style={{ fontSize: 12, fontFamily: "monospace", color: "#30d158", wordBreak: "break-all", lineHeight: 1.5, marginBottom: 8 }}>
                      {verifyProof.artifact.digestB64}
                    </div>
                    <div style={{ display: "flex", gap: 12, fontSize: 12, color: "var(--c-text-tertiary)", flexWrap: "wrap" }}>
                      {verifyProof.commit.counter && <span>Counter #{verifyProof.commit.counter}</span>}
                      <span>{verifyProof.environment?.enforcement === "measured-tee" ? "Hardware Enclave" : "Software"}</span>
                      {verifyProof.commit.time && <span>{new Date(verifyProof.commit.time).toLocaleString(undefined, { timeZoneName: "short" })}</span>}
                      {verifyProof.attribution?.name && <span>By: {verifyProof.attribution.name}</span>}
                    </div>
                  </div>
                )}

                <button onClick={resetVerify} style={{ ...btnOutline, width: "100%" }}>
                  Verify another
                </button>
              </div>
            )}
          </>
        )}

        {/* ═══ PUBLIC PROOF LEDGER ═══ */}
        <div style={{ marginTop: 64 }}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            marginBottom: 16,
          }}>
            <h2 style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em" }}>
              Public proof ledger
            </h2>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 13, color: "var(--c-text-tertiary)" }}>
                {ledgerTotal.toLocaleString()} total proofs
              </span>
              <div style={{
                display: "flex", gap: 2, background: "var(--c-bg-secondary, #141416)", borderRadius: 0,
                padding: 2, border: "1px solid var(--c-border-subtle)",
              }}>
                {(["normal", "timeonly"] as const).map(m => (
                  <button key={m} onClick={() => setLedgerViewMode(m)} style={{
                    fontSize: 12, fontWeight: 500, padding: "5px 12px", borderRadius: 0,
                    border: "none", cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s",
                    background: ledgerViewMode === m ? "var(--bg-elevated, #1c1c1e)" : "transparent",
                    color: ledgerViewMode === m ? "var(--c-text)" : "var(--c-text-tertiary)",
                  }}>
                    {m === "normal" ? "Normal" : "Time Only"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {ledger.length === 0 ? (
            <div style={{ ...cardStyle, textAlign: "center", color: "var(--c-text-tertiary)", fontSize: 14 }}>
              No proofs yet
            </div>
          ) : (
            <>
              <div style={{
                border: "1px solid var(--c-border-subtle)",
                borderRadius: 0,
                background: "var(--bg-elevated)",
                overflow: "hidden",
              }}>
                {/* Table header */}
                <div style={{
                  display: ledgerViewMode === "timeonly" ? "grid" : "grid",
                  gridTemplateColumns: ledgerViewMode === "timeonly" ? "80px 1fr" : "60px 100px 1fr 120px 100px 120px",
                  padding: "12px 20px",
                  background: "rgba(255,255,255,0.02)",
                  borderBottom: "1px solid var(--c-border-subtle)",
                  fontSize: 12, fontWeight: 600, color: "var(--c-text-tertiary)",
                  textTransform: "uppercase" as const, letterSpacing: "0.04em",
                }}>
                  {ledgerViewMode === "timeonly" ? (
                    <>
                      <span>#</span>
                      <span>Time</span>
                    </>
                  ) : (
                    <>
                      <span>#</span>
                      <span>Type</span>
                      <span>Digest</span>
                      <span>Epoch</span>
                      <span>Age</span>
                      <span>Signer</span>
                    </>
                  )}
                </div>
                {ledger.map((entry, i) => (
                  <LedgerRow key={entry.digest + i} entry={entry} isLast={i === ledger.length - 1} viewMode={ledgerViewMode} />
                ))}
              </div>

              {/* Pagination */}
              {ledgerTotal > 15 && (
                <div style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: 16 }}>
                  <button
                    onClick={() => fetchLedger(ledgerPage - 1)}
                    disabled={ledgerPage <= 1}
                    style={{
                      ...btnOutline, flex: "none", width: 80, height: 36, fontSize: 13,
                      opacity: ledgerPage <= 1 ? 0.3 : 1,
                    }}
                  >
                    Prev
                  </button>
                  <span style={{ fontSize: 13, color: "var(--c-text-tertiary)", lineHeight: "36px" }}>
                    Page {ledgerPage} of {Math.ceil(ledgerTotal / 15)}
                  </span>
                  <button
                    onClick={() => fetchLedger(ledgerPage + 1)}
                    disabled={ledgerPage >= Math.ceil(ledgerTotal / 15)}
                    style={{
                      ...btnOutline, flex: "none", width: 80, height: 36, fontSize: 13,
                      opacity: ledgerPage >= Math.ceil(ledgerTotal / 15) ? 0.3 : 1,
                    }}
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Ledger Row — expandable, fetches full proof on first click
   ═══════════════════════════════════════════════════════════════════════════ */

function LedgerRow({ entry, isLast, viewMode }: { entry: ProofEntry; isLast: boolean; viewMode: "normal" | "timeonly" }) {
  const [expanded, setExpanded] = useState(false);
  const [proof, setProof] = useState<BitGraphProof | null>(null);
  const [loading, setLoading] = useState(false);
  const [copiedDigest, setCopiedDigest] = useState(false);

  async function toggle() {
    if (viewMode === "timeonly") return;
    if (!expanded && !proof && entry.digest !== "—") {
      setLoading(true);
      try {
        const resp = await fetch(`/api/proofs/${encodeURIComponent(toUrlSafeB64(entry.digest))}`);
        if (resp.ok) {
          const data = await resp.json();
          if (data.proofs?.[0]?.proof) setProof(data.proofs[0].proof as BitGraphProof);
        }
      } catch { /* silent */ }
      setLoading(false);
    }
    setExpanded(e => !e);
  }

  const commit = proof?.commit;
  const signer = proof?.signer;
  const env = proof?.environment;
  const proofAny = proof as unknown as Record<string, unknown> | undefined;
  const policy = proofAny?.policy as Record<string, unknown> | undefined;
  const principal = proofAny?.principal as Record<string, unknown> | undefined;
  const timestamps = proof?.timestamps as Record<string, unknown> | undefined;
  const slotAllocation = proofAny?.slotAllocation as Record<string, unknown> | undefined;
  const attribution = proof?.attribution;

  const counter = entry.counter || String(entry.globalId);
  const trunc = (s: string, n: number) => s.length > n ? s.slice(0, n) + "..." : s;
  const toolName = entry.attribution || "proof";
  const epochId = commit?.epochId ? String(commit.epochId) : "";
  const signerPub = entry.signer || "";

  // Shared cell styles
  const cellStyle: React.CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
  const monoFont = "var(--font-mono), 'SF Mono', SFMono-Regular, monospace";

  if (viewMode === "timeonly") {
    return (
      <div style={{
        display: "grid", gridTemplateColumns: "80px 1fr",
        padding: "14px 20px", alignItems: "center",
        borderBottom: isLast ? "none" : "1px solid var(--c-border-subtle)",
        fontSize: 14,
      }}>
        <span style={{ ...cellStyle, fontWeight: 600, color: "var(--accent, #0A84FF)", fontFamily: monoFont }}>{counter}</span>
        <span style={{ ...cellStyle, fontFamily: monoFont, color: "var(--c-text-secondary)" }}>
          {entry.time ? new Date(entry.time).toLocaleString(undefined, { timeZoneName: "short" }) : "—"}
        </span>
      </div>
    );
  }

  return (
    <div style={{ borderBottom: isLast ? "none" : "1px solid var(--c-border-subtle)" }}>
      {/* Table row */}
      <div onClick={toggle} style={{
        display: "grid", gridTemplateColumns: "60px 100px 1fr 120px 100px 120px",
        padding: "14px 20px", alignItems: "center",
        fontSize: 14, transition: "background 0.1s", cursor: "pointer",
      }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.02)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
      >
        <span style={{ ...cellStyle, fontWeight: 600, color: "var(--accent, #0A84FF)", fontFamily: monoFont }}>{counter}</span>
        <span style={cellStyle}>
          <span style={{
            display: "inline-block", fontSize: 11, fontWeight: 500, padding: "3px 8px",
            borderRadius: 0, border: "1px solid var(--c-border-subtle)",
            background: "rgba(255,255,255,0.02)", color: "var(--c-text-secondary)",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 90,
          }} title={toolName}>{trunc(toolName, 12)}</span>
        </span>
        <span style={{
          ...cellStyle, fontFamily: monoFont, fontSize: 13, color: "var(--c-text-secondary)",
          display: "flex", alignItems: "center", gap: 6,
        }} onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(entry.digest); setCopiedDigest(true); setTimeout(() => setCopiedDigest(false), 1500); }}>
          {trunc(entry.digest, 20)}
          <button style={{
            opacity: 0, transition: "opacity 0.15s", background: "none", border: "none",
            color: "var(--c-text-tertiary)", cursor: "pointer", padding: 2,
            display: "flex", alignItems: "center",
          }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = "0"; }}
          >
            {copiedDigest ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0065A4" strokeWidth="2"><path d="M20 6L9 17l-5-5"/></svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
            )}
          </button>
        </span>
        <span style={{ ...cellStyle, color: "var(--c-text-secondary)", fontSize: 13 }} title={epochId}>{trunc(epochId, 12)}</span>
        <span style={{ ...cellStyle, color: "var(--c-text-secondary)", fontSize: 13 }} title={entry.time ? new Date(entry.time).toLocaleString(undefined, { timeZoneName: "short" }) : ""}>
          {entry.time ? relativeTime(entry.time) : "—"}
        </span>
        <span style={{ ...cellStyle, fontFamily: monoFont, fontSize: 12, color: "var(--c-text-tertiary)" }} title={signerPub}>{trunc(signerPub, 12)}</span>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div style={{
          padding: 20, background: "rgba(255,255,255,0.015)",
          borderTop: "1px solid var(--c-border-subtle)",
        }}>
          {loading && (
            <div style={{ fontSize: 13, color: "var(--c-text-tertiary)", padding: "8px 0" }}>Loading proof...</div>
          )}

          {proof && (
            <>
              {/* Ethereum anchor link */}
              {(proof.commit && (proof.commit as Record<string, unknown>).chainId === "bitgraph:ethereum-anchors") || (proof.attribution?.name?.startsWith("Ethereum #")) ? (
                <div style={{
                  padding: "10px 16px", marginBottom: 16, borderRadius: 0,
                  border: "1px solid rgba(59,130,246,0.2)", background: "rgba(59,130,246,0.05)",
                  display: "flex", alignItems: "center", gap: 12, fontSize: 13, flexWrap: "wrap",
                }}>
                  <span style={{ color: "var(--c-text-secondary)" }}>
                    {proof.attribution?.name || "Ethereum anchor"}
                  </span>
                  {proof.attribution?.title ? (
                    <a href={proof.attribution.title} target="_blank" rel="noopener"
                      style={{ color: "#3b82f6", textDecoration: "none", fontWeight: 500 }}>
                      View on Etherscan →
                    </a>
                  ) : null}
                </div>
              ) : null}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                {/* Artifact */}
                <LedgerDetailSection title="Artifact">
                  <LedgerDetailField label="Digest" value={proof.artifact?.digestB64 || "—"} mono />
                  {proof.version && <LedgerDetailField label="Version" value={proof.version} />}
                </LedgerDetailSection>

                {/* Commit */}
                {commit && (
                  <LedgerDetailSection title="Commit">
                    {commit.time != null && <LedgerDetailField label="Time" value={new Date(commit.time).toLocaleString(undefined, { timeZoneName: "short" })} />}
                    <LedgerDetailField label="Counter" value={`#${counter}`} />
                    {commit.epochId && <LedgerDetailField label="Epoch" value={commit.epochId} mono />}
                    {commit.prevB64 && <LedgerDetailField label="Prev Hash" value={commit.prevB64} mono />}
                    {commit.nonceB64 && <LedgerDetailField label="Nonce" value={commit.nonceB64} mono />}
                    {commit.slotCounter != null && <LedgerDetailField label="Slot #" value={String(commit.slotCounter)} />}
                    {commit.slotHashB64 && <LedgerDetailField label="Slot Hash" value={commit.slotHashB64} mono />}
                  </LedgerDetailSection>
                )}

                {/* Signer */}
                {signer && (
                  <LedgerDetailSection title="Signer">
                    <LedgerDetailField label="Public Key" value={signer.publicKeyB64} mono />
                    <LedgerDetailField label="Signature" value={signer.signatureB64} mono />
                  </LedgerDetailSection>
                )}

                {/* Environment */}
                {env && (
                  <LedgerDetailSection title="Environment">
                    <LedgerDetailField label="Enforcement" value={env.enforcement === "measured-tee" ? "Hardware Enclave" : env.enforcement === "hw-key" ? "Hardware Key" : "Software"} />
                    {env.measurement && <LedgerDetailField label="PCR0" value={env.measurement} mono />}
                  </LedgerDetailSection>
                )}

                {/* Principal */}
                {principal && (
                  <LedgerDetailSection title="Principal">
                    {(principal as Record<string, unknown>).provider ? <LedgerDetailField label="Provider" value={String((principal as Record<string, unknown>).provider)} /> : null}
                    {(principal as Record<string, unknown>).id ? <LedgerDetailField label="ID" value={String((principal as Record<string, unknown>).id)} mono /> : null}
                  </LedgerDetailSection>
                )}

                {/* Policy */}
                {policy && (
                  <LedgerDetailSection title="Policy">
                    {policy.name ? <LedgerDetailField label="Name" value={String(policy.name)} /> : null}
                    {policy.digestB64 ? <LedgerDetailField label="Digest" value={String(policy.digestB64)} mono /> : null}
                  </LedgerDetailSection>
                )}

                {/* Timestamps */}
                {timestamps && (
                  <LedgerDetailSection title="Timestamp">
                    {(timestamps as Record<string, unknown>).artifact ? (
                      <>
                        {((timestamps as Record<string, unknown>).artifact as Record<string, unknown>)?.authority
                          && <LedgerDetailField label="Authority" value={String(((timestamps as Record<string, unknown>).artifact as Record<string, unknown>).authority)} />}
                        {((timestamps as Record<string, unknown>).artifact as Record<string, unknown>)?.time
                          && <LedgerDetailField label="Time" value={String(((timestamps as Record<string, unknown>).artifact as Record<string, unknown>).time)} />}
                      </>
                    ) : null}
                  </LedgerDetailSection>
                )}

                {/* Attribution */}
                {attribution && (
                  <LedgerDetailSection title="Attribution">
                    {attribution.name && <LedgerDetailField label="Name" value={attribution.name} />}
                  </LedgerDetailSection>
                )}

                {/* Slot Allocation */}
                {slotAllocation && (
                  <LedgerDetailSection title="Causal Slot">
                    {(slotAllocation as any).counter != null && <LedgerDetailField label="Slot #" value={String((slotAllocation as any).counter)} />}
                    {(slotAllocation as any).time && <LedgerDetailField label="Time" value={new Date((slotAllocation as any).time).toLocaleString()} />}
                  </LedgerDetailSection>
                )}
              </div>

              {/* JSON + Export */}
              <div style={{ marginTop: 16, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <LedgerCopyableJson data={proof} />
                <button onClick={() => {
                  const json = JSON.stringify(proof, null, 2);
                  const blob = new Blob([json], { type: "application/json" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `bitgraph-proof-${(proof.artifact?.digestB64 || "unknown").slice(0, 12)}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                }} style={{
                  fontSize: 12, fontWeight: 500, padding: "6px 14px", borderRadius: 0,
                  border: "1px solid var(--c-border)", background: "transparent",
                  color: "var(--c-text-secondary)", cursor: "pointer",
                }}>
                  Export .json
                </button>
              </div>
            </>
          )}

          {!loading && !proof && (
            <div style={{ fontSize: 13, color: "var(--c-text-tertiary)" }}>Full proof not available for this entry.</div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Detail section for ledger expanded view ── */
function LedgerDetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      border: "1px solid var(--c-border-subtle)", borderRadius: 0,
      overflow: "hidden",
    }}>
      <div style={{
        fontSize: 12, fontWeight: 600,
        color: "var(--c-text-tertiary)", padding: "8px 14px",
        background: "rgba(255,255,255,0.02)",
        borderBottom: "1px solid var(--c-border-subtle)",
      }}>
        {title}
      </div>
      {children}
    </div>
  );
}

/* ── Detail field for ledger expanded view ── */
function LedgerDetailField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "baseline",
      padding: "8px 14px", borderBottom: "1px solid var(--c-border-subtle)",
      fontSize: 13,
    }}>
      <span style={{ color: "var(--c-text-tertiary)", fontSize: 12 }}>{label}</span>
      <span style={{
        color: mono ? "#0065A4" : "var(--c-text)",
        fontFamily: mono ? "var(--font-mono), 'SF Mono', SFMono-Regular, monospace" : "inherit",
        fontSize: mono ? 12 : 13,
        textAlign: "right" as const, maxWidth: "60%",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        cursor: "pointer",
      }} title={value} onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
        {copied ? "Copied!" : value.length > 32 ? value.slice(0, 24) + "..." : value}
      </span>
    </div>
  );
}

/* ── Copyable full JSON ── */
function LedgerCopyableJson({ data }: { data: unknown }) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  const json = JSON.stringify(data, null, 2);
  const sizeKb = (new TextEncoder().encode(json).length / 1024).toFixed(1);

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: open ? 8 : 0 }}>
        <button onClick={() => setOpen(!open)} style={{
          fontSize: 12, fontWeight: 500, padding: "6px 14px", borderRadius: 0,
          border: "1px solid var(--c-border)", background: "transparent",
          color: "var(--c-text-secondary)", cursor: "pointer",
        }}>
          {open ? "Hide JSON" : "Show JSON"} ({sizeKb} KB)
        </button>
        {open && (
          <button onClick={() => { navigator.clipboard.writeText(json); setCopied(true); setTimeout(() => setCopied(false), 1500); }} style={{
            fontSize: 12, fontWeight: 500, padding: "6px 14px", borderRadius: 0,
            border: "1px solid var(--c-border)", background: "transparent",
            color: copied ? "#30d158" : "var(--c-text-secondary)", cursor: "pointer",
          }}>
            {copied ? "Copied!" : "Copy JSON"}
          </button>
        )}
      </div>
      {open && (
        <div style={{ position: "relative" }}>
          <pre
            onClick={() => { navigator.clipboard.writeText(json); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
            style={{
              fontSize: 11, fontFamily: "var(--font-mono), monospace", lineHeight: 1.5,
              color: "#30d158", background: "#0a0a0a",
              padding: 16, borderRadius: 0, overflow: "auto", maxHeight: 400,
              cursor: "pointer", transition: "box-shadow 0.2s",
            }}
          >
            {json}
          </pre>
          {copied && (
            <span style={{
              position: "absolute", top: 8, right: 12,
              fontSize: 11, fontWeight: 600, color: "#30d158",
              background: "#0a0a0a", padding: "2px 8px", borderRadius: 0,
            }}>
              Copied
            </span>
          )}
        </div>
      )}
    </div>
  );
}
