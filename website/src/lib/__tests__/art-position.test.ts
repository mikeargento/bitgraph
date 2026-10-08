// The image generator end to end and offline (Mike, 2026-10-05): the real open and commit
// (fuse-tree-make.ts) against the stub boundary the tree/1 tests use, the image drawn from the
// commitment only after the position opened, recorded in that position, read back with the
// published verifier. Negative cases: expiry, a failed recording, a refused allocation, a
// boundary that answers with another position, a downloaded file that is not one.
import { test } from "node:test";
import * as assert from "node:assert/strict";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToBase64, verifyFuse } from "@mikeargento/bitgraph-verify";
import { createArtImage, verifyArtFile, redrawRecordedArt, ArtError, type ArtStage } from "../art-position.ts";
import { decodePng, toBase64Url } from "../commitment-art.ts";
import { decodeV13 } from "../commitment-art-v13.ts";
import { makeStub } from "./tree1-helpers.ts";

const isArtError = (code: string) => (e: unknown) => e instanceof ArtError && e.code === code;

test("one click: the position opens first, the commitment is shown before drawing, the image is recorded in that position and verifies", async () => {
  const stub = await makeStub();
  const stages: Array<{ stage: ArtStage; commitment: string | null; commits: number }> = [];
  const made = await createArtImage({
    transport: { fetch: stub.fetch },
    onStage: (stage, p) => stages.push({ stage, commitment: p?.commitment ?? null, commits: stub.commits.length }),
  });
  assert.deepEqual(stages.map((s) => s.stage), ["opening", "generating", "recording", "verifying", "ready"]);
  // The commitment is known when drawing starts, and nothing has been committed yet.
  assert.equal(stages[1]!.commitment, made.position.commitment);
  assert.equal(stages[1]!.commits, 0);
  // One position, one commit, of exactly these bytes.
  assert.equal(stub.commits.length, 1);
  assert.equal(stub.minted.length, 1);
  assert.equal((stub.commits[0]!.digests as Array<{ digestB64: string }>)[0]!.digestB64, bytesToBase64(sha256(made.png)));
  assert.equal(made.proof.commit.slotCounter, made.position.slotCounter);
  // The published verifier finds this position's commitment inside the image.
  assert.equal((await verifyFuse({ proof: made.proof, bytes: made.png })).category, "CARRIED_INLINE");
  // And the picture spells it: read back from the pixels alone.
  const d = await decodePng(made.png);
  assert.equal(toBase64Url(decodeV13(d.rgba, d.width, d.height)!), made.position.commitment); // the default is version 13
  assert.equal(made.checks.regenerated.result, "TRUE");
  assert.equal(made.checks.strip.result, "TRUE");
});

test("a second click opens a new position and draws a different image", async () => {
  const stub = await makeStub();
  const a = await createArtImage({ transport: { fetch: stub.fetch } });
  const b = await createArtImage({ transport: { fetch: stub.fetch } });
  assert.notEqual(a.position.commitment, b.position.commitment);
  assert.notEqual(a.digestB64, b.digestB64);
  assert.equal(stub.minted.length, 2);
});

test("a position that runs out of time is never recorded; the retry opens a new one and redraws", async () => {
  const stub = await makeStub();
  let t = 0;
  const now = () => t;
  await assert.rejects(
    createArtImage({ transport: { fetch: stub.fetch }, now, onStage: (s) => { if (s === "generating") t += 200_000; } }),
    isArtError("expired"),
  );
  assert.equal(stub.commits.length, 0, "nothing was committed under the expired position");
  t = 0;
  const retry = await createArtImage({ transport: { fetch: stub.fetch }, now });
  assert.equal(stub.commits.length, 1);
  assert.equal(stub.calls.filter((c) => c.includes("/api/fuse/allocate")).length, 2, "the retry opened its own position");
  assert.equal(retry.checks.regenerated.result, "TRUE");
});

test("a failed recording is reported as one, and nothing is called made", async () => {
  const stub = await makeStub();
  const failing: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/api/fuse/commit")) return Response.json({ error: "the boundary refused the commit" }, { status: 500 });
    return stub.fetch(input, init);
  };
  await assert.rejects(createArtImage({ transport: { fetch: failing } }), isArtError("record-failed"));
});

test("a position the boundary already consumed reads as expired", async () => {
  const stub = await makeStub();
  const consumed: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/api/fuse/commit")) return Response.json({ error: "the position is no longer available", code: "slot-unavailable" }, { status: 409 });
    return stub.fetch(input, init);
  };
  await assert.rejects(createArtImage({ transport: { fetch: consumed, recoveryAttempts: 1, recoveryDelayMs: 1 } }), isArtError("expired"));
});

test("an allocation with no floor block, or a restarting enclave, is refused before anything is drawn", async () => {
  const noFloor = await makeStub({ noAnchor: true });
  const stages: ArtStage[] = [];
  await assert.rejects(createArtImage({ transport: { fetch: noFloor.fetch }, onStage: (s) => stages.push(s) }), isArtError("open-failed"));
  assert.deepEqual(stages, ["opening"], "no image is drawn without a position");

  const restarting: typeof fetch = async () => Response.json({ error: "the boundary is restarting", code: "tee-restarting" }, { status: 503 });
  await assert.rejects(createArtImage({ transport: { fetch: restarting } }), isArtError("tee-restarting"));
});

test("a proof under a different position is never accepted in place of this one", async () => {
  const stub = await makeStub();
  const swapped: typeof fetch = async (input, init) => {
    const res = await stub.fetch(input, init);
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.includes("/api/fuse/commit") || res.status !== 200) return res;
    const j = (await res.json()) as { proof: { slotAllocation: { nonceB64: string } } };
    j.proof.slotAllocation = { ...j.proof.slotAllocation, nonceB64: bytesToBase64(sha256(new TextEncoder().encode("another position"))) };
    return Response.json(j);
  };
  await assert.rejects(createArtImage({ transport: { fetch: swapped } }), isArtError("record-failed"));
});

test("a file with no proof block is not reported as verified", async () => {
  const stub = await makeStub();
  const made = await createArtImage({ transport: { fetch: stub.fetch } });
  const r = await verifyArtFile(made.png, []);
  assert.equal(r.overall, "failed");
  assert.notEqual(r.protocol.result, "TRUE");
});

test("the proof page can rebuild the exact recorded file from the proof alone, and nothing else", async () => {
  const stub = await makeStub();
  const made = await createArtImage({ transport: { fetch: stub.fetch } });
  const r = await redrawRecordedArt(made.proof);
  assert.ok(r, "a version 2 image is rebuilt from its proof");
  assert.equal(bytesToBase64(sha256(r!.png)), made.digestB64, "byte for byte the recorded file");
  // A proof whose digest is not a drawing of its commitment gives nothing to show.
  const other = { ...made.proof, artifact: { ...made.proof.artifact, digestB64: bytesToBase64(sha256(new TextEncoder().encode("not an image"))) } };
  assert.equal(await redrawRecordedArt(other), null);
  const notInline = { ...made.proof, attribution: { name: "bitgraph-fuse/2", title: "tree/1" } };
  assert.equal(await redrawRecordedArt(notInline as never), null);
});

test("coming back: the made image is rebuilt from its proof alone, the same bytes and the same code", async () => {
  const { restoreArtImage } = await import("../art-position.ts");
  const stub = await makeStub();
  const made = await createArtImage({ transport: { fetch: stub.fetch } });
  const back = await restoreArtImage(made.proof);
  assert.ok(back);
  assert.equal(back!.digestB64, made.digestB64);
  assert.equal(bytesToBase64(sha256(back!.png)), made.digestB64);
  assert.equal(back!.position.commitment, made.position.commitment);
  assert.equal(back!.position.slotCounter, made.position.slotCounter);
  assert.equal(back!.manifest.algorithm, made.manifest.algorithm);
  // A proof whose digest is not a drawing of its commitment rebuilds nothing.
  const other = { ...made.proof, artifact: { ...made.proof.artifact, digestB64: bytesToBase64(sha256(new TextEncoder().encode("not an image"))) } };
  assert.equal(await restoreArtImage(other), null);
});
