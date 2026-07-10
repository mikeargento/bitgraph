// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * bitgraph-audit ingest
 *
 * Streams bundle entries per docs/BUNDLE-FORMAT.md from a directory, a
 * .tar, or a .tar.gz/.tgz container, classifies every entry, and builds
 * the observed-proof, artifact, witness, and manifest indexes that the
 * verification and reconstruction stages consume.
 *
 * Discovery is by schema shape, never by filename (the single exception is
 * the reserved root manifest.json). The version policy is enforced first:
 * a proof-shaped file whose version is not exactly "bitgraph/1" is rejected
 * with the stable code "unsupported-version", counted, listed, and excluded
 * from verification, chain reconstruction, and anomaly analysis.
 *
 * Memory: archives are never unpacked to disk and never loaded whole.
 * Every entry is hashed incrementally as it streams. Only small JSON
 * candidates (at most MAX_CANDIDATE_JSON_BYTES) are buffered for parsing;
 * artifact bytes are hashed and dropped. What ingest retains scales with
 * the number of entries and the total size of the proof JSONs, not with
 * artifact payload sizes.
 *
 * Untrusted .tar / .tar.gz containers are additionally bounded by
 * configurable caps (IngestLimits, defaults DEFAULT_INGEST_LIMITS): a total
 * decompressed-byte ceiling, a maximum entry count, and a maximum size for
 * metadata entries buffered whole (PAX headers, GNU long names). A crafted
 * archive that would otherwise exhaust memory (a decompression bomb, an
 * entry flood, or a header declaring an absurd size) aborts ingest with a
 * clear error rather than allocating without bound. The defaults sit well
 * above any legitimate bundle; directory bundles are already on disk and
 * are not capped here.
 */

import { createReadStream } from "node:fs";
import { open, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { createGunzip } from "node:zlib";
import { sha256 } from "@noble/hashes/sha256";
import { computeProofHash } from "@mikeargento/bitgraph-verify";
import type { BitGraphProof } from "@mikeargento/bitgraph-verify";
import { readTarEntries } from "./tar.js";
import { combineEntryDigests } from "./contents-hash.js";
import type {
  AnchorWitnessFile,
  ArtifactRecord,
  AuditFinding,
  BundleManifest,
  ContainerKind,
  EmbeddedProofHashStatus,
  IngestCounts,
  IngestLimits,
  IngestResult,
  ManifestReport,
  MatchedArtifactBytes,
  ObservedProof,
  ProofSource,
  UnsupportedVersionRecord,
} from "./types.js";

/**
 * Largest file that is buffered for JSON candidacy. Larger entries are
 * treated as artifact candidates only (they are hashed, never parsed).
 * Real proofs, manifests, and witnesses are a few kilobytes; the cap only
 * bounds transient memory for pathological inputs.
 */
const MAX_CANDIDATE_JSON_BYTES = 8 * 1024 * 1024;

/**
 * Default resource caps for untrusted .tar / .tar.gz ingest. Chosen well
 * above any legitimate bundle (the 50k-proof benchmark bundle decompresses
 * to a few hundred MiB across ~50k entries, with kilobyte-scale metadata),
 * so real inputs never approach them while a crafted archive aborts.
 */
export const DEFAULT_INGEST_LIMITS: IngestLimits = {
  maxTotalBytes: 2 * 1024 * 1024 * 1024, // 2 GiB decompressed
  maxEntryCount: 1_000_000,
  maxMetadataEntryBytes: 8 * 1024 * 1024, // 8 MiB per PAX/GNU metadata entry
};

const NUL = new Uint8Array([0]);
const MANIFEST_PATH = "manifest.json";
const BUNDLE_VERSION = "bitgraph-bundle/1";
const WITNESS_VERSION = "bitgraph-anchor-witness/1";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Ingest a bundle from a directory, .tar, or .tar.gz/.tgz path.
 *
 * Performs no verification; run verifyObservedProofs() on the result.
 * Performs no network access of any kind.
 *
 * @param limits Resource caps for untrusted tar/tar.gz containers; defaults
 *               to DEFAULT_INGEST_LIMITS. Ignored for directory bundles.
 * @throws {TypeError} when the path is not one of the accepted container
 *                     forms. Corrupt archives throw Error from the tar or
 *                     gzip layer, and an archive that exceeds a cap throws
 *                     Error rather than exhausting memory.
 */
export async function ingestBundle(
  bundlePath: string,
  limits: IngestLimits = DEFAULT_INGEST_LIMITS
): Promise<IngestResult> {
  const container = await detectContainer(bundlePath);
  const findings: AuditFinding[] = [];
  let skippedUnsafePaths = 0;
  let entriesScanned = 0;

  // ---------------------------------------------------------------------
  // Scan: stream every entry once, hashing incrementally.
  // ---------------------------------------------------------------------
  const scanned: ScannedEntry[] = [];
  const rootTracker = new CommonRootTracker();

  if (container === "directory") {
    for await (const file of walkDirectory(bundlePath)) {
      entriesScanned++;
      const stream = createReadStream(file.absPath);
      const hashed = await hashEntryStream(file.relPath, undefined, undefined, stream);
      scanned.push(makeScannedEntry(file.relPath, hashed));
    }
  } else {
    const { stream, close } = openContainerByteStream(bundlePath, container);
    try {
      for await (const entry of readTarEntries(stream, limits)) {
        if (entry.kind !== "file") continue;
        entriesScanned++;
        const normalized = normalizeEntryPath(entry.path);
        // Every file entry, safe or not, weighs on the bundle-root
        // decision: a stripped root exists only when ALL entries in the
        // archive sit under one common top-level directory.
        rootTracker.observe(normalized.path);
        if (normalized.unsafe) {
          skippedUnsafePaths++;
          findings.push({
            code: "unsafe-path",
            path: entry.path,
            message: `entry skipped: ${normalized.reason}`,
          });
          continue;
        }
        const slash = normalized.path.indexOf("/");
        const strippedVariant = slash === -1 ? undefined : normalized.path.slice(slash + 1);
        const hashed = await hashEntryStream(normalized.path, strippedVariant, entry.size, entry.body);
        scanned.push(makeScannedEntry(normalized.path, hashed));
      }
    } finally {
      close();
    }
  }

  // ---------------------------------------------------------------------
  // Finalize paths: tar bundle-root normalization + last-wins duplicates.
  // ---------------------------------------------------------------------
  let strippedRootPrefix: string | undefined;
  if (container !== "directory" && scanned.length > 0) {
    strippedRootPrefix = rootTracker.commonRoot();
  }

  const finalByPath = new Map<string, FinalEntry>();
  for (const entry of scanned) {
    let finalPath = entry.rawPath;
    let entryDigest = entry.entryDigestFull;
    if (strippedRootPrefix !== undefined) {
      finalPath = entry.rawPath.slice(strippedRootPrefix.length + 1);
      entryDigest = entry.entryDigestStripped as Uint8Array;
    }
    if (finalByPath.has(finalPath)) {
      findings.push({
        code: "duplicate-path",
        path: finalPath,
        message: "multiple archive entries normalized to the same path; the last entry wins",
      });
    }
    finalByPath.set(finalPath, {
      path: finalPath,
      sha256Hex: entry.sha256Hex,
      byteLength: entry.byteLength,
      entryDigest,
      ...(entry.json !== undefined ? { json: entry.json } : {}),
    });
  }
  const finalEntries = Array.from(finalByPath.values());

  // ---------------------------------------------------------------------
  // Deterministic contents hash over everything except the root manifest.
  // ---------------------------------------------------------------------
  const computedContentsHashB64 = combineEntryDigests(
    finalEntries
      .filter((entry) => entry.path !== MANIFEST_PATH)
      .map((entry) => ({ path: entry.path, entryDigest: entry.entryDigest }))
  );

  // ---------------------------------------------------------------------
  // Classify.
  // ---------------------------------------------------------------------
  const proofs: ObservedProof[] = [];
  const proofsByHash = new Map<string, ObservedProof>();
  const unsupportedVersions: UnsupportedVersionRecord[] = [];
  const witnesses: AnchorWitnessFile[] = [];
  const artifactsByHex = new Map<string, ArtifactRecord>();
  let manifest: ManifestReport | undefined;
  let proofFiles = 0;
  let exactDuplicates = 0;
  let semanticDuplicates = 0;

  for (const entry of finalEntries) {
    if (entry.path === MANIFEST_PATH) {
      manifest = classifyManifest(entry, computedContentsHashB64, findings);
      continue;
    }

    const parsed = entry.json;
    if (parsed !== undefined && isProofShaped(parsed)) {
      const version = (parsed as Record<string, unknown>)["version"] as string;
      if (version === "bitgraph/1") {
        proofFiles++;
        const outcome = recordMemberProof(entry, parsed as Record<string, unknown>, proofsByHash, proofs, findings);
        if (outcome === "exact-duplicate") exactDuplicates++;
        if (outcome === "semantic-duplicate") semanticDuplicates++;
        continue;
      }
      // Version policy: rejected, counted, listed, excluded. The file
      // remains a candidate artifact per spec section 6.3 (it is not a
      // member proof).
      unsupportedVersions.push({
        code: "unsupported-version",
        path: entry.path,
        version,
        fileSha256Hex: entry.sha256Hex,
      });
      findings.push({
        code: "unsupported-version",
        path: entry.path,
        message: `proof-shaped file rejected: version "${version}" is not "bitgraph/1"`,
        details: { version },
      });
      indexArtifact(entry, artifactsByHex);
      continue;
    }

    if (
      parsed !== undefined &&
      (parsed as Record<string, unknown>)["version"] === WITNESS_VERSION
    ) {
      witnesses.push({
        path: entry.path,
        fileSha256Hex: entry.sha256Hex,
        witness: parsed as Record<string, unknown>,
      });
      continue;
    }

    indexArtifact(entry, artifactsByHex);
  }

  // ---------------------------------------------------------------------
  // Content-addressed artifact matching.
  // ---------------------------------------------------------------------
  for (const proof of proofs) {
    const digestHex = strictDigestToHex(
      (proof.proof as unknown as Record<string, unknown>)["artifact"]
    );
    if (digestHex === null) continue;
    const artifact = artifactsByHex.get(digestHex);
    if (artifact !== undefined) {
      artifact.matchedProofHashes.push(proof.proofHash);
    }
  }

  const artifacts = Array.from(artifactsByHex.values());

  const counts: IngestCounts = {
    observed: proofs.length,
    proofFiles,
    exactDuplicates,
    semanticDuplicates,
    unsupportedVersion: unsupportedVersions.length,
    artifacts: artifacts.length,
    witnesses: witnesses.length,
    skippedUnsafePaths,
  };

  return {
    bundlePath,
    container,
    ...(strippedRootPrefix !== undefined ? { strippedRootPrefix } : {}),
    entriesScanned,
    proofs,
    unsupportedVersions,
    artifacts,
    witnesses,
    ...(manifest !== undefined ? { manifest } : {}),
    computedContentsHashB64,
    findings,
    counts,
  };
}

/**
 * Stream the bytes of every artifact that content-matched at least one
 * proof, one artifact at a time, in deterministic order (first-observation
 * order for directories, archive order for tars). Peak memory is bounded
 * by the largest matched artifact, because the canonical verify() API
 * takes whole byte arrays.
 *
 * Bytes are re-read from the container and re-hashed before being yielded;
 * an entry whose bytes no longer hash to the recorded digest (for example
 * a file modified on disk between passes) is skipped, never yielded under
 * the stale digest.
 */
export async function* streamMatchedArtifacts(
  ingest: IngestResult
): AsyncGenerator<MatchedArtifactBytes, void, void> {
  const needed = ingest.artifacts.filter((a) => a.matchedProofHashes.length > 0);
  if (needed.length === 0) return;

  if (ingest.container === "directory") {
    for (const artifact of needed) {
      for (const relPath of artifact.paths) {
        let bytes: Uint8Array;
        try {
          bytes = new Uint8Array(await readFile(join(ingest.bundlePath, ...relPath.split("/"))));
        } catch {
          continue;
        }
        if (toHex(sha256(bytes)) !== artifact.sha256Hex) continue;
        yield { sha256Hex: artifact.sha256Hex, path: relPath, bytes };
        break;
      }
    }
    return;
  }

  const neededByPath = new Map<string, ArtifactRecord>();
  for (const artifact of needed) {
    for (const path of artifact.paths) neededByPath.set(path, artifact);
  }
  const satisfied = new Set<string>();
  const { stream, close } = openContainerByteStream(ingest.bundlePath, ingest.container);
  try {
    for await (const entry of readTarEntries(stream, DEFAULT_INGEST_LIMITS)) {
      if (satisfied.size === needed.length) break;
      if (entry.kind !== "file") continue;
      const normalized = normalizeEntryPath(entry.path);
      if (normalized.unsafe) continue;
      let finalPath = normalized.path;
      if (ingest.strippedRootPrefix !== undefined) {
        if (!finalPath.startsWith(`${ingest.strippedRootPrefix}/`)) continue;
        finalPath = finalPath.slice(ingest.strippedRootPrefix.length + 1);
      }
      const artifact = neededByPath.get(finalPath);
      if (artifact === undefined || satisfied.has(artifact.sha256Hex)) continue;
      const chunks: Uint8Array[] = [];
      let total = 0;
      for await (const chunk of entry.body) {
        chunks.push(chunk.slice());
        total += chunk.length;
      }
      const bytes = concatBytes(chunks, total);
      if (toHex(sha256(bytes)) !== artifact.sha256Hex) continue;
      satisfied.add(artifact.sha256Hex);
      yield { sha256Hex: artifact.sha256Hex, path: finalPath, bytes };
    }
  } finally {
    close();
  }
}

// ---------------------------------------------------------------------------
// Container detection and opening
// ---------------------------------------------------------------------------

async function detectContainer(bundlePath: string): Promise<ContainerKind> {
  const info = await stat(bundlePath);
  if (info.isDirectory()) return "directory";

  const lower = bundlePath.toLowerCase();
  if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) return "tar-gz";
  if (lower.endsWith(".tar")) return "tar";

  // Content sniffing: gzip magic bytes, then tar ustar magic at offset 257.
  const handle = await open(bundlePath, "r");
  try {
    const head = Buffer.alloc(262);
    const { bytesRead } = await handle.read(head, 0, 262, 0);
    if (bytesRead >= 2 && head[0] === 0x1f && head[1] === 0x8b) return "tar-gz";
    if (bytesRead >= 262 && head.subarray(257, 262).toString("latin1") === "ustar") return "tar";
  } finally {
    await handle.close();
  }
  throw new TypeError(
    `bitgraph-audit: "${bundlePath}" is not an accepted bundle container ` +
      `(expected a directory, .tar, .tar.gz, or .tgz)`
  );
}

function openContainerByteStream(
  bundlePath: string,
  container: ContainerKind
): { stream: AsyncIterable<Uint8Array>; close: () => void } {
  const file = createReadStream(bundlePath);
  if (container === "tar-gz") {
    const gunzip = createGunzip();
    file.pipe(gunzip);
    // Surface file-read errors through the gunzip stream so async
    // iteration rejects instead of hanging.
    file.on("error", (err) => gunzip.destroy(err));
    return {
      stream: gunzip as AsyncIterable<Uint8Array>,
      close: () => {
        gunzip.destroy();
        file.destroy();
      },
    };
  }
  return {
    stream: file as AsyncIterable<Uint8Array>,
    close: () => file.destroy(),
  };
}

// ---------------------------------------------------------------------------
// Directory walking
// ---------------------------------------------------------------------------

async function* walkDirectory(
  root: string
): AsyncGenerator<{ relPath: string; absPath: string }, void, void> {
  yield* walkDir(root, "");
}

async function* walkDir(
  root: string,
  relDir: string
): AsyncGenerator<{ relPath: string; absPath: string }, void, void> {
  const absDir = relDir === "" ? root : join(root, ...relDir.split("/"));
  const entries = await readdir(absDir, { withFileTypes: true });
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const rel = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
    if (entry.isDirectory()) {
      yield* walkDir(root, rel);
    } else if (entry.isFile()) {
      // Symlinks, sockets, and other non-regular files are not bundle
      // entries and are never followed.
      yield { relPath: rel, absPath: join(root, ...rel.split("/")) };
    }
  }
}

// ---------------------------------------------------------------------------
// Entry scanning
// ---------------------------------------------------------------------------

interface ScannedEntry {
  rawPath: string;
  sha256Hex: string;
  byteLength: number;
  entryDigestFull: Uint8Array;
  entryDigestStripped?: Uint8Array;
  json?: unknown;
}

interface FinalEntry {
  path: string;
  sha256Hex: string;
  byteLength: number;
  entryDigest: Uint8Array;
  json?: unknown;
}

interface HashedEntry {
  sha256Hex: string;
  byteLength: number;
  entryDigestFull: Uint8Array;
  entryDigestStripped?: Uint8Array;
  buffered?: Uint8Array;
}

/**
 * Stream an entry's content once, computing in parallel:
 *   - the plain content SHA-256 (file identity, artifact addressing),
 *   - the contents-hash entry digest SHA-256(path || 0x00 || content),
 *   - for tar entries below a potentially stripped root, the same entry
 *     digest under the stripped path variant,
 * while buffering the content only if it stays within the JSON candidacy
 * cap.
 */
async function hashEntryStream(
  path: string,
  strippedPathVariant: string | undefined,
  declaredSize: number | undefined,
  chunks: AsyncIterable<Uint8Array>
): Promise<HashedEntry> {
  const encoder = new TextEncoder();
  const contentHasher = sha256.create();
  const fullHasher = sha256.create();
  fullHasher.update(encoder.encode(path));
  fullHasher.update(NUL);
  const strippedHasher = strippedPathVariant === undefined ? undefined : sha256.create();
  if (strippedHasher !== undefined) {
    strippedHasher.update(encoder.encode(strippedPathVariant as string));
    strippedHasher.update(NUL);
  }

  let buffering = declaredSize === undefined || declaredSize <= MAX_CANDIDATE_JSON_BYTES;
  const buffered: Uint8Array[] = [];
  let total = 0;

  for await (const chunk of chunks) {
    contentHasher.update(chunk);
    fullHasher.update(chunk);
    strippedHasher?.update(chunk);
    total += chunk.length;
    if (buffering) {
      if (total > MAX_CANDIDATE_JSON_BYTES) {
        buffered.length = 0;
        buffering = false;
      } else {
        // Copy: tar body chunks are views into the container's stream
        // buffers and are not stable after iteration continues.
        buffered.push(chunk.slice());
      }
    }
  }

  return {
    sha256Hex: toHex(contentHasher.digest()),
    byteLength: total,
    entryDigestFull: fullHasher.digest(),
    ...(strippedHasher !== undefined ? { entryDigestStripped: strippedHasher.digest() } : {}),
    ...(buffering ? { buffered: concatBytes(buffered, total) } : {}),
  };
}

function makeScannedEntry(rawPath: string, hashed: HashedEntry): ScannedEntry {
  const json = hashed.buffered === undefined ? undefined : tryParseJsonObject(hashed.buffered);
  return {
    rawPath,
    sha256Hex: hashed.sha256Hex,
    byteLength: hashed.byteLength,
    entryDigestFull: hashed.entryDigestFull,
    ...(hashed.entryDigestStripped !== undefined
      ? { entryDigestStripped: hashed.entryDigestStripped }
      : {}),
    ...(json !== undefined ? { json } : {}),
  };
}

/**
 * Parse an entry as UTF-8 JSON with a single top-level object. Returns
 * undefined for anything else (invalid UTF-8, non-JSON, arrays,
 * primitives). A single leading UTF-8 BOM is tolerated for parsing; hashes
 * always cover the raw bytes including any BOM.
 */
function tryParseJsonObject(bytes: Uint8Array): unknown {
  let body = bytes;
  if (body.length >= 3 && body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf) {
    body = body.subarray(3);
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return undefined;
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Path handling
// ---------------------------------------------------------------------------

function normalizeEntryPath(raw: string): { path: string; unsafe: boolean; reason?: string } {
  if (raw.includes("\0")) {
    return { path: raw, unsafe: true, reason: "path contains a NUL byte" };
  }
  const absolute = raw.startsWith("/");
  const components = raw.split("/").filter((c) => c !== "" && c !== ".");
  const normalized = components.join("/");
  if (absolute) {
    return { path: normalized, unsafe: true, reason: "absolute path" };
  }
  if (components.some((c) => c === "..")) {
    return { path: normalized, unsafe: true, reason: "path escapes the bundle root" };
  }
  if (normalized === "") {
    return { path: normalized, unsafe: true, reason: "empty path" };
  }
  return { path: normalized, unsafe: false };
}

/**
 * Tar bundle-root normalization (spec section 4.1): if every entry sits
 * under one common top-level directory, that directory is the bundle root.
 * Applies if and only if all entries share the same first path component
 * and every entry has at least two components. Every file entry counts,
 * including skipped unsafe ones; an entry outside the candidate root
 * rules stripping out.
 */
class CommonRootTracker {
  private candidate: string | undefined;
  private ruledOut = false;

  observe(normalizedPath: string): void {
    if (this.ruledOut) return;
    const slash = normalizedPath.indexOf("/");
    if (slash === -1) {
      this.ruledOut = true;
      return;
    }
    const first = normalizedPath.slice(0, slash);
    if (first === "..") {
      this.ruledOut = true;
      return;
    }
    if (this.candidate === undefined) {
      this.candidate = first;
    } else if (this.candidate !== first) {
      this.ruledOut = true;
    }
  }

  commonRoot(): string | undefined {
    return this.ruledOut ? undefined : this.candidate;
  }
}

// ---------------------------------------------------------------------------
// Proof classification
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Proof-shaped per spec section 6.1: a string version plus object-valued
 * artifact, commit, and signer fields.
 */
function isProofShaped(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  return (
    typeof value["version"] === "string" &&
    isPlainObject(value["artifact"]) &&
    isPlainObject(value["commit"]) &&
    isPlainObject(value["signer"])
  );
}

type DuplicateKind = "new" | "exact-duplicate" | "semantic-duplicate";

function recordMemberProof(
  entry: FinalEntry,
  parsed: Record<string, unknown>,
  proofsByHash: Map<string, ObservedProof>,
  proofs: ObservedProof[],
  findings: AuditFinding[]
): DuplicateKind {
  const proofHash = computeProofHash(parsed);
  const source: ProofSource = {
    path: entry.path,
    fileSha256Hex: entry.sha256Hex,
    byteLength: entry.byteLength,
  };

  const embeddedStatus = embeddedProofHashStatus(parsed, proofHash);
  if (embeddedStatus === "mismatch") {
    findings.push({
      code: "proofhash-mismatch",
      path: entry.path,
      message: "embedded proofHash does not match the computed canonical proof hash",
      details: {
        embedded: parsed["proofHash"],
        computed: proofHash,
      },
    });
  }

  const existing = proofsByHash.get(proofHash);
  if (existing !== undefined) {
    const exact = existing.sources.some((s) => s.fileSha256Hex === source.fileSha256Hex);
    existing.sources.push(source);
    if (embeddedStatus === "mismatch") {
      existing.embeddedProofHash = "mismatch";
    }
    findings.push({
      code: exact ? "exact-duplicate" : "semantic-duplicate",
      path: entry.path,
      message: exact
        ? "byte-identical copy of an already observed proof"
        : "different byte encoding of an already observed proof (same canonical identity)",
      details: { proofHash, firstObservedAt: (existing.sources[0] as ProofSource).path },
    });
    return exact ? "exact-duplicate" : "semantic-duplicate";
  }

  const commit = isPlainObject(parsed["commit"]) ? parsed["commit"] : {};
  const signer = isPlainObject(parsed["signer"]) ? parsed["signer"] : {};
  const environment = isPlainObject(parsed["environment"]) ? parsed["environment"] : {};

  const counter = asString(commit["counter"]);
  const epochId = asString(commit["epochId"]);
  const chainIdRaw = asString(commit["chainId"]);

  const observed: ObservedProof = {
    proofHash,
    proof: parsed as unknown as BitGraphProof,
    sources: [source],
    version: "bitgraph/1",
    ...(counter !== undefined ? { counter } : {}),
    ...(asString(commit["slotCounter"]) !== undefined
      ? { slotCounter: asString(commit["slotCounter"]) as string }
      : {}),
    ...(asString(commit["prevB64"]) !== undefined
      ? { prevB64: asString(commit["prevB64"]) as string }
      : {}),
    ...(epochId !== undefined ? { epochId } : {}),
    chainId: chainIdRaw !== undefined && chainIdRaw.length > 0 ? chainIdRaw : "global",
    ...(asString(signer["publicKeyB64"]) !== undefined
      ? { publicKeyB64: asString(signer["publicKeyB64"]) as string }
      : {}),
    ...(asString(environment["measurement"]) !== undefined
      ? { measurement: asString(environment["measurement"]) as string }
      : {}),
    ...(asString(environment["enforcement"]) !== undefined
      ? { enforcement: asString(environment["enforcement"]) as string }
      : {}),
    hasSlotAllocation: isPlainObject(parsed["slotAllocation"]),
    hasAttestation: isPlainObject(environment["attestation"]),
    hasAgency: isPlainObject(parsed["agency"]),
    hasEpochLink: isPlainObject(commit["epochLink"]),
    embeddedProofHash: embeddedStatus,
    chainless: counter === undefined && epochId === undefined,
  };

  proofsByHash.set(proofHash, observed);
  proofs.push(observed);
  return "new";
}

function embeddedProofHashStatus(
  parsed: Record<string, unknown>,
  computed: string
): EmbeddedProofHashStatus {
  const embedded = parsed["proofHash"];
  if (embedded === undefined) return "absent";
  return typeof embedded === "string" && embedded === computed ? "match" : "mismatch";
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

// ---------------------------------------------------------------------------
// Artifact indexing and matching
// ---------------------------------------------------------------------------

function indexArtifact(entry: FinalEntry, artifactsByHex: Map<string, ArtifactRecord>): void {
  const existing = artifactsByHex.get(entry.sha256Hex);
  if (existing !== undefined) {
    existing.paths.push(entry.path);
    return;
  }
  artifactsByHex.set(entry.sha256Hex, {
    sha256Hex: entry.sha256Hex,
    sha256B64: Buffer.from(entry.sha256Hex, "hex").toString("base64"),
    byteLength: entry.byteLength,
    paths: [entry.path],
    matchedProofHashes: [],
  });
}

/**
 * Strict base64 digest decoding per spec section 6.3: RFC 4648 section 4
 * alphabet with the round-trip property, decoding to exactly 32 bytes.
 * Returns the lowercase hex form, or null when the digest is unusable for
 * matching (the proof's own verification records the precise failure).
 */
function strictDigestToHex(artifact: unknown): string | null {
  if (!isPlainObject(artifact)) return null;
  const digestB64 = artifact["digestB64"];
  if (typeof digestB64 !== "string" || digestB64.length === 0) return null;
  const decoded = Buffer.from(digestB64, "base64");
  if (decoded.toString("base64") !== digestB64) return null;
  if (decoded.length !== 32) return null;
  return decoded.toString("hex");
}

// ---------------------------------------------------------------------------
// Manifest classification
// ---------------------------------------------------------------------------

function classifyManifest(
  entry: FinalEntry,
  computedContentsHashB64: string,
  findings: AuditFinding[]
): ManifestReport {
  if (entry.json === undefined) {
    findings.push({
      code: "manifest-unparseable",
      path: entry.path,
      message: "root manifest.json did not parse as a single JSON object; proceeding as if no manifest were present",
    });
    return { path: entry.path, parsed: false, recognized: false, problems: [] };
  }

  const raw = entry.json as Record<string, unknown>;
  const version = raw["version"];
  if (version !== BUNDLE_VERSION) {
    findings.push({
      code: "manifest-unrecognized-version",
      path: entry.path,
      message: `manifest version ${JSON.stringify(version)} is not "${BUNDLE_VERSION}"; the manifest was not interpreted`,
      ...(typeof version === "string" ? { details: { version } } : {}),
    });
    return {
      path: entry.path,
      parsed: true,
      ...(typeof version === "string" ? { version } : {}),
      recognized: false,
      problems: [],
    };
  }

  const problems = validateManifestFields(raw);
  for (const problem of problems) {
    findings.push({
      code: "manifest-field-invalid",
      path: entry.path,
      message: problem,
    });
  }

  const report: ManifestReport = {
    path: entry.path,
    parsed: true,
    version: BUNDLE_VERSION,
    recognized: true,
    manifest: raw as BundleManifest,
    problems,
  };

  const declared = raw["contentsHashB64"];
  if (typeof declared === "string" && declared.length > 0) {
    const match = declared === computedContentsHashB64;
    report.contentsHash = {
      declaredB64: declared,
      computedB64: computedContentsHashB64,
      match,
    };
    if (!match) {
      findings.push({
        code: "manifest-contents-hash-mismatch",
        path: entry.path,
        message:
          "manifest contentsHashB64 does not match the computed contents hash; " +
          "the bundle held is not byte-for-byte the bundle the manifest describes. " +
          "Advisory: this does not fail any proof.",
        details: { declared, computed: computedContentsHashB64 },
      });
    }
  }

  return report;
}

/** Type checks per spec section 7.1. Unknown fields are tolerated. */
function validateManifestFields(m: Record<string, unknown>): string[] {
  const problems: string[] = [];
  const isStringArray = (v: unknown): boolean =>
    Array.isArray(v) && v.every((x) => typeof x === "string");

  if (m["epochIds"] !== undefined && !isStringArray(m["epochIds"])) {
    problems.push("manifest.epochIds must be an array of strings when present");
  }
  if (m["chainIds"] !== undefined && !isStringArray(m["chainIds"])) {
    problems.push("manifest.chainIds must be an array of strings when present");
  }
  if (
    m["proofCount"] !== undefined &&
    (typeof m["proofCount"] !== "number" || !Number.isInteger(m["proofCount"]) || m["proofCount"] < 0)
  ) {
    problems.push("manifest.proofCount must be a non-negative integer when present");
  }
  if (m["counterRanges"] !== undefined) {
    const ok =
      Array.isArray(m["counterRanges"]) &&
      m["counterRanges"].every(
        (r) =>
          isPlainObject(r) &&
          typeof r["epochId"] === "string" &&
          typeof r["chainId"] === "string" &&
          typeof r["min"] === "string" &&
          typeof r["max"] === "string"
      );
    if (!ok) {
      problems.push(
        "manifest.counterRanges must be an array of { epochId, chainId, min, max } string fields when present"
      );
    }
  }
  if (m["generatedAt"] !== undefined && typeof m["generatedAt"] !== "string") {
    problems.push("manifest.generatedAt must be a string when present");
  }
  if (m["contentsHashB64"] !== undefined) {
    const v = m["contentsHashB64"];
    let ok = typeof v === "string" && v.length > 0;
    if (ok) {
      const decoded = Buffer.from(v as string, "base64");
      ok = decoded.toString("base64") === v && decoded.length === 32;
    }
    if (!ok) {
      problems.push("manifest.contentsHashB64 must be standard base64 of 32 bytes when present");
    }
  }
  if (m["artifactsIncluded"] !== undefined && typeof m["artifactsIncluded"] !== "boolean") {
    problems.push("manifest.artifactsIncluded must be a boolean when present");
  }
  if (m["openEpochs"] !== undefined) {
    const ok =
      Array.isArray(m["openEpochs"]) &&
      m["openEpochs"].every(
        (e) =>
          isPlainObject(e) &&
          typeof e["epochId"] === "string" &&
          typeof e["counterAtSnapshot"] === "string"
      );
    if (!ok) {
      problems.push(
        "manifest.openEpochs must be an array of { epochId, counterAtSnapshot } string fields when present"
      );
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Byte helpers
// ---------------------------------------------------------------------------

function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

function concatBytes(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
