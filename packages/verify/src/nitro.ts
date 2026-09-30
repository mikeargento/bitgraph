// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * AWS Nitro attestation: decode, verify, and lay out as evidence.
 *
 * An attestation document is a COSE_Sign1 (RFC 9052) over a CBOR map that
 * AWS's Nitro Security Module signs with a certificate chain reaching the AWS
 * Nitro Enclaves Root CA G1. This module does, offline and with no dependency
 * beyond @noble:
 *
 *   1. decode the envelope and the map (PCRs, user_data, timestamp, certs);
 *   2. verify the ES384 signature over the Sig_structure with the leaf's key;
 *   3. walk the chain: each certificate signed by the one above it, the top
 *      by the embedded AWS root (SHA-256 641A0321…79BB5B);
 *   4. evaluate every certificate's validity at the DOCUMENT'S OWN instant
 *      (they live about three hours, so "now" is the wrong clock);
 *   5. compare PCR0 to the proof's measurement and user_data to the proof's
 *      signed-body hash, each stated separately.
 *
 * And it writes the WITNESS a bitgraph-carrier/2 block carries: the same
 * facts as files a reader can check with openssl alone, no CBOR knowledge
 * needed (see attestationWitness).
 *
 * The same procedure runs in bitgraph-audit (attestation.ts) and on the site;
 * this copy is the one the carrier verifier and the SDK use.
 */

import { p384 } from "@noble/curves/nist.js";
import { sha256, sha384 } from "@noble/hashes/sha2.js";

/* ── The trust root ─────────────────────────────────────────────────────── */

/**
 * AWS Nitro Enclaves Root CA G1 (CN=aws.nitro-enclaves, O=Amazon), valid
 * 2019-10-28 to 2049-10-28. Published by AWS at
 * https://aws-nitro-enclaves.amazonaws.com/AWS_NitroEnclaves_Root-G1.zip
 */
export const AWS_NITRO_ROOT_CA_PEM = `-----BEGIN CERTIFICATE-----
MIICETCCAZagAwIBAgIRAPkxdWgbkK/hHUbMtOTn+FYwCgYIKoZIzj0EAwMwSTEL
MAkGA1UEBhMCVVMxDzANBgNVBAoMBkFtYXpvbjEMMAoGA1UECwwDQVdTMRswGQYD
VQQDDBJhd3Mubml0cm8tZW5jbGF2ZXMwHhcNMTkxMDI4MTMyODA1WhcNNDkxMDI4
MTQyODA1WjBJMQswCQYDVQQGEwJVUzEPMA0GA1UECgwGQW1hem9uMQwwCgYDVQQL
DANBV1MxGzAZBgNVBAMMEmF3cy5uaXRyby1lbmNsYXZlczB2MBAGByqGSM49AgEG
BSuBBAAiA2IABPwCVOumCMHzaHDimtqQvkY4MpJzbolL//Zy2YlES1BR5TSksfbb
48C8WBoyt7F2Bw7eEtaaP+ohG2bnUs990d0JX28TcPQXCEPZ3BABIeTPYwEoCWZE
h8l5YoQwTcU/9KNCMEAwDwYDVR0TAQH/BAUwAwEB/zAdBgNVHQ4EFgQUkCW1DdkF
R+eWw5b6cp3PmanfS5YwDgYDVR0PAQH/BAQDAgGGMAoGCCqGSM49BAMDA2kAMGYC
MQCjfy+Rocm9Xue4YnwWmNJVA44fA0P5W2OpYow9OYCVRaEevL8uO1XYru5xtMPW
rfMCMQCi85sWBbJwKKXdS6BptQFuZbT73o/gBh1qUxl/nNr12UO8Yfwr6wPLb+6N
IwLz3/Y=
-----END CERTIFICATE-----`;

export function awsNitroRootDer(): Uint8Array {
  return pemToDer(AWS_NITRO_ROOT_CA_PEM);
}

/** SHA-256 of the root's DER, uppercase hex, computed from the embedded certificate (never typed in). */
export function awsNitroRootSha256(): string {
  return bytesToHex(sha256(awsNitroRootDer())).toUpperCase();
}

/* ── Decoding ───────────────────────────────────────────────────────────── */

export interface NitroDocument {
  moduleId: string | null;
  /** The document's own signed clock, milliseconds since the epoch. */
  timestampMs: number | null;
  /** Every PCR as hex, index 0 to 15, including the zero ones. */
  pcrs: Record<number, string>;
  userData: Uint8Array | null;
  nonce: Uint8Array | null;
  publicKey: Uint8Array | null;
  /** The leaf certificate, DER. */
  certificate: Uint8Array;
  /** The chain above the leaf as the document lists it: [root, intermediates...], DER. */
  cabundle: Uint8Array[];
}

export interface NitroDecoded {
  protectedHeader: Uint8Array;
  payload: Uint8Array;
  /** Raw r||s, 96 bytes. */
  signature: Uint8Array;
  /** The bytes the signature covers (RFC 9052 §4.4). */
  sigStructure: Uint8Array;
  doc: NitroDocument;
}

/** Decode a base64 attestation document. Throws on anything that is not a COSE_Sign1 over a Nitro map. */
export function decodeNitroAttestation(reportB64: string): NitroDecoded {
  const cose = decodeCbor(b64ToBytes(reportB64), 0).value;
  if (!Array.isArray(cose) || cose.length < 4) throw new Error("not a COSE_Sign1 array");
  const protectedHeader = cose[0], payload = cose[2], signature = cose[3];
  if (!(protectedHeader instanceof Uint8Array) || !(payload instanceof Uint8Array) || !(signature instanceof Uint8Array)) {
    throw new Error("COSE_Sign1 is missing protected header, payload or signature");
  }
  const m = decodeCbor(payload, 0).value;
  if (!m || typeof m !== "object" || Array.isArray(m)) throw new Error("the attestation payload is not a map");
  const map = m as Record<string, unknown>;
  const pcrs: Record<number, string> = {};
  const pm = map.pcrs as Record<string, unknown> | undefined;
  if (pm) for (const [k, v] of Object.entries(pm)) if (v instanceof Uint8Array) pcrs[Number(k)] = bytesToHex(v);
  const certificate = map.certificate;
  if (!(certificate instanceof Uint8Array)) throw new Error("the attestation carries no leaf certificate");
  const cab = Array.isArray(map.cabundle) ? (map.cabundle as unknown[]).filter((c): c is Uint8Array => c instanceof Uint8Array) : [];
  const bytesOrNull = (v: unknown): Uint8Array | null => (v instanceof Uint8Array && v.length > 0 ? v : null);
  return {
    protectedHeader,
    payload,
    signature,
    sigStructure: encodeSigStructure(protectedHeader, payload),
    doc: {
      moduleId: typeof map.module_id === "string" ? map.module_id : null,
      timestampMs: typeof map.timestamp === "number" && Number.isFinite(map.timestamp) ? map.timestamp : null,
      pcrs,
      userData: bytesOrNull(map.user_data),
      nonce: bytesOrNull(map.nonce),
      publicKey: bytesOrNull(map.public_key),
      certificate,
      cabundle: cab,
    },
  };
}

/* ── Verification ───────────────────────────────────────────────────────── */

export interface NitroCheck {
  name: string;
  pass: boolean;
  detail: string;
}

export interface NitroVerifyOptions {
  /** The proof's environment.measurement; when given, PCR0 must equal it. */
  expectedPcr0?: string;
  /** The SHA-256 of the proof's canonical signed body, base64; when given, user_data must equal it. */
  expectedUserDataB64?: string;
  /** Another trust root, DER, for a verifier that pins its own. Default: the embedded AWS root. */
  rootDer?: Uint8Array;
}

export interface NitroVerifyResult {
  valid: boolean;
  checks: NitroCheck[];
  doc: NitroDocument | null;
  /** SHA-256 of the root the chain was checked against, uppercase hex. */
  rootSha256: string;
}

/**
 * Every check, in order, each stated as a verdict. The document's own
 * timestamp is the instant the certificates are evaluated at.
 */
export function verifyNitroAttestation(reportB64: string, opts: NitroVerifyOptions = {}): NitroVerifyResult {
  const checks: NitroCheck[] = [];
  const rootDer = opts.rootDer ?? awsNitroRootDer();
  const rootSha256 = bytesToHex(sha256(rootDer)).toUpperCase();
  const usingAws = opts.rootDer === undefined;
  let decoded: NitroDecoded;
  try {
    decoded = decodeNitroAttestation(reportB64);
  } catch (e) {
    checks.push({ name: "Attestation document", pass: false, detail: e instanceof Error ? e.message : String(e) });
    return { valid: false, checks, doc: null, rootSha256 };
  }
  const { doc } = decoded;
  checks.push({ name: "Attestation document", pass: true, detail: "COSE_Sign1 over a Nitro attestation map" });
  const done = (valid: boolean): NitroVerifyResult => ({ valid, checks, doc, rootSha256 });

  // 1. The signature, with the leaf's key.
  let leaf: ParsedCert;
  try {
    leaf = parseCertificate(doc.certificate);
  } catch (e) {
    checks.push({ name: "AWS signature", pass: false, detail: `leaf certificate: ${e instanceof Error ? e.message : String(e)}` });
    return done(false);
  }
  const sigOk = verifyP384(decoded.signature, sha384(decoded.sigStructure), leaf.publicKey);
  checks.push({
    name: sigOk ? "AWS signature verified" : "AWS signature",
    pass: sigOk,
    detail: sigOk ? "The document's ES384 signature checks against its leaf certificate" : "The signature does not verify against the leaf certificate's key",
  });
  if (!sigOk) return done(false);

  // 2. The chain: [root, intermediates..., leaf], each signed by the one before.
  let chain: ParsedCert[];
  try {
    chain = [...doc.cabundle, doc.certificate].map(parseCertificate);
  } catch (e) {
    checks.push({ name: "Certificate chain", pass: false, detail: e instanceof Error ? e.message : String(e) });
    return done(false);
  }
  if (doc.cabundle.length === 0) {
    checks.push({ name: "Certificate chain", pass: false, detail: "the document carries no CA bundle" });
    return done(false);
  }
  for (let i = 1; i < chain.length; i++) {
    const child = chain[i]!, parent = chain[i - 1]!;
    if (!verifyP384(child.signature, sha384(child.tbsCertificate), parent.publicKey)) {
      checks.push({ name: "Certificate chain", pass: false, detail: `certificate ${i} is not signed by certificate ${i - 1}` });
      return done(false);
    }
  }
  checks.push({ name: "Certificate chain", pass: true, detail: "Each certificate is signed by the one above it" });

  // 3. The top of the chain is signed by the root the verifier trusts.
  const root = parseCertificate(rootDer);
  const top = chain[0]!;
  const rootOk = verifyP384(top.signature, sha384(top.tbsCertificate), root.publicKey);
  checks.push({
    name: rootOk ? `Chains to ${usingAws ? "AWS Nitro root" : "the supplied root"} (${rootSha256.slice(0, 8)}…)` : "Trust root",
    pass: rootOk,
    detail: rootOk
      ? `The top of the chain is signed by ${usingAws ? "AWS Nitro Root G1 (CN=aws.nitro-enclaves)" : "the supplied root"}, SHA-256 ${rootSha256}`
      : "The top of the chain is not signed by the trusted root",
  });
  if (!rootOk) return done(false);

  // 4. Validity at the document's own instant.
  if (doc.timestampMs === null) {
    checks.push({ name: "Certificate validity", pass: false, detail: "the document carries no timestamp, so validity cannot be evaluated offline" });
    return done(false);
  }
  for (let i = 0; i < chain.length; i++) {
    const c = chain[i]!;
    if (doc.timestampMs < c.notBeforeMs || doc.timestampMs > c.notAfterMs) {
      checks.push({
        name: "Certificate validity",
        pass: false,
        detail: `certificate ${i} is valid ${new Date(c.notBeforeMs).toISOString()} to ${new Date(c.notAfterMs).toISOString()}, which does not contain the document's ${new Date(doc.timestampMs).toISOString()}`,
      });
      return done(false);
    }
  }
  checks.push({ name: "Certificate validity", pass: true, detail: `Every certificate was valid at the document's own instant, ${new Date(doc.timestampMs).toISOString()}` });

  // 5. The comparisons, only now.
  let valid = true;
  if (opts.expectedPcr0 !== undefined) {
    const ok = (doc.pcrs[0] ?? "") === opts.expectedPcr0.toLowerCase();
    valid &&= ok;
    checks.push({ name: "PCR0", pass: ok, detail: ok ? "PCR0 inside the document equals the proof's measurement" : `PCR0 ${(doc.pcrs[0] ?? "").slice(0, 16)}… is not the proof's measurement ${opts.expectedPcr0.slice(0, 16)}…` });
  }
  if (opts.expectedUserDataB64 !== undefined) {
    const ud = doc.userData ? bytesToB64(doc.userData) : null;
    const ok = ud !== null && ud === opts.expectedUserDataB64;
    valid &&= ok;
    checks.push({
      name: "Bound to this proof",
      pass: ok,
      detail: ok ? "user_data equals the SHA-256 of this proof's signed body, recomputed here" : ud === null ? "the document carries no user_data" : "user_data is not this proof's signed-body hash",
    });
  }
  return done(valid);
}

/* ── The witness: the same facts as openssl-checkable files ─────────────── */

export const ATTESTATION_WITNESS_FORMAT = "aws-nitro-witness/1";

export interface AttestationWitness {
  format: typeof ATTESTATION_WITNESS_FORMAT;
  /** The bytes the ES384 signature covers (RFC 9052 Sig_structure), base64. */
  sigStructureB64: string;
  /** The signature as COSE carries it, r||s, hex. */
  signatureRawHex: string;
  /** The same signature DER-encoded, hex, for openssl. */
  signatureDerHex: string;
  /** Leaf first, then each certificate above it, up to (not including) the root. PEM. */
  chainPem: string[];
  /** The AWS Nitro Enclaves Root CA G1, PEM, and its DER SHA-256. */
  rootPem: string;
  rootSha256: string;
  /** The instant to evaluate the certificates at: the document's own timestamp. */
  atTime: string;
  atTimeUnix: number;
  /** What the signed map says, decoded. */
  decoded: {
    moduleId: string | null;
    timestampMs: number | null;
    /** CBOR encoding of the timestamp inside the signed bytes (0x1b + 8 bytes), hex, for the presence check. */
    timestampCborHex: string | null;
    pcr0: string | null;
    pcr1: string | null;
    pcr2: string | null;
    pcr3: string | null;
    pcr4: string | null;
    userDataHex: string | null;
    userDataB64: string | null;
  };
  /** What the proof says each value must equal. */
  expected: {
    pcr0: string;
    /** SHA-256 of the proof's canonical signed body, base64: what user_data must equal. */
    signedBodyHashB64: string;
    /** The ledger's proofHash, when it is the same value (a proof with no actor and no policy). */
    proofHashB64?: string;
  };
  /** The check, as shell steps with their expected output. */
  procedure: string[];
}

/**
 * Lay the attestation out as evidence. `expected.signedBodyHashB64` is the
 * SHA-256 of the proof's canonical signed body (computeSignedBodyHash), the
 * value user_data must equal; `expected.pcr0` is the proof's measurement.
 */
export function attestationWitness(reportB64: string, expected: { pcr0: string; signedBodyHashB64: string; proofHashB64?: string }): AttestationWitness {
  const d = decodeNitroAttestation(reportB64);
  const { doc } = d;
  // cabundle is [root, intermediate..., ...]: the chain above the leaf, top first. Drop the root (it is the pin).
  const aboveLeaf = doc.cabundle.slice(1).reverse();
  const chainPem = [derToPem(doc.certificate), ...aboveLeaf.map(derToPem)];
  const rootSha = awsNitroRootSha256();
  const ts = doc.timestampMs;
  const tsCbor = ts === null ? null : "1b" + ts.toString(16).padStart(16, "0");
  const ud = doc.userData;
  const p = (i: number) => doc.pcrs[i] ?? null;
  const atTimeUnix = ts === null ? 0 : Math.floor(ts / 1000);
  const procedure = [
    "# Write these files from this witness: root.pem (rootPem), leaf.pem (chainPem[0]), chain.pem (chainPem[1..] concatenated),",
    "# sig.der (signatureDerHex, hex to bytes), sigstructure.bin (sigStructureB64, base64 to bytes).",
    `openssl x509 -in root.pem -outform DER | openssl dgst -sha256            # ${rootSha.toLowerCase()} : the AWS Nitro Enclaves Root CA G1`,
    `openssl verify -attime ${atTimeUnix} -CAfile root.pem -untrusted chain.pem leaf.pem   # leaf.pem: OK (evaluated at the document's own instant; the certificates live about three hours)`,
    "openssl x509 -in leaf.pem -pubkey -noout > leaf.pub",
    "openssl dgst -sha384 -verify leaf.pub -signature sig.der sigstructure.bin   # Verified OK : AWS's hardware signed exactly these bytes",
    `xxd -p sigstructure.bin | tr -d '\\n' | grep -c ${p(0) ?? "<pcr0>"}   # 1 : PCR0 is inside the signed bytes`,
    `xxd -p sigstructure.bin | tr -d '\\n' | grep -c ${ud ? bytesToHex(ud) : "<user_data>"}   # 1 : user_data is inside the signed bytes`,
    `xxd -p sigstructure.bin | tr -d '\\n' | grep -c ${tsCbor ?? "<timestamp>"}   # 1 : the timestamp is inside the signed bytes`,
    `# decoded.pcr0 must equal expected.pcr0 (the proof's environment.measurement): ${expected.pcr0}`,
    `# decoded.userDataB64 must equal expected.signedBodyHashB64 (SHA-256 of the proof's canonical signed body): ${expected.signedBodyHashB64}`,
    "# The timestamp must fall after the floor block's time and before the Base block's time; both are read from headers in this file.",
    "# Full decode, if cbor2 is available: python3 -c \"import cbor2,base64,json,sys; s=cbor2.loads(base64.b64decode(open('sigstructure.b64').read())); d=cbor2.loads(s[3]); print(d['module_id'], d['timestamp'], d['pcrs'][0].hex(), d['user_data'].hex())\"",
  ];
  return {
    format: ATTESTATION_WITNESS_FORMAT,
    sigStructureB64: bytesToB64(d.sigStructure),
    signatureRawHex: bytesToHex(d.signature),
    signatureDerHex: bytesToHex(rawEcdsaSigToDer(d.signature)),
    chainPem,
    rootPem: AWS_NITRO_ROOT_CA_PEM,
    rootSha256: rootSha,
    atTime: ts === null ? "" : new Date(ts).toISOString(),
    atTimeUnix,
    decoded: {
      moduleId: doc.moduleId,
      timestampMs: ts,
      timestampCborHex: tsCbor,
      pcr0: p(0), pcr1: p(1), pcr2: p(2), pcr3: p(3), pcr4: p(4),
      userDataHex: ud ? bytesToHex(ud) : null,
      userDataB64: ud ? bytesToB64(ud) : null,
    },
    expected: { pcr0: expected.pcr0, signedBodyHashB64: expected.signedBodyHashB64, ...(expected.proofHashB64 !== undefined ? { proofHashB64: expected.proofHashB64 } : {}) },
    procedure,
  };
}

/**
 * Check a witness against the attestation it claims to lay out: every derived
 * field must be what this module derives from reportB64 itself. A witness is
 * convenience for a reader with openssl; it is never trusted over the document.
 */
export function witnessMatchesAttestation(w: AttestationWitness, reportB64: string): { ok: boolean; detail: string } {
  let fresh: AttestationWitness;
  try {
    fresh = attestationWitness(reportB64, w.expected);
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
  const same = w.format === fresh.format && w.sigStructureB64 === fresh.sigStructureB64 && w.signatureRawHex === fresh.signatureRawHex
    && w.signatureDerHex === fresh.signatureDerHex && w.rootSha256 === fresh.rootSha256 && w.atTimeUnix === fresh.atTimeUnix
    && JSON.stringify(w.chainPem) === JSON.stringify(fresh.chainPem) && JSON.stringify(w.decoded) === JSON.stringify(fresh.decoded);
  return same ? { ok: true, detail: "the witness is exactly what the attestation document decodes to" } : { ok: false, detail: "the witness does not match the attestation document it claims to lay out" };
}

/* ── CBOR (the subset COSE and the attestation map need) ────────────────── */

function encodeCborHead(major: number, n: number): Uint8Array {
  const m = major << 5;
  if (n < 24) return Uint8Array.of(m | n);
  if (n < 256) return Uint8Array.of(m | 24, n);
  if (n < 65536) return Uint8Array.of(m | 25, n >> 8, n & 0xff);
  return Uint8Array.of(m | 26, (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
}
function cat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
/** RFC 9052 §4.4: ["Signature1", protected, external_aad = h'', payload]. */
export function encodeSigStructure(protectedHeader: Uint8Array, payload: Uint8Array): Uint8Array {
  const text = new TextEncoder().encode("Signature1");
  return cat(
    encodeCborHead(4, 4),
    encodeCborHead(3, text.length), text,
    encodeCborHead(2, protectedHeader.length), protectedHeader,
    encodeCborHead(2, 0),
    encodeCborHead(2, payload.length), payload,
  );
}

function decodeCbor(data: Uint8Array, offset: number): { value: unknown; offset: number } {
  if (offset >= data.length) throw new Error("CBOR: unexpected end");
  const major = data[offset]! >> 5;
  const info = data[offset]! & 0x1f;
  offset++;
  const readLength = (): number => {
    if (info < 24) return info;
    if (info === 24) return data[offset++]!;
    if (info === 25) { const v = (data[offset]! << 8) | data[offset + 1]!; offset += 2; return v; }
    if (info === 26) { const v = ((data[offset]! << 24) | (data[offset + 1]! << 16) | (data[offset + 2]! << 8) | data[offset + 3]!) >>> 0; offset += 4; return v; }
    if (info === 27) { let v = 0; for (let i = 0; i < 8; i++) v = v * 256 + data[offset + i]!; offset += 8; return v; }
    throw new Error(`CBOR: unsupported length ${info}`);
  };
  switch (major) {
    case 0: return { value: readLength(), offset };
    case 1: return { value: -1 - readLength(), offset };
    case 2: { const n = readLength(); return { value: data.slice(offset, offset + n), offset: offset + n }; }
    case 3: { const n = readLength(); return { value: new TextDecoder().decode(data.slice(offset, offset + n)), offset: offset + n }; }
    case 4: {
      const arr: unknown[] = [];
      if (info === 31) { while (data[offset] !== 0xff) { const it = decodeCbor(data, offset); arr.push(it.value); offset = it.offset; } return { value: arr, offset: offset + 1 }; }
      const n = readLength();
      for (let i = 0; i < n; i++) { const it = decodeCbor(data, offset); arr.push(it.value); offset = it.offset; }
      return { value: arr, offset };
    }
    case 5: {
      const map: Record<string, unknown> = {};
      const one = () => { const k = decodeCbor(data, offset); offset = k.offset; const v = decodeCbor(data, offset); offset = v.offset; map[String(k.value)] = v.value; };
      if (info === 31) { while (data[offset] !== 0xff) one(); return { value: map, offset: offset + 1 }; }
      const n = readLength();
      for (let i = 0; i < n; i++) one();
      return { value: map, offset };
    }
    case 6: { readLength(); return decodeCbor(data, offset); }
    case 7: {
      if (info === 20) return { value: false, offset };
      if (info === 21) return { value: true, offset };
      if (info === 22) return { value: null, offset };
      if (info === 23) return { value: undefined, offset };
      throw new Error(`CBOR: unsupported simple value ${info}`);
    }
  }
  throw new Error(`CBOR: unsupported major type ${major}`);
}

/* ── X.509 (the minimum: TBS bytes, signature, key, validity) ───────────── */

interface ParsedCert {
  tbsCertificate: Uint8Array;
  /** Raw r||s, 96 bytes. */
  signature: Uint8Array;
  /** Uncompressed point 0x04 || x || y. */
  publicKey: Uint8Array;
  notBeforeMs: number;
  notAfterMs: number;
}
interface TLV { tag: number; contentStart: number; end: number }

function readTLV(data: Uint8Array, offset: number): TLV {
  const tag = data[offset];
  if (tag === undefined) throw new Error("DER: unexpected end of input");
  let off = offset + 1;
  let length = data[off++];
  if (length === undefined) throw new Error("DER: unexpected end of input");
  if (length & 0x80) {
    const n = length & 0x7f;
    length = 0;
    for (let i = 0; i < n; i++) {
      const b = data[off++];
      if (b === undefined) throw new Error("DER: unexpected end of input");
      length = length * 256 + b;
    }
  }
  const end = off + length;
  if (end > data.length) throw new Error("DER: element is truncated");
  return { tag, contentStart: off, end };
}
function readSequence(data: Uint8Array, offset: number): TLV {
  const t = readTLV(data, offset);
  if (t.tag !== 0x30) throw new Error(`DER: expected SEQUENCE at ${offset}, got 0x${t.tag.toString(16)}`);
  return t;
}
function parseDerTime(data: Uint8Array, t: TLV): number {
  const text = String.fromCharCode(...data.slice(t.contentStart, t.end));
  let year: number, rest: string;
  if (t.tag === 0x17) {
    if (!/^\d{12}Z$/.test(text)) throw new Error(`DER: malformed UTCTime "${text}"`);
    const yy = Number.parseInt(text.slice(0, 2), 10);
    year = yy < 50 ? 2000 + yy : 1900 + yy;
    rest = text.slice(2);
  } else if (t.tag === 0x18) {
    if (!/^\d{14}Z$/.test(text)) throw new Error(`DER: malformed GeneralizedTime "${text}"`);
    year = Number.parseInt(text.slice(0, 4), 10);
    rest = text.slice(4);
  } else throw new Error(`DER: expected a Time, got 0x${t.tag.toString(16)}`);
  const n = (a: number, b: number) => Number.parseInt(rest.slice(a, b), 10);
  return Date.UTC(year, n(0, 2) - 1, n(2, 4), n(4, 6), n(6, 8), n(8, 10));
}
function parseCertificate(der: Uint8Array): ParsedCert {
  const outer = readSequence(der, 0);
  let off = outer.contentStart;
  const tbs = readTLV(der, off);
  const tbsCertificate = der.slice(off, tbs.end);
  off = readTLV(der, tbs.end).end; // signatureAlgorithm
  const sigBits = readTLV(der, off);
  const signature = derEcdsaSigToRaw(der.slice(sigBits.contentStart + 1, sigBits.end), 48);
  // TBSCertificate: [0] version?, serialNumber, signature, issuer, validity, subject, subjectPublicKeyInfo
  const seq = readSequence(tbsCertificate, 0);
  let o = seq.contentStart;
  if (tbsCertificate[o] === 0xa0) o = readTLV(tbsCertificate, o).end;
  o = readTLV(tbsCertificate, o).end;
  o = readTLV(tbsCertificate, o).end;
  o = readTLV(tbsCertificate, o).end;
  const validity = readSequence(tbsCertificate, o);
  const nb = readTLV(tbsCertificate, validity.contentStart);
  const na = readTLV(tbsCertificate, nb.end);
  o = readTLV(tbsCertificate, validity.end).end; // subject
  const spki = readSequence(tbsCertificate, o);
  const alg = readTLV(tbsCertificate, spki.contentStart);
  const bits = readTLV(tbsCertificate, alg.end);
  return {
    tbsCertificate,
    signature,
    publicKey: tbsCertificate.slice(bits.contentStart + 1, bits.end),
    notBeforeMs: parseDerTime(tbsCertificate, nb),
    notAfterMs: parseDerTime(tbsCertificate, na),
  };
}
function derEcdsaSigToRaw(der: Uint8Array, size: number): Uint8Array {
  const seq = readSequence(der, 0);
  const rT = readTLV(der, seq.contentStart);
  const sT = readTLV(der, rT.end);
  if (rT.tag !== 0x02 || sT.tag !== 0x02) throw new Error("DER: ECDSA signature integers expected");
  const trim = (b: Uint8Array) => { while (b.length > size && b[0] === 0) b = b.slice(1); return b; };
  const r = trim(der.slice(rT.contentStart, rT.end)), s = trim(der.slice(sT.contentStart, sT.end));
  const out = new Uint8Array(size * 2);
  out.set(r, size - r.length);
  out.set(s, 2 * size - s.length);
  return out;
}
/** r||s → DER SEQUENCE { INTEGER r, INTEGER s }, the form openssl reads. */
export function rawEcdsaSigToDer(raw: Uint8Array): Uint8Array {
  const half = raw.length / 2;
  const int = (b: Uint8Array): Uint8Array => {
    let i = 0;
    while (i < b.length - 1 && b[i] === 0) i++;
    let v: Uint8Array = b.slice(i);
    if (v[0]! & 0x80) v = cat(Uint8Array.of(0), v);
    return cat(Uint8Array.of(0x02, v.length), v);
  };
  const body = cat(int(raw.slice(0, half)), int(raw.slice(half)));
  const head = body.length < 128 ? Uint8Array.of(0x30, body.length) : Uint8Array.of(0x30, 0x81, body.length);
  return cat(head, body);
}
function verifyP384(rawSig: Uint8Array, msgHash: Uint8Array, publicKey: Uint8Array): boolean {
  try {
    return p384.verify(rawSig, msgHash, publicKey, { prehash: false, lowS: false });
  } catch {
    return false;
  }
}

/* ── Bytes, base64, PEM ─────────────────────────────────────────────────── */

export function bytesToHex(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i]!.toString(16).padStart(2, "0");
  return s;
}
function b64ToBytes(b64: string): Uint8Array {
  let s = b64.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4 !== 0) s += "=";
  if (typeof atob === "function") {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  const buf = Buffer.from(s, "base64");
  const out = new Uint8Array(buf.length);
  out.set(buf);
  return out;
}
function bytesToB64(b: Uint8Array): string {
  if (typeof btoa === "function") {
    let s = "";
    for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]!);
    return btoa(s);
  }
  return Buffer.from(b).toString("base64");
}
export function derToPem(der: Uint8Array): string {
  const b64 = bytesToB64(der);
  const lines = b64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN CERTIFICATE-----\n${lines.join("\n")}\n-----END CERTIFICATE-----`;
}
export function pemToDer(pem: string): Uint8Array {
  return b64ToBytes(pem.replace(/-----BEGIN CERTIFICATE-----/, "").replace(/-----END CERTIFICATE-----/, "").replace(/\s+/g, ""));
}
