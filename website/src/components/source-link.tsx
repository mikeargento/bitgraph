"use client";

// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

import { useCallback, useEffect, useState } from "react";
import { relativeTime } from "@/lib/explorer";

/**
 * A hosted original on a proof page (2026-10-29): where the holder keeps the exact file, so anyone who finds the record
 * can fetch the bytes and run the proof. Three pieces, all over app/api/sources:
 *   SourceField   under the picture, one row of buttons: Download original (only when the page shows the original;
 *                 the bytes come through our hash and are hashed again here before they are saved), Link original
 *                 while no link exists (anyone may offer one, since the server admits a link only after it fetches the
 *                 file and finds it hashes to the bound digest), Change the link for a holder of the exact bytes. The
 *                 host is credited in a quiet line under the row.
 *   SourceHint    on a Check row for a copy: "original available".
 * A link dragged in with the file (an image from a page, a public bucket address) fills the field by itself.
 */

type Pos = { digest: string; epoch: string; counter: string };
export type Source = { host: string; name: string | null; bytes: number; verifiedAt: number };
const EV = "bitgraph-source";
const q = (p: Pos) => `digest=${encodeURIComponent(p.digest)}&epoch=${encodeURIComponent(p.epoch)}&counter=${encodeURIComponent(p.counter)}`;
const mb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(n >= 10 * 1024 * 1024 ? 0 : 1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const toSafe = (b64: string) => b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64 = (u: Uint8Array) => { let s = ""; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]!); return btoa(s); };

// the address a drop carried with it (an image dragged from a page), taken once by the field
let dropUrl: string | null = null;
export function noteDropUrl(dt: DataTransfer) {
  const line = (dt.getData("text/uri-list") || dt.getData("text/plain") || "").split(/\r?\n/).find((l) => l && !l.startsWith("#")) ?? "";
  dropUrl = /^https?:\/\/\S+$/.test(line) ? line : null;
}

function useSource(pos: Pos) {
  const [source, setSource] = useState<Source | null | undefined>(undefined);
  const [note, setNote] = useState<string | null>(null);
  const { digest, epoch, counter } = pos;
  const load = useCallback(() => {
    fetch(`/api/sources?${q({ digest, epoch, counter })}`)
      .then((r) => (r.ok ? r.json() : null)).catch(() => null)
      .then((body: { source?: Source | null; note?: string } | null) => { setSource(body?.source ?? null); setNote(body?.note ?? null); });
  }, [digest, epoch, counter]);
  useEffect(() => { load(); window.addEventListener(EV, load); return () => window.removeEventListener(EV, load); }, [load]);
  return { source, note };
}

/** Under the picture, in the Original state only: the download button, and the host credited in a quiet line. */
function useDownload(pos: Pos, source: Source | null | undefined) {
  const [dl, setDl] = useState<{ state: "idle" } | { state: "fetching"; got: number } | { state: "hashing" } | { state: "ok" } | { state: "bad"; why: string }>({ state: "idle" });
  const download = async () => {
    if (!source) return;
    setDl({ state: "fetching", got: 0 });
    try {
      const r = await fetch(`/api/sources/download?${q(pos)}`);
      if (!r.ok || !r.body) throw new Error((await r.json().catch(() => null))?.error ?? "the download could not start");
      const reader = r.body.getReader(), parts: Uint8Array[] = [];
      let got = 0;
      for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); got += value.byteLength; setDl({ state: "fetching", got }); }
      setDl({ state: "hashing" });
      const blob = new Blob(parts as BlobPart[]);
      const d = b64(new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())));
      if (toSafe(d) !== toSafe(pos.digest)) throw new Error("the host served different bytes; nothing was saved");
      const url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url; a.download = source.name ?? "original"; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setDl({ state: "ok" });
    } catch (e) { setDl({ state: "bad", why: (e as Error).message }); }
  };
  const label = !source ? "" : dl.state === "fetching" ? `Fetching… ${mb(dl.got)} of ${mb(source.bytes)}` : dl.state === "hashing" ? "Checking…" : `Download original (${mb(source.bytes)})`;
  return { dl, download, label, busy: dl.state === "fetching" || dl.state === "hashing" };
}

export type Among = Pos[];
/** `file` is the holder's file when the page has matched one to the bound digest; without it, the field only offers to
 *  add a first link. `among`: the other BitGraphs of the same picture (a copy matched several); a link whose bytes are
 *  one of theirs lands there, and `onLanded` is told where. `bare`: the form alone, opened by its parent. */
export function SourceField({ pos, file, among, onLanded, bare, original }: { pos: Pos; file?: { name: string; data: ArrayBuffer }; among?: Among; onLanded?: (at: Pos) => void; bare?: boolean; original?: boolean }) {
  const { source } = useSource(pos);
  const { dl, download, label: dlLabel, busy } = useDownload(pos, source);
  const [hashedFile, setHashedFile] = useState<{ file: object; holds: boolean } | null>(null);
  const holds = !!file && hashedFile?.file === file && hashedFile.holds;
  const [url, setUrl] = useState("");
  const [open, setOpen] = useState(!!bare);
  const [state, setState] = useState<{ kind: "idle" } | { kind: "checking" } | { kind: "ok"; host: string } | { kind: "bad"; why: string }>({ kind: "idle" });
  const submit = useCallback(async (u: string) => {
    if (!u.trim()) return;
    setState({ kind: "checking" });
    const r = await fetch("/api/sources", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...pos, url: u.trim(), ...(file ? { name: file.name } : {}), ...(among?.length ? { among } : {}) }) }).catch(() => null);
    const body = (await r?.json().catch(() => null)) as { ok?: boolean; source?: Source; at?: Pos; error?: string } | null;
    if (r?.ok && body?.source) {
      setState({ kind: "ok", host: body.source.host });
      if (body.at && body.at.digest !== pos.digest) { onLanded?.(body.at); return; }
      if (!bare) setOpen(false);
      window.dispatchEvent(new Event(EV));
    }
    else setState({ kind: "bad", why: body?.error ?? "the link could not be checked just now" });
  }, [pos, file, among, onLanded, bare]);
  // a holder of the exact bytes may change an existing link; a link that came with their drop is tried at once
  useEffect(() => {
    if (!file) return;
    let gone = false;
    crypto.subtle.digest("SHA-256", file.data).then((h) => {
      if (gone) return;
      const ok = toSafe(b64(new Uint8Array(h))) === toSafe(pos.digest);
      setHashedFile({ file, holds: ok });
      const u = dropUrl; dropUrl = null;
      if (ok && u) { setUrl(u); setOpen(true); void submit(u); }
    }).catch(() => {});
    return () => { gone = true; };
  }, [file, pos.digest, submit]);
  if (!bare && source === undefined) return null;
  // the row: Download original only when the original is what the page shows; Link original until a link exists;
  // Change the link for the holder of the exact bytes
  const canDownload = !!original && !!source;
  const canLink = !source || holds;
  if (!bare && !canDownload && !canLink) return null;
  return (
    <div className={bare ? "pv-source-field is-bare" : "pv-source-field"}>
      {!open && (canDownload || canLink) && (
        <div className="pv-photo-actions" style={{ marginTop: 0 }}>
          {canDownload && <button type="button" className="bg-action-link" style={{ margin: 0 }} onClick={() => void download()} disabled={busy}>{dlLabel}</button>}
          {canLink && <button type="button" className="bg-action-link" style={{ margin: 0 }} onClick={() => setOpen(true)}>{source ? "Change the link" : "Link original"}</button>}
        </div>
      )}
      {open && (
        <form onSubmit={(e) => { e.preventDefault(); void submit(url); }}>
          <label className="pv-source-label" htmlFor="src-url">Where is the original file?</label>
          <div className="pv-source-row">
            <input id="src-url" type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…  (Drive, Dropbox, OneDrive, GitHub, S3 or any web address)" autoComplete="off" spellCheck={false} />
            <button type="submit" className="bg-action-link" style={{ margin: 0, flex: "none" }} disabled={state.kind === "checking" || !url.trim()}>{state.kind === "checking" ? "Checking…" : "Check and add"}</button>
            {!bare && <button type="button" className="bg-action-link" style={{ margin: 0, flex: "none" }} onClick={() => setOpen(false)}>Cancel</button>}
          </div>
          <p className="pv-source-fine">Paste a link to the exact file, shared as &ldquo;anyone with the link&rdquo;. We download it and check that it is the very same file before the link is shown; any other file is refused.</p>
        </form>
      )}
      {canDownload && source && <p className="pv-source-credit">Hosted at {source.host} · checked {relativeTime(source.verifiedAt)}</p>}
      {dl.state === "bad" && <p className="pv-source-bad">Download stopped: {dl.why}.</p>}
      {state.kind === "ok" && <p className="pv-source-ok">{"✓"} Checked: the original is at {state.host}.</p>}
      {state.kind === "bad" && <p className="pv-source-bad">{state.why}</p>}
    </div>
  );
}

/** On a Check row for a copy: whether the original it looks like can be fetched. */
export function SourceHint(pos: Pos) {
  const { source } = useSource(pos);
  return source ? <span className="db-size"> · original online</span> : null;
}
