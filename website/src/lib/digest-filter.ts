/**
 * A membership filter over every digest the ledger indexes.
 *
 * The lookup's cost is one S3 listing per digest, so a 30,000-file drop is
 * 30,000 listings and no amount of batching removes them (measured
 * 2026-09-07: 500-per-request only halved a 99 second wait). Nearly all of
 * those listings return nothing, because nearly every file in a big drop is
 * new. This filter answers "certainly not on record" from memory, so only the
 * few that might be there cost a read.
 *
 * A Bloom filter, not a set of strings: 1.5 million digests as JavaScript
 * strings is hundreds of megabytes, while the filter is a couple of megabytes
 * and answers in constant time. The trade is false positives, which are
 * harmless here: a digest the filter thinks might be present gets the same
 * real lookup it gets today, so a false positive costs one read and never a
 * wrong answer. False negatives are impossible by construction, which is the
 * property the whole thing rests on: what the filter rejects is genuinely
 * absent, as of what it has been told.
 *
 * ⚠️ "As of what it has been told" is the only way this can be wrong. A digest
 * written after the filter last learned about it would be reported absent,
 * which would tell someone their recorded file is not on record. Freshness is
 * therefore not optional and not this file's job: see digest-index.ts, which
 * folds a journal of recent writes into the filter before every use, and falls
 * back to the plain lookup whenever it cannot.
 */

/** FNV-1a over the bytes, 32-bit, as the base for the k hashes. */
function fnv1a(bytes: Uint8Array, seed: number): number {
  let h = (2166136261 ^ seed) >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]!;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export interface BloomParams {
  /** Bits in the filter. */
  m: number;
  /** Hashes per item. */
  k: number;
}

/** Bits and hashes for n items at false-positive rate p, the standard sizing. */
export function bloomParamsFor(n: number, p = 0.001): BloomParams {
  const m = Math.ceil((-n * Math.log(p)) / (Math.LN2 * Math.LN2));
  const k = Math.max(1, Math.round((m / n) * Math.LN2));
  return { m, k };
}

export class DigestFilter {
  readonly m: number;
  readonly k: number;
  private readonly bits: Uint8Array;
  /** How many digests have been added. Advisory: the filter cannot count. */
  private added = 0;

  constructor(params: BloomParams, bits?: Uint8Array) {
    this.m = params.m;
    this.k = params.k;
    const bytes = Math.ceil(params.m / 8);
    if (bits !== undefined && bits.length !== bytes) throw new RangeError(`filter needs ${bytes} bytes, got ${bits.length}`);
    this.bits = bits ?? new Uint8Array(bytes);
  }

  get size(): number { return this.added; }
  get byteLength(): number { return this.bits.length; }

  private *positions(key: string): Generator<number> {
    const bytes = new TextEncoder().encode(key);
    // Two hashes generate k, the standard Kirsch-Mitzenmacher construction.
    const a = fnv1a(bytes, 0);
    const b = fnv1a(bytes, 0x9e3779b9) | 1;
    for (let i = 0; i < this.k; i++) yield ((a + Math.imul(i, b)) >>> 0) % this.m;
  }

  add(key: string): void {
    for (const p of this.positions(key)) this.bits[p >>> 3]! |= 1 << (p & 7);
    this.added++;
  }

  /** False means CERTAINLY absent. True means possibly present, and must be checked. */
  has(key: string): boolean {
    for (const p of this.positions(key)) if ((this.bits[p >>> 3]! & (1 << (p & 7))) === 0) return false;
    return true;
  }

  /** header (32 bytes) then the bit array: magic, version, m, k, added. */
  serialize(): Uint8Array {
    const out = new Uint8Array(32 + this.bits.length);
    const view = new DataView(out.buffer);
    out.set(new TextEncoder().encode("BGDIGEST"), 0);
    view.setUint32(8, 1, false);
    view.setUint32(12, this.m, false);
    view.setUint32(16, this.k, false);
    view.setUint32(20, this.added, false);
    out.set(this.bits, 32);
    return out;
  }

  static parse(bytes: Uint8Array): DigestFilter | null {
    if (bytes.length < 32) return null;
    const magic = new TextDecoder().decode(bytes.subarray(0, 8));
    if (magic !== "BGDIGEST") return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(8, false) !== 1) return null;
    const m = view.getUint32(12, false);
    const k = view.getUint32(16, false);
    const added = view.getUint32(20, false);
    const bits = bytes.subarray(32);
    if (bits.length !== Math.ceil(m / 8)) return null;
    const f = new DigestFilter({ m, k }, new Uint8Array(bits));
    (f as unknown as { added: number }).added = added;
    return f;
  }
}
