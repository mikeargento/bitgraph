// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * HTTP client for the hosted BitGraph API.
 *
 * This connector is an adapter, not an implementation. Every protocol
 * behaviour (slot allocation, signing, epochs, counters, anchoring) happens
 * inside the TEE behind these endpoints; nothing here reproduces any of it.
 * The only computation this package performs on its own is SHA-256 of the
 * caller's bytes, which is exactly the computation that must happen on the
 * caller's side for the digest-only property to hold.
 *
 * Recording goes through the website's /api/commit proxy rather than the TEE
 * directly: the proxy is what maintains the per-position by-digest index that
 * makes every causal position of a file discoverable afterward.
 */

import type { Bundle, ZObject } from "zapier-platform-core";
import { sha256Stream, sha256Buffer, toUrlSafeB64, type HashedBytes } from "./digest";
import type {
  Attribution,
  BatchCheckResponse,
  BitGraphProof,
  ProofDetailResponse,
  SearchResponse,
} from "./types";

export const DEFAULT_BASE_URL = "https://bitgraph.ing";

/** Matches the website client and the MCP package: 50 digests per commit request. */
export const COMMIT_CHUNK_SIZE = 50;
/** Matches the batch endpoint's MAX_DIGESTS. */
export const BATCH_CHECK_LIMIT = 500;

const READ_TIMEOUT_MS = 30_000;
const COMMIT_TIMEOUT_MS = 60_000;

/**
 * The configured endpoint, validated as an origin.
 *
 * This field lets someone point the connector at their own BitGraph boundary,
 * which means it is also the one place a typo or a pasted-in host sends their
 * digests somewhere unintended. Zapier's D026 check exists for exactly this
 * shape of field. Three rules, each cheap and each catching a real mistake:
 * it must parse, it must be https so digests never cross the wire in the
 * clear, and it must be an origin with no path, query or fragment, because
 * every endpoint in this client is built by appending to it and a stray path
 * silently produces 404s that look like outages.
 *
 * Returning `origin` rather than the raw string also normalises away a
 * trailing slash, default ports and case in the host.
 */
export function baseUrl(bundle: Bundle): string {
  const configured = (bundle.authData?.["baseUrl"] ?? "").trim();
  if (configured.length === 0) return DEFAULT_BASE_URL;

  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error(
      `API Endpoint is not a valid URL: "${configured}". Expected an origin such as ${DEFAULT_BASE_URL}.`
    );
  }

  if (parsed.protocol !== "https:") {
    throw new Error(
      `API Endpoint must use https, so digests are never sent in the clear. Got "${parsed.protocol}//".`
    );
  }

  if (parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "") {
    throw new Error(
      `API Endpoint must be an origin with no path, query or fragment. Try "${parsed.origin}".`
    );
  }

  return parsed.origin;
}

/** Proof page URL for a digest, optionally pinned to one causal position. */
export function proofUrl(
  base: string,
  digestB64: string,
  counter?: string | undefined,
  standardEpochId?: string | undefined
): string {
  let url = `${base}/proof/${encodeURIComponent(toUrlSafeB64(digestB64))}`;
  if (counter !== undefined) {
    url += `?counter=${encodeURIComponent(counter)}`;
    if (standardEpochId !== undefined) {
      url += `&epoch=${encodeURIComponent(toUrlSafeB64(standardEpochId))}`;
    }
  }
  return url;
}

/**
 * Turn a non-2xx BitGraph response into the Zapier error that produces the
 * right behaviour for it.
 *
 * The 503 "tee-restarting" case is the one worth special handling. The
 * boundary restarts once a day for epoch rotation, and commits are held until
 * the new epoch's first Ethereum anchor lands. Nothing is minted when that
 * gate fires, so a retry cannot double-record. Raising ThrottledError makes
 * Zapier re-run the step by itself, turning a ~1 minute daily window into a
 * delay nobody sees rather than a failed Zap.
 */
function apiError(z: ZObject, status: number, body: unknown, what: string): Error {
  const parsed = (body ?? {}) as { error?: string; code?: string };
  const detail = typeof parsed.error === "string" && parsed.error.length > 0 ? parsed.error : `HTTP ${status}`;

  if (status === 503 && parsed.code === "tee-restarting") {
    return new z.errors.ThrottledError(
      "BitGraph is between epochs and is not accepting recordings for the next minute or so. " +
        "Nothing was recorded; Zapier will retry this step automatically.",
      90
    );
  }
  if (status === 429) {
    return new z.errors.ThrottledError(
      `BitGraph rate limit reached: ${detail}. Nothing was recorded; Zapier will retry this step automatically.`,
      120
    );
  }
  if (status === 401 || status === 403) {
    return new z.errors.Error(
      `BitGraph rejected the API key: ${detail}. Reconnect the BitGraph account in Zapier.`,
      "AuthenticationError",
      status
    );
  }
  return new z.errors.Error(`${what} failed: ${detail}`, "BitGraphApiError", status);
}

export class BitGraphClient {
  private readonly z: ZObject;
  readonly base: string;
  private readonly apiKey: string | undefined;

  constructor(z: ZObject, bundle: Bundle) {
    this.z = z;
    this.base = baseUrl(bundle);
    const key = (bundle.authData?.["apiKey"] ?? "").trim();
    this.apiKey = key.length > 0 ? key : undefined;
  }

  /**
   * The API key is sent on writes only. It is validated at the boundary, where
   * its effect is a rate-limit exemption; reads are served from the ledger and
   * take no credential. Sending it on reads would spread the secret across
   * more requests for no gain.
   */
  private writeHeaders(): Record<string, string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey !== undefined) headers["Authorization"] = `Bearer ${this.apiKey}`;
    return headers;
  }

  private async get<T>(path: string, what: string): Promise<T> {
    const res = await this.z.request({
      method: "GET",
      url: `${this.base}${path}`,
      timeout: READ_TIMEOUT_MS,
      skipThrowForStatus: true,
    });
    if (res.status < 200 || res.status >= 300) throw apiError(this.z, res.status, res.data, what);
    return res.data as T;
  }

  private async post<T>(path: string, body: unknown, timeout: number, what: string): Promise<T> {
    const res = await this.z.request({
      method: "POST",
      url: `${this.base}${path}`,
      headers: this.writeHeaders(),
      body: JSON.stringify(body),
      timeout,
      skipThrowForStatus: true,
    });
    if (res.status < 200 || res.status >= 300) throw apiError(this.z, res.status, res.data, what);
    return res.data as T;
  }

  /** Which digests are already on record. Input must be URL-safe base64. */
  async batchCheck(urlSafeDigests: readonly string[]): Promise<BatchCheckResponse> {
    const merged: BatchCheckResponse = { results: {} };
    for (let i = 0; i < urlSafeDigests.length; i += BATCH_CHECK_LIMIT) {
      const chunk = urlSafeDigests.slice(i, i + BATCH_CHECK_LIMIT);
      const page = await this.post<BatchCheckResponse>(
        "/api/proofs/batch",
        { digests: chunk },
        READ_TIMEOUT_MS,
        "Checking the BitGraph ledger"
      );
      Object.assign(merged.results, page.results);
    }
    return merged;
  }

  /**
   * Record digests at new causal positions. Input must be STANDARD base64, the
   * form stored inside proofs.
   *
   * A recording is permanent, so a partial failure must never be reported as
   * success. The caller gets back whatever was minted before the failure and
   * the error that stopped it.
   */
  async commit(
    standardDigests: readonly string[],
    attribution?: Attribution | undefined
  ): Promise<BitGraphProof[]> {
    const proofs: BitGraphProof[] = [];
    for (let i = 0; i < standardDigests.length; i += COMMIT_CHUNK_SIZE) {
      const chunk = standardDigests.slice(i, i + COMMIT_CHUNK_SIZE);
      const body: Record<string, unknown> = {
        digests: chunk.map((digestB64) => ({ digestB64, hashAlg: "sha256" })),
        chainId: "bitgraph:main",
      };
      if (attribution !== undefined) body["attribution"] = attribution;
      try {
        const raw = await this.post<BitGraphProof[] | BitGraphProof>(
          "/api/commit",
          body,
          COMMIT_TIMEOUT_MS,
          "Recording to the BitGraph ledger"
        );
        proofs.push(...(Array.isArray(raw) ? raw : [raw]));
      } catch (err) {
        // Only a failure that left something minted is "partial". When nothing
        // was recorded the original error is rethrown untouched, because its
        // type is what decides what happens next: a ThrottledError from the
        // rate limiter or the epoch rotation window makes Zapier re-run the
        // step, and burying it inside a generic wrapper would turn a safe
        // automatic retry into a failed Zap.
        if (proofs.length === 0) throw err;
        throw new PartialCommitError(proofs, standardDigests.length, err);
      }
    }
    return proofs;
  }

  /** Full detail for one digest: proof, every causal position, anchor window. */
  async proofDetail(
    urlSafeDigest: string,
    counter?: string | undefined,
    urlSafeEpoch?: string | undefined
  ): Promise<ProofDetailResponse> {
    const params = new URLSearchParams();
    if (counter !== undefined) params.set("counter", counter);
    if (urlSafeEpoch !== undefined) params.set("epoch", urlSafeEpoch);
    const query = params.toString();
    return this.get<ProofDetailResponse>(
      `/api/proofs/digest/${encodeURIComponent(urlSafeDigest)}${query.length > 0 ? `?${query}` : ""}`,
      "Fetching the proof"
    );
  }

  /** Resolve a BitGraph number to a digest. Numbers are per epoch. */
  async search(q: string): Promise<SearchResponse> {
    return this.get<SearchResponse>(`/api/search?q=${encodeURIComponent(q)}`, "Searching the ledger");
  }

  /**
   * Download a file and hash it as it streams, then throw the bytes away.
   *
   * The file never touches disk and is never held in memory whole, and no part
   * of it is sent to BitGraph: the request that follows carries 32 bytes of
   * digest. Zapier already holds these bytes, since it is what fetched them
   * from Drive or Dropbox in the first place; what this preserves is that they
   * go no further.
   */
  async hashFileUrl(url: string): Promise<HashedBytes> {
    const res = await this.z.request({
      method: "GET",
      url,
      raw: true,
      timeout: READ_TIMEOUT_MS,
      skipThrowForStatus: true,
    });
    if (res.status < 200 || res.status >= 300) {
      throw new this.z.errors.Error(
        `Could not download the file to hash it (HTTP ${res.status}). ` +
          `Check that the previous step's file field is still valid.`,
        "FileFetchError",
        res.status
      );
    }
    return sha256Stream(res.body);
  }
}

/** A commit batch failed partway. The `minted` proofs are already permanent. */
export class PartialCommitError extends Error {
  readonly minted: BitGraphProof[];
  readonly requested: number;
  readonly reason: unknown;

  constructor(minted: BitGraphProof[], requested: number, reason: unknown) {
    const detail = reason instanceof Error ? reason.message : String(reason);
    super(`Recorded ${minted.length} of ${requested} digests before failing: ${detail}`);
    this.minted = minted;
    this.requested = requested;
    this.reason = reason;
  }
}

/**
 * Resolve whatever the Zap step was given into a digest.
 *
 * Zapier hands a file field over as a URL when it comes from another app
 * (Drive, Dropbox, DocuSign), and as literal content when someone types into
 * the field or maps a text field. Both are supported; a URL is streamed and
 * hashed, literal content is hashed in place.
 */
export async function resolveFileDigest(
  client: BitGraphClient,
  file: string
): Promise<HashedBytes> {
  const trimmed = file.trim();
  if (/^https?:\/\//i.test(trimmed)) return client.hashFileUrl(trimmed);
  return sha256Buffer(file);
}
