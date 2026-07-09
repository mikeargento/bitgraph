// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * Tests for @mikeargento/bitgraph-audit ingest: container handling
 * (directory, tar, tar.gz), discovery by shape, the version policy,
 * duplicate detection, embedded proofHash cross-checks, manifest
 * validation, the deterministic contents hash, and path safety.
 */

import { describe, test, before, after } from "node:test";
import * as assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { computeProofHash } from "@mikeargento/bitgraph-verify";
import {
  computeContentsHashB64,
  ingestBundle,
} from "@mikeargento/bitgraph-audit";
import type { BitGraphProof } from "@mikeargento/bitgraph-verify";
import {
  b64,
  makeChainIdProof,
  makeConstructorProof,
  makeTar,
  makeTempDir,
  proofJson,
  storedProofJson,
  utf8,
  writeBundleDir,
} from "./audit-fixtures.js";

const tempDirs: string[] = [];

async function newBundleDir(): Promise<string> {
  const dir = await makeTempDir("bitgraph-audit-ingest-");
  tempDirs.push(dir);
  return dir;
}

after(async () => {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true });
  }
});

// Shared fixtures
let fxProof!: BitGraphProof;
let fxBytes!: Uint8Array;
let fxHash!: string;

before(async () => {
  const made = await makeConstructorProof();
  fxProof = made.proof;
  fxBytes = made.bytes;
  fxHash = computeProofHash(fxProof);
});

// ---------------------------------------------------------------------------
// Directory bundles
// ---------------------------------------------------------------------------

describe("audit ingest: directory bundles", () => {
  test("discovers proofs by shape, matches artifacts by content, ignores unrelated files", async () => {
    const dir = await newBundleDir();
    await writeBundleDir(dir, {
      "proofs/anything-goes.txt": storedProofJson(fxProof, fxHash),
      "media/original.bin": fxBytes,
      "notes/README.txt": "operator notes, not evidence",
    });

    const result = await ingestBundle(dir);

    assert.equal(result.container, "directory");
    assert.equal(result.counts.observed, 1);
    assert.equal(result.counts.proofFiles, 1);
    const proof = result.proofs[0]!;
    assert.equal(proof.proofHash, fxHash);
    assert.equal(proof.sources.length, 1);
    assert.equal(proof.sources[0]!.path, "proofs/anything-goes.txt");
    assert.equal(proof.embeddedProofHash, "match");

    // Artifact matched content-addressed; the README is an unmatched candidate.
    const matched = result.artifacts.filter((a) => a.matchedProofHashes.length > 0);
    assert.equal(matched.length, 1);
    assert.deepEqual(matched[0]!.paths, ["media/original.bin"]);
    assert.deepEqual(matched[0]!.matchedProofHashes, [fxHash]);
    const unmatched = result.artifacts.filter((a) => a.matchedProofHashes.length === 0);
    assert.equal(unmatched.length, 1);
    assert.deepEqual(unmatched[0]!.paths, ["notes/README.txt"]);

    // Unrelated files produce no findings.
    assert.deepEqual(result.findings, []);
  });

  test("version policy: occ/1 proof-shaped file is rejected with the stable code", async () => {
    const dir = await newBundleDir();
    await writeBundleDir(dir, {
      "legacy.json": JSON.stringify({
        version: "occ/1",
        artifact: { hashAlg: "sha256", digestB64: "AAAA" },
        commit: { nonceB64: "AAAA" },
        signer: { publicKeyB64: "AAAA", signatureB64: "AAAA" },
      }),
      "good.json": proofJson(fxProof),
    });

    const result = await ingestBundle(dir);

    assert.equal(result.counts.observed, 1);
    assert.equal(result.counts.unsupportedVersion, 1);
    const rejected = result.unsupportedVersions[0]!;
    assert.equal(rejected.code, "unsupported-version");
    assert.equal(rejected.path, "legacy.json");
    assert.equal(rejected.version, "occ/1");
    const finding = result.findings.find((f) => f.code === "unsupported-version");
    assert.ok(finding);
    assert.equal(finding.path, "legacy.json");
    // Excluded from observation entirely.
    assert.ok(result.proofs.every((p) => p.sources[0]!.path !== "legacy.json"));
  });

  test("unknown fields tolerated: signed chainId is extracted, absence normalizes to global", async () => {
    const withChain = await makeChainIdProof({ chainId: "bitgraph:main", counter: "2", epochId: "epoch-x" });
    const dir = await newBundleDir();
    await writeBundleDir(dir, {
      "a.json": proofJson(withChain.proof),
      "b.json": proofJson(fxProof),
    });

    const result = await ingestBundle(dir);
    assert.equal(result.counts.observed, 2);
    const chained = result.proofs.find((p) => p.sources[0]!.path === "a.json")!;
    const plain = result.proofs.find((p) => p.sources[0]!.path === "b.json")!;
    assert.equal(chained.chainId, "bitgraph:main");
    assert.equal(chained.counter, "2");
    assert.equal(chained.epochId, "epoch-x");
    assert.equal(chained.chainless, false);
    assert.equal(plain.chainId, "global");
  });

  test("exact duplicates: byte-identical copies collapse to one observed proof", async () => {
    const dir = await newBundleDir();
    const body = proofJson(fxProof);
    await writeBundleDir(dir, {
      "one/copy.json": body,
      "two/copy.json": body,
    });

    const result = await ingestBundle(dir);
    assert.equal(result.counts.observed, 1);
    assert.equal(result.counts.proofFiles, 2);
    assert.equal(result.counts.exactDuplicates, 1);
    assert.equal(result.counts.semanticDuplicates, 0);
    assert.equal(result.proofs[0]!.sources.length, 2);
    const finding = result.findings.find((f) => f.code === "exact-duplicate");
    assert.ok(finding);
    assert.equal(finding.details?.["proofHash"], fxHash);
  });

  test("semantic duplicates: different encodings of the same canonical identity", async () => {
    const dir = await newBundleDir();
    await writeBundleDir(dir, {
      "compact.json": JSON.stringify(fxProof),
      "pretty.json": JSON.stringify(fxProof, null, 2),
    });

    const result = await ingestBundle(dir);
    assert.equal(result.counts.observed, 1);
    assert.equal(result.counts.exactDuplicates, 0);
    assert.equal(result.counts.semanticDuplicates, 1);
    assert.equal(result.proofs[0]!.proofHash, fxHash);
    assert.equal(result.proofs[0]!.sources.length, 2);
    assert.ok(result.findings.find((f) => f.code === "semantic-duplicate"));
  });

  test("embedded proofHash mismatch is flagged with a stable code but still observed", async () => {
    const dir = await newBundleDir();
    await writeBundleDir(dir, {
      "tampered-hash.json": storedProofJson(fxProof, b64(new Uint8Array(32))),
    });

    const result = await ingestBundle(dir);
    assert.equal(result.counts.observed, 1);
    const proof = result.proofs[0]!;
    assert.equal(proof.embeddedProofHash, "mismatch");
    // Identity is always computed, never read from the file.
    assert.equal(proof.proofHash, fxHash);
    const finding = result.findings.find((f) => f.code === "proofhash-mismatch");
    assert.ok(finding);
    assert.equal(finding.details?.["computed"], proof.proofHash);
  });

  test("chainless classification: no counter and no epochId means observed-but-unchained", async () => {
    const chained = await makeConstructorProof({ withCounter: true, epochId: "epoch-chained" });
    const dir = await newBundleDir();
    await writeBundleDir(dir, {
      "chainless.json": proofJson(fxProof),
      "chained.json": proofJson(chained.proof),
    });

    const result = await ingestBundle(dir);
    const unchained = result.proofs.find((p) => p.sources[0]!.path === "chainless.json")!;
    const linked = result.proofs.find((p) => p.sources[0]!.path === "chained.json")!;
    assert.equal(unchained.chainless, true);
    assert.equal(linked.chainless, false);
    assert.equal(linked.counter, "1");
    assert.equal(linked.epochId, "epoch-chained");
    // Chainless is not an anomaly: no finding is emitted for it.
    assert.deepEqual(result.findings, []);
  });
});

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

describe("audit ingest: manifest", () => {
  test("contents hash verifies over every entry except the root manifest", async () => {
    const dir = await newBundleDir();
    const proofBytes = utf8(proofJson(fxProof));
    const contentsHashB64 = computeContentsHashB64([
      { path: "proofs/p.json", content: proofBytes },
      { path: "media/original.bin", content: fxBytes },
    ]);
    await writeBundleDir(dir, {
      "proofs/p.json": proofBytes,
      "media/original.bin": fxBytes,
      "manifest.json": JSON.stringify({
        version: "bitgraph-bundle/1",
        proofCount: 1,
        contentsHashB64,
        artifactsIncluded: true,
      }),
    });

    const result = await ingestBundle(dir);
    assert.ok(result.manifest);
    assert.equal(result.manifest.recognized, true);
    assert.deepEqual(result.manifest.problems, []);
    assert.equal(result.manifest.contentsHash?.match, true);
    assert.equal(result.computedContentsHashB64, contentsHashB64);
    assert.equal(result.findings.filter((f) => f.code === "manifest-contents-hash-mismatch").length, 0);
    // The manifest is never a proof, artifact, or witness.
    assert.equal(result.counts.observed, 1);
    assert.ok(result.artifacts.every((a) => !a.paths.includes("manifest.json")));
  });

  test("contents hash mismatch is an advisory finding, never a proof failure", async () => {
    const dir = await newBundleDir();
    await writeBundleDir(dir, {
      "proofs/p.json": proofJson(fxProof),
      "manifest.json": JSON.stringify({
        version: "bitgraph-bundle/1",
        contentsHashB64: "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=",
      }),
    });

    const result = await ingestBundle(dir);
    assert.equal(result.manifest?.contentsHash?.match, false);
    const finding = result.findings.find((f) => f.code === "manifest-contents-hash-mismatch");
    assert.ok(finding);
    // Advisory: the proof is still observed normally.
    assert.equal(result.counts.observed, 1);
    assert.equal(result.proofs[0]!.proofHash, fxHash);
  });

  test("manifest field type problems are reported per spec section 7.1", async () => {
    const dir = await newBundleDir();
    await writeBundleDir(dir, {
      "manifest.json": JSON.stringify({
        version: "bitgraph-bundle/1",
        proofCount: "five",
        epochIds: "not-an-array",
        futureUnknownField: { tolerated: true },
      }),
    });

    const result = await ingestBundle(dir);
    assert.ok(result.manifest);
    assert.equal(result.manifest.recognized, true);
    assert.equal(result.manifest.problems.length, 2);
    assert.equal(result.findings.filter((f) => f.code === "manifest-field-invalid").length, 2);
  });

  test("unrecognized manifest version is reported and the manifest is not interpreted", async () => {
    const dir = await newBundleDir();
    await writeBundleDir(dir, {
      "manifest.json": JSON.stringify({ version: "bitgraph-bundle/2", proofCount: 1 }),
      "proofs/p.json": proofJson(fxProof),
    });

    const result = await ingestBundle(dir);
    assert.equal(result.manifest?.recognized, false);
    assert.equal(result.manifest?.manifest, undefined);
    assert.ok(result.findings.find((f) => f.code === "manifest-unrecognized-version"));
    // Processing continues as if no manifest were present.
    assert.equal(result.counts.observed, 1);
  });
});

// ---------------------------------------------------------------------------
// Tar and tar.gz containers
// ---------------------------------------------------------------------------

describe("audit ingest: tar and tar.gz containers", () => {
  test("plain tar with a PAX long-name entry", async () => {
    const dir = await newBundleDir();
    const longPath = `proofs/${"very-long-directory-name-".repeat(6)}segment/proof.json`;
    assert.ok(longPath.length > 100);
    const tar = makeTar([
      { name: "long-name-truncated", paxPath: longPath, content: proofJson(fxProof) },
      { name: "media/original.bin", content: fxBytes },
      { name: "notes.txt", content: "unrelated" },
    ]);
    const tarPath = join(dir, "bundle.tar");
    await writeFile(tarPath, tar);

    const result = await ingestBundle(tarPath);
    assert.equal(result.container, "tar");
    assert.equal(result.counts.observed, 1);
    assert.equal(result.proofs[0]!.sources[0]!.path, longPath);
    const matched = result.artifacts.find((a) => a.matchedProofHashes.length > 0);
    assert.deepEqual(matched?.paths, ["media/original.bin"]);
  });

  test("GNU long-name entries are accepted", async () => {
    const dir = await newBundleDir();
    const longPath = `archive/${"gnu-long-name-".repeat(9)}tail/proof.json`;
    assert.ok(longPath.length > 100);
    const tar = makeTar([
      { name: "gnu-truncated", gnuLongName: longPath, content: proofJson(fxProof) },
      // Root-level entry so the single-top-level-directory rule does not apply.
      { name: "notes.txt", content: "unrelated" },
    ]);
    const tarPath = join(dir, "gnu.tar");
    await writeFile(tarPath, tar);

    const result = await ingestBundle(tarPath);
    assert.equal(result.strippedRootPrefix, undefined);
    assert.equal(result.counts.observed, 1);
    assert.equal(result.proofs[0]!.sources[0]!.path, longPath);
  });

  test("tar.gz round-trips identically to the plain tar", async () => {
    const dir = await newBundleDir();
    const tar = makeTar([
      { name: "proofs/p.json", content: proofJson(fxProof) },
      { name: "media/original.bin", content: fxBytes },
    ]);
    const tgzPath = join(dir, "bundle.tgz");
    await writeFile(tgzPath, gzipSync(tar));

    const result = await ingestBundle(tgzPath);
    assert.equal(result.container, "tar-gz");
    assert.equal(result.counts.observed, 1);
    assert.equal(result.proofs[0]!.proofHash, fxHash);
    assert.equal(result.artifacts.filter((a) => a.matchedProofHashes.length > 0).length, 1);
  });

  test("a single common top-level directory is stripped as the bundle root", async () => {
    const dir = await newBundleDir();
    const proofBytes = utf8(proofJson(fxProof));
    // Contents hash computed over bundle-root-relative (stripped) paths.
    const contentsHashB64 = computeContentsHashB64([
      { path: "proofs/p.json", content: proofBytes },
      { path: "media/original.bin", content: fxBytes },
    ]);
    const tar = makeTar([
      { name: "mybundle/proofs/p.json", content: proofBytes },
      { name: "mybundle/media/original.bin", content: fxBytes },
      {
        name: "mybundle/manifest.json",
        content: JSON.stringify({ version: "bitgraph-bundle/1", contentsHashB64 }),
      },
    ]);
    const tarPath = join(dir, "wrapped.tar");
    await writeFile(tarPath, tar);

    const result = await ingestBundle(tarPath);
    assert.equal(result.strippedRootPrefix, "mybundle");
    assert.equal(result.proofs[0]!.sources[0]!.path, "proofs/p.json");
    assert.ok(result.manifest, "manifest at the stripped root is the root manifest");
    assert.equal(result.manifest.contentsHash?.match, true);
  });

  test("unsafe paths are skipped and reported, and never contribute anywhere", async () => {
    const dir = await newBundleDir();
    const tar = makeTar([
      { name: "../escape.json", content: proofJson(fxProof) },
      { name: "/absolute.json", content: proofJson(fxProof) },
      { name: "good/p.json", content: proofJson(fxProof) },
    ]);
    const tarPath = join(dir, "unsafe.tar");
    await writeFile(tarPath, tar);

    const result = await ingestBundle(tarPath);
    assert.equal(result.counts.skippedUnsafePaths, 2);
    assert.equal(result.findings.filter((f) => f.code === "unsafe-path").length, 2);
    assert.equal(result.counts.observed, 1);
    assert.equal(result.proofs[0]!.sources.length, 1);
    assert.equal(result.proofs[0]!.sources[0]!.path, "good/p.json");
    // Skipped entries are excluded from the contents hash.
    assert.equal(
      result.computedContentsHashB64,
      computeContentsHashB64([{ path: "good/p.json", content: utf8(proofJson(fxProof)) }])
    );
  });

  test("duplicate tar paths: the last entry wins and the duplication is reported", async () => {
    const dir = await newBundleDir();
    const tar = makeTar([
      { name: "data/blob.bin", content: "first version" },
      { name: "data/blob.bin", content: "second version" },
      // Root-level entry so the single-top-level-directory rule does not apply.
      { name: "notes.txt", content: "unrelated" },
    ]);
    const tarPath = join(dir, "dupes.tar");
    await writeFile(tarPath, tar);

    const result = await ingestBundle(tarPath);
    assert.ok(result.findings.find((f) => f.code === "duplicate-path" && f.path === "data/blob.bin"));
    const blob = result.artifacts.find((a) => a.paths.includes("data/blob.bin"))!;
    assert.equal(blob.byteLength, utf8("second version").length);
    // Exactly one entry per path participates: the shadowed first version is gone.
    assert.equal(
      result.artifacts.filter((a) => a.paths.includes("data/blob.bin")).length,
      1
    );
  });
});

// ---------------------------------------------------------------------------
// Deterministic contents hash vectors (docs/BUNDLE-FORMAT.md section 8.3)
// ---------------------------------------------------------------------------

describe("audit ingest: contents hash test vectors", () => {
  test("empty hashed set reproduces the published vector", () => {
    assert.equal(
      computeContentsHashB64([]),
      "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU="
    );
  });

  test("two-entry set reproduces the published vector", () => {
    const entries = [
      // Deliberately supplied out of sorted order; the scheme sorts by path bytes.
      { path: "proofs/example.json", content: utf8('{"hello":"world"}\n') },
      { path: "artifacts/a.bin", content: new Uint8Array([0x00, 0x01, 0x02]) },
    ];
    assert.equal(
      computeContentsHashB64(entries),
      "uO+wswRbTl4WWwAuXVrdRjEVDs2jKq72iJhI95XoH3s="
    );
  });

  test("streaming ingest agrees with the one-shot vector implementation", async () => {
    const dir = await newBundleDir();
    await writeBundleDir(dir, {
      "artifacts/a.bin": new Uint8Array([0x00, 0x01, 0x02]),
      "proofs/example.json": utf8('{"hello":"world"}\n'),
    });
    const result = await ingestBundle(dir);
    assert.equal(result.computedContentsHashB64, "uO+wswRbTl4WWwAuXVrdRjEVDs2jKq72iJhI95XoH3s=");
  });
});

// ---------------------------------------------------------------------------
// Witness discovery
// ---------------------------------------------------------------------------

describe("audit ingest: anchor witness discovery", () => {
  test("witnesses are discovered by version discriminator, never by filename", async () => {
    const dir = await newBundleDir();
    await writeBundleDir(dir, {
      "some/dir/whatever.dat": JSON.stringify({
        version: "bitgraph-anchor-witness/1",
        headerRlpHex: "0xf90201",
        blockNumber: 19000000,
        blockHash: `0x${"ab".repeat(32)}`,
      }),
    });

    const result = await ingestBundle(dir);
    assert.equal(result.counts.witnesses, 1);
    assert.equal(result.witnesses[0]!.path, "some/dir/whatever.dat");
    assert.equal(result.witnesses[0]!.witness["blockNumber"], 19000000);
    // Witnesses are not artifact candidates.
    assert.equal(result.artifacts.length, 0);
  });
});
