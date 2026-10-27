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

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { SandwichFigure } from "@/components/primitive-figures";
import { takeFreshProof } from "@/lib/fresh-proof";
import { TimeChip, useTimeZoneMode } from "@/lib/format-time";
import { recordedMsOf } from "@/lib/recorded-time";
import { checkMember, memberOf } from "@/lib/tree-member";
import type { Proof } from "@/lib/plugins";
import { NoTrustmark, trustmarkedFile, type TrustmarkedFile } from "@/lib/trustmark/export";
import { cropRGBA, readings } from "@/lib/trustmark/marks";
import { partsOf, pointerFrom, publishedPointer } from "@/lib/trustmark/sandwich";
import { decodePhoto, parseRecord, recordBytes, type Decoded } from "@/lib/trustmark/record";

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

/** The same square of both pictures at full size: the original beside the BitGraphed file, to see the mark is not seen. */
function Zoom({ original, marked }: { original: Decoded; marked: Decoded }) {
  const a = useRef<HTMLCanvasElement>(null), b = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const s = Math.min(360, original.w, original.h, marked.w, marked.h);
    const x = Math.floor((original.w - s) / 2), y = Math.floor((original.h - s) / 2);
    for (const [ref, img] of [[a, original], [b, marked]] as const) {
      const c = ref.current;
      if (!c) continue;
      c.width = s; c.height = s;
      c.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(cropRGBA(img.rgba, img.w, x, y, s, s)), s, s), 0, 0);
    }
  }, [original, marked]);
  return (
    <div className="bgf-zoom">
      <figure><canvas ref={a} /><figcaption>The original</figcaption></figure>
      <figure><canvas ref={b} /><figcaption>The BitGraphed file</figcaption></figure>
    </div>
  );
}

function Pointer({ payload }: { payload: string }) {
  const p = partsOf(payload);
  return (
    <dl className="bgf-pointer">
      <div><dt>Points to</dt><dd>BitGraph #{fmt(p.counter)}</dd></div>
      <div><dt>Code from A&rsquo;s nonce</dt><dd><code>{p.tag.toString(16).padStart(7, "0")}</code></dd></div>
    </dl>
  );
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
  const [pictures, setPictures] = useState<{ original: Decoded; marked: Decoded } | null>(null);
  const [published, setPublished] = useState<string | null | undefined>(undefined);
  const [pickNote, setPickNote] = useState("");

  // A, from the proof Make handed over, else from the ledger
  useEffect(() => {
    let live = true;
    const seed = takeFreshProof<{ proofs?: Array<{ proof: Proof }> }>(digestParam)?.proofs?.[0]?.proof ?? null;
    if (seed) { setOriginal(seed); setLookup("found"); }
    else void originalOf(digestB64, query.get("counter"), query.get("epoch")).then((p) => { if (live) { setOriginal(p); setLookup(p ? "found" : "missing"); } });
    return () => { live = false; };
  }, [digestParam, digestB64, query]);

  // the original, when Make left it in this browser (the write can land a moment after the page opens)
  useEffect(() => {
    let live = true;
    void (async () => {
      for (let i = 0; i < 10 && live; i++) {
        const f = await cachedOriginal(digestB64);
        if (f) { if (live) setFile(f); return; }
        await new Promise((r) => setTimeout(r, 500));
      }
    })();
    return () => { live = false; };
  }, [digestB64]);

  // without the original, the pointer its BitGraphed files carry, remade from A's proof and the published record
  useEffect(() => {
    if (!original || made) return;
    let live = true;
    void publishedPointer(digestB64, original).then((p) => { if (live) setPublished(p); }).catch(() => { if (live) setPublished(null); });
    return () => { live = false; };
  }, [original, digestB64, made]);

  async function make() {
    if (!original || !file || stage === "making") return;
    setStage("making"); setStep("Checking the photo…"); setWhy("");
    try {
      const t = await trustmarkedFile(new File([file.data], file.name), digestB64, original, (s) => setStep(s));
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
    if (orig && marked) setPictures({ original: orig, marked });
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
  useEffect(() => { if (fresh && original && file && stage === "idle") void make(); });

  function download() {
    if (!made) return;
    const url = URL.createObjectURL(new Blob([made.bytes as BlobPart], { type: "image/jpeg" }));
    const el = document.createElement("a"); el.href = url; el.download = made.fileName; el.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function pick(f: File | undefined) {
    if (!f) return;
    const data = await f.arrayBuffer();
    if (b64(new Uint8Array(await crypto.subtle.digest("SHA-256", data))) !== digestB64) { setPickNote("That is not the photo BitGraph A recorded: its bytes differ."); return; }
    setPickNote(""); setFile({ name: f.name, data });
  }

  const a = made?.original ?? original;
  const aTime = a ? recordedMsOf(a) : null, bTime = made ? recordedMsOf(made.copyProof) : null;
  const progress = !a ? 0 : stage === "done" ? 4 : stage !== "making" ? (made ? 4 : 1) : step.startsWith("Adding") ? 2 : step.startsWith("Recording") || step.startsWith("Waiting") ? 3 : 1;
  const payload = made?.payload ?? published ?? null;

  if (lookup === "missing") {
    return (
      <section className="home-section">
        <p className="home-kicker">BitGraphed file</p>
        <h2>No BitGraph of this photo was found.</h2>
        <p style={{ marginTop: 16 }}>Its BitGraph may still be landing. Reload in a moment, or check the photo on <a href="/make">Make</a>.</p>
      </section>
    );
  }

  return (
    <>
      <section className="home-section" aria-labelledby="bgf-h">
        <p className="home-kicker">BitGraphed file</p>
        <h2 id="bgf-h">A watermarked photo between two&nbsp;BitGraphs.</h2>
        <p style={{ marginTop: 24 }}>
          BitGraph A records the photo as it is. A&rsquo;s nonce, unseen until A was bound, makes a pointer that is written
          invisibly into the pixels. BitGraph B records the watermarked file. The file could not exist before&nbsp;A, and
          it existed by&nbsp;B. A screenshot or a feed&rsquo;s copy keeps the pointer, and the pointer leads back to&nbsp;A.
        </p>
        {copyScore && (
          <p className="bgf-note" style={{ marginTop: 16 }}>
            You checked a copy of this photo. It carries this pointer and looks like the photo recorded in A (match {Number(copyScore).toFixed(2)}).
            That doesn&rsquo;t prove the copy is unedited: only the original&rsquo;s exact bytes prove that.
          </p>
        )}
      </section>

      <section className="home-section bgf-steps" aria-label="How this file was made">
        <div className="bgf-step">
          <p className="bgf-label">BitGraph A &middot; the original</p>
          {a ? (
            <>
              <p className="bgf-big">#{fmt(a.commit?.counter)}{aTime !== null && <> &middot; <TimeChip date={new Date(aTime)} withDate /></>}</p>
              <p>The photo, exactly as it was, bound with its fingerprint. Its nonce:</p>
              <pre className="jev-code bgf-nonce">{nonceOf(a)}</pre>
            </>
          ) : <p>Reading A from the ledger…</p>}
        </div>

        <div className="bgf-step">
          <p className="bgf-label">The watermark &middot; made from A&rsquo;s nonce</p>
          {payload ? <Pointer payload={payload} /> : stage === "idle" && published === null && <p>No BitGraphed file of this photo has been published yet, so its pointer is not on the ledger.</p>}
          {stage === "making" && (
            <p className="bgf-working"><span className="demo-progress" role="progressbar" aria-label={step}><span style={{ width: `${Math.round((progress / 4) * 100)}%` }} /></span> {step}</p>
          )}
          {made && (
            <ul className="bgf-checks">
              <li>{remade === "checking" ? "Making the pointer again in your browser from A’s proof…" : remade === "match" ? "✓ Made again in your browser from A’s proof on bitgraph.ing: the same pointer." : remade === "mismatch" ? <span className="db-bad">The pointer does not match A&rsquo;s nonce.</span> : "A’s proof could not be read just now to remake the pointer here."}</li>
              <li>{readBack === null ? "Reading the pointer out of the BitGraphed file…" : readBack ? "✓ Read back out of the BitGraphed file’s pixels." : <span className="db-bad">The pointer did not read back from the file.</span>}</li>
            </ul>
          )}
          {!made && published && <p className="bgf-check">✓ Made again in your browser from A&rsquo;s proof and the photo&rsquo;s published fingerprint.</p>}
          {pictures && <Zoom original={pictures.original} marked={pictures.marked} />}
          {stage === "cannot" && <p>This photo can&rsquo;t carry a pointer: {why}. Its <a href={a ? proofHref(digestB64, a) : "#"}>proof page</a> gives its plain BitGraphed file.</p>}
          {stage === "error" && <p className="db-bad">The BitGraphed file could not be made just now: {why}</p>}
        </div>

        <div className="bgf-step">
          <p className="bgf-label">BitGraph B &middot; the BitGraphed file</p>
          {made ? (
            <>
              <p className="bgf-big">#{fmt(made.copyProof.commit?.counter)}{bTime !== null && <> &middot; <TimeChip date={new Date(bTime)} withDate /></>}</p>
              <p>The watermarked file, bound after A. It could not have existed before #{fmt(made.original.commit?.counter)}, and it existed by #{fmt(made.copyProof.commit?.counter)}.</p>
              {!made.ceiling && <p className="bgf-note">Its Base ceiling has not landed yet; downloading again in a few seconds adds it.</p>}
              {!made.published && <p className="bgf-note">Its pointer could not be registered just now, so a stripped copy cannot be checked yet. Try again in a moment.</p>}
            </>
          ) : stage === "making" ? <p>Waiting for the watermark…</p> : file ? (
            <>
              <p>Not made in this browser yet. Making it records BitGraph B.</p>
              <button type="button" className="bg-action-link is-make" style={{ margin: "8px 0 0" }} disabled={!original} onClick={() => void make()}>Make the BitGraphed file</button>
            </>
          ) : (
            <>
              <p>Made with the original in hand. If you have it, open it here; nothing is uploaded.</p>
              <label className="bg-action-link" style={{ margin: "8px 0 0", cursor: "pointer" }}>
                Open the original photo
                <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => void pick(e.target.files?.[0])} />
              </label>
              {pickNote && <p className="db-bad">{pickNote}</p>}
            </>
          )}
        </div>
      </section>

      <section className="home-section">
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {made && <button type="button" className="bg-action-link is-make" style={{ margin: 0 }} onClick={download}>Download BitGraphed file</button>}
          {a && <a className="bg-action-link" style={{ margin: 0 }} href={proofHref(digestB64, a)}>BitGraph A #{fmt(a.commit?.counter)}, the original</a>}
          {made && <a className="bg-action-link" style={{ margin: 0 }} href={proofHref(made.markedDigestB64, made.copyProof)}>BitGraph B #{fmt(made.copyProof.commit?.counter)}, the BitGraphed file</a>}
        </div>
      </section>

      {/* The drawing explains and moves with the work; it sits below the three steps, as on Ask AI, so the steps are
          the first thing seen. */}
      <section className="home-section" aria-label="How it works">
        <div>
          <SandwichFigure
            a="The original"
            steps={[{ title: "Pointer", sub: "From A’s nonce" }, { title: "Watermark", sub: "Into the pixels" }]}
            b="The BitGraphed file"
            caption={<>The pointer could not exist before&nbsp;A.<br />The watermarked file is bound at&nbsp;B.</>}
            label="BitGraph A records the original. A pointer is made from A's nonce and written into the pixels, and BitGraph B records the watermarked file."
            progress={stage === "making" || made ? progress : undefined}
          />
        </div>
      </section>
    </>
  );
}
