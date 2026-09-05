/**
 * The scan's hasher: one pass over a file's bytes that yields its digest AND
 * the hasher's saved state, so a trailer/1 member's fused digest can be
 * finished later, for whatever slot commitment the set is made under,
 * without reading the file again. The browser's native SHA-256 cannot save
 * its state, so the pass runs a WebAssembly SHA-256 (hash-wasm) in chunks;
 * the drop's workers run one each, which keeps the scan at disk speed.
 *
 * Node-testable on purpose: nothing here touches the DOM, and the tests pin
 * that the digest equals the native one and that a state finished with the
 * placement's own trailer equals the hash of the placement's own build.
 */
import { createSHA256, type IHasher } from "hash-wasm";
import { placementForBytes } from "@mikeargento/bitgraph";
import type { SitePlacement } from "./fuse-placement";

export interface ScanHash {
  /** SHA-256 of the whole file, standard base64. */
  digestB64: string;
  /** Decided from the first bytes, as the fuse does. */
  placement: SitePlacement;
  /**
   * The hasher's state after the last byte, for a trailer/1 file; null for a
   * container/1 file, whose fused bytes put the slot data BEFORE the
   * original, so its fused digest needs the bytes again.
   */
  state: Uint8Array | null;
  bytes: number;
}

/** Bytes the placement decision needs: every magic number placementForBytes reads sits in the first 16. */
const SNIFF = 64;

const toB64 = (b: Uint8Array): string => {
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]!);
  return btoa(s);
};

/**
 * Hash a stream of chunks. The placement is decided from the first chunk
 * (a chunk shorter than SNIFF is joined with the next until enough bytes
 * are in hand, or the stream ends).
 */
export async function hashChunks(chunks: AsyncIterable<Uint8Array>): Promise<ScanHash> {
  const h: IHasher = await createSHA256();
  h.init();
  let head: Uint8Array | null = null;
  let placement: SitePlacement | null = null;
  let bytes = 0;
  for await (const chunk of chunks) {
    if (placement === null) {
      head = head === null ? chunk : concat(head, chunk);
      if (head.length >= SNIFF) {
        placement = placementForBytes(head.subarray(0, SNIFF));
        h.update(head);
        head = null;
      }
    } else {
      h.update(chunk);
    }
    bytes += chunk.length;
  }
  if (placement === null) {
    // A short file: decide from what there is, then hash it.
    placement = placementForBytes(head ?? new Uint8Array(0));
    if (head !== null) h.update(head);
  }
  const state = placement === "trailer/1" ? h.save() : null;
  const digest = h.digest("binary");
  return { digestB64: toB64(digest), placement, state, bytes };
}

/** Hash a Blob or File by streaming it. */
export async function hashBlob(blob: Blob): Promise<ScanHash> {
  return hashChunks(readChunks(blob));
}

async function* readChunks(blob: Blob): AsyncIterable<Uint8Array> {
  const reader = blob.stream().getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      if (value !== undefined) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * The fused digest of a trailer/1 member from its saved state and the 48
 * trailer bytes (trailerBytesFor(commitment) in the core): the hash of the
 * original followed by the trailer, which is exactly the placement's build.
 */
export async function finishTrailer(state: Uint8Array, trailer: Uint8Array): Promise<Uint8Array> {
  const h = await createSHA256();
  h.load(state);
  h.update(trailer);
  return h.digest("binary");
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
