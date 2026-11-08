// Copyright (c) 2025-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * HTTP client for the hosted BitGraph API, the same routes the site's drop box
 * calls.
 *
 *   POST /api/commit         bind one SHA-256: a fresh nonce at count N, the
 *                            digest at N+1, signed and attested together
 *   POST /api/tree-members   index a tree's files under their own hashes
 *   POST /api/proofs/batch   which digests already have a BitGraph
 *   GET  /api/proofs/digest  one digest's proof and positions
 *   GET  /api/search         a BitGraph number to its digest
 */

import { mapConcurrent } from "./encoding.js";
import type { BatchCheckResponse, BitGraphProof, ProofDetailResponse, SearchResponse } from "./types.js";

export interface ApiConfig {
  baseUrl: string;
  apiKey?: string;
}

/** Read configuration from the environment at call time (testable via env). */
export function configFromEnv(): ApiConfig {
  const baseUrl = (process.env["BITGRAPH_API_URL"] ?? "https://bitgraph.ing").replace(/\/+$/, "");
  const apiKey = process.env["BITGRAPH_API_KEY"];
  return apiKey ? { baseUrl, apiKey } : { baseUrl };
}

/** Matches the batch endpoint's MAX_DIGESTS. */
export const BATCH_CHECK_LIMIT = 500;
/** Batch lookups in flight at once: a large folder is many pages. */
const BATCH_CHECK_CONCURRENCY = 4;

const CHECK_TIMEOUT_MS = 30_000;
const BIND_TIMEOUT_MS = 60_000;
const TREE_INDEX_TIMEOUT_MS = 60_000;
/** Tree members per index request, and requests in flight, as the site sends them. */
const TREE_INDEX_BATCH = 2000;
const TREE_INDEX_CONCURRENCY = 4;
const TREE_INDEX_ATTEMPTS = 10;

export class ApiError extends Error {
  readonly status: number;
  readonly retryAfterSec: number | null;

  constructor(status: number, message: string, retryAfterSec: number | null = null) {
    super(message);
    this.status = status;
    this.retryAfterSec = retryAfterSec;
  }
}

async function parseError(res: Response): Promise<ApiError> {
  let message = res.statusText || `HTTP ${res.status}`;
  try {
    const body = (await res.json()) as { error?: string };
    if (typeof body.error === "string" && body.error.length > 0) message = body.error;
  } catch {
    /* non-JSON error body */
  }
  const retryAfterRaw = res.headers.get("retry-after");
  const retryAfterSec = retryAfterRaw !== null ? Number.parseInt(retryAfterRaw, 10) : null;
  return new ApiError(res.status, message, Number.isFinite(retryAfterSec) ? retryAfterSec : null);
}

/**
 * Redirects are refused everywhere: an Authorization header must never follow
 * one to a different host, and the canonical endpoint serves without them.
 */
function redirectHint(err: unknown): never {
  if (err instanceof TypeError && /redirect/i.test(err.message)) {
    throw new Error(
      "The BitGraph endpoint redirected. Set BITGRAPH_API_URL to the canonical https://bitgraph.ing (apex, no www)."
    );
  }
  throw err;
}

async function getJson<T>(config: ApiConfig, path: string, timeoutMs: number): Promise<T> {
  const res = await fetch(`${config.baseUrl}${path}`, {
    method: "GET",
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  }).catch(redirectHint);
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as T;
}

async function postJson<T>(
  config: ApiConfig,
  path: string,
  body: unknown,
  timeoutMs: number,
  authenticated: boolean
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authenticated && config.apiKey) headers["Authorization"] = `Bearer ${config.apiKey}`;
  const res = await fetch(`${config.baseUrl}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  }).catch(redirectHint);
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as T;
}

/**
 * Look up which digests are on record. Input digests must be URL-safe base64;
 * the response is keyed by the exact strings sent. Pages of up to 500, a few
 * in flight at once.
 */
export async function batchCheck(
  config: ApiConfig,
  urlSafeDigests: readonly string[]
): Promise<BatchCheckResponse> {
  const chunks: string[][] = [];
  for (let offset = 0; offset < urlSafeDigests.length; offset += BATCH_CHECK_LIMIT) {
    chunks.push(urlSafeDigests.slice(offset, offset + BATCH_CHECK_LIMIT));
  }
  const pages = await mapConcurrent(chunks, BATCH_CHECK_CONCURRENCY, (chunk) =>
    postJson<BatchCheckResponse>(config, "/api/proofs/batch", { digests: chunk }, CHECK_TIMEOUT_MS, false)
  );
  const merged: BatchCheckResponse = { results: {} };
  for (const page of pages) {
    Object.assign(merged.results, page.results);
    if (page.environments !== undefined) merged.environments = { ...(merged.environments ?? {}), ...page.environments };
  }
  return merged;
}

/**
 * Bind one SHA-256 (standard base64) in the enclave: a fresh nonce takes one
 * count and the digest the next, both signed with the enclave's time and
 * attested. Returns the proof. Permanent: a BitGraph is never undone.
 */
export async function bindDigest(config: ApiConfig, digestB64: string): Promise<BitGraphProof> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.apiKey) headers["Authorization"] = `Bearer ${config.apiKey}`;
  const res = await fetch(`${config.baseUrl}/api/commit`, {
    method: "POST",
    headers,
    body: JSON.stringify({ digests: [{ digestB64, hashAlg: "sha256" }], chainId: "bitgraph:main" }),
    redirect: "error",
    signal: AbortSignal.timeout(BIND_TIMEOUT_MS),
  }).catch(redirectHint);
  if (res.status === 503) {
    const err = await parseError(res);
    throw new ApiError(503, "the enclave is restarting (it does once a day); nothing was made, try again in a minute", err.retryAfterSec);
  }
  if (!res.ok) throw await parseError(res);
  const raw = (await res.json()) as BitGraphProof[] | { proofs?: BitGraphProof[] } | BitGraphProof;
  const proofs = Array.isArray(raw) ? raw : "proofs" in raw && Array.isArray(raw.proofs) ? raw.proofs : [raw as BitGraphProof];
  const proof = proofs.find((p) => p.artifact?.digestB64 === digestB64);
  if (!proof) throw new ApiError(502, `no proof came back for ${digestB64}; look it up before trying again`);
  return proof;
}

/** A tree's root position, as the index checks it. */
export interface TreeRoot {
  /** SHA-256 of the root text, standard base64: the digest the proof binds. */
  rootDigestB64: string;
  epochId: string;
  counter: string;
  rootText: string;
}

/** One file of a tree: its SHA-256, its leaf index, and its path to the root. */
export interface TreeMemberRow {
  digestB64: string;
  index: number;
  path: string;
}

/**
 * Index a tree's files under their own hashes, so each is found like a file
 * bound alone. The site reads the root's proof at its position and walks each
 * file's hash up its path to the root before it writes anything. The root's
 * own entry can lag its bind by a moment (404); that, a rate limit and a
 * server error are waited out and tried again. Resolves with how many were
 * written.
 */
export async function postTreeMembers(config: ApiConfig, root: TreeRoot, members: readonly TreeMemberRow[]): Promise<number> {
  const batches: TreeMemberRow[][] = [];
  for (let i = 0; i < members.length; i += TREE_INDEX_BATCH) batches.push(members.slice(i, i + TREE_INDEX_BATCH));
  const written = await mapConcurrent(batches, TREE_INDEX_CONCURRENCY, async (batch) => {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${config.baseUrl}/api/tree-members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...root, members: batch }),
        redirect: "error",
        signal: AbortSignal.timeout(TREE_INDEX_TIMEOUT_MS),
      }).catch(() => null);
      if (res?.ok) {
        const j = (await res.json().catch(() => null)) as { written?: number } | null;
        return j?.written ?? 0;
      }
      const retryable = res === null || res.status === 404 || res.status === 429 || res.status >= 500;
      if (!retryable || attempt + 1 >= TREE_INDEX_ATTEMPTS) throw new Error(`the tree index answered ${res?.status ?? "nothing"}`);
      const wait = Number(res?.headers.get("retry-after") ?? "") || 2;
      await new Promise((r) => setTimeout(r, wait * 1000));
    }
  });
  return written.reduce((a, b) => a + b, 0);
}

/** Full detail for one digest: its proof and every position the same bytes occupy. */
export async function getProofDetail(
  config: ApiConfig,
  urlSafeDigest: string,
  counter?: string,
  urlSafeEpoch?: string
): Promise<ProofDetailResponse> {
  const params = new URLSearchParams();
  if (counter !== undefined) params.set("counter", counter);
  if (urlSafeEpoch !== undefined) params.set("epoch", urlSafeEpoch);
  const query = params.size > 0 ? `?${params.toString()}` : "";
  return getJson<ProofDetailResponse>(
    config,
    `/api/proofs/digest/${encodeURIComponent(urlSafeDigest)}${query}`,
    CHECK_TIMEOUT_MS
  );
}

/** Resolve a BitGraph number (or digest string) to a digest via /api/search. */
export async function search(config: ApiConfig, q: string): Promise<SearchResponse> {
  return getJson<SearchResponse>(
    config,
    `/api/search?q=${encodeURIComponent(q)}`,
    CHECK_TIMEOUT_MS
  );
}
