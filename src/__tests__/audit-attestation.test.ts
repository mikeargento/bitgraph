// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * Offline attestation validation tests.
 *
 * Real path: REALISTIC_PROOF carries a TRUNCATED attestation blob; the
 * validator must report document-present but validation-failed (parse
 * error) honestly, never a pass.
 *
 * Synthetic path: a minimal valid COSE_Sign1 with a self-signed P-384
 * certificate chain is built in-test with node:crypto webcrypto and
 * hand-rolled DER/CBOR, exercising signature verification, chain
 * walking, trust-root anchoring, validity windows at the document's own
 * timestamp, PCR0 matching, and user_data binding, pass and fail. The
 * synthetic chain also proves the DEFAULT trust root is the bundled AWS
 * Nitro root: without an explicit override, a synthetic chain fails at
 * the root check.
 */

import { describe, it, before } from "node:test";
import * as assert from "node:assert/strict";
import { webcrypto } from "node:crypto";

/** Node's webcrypto key type without relying on DOM lib globals. */
type CryptoKey = Parameters<typeof webcrypto.subtle.exportKey>[1];
import {
  analyzeAuthorities,
  ingestBundle,
  validateAttestations,
  validateNitroAttestationDocument,
  verifyObservedProofs,
} from "@mikeargento/bitgraph-audit";
import { computeProofHash } from "@mikeargento/bitgraph-verify";
import type { BitGraphProof } from "@mikeargento/bitgraph-verify";
import { REALISTIC_PROOF } from "./realistic-proof-fixture.js";
import {
  b64,
  makeChainIdProof,
  makeKey,
  makeTempDir,
  proofJson,
  signBody,
  utf8,
  writeBundleDir,
} from "./audit-fixtures.js";

// ---------------------------------------------------------------------------
// Minimal CBOR encoder (test side only)
// ---------------------------------------------------------------------------

function concat(parts: Uint8Array[]): Uint8Array {
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

interface TestKeyPair {
  privateKey: CryptoKey;
  publicRaw: Uint8Array;
}

async function makeP384(): Promise<TestKeyPair> {
  const kp = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-384" }, true, [
    "sign",
    "verify",
  ]);
  const publicRaw = new Uint8Array(await webcrypto.subtle.exportKey("raw", kp.publicKey));
  return { privateKey: kp.privateKey, publicRaw };
}

async function signP384(priv: CryptoKey, message: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(
    await webcrypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-384" },
      priv,
      message as Uint8Array<ArrayBuffer>
    )
  );
}

async function makeCert(
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

const PCR0_BYTES = new Uint8Array(48).fill(0xab);
const PCR0_HEX = "ab".repeat(48);
const DOC_TIMESTAMP = Date.UTC(2026, 0, 1);

async function makeDocB64(opts: {
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

// ---------------------------------------------------------------------------
// Shared synthetic fixture
// ---------------------------------------------------------------------------

let root: TestKeyPair;
let leaf: TestKeyPair;
let rootCert: Uint8Array;
let leafCert: Uint8Array;
/** A verifier-valid proof whose attestation binds user_data to its own canonical hash. */
let boundProof: { proof: BitGraphProof; proofHash: string };

before(async () => {
  root = await makeP384();
  leaf = await makeP384();
  rootCert = await makeCert(root.publicRaw, root.privateKey); // self-signed
  leafCert = await makeCert(leaf.publicRaw, root.privateKey);

  const key = await makeKey();
  const bytes = utf8("attested payload");
  const digestB64 = b64(
    new Uint8Array(await webcrypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>))
  );
  const proof = await signBody(
    key,
    { hashAlg: "sha256", digestB64 },
    { nonceB64: b64(crypto.getRandomValues(new Uint8Array(16))) },
    PCR0_HEX,
    { attestation: { format: "aws-nitro", reportB64: "cGxhY2Vob2xkZXI=" } }
  );
  const proofHash = computeProofHash(proof);
  const docB64 = await makeDocB64({
    leafPrivate: leaf.privateKey,
    leafCert,
    cabundle: [rootCert],
    userData: new Uint8Array(Buffer.from(proofHash, "base64")),
  });
  (proof.environment.attestation as { reportB64: string }).reportB64 = docB64;
  assert.equal(
    computeProofHash(proof),
    proofHash,
    "reportB64 lives outside the signed body; swapping it never changes the canonical hash"
  );
  boundProof = { proof, proofHash };
});

// ---------------------------------------------------------------------------
// Real fixture path: truncated blob must fail honestly
// ---------------------------------------------------------------------------

describe("audit attestation: truncated real fixture reports honestly", () => {
  it("REALISTIC_PROOF: document present, validation failed with a parse error, never a pass", async () => {
    const dir = await makeTempDir("bg-audit-att-real-");
    await writeBundleDir(dir, { "proofs/realistic.json": JSON.stringify(REALISTIC_PROOF) });
    const ingest = await ingestBundle(dir);
    await verifyObservedProofs(ingest);

    const analysis = await validateAttestations(ingest);
    assert.equal(analysis.records.length, 1);
    const record = analysis.records[0]!;
    assert.equal(record.declaredMeasurementPresent, true);
    assert.equal(record.documentPresent, true);
    assert.equal(record.attestationFormat, "aws-nitro");
    assert.equal(record.documentValidated, false);
    assert.ok(record.validationFailure !== undefined, "a precise parse failure is reported");
    assert.equal(record.pcr0MatchesDeclared, undefined, "no comparison against an unvalidated document");
    assert.equal(record.userDataBoundToProof, undefined);
    assert.ok(record.checks.every((c) => !(c.name === "PCR0 Match" && c.pass)));
    assert.equal(analysis.counts.documentsFailed, 1);
    assert.equal(analysis.counts.documentsValidated, 0);
    assert.ok(analysis.findings.some((f) => f.code === "attestation-invalid"));
  });
});

// ---------------------------------------------------------------------------
// Synthetic path: low-level validator
// ---------------------------------------------------------------------------

describe("audit attestation: synthetic document, low-level validator", () => {
  it("validates a correct document end-to-end (signature, chain, root, window, PCR0, user_data)", async () => {
    const docB64 = (boundProof.proof.environment.attestation as { reportB64: string }).reportB64;
    const result = await validateNitroAttestationDocument(docB64, {
      expectedPcr0: PCR0_HEX,
      expectedUserDataB64: boundProof.proofHash,
      trustedRootCaDer: rootCert,
    });
    assert.equal(result.documentValid, true, result.failure);
    assert.equal(result.pcr0, PCR0_HEX);
    assert.equal(result.pcrs[1], undefined, "all-zero PCRs are treated as absent");
    assert.equal(result.pcr0Matches, true);
    assert.equal(result.userDataMatches, true);
    assert.equal(result.timestamp, DOC_TIMESTAMP);
    assert.equal(result.certChainLength, 2);
    assert.ok(result.moduleId !== undefined);
    assert.ok(result.checks.every((c) => c.pass));
  });

  it("defaults to the bundled AWS Nitro root: a synthetic chain fails the root check", async () => {
    const docB64 = (boundProof.proof.environment.attestation as { reportB64: string }).reportB64;
    const result = await validateNitroAttestationDocument(docB64, {
      expectedPcr0: PCR0_HEX,
      expectedUserDataB64: boundProof.proofHash,
    });
    assert.equal(result.documentValid, false);
    const rootCheck = result.checks.find((c) => c.name === "AWS Nitro Root CA");
    assert.ok(rootCheck !== undefined && rootCheck.pass === false);
    assert.equal(result.pcr0Matches, undefined, "no comparisons on a failed document");
  });

  it("a corrupted COSE signature fails at the signature step", async () => {
    const docB64 = (boundProof.proof.environment.attestation as { reportB64: string }).reportB64;
    const bytes = Buffer.from(docB64, "base64");
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] as number) ^ 0x01;
    const result = await validateNitroAttestationDocument(bytes.toString("base64"), {
      trustedRootCaDer: rootCert,
    });
    assert.equal(result.documentValid, false);
    const sigCheck = result.checks.find((c) => c.name === "ECDSA P-384 Signature");
    assert.ok(sigCheck !== undefined && sigCheck.pass === false);
  });

  it("a certificate not signed by its parent fails the chain walk", async () => {
    const evil = await makeP384();
    const orphanLeafCert = await makeCert(leaf.publicRaw, evil.privateKey);
    const docB64 = await makeDocB64({
      leafPrivate: leaf.privateKey,
      leafCert: orphanLeafCert,
      cabundle: [rootCert],
    });
    const result = await validateNitroAttestationDocument(docB64, { trustedRootCaDer: rootCert });
    assert.equal(result.documentValid, false);
    const chainCheck = result.checks.find((c) => c.name === "Certificate Chain");
    assert.ok(chainCheck !== undefined && chainCheck.pass === false);
  });

  it("evaluates certificate validity windows at the document's own timestamp", async () => {
    const expiredLeafCert = await makeCert(
      leaf.publicRaw,
      root.privateKey,
      "200101000000Z",
      "210101000000Z"
    );
    const docB64 = await makeDocB64({
      leafPrivate: leaf.privateKey,
      leafCert: expiredLeafCert,
      cabundle: [rootCert],
      timestamp: DOC_TIMESTAMP, // 2026: outside [2020, 2021]
    });
    const result = await validateNitroAttestationDocument(docB64, { trustedRootCaDer: rootCert });
    assert.equal(result.documentValid, false);
    const windowCheck = result.checks.find((c) => c.name === "Certificate Validity Window");
    assert.ok(windowCheck !== undefined && windowCheck.pass === false);
    assert.match(windowCheck.detail, /does not contain the document timestamp/);
  });
});

// ---------------------------------------------------------------------------
// Pipeline: separate facts, findings, authority groups
// ---------------------------------------------------------------------------

describe("audit attestation: pipeline facts stay separate", () => {
  it("pass case populates the per-proof record and AuthorityGroup.attested", async () => {
    const plain = await makeChainIdProof({ counter: "2", epochId: "E-ATT" });
    const dir = await makeTempDir("bg-audit-att-pipe-");
    await writeBundleDir(dir, {
      "proofs/bound.json": proofJson(boundProof.proof),
      "proofs/plain.json": proofJson(plain.proof),
      "proofs/realistic.json": JSON.stringify(REALISTIC_PROOF),
    });
    const ingest = await ingestBundle(dir);
    await verifyObservedProofs(ingest);
    const authority = analyzeAuthorities(ingest);

    const analysis = await validateAttestations(ingest, authority, { trustedRootCaDer: rootCert });

    const bound = analysis.records.find((r) => r.proofHash === boundProof.proofHash)!;
    assert.equal(bound.documentValidated, true, bound.validationFailure);
    assert.equal(bound.attestedPcr0, PCR0_HEX);
    assert.equal(bound.pcr0MatchesDeclared, true);
    assert.equal(bound.userDataBoundToProof, true);

    const plainRecord = analysis.records.find((r) => r.proofHash === computeProofHash(plain.proof))!;
    assert.equal(plainRecord.documentPresent, false);
    assert.equal(plainRecord.documentValidated, false);
    assert.equal(plainRecord.checks.length, 0);

    const boundGroup = authority.groups.find((g) => g.proofHashes.includes(boundProof.proofHash))!;
    assert.ok(boundGroup.attested !== undefined);
    assert.equal(boundGroup.attested.status, "validated");
    assert.equal(boundGroup.attested.attestedMeasurement, PCR0_HEX);
    assert.equal(boundGroup.attested.matchesDeclared, true);
    assert.equal(boundGroup.attested.validatedProofCount, 1);
    assert.equal(boundGroup.attested.failedProofCount, 0);

    const realisticGroup = authority.groups.find((g) =>
      g.proofHashes.includes(computeProofHash(REALISTIC_PROOF))
    )!;
    assert.ok(realisticGroup.attested !== undefined);
    assert.equal(realisticGroup.attested.status, "validation-failed");
    assert.equal(realisticGroup.attested.attestedMeasurement, undefined);

    const plainGroup = authority.groups.find((g) =>
      g.proofHashes.includes(computeProofHash(plain.proof))
    )!;
    assert.equal(plainGroup.attestationPresent, false);
    assert.equal(plainGroup.attested, undefined, "nothing to validate, nothing claimed");

    assert.equal(analysis.counts.documentsValidated, 1);
    assert.equal(analysis.counts.documentsFailed, 1);
    assert.equal(analysis.counts.pcr0Matches, 1);
    assert.equal(analysis.counts.userDataBound, 1);
  });

  it("attested PCR0 disagreeing with the declared measurement is a separate recorded fact", async () => {
    const key = await makeKey();
    const declared = "ff".repeat(48); // declared measurement differs from the attested PCR0
    const proof = await signBody(
      key,
      { hashAlg: "sha256", digestB64: b64(new Uint8Array(32).fill(7)) },
      { nonceB64: b64(crypto.getRandomValues(new Uint8Array(16))) },
      declared,
      { attestation: { format: "aws-nitro", reportB64: "cGxhY2Vob2xkZXI=" } }
    );
    const proofHash = computeProofHash(proof);
    const docB64 = await makeDocB64({
      leafPrivate: leaf.privateKey,
      leafCert,
      cabundle: [rootCert],
      userData: new Uint8Array(Buffer.from(proofHash, "base64")),
    });
    (proof.environment.attestation as { reportB64: string }).reportB64 = docB64;

    const dir = await makeTempDir("bg-audit-att-pcr-");
    await writeBundleDir(dir, { "proofs/p.json": proofJson(proof) });
    const ingest = await ingestBundle(dir);
    await verifyObservedProofs(ingest);
    const authority = analyzeAuthorities(ingest);
    const analysis = await validateAttestations(ingest, authority, { trustedRootCaDer: rootCert });

    const record = analysis.records[0]!;
    assert.equal(record.documentValidated, true, "the document itself is genuine");
    assert.equal(record.pcr0MatchesDeclared, false);
    assert.equal(record.userDataBoundToProof, true);
    assert.ok(analysis.findings.some((f) => f.code === "attestation-measurement-mismatch"));
    const group = authority.groups[0]!;
    assert.equal(group.attested?.status, "validated");
    assert.equal(group.attested?.matchesDeclared, false);
  });

  it("a genuine attestation lifted from another proof fails only the user_data binding", async () => {
    const key = await makeKey();
    const proof = await signBody(
      key,
      { hashAlg: "sha256", digestB64: b64(new Uint8Array(32).fill(9)) },
      { nonceB64: b64(crypto.getRandomValues(new Uint8Array(16))) },
      PCR0_HEX,
      { attestation: { format: "aws-nitro", reportB64: "cGxhY2Vob2xkZXI=" } }
    );
    // The document is valid and attests the right PCR0, but its user_data
    // binds a DIFFERENT proof's hash.
    const docB64 = await makeDocB64({
      leafPrivate: leaf.privateKey,
      leafCert,
      cabundle: [rootCert],
      userData: crypto.getRandomValues(new Uint8Array(32)),
    });
    (proof.environment.attestation as { reportB64: string }).reportB64 = docB64;

    const dir = await makeTempDir("bg-audit-att-lift-");
    await writeBundleDir(dir, { "proofs/p.json": proofJson(proof) });
    const ingest = await ingestBundle(dir);
    await verifyObservedProofs(ingest);
    const analysis = await validateAttestations(ingest, undefined, { trustedRootCaDer: rootCert });

    const record = analysis.records[0]!;
    assert.equal(record.documentValidated, true);
    assert.equal(record.pcr0MatchesDeclared, true);
    assert.equal(record.userDataBoundToProof, false);
    assert.ok(analysis.findings.some((f) => f.code === "attestation-user-data-mismatch"));
    assert.ok(!analysis.findings.some((f) => f.code === "attestation-invalid"));
  });
});
