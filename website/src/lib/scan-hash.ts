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
  const origin: IHasher = await takeHasher();
  origin.init();
  // A second hasher runs over prefix and bytes when the prefix is not empty;
  // with an empty prefix the origin hasher's own state is the fused state.
  // (Held in one object: the closures below assign it, which the type
  // checker's narrowing of a plain variable would not see.)
  const run: { fused: IHasher | null; stateless: boolean; placement: SitePlacement | null } = { fused: null, stateless: false, placement: null };
  try {
  let head: Uint8Array | null = null;
  let bytes = 0;
  const start = async (p: SitePlacement) => {
    run.placement = p;
    const prefix = size === undefined ? null : getPlacement(p)?.scanPrefix?.(size) ?? null;
    if (prefix === null) run.stateless = true;
    else if (prefix.length > 0) {
      const h = await takeHasher();
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
  } finally {
    giveHasher(origin);
    giveHasher(run.fused);
  }
}

/** Hash a Blob or File by streaming it. */
/**
 * Files read whole rather than streamed. Above this, streaming keeps a large
 * file out of memory; below it, streaming is nearly all overhead.
 */
const WHOLE_READ_MAX = 4 * 1024 * 1024;

export async function hashBlob(blob: Blob): Promise<ScanHash> {
  // ⚠️ A SMALL FILE IS READ IN ONE CALL. blob.stream().getReader() builds a
  // ReadableStream and does two async reads to fetch 57 bytes, which measured
  // 24.8us a file against 1.8us for arrayBuffer(), fourteen times the cost
  // (2026-09-07). A 48,000 file drop spends that per file and none of it is
  // hashing. Large files still stream so one of them is never held whole.
  return hashChunks(blob.size <= WHOLE_READ_MAX ? oneChunk(blob) : readChunks(blob), blob.size);
}

async function* oneChunk(blob: Blob): AsyncIterable<Uint8Array> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  // ⚠️ An empty file yields NOTHING, exactly as the stream does. Yielding one
  // empty chunk instead feeds a zero-length update to the hasher, and the
  // state it then saves is not the state the streamed path saves, so a
  // zero-byte member would finish to a different fused digest than a verifier
  // recomputes. Caught by the equivalence test at 0 bytes.
  if (bytes.length > 0) yield bytes;
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
/**
 * One hasher, reused.
 *
 * ⚠️ THIS USED TO CALL createSHA256() PER MEMBER, and that is what made fusing
 * a large set take minutes. Node caches the compiled module so a fresh
 * instance costs 0.03ms there, which is why it never showed up in a bench; a
 * browser pays a real WebAssembly.instantiate every time. Measured on the live
 * site 2026-09-07: a 48,000 member set spent 85.3s of a 94.3s run in this
 * function, 1.78ms a member, which is instantiation and nothing else.
 *
 * Reuse is safe because load/update/digest run with no await between them, so
 * a call owns the instance for its whole sequence however many callers there
 * are. The promise is cached rather than the hasher so concurrent first calls
 * cannot each build one.
 */
let finisher: Promise<IHasher> | null = null;

/**
 * Hashers for the scan, returned when a file is done.
 *
 * Same instantiation cost as finishState, paid twice per file here (one for
 * the origin, one for the fused prefix), so a 48,000 file scan built 96,000
 * WebAssembly instances. Unlike finishState these are held across the whole
 * read, with awaits throughout, so two scans can overlap and a single shared
 * instance would corrupt both. A free list reuses what is idle and builds one
 * only when everything is busy.
 */
const idle: IHasher[] = [];
const takeHasher = async (): Promise<IHasher> => idle.pop() ?? (await createSHA256());
const giveHasher = (h: IHasher | null): void => { if (h !== null && idle.length < 8) idle.push(h); };

export async function finishState(state: Uint8Array, suffix: Uint8Array): Promise<Uint8Array> {
  finisher ??= createSHA256();
  const h = await finisher;
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
