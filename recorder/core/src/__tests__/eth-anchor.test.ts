// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

import { describe, test } from "node:test";
import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { verifyWitness } from "../eth-anchor.js";

const FIX = fileURLToPath(new URL("../../src/__tests__/fixtures/", import.meta.url));
const witness = JSON.parse(readFileSync(`${FIX}witness.json`, "utf8")) as Record<string, unknown>;
const anchor = JSON.parse(readFileSync(`${FIX}anchor.json`, "utf8")) as { attribution: { message: string } };

describe("the chain side of an anchor", () => {
  test("a real block header hashes to the hash the anchor signed, and its time comes out", () => {
    const v = verifyWitness(witness, anchor.attribution.message);
    assert.equal(v.ok, true, v.ok ? "" : v.reason);
    if (!v.ok) return;
    assert.equal(v.blockNumber, 25735831);
    assert.equal(v.blockHash, anchor.attribution.message.toLowerCase());
    // A real mainnet block, so a real date: sane, and not this machine's clock.
    assert.ok(v.blockTime.getTime() > Date.UTC(2020, 0, 1));
    assert.ok(v.blockTime.getTime() < Date.now() + 86_400_000);
  });

  test("a header that does not hash to the signed block hash is a CONTRADICTION, not a gap", () => {
    const v = verifyWitness(witness, "0x" + "11".repeat(32));
    assert.equal(v.ok, false);
    assert.equal(v.ok === false && v.kind, "contradicted");
    assert.match(v.ok === false ? v.reason : "", /hashes to/);
  });

  test("one flipped byte in the header is caught", () => {
    const hex = String(witness["headerRlpHex"]);
    const broken = { ...witness, headerRlpHex: hex.slice(0, 20) + (hex[20] === "a" ? "b" : "a") + hex.slice(21) };
    const v = verifyWitness(broken, anchor.attribution.message);
    assert.equal(v.ok, false);
    assert.equal(v.ok === false && v.kind, "contradicted");
  });

  test("a missing witness is UNDETERMINED and never a contradiction", () => {
    for (const bad of [null, undefined, {}, { headerRlpHex: "zz" }, { headerRlpHex: "" }]) {
      const v = verifyWitness(bad, anchor.attribution.message);
      assert.equal(v.ok, false);
      assert.equal(v.ok === false && v.kind, "undetermined", JSON.stringify(bad));
    }
  });

  test("no hash to check against is UNDETERMINED, not a pass", () => {
    const v = verifyWitness({ headerRlpHex: String(witness["headerRlpHex"]) }, null);
    assert.equal(v.ok, false);
    assert.equal(v.ok === false && v.kind, "undetermined");
  });

  test("a truncated header does not decode into a time", () => {
    const hex = String(witness["headerRlpHex"]);
    const v = verifyWitness({ ...witness, headerRlpHex: hex.slice(0, hex.length - 40) }, null);
    assert.equal(v.ok, false);
  });
});
