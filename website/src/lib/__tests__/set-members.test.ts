/**
 * A set's member list, and the two properties it must never break.
 *
 * The list exists so a 48,000 file set is not 48,000 lookups. It is an INDEX
 * over keys that already exist, so the rules are:
 *
 *   1. It may only ever make an answer FASTER, never different. A digest the
 *      list does not name, or names in a chunk that will not parse, must
 *      fall through to the lookup it always had.
 *   2. A proof lifted out of an entry must come back as the same proof, and
 *      an entry naming a set the answer did not carry must come back with NO
 *      proof rather than someone else's.
 *
 * Run: node --test src/lib/__tests__/set-members.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SET_MEMBER_VERSION, encodeChunk, decodeChunkInto, liftSetProofs, attachSetProofs,
  setMembersKey, setMembersPrefix, type SetMemberRef,
} from "../set-members.ts";

const AT = { epochId: "P1IPCIeBd_gbBGJnbQVSDhKFeI7wVzTzWYbfvzZlqcs", counter: "1546" };
const META = { setDigest: "SETDIGEST", ...AT, count: 48000, writeTime: 1788837437663 };
const ENTRIES = [
  { digestB64: "aaa", kind: "set-member" as const, index: 0 },
  { digestB64: "bbb", kind: "fused-descendant" as const, index: 0 },
  { digestB64: "ccc", kind: "set-member" as const, index: 1 },
];

test("a chunk round-trips with the kind, index and count a row needs", () => {
  const into = new Map<string, SetMemberRef>();
  assert.equal(decodeChunkInto(encodeChunk(META, ENTRIES, 0), AT, into), true);
  assert.equal(into.size, 3);
  assert.deepEqual(into.get("aaa"), {
    setDigest: "SETDIGEST", epochId: AT.epochId, counter: "1546",
    kind: "set-member", index: 0, count: 48000, writeTime: 1788837437663,
  });
  // The two sides of one member are told apart, which is what the row's
  // "origin" / "fused" label is read from.
  assert.equal(into.get("bbb")?.kind, "fused-descendant");
});

test("the key layout pads so chunks sort in order", () => {
  assert.equal(setMembersPrefix("E", "7"), "set-members/E/7/");
  assert.equal(setMembersKey("E", "7", 0), "set-members/E/7/000000.json");
  const keys = [12, 2, 100].map((n) => setMembersKey("E", "7", n));
  assert.deepEqual([...keys].sort(), [setMembersKey("E", "7", 2), setMembersKey("E", "7", 12), setMembersKey("E", "7", 100)]);
});

test("the two spellings of one epoch are the same epoch", () => {
  // ⚠️ THE BUG THIS FILE MISSED. A proof's commit.epochId is STANDARD base64
  // ("P1IPCIeBd/gbBGJ...="); the ledger's keys use the url-safe spelling.
  // Every test above used one spelling on both sides, so the mismatch that
  // made every list lookup miss sailed straight through. Both spellings must
  // reach the same prefix and the same chunk.
  const standard = "P1IPCIeBd/gbBGJnbQVSDhKFeI7wVzTzWYbfvzZlqcs=";
  const urlSafe = "P1IPCIeBd_gbBGJnbQVSDhKFeI7wVzTzWYbfvzZlqcs";
  assert.equal(setMembersPrefix(standard, "1640"), setMembersPrefix(urlSafe, "1640"));
  assert.equal(setMembersPrefix(standard, "1640"), `set-members/${urlSafe}/1640/`,
    "the prefix must be the url-safe form the keys are written under");
  assert.ok(!setMembersPrefix(standard, "1640").includes("/gbBGJ"),
    "a standard-base64 slash would invent an extra path segment");
  // A chunk written under one spelling is readable when asked under the other.
  const into = new Map<string, SetMemberRef>();
  const written = encodeChunk({ ...META, epochId: urlSafe }, ENTRIES, 0);
  assert.equal(decodeChunkInto(written, { epochId: standard, counter: "1546" }, into), true);
  assert.equal(into.size, 3);
  assert.equal(into.get("aaa")?.epochId, urlSafe, "and it reports the canonical spelling");
});

test("NEGATIVE: a chunk from another position is refused, and adds nothing", () => {
  // The whole risk of an index: answering about the wrong position.
  const into = new Map<string, SetMemberRef>();
  const other = encodeChunk({ ...META, counter: "9999" }, ENTRIES, 0);
  assert.equal(decodeChunkInto(other, AT, into), false);
  assert.equal(into.size, 0, "nothing from a mismatched chunk may be kept");
});

test("NEGATIVE: an unknown version or unparseable body is refused", () => {
  const into = new Map<string, SetMemberRef>();
  const bad = JSON.parse(encodeChunk(META, ENTRIES, 0));
  bad.v = SET_MEMBER_VERSION + 1;
  assert.equal(decodeChunkInto(JSON.stringify(bad), AT, into), false);
  assert.equal(decodeChunkInto("{not json", AT, into), false);
  assert.equal(decodeChunkInto("null", AT, into), false);
  assert.equal(into.size, 0);
});

test("a malformed row is skipped without losing the rest of the chunk", () => {
  const into = new Map<string, SetMemberRef>();
  const c = JSON.parse(encodeChunk(META, ENTRIES, 0));
  c.entries[1] = ["bbb", "x", 0];
  assert.equal(decodeChunkInto(JSON.stringify(c), AT, into), true);
  assert.equal(into.size, 2, "the two good rows survive");
  assert.equal(into.has("bbb"), false, "and the bad one is simply absent, never guessed");
});

test("a lifted proof is the same object coming back", () => {
  const proof = { version: "bitgraph/1", artifact: { digestB64: "root" } };
  const sets = { SETDIGEST: proof };
  const results = { a: { proofs: [{ proof, setDigest: "SETDIGEST" }] } };
  assert.equal(liftSetProofs(results, sets), 1);
  assert.equal(results.a.proofs[0].proof, undefined);
  assert.equal((results.a.proofs[0] as { setRef?: string }).setRef, "SETDIGEST");
  const { attached, unresolved } = attachSetProofs(results, sets);
  assert.equal(attached, 1);
  assert.equal(unresolved, 0);
  assert.equal(results.a.proofs[0].proof, proof);
});

test("a proof that was genuinely READ is left alone", () => {
  // Only the resolver's entries hold the very object in `sets`. A separate
  // parse that merely looks the same must not be lifted, because putting
  // back "a proof like it" is not putting back the proof.
  const proof = { version: "bitgraph/1", artifact: { digestB64: "root" } };
  const lookalike = JSON.parse(JSON.stringify(proof));
  const results = { a: { proofs: [{ proof: lookalike, setDigest: "SETDIGEST" }] } };
  assert.equal(liftSetProofs(results, { SETDIGEST: proof }), 0);
  assert.equal(results.a.proofs[0].proof, lookalike);
});

test("NEGATIVE: an entry naming a set the answer lacks gets NO proof", () => {
  const results = { a: { proofs: [{ setRef: "MISSING" }] } };
  const { attached, unresolved } = attachSetProofs(results, { OTHER: { version: "bitgraph/1" } });
  assert.equal(attached, 0);
  assert.equal(unresolved, 1);
  assert.equal(results.a.proofs[0].proof, undefined, "never substituted with another set's proof");
  assert.equal(results.a.proofs[0].setRef, "MISSING", "and the unresolved name is kept, not erased");
});

test("REGRESSION: every lifted entry's set must be in the answer", () => {
  // ⚠️ The bug this exists for. The route sent `sets` only when its
  // per-digest pass had asked for one; a set expanded from a member list
  // never goes through that pass, so an answer went out with thousands of
  // entries naming a set it did not carry. attachSetProofs then leaves those
  // entries with NO proof, and a row with no proof reads as not on the
  // ledger — an offer to re-record bytes that already hold a position.
  const proof = { version: "bitgraph/1", artifact: { digestB64: "root" } };
  const sets: Record<string, unknown> = { SETDIGEST: proof };
  const results = {
    a: { proofs: [{ proof, setDigest: "SETDIGEST" }] },
    b: { proofs: [{ proof, setDigest: "SETDIGEST" }] },
  };
  liftSetProofs(results, sets);
  const named = Object.values(results).flatMap((r) => r.proofs).map((e) => (e as { setRef?: string }).setRef).filter(Boolean);
  assert.equal(named.length, 2, "both entries reference their set");
  for (const ref of named) assert.ok(ref! in sets, `the answer must carry ${ref}`);
  // And with that table they all come back whole.
  const { attached, unresolved } = attachSetProofs(results, sets);
  assert.equal(attached, 2);
  assert.equal(unresolved, 0);
  // Shipping the same answer WITHOUT the table is the bug, and it is loud.
  const dropped = { a: { proofs: [{ setRef: "SETDIGEST" }] } };
  assert.equal(attachSetProofs(dropped, undefined).unresolved, 1);
  assert.equal(dropped.a.proofs[0].proof, undefined);
});

test("nonsense never throws", () => {
  assert.equal(liftSetProofs({ a: undefined }, {}), 0);
  assert.deepEqual(attachSetProofs({ a: undefined }, undefined), { attached: 0, unresolved: 0 });
  assert.deepEqual(attachSetProofs({ a: { proofs: [] } }, {}), { attached: 0, unresolved: 0 });
});
