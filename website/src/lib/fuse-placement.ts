/**
 * Which registered placement the public drop uses for a file (profile
 * bitgraph-fuse/1). Decided from the bytes, never the extension.
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
export type SitePlacement = "trailer/1" | "container/1";

const startsWith = (b: Uint8Array, sig: number[], at = 0): boolean =>
  b.length >= at + sig.length && sig.every((v, i) => b[at + i] === v);

/** True when the bytes are one of the formats known to ignore trailing data. */
export function toleratesTrailer(bytes: Uint8Array): boolean {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return true; // JPEG
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return true; // PNG
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return true; // GIF87a / GIF89a
  if (startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) || startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a])) return true; // TIFF, DNG, CR2, NEF, ARW
  if (startsWith(bytes, [0x42, 0x4d]) && bytes.length >= 14) return true; // BMP
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && bytes.length >= 12) return true; // RIFF: WebP, WAV, AVI
  return false;
}

export function placementFor(bytes: Uint8Array): SitePlacement {
  return toleratesTrailer(bytes) ? "trailer/1" : "container/1";
}

/** Names for what the visitor may download: the fused bytes and the Frame. */
export function fusedNames(originalName: string, placement: SitePlacement): { fusedName: string; frameName: string } {
  const dot = originalName.lastIndexOf(".");
  const stem = dot > 0 ? originalName.slice(0, dot) : originalName;
  const ext = dot > 0 ? originalName.slice(dot) : "";
  return {
    fusedName: placement === "trailer/1" ? `${stem}.fused${ext}` : `${stem}.fused.tar`,
    frameName: `${originalName}.bitgraph-fuse.json`,
  };
}

/** Files above this are recorded rather than fused: the fused bytes are built in memory in the browser. */
export const MAX_FUSE_BYTES = 256 * 1024 * 1024;
