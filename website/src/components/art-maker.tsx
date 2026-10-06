"use client";

/**
 * The image generator (Mike, 2026-10-05; redesigned the same night: "its not very compelling").
 * A studio: the canvas draws itself, cell by cell (version 3: the cells spell the code), from the
 * commitment shown beside it; the panel on the right holds the one button, the steps, the
 * commitment and, when the image is recorded, a timeline from the Ethereum block to the Base block.
 *
 * The drawing on screen is presentation only. The canonical pixels exist in full before the reveal
 * starts (lib/commitment-art.ts) and before the commit (lib/art-position.ts); the reveal paints them,
 * it does not compute them, and "Ready" waits for the recorded proof, never for the animation.
 *
 * Claims, exactly: the caption under the image says the code it is drawn from did not exist until
 * the click, bounded by the click because the position opens after it; the technical details say the
 * image was generated from its position commitment and recorded in that position, and that the
 * commitment-bearing file could not have been completed before the commitment existed, under the
 * protocol's unpredictability assumptions.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createArtImage, ArtError, type ArtStage, type MadeArtImage, type OpenedPosition } from "@/lib/art-position";
import { buildCarrierForProof } from "@/lib/carrier-site";
import { recordedMsOf } from "@/lib/recorded-time";
import { ART_ALGORITHM, artRecipe, artSize, fromBase64Url } from "@/lib/commitment-art";

const { width: ART_WIDTH, height: ART_HEIGHT } = artSize(ART_ALGORITHM);

const STEPS: Array<{ key: ArtStage; label: string }> = [
  { key: "opening", label: "Opening position" },
  { key: "generating", label: "Generating image" },
  { key: "recording", label: "Recording image" },
  { key: "ready", label: "Ready" },
];
const stepIndex = (s: ArtStage | null) => (s === null ? -1 : s === "verifying" ? 2 : STEPS.findIndex((x) => x.key === s));
const urlSafe = (b64: string) => b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const n = (x: number | string) => Number(x).toLocaleString("en-US");
const utc = (ms: number) => new Date(ms).toISOString().slice(11, 19) + " UTC";

type Built = { bytes: Uint8Array; fileName: string; existedBy: { blockNumber: number; timestamp: number } | null; floorTs: number | null };

/** Paint the canonical pixels onto the canvas, cell by cell, then the whole image exactly. */
function reveal(canvas: HTMLCanvasElement, pixels: Uint8Array, grid: number, instant: boolean): () => void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};
  const img = new ImageData(new Uint8ClampedArray(pixels), ART_WIDTH, ART_HEIGHT);
  if (instant) { ctx.putImageData(img, 0, 0); return () => {}; }
  const side = 960 / grid;
  ctx.fillStyle = `rgb(${pixels[0]},${pixels[1]},${pixels[2]})`;
  ctx.fillRect(0, 0, ART_WIDTH, ART_HEIGHT);
  const steps: Array<[number, number, number, number]> = [];
  // Cell by cell for a 6 x 6 grid; a 16 x 16 maze grows row by row, so it still takes about a second.
  if (grid <= 6) for (let r = 0; r < grid; r++) for (let k = 0; k < grid; k++) steps.push([32 + k * side, 32 + r * side, side, side]);
  else for (let r = 0; r < grid; r++) steps.push([32, 32 + r * side, 960, side]);
  steps.push([0, 0, ART_WIDTH, ART_HEIGHT]); // and the whole, exactly
  let i = 0, timer = 0;
  const per = Math.max(16, Math.floor(1000 / steps.length));
  const tick = () => {
    const s = steps[i++];
    if (!s) return;
    ctx.putImageData(img, 0, 0, s[0], s[1], s[2], s[3]);
    timer = window.setTimeout(tick, per);
  };
  tick();
  return () => window.clearTimeout(timer);
}

/**
 * `children` is the page's headline and sentence. They fold away on the first click (Mike, 10-06:
 * "a smooth animation when you click that sort of removes the content in the way and makes room
 * for image"), and stay folded while there is an image or a run on the page.
 */
export function ArtMaker({ children }: { children?: ReactNode } = {}) {
  const [stage, setStage] = useState<ArtStage | null>(null);
  const [failedAt, setFailedAt] = useState(-1);
  const [position, setPosition] = useState<OpenedPosition | null>(null);
  const [made, setMade] = useState<MadeArtImage | null>(null);
  const [error, setError] = useState<{ message: string; recorded: boolean } | null>(null);
  const [built, setBuilt] = useState<Built | null>(null);
  const [building, setBuilding] = useState(false);
  const [drawn, setDrawn] = useState(false);
  const busy = useRef(false);
  const stageRef = useRef<ArtStage | null>(null);
  const positionRef = useRef<OpenedPosition | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const stopReveal = useRef<() => void>(() => {});
  const buildPromise = useRef<Promise<Built | null> | null>(null);

  useEffect(() => () => stopReveal.current(), []);

  /** The image with its proof inside, built from what followed the commit (anchors, the Base block). */
  const buildDownload = useCallback((m: MadeArtImage): Promise<Built | null> => {
    if (buildPromise.current) return buildPromise.current;
    setBuilding(true);
    buildPromise.current = (async () => {
      try {
        const b = await buildCarrierForProof(m.png, m.proof as never, `bitgraph-image-${m.proof.commit.counter}.png`, { waitForCeilingMs: 20_000 });
        const out: Built = {
          bytes: b.bytes,
          fileName: b.fileName,
          existedBy: b.bounds.existedBy ? { blockNumber: b.bounds.existedBy.blockNumber, timestamp: b.bounds.existedBy.timestamp } : null,
          floorTs: b.bounds.notBefore.timestamp,
        };
        setBuilt(out);
        return out;
      } catch (e) {
        setError({ message: `The download could not be built: ${e instanceof Error ? e.message : String(e)}`, recorded: true });
        buildPromise.current = null;
        return null;
      } finally {
        setBuilding(false);
      }
    })();
    return buildPromise.current;
  }, []);

  const create = useCallback(async () => {
    if (busy.current) return; // one image at a time
    busy.current = true;
    stopReveal.current();
    // The last image leaves the frame before the new position opens: nothing old is shown as new.
    canvas.current?.getContext("2d")?.clearRect(0, 0, ART_WIDTH, ART_HEIGHT);
    buildPromise.current = null;
    positionRef.current = null;
    setError(null); setMade(null); setBuilt(null); setPosition(null); setFailedAt(-1); setDrawn(false);
    try {
      const r = await createArtImage({
        onStage: (s, p) => { stageRef.current = s; setStage(s); if (p) { positionRef.current = p; setPosition(p); } },
        onDrawn: (px) => {
          setDrawn(true);
          const c = positionRef.current ? fromBase64Url(positionRef.current.commitment) : null;
          const grid = c ? artRecipe(c).grid : 16;
          const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          requestAnimationFrame(() => { if (canvas.current) stopReveal.current = reveal(canvas.current, px, grid, reduce); });
        },
      });
      setMade(r);
      void buildDownload(r); // ready the download and the Base block in the background
    } catch (e) {
      setFailedAt(stepIndex(stageRef.current));
      setStage(null);
      // An image that was not recorded is not shown as if it were: it leaves the page.
      if (!(e instanceof ArtError && e.recorded)) { stopReveal.current(); setDrawn(false); }
      setError(e instanceof ArtError ? { message: e.message, recorded: e.recorded } : { message: e instanceof Error ? e.message : String(e), recorded: false });
    } finally {
      busy.current = false;
    }
  }, [buildDownload]);

  const download = useCallback(async () => {
    if (!made) return;
    const b = await buildDownload(made);
    if (!b) return;
    const url = URL.createObjectURL(new Blob([b.bytes as BlobPart], { type: "image/png" }));
    const a = document.createElement("a");
    a.href = url; a.download = b.fileName;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }, [made, buildDownload]);



  const running = stage !== null && stage !== "ready";
  const at = stepIndex(stage);
  const recordedMs = made ? recordedMsOf(made.proof) : null;

  return (
    <div className={`art${stage !== null || failedAt >= 0 || made ? " is-active" : ""}`}>
      {children && (
        <div className={`art-hero${stage !== null || failedAt >= 0 || made ? " is-away" : ""}`}>
          <div className="art-hero-inner">{children}</div>
        </div>
      )}
      {/* The first button folds away with the headline on the click; after a failure it comes back as
          "Try again". "Make another" lives with the other actions under the image (Mike, 10-06). */}
      <div className={`art-hero art-go-wrap${running || made ? " is-away" : ""}`}>
        <div className="art-hero-inner">
          <button type="button" className="bg-action-link is-make art-go" onClick={create} disabled={running} aria-busy={running}>
            {failedAt >= 0 ? "Try again" : "Create a BitGraph image"}
          </button>
        </div>
      </div>

      {(stage !== null || failedAt >= 0) && (
        <ol className="art-stepper" aria-label="Progress">
          {STEPS.map((s, i) => {
            const state = i === failedAt ? "failed" : i < at || i < failedAt || stage === "ready" ? "done" : i === at ? "now" : "todo";
            return (
              <li key={s.key} className={`is-${state}`} aria-current={state === "now" ? "step" : undefined}>
                <span className="art-dot" aria-hidden>
                  {state === "done" ? <svg viewBox="0 0 16 16" width="14" height="14"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    : state === "failed" ? <svg viewBox="0 0 16 16" width="12" height="12"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
                    : i + 1}
                </span>
                <span className="art-step-label">{s.label}</span>
              </li>
            );
          })}
        </ol>
      )}

      {error && (
        <div className="art-error" role="alert">
          <p>{error.message}</p>
          {error.recorded && made && <p>A proof was returned for this image; it is not called verified here. <a href={`/proof/${urlSafe(made.digestB64)}`}>Open its proof page</a>.</p>}
        </div>
      )}

      {/* The frame is held from the click, blank until the image draws into it, so nothing below
          jumps; the code sits under it as its caption (Mike, 10-06: "under image?"). */}
      <div className={`art-canvas${drawn ? " is-drawn" : ""}`} hidden={!(drawn || (running && failedAt < 0))}>
        <canvas ref={canvas} width={ART_WIDTH} height={ART_HEIGHT} role="img" aria-label={made ? `Abstract geometric image drawn from position commitment ${made.position.commitment}` : "The image, drawing"} />
      </div>

      {position && (
        <div className="art-code">
          <span className="art-code-note">Drawn from this code, which did not exist until you clicked.</span>
          <code className="art-code-value">{position.commitment}</code>
        </div>
      )}

      {made && (
        <>
          {/* No success sentence (Mike, 10-06: "redundant"): the headline and the caption under the
              image already say it; "Ready", the actions and the timeline say it is done. */}
          <div className="actions art-actions">
            <button type="button" className="bg-action-link is-make" onClick={download} disabled={building && !built}>{building && !built ? "Preparing the download" : "Download image and proof"}</button>
            {/* A link to the full proof, not a button that checks itself here (Mike, 10-06: "a trust
                me bro button when you can just link to full proof"). The proof page shows every
                field, checks against Ethereum and Base, and redraws the image on its own. */}
            <a className="bg-action-link" href={`/proof/${urlSafe(made.digestB64)}`}><span>See the full proof</span></a>
            <button type="button" className="bg-action-link" onClick={create} disabled={running}>Create another image</button>
          </div>
          <ol className="art-timeline">
            <li><span>Ethereum block {n(made.position.floorBlock)}</span><span>{built?.floorTs ? utc(built.floorTs * 1000) : "the floor"}</span></li>
            <li><span>Position {n(made.position.slotCounter)} opened, commitment issued</span><span>after the floor</span></li>
            <li><span>Image drawn from the commitment</span><span>{made.recipe.grid * made.recipe.grid} {made.recipe.grid === 16 ? "tiles, one bit each" : "cells"}</span></li>
            <li><span>Recorded as <a href={`/proof/${urlSafe(made.digestB64)}`}>BitGraph #{n(made.proof.commit.counter ?? 0)}</a></span><span>{recordedMs ? utc(recordedMs) : ""}</span></li>
            <li className={built?.existedBy ? "" : "is-pending"}><span>{built?.existedBy ? `Existed by Base block ${n(built.existedBy.blockNumber)}` : "Base block"}</span><span>{built?.existedBy ? utc(built.existedBy.timestamp * 1000) : building ? "waiting for it" : "not in yet"}</span></li>
          </ol>
        </>
      )}

      {made && (
        <details className="art-details">
          <summary>Technical details</summary>
          <div className="art-detail-parts">
            <h3>What it proves</h3>
            <p>The image was drawn from its position&rsquo;s commitment, and that commitment did not exist until the position opened. So these exact bytes could not have been finished any earlier.</p>
            <p className="art-fine">Precisely: this image was generated from its position commitment and recorded in that position. Under the protocol&rsquo;s unpredictability assumptions, this exact commitment-bearing artifact could not have been completed before the commitment became available.</p>
            <h3>How it was drawn</h3>
            <p>{made.manifest.algorithm === "bitgraph-art/4"
              ? <>The picture spells the code. Each of its 256 tiles is one bit: the arcs turn one way for a 0 and the other for a 1, and join into one pattern. So two different codes can never draw the same picture, and the code can be read back from the picture alone ({made.manifest.algorithm}).</>
              : <>The picture spells the code. Each of its 36 cells carries 7 of the code&rsquo;s 256 bits, the palette and the frame carry the rest, so two different codes can never draw the same picture, and the code can be read back from the picture alone ({made.manifest.algorithm}).</>} Anyone can redraw it and compare, pixel for pixel.</p>
            <h3>What it does not prove</h3>
            <p>Who made it, whether it is original, or anything about the computer it was made on.</p>
            <h3>The numbers</h3>
          </div>
          <dl>
            <dt>Algorithm</dt><dd><code>{made.manifest.algorithm}</code>, {made.manifest.width} x {made.manifest.height}</dd>
            <dt>Record</dt><dd>BitGraph #{n(made.proof.commit.counter ?? 0)}</dd>
            <dt>Position</dt><dd>opened at {n(made.position.slotCounter)}, epoch <code>{made.position.epochId.slice(0, 8)}</code>, after Ethereum block {n(made.position.floorBlock)}</dd>
            <dt>Commitment</dt><dd><code className="break">{made.position.commitment}</code></dd>
            <dt>Recipe SHA-256</dt><dd><code className="break">{made.manifest.recipeSha256}</code></dd>
            <dt>Pixels SHA-256</dt><dd><code className="break">{made.manifest.pixelsSha256}</code></dd>
            <dt>Recorded file SHA-256</dt><dd><code className="break">{made.digestB64}</code> (base64)</dd>
          </dl>
        </details>
      )}


      {/* No "check a downloaded image" here (Mike, 10-06: "what is this for?"): this page makes;
          a received image is checked where files are checked, the drop box and its proof page,
          which redraws it from the commitment and compares it byte for byte. */}
    </div>
  );
}
