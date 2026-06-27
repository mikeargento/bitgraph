/**
 * AWS Nitro Enclave attestation verification — pure browser TypeScript.
 *
 * Verifies a base64-encoded COSE_Sign1 attestation document end-to-end:
 *   1. Decode CBOR (COSE_Sign1 envelope + attestation payload)
 *   2. Reconstruct Sig_structure per RFC 9052 §4.4
 *   3. Verify ECDSA P-384 signature against the leaf certificate's public key
 *   4. Walk the certificate bundle, verifying each cert is signed by the next
 *   5. Verify the topmost cert in the bundle is signed by AWS Nitro root CA
 *   6. Confirm PCR0 inside the attestation matches the expected measurement
 *
 * No network calls. The AWS Nitro root CA is embedded as a constant.
 */

import { p384 } from "@noble/curves/nist.js";
import { sha384 } from "@noble/hashes/sha2.js";
import { rootCaDerBytes } from "./aws-nitro-root-ca";

// ─── Public API ──────────────────────────────────────────────────────────

export interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
}

export interface NitroVerifyResult {
  valid: boolean;
  checks: CheckResult[];
  pcr0?: string;
  pcrs: Record<number, string>;
  moduleId?: string;
  timestamp?: number;
  certChainLength?: number;
  userDataB64?: string;
}

export async function verifyNitroAttestation(
  reportB64: string,
  expectedPcr0: string,
  // The proofHash this attestation must be bound to (its user_data). When
  // provided, the verifier confirms the attestation belongs to THIS proof and
  // wasn't lifted off another genuine BitGraph.
  expectedUserDataB64?: string,
): Promise<NitroVerifyResult> {
  const checks: CheckResult[] = [];
  let pcrs: Record<number, string> = {};
  let pcr0: string | undefined;
  let moduleId: string | undefined;
  let timestamp: number | undefined;
  let certChainLength: number | undefined;
  let userDataB64: string | undefined;

  try {
    // Step 1: decode CBOR envelope
    const reportBytes = b64ToBytes(reportB64);
    const cose = decodeCbor(reportBytes, 0).value;
    if (!Array.isArray(cose) || cose.length < 4) {
      checks.push({ name: "CBOR Decode", pass: false, detail: "Not a valid COSE_Sign1 array" });
      return { valid: false, checks, pcrs };
    }
    checks.push({ name: "CBOR Decode", pass: true, detail: "COSE_Sign1 envelope parsed" });

    const protectedHeaderBytes = cose[0] as Uint8Array;
    const payloadBytes = cose[2] as Uint8Array;
    const signatureBytes = cose[3] as Uint8Array;
    if (!(protectedHeaderBytes instanceof Uint8Array) || !(payloadBytes instanceof Uint8Array) || !(signatureBytes instanceof Uint8Array)) {
      checks.push({ name: "COSE Structure", pass: false, detail: "Missing protected/payload/signature" });
      return { valid: false, checks, pcrs };
    }

    // Step 2: parse the attestation payload
    const attDoc = decodeCbor(payloadBytes, 0).value as Record<string, unknown>;
    if (!attDoc || typeof attDoc !== "object") {
      checks.push({ name: "Payload Decode", pass: false, detail: "Could not decode attestation payload" });
      return { valid: false, checks, pcrs };
    }

    // Extract decoded fields
    pcrs = extractPcrs(attDoc);
    pcr0 = pcrs[0];
    moduleId = typeof attDoc.module_id === "string" ? attDoc.module_id : undefined;
    timestamp = typeof attDoc.timestamp === "number" ? attDoc.timestamp : undefined;
    const ud = attDoc.user_data;
    userDataB64 = ud instanceof Uint8Array && ud.length > 0 ? btoa(String.fromCharCode(...ud)) : undefined;
    const cabundle = attDoc.cabundle as Uint8Array[] | undefined;
    const leafCertBytes = attDoc.certificate as Uint8Array | undefined;
    if (!leafCertBytes || !(leafCertBytes instanceof Uint8Array)) {
      checks.push({ name: "Leaf Certificate", pass: false, detail: "No leaf certificate in attestation" });
      return { valid: false, checks, pcrs, pcr0, moduleId, timestamp };
    }
    certChainLength = (cabundle?.length ?? 0) + 1;

    // Step 3: parse leaf cert and verify COSE signature
    const leafCert = parseCertificate(leafCertBytes);
    const sigStructure = encodeSigStructure(protectedHeaderBytes, payloadBytes);
    const sigStructureHash = sha384(sigStructure);

    // COSE signature is raw r||s (96 bytes for P-384). @noble/curves expects compact form.
    const sigValid = verifyP384(signatureBytes, sigStructureHash, leafCert.publicKey);
    checks.push({
      name: "ECDSA P-384 Signature",
      pass: sigValid,
      detail: sigValid
        ? "Attestation signed by leaf certificate"
        : "Signature verification failed against leaf certificate public key",
    });
    if (!sigValid) return { valid: false, checks, pcrs, pcr0, moduleId, timestamp, certChainLength };

    // Step 4: walk the certificate chain
    // cabundle order: [root, intermediate(s), ...]; leaf is in attDoc.certificate
    // Verify: root → intermediate(s) → leaf
    // Each cert is signed by the previous one's public key.
    // Final check: cabundle[0] (the topmost) must be signed by AWS Nitro root CA.
    if (!cabundle || cabundle.length === 0) {
      checks.push({ name: "Certificate Chain", pass: false, detail: "Empty cabundle" });
      return { valid: false, checks, pcrs, pcr0, moduleId, timestamp, certChainLength };
    }

    // Build chain: bundle (root → intermediates) + leaf
    const chain = [...cabundle, leafCertBytes].map(parseCertificate);

    // Verify each subsequent cert is signed by the previous
    let chainValid = true;
    let chainFailReason = "";
    for (let i = 1; i < chain.length; i++) {
      const child = chain[i];
      const parent = chain[i - 1];
      const childHash = sha384(child.tbsCertificate);
      const ok = verifyP384(child.signature, childHash, parent.publicKey);
      if (!ok) {
        chainValid = false;
        chainFailReason = `Certificate ${i} signature invalid (parent: ${i - 1})`;
        break;
      }
    }

    checks.push({
      name: "Certificate Chain",
      pass: chainValid,
      detail: chainValid
        ? `${chain.length} certificates, each signed by parent`
        : chainFailReason,
    });
    if (!chainValid) return { valid: false, checks, pcrs, pcr0, moduleId, timestamp, certChainLength };

    // Step 5: verify topmost cert (cabundle[0]) is signed by AWS Nitro root CA
    const rootCert = parseCertificate(rootCaDerBytes());
    const topCert = chain[0];
    const topHash = sha384(topCert.tbsCertificate);
    const rootMatch = verifyP384(topCert.signature, topHash, rootCert.publicKey);
    checks.push({
      name: "AWS Nitro Root CA",
      pass: rootMatch,
      detail: rootMatch
        ? "Chain anchored to AWS Nitro Root G1 (CN=aws.nitro-enclaves)"
        : "Top of chain not signed by AWS Nitro Root CA",
    });
    if (!rootMatch) return { valid: false, checks, pcrs, pcr0, moduleId, timestamp, certChainLength };

    // Step 6: confirm PCR0 inside attestation matches displayed measurement
    const pcr0Match = pcr0 === expectedPcr0;
    checks.push({
      name: "PCR0 Match",
      pass: pcr0Match,
      detail: pcr0Match
        ? "PCR0 inside attestation matches displayed measurement"
        : `PCR0 mismatch: expected ${expectedPcr0.slice(0, 16)}..., got ${(pcr0 ?? "").slice(0, 16)}...`,
    });

    // Step 7: confirm the attestation is bound to THIS proof (user_data == proofHash).
    // Without this, a genuine attestation lifted off another BitGraph (same
    // enclave/PCR0) would otherwise pass on a forged proof body.
    if (expectedUserDataB64 !== undefined) {
      const bound = !!userDataB64 && userDataB64 === expectedUserDataB64;
      checks.push({
        name: "Bound to this proof",
        pass: bound,
        detail: bound
          ? "Attestation user_data matches this proof's hash"
          : userDataB64
            ? "Attestation user_data does not match this proof"
            : "Attestation carries no user_data to bind",
      });
    }

    const allPass = checks.every((c) => c.pass);
    return { valid: allPass, checks, pcrs, pcr0, moduleId, timestamp, certChainLength, userDataB64 };
  } catch (e) {
    checks.push({
      name: "Verification Error",
      pass: false,
      detail: e instanceof Error ? e.message : String(e),
    });
    return { valid: false, checks, pcrs, pcr0, moduleId, timestamp, certChainLength };
  }
}

// ─── CBOR encoder (subset for Sig_structure) ─────────────────────────────

function encodeCborInt(n: number): Uint8Array {
  if (n < 24) return new Uint8Array([n]);
  if (n < 256) return new Uint8Array([0x18, n]);
  if (n < 65536) return new Uint8Array([0x19, n >> 8, n & 0xff]);
  // 32-bit
  return new Uint8Array([0x1a, (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

function encodeCborBytes(bytes: Uint8Array): Uint8Array {
  const lenPrefix = encodeCborInt(bytes.length);
  // major type 2 (byte string) — set top 3 bits
  lenPrefix[0] = (lenPrefix[0] & 0x1f) | 0x40;
  const out = new Uint8Array(lenPrefix.length + bytes.length);
  out.set(lenPrefix, 0);
  out.set(bytes, lenPrefix.length);
  return out;
}

function encodeCborText(s: string): Uint8Array {
  const utf8 = new TextEncoder().encode(s);
  const lenPrefix = encodeCborInt(utf8.length);
  lenPrefix[0] = (lenPrefix[0] & 0x1f) | 0x60;
  const out = new Uint8Array(lenPrefix.length + utf8.length);
  out.set(lenPrefix, 0);
  out.set(utf8, lenPrefix.length);
  return out;
}

function encodeCborArray(items: Uint8Array[]): Uint8Array {
  const lenPrefix = encodeCborInt(items.length);
  lenPrefix[0] = (lenPrefix[0] & 0x1f) | 0x80;
  const totalLen = lenPrefix.length + items.reduce((sum, x) => sum + x.length, 0);
  const out = new Uint8Array(totalLen);
  let off = 0;
  out.set(lenPrefix, off);
  off += lenPrefix.length;
  for (const item of items) {
    out.set(item, off);
    off += item.length;
  }
  return out;
}

/**
 * Construct the COSE_Sign1 Sig_structure per RFC 9052 §4.4:
 *   Sig_structure = [
 *     context: "Signature1",
 *     body_protected: bstr,
 *     external_aad: bstr (empty),
 *     payload: bstr
 *   ]
 */
function encodeSigStructure(protectedHeader: Uint8Array, payload: Uint8Array): Uint8Array {
  return encodeCborArray([
    encodeCborText("Signature1"),
    encodeCborBytes(protectedHeader),
    encodeCborBytes(new Uint8Array(0)),
    encodeCborBytes(payload),
  ]);
}

// ─── CBOR decoder (subset needed for COSE + attestation doc) ─────────────

function decodeCbor(data: Uint8Array, offset = 0): { value: unknown; offset: number } {
  const major = data[offset] >> 5;
  const info = data[offset] & 0x1f;
  offset++;

  function readLength(): number {
    if (info < 24) return info;
    if (info === 24) { const v = data[offset]; offset += 1; return v; }
    if (info === 25) { const v = (data[offset] << 8) | data[offset + 1]; offset += 2; return v; }
    if (info === 26) {
      const v = ((data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]) >>> 0;
      offset += 4;
      return v;
    }
    if (info === 27) {
      let v = 0;
      for (let i = 0; i < 8; i++) v = v * 256 + data[offset + i];
      offset += 8;
      return v;
    }
    throw new Error(`Unsupported CBOR length info: ${info}`);
  }

  switch (major) {
    case 0: return { value: readLength(), offset };
    case 1: return { value: -1 - readLength(), offset };
    case 2: {
      const len = readLength();
      const v = data.slice(offset, offset + len);
      return { value: v, offset: offset + len };
    }
    case 3: {
      const len = readLength();
      const v = new TextDecoder().decode(data.slice(offset, offset + len));
      return { value: v, offset: offset + len };
    }
    case 4: {
      if (info === 31) {
        const arr: unknown[] = [];
        while (data[offset] !== 0xff) {
          const item = decodeCbor(data, offset);
          arr.push(item.value);
          offset = item.offset;
        }
        return { value: arr, offset: offset + 1 };
      }
      const len = readLength();
      const arr: unknown[] = [];
      for (let i = 0; i < len; i++) {
        const item = decodeCbor(data, offset);
        arr.push(item.value);
        offset = item.offset;
      }
      return { value: arr, offset };
    }
    case 5: {
      if (info === 31) {
        const map: Record<string, unknown> = {};
        while (data[offset] !== 0xff) {
          const k = decodeCbor(data, offset);
          offset = k.offset;
          const v = decodeCbor(data, offset);
          offset = v.offset;
          map[String(k.value)] = v.value;
        }
        return { value: map, offset: offset + 1 };
      }
      const len = readLength();
      const map: Record<string, unknown> = {};
      for (let i = 0; i < len; i++) {
        const k = decodeCbor(data, offset);
        offset = k.offset;
        const v = decodeCbor(data, offset);
        offset = v.offset;
        map[String(k.value)] = v.value;
      }
      return { value: map, offset };
    }
    case 6: {
      // tag — read length, then read tagged value
      readLength();
      return decodeCbor(data, offset);
    }
    case 7: {
      // simple/float — only handle null/true/false/undefined we encounter
      if (info === 20) return { value: false, offset };
      if (info === 21) return { value: true, offset };
      if (info === 22) return { value: null, offset };
      if (info === 23) return { value: undefined, offset };
      throw new Error(`Unsupported CBOR simple value: ${info}`);
    }
  }
  throw new Error(`Unsupported CBOR major type: ${major}`);
}

// ─── X.509 DER parser (minimal — only what we need) ──────────────────────

interface ParsedCert {
  tbsCertificate: Uint8Array;  // the TBS bytes (what gets signed)
  signature: Uint8Array;        // raw r||s for ECDSA
  publicKey: Uint8Array;        // uncompressed point: 0x04 || x || y
}

/**
 * Parse a DER-encoded X.509 certificate.
 *
 * Structure:
 *   Certificate ::= SEQUENCE {
 *     tbsCertificate       TBSCertificate,
 *     signatureAlgorithm   AlgorithmIdentifier,
 *     signatureValue       BIT STRING
 *   }
 *
 * TBSCertificate contains the SubjectPublicKeyInfo we need.
 * For ECDSA, the BIT STRING signature value is a DER-encoded
 * SEQUENCE { r INTEGER, s INTEGER }.
 */
function parseCertificate(der: Uint8Array): ParsedCert {
  const r = readSequence(der, 0);
  // Inside certificate SEQUENCE: TBS, sigAlg, sigValue
  let off = r.contentStart;

  // TBSCertificate (SEQUENCE)
  const tbsHeader = readTLV(der, off);
  const tbsCertificate = der.slice(off, tbsHeader.end);
  off = tbsHeader.end;

  // signatureAlgorithm (SEQUENCE) — skip
  const sigAlg = readTLV(der, off);
  off = sigAlg.end;

  // signatureValue (BIT STRING)
  const sigBitString = readTLV(der, off);
  // BIT STRING content: first byte is unused-bit count (always 0 for sigs), rest is DER ECDSA-Sig
  const sigContent = der.slice(sigBitString.contentStart + 1, sigBitString.end);
  const signature = derEcdsaSigToRaw(sigContent, 48); // P-384 = 48 bytes per coordinate

  // Now extract public key from TBSCertificate
  const publicKey = extractPublicKeyFromTbs(tbsCertificate);

  return { tbsCertificate, signature, publicKey };
}

interface TLV {
  tag: number;
  contentStart: number;
  contentEnd: number;
  end: number;
}

function readTLV(data: Uint8Array, offset: number): TLV {
  const tag = data[offset];
  let off = offset + 1;
  let length = data[off++];
  if (length & 0x80) {
    const numBytes = length & 0x7f;
    length = 0;
    for (let i = 0; i < numBytes; i++) length = length * 256 + data[off++];
  }
  return { tag, contentStart: off, contentEnd: off + length, end: off + length };
}

function readSequence(data: Uint8Array, offset: number): TLV {
  const tlv = readTLV(data, offset);
  if (tlv.tag !== 0x30) throw new Error(`Expected SEQUENCE at offset ${offset}, got tag 0x${tlv.tag.toString(16)}`);
  return tlv;
}

/**
 * Extract the SubjectPublicKeyInfo BIT STRING from a TBSCertificate.
 *
 * TBSCertificate ::= SEQUENCE {
 *   version         [0] EXPLICIT Version DEFAULT v1,
 *   serialNumber    INTEGER,
 *   signature       AlgorithmIdentifier,
 *   issuer          Name,
 *   validity        Validity,
 *   subject         Name,
 *   subjectPublicKeyInfo SubjectPublicKeyInfo,
 *   ...
 * }
 *
 * We walk to the 7th element (index 6), which is the SPKI.
 */
function extractPublicKeyFromTbs(tbs: Uint8Array): Uint8Array {
  const seq = readSequence(tbs, 0);
  let off = seq.contentStart;

  // Skip optional [0] version tag
  if (tbs[off] === 0xa0) {
    const version = readTLV(tbs, off);
    off = version.end;
  }
  // serialNumber
  off = readTLV(tbs, off).end;
  // signature AlgorithmIdentifier
  off = readTLV(tbs, off).end;
  // issuer
  off = readTLV(tbs, off).end;
  // validity
  off = readTLV(tbs, off).end;
  // subject
  off = readTLV(tbs, off).end;
  // SubjectPublicKeyInfo (SEQUENCE)
  const spki = readSequence(tbs, off);

  // Inside SPKI: AlgorithmIdentifier, BIT STRING (the public key)
  let spkiOff = spki.contentStart;
  const algId = readTLV(tbs, spkiOff);
  spkiOff = algId.end;
  const bitString = readTLV(tbs, spkiOff);
  // BIT STRING content: first byte is unused-bit count (0), rest is the EC point
  // EC point for P-384 uncompressed: 0x04 || x (48 bytes) || y (48 bytes) = 97 bytes
  return tbs.slice(bitString.contentStart + 1, bitString.end);
}

/**
 * Convert DER-encoded ECDSA signature (SEQUENCE { r, s }) to raw r||s bytes.
 * @noble/curves verifyP384 expects compact 96-byte signatures for P-384.
 */
function derEcdsaSigToRaw(der: Uint8Array, coordSize: number): Uint8Array {
  const seq = readSequence(der, 0);
  let off = seq.contentStart;
  const rTlv = readTLV(der, off);
  if (rTlv.tag !== 0x02) throw new Error("Expected INTEGER for r");
  let r = der.slice(rTlv.contentStart, rTlv.end);
  off = rTlv.end;
  const sTlv = readTLV(der, off);
  if (sTlv.tag !== 0x02) throw new Error("Expected INTEGER for s");
  let s = der.slice(sTlv.contentStart, sTlv.end);

  // Strip leading zero (DER INTEGER positive marker)
  if (r[0] === 0x00 && r.length > coordSize) r = r.slice(1);
  if (s[0] === 0x00 && s.length > coordSize) s = s.slice(1);

  // Pad to coordSize bytes if shorter
  const rPadded = new Uint8Array(coordSize);
  rPadded.set(r, coordSize - r.length);
  const sPadded = new Uint8Array(coordSize);
  sPadded.set(s, coordSize - s.length);

  const out = new Uint8Array(coordSize * 2);
  out.set(rPadded, 0);
  out.set(sPadded, coordSize);
  return out;
}

// ─── ECDSA P-384 verification ────────────────────────────────────────────

function verifyP384(rawSig: Uint8Array, msgHash: Uint8Array, publicKey: Uint8Array): boolean {
  try {
    // X.509 / COSE signatures don't enforce low-S form, so disable that check.
    // prehash: false because we already hashed the message ourselves.
    return p384.verify(rawSig, msgHash, publicKey, { prehash: false, lowS: false });
  } catch {
    return false;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function b64ToBytes(b64: string): Uint8Array {
  let s = b64.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4 !== 0) s += "=";
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function extractPcrs(attDoc: Record<string, unknown>): Record<number, string> {
  const pcrs: Record<number, string> = {};
  const map = attDoc.pcrs as Record<string, unknown> | undefined;
  if (!map) return pcrs;
  for (const [idx, val] of Object.entries(map)) {
    if (val instanceof Uint8Array) {
      const hex = bytesToHex(val);
      // Only include non-zero PCRs
      if (hex.replace(/0/g, "").length > 0) {
        pcrs[Number(idx)] = hex;
      }
    }
  }
  return pcrs;
}
