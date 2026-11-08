// Copyright (c) 2025-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * The scan: the digest is the file's own across sizes on both sides of the
 * stream chunk, and expandPaths keeps to its rules.
 */

import { test, before } from "node:test";
import { strict as assert } from "node:assert";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expandPaths, scanFile } from "../scan.js";

let root = "";
before(async () => {
  root = await mkdtemp(join(tmpdir(), "bitgraph-mcp-scan-"));
});

const SIZES = [0, 1, 64, 65_535, 65_536, 65_537, 200_000];

test("a scan's digest is the file's own", async () => {
  for (const size of SIZES) {
    const bytes = randomBytes(size);
    const path = join(root, `f-${size}.bin`);
    await writeFile(path, bytes);
    const s = await scanFile(path);
    assert.equal(s.size, size);
    assert.equal(s.digestB64, createHash("sha256").update(bytes).digest("base64"), `${size}: digest`);
  }
});

test("expandPaths: files, directories, hidden entries, links, duplicates, limits, missing paths", async () => {
  const lone = join(root, "lone.txt");
  await writeFile(lone, "lone");
  const dir = join(root, "tree");
  await mkdir(join(dir, "sub", ".secret"), { recursive: true });
  await writeFile(join(dir, "a.txt"), "a");
  await writeFile(join(dir, ".DS_Store"), "junk");
  await writeFile(join(dir, "sub", "b.txt"), "b");
  await writeFile(join(dir, "sub", ".secret", "c.txt"), "c");
  await symlink(join(dir, "a.txt"), join(dir, "link.txt"));

  const e = await expandPaths([lone, dir], 100);
  assert.deepEqual(e.files, [lone, join(dir, "a.txt"), join(dir, "sub", "b.txt")]);
  assert.equal(e.directories, 1);

  const twice = await expandPaths([lone, lone, dir, join(dir, "a.txt")], 100);
  assert.deepEqual(twice.files, [lone, join(dir, "a.txt"), join(dir, "sub", "b.txt")], "the same file twice is one file");

  await assert.rejects(expandPaths([dir], 1), /more than 1 files/);
  await assert.rejects(expandPaths([lone, join(root, "missing.txt")], 100), (err: Error) => {
    assert.ok(err.message.includes("nothing was made"));
    assert.ok(err.message.includes(join(root, "missing.txt")));
    return true;
  });
});
