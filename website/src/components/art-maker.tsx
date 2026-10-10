"use client";

/**
 * The image generator (Mike, 2026-10-05; redesigned the same night: "its not very compelling").
 * A studio: the canvas draws itself, cell by cell (version 3: the cells spell the code), from the
 * commitment shown beside it; the panel on the right holds the one button, the steps, the
 * commitment and, when the image is recorded, a timeline from the floor block (Base since enclave v10,
 * Ethereum before) to the Base block.
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
import { createArtImage, restoreArtImage, ArtError, type ArtStage, type MadeArtImage } from "@/lib/art-position";
import { buildCarrierForProof } from "@/lib/carrier-site";
import { PRINTABLE, printSizeOf } from "@/lib/art-print";
import { drawPrintOffThread } from "@/lib/art-offthread";
import { DENSITY_NAMES_V10, PALETTE_NAMES_V10, STYLE_NAMES_V10 } from "@/lib/commitment-art-v10";
import { AGE_BAND_NAMES_V11, EXPRESSION_NAMES_V11, HAIR_NAMES_V11, PALETTE_NAMES_V11, ageBandV11 } from "@/lib/commitment-art-v11";
import { compositionNameV15, paletteNameV15 } from "@/lib/commitment-art-v15";
import { ART_ALGORITHM, ART_ALGORITHM_V15, ART_ALGORITHM_V16, toHex } from "@/lib/commitment-art";
import { describeV16, svgFromPngV16 } from "@/lib/commitment-art-v16";
import { sha256 } from "@noble/hashes/sha256";
import { rememberMade, madeHere } from "@/lib/made-here";
import { recordedMsOf } from "@/lib/recorded-time";



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

/** Paint the canonical pixels onto the canvas, exactly. */
function paint(canvas: HTMLCanvasElement, pixels: Uint8Array, width: number, height: number): void {
  canvas.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
}

/** How long the finished stepper stays, all green, before it gives way to the image. */
/** The spinner stays at least this long (Mike, 10-06: "it goes so fast on jev questions its barely there"):
 *  shorter reads as a flicker, not as speed. A slower run shows its result the moment it is recorded. */
const MIN_WAIT_MS = 1000;

/**
 * `children` is the page's headline. The demo, for someone who has no idea what is happening (Mike,
 * 10-06: "we never want to be in the middle of this chart for these demos"): the headline and one
 * button; on the click everything folds away and only the progress steps stay, in the middle of the
 * screen; when the image is recorded the steps give way and the image fades in under one plain
 * paragraph saying what just happened. The numbers, the timeline and the precise claim sit under
 * "Technical details", closed.
 *
 * A finished image is never lost by leaving the page: the address becomes /painting?p=<digest>, and
 * that address rebuilds the same image from its proof (restoreArtImage), byte for byte.
 */
/**
 * What the page makes. "painting" (/painting, the default, unchanged): version 15. "three" (/three, Mike, 2026-10-09:
 * "basically copy the painting page"): version 16, the same flow and buttons with its own words, and a second download,
 * the print SVG the recorded PNG carries.
 */
export type ArtMakerMode = "painting" | "three";
// The make buttons: /three is Mike's own studio page, so its buttons say "Generate" (Mike, 2026-10-09: "button should be generate since its just for me").
const MODES: Record<ArtMakerMode, { algorithm: string; path: string; noun: string; filePrefix: string; make: string; again: string }> = {
  painting: { algorithm: ART_ALGORITHM, path: "/painting", noun: "painting", filePrefix: "bitgraph-image", make: "Make a BitGraph painting", again: "Make another painting" },
  three: { algorithm: ART_ALGORITHM_V16, path: "/generate", noun: "piece", filePrefix: "bitgraph-three", make: "Generate", again: "Generate another" },
};

export function ArtMaker({ children, mode = "painting" }: { children?: ReactNode; mode?: ArtMakerMode } = {}) {
  const cfg = MODES[mode];
  const [stage, setStage] = useState<ArtStage | null>(null);
  const [failedAt, setFailedAt] = useState(-1);
  const [made, setMade] = useState<MadeArtImage | null>(null);
  const [shown, setShown] = useState(false);
  const [restored, setRestored] = useState(false);
  const [restoring, setRestoring] = useState(false);
  /** While a painting (version 15) is being drawn in its worker: the wait says Painting. */
  const [painting, setPainting] = useState(false);
  const [error, setError] = useState<{ message: string; recorded: boolean } | null>(null);
  const [built, setBuilt] = useState<Built | null>(null);
  const [building, setBuilding] = useState(false);
  const [printing, setPrinting] = useState(false);
  const busy = useRef(false);
  const stageRef = useRef<ArtStage | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const showTimer = useRef(0);
  const startedAt = useRef(0);
  const buildPromise = useRef<Promise<Built | null> | null>(null);

  useEffect(() => () => window.clearTimeout(showTimer.current), []);

  /** The image with its proof inside, built from what followed the commit (the Base block; on an Ethereum floor, the anchors too). */
  const buildDownload = useCallback((m: MadeArtImage): Promise<Built | null> => {
    if (buildPromise.current) return buildPromise.current;
    setBuilding(true);
    buildPromise.current = (async () => {
      try {
        const b = await buildCarrierForProof(m.png, m.proof as never, `${cfg.filePrefix}-${m.proof.commit.counter}.png`, { waitForCeilingMs: 20_000 });
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
  }, [cfg.filePrefix]);

  // Coming back: /painting?p=<digest> (or /generate?p=) rebuilds the recorded image from its proof.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("p");
    if (!p) return;
    let cancelled = false;
    setRestoring(true);
    (async () => {
      try {
        const r = await fetch(`/api/proofs/digest/${encodeURIComponent(p)}`);
        const d = r.ok ? await r.json() : null;
        const list: Array<{ proof?: unknown }> = Array.isArray(d?.proofs) ? d.proofs : [];
        for (const item of list) {
          const m = item.proof ? await restoreArtImage(item.proof as never, { recordedMs: recordedMsOf(item.proof), onTry: (a) => { if (!cancelled) setPainting(a === ART_ALGORITHM_V15); } }) : null;
          if (m && !cancelled) { setMade(m); setRestored(!madeHere(urlSafe(m.digestB64))); setShown(true); void buildDownload(m); return; }
        }
        if (!cancelled) { setError({ message: `That ${cfg.noun} could not be found. Make a new one below.`, recorded: false }); window.history.replaceState(null, "", cfg.path); }
      } catch {
        if (!cancelled) setError({ message: "That image could not be opened right now. Try reloading the page.", recorded: false });
      } finally {
        if (!cancelled) { setRestoring(false); setPainting(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [buildDownload, cfg.noun, cfg.path]);

  // The image appears once it is shown: painted exactly, faded in by CSS.
  useEffect(() => {
    if (shown && made && canvas.current) paint(canvas.current, made.pixels, made.manifest.width, made.manifest.height);
  }, [shown, made]);

  const create = useCallback(async () => {
    if (busy.current) return; // one image at a time
    busy.current = true;
    window.clearTimeout(showTimer.current);
    startedAt.current = performance.now();
    buildPromise.current = null;
    window.history.replaceState(null, "", cfg.path);
    setError(null); setMade(null); setShown(false); setRestored(false); setBuilt(null); setFailedAt(-1);
    window.scrollTo({ top: 0, behavior: "smooth" });
    try {
      const r = await createArtImage({
        algorithm: cfg.algorithm,
        onStage: (s) => { stageRef.current = s; setStage(s); },
      });
      setMade(r);
      // The address now opens this image again, so leaving the page loses nothing.
      window.history.replaceState(null, "", `${cfg.path}?p=${urlSafe(r.digestB64)}`);
      rememberMade(urlSafe(r.digestB64));
      void buildDownload(r); // ready the download and the Base block in the background
      showTimer.current = window.setTimeout(() => setShown(true), Math.max(0, MIN_WAIT_MS - (performance.now() - startedAt.current)));
    } catch (e) {
      setFailedAt(stepIndex(stageRef.current));
      setStage(null);
      setError(e instanceof ArtError ? { message: e.message, recorded: e.recorded } : { message: e instanceof Error ? e.message : String(e), recorded: false });
    } finally {
      busy.current = false;
    }
  }, [buildDownload, cfg.algorithm, cfg.path]);

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

  /** Version 16's print master: the SVG inside the recorded PNG, byte for byte (checked against a redrawing when the piece was made or reopened). */
  const downloadSvg = useCallback(() => {
    if (!made || made.manifest.algorithm !== ART_ALGORITHM_V16 || made.checks.strip.result !== "TRUE") return;
    const svg = svgFromPngV16(made.png);
    if (!svg) return;
    const url = URL.createObjectURL(new Blob([svg as BlobPart], { type: "image/svg+xml" }));
    const a = document.createElement("a");
    a.href = url; a.download = `bitgraph-three-${made.proof.commit.counter ?? ""}.svg`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }, [made]);

  const [copied, setCopied] = useState(false);
  const copyProofLink = useCallback(async () => {
    if (!made) return;
    const url = `${window.location.origin}/${urlSafe(made.digestB64).slice(0, 10)}`; // the short link: the digest's first ten characters at the site root (app/[code]; Mike, 2026-10-09)
    try { await navigator.clipboard.writeText(url); } catch { window.prompt("Copy the proof link", url); }
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  }, [made]);
  /** The same image redrawn at 4096 x 4096 for print (lib/art-print.ts): a redrawing, not the recorded file. */
  const downloadPrint = useCallback(async () => {
    if (!made || printing) return;
    setPrinting(true);
    try {
      const counter = Number(made.proof.commit.counter ?? 0);
      const bytes = await drawPrintOffThread({ commitment: made.position.commitment, counter, digestB64: made.digestB64, algorithm: made.manifest.algorithm });
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "image/png" }));
      const a = document.createElement("a");
      const ps = printSizeOf(made.manifest.algorithm);
      a.href = url; a.download = `bitgraph-image-${counter}-print-${ps.width}x${ps.height}.png`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (e) {
      setError({ message: `The print version could not be drawn: ${e instanceof Error ? e.message : String(e)}`, recorded: true });
    } finally {
      setPrinting(false);
    }
  }, [made, printing]);

  const running = stage !== null && !shown && failedAt < 0;
  const recordedMs = made ? recordedMsOf(made.proof) : null;
  const counter = made ? n(made.proof.commit.counter ?? 0) : "";
  // What the recorded picture is, so a reopened older record reads right: portraits (versions 11 to 14),
  // paintings (15 on), images before that (Mike, 2026-10-09).
  // Version 16 (/three) is a "piece".
  const noun = !made ? cfg.noun : made.manifest.algorithm === ART_ALGORITHM_V16 ? "piece" : /^bitgraph-art\/(1[1-4])$/.test(made.manifest.algorithm) ? "portrait" : /^bitgraph-art\/([1-9]|10)$/.test(made.manifest.algorithm) ? "image" : "painting";
  const paints = cfg.algorithm === ART_ALGORITHM_V15;
  const printSvgSha = made?.recipe.v16 ? (() => { const svg = svgFromPngV16(made.png); return svg ? toHex(sha256(svg)) : null; })() : null;

  return (
    <div className={`art${shown ? " is-active" : ""}`}>
      {children && (
        <div className={`art-hero${stage !== null || failedAt >= 0 || shown || restoring ? " is-away" : ""}`}>
          <div className="art-hero-inner">{children}</div>
        </div>
      )}
      <div className={`art-hero art-go-wrap${running || shown || restoring ? " is-away" : ""}`}>
        <div className="art-hero-inner">
          <button type="button" className="bg-action-link is-make art-go" onClick={create} disabled={running} aria-busy={running}>
            {failedAt >= 0 ? "Try again" : cfg.make}
          </button>
        </div>
      </div>

      {/* While it runs, the site's own spinner (Mike, 10-06: "the green checks are dumb and make it seem like
          its taking longer ... use normal spinner we have on site"): the proof page's fresh-recording wait. */}
      {running && (
        <div className="art-wait" role="status" aria-label={stage === "generating" && paints ? "Painting" : "BitGraphing"}>
          <div className="bg-spinner art-spinner" />
          {/* A painting takes a few seconds to draw (version 15, in a worker): the wait says so while it paints. */}
          <div className="art-wait-label">{stage === "generating" && paints ? <>Painting&hellip;</> : <>BitGraphing&hellip;</>}</div>
        </div>
      )}
      {restoring && <p className="art-restoring" role="status">{painting ? <>Painting&hellip;</> : <>Opening the image&hellip;</>}</p>}

      {error && (
        <div className="art-error" role="alert">
          <p>{error.message}</p>
          {error.recorded && made && <p>A proof was returned for this image; it is not called verified here. <a href={`/proof/${urlSafe(made.digestB64)}`}>Open its proof page</a>.</p>}
        </div>
      )}

      {made && shown && (
        <div className="art-result">
          {/* What just happened, for someone who has never heard of BitGraph, above the image (Mike, 10-06, after trying it below: "i suppose this paragraph should be on top eh?": a square image fills the screen, so text under it sits below the fold). */}
          <div className="art-canvas">
            <canvas ref={canvas} width={made.manifest.width} height={made.manifest.height} style={{ aspectRatio: `${made.manifest.width} / ${made.manifest.height}` }} role="img" aria-label={`${made.recipe.v16 ? `Three shapes, ${describeV16(made.recipe.v16)},` : made.recipe.v14 || made.recipe.v13 || made.recipe.v12 || made.recipe.v11 ? "Portrait" : "Abstract image"} drawn from the code ${made.position.commitment}`} />
          </div>
          {/* The caption under the image (Mike, 10-06: "it should caption under image"). */}
          <p className="art-explain art-explain-one art-caption">{/* Mike, 10-06: "The proof for this image began before the image existed."; "the bits" from 10-07. Accurate: the position (the
                      proof's start) is opened and signed before the image is drawn; the signed record comes after. */}The proof for this {noun} began before the bits existed. It&rsquo;s an original: no one could have made it before your click, and no click will ever make it&nbsp;again.</p>
          {/* No code under the image (Mike, 10-06: "do they need to know this?"): the paragraph says it
              was drawn from a code; the code itself is under Technical details (Commitment). */}
          <div className="actions art-actions">
            {/* The next draw is the page's main action (Mike, 2026-10-08: "should draw another person be more distinctive"):
                the one blue button, first; the download is outlined with the rest. */}
            <button type="button" className="bg-action-link is-make" onClick={create}>{cfg.again}</button>
            <button type="button" className="bg-action-link" onClick={download} disabled={building && !built}>{building && !built ? "Preparing the download" : `Download ${noun}, proof inside`}</button>
            {/* Version 16's print master (Mike, 2026-10-09): the SVG the recorded PNG carries, for printing at any size. */}
            {made.recipe.v16 && made.checks.strip.result === "TRUE" && <button type="button" className="bg-action-link" onClick={downloadSvg}>Download SVG for print</button>}
            {/* For print (Mike, 10-06: "4 stacked buttons now 2 and 2 with one new one being the high res
                download for printing"): the same image redrawn at 4096 x 4096 from its code. */}
            {/* Copy proof link in place of Download for print (Mike, 2026-10-08: "proof pages are what ill share"): the
                reprint moved to the proof page, where anyone holding the link can make it. */}
            <button type="button" className="bg-action-link" onClick={copyProofLink}>{copied ? "Proof link copied" : "Copy proof link"}</button>
            <a className="bg-action-link" href={`/proof/${urlSafe(made.digestB64)}`}><span>See the full proof</span></a>
          </div>

          <details className="art-details">
            <summary className="art-details-title">Technical details</summary>
            <ol className="art-timeline">
              <li><span>{made.position.floorChain === "base" ? "Base" : "Ethereum"} block {made.position.floorBlock ? n(made.position.floorBlock) : ""}</span><span>{built?.floorTs ? utc(built.floorTs * 1000) : "the floor"}</span></li>
              <li><span>Position {n(made.position.slotCounter)} opened, commitment issued</span><span>after the floor</span></li>
              <li><span>Image drawn from the commitment</span><span>{made.recipe.v16 ? `three shapes, ${describeV16(made.recipe.v16)}, the print SVG inside the file` : made.recipe.v15 ? `painting, ${compositionNameV15(made.recipe.v15)}, ${paletteNameV15(made.recipe.v15)}, 256 bits in its pixels` : made.recipe.v14 ? `engraved portrait, ${PALETTE_NAMES_V11[made.recipe.v14.palette]}, ${AGE_BAND_NAMES_V11[ageBandV11(made.recipe.v14.age)]}, ${HAIR_NAMES_V11[made.recipe.v14.hair]}, ${EXPRESSION_NAMES_V11[made.recipe.v14.expr]}, 256 bits in its pixels` : made.recipe.v13 ? `engraved portrait, ${PALETTE_NAMES_V11[made.recipe.v13.palette]}, ${AGE_BAND_NAMES_V11[ageBandV11(made.recipe.v13.age)]}, ${HAIR_NAMES_V11[made.recipe.v13.hair]}, ${EXPRESSION_NAMES_V11[made.recipe.v13.expr]}, 256 bits in its pixels` : made.recipe.v12 ? `engraved portrait, ${PALETTE_NAMES_V11[made.recipe.v12.palette]}, ${AGE_BAND_NAMES_V11[ageBandV11(made.recipe.v12.age)]}, ${HAIR_NAMES_V11[made.recipe.v12.hair]}, ${EXPRESSION_NAMES_V11[made.recipe.v12.expr]}, 256 bits in its pixels` : made.recipe.v11 ? `ink portrait, ${PALETTE_NAMES_V11[made.recipe.v11.palette]}, ${AGE_BAND_NAMES_V11[ageBandV11(made.recipe.v11.age)]}, ${HAIR_NAMES_V11[made.recipe.v11.hair]}, ${EXPRESSION_NAMES_V11[made.recipe.v11.expr]}, 256 bits in its pixels` : made.recipe.v10 ? `flow field, ${STYLE_NAMES_V10[made.recipe.v10.style]}, ${DENSITY_NAMES_V10[made.recipe.v10.density]}, ${PALETTE_NAMES_V10[made.recipe.v10.palette]}, ${made.recipe.v10.segments.length.toLocaleString("en-US")} segments, 256 bits in its pixels` : made.recipe.v9 ? `five families, ${["strata", "interference", "cut paper", "blocks", "ribbons"][made.recipe.v9.dominant]} leading, ${made.recipe.v9.loud ? "loud" : "calm"}, 256 bits in its pixels` : made.recipe.v8 ? `${made.recipe.v8.layers.length} shapes, ${made.recipe.v8.loud ? "loud" : "calm"}, 256 bits in its pixels` : made.recipe.v7 ? `${made.recipe.v7.layers.length} layers, ${made.recipe.v7.loud ? "loud" : "calm"}, 256 bits in its colours` : made.recipe.v6 ? `${made.recipe.v6.layers.length} layers, ${made.recipe.v6.loud ? "loud" : "calm"}, 256 woven bits` : made.recipe.v5 ? `${made.recipe.v5.layers.length} layers, ${made.recipe.v5.loud ? "loud" : "calm"}` : made.recipe.grid === 16 ? "256 tiles, one bit each" : `${made.recipe.grid * made.recipe.grid} cells`}</span></li>
              <li><span>Recorded as <a href={`/proof/${urlSafe(made.digestB64)}`}>BitGraph #{counter}</a></span><span>{recordedMs ? utc(recordedMs) : ""}</span></li>
              <li className={built?.existedBy ? "" : "is-pending"}><span>{built?.existedBy ? `Existed by Base block ${n(built.existedBy.blockNumber)}` : "Base block"}</span><span>{built?.existedBy ? utc(built.existedBy.timestamp * 1000) : building ? "waiting for it" : "not in yet"}</span></li>
            </ol>
            <div className="art-detail-parts">
              <h3>What it proves</h3>
              <p>The image was drawn from its position&rsquo;s commitment, and that commitment did not exist until the position opened. So these exact bytes could not have been finished any earlier. That makes it original: it did not exist anywhere before that moment, and no later click will ever draw it again.</p>
              <p className="art-fine">Precisely: this image was generated from its position commitment and recorded in that position. Under the protocol&rsquo;s unpredictability assumptions, this exact commitment-bearing artifact could not have been completed before the commitment became available.</p>
              <h3>How it was drawn</h3>
              <p>{made.manifest.algorithm === ART_ALGORITHM_V16
                ? <>Every piece is three flat shapes on a flat ground, squares or rectangles that never touch, in red, yellow, blue and green: the ground is one of the four, and each shape one of the other three. Every size, position, gap and colour comes from the code ({made.manifest.algorithm}). The recorded file is a PNG, and it carries the print version inside it, an SVG of the same shapes in whole numbers on an 1800 by 1800 grid, so it prints sharp at any size; the proof covers both. The code is written into both files as text, and both are drawn again from the code and compared, byte for byte.</>
                : made.manifest.algorithm === "bitgraph-art/15"
                ? <>Every picture is a painting no one painted: an abstract oil painting whose every decision comes from the code ({made.manifest.algorithm}), the painter&rsquo;s choices for the day, the composition, each brush, its load of paint, how it twists, splays and runs dry, and the wet paint it picks up and drags, laid on linen and lit from the top left. The code is also written into the picture itself: a hidden grid of 256 tiles, one bit each, where one pixel per tile is its painted colour or that colour one level away in blue, so that its red, green and blue add up to an odd number exactly when the bit is 1, too slight to see. So two different codes can never make the same image, and the code can be read back from the picture alone.</>
                : made.manifest.algorithm === "bitgraph-art/14" || made.manifest.algorithm === "bitgraph-art/13"
                ? <>Every picture is a portrait of a person who does not exist: a head built from the code, its bones, features, age, hair, expression, gaze and the light on it all drawn from the code ({made.manifest.algorithm}), and rendered as an engraving, fine lines that follow the form and swell and thin like a burin cut, fading out where the light turns, every outline a smooth curve. The code is also written into the picture itself: a hidden grid of 256 tiles, one bit each, where one pixel per tile is drawn one shade away from its colour when the bit is 1, too slight to see. So two different codes can never make the same image, and the code can be read back from the picture alone.</>
                : made.manifest.algorithm === "bitgraph-art/12"
                ? <>Every picture is a portrait of a person who does not exist: a head built from the code, its bones, features, age, hair, expression, gaze and the light on it all drawn from the code ({made.manifest.algorithm}), and rendered as an engraving, fine lines that follow the form and swell and thin like a burin cut. The code is also written into the picture itself: a hidden grid of 256 tiles, one bit each, where one pixel per tile is drawn one shade away from its colour when the bit is 1, too slight to see. So two different codes can never make the same image, and the code can be read back from the picture alone.</>
                : made.manifest.algorithm === "bitgraph-art/11"
                ? <>Every picture is a portrait of a person who does not exist: a head built from the code, its bones, features, age, hair, expression, gaze and the light on it all drawn from the code ({made.manifest.algorithm}), and rendered as an etching, hatched lines that follow the form. The code is also written into the picture itself: a hidden grid of 256 tiles, one bit each, where one pixel per tile is drawn one shade away from its colour when the bit is 1, too slight to see. So two different codes can never make the same image, and the code can be read back from the picture alone.</>
                : made.manifest.algorithm === "bitgraph-art/10"
                ? <>Every picture is a flow field: hundreds to thousands of flat segments, from hairlines to broad bands, grown along a heading field and never overlapping, packed where a density field is high and absent where it is low, and every heading, width, colour and position comes from the code ({made.manifest.algorithm}). The code is also written into the picture itself: a hidden grid of 256 tiles, one bit each, where one pixel per tile is drawn one shade away from its colour when the bit is 1, too slight to see. So two different codes can never make the same image, and the code can be read back from the picture alone.</>
                : made.manifest.algorithm === "bitgraph-art/9"
                ? <>Every picture layers the same five families, strata, interference, cut paper, blocks and ribbons, one of them leading, and every shape, colour and position comes from the code ({made.manifest.algorithm}). The code is also written into the picture itself: a hidden grid of 256 tiles, one bit each, where one pixel per tile is drawn one shade away from its colour when the bit is 1, too slight to see. So two different codes can never make the same image, and the code can be read back from the picture alone.</>
                : made.manifest.algorithm === "bitgraph-art/8"
                ? <>Every shape, pattern, colour and mood comes from the code ({made.manifest.algorithm}). The code is also written into the picture itself: a hidden grid of 256 tiles, one bit each, where one pixel per tile is drawn one shade away from its colour when the bit is 1, too slight to see. So two different codes can never make the same image, and the code can be read back from the picture alone.</>
                : made.manifest.algorithm === "bitgraph-art/7"
                ? <>Every shape, pattern, colour and mood comes from the code ({made.manifest.algorithm}). The code is also written into the picture&rsquo;s colours: a hidden grid of 256 tiles, one bit each, where a tile whose bit is 1 is drawn in colours one shade away from the palette&rsquo;s, too close to see. Nothing in the picture moves to carry it, yet two different codes can never make the same image, and the code can be read back from the picture alone.</>
                : made.manifest.algorithm === "bitgraph-art/6"
                ? <>Every shape, pattern, colour and mood comes from the code ({made.manifest.algorithm}). The code is woven into the art itself: a hidden grid of 256 tiles, one bit each, where the pattern on top shifts slightly inside its tile so the tile&rsquo;s centre lands on the colour its bit calls for. That is the faint stitching you can see at the tile edges. So two different codes can never make the same image, and the code can be read back from the picture alone.</>
                : made.manifest.algorithm === "bitgraph-art/5"
                ? <>Every shape, pattern, colour and mood comes from the code ({made.manifest.algorithm}): which shapes, where, filled with which line fields, rings, bursts, dots or checks, whether calm or loud. The tick marks around the frame spell the code&rsquo;s 256 bits, one tick per bit, so two different codes can never make the same image, and the code can be read back from the picture alone.</>
                : made.manifest.algorithm === "bitgraph-art/4"
                ? <>The picture spells the code. Each of its 256 tiles is one bit: the arcs turn one way for a 0 and the other for a 1, and join into one pattern. So two different codes can never draw the same picture, and the code can be read back from the picture alone ({made.manifest.algorithm}).</>
                : <>The picture spells the code. Each of its 36 cells carries 7 of the code&rsquo;s 256 bits, the palette and the frame carry the rest, so two different codes can never draw the same picture, and the code can be read back from the picture alone ({made.manifest.algorithm}).</>} Anyone can redraw it and compare, pixel for pixel.</p>
              <h3>What it does not prove</h3>
              <p>Who made it, or anything about the computer it was made on.</p>
              <h3>The numbers</h3>
            </div>
            <dl>
              <dt>Algorithm</dt><dd><code>{made.manifest.algorithm}</code>, {made.manifest.width} x {made.manifest.height}</dd>
              <dt>Record</dt><dd>BitGraph #{counter}</dd>
              <dt>Position</dt><dd>opened at {n(made.position.slotCounter)}, epoch <code>{made.position.epochId.slice(0, 8)}</code>{made.position.floorBlock ? <>, after {made.position.floorChain === "base" ? "Base" : "Ethereum"} block {n(made.position.floorBlock)}</> : null}</dd>
              <dt>Commitment</dt><dd><code className="break">{made.position.commitment}</code></dd>
              <dt>Recipe SHA-256</dt><dd><code className="break">{made.manifest.recipeSha256}</code></dd>
              <dt>Pixels SHA-256</dt><dd><code className="break">{made.manifest.pixelsSha256}</code></dd>
              {made.recipe.v16 && printSvgSha && <><dt>Print SVG SHA-256</dt><dd><code className="break">{printSvgSha}</code></dd></>}
              <dt>Recorded file SHA-256</dt><dd><code className="break">{made.digestB64}</code> (base64)</dd>
            </dl>
          </details>
        </div>
      )}
    </div>
  );
}
