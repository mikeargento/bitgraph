/**
 * Epoch export: bundle assembly for the /api/export/epoch/[epochId] route.
 *
 * WRITE-SIDE OPERATOR FUNCTIONALITY. Proprietary, part of the website
 * (SEE LICENSE IN LICENSE), NOT part of the permissive packages. This file
 * produces bitgraph-bundle/1 archives per the normative spec at
 * docs/BUNDLE-FORMAT.md; the canonical, permissively licensed reference
 * implementation of bundle assembly is buildBundleArchive() in
 * @mikeargento/bitgraph-audit (packages/audit/src/export.ts). The website
 * does not resolve workspace packages, so the minimal tar/manifest
 * plumbing is deliberately duplicated here across the license boundary
 * (recorded in DECISIONS.md); a repo-root conformance test holds this
 * implementation byte-identical to the reference builder for the same
 * input.
 *
 * Self-contained on purpose: node:zlib and node:crypto only, no framework
 * imports, no relative imports, erasable-types-only TypeScript, so the
 * repo-root round-trip test can import this exact file under Node's type
 * stripping and audit its output with the canonical audit package.
 *
 * Deterministic given the same ledger data and the same generatedAt string:
 * this module never reads the clock (the route passes generation time in)
 * and never mutates anything. It reads through the injected data source
 * only; it performs no other I/O and no network access of its own.
 */

import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Data source (injected: the route wires S3, tests wire memory)
// ---------------------------------------------------------------------------

export interface EpochDataSource {
  /** Object keys under proofs/{safeEpochId}/, lexicographically sorted (causal order). */
  listProofKeys(safeEpochId: string): Promise<string[]>;
  /** Object keys under anchors/{safeEpochId}/, lexicographically sorted. */
  listAnchorKeys(safeEpochId: string): Promise<string[]>;
  /** Raw UTF-8 JSON text of one object, or null when missing. */
  getObjectText(key: string): Promise<string | null>;
  /** Safe id of the epoch currently minting proofs, or null when unknown. */
  getCurrentEpochSafeId(): Promise<string | null>;
}

export interface EpochExportResult {
  /** The complete .tar.gz bundle bytes. */
  archive: Uint8Array;
  /** True when the epoch was still minting proofs (labeled snapshot). */
  open: boolean;
  /** Distinct member proofs included. */
  proofCount: number;
  /** Raw commit.epochId as it appears in proofs (falls back to the safe id). */
  epochId: string;
  /** Highest commit counter included, as a decimal string; null when none parsed. */
  maxCounter: string | null;
  /** Ledger objects skipped (unparseable, non-bitgraph/1, unsafe key, or missing). */
  skipped: number;
}

/** Upper bound on ledger objects fetched per export; the route maps an excess to 413.
 * Kept small on purpose: epoch export is a demo and comprehensive-audit tool, not a
 * bulk-ledger download. Larger epochs (including the live one) return 413 by design. */
export const MAX_EXPORT_OBJECTS = 100;

/** Parallel S3 GETs while gathering. */
const FETCH_CONCURRENCY = 16;

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/**
 * Gather one epoch from the data source and assemble a bitgraph-bundle/1
 * .tar.gz archive.
 *
 * Rules, matching the live ledger's layout:
 *   - proofs/{epoch}/ holds every member proof (user proofs AND anchor
 *     proofs interleave on one chain), stored form (trailing proofHash).
 *     Entry paths reuse the ledger keys verbatim, so the export looks like
 *     a slice of the ledger (spec section 9).
 *   - anchors/{epoch}/ is a rebuildable INDEX whose objects duplicate the
 *     anchor proofs (with an extra unsigned "ethereum" field). Including
 *     those copies would make every anchor a semantic-duplicate finding in
 *     an audit, so anchor-index objects are included only when the same
 *     proof is MISSING from proofs/ (defensive completeness), never
 *     mirrored.
 *   - Only version "bitgraph/1" objects ship (owner version policy);
 *     anything else in the listing is skipped and counted.
 *   - Artifact bytes are never included: the ledger stores no artifacts
 *     (proofs are capability-gated by the file, which only its holder has).
 *
 * Returns null when the epoch has no proofs.
 *
 * @param generatedAt Advisory ISO 8601 UTC string for the manifest,
 *   supplied by the caller; this function never reads the clock.
 */
export async function exportEpoch(
  source: EpochDataSource,
  safeEpochId: string,
  generatedAt: string
): Promise<EpochExportResult | null> {
  const proofKeys = await source.listProofKeys(safeEpochId);
  if (proofKeys.length === 0) return null;
  const anchorKeys = await source.listAnchorKeys(safeEpochId);
  if (proofKeys.length + anchorKeys.length > MAX_EXPORT_OBJECTS) {
    throw new EpochTooLargeError(safeEpochId, proofKeys.length + anchorKeys.length);
  }

  let skipped = 0;
  const entries: BundleEntry[] = [];
  const usedPaths = new Set<string>();
  const seenIdentities = new Set<string>();
  const seenPositions = new Set<string>();
  const chainIdSet = new Set<string>();
  const epochIdSet = new Set<string>();
  const partitions = new Map<string, { epochId: string; chainId: string; min: bigint; max: bigint }>();
  let maxCounter: bigint | null = null;

  const consider = (key: string, text: string | null): void => {
    if (text === null || !isSafePath(key) || key === "manifest.json" || usedPaths.has(key)) {
      skipped++;
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      skipped++;
      return;
    }
    if (!isPlainObject(parsed) || parsed["version"] !== "bitgraph/1") {
      // Version policy: only bitgraph/1 proofs are bundle members.
      skipped++;
      return;
    }
    const commit = isPlainObject(parsed["commit"]) ? (parsed["commit"] as Record<string, unknown>) : {};
    const epochId = typeof commit["epochId"] === "string" && commit["epochId"].length > 0
      ? (commit["epochId"] as string)
      : null;
    const counter = typeof commit["counter"] === "string" && commit["counter"].length > 0
      ? (commit["counter"] as string)
      : null;
    const chainId = typeof commit["chainId"] === "string" && commit["chainId"].length > 0
      ? (commit["chainId"] as string)
      : "global";
    const storedHash = typeof parsed["proofHash"] === "string" ? (parsed["proofHash"] as string) : null;

    // Dedup between the proofs/ listing and the anchors/ index: by stored
    // proofHash first, by (epochId, counter) position as a fallback.
    const identity = storedHash !== null ? `h:${storedHash}` : `k:${key}`;
    const position = epochId !== null && counter !== null ? `${epochId}\u0000${counter}` : null;
    if (seenIdentities.has(identity) || (storedHash === null && position !== null && seenPositions.has(position))) {
      skipped++;
      return;
    }
    seenIdentities.add(identity);
    if (position !== null) seenPositions.add(position);

    entries.push({ path: key, content: utf8(text) });
    usedPaths.add(key);
    chainIdSet.add(chainId);
    if (epochId !== null) epochIdSet.add(epochId);
    if (epochId !== null && counter !== null) {
      let value: bigint | null = null;
      try {
        value = BigInt(counter);
      } catch {
        value = null;
      }
      if (value !== null && value >= BigInt(0)) {
        if (maxCounter === null || value > maxCounter) maxCounter = value;
        const pKey = `${epochId}\u0000${chainId}`;
        const existing = partitions.get(pKey);
        if (existing === undefined) {
          partitions.set(pKey, { epochId, chainId, min: value, max: value });
        } else {
          if (value < existing.min) existing.min = value;
          if (value > existing.max) existing.max = value;
        }
      }
    }
  };

  // proofs/ first (the authoritative member listing), then the anchors/
  // index (only fills holes). Fetches are batched; classification runs in
  // listing order so the result is deterministic.
  for (const keys of [proofKeys, anchorKeys]) {
    const texts = await mapWithConcurrency(keys, FETCH_CONCURRENCY, (key) => source.getObjectText(key));
    for (let i = 0; i < keys.length; i++) consider(keys[i], texts[i]);
  }

  if (entries.length === 0) return null;

  const currentSafeId = await source.getCurrentEpochSafeId();
  const open = currentSafeId !== null && currentSafeId === safeEpochId;
  const epochIds = Array.from(epochIdSet).sort();
  const rawEpochId = epochIds.length > 0 ? (epochIds[0] as string) : safeEpochId;
  const maxCounterStr: string | null = maxCounter === null ? null : (maxCounter as bigint).toString();

  const archive = assembleArchive({
    entries,
    epochIds: epochIds.length > 0 ? epochIds : [safeEpochId],
    chainIds: Array.from(chainIdSet).sort(),
    proofCount: entries.length,
    counterRanges: Array.from(partitions.values())
      .sort((a, b) =>
        a.epochId < b.epochId ? -1 : a.epochId > b.epochId ? 1 : a.chainId < b.chainId ? -1 : a.chainId > b.chainId ? 1 : 0
      )
      .map((p) => ({ epochId: p.epochId, chainId: p.chainId, min: p.min.toString(), max: p.max.toString() })),
    generatedAt,
    artifactsIncluded: false,
    openEpochs: open && maxCounterStr !== null ? [{ epochId: rawEpochId, counterAtSnapshot: maxCounterStr }] : [],
  });

  return {
    archive,
    open,
    proofCount: entries.length,
    epochId: rawEpochId,
    maxCounter: maxCounterStr,
    skipped,
  };
}

export class EpochTooLargeError extends Error {
  constructor(safeEpochId: string, objectCount: number) {
    super(`epoch ${safeEpochId} has ${objectCount} ledger objects, above the export cap of ${MAX_EXPORT_OBJECTS}`);
    this.name = "EpochTooLargeError";
  }
}

// ---------------------------------------------------------------------------
// Archive assembly (spec-conformant; mirrors packages/audit/src/export.ts)
// ---------------------------------------------------------------------------

interface BundleEntry {
  path: string;
  content: Uint8Array;
}

interface AssembleInput {
  entries: BundleEntry[];
  epochIds: string[];
  chainIds: string[];
  proofCount: number;
  counterRanges: Array<{ epochId: string; chainId: string; min: string; max: string }>;
  generatedAt: string;
  artifactsIncluded: boolean;
  openEpochs: Array<{ epochId: string; counterAtSnapshot: string }>;
}

/**
 * Assemble the .tar.gz: manifest per spec section 7 (fixed field order),
 * deterministic contents hash per section 8, sorted entry order, fixed tar
 * metadata (mtime 0). Byte-identical to the reference builder for the same
 * input, which the repo-root conformance test asserts.
 */
function assembleArchive(input: AssembleInput): Uint8Array {
  // Contents hash over every entry except the manifest itself (section 8).
  const contentsHashB64 = computeContentsHash(input.entries);

  const manifest: Record<string, unknown> = { version: "bitgraph-bundle/1" };
  manifest["epochIds"] = input.epochIds;
  manifest["chainIds"] = input.chainIds;
  manifest["proofCount"] = input.proofCount;
  manifest["counterRanges"] = input.counterRanges;
  manifest["generatedAt"] = input.generatedAt;
  manifest["contentsHashB64"] = contentsHashB64;
  manifest["artifactsIncluded"] = input.artifactsIncluded;
  if (input.openEpochs.length > 0) manifest["openEpochs"] = input.openEpochs;

  const all: BundleEntry[] = [...input.entries, { path: "manifest.json", content: utf8(JSON.stringify(manifest)) }];
  const sorted = all
    .map((entry) => ({ entry, pathBytes: utf8(entry.path) }))
    .sort((a, b) => compareBytes(a.pathBytes, b.pathBytes))
    .map((x) => x.entry);

  const tarBytes = writeTarArchive(sorted);
  const gz = gzipSync(tarBytes, { level: 9 });
  return new Uint8Array(gz.buffer, gz.byteOffset, gz.byteLength);
}

/** Deterministic contents hash, spec section 8: sorted per-entry digests, hashed. */
function computeContentsHash(entries: BundleEntry[]): string {
  const digests = entries.map((entry) => {
    const hasher = createHash("sha256");
    hasher.update(utf8(entry.path));
    hasher.update(new Uint8Array([0]));
    hasher.update(entry.content);
    return { pathBytes: utf8(entry.path), digest: hasher.digest() };
  });
  digests.sort((a, b) => compareBytes(a.pathBytes, b.pathBytes));
  const outer = createHash("sha256");
  for (const d of digests) outer.update(d.digest);
  return outer.digest("base64");
}

// ---------------------------------------------------------------------------
// Minimal deterministic tar writer (ustar + PAX long paths; mtime fixed 0)
// ---------------------------------------------------------------------------

const BLOCK = 512;

function writeTarArchive(files: BundleEntry[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const file of files) {
    const pathBytes = utf8(file.path);
    if (pathBytes.length <= 100) {
      parts.push(tarHeader(file.path, "", file.content.length, "0"));
    } else {
      const split = splitUstarPath(file.path, pathBytes);
      if (split !== null) {
        parts.push(tarHeader(split.name, split.prefix, file.content.length, "0"));
      } else {
        const record = paxPathRecord(file.path);
        const paxName = truncateBytes(`PaxHeaders.0/${file.path}`, 100);
        parts.push(tarHeader(paxName, "", record.length, "x"), padBlock(record));
        parts.push(tarHeader(truncateBytes(file.path, 100), "", file.content.length, "0"));
      }
    }
    parts.push(padBlock(file.content));
  }
  parts.push(new Uint8Array(BLOCK), new Uint8Array(BLOCK));
  return concatParts(parts);
}

function splitUstarPath(path: string, pathBytes: Uint8Array): { prefix: string; name: string } | null {
  for (let i = path.length - 1; i > 0; i--) {
    if (path.charCodeAt(i) !== 0x2f) continue;
    const prefix = path.slice(0, i);
    const name = path.slice(i + 1);
    const prefixLen = utf8(prefix).length;
    const nameLen = pathBytes.length - prefixLen - 1;
    if (name.length > 0 && nameLen <= 100 && prefixLen <= 155) {
      return { prefix, name };
    }
  }
  return null;
}

function tarHeader(name: string, prefix: string, size: number, typeflag: string): Uint8Array {
  const block = new Uint8Array(BLOCK);
  const ascii = (text: string, offset: number, length: number): void => {
    const bytes = utf8(text);
    block.set(bytes.subarray(0, Math.min(bytes.length, length)), offset);
  };
  ascii(name, 0, 100);
  block.set(octal(0o644, 8), 100); // mode
  block.set(octal(0, 8), 108); // uid
  block.set(octal(0, 8), 116); // gid
  block.set(octal(size, 12), 124); // size
  block.set(octal(0, 12), 136); // mtime, fixed 0 for determinism
  for (let i = 148; i < 156; i++) block[i] = 0x20; // checksum spaces
  block[156] = typeflag.charCodeAt(0);
  ascii("ustar", 257, 6); // magic, NUL-terminated by the zeroed block
  ascii("00", 263, 2); // version
  if (prefix.length > 0) ascii(prefix, 345, 155);
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += block[i] as number;
  ascii(sum.toString(8).padStart(6, "0"), 148, 6);
  block[154] = 0;
  block[155] = 0x20;
  return block;
}

function octal(value: number, length: number): Uint8Array {
  const out = new Uint8Array(length);
  const text = value.toString(8).padStart(length - 1, "0");
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
  out[length - 1] = 0;
  return out;
}

function paxPathRecord(path: string): Uint8Array {
  const baseBytes = utf8(` path=${path}\n`);
  let length = baseBytes.length + 1;
  while (String(length).length + baseBytes.length !== length) {
    length = String(length).length + baseBytes.length;
  }
  return concatParts([utf8(String(length)), baseBytes]);
}

function truncateBytes(text: string, n: number): string {
  const bytes = utf8(text);
  if (bytes.length <= n) return text;
  let end = n;
  while (end > 0 && ((bytes[end] as number) & 0xc0) === 0x80) end--;
  return new TextDecoder("utf-8").decode(bytes.subarray(0, end));
}

function padBlock(content: Uint8Array): Uint8Array {
  const padding = (BLOCK - (content.length % BLOCK)) % BLOCK;
  if (padding === 0) return content;
  const out = new Uint8Array(content.length + padding);
  out.set(content, 0);
  return out;
}

function concatParts(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Spec section 4.1 path safety: relative, no NUL, no "..", no empty or "." segments. */
function isSafePath(path: string): boolean {
  if (path.length === 0 || path.includes("\0") || path.startsWith("/")) return false;
  for (const segment of path.split("/")) {
    if (segment === "" || segment === "." || segment === "..") return false;
  }
  return true;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = (a[i] as number) - (b[i] as number);
    if (d !== 0) return d;
  }
  return a.length - b.length;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index] as T);
    }
  };
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(concurrency, items.length); i++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// Self-notarization hook (DISABLED BY DEFAULT; no code path calls this)
// ---------------------------------------------------------------------------

/**
 * DISABLED self-notarization hook. Committing an exported archive's SHA-256
 * through the live bitgrapher would make the archive itself a committed
 * fact in the causal chain, which is exactly why it must never happen
 * implicitly: every commit mints a permanent, unremovable proof on the
 * COMPLIANCE-locked production ledger (10-year Object Lock). Notarization
 * must be a deliberate, manual act by the operator.
 *
 * Nothing calls this function. docs/EXPORT-INTEGRATION.md describes exactly
 * how the maintainer would wire it through the existing /api/commit flow
 * and how to exercise it once, by hand.
 */
export function notarizeArchiveHook(archiveSha256B64: string): never {
  throw new Error(
    "notarizeArchiveHook is disabled by default: committing an archive hash " +
      `(here ${archiveSha256B64}) would mint a permanent proof on the COMPLIANCE-locked ` +
      "production ledger. Self-notarization must be a deliberate manual act; " +
      "see docs/EXPORT-INTEGRATION.md for the wiring and one-time exercise steps."
  );
}
