// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

import { connect, type Socket } from "node:net";
import type { AgencyEnvelope, BitGraphProof, PolicyBinding } from "bitgraph";

export interface CommitRequest {
  type: "commit";
  digests: Array<{ digestB64: string; hashAlg: "sha256" }>;
  metadata?: Record<string, unknown>;
  prevProofId?: string;
  /** Optional agency envelope — actor identity + signed authorization. */
  agency?: AgencyEnvelope;
  /** Optional attribution — human-readable claim sealed into the proof. */
  attribution?: { name?: string; title?: string; message?: string };
  /** Optional policy binding — cryptographically sealed into the proof. */
  policy?: PolicyBinding;
}

/** BitGraph 2-RTT: single-artifact commit with pre-allocated slot. */
export interface CommitDigestRequest {
  type: "commitDigest";
  slotId: string;
  digestB64: string;
  metadata?: Record<string, unknown>;
  agency?: AgencyEnvelope;
  attribution?: { name?: string; title?: string; message?: string };
  /** Optional policy binding — cryptographically sealed into the proof. */
  policy?: PolicyBinding;
}

/** Pre-allocate a causal slot (nonce-first). */
export interface AllocateSlotRequest {
  type: "allocateSlot";
  chainId?: string;
}

export interface KeyRequest {
  type: "key";
}

export interface ChallengeRequest {
  type: "challenge";
}

/**
 * Initialize enclave with previous epoch's last proof for lineage.
 *
 * Fail-closed semantics:
 *   - lastProof provided → enclave verifies it or HALTS
 *   - no lastProof + allowGenesis=true → genesis epoch (no predecessor)
 *   - no lastProof + no allowGenesis → enclave HALTS (refuses implicit genesis)
 */
export interface InitRequest {
  type: "init";
  lastProof?: BitGraphProof;
  /** Per-chain last proofs for multi-chain epoch lineage. */
  lastProofsPerChain?: Record<string, BitGraphProof>;
  /** Must be explicitly true to start without a predecessor. */
  allowGenesis?: boolean;
}

export type EnclaveRequest =
  | CommitRequest
  | CommitDigestRequest
  | AllocateSlotRequest
  | KeyRequest
  | ChallengeRequest
  | InitRequest;

export interface EnclaveResponse {
  ok: boolean;
  data?: unknown;
  error?: string;
}

export interface EnclaveClient {
  send(request: EnclaveRequest): Promise<EnclaveResponse>;
  close(): void;
}

/**
 * Connects to the enclave via a local socat TCP bridge.
 *
 * Node.js `net` doesn't support AF_VSOCK natively, so we rely on a
 * socat process on the parent that bridges a local TCP port to the
 * enclave's vsock CID:port.
 *
 *   socat TCP-LISTEN:<bridgePort>,fork,reuseaddr VSOCK-CONNECT:<cid>:5000
 *
 * The VsockClient then connects to localhost:<bridgePort> via plain TCP.
 */
const DEFAULT_BRIDGE_PORT = 9000;

export class VsockClient implements EnclaveClient {
  readonly #host: string;
  readonly #port: number;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(opts?: { host?: string; port?: number }) {
    this.#host = opts?.host
      ?? process.env["VSOCK_BRIDGE_HOST"]
      ?? "127.0.0.1";
    this.#port = opts?.port
      ?? Number(process.env["VSOCK_BRIDGE_PORT"] || DEFAULT_BRIDGE_PORT);
  }

  async send(request: EnclaveRequest): Promise<EnclaveResponse> {
    // Serialize all requests — only one in-flight at a time.
    // This prevents counter race conditions when multiple callers
    // (user proofs + ETH anchors) hit the TEE concurrently.
    const result = this.#queue.then(() => this.#doSend(request));
    this.#queue = result.catch(() => {}); // swallow errors in queue chain
    return result;
  }

  #doSend(request: EnclaveRequest): Promise<EnclaveResponse> {
    return new Promise((resolve, reject) => {
      const sock: Socket = connect({ host: this.#host, port: this.#port }, () => {
        // Map { type: "commit", ... } → { action: "commit", ... } to match
        // the enclave's dispatcher which reads req.action, not req.type.
        const { type, ...rest } = request;
        const wireMsg = { action: type, ...rest };

        // Send raw JSON — the enclave expects plain JSON, no length prefix.
        // Use write() not end() — end() half-closes the TCP connection,
        // and socat propagates the FIN through the vsock chain, tearing
        // down the connection before the enclave can respond.
        const payload = JSON.stringify(wireMsg);
        sock.write(payload);
      });

      const chunks: Buffer[] = [];
      sock.on("data", (chunk: Buffer) => chunks.push(chunk));
      sock.on("end", () => {
        try {
          const buf = Buffer.concat(chunks);
          const text = buf.toString("utf8");
          if (text.length === 0) {
            reject(new Error("VsockClient: empty response from enclave"));
            return;
          }
          const raw = JSON.parse(text) as Record<string, unknown>;

          // Normalize: the enclave's "key" handler returns raw data
          // (e.g. { publicKeyB64, measurement, ... }) without an ok/data
          // wrapper. The "commit" handler returns { ok, data }.
          // Wrap raw responses into EnclaveResponse format for the caller.
          if ("ok" in raw) {
            resolve(raw as unknown as EnclaveResponse);
          } else if ("error" in raw) {
            resolve({ ok: false, error: String(raw["error"]) });
          } else {
            resolve({ ok: true, data: raw });
          }
        } catch (err) {
          reject(new Error(`VsockClient: failed to parse response: ${err}`));
        }
      });
      sock.on("error", (err) => reject(new Error(`VsockClient: ${err.message}`)));
      sock.setTimeout(30_000, () => {
        sock.destroy();
        reject(new Error("VsockClient: request timed out"));
      });
    });
  }

  close(): void {}
}
