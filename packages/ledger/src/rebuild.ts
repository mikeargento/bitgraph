/**
 * BitGraph Ledger — Rebuild Index from S3
 *
 * If the database is lost, this script reconstructs the index
 * from the immutable S3 ledger. The S3 ledger is the source of truth.
 *
 * Usage:
 *   LEDGER_BUCKET=bitgraph-ledger DATABASE_URL=postgres://... npx tsx rebuild.ts
 */

import { Ledger } from "./s3.js";
import { LedgerIndex } from "./index-db.js";
import { proofKey, anchorKey } from "./types.js";

async function rebuild() {
  const bucket = process.env.LEDGER_BUCKET;
  const dbUrl = process.env.DATABASE_URL;

  if (!bucket || !dbUrl) {
    console.error("Required: LEDGER_BUCKET and DATABASE_URL");
    process.exit(1);
  }

  const ledger = new Ledger({ bucket });
  const index = new LedgerIndex(dbUrl);

  console.log("[rebuild] initializing index...");
  await index.reset();

  let proofCount = 0;
  let anchorCount = 0;

  // Rebuild proofs
  console.log("[rebuild] scanning proofs in S3...");
  for await (const proof of ledger.allProofs()) {
    const isAnchor = proof.attribution?.name?.startsWith("Ethereum") ?? false;
    const anchorBlock = isAnchor && proof.metadata
      ? (proof.metadata as Record<string, unknown>).anchor
        ? ((proof.metadata as Record<string, Record<string, unknown>>).anchor.blockNumber as number)
        : undefined
      : undefined;

    const s3Key = proofKey(proof.commit.epochId, proof.commit.counter, proof.proofHash);

    await index.indexProof({
      proofHash: proof.proofHash,
      artifactDigest: proof.artifact.digestB64,
      counter: proof.commit.counter,
      epochId: proof.commit.epochId,
      signerPub: proof.signer.publicKeyB64,
      enforcement: proof.environment.enforcement,
      measurement: proof.environment.measurement,
      attribution: proof.attribution?.name,
      isAnchor,
      anchorBlock,
      s3Key,
    });

    proofCount++;
    if (proofCount % 100 === 0) console.log(`[rebuild] ${proofCount} proofs indexed...`);
  }

  // Rebuild anchors
  console.log("[rebuild] scanning anchors in S3...");
  for await (const anchor of ledger.allAnchors()) {
    const s3Key = anchorKey(anchor.epochId, anchor.counter, anchor.anchorHashB64);

    await index.indexProof({
      proofHash: anchor.proof.proofHash,
      artifactDigest: anchor.proof.artifact.digestB64,
      counter: anchor.counter,
      epochId: anchor.epochId,
      signerPub: anchor.proof.signer.publicKeyB64,
      enforcement: anchor.proof.environment.enforcement,
      measurement: anchor.proof.environment.measurement,
      attribution: `Ethereum #${anchor.ethereum.blockNumber}`,
      isAnchor: true,
      anchorBlock: anchor.ethereum.blockNumber,
      anchorHash: anchor.ethereum.blockHash,
      s3Key,
    });

    anchorCount++;
  }

  console.log(`[rebuild] complete: ${proofCount} proofs, ${anchorCount} anchors`);
  await index.close();
}

rebuild().catch(err => {
  console.error("[rebuild] fatal:", err);
  process.exit(1);
});
