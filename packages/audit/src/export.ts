// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * Bundle archive builder: the producer counterpart of ingest.
 *
 * buildBundleArchive() assembles a spec-conformant bitgraph-bundle/1
 * .tar.gz archive (docs/BUNDLE-FORMAT.md) from in-memory proofs, anchor
 * proofs, anchor witnesses, and optional artifact bytes. This is generic,
 * read-side-safe bundle assembly: it never talks to a ledger, never reads
 * the clock (the advisory generatedAt string is passed in by the caller),
 * and never touches the network.
 *
 * Deterministic by construction: entries are written in raw-UTF-8-path-byte
 * order, tar header metadata is fixed (mtime 0, mode 0644, uid/gid 0), and
 * the manifest is serialized with a fixed field order. The same input
 * produces a byte-identical archive on the same runtime (the gzip layer's
 * bytes are fixed by zlib for a given input, so cross-runtime identity
 * additionally assumes the same zlib).
 *
 * Producer conformance (spec section 12.1) is enforced, not advised:
 * non-bitgraph/1 proofs, duplicate canonical identities, unsafe paths, and
 * a storedProofHash that disagrees with the computed canonical hash all
 * throw instead of producing a bundle that would audit dirty.
 */

import { gzipSync } from "node:zlib";
import { computeProofHash } from "@mikeargento/bitgraph-verify";
import { computeContentsHashB64, type ContentsHashEntry } from "./contents-hash.js";
import { writeTarArchive } from "./tar.js";

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

/** One member proof to include. */
export interface BundleArchiveProofEntry {
  /** The proof object (wire form or stored form). Must be version "bitgraph/1". */
  proof: Record<string, unknown>;
  /**
   * The stored proofHash to append as a trailing field (ledger stored form).
   * Must equal the computed canonical proof hash; a mismatch throws, because
   * shipping it would produce a proofhash-mismatch finding in every audit.
   * Omit to serialize the proof object as given.
   */
  storedProofHash?: string;
}

/** One anchor witness file to include (spec section 10.2). */
export interface BundleArchiveWitnessEntry {
  /** Bundle-root-relative path, e.g. "witnesses/123456.json" per the advisory layout. */
  path: string;
  /** The witness object, serialized verbatim as compact JSON. */
  witness: Record<string, unknown>;
}

/** Original artifact bytes to include. */
export interface BundleArchiveArtifactFile {
  /** File name (may contain subdirectories); placed under "artifacts/". Advisory, never load-bearing. */
  name: string;
  bytes: Uint8Array;
}

export interface BundleArchiveInput {
  /** Member proofs, placed under proofs/ per the advisory layout. */
  proofs: BundleArchiveProofEntry[];
  /**
   * Anchor proofs, placed under anchors/ per the advisory layout. They are
   * ordinary bitgraph/1 members; the separate group only controls placement.
   * A proof must appear in exactly one group (duplicates throw).
   */
  anchors?: BundleArchiveProofEntry[];
  witnesses?: BundleArchiveWitnessEntry[];
  artifactFiles?: BundleArchiveArtifactFile[];
  /** Advisory manifest field: distinct commit.epochId values, raw base64 form. */
  epochIds: string[];
  /** Advisory manifest field: distinct chain ids ("global" for the default chain). */
  chainIds: string[];
  /** Advisory manifest field: open-epoch snapshot declaration. Emitted only when non-empty. */
  openEpochs?: Array<{ epochId: string; counterAtSnapshot: string }>;
  /**
   * Advisory manifest field: ISO 8601 UTC generation time, supplied BY THE
   * CALLER. This function never reads the clock, so the same input always
   * produces the same archive.
   */
  generatedAt?: string;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Assemble a spec-conformant bitgraph-bundle/1 .tar.gz archive.
 *
 * @returns the gzipped tar bytes.
 * @throws {TypeError} on producer-conformance violations: a proof whose
 *   version is not exactly "bitgraph/1", a storedProofHash that does not
 *   match the computed canonical hash, duplicate canonical proof identities,
 *   unsafe or colliding entry paths, or a witness placed at the reserved
 *   root manifest.json path.
 */
export function buildBundleArchive(input: BundleArchiveInput): Uint8Array {
  const entries: ContentsHashEntry[] = [];
  const usedPaths = new Set<string>();
  const seenProofHashes = new Set<string>();
  const partitions = new Map<string, { epochId: string; chainId: string; min: bigint; max: bigint }>();

  const addEntry = (path: string, content: Uint8Array): void => {
    assertSafePath(path);
    if (path === "manifest.json") {
      throw new TypeError(
        'bitgraph-audit: "manifest.json" is the reserved root manifest path; entries may not claim it'
      );
    }
    if (usedPaths.has(path)) {
      throw new TypeError(`bitgraph-audit: duplicate bundle entry path "${path}"`);
    }
    usedPaths.add(path);
    entries.push({ path, content });
  };

  const addProofGroup = (group: BundleArchiveProofEntry[], prefix: "proofs" | "anchors"): void => {
    for (const entry of group) {
      const proof = entry.proof;
      if (proof["version"] !== "bitgraph/1") {
        throw new TypeError(
          `bitgraph-audit: only bitgraph/1 proofs are bundle members; got version ${JSON.stringify(
            proof["version"]
          )}`
        );
      }
      const canonicalHash = computeProofHash(proof);
      if (entry.storedProofHash !== undefined && entry.storedProofHash !== canonicalHash) {
        throw new TypeError(
          "bitgraph-audit: storedProofHash does not match the computed canonical proof hash; " +
            "refusing to produce a bundle that would carry a proofhash-mismatch finding"
        );
      }
      if (seenProofHashes.has(canonicalHash)) {
        throw new TypeError(
          `bitgraph-audit: duplicate proof (canonical hash ${canonicalHash}); ` +
            "each member must appear exactly once or the bundle audits with duplicate findings"
        );
      }
      seenProofHashes.add(canonicalHash);

      const commit = isPlainObject(proof["commit"]) ? (proof["commit"] as Record<string, unknown>) : {};
      const epochId = typeof commit["epochId"] === "string" && commit["epochId"].length > 0
        ? (commit["epochId"] as string)
        : undefined;
      const counter = typeof commit["counter"] === "string" && commit["counter"].length > 0
        ? (commit["counter"] as string)
        : undefined;
      const chainId = typeof commit["chainId"] === "string" && commit["chainId"].length > 0
        ? (commit["chainId"] as string)
        : "global";

      const path =
        epochId !== undefined && counter !== undefined
          ? `${prefix}/${toSafeId(epochId)}/${counter.padStart(12, "0")}-${toSafeId(canonicalHash)}.json`
          : `${prefix}/unpositioned/${toSafeId(canonicalHash)}.json`;

      const body =
        entry.storedProofHash !== undefined
          ? { ...proof, proofHash: entry.storedProofHash }
          : proof;
      addEntry(path, utf8(JSON.stringify(body)));

      if (epochId !== undefined && counter !== undefined) {
        let value: bigint | undefined;
        try {
          value = BigInt(counter);
        } catch {
          value = undefined;
        }
        if (value !== undefined && value >= 0n) {
          const key = `${epochId}\u0000${chainId}`;
          const existing = partitions.get(key);
          if (existing === undefined) {
            partitions.set(key, { epochId, chainId, min: value, max: value });
          } else {
            if (value < existing.min) existing.min = value;
            if (value > existing.max) existing.max = value;
          }
        }
      }
    }
  };

  addProofGroup(input.proofs, "proofs");
  addProofGroup(input.anchors ?? [], "anchors");

  for (const witness of input.witnesses ?? []) {
    addEntry(witness.path, utf8(JSON.stringify(witness.witness)));
  }

  for (const artifact of input.artifactFiles ?? []) {
    if (artifact.name.length === 0) {
      throw new TypeError("bitgraph-audit: artifact file names must be non-empty");
    }
    addEntry(`artifacts/${artifact.name}`, artifact.bytes);
  }

  // Contents hash over every entry except the manifest itself (spec section 8).
  const contentsHashB64 = computeContentsHashB64(entries);

  // Manifest with a fixed field order (spec section 7.1). Compact JSON.
  const counterRanges = Array.from(partitions.values())
    .sort((a, b) =>
      a.epochId < b.epochId ? -1 : a.epochId > b.epochId ? 1 : a.chainId < b.chainId ? -1 : a.chainId > b.chainId ? 1 : 0
    )
    .map((p) => ({ epochId: p.epochId, chainId: p.chainId, min: p.min.toString(), max: p.max.toString() }));

  const manifest: Record<string, unknown> = { version: "bitgraph-bundle/1" };
  manifest["epochIds"] = input.epochIds;
  manifest["chainIds"] = input.chainIds;
  manifest["proofCount"] = seenProofHashes.size;
  manifest["counterRanges"] = counterRanges;
  if (input.generatedAt !== undefined) manifest["generatedAt"] = input.generatedAt;
  manifest["contentsHashB64"] = contentsHashB64;
  manifest["artifactsIncluded"] = (input.artifactFiles?.length ?? 0) > 0;
  if (input.openEpochs !== undefined && input.openEpochs.length > 0) {
    manifest["openEpochs"] = input.openEpochs;
  }

  const manifestPath = "manifest.json";
  assertSafePath(manifestPath);
  entries.push({ path: manifestPath, content: utf8(JSON.stringify(manifest)) });

  // Fixed entry ordering: raw UTF-8 path bytes, unsigned byte-wise.
  const sorted = entries
    .map((entry) => ({ entry, pathBytes: utf8(entry.path) }))
    .sort((a, b) => compareBytes(a.pathBytes, b.pathBytes))
    .map(({ entry }) => ({ path: entry.path, content: entry.content }));

  const tarBytes = writeTarArchive(sorted);
  const gz = gzipSync(tarBytes, { level: 9 });
  return new Uint8Array(gz.buffer, gz.byteOffset, gz.byteLength);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Path-safe transform for base64 values in file names (spec section 9). */
function toSafeId(b64: string): string {
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Spec section 4.1: relative, no NUL, no "..", no leading "/" or "./", no empty segments. */
function assertSafePath(path: string): void {
  if (path.length === 0) throw new TypeError("bitgraph-audit: bundle entry paths must be non-empty");
  if (path.includes("\0")) throw new TypeError("bitgraph-audit: bundle entry paths must not contain NUL bytes");
  if (path.startsWith("/")) throw new TypeError(`bitgraph-audit: bundle entry path "${path}" must be relative`);
  const segments = path.split("/");
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") {
      throw new TypeError(`bitgraph-audit: bundle entry path "${path}" contains an unsafe component`);
    }
  }
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
