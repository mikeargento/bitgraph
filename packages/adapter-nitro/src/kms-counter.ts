// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * KmsCounter — monotonic counter for AWS Nitro Enclaves backed by AWS KMS.
 *
 * See the old prethereum repo for full design rationale.
 * Counter value sealed with KMS, restored on enclave restart.
 * External DynamoDB anchor closes the blob rollback gap.
 */

import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import type { RequestOptions } from "node:http";
import { createHash, createHmac } from "node:crypto";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface KmsCounterOptions {
  kmsKeyId: string;
  kmsRegion: string;
  kmsEndpoint?: string;
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };
  persistBlob?: (ciphertextBase64: string) => Promise<void>;
  restoreBlob?: () => Promise<string | null | undefined>;
  anchorCounter?: (candidate: bigint) => Promise<void>;
  initialValue?: bigint;
}

// ---------------------------------------------------------------------------
// KmsCounter
// ---------------------------------------------------------------------------

export class KmsCounter {
  readonly #opts: KmsCounterOptions;
  #value: bigint;
  #restored: boolean = false;

  constructor(opts: KmsCounterOptions) {
    if (!opts.kmsKeyId) throw new TypeError("KmsCounter: kmsKeyId is required");
    if (!opts.kmsRegion) throw new TypeError("KmsCounter: kmsRegion is required");
    this.#opts = opts;
    this.#value = opts.initialValue ?? 0n;
  }

  async restore(): Promise<void> {
    this.#restored = true;

    if (!this.#opts.restoreBlob) return;

    const blob = await this.#opts.restoreBlob();
    if (!blob) return;

    const plaintext = await this.#kmsDecrypt(blob);
    const decoded = new TextDecoder().decode(plaintext).replace(/\s+$/, "").trim();
    const restored = BigInt(decoded);
    const candidate = restored + 1n;

    if (this.#opts.anchorCounter) {
      await this.#opts.anchorCounter(candidate);
    }

    this.#value = candidate;
  }

  async next(): Promise<string> {
    const candidate = this.#value + 1n;

    const ciphertextB64 = await this.#kmsEncrypt(candidate);

    if (this.#opts.anchorCounter) {
      await this.#opts.anchorCounter(candidate);
    }

    if (this.#opts.persistBlob) {
      await this.#opts.persistBlob(ciphertextB64);
    }

    this.#value = candidate;

    return candidate.toString();
  }

  get current(): bigint {
    return this.#value;
  }

  get isRestored(): boolean {
    return this.#restored;
  }

  // -------------------------------------------------------------------------
  // KMS operations
  // -------------------------------------------------------------------------

  async #kmsEncrypt(value: bigint): Promise<string> {
    const plaintext = this.#encodeCounter(value);
    const plaintextB64 = Buffer.from(plaintext).toString("base64");

    const body = JSON.stringify({
      KeyId: this.#opts.kmsKeyId,
      Plaintext: plaintextB64,
      EncryptionAlgorithm: "SYMMETRIC_DEFAULT",
    });

    const response = await this.#kmsCall("Encrypt", body);

    if (typeof response["CiphertextBlob"] !== "string") {
      throw new KmsCounterError(
        `KmsCounter: KMS Encrypt response missing CiphertextBlob: ${JSON.stringify(response)}`
      );
    }

    return response["CiphertextBlob"] as string;
  }

  async #kmsDecrypt(ciphertextB64: string): Promise<Uint8Array> {
    const body = JSON.stringify({
      CiphertextBlob: ciphertextB64,
      EncryptionAlgorithm: "SYMMETRIC_DEFAULT",
    });

    const response = await this.#kmsCall("Decrypt", body);

    if (typeof response["Plaintext"] !== "string") {
      throw new KmsCounterError(
        `KmsCounter: KMS Decrypt response missing Plaintext: ${JSON.stringify(response)}`
      );
    }

    return Buffer.from(response["Plaintext"] as string, "base64");
  }

  // -------------------------------------------------------------------------
  // HTTP transport
  // -------------------------------------------------------------------------

  async #kmsCall(action: string, body: string): Promise<Record<string, unknown>> {
    const endpoint = this.#opts.kmsEndpoint
      ?? `https://kms.${this.#opts.kmsRegion}.amazonaws.com`;

    const url = new URL(`/`, endpoint);
    const isHttp = url.protocol === "http:";
    const host = url.hostname;
    const port = url.port
      ? parseInt(url.port, 10)
      : (isHttp ? 80 : 443);

    const amzTarget = `TrentService.${action}`;
    const now = new Date();
    const amzDate = this.#toAmzDate(now);
    const dateStamp = amzDate.slice(0, 8);

    const headers: Record<string, string> = {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": amzTarget,
      "X-Amz-Date": amzDate,
      "Host": host,
      "Content-Length": Buffer.byteLength(body, "utf8").toString(),
    };

    const { credentials } = this.#opts;
    if (credentials?.sessionToken) {
      headers["X-Amz-Security-Token"] = credentials.sessionToken;
    }

    if (credentials) {
      const authHeader = this.#sigV4Sign({
        method: "POST",
        path: "/",
        query: "",
        headers,
        body,
        region: this.#opts.kmsRegion,
        service: "kms",
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        amzDate,
        dateStamp,
      });
      headers["Authorization"] = authHeader;
    }

    const responseBody = await this.#httpRequest({
      hostname: host,
      port,
      path: "/",
      method: "POST",
      headers,
      isHttp,
    }, body);

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(responseBody) as Record<string, unknown>;
    } catch {
      throw new KmsCounterError(
        `KmsCounter: KMS ${action} returned non-JSON response: ${responseBody.slice(0, 200)}`
      );
    }

    if (parsed["__type"]) {
      throw new KmsCounterError(
        `KmsCounter: KMS ${action} error: ${parsed["__type"] as string} — ${parsed["Message"] as string ?? "(no message)"}`
      );
    }

    return parsed;
  }

  #httpRequest(opts: RequestOptions & { isHttp: boolean }, body: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const req = opts.isHttp
        ? httpRequest(opts, (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (chunk: Buffer) => chunks.push(chunk));
            res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
            res.on("error", reject);
          })
        : httpsRequest(opts, (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (chunk: Buffer) => chunks.push(chunk));
            res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
            res.on("error", reject);
          });

      req.on("error", reject);
      req.setTimeout(15_000, () => {
        req.destroy(new KmsCounterError(`KmsCounter: KMS request timed out after 15s`));
      });
      req.write(body, "utf8");
      req.end();
    });
  }

  // -------------------------------------------------------------------------
  // AWS Signature Version 4
  // -------------------------------------------------------------------------

  #sigV4Sign(params: {
    method: string;
    path: string;
    query: string;
    headers: Record<string, string>;
    body: string;
    region: string;
    service: string;
    accessKeyId: string;
    secretAccessKey: string;
    amzDate: string;
    dateStamp: string;
  }): string {
    const {
      method, path, query, headers, body,
      region, service, accessKeyId, secretAccessKey,
      amzDate, dateStamp,
    } = params;

    const signedHeaders = ["content-type", "host", "x-amz-date", "x-amz-target"];
    if (headers["X-Amz-Security-Token"]) {
      signedHeaders.push("x-amz-security-token");
      signedHeaders.sort();
    }

    const canonicalHeaders = signedHeaders
      .map((h) => `${h}:${(headers[this.#headerKey(h, headers)] ?? "").trim()}\n`)
      .join("");

    const signedHeadersStr = signedHeaders.join(";");
    const payloadHash = this.#sha256Hex(Buffer.from(body, "utf8"));

    const canonicalRequest = [
      method, path, query, canonicalHeaders, signedHeadersStr, payloadHash,
    ].join("\n");

    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256", amzDate, credentialScope,
      this.#sha256Hex(Buffer.from(canonicalRequest, "utf8")),
    ].join("\n");

    const signingKey = this.#getSigningKey(secretAccessKey, dateStamp, region, service);
    const signature = this.#hmacHex(signingKey, stringToSign);

    return (
      `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeadersStr}, Signature=${signature}`
    );
  }

  #headerKey(lower: string, headers: Record<string, string>): string {
    for (const k of Object.keys(headers)) {
      if (k.toLowerCase() === lower) return k;
    }
    return lower;
  }

  #getSigningKey(secretKey: string, dateStamp: string, region: string, service: string): Buffer {
    const kDate    = this.#hmacBuf(Buffer.from(`AWS4${secretKey}`, "utf8"), dateStamp);
    const kRegion  = this.#hmacBuf(kDate, region);
    const kService = this.#hmacBuf(kRegion, service);
    return this.#hmacBuf(kService, "aws4_request");
  }

  #hmacBuf(key: Buffer, data: string): Buffer {
    return createHmac("sha256", key).update(data, "utf8").digest();
  }

  #hmacHex(key: Buffer, data: string): string {
    return createHmac("sha256", key).update(data, "utf8").digest("hex");
  }

  #sha256Hex(data: Buffer): string {
    return createHash("sha256").update(data).digest("hex");
  }

  #toAmzDate(d: Date): string {
    return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  }

  #encodeCounter(value: bigint): Uint8Array {
    const str = value.toString();
    const buf = Buffer.alloc(32, 0x20);
    Buffer.from(str, "ascii").copy(buf, 0);
    return buf;
  }
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class KmsCounterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KmsCounterError";
  }
}
