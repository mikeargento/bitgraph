// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * Test doubles.
 *
 * The perform functions are exercised against a scripted `z` rather than
 * Zapier's app tester, for one overriding reason: the BitGraph ledger is
 * Object Lock COMPLIANCE storage with ten-year retention and no deletes, so a
 * test that records something can never be undone. Nothing in this suite is
 * allowed to reach POST /api/commit against production. A fake `z` makes that
 * structural instead of a rule people have to remember, and it also lets the
 * commit path be tested at all, which a real-endpoint test could not do.
 *
 * The read-only live checks in live.test.ts are the counterweight: they use
 * the real API so the wire shapes this suite assumes stay honest.
 */

import type { Bundle, ZObject } from "zapier-platform-core";
import { Readable } from "node:stream";

export interface RecordedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface StubResponse {
  status: number;
  data?: unknown;
  /** For raw:true file downloads. */
  bodyBytes?: Buffer;
}

/** Match a request to a canned response, or blow up loudly if none matches. */
export type Route = (req: RecordedRequest) => StubResponse | undefined;

class StubError extends Error {
  code: string | undefined;
  status: number | undefined;
  constructor(message: string, code?: string, status?: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

class StubThrottled extends Error {
  delay: number | undefined;
  constructor(message: string, delay?: number) {
    super(message);
    this.delay = delay;
  }
}

export interface FakeZ {
  z: ZObject;
  requests: RecordedRequest[];
}

export function fakeZ(routes: Route[]): FakeZ {
  const requests: RecordedRequest[] = [];

  const request = async (options: Record<string, unknown>) => {
    const req: RecordedRequest = {
      method: String(options["method"] ?? "GET"),
      url: String(options["url"] ?? ""),
      headers: (options["headers"] as Record<string, string>) ?? {},
      body: typeof options["body"] === "string" ? JSON.parse(options["body"] as string) : options["body"],
    };
    requests.push(req);

    for (const route of routes) {
      const hit = route(req);
      if (hit !== undefined) {
        if (options["raw"] === true) {
          return {
            status: hit.status,
            body: Readable.from(hit.bodyBytes ?? Buffer.alloc(0)),
          };
        }
        return { status: hit.status, data: hit.data };
      }
    }
    throw new Error(`No stub route for ${req.method} ${req.url}. Tests must not reach the network.`);
  };

  const z = {
    request,
    errors: {
      Error: StubError,
      ThrottledError: StubThrottled,
      HaltedError: StubError,
      ExpiredAuthError: StubError,
      RefreshAuthError: StubError,
    },
  } as unknown as ZObject;

  return { z, requests };
}

export function bundleOf(inputData: Record<string, unknown>, authData: Record<string, string> = {}): Bundle {
  return {
    authData: { apiKey: "test-key", ...authData },
    inputData,
    inputDataRaw: {},
    meta: {},
  } as unknown as Bundle;
}

/** The real public example proof, used as a fixture so shapes stay truthful. */
export const EXAMPLE_DIGEST_B64 = "mYNezUiNnzhS3V0xqDsGUWCg2ZsKshiftAI016JPBUc=";
export const EXAMPLE_DIGEST_URLSAFE = "mYNezUiNnzhS3V0xqDsGUWCg2ZsKshiftAI016JPBUc";
export const EXAMPLE_EPOCH_B64 = "EQmlm7sZsGZeYmKlgVU6k0qd6cj79bsmhzhlzxlMF7o=";

export const EXAMPLE_PROOF = {
  version: "bitgraph/1",
  artifact: { hashAlg: "sha256", digestB64: EXAMPLE_DIGEST_B64 },
  commit: {
    nonceB64: "rKW0X5fzncKtU5avAornJ3xetXRrS0S6J/nuNf+GTx4=",
    counter: "7910",
    slotCounter: "7909",
    slotHashB64: "AGC5XCMaBHFqJYeEEe9aFhZr6r+A55g69Xy+bac18mY=",
    epochId: EXAMPLE_EPOCH_B64,
    prevB64: "aCg0e0hIcEl8pHugN3/kUJXzTT2FiBdyiQItbYaC4QA=",
    chainId: "bitgraph:main",
  },
  signer: {
    publicKeyB64: "r0RCAh/beCKOpLCtY+yXEG4LixW3xhI1jadMar5n9lE=",
    signatureB64:
      "IUdaOEwAhDIEfkykc0QFAjh1smb6S9fdk2ItP3JOPj3gnLssiGmmY8YgPJvOMFXLFbN0PWkc87HPEOhmVspHCQ==",
  },
  environment: {
    enforcement: "measured-tee",
    measurement:
      "6483cedffed74680ffb287507744a398b288c3fb943eb3f2e4fe889f8b60b3d575ad8942350360b69a1bd7bf713df27f",
    attestation: { format: "aws-nitro", reportB64: "truncated" },
  },
  proofHash: "SMbMMy9xjCjUiJWETtBjTDDp4qDOXwisRE6JDHU1DfU=",
};

export const EXAMPLE_DETAIL = {
  proofs: [{ proof: EXAMPLE_PROOF }],
  positions: [
    { counter: "7910", epoch: "EQmlm7sZsGZeYmKlgVU6k0qd6cj79bsmhzhlzxlMF7o", lowerTime: "2026-07-29T16:54:11.000Z", upperTime: "2026-07-29T16:54:23.000Z" },
    { counter: "14224", epoch: "EQmlm7sZsGZeYmKlgVU6k0qd6cj79bsmhzhlzxlMF7o", lowerTime: "2026-07-30T03:51:59.000Z", upperTime: "2026-07-30T03:52:11.000Z" },
  ],
  causalWindow: {
    anchorBefore: { counter: "7908", blockNumber: 25639816, blockTime: "2026-07-29T16:54:11.000Z", etherscanUrl: "https://etherscan.io/block/25639816" },
    anchorAfter: { counter: "7912", blockNumber: 25639817, blockTime: "2026-07-29T16:54:23.000Z", etherscanUrl: "https://etherscan.io/block/25639817" },
  },
};

/** Route helpers, matched on path so base URL changes do not break them. */
export const route = {
  // Echoes back whichever digests were asked for, exactly as the real batch
  // endpoint does: it keys its response by the strings the caller sent.
  batchFound: (): Route => (req) => {
    if (!req.url.endsWith("/api/proofs/batch")) return undefined;
    const asked = (req.body as { digests?: string[] })?.digests ?? [EXAMPLE_DIGEST_URLSAFE];
    const results: Record<string, { proofs: Array<{ proof: unknown }> }> = {};
    for (const d of asked) results[d] = { proofs: [{ proof: EXAMPLE_PROOF }] };
    return { status: 200, data: { results } };
  },

  batchEmpty: (): Route => (req) =>
    req.url.endsWith("/api/proofs/batch") ? { status: 200, data: { results: {} } } : undefined,

  detail: (): Route => (req) =>
    req.url.includes("/api/proofs/digest/") ? { status: 200, data: EXAMPLE_DETAIL } : undefined,

  detailEmpty: (): Route => (req) =>
    req.url.includes("/api/proofs/digest/") ? { status: 200, data: { proofs: [] } } : undefined,

  commitOk: (): Route => (req) =>
    req.url.endsWith("/api/commit") ? { status: 200, data: [EXAMPLE_PROOF] } : undefined,

  commitStatus: (status: number, data: unknown): Route => (req) =>
    req.url.endsWith("/api/commit") ? { status, data } : undefined,

  fileBytes: (bytes: Buffer): Route => (req) =>
    req.url.startsWith("https://files.example.test/") ? { status: 200, bodyBytes: bytes } : undefined,

  search: (data: unknown): Route => (req) =>
    req.url.includes("/api/search") ? { status: 200, data } : undefined,
};
