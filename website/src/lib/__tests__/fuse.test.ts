import { test } from "node:test";
import assert from "node:assert/strict";
import { FUSE_ATTRIBUTION_NAME, fusedOriginDigestOf, isFusedProof, isSlotRecord, secondsUntilRotation, rotationGuardActive } from "../fuse-core.ts";

const digest = Buffer.alloc(32, 7).toString("base64");

test("fusedOriginDigestOf reads only the signed attribution of a fused proof", () => {
  assert.equal(fusedOriginDigestOf({ attribution: { name: "bitgraph-fuse/1", title: "trailer/1", message: digest } }), digest);
  assert.equal(fusedOriginDigestOf({ attribution: { name: "bitgraph-fuse/1", title: "produced/1" } }), null, "no origin declared");
  assert.equal(fusedOriginDigestOf({ attribution: { name: "Ethereum Anchor", message: digest } }), null, "not fused");
  assert.equal(fusedOriginDigestOf({ attribution: { name: "bitgraph-fuse/1", message: "not a digest" } }), null);
  assert.equal(fusedOriginDigestOf({ attribution: { name: "bitgraph-fuse/1", message: "-".repeat(43) + "=" } }), null, "url-safe alphabet refused");
  assert.equal(fusedOriginDigestOf({ attribution: { name: "bitgraph-fuse/1", message: digest.slice(0, 43) + "B" } }), null, "non-canonical padding refused");
  assert.equal(fusedOriginDigestOf({}), null);
  assert.equal(isFusedProof({ attribution: { name: "bitgraph-fuse/1" } }), true);
  assert.equal(isFusedProof({ attribution: { name: "Interval" } }), false);
});

test("isSlotRecord accepts only an anchored-chain slot record", () => {
  const slot = { version: "bitgraph/slot/1", nonceB64: digest, counter: "12", epochId: digest, publicKeyB64: digest, chainId: "bitgraph:main", signatureB64: Buffer.alloc(64, 1).toString("base64") };
  assert.equal(isSlotRecord(slot), true);
  assert.equal(isSlotRecord({ ...slot, chainId: "global" }), false);
  assert.equal(isSlotRecord({ ...slot, counter: "012" }), false);
  assert.equal(isSlotRecord({ ...slot, nonceB64: "short" }), false);
  assert.equal(isSlotRecord(null), false);
});

test("secondsUntilRotation counts to the next 23:59 UTC and wraps past midnight", () => {
  assert.equal(secondsUntilRotation(new Date(Date.UTC(2026, 8, 3, 23, 58, 0))), 60);
  assert.equal(secondsUntilRotation(new Date(Date.UTC(2026, 8, 3, 23, 59, 0))), 0);
  assert.equal(secondsUntilRotation(new Date(Date.UTC(2026, 8, 3, 23, 59, 30))), 86_400 - 30, "just after the instant, the next one is tomorrow");
  assert.equal(secondsUntilRotation(new Date(Date.UTC(2026, 8, 3, 0, 0, 0))), 23 * 3600 + 59 * 60);
  assert.equal(secondsUntilRotation(new Date(Date.UTC(2026, 8, 3, 12, 0, 0)), "12:02"), 120, "override respected");
});

test("the guard refuses allocation inside the pre-rotation window only", () => {
  assert.equal(rotationGuardActive(new Date(Date.UTC(2026, 8, 3, 23, 57, 0)), 150), true, "120 s before: inside the 150 s guard");
  assert.equal(rotationGuardActive(new Date(Date.UTC(2026, 8, 3, 23, 56, 0)), 150), false, "180 s before: open");
  assert.equal(rotationGuardActive(new Date(Date.UTC(2026, 8, 3, 23, 59, 5)), 150), false, "after the instant the next rotation is a day away");
  assert.equal(rotationGuardActive(new Date(Date.UTC(2026, 8, 3, 9, 0, 0)), 150), false);
});

test("the site's pinned wire name agrees with @mikeargento/bitgraph-verify", async () => {
  // The site cannot import this from its verify dependency until 1.4.0 is
  // published, so it pins the value and this test keeps the two copies equal.
  // Requires the workspace build (npm run build at the repo root).
  const verify = (await import("../../../../packages/verify/dist/index.js")) as { FUSE_ATTRIBUTION_NAME: string; FUSE_PROFILE: string };
  assert.equal(FUSE_ATTRIBUTION_NAME, verify.FUSE_ATTRIBUTION_NAME);
  assert.equal(FUSE_ATTRIBUTION_NAME, verify.FUSE_PROFILE, "the marker is the profile id");
  assert.equal(FUSE_ATTRIBUTION_NAME, "bitgraph-fuse/1", "the v1 wire identifier is fixed");
});
