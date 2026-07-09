// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * Tests for @mikeargento/bitgraph-audit verification tiers: full
 * verification when artifact bytes are present (canonical verify()),
 * bytes-free integrity when they are absent (verifyProofIntegrity()),
 * exact failure reasons, VerificationPolicy passthrough, and per-run
 * epoch link state reset.
 */

import { describe, test, before, after } from "node:test";
import * as assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { computeProofHash } from "@mikeargento/bitgraph-verify";
import type { BitGraphProof } from "@mikeargento/bitgraph-verify";
import { ingestBundle, verifyObservedProofs } from "@mikeargento/bitgraph-audit";
import {
  b64,
  makeChainIdProof,
  makeConstructorProof,
  makeEpochLinkProof,
  makeTar,
  makeTempDir,
  proofJson,
  utf8,
  writeBundleDir,
} from "./audit-fixtures.js";
import { sha256 } from "@noble/hashes/sha256";

const tempDirs: string[] = [];

async function newBundleDir(): Promise<string> {
  const dir = await makeTempDir("bitgraph-audit-tiers-");
  tempDirs.push(dir);
  return dir;
}

after(async () => {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true });
  }
});

let fxProof!: BitGraphProof;
let fxBytes!: Uint8Array;
let fxHash!: string;

before(async () => {
  const made = await makeConstructorProof();
  fxProof = made.proof;
  fxBytes = made.bytes;
  fxHash = computeProofHash(fxProof);
});

function clone(proof: BitGraphProof): BitGraphProof {
  return JSON.parse(JSON.stringify(proof)) as BitGraphProof;
}

// ---------------------------------------------------------------------------
// Tier routing
// ---------------------------------------------------------------------------

describe("audit tiers: artifact present", () => {
  test("full verification through canonical verify(), status verified", async () => {
    const dir = await newBundleDir();
    await writeBundleDir(dir, {
      "proofs/p.json": proofJson(fxProof),
      "media/original.bin": fxBytes,
    });

    const ingest = await ingestBundle(dir);
    const summary = await verifyObservedProofs(ingest);

    assert.deepEqual(summary, {
      total: 1,
      verified: 1,
      failed: 0,
      artifactUnavailable: 0,
      chainless: 1,
    });
    const verification = ingest.proofs[0]!.verification!;
    assert.equal(verification.tier, "full");
    assert.equal(verification.status, "verified");
    assert.equal(verification.artifactPath, "media/original.bin");
    assert.equal(verification.reason, undefined);
  });

  test("tampered signature fails at the full tier with the verifier's exact reason", async () => {
    const tampered = clone(fxProof);
    const sigBytes = Buffer.from(tampered.signer.signatureB64, "base64");
    sigBytes[0] = (sigBytes[0]! + 1) % 256;
    tampered.signer.signatureB64 = sigBytes.toString("base64");

    const dir = await newBundleDir();
    await writeBundleDir(dir, {
      "proofs/p.json": proofJson(tampered),
      "media/original.bin": fxBytes,
    });

    const ingest = await ingestBundle(dir);
    const summary = await verifyObservedProofs(ingest);

    assert.equal(summary.failed, 1);
    const verification = ingest.proofs[0]!.verification!;
    assert.equal(verification.tier, "full");
    assert.equal(verification.status, "failed");
    assert.equal(verification.reason, "signature verification failed: signature does not match");
  });

  test("full verification works through a tar container (bytes re-streamed)", async () => {
    const dir = await newBundleDir();
    const tar = makeTar([
      { name: "proofs/p.json", content: proofJson(fxProof) },
      { name: "media/original.bin", content: fxBytes },
    ]);
    const tarPath = join(dir, "bundle.tar");
    await writeFile(tarPath, tar);

    const ingest = await ingestBundle(tarPath);
    const summary = await verifyObservedProofs(ingest);
    assert.equal(summary.verified, 1);
    assert.equal(ingest.proofs[0]!.verification!.tier, "full");
  });

  test("a proof with a signed chainId verifies fully (unknown-field tolerance end to end)", async () => {
    const made = await makeChainIdProof({ chainId: "bitgraph:main", counter: "2", epochId: "epoch-c" });
    const dir = await newBundleDir();
    await writeBundleDir(dir, {
      "p.json": proofJson(made.proof),
      "artifact.bin": made.bytes,
    });

    const ingest = await ingestBundle(dir);
    const summary = await verifyObservedProofs(ingest);
    assert.equal(summary.verified, 1);
    assert.equal(ingest.proofs[0]!.chainId, "bitgraph:main");
  });
});

describe("audit tiers: artifact absent", () => {
  test("integrity tier records artifact-unavailable, never verified", async () => {
    const dir = await newBundleDir();
    await writeBundleDir(dir, {
      "proofs/p.json": proofJson(fxProof),
    });

    const ingest = await ingestBundle(dir);
    const summary = await verifyObservedProofs(ingest);

    assert.deepEqual(summary, {
      total: 1,
      verified: 0,
      failed: 0,
      artifactUnavailable: 1,
      chainless: 1,
    });
    const verification = ingest.proofs[0]!.verification!;
    assert.equal(verification.tier, "integrity");
    assert.equal(verification.status, "artifact-unavailable");
    assert.equal(verification.artifactPath, undefined);
  });

  test("a decoy file named like the artifact does not bind (matching is content-addressed)", async () => {
    const dir = await newBundleDir();
    await writeBundleDir(dir, {
      "proofs/p.json": proofJson(fxProof),
      // Named to look like the artifact, but the bytes hash differently.
      "artifacts/original.bin": utf8("not the committed bytes"),
    });

    const ingest = await ingestBundle(dir);
    const summary = await verifyObservedProofs(ingest);
    assert.equal(summary.artifactUnavailable, 1);
    assert.equal(summary.verified, 0);
    assert.equal(ingest.proofs[0]!.verification!.tier, "integrity");
  });

  test("a corrupted artifact digest fails integrity with the verifier's exact reason", async () => {
    // Flip the committed digest to some other 32-byte value. Content
    // addressing then finds no artifact (the original bytes no longer
    // match), and the signature check fails because the digest sits
    // inside the signed body.
    const corrupted = clone(fxProof);
    corrupted.artifact.digestB64 = b64(sha256(utf8("some other content")));

    const dir = await newBundleDir();
    await writeBundleDir(dir, {
      "proofs/p.json": proofJson(corrupted),
      "media/original.bin": fxBytes,
    });

    const ingest = await ingestBundle(dir);
    const summary = await verifyObservedProofs(ingest);

    assert.equal(summary.failed, 1);
    assert.equal(summary.verified, 0);
    const verification = ingest.proofs[0]!.verification!;
    assert.equal(verification.tier, "integrity");
    assert.equal(verification.status, "failed");
    assert.equal(verification.reason, "signature verification failed: signature does not match");
    // The genuine artifact bytes did not bind to the corrupted digest.
    assert.equal(
      ingest.artifacts.find((a) => a.paths.includes("media/original.bin"))!.matchedProofHashes.length,
      0
    );
  });
});

// ---------------------------------------------------------------------------
// Deduplication and exclusion interplay
// ---------------------------------------------------------------------------

describe("audit tiers: unique verification", () => {
  test("semantic duplicates are verified once, as one observed proof", async () => {
    const dir = await newBundleDir();
    await writeBundleDir(dir, {
      "compact.json": JSON.stringify(fxProof),
      "pretty.json": JSON.stringify(fxProof, null, 2),
      "media/original.bin": fxBytes,
    });

    const ingest = await ingestBundle(dir);
    const summary = await verifyObservedProofs(ingest);
    assert.equal(summary.total, 1);
    assert.equal(summary.verified, 1);
    assert.equal(ingest.proofs[0]!.sources.length, 2);
  });

  test("unsupported-version files are excluded from verification entirely", async () => {
    const dir = await newBundleDir();
    await writeBundleDir(dir, {
      "legacy.json": JSON.stringify({
        version: "occ/1",
        artifact: { hashAlg: "sha256", digestB64: b64(sha256(fxBytes)) },
        commit: { nonceB64: "AAAA" },
        signer: { publicKeyB64: "AAAA", signatureB64: "AAAA" },
      }),
      "good.json": proofJson(fxProof),
    });

    const ingest = await ingestBundle(dir);
    const summary = await verifyObservedProofs(ingest);
    assert.equal(summary.total, 1);
    assert.equal(ingest.counts.unsupportedVersion, 1);
  });
});

// ---------------------------------------------------------------------------
// Policy passthrough
// ---------------------------------------------------------------------------

describe("audit tiers: VerificationPolicy passthrough", () => {
  test("trustAnchors constraints are applied by the canonical verifier", async () => {
    const dir = await newBundleDir();
    await writeBundleDir(dir, {
      "proofs/p.json": proofJson(fxProof),
      "media/original.bin": fxBytes,
    });

    const ingest = await ingestBundle(dir);
    const summary = await verifyObservedProofs(ingest, {
      trustAnchors: { allowedMeasurements: ["some-other-measurement"] },
    });

    assert.equal(summary.failed, 1);
    const verification = ingest.proofs[0]!.verification!;
    assert.equal(verification.status, "failed");
    assert.match(verification.reason ?? "", /is not in the allowed set/);
  });

  test("a satisfied policy leaves the proof verified", async () => {
    const dir = await newBundleDir();
    await writeBundleDir(dir, {
      "proofs/p.json": proofJson(fxProof),
      "media/original.bin": fxBytes,
    });

    const ingest = await ingestBundle(dir);
    const summary = await verifyObservedProofs(ingest, {
      trustAnchors: { allowedMeasurements: [fxProof.environment.measurement] },
    });
    assert.equal(summary.verified, 1);
  });
});

// ---------------------------------------------------------------------------
// Epoch link state
// ---------------------------------------------------------------------------

describe("audit tiers: epoch link state", () => {
  const predecessor = {
    prevEpochId: "epoch-predecessor",
    prevCounter: "42",
    prevProofHashB64: b64(sha256(utf8("terminal-proof-of-predecessor"))),
  };

  test("within one run, a second consumption of the same predecessor is a detected fork", async () => {
    const first = await makeEpochLinkProof({ ...predecessor, toEpochId: "epoch-successor-a" });
    const second = await makeEpochLinkProof({ ...predecessor, toEpochId: "epoch-successor-b" });

    const dir = await newBundleDir();
    // Observation order is deterministic (sorted directory walk):
    // a-genesis before b-genesis.
    await writeBundleDir(dir, {
      "a-genesis.json": proofJson(first.proof),
      "b-genesis.json": proofJson(second.proof),
    });

    const ingest = await ingestBundle(dir);
    const summary = await verifyObservedProofs(ingest);

    assert.equal(summary.total, 2);
    assert.equal(summary.artifactUnavailable, 1);
    assert.equal(summary.failed, 1);
    const a = ingest.proofs.find((p) => p.sources[0]!.path === "a-genesis.json")!;
    const b = ingest.proofs.find((p) => p.sources[0]!.path === "b-genesis.json")!;
    assert.equal(a.verification!.status, "artifact-unavailable");
    assert.equal(b.verification!.status, "failed");
    assert.match(b.verification!.reason ?? "", /FORK DETECTED/);
    assert.equal(a.hasEpochLink, true);
  });

  test("state is reset per run: a fresh audit is not poisoned by a previous one", async () => {
    const runOne = await makeEpochLinkProof({ ...predecessor, toEpochId: "epoch-successor-x" });
    const dirOne = await newBundleDir();
    await writeBundleDir(dirOne, { "genesis-x.json": proofJson(runOne.proof) });
    const ingestOne = await ingestBundle(dirOne);
    const summaryOne = await verifyObservedProofs(ingestOne);
    assert.equal(summaryOne.failed, 0);

    // A different successor consumes the same predecessor in a separate
    // bundle. Within one run that would be a fork; across runs the state
    // must have been reset, so this verifies cleanly.
    const runTwo = await makeEpochLinkProof({ ...predecessor, toEpochId: "epoch-successor-y" });
    const dirTwo = await newBundleDir();
    await writeBundleDir(dirTwo, { "genesis-y.json": proofJson(runTwo.proof) });
    const ingestTwo = await ingestBundle(dirTwo);
    const summaryTwo = await verifyObservedProofs(ingestTwo);
    assert.equal(summaryTwo.failed, 0);
    assert.equal(summaryTwo.artifactUnavailable, 1);
  });
});
