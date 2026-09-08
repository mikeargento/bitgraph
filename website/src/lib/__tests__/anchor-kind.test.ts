/**
 * What counts as an anchor on the site.
 *
 * The discriminator used to be a bare `attribution.name === "Ethereum Anchor"`
 * repeated in the ledger feed, the anchor lookup and the digest route. It is
 * now one helper, and it accepts two forms for a reason worth protecting:
 *
 *   - the signed `commit.anchor`, which every anchor since enclave v7 carries
 *   - the attribution name, which is all the ledger before 2026-09-06 has
 *
 * Dropping the second would un-anchor months of history. Requiring the second
 * would make it impossible for an anchor to be fused, because a fused proof
 * needs its one attribution name for the `bitgraph-fuse/1` marker.
 *
 * ⚠️ This now tests the PUBLISHED package, not a local copy. The site's
 * mirror of these helpers is gone (bitgraph-verify 1.11.0 owns them), so
 * what this pins is the behaviour the site actually installs.
 *
 * Run: node --test src/lib/__tests__/anchor-kind.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { anchorKindOf, anchorMarkOf, isAnchorProof, ANCHOR_ATTRIBUTION_NAME } from "@mikeargento/bitgraph-verify";

const BLOCK = 25928913;
const HASH = "0x0ce4f044093cdd272ce4d7f47903a2f77e9195c4a5267a3eb7200e3a7d9ba7fa";

const legacy = {
  commit: { counter: "10956" },
  attribution: { name: ANCHOR_ATTRIBUTION_NAME, title: `https://etherscan.io/block/${BLOCK}`, message: HASH },
};
const authenticated = {
  commit: { counter: "10957", anchor: { blockNumber: BLOCK, blockHash: HASH } },
  attribution: { name: ANCHOR_ATTRIBUTION_NAME, title: `https://etherscan.io/block/${BLOCK}`, message: HASH },
};
const fused = {
  commit: { counter: "10958", anchor: { blockNumber: BLOCK, blockHash: HASH } },
  attribution: { name: "bitgraph-fuse/1", title: "container/2" },
};

test("a pre-v7 anchor is still recognised by its attribution name", () => {
  assert.equal(anchorKindOf(legacy), "legacy-attribution");
  assert.equal(isAnchorProof(legacy), true);
  // It has no signed mark, so the block has to come from attribution as before.
  assert.equal(anchorMarkOf(legacy), null);
});

test("an anchor carrying both reports the stronger claim", () => {
  assert.equal(anchorKindOf(authenticated), "authenticated");
  assert.deepEqual(anchorMarkOf(authenticated), { blockNumber: BLOCK, blockHash: HASH });
});

test("a fused anchor is recognised with no attribution name at all", () => {
  // The case the migration exists for.
  assert.equal(anchorKindOf(fused), "authenticated");
  assert.equal(isAnchorProof(fused), true);
  assert.deepEqual(anchorMarkOf(fused), { blockNumber: BLOCK, blockHash: HASH });
});

test("an ordinary proof is not an anchor", () => {
  assert.equal(anchorKindOf({ commit: { counter: "5" }, attribution: { name: "Mike" } }), null);
  assert.equal(isAnchorProof({ commit: { counter: "5" } }), false);
  assert.equal(isAnchorProof({}), false);
});

test("an unsigned metadata claim is not an anchor", () => {
  // metadata is advisory and unsigned; it can say anything.
  const claim = { commit: { counter: "9" }, metadata: { type: "ethereum-anchor" } };
  assert.equal(anchorKindOf(claim), null);
  assert.equal(isAnchorProof(claim), false);
});

test("a malformed mark is refused rather than half-read", () => {
  assert.equal(anchorMarkOf({ commit: { anchor: { blockNumber: "25928913", blockHash: HASH } } }), null);
  assert.equal(anchorMarkOf({ commit: { anchor: { blockNumber: BLOCK } } }), null);
  assert.equal(anchorMarkOf({ commit: { anchor: null } }), null);
  // ...but a proof whose mark is present and malformed still reads as an
  // anchor, because commit.anchor being there at all is the enclave's doing.
  assert.equal(isAnchorProof({ commit: { anchor: { blockNumber: "oops" } } }), true);
});

test("nonsense input never throws", () => {
  for (const junk of [null, undefined, 0, "", [], [1, 2], true]) {
    assert.equal(anchorKindOf(junk), null);
    assert.equal(anchorMarkOf(junk), null);
    assert.equal(isAnchorProof(junk), false);
  }
});
