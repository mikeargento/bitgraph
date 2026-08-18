// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * bitgraph-audit offline attestation validation
 *
 * A self-contained Node port of the website's AWS Nitro attestation
 * validator (website/src/lib/nitro-verify.ts), fully offline:
 *
 *   1. Decode the base64 COSE_Sign1 envelope (minimal CBOR reader).
 *   2. Parse the attestation payload (module_id, timestamp, pcrs,
 *      certificate, cabundle, user_data).
 *   3. Verify the ECDSA P-384 signature over the RFC 9052 Sig_structure
 *      against the leaf certificate's public key (node:crypto webcrypto).
 *   4. Walk the certificate bundle: each certificate signed by its
 *      predecessor, leaf last.
 *   5. Verify the top of the bundle against the trust root. The default
 *      trust root is the bundled AWS Nitro Enclaves Root CA G1 constant
 *      (aws-nitro-root-ca.ts, same string the website embeds); tests and
 *      non-AWS deployments may supply other trust material explicitly.
 *   6. Evaluate every chain certificate's validity window at the
 *      attestation document's OWN timestamp. The website validator does
 *      not perform this check; it is added here because an audit runs
 *      long after the short-lived leaf certificates expire, and the
 *      document's own timestamp is the only offline-evaluable instant.
 *
 * Separately tracked facts, never conflated (G9): declared measurement
 * present; attestation document present; document cryptographically
 * validated; attested PCR0 matches the declared measurement; user_data
 * bound to the signed body. PCR0 and user_data comparisons run only on a
 * VALIDATED document: values parsed from an unvalidated document prove
 * nothing.
 *
 * user_data binding mirrors the website and the enclave exactly: the
 * enclave requests attestation with user_data = SHA-256 of the canonical
 * signed body (the raw bytes whose base64 IS the canonical proof hash),
 * so base64(user_data) must equal the proof hash the audit tool computes
 * itself.
 *
 * No network calls anywhere. Never outputs "hardware verified" from
 * presence alone.
 */

import { webcrypto } from "node:crypto";
import { computeSignedBodyHash } from "@mikeargento/bitgraph-verify";
import { rootCaDerBytes } from "./aws-nitro-root-ca.js";
import type {
  AttestationAnalysis,
  AttestationCheck,
  AuditFinding,
  AuthorityAnalysis,
  IngestResult,
  NitroValidationOptions,
  NitroValidationResult,
  ObservedProof,
  ProofAttestationRecord,
} from "./types.js";

// ---------------------------------------------------------------------------
// Low-level document validation
// ---------------------------------------------------------------------------

/**
 * Validate one base64 COSE_Sign1 attestation document offline. See the
 * module doc for the check sequence. Document checks short-circuit; the
 * PCR0 and user_data comparisons run only when the document validated and
 * the corresponding expectation was supplied.
 */
export async function validateNitroAttestationDocument(
  reportB64: string,
  options?: NitroValidationOptions
): Promise<NitroValidationResult> {
  const checks: AttestationCheck[] = [];
  let pcrs: Record<number, string> = {};
  let pcr0: string | undefined;
  let moduleId: string | undefined;
  let timestamp: number | undefined;
  let certChainLength: number | undefined;
  let userDataB64: string | undefined;

  const failed = (): NitroValidationResult => ({
    documentValid: false,
    checks,
    failure: [...checks].reverse().find((c) => !c.pass)?.detail as string,
    ...(pcr0 !== undefined ? { pcr0 } : {}),
    pcrs,
    ...(moduleId !== undefined ? { moduleId } : {}),
    ...(timestamp !== undefined ? { timestamp } : {}),
    ...(certChainLength !== undefined ? { certChainLength } : {}),
    ...(userDataB64 !== undefined ? { userDataB64 } : {}),
  });

  try {
    // Step 1: decode the CBOR envelope.
    const reportBytes = b64ToBytes(reportB64);
    if (reportBytes === null) {
      checks.push({
        name: "CBOR Decode",
        pass: false,
        detail: "reportB64 is not valid base64",
      });
      return failed();
    }
    const cose = decodeCbor(reportBytes, 0).value;
    if (!Array.isArray(cose) || cose.length < 4) {
      checks.push({ name: "CBOR Decode", pass: false, detail: "Not a valid COSE_Sign1 array" });
      return failed();
    }
    checks.push({ name: "CBOR Decode", pass: true, detail: "COSE_Sign1 envelope parsed" });

    const protectedHeaderBytes = cose[0];
    const payloadBytes = cose[2];
    const signatureBytes = cose[3];
    if (
      !(protectedHeaderBytes instanceof Uint8Array) ||
      !(payloadBytes instanceof Uint8Array) ||
      !(signatureBytes instanceof Uint8Array)
    ) {
      checks.push({
        name: "COSE Structure",
        pass: false,
        detail: "Missing protected/payload/signature",
      });
      return failed();
    }

    // Step 2: parse the attestation payload.
    const attDoc = decodeCbor(payloadBytes, 0).value as Record<string, unknown>;
    if (!attDoc || typeof attDoc !== "object" || Array.isArray(attDoc)) {
      checks.push({
        name: "Payload Decode",
        pass: false,
        detail: "Could not decode attestation payload",
      });
      return failed();
    }

    pcrs = extractPcrs(attDoc);
    pcr0 = pcrs[0];
    moduleId = typeof attDoc["module_id"] === "string" ? (attDoc["module_id"] as string) : undefined;
    timestamp = typeof attDoc["timestamp"] === "number" ? (attDoc["timestamp"] as number) : undefined;
    const ud = attDoc["user_data"];
    userDataB64 =
      ud instanceof Uint8Array && ud.length > 0 ? Buffer.from(ud).toString("base64") : undefined;
    const cabundle = attDoc["cabundle"] as Uint8Array[] | undefined;
    const leafCertBytes = attDoc["certificate"];
    if (!(leafCertBytes instanceof Uint8Array)) {
      checks.push({
        name: "Leaf Certificate",
        pass: false,
        detail: "No leaf certificate in attestation",
      });
      return failed();
    }
    certChainLength = (Array.isArray(cabundle) ? cabundle.length : 0) + 1;

    // Step 3: leaf certificate signature over the Sig_structure.
    const leafCert = parseCertificate(leafCertBytes);
    const sigStructure = encodeSigStructure(protectedHeaderBytes, payloadBytes);
    const sigValid = await verifyP384Raw(signatureBytes, sigStructure, leafCert.publicKey);
    checks.push({
      name: "ECDSA P-384 Signature",
      pass: sigValid,
      detail: sigValid
        ? "Attestation signed by leaf certificate"
        : "Signature verification failed against leaf certificate public key",
    });
    if (!sigValid) return failed();

    // Step 4: walk the certificate chain (bundle root first, leaf last).
    if (!Array.isArray(cabundle) || cabundle.length === 0 || !cabundle.every((c) => c instanceof Uint8Array)) {
      checks.push({ name: "Certificate Chain", pass: false, detail: "Empty cabundle" });
      return failed();
    }
    const chain = [...cabundle, leafCertBytes].map(parseCertificate);
    let chainValid = true;
    let chainFailReason = "";
    for (let i = 1; i < chain.length; i++) {
      const child = chain[i] as ParsedCert;
      const parent = chain[i - 1] as ParsedCert;
      const ok = await verifyP384Raw(child.signature, child.tbsCertificate, parent.publicKey);
      if (!ok) {
        chainValid = false;
        chainFailReason = `Certificate ${i} signature invalid (parent: ${i - 1})`;
        break;
      }
    }
    checks.push({
      name: "Certificate Chain",
      pass: chainValid,
      detail: chainValid ? `${chain.length} certificates, each signed by parent` : chainFailReason,
    });
    if (!chainValid) return failed();

    // Step 5: anchor the top of the bundle to the trust root.
    const usingBundledRoot = options?.trustedRootCaDer === undefined;
    const rootCert = parseCertificate(options?.trustedRootCaDer ?? rootCaDerBytes());
    const topCert = chain[0] as ParsedCert;
    const rootMatch = await verifyP384Raw(topCert.signature, topCert.tbsCertificate, rootCert.publicKey);
    checks.push({
      name: "AWS Nitro Root CA",
      pass: rootMatch,
      detail: rootMatch
        ? usingBundledRoot
          ? "Chain anchored to AWS Nitro Root G1 (CN=aws.nitro-enclaves)"
          : "Chain anchored to the supplied trust root (non-default trust material)"
        : usingBundledRoot
          ? "Top of chain not signed by AWS Nitro Root CA"
          : "Top of chain not signed by the supplied trust root",
    });
    if (!rootMatch) return failed();

    // Step 6: certificate validity windows at the document's own
    // timestamp. This check does not exist in the website validator; see
    // the module doc for why it is added and why the document timestamp
    // is the evaluation instant.
    let windowValid = true;
    let windowDetail = `All ${chain.length} certificate validity windows contain the document timestamp`;
    if (timestamp === undefined) {
      windowValid = false;
      windowDetail =
        "Attestation document carries no timestamp; certificate validity cannot be evaluated offline";
    } else {
      for (let i = 0; i < chain.length; i++) {
        const cert = chain[i] as ParsedCert;
        if (timestamp < cert.notBeforeMs || timestamp > cert.notAfterMs) {
          windowValid = false;
          windowDetail =
            `Certificate ${i} validity window ` +
            `[${new Date(cert.notBeforeMs).toISOString()}, ${new Date(cert.notAfterMs).toISOString()}] ` +
            `does not contain the document timestamp ${new Date(timestamp).toISOString()}`;
          break;
        }
      }
    }
    checks.push({ name: "Certificate Validity Window", pass: windowValid, detail: windowDetail });
    if (!windowValid) return failed();

    // Document validated. Now, and only now, the separate comparisons.
    let pcr0Matches: boolean | undefined;
    if (options?.expectedPcr0 !== undefined) {
      pcr0Matches = pcr0 === options.expectedPcr0;
      checks.push({
        name: "PCR0 Match",
        pass: pcr0Matches,
        detail: pcr0Matches
          ? "PCR0 inside attestation matches declared measurement"
          : `PCR0 mismatch: expected ${options.expectedPcr0.slice(0, 16)}..., got ${(pcr0 ?? "").slice(0, 16)}...`,
      });
    }
    let userDataMatches: boolean | undefined;
    if (options?.expectedUserDataB64 !== undefined) {
      userDataMatches = userDataB64 !== undefined && userDataB64 === options.expectedUserDataB64;
      checks.push({
        name: "Bound to this proof",
        pass: userDataMatches,
        detail: userDataMatches
          ? "Attestation user_data matches this proof's canonical hash"
          : userDataB64 !== undefined
            ? "Attestation user_data does not match this proof"
            : "Attestation carries no user_data to bind",
      });
    }

    return {
      documentValid: true,
      checks,
      ...(pcr0 !== undefined ? { pcr0 } : {}),
      pcrs,
      ...(moduleId !== undefined ? { moduleId } : {}),
      ...(timestamp !== undefined ? { timestamp } : {}),
      certChainLength,
      ...(userDataB64 !== undefined ? { userDataB64 } : {}),
      ...(pcr0Matches !== undefined ? { pcr0Matches } : {}),
      ...(userDataMatches !== undefined ? { userDataMatches } : {}),
    };
  } catch (error) {
    checks.push({
      name: "Verification Error",
      pass: false,
      detail: error instanceof Error ? error.message : String(error),
    });
    return failed();
  }
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

/**
 * Validate the attestation of every observed proof and populate
 * AuthorityGroup.attested on the given authority analysis (the typed
 * Phase 4c extension point). Groups without an attestation document keep
 * attested undefined; a declared measurement is never treated as
 * attested.
 *
 * The trust root defaults to the bundled AWS Nitro root; the override
 * exists for tests and explicitly non-AWS trust material.
 */
export async function validateAttestations(
  ingest: IngestResult,
  authority?: AuthorityAnalysis,
  options?: Pick<NitroValidationOptions, "trustedRootCaDer">
): Promise<AttestationAnalysis> {
  const records: ProofAttestationRecord[] = [];
  const findings: AuditFinding[] = [];
  const counts = {
    proofsWithDeclaredMeasurement: 0,
    proofsWithDocument: 0,
    documentsValidated: 0,
    documentsFailed: 0,
    pcr0Matches: 0,
    pcr0Mismatches: 0,
    userDataBound: 0,
    userDataUnbound: 0,
  };

  for (const proof of ingest.proofs) {
    const declaredMeasurement =
      proof.measurement !== undefined && proof.measurement.length > 0
        ? proof.measurement
        : undefined;
    if (declaredMeasurement !== undefined) counts.proofsWithDeclaredMeasurement++;

    const attestation = readAttestation(proof);
    const record: ProofAttestationRecord = {
      proofHash: proof.proofHash,
      declaredMeasurementPresent: declaredMeasurement !== undefined,
      ...(declaredMeasurement !== undefined ? { declaredMeasurement } : {}),
      documentPresent: attestation !== undefined,
      ...(attestation?.format !== undefined ? { attestationFormat: attestation.format } : {}),
      documentValidated: false,
      checks: [],
    };

    if (attestation !== undefined) {
      counts.proofsWithDocument++;
      const result = await validateNitroAttestationDocument(attestation.reportB64, {
        ...(declaredMeasurement !== undefined ? { expectedPcr0: declaredMeasurement } : {}),
        // ⚠️ The FULL canonical signed body, never proof.proofHash.
        //
        // BitGraph has three distinct proof hashes and this check needs the
        // one the enclave actually put in user_data: SHA-256 over the whole
        // signed body, which carries `actor` and `policy` when present.
        // proof.proofHash is the frozen ledger-identity SUBSET, which
        // deliberately excludes both. The two are identical for every proof
        // that carries neither — every ordinary recording — so substituting
        // one for the other passed every test and every real bundle until the
        // first DECLARED recording existed, then reported it as belonging to
        // "some other proof": a valid proof turned FALSE (found 2026-08-18 on
        // ledger position #12,010, the first declaration ever made).
        expectedUserDataB64: computeSignedBodyHash(proof.proof as unknown as Record<string, unknown>),
        ...(options?.trustedRootCaDer !== undefined
          ? { trustedRootCaDer: options.trustedRootCaDer }
          : {}),
      });

      record.documentValidated = result.documentValid;
      record.checks = result.checks;
      if (result.pcr0 !== undefined) record.attestedPcr0 = result.pcr0;
      record.pcrs = result.pcrs;
      if (result.moduleId !== undefined) record.moduleId = result.moduleId;
      if (result.timestamp !== undefined) record.timestamp = result.timestamp;
      if (result.certChainLength !== undefined) record.certChainLength = result.certChainLength;
      if (result.userDataB64 !== undefined) record.userDataB64 = result.userDataB64;

      if (!result.documentValid) {
        counts.documentsFailed++;
        if (result.failure !== undefined) record.validationFailure = result.failure;
        findings.push({
          code: "attestation-invalid",
          ...pathOf(proof),
          message: `attestation document failed offline validation: ${result.failure ?? "unknown"}. Presence of a document is reported separately and proves nothing by itself.`,
          details: { proofHash: proof.proofHash },
        });
      } else {
        counts.documentsValidated++;
        if (result.pcr0Matches !== undefined) {
          record.pcr0MatchesDeclared = result.pcr0Matches;
          if (result.pcr0Matches) counts.pcr0Matches++;
          else {
            counts.pcr0Mismatches++;
            findings.push({
              code: "attestation-measurement-mismatch",
              ...pathOf(proof),
              message:
                "the validated attestation document's PCR0 does not equal the proof's declared " +
                "environment.measurement. Declared and attested measurements are reported " +
                "separately and disagree here.",
              details: {
                proofHash: proof.proofHash,
                declared: declaredMeasurement as string,
                ...(result.pcr0 !== undefined ? { attested: result.pcr0 } : {}),
              },
            });
          }
        }
        if (result.userDataMatches !== undefined) {
          record.userDataBoundToProof = result.userDataMatches;
          if (result.userDataMatches) counts.userDataBound++;
          else {
            counts.userDataUnbound++;
            findings.push({
              code: "attestation-user-data-mismatch",
              ...pathOf(proof),
              message:
                "the validated attestation document's user_data is not bound to this proof's " +
                "canonical hash. A genuine attestation lifted from another proof would look " +
                "exactly like this.",
              details: {
                proofHash: proof.proofHash,
                ...(result.userDataB64 !== undefined ? { userDataB64: result.userDataB64 } : {}),
              },
            });
          }
        }
      }
    }

    records.push(record);
  }

  if (authority !== undefined) populateAuthorityGroups(authority, records);

  return { records, findings, counts };
}

function populateAuthorityGroups(
  authority: AuthorityAnalysis,
  records: ProofAttestationRecord[]
): void {
  const byHash = new Map<string, ProofAttestationRecord>(records.map((r) => [r.proofHash, r]));
  for (const group of authority.groups) {
    if (!group.attestationPresent) continue;
    const memberRecords = group.proofHashes
      .map((h) => byHash.get(h))
      .filter((r): r is ProofAttestationRecord => r !== undefined && r.documentPresent);
    if (memberRecords.length === 0) continue;

    const validated = memberRecords.filter((r) => r.documentValidated);
    const failedCount = memberRecords.length - validated.length;
    const attestedValues = [...new Set(validated.map((r) => r.attestedPcr0).filter((v): v is string => v !== undefined))].sort();

    const attestedMeasurement = attestedValues.length === 1 ? attestedValues[0] : undefined;
    group.attested = {
      status: failedCount === 0 && validated.length > 0 ? "validated" : "validation-failed",
      ...(attestedMeasurement !== undefined ? { attestedMeasurement } : {}),
      ...(attestedMeasurement !== undefined && group.measurement !== undefined
        ? { matchesDeclared: attestedMeasurement === group.measurement }
        : {}),
      validatedProofCount: validated.length,
      failedProofCount: failedCount,
      ...(attestedValues.length > 1 ? { attestedMeasurements: attestedValues } : {}),
    };
  }
}

function readAttestation(
  proof: ObservedProof
): { reportB64: string; format?: string } | undefined {
  const environment = (proof.proof as unknown as Record<string, unknown>)["environment"];
  if (environment === null || typeof environment !== "object" || Array.isArray(environment)) {
    return undefined;
  }
  const attestation = (environment as Record<string, unknown>)["attestation"];
  if (attestation === null || typeof attestation !== "object" || Array.isArray(attestation)) {
    return undefined;
  }
  const reportB64 = (attestation as Record<string, unknown>)["reportB64"];
  if (typeof reportB64 !== "string" || reportB64.length === 0) return undefined;
  const format = (attestation as Record<string, unknown>)["format"];
  return { reportB64, ...(typeof format === "string" ? { format } : {}) };
}

function pathOf(proof: ObservedProof): { path?: string } {
  const path = proof.sources[0]?.path;
  return path !== undefined ? { path } : {};
}

// ---------------------------------------------------------------------------
// Base64 (mirrors the website's atob-based decoder: base64url tolerated,
// padding restored, anything else rejected via the round-trip property)
// ---------------------------------------------------------------------------

function b64ToBytes(b64: string): Uint8Array | null {
  let s = b64.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4 !== 0) s += "=";
  const decoded = Buffer.from(s, "base64");
  if (decoded.toString("base64") !== s) return null;
  return new Uint8Array(decoded);
}

// ---------------------------------------------------------------------------
// CBOR encoder subset (Sig_structure only), ported from the website
// ---------------------------------------------------------------------------

function encodeCborInt(n: number): Uint8Array {
  if (n < 24) return new Uint8Array([n]);
  if (n < 256) return new Uint8Array([0x18, n]);
  if (n < 65536) return new Uint8Array([0x19, n >> 8, n & 0xff]);
  return new Uint8Array([0x1a, (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

function encodeCborBytes(bytes: Uint8Array): Uint8Array {
  const lenPrefix = encodeCborInt(bytes.length);
  lenPrefix[0] = ((lenPrefix[0] as number) & 0x1f) | 0x40;
  const out = new Uint8Array(lenPrefix.length + bytes.length);
  out.set(lenPrefix, 0);
  out.set(bytes, lenPrefix.length);
  return out;
}

function encodeCborText(s: string): Uint8Array {
  const utf8 = new TextEncoder().encode(s);
  const lenPrefix = encodeCborInt(utf8.length);
  lenPrefix[0] = ((lenPrefix[0] as number) & 0x1f) | 0x60;
  const out = new Uint8Array(lenPrefix.length + utf8.length);
  out.set(lenPrefix, 0);
  out.set(utf8, lenPrefix.length);
  return out;
}

function encodeCborArray(items: Uint8Array[]): Uint8Array {
  const lenPrefix = encodeCborInt(items.length);
  lenPrefix[0] = ((lenPrefix[0] as number) & 0x1f) | 0x80;
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
 * COSE_Sign1 Sig_structure per RFC 9052 section 4.4:
 * ["Signature1", body_protected, external_aad (empty), payload].
 */
function encodeSigStructure(protectedHeader: Uint8Array, payload: Uint8Array): Uint8Array {
  return encodeCborArray([
    encodeCborText("Signature1"),
    encodeCborBytes(protectedHeader),
    encodeCborBytes(new Uint8Array(0)),
    encodeCborBytes(payload),
  ]);
}

// ---------------------------------------------------------------------------
// CBOR decoder subset, ported from the website with explicit bounds checks
// (the website indexes past the end silently; here truncation throws a
// precise error and the document fails closed)
// ---------------------------------------------------------------------------

function decodeCbor(data: Uint8Array, offset = 0): { value: unknown; offset: number } {
  const first = data[offset];
  if (first === undefined) throw new Error("CBOR: unexpected end of input");
  const major = first >> 5;
  const info = first & 0x1f;
  offset++;

  const byteAt = (position: number): number => {
    const value = data[position];
    if (value === undefined) throw new Error("CBOR: unexpected end of input");
    return value;
  };

  function readLength(): number {
    if (info < 24) return info;
    if (info === 24) {
      const v = byteAt(offset);
      offset += 1;
      return v;
    }
    if (info === 25) {
      const v = (byteAt(offset) << 8) | byteAt(offset + 1);
      offset += 2;
      return v;
    }
    if (info === 26) {
      const v =
        ((byteAt(offset) << 24) |
          (byteAt(offset + 1) << 16) |
          (byteAt(offset + 2) << 8) |
          byteAt(offset + 3)) >>>
        0;
      offset += 4;
      return v;
    }
    if (info === 27) {
      let v = 0;
      for (let i = 0; i < 8; i++) v = v * 256 + byteAt(offset + i);
      offset += 8;
      return v;
    }
    throw new Error(`Unsupported CBOR length info: ${info}`);
  }

  switch (major) {
    case 0:
      return { value: readLength(), offset };
    case 1:
      return { value: -1 - readLength(), offset };
    case 2: {
      const len = readLength();
      if (offset + len > data.length) throw new Error("CBOR: byte string is truncated");
      return { value: data.slice(offset, offset + len), offset: offset + len };
    }
    case 3: {
      const len = readLength();
      if (offset + len > data.length) throw new Error("CBOR: text string is truncated");
      const v = new TextDecoder().decode(data.slice(offset, offset + len));
      return { value: v, offset: offset + len };
    }
    case 4: {
      if (info === 31) {
        const arr: unknown[] = [];
        while (byteAt(offset) !== 0xff) {
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
        while (byteAt(offset) !== 0xff) {
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
      // Tag: read the tag number, then the tagged value.
      readLength();
      return decodeCbor(data, offset);
    }
    case 7: {
      if (info === 20) return { value: false, offset };
      if (info === 21) return { value: true, offset };
      if (info === 22) return { value: null, offset };
      if (info === 23) return { value: undefined, offset };
      throw new Error(`Unsupported CBOR simple value: ${info}`);
    }
    default:
      throw new Error(`Unsupported CBOR major type: ${major}`);
  }
}

// ---------------------------------------------------------------------------
// Minimal X.509 DER parser, ported from the website, extended with the
// validity window (the only addition)
// ---------------------------------------------------------------------------

interface ParsedCert {
  /** The full TBSCertificate TLV bytes (what the signature covers). */
  tbsCertificate: Uint8Array;
  /** Raw r||s (96 bytes for P-384). */
  signature: Uint8Array;
  /** Uncompressed EC point: 0x04 || x || y. */
  publicKey: Uint8Array;
  notBeforeMs: number;
  notAfterMs: number;
}

function parseCertificate(der: Uint8Array): ParsedCert {
  const r = readSequence(der, 0);
  let off = r.contentStart;

  // TBSCertificate (SEQUENCE)
  const tbsHeader = readTLV(der, off);
  const tbsCertificate = der.slice(off, tbsHeader.end);
  off = tbsHeader.end;

  // signatureAlgorithm (SEQUENCE): skipped, as in the website port.
  const sigAlg = readTLV(der, off);
  off = sigAlg.end;

  // signatureValue (BIT STRING): first content byte is the unused-bit
  // count (0 for signatures), the rest is a DER ECDSA-Sig-Value.
  const sigBitString = readTLV(der, off);
  const sigContent = der.slice(sigBitString.contentStart + 1, sigBitString.end);
  const signature = derEcdsaSigToRaw(sigContent, 48);

  const { publicKey, notBeforeMs, notAfterMs } = walkTbs(tbsCertificate);
  return { tbsCertificate, signature, publicKey, notBeforeMs, notAfterMs };
}

interface TLV {
  tag: number;
  contentStart: number;
  contentEnd: number;
  end: number;
}

function readTLV(data: Uint8Array, offset: number): TLV {
  const tag = data[offset];
  if (tag === undefined) throw new Error("DER: unexpected end of input");
  let off = offset + 1;
  let length = data[off++];
  if (length === undefined) throw new Error("DER: unexpected end of input");
  if (length & 0x80) {
    const numBytes = length & 0x7f;
    length = 0;
    for (let i = 0; i < numBytes; i++) {
      const b = data[off++];
      if (b === undefined) throw new Error("DER: unexpected end of input");
      length = length * 256 + b;
    }
  }
  const end = off + length;
  if (end > data.length) throw new Error("DER: element is truncated");
  return { tag, contentStart: off, contentEnd: end, end };
}

function readSequence(data: Uint8Array, offset: number): TLV {
  const tlv = readTLV(data, offset);
  if (tlv.tag !== 0x30) {
    throw new Error(`Expected SEQUENCE at offset ${offset}, got tag 0x${tlv.tag.toString(16)}`);
  }
  return tlv;
}

/**
 * Walk a TBSCertificate: [0] version (optional), serialNumber, signature
 * AlgorithmIdentifier, issuer, validity, subject, subjectPublicKeyInfo.
 * Returns the SPKI public key point and the validity window.
 */
function walkTbs(tbs: Uint8Array): {
  publicKey: Uint8Array;
  notBeforeMs: number;
  notAfterMs: number;
} {
  const seq = readSequence(tbs, 0);
  let off = seq.contentStart;

  if (tbs[off] === 0xa0) {
    off = readTLV(tbs, off).end; // [0] version
  }
  off = readTLV(tbs, off).end; // serialNumber
  off = readTLV(tbs, off).end; // signature AlgorithmIdentifier
  off = readTLV(tbs, off).end; // issuer

  // validity ::= SEQUENCE { notBefore Time, notAfter Time }
  const validity = readSequence(tbs, off);
  let vOff = validity.contentStart;
  const notBeforeTlv = readTLV(tbs, vOff);
  vOff = notBeforeTlv.end;
  const notAfterTlv = readTLV(tbs, vOff);
  const notBeforeMs = parseDerTime(tbs, notBeforeTlv);
  const notAfterMs = parseDerTime(tbs, notAfterTlv);
  off = validity.end;

  off = readTLV(tbs, off).end; // subject

  // SubjectPublicKeyInfo ::= SEQUENCE { AlgorithmIdentifier, BIT STRING }
  const spki = readSequence(tbs, off);
  let spkiOff = spki.contentStart;
  const algId = readTLV(tbs, spkiOff);
  spkiOff = algId.end;
  const bitString = readTLV(tbs, spkiOff);
  const publicKey = tbs.slice(bitString.contentStart + 1, bitString.end);

  return { publicKey, notBeforeMs, notAfterMs };
}

/** UTCTime (0x17, YYMMDDHHMMSSZ) or GeneralizedTime (0x18, YYYYMMDDHHMMSSZ) to epoch ms. */
function parseDerTime(data: Uint8Array, tlv: TLV): number {
  const text = String.fromCharCode(...data.slice(tlv.contentStart, tlv.contentEnd));
  let year: number;
  let rest: string;
  if (tlv.tag === 0x17) {
    if (!/^\d{12}Z$/.test(text)) throw new Error(`DER: malformed UTCTime "${text}"`);
    const yy = Number.parseInt(text.slice(0, 2), 10);
    year = yy < 50 ? 2000 + yy : 1900 + yy;
    rest = text.slice(2);
  } else if (tlv.tag === 0x18) {
    if (!/^\d{14}Z$/.test(text)) throw new Error(`DER: malformed GeneralizedTime "${text}"`);
    year = Number.parseInt(text.slice(0, 4), 10);
    rest = text.slice(4);
  } else {
    throw new Error(`DER: expected a Time value, got tag 0x${tlv.tag.toString(16)}`);
  }
  const month = Number.parseInt(rest.slice(0, 2), 10);
  const day = Number.parseInt(rest.slice(2, 4), 10);
  const hour = Number.parseInt(rest.slice(4, 6), 10);
  const minute = Number.parseInt(rest.slice(6, 8), 10);
  const second = Number.parseInt(rest.slice(8, 10), 10);
  return Date.UTC(year, month - 1, day, hour, minute, second);
}

/** DER ECDSA-Sig-Value (SEQUENCE { r INTEGER, s INTEGER }) to raw r||s. */
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

  if (r[0] === 0x00 && r.length > coordSize) r = r.slice(1);
  if (s[0] === 0x00 && s.length > coordSize) s = s.slice(1);
  if (r.length > coordSize || s.length > coordSize) {
    throw new Error("ECDSA signature component longer than the curve coordinate size");
  }

  const out = new Uint8Array(coordSize * 2);
  out.set(r, coordSize - r.length);
  out.set(s, coordSize * 2 - s.length);
  return out;
}

// ---------------------------------------------------------------------------
// ECDSA P-384 via node:crypto webcrypto (no dependency). WebCrypto hashes
// the message itself (SHA-384) and does not enforce low-S form, matching
// the website's noble configuration (prehash + lowS: false).
// ---------------------------------------------------------------------------

async function verifyP384Raw(
  rawSig: Uint8Array,
  message: Uint8Array,
  publicKeyPoint: Uint8Array
): Promise<boolean> {
  if (publicKeyPoint.length !== 97 || publicKeyPoint[0] !== 0x04) return false;
  if (rawSig.length !== 96) return false;
  try {
    const key = await webcrypto.subtle.importKey(
      "raw",
      publicKeyPoint as Uint8Array<ArrayBuffer>,
      { name: "ECDSA", namedCurve: "P-384" },
      false,
      ["verify"]
    );
    return await webcrypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-384" },
      key,
      rawSig as Uint8Array<ArrayBuffer>,
      message as Uint8Array<ArrayBuffer>
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// PCR extraction, ported from the website (all-zero PCRs treated as absent)
// ---------------------------------------------------------------------------

function extractPcrs(attDoc: Record<string, unknown>): Record<number, string> {
  const pcrs: Record<number, string> = {};
  const map = attDoc["pcrs"] as Record<string, unknown> | undefined;
  if (!map || typeof map !== "object") return pcrs;
  for (const [idx, val] of Object.entries(map)) {
    if (val instanceof Uint8Array) {
      const hex = Buffer.from(val).toString("hex");
      if (hex.replace(/0/g, "").length > 0) {
        pcrs[Number(idx)] = hex;
      }
    }
  }
  return pcrs;
}
