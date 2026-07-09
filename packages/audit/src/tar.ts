// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * Minimal streaming tar reader.
 *
 * Coverage, per docs/BUNDLE-FORMAT.md section 4: POSIX ustar headers, PAX
 * extended headers (typeflags 'x' and 'g'; the 'path' and 'size' keywords
 * are applied, other keywords are parsed and ignored), and GNU long-name
 * entries (typeflag 'L'; 'K' long-linkname entries are consumed and
 * discarded because links are not bundle entries). GNU base-256 numeric
 * fields are supported for large sizes.
 *
 * Design constraints:
 *   - Pure streaming over an AsyncIterable of byte chunks. Nothing is
 *     written to disk and no entry is buffered by this module; entry bodies
 *     are exposed as async chunk generators the caller consumes (or
 *     abandons; unconsumed bytes are skipped automatically).
 *   - Only regular-file entries carry content of interest. Directories,
 *     symlinks, hard links, devices, and FIFOs are yielded as kind "other"
 *     so callers can count them, but their bodies are never interpreted and
 *     links are never followed or dereferenced.
 *   - Corrupt structure (bad checksum, truncation, malformed PAX records)
 *     throws; a corrupt container is not a readable bundle.
 */

const BLOCK = 512;

export interface TarEntry {
  /** Entry path exactly as recorded (after PAX / GNU long-name resolution). Not normalized. */
  path: string;
  /** Content size in bytes. */
  size: number;
  /** "file" for regular files; "other" for everything else. */
  kind: "file" | "other";
  /** Raw typeflag character. */
  typeflag: string;
  /**
   * Content chunks. Valid only until the next entry is requested from the
   * outer generator; any unconsumed remainder is skipped automatically.
   */
  body: AsyncGenerator<Uint8Array, void, void>;
}

/**
 * Read tar entries sequentially from a byte stream.
 */
export async function* readTarEntries(
  source: AsyncIterable<Uint8Array>
): AsyncGenerator<TarEntry, void, void> {
  const reader = new ChunkReader(source);
  let pendingPax: Map<string, string> | null = null;
  let globalPax: Map<string, string> | null = null;
  let pendingLongName: string | null = null;

  for (;;) {
    const block = await reader.readExact(BLOCK);
    if (block === null) {
      // EOF at a block boundary without the two-zero-block trailer.
      // Tolerated: everything read so far was structurally complete.
      return;
    }
    if (isZeroBlock(block)) {
      // End-of-archive marker. The second zero block and any trailing
      // padding are irrelevant.
      return;
    }

    const header = parseHeader(block);
    const typeflag = header.typeflag;

    // --- Metadata entries that modify the NEXT real entry ---------------
    if (typeflag === "x" || typeflag === "g") {
      const data = await readAll(reader, header.size);
      await reader.skip(padOf(header.size));
      const records = parsePaxRecords(data);
      if (typeflag === "x") {
        pendingPax = records;
      } else {
        globalPax = mergePax(globalPax, records);
      }
      continue;
    }
    if (typeflag === "L") {
      const data = await readAll(reader, header.size);
      await reader.skip(padOf(header.size));
      pendingLongName = decodeString(stripTrailingNuls(data));
      continue;
    }
    if (typeflag === "K") {
      // GNU long linkname. Links are not bundle entries; discard.
      await reader.skip(header.size + padOf(header.size));
      continue;
    }

    // --- Real entry ------------------------------------------------------
    let path = header.name;
    if (globalPax !== null && globalPax.has("path")) path = globalPax.get("path") as string;
    if (pendingLongName !== null) path = pendingLongName;
    if (pendingPax !== null && pendingPax.has("path")) path = pendingPax.get("path") as string;

    let size = header.size;
    const paxSize = pendingPax?.get("size") ?? globalPax?.get("size");
    if (paxSize !== undefined) {
      const parsed = Number(paxSize);
      if (!Number.isSafeInteger(parsed) || parsed < 0) {
        throw new Error("tar: invalid PAX size value");
      }
      size = parsed;
    }
    pendingPax = null;
    pendingLongName = null;

    const isFile = typeflag === "0" || typeflag === "\0";
    const state = { remaining: size };
    const body = bodyGenerator(reader, state);

    yield {
      path,
      size,
      kind: isFile ? "file" : "other",
      typeflag,
      body,
    };

    // Skip whatever the consumer left unread, plus block padding.
    if (state.remaining > 0) {
      await reader.skip(state.remaining);
      state.remaining = 0;
    }
    await reader.skip(padOf(size));
  }
}

// ---------------------------------------------------------------------------
// Body streaming
// ---------------------------------------------------------------------------

async function* bodyGenerator(
  reader: ChunkReader,
  state: { remaining: number }
): AsyncGenerator<Uint8Array, void, void> {
  while (state.remaining > 0) {
    const chunk = await reader.readSome(state.remaining);
    if (chunk === null) {
      throw new Error("tar: truncated archive (unexpected end of stream inside entry body)");
    }
    state.remaining -= chunk.length;
    yield chunk;
  }
}

async function readAll(reader: ChunkReader, size: number): Promise<Uint8Array> {
  if (size === 0) return new Uint8Array(0);
  const data = await reader.readExact(size);
  if (data === null) {
    throw new Error("tar: truncated archive (unexpected end of stream)");
  }
  return data;
}

// ---------------------------------------------------------------------------
// Header parsing
// ---------------------------------------------------------------------------

interface RawHeader {
  name: string;
  size: number;
  typeflag: string;
}

function parseHeader(block: Uint8Array): RawHeader {
  verifyChecksum(block);

  const rawType = block[156] as number;
  const typeflag = rawType === 0 ? "\0" : String.fromCharCode(rawType);

  let name = decodeString(fieldBytes(block, 0, 100));
  const magic = decodeString(fieldBytes(block, 257, 6));
  if (magic === "ustar") {
    const prefix = decodeString(fieldBytes(block, 345, 155));
    if (prefix.length > 0) {
      name = `${prefix}/${name}`;
    }
  }

  const size = parseNumeric(block.subarray(124, 136));

  return { name, size, typeflag };
}

/** Extract a NUL-terminated field. */
function fieldBytes(block: Uint8Array, offset: number, length: number): Uint8Array {
  const raw = block.subarray(offset, offset + length);
  let end = raw.indexOf(0);
  if (end === -1) end = raw.length;
  return raw.subarray(0, end);
}

/**
 * Parse a tar numeric field: ASCII octal (NUL/space padded), or GNU
 * base-256 when the high bit of the first byte is set.
 */
function parseNumeric(field: Uint8Array): number {
  if (field.length > 0 && ((field[0] as number) & 0x80) !== 0) {
    // GNU base-256: big-endian binary, first byte's low 7 bits included.
    let value = 0n;
    for (let i = 0; i < field.length; i++) {
      const byte = i === 0 ? (field[0] as number) & 0x7f : (field[i] as number);
      value = (value << 8n) | BigInt(byte);
    }
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("tar: numeric field exceeds the supported range");
    }
    return Number(value);
  }
  const text = decodeString(field).trim().replace(/\0+$/, "").trim();
  if (text.length === 0) return 0;
  const value = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`tar: invalid octal numeric field: "${text}"`);
  }
  return value;
}

function verifyChecksum(block: Uint8Array): void {
  const stored = parseNumeric(block.subarray(148, 156));
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) {
    sum += i >= 148 && i < 156 ? 0x20 : (block[i] as number);
  }
  if (sum !== stored) {
    throw new Error("tar: header checksum mismatch (corrupt or not a tar archive)");
  }
}

function isZeroBlock(block: Uint8Array): boolean {
  for (let i = 0; i < block.length; i++) {
    if ((block[i] as number) !== 0) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// PAX records
// ---------------------------------------------------------------------------

/**
 * Parse PAX extended-header data: a sequence of "len key=value\n" records
 * where len is the decimal byte length of the whole record including the
 * digits, the space, and the trailing newline.
 */
function parsePaxRecords(data: Uint8Array): Map<string, string> {
  const records = new Map<string, string>();
  let offset = 0;
  while (offset < data.length) {
    let cursor = offset;
    while (cursor < data.length && (data[cursor] as number) !== 0x20) cursor++;
    if (cursor >= data.length) {
      throw new Error("tar: malformed PAX record (no length delimiter)");
    }
    const length = Number(decodeString(data.subarray(offset, cursor)));
    if (!Number.isInteger(length) || length <= 0 || offset + length > data.length) {
      throw new Error("tar: malformed PAX record (bad length)");
    }
    const record = data.subarray(cursor + 1, offset + length);
    if (record.length === 0 || (record[record.length - 1] as number) !== 0x0a) {
      throw new Error("tar: malformed PAX record (missing newline)");
    }
    const text = decodeString(record.subarray(0, record.length - 1));
    const eq = text.indexOf("=");
    if (eq === -1) {
      throw new Error("tar: malformed PAX record (missing '=')");
    }
    records.set(text.slice(0, eq), text.slice(eq + 1));
    offset += length;
  }
  return records;
}

function mergePax(
  base: Map<string, string> | null,
  overlay: Map<string, string>
): Map<string, string> {
  const merged = new Map(base ?? []);
  for (const [key, value] of overlay) merged.set(key, value);
  return merged;
}

// ---------------------------------------------------------------------------
// Byte helpers
// ---------------------------------------------------------------------------

function decodeString(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}

function stripTrailingNuls(bytes: Uint8Array): Uint8Array {
  let end = bytes.length;
  while (end > 0 && (bytes[end - 1] as number) === 0) end--;
  return bytes.subarray(0, end);
}

/**
 * Pull-based reader over an async chunk stream.
 */
class ChunkReader {
  private readonly iter: AsyncIterator<Uint8Array>;
  private chunks: Uint8Array[] = [];
  private head = 0;
  private available = 0;
  private ended = false;

  constructor(source: AsyncIterable<Uint8Array>) {
    this.iter = source[Symbol.asyncIterator]();
  }

  private async fill(): Promise<boolean> {
    if (this.ended) return false;
    const result = await this.iter.next();
    if (result.done === true) {
      this.ended = true;
      return false;
    }
    const chunk = result.value;
    if (chunk.length > 0) {
      this.chunks.push(chunk);
      this.available += chunk.length;
    }
    return true;
  }

  /**
   * Read exactly n bytes. Returns null on a clean EOF with nothing
   * buffered; throws if the stream ends mid-read.
   */
  async readExact(n: number): Promise<Uint8Array | null> {
    while (this.available < n) {
      const more = await this.fill();
      if (!more) {
        if (this.available === 0) return null;
        throw new Error("tar: truncated archive (unexpected end of stream)");
      }
    }
    return this.take(n);
  }

  /** Read between 1 and max bytes. Returns null at EOF. */
  async readSome(max: number): Promise<Uint8Array | null> {
    while (this.available === 0) {
      const more = await this.fill();
      if (!more) return null;
    }
    const first = this.chunks[0] as Uint8Array;
    const take = Math.min(max, first.length - this.head);
    const out = first.subarray(this.head, this.head + take);
    this.advance(take, first);
    return out;
  }

  async skip(n: number): Promise<void> {
    let remaining = n;
    while (remaining > 0) {
      const chunk = await this.readSome(remaining);
      if (chunk === null) {
        throw new Error("tar: truncated archive (unexpected end of stream)");
      }
      remaining -= chunk.length;
    }
  }

  private take(n: number): Uint8Array {
    const out = new Uint8Array(n);
    let copied = 0;
    while (copied < n) {
      const first = this.chunks[0] as Uint8Array;
      const take = Math.min(n - copied, first.length - this.head);
      out.set(first.subarray(this.head, this.head + take), copied);
      copied += take;
      this.advance(take, first);
    }
    return out;
  }

  private advance(consumed: number, first: Uint8Array): void {
    this.head += consumed;
    this.available -= consumed;
    if (this.head === first.length) {
      this.chunks.shift();
      this.head = 0;
    }
  }
}

function padOf(size: number): number {
  return (BLOCK - (size % BLOCK)) % BLOCK;
}
