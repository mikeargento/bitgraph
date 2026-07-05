// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * @bitgraph/adapter-nitro — NitroHost
 *
 * AWS Nitro Enclaves adapter for bitgraph-core.
 *
 * This adapter implements HostCapabilities for software running inside an
 * AWS Nitro Enclave.  It communicates with the Nitro Security Module (NSM)
 * via the character device at /dev/nsm using the kernel ioctl interface.
 *
 * Prerequisites:
 *   - Running inside a Nitro Enclave (not the parent EC2 instance)
 *   - The NSM driver must be accessible (standard on Nitro Enclaves)
 *   - gcc (or musl-gcc) must be available to compile the nsm_ioctl helper
 *     on first use, OR pre-compile nsm_ioctl.c and set nsmBinaryPath.
 *   - An Ed25519 key pair provisioned inside the enclave boundary
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decode, encode } from "cbor2";
import type { EnforcementTier, HostCapabilities } from "bitgraph";
import type { KmsCounter } from "./kms-counter.js";

// ---------------------------------------------------------------------------
// NSM types (minimal subset needed by this adapter)
// ---------------------------------------------------------------------------

interface NsmPcrResponse {
  lock: boolean;
  data: Uint8Array;
}

interface NsmRandomResponse {
  random: Uint8Array;
}

interface NsmAttestationResponse {
  document: Uint8Array;
}

// ---------------------------------------------------------------------------
// NSM ioctl C helper source
// ---------------------------------------------------------------------------

const NSM_IOCTL_C_SOURCE = `
#include <fcntl.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <unistd.h>
#include <errno.h>

#define NSM_MAGIC              0x0A
#define NSM_REQUEST_MAX_SIZE   0x1000
#define NSM_RESPONSE_MAX_SIZE  0x3000

struct nsm_iovec { uint64_t addr; uint64_t len; };
struct nsm_raw   { struct nsm_iovec request; struct nsm_iovec response; };

#define NSM_IOCTL_RAW  _IOWR(NSM_MAGIC, 0x0, struct nsm_raw)

int main(void) {
    static uint8_t req[NSM_REQUEST_MAX_SIZE];
    static uint8_t res[NSM_RESPONSE_MAX_SIZE];
    size_t rlen = 0; ssize_t n;
    while (rlen < NSM_REQUEST_MAX_SIZE) {
        n = read(0, req + rlen, NSM_REQUEST_MAX_SIZE - rlen);
        if (n < 0) { if (errno == EINTR) continue; perror("read"); return 1; }
        if (n == 0) break;
        rlen += (size_t)n;
    }
    if (!rlen) { fputs("empty\\n", stderr); return 1; }
    int fd = open("/dev/nsm", O_RDWR | O_CLOEXEC);
    if (fd < 0) { perror("open"); return 1; }
    struct nsm_raw m = {
        { (uint64_t)(uintptr_t)req, (uint64_t)rlen },
        { (uint64_t)(uintptr_t)res, NSM_RESPONSE_MAX_SIZE }
    };
    if (ioctl(fd, NSM_IOCTL_RAW, &m)) {
        fprintf(stderr, "ioctl: %s\\n", strerror(errno)); close(fd); return 1;
    }
    close(fd);
    size_t wlen = (size_t)m.response.len, wo = 0;
    while (wo < wlen) {
        n = write(1, res + wo, wlen - wo);
        if (n < 0) { if (errno == EINTR) continue; perror("write"); return 1; }
        wo += (size_t)n;
    }
    return 0;
}
`;

// ---------------------------------------------------------------------------
// NsmClient
// ---------------------------------------------------------------------------

export interface NsmClient {
  request(request: Record<string, unknown>): Promise<Record<string, unknown>>;
}

const DEFAULT_NSM_BINARY = "/usr/local/bin/nsm_ioctl";

export class DefaultNsmClient implements NsmClient {
  readonly #nsmBinaryPath: string | undefined;
  #compiledBinaryPath: string | undefined;

  constructor(opts?: { nsmBinaryPath?: string }) {
    this.#nsmBinaryPath = opts?.nsmBinaryPath;
  }

  #getBinaryPath(): string {
    if (this.#nsmBinaryPath) {
      if (!existsSync(this.#nsmBinaryPath)) {
        throw new NsmIoctlError(
          `DefaultNsmClient: binary not found at provided path: ${this.#nsmBinaryPath}`
        );
      }
      return this.#nsmBinaryPath;
    }

    if (existsSync(DEFAULT_NSM_BINARY)) {
      return DEFAULT_NSM_BINARY;
    }

    if (this.#compiledBinaryPath && existsSync(this.#compiledBinaryPath)) {
      return this.#compiledBinaryPath;
    }

    const tmpDir = mkdtempSync(join(tmpdir(), "nsm-ioctl-"));
    const srcPath = join(tmpDir, "nsm_ioctl.c");
    const binPath = join(tmpDir, "nsm_ioctl");

    writeFileSync(srcPath, NSM_IOCTL_C_SOURCE, "utf8");

    const compilers = ["gcc", "musl-gcc", "cc"];
    let compiled = false;

    for (const compiler of compilers) {
      const result = spawnSync(
        compiler,
        ["-O2", "-static", "-o", binPath, srcPath],
        { encoding: "utf8", timeout: 30_000 }
      );
      if (result.status === 0) {
        compiled = true;
        break;
      }
    }

    if (!compiled) {
      throw new NsmCompileError(
        "DefaultNsmClient: nsm_ioctl binary not found and JIT-compilation failed.\n" +
          "  In a Nitro Enclave, pre-compile nsm_ioctl.c during Docker build:\n" +
          "    gcc -O2 -static -o /usr/local/bin/nsm_ioctl nsm_ioctl.c\n" +
          "  Or provide a pre-compiled binary path:\n" +
          "    new DefaultNsmClient({ nsmBinaryPath: '/path/to/nsm_ioctl' })"
      );
    }

    this.#compiledBinaryPath = binPath;
    return binPath;
  }

  #encodeRequest(request: Record<string, unknown>): Uint8Array {
    const entries = Object.entries(request);
    if (entries.length !== 1) {
      throw new TypeError(
        "NsmClient.request: expected exactly one command key, got " +
          JSON.stringify(Object.keys(request))
      );
    }

    const [cmd, args] = entries[0]!;

    if (args === null || args === undefined) {
      return encode(cmd);
    }

    const cleanArgs: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
      if (v !== null && v !== undefined) {
        cleanArgs[k] = v;
      }
    }

    return encode({ [cmd]: cleanArgs });
  }

  async request(
    request: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const binaryPath = this.#getBinaryPath();
    const reqBytes = this.#encodeRequest(request);

    const result = spawnSync(binaryPath, [], {
      input: reqBytes,
      maxBuffer: 64 * 1024,
      timeout: 10_000,
    });

    if (result.error) {
      throw new NsmIoctlError(
        "nsm_ioctl process error: " + result.error.message
      );
    }

    const stderr = result.stderr?.toString().trim();
    if (result.status !== 0) {
      throw new NsmIoctlError(
        `nsm_ioctl exited with code ${result.status}: ${stderr ?? "unknown error"}`
      );
    }

    if (!result.stdout || result.stdout.length === 0) {
      throw new NsmIoctlError("nsm_ioctl returned empty response");
    }

    const decoded = decode(result.stdout) as Record<string, unknown>;
    return decoded;
  }
}

export class NsmNotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NsmNotImplementedError";
  }
}

export class NsmCompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NsmCompileError";
  }
}

export class NsmIoctlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NsmIoctlError";
  }
}

// ---------------------------------------------------------------------------
// NitroHost options
// ---------------------------------------------------------------------------

export interface NitroHostOptions {
  pcrIndex?: number;
  nsmClient?: NsmClient;
  sign: (data: Uint8Array) => Promise<Uint8Array>;
  getPublicKey: () => Promise<Uint8Array>;
  counter?: KmsCounter | { next(): Promise<string> };
}

// ---------------------------------------------------------------------------
// NitroHost
// ---------------------------------------------------------------------------

export class NitroHost implements HostCapabilities {
  readonly enforcementTier: EnforcementTier = "measured-tee";

  readonly #pcrIndex: number;
  readonly #nsm: NsmClient;
  readonly #signFn: (data: Uint8Array) => Promise<Uint8Array>;
  readonly #getPublicKeyFn: () => Promise<Uint8Array>;

  nextCounter?: () => Promise<string>;

  constructor(opts: NitroHostOptions) {
    this.#pcrIndex = opts.pcrIndex ?? 0;
    this.#nsm = opts.nsmClient ?? new DefaultNsmClient();
    this.#signFn = opts.sign;
    this.#getPublicKeyFn = opts.getPublicKey;

    if (opts.counter) {
      const c = opts.counter;
      this.nextCounter = () => c.next();
    }
  }

  async getMeasurement(): Promise<string> {
    const resp = await this.#nsm.request({
      DescribePCR: { index: this.#pcrIndex },
    });

    const pcr = resp["DescribePCR"] as NsmPcrResponse | undefined;
    if (!pcr || !(pcr.data instanceof Uint8Array)) {
      throw new Error(
        `NitroHost: unexpected NSM DescribePCR response for PCR${this.#pcrIndex}`
      );
    }

    return Buffer.from(pcr.data).toString("hex");
  }

  async getFreshNonce(): Promise<Uint8Array> {
    const resp = await this.#nsm.request({ GetRandom: null });

    const random = resp["GetRandom"] as NsmRandomResponse | undefined;
    if (!random || !(random.random instanceof Uint8Array)) {
      throw new Error("NitroHost: unexpected NSM GetRandom response");
    }
    if (random.random.length < 16) {
      throw new RangeError(
        `NitroHost: NSM GetRandom returned only ${random.random.length} bytes; expected >= 16`
      );
    }

    // NSM GetRandom returns 256 bytes (its full entropy pool).
    // Truncate to 32 bytes (256 bits) — the standard nonce size for BitGraph.
    // This is still well above the 128-bit minimum required by HostCapabilities.
    return random.random.slice(0, 32);
  }

  async sign(data: Uint8Array): Promise<Uint8Array> {
    return this.#signFn(data);
  }

  async getPublicKey(): Promise<Uint8Array> {
    return this.#getPublicKeyFn();
  }

  async getAttestation(
    userData?: Uint8Array
  ): Promise<{ format: string; report: Uint8Array }> {
    const attestationArgs: Record<string, unknown> = {};
    if (userData && userData.length > 0) {
      attestationArgs["user_data"] = userData;
    }

    const resp = await this.#nsm.request({
      Attestation: attestationArgs,
    });

    const attestation = resp["Attestation"] as NsmAttestationResponse | undefined;

    if (!attestation || !(attestation.document instanceof Uint8Array)) {
      throw new Error("NitroHost: unexpected NSM Attestation response");
    }

    return { format: "aws-nitro", report: attestation.document };
  }
}
