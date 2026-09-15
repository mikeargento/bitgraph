// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * The positions around a recording.
 *
 * Two things this exists to get right, both of them learned on 2026-09-13
 * reconstructing one drop by hand:
 *
 *   1. THE FLOOR IS NOT ALWAYS THE ANCHOR BEFORE. The floor is fixed when the
 *      SLOT opens; `anchor-before` is the anchor before the COMMIT. They are
 *      the same whenever the two positions are adjacent and different the
 *      moment anything lands in between. Both are true about different events,
 *      so the strip marks the floor on its own row and never shows the pair as
 *      if they disagreed.
 *
 *   2. A GAP IS NAMED AS A GAP. A counter nothing accounts for is emitted, not
 *      skipped, because a strip that closes up silently claims the positions
 *      were adjacent.
 *
 * Nothing here reaches the network: the whole point of the strip is that a
 * folder can draw it with the bytes already beside the file.
 */

import { suite, test } from "node:test";
import * as assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkFolder, type NeighbourRow } from "../check.js";

const FIX = fileURLToPath(new URL("../../src/__tests__/fixtures/inline-carry/circles-drop/", import.meta.url));

const rowsOf = async (dir: string): Promise<NeighbourRow[]> => {
  const report = await checkFolder(dir, { everyRow: true });
  return report.speaking[0]?.neighbourhood ?? [];
};
const kinds = (rows: NeighbourRow[]): string => rows.map((r) => `${r.counter}:${r.kind}`).join(" ");

/** The fixture, copied so a test can move its counters without touching it. */
function copyFixture(): string {
  const dir = join(mkdtempSync(join(tmpdir(), "bg-nb-")), "drop");
  cpSync(FIX, dir, { recursive: true });
  return dir;
}

suite("the positions around a recording", () => {
  test("every position between the two anchors is named, in order", async () => {
    const rows = await rowsOf(copyFixture());
    assert.equal(
      kinds(rows),
      "2403:anchor-slot 2404:anchor 2405:mine-slot 2406:mine-commit 2407:anchor-slot 2408:anchor",
      "an anchor accounts for BOTH positions it took, not just its commit",
    );
  });

  test("an anchor carries its own BitGraph and its own block, and neither is fetched", async () => {
    const rows = await rowsOf(copyFixture());
    const anchor = rows.find((r) => r.counter === "2404")!;
    /* The address is SHA-256 of the block-hash STRING, which is what the
     * enclave requires of an anchor's artifact digest. Derived, never asked
     * for: this is the whole reason a floor can be linked at all. */
    assert.equal(anchor.proofUrl, "https://bitgraph.ing/proof/dhOzkbojBGoPaJ0zkty_nzi9Q56ICRu9HrBAw8Mhv6g");
    assert.equal(anchor.etherscanUrl, "https://etherscan.io/block/25966127");
    assert.equal(anchor.blockNumber, 25966127);
  });

  test("the floor is marked, and here it is also the anchor before", async () => {
    const rows = await rowsOf(copyFixture());
    assert.deepEqual(rows.filter((r) => r.floor === true).map((r) => r.counter), ["2404"]);
    /* Adjacent slot and commit, so the two coincide and the row carries the
     * verified block time as well as the floor mark. */
    assert.equal(typeof rows.find((r) => r.counter === "2404")!.blockTime, "string");
  });

  test("when the floor is NOT the anchor before, both are shown and only one is the floor", async () => {
    /* The 2026-09-13 shape: a set held its position while an anchor committed
     * inside the hold, so the floor (2404) sits BELOW the slot and the anchor
     * before the commit (2408) sits between the slot and the commit. */
    const dir = copyFixture();
    const proof = JSON.parse(readFileSync(join(dir, "proof.json"), "utf8")) as Record<string, Record<string, unknown>>;
    proof["commit"]!["counter"] = "2409";
    writeFileSync(join(dir, "proof.json"), JSON.stringify(proof));

    const rows = await rowsOf(dir);
    const floors = rows.filter((r) => r.floor === true).map((r) => r.counter);
    assert.deepEqual(floors, ["2404"], "the floor is the anchor the SLOT saw, not the one before the commit");

    const before = rows.find((r) => r.counter === "2408")!;
    assert.equal(before.kind, "anchor");
    assert.notEqual(before.floor, true, "the anchor before the commit is not a floor and must not be dressed as one");
    assert.equal(kinds(rows).includes("2405:mine-slot"), true);
    assert.equal(kinds(rows).includes("2409:mine-commit"), true);
  });

  test("a position nothing accounts for says so instead of closing the gap", async () => {
    const dir = copyFixture();
    const proof = JSON.parse(readFileSync(join(dir, "proof.json"), "utf8")) as Record<string, Record<string, unknown>>;
    proof["commit"]!["counter"] = "2409";
    writeFileSync(join(dir, "proof.json"), JSON.stringify(proof));
    const rows = await rowsOf(dir);
    /* 2406 is the old commit and nothing claims it now; it must appear. */
    const gap = rows.find((r) => r.counter === "2406")!;
    assert.equal(gap.kind, "unidentified");
  });

  test("an anchor named without a header says WHY it has no time", async () => {
    /* Move the floor to a position no bundled anchor covers. It can still be
     * named and linked from the signed field, but its block time was never
     * checked here, and a blank beside a block number reads as "this block has
     * no time", which is a different claim. */
    const dir = copyFixture();
    const proof = JSON.parse(readFileSync(join(dir, "proof.json"), "utf8")) as Record<string, Record<string, unknown>>;
    (proof["commit"]!["slotAnchor"] as Record<string, unknown>)["counter"] = "2401";
    writeFileSync(join(dir, "proof.json"), JSON.stringify(proof));

    const rows = await rowsOf(dir);
    const floor = rows.find((r) => r.counter === "2401")!;
    assert.equal(floor.floor, true);
    assert.equal(floor.blockTime, undefined);
    assert.match(floor.timeNote ?? "", /not checked here/, "the absence says which kind it is");
    assert.equal(typeof floor.proofUrl, "string", "it is still linkable: the address comes from the block hash");
  });

  test("a wildly wide span draws nothing rather than a misleading strip", async () => {
    const dir = copyFixture();
    const proof = JSON.parse(readFileSync(join(dir, "proof.json"), "utf8")) as Record<string, Record<string, unknown>>;
    proof["commit"]!["counter"] = "99999";
    writeFileSync(join(dir, "proof.json"), JSON.stringify(proof));
    assert.deepEqual(await rowsOf(dir), [], "no neighbourhood at all, never 97,000 rows");
  });
});
