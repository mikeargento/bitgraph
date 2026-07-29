// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * Mock commit service — standalone HTTP server for local development
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { BitGraphProof, VerificationPolicy, AgencyEnvelope } from "bitgraph";
import { MockEnclave } from "./mock-enclave.js";

const PORT = Number(
  process.argv.find((a) => a.startsWith("--port="))?.split("=")[1]
    ?? process.env["PORT"]
    ?? 8787
);

// API key auth (same as parent server)
const API_KEYS: ReadonlySet<string> = (() => {
  const raw = process.env["API_KEYS"] ?? "";
  const keys = raw.split(",").map((k) => k.trim()).filter((k) => k.length > 0);
  if (keys.length > 0) {
    console.log(`[mock-server] API key auth enabled (${keys.length} key(s))`);
  } else {
    console.log("[mock-server] API key auth disabled (no API_KEYS set — dev mode)");
  }
  return new Set(keys);
})();

function checkApiKey(req: IncomingMessage): boolean {
  if (API_KEYS.size === 0) return true;
  const auth = req.headers["authorization"] ?? "";
  if (!auth.startsWith("Bearer ")) return false;
  return API_KEYS.has(auth.slice(7).trim());
}

const enclave = await MockEnclave.create();

console.log("[mock-server] MockEnclave ready");
console.log(`  enforcement: stub`);
console.log(`  measurement: ${enclave.measurement}`);
console.log(`  publicKey:   ${enclave.publicKeyB64}`);

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { ...CORS_HEADERS, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(json) });
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

async function handleCommit(req: IncomingMessage, res: ServerResponse): Promise<void> {
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
  let body: {
    digests: Array<{ digestB64: string; hashAlg: "sha256" }>;
    metadata?: Record<string, unknown>;
    prevProofId?: string;
    agency?: AgencyEnvelope;
  };

  try { body = JSON.parse(raw.toString("utf8")); } catch { sendError(res, 400, "Invalid JSON body"); return; }

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

  const result = await enclave.send({ type: "commit", digests: body.digests, metadata: body.metadata, prevProofId: body.prevProofId, agency: body.agency });
  if (!result.ok) { sendError(res, 500, result.error ?? "commit failed"); return; }
  sendJson(res, 200, result.data);
}

async function handleKey(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const result = await enclave.send({ type: "key" });
  if (!result.ok) { sendError(res, 500, result.error ?? "key retrieval failed"); return; }
  sendJson(res, 200, result.data);
}

async function handleVerify(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const contentType = req.headers["content-type"] ?? "";
  if (!contentType.includes("application/json")) {
    sendError(res, 400, "POST /verify requires Content-Type: application/json");
    return;
  }

  const raw = await readBody(req);
  let body: { proof: BitGraphProof; policy?: VerificationPolicy };
  try { body = JSON.parse(raw.toString("utf8")); } catch { sendError(res, 400, "Invalid JSON body"); return; }

  if (!body.proof) {
    sendError(res, 400, "body must have { proof: BitGraphProof, policy?: VerificationPolicy }");
    return;
  }

  try {
    const { verifySignatureOnly } = await import("../parent/verify-helper.js");
    const result = await verifySignatureOnly(body.proof, body.policy);
    sendJson(res, 200, result);
  } catch {
    sendJson(res, 200, {
      valid: false,
      reason: "Full verification requires original bytes. Use the SDK verify() function with the original data.",
    });
  }
}

async function handleChallenge(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const result = await enclave.send({ type: "challenge" });
  if (!result.ok || !result.data) { sendError(res, 500, result.error ?? "challenge failed"); return; }
  sendJson(res, 200, result.data);
}

async function handleHealth(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  sendJson(res, 200, { ok: true });
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const method = req.method ?? "GET";

  try {
    if (method === "OPTIONS") { res.writeHead(204, CORS_HEADERS); res.end(); return; }
    if (method === "POST" && url.pathname === "/commit") { await handleCommit(req, res); }
    else if (method === "POST" && url.pathname === "/challenge") { await handleChallenge(req, res); }
    else if (method === "GET" && url.pathname === "/key") { await handleKey(req, res); }
    else if (method === "POST" && url.pathname === "/verify") { await handleVerify(req, res); }
    else if (method === "GET" && url.pathname === "/health") { await handleHealth(req, res); }
    else { sendError(res, 404, `${method} ${url.pathname} not found`); }
  } catch (err) {
    console.error("[mock-server] unhandled error:", err);
    sendError(res, 500, "internal server error");
  }
});

server.listen(PORT, () => {
  console.log(`[mock-server] listening on http://localhost:${PORT}`);
  console.log(`  POST /commit      (Content-Type: application/json, Authorization: Bearer <key>)`);
  console.log(`  POST /challenge   (public — issues enclave nonce for agency signing)`);
  console.log(`  GET  /key`);
  console.log(`  POST /verify      (Content-Type: application/json)`);
  console.log(`  GET  /health`);
});

export { server, PORT };
