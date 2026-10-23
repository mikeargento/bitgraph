/**
 * BitGraph Ledger — Index Database
 *
 * Postgres index for fast lookups. NOT the source of truth.
 * Rebuildable from S3 at any time.
 *
 * Primary lookup: artifact digest → proof(s) + bounding anchors
 * This is the only query the product needs:
 *   "User uploads file → hash → find proof → find causal window"
 */

import postgres from "postgres";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS bitgraph_ledger_proofs (
    id              SERIAL PRIMARY KEY,
    proof_hash      TEXT NOT NULL UNIQUE,
    artifact_digest TEXT NOT NULL,
    counter         BIGINT NOT NULL,
    epoch_id        TEXT NOT NULL,
    signer_pub      TEXT NOT NULL,
    enforcement     TEXT NOT NULL,
    measurement     TEXT NOT NULL,
    attribution     TEXT,
    is_anchor       BOOLEAN NOT NULL DEFAULT FALSE,
    anchor_block    BIGINT,
    anchor_hash     TEXT,
    s3_key          TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_artifact_digest ON bitgraph_ledger_proofs(artifact_digest);
  CREATE INDEX IF NOT EXISTS idx_epoch_counter ON bitgraph_ledger_proofs(epoch_id, counter);
  CREATE INDEX IF NOT EXISTS idx_anchor ON bitgraph_ledger_proofs(is_anchor, epoch_id, counter);
`;

// ---------------------------------------------------------------------------
// Index
// ---------------------------------------------------------------------------

export class LedgerIndex {
  private sql: postgres.Sql;

  constructor(databaseUrl: string) {
    this.sql = postgres(databaseUrl);
  }

  async initialize(): Promise<void> {
    await this.sql.unsafe(SCHEMA);
  }

  /**
   * Index a proof.
   */
  async indexProof(params: {
    proofHash: string;
    artifactDigest: string;
    counter: string;
    epochId: string;
    signerPub: string;
    enforcement: string;
    measurement: string;
    attribution?: string;
    isAnchor: boolean;
    anchorBlock?: number;
    anchorHash?: string;
    s3Key: string;
  }): Promise<void> {
    await this.sql`
      INSERT INTO bitgraph_ledger_proofs (
        proof_hash, artifact_digest, counter, epoch_id,
        signer_pub, enforcement, measurement, attribution,
        is_anchor, anchor_block, anchor_hash, s3_key
      ) VALUES (
        ${params.proofHash}, ${params.artifactDigest}, ${BigInt(params.counter)}, ${params.epochId},
        ${params.signerPub}, ${params.enforcement}, ${params.measurement}, ${params.attribution || null},
        ${params.isAnchor}, ${params.anchorBlock || null}, ${params.anchorHash || null}, ${params.s3Key}
      ) ON CONFLICT (proof_hash) DO NOTHING
    `;
  }

  /**
   * Lookup proof(s) by artifact digest.
   * This is the primary user-facing query.
   */
  async lookupByArtifact(digestB64: string): Promise<Array<{
    proofHash: string;
    counter: string;
    epochId: string;
    attribution: string | null;
    s3Key: string;
  }>> {
    const rows = await this.sql`
      SELECT proof_hash, counter, epoch_id, attribution, s3_key
      FROM bitgraph_ledger_proofs
      WHERE artifact_digest = ${digestB64}
      ORDER BY epoch_id, counter
    `;
    return rows.map(r => ({
      proofHash: r.proof_hash as string,
      counter: String(r.counter),
      epochId: r.epoch_id as string,
      attribution: r.attribution as string | null,
      s3Key: r.s3_key as string,
    }));
  }

  /**
   * Find the front anchor that bounds a proof.
   * The front anchor is the first anchor with counter > proof counter
   * in the same epoch.
   */
  async findBoundingAnchor(epochId: string, counter: string): Promise<{
    proofHash: string;
    counter: string;
    anchorBlock: number;
    anchorHash: string;
    s3Key: string;
  } | null> {
    const rows = await this.sql`
      SELECT proof_hash, counter, anchor_block, anchor_hash, s3_key
      FROM bitgraph_ledger_proofs
      WHERE is_anchor = TRUE
        AND epoch_id = ${epochId}
        AND counter > ${BigInt(counter)}
      ORDER BY counter ASC
      LIMIT 1
    `;
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      proofHash: r.proof_hash as string,
      counter: String(r.counter),
      anchorBlock: Number(r.anchor_block),
      anchorHash: r.anchor_hash as string,
      s3Key: r.s3_key as string,
    };
  }

  /**
   * Find the previous anchor before a proof (for the causal window).
   */
  async findPreviousAnchor(epochId: string, counter: string): Promise<{
    proofHash: string;
    counter: string;
    anchorBlock: number;
    anchorHash: string;
    s3Key: string;
  } | null> {
    const rows = await this.sql`
      SELECT proof_hash, counter, anchor_block, anchor_hash, s3_key
      FROM bitgraph_ledger_proofs
      WHERE is_anchor = TRUE
        AND epoch_id = ${epochId}
        AND counter < ${BigInt(counter)}
      ORDER BY counter DESC
      LIMIT 1
    `;
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      proofHash: r.proof_hash as string,
      counter: String(r.counter),
      anchorBlock: Number(r.anchor_block),
      anchorHash: r.anchor_hash as string,
      s3Key: r.s3_key as string,
    };
  }

  /**
   * List recent proofs (for the explorer feed).
   */
  async listRecent(limit = 20, offset = 0): Promise<Array<{
    proofHash: string;
    artifactDigest: string;
    counter: string;
    epochId: string;
    attribution: string | null;
    isAnchor: boolean;
    anchorBlock: number | null;
  }>> {
    const rows = await this.sql`
      SELECT proof_hash, artifact_digest, counter, epoch_id, attribution, is_anchor, anchor_block
      FROM bitgraph_ledger_proofs
      ORDER BY epoch_id DESC, counter DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
    return rows.map(r => ({
      proofHash: r.proof_hash as string,
      artifactDigest: r.artifact_digest as string,
      counter: String(r.counter),
      epochId: r.epoch_id as string,
      attribution: r.attribution as string | null,
      isAnchor: r.is_anchor as boolean,
      anchorBlock: r.anchor_block ? Number(r.anchor_block) : null,
    }));
  }

  /** Total proof count. */
  async count(): Promise<number> {
    const [row] = await this.sql`SELECT COUNT(*) as total FROM bitgraph_ledger_proofs`;
    return Number(row.total);
  }

  /** Drop and recreate (for rebuild). */
  async reset(): Promise<void> {
    await this.sql`DROP TABLE IF EXISTS bitgraph_ledger_proofs`;
    await this.initialize();
  }

  async close(): Promise<void> {
    await this.sql.end();
  }
}
