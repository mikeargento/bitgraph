// © 2026 Michael Argento. All rights reserved.
/**
 * bitgraph-art/15's file encoding (2026-10-09): the PNG image data of a painting, smaller than the fixed deflate of
 * versions 2 to 14 (about 9 MB a painting at 1800 x 1800) and, like it, a pure function of the pixels: written here in
 * integer JavaScript, never by a platform compressor, so a browser, a worker and node write the same bytes forever.
 * Part of version 15; never edit (a change of these bytes is a new version).
 *
 * Rows: each row of RGB bytes takes the PNG filter (0 None, 1 Sub, 2 Up, 3 Average, 4 Paeth) whose filtered bytes
 * have the smallest sum of absolute values (each byte read as a signed value, -128 to 127); a tie takes the lower
 * filter number.
 *
 * Deflate (RFC 1951) in a zlib stream (header 78 DA, Adler-32 at the end), with:
 *  - LZ77 over a 32 KB window: a hash of the next three bytes (h = ((b0 << 10) ^ (b1 << 5) ^ b2) & 32767) heads a chain
 *    of earlier positions; at most 64 are tried, newest first; a match must be at least 3 long (a match of exactly 3
 *    only within 4096 bytes), up to 258; the first longest match wins. One step of lazy matching: when the next
 *    position's match is longer, the current byte goes out as a literal.
 *  - Blocks of at most 32768 symbols, each with its own dynamic Huffman codes (BTYPE 2): code lengths by package-merge
 *    (limited to 15 bits for literals, lengths and distances, 7 for the code-length code), weights sorted by
 *    (weight, symbol), packages after leaves on equal weight; canonical codes. At least two codes are always defined
 *    in each alphabet (the end-of-block code, and distance codes 0 and 1 when a block has fewer than two distances).
 *  - The code lengths run-length coded with codes 16, 17 and 18, greedily, longest run first.
 */

/** Filter the RGBA pixels' RGB bytes row by row, the best filter per row: the raw PNG image data (filter byte + row). */
export function filterRowsV15(px: Uint8Array, w: number, h: number): Uint8Array {
  const st = w * 3, out = new Uint8Array(h * (st + 1));
  const cur = new Uint8Array(st), prev = new Uint8Array(st), cand = new Uint8Array(st * 5);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; cur[x * 3] = px[i]!; cur[x * 3 + 1] = px[i + 1]!; cur[x * 3 + 2] = px[i + 2]!; }
    const sums = [0, 0, 0, 0, 0];
    for (let x = 0; x < st; x++) {
      const v = cur[x]!, a = x >= 3 ? cur[x - 3]! : 0, b = prev[x]!, c = x >= 3 ? prev[x - 3]! : 0;
      const p = a + b - c, pa = p > a ? p - a : a - p, pb = p > b ? p - b : b - p, pc = p > c ? p - c : c - p;
      const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      const f0 = v, f1 = (v - a) & 255, f2 = (v - b) & 255, f3 = (v - ((a + b) >> 1)) & 255, f4 = (v - pr) & 255;
      cand[x] = f0; cand[st + x] = f1; cand[2 * st + x] = f2; cand[3 * st + x] = f3; cand[4 * st + x] = f4;
      sums[0] += f0 < 128 ? f0 : 256 - f0; sums[1] += f1 < 128 ? f1 : 256 - f1; sums[2] += f2 < 128 ? f2 : 256 - f2; sums[3] += f3 < 128 ? f3 : 256 - f3; sums[4] += f4 < 128 ? f4 : 256 - f4;
    }
    let best = 0;
    for (let f = 1; f < 5; f++) if (sums[f]! < sums[best]!) best = f;
    const o = y * (st + 1);
    out[o] = best;
    out.set(cand.subarray(best * st, best * st + st), o + 1);
    prev.set(cur);
  }
  return out;
}

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
/** The length code (0..28) of a match length, and the distance code (0..29) of a distance. */
const LEN_CODE = (() => { const t = new Uint8Array(259); for (let c = 0; c < 29; c++) for (let l = LEN_BASE[c]!; l < (c < 28 ? LEN_BASE[c + 1]! : 259); l++) t[l] = c; t[258] = 28; return t; })();
function distCode(d: number): number { let c = 29; while (DIST_BASE[c]! > d) c--; return c; }
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

/** Code lengths limited to `limit` bits for the given weights (0 = unused), by package-merge. */
function codeLengths(freq: ArrayLike<number>, limit: number): Uint8Array {
  const n = freq.length, lens = new Uint8Array(n);
  const used: number[] = [];
  for (let s = 0; s < n; s++) if (freq[s]! > 0) used.push(s);
  if (used.length === 0) return lens;
  if (used.length === 1) { lens[used[0]!] = 1; return lens; }
  used.sort((a, b) => freq[a]! - freq[b]! || a - b);
  // nodes: leaves (symbol) or packages (two children); each list holds node ids sorted by weight
  const w: number[] = [], left: number[] = [], right: number[] = [], sym: number[] = [];
  const leaf = (s: number): number => { w.push(freq[s]!); left.push(-1); right.push(-1); sym.push(s); return w.length - 1; };
  const leaves = used.map(leaf);
  let list = leaves.slice();
  for (let level = 1; level < limit; level++) {
    const pk: number[] = [];
    for (let i = 0; i + 1 < list.length; i += 2) { w.push(w[list[i]!]! + w[list[i + 1]!]!); left.push(list[i]!); right.push(list[i + 1]!); sym.push(-1); pk.push(w.length - 1); }
    const merged: number[] = [];
    let a = 0, b = 0;
    while (a < leaves.length || b < pk.length) {
      if (b >= pk.length || (a < leaves.length && w[leaves[a]!]! <= w[pk[b]!]!)) merged.push(leaves[a++]!); else merged.push(pk[b++]!);
    }
    list = merged;
  }
  const stack: number[] = [];
  for (let i = 0; i < 2 * used.length - 2; i++) stack.push(list[i]!);
  while (stack.length) { const k = stack.pop()!; if (sym[k]! >= 0) lens[sym[k]!]++; else { stack.push(left[k]!, right[k]!); } }
  return lens;
}
/** Canonical codes for code lengths, bit-reversed for the least-significant-bit-first writer. */
function canonical(lens: Uint8Array): Uint16Array {
  const n = lens.length, count = new Uint16Array(16), next = new Uint16Array(16), codes = new Uint16Array(n);
  for (let s = 0; s < n; s++) count[lens[s]!]++;
  count[0] = 0;
  let code = 0;
  for (let b = 1; b < 16; b++) { code = (code + count[b - 1]!) << 1; next[b] = code; }
  for (let s = 0; s < n; s++) {
    const l = lens[s]!; if (!l) continue;
    let c = next[l]++, r = 0;
    for (let i = 0; i < l; i++) { r = (r << 1) | (c & 1); c >>= 1; }
    codes[s] = r;
  }
  return codes;
}

/** The zlib stream of `raw`, as described above. */
export function deflateV15(raw: Uint8Array): Uint8Array {
  const N = raw.length;
  let out = new Uint8Array((N >> 1) + 1024), n = 0, acc = 0, nb = 0;
  const bits = (v: number, c: number): void => {
    acc |= v << nb; nb += c;
    while (nb >= 8) { if (n === out.length) { const o2 = new Uint8Array(out.length * 2); o2.set(out); out = o2; } out[n++] = acc & 255; acc >>>= 8; nb -= 8; }
  };
  out[n++] = 0x78; out[n++] = 0xda;
  // LZ77 tokens of the current block: a literal (0..255) or a match (256 + length code index into tlen/tdist)
  const MAXSYM = 32768;
  const tok = new Int32Array(MAXSYM), tlen = new Int32Array(MAXSYM), tdist = new Int32Array(MAXSYM);
  let nt = 0;
  const head = new Int32Array(32768).fill(-1), prevp = new Int32Array(32768).fill(-1);
  const hashAt = (i: number): number => ((raw[i]! << 10) ^ (raw[i + 1]! << 5) ^ raw[i + 2]!) & 32767;
  const insert = (i: number): void => { if (i + 2 < N) { const h = hashAt(i); prevp[i & 32767] = head[h]!; head[h] = i; } };
  const longest = (i: number): number => { // the match at i: length (0 when none) in the low bits, distance above
    if (i + 2 >= N) return 0;
    let cand = head[hashAt(i)]!, chain = 64, bestL = 0, bestD = 0;
    const maxL = Math.min(258, N - i);
    while (cand >= 0 && i - cand <= 32768 && chain-- > 0) {
      if (raw[cand + bestL] === raw[i + bestL] && raw[cand] === raw[i] && raw[cand + 1] === raw[i + 1]) {
        let l = 2;
        while (l < maxL && raw[cand + l] === raw[i + l]) l++;
        if (l > bestL && (l > 3 || i - cand <= 4096)) { bestL = l; bestD = i - cand; if (l === maxL) break; }
      }
      const nx = prevp[cand & 32767]!;
      if (nx >= cand) break;
      cand = nx;
    }
    return bestL >= 3 ? bestL + bestD * 512 : 0;
  };
  const flush = (last: boolean): void => {
    const lf = new Int32Array(286), df = new Int32Array(30);
    for (let k = 0; k < nt; k++) { const t = tok[k]!; if (t < 256) lf[t]++; else { lf[257 + LEN_CODE[tlen[k]!]!]++; df[distCode(tdist[k]!)]++; } }
    lf[256]++;
    let distUsed = 0; for (let d = 0; d < 30; d++) if (df[d]! > 0) distUsed++;
    if (distUsed < 2) { if (df[0] === 0) df[0] = 1; if (df[1] === 0) df[1] = 1; }
    const ll = codeLengths(lf, 15), dl = codeLengths(df, 15);
    let hlit = 286; while (hlit > 257 && ll[hlit - 1] === 0) hlit--;
    let hdist = 30; while (hdist > 1 && dl[hdist - 1] === 0) hdist--;
    // the code lengths, run-length coded
    const all = new Uint8Array(hlit + hdist); all.set(ll.subarray(0, hlit)); all.set(dl.subarray(0, hdist), hlit);
    const rs: number[] = [], rx: number[] = [];
    for (let i = 0; i < all.length;) {
      const v = all[i]!; let run = 1;
      while (i + run < all.length && all[i + run] === v) run++;
      if (v === 0 && run >= 3) { const r = Math.min(run, 138); if (r >= 11) { rs.push(18); rx.push(r - 11); } else { rs.push(17); rx.push(r - 3); } i += r; continue; }
      rs.push(v); rx.push(0); i++;
      if (v !== 0) { let rest = run - 1; while (rest >= 3) { const r = Math.min(rest, 6); rs.push(16); rx.push(r - 3); rest -= r; i += r; } }
    }
    const cf = new Int32Array(19); for (const s of rs) cf[s]++;
    if (cf.filter((x) => x > 0).length < 2) { if (cf[0] === 0) cf[0] = 1; else cf[1] = 1; } // a complete code-length code
    const cl = codeLengths(cf, 7);
    let hclen = 19; while (hclen > 4 && cl[CL_ORDER[hclen - 1]!] === 0) hclen--;
    const lc = canonical(ll), dc = canonical(dl), cc = canonical(cl);
    bits(last ? 1 : 0, 1); bits(2, 2);
    bits(hlit - 257, 5); bits(hdist - 1, 5); bits(hclen - 4, 4);
    for (let i = 0; i < hclen; i++) bits(cl[CL_ORDER[i]!]!, 3);
    for (let i = 0; i < rs.length; i++) { const s = rs[i]!; bits(cc[s]!, cl[s]!); if (s === 16) bits(rx[i]!, 2); else if (s === 17) bits(rx[i]!, 3); else if (s === 18) bits(rx[i]!, 7); }
    for (let k = 0; k < nt; k++) {
      const t = tok[k]!;
      if (t < 256) { bits(lc[t]!, ll[t]!); continue; }
      const L = tlen[k]!, D = tdist[k]!, c = LEN_CODE[L]!, s = 257 + c;
      bits(lc[s]!, ll[s]!); if (LEN_EXTRA[c]) bits(L - LEN_BASE[c]!, LEN_EXTRA[c]!);
      const d = distCode(D); bits(dc[d]!, dl[d]!); if (DIST_EXTRA[d]) bits(D - DIST_BASE[d]!, DIST_EXTRA[d]!);
    }
    bits(lc[256]!, ll[256]!);
    nt = 0;
  };
  let i = 0;
  let pending = longest(0);
  insert(0);
  while (i < N) {
    const m = pending;
    const L = m & 511;
    if (L >= 3) {
      const nextM = i + 1 < N ? longest(i + 1) : 0;
      if ((nextM & 511) > L) { // lazy: the next position matches longer, so this byte is a literal
        tok[nt++] = raw[i]!; if (nt === MAXSYM) flush(false);
        i++; insert(i); pending = nextM;
        continue;
      }
      tok[nt] = 256; tlen[nt] = L; tdist[nt] = m >>> 9; nt++; if (nt === MAXSYM) flush(false);
      for (let k = 1; k < L; k++) insert(i + k);
      i += L;
      if (i < N) { pending = longest(i); insert(i); }
      continue;
    }
    tok[nt++] = raw[i]!; if (nt === MAXSYM) flush(false);
    i++;
    if (i < N) { pending = longest(i); insert(i); }
  }
  flush(true);
  if (nb > 0) bits(0, 8 - nb);
  let s1 = 1, s2 = 0;
  for (let k = 0; k < N; k++) { s1 += raw[k]!; if (s1 >= 65521) s1 -= 65521; s2 += s1; if (s2 >= 65521) s2 -= 65521; }
  const res = new Uint8Array(n + 4);
  res.set(out.subarray(0, n));
  const ad = ((s2 << 16) | s1) >>> 0;
  res[n] = ad >>> 24; res[n + 1] = (ad >>> 16) & 255; res[n + 2] = (ad >>> 8) & 255; res[n + 3] = ad & 255;
  return res;
}
