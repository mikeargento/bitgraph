"use client";

// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * A photo's BitGraphed file, shown the way it is made: a watermarked file between two BitGraphs (lib/trustmark/sandwich).
 *
 *   BitGraph A    the original, as it was dropped on Make.
 *   the mark      a pointer made from A's nonce, written into the pixels in this browser (Pixel Seal).
 *   BitGraph B    the marked file, bound after A.
 *
 * Made only with the original in hand: straight after Make (?fresh=1), or when the reader opens the original here.
 * Making it records BitGraph B, so a visit by anyone else never makes one on its own. Without the original the page
 * still shows A and the pointer its nonce makes, remade in the reader's browser from A's public proof.
 */

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { takeFreshProof } from "@/lib/fresh-proof";
import { makePhotoBitGraph } from "@/lib/trustmark/make-photo";
import { takePendingPhoto } from "@/lib/trustmark/pending-photo";
import { useTimeZoneMode } from "@/lib/format-time";
import { recordedMsOf } from "@/lib/recorded-time";
import { checkMember, memberOf } from "@/lib/tree-member";
import type { Proof } from "@/lib/plugins";
import { NoTrustmark, trustmarkedFile, type TrustmarkedFile } from "@/lib/trustmark/export";
import { readings } from "@/lib/trustmark/marks";
import { partsOf, pointerFrom, publishedPointer } from "@/lib/trustmark/sandwich";
import { decodePhoto, parseRecord, recordBytes } from "@/lib/trustmark/record";

const toUrlSafe = (s: string) => s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromUrlSafe = (s: string) => { let d = decodeURIComponent(s).replace(/-/g, "+").replace(/_/g, "/"); while (d.length % 4) d += "="; return d; };
const b64 = (u: Uint8Array) => { let s = ""; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]!); return btoa(s); };
const fmt = (n: unknown) => Number(n).toLocaleString("en-US");
const proofHref = (digestB64: string, p: Proof) => `/proof/${toUrlSafe(digestB64)}?counter=${encodeURIComponent(String(p.commit?.counter ?? ""))}&epoch=${encodeURIComponent(toUrlSafe(String(p.commit?.epochId ?? "")))}`;
const nonceOf = (p: Proof) => String((p.commit as { nonceB64?: string } | undefined)?.nonceB64 ?? "");

type InHand = { name: string; data: ArrayBuffer };
type Stage = "idle" | "making" | "done" | "cannot" | "error";
type Remade = "checking" | "match" | "mismatch" | "unavailable";

/** The photo's member proofs on the ledger, the one named by ?counter&epoch first. */
async function originalOf(digestB64: string, counter: string | null, epoch: string | null): Promise<Proof | null> {
  const res = await fetch(`/api/proofs/${toUrlSafe(digestB64)}`, { cache: "no-store" }).catch(() => null);
  const body = res?.ok ? ((await res.json().catch(() => null)) as { proofs?: Array<{ proof: Proof; kind?: string }> } | null) : null;
  // a file of a tree first (every drop since trees); a BitGraph of the file alone, made before them, still shows as A
  const recorded = (body?.proofs ?? []).filter((x) => x.kind === "recorded").map((x) => x.proof);
  const all = [...recorded.filter((p) => memberOf(p) && checkMember(p, digestB64)), ...recorded.filter((p) => !memberOf(p) && p.artifact?.digestB64 === digestB64)];
  return all.find((p) => String(p.commit?.counter) === counter && (!epoch || toUrlSafe(String(p.commit?.epochId)) === epoch)) ?? all[0] ?? null;
}

/** The original's bytes, as Make left them in this browser (lib/file-cache), when they hash to this photo. */
async function cachedOriginal(digestB64: string): Promise<InHand | null> {
  try {
    const db = await new Promise<IDBDatabase>((ok, fail) => {
      const req = indexedDB.open("bitgraph-files", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("files");
      req.onsuccess = () => ok(req.result);
      req.onerror = () => fail(req.error);
    });
    const rec = await new Promise<InHand | undefined>((ok) => {
      const req = db.transaction("files", "readonly").objectStore("files").get(digestB64);
      req.onsuccess = () => ok(req.result as InHand | undefined);
      req.onerror = () => ok(undefined);
    });
    db.close();
    if (!rec?.data) return null;
    return b64(new Uint8Array(await crypto.subtle.digest("SHA-256", rec.data))) === digestB64 ? rec : null;
  } catch { return null; }
}

const clock = (ms: number | null) => (ms === null ? "" : new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" }));
const day = (ms: number | null) => (ms === null ? "" : new Date(ms).toLocaleString());
const codeOf = (payload: string) => partsOf(payload).tag.toString(16).padStart(7, "0");

/** The photo, and once marked, the BitGraphed file over it: drag across to compare; zoom to look closely. */
function Picture({ before, after, working }: { before: string | null; after: string | null; working: boolean }) {
  const [at, setAt] = useState(50);
  const [zoom, setZoom] = useState(false);
  if (!before && !after) return null;
  return (
    <div className={`bgf-pic${zoom ? " is-zoom" : ""}${working ? " is-working" : ""}`}>
      <div className="bgf-pic-frame">
        <img src={before ?? after!} alt="The original photo" draggable={false} />
        {after && before && <img className="bgf-pic-after" src={after} alt="The BitGraphed file" draggable={false} style={{ clipPath: `inset(0 0 0 ${at}%)` }} />}
        {after && before && <div className="bgf-pic-handle" style={{ left: `${at}%` }} aria-hidden="true" />}
        {after && before && (
          <input className="bgf-pic-range" type="range" min={0} max={100} value={at} onChange={(e) => setAt(Number(e.target.value))} aria-label="Compare the original with the BitGraphed file" />
        )}
        {working && <div className="bgf-pic-scan" aria-hidden="true" />}
      </div>
      {after && before && (
        <div className="bgf-pic-bar">
          <span>Original</span>
          <button type="button" onClick={() => setZoom((z) => !z)}>{zoom ? "Fit" : "Zoom 3×"}</button>
          <span>BitGraphed</span>
        </div>
      )}
    </div>
  );
}

type NodeState = "done" | "active" | "waiting";
function Node({ state, kind, title, value, sub, href }: { state: NodeState; kind: "end" | "mark"; title: string; value: string; sub?: string; href?: string }) {
  const inner = (
    <>
      <span className={`bgf-dot is-${kind}`} style={{ borderRadius: "50%" }} aria-hidden="true"><span>{kind === "end" ? title.slice(-1) : "◆"}</span></span>
      <span className="sr-only">{title}</span>
      <span className="bgf-node-value">{value || "—"}</span>
      {sub && <span className="bgf-node-sub">{sub}</span>}
    </>
  );
  return href ? <a className={`bgf-node is-${state}`} href={href}>{inner}</a> : <div className={`bgf-node is-${state}`}>{inner}</div>;
}

export function BitGraphedView() {
  useTimeZoneMode();
  const params = useParams();
  const digestParam = String(params.digest ?? "");
  const digestB64 = fromUrlSafe(digestParam);
  const [query] = useState(() => (typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search)));
  const fresh = query.get("fresh") === "1";
  const copyScore = query.get("copy");

  const [original, setOriginal] = useState<Proof | null>(null);
  const [lookup, setLookup] = useState<"loading" | "found" | "missing">("loading");
  const [file, setFile] = useState<InHand | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [step, setStep] = useState("");
  const [why, setWhy] = useState("");
  const [made, setMade] = useState<TrustmarkedFile | null>(null);
  const [remade, setRemade] = useState<Remade | null>(null);
  const [readBack, setReadBack] = useState<boolean | null>(null);
  const [published, setPublished] = useState<string | null | undefined>(undefined);
  const [pickNote, setPickNote] = useState("");
  const [over, setOver] = useState(false);

  // A photo dropped on Make arrives in hand, with no BitGraph yet: this page makes A, the watermark and B in one run.
  const [pending] = useState(() => (query.get("make") === "1" ? takePendingPhoto(digestParam) : null));

  // A, from the proof Make handed over, else from the ledger
  useEffect(() => {
    let live = true;
    if (pending) { setLookup("found"); return; }
    const seed = takeFreshProof<{ proofs?: Array<{ proof: Proof }> }>(digestParam)?.proofs?.[0]?.proof ?? null;
    if (seed) { setOriginal(seed); setLookup("found"); }
    else void originalOf(digestB64, query.get("counter"), query.get("epoch")).then((p) => { if (live) { setOriginal(p); setLookup(p ? "found" : "missing"); } });
    return () => { live = false; };
  }, [digestParam, digestB64, query, pending]);

  // the original, when Make left it in this browser (the write can land a moment after the page opens)
  useEffect(() => {
    if (pending) { void pending.arrayBuffer().then((data) => setFile({ name: pending.name, data })); return; }
    let live = true;
    void (async () => {
      for (let i = 0; i < 10 && live; i++) {
        const f = await cachedOriginal(digestB64);
        if (f) { if (live) setFile(f); return; }
        await new Promise((r) => setTimeout(r, 500));
      }
    })();
    return () => { live = false; };
  }, [digestB64, pending]);

  // without the original, the pointer its BitGraphed files carry, remade from A's proof and the published record
  useEffect(() => {
    if (!original || made) return;
    let live = true;
    void publishedPointer(digestB64, original).then((p) => { if (live) setPublished(p); }).catch(() => { if (live) setPublished(null); });
    return () => { live = false; };
  }, [original, digestB64, made]);

  const beforeUrl = useMemo(() => (file ? URL.createObjectURL(new Blob([file.data])) : null), [file]);
  const afterUrl = useMemo(() => (made ? URL.createObjectURL(new Blob([made.marked as BlobPart], { type: "image/jpeg" })) : null), [made]);
  useEffect(() => () => { if (beforeUrl) URL.revokeObjectURL(beforeUrl); }, [beforeUrl]);
  useEffect(() => () => { if (afterUrl) URL.revokeObjectURL(afterUrl); }, [afterUrl]);

  async function make() {
    if ((!original && !pending) || !file || stage === "making") return;
    setStage("making"); setStep("Checking the photo…"); setWhy("");
    try {
      let a = original;
      if (!a) {
        const made = await makePhotoBitGraph(new File([file.data], file.name), (s) => setStep(s));
        a = made.proof; setOriginal(a);
      }
      const t = await trustmarkedFile(new File([file.data], file.name), digestB64, a, (s) => setStep(s), { copyChecked: !!pending });
      setMade(t); setStage("done");
      void confirm(t);
    } catch (e) {
      if (e instanceof NoTrustmark) { setWhy(e.message); setStage("cannot"); }
      else { setWhy(e instanceof Error ? e.message : String(e)); setStage("error"); }
    }
  }

  // Each check from scratch, as a reader would: A's proof read again from the ledger, the pointer remade from its nonce
  // and the photo's own fingerprint, and the pointer read out of the BitGraphed file's pixels.
  async function confirm(t: TrustmarkedFile) {
    setRemade("checking"); setReadBack(null);
    const [orig, marked] = await Promise.all([decodePhoto(new Blob([file!.data])), decodePhoto(new Blob([t.marked as BlobPart], { type: "image/jpeg" }))]);
    try {
      const a = await originalOf(digestB64, String(t.original.commit?.counter), toUrlSafe(String(t.original.commit?.epochId)));
      const rec = orig ? parseRecord(recordBytes(digestB64, orig)) : null;
      const again = a && rec ? await pointerFrom(a, rec.phash) : null;
      setRemade(again === null ? "unavailable" : again === t.payload ? "match" : "mismatch");
    } catch { setRemade("unavailable"); }
    if (marked) {
      let found = false;
      for await (const r of readings(marked.rgba, marked.w, marked.h, { legacy: false })) if (r.payload === t.payload) { found = true; break; }
      setReadBack(found);
    }
  }

  // straight from Make, the file is made at once
  useEffect(() => { if (((fresh && original) || pending) && file && stage === "idle") void make(); });

  function download() {
    if (!made) return;
    const url = URL.createObjectURL(new Blob([made.bytes as BlobPart], { type: "image/jpeg" }));
    const el = document.createElement("a"); el.href = url; el.download = made.fileName; el.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function pick(f: File | undefined) {
    if (!f) return;
    const data = await f.arrayBuffer();
    if (b64(new Uint8Array(await crypto.subtle.digest("SHA-256", data))) !== digestB64) { setPickNote("Not the photo A recorded."); return; }
    setPickNote(""); setFile({ name: f.name, data });
  }

  const a = made?.original ?? original;
  const aTime = a ? recordedMsOf(a) : null, bTime = made ? recordedMsOf(made.copyProof) : null;
  const payload = made?.payload ?? published ?? null;
  const makingA = stage === "making" && !a;
  const marking = stage === "making" && !!a && !step.startsWith("Recording") && !step.startsWith("Waiting");
  const recording = stage === "making" && !marking;
  const nodes: [NodeState, NodeState, NodeState] = [
    a ? "done" : makingA || lookup === "loading" ? "active" : "waiting",
    made || (stage !== "making" && payload) ? "done" : marking ? "active" : "waiting",
    made ? "done" : recording ? "active" : "waiting",
  ];
  const gap = aTime !== null && bTime !== null ? Math.max(0, Math.round((bTime - aTime) / 1000)) : null;
  const checks = made && [
    { ok: remade === "match", wait: remade === "checking" || remade === null, label: "Remade from A’s nonce" },
    { ok: readBack === true, wait: readBack === null, label: "Read from the pixels" },
  ];

  if (lookup === "missing") {
    return <section className="home-section bgf"><p className="home-kicker">BitGraphed file</p><h2>No BitGraph of this photo yet.</h2></section>;
  }

  return (
    <section className="home-section bgf" aria-label="BitGraphed file">
      <div className="bgf-head">
        <p className="home-kicker">BitGraphed file</p>
        {copyScore && <span className="bgf-pill">Copy checked &middot; match {Number(copyScore).toFixed(2)}</span>}
      </div>

      {beforeUrl ? (
        <Picture before={beforeUrl} after={afterUrl} working={marking} />
      ) : (
        <label
          className={`bgf-drop${over ? " is-over" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); void pick(e.dataTransfer.files?.[0]); }}
        >
          <input type="file" accept="image/*" onChange={(e) => void pick(e.target.files?.[0])} />
          <span className="bgf-drop-title">Drop the original photo</span>
          <span className="bgf-drop-sub">{pickNote || "to make its BitGraphed file · nothing is uploaded"}</span>
        </label>
      )}

      <div className="bgf-rail" role="list" aria-label="BitGraph A, the watermark, BitGraph B">
        <Node state={nodes[0]} kind="end" title="BitGraph A" value={a ? `#${fmt(a.commit?.counter)}` : makingA ? "recording…" : ""} sub={clock(aTime)} href={a ? proofHref(digestB64, a) : undefined} />
        <span className={`bgf-link${nodes[1] !== "waiting" ? " is-lit" : ""}`} aria-hidden="true" />
        <Node state={nodes[1]} kind="mark" title="Watermark" value={payload ? codeOf(payload) : marking ? "writing…" : ""} sub={payload ? "A’s nonce" : undefined} />
        <span className={`bgf-link${nodes[2] !== "waiting" ? " is-lit" : ""}`} aria-hidden="true" />
        <Node state={nodes[2]} kind="end" title="BitGraph B" value={made ? `#${fmt(made.copyProof.commit?.counter)}` : recording ? "recording…" : ""} sub={clock(bTime)} href={made ? proofHref(made.markedDigestB64, made.copyProof) : undefined} />
      </div>
      <p className="bgf-caption" title={aTime !== null ? `A ${day(aTime)}${bTime !== null ? ` · B ${day(bTime)}` : ""}` : undefined}>
        {gap !== null ? <>Born between A and B &middot; {gap} s</> : <>Can&rsquo;t exist before A &middot; bound at B</>}
      </p>

      {checks && (
        <div className="bgf-checks">
          {checks.map((c) => <span key={c.label} className={`bgf-check${c.ok ? " is-ok" : c.wait ? "" : " is-bad"}`}>{c.ok ? "✓" : c.wait ? "…" : "✕"} {c.label}</span>)}
        </div>
      )}

      {made && (
        <div className="bgf-actions">
          <button type="button" className="bg-action-link is-make" style={{ margin: 0 }} onClick={download}>Download BitGraphed file</button>
          {(!made.ceiling || !made.published) && <span className="bgf-note">{!made.published ? "Pointer not registered yet; try again in a moment." : "Ceiling still landing; download again shortly."}</span>}
        </div>
      )}
      {!made && file && (stage === "idle" || stage === "error") && (
        <div className="bgf-actions"><button type="button" className="bg-action-link is-make" style={{ margin: 0 }} disabled={!original} onClick={() => void make()}>Make BitGraphed file</button></div>
      )}
      {stage === "cannot" && <p className="bgf-note">Can&rsquo;t carry a pointer: {why}.</p>}
      {stage === "error" && <p className="db-bad">{why}</p>}
    </section>
  );
}
