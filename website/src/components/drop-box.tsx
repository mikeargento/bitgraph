"use client";

// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * The drop box (Mike, 2026-10-17: "wheres the dropbox? there should be a
 * checker and a maker right?"). Drop files; each is hashed HERE, in the
 * browser, and only its SHA-256 ever leaves the machine.
 *
 *   Checker: every file is looked up by its hash. A file that is already a
 *   BitGraph gets its proof verified in this browser against the file's own
 *   bytes, and a link to its proof page.
 *   Maker: files that are not yet BitGraphs can be made into BitGraphs with one
 *   click: one atomic action in the enclave each (a fresh nonce, then the
 *   file's digest). Making one is permanent, so it is never automatic.
 *   Each result shows the enclave's own signed time.
 *
 * A lookup that fails is "could not check", never "not a BitGraph"
 * (project_ledger_read_honesty).
 */

import { useCallback, useRef, useState } from "react";
import { verify, createVerificationContext } from "@mikeargento/bitgraph-verify";
import { recordedMsOf } from "@/lib/recorded-time";

const MAX_FILES = 25;

type Proof = Record<string, unknown> & { commit?: { counter?: string; atomic?: boolean }; artifact?: { digestB64?: string } };

type Row = {
  key: string;
  name: string;
  size: number;
  digestB64?: string;
  bytes?: Uint8Array;
  state: "hashing" | "looking" | "found" | "new" | "making" | "made" | "error";
  proof?: Proof;
  valid?: boolean;
  note?: string;
};

const toUrlSafe = (b64: string) => b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function b64(bytes: Uint8Array): string {
  let s = "";
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s);
}
function teeTime(proof: Proof): string | null {
  const ms = recordedMsOf(proof);
  if (ms === null) return null;
  const d = new Date(ms);
  return `${d.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" })}, ${d.toLocaleTimeString("en-US", { timeZone: "UTC", hour: "numeric", minute: "2-digit", second: "2-digit" })} UTC`;
}
const sizeLabel = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

async function check(proof: Proof, bytes: Uint8Array): Promise<boolean> {
  const { proofHash: _h, ...p } = proof as Proof & { proofHash?: unknown };
  try {
    const r = await verify({ proof: p as never, bytes, context: createVerificationContext() });
    return r.valid === true;
  } catch {
    return false;
  }
}

export function DropBox() {
  const [rows, setRows] = useState<Row[]>([]);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const patch = (key: string, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));

  const take = useCallback(async (files: File[]) => {
    const picked = files.slice(0, MAX_FILES);
    const fresh: Row[] = picked.map((f, i) => ({ key: `${Date.now()}-${i}-${f.name}`, name: f.name, size: f.size, state: "hashing" }));
    setRows(fresh);
    await Promise.all(picked.map(async (f, i) => {
      const key = fresh[i]!.key;
      try {
        const bytes = new Uint8Array(await f.arrayBuffer());
        const digestB64 = b64(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
        patch(key, { bytes, digestB64, state: "looking" });
        const res = await fetch(`/api/proofs/${toUrlSafe(digestB64)}`);
        if (!res.ok) { patch(key, { state: "error", note: "Could not check the ledger just now. Try again in a moment." }); return; }
        const body = (await res.json()) as { proofs?: Array<{ proof: Proof }> };
        const first = body.proofs?.[0]?.proof;
        if (!first) { patch(key, { state: "new" }); return; }
        patch(key, { state: "found", proof: first, valid: await check(first, bytes) });
      } catch {
        patch(key, { state: "error", note: "This browser could not read or check that file." });
      }
    }));
  }, []);

  const make = async () => {
    const todo = rows.filter((r) => r.state === "new" && r.digestB64);
    if (todo.length === 0) return;
    setBusy(true);
    for (const r of todo) patch(r.key, { state: "making" });
    try {
      const res = await fetch("/api/commit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ digests: todo.map((r) => ({ digestB64: r.digestB64, hashAlg: "sha256" })), chainId: "bitgraph:main" }),
      });
      if (!res.ok) {
        const note = res.status === 503 ? "The enclave is restarting (it does once a day). Try again in a minute." : "The BitGraph could not be made just now. Nothing was recorded.";
        for (const r of todo) patch(r.key, { state: "new", note });
        return;
      }
      const raw = (await res.json()) as Proof[] | { proofs?: Proof[] };
      const proofs = Array.isArray(raw) ? raw : raw.proofs ?? [];
      for (const r of todo) {
        const p = proofs.find((x) => x.artifact?.digestB64 === r.digestB64);
        if (!p || !r.bytes) { patch(r.key, { state: "error", note: "No proof came back for this file. Look it up on the ledger before trying again." }); continue; }
        patch(r.key, { state: "made", proof: p, valid: await check(p, r.bytes) });
      }
    } catch {
      for (const r of todo) patch(r.key, { state: "error", note: "The request did not finish. Look the file up on the ledger before trying again: it may already be recorded." });
    } finally {
      setBusy(false);
    }
  };

  const download = (r: Row) => {
    if (!r.proof) return;
    const blob = new Blob([JSON.stringify(r.proof, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${r.name}.bitgraph.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const newCount = rows.filter((r) => r.state === "new").length;

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-label="Drop files to check or make BitGraphs, or press to choose files"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inputRef.current?.click(); } }}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); void take(Array.from(e.dataTransfer.files)); }}
        className="db-zone"
        data-over={over ? "1" : undefined}
      >
        <div className="db-zone-title">Drop files here, or choose them</div>
        <div className="db-zone-sub">Each file is hashed in your browser. Only its SHA-256 is sent; the file never leaves your machine.</div>
        <input ref={inputRef} type="file" multiple style={{ display: "none" }} onChange={(e) => { void take(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
      </div>

      {rows.length > 0 && (
        <div className="db-rows">
          {rows.map((r) => (
            <div key={r.key} className="db-row">
              <div className="db-name">
                <span>{r.name}</span>
                <span className="db-size">{sizeLabel(r.size)}</span>
              </div>
              <div className="db-state">
                {r.state === "hashing" && "Hashing…"}
                {r.state === "looking" && "Checking the ledger…"}
                {r.state === "new" && (r.note ?? "Not a BitGraph yet")}
                {r.state === "making" && "Binding…"}
                {r.state === "error" && r.note}
                {(r.state === "found" || r.state === "made") && r.proof && (
                  <>
                    <span className={r.valid ? "db-ok" : "db-bad"}>
                      {r.state === "made" ? "Made" : "A BitGraph"}
                      {r.valid ? ", checked in this browser" : ", but the proof did not check against this file"}
                    </span>
                    {teeTime(r.proof) && <span className="db-size">{teeTime(r.proof)}, enclave time</span>}
                    <a href={`/proof/${toUrlSafe(r.digestB64 ?? "")}`}>Proof</a>
                    <button type="button" className="db-link" onClick={() => download(r)}>Download proof</button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {newCount > 0 && (
        <div className="db-make">
          <button type="button" className="bg-action-link" style={{ margin: 0 }} disabled={busy} onClick={() => void make()}>
            {busy ? "Making…" : `Make ${newCount === 1 ? "a BitGraph" : `${newCount} BitGraphs`}`}
          </button>
          <span className="db-make-note">Making a BitGraph is permanent.</span>
        </div>
      )}
    </div>
  );
}
