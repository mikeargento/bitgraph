// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * BitGraph's published enclave images are written down in four places: the
 * spec's table (section 16), the verifier's default measurement policy, the
 * site's proof page and the player. An image added to one and not the others
 * would make one of them call a real BitGraph "not BitGraph's", so they are
 * checked against each other here, PCR0 for PCR0, in the same order.
 */

import { test } from "node:test";
import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PUBLISHED_ENCLAVE_MEASUREMENTS, PUBLISHED_PCR0S, publishedMeasurement } from "@mikeargento/bitgraph-verify";
import { KNOWN_ENCLAVE_MEASUREMENTS } from "@mikeargento/bitgraph-player";

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

test("the verifier's published images are the spec's section 16 table, in order", () => {
  const spec = readFileSync(here("../../spec/SPEC.md"), "utf8");
  const section = spec.slice(spec.indexOf("Published enclave measurements (PCR0):"), spec.indexOf("## 17."));
  const rows = [...section.matchAll(/^\| (\S+) \| (\d{4}-\d{2}-\d{2}) \| `([0-9a-f]{96})` \|$/gm)].map((m) => ({ version: m[1], since: m[2], pcr0: m[3] }));
  assert.ok(rows.length >= 8, "the table was read");
  assert.deepEqual(rows, PUBLISHED_ENCLAVE_MEASUREMENTS.map((m) => ({ ...m })));
  assert.deepEqual([...PUBLISHED_PCR0S], rows.map((r) => r.pcr0));
});

test("the site's proof page and the player carry the same images", () => {
  const site = readFileSync(here("../../website/src/lib/enclave-measurements.ts"), "utf8");
  const sitePcr0s = [...site.matchAll(/pcr0: "([0-9a-f]{96})"/g)].map((m) => m[1]);
  assert.deepEqual(sitePcr0s, [...PUBLISHED_PCR0S]);
  const player = KNOWN_ENCLAVE_MEASUREMENTS.map((m) => m.pcr0);
  assert.deepEqual(player.slice(-PUBLISHED_PCR0S.length), [...PUBLISHED_PCR0S], "the player lists every published image, newest last");
});

test("publishedMeasurement names an image by its PCR0, case-insensitively, and nothing else", () => {
  const v9 = PUBLISHED_ENCLAVE_MEASUREMENTS.at(-1)!;
  assert.equal(publishedMeasurement(v9.pcr0.toUpperCase())?.version, v9.version);
  assert.equal(publishedMeasurement("00".repeat(48)), null);
  assert.equal(publishedMeasurement(12345), null);
});
