/**
 * The high resolution download (Mike, 2026-10-06: "make a download high resolution button", for
 * printing): the recorded image redrawn at four times the size, 4096 x 4096, from its commitment
 * (renderV6At / renderV7At). Same shapes, sharper lines. It is a redrawing for
 * print, not the recorded file: the proof covers the 1024 x 1024 image, and anyone can redraw this
 * one from the same code. Versions 6 and 7 (10-06: "just version 6 is fine", then version 7 came),
 * then the landscape versions 8 and 9 at three times their size.
 *
 * The drawing takes a few seconds on this thread; the button says so while it works.
 */
import { ART_ALGORITHM_V6, ART_ALGORITHM_V7, ART_ALGORITHM_V8, ART_ALGORITHM_V9, artSize, encodePrintPng, fromBase64Url } from "./commitment-art.ts";
import { planV6, renderV6At } from "./commitment-art-v6.ts";
import { planV7, renderV7At } from "./commitment-art-v7.ts";
import { planV8, renderV8At } from "./commitment-art-v8.ts";
import { planV9, renderV9At } from "./commitment-art-v9.ts";

export const PRINT_SCALE = 4;
export const PRINT_SIZE = 1024 * PRINT_SCALE;

export interface PrintRequest { commitment: string; counter: number; digestB64: string; algorithm?: string }

/** The versions that can be redrawn larger. */
export const PRINTABLE: readonly string[] = [ART_ALGORITHM_V6, ART_ALGORITHM_V7, ART_ALGORITHM_V8, ART_ALGORITHM_V9];
/** How much larger each version is drawn for print: versions 8 and 9 are landscape and already 1600 wide, so 3 times (4800 x 3072). */
export const printScaleOf = (algorithm: string): number => (algorithm === ART_ALGORITHM_V8 || algorithm === ART_ALGORITHM_V9 ? 3 : PRINT_SCALE);
export const printSizeOf = (algorithm: string): { width: number; height: number } => { const { width, height } = artSize(algorithm); const s = printScaleOf(algorithm); return { width: width * s, height: height * s }; };

/** Draw and encode, wherever this runs. */
export async function drawPrint(req: PrintRequest): Promise<Uint8Array> {
  const c = fromBase64Url(req.commitment);
  if (!c || c.length !== 32) throw new Error("not a position commitment");
  const algorithm = req.algorithm ?? ART_ALGORITHM_V6;
  if (!PRINTABLE.includes(algorithm)) throw new Error(`${algorithm} has no larger drawing`);
  const S = printScaleOf(algorithm), size = printSizeOf(algorithm);
  const px = algorithm === ART_ALGORITHM_V9 ? renderV9At(planV9(c), c, S) : algorithm === ART_ALGORITHM_V8 ? renderV8At(planV8(c), c, S) : algorithm === ART_ALGORITHM_V7 ? renderV7At(planV7(c), c, S) : renderV6At(planV6(c), c, S);
  const rec = artSize(algorithm);
  return encodePrintPng(px, size.width, size.height, {
    what: `A larger redrawing, for print, of BitGraph #${req.counter}`,
    recordedFile: `sha256 ${req.digestB64}, ${algorithm}, ${rec.width} x ${rec.height}`,
    scale: S,
    note: `The proof covers the recorded ${rec.width} x ${rec.height} file. This one is drawn from the same code at ${S} times the size.`,
  });
}

/** Draw after the page has painted the button's "Drawing" state. */
export async function makePrint(req: PrintRequest): Promise<Uint8Array> {
  await new Promise((r) => setTimeout(r, 50));
  return drawPrint(req);
}
