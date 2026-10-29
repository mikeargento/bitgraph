"use client";

// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { decodeForRecord, fingerprintOf } from "@/lib/trustmark/record";
import { align, GRID, MATCH } from "@/lib/trustmark/align";
import { toUrlSafeB64 } from "@/lib/explorer";

/**
 * Find (2026-10-29): a picture with everything stripped, matched to the original's BitGraph by what it looks like.
 *
 * The record Make binds beside every photo says what the original looks like (lib/trustmark/record.ts), and it is
 * published once the tree is indexed. Here the dropped picture is read the same way; its 64-bit pHash goes to the
 * server, which returns the nearest records; each record's brightness grid is then matched against the picture's own
 * pixels in this browser (lib/trustmark/align), and the best match above the threshold is the find. The picture never
 * leaves the machine: only its pHash is sent. A file whose exact bytes are bound goes straight to its proof instead.
 *
 * A find is not a proof. The record says what the original looked like; the original's proof says when its exact
 * bytes were bound. The page says both.
 */

type Candidate = { distance: number; phash: string; photo: string; counter: string; epoch: string; values: string };
type Found = { c: Candidate; score: number; exact: boolean };

const toSafe = (s: string) => s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64 = (u: Uint8Array) => { let s = ""; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]!); return btoa(s); };
const hrefOf = (digestB64: string, counter: string, epochSafe: string) =>
  `/proof/${toSafe(digestB64)}?counter=${encodeURIComponent(counter)}&epoch=${encodeURIComponent(epochSafe)}`;

/** The record's 32 x 32 brightness grid, drawn: what the record says the original looks like, and all it holds of it. */
function Grid({ values }: { values: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current, g = c?.getContext("2d");
    if (!c || !g) return;
    const img = g.createImageData(GRID, GRID);
    for (let i = 0; i < GRID * GRID; i++) { const v = parseInt(values[i] ?? "0", 16) * 17; img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
    g.putImageData(img, 0, 0);
  }, [values]);
  return <canvas ref={ref} className="fd-grid" width={GRID} height={GRID} aria-label="The record's brightness grid" />;
}

export function FindBox() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [found, setFound] = useState<Found | null | "none" | "not-a-picture">(null);
  const [error, setError] = useState<string | null>(null);

  const take = useCallback(async (file: File | undefined) => {
    if (!file) return;
    setFound(null); setError(null);
    try {
      // the exact bytes, bound: the proof itself
      setStatus("Hashing the file…");
      const digest = b64(new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer())));
      const exact = await fetch(`/api/proofs/${toUrlSafeB64(digest)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null) as
        { proofs?: Array<{ kind?: string; proof: { commit?: { counter?: string; epochId?: string } } }> } | null;
      const bound = exact?.proofs?.find((p) => p.kind === "recorded" && p.proof.commit?.counter && p.proof.commit?.epochId);
      if (bound) { setStatus("Opening the proof…"); router.push(hrefOf(digest, String(bound.proof.commit!.counter), toSafe(String(bound.proof.commit!.epochId)))); return; }
      // else by what it looks like
      setStatus("Reading the picture…");
      const img = await decodeForRecord(file);
      if (!img) { setFound("not-a-picture"); return; }
      const fp = fingerprintOf(img);
      setStatus("Looking for records like it…");
      const res = await fetch(`/api/find?phash=${fp.phash}`);
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `find failed (${res.status})`);
      const { candidates } = (await res.json()) as { candidates: Candidate[] };
      setStatus(candidates.length ? `Matching against ${candidates.length === 1 ? "one record" : `${candidates.length} records`}…` : null);
      let best: Found | null = null;
      for (const c of candidates) {
        const { score } = align(img.rgba, img.w, img.h, c.values);
        if (score >= MATCH && (!best || score > best.score)) best = { c, score, exact: false };
      }
      setFound(best ?? "none");
    } catch (e) { setError((e as Error).message); }
    finally { setStatus(null); }
  }, [router]);

  return (
    <div className="fd">
      <div className={`db-zone${status ? " is-busy" : ""}`} data-over={over ? "1" : undefined} role="button" tabIndex={0}
        onClick={() => inputRef.current?.click()} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inputRef.current?.click(); } }}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); void take(e.dataTransfer.files[0]); }}>
        <div className="db-zone-title">{status ?? <>Drop a picture here, or <button type="button" className="db-zone-pick" onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}>choose one</button></>}</div>
        {status && <div className="bg-working" role="progressbar" aria-label={status} />}
        <div className="db-zone-sub">A screenshot, a re-save, a copy with its metadata stripped. <br className="sub-br" />Only a 64-bit fingerprint is&nbsp;sent.</div>
        <div className="db-zone-sub">The picture never leaves your machine.</div>
        <input ref={inputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { void take(e.target.files?.[0]); e.target.value = ""; }} />
      </div>

      {error && <div className="db-reveal"><div><div className="db-rows"><div className="db-row"><div className="db-state"><span className="db-bad">{error}</span></div></div></div></div></div>}
      {found === "not-a-picture" && <div className="db-reveal"><div><div className="fd-result"><p className="fd-none">This browser cannot open that file as a picture.</p></div></div></div>}
      {found === "none" && <div className="db-reveal"><div><div className="fd-result">
        <p className="fd-none">No record looks like this picture.</p>
        <p className="fd-fine">Either its original was never recorded with a fingerprint, or the copy differs too much: a heavy crop, a filter, a photo of a screen.</p>
      </div></div></div>}
      {found && typeof found === "object" && (
        <div className="db-reveal" key={`${found.c.counter}-${found.c.epoch}`}><div>
          <div className="fd-result">
            <div className="fd-row">
              <Grid values={found.c.values} />
              <div className="fd-text">
                <div className="plug-title">Looks like BitGraph <span className="plug-num">#{Number(found.c.counter).toLocaleString("en-US")}</span></div>
                <div className="plug-sub">Match {found.score.toFixed(3)} against the record bound beside the original. The grid is the whole record: what the original looks like, and nothing more.</div>
              </div>
              <a className="bg-action-link plug-open" style={{ margin: 0, flex: "none" }} href={hrefOf(found.c.photo, found.c.counter, found.c.epoch)}>Open the proof</a>
            </div>
            <p className="fd-fine">A find is not a proof. The record says what the original looked like; the original&rsquo;s proof says when its exact bytes were bound. This copy proves only that it resembles them.</p>
          </div>
        </div></div>
      )}
    </div>
  );
}
