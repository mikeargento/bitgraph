// Copyright (c) 2025-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * bind: the one way to make a BitGraph (enclave v12, 2026-10-17: "one tee,
 * 2 steps, one atomic action").
 *
 * Each file is hashed HERE (SHA-256, streamed); only the digest goes to
 * BitGraph. Inside the enclave, one atomic action per digest: a fresh nonce
 * nobody can see takes count N, the digest is bound at N+1, and both are signed
 * with the enclave's own time. The proof comes back, and with `write` it is
 * saved beside the file as `<file>.bitgraph.json`.
 *
 * Nothing else happens: no file is changed, no tree, no chain write. Anything
 * of that kind is plumbing a caller adds on its own.
 */

import { writeFile } from "node:fs/promises";
import { ApiError, type ApiConfig } from "./api.js";
import { sha256FileB64, mapConcurrent, toUrlSafeB64 } from "./encoding.js";
import { expandPaths } from "./scan.js";
import type { BitGraphProof } from "./types.js";

/** Digests per request, as the site's own clients send them. */
const CHUNK = 50;
const MAX_FILES = 10_000;
const TIMEOUT_MS = 60_000;

export interface BoundFile {
  /** The file's path, or null for a digest given directly. */
  path: string | null;
  /** SHA-256 of the file, standard base64. */
  digestB64: string;
  proof: BitGraphProof;
  /** The BitGraph's number: the payload's count. */
  number: string | null;
  /** The nonce's count and the payload's, one after the other. */
  counts: [string, string] | null;
  proofUrl: string;
  /** Where the proof was saved, when `write` was asked for. */
  wrote: string | null;
}

/** Where a bound file's proof is saved beside it. */
export function proofPathFor(path: string): string {
  return `${path}.bitgraph.json`;
}

async function postCommit(config: ApiConfig, digests: string[]): Promise<BitGraphProof[]> {
  const res = await fetch(`${config.baseUrl}/api/commit`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}) },
    body: JSON.stringify({ digests: digests.map((digestB64) => ({ digestB64, hashAlg: "sha256" })) }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    let message = `bind refused (${res.status})`;
    try { const j = (await res.json()) as { error?: string }; if (j.error) message = j.error; } catch { /* keep the status */ }
    const retry = Number(res.headers.get("retry-after"));
    throw new ApiError(res.status, message, Number.isFinite(retry) && retry > 0 ? retry : null);
  }
  const raw = (await res.json()) as BitGraphProof[] | BitGraphProof;
  return Array.isArray(raw) ? raw : [raw];
}

/**
 * Bind files (paths, folders expanded) and/or digests. Returns one BoundFile
 * per input, in order. A request that fails partway throws, carrying the
 * files already bound (they are permanent) as `bound`.
 */
export async function bindFiles(
  config: ApiConfig,
  inputs: { paths?: readonly string[]; digests?: readonly string[] },
  opts: { write?: boolean } = {},
): Promise<BoundFile[]> {
  const fromPaths = inputs.paths && inputs.paths.length > 0 ? (await expandPaths(inputs.paths, MAX_FILES)).files : [];
  const hashed = await mapConcurrent(fromPaths, 4, async (path) => ({ path, digestB64: await sha256FileB64(path) }));
  const items: Array<{ path: string | null; digestB64: string }> = [
    ...hashed,
    ...(inputs.digests ?? []).map((d) => ({ path: null, digestB64: d })),
  ];
  if (items.length === 0) throw new ApiError(400, "nothing to bind: no files and no digests");

  const out: BoundFile[] = [];
  for (let i = 0; i < items.length; i += CHUNK) {
    const chunk = items.slice(i, i + CHUNK);
    let proofs: BitGraphProof[];
    try {
      proofs = await postCommit(config, chunk.map((c) => c.digestB64));
    } catch (err) {
      (err as { bound?: BoundFile[] }).bound = out;
      throw err;
    }
    for (const c of chunk) {
      const proof = proofs.find((p) => p.artifact?.digestB64 === c.digestB64);
      if (!proof) throw Object.assign(new ApiError(502, `no proof came back for ${c.digestB64}`, null), { bound: out });
      const counter = proof.commit?.counter ?? null;
      const slotCounter = proof.commit?.slotCounter ?? null;
      let wrote: string | null = null;
      if (opts.write && c.path !== null) {
        const { proofHash: _ph, ...whole } = proof as BitGraphProof & { proofHash?: unknown };
        wrote = proofPathFor(c.path);
        await writeFile(wrote, JSON.stringify(whole, null, 2) + "\n");
      }
      out.push({
        path: c.path,
        digestB64: c.digestB64,
        proof,
        number: counter,
        counts: counter !== null && slotCounter !== null ? [slotCounter, counter] : null,
        proofUrl: `${config.baseUrl}/proof/${encodeURIComponent(toUrlSafeB64(c.digestB64))}`,
        wrote,
      });
    }
  }
  return out;
}
