"use client";

// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * The image generator on two BitGraphs (restored 2026-10-17, on the same two-BitGraph method),
 * the same shape as Ask AI. One click binds A (a small request file); A's nonce, unseen until A is bound, is the only
 * input to the drawing (bitgraph-art/19); the PNG is bound as B, after A. The drawing is deterministic, so nothing is
 * stored: /generate?a=<A's digest> reads A's proof, draws the same picture from its nonce, and looks B up by the PNG's
 * SHA-256. Only digests leave the browser.
 */
import { useCallback, useEffect, useState } from "react";
import { makeArtOffThread } from "@/lib/art-offthread";
import { ART_ALGORITHM_V19 } from "@/lib/commitment-art";
import { cacheArtifactToIDB } from "@/lib/file-cache";
import { SandwichFigure } from "@/components/primitive-figures";

const fmt = (n: number | string) => Number(n).toLocaleString("en-US");
const b64 = (u: Uint8Array) => { let s = ""; for (const x of u) s += String.fromCharCode(x); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const urlSafe = (s: string) => s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const sha = async (u: Uint8Array) => b64(new Uint8Array(await crypto.subtle.digest("SHA-256", u.slice())));

interface Proof { artifact?: { digestB64?: string }; commit?: { nonceB64?: string; counter?: string; slotCounter?: string; epochId?: string } }
interface Made { a: Proof; b: Proof | null; png: Uint8Array; url: string }

/** POST /api/commit for one digest; the proof that names it. */
async function bind(digestB64: string): Promise<Proof> {
  const res = await fetch("/api/commit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ digests: [{ digestB64, hashAlg: "sha256" }], chainId: "bitgraph:main" }) });
  if (res.status === 503) throw new Error("The enclave is restarting (it does once a day). Try again in a minute.");
  if (!res.ok) throw new Error(`The BitGraph could not be made (${res.status}).`);
  const raw = (await res.json()) as Proof[] | { proofs?: Proof[] };
  const p = (Array.isArray(raw) ? raw : raw.proofs ?? []).find((x) => x.artifact?.digestB64 === digestB64);
  if (!p?.commit?.nonceB64) throw new Error("No proof came back.");
  return p;
}

/** The proof the ledger holds for a digest, or null. */
async function lookup(digestB64: string): Promise<Proof | null> {
  const res = await fetch(`/api/proofs/${urlSafe(digestB64)}`);
  if (!res.ok) return null;
  const body = (await res.json()) as { proofs?: Array<{ proof: Proof }> };
  return body.proofs?.[0]?.proof ?? null;
}

/** The picture A's nonce draws: the same bytes on every machine. */
async function draw(a: Proof): Promise<{ png: Uint8Array; digestB64: string }> {
  const art = await makeArtOffThread(unb64(a.commit!.nonceB64!), ART_ALGORITHM_V19);
  return { png: art.png, digestB64: await sha(art.png) };
}

const proofHref = (p: Proof) => `/proof/${urlSafe(p.artifact!.digestB64!)}?counter=${p.commit!.counter}&epoch=${encodeURIComponent(p.commit!.epochId!)}`;

export function ArtTwo() {
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [step, setStep] = useState("");
  const [made, setMade] = useState<Made | null>(null);
  const [error, setError] = useState<string | null>(null);

  const show = useCallback((a: Proof, b: Proof | null, png: Uint8Array) => {
    setMade((m) => { if (m) URL.revokeObjectURL(m.url); return { a, b, png, url: URL.createObjectURL(new Blob([png.slice()], { type: "image/png" })) }; });
  }, []);

  // A link that carries A: draw again from A's nonce, then find B by the picture's digest.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("a");
    if (!q || !/^[A-Za-z0-9_-]{43}$/.test(q)) return;
    void (async () => {
      try {
        setState("running"); setStep("Reading BitGraph A…");
        const a = await lookup(q);
        if (!a?.commit?.nonceB64) { setState("idle"); return; }
        setStep("Drawing from A’s nonce…");
        const { png, digestB64 } = await draw(a);
        const b = await lookup(digestB64);
        show(a, b, png); setState("done");
        if (b) void cacheArtifactToIDB(new File([png.slice()], `bitgraph-${b.commit!.counter}.png`, { type: "image/png" }), digestB64).catch(() => {});
      } catch { setState("idle"); }
    })();
  }, [show]);

  const makeNow = async () => {
    setState("running"); setError(null); setStep("Making BitGraph A…");
    try {
      const request = new TextEncoder().encode(JSON.stringify({
        format: "bitgraph-art-request/1",
        request: crypto.randomUUID(),
        algorithm: ART_ALGORITHM_V19,
        asks: "An image drawn from this BitGraph's nonce once it is bound.",
      }, null, 2) + "\n");
      const aDigest = await sha(request);
      const a = await bind(aDigest);
      void cacheArtifactToIDB(new File([request.slice()], `bitgraph-${a.commit!.counter}-request.json`, { type: "application/json" }), aDigest).catch(() => {});
      setStep("Drawing from A’s nonce…");
      const { png, digestB64 } = await draw(a);
      setStep("Making BitGraph B…");
      const b = await bind(digestB64);
      void cacheArtifactToIDB(new File([png.slice()], `bitgraph-${b.commit!.counter}.png`, { type: "image/png" }), digestB64).catch(() => {});
      show(a, b, png); setState("done");
      window.history.replaceState(null, "", `/generate?a=${urlSafe(aDigest)}`);
    } catch (e) {
      setError((e as Error).message); setState("error");
    }
  };

  const a = made?.a, b = made?.b;
  return (
    <>
      <section className="home-section" aria-labelledby="gen-h">
        <p className="home-kicker">Generate image</p>
        <h2 id="gen-h">A file that never existed before you&nbsp;clicked.</h2>
        <p style={{ marginTop: 24 }}>
          One click makes BitGraph A. Its nonce, unseen until A is bound, is the only input to the drawing. The picture is
          bound as BitGraph B, after A in the same sequence. Anyone can draw it again from A&rsquo;s proof and get the same&nbsp;bytes.
        </p>
        <div style={{ marginTop: 24, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          {/* The primary action, filled (2026-10-20) so it stands out as the one thing to press. The record dot was tried
              and left off: on a button it reads as "this site will record you". */}
          <button type="button" className="bg-action-link is-make" style={{ margin: 0 }} disabled={state === "running"} onClick={() => void makeNow()}>
            {made ? "Generate another" : "Generate image"}
          </button>
          {/* While it runs the button keeps its label and a bar fills, one part per step, instead of the label changing
              at each BitGraph (2026-10-19): a label swapped per step made the button blink. */}
          {state === "running" && (
            <span className="demo-progress" role="progressbar" aria-label={step} title={step}>
              <span style={{ width: `${Math.round(100 * (step.startsWith("Making BitGraph B") ? 0.85 : step.startsWith("Drawing") || step.startsWith("Asking") ? 0.5 : 0.15))}%` }} />
            </span>
          )}
          {state === "error" && <span className="db-bad">{error}</span>}
        </div>
      </section>

      {made && a && (
        // The result opens smoothly: the space grows and the content fades in, so the drawing below glides down
        // instead of jumping (2026-10-19).
        <div className="demo-reveal"><div>
        <section className="home-section" aria-labelledby="gen-r">
          <h2 id="gen-r" className="sr-only">The picture</h2>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={made.url} alt={`Drawn from the nonce of BitGraph #${fmt(a.commit!.counter!)}`} style={{ display: "block", width: "100%", height: "auto", aspectRatio: "16 / 9" }} />
          <div style={{ paddingTop: 40 }}><p className="home-kicker">Drawn from BitGraph A&rsquo;s nonce</p></div>
          <div className="gen-nonce"><pre className="jev-code">{urlSafe(a.commit!.nonceB64!)}</pre></div>
          {!b && <p className="db-bad">This picture has no BitGraph B on the ledger.</p>}
          {/* The links are buttons (2026-10-19), like View proof on Make. */}
          <div style={{ marginTop: 20, display: "flex", gap: 12, flexWrap: "wrap" }}>
            <a className="bg-action-link" style={{ margin: 0 }} href={proofHref(a)}>BitGraph A #{fmt(a.commit!.counter!)}, the request</a>
            {b && <a className="bg-action-link" style={{ margin: 0 }} href={proofHref(b)}>BitGraph B #{fmt(b.commit!.counter!)}, the picture</a>}
            <a className="bg-action-link" style={{ margin: 0 }} href={made.url} download={`bitgraph-${b?.commit?.counter ?? a.commit!.counter}.png`}>Download the picture</a>
          </div>
        </section>
        </div></div>
      )}
      {/* The drawing explains; it does not animate, and it sits below the result, so a result is the first thing seen
          after the button (2026-10-19): the animation added nothing, and the result reads better higher up the
          page. */}
      <section className="home-section" aria-label="How it works">
        <div>
          <SandwichFigure
            a="The request"
            steps={[{ title: "Picture", sub: "Drawn from A’s nonce" }]}
            b="The picture"
            caption={<>The picture could not exist before&nbsp;A; its bytes are bound at&nbsp;B.</>}
            label="BitGraph A, the request. A picture is drawn from A's nonce, and BitGraph B binds the picture."
          />
        </div>
      </section>
    </>
  );
}
