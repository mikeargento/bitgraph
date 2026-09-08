// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * bitgraph-audit anchor identification (G5)
 *
 * Ethereum anchors are ordinary chain members minted by the anchor
 * service: same counter sequence, same prevB64 links, same signing key as
 * every other proof on the chain. What makes a proof an anchor is the
 * SIGNED attribution:
 *
 *   - attribution.name === "Ethereum Anchor" is the discriminator.
 *   - attribution.message carries the Ethereum block hash string.
 *   - attribution.title carries the block number, only inside the signed
 *     Etherscan URL.
 *   - artifact.digestB64 is SHA-256 over the block-hash STRING.
 *
 * The unsigned metadata.type === "ethereum-anchor" is corroboration only:
 * agreement and disagreement are recorded, and metadata alone never makes
 * a proof an anchor. The unsigned metadata.anchor block timestamp is
 * never read; wall-clock evidence comes exclusively from verified anchor
 * witnesses (witness.ts). No wall-clock time is ever derived from a block
 * number.
 *
 * Run after verifyObservedProofs so the records carry the run
 * verification status; identification itself reads only the signed body.
 */

import { anchorKindOf, anchorMarkOf } from "@mikeargento/bitgraph-verify";
import type {
  AnchorIdentification,
  AnchorRecord,
  AuditFinding,
  IngestResult,
  ObservedProof,
} from "./types.js";

const ANCHOR_METADATA_TYPE = "ethereum-anchor";

/**
 * Strict Etherscan block URL, the exact form the anchor service signs
 * (packages/hosted/src/bitcoin-anchor.ts): https://etherscan.io/block/{n}.
 * Anything else is reported unparseable and the block number treated as
 * absent, never guessed.
 */
const ETHERSCAN_BLOCK_URL = /^https:\/\/etherscan\.io\/block\/([0-9]+)$/;

/**
 * Identify anchor proofs among the observed proofs. Read-only and
 * deterministic (observation order).
 */
export function identifyAnchors(ingest: IngestResult): AnchorIdentification {
  const anchors: AnchorRecord[] = [];
  const metadataOnlyProofHashes: string[] = [];
  const findings: AuditFinding[] = [];

  for (const proof of ingest.proofs) {
    const metadataType = readMetadataType(proof);
    // ⚠️ Two forms, and they are not equally strong. "authenticated" means the
    // enclave wrote commit.anchor after verifying the anchor service's
    // signature over the claim; "legacy-attribution" means only the signed
    // name says so, which is every anchor written before enclave v7
    // (2026-09-06) and most of the ledger. Both are anchors; only one is
    // backed by something inside the proof.
    const kind = anchorKindOf(proof.proof);

    if (kind === null) {
      if (metadataType === ANCHOR_METADATA_TYPE) {
        // Unsigned claim with no signed backing: recorded, never trusted.
        metadataOnlyProofHashes.push(proof.proofHash);
        findings.push({
          code: "anchor-metadata-only-claim",
          ...pathOf(proof),
          message:
            "unsigned metadata.type claims ethereum-anchor, but the proof carries neither a signed " +
            "commit.anchor nor the signed attribution name. Metadata is advisory and unsigned; the " +
            "proof is not treated as an anchor.",
          details: { proofHash: proof.proofHash },
        });
      }
      continue;
    }

    // Corroboration between the signed discriminator and the unsigned
    // metadata. Only a present-but-different type disagrees; an absent
    // type is simply absent corroboration.
    const corroboration =
      metadataType === ANCHOR_METADATA_TYPE
        ? ("agrees" as const)
        : metadataType === undefined
          ? ("absent" as const)
          : ("disagrees" as const);
    if (corroboration === "disagrees") {
      findings.push({
        code: "anchor-metadata-disagreement",
        ...pathOf(proof),
        message:
          `this proof is a signed Ethereum anchor, but unsigned metadata.type is ` +
          `${JSON.stringify(metadataType)}. The signed field governs; the disagreement is recorded.`,
        details: { proofHash: proof.proofHash, metadataType: metadataType as string },
      });
    }

    // An authenticated anchor carries its block in commit.anchor, which the
    // enclave signed. Reading it from there rather than from attribution is
    // what lets an anchor's attribution be used for something else — a
    // bitgraph-fuse/1 marker, for instance — without the block becoming
    // unreadable. Legacy anchors keep the old path exactly.
    const authenticated = anchorMarkOf(proof.proof);
    const blockHash = authenticated?.blockHash ?? readAttributionField(proof, "message");
    const title = readAttributionField(proof, "title");
    const blockNumber =
      authenticated !== null
        ? String(authenticated.blockNumber)
        : title !== undefined
          ? (ETHERSCAN_BLOCK_URL.exec(title)?.[1] ?? undefined)
          : undefined;
    // Only a legacy anchor depends on the title for its block number; an
    // authenticated one has already answered, so an absent title is not a
    // finding against it.
    if (blockNumber === undefined && kind === "legacy-attribution") {
      findings.push({
        code: "anchor-title-unparseable",
        ...pathOf(proof),
        message:
          title === undefined
            ? "anchor proof carries no signed attribution.title; the signed block number is absent"
            : "anchor attribution.title does not parse as an Etherscan block URL; the signed block number is treated as absent",
        details: {
          proofHash: proof.proofHash,
          ...(title !== undefined ? { title } : {}),
        },
      });
    }

    const verification = proof.verification;
    anchors.push({
      proofHash: proof.proofHash,
      ...(proof.epochId !== undefined ? { epochId: proof.epochId } : {}),
      chainId: proof.chainId,
      ...(proof.counter !== undefined ? { counter: proof.counter } : {}),
      ...(proof.slotCounter !== undefined ? { slotCounter: proof.slotCounter } : {}),
      ...(blockHash !== undefined ? { blockHash } : {}),
      ...(blockNumber !== undefined ? { blockNumber } : {}),
      metadataCorroboration: corroboration,
      ...(verification !== undefined
        ? {
            verificationTier: verification.tier,
            verificationStatus: verification.status,
            ...(verification.reason !== undefined ? { verificationReason: verification.reason } : {}),
          }
        : {}),
    });
  }

  return { anchors, metadataOnlyProofHashes, findings };
}

// ---------------------------------------------------------------------------
// Field readers (tolerant: structural problems belong to the verification
// dimension, not to anchor identification)
// ---------------------------------------------------------------------------

function readAttributionField(
  proof: ObservedProof,
  field: "name" | "title" | "message"
): string | undefined {
  const attribution = (proof.proof as unknown as Record<string, unknown>)["attribution"];
  if (attribution === null || typeof attribution !== "object" || Array.isArray(attribution)) {
    return undefined;
  }
  const value = (attribution as Record<string, unknown>)[field];
  return typeof value === "string" ? value : undefined;
}

function readMetadataType(proof: ObservedProof): string | undefined {
  const metadata = (proof.proof as unknown as Record<string, unknown>)["metadata"];
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) {
    return undefined;
  }
  const value = (metadata as Record<string, unknown>)["type"];
  return typeof value === "string" ? value : undefined;
}

function pathOf(proof: ObservedProof): { path?: string } {
  const path = proof.sources[0]?.path;
  return path !== undefined ? { path } : {};
}
