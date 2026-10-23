/**
 * BitGraph Ledger — S3 Immutable Storage
 *
 * All writes use S3 Object Lock (COMPLIANCE mode, immutable retention).
 * All reads use deterministic keys.
 * No overwrites. No deletes. Append only.
 *
 * This is the source of truth. Everything else (Postgres, explorer)
 * is a rebuildable index.
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { sha256 } from "@noble/hashes/sha256";
import { canonicalize, computeProofHash } from "bitgraph";
import {
  type StoredProof,
  type StoredAnchor,
  type Finalization,
  proofKey,
  anchorKey,
  finalizationKey,
} from "./types.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface LedgerConfig {
  bucket: string;
  region?: string;
  /** Object Lock retention in days. Default: 3650 (10 years). */
  retentionDays?: number;
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

export class Ledger {
  private s3: S3Client;
  private bucket: string;
  private retentionDays: number;

  constructor(config: LedgerConfig) {
    this.s3 = new S3Client({ region: config.region || "us-east-2" });
    this.bucket = config.bucket;
    this.retentionDays = config.retentionDays ?? 3650;
  }

  // ── Write ──────────────────────────────────────────────────────────

  /**
   * Store a proof immutably.
   * Computes proofHash via canonical function, sets deterministic key, writes with Object Lock.
   */
  async storeProof(proof: Record<string, unknown>): Promise<StoredProof> {
    const proofHash = computeProofHash(proof);

    const stored: StoredProof = {
      ...(proof as unknown as Omit<StoredProof, "proofHash">),
      proofHash,
    };

    const commit = proof.commit as { epochId: string; counter: string };
    const key = proofKey(commit.epochId, commit.counter, proofHash);

    await this.putImmutable(key, stored);
    return stored;
  }

  /**
   * Store an Ethereum front anchor immutably.
   */
  async storeAnchor(
    proof: StoredProof,
    ethereum: { blockNumber: number; blockHash: string }
  ): Promise<StoredAnchor> {
    const anchorBody = {
      proofHash: proof.proofHash,
      epochId: proof.commit.epochId,
      counter: proof.commit.counter,
      blockNumber: ethereum.blockNumber,
      blockHash: ethereum.blockHash,
    };

    const hashBytes = sha256(canonicalize(anchorBody));
    const anchorHashB64 = Buffer.from(hashBytes).toString("base64");

    const stored: StoredAnchor = {
      proof,
      ethereum,
      epochId: proof.commit.epochId,
      counter: proof.commit.counter,
      anchorHashB64,
    };

    const key = anchorKey(stored.epochId, stored.counter, anchorHashB64);
    await this.putImmutable(key, stored);
    return stored;
  }

  /**
   * Store a finalization record (proof bounded between anchors).
   */
  async storeFinalization(fin: Finalization): Promise<void> {
    const key = finalizationKey(fin.proofHash);
    await this.putImmutable(key, fin);
  }

  // ── Read ───────────────────────────────────────────────────────────

  /**
   * Get a proof by its hash.
   */
  async getProof(epochId: string, counter: string, proofHash: string): Promise<StoredProof | null> {
    const key = proofKey(epochId, counter, proofHash);
    return this.getObject<StoredProof>(key);
  }

  /**
   * Get an anchor by its hash.
   */
  async getAnchor(epochId: string, counter: string, anchorHash: string): Promise<StoredAnchor | null> {
    const key = anchorKey(epochId, counter, anchorHash);
    return this.getObject<StoredAnchor>(key);
  }

  /**
   * Get finalization for a proof.
   */
  async getFinalization(proofHash: string): Promise<Finalization | null> {
    const key = finalizationKey(proofHash);
    return this.getObject<Finalization>(key);
  }

  /**
   * List all proofs in an epoch, ordered by counter.
   */
  async listProofs(epochId: string): Promise<string[]> {
    return this.listKeys(`proofs/${toSafeId(epochId)}/`);
  }

  /**
   * List all anchors in an epoch, ordered by counter.
   */
  async listAnchors(epochId: string): Promise<string[]> {
    return this.listKeys(`anchors/${toSafeId(epochId)}/`);
  }

  /**
   * List all epoch prefixes (for rebuild).
   */
  async listEpochs(): Promise<string[]> {
    const result = await this.s3.send(new ListObjectsV2Command({
      Bucket: this.bucket,
      Prefix: "proofs/",
      Delimiter: "/",
    }));
    return (result.CommonPrefixes || [])
      .map(p => p.Prefix?.replace("proofs/", "").replace("/", "") || "")
      .filter(Boolean);
  }

  // ── Rebuild ────────────────────────────────────────────────────────

  /**
   * Stream all proofs from S3 for index rebuilding.
   * Returns proofs in counter order per epoch.
   */
  async *allProofs(): AsyncGenerator<StoredProof> {
    const epochs = await this.listEpochs();
    for (const epoch of epochs) {
      const keys = await this.listProofs(epoch);
      for (const key of keys) {
        const proof = await this.getObject<StoredProof>(key);
        if (proof) yield proof;
      }
    }
  }

  /**
   * Stream all anchors from S3 for index rebuilding.
   */
  async *allAnchors(): AsyncGenerator<StoredAnchor> {
    const epochs = await this.listEpochs();
    for (const epoch of epochs) {
      const keys = await this.listAnchors(epoch);
      for (const key of keys) {
        const anchor = await this.getObject<StoredAnchor>(key);
        if (anchor) yield anchor;
      }
    }
  }

  // ── Internal ───────────────────────────────────────────────────────

  private async putImmutable(key: string, data: unknown): Promise<void> {
    const body = JSON.stringify(data, null, 2);

    const retention = new Date();
    retention.setDate(retention.getDate() + this.retentionDays);

    await this.s3.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentType: "application/json",
      ObjectLockMode: "COMPLIANCE",
      ObjectLockRetainUntilDate: retention,
    }));
  }

  private async getObject<T>(key: string): Promise<T | null> {
    try {
      const result = await this.s3.send(new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }));
      const body = await result.Body?.transformToString();
      if (!body) return null;
      return JSON.parse(body) as T;
    } catch (err) {
      if ((err as { name?: string }).name === "NoSuchKey") return null;
      throw err;
    }
  }

  private async listKeys(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let continuationToken: string | undefined;

    do {
      const result = await this.s3.send(new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }));

      for (const obj of result.Contents || []) {
        if (obj.Key) keys.push(obj.Key);
      }

      continuationToken = result.NextContinuationToken;
    } while (continuationToken);

    return keys.sort(); // counter-padded keys sort lexicographically = causal order
  }
}

function toSafeId(b64: string): string {
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
