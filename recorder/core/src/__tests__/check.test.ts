// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * The offline check over a real recording, and over folders that hold one.
 *
 * The fixture is a BitGraph made through the hosted MCP on 2026-09-13: an SVG
 * whose bytes carry the slot commitment inside them (the task shape: the slot
 * was opened first, the picture was made with the commitment in it, then the
 * digest was committed), with its proof and both Ethereum anchors. Signed by
 * enclave v8, so the check runs against the measurement this build ships.
 * Nothing here reaches the network.
 */

import { describe as suite, test, before } from "node:test";
import * as assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, readFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkFolder, Checker } from "../check.js";
import { scanFile } from "../hash.js";

const FIX = fileURLToPath(new URL("../../src/__tests__/fixtures/inline-carry/circles-drop/", import.meta.url));

suite("a file that carries its commitment inside its bytes", () => {
  test("its recording folder checks itself, and the pass carries the verifier's limit", async () => {
    const report = await checkFolder(FIX, { everyRow: true });
    assert.deepEqual(report.counts, { verified: 1, failed: 0, undetermined: 0, unrecorded: 0 }, JSON.stringify(report.speaking));
    const [row] = report.speaking;
    assert.equal(row!.rel, "circles.svg");
    assert.equal(row!.status, "verified");
    assert.equal(row!.category, "CARRIED_INLINE");
    assert.equal(row!.method, "verifier");
    assert.equal(row!.position?.counter, "2406");
    assert.match(row!.limit ?? "", /commitment/i, "the limit is stated, not left to inference");
    assert.equal(row!.evidencePath, join(FIX, "proof.json"));
    /* Both anchors are in the folder, and each block header was checked against the hash its anchor signed. */
    assert.equal(row!.bounds?.length, 2);
    for (const side of row!.bounds ?? []) assert.equal(typeof side.blockTime, "string", JSON.stringify(side));
  });

  test("the recording's own files are not files somebody recorded", async () => {
    const report = await checkFolder(FIX);
    assert.equal(report.counts.unrecorded, 0, "proof.json and the anchors are not counted");
    assert.deepEqual(report.speaking, [], "a verified file does not speak");
  });

  test("a changed file is not what the recording is about, and it says so without accusing anybody", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bg-inline-tamper-"));
    cpSync(FIX, dir, { recursive: true });
    const svg = readFileSync(join(dir, "circles.svg"), "utf8");
    assert.notEqual(svg.indexOf("<circle"), -1);
    writeFileSync(join(dir, "circles.svg"), svg.replace("<circle", "<circle data-x=\"1\""));
    const report = await checkFolder(dir, { everyRow: true });
    /* ⚠️ Bytes alone cannot tell altered from never recorded, so this is
     * UNRECORDED, never FAILED. What can be said is that the recording in
     * this folder is about different bytes. */
    assert.deepEqual(report.counts, { verified: 0, failed: 0, undetermined: 0, unrecorded: 1 }, JSON.stringify(report.speaking));
    assert.match(report.speaking[0]!.reason ?? "", /different bytes/);
  });
});

suite("recordings are read wherever they sit", () => {
  let mixed: string;
  before(() => {
    /* A folder holding a picture, a copy of it, a note, and the recording of
     * the picture one level down: the shape Mike dropped on 2026-09-13. */
    mixed = mkdtempSync(join(tmpdir(), "bg-mixed-"));
    cpSync(FIX, join(mixed, "circles-drop"), { recursive: true });
    copyFileSync(join(FIX, "circles.svg"), join(mixed, "circles.svg"));
    writeFileSync(join(mixed, "note.txt"), "made with the commitment inside\n");
    mkdirSync(join(mixed, "deeper", "still"), { recursive: true });
    cpSync(FIX, join(mixed, "deeper", "still", "again"), { recursive: true });
  });

  test("a recording one level down answers for its file, and for a copy of its bytes anywhere in the folder", async () => {
    const report = await checkFolder(mixed, { everyRow: true });
    const by = new Map(report.speaking.map((r) => [r.rel, r]));
    assert.equal(by.get("circles-drop/circles.svg")?.status, "verified", "the file in its recording");
    assert.equal(by.get("circles.svg")?.status, "verified", "the copy at the top, by content");
    assert.equal(by.get("circles.svg")?.evidencePath, join(mixed, "circles-drop", "proof.json"), "answered by a recording it does not sit in");
    assert.equal(by.get("deeper/still/again/circles.svg")?.status, "verified", "three levels down");
    assert.equal(by.get("note.txt")?.status, "unrecorded");
    assert.deepEqual(report.counts, { verified: 3, failed: 0, undetermined: 0, unrecorded: 1 }, JSON.stringify([...by.keys()]));
  });

  test("the checker says which files a recording covers and which are the recording's own", async () => {
    const checker = await Checker.open(mixed);
    checker.noteBundles([join(mixed, "circles-drop", "proof.json")]);
    assert.equal(checker.recordings, 1);
    assert.equal(await checker.isRecordingOwn(join(mixed, "circles-drop", "proof.json")), true);
    assert.equal(await checker.isRecordingOwn(join(mixed, "circles-drop", "ethereum-anchors", "anchor-before.json")), true);
    assert.equal(await checker.isRecordingOwn(join(mixed, "circles-drop", "circles.svg")), false);
    assert.equal(await checker.isRecordingOwn(join(mixed, "note.txt")), false);
    const svg = await scanFile(join(mixed, "circles.svg"), "circles.svg");
    const note = await scanFile(join(mixed, "note.txt"), "note.txt");
    assert.equal(await checker.covered(svg.path, Buffer.from(svg.originDigest).toString("base64")), true);
    assert.equal(await checker.covered(note.path, Buffer.from(note.originDigest).toString("base64")), false);
  });
});
