/**
 * The sandwich: verifyStretch / verifyBetween check the SHAPE of a run of
 * binds (two counts each, nonce count = previous payload count + 1, prevB64
 * links). Signatures are verify()'s job, so these proofs are unsigned shapes.
 * The real thing, minted by the enclave's own code, is checked end to end in
 * server/commit-service/local-enclave/bind-v11.mts.
 *
 *   cd packages/verify && npx tsc -p . && node --test dist/__tests__/stretch.test.js
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { verifyStretch, verifyBetween } from "../stretch.js";
import { computeChainHash } from "../proof-hash.js";
import type { BitGraphProof } from "../types.js";

function run(startCount: number, n: number): BitGraphProof[] {
  const out: BitGraphProof[] = [];
  let count = startCount;
  for (let i = 0; i < n; i++) {
    const nonce = String(count);
    const payload = String(count + 1);
    count += 2;
    const p = {
      version: "bitgraph/1",
      artifact: { hashAlg: "sha256", digestB64: Buffer.alloc(32, i).toString("base64") },
      commit: {
        nonceB64: Buffer.alloc(32, 100 + i).toString("base64"),
        counter: payload,
        slotCounter: nonce,
        epochId: "epoch",
        atomic: true,
        ...(out.length > 0 ? { prevB64: computeChainHash(out[out.length - 1]!) } : {}),
      },
      signer: { publicKeyB64: "key", signatureB64: "sig" },
      environment: { enforcement: "measured-tee", measurement: "m" },
      slotAllocation: { version: "bitgraph/slot/1", nonceB64: Buffer.alloc(32, 100 + i).toString("base64"), counter: nonce, epochId: "epoch", publicKeyB64: "key", signatureB64: "s" },
    } as unknown as BitGraphProof;
    out.push(p);
  }
  return out;
}

test("A 2435-2436 → R → R → B 2441-2442 is one unbroken stretch", () => {
  const s = run(2435, 4);
  const r = verifyStretch(s);
  assert.equal(r.ok, true, r.reasons.join("; "));
  assert.equal(r.from, "2435");
  assert.equal(r.to, "2442");
  assert.equal(verifyBetween(s, s[1]!).ok, true);
  assert.equal(verifyBetween(s, s[2]!).ok, true);
});

test("A and B themselves are not between A and B", () => {
  const s = run(2435, 4);
  assert.equal(verifyBetween(s, s[0]!).ok, false);
  assert.equal(verifyBetween(s, s[3]!).ok, false);
});

test("a missing proof shows up as unaccounted counts", () => {
  const s = run(2435, 4);
  const r = verifyStretch([s[0]!, s[2]!, s[3]!]);
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => /2437 to 2438 are unaccounted/.test(x)), r.reasons.join("; "));
});

test("a two-call proof (no commit.atomic) breaks the stretch", () => {
  const s = run(2435, 3);
  const mid = s[1]! as unknown as { commit: Record<string, unknown> };
  delete mid.commit["atomic"];
  const r = verifyStretch(s);
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => /not a bind/.test(x)));
});

test("a payload count that is not nonce + 1 is refused", () => {
  const s = run(2435, 2);
  (s[1]! as unknown as { commit: { counter: string } }).commit.counter = "2439";
  const r = verifyStretch(s);
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => /not nonce count 2437 plus one/.test(x)), r.reasons.join("; "));
});

test("a broken prevB64 link is refused", () => {
  const s = run(2435, 3);
  (s[2]! as unknown as { commit: { prevB64: string } }).commit.prevB64 = "x";
  const r = verifyStretch(s);
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => /does not link/.test(x)));
});

test("another epoch or key is refused", () => {
  const s = run(2435, 2);
  (s[1]! as unknown as { commit: { epochId: string } }).commit.epochId = "other";
  assert.equal(verifyStretch(s).ok, false);
});
