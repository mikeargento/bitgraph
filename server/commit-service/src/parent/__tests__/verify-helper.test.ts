// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * POST /verify's signature rebuild must include every signed field. It used
 * to omit attribution and policy, so every anchor proof and every fused proof
 * (placement and origin ride in attribution) was reported as failing.
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { verifySignatureOnly } from "../verify-helper.js";
import type { BitGraphProof } from "bitgraph";

const FIX = fileURLToPath(new URL("../../../../../src/__tests__/fuse-fixtures/", import.meta.url));
const proofOf = (name: string) => JSON.parse(readFileSync(FIX + name, "utf8")) as BitGraphProof;

test("an attributed (fused) proof verifies", async () => {
  const r = await verifySignatureOnly(proofOf("trailer.proof.json"));
  assert.equal(r.valid, true, r.reason);
});

test("an unattributed proof still verifies", async () => {
  const r = await verifySignatureOnly(proofOf("recorded.proof.json"));
  assert.equal(r.valid, true, r.reason);
});

test("a changed or removed attribution fails, because it is signed", async () => {
  const p = proofOf("trailer.proof.json");
  const edited = structuredClone(p);
  edited.attribution!.message = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  assert.equal((await verifySignatureOnly(edited)).valid, false);
  const stripped = structuredClone(p);
  delete stripped.attribution;
  assert.equal((await verifySignatureOnly(stripped)).valid, false);
});
