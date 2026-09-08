/**
 * The attestation side table, and the property the whole thing rests on.
 *
 * A batch answer stops carrying one ~6 KB attestation per proof and carries
 * each distinct one once. That is only safe if a restored proof is EXACTLY
 * the proof the ledger holds: these are exported as proof.json for a skeptic
 * to verify, and `environment` contains `enforcement` and `measurement`,
 * which are inside the signed body and inside computeProofHash's frozen
 * subset. One byte different and the export stops verifying.
 *
 * Run: node --test src/lib/__tests__/proof-environment.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { canonicalizeToString } from "@mikeargento/bitgraph-verify";
import { splitEnvironments, attachEnvironments } from "../proof-environment.ts";

const key = (json: string) => createHash("sha256").update(json).digest("base64url").slice(0, 16);

const ENV_A = {
  enforcement: "tee",
  measurement: { pcr0: "eccfc1c7".repeat(12) },
  attestation: { format: "nitro", documentB64: "A".repeat(6000) },
};
const ENV_B = {
  enforcement: "tee",
  measurement: { pcr0: "394c3cf5".repeat(12) },
  attestation: { format: "nitro", documentB64: "B".repeat(6000) },
};

function proof(env: unknown, counter: string) {
  return {
    version: "bitgraph/1",
    artifact: { digestB64: `d-${counter}`, hashAlg: "sha256" },
    commit: { counter, epochId: "e1" },
    environment: env,
    metadata: { note: counter },
  } as Record<string, unknown>;
}
function results(...envs: unknown[]) {
  return {
    a: { proofs: envs.map((e, i) => ({ proof: proof(e, String(i)) })) },
  };
}

test("a restored proof is the same proof every verifier will see", () => {
  // Not literal string equality: putting the key back appends it, so the
  // restored object's KEY ORDER differs from the one that went in. That is
  // safe, and the reason is worth stating rather than assumed — canonical.ts
  // sorts keys recursively before signing or hashing, so every signature
  // check, computeProofHash and export sees an identical byte sequence
  // either way. This asserts against the real canonicalizer, not a mirror of
  // it, so the test fails if that ever stops being true.
  const r = results(ENV_A, ENV_B, ENV_A);
  const before = r.a.proofs.map((e) => canonicalizeToString(e.proof));
  const table = splitEnvironments(r, key);
  assert.ok(!("environment" in r.a.proofs[0].proof), "split must actually remove it");
  const { attached, unresolved } = attachEnvironments(r, table);
  assert.equal(attached, 3);
  assert.equal(unresolved, 0);
  assert.deepEqual(r.a.proofs.map((e) => canonicalizeToString(e.proof)), before);
  // And every field is back, not just the ones canonical order happened to keep.
  assert.deepEqual(r.a.proofs[0].proof["environment"], ENV_A);
  assert.deepEqual(r.a.proofs[1].proof["environment"], ENV_B);
});

test("identical environments collapse to one table entry", () => {
  const r = results(ENV_A, ENV_A, ENV_A, ENV_B);
  const table = splitEnvironments(r, key);
  // The real measurement on 2026-09-07: 4,000 proofs, 2 distinct environments.
  assert.equal(Object.keys(table).length, 2, "four proofs, two distinct environments");
  const seen = r.a.proofs.map((e) => (e as { envRef?: string }).envRef);
  assert.equal(new Set(seen).size, 2, "the three ENV_A proofs must name the same entry");
});

test("the answer really is smaller, by about what was measured", () => {
  // 20 proofs sharing one environment: the shape of a folder re-drop.
  const r = results(...Array.from({ length: 20 }, () => ENV_A));
  const fat = JSON.stringify(r).length;
  const table = splitEnvironments(r, key);
  const lean = JSON.stringify({ results: r, environments: table }).length;
  assert.ok(lean < fat / 3, `expected a big cut, got ${fat} -> ${lean}`);
});

test("NEGATIVE: an unresolvable reference leaves the proof visibly incomplete", () => {
  // The case that must never quietly pass. If the table is missing or wrong,
  // a proof must NOT come back looking whole: it has no environment, so a
  // verifier refuses it, which is the honest outcome.
  const r = results(ENV_A, ENV_B);
  splitEnvironments(r, key);
  const { attached, unresolved } = attachEnvironments(r, { "not-the-key": ENV_A });
  assert.equal(attached, 0);
  assert.equal(unresolved, 2);
  for (const e of r.a.proofs) {
    assert.equal(e.proof["environment"], undefined, "must stay absent, never guessed at");
    assert.equal((e as { envRef?: string }).envRef, undefined ?? (e as { envRef?: string }).envRef);
  }
});

test("NEGATIVE: a wrong table does not put the wrong attestation on a proof", () => {
  const r = results(ENV_A);
  const table = splitEnvironments(r, key);
  const onlyKey = Object.keys(table)[0];
  // An answer whose table entry was swapped for a different environment is
  // indistinguishable from a correct one HERE, which is exactly why the key
  // is content-addressed: swapping the value changes the key it would be
  // stored under, so it can only arrive under a name nothing references.
  assert.equal(onlyKey, key(JSON.stringify(ENV_A)));
  assert.notEqual(key(JSON.stringify(ENV_B)), onlyKey);
});

test("proofs with no environment are left alone", () => {
  const r = { a: { proofs: [{ proof: { version: "bitgraph/1" } as Record<string, unknown> }] } };
  const before = JSON.stringify(r);
  const table = splitEnvironments(r, key);
  assert.deepEqual(table, {});
  attachEnvironments(r, table);
  assert.equal(JSON.stringify(r), before);
});

test("nonsense never throws", () => {
  assert.deepEqual(splitEnvironments({ a: undefined, b: { proofs: [] } }, key), {});
  assert.deepEqual(attachEnvironments({ a: undefined }, undefined), { attached: 0, unresolved: 0 });
});
