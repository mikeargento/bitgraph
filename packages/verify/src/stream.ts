// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * Streaming checks of a file against a tree leaf (2026-10-03): constant
 * memory, one pass over the bytes, any size. The tree/1 format needs nothing
 * for this; it is how a verifier judges a 40 GB file on a laptop or in a
 * browser tab, where reading it whole is impossible. The in-memory path
 * (verifyTreeMember with `bytes`) and this one give the same category for the
 * same bytes; a test holds them equal over every placement.
 *
 * Three hypotheses run in the same pass, each with its own hasher:
 *   - the bytes are the file as handed in, the ORIGIN of a placed leaf:
 *     SHA-256(prefix || bytes || suffix) for the leaf's placement, the frame
 *     built exactly as a producer builds it (the origin a container's
 *     manifest names is the leaf's);
 *   - the bytes are the COMMITTED bytes of a placed leaf: the stream must be
 *     exactly prefix || original || suffix for that placement. The original's
 *     length comes from the layout (the ustar header for a container, the
 *     last 48 bytes for the trailer), the manifest is parsed where it lies
 *     and the frame rebuilt from it, and the original inside is hashed as it
 *     passes;
 *   - the plain SHA-256 of every byte, which decides which hypothesis applies.
 * A fourth pass-along asks whether the bytes carry this commitment under
 * ANY placement (the in-memory check tries every placement's locate), for
 * the "carries the commitment but is not this leaf" verdict: the last 48
 * bytes as a trailer, or the container layout the first block announces,
 * whose original inside is hashed by a second small machine when it is not
 * the placement already being checked.
 */

import { sha256 } from "@noble/hashes/sha256";
import { bytesEqual, getPlacement, parseFusePayload, CONTAINER_MANIFEST_PATH, CONTAINER_ORIGINAL_PATH, TRAILER_LENGTH, TRAILER_MAGIC, type Placement } from "./fuse.js";

/** Bytes that can be read as chunks, more than once. A File, a Blob, or a path opened each time. */
export interface ByteSource {
  size: number;
  stream(): AsyncIterable<Uint8Array>;
}

export function bytesSource(bytes: Uint8Array): ByteSource {
  return {
    size: bytes.length,
    async *stream() {
      yield bytes;
    },
  };
}

/** A Blob or File (browser or Node) as a source. */
export function blobSource(blob: { size: number; stream(): ReadableStream<Uint8Array> }): ByteSource {
  return {
    size: blob.size,
    async *stream() {
      const reader = blob.stream().getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return;
          if (value !== undefined && value.length > 0) yield value;
        }
      } finally {
        reader.releaseLock();
      }
    },
  };
}

export type StreamPlacement = "trailer/1" | "container/1" | "container/2";

export interface StreamLeafCheck {
  /** Bytes streamed; the source's size must agree. */
  size: number;
  /** SHA-256 of every byte. */
  digest: Uint8Array;
  /** The first 64 bytes (or fewer): what a placement choice reads. */
  head: Uint8Array;
  /** The origin hypothesis: SHA-256 of the placement's frame around these bytes. Null when no placement was asked, or container/1 was asked without an origin (its prefix carries it). */
  fusedFromOrigin: Uint8Array | null;
  /** The committed-bytes hypothesis for the placement asked: the layout held and the original inside hashes to embeddedOrigin, or why not. Null when no placement was asked. */
  direct: { ok: true; embeddedOrigin: Uint8Array; originalSize: number } | { ok: false; reason: string } | null;
  /** True when the bytes carry this commitment under some placement: a trailer at their end, or a container whose manifest names it and whose original inside hashes to the origin it names. */
  carriesCommitment: boolean;
}

const HEAD = 64;
const BLOCK = 512;
const MANIFEST_BYTES = 250;
const padTo = (n: number) => (BLOCK - (n % BLOCK)) % BLOCK;

/** The original's length from a ustar header's size field: 11 octal digits at offset 124. */
function ustarSize(header: Uint8Array): number | null {
  if (header.length < BLOCK) return null;
  let n = 0;
  for (let i = 124; i < 135; i++) {
    const c = header[i]!;
    if (c < 0x30 || c > 0x37) return null;
    n = n * 8 + (c - 0x30);
  }
  return header[135] === 0 ? n : null;
}

/** Where the manifest and the original's header sit, and how long the prefix is, for each container layout. */
const LAYOUT = {
  "container/1": { prefixLength: BLOCK + MANIFEST_BYTES + padTo(MANIFEST_BYTES) + BLOCK, manifestAt: BLOCK, originalHeaderAt: BLOCK + MANIFEST_BYTES + padTo(MANIFEST_BYTES) },
  "container/2": { prefixLength: BLOCK, manifestAt: null, originalHeaderAt: 0 },
} as const;

function concat(a: Uint8Array, b: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** SHA-256 of a source, streamed. */
export async function streamDigest(source: ByteSource): Promise<Uint8Array> {
  const h = sha256.create();
  for await (const chunk of source.stream()) h.update(chunk);
  return h.digest();
}

/**
 * One pass over a source for the hypotheses above. `origin` is the leaf's
 * origin when a leaf is in hand (the origin a producer wrote into a
 * container's manifest); null when only the bytes' own digest will do.
 */
export async function streamLeafCheck(source: ByteSource, opts: { placement: StreamPlacement | null; commitment: Uint8Array; origin: Uint8Array | null }): Promise<StreamLeafCheck> {
  const { placement, commitment } = opts;
  if (commitment.length !== 32) throw new TypeError("commitment must be 32 bytes");
  const size = source.size;
  if (!Number.isSafeInteger(size) || size < 0) throw new TypeError("the source's size must be a non-negative integer");
  const p: Placement | null = placement === null ? null : getPlacement(placement) ?? null;
  if (placement !== null && (p === null || p.frame === undefined)) throw new TypeError(`${placement} is not a streamable placement`);

  const whole = sha256.create();
  let head: Uint8Array = new Uint8Array(0);

  // The origin hypothesis: the frame around a file of exactly `size` bytes.
  let fused: ReturnType<typeof sha256.create> | null = null;
  let fusedSuffix: Uint8Array | null = null;
  if (p !== null) {
    const originForFrame = opts.origin ?? (placement === "container/1" ? null : new Uint8Array(32));
    if (originForFrame !== null) {
      const frame = p.frame!({ originalSize: size, originDigest: originForFrame, commitment });
      fused = sha256.create();
      fused.update(frame.prefix);
      fusedSuffix = frame.suffix;
    }
  }

  // The committed-bytes hypothesis: prefix || original || suffix, read in
  // place. One machine for the placement asked; a second for the layout the
  // first block announces, when that differs, so "carries the commitment"
  // is judged the way the in-memory locate judges it.
  class Machine {
    readonly p: Placement;
    readonly prefixLength: number;
    originalSize: number | null = null;
    prefix: Uint8Array = new Uint8Array(0);
    suffix: Uint8Array = new Uint8Array(0);
    readonly embedded = sha256.create();
    failed: string | null = null;
    constructor(readonly id: StreamPlacement) {
      this.p = getPlacement(id)!;
      this.prefixLength = id === "trailer/1" ? 0 : LAYOUT[id].prefixLength;
      if (id === "trailer/1") {
        if (size < TRAILER_LENGTH) this.failed = "shorter than a trailer";
        else this.originalSize = size - TRAILER_LENGTH;
      } else if (size < this.prefixLength) {
        this.failed = "shorter than the container's headers";
      }
    }
    /** The prefix is in hand: the original's length from its header, and the size must fit the layout. */
    private settle(): void {
      const headerAt = LAYOUT[this.id as "container/1" | "container/2"].originalHeaderAt;
      const n = ustarSize(this.prefix.subarray(headerAt, headerAt + BLOCK));
      if (n === null) { this.failed = "the original's ustar header does not carry a size"; return; }
      const frame = this.p.frame!({ originalSize: n, originDigest: new Uint8Array(32), commitment });
      if (size !== frame.prefix.length + n + frame.suffix.length) { this.failed = "the file's length does not fit the container layout its header states"; return; }
      this.originalSize = n;
    }
    feed(chunk: Uint8Array, at: number): void {
      if (this.failed !== null) return;
      let off = 0;
      if (at < this.prefixLength) {
        const take = Math.min(chunk.length, this.prefixLength - at);
        this.prefix = concat(this.prefix, chunk.subarray(0, take));
        off = take;
        if (this.prefix.length === this.prefixLength && this.originalSize === null) this.settle();
      }
      if (this.failed === null && this.originalSize !== null && off < chunk.length) {
        const originalEnd = this.prefixLength + this.originalSize;
        const here = at + off;
        if (here < originalEnd) {
          const take = Math.min(chunk.length - off, originalEnd - here);
          this.embedded.update(chunk.subarray(off, off + take));
          off += take;
        }
        if (off < chunk.length) this.suffix = concat(this.suffix, chunk.subarray(off));
      }
    }
    finish(): StreamLeafCheck["direct"] {
      if (this.failed !== null) return { ok: false, reason: this.failed };
      if (this.originalSize === null) return { ok: false, reason: "the stream ended inside the container's headers" };
      const embeddedOrigin = this.embedded.digest();
      let manifestOrigin: Uint8Array | null = null;
      let frameOk = false;
      if (this.id === "trailer/1") {
        frameOk = bytesEqual(this.suffix, this.p.frame!({ originalSize: this.originalSize, originDigest: embeddedOrigin, commitment }).suffix);
        manifestOrigin = embeddedOrigin;
      } else {
        const manifestBytes = this.id === "container/1"
          ? this.prefix.subarray(LAYOUT["container/1"].manifestAt, LAYOUT["container/1"].manifestAt + MANIFEST_BYTES)
          : this.suffix.subarray(padTo(this.originalSize) + BLOCK, padTo(this.originalSize) + BLOCK + MANIFEST_BYTES);
        const manifest = parseFusePayload(manifestBytes);
        if (manifest !== null && manifest.originDigest !== undefined && bytesEqual(manifest.commitment, commitment)) {
          manifestOrigin = manifest.originDigest;
          const expected = this.p.frame!({ originalSize: this.originalSize, originDigest: manifestOrigin, commitment });
          frameOk = bytesEqual(this.prefix, expected.prefix) && bytesEqual(this.suffix, expected.suffix);
        }
      }
      if (!frameOk) return { ok: false, reason: `the bytes are not a ${this.id} carrying this position's commitment` };
      if (manifestOrigin === null || !bytesEqual(manifestOrigin, embeddedOrigin)) return { ok: false, reason: `the original inside the ${this.id} does not hash to the origin its manifest names` };
      return { ok: true, embeddedOrigin, originalSize: this.originalSize };
    }
  }
  const asked: Machine | null = placement === null ? null : new Machine(placement);
  let guessed: Machine | null = null;
  // Bytes seen before the first block is whole, replayed into a machine made late.
  let early: Uint8Array = new Uint8Array(0);
  let decided = false;
  const trailerMagic = new TextEncoder().encode(TRAILER_MAGIC);
  let tail: Uint8Array = new Uint8Array(0);

  let pos = 0;
  for await (const chunk of source.stream()) {
    if (chunk.length === 0) continue;
    if (pos + chunk.length > size) throw new RangeError("the source yielded more bytes than its size");
    whole.update(chunk);
    if (fused !== null) fused.update(chunk);
    if (head.length < HEAD) head = concat(head, chunk.subarray(0, HEAD - head.length));
    tail = concat(tail, chunk).subarray(-TRAILER_LENGTH);
    if (asked !== null) asked.feed(chunk, pos);
    if (!decided) {
      early = concat(early, chunk);
      if (early.length >= BLOCK || pos + chunk.length === size) {
        decided = true;
        const layout = containerLayoutOf(early.subarray(0, BLOCK));
        if (layout !== null && layout !== placement) {
          guessed = new Machine(layout);
          guessed.feed(early, 0);
        }
        early = new Uint8Array(0);
      }
    } else if (guessed !== null) {
      guessed.feed(chunk, pos);
    }
    pos += chunk.length;
  }
  if (pos !== size) throw new RangeError(`the source yielded ${pos} bytes; its size says ${size}`);

  const digest = whole.digest();
  let fusedFromOrigin: Uint8Array | null = null;
  if (fused !== null && fusedSuffix !== null) {
    fused.update(fusedSuffix);
    fusedFromOrigin = fused.digest();
  }
  const directResult = asked === null ? null : asked.finish();

  // Carries this commitment under some placement: a trailer at the end (as the
  // in-memory locate, no origin check), or the announced container layout.
  const trailerCarries = size >= TRAILER_LENGTH
    && bytesEqual(tail.subarray(0, 8), trailerMagic)
    && tail.subarray(8, 16).every((b) => b === 0)
    && bytesEqual(tail.subarray(16, 48), commitment);
  const containerCarries = (placement !== "trailer/1" && directResult?.ok === true) || (guessed !== null && guessed.finish()?.ok === true);
  const carries = trailerCarries || containerCarries;

  return { size, digest, head, fusedFromOrigin, direct: directResult, carriesCommitment: carries };
}

/** The container layout a first block announces, by its ustar magic and entry name; null for anything else (a trailer file, or no placement). */
function containerLayoutOf(block: Uint8Array): "container/1" | "container/2" | null {
  if (block.length < BLOCK) return null;
  if (new TextDecoder().decode(block.subarray(257, 263)) !== "ustar\0") return null;
  const end = block.subarray(0, 100).indexOf(0);
  const name = new TextDecoder().decode(block.subarray(0, end < 0 ? 100 : end));
  if (name === CONTAINER_MANIFEST_PATH) return "container/1";
  if (name === CONTAINER_ORIGINAL_PATH) return "container/2";
  return null;
}
