// Copyright (c) 2025-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * A tree member's BitGraphed file (bitgraph-carrier/4) through the SDK's
 * reader: the window view names the member, and the one-line form says so,
 * kept as is or placed. The tree is minted with a throwaway key over the
 * saved Base floor block the fuse/3 fixtures use (no attestation, so the
 * verdict is UNDETERMINED: the image is not established), which is enough to
 * show the reader carries the member through.
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getPublicKeyAsync, signAsync } from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import {
  assembleCarrierV4Payload, buildCarrier, buildSignedBody, buildTree, buildTreeMemberEvidence, buildTreeRootDocument, bytesToBase64, bytesToHex,
  canonicalize, canonicalSlotBody, computeSlotCommitment3, leafFor, treeAttribution, currentTreeSpecHash, type BitGraphProof,
} from "@mikeargento/bitgraph-verify";
import { carrierLine, readCarrierFile } from "../carrier-io.js";

const fixtures = fileURLToPath(new URL("../../../../src/__tests__/fuse3-fixtures/", import.meta.url));
const harness = JSON.parse(readFileSync(join(fixtures, "trailer3.proof.json"), "utf-8")) as { commit: { slotFloor: { chain: "base"; evmChainId: 8453; blockNumber: number; blockHash: string; blockTimestamp: number } } };
const header = readFileSync(join(fixtures, "floor-base-52271417.rlp.hex"), "utf-8").trim();
const slotFloor = harness.commit.slotFloor;
const b64 = (u: Uint8Array) => bytesToBase64(u);
const enc = new TextEncoder();

test("readCarrierFile on a tree member's file: version 4, the member in the view and in the line", async () => {
  const priv = sha256(enc.encode("carrier-v4 test key (TEST ONLY)"));
  const publicKeyB64 = b64(await getPublicKeyAsync(priv));
  const slotBody = { version: "bitgraph/slot/1" as const, nonceB64: b64(sha256(enc.encode("nonce-v4"))), counter: "51", epochId: b64(new Uint8Array(32).fill(9)), publicKeyB64, chainId: "bitgraph:main" };
  const slot = { ...slotBody, signatureB64: b64(await signAsync(canonicalize(slotBody as never), priv)) };
  const commitment = computeSlotCommitment3(slot, slotFloor.blockHash);
  const placed = leafFor(0x01, enc.encode("a placed member\n"), commitment);
  const asIs = leafFor(0x00, enc.encode("a member kept as is\n"), commitment);
  const built = buildTree([placed.leaf, asIs.leaf]);
  const rootDocument = buildTreeRootDocument(commitment, built.sorted.length, built.root);
  const commit = { nonceB64: slot.nonceB64, counter: "53", epochId: slot.epochId, slotCounter: slot.counter, slotHashB64: b64(sha256(canonicalize(canonicalSlotBody(slot) as never))), slotFloor, chainId: "bitgraph:main" };
  const p = {
    version: "bitgraph/1", artifact: { hashAlg: "sha256", digestB64: b64(sha256(rootDocument)) }, commit,
    signer: { publicKeyB64, signatureB64: "" }, environment: { enforcement: "stub", measurement: "test-measurement" },
    slotAllocation: slot, attribution: treeAttribution(currentTreeSpecHash(3)),
  } as unknown as BitGraphProof;
  p.signer.signatureB64 = b64(await signAsync(canonicalize(buildSignedBody(p) as never), priv));

  const dir = mkdtempSync(join(tmpdir(), "bitgraph-carrier-v4-"));
  for (const [name, m] of [["placed", placed], ["as-is", asIs]] as const) {
    const i = built.sorted.findIndex((l) => bytesToHex(l.artifact) === bytesToHex(m.leaf.artifact));
    const payload = assembleCarrierV4Payload({
      proof: p as never,
      floor: { status: "present", basis: "base-header", header },
      ceilingInTime: { status: "unfetched" },
      tree: { rootDocument: bytesToHex(rootDocument), member: buildTreeMemberEvidence(built.sorted[i]!, i, 2, built.tree.path(i)) },
    });
    const path = join(dir, `${name}.bitgraph.txt`);
    writeFileSync(path, buildCarrier(m.committed, payload));
    const r = await readCarrierFile(path);
    assert.equal(r.status, "ok");
    assert.equal(r.innerDigestB64, b64(m.leaf.artifact), "the lookup digest is the member's committed bytes, not the envelope");
    assert.equal(r.view?.version, 4);
    assert.deepEqual(r.view?.member, { index: i, count: 2, placement: name === "placed" ? "trailer/1" : "as-is" });
    assert.notEqual(r.view?.verdict, "FALSE", r.view?.reasons.join("; "));
    const line = carrierLine(r.view!);
    assert.match(line, new RegExp(`tree member: leaf ${i} of 2`));
    if (name === "as-is") assert.match(line, /kept as is: recorded after the floor, the bytes themselves are not dated/);
    else assert.doesNotMatch(line, /kept as is/);
    assert.match(line, /after Base block 52271417/);
  }
});
