// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * The full check of a plain BitGraph proof: the one every BitGraph tool runs (2026-10-18 audit, finding D.1).
 *
 * verify() checks a proof's own consistency: its Ed25519 signature, its slot record, its counts and its structure.
 * The key it checks against is the one the proof carries, so on its own it cannot tell BitGraph's enclave from anyone
 * who made a key and signed a body. What makes a proof BitGraph's is the hardware: the AWS Nitro attestation document
 * the enclave requested over the signed body. verifyAttested() adds exactly that:
 *
 *   1. verify() itself, requiring the atomic form (count N+1 right after the nonce's N) whenever the proof says it
 *      is atomic, and on any proof whose image is v11 or later;
 *   2. the attestation in full (nitro.ts verifyNitroAttestation): its ES384 signature, its certificate chain to the
 *      AWS Nitro root, every certificate valid at the document's own instant, the PCR0 the proof declares, and
 *      user_data equal to SHA-256 of the signed body, so the document is about this proof and no other;
 *   3. the image: the PCR0 inside the hardware-signed document must be one the caller accepts, by default an image
 *      BitGraph published (measurements.ts). A valid attestation from some other enclave is not BitGraph's.
 *
 * Valid means: these bytes (when given) were bound at this position by the published BitGraph enclave image, as the
 * AWS hardware attests. It says nothing about when or how the content was made.
 */

import type { BitGraphProof, VerificationPolicy } from "./types.js";
import { verify, verifyProofIntegrity, createVerificationContext, type VerificationContext } from "./verifier.js";
import { verifyNitroAttestation, type NitroCheck } from "./nitro.js";
import { computeSignedBodyHash } from "./proof-hash.js";
import { PUBLISHED_PCR0S, publishedMeasurement } from "./measurements.js";
import { sha256 } from "@noble/hashes/sha256";
import { checkTreeMember, treeMemberOf, treeRootTextBytes } from "./tree-member.js";

export interface AttestedOptions {
  /** The proof to check. */
  proof: BitGraphProof;
  /** The committed bytes. Omitted: everything but the bytes-versus-digest comparison is checked. */
  bytes?: Uint8Array;
  /** The enclave images accepted, by PCR0 (hex). Default: every image BitGraph has published. */
  pcr0?: readonly string[];
  /** A different root certificate (DER), for testing against a non-AWS chain. Default: the AWS Nitro root. */
  rootDer?: Uint8Array;
  /** Extra policy for verify(). requireAtomic is set here whenever the proof is atomic. */
  trustAnchors?: VerificationPolicy;
  context?: VerificationContext;
}

export interface AttestedResult {
  valid: boolean;
  /** Why it is not valid; absent when valid. */
  reason?: string;
  /** Each attestation check, in order, with its detail. */
  checks: NitroCheck[];
  /** The PCR0 inside the hardware-signed document (lowercase hex), when it could be read. */
  pcr0: string | null;
  /** The published image that PCR0 names, when it is one of BitGraph's. */
  image: { version: string; since: string } | null;
  /** The document's own signed time (ms since the epoch): when the enclave bound this proof. */
  attestedAtMs: number | null;
  /** Whether the bytes were compared with the proof's digest. */
  artifactBinding: "checked" | "not-checked";
  /** When the proof is a tree member's (bitgraph-tree-member/1) and the file was given: which file of how many it is,
   *  its hash checked up the tree to the root the proof binds. */
  treeMember?: { index: number; files: number };
}

/** Images from v11 on make every proof atomic; a proof from one must be in the atomic form. */
const ATOMIC_FROM = new Set(["v11", "v12", "v13"]);

export async function verifyAttested(opts: AttestedOptions): Promise<AttestedResult> {
  const { proof } = opts;
  let bytes = opts.bytes;
  const artifactBinding = bytes !== undefined ? "checked" : "not-checked";
  // A tree member's proof (tree-member.ts): the file's hash must walk up to the root the proof binds, and the proof is
  // then checked against the root's text, the bytes it signs, as any proof is against its file.
  const member = bytes !== undefined ? treeMemberOf(proof) : null;
  let treeMember: AttestedResult["treeMember"];
  const out = (valid: boolean, reason: string | undefined, checks: NitroCheck[], pcr0: string | null, attestedAtMs: number | null): AttestedResult => {
    const pub = pcr0 ? publishedMeasurement(pcr0) : null;
    return { valid, ...(reason !== undefined ? { reason } : {}), checks, pcr0, image: pub ? { version: pub.version, since: pub.since } : null, attestedAtMs, artifactBinding, ...(treeMember ? { treeMember } : {}) };
  };

  // 2 first, because it decides 1's atomic rule: the hardware's word about which image made this proof.
  const att = proof?.environment?.attestation as { format?: string; reportB64?: string } | undefined;
  if (!att || att.format !== "aws-nitro" || typeof att.reportB64 !== "string" || att.reportB64.length === 0) {
    return out(false, "no AWS Nitro attestation: a proof without one is not BitGraph's", [], null, null);
  }
  const declared = typeof proof.environment?.measurement === "string" ? proof.environment.measurement.toLowerCase() : null;
  const n = verifyNitroAttestation(att.reportB64, {
    ...(declared !== null ? { expectedPcr0: declared } : {}),
    expectedUserDataB64: computeSignedBodyHash(proof),
    ...(opts.rootDer ? { rootDer: opts.rootDer } : {}),
  });
  const docPcr0 = (n.doc?.pcrs as Record<number, unknown> | undefined)?.[0];
  const pcr0 = typeof docPcr0 === "string" ? docPcr0.toLowerCase() : null;
  const attestedAtMs = n.valid && typeof n.doc?.timestampMs === "number" ? n.doc.timestampMs : null;
  if (!n.valid) {
    const bad = n.checks.find((c) => !c.pass);
    return out(false, `the attestation does not verify: ${bad ? `${bad.name}: ${bad.detail}` : "incomplete"}`, n.checks, pcr0, null);
  }
  if (pcr0 === null) return out(false, "the attestation names no PCR0", n.checks, null, null);

  // 3. The image.
  const accepted = (opts.pcr0 ?? PUBLISHED_PCR0S).map((x) => String(x).toLowerCase());
  if (!accepted.includes(pcr0)) {
    return out(false, opts.pcr0 ? `PCR0 ${pcr0.slice(0, 16)}… is not an image this verifier accepts` : `PCR0 ${pcr0.slice(0, 16)}… is not an enclave image BitGraph published`, n.checks, pcr0, attestedAtMs);
  }

  if (member && bytes !== undefined) {
    if (!checkTreeMember(proof, sha256(bytes), member)) return out(false, "the file is not in the tree this proof binds", n.checks, pcr0, attestedAtMs);
    treeMember = { index: member.index, files: member.files };
    bytes = treeRootTextBytes(member);
  }

  // 1. The proof's own consistency, with the atomic rule where it applies.
  const image = publishedMeasurement(pcr0);
  const atomic = proof.commit?.atomic === true || (image !== null && ATOMIC_FROM.has(image.version));
  const trustAnchors: VerificationPolicy = { ...(opts.trustAnchors ?? {}), ...(atomic ? { requireAtomic: true } : {}) };
  const context = opts.context ?? createVerificationContext();
  const r = bytes !== undefined
    ? await verify({ proof, bytes, trustAnchors, context })
    : await verifyProofIntegrity({ proof, trustAnchors, context });
  if (!r.valid) return out(false, r.reason ?? "the proof does not verify", n.checks, pcr0, attestedAtMs);
  return out(true, undefined, n.checks, pcr0, attestedAtMs);
}
