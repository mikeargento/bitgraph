/**
 * Which registered placement the public drop uses for a file (profile
 * bitgraph-fuse/1). Decided from the bytes, never the extension. The policy
 * itself lives in the core package (placementForBytes), so the site, the CLI
 * and both MCP servers make the same choice for the same bytes.
 *
 * trailer/1 appends 48 bytes after the file's own end. That is safe only for
 * formats whose decoders stop at an internal end marker or read by declared
 * sizes, so trailing bytes are ignored: JPEG (EOI), PNG (IEND), GIF (0x3B),
 * TIFF and the TIFF-based raws such as DNG, CR2, NEF, ARW (offset tables),
 * BMP (declared size) and RIFF containers such as WebP, WAV, AVI (declared
 * chunk size). Everything else goes into container/1, a tar that carries the
 * original untouched: PDF (%%EOF is expected near the end), ZIP-based files
 * including Office documents and EPUB (the end-of-central-directory record
 * is found by scanning back from the end), ISO base media video and images
 * such as MP4, MOV, HEIC, AVIF (box-structured to the end), Matroska and
 * WebM, MP3 (ID3v1 tags are read from the last 128 bytes), structured text
 * such as JSON, XML, HTML, SVG (a trailer makes them invalid), plain text and
 * anything unrecognised.
 */
import { fusedNamesFor, placementForBytes } from "@mikeargento/bitgraph";

export type SitePlacement = "trailer/1" | "container/1";

/** True when the bytes are one of the formats known to ignore trailing data. */
export function toleratesTrailer(bytes: Uint8Array): boolean {
  return placementForBytes(bytes) === "trailer/1";
}

export function placementFor(bytes: Uint8Array): SitePlacement {
  return placementForBytes(bytes);
}

/** Names for what the visitor may download: the fused bytes and the Frame. */
export function fusedNames(originalName: string, placement: SitePlacement): { fusedName: string; frameName: string } {
  return fusedNamesFor(originalName, placement);
}

/** Files above this are recorded rather than fused: the fused bytes are built in memory in the browser. */
export const MAX_FUSE_BYTES = 256 * 1024 * 1024;
