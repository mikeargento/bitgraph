/**
 * verifyAttested: the full check of a plain proof (2026-10-18 audit, finding D.1).
 *
 * The fixture is a real production proof: BitGraph #14 of epoch 1TYU…, made by enclave v12 (PCR0 cf1ca497…) on
 * 2026-10-18, binding merkle-root.txt of a five-file tree. Its attestation is AWS-signed, so this test checks the
 * real chain to the AWS Nitro root at the document's own instant.
 *
 * The point of the test is the forgery: a key anyone can make, signing a body that claims "measured-tee" and the
 * published PCR0. verify() alone passes it (it checks the signature against the key the proof carries); the full
 * check refuses it, because the hardware document is not about that body.
 *
 *   cd packages/verify && npx tsc -p . && node --test dist/__tests__/attested.test.js
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { getPublicKeyAsync, signAsync, utils } from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import { verifyAttested } from "../attested.js";
import { verify, createVerificationContext } from "../verifier.js";
import { buildSignedBody } from "../proof-hash.js";
import { canonicalize } from "../canonical.js";
import type { BitGraphProof } from "../types.js";

const proof = JSON.parse(readFileSync(new URL("../../src/__tests__/fixtures/v12/proof-14.json", import.meta.url), "utf8")) as BitGraphProof;
const bytes = new TextEncoder().encode("Merkle root (RFC 6962, SHA-256) of 5 files:\n48c297f66dd6535a173662db20083164ee46d527f6e8db18d1044af8e394e1a8\n");
const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");
const clone = (p: BitGraphProof): BitGraphProof => JSON.parse(JSON.stringify(p)) as BitGraphProof;

test("the real proof is BitGraph's: signature, atomic counts, attestation chain, binding and published image", async () => {
  assert.equal(b64(sha256(bytes)), proof.artifact.digestB64, "the fixture's bytes are its committed bytes");
  const r = await verifyAttested({ proof, bytes });
  assert.equal(r.valid, true, r.reason);
  assert.equal(r.artifactBinding, "checked");
  assert.equal(r.image?.version, "v12");
  assert.ok(r.attestedAtMs && new Date(r.attestedAtMs).toISOString().startsWith("2026-10-18"));
  assert.ok(r.checks.every((c) => c.pass));
});

test("without the bytes, everything but the digest comparison is checked, and said", async () => {
  const r = await verifyAttested({ proof });
  assert.equal(r.valid, true, r.reason);
  assert.equal(r.artifactBinding, "not-checked");
});

test("other bytes do not verify", async () => {
  const r = await verifyAttested({ proof, bytes: new TextEncoder().encode("something else") });
  assert.equal(r.valid, false);
});

test("a forged proof signed by anyone's key passes verify() alone, and fails the full check", async () => {
  const forged = clone(proof);
  forged.artifact.digestB64 = b64(sha256(new TextEncoder().encode("a file BitGraph never saw")));
  const priv = utils.randomPrivateKey();
  const pub = b64(await getPublicKeyAsync(priv));
  forged.signer.publicKeyB64 = pub;
  // Re-sign the slot record and the body with the forger's key, keeping the real attestation and the real PCR0 string.
  const slot = forged.slotAllocation as unknown as Record<string, unknown>;
  slot["publicKeyB64"] = pub;
  const { signatureB64: _s, ...slotBody } = slot;
  slot["signatureB64"] = b64(await signAsync(canonicalize(slotBody), priv));
  forged.commit.slotHashB64 = b64(sha256(canonicalize(slotBody)));
  forged.signer.signatureB64 = b64(await signAsync(canonicalize(buildSignedBody(forged)), priv));
  const plain = await verify({ proof: forged, bytes: new TextEncoder().encode("a file BitGraph never saw"), context: createVerificationContext() });
  assert.equal(plain.valid, true, "verify() alone accepts the forgery: this is the gap verifyAttested closes");
  const full = await verifyAttested({ proof: forged, bytes: new TextEncoder().encode("a file BitGraph never saw") });
  assert.equal(full.valid, false);
  assert.match(full.reason ?? "", /attestation does not verify/);
});

test("no attestation, or an image the verifier does not accept, is not BitGraph's", async () => {
  const none = clone(proof);
  delete (none.environment as { attestation?: unknown }).attestation;
  assert.equal((await verifyAttested({ proof: none, bytes })).valid, false);
  const other = await verifyAttested({ proof, bytes, pcr0: ["00".repeat(48)] });
  assert.equal(other.valid, false);
  assert.match(other.reason ?? "", /not an image this verifier accepts/);
});

test("a changed count breaks the proof", async () => {
  const gap = clone(proof);
  gap.commit.counter = String(Number(gap.commit.counter) + 2);
  const r = await verifyAttested({ proof: gap, bytes });
  assert.equal(r.valid, false);
});
