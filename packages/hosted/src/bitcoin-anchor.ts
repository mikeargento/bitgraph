/**
 * Ethereum Anchor Service
 *
 * Commits the latest Ethereum block hash to the BitGraph proof chain via TEE.
 * The anchor proof is a NORMAL BitGraph proof on the SAME monotonic counter chain
 * as user proofs — same counter, same prevB64, same enclave key, same epoch.
 *
 * Because the Ethereum block hash is unpredictable and the anchor occurs
 * later in the same chain, it acts as a FUTURE CAUSAL BOUNDARY — everything
 * before this proof in the chain provably existed before the block was mined.
 *
 * Chain: User Proof → User Proof → ETH Anchor → User Proof → ETH Anchor
 *
 * "The future is the strongest clock."
 */

import { sha256 } from "@noble/hashes/sha256";

/**
 * Canonical proof hash — signed body only.
 * MUST match computeProofHash() from bitgraph exactly.
 * Inlined here because Railway can't resolve the monorepo package.
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
let anchorIntervalMs = 12 * 1000; // 12 seconds — every finalized Ethereum block

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

interface EthBlock {
  hash: string;
  number: number;
  timestamp: number;
}

async function getLatestBlock(): Promise<EthBlock> {
  const endpoints = [
    "https://ethereum-rpc.publicnode.com",
    "https://rpc.ankr.com/eth",
    "https://eth.llamarpc.com",
  ];

  for (const rpc of endpoints) {
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
      const data = await res.json() as { result?: { hash: string; number: string; timestamp: string } };
      if (!data.result?.hash) continue;

      return {
        hash: data.result.hash,
        number: parseInt(data.result.number, 16),
        timestamp: parseInt(data.result.timestamp, 16),
      };
    } catch { continue; }
  }

  throw new Error("Could not fetch Ethereum block from any RPC endpoint");
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
  const hashBytes = sha256(new TextEncoder().encode(block.hash));
  const digestB64 = toBase64(hashBytes);

  try {
    const res = await fetch(`${TEE_URL}/commit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        digests: [{ digestB64, hashAlg: "sha256" }],
        chainId: "bitgraph:main",
        // Attribution is SIGNED — block data is tamper-evident
        attribution: {
          name: "Ethereum Anchor",
          message: block.hash,
          title: `https://etherscan.io/block/${block.number}`,
        },
        // Metadata is NOT signed — advisory only
        metadata: {
          type: "ethereum-anchor",
          anchor: {
            network: "mainnet",
            blockNumber: block.number,
            blockHash: block.hash,
            blockTime: block.timestamp,
            blockTimeISO: new Date(block.timestamp * 1000).toISOString(),
          },
        },
      }),
    });

    if (!res.ok) throw new Error(`TEE ${res.status}`);

    const data = await res.json();
    const proof = Array.isArray(data) ? data[0] : data.proofs?.[0] ?? data;

    // Persist to S3 (same chain, same format, just with anchor index too)
    void persistAnchor(proof, { blockNumber: block.number, blockHash: block.hash });

    return { proof, digestB64 };
  } catch (err) {
    console.error("[eth-anchor] TEE commit failed:", (err as Error).message);
    return null;
  }
}

/* ── State & scheduling ── */

let lastAnchoredBlock = 0;
let intervalId: ReturnType<typeof setInterval> | null = null;

async function checkAndAnchor(): Promise<void> {
  try {
    const block = await getLatestBlock();

    if (block.number <= lastAnchoredBlock) {
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
  }
}

export async function manualAnchor(): Promise<{ block: EthBlock; proof: unknown; digestB64: string } | null> {
  const block = await getLatestBlock();
  const result = await commitAnchor(block);
  if (result) {
    lastAnchoredBlock = block.number;
    await trackAnchorForIntervals(result.proof);
    return { block, proof: result.proof, digestB64: result.digestB64 };
  }
  return null;
}

export function getAnchorStatus(): { running: boolean; lastAnchoredBlock: number; source: string; intervalSeconds: number } {
  return {
    running: intervalId !== null,
    lastAnchoredBlock,
    source: "ethereum",
    intervalSeconds: anchorIntervalMs / 1000,
  };
}

export function startAnchorService(intervalMs?: number): void {
  if (intervalMs) anchorIntervalMs = intervalMs;
  console.log(`[eth-anchor] Starting Ethereum anchor service (interval: ${anchorIntervalMs / 1000}s)`);

  // Run immediately, then on interval
  void checkAndAnchor();
  intervalId = setInterval(() => void checkAndAnchor(), anchorIntervalMs);
}

export function stopAnchorService(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log("[eth-anchor] Anchor service stopped");
  }
}

export function setAnchorInterval(seconds: number): { ok: boolean; intervalSeconds: number } {
  anchorIntervalMs = seconds * 1000;
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = setInterval(() => void checkAndAnchor(), anchorIntervalMs);
  }
  console.log(`[eth-anchor] Interval updated: ${seconds}s`);
  return { ok: true, intervalSeconds: seconds };
}

// Legacy aliases
export const startBitcoinAnchor = startAnchorService;
export const stopBitcoinAnchor = stopAnchorService;
