/**
 * The high resolution download (Mike, 2026-10-06: "make a download high resolution button", for
 * printing): the recorded image redrawn at four times the size, 4096 x 4096, from its commitment
 * (commitment-art-v6.ts renderV6At). Same shapes, same weave, sharper lines. It is a redrawing for
 * print, not the recorded file: the proof covers the 1024 x 1024 image, and anyone can redraw this
 * one from the same code. Version 6 only (Mike: "just version 6 is fine").
 *
 * The drawing takes a few seconds on this thread; the button says so while it works.
 */
import { ART_ALGORITHM_V6, encodePrintPng, fromBase64Url } from "./commitment-art.ts";
import { planV6, renderV6At } from "./commitment-art-v6.ts";

export const PRINT_SCALE = 4;
export const PRINT_SIZE = 1024 * PRINT_SCALE;

export interface PrintRequest { commitment: string; counter: number; digestB64: string }

/** Draw and encode, wherever this runs. */
export async function drawPrint(req: PrintRequest): Promise<Uint8Array> {
  const c = fromBase64Url(req.commitment);
  if (!c || c.length !== 32) throw new Error("not a position commitment");
  const px = renderV6At(planV6(c), c, PRINT_SCALE);
  return encodePrintPng(px, PRINT_SIZE, PRINT_SIZE, {
    what: `A larger redrawing, for print, of BitGraph #${req.counter}`,
    recordedFile: `sha256 ${req.digestB64}, ${ART_ALGORITHM_V6}, 1024 x 1024`,
    scale: PRINT_SCALE,
    note: "The proof covers the recorded 1024 x 1024 file. This one is drawn from the same code at four times the size.",
  });
}

/** Draw after the page has painted the button's "Drawing" state. */
export async function makePrint(req: PrintRequest): Promise<Uint8Array> {
  await new Promise((r) => setTimeout(r, 50));
  return drawPrint(req);
}
