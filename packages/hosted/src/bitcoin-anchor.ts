/**
 * Ethereum Anchor Service
 *
 * Commits a fresh Ethereum block hash to the BitGraph proof chain via TEE: the parent of the
 * head, one block behind `latest`, so that a depth-1 reorg (the common kind) cannot orphan a
 * block a proof's floor rests on. Ruled 2026-09-30 after positions 854-856 of that day got a
 * floor whose block Ethereum no longer knows.
 * The anchor proof is a NORMAL BitGraph proof on the SAME monotonic counter chain
 * as user proofs — same counter, same prevB64, same enclave key, same epoch.
 *
 * A block hash does not exist before its block is produced, so this anchor and
 * every proof chained AFTER it provably came after that block — the chain's
 * public wall-clock bound, one-directional (no earlier than). What the anchor
 * does for the proofs BEFORE it is fix their content, not their time: it is
 * hash-linked to the entire prior chain, so once it exists, earlier history
 * cannot be altered without breaking the chain that reaches it. Nothing is
 * written to Ethereum, so no proof gains a public "before this block" bound.
 *
 * Chain: User Proof → User Proof → ETH Anchor → User Proof → ETH Anchor
 *
 * "The future is the strongest clock."
 */

import { sha256 } from "@noble/hashes/sha256";
import { headerRlpFor, type RpcBlockHeader } from "./eth-header.js";
import { getPublicKeyAsync, signAsync } from "@noble/ed25519";

/**
 * Ledger identity hash — the FROZEN signed-body subset, not the full signed
 * body. MUST match computeProofHash() in packages/verify/src/proof-hash.ts
 * field for field; that file is the source of truth and explains why the
 * subset excludes `actor` and `policy` and why widening it would orphan every
 * S3 key already written. Inlined here only because Railway cannot resolve
 * the monorepo package. If the field list there ever changes, change it here
 * in the same commit.
 */
function computeProofHash(proof: Record<string, unknown>): string {
  const signer = proof.signer as { publicKeyB64: string } | undefined;
  const env = proof.environment as { enforcement: string; measurement: string; attestation?: { format: string } } | undefined;
  const signedBody: Record<string, unknown> = {
    version: proof.version,
    artifact: proof.artifact,
    commit: proof.commit,
    publicKeyB64: signer?.publicKeyB64,
    enforcement: env?.enforcement,
    measurement: env?.measurement,
  };
  if (proof.attribution) signedBody.attribution = proof.attribution;
  if (env?.attestation) signedBody.attestationFormat = env.attestation.format;
  const json = stableStringify(signedBody);
  return Buffer.from(sha256(new TextEncoder().encode(json))).toString("base64");
}

/** Recursive key-sort JSON — matches bitgraph's canonicalize(). */
function stableStringify(obj: unknown): string {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(stableStringify).join(",") + "]";
  const sorted = Object.keys(obj as Record<string, unknown>).sort();
  const entries = sorted
    .filter(k => (obj as Record<string, unknown>)[k] !== undefined)
    .map(k => JSON.stringify(k) + ":" + stableStringify((obj as Record<string, unknown>)[k]));
  return "{" + entries.join(",") + "}";
}

/* ── S3 persistence ── */

async function persistAnchor(
  proof: Record<string, unknown>,
  ethereum: { blockNumber: number; blockHash: string }
): Promise<void> {
  const bucket = process.env.LEDGER_BUCKET;
  if (!bucket) return;

  try {
    const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3" as string) as {
      S3Client: new (config: { region: string }) => { send: (cmd: unknown) => Promise<void> };
      PutObjectCommand: new (params: Record<string, unknown>) => unknown;
    };

    const s3 = new S3Client({ region: process.env.LEDGER_REGION || "us-east-2" });
    const commit = proof.commit as { counter: string; epochId: string };
    const proofHash = computeProofHash(proof);

    const safeEpoch = commit.epochId.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const safeHash = proofHash.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const counter = (commit.counter || "0").padStart(12, "0");
    const retention = new Date();
    retention.setDate(retention.getDate() + 3650);

    const stored = { ...proof, proofHash };

    // Store proof (same format as user proofs)
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: `proofs/${safeEpoch}/${counter}-${safeHash}.json`,
      Body: JSON.stringify(stored, null, 2),
      ContentType: "application/json",
      ObjectLockMode: "COMPLIANCE",
      ObjectLockRetainUntilDate: retention,
    }));

    // By-digest index (artifact hash → proof). Legacy single-object key.
    const artifact = proof.artifact as { digestB64: string };
    const safeDigest = artifact.digestB64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    await journalDigests({ client: s3, PutObjectCommand } as unknown as S3Ops, bucket, [artifact.digestB64, safeDigest]);
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: `by-digest/${safeDigest}.json`,
      Body: JSON.stringify(stored, null, 2),
      ContentType: "application/json",
    }));

    // Per-position by-digest entry (one per causal position). An interval
    // recurrence re-commits these exact bytes at a later counter; without a
    // per-position entry the recurrence's legacy write would clobber this
    // anchor in the shared index and the "same bits, two positions" view would
    // lose the original. Mirrors the website commit route's storeProofByDigest.
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: `by-digest/${safeDigest}/${safeEpoch}-${counter}.json`,
      Body: JSON.stringify(stored, null, 2),
      ContentType: "application/json",
    }));

    // Anchor index (time-ordered for causal window queries)
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const anchorBody = JSON.stringify({ ...stored, ethereum }, null, 2);
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: `anchors-by-time/${ts}-${ethereum.blockNumber}.json`,
      Body: anchorBody,
      ContentType: "application/json",
    }));

    // Counter-indexed anchor (for fast "next anchor after counter N" lookups)
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: `anchors/${safeEpoch}/${counter}.json`,
      Body: anchorBody,
      ContentType: "application/json",
    }));

    console.log(`[ledger] anchor stored: block=${ethereum.blockNumber} counter=${commit.counter}`);
  } catch (err) {
    console.error("[ledger] persist anchor failed:", (err as Error).message);
  }
}

/* ── Rolling same-bits intervals ── */

/**
 * Each committed Ethereum anchor BitGraphs the exact block-hash string as its
 * artifact. The engine counts INTERVAL_DEPTH NEW anchors, then re-BitGraphs the
 * anchor that opened that span through the normal TEE path as one "Interval"
 * checkpoint: a fresh slot, nonce, counter, chain link, signature, and
 * proofHash, but the identical artifact digest. Then it counts INTERVAL_DEPTH
 * more and lays the next checkpoint. Windows are back-to-back and NON
 * overlapping (one re-BitGraph per window, NOT one per anchor), each exactly
 * INTERVAL_DEPTH anchor occurrences wide regardless of how many ordinary
 * BitGraphs land in between. The counter distance between the two occurrences
 * measures the causal activity during that externally paced window.
 *
 * Recurrences are NOT anchors: they never write under anchors/, they carry
 * attribution.name "Interval" (not "Ethereum Anchor"), and the trigger only
 * ever reads anchors/, so a recurrence can neither be counted as an anchor nor
 * trigger further recurrences. This writes nothing to Ethereum; it only reuses
 * block hashes already recorded on-chain as publicly derived artifacts.
 *
 * Epoch-scoped: counters reset on every TEE restart (new epoch), so a window
 * is only closed when its INTERVAL_DEPTH-later anchor lands in the SAME epoch.
 * A restart abandons any windows still open in the prior epoch, keeping the
 * counter-distance measurement coherent within one epoch.
 */
const INTERVAL_DEPTH = 25;

function toSafeId(b64: string): string {
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

interface S3Ops {
  client: { send: (cmd: unknown) => Promise<{ Body?: { transformToString: () => Promise<string> }; Contents?: Array<{ Key?: string }>; IsTruncated?: boolean; NextContinuationToken?: string }> };
  PutObjectCommand: new (p: Record<string, unknown>) => unknown;
  GetObjectCommand: new (p: Record<string, unknown>) => unknown;
  ListObjectsV2Command: new (p: Record<string, unknown>) => unknown;
}

async function s3ops(): Promise<S3Ops | null> {
  if (!process.env.LEDGER_BUCKET) return null;
  const mod = await import("@aws-sdk/client-s3" as string) as unknown as {
    S3Client: new (config: { region: string }) => S3Ops["client"];
    PutObjectCommand: S3Ops["PutObjectCommand"];
    GetObjectCommand: S3Ops["GetObjectCommand"];
    ListObjectsV2Command: S3Ops["ListObjectsV2Command"];
  };
  const client = new mod.S3Client({ region: process.env.LEDGER_REGION || "us-east-2" });
  return { client, PutObjectCommand: mod.PutObjectCommand, GetObjectCommand: mod.GetObjectCommand, ListObjectsV2Command: mod.ListObjectsV2Command };
}

async function getObject(ops: S3Ops, bucket: string, key: string): Promise<string | null> {
  try {
    const res = await ops.client.send(new ops.GetObjectCommand({ Bucket: bucket, Key: key }));
    return res.Body ? await res.Body.transformToString() : null;
  } catch { return null; }
}

/** List the 12-digit counters of every object directly under a prefix, ascending. */
async function listCounters(ops: S3Ops, bucket: string, prefix: string): Promise<string[]> {
  const out: string[] = [];
  let token: string | undefined;
  do {
    const res = await ops.client.send(new ops.ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token, MaxKeys: 1000 }));
    for (const o of res.Contents ?? []) {
      const m = /(\d{12})\.json$/.exec(o.Key ?? "");
      if (m) out.push(m[1]);
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return out.sort();
}

/**
 * Write a proof's per-position by-digest entry, and backfill the prior legacy
 * occupant into ITS own per-position slot so the shared digest keeps every
 * occurrence. Mirrors website storeProofByDigest. `priorLegacy` must be read
 * BEFORE the commit (the TEE parent overwrites the legacy key fire-and-forget).
 */
async function storeByDigestPerPosition(
  ops: S3Ops,
  bucket: string,
  proof: Record<string, unknown>,
  digestB64: string,
  priorLegacy: Record<string, unknown> | null
): Promise<void> {
  const safeDigest = toSafeId(digestB64);
  const posKey = (p: Record<string, unknown>): string | null => {
    const c = p.commit as { epochId?: string; counter?: string } | undefined;
    if (!c?.epochId || !c?.counter) return null;
    return `by-digest/${safeDigest}/${toSafeId(c.epochId)}-${String(c.counter).padStart(12, "0")}.json`;
  };
  const k = posKey(proof);
  if (k) {
    await ops.client.send(new ops.PutObjectCommand({ Bucket: bucket, Key: k, Body: JSON.stringify(proof, null, 2), ContentType: "application/json" }));
  }
  if (priorLegacy) {
    const pk = posKey(priorLegacy);
    if (pk && pk !== k) {
      await ops.client.send(new ops.PutObjectCommand({ Bucket: bucket, Key: pk, Body: JSON.stringify(priorLegacy, null, 2), ContentType: "application/json" }));
    }
  }
  await ops.client.send(new ops.PutObjectCommand({ Bucket: bucket, Key: `by-digest/${safeDigest}.json`, Body: JSON.stringify(proof, null, 2), ContentType: "application/json" }));
}

// In-memory interval state for the current epoch. Rebuilt from the durable
// ledger on startup and on every epoch change, so the engine is restart-safe
// and never double-emits: a marker that already exists is skipped.
let intervalEpoch: string | null = null;
let anchorCounters: string[] = [];        // ordered anchor counters this epoch
let recurredOrig = new Set<string>();     // original counters whose window is closed
let baselineOrdinal = 0;                  // anchors before this ordinal predate the engine
let genesisSeeded = true;                 // has the genesis opening bookend been laid?
let reconciling = false;

/** Interval engine on/off. Deploying the code is inert until this is set, so
 *  no proofs land in the compliance-locked ledger until an operator opts in. */
function intervalsEnabled(): boolean {
  const v = (process.env.INTERVALS_ENABLED || "").toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/** All interval bookkeeping (closing markers, baseline, genesis) is namespaced
 *  by depth, so running additional window sizes later is a zero-migration add. */
function recurrencePrefix(safeEpoch: string): string {
  return `recurrences/${safeEpoch}/d${INTERVAL_DEPTH}/`;
}

async function rebuildIntervalState(epoch: string): Promise<void> {
  const ops = await s3ops();
  const bucket = process.env.LEDGER_BUCKET;
  if (!ops || !bucket) return;
  const safeEpoch = toSafeId(epoch);
  const prefix = recurrencePrefix(safeEpoch);
  anchorCounters = await listCounters(ops, bucket, `anchors/${safeEpoch}/`);
  recurredOrig = new Set(await listCounters(ops, bucket, prefix));

  // Baseline watermark, decided once per epoch and read back on restart:
  //  - Fewer than INTERVAL_DEPTH anchors exist → the engine caught this epoch
  //    at genesis (no complete window could have been missed). Baseline 0:
  //    every anchor from the first participates, and the genesis opening
  //    bookend is laid.
  //  - INTERVAL_DEPTH or more already exist → the engine is being enabled
  //    mid-epoch. Baseline = current count so history is NOT recurred
  //    retroactively (which would bunch every recurrence at one counter and
  //    make the distances meaningless), and no genesis bookend is laid.
  const baseText = await getObject(ops, bucket, `${prefix}_baseline.json`);
  if (baseText) {
    baselineOrdinal = (JSON.parse(baseText) as { baselineOrdinal?: number }).baselineOrdinal ?? 0;
  } else {
    baselineOrdinal = anchorCounters.length < INTERVAL_DEPTH ? 0 : anchorCounters.length;
    await ops.client.send(new ops.PutObjectCommand({
      Bucket: bucket,
      Key: `${prefix}_baseline.json`,
      Body: JSON.stringify({ baselineOrdinal, note: "anchors before this ordinal predate the interval engine and are never recurred" }, null, 2),
      ContentType: "application/json",
    }));
  }

  // The genesis opening bookend is laid only when the epoch was caught at
  // genesis (baseline 0). The _genesis marker makes it idempotent across restarts.
  genesisSeeded = baselineOrdinal !== 0 || (await getObject(ops, bucket, `${prefix}_genesis.json`)) !== null;

  intervalEpoch = epoch;
  console.log(`[interval] state rebuilt for epoch: ${anchorCounters.length} anchors, ${recurredOrig.size} closed, baseline=${baselineOrdinal}, genesisSeeded=${genesisSeeded}`);
}

/** The exact block-hash bytes an anchor committed, recovered from the ledger. */
async function loadAnchorBytes(ops: S3Ops, bucket: string, safeEpoch: string, counter: string): Promise<{ blockHash: string; blockNumber?: number } | null> {
  const text = await getObject(ops, bucket, `anchors/${safeEpoch}/${counter}.json`);
  if (!text) return null;
  const a = JSON.parse(text) as { attribution?: { message?: string }; metadata?: { anchor?: { blockHash?: string; blockNumber?: number } }; ethereum?: { blockNumber?: number } };
  const blockHash = a.attribution?.message ?? a.metadata?.anchor?.blockHash;
  if (!blockHash) return null;
  return { blockHash, blockNumber: a.metadata?.anchor?.blockNumber ?? a.ethereum?.blockNumber };
}

/**
 * Re-BitGraph an anchor's exact block-hash bytes at a fresh causal position
 * through the normal TEE commit path: identical artifact digest, new slot,
 * nonce, counter, chain link, signature, and proofHash. This is just a plain
 * BitGraph of bytes that were already BitGraphed. Persists the per-position
 * by-digest entry (and backfills the prior occupant) so both occurrences of the
 * same bits survive in the shared index. The TEE parent already writes
 * proofs/{epoch}/{counter}.json and the legacy by-digest key, so the recurrence
 * appears on the chain for free.
 */
async function reBitgraphAnchorBytes(
  ops: S3Ops,
  bucket: string,
  blockHash: string,
  blockNumber: number | undefined,
  originalCounter: string,
  role: "genesis-open" | "rolling-close"
): Promise<{ rcCounter: string; proofHash: string } | null> {
  const digestB64 = toBase64(sha256(new TextEncoder().encode(blockHash)));
  const priorLegacy = await getObject(ops, bucket, `by-digest/${toSafeId(digestB64)}.json`)
    .then((t) => (t ? (JSON.parse(t) as Record<string, unknown>) : null))
    .catch(() => null);

  const res = await fetch(`${TEE_URL}/commit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      digests: [{ digestB64, hashAlg: "sha256" }],
      chainId: "bitgraph:main",
      // Signed. name "Interval" distinguishes a recurrence from a real anchor.
      // title is a REAL etherscan URL for the original block (renders as a
      // working "Link" on the proof page); the interval framing lives in
      // metadata.interval, not in a fake link.
      attribution: {
        name: "Interval",
        message: blockHash,
        ...(blockNumber !== undefined ? { title: `https://etherscan.io/block/${blockNumber}` } : {}),
      },
      // Unsigned, advisory: the interval measurement and its origin.
      metadata: {
        type: "interval-recurrence",
        interval: {
          depth: INTERVAL_DEPTH,
          role,
          originalCounter: String(parseInt(originalCounter, 10)),
          originalBlockNumber: blockNumber,
          originalBlockHash: blockHash,
        },
      },
    }),
  });
  if (!res.ok) throw new Error(`TEE ${res.status}`);

  const data = await res.json();
  const proof = (Array.isArray(data) ? data[0] : data.proofs?.[0] ?? data) as Record<string, unknown>;
  const rcCounter = String((proof.commit as { counter?: string } | undefined)?.counter ?? "0");
  const proofHash = computeProofHash(proof);
  await storeByDigestPerPosition(ops, bucket, { ...proof, proofHash }, digestB64, priorLegacy);
  return { rcCounter, proofHash };
}

/** COMPLIANCE-locked durable marker (idempotency + interval record). */
async function putMarker(ops: S3Ops, bucket: string, key: string, body: Record<string, unknown>): Promise<void> {
  const retention = new Date();
  retention.setDate(retention.getDate() + 3650);
  await ops.client.send(new ops.PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: JSON.stringify(body, null, 2),
    ContentType: "application/json",
    ObjectLockMode: "COMPLIANCE",
    ObjectLockRetainUntilDate: retention,
  }));
}

/**
 * Close one anchor's rolling window: re-BitGraph its bytes INTERVAL_DEPTH
 * anchors after it appeared. Idempotent via the per-depth {origCounter} marker.
 */
async function commitRecurrence(origCounter: string): Promise<boolean> {
  const ops = await s3ops();
  const bucket = process.env.LEDGER_BUCKET;
  if (!ops || !bucket || !intervalEpoch) return false;
  const safeEpoch = toSafeId(intervalEpoch);
  const bytes = await loadAnchorBytes(ops, bucket, safeEpoch, origCounter);
  if (!bytes) { console.error(`[interval] anchor bytes missing: ${origCounter}`); return false; }
  try {
    const rc = await reBitgraphAnchorBytes(ops, bucket, bytes.blockHash, bytes.blockNumber, origCounter, "rolling-close");
    if (!rc) return false;
    const distance = parseInt(rc.rcCounter, 10) - parseInt(origCounter, 10);
    await putMarker(ops, bucket, `${recurrencePrefix(safeEpoch)}${origCounter}.json`, {
      originalCounter: String(parseInt(origCounter, 10)),
      recurrenceCounter: rc.rcCounter,
      counterDistance: distance,
      intervalDepthAnchors: INTERVAL_DEPTH,
      blockNumber: bytes.blockNumber,
      blockHash: bytes.blockHash,
      proofHash: rc.proofHash,
    });
    console.log(`[interval] closed window block#${bytes.blockNumber} orig=${parseInt(origCounter, 10)} rc=${rc.rcCounter} distance=${distance}`);
    return true;
  } catch (err) {
    console.error(`[interval] recurrence failed for ${origCounter}:`, (err as Error).message);
    return false;
  }
}

/**
 * Lay the genesis opening bookend: the moment an epoch's first anchor exists,
 * re-BitGraph its bytes immediately so the interval series is live from genesis
 * instead of dark for the first ~INTERVAL_DEPTH anchors. Its closing bookend is
 * the ordinary +INTERVAL_DEPTH recurrence of that same first anchor, so the
 * first anchor's bytes are BitGraphed three times (the anchor, this opening,
 * and the close). Idempotent via the _genesis marker.
 */
async function maybeSeedGenesis(): Promise<void> {
  if (genesisSeeded || !intervalEpoch) return;
  const ops = await s3ops();
  const bucket = process.env.LEDGER_BUCKET;
  if (!ops || !bucket) return;
  const safeEpoch = toSafeId(intervalEpoch);
  const firstCounter = anchorCounters[0];
  if (!firstCounter) return;
  const marker = `${recurrencePrefix(safeEpoch)}_genesis.json`;
  if (await getObject(ops, bucket, marker)) { genesisSeeded = true; return; }
  const bytes = await loadAnchorBytes(ops, bucket, safeEpoch, firstCounter);
  if (!bytes) return;
  try {
    const rc = await reBitgraphAnchorBytes(ops, bucket, bytes.blockHash, bytes.blockNumber, firstCounter, "genesis-open");
    if (!rc) return;
    await putMarker(ops, bucket, marker, {
      role: "genesis-open",
      firstAnchorCounter: String(parseInt(firstCounter, 10)),
      openingCounter: rc.rcCounter,
      intervalDepthAnchors: INTERVAL_DEPTH,
      blockNumber: bytes.blockNumber,
      blockHash: bytes.blockHash,
      proofHash: rc.proofHash,
      note: "opening bookend of the genesis interval; closed by the +depth recurrence of the same anchor",
    });
    genesisSeeded = true;
    console.log(`[interval] genesis opening laid: firstAnchor=${parseInt(firstCounter, 10)} openingCounter=${rc.rcCounter}`);
  } catch (err) {
    console.error("[interval] genesis seed failed:", (err as Error).message);
  }
}

/**
 * Emit any due checkpoints. Windows are back-to-back and NON-overlapping: one
 * re-BitGraph per INTERVAL_DEPTH anchors, not one per anchor. Only anchors
 * whose ordinal is a whole number of windows past the baseline (baseline,
 * baseline+DEPTH, baseline+2*DEPTH, …) are re-BitGraphed, and only once each
 * exactly INTERVAL_DEPTH anchors have accrued behind the newest. So the engine
 * counts DEPTH new anchors, lays one checkpoint bracketing that span, counts
 * DEPTH more, and so on. Runs after each new anchor; guarded against overlap.
 */
async function reconcileIntervals(): Promise<void> {
  if (reconciling || !intervalEpoch) return;
  reconciling = true;
  try {
    const dueCount = anchorCounters.length - INTERVAL_DEPTH;
    for (let i = baselineOrdinal; i < dueCount; i++) {
      // Sparse: one checkpoint per window, at each DEPTH-th anchor past baseline.
      if ((i - baselineOrdinal) % INTERVAL_DEPTH !== 0) continue;
      const origCounter = anchorCounters[i];
      if (recurredOrig.has(origCounter)) continue;
      const ok = await commitRecurrence(origCounter);
      if (ok) recurredOrig.add(origCounter);
    }
  } finally {
    reconciling = false;
  }
}

/**
 * Record a freshly committed anchor for interval tracking, lay the genesis
 * bookend if this is a fresh epoch, and emit due recurrences. Detects a TEE
 * restart (new epoch) and rebuilds state from the ledger, abandoning windows
 * left open in the prior epoch. Inert until INTERVALS_ENABLED is set.
 */
async function trackAnchorForIntervals(proof: unknown): Promise<void> {
  if (!intervalsEnabled()) return;
  const commit = (proof as { commit?: { epochId?: string; counter?: string } })?.commit;
  const epoch = commit?.epochId;
  const counter = commit?.counter;
  if (!epoch || !counter) return;
  try {
    if (epoch !== intervalEpoch) {
      await rebuildIntervalState(epoch);
    }
    const padded = String(counter).padStart(12, "0");
    if (!anchorCounters.includes(padded)) {
      anchorCounters.push(padded);
      anchorCounters.sort();
    }
    await maybeSeedGenesis();
    await reconcileIntervals();
  } catch (err) {
    console.error("[interval] tracking failed:", (err as Error).message);
  }
}

/* ── Ethereum RPC ── */

const TEE_URL = "https://nitro.occproof.com";
/**
 * Anchor cadence. 12 s is one Ethereum slot ("fire it up"); the operator sets
 * 3600 s at rest. Nothing here waits for finality: each anchor is the parent
 * of whatever head the RPC reports (`latest - 1`). At 12 s or less the service
 * runs the head watcher (anchor when a new head appears), above 12 s a plain
 * free-running timer. See "State & scheduling".
 */
let anchorIntervalMs = 12 * 1000;

/** Public RPCs, tried in order. Shared by the block fetch and the head watcher. */
const ETH_RPC_ENDPOINTS = [
  "https://ethereum-rpc.publicnode.com",
  "https://rpc.ankr.com/eth",
  "https://eth.llamarpc.com",
];

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

interface EthBlock {
  hash: string;
  number: number;
  timestamp: number;
  /**
   * The RPC's own header fields, kept rather than discarded.
   *
   * They arrive with every block we already fetch, and they are what lets an
   * anchor carry its own evidence: keccak256 of their RLP is the block hash
   * this anchor signs. Optional so a response that omits any of them simply
   * yields no header, never a wrong one.
   */
  header?: RpcBlockHeader;
}

async function getLatestBlock(): Promise<EthBlock> {
  // The head is fetched only to name its parent: the block returned is `latest - 1`, by hash,
  // so the two reads agree with each other even if the head moved between them.
  for (const rpc of ETH_RPC_ENDPOINTS) {
    try {
      const res = await fetch(rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "eth_getBlockByNumber",
          params: ["latest", false],
          id: 1,
        }),
      });

      if (!res.ok) continue;
      const head = await res.json() as { result?: RpcBlockHeader };
      if (!head.result?.hash || !head.result.parentHash) continue;
      const parentRes = await fetch(rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "eth_getBlockByHash",
          params: [head.result.parentHash, false],
          id: 2,
        }),
      });
      if (!parentRes.ok) continue;
      const data = await parentRes.json() as { result?: RpcBlockHeader };
      if (!data.result?.hash || data.result.hash.toLowerCase() !== head.result.parentHash.toLowerCase()) continue;

      return {
        hash: data.result.hash,
        number: parseInt(data.result.number, 16),
        timestamp: parseInt(data.result.timestamp, 16),
        header: data.result,
      };
    } catch { continue; }
  }

  throw new Error("Could not fetch Ethereum block from any RPC endpoint");
}

/** Per-request timeout for the head watcher's cheap polls. */
const HEAD_FETCH_TIMEOUT_MS = 4000;

/**
 * The head's block number only (`eth_blockNumber`), for the head watcher. Much
 * cheaper than a block fetch, and it is only a trigger: the anchor itself is
 * still chosen by getLatestBlock (`latest - 1`, by hash). Each request is bounded
 * so a hung endpoint cannot stall the watcher.
 */
async function fetchHeadNumber(): Promise<number> {
  for (const rpc of ETH_RPC_ENDPOINTS) {
    try {
      const res = await fetch(rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", params: [], id: 1 }),
        signal: AbortSignal.timeout(HEAD_FETCH_TIMEOUT_MS),
      });
      if (!res.ok) continue;
      const data = await res.json() as { result?: unknown };
      if (typeof data.result !== "string") continue;
      const n = parseInt(data.result, 16);
      if (!Number.isSafeInteger(n) || n <= 0) continue;
      return n;
    } catch { continue; }
  }
  throw new Error("Could not fetch the Ethereum head number from any RPC endpoint");
}

/* ── TEE commit ── */

/**
 * Commit an Ethereum block hash to the BitGraph chain via TEE.
 *
 * The anchor proof is a normal BitGraph proof where:
 * - artifact.digestB64 = SHA-256(blockHash) — the block hash IS the artifact
 * - attribution.name = "Ethereum Anchor" (signed, human-readable label)
 * - attribution.message = blockHash (signed, the actual anchor data)
 * - metadata = { type: "ethereum-anchor", ... } (unsigned, advisory)
 *
 * It shares the same counter, prevB64, epochId, and signing key as all
 * other proofs on this chain. It IS the chain.
 */
async function commitAnchor(block: EthBlock): Promise<{ proof: unknown; digestB64: string } | null> {
  const blockHash = block.hash.toLowerCase();
  const hashBytes = sha256(new TextEncoder().encode(blockHash));
  const digestB64 = toBase64(hashBytes);
  // Self-checked: null unless keccak256 of the encoding IS this block hash.
  const headerRlp = headerRlpFor(block.header, blockHash);
  if (!headerRlp) console.warn(`[eth-anchor] no header witness for block ${block.number}; it will need an RPC to check`);

  try {
    // Enclave v7: prove to the enclave that this is the anchor service, so the
    // enclave signs commit.anchor into the proof. Without the key (local dev)
    // the commit goes out as before; an enclave older than v7 ignores the
    // field, and v7 refuses the reserved attribution name without it.
    const anchor = await signAnchorClaim(ANCHOR_CHAIN_ID, block.number, blockHash);
    const res = await fetch(`${TEE_URL}/commit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        digests: [{ digestB64, hashAlg: "sha256" }],
        chainId: ANCHOR_CHAIN_ID,
        // Attribution is SIGNED — block data is tamper-evident
        attribution: {
          name: "Ethereum Anchor",
          message: blockHash,
          title: `https://etherscan.io/block/${block.number}`,
        },
        ...(anchor ? { anchor } : {}),
        // Metadata is NOT signed — advisory only
        metadata: {
          type: "ethereum-anchor",
          anchor: {
            network: "mainnet",
            blockNumber: block.number,
            blockHash,
            blockTime: block.timestamp,
            blockTimeISO: new Date(block.timestamp * 1000).toISOString(),
            /**
             * The header these bytes hash to, so the anchor is checkable
             * with nothing but itself. Unsigned like the rest of metadata
             * and never trusted as a field: a reader recomputes keccak256
             * of it and compares against the SIGNED blockHash above, so a
             * tampered header fails to reproduce the hash. Absent when the
             * encoder cannot reproduce the hash (a header field newer than
             * it knows), which is the same state every anchor before this
             * was in — a reader falls back to an RPC.
             */
            ...(headerRlp ? { headerRlpHex: headerRlp } : {}),
          },
        },
      }),
    });

    if (!res.ok) throw new Error(`TEE ${res.status}`);

    const data = await res.json();
    const proof = Array.isArray(data) ? data[0] : data.proofs?.[0] ?? data;

    // Persist to S3 (same chain, same format, just with anchor index too).
    // Awaited, not fire-and-forget: the watermark is seeded by reading
    // anchors/{epoch}/ back, so a write still in flight lets a starting instance
    // read a ledger that trails what we just committed and re-anchor this block.
    await persistAnchor(proof, { blockNumber: block.number, blockHash });

    return { proof, digestB64 };
  } catch (err) {
    console.error("[eth-anchor] TEE commit failed:", (err as Error).message);
    return null;
  }
}

/* ── Digest index journal ── */

/**
 * Tell the digest index about digests this service is about to index.
 *
 * The site's lookup answers "certainly not on record" from a Bloom filter
 * rather than an S3 listing per digest, and the only way that answer can be
 * wrong is if the filter never heard about a write. Anchors are written from
 * here, not from the site, so they journal from here. Written BEFORE the keys
 * for the same reason the site does it that way: a journal entry with no key
 * behind it costs one wasted read, a key with no journal entry is a wrong
 * answer. Best effort, and loud when it fails.
 */
async function journalDigests(ops: S3Ops, bucket: string, digests: readonly string[]): Promise<void> {
  if (digests.length === 0) return;
  const at = Date.now();
  const key = `digest-journal/${String(at).padStart(13, "0")}-${Math.random().toString(16).slice(2, 8)}.json`;
  try {
    await ops.client.send(new ops.PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: JSON.stringify({ at, digests: [...new Set(digests)] }),
      ContentType: "application/json",
    }));
  } catch (err) {
    console.error("[eth-anchor] digest journal write failed; the site's index may not know this anchor until the next rebuild:", (err as Error).message);
  }
}

/* ── Anchor claim signing (enclave v7) ── */

const ANCHOR_CHAIN_ID = "bitgraph:main";
const ANCHOR_MESSAGE_PREFIX = "bitgraph-anchor/1";

/** Ed25519 seed from ANCHOR_SIGNING_KEY_B64, decoded once; null when unset. */
let anchorSigningKey: Uint8Array | null | undefined;
/** Base64 public half of the signing key, once derived; null when unset. Reported by getAnchorStatus so the configuration is checkable from outside without the logs. */
let anchorClaimPublicKeyB64: string | null = null;
function loadAnchorSigningKey(): Uint8Array | null {
  if (anchorSigningKey !== undefined) return anchorSigningKey;
  const b64 = process.env.ANCHOR_SIGNING_KEY_B64;
  if (!b64) {
    anchorSigningKey = null;
    console.warn("[eth-anchor] ANCHOR_SIGNING_KEY_B64 unset: anchors go out without an enclave-authenticated claim");
    return null;
  }
  const seed = new Uint8Array(Buffer.from(b64, "base64"));
  if (seed.length !== 32) throw new Error("ANCHOR_SIGNING_KEY_B64 must decode to a 32-byte Ed25519 seed");
  anchorSigningKey = seed;
  void getPublicKeyAsync(seed).then((pub) => {
    anchorClaimPublicKeyB64 = Buffer.from(pub).toString("base64");
    console.log(`[eth-anchor] anchor claims signed; public key ${anchorClaimPublicKeyB64}`);
  });
  return seed;
}

/**
 * Sign "bitgraph-anchor/1\n{epochId}\n{chainId}\n{blockNumber}\n{blockHash}"
 * for the enclave's current epoch. The epoch id is in the message so a claim
 * cannot be replayed into a later epoch. Returns null when no key is set;
 * throws when a key is set but the epoch cannot be read (the tick is skipped
 * rather than anchoring without the claim).
 */
async function signAnchorClaim(
  chainId: string,
  blockNumber: number,
  blockHash: string,
): Promise<{ blockNumber: number; blockHash: string; signatureB64: string } | null> {
  const seed = loadAnchorSigningKey();
  if (!seed) return null;
  const res = await fetch(`${TEE_URL}/key`);
  if (!res.ok) throw new Error(`TEE /key ${res.status} (needed to sign the anchor claim)`);
  const { epochId } = (await res.json()) as { epochId?: string };
  if (!epochId) throw new Error("TEE /key returned no epochId (needed to sign the anchor claim)");
  const message = new TextEncoder().encode(
    `${ANCHOR_MESSAGE_PREFIX}\n${epochId}\n${chainId}\n${blockNumber}\n${blockHash}`,
  );
  const sig = await signAsync(message, seed);
  return { blockNumber, blockHash, signatureB64: Buffer.from(sig).toString("base64") };
}

/* ── State & scheduling ── */

let lastAnchoredBlock = 0;
let intervalId: ReturnType<typeof setInterval> | null = null;
let anchoring = false;        // in-flight guard: a slow commit must not overlap the next tick
let watermarkSeeded = false;  // has lastAnchoredBlock been restored from the durable ledger?

/**
 * Restore lastAnchoredBlock from the ledger before anchoring anything.
 *
 * The watermark lives only in memory, so without this a redeploy restarts it at
 * 0, the current block trivially passes the freshness check, and the block the
 * previous instance just anchored is anchored a second time. The TEE is a
 * separate service that keeps running across our deploys, so that duplicate
 * lands in the SAME epoch, and the ledger is Object Lock COMPLIANCE: it can
 * never be removed. It also inflates the anchor count that reconcileIntervals
 * uses as its window ruler, so a window of INTERVAL_DEPTH entries would span
 * fewer than INTERVAL_DEPTH real blocks while still claiming the full depth.
 *
 * Ethereum block numbers are globally monotonic, so any recent epoch's high
 * water mark is a safe floor: a stale /key read costs at most one skipped
 * block, never a duplicate. A fresh epoch has no anchors yet and correctly
 * leaves the watermark at 0 so its genesis anchor lands immediately.
 *
 * Throws on failure so the caller declines to anchor and retries next tick. A
 * TEE that cannot serve /key cannot serve /commit either, so failing closed
 * here costs no availability that was not already lost.
 */
async function seedLastAnchoredBlock(): Promise<void> {
  const ops = await s3ops();
  const bucket = process.env.LEDGER_BUCKET;
  if (!ops || !bucket) return; // no ledger configured (local dev): nothing to restore

  const res = await fetch(`${TEE_URL}/key`);
  if (!res.ok) throw new Error(`TEE /key ${res.status}`);
  const { epochId } = (await res.json()) as { epochId?: string };
  if (!epochId) throw new Error("TEE /key returned no epochId");

  const safeEpoch = toSafeId(epochId);
  const counters = await listCounters(ops, bucket, `anchors/${safeEpoch}/`);

  // Newest first. Walk back a few in case the most recent object predates the
  // ethereum field; loadAnchorBytes returns blockNumber as optional.
  for (const counter of counters.slice(-5).reverse()) {
    const bytes = await loadAnchorBytes(ops, bucket, safeEpoch, counter);
    if (bytes?.blockNumber) {
      lastAnchoredBlock = bytes.blockNumber;
      console.log(`[eth-anchor] watermark restored: block #${lastAnchoredBlock} (${counters.length} anchors this epoch)`);
      return;
    }
  }

  if (counters.length > 0) throw new Error(`no recoverable blockNumber in the last ${Math.min(5, counters.length)} anchors`);
  console.log(`[eth-anchor] no prior anchor this epoch — starting from genesis`);
}

/** Restore the watermark once, then report whether anchoring may proceed. */
async function ensureWatermark(): Promise<boolean> {
  if (watermarkSeeded) return true;
  try {
    await seedLastAnchoredBlock();
    watermarkSeeded = true;
    return true;
  } catch (err) {
    // Fail closed: without a watermark we cannot tell a new block from one the
    // previous instance already anchored, and a wrong guess is permanent.
    console.error(`[eth-anchor] watermark seed failed, not anchoring this tick: ${(err as Error).message}`);
    return false;
  }
}

/**
 * Atomically claim a block before anchoring it. Returns "claimed" if this
 * process owns the block, "taken" if another already does, "error" if
 * ownership could not be established at all.
 *
 * The watermark cannot prevent duplicates on its own, because it lives inside
 * one process and the duplicate is a race between two. A Railway rolling deploy
 * runs the outgoing and incoming instances concurrently: both seed from the
 * ledger, both see the same next block, and both anchor it. The seed is racy in
 * its own right, since persistAnchor's write is not awaited, so a starting
 * instance can read a ledger that has not yet caught up to what the outgoing one
 * just committed. Block 25533154 landed twice this way (counters 9146 and 9148).
 *
 * A conditional write is the only arbiter both instances share. S3 PutObject
 * with IfNoneMatch "*" succeeds for exactly one caller and returns 412 to every
 * other, so the claim decides ownership rather than either process's local view.
 *
 * Claims are global rather than epoch-scoped. Block numbers are globally
 * monotonic, so a fresh epoch never revisits an old block, and skipping the
 * epoch lookup keeps this off the /key path (which a starting process has not
 * necessarily called yet). The cost of that simplification: right after a TEE
 * restart, the new epoch may skip a single block the previous epoch had already
 * claimed. A missing anchor is harmless; a duplicate is permanent.
 */
async function claimBlock(blockNumber: number): Promise<"claimed" | "taken" | "error"> {
  const ops = await s3ops();
  const bucket = process.env.LEDGER_BUCKET;
  if (!ops || !bucket) return "claimed"; // no ledger configured (local dev): nothing to arbitrate

  try {
    await ops.client.send(new ops.PutObjectCommand({
      Bucket: bucket,
      Key: `anchor-claims/${String(blockNumber).padStart(12, "0")}.json`,
      Body: JSON.stringify({ blockNumber, claimedAt: new Date().toISOString() }),
      ContentType: "application/json",
      IfNoneMatch: "*",
    }));
    return "claimed";
  } catch (err) {
    const meta = (err as { $metadata?: { httpStatusCode?: number } }).$metadata;
    const name = (err as { name?: string }).name;
    if (meta?.httpStatusCode === 412 || name === "PreconditionFailed") {
      console.log(`[eth-anchor] block #${blockNumber} already claimed by another instance — skipping`);
      return "taken";
    }
    console.error(`[eth-anchor] claim failed for #${blockNumber}, not anchoring: ${(err as Error).message}`);
    return "error";
  }
}

async function checkAndAnchor(): Promise<void> {
  if (anchoring) return;
  anchoring = true;
  try {
    if (!(await ensureWatermark())) return;

    const block = await getLatestBlock();

    if (block.number <= lastAnchoredBlock) {
      return;
    }

    const claim = await claimBlock(block.number);
    if (claim === "taken") {
      // Another instance owns it, so the block is anchored, just not by us.
      // Advance the watermark or we retry it every tick for no reason.
      lastAnchoredBlock = block.number;
      return;
    }
    if (claim === "error") {
      // Ownership unproven. Do NOT advance: the block may be anchored by nobody,
      // and skipping it permanently is worse than retrying in 12 seconds.
      return;
    }

    console.log(`[eth-anchor] Block #${block.number} — anchoring...`);
    const result = await commitAnchor(block);

    if (result) {
      lastAnchoredBlock = block.number;
      console.log(`[eth-anchor] Anchored block #${block.number} → counter on same chain`);
      // Record this anchor and emit any interval recurrence now due.
      await trackAnchorForIntervals(result.proof);
    }
  } catch (err) {
    console.error("[eth-anchor] check failed:", (err as Error).message);
  } finally {
    anchoring = false;
  }
}

/**
 * Operator-triggered anchor (POST /api/anchor/now). Shares the tick's in-flight
 * guard and watermark so a manual call cannot race the timer or re-anchor a
 * block already on the ledger. Throws rather than returning null on a refusal,
 * because null is the caller's "TEE unavailable" signal.
 */
export async function manualAnchor(): Promise<{ block: EthBlock; proof: unknown; digestB64: string } | null> {
  if (anchoring) throw new Error("An anchor is already in flight — try again in a moment");
  anchoring = true;
  try {
    if (!(await ensureWatermark())) throw new Error("Cannot restore the anchor watermark from the ledger — refusing to anchor");

    const block = await getLatestBlock();
    if (block.number <= lastAnchoredBlock) {
      throw new Error(`Block #${block.number} is already anchored (watermark #${lastAnchoredBlock}) — nothing to do`);
    }

    const claim = await claimBlock(block.number);
    if (claim === "taken") throw new Error(`Block #${block.number} is already claimed by another instance — nothing to do`);
    if (claim === "error") throw new Error(`Could not establish a claim on block #${block.number} — refusing to anchor`);

    const result = await commitAnchor(block);
    if (result) {
      lastAnchoredBlock = block.number;
      await trackAnchorForIntervals(result.proof);
      return { block, proof: result.proof, digestB64: result.digestB64 };
    }
    return null;
  } finally {
    anchoring = false;
  }
}

/* ── Anchor loop: head watcher (block rate) or timer (at rest) ── */

/**
 * Why a head watcher. A free-running 12 s timer has the same period as Ethereum
 * slots, so its phase against block production is frozen at whatever the last
 * restart or interval change left it. Measured 2026-10-02: ticks fired about
 * 1 s after each block was mined, before the RPC had it, so every anchor was
 * the parent of a head already ~12 s old and landed ~25 s after its block
 * (12 s deliberate depth plus ~12 s phase). The watcher removes the phase: it
 * polls the cheap head number and anchors as soon as a new head shows up. The
 * anchored block is unchanged: still `latest - 1`, by hash, through
 * checkAndAnchor and all of its guards.
 */

/** Interval at or below which the head watcher runs (one Ethereum slot). */
export const BLOCK_RATE_MAX_MS = 12 * 1000;
/** Default head poll period. Override with ANCHOR_HEAD_POLL_MS. */
export const HEAD_POLL_MS = 1500;
export const HEAD_POLL_MIN_MS = 500;
export const HEAD_POLL_MAX_MS = 6000;
/**
 * Runs per new head. The first run is the anchor; the extra ones cover an RPC
 * backend that still serves the previous head to getLatestBlock right after
 * another backend reported the new one (its `latest - 1` is then already
 * anchored and the run is a no-op). Bounded so a failing TEE is retried a
 * couple of polls later, not hammered every poll for a whole slot.
 */
const HEAD_RUNS_PER_BLOCK = 3;

/** ANCHOR_HEAD_POLL_MS, clamped to [HEAD_POLL_MIN_MS, HEAD_POLL_MAX_MS]; HEAD_POLL_MS when unset or not a number. */
export function headPollMsFromEnv(raw: string | undefined = process.env.ANCHOR_HEAD_POLL_MS): number {
  const n = raw === undefined || raw.trim() === "" ? NaN : Number(raw);
  if (!Number.isFinite(n)) return HEAD_POLL_MS;
  return Math.min(HEAD_POLL_MAX_MS, Math.max(HEAD_POLL_MIN_MS, Math.round(n)));
}

/**
 * What the loop calls out to. Production uses the real functions; tests swap
 * them through __setAnchorLoopDepsForTest. The anchor commit path itself
 * (checkAndAnchor and below) is not touched by this seam.
 */
interface AnchorLoopDeps {
  headNumber: () => Promise<number>;
  check: () => Promise<void>;
  anchoredBlock: () => number;
  busy: () => boolean;
}
const defaultLoopDeps: AnchorLoopDeps = {
  headNumber: fetchHeadNumber,
  check: checkAndAnchor,
  anchoredBlock: () => lastAnchoredBlock,
  busy: () => anchoring,
};
let loopDeps: AnchorLoopDeps = { ...defaultLoopDeps };

let loopMode: "head" | "timer" | null = null;
let headPollMs = HEAD_POLL_MS;
let headPollId: ReturnType<typeof setInterval> | null = null;
let loopGeneration = 0;       // bumped on every start/stop so a poll in flight from an old loop does nothing
let headPolling = false;      // one poll at a time
let lastSeenHead = 0;         // highest head number the watcher has seen
let runsForHead = 0;          // checkAndAnchor runs spent on lastSeenHead
let lastAttemptAt = 0;        // Date.now() of the last checkAndAnchor run started by the loop
let headPollFailing = false;  // for logging once per outage, not once per poll

function modeFor(intervalMs: number): "head" | "timer" {
  return intervalMs <= BLOCK_RATE_MAX_MS ? "head" : "timer";
}

function runCheck(): Promise<void> {
  lastAttemptAt = Date.now();
  return loopDeps.check();
}

async function pollHead(generation: number): Promise<void> {
  if (headPolling) return;
  headPolling = true;
  try {
    let head = 0;
    try {
      head = await loopDeps.headNumber();
      if (headPollFailing) {
        headPollFailing = false;
        console.log("[eth-anchor] head watcher: RPC head reads recovered");
      }
    } catch (err) {
      if (!headPollFailing) {
        headPollFailing = true;
        console.error(`[eth-anchor] head watcher: ${(err as Error).message} (safety net still runs)`);
      }
    }
    if (generation !== loopGeneration) return;

    if (head > lastSeenHead) {
      lastSeenHead = head;
      runsForHead = 0;
    }
    // Anchor the new head's parent. Skipped while an anchor (tick or manual) is
    // in flight, without spending a run, so the next poll tries again.
    if (
      lastSeenHead > 0 &&
      loopDeps.anchoredBlock() < lastSeenHead - 1 &&
      runsForHead < HEAD_RUNS_PER_BLOCK &&
      !loopDeps.busy()
    ) {
      runsForHead++;
      await runCheck();
      return;
    }
    // Safety net: heads unreadable or not moving. Same check as a timer tick.
    if (Date.now() - lastAttemptAt >= 2 * anchorIntervalMs) {
      await runCheck();
    }
  } finally {
    headPolling = false;
  }
}

function stopLoops(): void {
  loopGeneration++;
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  if (headPollId) {
    clearInterval(headPollId);
    headPollId = null;
  }
  loopMode = null;
}

/** Start the loop that fits anchorIntervalMs. `kick` runs once right away (service start). */
function startLoop(kick: boolean): void {
  stopLoops();
  const generation = loopGeneration;
  lastAttemptAt = Date.now();
  if (modeFor(anchorIntervalMs) === "head") {
    loopMode = "head";
    headPollMs = headPollMsFromEnv();
    lastSeenHead = 0;   // the first poll anchors the current head's parent (a no-op if already anchored)
    runsForHead = 0;
    headPollId = setInterval(() => void pollHead(generation), headPollMs);
    void pollHead(generation);
  } else {
    // At rest: exactly the old behaviour, a free-running timer.
    loopMode = "timer";
    if (kick) void runCheck();
    intervalId = setInterval(() => void runCheck(), anchorIntervalMs);
  }
}

/** Test seam: swap the loop's RPC/anchor calls, or restore them with no argument. Also stops any loop. */
export function __setAnchorLoopDepsForTest(deps?: Partial<AnchorLoopDeps>): void {
  stopLoops();
  loopDeps = { ...defaultLoopDeps, ...(deps ?? {}) };
  lastSeenHead = 0;
  runsForHead = 0;
  lastAttemptAt = 0;
  headPolling = false;
  headPollFailing = false;
}

export function getAnchorStatus(): {
  running: boolean;
  lastAnchoredBlock: number;
  watermarkSeeded: boolean;
  source: string;
  intervalSeconds: number;
  anchorClaimKey: string | null;
  mode: "head" | "timer" | null;
  headPollMs: number | null;
  lastSeenHead: number | null;
} {
  return {
    running: loopMode !== null,
    lastAnchoredBlock,
    // Enclave v7: the public key the anchor service signs its claims with, or
    // null when ANCHOR_SIGNING_KEY_B64 is unset. Must equal the constant baked
    // into the enclave image before a v7 enclave goes live.
    anchorClaimKey: anchorClaimPublicKeyB64,
    // False means the watermark has not been restored from the ledger yet, so
    // no anchoring is happening: either the first tick has not run or the seed
    // is failing (see logs). It is never false while anchors are landing.
    watermarkSeeded,
    source: "ethereum",
    intervalSeconds: anchorIntervalMs / 1000,
    // "head": anchoring follows block arrival (interval <= 12 s); "timer": a
    // free-running timer at intervalSeconds; null: the service is stopped.
    mode: loopMode,
    headPollMs: loopMode === "head" ? headPollMs : null,
    lastSeenHead: loopMode === "head" ? lastSeenHead : null,
  };
}

export function startAnchorService(intervalMs?: number): void {
  if (intervalMs) anchorIntervalMs = intervalMs;
  loadAnchorSigningKey(); // derive the public key now so the status reports it before the first anchor
  startLoop(true);
  console.log(`[eth-anchor] Starting Ethereum anchor service (interval: ${anchorIntervalMs / 1000}s, mode: ${loopMode}${loopMode === "head" ? `, head poll ${headPollMs}ms` : ""})`);
}

export function stopAnchorService(): void {
  const wasRunning = loopMode !== null;
  stopLoops();
  if (wasRunning) console.log("[eth-anchor] Anchor service stopped");
}

export function setAnchorInterval(seconds: number): { ok: boolean; intervalSeconds: number } {
  anchorIntervalMs = seconds * 1000;
  // Only restart a loop that is running, as before: a stopped service stays stopped.
  // A timer restart does not kick an immediate check, as before.
  if (loopMode !== null) startLoop(false);
  console.log(`[eth-anchor] Interval updated: ${seconds}s${loopMode ? ` (mode: ${loopMode})` : ""}`);
  return { ok: true, intervalSeconds: seconds };
}

// Legacy aliases
export const startBitcoinAnchor = startAnchorService;
export const stopBitcoinAnchor = stopAnchorService;
