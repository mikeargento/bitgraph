// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * Export naming. The SDK no longer makes trees (enclave v12, 2026-10-18: a BitGraph is made one way, bind), but it
 * still reads and writes bitgraph-export/1 files for trees made before, so their names stay pinned here. The tree
 * tests that minted through held positions were removed with Fuse.
 */
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { parseExport } from "@mikeargento/bitgraph-verify";
import { memberExportFileName, relativeNames, safeRelativeName, exportBaseName } from "../exports.js";

test("names: relative to the deepest common folder, and safe as paths", () => {
  assert.deepEqual(relativeNames(["/a/b/c.txt"]), ["c.txt"]);
  assert.deepEqual(relativeNames(["/a/b/c.txt", "/a/b/d/e.txt"]), ["c.txt", join("d", "e.txt")]);
  assert.deepEqual(relativeNames(["/x/y.txt", "/z/w.txt"]), [join("x", "y.txt"), join("z", "w.txt")]);
  assert.equal(safeRelativeName("../../etc/passwd", 0), join("etc", "passwd"));
  assert.equal(safeRelativeName("/abs/name\u0001.txt", 0), join("abs", "name .txt"));
  assert.equal(safeRelativeName("", 7), "leaf-7");
  assert.equal(exportBaseName({ counter: "4821", artifactDigest: "abc" }), "bitgraph-4821");
  assert.equal(exportBaseName({ counter: null, artifactDigest: "AbCdEfGhIjKlMn" }), "bitgraph-AbCdEfGhIjKl");
  assert.equal(memberExportFileName("photo.jpg"), "photo.jpg.bitgraph.json");
  assert.equal(parseExport("{}"), null);
});
