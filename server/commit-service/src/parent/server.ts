// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * Parent EC2 instance — HTTPS API server
 *
 * Endpoints:
 *   POST /commit         — { digests: [{ digestB64, hashAlg }], metadata?, agency?, policy? }  (requires API key)
 *   POST /allocate-slot  — {} → { slotId, slot }  (public — pre-allocates causal slot)
 *   POST /challenge      — {} → { challenge }  (public — issues enclave nonce for agency signing)
 *   GET  /key             — { publicKeyB64, measurement, enforcement }
 *   POST /verify          — { proof, policy? }
 *   GET  /health          — { ok: true }
 *
 * BitGraph Causal Commit Model:
 *   The parent internally handles the 2-RTT protocol (allocateSlot → commit)
 *   so clients can still use the single POST /commit API. Clients that want
 *   direct control over slot allocation can use POST /allocate-slot.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { verify } from "bitgraph";
import type { BitGraphProof, VerificationPolicy, AgencyEnvelope, PolicyBinding } from "bitgraph";
import { VsockClient, type EnclaveClient } from "./vsock-client.js";
import { requestTimestamp } from "./tsa-client.js";
import { getClientIp, tryConsumeDigests, rateLimitConfig } from "./rate-limit.js";
import { createAuthPolicy, describeAuthPolicy, type AuthPolicy } from "./auth.js";

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
      await s3.send(new PutObjectCommand({
        Bucket: LEDGER_BUCKET,
        Key: digestKey,
        Body: JSON.stringify(stored, null, 2),
        ContentType: "application/json",
      }));
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

const enclaveClient: EnclaveClient = new VsockClient();

let cachedKeyResponse: { publicKeyB64: string; measurement: string; enforcement: string } | null = null;

async function getKeyInfo(): Promise<{ publicKeyB64: string; measurement: string; enforcement: string }> {
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

async function initEnclave(): Promise<void> {
  console.log(`[parent] starting fresh genesis epoch`);
  const result = await enclaveClient.send({
    type: "init",
    allowGenesis: true,
  });
  if (!result.ok) {
    throw new Error(`Enclave rejected genesis: ${result.error ?? "unknown"}`);
  }
  const data = result.data as { counter: string; epochId: string };
  console.log(`[parent] genesis epoch started: epochId=${data.epochId}`);
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
    chainId?: string;
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

    // Step 1: Allocate a causal slot (nonce-first) — pass chainId for isolation
    const slotResult = await enclaveClient.send({ type: "allocateSlot", chainId: body.chainId });
    if (!slotResult.ok || !slotResult.data) {
      sendError(res, 500, slotResult.error ?? "slot allocation failed");
      return;
    }
    const { slotId } = slotResult.data as { slotId: string };

    // Step 2: Commit the digest with the allocated slot
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

    const commitResult = await enclaveClient.send({
      type: "commitDigest",
      slotId,
      digestB64: d.digestB64,
      agency: agencyForDigest,
      attribution: body.attribution,
      policy: body.policy,
      metadata: body.metadata,
    });

    if (!commitResult.ok || !commitResult.data) {
      sendError(res, 500, commitResult.error ?? "commit failed");
      return;
    }

    const { proof } = commitResult.data as { proof: BitGraphProof };
    proofs.push(proof);
  }

  // TSA timestamps disabled — Ethereum anchors provide stronger time proof
  // and TSA services rate-limit at scale. The ETH block hash in the causal
  // chain is an unforgeable timestamp that doesn't depend on third parties.

  // Add proofHash to each proof before responding
  try {
    const { computeProofHash } = await import("bitgraph");
    for (const p of proofs) {
      (p as BitGraphProof & { proofHash: string }).proofHash = computeProofHash(p);
    }
  } catch (_) { /* non-critical — proofHash is a convenience field */ }

  // Fire-and-forget: persist to immutable S3 ledger (includes by-digest index)
  void persistToLedger(proofs);

  sendJson(res, 200, proofs);
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

async function handleAllocateSlot(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Public endpoint — no API key required.
  // Pre-allocates a causal slot (nonce-first) for the BitGraph commit model.
  // Returns { slotId, slot } where slot is the signed SlotAllocation record.
  try {
    const result = await enclaveClient.send({ type: "allocateSlot" });
    if (!result.ok || !result.data) {
      sendError(res, 500, result.error ?? "allocateSlot failed");
      return;
    }
    sendJson(res, 200, result.data);
  } catch (err) {
    sendError(res, 500, `Failed to allocate slot: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function handleHealth(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  sendJson(res, 200, { ok: true });
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
    } else {
      sendError(res, 404, `${method} ${url.pathname} not found`);
    }
  } catch (err) {
    console.error("[parent] unhandled error:", err);
    sendError(res, 500, "internal server error");
  }
});

server.listen(PORT, async () => {
  console.log(`[parent] listening on http://localhost:${PORT}`);
  console.log(`  POST /commit         (Content-Type: application/json, Authorization: Bearer <key>)`);
  console.log(`  POST /allocate-slot  (public — pre-allocates causal slot)`);
  console.log(`  POST /challenge      (public — issues enclave nonce for agency signing)`);
  console.log(`  GET  /key`);
  console.log(`  POST /verify         (Content-Type: application/json)`);
  console.log(`  GET  /health`);

  const rl = rateLimitConfig();
  console.log(`[parent] /commit rate limit: ${rl.perIpCapacity} digests/IP burst, +${rl.perIpRefillPerMin}/min refill, ${rl.globalPerDay}/day global`);

  // Initialize enclave with previous epoch's last proof for lineage
  try {
    await initEnclave();
  } catch (err) {
    console.error(`[parent] enclave init failed: ${err instanceof Error ? err.message : String(err)}`);
    console.error(`[parent] enclave will start as genesis epoch`);
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
