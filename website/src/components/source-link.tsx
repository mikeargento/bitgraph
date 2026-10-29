"use client";

// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

import { useCallback, useEffect, useState } from "react";
import { relativeTime } from "@/lib/explorer";

/**
 * A hosted original on a proof page (2026-10-29): where the holder keeps the exact file, so anyone who finds the record
 * can fetch the bytes and run the proof. Three pieces, all over app/api/sources:
 *   SourceLine    in the strip, for everyone: the host to credit, when the bytes were last seen to match, and a
 *                 download that comes through our hash and is hashed again here before it is saved.
 *   SourceField   under the file pane, only for someone holding the original (the page has matched their file): paste
 *                 or drop a link, and the server fetches it and admits it only if it hashes to the bound digest.
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

export function SourceLine(pos: Pos) {
  const { source } = useSource(pos);
  const [dl, setDl] = useState<{ state: "idle" } | { state: "fetching"; got: number } | { state: "hashing" } | { state: "ok" } | { state: "bad"; why: string }>({ state: "idle" });
  if (!source) return null;
  const download = async () => {
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
  return (
    <div className="pv-source">
      <span>Original available · hosted at {source.host} · verified {relativeTime(source.verifiedAt)}</span>
      <button type="button" className="pv-source-dl" onClick={() => void download()} disabled={dl.state === "fetching" || dl.state === "hashing"}>
        {dl.state === "fetching" ? `Fetching… ${mb(dl.got)} of ${mb(source.bytes)}` : dl.state === "hashing" ? "Checking…" : `Download original (${mb(source.bytes)})`}
      </button>
      {dl.state === "bad" && <span className="pv-source-bad">Download stopped: {dl.why}.</span>}
    </div>
  );
}

/** For the holder: the page has matched their file to the bound digest, and `file` is that file. */
export function SourceField({ pos, file }: { pos: Pos; file: { name: string; data: ArrayBuffer } }) {
  const { source } = useSource(pos);
  const [holds, setHolds] = useState(false);
  const [url, setUrl] = useState("");
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<{ kind: "idle" } | { kind: "checking" } | { kind: "ok"; host: string } | { kind: "bad"; why: string }>({ kind: "idle" });
  const submit = useCallback(async (u: string) => {
    if (!u.trim()) return;
    setState({ kind: "checking" });
    const r = await fetch("/api/sources", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...pos, url: u.trim(), name: file.name }) }).catch(() => null);
    const body = (await r?.json().catch(() => null)) as { ok?: boolean; source?: Source; error?: string } | null;
    if (r?.ok && body?.source) { setState({ kind: "ok", host: body.source.host }); setOpen(false); window.dispatchEvent(new Event(EV)); }
    else setState({ kind: "bad", why: body?.error ?? "the link could not be checked just now" });
  }, [pos, file.name]);
  // only the holder of the exact bytes is asked where they are hosted; a link that came with the drop is tried at once
  useEffect(() => {
    let gone = false;
    crypto.subtle.digest("SHA-256", file.data).then((h) => {
      if (gone) return;
      const ok = toSafe(b64(new Uint8Array(h))) === toSafe(pos.digest);
      setHolds(ok);
      const u = dropUrl; dropUrl = null;
      if (ok && u) { setUrl(u); setOpen(true); void submit(u); }
    }).catch(() => {});
    return () => { gone = true; };
  }, [file, pos.digest, submit]);
  if (!holds) return null;
  return (
    <div className="pv-source-field">
      {!open ? (
        <button type="button" className="pv-source-add" onClick={() => setOpen(true)}>{source ? "Change where this original is hosted" : "Is this original hosted somewhere? Add the link"}</button>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); void submit(url); }}>
          <label className="pv-source-label" htmlFor="src-url">Where is this original hosted?</label>
          <div className="pv-source-row">
            <input id="src-url" type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…  (Drive, Dropbox, OneDrive, GitHub, S3 or any web address)" autoComplete="off" spellCheck={false} />
            <button type="submit" className="bg-action-link" style={{ margin: 0, flex: "none" }} disabled={state.kind === "checking" || !url.trim()}>{state.kind === "checking" ? "Checking…" : "Check and add"}</button>
          </div>
          <p className="pv-source-fine">Paste a link to the exact file, shared as &ldquo;anyone with the link&rdquo;. We fetch it and check that its bytes are this original&rsquo;s before anything is shown; a link to anything else is refused. Downloads come from your host.</p>
        </form>
      )}
      {state.kind === "ok" && <p className="pv-source-ok">{"✓"} Verified: this original is hosted at {state.host}.</p>}
      {state.kind === "bad" && <p className="pv-source-bad">{state.why}</p>}
    </div>
  );
}

/** On a Check row for a copy: whether the original it looks like can be fetched. */
export function SourceHint(pos: Pos) {
  const { source } = useSource(pos);
  return source ? <span className="db-size"> · original available</span> : null;
}
