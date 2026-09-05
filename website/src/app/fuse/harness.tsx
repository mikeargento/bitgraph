"use client";

import { useState } from "react";

type Placement = "trailer/1" | "container/1" | "container/2";

interface HarnessResult {
  copy: string[][];
  category: string;
  placement: Placement;
  slotCounter: string | null;
  commitCounter: string | null;
  epochId: string | null;
  artifactDigestB64: string;
  originDigestB64: string | null;
  recovered: boolean;
  frameName: string;
  frame: unknown;
  fusedName: string;
  fusedBase64: string | null;
}

const mono = "ui-monospace, SFMono-Regular, Menlo, monospace";

export default function Harness() {
  const [file, setFile] = useState<File | null>(null);
  const [placement, setPlacement] = useState<Placement>("trailer/1");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<HarnessResult | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("placement", placement);
      const r = await fetch("/api/fuse/harness", { method: "POST", headers: token ? { "x-fuse-harness-token": token } : {}, body: fd });
      const j = (await r.json().catch(() => ({}))) as Partial<HarnessResult> & { error?: string };
      if (!r.ok) {
        setError(j.error ?? `The harness answered ${r.status}.`);
      } else {
        setResult(j as HarnessResult);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const frameHref = result ? `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(result.frame, null, 2))}` : null;
  const fusedHref = result?.fusedBase64 ? `data:application/octet-stream;base64,${result.fusedBase64}` : null;

  return (
    <main style={{ maxWidth: 800, margin: "0 auto", padding: "40px 20px", color: "#111827", fontSize: 16, lineHeight: 1.5 }}>
      <h1 style={{ fontSize: 32, fontWeight: 900, margin: "0 0 8px" }}>Harness</h1>
      <p style={{ margin: "0 0 24px", color: "#374151" }}>
        Internal. One file in; a copy of it that carries a commitment to a slot allocated before the copy existed; the ordinary
        proof of that copy. The file you drop is never modified.
      </p>

      <form onSubmit={run} style={{ display: "grid", gap: 16, marginBottom: 32 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <span>File</span>
          <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <label style={{ display: "grid", gap: 6 }}>
          <span>Placement</span>
          <select value={placement} onChange={(e) => setPlacement(e.target.value as Placement)} style={{ padding: 8, borderRadius: 0, border: "1px solid #d0d5dd", background: "#fff", maxWidth: 320 }}>
            <option value="trailer/1">trailer/1 (Form A: in-file trailer; formats that tolerate trailing bytes)</option>
            <option value="container/1">container/1 (Form B: fixed-layout archive; the file stays byte-exact inside)</option>
            <option value="container/2">container/2 (Form B: the same archive with the original first; the default)</option>
          </select>
        </label>
        <label style={{ display: "grid", gap: 6 }}>
          <span>Harness token</span>
          <input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" style={{ padding: 8, borderRadius: 0, border: "1px solid #d0d5dd", maxWidth: 320 }} />
        </label>
        <div>
          <button type="submit" disabled={!file || busy} style={{ padding: "10px 16px", borderRadius: 0, border: "1px solid #0065A4", background: "#fff", color: "#0065A4", fontWeight: 600, cursor: busy ? "wait" : "pointer" }}>
            {busy ? "Allocating, fusing, committing" : "Run"}
          </button>
        </div>
      </form>

      {error && (
        <p style={{ border: "1px solid #d0d5dd", background: "#fff", padding: 16, margin: "0 0 24px" }}>{error}</p>
      )}

      {result && (
        <section style={{ border: "1px solid #d0d5dd", background: "#fff", padding: 16, display: "grid", gap: 16 }}>
          {result.copy.map(([head, body], i) => (
            <div key={i}>
              <div style={{ fontWeight: 700 }}>{head}</div>
              <div style={{ color: "#374151" }}>{body}</div>
            </div>
          ))}
          <dl style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "6px 16px", margin: 0, fontSize: 14 }}>
            <dt style={{ color: "#6b7280" }}>Verification</dt><dd style={{ margin: 0, fontFamily: mono }}>{result.category}</dd>
            <dt style={{ color: "#6b7280" }}>Placement</dt><dd style={{ margin: 0, fontFamily: mono }}>{result.placement}</dd>
            <dt style={{ color: "#6b7280" }}>Slot</dt><dd style={{ margin: 0, fontFamily: mono }}>{result.slotCounter ?? "?"}</dd>
            <dt style={{ color: "#6b7280" }}>Commit</dt><dd style={{ margin: 0, fontFamily: mono }}>{result.commitCounter ?? "?"}</dd>
            <dt style={{ color: "#6b7280" }}>Epoch</dt><dd style={{ margin: 0, fontFamily: mono, wordBreak: "break-all" }}>{result.epochId ?? "?"}</dd>
            <dt style={{ color: "#6b7280" }}>Fused digest</dt><dd style={{ margin: 0, fontFamily: mono, wordBreak: "break-all" }}>{result.artifactDigestB64}</dd>
            <dt style={{ color: "#6b7280" }}>Origin digest</dt><dd style={{ margin: 0, fontFamily: mono, wordBreak: "break-all" }}>{result.originDigestB64 ?? "none"}</dd>
            {result.recovered && (<><dt style={{ color: "#6b7280" }}>Note</dt><dd style={{ margin: 0 }}>The commit response was lost; the proof was read back by digest and matched on the held slot.</dd></>)}
          </dl>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", fontSize: 14 }}>
            {frameHref && <a href={frameHref} download={result.frameName} style={{ color: "#0065A4" }}>Frame: {result.frameName}</a>}
            {fusedHref && <a href={fusedHref} download={result.fusedName} style={{ color: "#0065A4" }}>Fused bytes: {result.fusedName}</a>}
          </div>
        </section>
      )}
    </main>
  );
}
