// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * The ledger identity hash exists twice on purpose.
 *
 * packages/verify/src/proof-hash.ts is the source of truth. The anchor service
 * (packages/hosted/src/bitcoin-anchor.ts) carries an inlined copy because its
 * Railway deployment cannot resolve the monorepo package, and it writes S3 keys
 * with the result. Until 2026-09-20 the only thing holding the two together was
 * a comment saying they must match, which an outside audit named as carrying
 * too much responsibility.
 *
 * This is that comment as a test. It compares the FIELD LIST each copy hashes,
 * because that list is frozen: widening it orphans every key already written
 * (see the header of proof-hash.ts). A behavioural comparison is not possible
 * here, the hosted copy being module-private, so the list and the two optional
 * fields are what gets pinned.
 */

import { describe, test } from "node:test";
import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

/** The keys assigned in the `signedBody` literal of a computeProofHash copy. */
function signedBodyKeys(source: string, functionName: string): string[] {
  const start = source.indexOf(`function ${functionName}`);
  assert.notEqual(start, -1, `${functionName} not found`);
  const literal = source.indexOf("signedBody: Record<string, unknown> = {", start);
  assert.notEqual(literal, -1, "signedBody literal not found");
  const end = source.indexOf("};", literal);
  const body = source.slice(literal, end);
  return [...body.matchAll(/^\s{4}([A-Za-z0-9_]+):/gm)].map((m) => m[1] ?? "");
}

describe("proofHash: the hosted copy matches the frozen field list", () => {
  const canonical = read("../../packages/verify/src/proof-hash.ts");
  const hosted = read("../../packages/hosted/src/bitcoin-anchor.ts");

  test("both hash the same fields, in the same order", () => {
    const a = signedBodyKeys(canonical, "computeProofHash");
    const b = signedBodyKeys(hosted, "computeProofHash");
    assert.deepEqual(b, a, "packages/hosted's inlined computeProofHash drifted from packages/verify");
    assert.deepEqual(a, ["version", "artifact", "commit", "publicKeyB64", "enforcement", "measurement"]);
  });

  test("both add attribution and attestationFormat on the same condition", () => {
    for (const [name, src] of [["verify", canonical], ["hosted", hosted]] as const) {
      assert.match(src, /signedBody\.attribution = /, `${name}: attribution is not carried`);
      assert.match(src, /signedBody\.attestationFormat = /, `${name}: attestationFormat is not carried`);
    }
  });

  test("the hosted copy still names its source of truth", () => {
    assert.match(hosted, /packages\/verify\/src\/proof-hash\.ts/);
  });
});
