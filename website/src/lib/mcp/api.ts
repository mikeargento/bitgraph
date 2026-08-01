/**
 * Remote MCP endpoint: HTTP client for the hosted BitGraph API.
 *
 * All recording goes through the website's own /api/commit proxy rather than
 * the TEE directly: the proxy is what maintains the per-position by-digest
 * index and the anchor-first gate. The endpoint serves anonymous callers only;
 * keyed clients that need the TEE rate-limit exemption use the stdio package
 * (@mikeargento/bitgraph-mcp), which forwards Authorization itself.
 *
 * Ported from packages/mcp/src/api.ts minus env-time API keys.
 */

import type {
  BatchCheckResponse,
  BitGraphProof,
  ProofDetailResponse,
  SearchResponse,
} from "./types";

/** Canonical apex; the MCP route self-fetches the site's public API. */
export function apiBaseUrl(): string {
  return (process.env.BITGRAPH_API_URL ?? "https://bitgraph.ing").replace(/\/+$/, "");
}

/** Matches the website client: 50 digests per commit request (~1s of TEE work each). */
export const COMMIT_CHUNK_SIZE = 50;
/** Matches the batch endpoint's MAX_DIGESTS. */
export const BATCH_CHECK_LIMIT = 500;

const CHECK_TIMEOUT_MS = 25_000;
// The route's maxDuration bounds the whole call; keep one commit chunk under it.
const COMMIT_TIMEOUT_MS = 50_000;

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

async function getJson<T>(path: string, timeoutMs: number): Promise<T> {
  const res = await fetch(`${apiBaseUrl()}${path}`, {
    method: "GET",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as T;
}

async function postJson<T>(path: string, body: unknown, timeoutMs: number): Promise<T> {
  const res = await fetch(`${apiBaseUrl()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as T;
}

/**
 * Look up which digests are on record. Input digests must be URL-safe base64;
 * the response is keyed by the exact strings sent. Batches of up to 500.
 */
export async function batchCheck(urlSafeDigests: readonly string[]): Promise<BatchCheckResponse> {
  const merged: BatchCheckResponse = { results: {} };
  for (let offset = 0; offset < urlSafeDigests.length; offset += BATCH_CHECK_LIMIT) {
    const chunk = urlSafeDigests.slice(offset, offset + BATCH_CHECK_LIMIT);
    const page = await postJson<BatchCheckResponse>(
      "/api/proofs/batch",
      { digests: chunk },
      CHECK_TIMEOUT_MS
    );
    Object.assign(merged.results, page.results);
  }
  return merged;
}

/**
 * Record digests at new causal positions. Input digests must be STANDARD
 * base64 (as stored in proofs). Commits sequentially in chunks of 50, matching
 * the website client; the TEE serializes commits anyway.
 *
 * On a mid-batch failure the error carries how many proofs were already
 * minted (those are permanent); the caller must report partial results
 * honestly rather than pretending all-or-nothing.
 */
export async function commitDigests(
  standardDigests: readonly string[],
  attribution?: { name?: string | undefined; title?: string | undefined; message?: string | undefined }
): Promise<BitGraphProof[]> {
  const proofs: BitGraphProof[] = [];
  for (let offset = 0; offset < standardDigests.length; offset += COMMIT_CHUNK_SIZE) {
    const chunk = standardDigests.slice(offset, offset + COMMIT_CHUNK_SIZE);
    const body: Record<string, unknown> = {
      digests: chunk.map((digestB64) => ({ digestB64, hashAlg: "sha256" })),
      chainId: "bitgraph:main",
    };
    if (attribution) body["attribution"] = attribution;
    try {
      const raw = await postJson<BitGraphProof[] | BitGraphProof>(
        "/api/commit",
        body,
        COMMIT_TIMEOUT_MS
      );
      proofs.push(...(Array.isArray(raw) ? raw : [raw]));
    } catch (err) {
      throw new PartialCommitError(proofs, standardDigests.length, err);
    }
  }
  return proofs;
}

/** A commit batch failed partway: `minted` proofs are already permanent. */
export class PartialCommitError extends Error {
  readonly minted: BitGraphProof[];
  readonly requested: number;
  readonly cause2: unknown;

  constructor(minted: BitGraphProof[], requested: number, cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(
      `Recording stopped after ${minted.length} of ${requested} digests: ${reason}` +
        (cause instanceof ApiError && cause.retryAfterSec !== null
          ? ` (retry after ${cause.retryAfterSec}s)`
          : "")
    );
    this.minted = minted;
    this.requested = requested;
    this.cause2 = cause;
  }
}

/** Full detail for one digest: proof, all causal positions, anchor window. */
export async function getProofDetail(
  urlSafeDigest: string,
  counter?: string,
  urlSafeEpoch?: string
): Promise<ProofDetailResponse> {
  const params = new URLSearchParams();
  if (counter !== undefined) params.set("counter", counter);
  if (urlSafeEpoch !== undefined) params.set("epoch", urlSafeEpoch);
  const query = params.size > 0 ? `?${params.toString()}` : "";
  return getJson<ProofDetailResponse>(
    `/api/proofs/digest/${encodeURIComponent(urlSafeDigest)}${query}`,
    CHECK_TIMEOUT_MS
  );
}

/** Resolve a BitGraph number (or digest string) to a digest via /api/search. */
export async function search(q: string): Promise<SearchResponse> {
  return getJson<SearchResponse>(`/api/search?q=${encodeURIComponent(q)}`, CHECK_TIMEOUT_MS);
}
