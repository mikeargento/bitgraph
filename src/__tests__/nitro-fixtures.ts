// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * Synthetic AWS Nitro attestation documents for tests: a P-384 root and leaf
 * of the test's own, CBOR and COSE_Sign1 built by hand. A verifier given the
 * test root (pins.rootDer) accepts them exactly as it accepts AWS's, which is
 * what lets a test reach a TRUE verdict and then show each rule turning it.
 * Copied from audit-attestation.test.ts (2026-10-03), which keeps its own.
 */

import { webcrypto } from "node:crypto";
import { b64, utf8 } from "./audit-fixtures.js";

/** Node's webcrypto key type without relying on DOM lib globals. */
type CryptoKey = Parameters<typeof webcrypto.subtle.exportKey>[1];

export function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function cborHead(major: number, length: number): Uint8Array {
  const m = major << 5;
  if (length < 24) return new Uint8Array([m | length]);
  if (length < 256) return new Uint8Array([m | 24, length]);
  if (length < 65536) return new Uint8Array([m | 25, length >> 8, length & 0xff]);
  if (length < 4294967296) {
    return new Uint8Array([
      m | 26,
      (length >>> 24) & 0xff,
      (length >>> 16) & 0xff,
      (length >>> 8) & 0xff,
      length & 0xff,
    ]);
  }
  const out = new Uint8Array(9);
  out[0] = m | 27;
  let v = BigInt(length);
  for (let i = 8; i >= 1; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

function cborInt(n: number): Uint8Array {
  return n >= 0 ? cborHead(0, n) : cborHead(1, -1 - n);
}

function cborBytes(bytes: Uint8Array): Uint8Array {
  return concat([cborHead(2, bytes.length), bytes]);
}

function cborText(s: string): Uint8Array {
  const body = utf8(s);
  return concat([cborHead(3, body.length), body]);
}

function cborArray(items: Uint8Array[]): Uint8Array {
  return concat([cborHead(4, items.length), ...items]);
}

function cborMap(entries: Array<[Uint8Array, Uint8Array]>): Uint8Array {
  return concat([cborHead(5, entries.length), ...entries.flat()]);
}

// ---------------------------------------------------------------------------
// Minimal DER builders (test side only)
// ---------------------------------------------------------------------------

function derLen(n: number): Uint8Array {
  if (n < 128) return new Uint8Array([n]);
  const bytes: number[] = [];
  let v = n;
  while (v > 0) {
    bytes.unshift(v & 0xff);
    v = Math.floor(v / 256);
  }
  return new Uint8Array([0x80 | bytes.length, ...bytes]);
}

function der(tag: number, content: Uint8Array): Uint8Array {
  return concat([new Uint8Array([tag]), derLen(content.length), content]);
}

function derSeq(...parts: Uint8Array[]): Uint8Array {
  return der(0x30, concat(parts));
}

const OID_ECDSA_SHA384 = der(0x06, new Uint8Array([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x03]));
const OID_EC_PUBLIC_KEY = der(0x06, new Uint8Array([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01]));
const OID_SECP384R1 = der(0x06, new Uint8Array([0x2b, 0x81, 0x04, 0x00, 0x22]));

function derUtcTime(text: string): Uint8Array {
  return der(0x17, utf8(text));
}

function derBitString(content: Uint8Array): Uint8Array {
  return der(0x03, concat([new Uint8Array([0x00]), content]));
}

function derIntFromBytes(bytes: Uint8Array): Uint8Array {
  let body = bytes;
  let start = 0;
  while (start < body.length - 1 && body[start] === 0x00) start++;
  body = body.subarray(start);
  if ((body[0] as number) & 0x80) body = concat([new Uint8Array([0x00]), body]);
  return der(0x02, body);
}

function rawSigToDer(raw: Uint8Array): Uint8Array {
  return derSeq(derIntFromBytes(raw.subarray(0, 48)), derIntFromBytes(raw.subarray(48, 96)));
}

// ---------------------------------------------------------------------------
// Synthetic P-384 chain and attestation documents
// ---------------------------------------------------------------------------

export interface TestKeyPair {
  privateKey: CryptoKey;
  publicRaw: Uint8Array;
}

export async function makeP384(): Promise<TestKeyPair> {
  const kp = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-384" }, true, [
    "sign",
    "verify",
  ]);
  const publicRaw = new Uint8Array(await webcrypto.subtle.exportKey("raw", kp.publicKey));
  return { privateKey: kp.privateKey, publicRaw };
}

export async function signP384(priv: CryptoKey, message: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(
    await webcrypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-384" },
      priv,
      message as Uint8Array<ArrayBuffer>
    )
  );
}

export async function makeCert(
  subjectPublicRaw: Uint8Array,
  signerPrivate: CryptoKey,
  notBefore = "200101000000Z",
  notAfter = "490101000000Z"
): Promise<Uint8Array> {
  const spki = derSeq(derSeq(OID_EC_PUBLIC_KEY, OID_SECP384R1), derBitString(subjectPublicRaw));
  const tbs = derSeq(
    der(0x02, new Uint8Array([0x01])), // serialNumber
    derSeq(OID_ECDSA_SHA384), // signature algorithm
    derSeq(), // issuer (empty)
    derSeq(derUtcTime(notBefore), derUtcTime(notAfter)), // validity
    derSeq(), // subject (empty)
    spki
  );
  const sig = await signP384(signerPrivate, tbs);
  return derSeq(tbs, derSeq(OID_ECDSA_SHA384), derBitString(rawSigToDer(sig)));
}

export const PCR0_BYTES = new Uint8Array(48).fill(0xab);
export const PCR0_HEX = "ab".repeat(48);
const DOC_TIMESTAMP = Date.UTC(2026, 0, 1);

export async function makeDocB64(opts: {
  leafPrivate: CryptoKey;
  leafCert: Uint8Array;
  cabundle: Uint8Array[];
  userData?: Uint8Array;
  timestamp?: number;
  pcr0?: Uint8Array;
}): Promise<string> {
  const entries: Array<[Uint8Array, Uint8Array]> = [
    [cborText("module_id"), cborText("i-0123456789abcdef0-enc0123456789abcdef")],
    [cborText("digest"), cborText("SHA384")],
    [cborText("timestamp"), cborInt(opts.timestamp ?? DOC_TIMESTAMP)],
    [
      cborText("pcrs"),
      cborMap([
        [cborInt(0), cborBytes(opts.pcr0 ?? PCR0_BYTES)],
        [cborInt(1), cborBytes(new Uint8Array(48))], // all-zero PCR, filtered out
      ]),
    ],
    [cborText("certificate"), cborBytes(opts.leafCert)],
    [cborText("cabundle"), cborArray(opts.cabundle.map(cborBytes))],
    ...(opts.userData !== undefined
      ? ([[cborText("user_data"), cborBytes(opts.userData)]] as Array<[Uint8Array, Uint8Array]>)
      : []),
  ];
  const payload = cborMap(entries);
  const protectedHeader = cborMap([[cborInt(1), cborInt(-35)]]); // alg: ES384
  const sigStructure = cborArray([
    cborText("Signature1"),
    cborBytes(protectedHeader),
    cborBytes(new Uint8Array(0)),
    cborBytes(payload),
  ]);
  const signature = await signP384(opts.leafPrivate, sigStructure);
  const cose = cborArray([
    cborBytes(protectedHeader),
    cborMap([]),
    cborBytes(payload),
    cborBytes(signature),
  ]);
  return b64(cose);
}

