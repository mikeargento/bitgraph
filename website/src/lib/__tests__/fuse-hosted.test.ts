import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { getPlacement, bytesToBase64 } from "@mikeargento/bitgraph-verify";
import {
  assemble,
  choosePlacement,
  decodeToken,
  encodeToken,
  recipeFor,
  recipeJson,
  renderCommitMarkdown,
  renderOpenMarkdown,
  type OpenState,
} from "../mcp/fuse-hosted.ts";

const sha256 = (b: Uint8Array) => new Uint8Array(createHash("sha256").update(b).digest());
const commitment = new Uint8Array(randomBytes(32));

// Sizes around the 512-byte tar block edges, plus zero and a large one.
const SIZES = [0, 1, 2, 511, 512, 513, 1023, 1024, 1025, 4095, 4097, 100_003];

test("container/1 recipe: prefix + original + suffix equals the registered placement's own build, byte for byte", () => {
  const placement = getPlacement("container/1");
  assert.ok(placement);
  for (const size of SIZES) {
    const original = new Uint8Array(randomBytes(size));
    const originDigest = sha256(original);
    const recipe = recipeFor("container/1", originDigest, size, commitment);
    const built = assemble(recipe, original);
    const reference = placement.build({ original, originDigest, commitment });
    assert.deepEqual(built, reference, `size ${size}`);
    // And the placement finds the commitment and the origin in what the caller built.
    const located = placement.locate(built);
    assert.ok(located, `locate at size ${size}`);
    assert.deepEqual(located.commitment, commitment);
    assert.deepEqual(located.originDigest, originDigest);
  }
});

test("container/2 recipe: prefix + original + suffix equals the registered placement's own build, byte for byte", () => {
  const placement = getPlacement("container/2");
  assert.ok(placement);
  for (const size of SIZES) {
    const original = new Uint8Array(randomBytes(size));
    const originDigest = sha256(original);
    const recipe = recipeFor("container/2", originDigest, size, commitment);
    const built = assemble(recipe, original);
    const reference = placement.build({ original, originDigest, commitment });
    assert.deepEqual(built, reference, `size ${size}`);
    // And the placement finds the commitment and the origin in what the caller built.
    const located = placement.locate(built);
    assert.ok(located, `locate at size ${size}`);
    assert.deepEqual(located.commitment, commitment);
    assert.deepEqual(located.originDigest, originDigest);
  }
});

test("trailer/1 recipe: original + append equals the registered placement's own build", () => {
  const placement = getPlacement("trailer/1");
  assert.ok(placement);
  for (const size of [0, 1, 100, 4097]) {
    const original = new Uint8Array(randomBytes(size));
    const originDigest = sha256(original);
    const recipe = recipeFor("trailer/1", originDigest, size, commitment);
    assert.equal(recipe.placement, "trailer/1");
    const built = assemble(recipe, original);
    assert.deepEqual(built, placement.build({ original, originDigest, commitment }), `size ${size}`);
    const located = placement.locate(built);
    assert.ok(located);
    assert.deepEqual(located.commitment, commitment);
    assert.deepEqual(located.originalBytes, original);
  }
});

test("the recipe depends only on the digest, the size and the commitment: same inputs, same bytes", () => {
  const originDigest = new Uint8Array(randomBytes(32));
  const a = recipeFor("container/1", originDigest, 777, commitment);
  const b = recipeFor("container/1", originDigest, 777, commitment);
  assert.deepEqual(recipeJson(a), recipeJson(b));
  const c = recipeFor("container/1", originDigest, 778, commitment);
  assert.notDeepEqual(recipeJson(a), recipeJson(c), "a different size changes the header and the padding");
});

test("recipeFor refuses malformed inputs", () => {
  const d = new Uint8Array(32);
  assert.throws(() => recipeFor("trailer/1", new Uint8Array(31), 1, commitment), /originDigest/);
  assert.throws(() => recipeFor("trailer/1", d, 1, new Uint8Array(1)), /commitment/);
  assert.throws(() => recipeFor("container/1", d, -1, commitment), /originSize/);
  assert.throws(() => recipeFor("container/1", d, 1.5, commitment), /originSize/);
});

test("choosePlacement follows the core policy from the first bytes, and the container when there are none", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...randomBytes(12)]);
  assert.equal(choosePlacement(jpeg, 100_000), "trailer/1");
  const pdf = new Uint8Array([...Buffer.from("%PDF-1.7\n"), ...randomBytes(7)]);
  assert.equal(choosePlacement(pdf, 100_000), "container/2");
  assert.equal(choosePlacement(null, 5), "container/2", "no head: the container wraps anything");
  // A whole tiny file is an acceptable head.
  assert.equal(choosePlacement(new Uint8Array([1, 2, 3]), 3), "container/2");
  // Too short a head for a larger file is refused, not guessed.
  const short = choosePlacement(new Uint8Array([0xff, 0xd8, 0xff]), 100_000);
  assert.ok(typeof short === "object" && /first 16 bytes/.test(short.error));
  const long = choosePlacement(new Uint8Array(65), 100_000);
  assert.ok(typeof long === "object" && /more than 64/.test(long.error));
  const longer = choosePlacement(new Uint8Array(20), 10);
  assert.ok(typeof longer === "object" && /longer than the file/.test(longer.error));
});

const slot = {
  version: "bitgraph/slot/1",
  nonceB64: bytesToBase64(new Uint8Array(randomBytes(32))),
  counter: "42",
  epochId: bytesToBase64(new Uint8Array(randomBytes(32))),
  publicKeyB64: bytesToBase64(new Uint8Array(randomBytes(32))),
  chainId: "bitgraph:main",
  signatureB64: bytesToBase64(new Uint8Array(randomBytes(64))),
};

test("the token round-trips the open state and rejects anything else", () => {
  const state: OpenState = {
    v: 1,
    slot,
    placement: "container/1",
    origin: { digestB64: bytesToBase64(new Uint8Array(randomBytes(32))), size: 1234, name: "report.pdf" },
    fusedName: "report.fused.tar",
    frameName: "report.pdf.bitgraph-fuse.json",
  };
  const token = encodeToken(state);
  assert.deepEqual(decodeToken(token), state);
  assert.equal(decodeToken("not a token"), null);
  assert.equal(decodeToken(Buffer.from("{}").toString("base64url")), null);
  assert.equal(decodeToken(encodeToken({ ...state, placement: "produced/1" as unknown as "trailer/1" })), null, "only the hosted placements");
  assert.deepEqual(decodeToken(encodeToken({ ...state, placement: "container/2" })), { ...state, placement: "container/2" }, "container/2 tokens decode");
  assert.deepEqual(decodeToken(encodeToken({ ...state, set: true })), { ...state, set: true }, "the set flag survives the round trip");
  assert.equal(decodeToken(encodeToken({ ...state, set: "yes" as unknown as true })), null, "the set flag is true or absent");
  assert.equal(decodeToken(encodeToken({ ...state, origin: { ...state.origin, size: -1 } })), null);
  assert.equal(decodeToken(encodeToken({ ...state, origin: { ...state.origin, digestB64: "x" } })), null);
  assert.equal(decodeToken(encodeToken({ ...state, slot: { ...slot, nonceB64: "short" } })), null, "the slot record is validated");
});

test("renderers state outcomes plainly and never claim what did not happen", () => {
  const open = renderOpenMarkdown([
    { name: "a.jpg", digest: "d1", outcome: "opened", placement: "trailer/1", slot_counter: "9", epoch: "e", fused_name: "a.fused.jpg", frame_name: "a.jpg.bitgraph-fuse.json", fuse_token: "t", recipe: { kind: "append", append_base64: "QQ==" }, total_positions: 0, proof_url: null, error: null },
    { name: "b.pdf", digest: "d2", outcome: "on record", placement: null, slot_counter: null, epoch: null, fused_name: null, frame_name: null, fuse_token: null, recipe: null, total_positions: 2, proof_url: "https://bitgraph.ing/proof/d2", error: null },
    { name: "c.txt", digest: "d3", outcome: "not opened", placement: null, slot_counter: null, epoch: null, fused_name: null, frame_name: null, fuse_token: null, recipe: null, total_positions: 0, proof_url: null, error: "the boundary is restarting" },
  ]);
  assert.match(open, /^1 opened, 1 already on record, 1 NOT opened\./);
  assert.match(open, /opened · slot #9 · a\.jpg · trailer\/1 → a\.fused\.jpg/);
  assert.match(open, /on record · b\.pdf \(2 positions\)/);
  assert.match(open, /not opened · c\.txt · the boundary is restarting/);
  assert.match(open, /new_file = original \+ append/);
  const commit = renderCommitMarkdown([
    { name: "a.jpg", origin_digest: "d1", artifact_digest: "f1", outcome: "fused", placement: "trailer/1", slot_counter: "9", counter: "10", epoch: "e", fused_name: "a.fused.jpg", frame_name: "a.jpg.bitgraph-fuse.json", proof_url: "https://bitgraph.ing/proof/f1", positions: [], recovered: false, error: null },
    { name: "c.txt", origin_digest: "d3", artifact_digest: "f3", outcome: "not fused", placement: "container/1", slot_counter: "11", counter: null, epoch: null, fused_name: "c.fused.tar", frame_name: "c.txt.bitgraph-fuse.json", proof_url: null, positions: [], recovered: false, error: "no anchor since the slot" },
  ]);
  assert.match(commit, /^1 fused, 1 NOT fused\./);
  assert.match(commit, /fused · slot #9 → #10 · a\.jpg → a\.fused\.jpg/);
  assert.match(commit, /not fused · c\.txt · no anchor since the slot/);
  assert.match(commit, /The new file is virtual/);
  const set = renderCommitMarkdown(
    [
      { name: "a.jpg", origin_digest: "d1", artifact_digest: "f1", outcome: "fused", placement: "trailer/1", slot_counter: "9", counter: "10", epoch: "e", fused_name: "a.fused.jpg", frame_name: "a.jpg.bitgraph-fuse.json", proof_url: "https://bitgraph.ing/proof/d1?counter=10", positions: [], recovered: false, error: null, member: 2, member_count: 2, set_digest: "s1" },
      { name: "b.txt", origin_digest: "d2", artifact_digest: "f2", outcome: "fused", placement: "container/2", slot_counter: "9", counter: "10", epoch: "e", fused_name: "b.fused.tar", frame_name: "b.txt.bitgraph-fuse.json", proof_url: "https://bitgraph.ing/proof/d2?counter=10", positions: [], recovered: false, error: null, member: 1, member_count: 2, set_digest: "s1" },
    ],
    [{ slot_counter: "9", counter: "10", epoch: "e", count: 2, artifact_digest: "s1", proof_url: "https://bitgraph.ing/proof/s1?counter=10", manifest_echoed: true, recovered: false }],
  );
  assert.match(set, /^2 fused as one set at #10 \(set of 2\)\./);
  assert.match(set, /- set · slot #9 → #10 · set of 2\n  https:\/\/bitgraph\.ing\/proof\/s1\?counter=10/);
  assert.match(set, /- fused · a\.jpg → a\.fused\.jpg \(2 of 2, trailer\/1\)/);
  assert.match(set, /- fused · b\.txt → b\.fused\.tar \(1 of 2, container\/2\)/);
  assert.match(set, /sets\[\]\.proof/);
  const openSet = renderOpenMarkdown([
    { name: "a.jpg", digest: "d1", outcome: "opened", set: true, placement: "trailer/1", slot_counter: "9", epoch: "e", fused_name: "a.fused.jpg", frame_name: "a.jpg.bitgraph-fuse.json", fuse_token: "t", recipe: { kind: "append", append_base64: "QQ==" }, total_positions: 0, proof_url: null, error: null },
    { name: "b.txt", digest: "d2", outcome: "opened", set: true, placement: "container/2", slot_counter: "9", epoch: "e", fused_name: "b.fused.tar", frame_name: "b.txt.bitgraph-fuse.json", fuse_token: "t2", recipe: { kind: "wrap", prefix_base64: "QQ==", suffix_base64: "QQ==" }, total_positions: 0, proof_url: null, error: null },
  ]);
  assert.match(openSet, /^2 opened under one slot #9 \(one set\), 0 already on record\./);
  assert.match(openSet, /single bitgraph_commit call/);
  assert.match(openSet, /expires 120 seconds/);
});
