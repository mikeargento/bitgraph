// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

import { describe, test } from "node:test";
import * as assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FolderIndex, INDEX_ROW_VERSION, type IndexRow } from "../index-store.js";
import { parseEvidence, writeJsonAtomic, EVIDENCE_VERSION } from "../evidence.js";
import { pathsFor, relativeEvidencePath, positionSegments } from "../paths.js";

const dir = () => mkdtempSync(join(tmpdir(), "bg-store-"));
const row = (over: Partial<IndexRow> = {}): IndexRow => ({
  v: INDEX_ROW_VERSION,
  originDigestB64: "AAAA",
  artifactDigestB64: "BBBB",
  name: "a.jpg",
  rel: "a.jpg",
  bytes: 10,
  mtimeMs: 1234,
  placement: "trailer/1",
  epochId: "e",
  counter: "1",
  evidence: "a.jpg.bitgraph",
  set: null,
  recordedAt: "now",
  ...over,
});

describe("the index is an index", () => {
  test("rows come back by content, and a position is (epoch, counter)", async () => {
    const path = join(dir(), "index.jsonl");
    const idx = await FolderIndex.open(path);
    await idx.append([row(), row({ originDigestB64: "CCCC", counter: "2" }), row({ originDigestB64: "DDDD", epochId: "e2", counter: "1" })]);
    assert.equal(idx.has("AAAA"), true);
    assert.equal(idx.has("ZZZZ"), false);
    assert.equal(idx.fileCount, 3);
    assert.equal(idx.positions.size, 3, "counter 1 in two different epochs is two positions, not one");
    assert.deepEqual(idx.positionList.find((p) => p.epochId === "e2"), { epochId: "e2", counter: "1" });
  });

  test("a torn last line is counted and everything before it stands", async () => {
    const path = join(dir(), "index.jsonl");
    const idx = await FolderIndex.open(path);
    await idx.append([row(), row({ originDigestB64: "CCCC" })]);
    appendFileSync(path, '{"v":"bitgraph-index/1","originDigestB64":"EEE');
    const reopened = await FolderIndex.open(path);
    assert.equal(reopened.fileCount, 2, "the rows before the crash are not lost");
    assert.equal(reopened.damagedLines, 1, "and the damage is a count the reader can act on");
  });

  test("the sweep's cache key is size AND mtime", async () => {
    const path = join(dir(), "index.jsonl");
    const idx = await FolderIndex.open(path);
    await idx.append([row({ rel: "photo.jpg", bytes: 100, mtimeMs: 500 })]);
    assert.equal(idx.settled("photo.jpg", 100, 500), true);
    assert.equal(idx.settled("photo.jpg", 100, 501), false, "a rewritten file is looked at again");
    assert.equal(idx.settled("photo.jpg", 101, 500), false);
    assert.equal(idx.settled("other.jpg", 100, 500), false);
  });

  test("a row from a version this build does not know is skipped, not guessed at", async () => {
    const path = join(dir(), "index.jsonl");
    writeFileSync(path, `${JSON.stringify({ ...row(), v: "bitgraph-index/99" })}\n${JSON.stringify(row())}\n`);
    const idx = await FolderIndex.open(path);
    assert.equal(idx.fileCount, 1);
    assert.equal(idx.damagedLines, 1);
  });
});

describe("evidence on disk", () => {
  test("a write is all there or not there at all", async () => {
    const d = dir();
    const path = join(d, "deep", "nested", "thing.json");
    await writeJsonAtomic(path, { hello: "world" });
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { hello: "world" });
    await writeJsonAtomic(path, { hello: "again" });
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { hello: "again" }, "it replaces cleanly");
  });

  test("anything that is not this version of evidence is refused rather than half-read", () => {
    assert.equal(parseEvidence("not json"), null);
    assert.equal(parseEvidence("[]"), null);
    assert.equal(parseEvidence(JSON.stringify({ version: "something-else" })), null);
    assert.equal(parseEvidence(JSON.stringify({ version: EVIDENCE_VERSION })), null, "a version alone is not evidence");
    const good = {
      version: EVIDENCE_VERSION,
      file: { name: "a", bytes: 1 },
      placement: "trailer/1",
      originDigestB64: "AA",
      artifactDigestB64: "BB",
      position: { epochId: "e", counter: "1" },
      proof: { kind: "inline", proof: {} },
      writtenAt: "now",
    };
    assert.notEqual(parseEvidence(JSON.stringify(good)), null);
  });
});

describe("where things go", () => {
  test("the BitGraphs folder mirrors the folder it watches", () => {
    assert.equal(relativeEvidencePath("IMG_1.CR3"), "IMG_1.CR3.bitgraph");
    assert.equal(relativeEvidencePath("raw/IMG_1.CR3"), "raw/IMG_1.CR3.bitgraph");
    assert.equal(relativeEvidencePath("a/b/c.jpg"), "a/b/c.jpg.bitgraph");
  });

  test("the extension is kept, so two files with one stem do not collide", () => {
    assert.notEqual(relativeEvidencePath("IMG_1.CR3"), relativeEvidencePath("IMG_1.JPG"));
  });

  test("nothing can climb out of the folder", () => {
    assert.throws(() => relativeEvidencePath("../outside.jpg"));
    assert.throws(() => relativeEvidencePath("a/../../outside.jpg"));
    assert.throws(() => relativeEvidencePath(""));
  });

  test("a position's directory is epoch AND counter, and the epoch is made path-safe", () => {
    const [epoch, counter] = positionSegments("a/b+c==", "1546");
    assert.equal(epoch, "a_b-c");
    assert.equal(counter, "1546");
    assert.ok(!epoch.includes("/"), "a slash in an epoch id would silently make a directory level");
  });

  test("a counter that is not digits is refused, because it would be a path", () => {
    assert.throws(() => positionSegments("e", "../../etc"));
    assert.throws(() => positionSegments("e", "12a"));
  });

  test("two epochs with the same counter get different directories", () => {
    const p = pathsFor("/root");
    assert.notEqual(p.position("epoch-one", "1546"), p.position("epoch-two", "1546"));
  });
});
