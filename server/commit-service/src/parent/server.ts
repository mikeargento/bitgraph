// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * Parent EC2 instance — HTTPS API server
 *
 * Endpoints:
 *   POST /commit         — { digests: [{ digestB64, hashAlg }], metadata?, agency?, policy?, chainId?, slotId? }
 *                          (slotId: a client-held slot from /allocate-slot; needs FUSE_ENABLED=true)
 *   POST /allocate-slot  — { chainId? } → { slotId, slot, chainId }  (same key policy as /commit;
 *                          metered per address in slots, see rate-limit.ts)
 *   POST /challenge      — {} → { challenge }  (public — issues enclave nonce for agency signing)
 *   GET  /key             — { publicKeyB64, measurement, enforcement }
 *   POST /verify          — { proof, policy? }
 *   GET  /health          — { ok: true }
 *
 * BitGraph Causal Commit Model:
 *   Against enclave v11 (its /key says bind: "atomic"), POST /commit without a slotId is ONE
 *   enclave call per digest, "bind": the nonce at count N and the digest at
 *   N+1 in one atomic action, so the nonce never leaves the enclave and the
 *   parent never sees it. A slotId on /commit (Fuse) still takes the 2-RTT path.
 *
 *   Against an older enclave the parent internally handles the 2-RTT protocol (allocateSlot → commit)
 *   so clients can still use the single POST /commit API. POST /allocate-slot
 *   hands out a client-held slot for the two-phase form (allocate first, then
 *   commit under that exact slot). It is metered, because a bare allocation
 *   mints nothing yet occupies one of the enclave's pending-slot entries for
 *   up to the slot TTL, and the pool is shared with every commit, anchors
 *   included. The chain is bound at allocation and defaults to the anchored
 *   chain, so a client-held slot is comparable with anchors.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { verify } from "bitgraph";
import type { BitGraphProof, VerificationPolicy, AgencyEnvelope, PolicyBinding } from "bitgraph";
import { VsockClient, type EnclaveClient, type AnchorClaimRequest, type BindRequest } from "./vsock-client.js";
import { requestTimestamp } from "./tsa-client.js";
import { getClientIp, tryConsumeDigests, rateLimitConfig, allocationLimiter } from "./rate-limit.js";
import { createAuthPolicy, describeAuthPolicy, type AuthPolicy } from "./auth.js";
import { enqueueCeiling, ceilingQueueEnabled } from "./ceiling-queue.js";
import { epochFloorFile, latestBaseBlock, sha256B64, epochGenesisDir, requestEpochGenesis, awaitEpochGenesis } from "./epoch-floor.js";
import { BaseHeadFeed, baseFloorEnabled } from "./base-head.js";
import { Timeline } from "./timeline.js";
import { TimelineAlerter, snsAlertSend } from "./timeline-alerts.js";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PORT = Number(
  process.argv.find((a) => a.startsWith("--port="))?.split("=")[1]
    ?? process.env["PORT"]
    ?? 8080
);

// ---------------------------------------------------------------------------
// Proof indexing — fire-and-forget POST to explorer database
// ---------------------------------------------------------------------------

const INDEX_URL = process.env["PROOF_INDEX_URL"] ?? "https://bitgraph.ing/api/proofs";
const LEDGER_BUCKET = process.env["LEDGER_BUCKET"];
const ALLOW_DEBUG_MODE = process.env["ALLOW_DEBUG_MODE"] === "true";
// BitGraph Fuse: lets POST /commit consume a client-held slot from
// POST /allocate-slot instead of allocating its own. Off by default; the
// enclave is unchanged either way (its commitDigest already takes a slotId).
const FUSE_ENABLED = process.env["FUSE_ENABLED"] === "true";
// Enclave v11: POST /commit binds each digest in ONE enclave call (nonce at N,
// digest at N+1). On when the enclave's /key says bind: "atomic" (v11, which
// also refuses held slots on bitgraph:main, so it must be on there).
// ATOMIC_BIND=on / off overrides, for tests. Never a silent fallback: a
// bind the enclave refuses is an error, not a two-call commit.
const ATOMIC_BIND_ENV = process.env["ATOMIC_BIND"];
/** Enclave v12 (its /key says only: "bind"): a BitGraph is made one way, a bind of a digest; held slots and challenges are gone. */
async function onlyBind(): Promise<boolean> {
  try { return (await getKeyInfo()).only === "bind"; } catch { return false; }
}
async function atomicBind(): Promise<boolean> {
  if (ATOMIC_BIND_ENV === "on") return true;
  if (ATOMIC_BIND_ENV === "off") return false;
  return (await getKeyInfo()).bind === "atomic";
}
/** The slotId returned by /allocate-slot is the slot's 32-byte nonce in standard base64. */
const SLOT_ID_PATTERN = /^[A-Za-z0-9+/]{43}=$/;

if (ceilingQueueEnabled()) console.log(`[parent] ceiling queue enabled: ${process.env["CEILING_QUEUE_PATH"]}`);

// Enclave v10: the newest Base header goes with every allocation and becomes
// the slot's floor. Off until BASE_FLOOR=on, so this parent can run ahead of
// the v10 enclave (an older enclave ignores the field).
const baseHead = baseFloorEnabled() ? BaseHeadFeed.fromEnv() : undefined;
if (baseHead) {
  baseHead.start();
  console.log("[parent] Base floor enabled: the newest Base header goes with every allocation");
}
// Each floor header is saved to the ledger before a proof can stand on it, so
// a package or a reorg check can always find the exact bytes (one object per
// header, only for headers actually used).
if (baseHead && LEDGER_BUCKET) {
  baseHead.setSaver(async (h) => {
    const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3" as string) as {
      S3Client: new (config: { region: string }) => { send: (cmd: unknown) => Promise<void> };
      PutObjectCommand: new (params: Record<string, unknown>) => unknown;
    };
    const s3 = new S3Client({ region: process.env["LEDGER_REGION"] || "us-east-2" });
    const retention = new Date();
    retention.setDate(retention.getDate() + 3650);
    await s3.send(new PutObjectCommand({
      Bucket: LEDGER_BUCKET,
      Key: `base-floors/${String(h.blockNumber).padStart(12, "0")}-${h.blockHash}.rlp`,
      Body: Buffer.from(h.headerB64, "base64"),
      ContentType: "application/octet-stream",
      ObjectLockMode: "COMPLIANCE",
      ObjectLockRetainUntilDate: retention,
    }));
  });
}

/**
 * Allocate a slot, with the Base floor when it is on: the newest header stamped
 * at or before this clock, saved first. If the enclave refuses it as ahead of
 * its own clock, once more with the previous header.
 */
async function allocateWithFloor(chainId: string | undefined) {
  if (!baseHead) return enclaveClient.send({ type: "allocateSlot", chainId });
  const first = baseHead.forAllocation(Date.now());
  if (first) await baseHead.ensureSaved(first);
  const r = await enclaveClient.send({ type: "allocateSlot", chainId, ...(first ? { baseFloorHeaderB64: first.headerB64 } : {}) });
  if (r.ok || !/ahead of the enclave clock/.test(r.error ?? "")) return r;
  const older = baseHead.forAllocation(Date.now(), true);
  if (!older) return r;
  await baseHead.ensureSaved(older);
  return enclaveClient.send({ type: "allocateSlot", chainId, baseFloorHeaderB64: older.headerB64 });
}
/**
 * Bind one digest (enclave v11), with the Base floor when it is on, the same
 * way allocateWithFloor fixes it: the newest header at or before this clock,
 * saved first; once more with the previous header if the enclave refuses the
 * newest as ahead of its own clock.
 */
async function bindWithFloor(req: Omit<BindRequest, "type" | "baseFloorHeaderB64">) {
  // Enclave v12 does one thing: bind a digest. Nothing else is sent to it.
  if (await onlyBind()) return enclaveClient.send({ type: "bind", digestB64: req.digestB64 });
  if (!baseHead) return enclaveClient.send({ type: "bind", ...req });
  const first = baseHead.forAllocation(Date.now());
  if (first) await baseHead.ensureSaved(first);
  const r = await enclaveClient.send({ type: "bind", ...req, ...(first ? { baseFloorHeaderB64: first.headerB64 } : {}) });
  if (r.ok || !/ahead of the enclave clock/.test(r.error ?? "")) return r;
  const older = baseHead.forAllocation(Date.now(), true);
  if (!older) return r;
  await baseHead.ensureSaved(older);
  return enclaveClient.send({ type: "bind", ...req, baseFloorHeaderB64: older.headerB64 });
}

if (LEDGER_BUCKET) {
  console.log(`[parent] S3 ledger enabled: ${LEDGER_BUCKET}`);
} else {
  console.log("[parent] S3 ledger disabled (no LEDGER_BUCKET)");
}

/**
 * Persist proofs to immutable S3 ledger.
 * No-op if LEDGER_BUCKET is not configured.
 * Uses AWS SDK dynamically to avoid import issues when not needed.
 */
async function persistToLedger(proofs: BitGraphProof[]): Promise<void> {
  if (!LEDGER_BUCKET) return;
  try {
    // Dynamic imports — these are only loaded when LEDGER_BUCKET is set
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3" as string) as {
      S3Client: new (config: { region: string }) => { send: (cmd: unknown) => Promise<void> };
      PutObjectCommand: new (params: Record<string, unknown>) => unknown;
    };
    const { computeProofHash } = await import("bitgraph");

    const s3 = new S3Client({ region: process.env["LEDGER_REGION"] || "us-east-2" });

    for (const proof of proofs) {
      // Canonical proof hash — uses library's recursive-sort canonicalize + SHA-256
      const proofHash = computeProofHash(proof);
      const safeEpoch = (proof.commit.epochId ?? "unknown").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const safeHash = proofHash.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const counter = (proof.commit.counter || "0").padStart(12, "0");
      const key = `proofs/${safeEpoch}/${counter}-${safeHash}.json`;

      const stored = { ...proof, proofHash };

      const retention = new Date();
      retention.setDate(retention.getDate() + 3650); // 10 years

      await s3.send(new PutObjectCommand({
        Bucket: LEDGER_BUCKET,
        Key: key,
        Body: JSON.stringify(stored, null, 2),
        ContentType: "application/json",
        ObjectLockMode: "COMPLIANCE",
        ObjectLockRetainUntilDate: retention,
      }));

      console.log(`[parent] ledger: stored ${key}`);

      // Also write a by-digest index for fast lookups by artifact hash
      const safeDigest = proof.artifact.digestB64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const digestKey = `by-digest/${safeDigest}.json`;
      // The site's lookup answers "certainly not on record" from a filter over
      // every indexed digest, and the one way that can be wrong is not having
      // heard about a write. This parent writes by-digest keys directly, so it
      // says so here, BEFORE the key exists. A journal entry with no key costs
      // a wasted read; a key with no journal entry is a wrong answer.
      try {
        const at = Date.now();
        await s3.send(new PutObjectCommand({
          Bucket: LEDGER_BUCKET,
          Key: `digest-journal/${String(at).padStart(13, "0")}-${Math.random().toString(16).slice(2, 8)}.json`,
          Body: JSON.stringify({ at, digests: [proof.artifact.digestB64, safeDigest] }),
          ContentType: "application/json",
        }));
      } catch (e) {
        console.warn(`[parent] digest journal failed: ${e instanceof Error ? e.message : String(e)}`);
      }
      // The earliest proof of these bytes keeps the by-digest key (2026-10-18 audit): a later re-bind used to
      // overwrite it, so a lookup answered with the latest position instead of the first. Create-only now; every
      // position stays in proofs/ regardless.
      try {
        await s3.send(new PutObjectCommand({
          Bucket: LEDGER_BUCKET,
          Key: digestKey,
          Body: JSON.stringify(stored, null, 2),
          ContentType: "application/json",
          IfNoneMatch: "*",
        }));
      } catch (e) {
        const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        if (status !== 412 && status !== 409) throw e;
      }
    }
  } catch (err) {
    console.warn(`[parent] ledger persist failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function indexProofs(proofs: BitGraphProof[]): Promise<void> {
  if (!INDEX_URL) return;
  try {
    await fetch(INDEX_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proofs }),
    });
  } catch (err) {
    console.warn(`[parent] proof indexing failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// API key auth
// ---------------------------------------------------------------------------

// Policy lives in auth.ts so it can be tested across configurations. See the
// header there for why the gate and the exemption must stay separate.
const AUTH: AuthPolicy = (() => {
  try {
    return createAuthPolicy(process.env);
  } catch (err) {
    // A boundary that rejects every caller looks identical to an outage from
    // the outside, so refuse to boot rather than fail one request at a time.
    console.error(`[parent] FATAL: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
})();
console.log(`[parent] auth: ${describeAuthPolicy(AUTH)}`);

function checkApiKey(req: IncomingMessage): boolean {
  return AUTH.allows(req.headers["authorization"]);
}

/** True only when the request presents a valid configured key. */
function hasValidApiKey(req: IncomingMessage): boolean {
  return AUTH.isExempt(req.headers["authorization"]);
}

// ---------------------------------------------------------------------------
// Enclave client
// ---------------------------------------------------------------------------

// Where the server listens (2026-10-18 audit): cloudflared reaches it at localhost:8787, so on the host it is set to
// 127.0.0.1 and the port is not open to the internet. Default unchanged.
const BIND_HOST = process.env["BIND_HOST"] || "0.0.0.0";

const enclaveClient: EnclaveClient = new VsockClient();

// The block timeline (timeline.ts), when TIMELINE=on: block reads bound beside the files, every record journaled.
let openEpochId: string | null = null;
let timeline: Timeline | null = null;
let alerter: TimelineAlerter | null = null;
/** While the epoch's genesis write is awaited: when it was requested. */
let genesisPendingSinceMs: number | null = null;

let cachedKeyResponse: { publicKeyB64: string; measurement: string; enforcement: string; bind?: string; only?: string } | null = null;

async function getKeyInfo(): Promise<{ publicKeyB64: string; measurement: string; enforcement: string; bind?: string; only?: string }> {
  if (cachedKeyResponse) return cachedKeyResponse;
  const result = await enclaveClient.send({ type: "key" });
  if (!result.ok || !result.data) {
    throw new Error(result.error ?? "Failed to get key info from enclave");
  }
  cachedKeyResponse = result.data as unknown as typeof cachedKeyResponse;
  return cachedKeyResponse!;
}

// ---------------------------------------------------------------------------
// Enclave initialization — always fresh genesis.
// Each epoch starts at counter 1. Ethereum anchors prove temporal
// ordering across epochs — no need to chain proofs between them.
// ---------------------------------------------------------------------------

async function initEnclave(): Promise<{ counter: string; epochId: string }> {
  console.log(`[parent] starting fresh genesis epoch`);
  const result = await enclaveClient.send({
    type: "init",
    allowGenesis: true,
  });
  if (!result.ok) {
    throw new Error(`Enclave rejected genesis: ${result.error ?? "unknown"}`);
  }
  const data = result.data as { counter: string; epochId: string };
  console.log(`[parent] genesis epoch started: epochId=${data.epochId} counter=${data.counter}`);
  return data;
}

// ---------------------------------------------------------------------------
// The epoch's first BitGraph: a fresh read of the latest Base block (epoch-floor.ts).
// While it is being made, /commit answers 503 "the epoch is starting", so it is the first record of the epoch.
// ---------------------------------------------------------------------------

let epochStarting = false;

async function bindEpochFloor(epochId: string): Promise<void> {
  epochStarting = true;
  const deadline = Date.now() + 90_000;
  try {
    // First choice: the genesis transaction (epoch-floor.ts, "The genesis transaction"). The writer sends it and
    // reports back through the shared directory; the parent binds the record. A writer that does not answer in
    // time costs this epoch the transaction, not its start: the block read below still opens it.
    const gdir = epochGenesisDir();
    if (gdir) {
      try {
        requestEpochGenesis(gdir, epochId);
        const waitMs = Number(process.env["EPOCH_GENESIS_WAIT_MS"] ?? 180_000);
        const file = await awaitEpochGenesis(gdir, epochId, waitMs);
        if (file) {
          const r = await bindWithFloor({ digestB64: sha256B64(file) });
          if (!r.ok || !r.data) throw new Error(r.error ?? "bind failed");
          const { proof } = r.data as { proof: BitGraphProof };
          await keepMade([proof], false);
          await storeEpochFloorFile(epochId, file);
          const g = JSON.parse(file) as { txHash: string; blockNumber: number };
          console.log(`[parent] epoch genesis: Base tx ${g.txHash.slice(0, 12)}… in block ${g.blockNumber} bound at counter ${proof.commit.counter} of ${epochId.slice(0, 12)}…`);
          return;
        }
        console.warn(`[parent] epoch genesis: no result from the writer within ${waitMs} ms; opening the epoch on a block read instead`);
      } catch (e) {
        console.warn(`[parent] epoch genesis failed: ${e instanceof Error ? e.message : String(e)}; opening the epoch on a block read instead`);
      }
    }
    for (let attempt = 1; ; attempt++) {
      try {
        const block = await latestBaseBlock();
        const file = epochFloorFile(epochId, block);
        const r = await bindWithFloor({ digestB64: sha256B64(file) });
        if (!r.ok || !r.data) throw new Error(r.error ?? "bind failed");
        const { proof } = r.data as { proof: BitGraphProof };
        await keepMade([proof], false);
        await storeEpochFloorFile(epochId, file);
        console.log(`[parent] epoch floor: Base block ${block.number} bound at counter ${proof.commit.counter} of ${epochId.slice(0, 12)}…`);
        return;
      } catch (e) {
        console.warn(`[parent] epoch floor attempt ${attempt} failed: ${e instanceof Error ? e.message : String(e)}`);
        if (Date.now() > deadline) { console.error("[parent] epoch floor: giving up; the epoch serves without one"); return; }
        await new Promise((res) => setTimeout(res, Math.min(10_000, 1000 * attempt)));
      }
    }
  } finally {
    epochStarting = false;
  }
}

// ---------------------------------------------------------------------------
// The epoch's genesis under the timeline: the Base write is retried until it lands, with no block-read fallback.
// Block reads and file binds go on meanwhile (pre-genesis: their clock check rests on Nitro alone until the genesis
// record is bound), so /commit is not held while the write is pending.
// ---------------------------------------------------------------------------

async function bindTimelineGenesis(epochId: string, counter: string): Promise<void> {
  const gdir = epochGenesisDir();
  const stateDir = process.env["TIMELINE_STATE_DIR"]!;
  const safeEpoch = epochId.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const marker = join(stateDir, `genesis-bound-${safeEpoch}`);
  const asked = join(stateDir, `genesis-requested-${safeEpoch}`);
  if (existsSync(marker)) return;
  // Only an epoch this timeline opened: a fresh one (counter 0), or one whose genesis it asked for before a restart.
  // An epoch already under way that it did not open was opened by the earlier path and has its first record.
  if (counter !== "0" && !existsSync(asked)) {
    console.log(`[parent] timeline: epoch ${epochId.slice(0, 12)}… was opened before the timeline ran (counter ${counter}); no genesis to bind`);
    return;
  }
  if (!gdir) {
    console.error("[parent] timeline: EPOCH_GENESIS_DIR is not set, so this epoch has no genesis write and stays pre-genesis");
    return;
  }
  requestEpochGenesis(gdir, epochId);
  mkdirSync(stateDir, { recursive: true });
  if (!existsSync(asked)) writeFileSync(asked, `${new Date().toISOString()}\n`);
  genesisPendingSinceMs = Date.now();
  console.log(`[parent] timeline: genesis write requested for ${epochId.slice(0, 12)}…; reads and binds continue as pre-genesis until it lands`);
  for (let waited = 0; ; waited++) {
    const file = await awaitEpochGenesis(gdir, epochId, 60_000);
    if (file) {
      for (let attempt = 1; ; attempt++) {
        try {
          const r = await bindWithFloor({ digestB64: sha256B64(file) });
          if (!r.ok || !r.data) throw new Error(r.error ?? "bind failed");
          const { proof } = r.data as { proof: BitGraphProof };
          await keepMade([proof], false, file);
          mkdirSync(stateDir, { recursive: true });
          writeFileSync(marker, `${proof.commit.counter}\n`);
          genesisPendingSinceMs = null;
          await storeEpochFloorFile(epochId, file);
          const g = JSON.parse(file) as { txHash: string; blockNumber: number };
          console.log(`[parent] timeline: genesis Base tx ${g.txHash.slice(0, 12)}… (block ${g.blockNumber}) bound at counter ${proof.commit.counter}`);
          return;
        } catch (e) {
          console.warn(`[parent] timeline: binding the genesis record failed (attempt ${attempt}): ${e instanceof Error ? e.message : String(e)}`);
          await new Promise((res) => setTimeout(res, Math.min(30_000, 1000 * attempt)));
        }
      }
    }
    console.warn(`[parent] timeline: genesis write for ${epochId.slice(0, 12)}… not mined after ${waited + 1} min; still waiting`);
  }
}

/** epoch-floors/<epoch>.json beside the proofs: create-only, Object Lock like them. */
async function storeEpochFloorFile(epochId: string, file: string): Promise<void> {
  if (!LEDGER_BUCKET) return;
  try {
    const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3" as string) as {
      S3Client: new (config: { region: string }) => { send: (cmd: unknown) => Promise<void> };
      PutObjectCommand: new (params: Record<string, unknown>) => unknown;
    };
    const s3 = new S3Client({ region: process.env["LEDGER_REGION"] || "us-east-2" });
    const safeEpoch = epochId.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const retention = new Date(); retention.setDate(retention.getDate() + 3650);
    await s3.send(new PutObjectCommand({
      Bucket: LEDGER_BUCKET, Key: `epoch-floors/${safeEpoch}.json`, Body: file, ContentType: "application/json",
      IfNoneMatch: "*", ObjectLockMode: "COMPLIANCE", ObjectLockRetainUntilDate: retention,
    }));
  } catch (e) {
    console.warn(`[parent] epoch floor file not stored: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    ...CORS_HEADERS,
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(json),
  });
  res.end(json);
}

function sendError(res: ServerResponse, status: number, message: string): void {
  sendJson(res, status, { error: message });
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

async function handleCommit(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // The epoch's first BitGraph (its Base block read) is being made: nothing else is bound before it.
  if (epochStarting) {
    res.setHeader("Retry-After", "5");
    sendJson(res, 503, { error: "The epoch is starting: its first BitGraph, a Base block read, is being made. Try again in a few seconds.", code: "tee-restarting" });
    return;
  }
  // API key check
  if (!checkApiKey(req)) {
    sendError(res, 401, "Unauthorized: valid API key required (Authorization: Bearer <key>)");
    return;
  }

  const contentType = req.headers["content-type"] ?? "";
  if (!contentType.includes("application/json")) {
    sendError(res, 400, "POST /commit requires Content-Type: application/json");
    return;
  }

  const raw = await readBody(req);

  // Digests are ~50 bytes each; even a full per-client batch fits in well
  // under 1 MB. Anything larger is not a legitimate commit request.
  if (raw.length > 1024 * 1024) {
    sendError(res, 413, "Request body too large. Max 1 MB.");
    return;
  }

  let body: {
    digests: Array<{ digestB64: string; hashAlg: "sha256" }>;
    metadata?: Record<string, unknown>;
    prevProofId?: string;
    agency?: AgencyEnvelope;
    attribution?: { name?: string; title?: string; message?: string };
    policy?: PolicyBinding;
    /** Anchor service claim, forwarded verbatim; the enclave authenticates it (v7). */
    anchor?: AnchorClaimRequest;
    chainId?: string;
    /** Client-held slot from POST /allocate-slot (BitGraph Fuse). */
    slotId?: unknown;
    /**
     * Opt in to the Base write (Mike, 2026-10-17: "we can opt in to those"):
     * true queues these records for a Base transaction, a public "by when".
     * Absent or false: no Base write. A BitGraph itself has no fee; the write
     * is the one paid, optional step.
     */
    ceiling?: unknown;
  };

  try {
    body = JSON.parse(raw.toString("utf8"));
  } catch {
    sendError(res, 400, "Invalid JSON body");
    return;
  }

  if (!Array.isArray(body.digests) || body.digests.length === 0) {
    sendError(res, 400, "body.digests must be a non-empty array");
    return;
  }

  for (const d of body.digests) {
    if (typeof d.digestB64 !== "string" || d.hashAlg !== "sha256") {
      sendError(res, 400, "each digest must have { digestB64: string, hashAlg: 'sha256' }");
      return;
    }
  }

  // Client-held slot (the BitGraph Fuse two-phase form): the caller allocated
  // a slot with POST /allocate-slot and now consumes exactly that slot. Never
  // fall back to a fresh slot when one was named; a proof under a different
  // slot would look like success and be a silent downgrade. One digest per
  // request: the enclave binds one slot to one digest, and a mid-batch
  // failure would burn the held nonce with nothing returned.
  let heldSlotId: string | undefined;
  if (body.slotId !== undefined && await onlyBind()) {
    sendJson(res, 410, { error: "Held slots are gone: a BitGraph is made one way, one atomic action in the enclave. Send the digest without a slotId.", code: "bind-only" });
    return;
  }
  if (body.slotId !== undefined) {
    if (!FUSE_ENABLED) {
      sendError(res, 400, "client-held slots are not enabled on this service (FUSE_ENABLED)");
      return;
    }
    if (typeof body.slotId !== "string" || !SLOT_ID_PATTERN.test(body.slotId)) {
      sendError(res, 400, "body.slotId must be the slotId returned by POST /allocate-slot (a 44-character base64 nonce)");
      return;
    }
    if (body.digests.length !== 1) {
      sendError(res, 400, "a client-held slot commits exactly one digest per request");
      return;
    }
    heldSlotId = body.slotId;
  }

  // Rate limit by digest count (proofs minted), not by request. Requests
  // bearing a valid API key are exempt.
  if (!hasValidApiKey(req)) {
    const clientIp = getClientIp(req);
    const rl = tryConsumeDigests(clientIp, body.digests.length);
    if (!rl.ok) {
      console.warn(`[parent] rate limit: rejected ${body.digests.length} digest(s) from ${clientIp} (${rl.reason})`);
      const json = JSON.stringify({ error: `Rate limit exceeded: ${rl.reason}` });
      res.writeHead(429, {
        ...CORS_HEADERS,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(json),
        ...(rl.retryAfterSec > 0 ? { "Retry-After": String(rl.retryAfterSec) } : {}),
      });
      res.end(json);
      return;
    }
  }

  // BitGraph 2-RTT protocol: one slot → one artifact → one proof
  // For each digest, allocate a slot then commit with the slotId.
  // The parent handles the round-trips so clients keep a single POST /commit API.
  //
  // Agency (passkey/WebAuthn) with batch support:
  //   - The client's agency envelope includes batchContext with all digests.
  //   - We pass agency to EVERY commitDigest call (with updated batchIndex).
  //   - The enclave validates the challenge + P-256 signature on digest #0,
  //     stores the validated batch, then looks it up for digests #1..N.
  //   - All proofs get actor identity in their Ed25519-signed body.
  //   - A run larger than one request arrives as several requests. The
  //     client's batchIndex is the OFFSET of this request into the run, and
  //     each digest here is numbered from it. Only index 0 validates against
  //     the (single-use) nonce; every later index takes the enclave's
  //     continuation path. Renumbering every request from 0 would present a
  //     spent nonce for re-validation and refuse the whole second request.
  //
  // Enclave commits are sequential (monotonic counter), but TSA timestamps
  // are parallelized afterward to minimize latency on batch requests.
  const proofs: BitGraphProof[] = [];
  const isBatch = body.digests.length > 1;

  for (let i = 0; i < body.digests.length; i++) {
    const d = body.digests[i]!;

    // For batch commits with agency, number each digest from the request's
    // offset into the run (the client's batchIndex), never from 0.
    let agencyForDigest: AgencyEnvelope | undefined;
    if (body.agency) {
      if (isBatch && body.agency.batchContext) {
        const offset = Number.isInteger(body.agency.batchContext.batchIndex) && body.agency.batchContext.batchIndex > 0
          ? body.agency.batchContext.batchIndex
          : 0;
        agencyForDigest = {
          ...body.agency,
          batchContext: { ...body.agency.batchContext, batchIndex: offset + i },
        };
      } else {
        agencyForDigest = i === 0 ? body.agency : undefined;
      }
    }

    let commitResult;
    if (heldSlotId === undefined && await atomicBind()) {
      // Enclave v11: one call, nonce at N and this digest at N+1. No slotId
      // ever exists outside the enclave.
      commitResult = await bindWithFloor({
        digestB64: d.digestB64,
        ...(body.chainId !== undefined ? { chainId: body.chainId } : {}),
        ...(agencyForDigest !== undefined ? { agency: agencyForDigest } : {}),
        ...(body.attribution !== undefined ? { attribution: body.attribution } : {}),
        ...(body.policy !== undefined ? { policy: body.policy } : {}),
        ...(body.metadata !== undefined ? { metadata: body.metadata } : {}),
        ...(body.anchor !== undefined ? { anchor: body.anchor } : {}),
      });
    } else {
      // Step 1: the slot. Either the caller's held slot (its chain was bound at
      // allocation; body.chainId is not consulted) or a fresh one allocated
      // here, nonce-first, on the requested chain.
      let slotId: string;
      if (heldSlotId !== undefined) {
        slotId = heldSlotId;
      } else {
        const slotResult = await allocateWithFloor(body.chainId);
        if (!slotResult.ok || !slotResult.data) {
          sendError(res, 500, slotResult.error ?? "slot allocation failed");
          return;
        }
        slotId = (slotResult.data as { slotId: string }).slotId;
      }

      // Step 2: Commit the digest with the allocated slot
      commitResult = await enclaveClient.send({
        type: "commitDigest",
        slotId,
        digestB64: d.digestB64,
        agency: agencyForDigest,
        attribution: body.attribution,
        policy: body.policy,
        metadata: body.metadata,
        anchor: body.anchor,
      });
    }

    // Enclave v8's floor gate: the anchored chain has no anchor yet this epoch,
    // so a proof made now would carry no floor and the enclave refuses to sign
    // one. It is a wait, not a fault: 503 with Retry-After, not a 500.
    if (!commitResult.ok && (commitResult.error ?? "").includes("no-anchor-floor")) {
      res.setHeader("Retry-After", "15");
      sendError(res, 503, commitResult.error ?? "no anchor floor yet");
      return;
    }

    if (!commitResult.ok || !commitResult.data) {
      // A held slot the enclave no longer has: consumed by an earlier
      // commit whose response was lost, expired past the TTL, or wiped by an
      // enclave restart. The enclave cannot tell these apart and neither can
      // we; the distinct code lets the client read back by digest before it
      // allocates again, instead of retrying blindly.
      if (heldSlotId !== undefined && /Slot not found or expired/.test(commitResult.error ?? "")) {
        sendJson(res, 409, {
          error: "The held slot is not available: it was already consumed, it expired, or the enclave restarted since allocation. Look the artifact digest up before allocating again.",
          code: "slot-unavailable",
        });
        return;
      }
      // Proofs already made in this request are kept and returned (2026-10-18 audit): they were bound, counted and
      // signed; dropping them left gaps in the sequence with nobody holding the proofs.
      if (proofs.length > 0) {
        await keepMade(proofs, body.ceiling === true);
        sendJson(res, 500, { error: commitResult.error ?? "commit failed", code: "partial", failedIndex: i, made: proofs });
        return;
      }
      sendError(res, 500, commitResult.error ?? "commit failed");
      return;
    }

    const { proof } = commitResult.data as { proof: BitGraphProof };
    proofs.push(proof);
  }

  // TSA timestamps disabled — Ethereum anchors provide stronger time proof
  // and TSA services rate-limit at scale. The ETH block hash in the causal
  // chain is an unforgeable timestamp that doesn't depend on third parties.

  await keepMade(proofs, body.ceiling === true);
  sendJson(res, 200, proofs);
}

/**
 * Every proof the enclave made: its proofHash added, persisted to the immutable S3 ledger (with the by-digest
 * index), and queued for its Base ceiling when the caller asked for one (no-op unless CEILING_QUEUE_PATH; the Base
 * plugin's write, Mike 2026-10-18). Persisting and queueing are fire-and-forget, as before.
 */
async function keepMade(proofs: BitGraphProof[], ceiling: boolean, genesisFile?: string): Promise<void> {
  try {
    const { computeProofHash } = await import("bitgraph");
    for (const p of proofs) {
      (p as BitGraphProof & { proofHash: string }).proofHash = computeProofHash(p);
    }
  } catch (_) { /* non-critical — proofHash is a convenience field */ }
  // The timeline's journal holds every record of the sequence; the per-proof ledger objects below are kept as well.
  if (timeline) {
    for (const p of proofs) {
      try { timeline.record(p, genesisFile); } catch (e) { console.error(`[parent] timeline journal append failed: ${e instanceof Error ? e.message : String(e)}`); }
    }
  }
  void persistToLedger(proofs);
  if (ceiling) enqueueCeiling(proofs);
}

async function handleKey(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const keyInfo = await getKeyInfo();
    sendJson(res, 200, keyInfo);
  } catch (err) {
    sendError(res, 500, `Failed to get key info: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function handleVerify(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const contentType = req.headers["content-type"] ?? "";
  if (!contentType.includes("application/json")) {
    sendError(res, 400, "POST /verify requires Content-Type: application/json");
    return;
  }

  const raw = await readBody(req);
  let body: { proof: BitGraphProof; policy?: VerificationPolicy };
  try {
    body = JSON.parse(raw.toString("utf8"));
  } catch {
    sendError(res, 400, "Invalid JSON body");
    return;
  }

  if (!body.proof) {
    sendError(res, 400, "body must have { proof: BitGraphProof, policy?: VerificationPolicy }");
    return;
  }

  const { verifySignatureOnly } = await import("./verify-helper.js");
  const result = await verifySignatureOnly(body.proof, body.policy);
  sendJson(res, 200, result);
}

async function handleChallenge(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Public endpoint — no API key required.
  // Issues a fresh enclave nonce for agency signing.
  try {
    const result = await enclaveClient.send({ type: "challenge" });
    if (!result.ok || !result.data) {
      sendError(res, 500, result.error ?? "challenge failed");
      return;
    }
    sendJson(res, 200, result.data);
  } catch (err) {
    sendError(res, 500, `Failed to get challenge: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Chain identifiers are short printable ASCII, e.g. "bitgraph:main". */
const CHAIN_ID_PATTERN = /^[\x21-\x7e]{1,128}$/;
// Enclave v11: held slots (Fuse, trees) live on their own chain; bitgraph:main
// takes only binds and the enclave refuses a held slot there.
const DEFAULT_ALLOCATION_CHAIN = "bitgraph:fuse";

async function handleAllocateSlot(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Pre-allocates a causal slot (nonce-first) that the caller holds and later
  // consumes with POST /commit { slotId }. Admission is the same policy as
  // /commit: the key gate (open unless REQUIRE_API_KEY=true), and for callers
  // without a valid key a limiter. This limiter counts slots, not digests: a
  // bare allocation mints nothing but holds one of the enclave's shared
  // pending-slot entries for up to the TTL (see rate-limit.ts).
  if (!checkApiKey(req)) {
    sendError(res, 401, "Unauthorized: valid API key required (Authorization: Bearer <key>)");
    return;
  }

  // The body is optional and tiny: { chainId?: string }.
  const raw = await readBody(req);
  if (raw.length > 4096) {
    sendError(res, 413, "Request body too large. Max 4 KB.");
    return;
  }
  let body: unknown = {};
  if (raw.length > 0) {
    try {
      body = JSON.parse(raw.toString("utf8"));
    } catch {
      sendError(res, 400, "Invalid JSON body");
      return;
    }
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    sendError(res, 400, "body must be a JSON object: { chainId?: string }");
    return;
  }

  // The chain is bound at allocation (the enclave stores it with the slot and
  // ignores any chainId sent at commit), so it must be chosen here. Default to
  // the anchored chain: a slot on any other chain has no anchor before it and
  // therefore no floor.
  const requested = (body as { chainId?: unknown }).chainId;
  let chainId = DEFAULT_ALLOCATION_CHAIN;
  if (requested !== undefined) {
    if (typeof requested !== "string" || !CHAIN_ID_PATTERN.test(requested)) {
      sendError(res, 400, "body.chainId must be printable ASCII, 1 to 128 characters, when present");
      return;
    }
    chainId = requested;
  }

  if (!hasValidApiKey(req)) {
    const clientIp = getClientIp(req);
    const rl = allocationLimiter.tryConsume(clientIp);
    if (!rl.ok) {
      console.warn(`[parent] allocation limit: rejected slot allocation from ${clientIp} (${rl.reason})`);
      const json = JSON.stringify({ error: `Rate limit exceeded: ${rl.reason}` });
      res.writeHead(429, {
        ...CORS_HEADERS,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(json),
        "Retry-After": String(rl.retryAfterSec),
      });
      res.end(json);
      return;
    }
  }

  try {
    const result = await allocateWithFloor(chainId);
    if (!result.ok || !result.data) {
      sendError(res, 500, result.error ?? "allocateSlot failed");
      return;
    }
    // { slotId, slot, chainId, anchor?, floor? }: slotId is the slot's nonce,
    // the bearer ticket the caller must not disclose before commit; floor
    // (v10) is the Base block a fused file binds.
    sendJson(res, 200, result.data);
  } catch (err) {
    sendError(res, 500, `Failed to allocate slot: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * GET /timeline/bundle?digest=<base64url or base64> | ?epoch=<id>&counter=<n>: a file's bitgraph-timeline-bundle/1,
 * everything needed to check its place between two block reads offline (verifyTimelineBundle; the chains give the
 * time). 409 with retryable: true until the block read that will be its ceiling exists, a few seconds after a bind.
 */
// GET /timeline/recent?epoch=<base64url>&after=<count>: the timeline's records not yet uploaded (timeline.ts recent()),
// so the public ledger shows block reads as they are made rather than a minute later.

async function handleTimelineBundle(url: URL, res: ServerResponse): Promise<void> {
  if (!timeline) { sendError(res, 404, "the block timeline is not running on this host"); return; }
  const d = url.searchParams.get("digest");
  const digestB64 = d ? Buffer.from(d.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("base64") : undefined;
  if (d && Buffer.from(digestB64!, "base64").length !== 32) { sendError(res, 400, "digest must be a 32-byte SHA-256 in base64 or base64url"); return; }
  const epochId = url.searchParams.get("epoch") ?? undefined;
  const counter = url.searchParams.get("counter") ?? undefined;
  if (counter !== undefined && !/^[1-9][0-9]*$/.test(counter)) { sendError(res, 400, "counter must be a positive decimal count"); return; }
  if (!digestB64 && !(epochId && counter)) { sendError(res, 400, "give digest, or epoch and counter"); return; }
  try {
    const r = await timeline.bundle({ ...(digestB64 ? { digestB64 } : {}), ...(epochId ? { epochId: epochId.replace(/-/g, "+").replace(/_/g, "/").padEnd(44, "=") } : {}), ...(counter ? { counter } : {}) });
    if (r.ok) { sendJson(res, 200, { bundle: r.bundle, chain: r.chain, notes: r.notes }); return; }
    if (r.retryable) res.setHeader("Retry-After", "5");
    sendJson(res, r.retryable ? 409 : r.found ? 422 : 404, { error: r.reason, retryable: r.retryable });
  } catch (e) {
    sendJson(res, 503, { error: `the timeline's records could not be read: ${e instanceof Error ? e.message : String(e)}`, retryable: true });
  }
}

async function handleHealth(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  sendJson(res, 200, timeline ? { ok: true, epochId: openEpochId, timeline: timeline.status(), alerts: alerter?.activeKeys() ?? null } : { ok: true });
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const method = req.method ?? "GET";

  try {
    if (method === "OPTIONS") {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }

    if (method === "POST" && url.pathname === "/commit") {
      await handleCommit(req, res);
    } else if (method === "POST" && (url.pathname === "/allocate-slot" || url.pathname === "/challenge") && await onlyBind()) {
      sendJson(res, 410, { error: "Gone: a BitGraph is made one way, POST /commit with a digest (one atomic action in the enclave).", code: "bind-only" });
    } else if (method === "POST" && url.pathname === "/allocate-slot") {
      await handleAllocateSlot(req, res);
    } else if (method === "POST" && url.pathname === "/challenge") {
      await handleChallenge(req, res);
    } else if (method === "GET" && url.pathname === "/key") {
      await handleKey(req, res);
    } else if (method === "POST" && url.pathname === "/verify") {
      await handleVerify(req, res);
    } else if (method === "GET" && url.pathname === "/health") {
      await handleHealth(req, res);
    } else if (method === "GET" && url.pathname === "/timeline/bundle") {
      await handleTimelineBundle(url, res);
    } else if (method === "GET" && url.pathname === "/timeline/recent") {
      if (!timeline) { sendError(res, 404, "the block timeline is not running on this host"); }
      else {
        const e = (url.searchParams.get("epoch") ?? "").replace(/-/g, "+").replace(/_/g, "/").padEnd(44, "=");
        const after = Number(url.searchParams.get("after") ?? "0");
        if (!/^[A-Za-z0-9+/]{43}=$/.test(e) || !Number.isSafeInteger(after) || after < 0) sendError(res, 400, "give epoch (base64url) and after (a count)");
        else sendJson(res, 200, timeline.recent(e, after));
      }
    } else {
      sendError(res, 404, `${method} ${url.pathname} not found`);
    }
  } catch (err) {
    console.error("[parent] unhandled error:", err);
    sendError(res, 500, "internal server error");
  }
});

server.listen(PORT, BIND_HOST, async () => {
  console.log(`[parent] listening on http://localhost:${PORT}`);
  console.log(`  POST /commit         (Content-Type: application/json, Authorization: Bearer <key>)`);
  console.log(`  POST /allocate-slot  (client-held slot for the two-phase form; metered in slots)`);
  console.log(`  POST /challenge      (public — issues enclave nonce for agency signing)`);
  console.log(`  GET  /key`);
  console.log(`  POST /verify         (Content-Type: application/json)`);
  console.log(`  GET  /health`);

  const rl = rateLimitConfig();
  console.log(`[parent] /commit rate limit: ${rl.perIpCapacity} digests/IP burst, +${rl.perIpRefillPerMin}/min refill, ${rl.globalPerDay}/day global`);
  console.log(`[parent] fuse: client-held slots on /commit are ${FUSE_ENABLED ? "ENABLED" : "disabled"} (FUSE_ENABLED)`);
  atomicBind().then(
    (on) => console.log(`[parent] POST /commit ${on ? "binds each digest in ONE enclave call (enclave v11)" : "allocates then commits (two calls)"}`),
    () => {},
  );
  const al = allocationLimiter.config();
  console.log(`[parent] /allocate-slot limit: ${al.perIpCapacity} slots/IP burst, +${al.perIpRefillPerMin}/min refill, ${al.globalPerWindow} per ${al.windowMs / 1000}s global`);

  // Epochs are not linked (Mike, 2026-10-18); each fresh epoch's first BitGraph is a Base block read instead.
  try {
    const init = await initEnclave();
    openEpochId = init.epochId;
    try {
      timeline = Timeline.fromEnv({
        bind: async (digestB64) => {
          // Straight to the enclave: never through /api/commit, so nothing is put in front of a block read.
          const r = await enclaveClient.send({ type: "bind", digestB64 });
          if (!r.ok || !r.data) throw new Error(r.error ?? "bind failed");
          return (r.data as { proof: BitGraphProof }).proof;
        },
        epochId: () => openEpochId,
        log: (m) => console.log(m),
      });
    } catch (e) {
      console.error(`[parent] timeline not started: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (timeline) {
      const st = timeline.status();
      console.log(`[parent] timeline: reading ${st.chains.map((c) => c.chain).join(" and ") || "no chain"}${st.problems.length ? ` (${st.problems.join("; ")})` : ""}`);
      timeline.start();
      void bindTimelineGenesis(init.epochId, init.counter);
      // Alerts by email through SNS (timeline-alerts.ts), when a topic is configured.
      const topic = process.env["TIMELINE_ALERT_SNS_TOPIC_ARN"];
      if (topic) {
        const tl = timeline;
        const startedAtMs = Date.now();
        alerter = new TimelineAlerter(snsAlertSend(topic, process.env["TIMELINE_ALERT_REGION"] || "us-east-2"), () => ({ timeline: tl.status(), genesisPendingSinceMs, startedAtMs }), undefined, Date.now, (m) => console.log(m));
        alerter.start();
        if (init.counter === "0") void alerter.notice("new epoch", `The enclave started a new epoch, ${init.epochId}, and this parent opened it (counter 0). If no restart was planned, the enclave restarted.`);
        console.log("[parent] timeline: alerts go to the SNS topic in TIMELINE_ALERT_SNS_TOPIC_ARN");
      } else {
        console.warn("[parent] timeline: no TIMELINE_ALERT_SNS_TOPIC_ARN, so no alerts are sent");
      }
    } else if (init.counter === "0" && process.env["EPOCH_FLOOR"] !== "off") void bindEpochFloor(init.epochId);
    else console.log(`[parent] epoch already under way (counter ${init.counter}): no epoch floor to bind`);
  } catch (err) {
    console.error(`[parent] enclave init failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Production safety: refuse to serve proofs from debug enclaves
  try {
    const keyInfo = await getKeyInfo();
    if (/^0+$/.test(keyInfo.measurement)) {
      if (!ALLOW_DEBUG_MODE) {
        console.error("[parent] FATAL: enclave is in debug mode (measurement is all zeros).");
        console.error("[parent] Set ALLOW_DEBUG_MODE=true to allow this. Shutting down.");
        process.exit(1);
      }
      console.warn("[parent] WARNING: running with debug enclave (ALLOW_DEBUG_MODE=true)");
    }
  } catch (err) {
    console.error(`[parent] Failed to verify enclave measurement: ${err instanceof Error ? err.message : String(err)}`);
  }
});

export { server, PORT };
