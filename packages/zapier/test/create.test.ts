// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * Create BitGraph.
 *
 * The theme running through these is that a recording is permanent, so the
 * step's failure modes matter more than its happy path: it must never mint
 * twice for one file, never report a recording it cannot confirm, and never
 * fail after minting in a way that invites the user to re-run and mint again.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import createBitGraph from "../src/creates/create-bitgraph";
import {
  EXAMPLE_DIGEST_B64,
  EXAMPLE_DIGEST_URLSAFE,
  bundleOf,
  fakeZ,
  route,
} from "./helpers";

const perform = createBitGraph.operation.perform;
const FILE_URL = "https://files.example.test/contract.pdf";

/** Bytes whose SHA-256 is the example digest cannot be conjured, so tests that
 * hash a file use their own bytes and stub the lookup keyed to that digest. */
const FILE_BYTES = Buffer.from("a signed contract");
const FILE_DIGEST_B64 = createHash("sha256").update(FILE_BYTES).digest("base64");
const FILE_DIGEST_URLSAFE = FILE_DIGEST_B64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

test("a file already on record is returned, not recorded again", async () => {
  const { z, requests } = fakeZ([route.fileBytes(FILE_BYTES), route.batchFound(), route.detail()]);
  const result = await perform(z, bundleOf({ file: FILE_URL, digest: "", recordAgain: false }));

  assert.equal(result.outcome, "on record");
  assert.equal(result.recorded, false);
  assert.ok(
    !requests.some((r) => r.url.endsWith("/api/commit")),
    "a file already on record must not reach the commit endpoint at all"
  );
  assert.equal(result.counter, "7910");
  assert.equal(result.epochId, "EQmlm7sZsGZeYmKlgVU6k0qd6cj79bsmhzhlzxlMF7o=");
  assert.equal(result.chainId, "bitgraph:main");
  assert.equal(result.fileBytes, FILE_BYTES.length);
});

test("a file not yet on record is recorded, and only its digest is sent", async () => {
  const { z, requests } = fakeZ([route.fileBytes(FILE_BYTES), route.batchEmpty(), route.commitOk(), route.detail()]);
  const result = await perform(z, bundleOf({ file: FILE_URL, recordAgain: false }));

  assert.equal(result.outcome, "recorded");
  assert.equal(result.recorded, true);

  const commit = requests.find((r) => r.url.endsWith("/api/commit"));
  assert.ok(commit, "the commit endpoint was called");
  assert.deepEqual(commit.body, {
    digests: [{ digestB64: FILE_DIGEST_B64, hashAlg: "sha256" }],
    chainId: "bitgraph:main",
  });

  // The whole privacy claim in one assertion: no request body anywhere in the
  // flow contains the file's bytes.
  const wire = JSON.stringify(requests.map((r) => r.body));
  assert.ok(!wire.includes(FILE_BYTES.toString("utf8")), "file contents must never appear on the wire");
  assert.ok(!wire.includes(FILE_BYTES.toString("base64")), "not even base64-encoded");
});

test("Record Again mints a second position for bytes already on record", async () => {
  const { z, requests } = fakeZ([route.fileBytes(FILE_BYTES), route.batchFound(), route.commitOk(), route.detail()]);
  const result = await perform(z, bundleOf({ file: FILE_URL, recordAgain: true }));

  assert.equal(result.recorded, true);
  assert.ok(requests.some((r) => r.url.endsWith("/api/commit")));
});

test("the API key rides on the write and not on the reads", async () => {
  const { z, requests } = fakeZ([route.fileBytes(FILE_BYTES), route.batchEmpty(), route.commitOk(), route.detail()]);
  await perform(z, bundleOf({ file: FILE_URL }));

  const commit = requests.find((r) => r.url.endsWith("/api/commit"));
  assert.equal(commit?.headers["Authorization"], "Bearer test-key");
  const detail = requests.find((r) => r.url.includes("/api/proofs/digest/"));
  assert.equal(detail?.headers["Authorization"], undefined, "reads carry no credential");
});

test("a precomputed hex digest is accepted and normalized to base64 on the wire", async () => {
  const hex = Buffer.from(EXAMPLE_DIGEST_B64, "base64").toString("hex");
  const { z, requests } = fakeZ([route.batchEmpty(), route.commitOk(), route.detail()]);
  const result = await perform(z, bundleOf({ digest: hex }));

  const commit = requests.find((r) => r.url.endsWith("/api/commit"));
  assert.deepEqual((commit?.body as { digests: unknown[] }).digests, [
    { digestB64: EXAMPLE_DIGEST_B64, hashAlg: "sha256" },
  ]);
  assert.equal(result.artifactHash, EXAMPLE_DIGEST_B64);
  assert.equal(result.artifactHashUrlSafe, EXAMPLE_DIGEST_URLSAFE);
  assert.equal(result.fileBytes, null, "nothing was read, so nothing is claimed to have been");
});

test("attribution is forwarded only when something was actually filled in", async () => {
  const withNote = fakeZ([route.batchEmpty(), route.commitOk(), route.detail()]);
  await perform(
    withNote.z,
    bundleOf({ digest: EXAMPLE_DIGEST_B64, attributionName: "Acme Legal", attributionMessage: "Executed copy" })
  );
  const body = withNote.requests.find((r) => r.url.endsWith("/api/commit"))?.body as Record<string, unknown>;
  assert.deepEqual(body["attribution"], { name: "Acme Legal", message: "Executed copy" });

  const without = fakeZ([route.batchEmpty(), route.commitOk(), route.detail()]);
  await perform(without.z, bundleOf({ digest: EXAMPLE_DIGEST_B64 }));
  const bare = without.requests.find((r) => r.url.endsWith("/api/commit"))?.body as Record<string, unknown>;
  assert.ok(!("attribution" in bare), "an empty note is omitted rather than sent as an empty object");
});

test("giving both a file and a digest is refused rather than guessed at", async () => {
  const { z } = fakeZ([route.batchEmpty()]);
  await assert.rejects(
    perform(z, bundleOf({ file: FILE_URL, digest: EXAMPLE_DIGEST_B64 })),
    /not both/
  );
});

test("giving neither is refused", async () => {
  const { z } = fakeZ([route.batchEmpty()]);
  await assert.rejects(perform(z, bundleOf({})), /Provide a File to BitGraph/);
});

test("a 200 carrying no proof is a failure, not a silent success", async () => {
  const { z } = fakeZ([route.batchEmpty(), route.commitStatus(200, []), route.detail()]);
  await assert.rejects(
    perform(z, bundleOf({ digest: EXAMPLE_DIGEST_B64 })),
    /returned no proof/,
    "claiming a recording that cannot be confirmed is worse than failing"
  );
});

test("the epoch rotation window becomes a retry rather than a failed Zap", async () => {
  const { z } = fakeZ([
    route.batchEmpty(),
    route.commitStatus(503, { error: "The camera is restarting", code: "tee-restarting" }),
  ]);
  // Nothing is minted when the anchor-first gate fires, so retrying is safe.
  await assert.rejects(perform(z, bundleOf({ digest: EXAMPLE_DIGEST_B64 })), (err: Error) => {
    assert.match(err.message, /between epochs/);
    assert.match(err.message, /Nothing was recorded/);
    assert.equal((err as { delay?: number }).delay, 90, "raised as a throttle so Zapier re-runs the step");
    return true;
  });
});

test("a rate limit is also a retry, and says nothing was recorded", async () => {
  const { z } = fakeZ([route.batchEmpty(), route.commitStatus(429, { error: "Too many digests" })]);
  await assert.rejects(perform(z, bundleOf({ digest: EXAMPLE_DIGEST_B64 })), /Nothing was recorded/);
});

test("a bad key is reported as an auth problem, not a generic failure", async () => {
  const { z } = fakeZ([route.batchEmpty(), route.commitStatus(401, { error: "Unauthorized" })]);
  await assert.rejects(perform(z, bundleOf({ digest: EXAMPLE_DIGEST_B64 })), /Reconnect the BitGraph account/);
});

test("a failed anchor lookup after minting does not fail the step", async () => {
  // The recording is already permanent at this point. Failing here would push
  // the user to re-run and mint a second position for the same bytes.
  const { z } = fakeZ([
    route.batchEmpty(),
    route.commitOk(),
    (req) => (req.url.includes("/api/proofs/digest/") ? { status: 500, data: { error: "Failed" } } : undefined),
  ]);
  const result = await perform(z, bundleOf({ digest: EXAMPLE_DIGEST_B64 }));

  assert.equal(result.recorded, true, "the recording still happened and is still reported");
  assert.equal(result.proofUrl.includes(EXAMPLE_DIGEST_URLSAFE), true);
  assert.equal(result.bitgraphedAfter, null, "unknown time bounds are null, never invented");
  assert.equal(result.causalWindow, null);
  assert.equal(result.anchorSettled, false);
});

test("a fresh recording reports the lower bound and an unsettled upper bound", async () => {
  // The state every real recording passes through: the epoch's previous anchor
  // gives a true lower bound immediately, the upper one lands a minute later.
  const { z } = fakeZ([
    route.batchEmpty(),
    route.commitOk(),
    (req) =>
      req.url.includes("/api/proofs/digest/")
        ? {
            status: 200,
            data: {
              proofs: [{ proof: {} }],
              positions: [{ counter: "7910", epoch: "x", lowerTime: "2026-07-29T16:54:11.000Z", upperTime: null }],
              causalWindow: {
                anchorBefore: { blockNumber: 25639816, blockTime: "2026-07-29T16:54:11.000Z", etherscanUrl: "https://etherscan.io/block/25639816" },
                anchorAfter: null,
              },
            },
          }
        : undefined,
  ]);
  const result = await perform(z, bundleOf({ digest: EXAMPLE_DIGEST_B64 }));

  assert.equal(result.bitgraphedAfter, "2026-07-29T16:54:11.000Z");
  assert.equal(result.bitgraphedBefore, null);
  assert.equal(result.anchorSettled, false);
  assert.match(result.causalWindow ?? "", /waiting on the next Ethereum anchor/);
});

test("the file URL is fetched but its bytes are never held past hashing", async () => {
  const big = Buffer.alloc(3 * 1024 * 1024, 7);
  const { z, requests } = fakeZ([route.fileBytes(big), route.batchEmpty(), route.commitOk(), route.detail()]);
  const result = await perform(z, bundleOf({ file: FILE_URL }));

  assert.equal(result.fileBytes, big.length);
  const commit = requests.find((r) => r.url.endsWith("/api/commit"));
  assert.equal(JSON.stringify(commit?.body).length < 200, true, "the commit body stays digest-sized");
});

void FILE_DIGEST_URLSAFE;
