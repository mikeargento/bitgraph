// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * RFC 3161 Timestamp Authority client.
 *
 * Sends a SHA-256 digest to a TSA and receives a signed TimeStampToken
 * proving the digest existed at a specific time. The token is independently
 * verifiable by any party using the TSA's public certificate.
 *
 * No ASN.1 library required — the TimeStampReq for SHA-256 is a fixed
 * 59-byte DER structure. Response parsing uses minimal tag walking.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TsaResult {
  /** TSA identifier (e.g. "freetsa.org") */
  authority: string;
  /** ISO 8601 UTC timestamp extracted from the token */
  time: string;
  /** Base64-encoded raw TimeStampToken (DER) for independent verification */
  tokenB64: string;
  /** Hash algorithm used */
  digestAlg: "sha256";
  /** Base64 digest that was timestamped (for cross-reference) */
  digestB64: string;
}

// ---------------------------------------------------------------------------
// TSA endpoints (tried in order)
// ---------------------------------------------------------------------------

const TSA_ENDPOINTS = [
  { url: "https://freetsa.org/tsr", authority: "freetsa.org" },
  { url: "http://timestamp.digicert.com", authority: "digicert.com" },
];

const TSA_TIMEOUT_MS = 5_000;

// ---------------------------------------------------------------------------
// DER building — hand-crafted TimeStampReq for SHA-256
// ---------------------------------------------------------------------------

/**
 * SHA-256 AlgorithmIdentifier OID: 2.16.840.1.101.3.4.2.1
 * DER: 06 09 60 86 48 01 65 03 04 02 01 05 00
 */
const SHA256_ALG_ID = new Uint8Array([
  0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01,
  0x05, 0x00,
]);

/**
 * Build a DER-encoded RFC 3161 TimeStampReq.
 *
 * Structure:
 *   SEQUENCE {
 *     version       INTEGER (1)
 *     messageImprint SEQUENCE {
 *       algorithm   AlgorithmIdentifier (SHA-256)
 *       hashedMessage OCTET STRING (32 bytes)
 *     }
 *     certReq       BOOLEAN (TRUE)
 *   }
 */
export function buildTimestampReq(digestBytes: Uint8Array): Uint8Array {
  if (digestBytes.length !== 32) {
    throw new Error(`Expected 32-byte SHA-256 digest, got ${digestBytes.length}`);
  }

  // hashedMessage: OCTET STRING (32 bytes)
  // Tag 04, Length 20 (hex), then 32 bytes
  const hashedMessage = new Uint8Array(2 + 32);
  hashedMessage[0] = 0x04; // OCTET STRING
  hashedMessage[1] = 0x20; // 32 bytes
  hashedMessage.set(digestBytes, 2);

  // messageImprint: SEQUENCE { algorithmIdentifier, hashedMessage }
  const miContent = concat(wrapSequence(SHA256_ALG_ID), hashedMessage);
  const messageImprint = wrapSequence(miContent);

  // version: INTEGER (1)
  const version = new Uint8Array([0x02, 0x01, 0x01]);

  // certReq: BOOLEAN (TRUE)
  const certReq = new Uint8Array([0x01, 0x01, 0xff]);

  // Outer SEQUENCE
  const body = concat(version, messageImprint, certReq);
  return wrapSequence(body);
}

function wrapSequence(content: Uint8Array): Uint8Array {
  return wrapTag(0x30, content);
}

function wrapTag(tag: number, content: Uint8Array): Uint8Array {
  const len = encodeLength(content.length);
  const result = new Uint8Array(1 + len.length + content.length);
  result[0] = tag;
  result.set(len, 1);
  result.set(content, 1 + len.length);
  return result;
}

function encodeLength(len: number): Uint8Array {
  if (len < 0x80) {
    return new Uint8Array([len]);
  }
  if (len < 0x100) {
    return new Uint8Array([0x81, len]);
  }
  return new Uint8Array([0x82, (len >> 8) & 0xff, len & 0xff]);
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

// ---------------------------------------------------------------------------
// DER parsing — minimal ASN.1 walking to extract genTime
// ---------------------------------------------------------------------------

/**
 * Extract the GeneralizedTime from a TimeStampResp.
 *
 * TimeStampResp ::= SEQUENCE {
 *   status  PKIStatusInfo,
 *   timeStampToken  ContentInfo OPTIONAL  -- CMS SignedData
 * }
 *
 * We walk through the ASN.1 structure looking for tag 0x18
 * (GeneralizedTime) which contains the timestamp as a printable string
 * like "20260307153000Z".
 */
export function extractGenTime(respBytes: Uint8Array): string | null {
  // First check status: walk into outer SEQUENCE → first element (PKIStatusInfo)
  // PKIStatusInfo.status is an INTEGER; value 0 = granted, 1 = grantedWithMods
  const status = extractTsaStatus(respBytes);
  if (status === null || status > 1) {
    return null; // Not granted
  }

  // Scan for GeneralizedTime tag (0x18) — it appears exactly once in TSTInfo
  for (let i = 0; i < respBytes.length - 2; i++) {
    if (respBytes[i] === 0x18) {
      // Read length
      const lenInfo = readLength(respBytes, i + 1);
      if (!lenInfo) continue;

      const strBytes = respBytes.slice(lenInfo.offset, lenInfo.offset + lenInfo.length);
      const timeStr = new TextDecoder().decode(strBytes);

      // Validate it looks like a GeneralizedTime (YYYYMMDDHHmmssZ)
      if (/^\d{14}Z$/.test(timeStr)) {
        // Convert "20260307153000Z" → "2026-03-07T15:30:00Z"
        const y = timeStr.slice(0, 4);
        const m = timeStr.slice(4, 6);
        const d = timeStr.slice(6, 8);
        const H = timeStr.slice(8, 10);
        const M = timeStr.slice(10, 12);
        const S = timeStr.slice(12, 14);
        return `${y}-${m}-${d}T${H}:${M}:${S}Z`;
      }

      // Some TSAs include fractional seconds: YYYYMMDDHHmmss.fffZ
      if (/^\d{14}\.\d+Z$/.test(timeStr)) {
        const y = timeStr.slice(0, 4);
        const m = timeStr.slice(4, 6);
        const d = timeStr.slice(6, 8);
        const H = timeStr.slice(8, 10);
        const M = timeStr.slice(10, 12);
        const rest = timeStr.slice(12); // "ss.fffZ"
        return `${y}-${m}-${d}T${H}:${M}:${rest}`;
      }
    }
  }

  return null;
}

/**
 * Extract the status INTEGER from a TimeStampResp.
 * Returns the status value (0 = granted) or null on parse failure.
 */
function extractTsaStatus(respBytes: Uint8Array): number | null {
  // Outer SEQUENCE
  if (respBytes[0] !== 0x30) return null;
  const outer = readLength(respBytes, 1);
  if (!outer) return null;

  // PKIStatusInfo SEQUENCE
  let pos = outer.offset;
  if (respBytes[pos] !== 0x30) return null;
  const statusInfo = readLength(respBytes, pos + 1);
  if (!statusInfo) return null;

  // status INTEGER
  const intPos = statusInfo.offset;
  if (respBytes[intPos] !== 0x02) return null;
  const intLen = readLength(respBytes, intPos + 1);
  if (!intLen) return null;

  // Read integer value (usually 1 byte)
  let value = 0;
  for (let i = 0; i < intLen.length; i++) {
    value = (value << 8) | respBytes[intLen.offset + i]!;
  }
  return value;
}

/**
 * Read a DER length at the given position.
 * Returns { length, offset } where offset is the position after the length bytes.
 */
function readLength(
  data: Uint8Array,
  pos: number
): { length: number; offset: number } | null {
  if (pos >= data.length) return null;

  const first = data[pos]!;
  if (first < 0x80) {
    return { length: first, offset: pos + 1 };
  }

  const numBytes = first & 0x7f;
  if (numBytes === 0 || pos + 1 + numBytes > data.length) return null;

  let length = 0;
  for (let i = 0; i < numBytes; i++) {
    length = (length << 8) | data[pos + 1 + i]!;
  }
  return { length, offset: pos + 1 + numBytes };
}

// ---------------------------------------------------------------------------
// Extract the TimeStampToken from a TimeStampResp
// ---------------------------------------------------------------------------

/**
 * Extract the raw TimeStampToken (ContentInfo) from a TimeStampResp.
 * The token is the second element of the outer SEQUENCE (after PKIStatusInfo).
 */
export function extractToken(respBytes: Uint8Array): Uint8Array | null {
  // Outer SEQUENCE
  if (respBytes[0] !== 0x30) return null;
  const outer = readLength(respBytes, 1);
  if (!outer) return null;

  // Skip PKIStatusInfo SEQUENCE
  let pos = outer.offset;
  if (respBytes[pos] !== 0x30) return null;
  const statusInfo = readLength(respBytes, pos + 1);
  if (!statusInfo) return null;
  pos = statusInfo.offset + statusInfo.length;

  // The rest is the TimeStampToken (ContentInfo SEQUENCE)
  if (pos >= respBytes.length) return null;
  if (respBytes[pos] !== 0x30) return null;

  const tokenLen = readLength(respBytes, pos + 1);
  if (!tokenLen) return null;

  // Return the complete TLV (tag + length + value)
  return respBytes.slice(pos, tokenLen.offset + tokenLen.length);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Request an RFC 3161 timestamp for a SHA-256 digest.
 *
 * Tries TSA endpoints in order. Returns null if all fail (best-effort).
 * The proof is still valid without a TSA token.
 */
export async function requestTimestamp(
  digestB64: string
): Promise<TsaResult | null> {
  const digestBytes = Buffer.from(digestB64, "base64");
  if (digestBytes.length !== 32) {
    console.warn(`[tsa] invalid digest length: ${digestBytes.length}`);
    return null;
  }

  const reqBody = buildTimestampReq(digestBytes);

  for (const { url, authority } of TSA_ENDPOINTS) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TSA_TIMEOUT_MS);

      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/timestamp-query" },
        body: Buffer.from(reqBody),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!resp.ok) {
        console.warn(`[tsa] ${authority} returned ${resp.status}`);
        continue;
      }

      const respBytes = new Uint8Array(await resp.arrayBuffer());

      // Extract timestamp
      const time = extractGenTime(respBytes);
      if (!time) {
        console.warn(`[tsa] ${authority} response: could not extract genTime`);
        continue;
      }

      // Extract the TimeStampToken (without the status wrapper)
      const token = extractToken(respBytes);
      if (!token) {
        console.warn(`[tsa] ${authority} response: could not extract token`);
        continue;
      }

      const tokenB64 = Buffer.from(token).toString("base64");

      console.log(`[tsa] ${authority} timestamped at ${time}`);

      return {
        authority,
        time,
        tokenB64,
        digestAlg: "sha256",
        digestB64,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[tsa] ${authority} failed: ${msg}`);
      continue;
    }
  }

  console.warn("[tsa] all TSA endpoints failed, proceeding without timestamp");
  return null;
}
