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

test("the verifier's published images are the newest spec's section 16 table, in order, then the images published after it", () => {
  // SPEC v2 cannot list enclave v10: v10's image embeds the verifier, which pins
  // SPEC v2's hash, so the spec is final before that image exists (SPEC v2
  // section 16). Images after the table are published by the means section 5.6
  // names (PINS.md, this list); each must appear in PINS.md.
  const spec = readFileSync(here("../../spec/SPEC-v2.md"), "utf8");
  const section = spec.slice(spec.indexOf("Published enclave measurements (PCR0):"), spec.indexOf("## 17."));
  const rows = [...section.matchAll(/^\| (\S+) \| (\d{4}-\d{2}-\d{2}) \| `([0-9a-f]{96})` \|$/gm)].map((m) => ({ version: m[1], since: m[2], pcr0: m[3] }));
  assert.ok(rows.length >= 8, "the table was read");
  assert.deepEqual(PUBLISHED_ENCLAVE_MEASUREMENTS.slice(0, rows.length).map((m) => ({ ...m })), rows);
  const after = PUBLISHED_ENCLAVE_MEASUREMENTS.slice(rows.length);
  assert.ok(after.every((m) => m.version !== "v9" && Number(m.version.slice(1)) >= 10), "only images made after SPEC v2 are past its table");
  const pins = readFileSync(here("../../server/commit-service/reproducible-build/PINS.md"), "utf8");
  for (const m of after) assert.ok(pins.includes(m.pcr0), `PINS.md publishes ${m.version}`);
  const v1 = readFileSync(here("../../spec/SPEC.md"), "utf8");
  const v1Rows = [...v1.slice(v1.indexOf("Published enclave measurements (PCR0):"), v1.indexOf("## 17.")).matchAll(/^\| (\S+) \| (\d{4}-\d{2}-\d{2}) \| `([0-9a-f]{96})` \|$/gm)].map((m) => m[3]);
  assert.deepEqual(rows.map((r) => r.pcr0), v1Rows, "SPEC v2's table is v1's, unchanged");
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
