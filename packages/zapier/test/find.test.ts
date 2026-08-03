// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * Retrieve Proof. Read-only by construction: a search that could write would
 * be a contradiction, so the suite asserts it as well as testing the lookups.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import findProof from "../src/searches/find-proof";
import { EXAMPLE_DIGEST_B64, EXAMPLE_DIGEST_URLSAFE, bundleOf, fakeZ, route } from "./helpers";

const perform = findProof.operation.perform;

test("looking up by digest returns one result with its causal positions", async () => {
  const { z } = fakeZ([route.detail()]);
  const results = await perform(z, bundleOf({ digest: EXAMPLE_DIGEST_B64 }));

  assert.equal(results.length, 1);
  const [hit] = results;
  assert.equal(hit?.counter, "7910");
  assert.equal(hit?.chainId, "bitgraph:main");
  assert.equal(hit?.onRecord, true);
  assert.equal(hit?.totalPositions, 2, "the same bytes recorded twice are two positions, not a duplicate");
  assert.equal(hit?.positions.length, 2);
  assert.match(hit?.proofUrl ?? "", new RegExp(EXAMPLE_DIGEST_URLSAFE));
});

test("looking up by BitGraph number resolves through search, then pins that position", async () => {
  const { z, requests } = fakeZ([
    route.search({ found: true, digest: EXAMPLE_DIGEST_URLSAFE, counter: "7910" }),
    route.detail(),
  ]);
  const results = await perform(z, bundleOf({ number: "#7,910" }));

  assert.equal(results.length, 1);
  const detailCall = requests.find((r) => r.url.includes("/api/proofs/digest/"));
  assert.match(detailCall?.url ?? "", /counter=7910/, "the number names one recording, so the lookup pins it");
});

test("a number that does not resolve is an empty result, not an error", async () => {
  // Counters reset each epoch and epochs rotate daily, so a number that worked
  // yesterday can legitimately find nothing today. Zapier searches express
  // that as no results.
  const { z } = fakeZ([route.search({ found: false })]);
  assert.deepEqual(await perform(z, bundleOf({ number: "999999999" })), []);
});

test("a digest with no proof is an empty result", async () => {
  const { z } = fakeZ([route.detailEmpty()]);
  assert.deepEqual(await perform(z, bundleOf({ digest: EXAMPLE_DIGEST_B64 })), []);
});

test("looking up by file hashes locally and sends only the digest", async () => {
  const bytes = Buffer.from("quarterly report");
  const expected = createHash("sha256").update(bytes).digest("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const { z, requests } = fakeZ([route.fileBytes(bytes), route.detail()]);
  await perform(z, bundleOf({ file: "https://files.example.test/q3.pdf" }));

  const lookup = requests.find((r) => r.url.includes("/api/proofs/digest/"));
  assert.match(lookup?.url ?? "", new RegExp(expected), "the URL carries the digest, never the bytes");
});

test("exactly one lookup key is required", async () => {
  const { z } = fakeZ([route.detail()]);
  await assert.rejects(perform(z, bundleOf({})), /exactly one/);
  await assert.rejects(
    perform(z, bundleOf({ digest: EXAMPLE_DIGEST_B64, number: "7910" })),
    /exactly one/
  );
});

test("an epoch given in either base64 form reaches the API url-safe", async () => {
  const { z, requests } = fakeZ([route.detail()]);
  await perform(
    z,
    bundleOf({ digest: EXAMPLE_DIGEST_B64, counter: "7910", epoch: "EQmlm7sZsGZeYmKlgVU6k0qd6cj79bsmhzhlzxlMF7o=" })
  );
  const url = requests.find((r) => r.url.includes("/api/proofs/digest/"))?.url ?? "";
  assert.ok(url.includes("epoch=EQmlm7sZsGZeYmKlgVU6k0qd6cj79bsmhzhlzxlMF7o"), url);
  assert.ok(!url.includes("%3D"), "the padded form must not leak into the query");
});

test("retrieving never writes", async () => {
  const { z, requests } = fakeZ([route.detail()]);
  await perform(z, bundleOf({ digest: EXAMPLE_DIGEST_B64 }));
  assert.ok(requests.every((r) => r.method === "GET"), "a lookup issues reads only");
});
