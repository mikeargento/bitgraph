// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * @mikeargento/bitgraph-mcp: HTTP client for the hosted BitGraph API.
 *
 * The reads: the batch lookup, the proof detail, the number search. Making a
 * BitGraph goes through the core package's own transport against the same
 * site (its /api/fuse routes), which is what maintains the per-position
 * by-digest index that makes every member of a set discoverable afterward;
 * the one write here is a set/2's member evidence, indexed after the commit.
 */

import { mapConcurrent } from "./encoding.js";
import type { BatchCheckResponse, ProofDetailResponse, SearchResponse, SetIndexResponse } from "./types.js";

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
const SET_INDEX_TIMEOUT_MS = 60_000;

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
  for (const page of pages) Object.assign(merged.results, page.results);
  return merged;
}

/** One request's worth of a set/2's member evidence, for the site to index. */
export interface SetIndexRequest {
  /** The set proof's artifact digest, URL-safe base64. */
  setDigest: string;
  /** The set proof's epoch id, URL-safe base64. */
  epoch: string;
  /** The set proof's commit counter. */
  counter: string;
  members: unknown[];
}

/**
 * Index members of a set/2 from their evidence. The site reads the set proof
 * from its own position, binds the root document, and checks every member's
 * path before writing a key; a row that does not bind is rejected, never
 * written.
 */
export async function indexSetMembers(config: ApiConfig, body: SetIndexRequest): Promise<SetIndexResponse> {
  return postJson<SetIndexResponse>(config, "/api/fuse/set-index", body, SET_INDEX_TIMEOUT_MS, false);
}

/** Full detail for one digest: proof, all causal positions, anchor window. */
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
