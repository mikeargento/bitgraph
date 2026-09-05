/**
 * The scan's hasher: one pass over a file's bytes that yields its digest AND
 * the hasher's saved state, so a member's fused digest can be finished later,
 * for whatever slot commitment the set is made under, without reading the
 * file again. A placement is prefix, original, suffix (its frame); when the
 * prefix depends on the file's size alone (trailer/1: nothing; container/2:
 * the original's tar header) the state after prefix and original is saved
 * and the suffix, which carries the commitment, is added at BitGraph time.
 * The browser's native SHA-256 cannot save its state, so the pass runs a
 * WebAssembly SHA-256 (hash-wasm) in chunks; the drop's workers run one
 * each, which keeps the scan at disk speed.
 *
 * Node-testable on purpose: nothing here touches the DOM, and the tests pin
 * that the digest equals the native one and that a saved state finished with
 * the placement's own suffix equals the hash of the placement's own build.
 */
import { createSHA256, type IHasher } from "hash-wasm";
import { placementForBytes } from "@mikeargento/bitgraph";
import { getPlacement } from "@mikeargento/bitgraph-verify";
import type { SitePlacement } from "./fuse-placement";

export interface ScanHash {
  /** SHA-256 of the whole file, standard base64. */
  digestB64: string;
  /** Decided from the first bytes, as the fuse does. */
  placement: SitePlacement;
  /**
   * The hasher's state after the placement's prefix and the last byte of the
   * file, when the placement's prefix depends on the size alone; null when
   * the size was unknown or the placement puts the commitment before the
   * original (container/1), so its fused digest needs the bytes again.
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
 * Hash a stream of chunks. The placement is decided from the first chunk (a
 * chunk shorter than SNIFF is joined with the next until enough bytes are in
 * hand, or the stream ends). `size` is the file's length, needed for a
 * prefix that carries it; without it only a prefix-free placement saves a
 * state.
 */
export async function hashChunks(chunks: AsyncIterable<Uint8Array>, size?: number): Promise<ScanHash> {
  const origin: IHasher = await createSHA256();
  origin.init();
  // A second hasher runs over prefix and bytes when the prefix is not empty;
  // with an empty prefix the origin hasher's own state is the fused state.
  // (Held in one object: the closures below assign it, which the type
  // checker's narrowing of a plain variable would not see.)
  const run: { fused: IHasher | null; stateless: boolean; placement: SitePlacement | null } = { fused: null, stateless: false, placement: null };
  let head: Uint8Array | null = null;
  let bytes = 0;
  const start = async (p: SitePlacement) => {
    run.placement = p;
    const prefix = size === undefined ? null : getPlacement(p)?.scanPrefix?.(size) ?? null;
    if (prefix === null) run.stateless = true;
    else if (prefix.length > 0) {
      const h = await createSHA256();
      h.init();
      h.update(prefix);
      run.fused = h;
    }
  };
  const feed = (chunk: Uint8Array) => {
    origin.update(chunk);
    if (run.fused !== null) run.fused.update(chunk);
  };
  for await (const chunk of chunks) {
    if (run.placement === null) {
      head = head === null ? chunk : concat(head, chunk);
      if (head.length >= SNIFF) {
        await start(placementForBytes(head.subarray(0, SNIFF)));
        feed(head);
        head = null;
      }
    } else {
      feed(chunk);
    }
    bytes += chunk.length;
  }
  if (run.placement === null) {
    // A short file: decide from what there is, then hash it.
    await start(placementForBytes(head ?? new Uint8Array(0)));
    if (head !== null) feed(head);
  }
  if (size !== undefined && bytes !== size) run.stateless = true;
  const state = run.stateless ? null : run.fused !== null ? run.fused.save() : origin.save();
  const digest = origin.digest("binary");
  return { digestB64: toB64(digest), placement: run.placement!, state, bytes };
}

/** Hash a Blob or File by streaming it. */
export async function hashBlob(blob: Blob): Promise<ScanHash> {
  return hashChunks(readChunks(blob), blob.size);
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
 * The fused digest of a member from its saved state and the placement's
 * suffix for the slot (getPlacement(id).frame({...}).suffix): the hash of
 * prefix, original, suffix, which is exactly the placement's build.
 */
export async function finishState(state: Uint8Array, suffix: Uint8Array): Promise<Uint8Array> {
  const h = await createSHA256();
  h.load(state);
  h.update(suffix);
  return h.digest("binary");
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
