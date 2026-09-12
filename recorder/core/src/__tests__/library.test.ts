// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

import { describe, test } from "node:test";
import * as assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ledger, listDay, search, holdsRecordings } from "../library.js";

/** A library of three days, written by hand: the directory names ARE the listing. */
function library(): string {
  const lib = mkdtempSync(join(tmpdir(), "bg-library-"));
  const recording = (day: string, name: string, files: string[], at: Date, waiting = false) => {
    const dir = join(lib, day, name);
    mkdirSync(dir, { recursive: true });
    for (const f of files) writeFileSync(join(dir, f), "x");
    writeFileSync(join(dir, "proof.json"), "{}");
    utimesSync(join(dir, "proof.json"), at, at);
    if (waiting) writeFileSync(join(dir, "anchors-status.json"), "{}");
  };
  recording("2026-09-09", "BitGraph (IMG_4021.png)", ["IMG_4021.png"], new Date("2026-09-09T13:04:11Z"));
  recording("2026-09-09", "BitGraph (Photos 2026, 2 files)", ["a.jpg", "b.jpg"], new Date("2026-09-09T15:48:02Z"), true);
  recording("2026-09-03", "BitGraph (Exports, 1 file)", ["e.pdf"], new Date("2026-09-03T21:15:40Z"));
  recording("2026-08-28", "BitGraph (img_0001.CR3)", ["img_0001.CR3"], new Date("2026-08-28T09:00:00Z"));
  mkdirSync(join(lib, "2026-08-01")); // an empty day is not a day
  mkdirSync(join(lib, "not-a-day", "BitGraph (stray)"), { recursive: true });
  return lib;
}

describe("the ledger reads the folders", () => {
  test("the spine is every day with something in it, newest first", async () => {
    const spine = await ledger(library());
    assert.deepEqual(spine.days, [
      { day: "2026-09-09", count: 2 },
      { day: "2026-09-03", count: 1 },
      { day: "2026-08-28", count: 1 },
    ]);
    assert.equal(spine.total, 4);
  });

  test("a day drilled out reads in the order it was made", async () => {
    const day = await listDay(library(), "2026-09-09");
    assert.deepEqual(day.map((r) => r.name), ["BitGraph (IMG_4021.png)", "BitGraph (Photos 2026, 2 files)"]);
    assert.deepEqual(day.map((r) => r.files), [1, 2]);
    assert.deepEqual(day.map((r) => r.waitingOnAnchors), [false, true]);
  });
});

describe("a search finds recordings by name", () => {
  test("case-insensitively, newest first, across every day", async () => {
    const found = await search(library(), "img");
    assert.deepEqual(found.recordings.map((r) => [r.day, r.name]), [
      ["2026-09-09", "BitGraph (IMG_4021.png)"],
      ["2026-08-28", "BitGraph (img_0001.CR3)"],
    ]);
    assert.equal(found.truncated, false);
    assert.equal(found.query, "img");
  });

  test("a day's name matches everything in it", async () => {
    const found = await search(library(), "09-09");
    assert.deepEqual(found.recordings.map((r) => r.name), ["BitGraph (Photos 2026, 2 files)", "BitGraph (IMG_4021.png)"]);
  });

  test("nothing matches nothing, and blank asks for nothing", async () => {
    assert.deepEqual((await search(library(), "zzz")).recordings, []);
    assert.deepEqual((await search(library(), "   ")).recordings, []);
    assert.deepEqual((await search("/nowhere/at/all", "img")).recordings, []);
  });

  test("past the limit it says it stopped", async () => {
    const found = await search(library(), "bitgraph", undefined, 2);
    assert.equal(found.recordings.length, 2);
    assert.equal(found.truncated, true);
  });
});

describe("a folder of BitGraphs is told from a folder of files", () => {
  test("a recording, a day, a library: yes. A folder of plain files: no", async () => {
    const lib = library();
    assert.equal(await holdsRecordings(join(lib, "2026-09-09", "BitGraph (IMG_4021.png)")), true, "a recording");
    assert.equal(await holdsRecordings(join(lib, "2026-09-09")), true, "a day");
    assert.equal(await holdsRecordings(lib), true, "the library");
    const plain = mkdtempSync(join(tmpdir(), "bg-plain-"));
    mkdirSync(join(plain, "sub"));
    writeFileSync(join(plain, "a.jpg"), "x");
    writeFileSync(join(plain, "sub", "b.jpg"), "x");
    assert.equal(await holdsRecordings(plain), false);
    assert.equal(await holdsRecordings("/nowhere/at/all"), false);
  });

  test("evidence beside files counts too, and the look stops two levels down", async () => {
    const side = mkdtempSync(join(tmpdir(), "bg-side-"));
    writeFileSync(join(side, "a.jpg"), "x");
    writeFileSync(join(side, "a.jpg.bitgraph"), "{}");
    assert.equal(await holdsRecordings(side), true);
    const deep = mkdtempSync(join(tmpdir(), "bg-deep-"));
    mkdirSync(join(deep, "a", "b", "c"), { recursive: true });
    writeFileSync(join(deep, "a", "b", "c", "proof.json"), "{}");
    assert.equal(await holdsRecordings(deep), false, "three levels down is a folder of folders, not a folder of BitGraphs");
  });
});
