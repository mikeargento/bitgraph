// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * Parent EC2 instance: HTTPS API server
 *
 * Endpoints:
 *   POST /commit           { digests: [{ digestB64, hashAlg }], metadata?, agency?, policy?, attribution?, chainId? }
 *   POST /challenge        {} -> { challenge }  (public; issues an enclave nonce for agency signing, on enclaves that have one)
 *   GET  /key              { publicKeyB64, measurement, enforcement }
 *   POST /verify           { proof, policy? }
 *   GET  /health           { ok: true, ... }
 *   GET  /timeline/bundle  a file's bitgraph-timeline-bundle/1 (when TIMELINE=on)
 *   GET  /timeline/recent  the timeline's records not yet uploaded (when TIMELINE=on)
 *
 * A BitGraph is one atomic enclave action, "bind": a fresh nonce at count N and the digest at N+1, attested and
 * chained to the record before it by prevB64. POST /commit makes one bind per digest. The nonce never leaves the
 * enclave and the parent never sees it. Nothing here reads from or writes to any blockchain.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { verify } from "bitgraph";
import type { BitGraphProof, VerificationPolicy, AgencyEnvelope, PolicyBinding } from "bitgraph";
import { VsockClient, type EnclaveClient, type BindRequest } from "./vsock-client.js";
import { getClientIp, tryConsumeDigests, rateLimitConfig } from "./rate-limit.js";
import { createAuthPolicy, describeAuthPolicy, type AuthPolicy } from "./auth.js";
import { epochEndFileText, closeRequestPath } from "./epoch-end.js";
import { Timeline } from "./timeline.js";
import { TimelineAlerter, snsAlertSend } from "./timeline-alerts.js";

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
/** Enclave v12 and later (its /key says only: "bind"): a bind carries the digest and nothing else. */
async function onlyBind(): Promise<boolean> {
  try { return (await getKeyInfo()).only === "bind"; } catch { return false; }
}

/** Bind one digest. An enclave that binds only digests is sent the digest alone. */
async function bindDigest(req: Omit<BindRequest, "type">) {
  if (await onlyBind()) return enclaveClient.send({ type: "bind", digestB64: req.digestB64 });
  return enclaveClient.send({ type: "bind", ...req });
}

const sha256B64 = (text: string): string => createHash("sha256").update(text, "utf8").digest("base64");

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

// The timeline (timeline.ts), when TIMELINE=on: every record the enclave makes is journaled.
let openEpochId: string | null = null;
let timeline: Timeline | null = null;
let alerter: TimelineAlerter | null = null;

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
// Enclave initialization: always a fresh epoch, starting at counter 1.
// Epochs are not chained to each other; each stands on its own key and
// attestation.
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
// Binds run one at a time, so the epoch's closing BitGraph is the last record bound.
// ---------------------------------------------------------------------------

let bindChain: Promise<unknown> = Promise.resolve();
/** Run `f` with no other bind in the enclave until it finishes. */
function bindExclusive<T>(f: () => Promise<T>): Promise<T> {
  const run = bindChain.then(f, f);
  bindChain = run.catch(() => undefined);
  return run;
}

// ---------------------------------------------------------------------------
// The epoch's closing BitGraph (epoch-end.ts): the last record of the line, made when the nightly rotation is about to
// stop the enclave. The rotation leaves a close request for the open epoch in EPOCH_CLOSE_DIR, then stops this service.
// On that stop, and only then, no new request is taken, the binds already under way finish, and the closing note is
// bound as the epoch's last BitGraph. A stop without a close request (a deploy, a crash restart) leaves the epoch
// open, since the enclave keeps running and its line goes on.
// ---------------------------------------------------------------------------

const EPOCH_CLOSE_DIR = process.env["EPOCH_CLOSE_DIR"];

async function bindEpochEnd(): Promise<void> {
  const epochId = openEpochId;
  if (!epochId || !EPOCH_CLOSE_DIR) return;
  if (!existsSync(closeRequestPath(EPOCH_CLOSE_DIR, epochId))) return;
  const text = epochEndFileText(epochId);
  const r = await bindExclusive(() => enclaveClient.send({ type: "bind", digestB64: sha256B64(text) }));
  if (!r.ok || !r.data) { console.error(`[parent] epoch end: the closing note was not bound (${r.error ?? "no answer"})`); return; }
  const { proof } = r.data as { proof: BitGraphProof };
  try { timeline?.recordEnd(proof, text); } catch (e) { console.error(`[parent] epoch end: journal append failed: ${e instanceof Error ? e.message : String(e)}`); }
  void persistToLedger([proof]);
  console.log(`[parent] epoch end: ${epochId} closed at count ${proof.commit.counter}`);
}

let stopping = false;
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    if (stopping) return;
    stopping = true;
    server.close();
    void bindEpochEnd()
      .catch((e) => console.error(`[parent] epoch end failed: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => setTimeout(() => process.exit(0), 1500));
  });
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
    /** Held slots are gone; a request that names one is refused (410). */
    slotId?: unknown;
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

  if (body.slotId !== undefined) {
    sendJson(res, 410, { error: "Held slots are gone: a BitGraph is made one way, one atomic action in the enclave. Send the digest without a slotId.", code: "bind-only" });
    return;
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

  // One bind per digest: the nonce at count N and this digest at N+1, in one enclave call.
  //
  // Agency (passkey/WebAuthn) with batch support, on enclaves that take it:
  //   - The client's agency envelope includes batchContext with all digests.
  //   - Agency goes with EVERY bind (with updated batchIndex).
  //   - The enclave validates the challenge + P-256 signature on digest #0,
  //     stores the validated batch, then looks it up for digests #1..N.
  //   - A run larger than one request arrives as several requests. The
  //     client's batchIndex is the OFFSET of this request into the run, and
  //     each digest here is numbered from it. Only index 0 validates against
  //     the (single-use) nonce; every later index takes the enclave's
  //     continuation path.
  //
  // Binds are sequential (monotonic counter).
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

    const commitResult = await bindExclusive(() => bindDigest({
      digestB64: d.digestB64,
      ...(body.chainId !== undefined ? { chainId: body.chainId } : {}),
      ...(agencyForDigest !== undefined ? { agency: agencyForDigest } : {}),
      ...(body.attribution !== undefined ? { attribution: body.attribution } : {}),
      ...(body.policy !== undefined ? { policy: body.policy } : {}),
      ...(body.metadata !== undefined ? { metadata: body.metadata } : {}),
    }));

    if (!commitResult.ok || !commitResult.data) {
      // Proofs already made in this request are kept and returned (2026-10-18 audit): they were bound, counted and
      // signed; dropping them left gaps in the sequence with nobody holding the proofs.
      if (proofs.length > 0) {
        await keepMade(proofs);
        sendJson(res, 500, { error: commitResult.error ?? "commit failed", code: "partial", failedIndex: i, made: proofs });
        return;
      }
      sendError(res, 500, commitResult.error ?? "commit failed");
      return;
    }

    const { proof } = commitResult.data as { proof: BitGraphProof };
    proofs.push(proof);
  }

  await keepMade(proofs);
  sendJson(res, 200, proofs);
}

/**
 * Every proof the enclave made: its proofHash added, journaled when the timeline runs, and persisted to the immutable
 * S3 ledger (with the by-digest index). Persisting is fire-and-forget.
 */
async function keepMade(proofs: BitGraphProof[]): Promise<void> {
  try {
    const { computeProofHash } = await import("bitgraph");
    for (const p of proofs) {
      (p as BitGraphProof & { proofHash: string }).proofHash = computeProofHash(p);
    }
  } catch (_) { /* non-critical: proofHash is a convenience field */ }
  // The timeline's journal holds every record of the sequence; the per-proof ledger objects below are kept as well.
  if (timeline) {
    for (const p of proofs) {
      try { timeline.record(p); } catch (e) { console.error(`[parent] timeline journal append failed: ${e instanceof Error ? e.message : String(e)}`); }
    }
  }
  void persistToLedger(proofs);
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

/**
 * GET /timeline/bundle?digest=<base64url or base64> | ?epoch=<id>&counter=<n>: a file's bitgraph-timeline-bundle/1,
 * everything needed to check its place between two block reads offline (verifyTimelineBundle). It needs block-read
 * records on both sides of the file in its epoch: 409 with retryable: true while there is none after it.
 */
// GET /timeline/recent?epoch=<base64url>&after=<count>: the timeline's records not yet uploaded (timeline.ts recent()),
// so the public ledger shows records as they are made rather than a minute later.

async function handleTimelineBundle(url: URL, res: ServerResponse): Promise<void> {
  if (!timeline) { sendError(res, 404, "the timeline is not running on this host"); return; }
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
    } else if (method === "POST" && (url.pathname === "/allocate-slot" || (url.pathname === "/challenge" && await onlyBind()))) {
      sendJson(res, 410, { error: "Gone: a BitGraph is made one way, POST /commit with a digest (one atomic action in the enclave).", code: "bind-only" });
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
      if (!timeline) { sendError(res, 404, "the timeline is not running on this host"); }
      else {
        const e = (url.searchParams.get("epoch") ?? "").replace(/-/g, "+").replace(/_/g, "/").padEnd(44, "=");
        const after = Number(url.searchParams.get("after") ?? "0");
        if (!/^[A-Za-z0-9+/]{43}=$/.test(e) || !Number.isSafeInteger(after) || after < 0) sendError(res, 400, "give epoch (base64url) and after (a count)");
        else if (url.searchParams.get("full") === "1") sendJson(res, 200, { epochId: e, lines: timeline.recentLines(e, after) });
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
  console.log(`  POST /challenge      (public — issues enclave nonce for agency signing)`);
  console.log(`  GET  /key`);
  console.log(`  POST /verify         (Content-Type: application/json)`);
  console.log(`  GET  /health`);

  const rl = rateLimitConfig();
  console.log(`[parent] /commit rate limit: ${rl.perIpCapacity} digests/IP burst, +${rl.perIpRefillPerMin}/min refill, ${rl.globalPerDay}/day global`);

  try {
    const init = await initEnclave();
    openEpochId = init.epochId;
    try {
      timeline = Timeline.fromEnv();
    } catch (e) {
      console.error(`[parent] timeline not started: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (timeline) {
      const st = timeline.status();
      console.log(`[parent] timeline: journaling every record${st.problems.length ? ` (${st.problems.join("; ")})` : ""}`);
      timeline.start();
      // Alerts by email through SNS (timeline-alerts.ts), when a topic is configured.
      const topic = process.env["TIMELINE_ALERT_SNS_TOPIC_ARN"];
      if (topic) {
        const tl = timeline;
        alerter = new TimelineAlerter(snsAlertSend(topic, process.env["TIMELINE_ALERT_REGION"] || "us-east-2"), () => ({ timeline: tl.status() }), undefined, Date.now, (m) => console.log(m));
        alerter.start();
        if (init.counter === "0") void alerter.notice("new epoch", `The enclave started a new epoch, ${init.epochId}, and this parent opened it (counter 0). If no restart was planned, the enclave restarted.`);
        console.log("[parent] timeline: alerts go to the SNS topic in TIMELINE_ALERT_SNS_TOPIC_ARN");
      } else {
        console.warn("[parent] timeline: no TIMELINE_ALERT_SNS_TOPIC_ARN, so no alerts are sent");
      }
    }
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
