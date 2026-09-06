// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * The scan's two promises: the digest is the file's own, and a state
 * finished with the placement's suffix for a slot is the hash of the
 * placement's own build for that slot. Both are pinned across sizes on both
 * sides of every boundary that matters (the 64-byte sniff, the tar block,
 * the 64 KB stream chunk) for both placements the scan makes.
 */

import { test, before } from "node:test";
import { strict as assert } from "node:assert";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { placementForBytes } from "@mikeargento/bitgraph";
import { getPlacement } from "@mikeargento/bitgraph-verify";
import { expandPaths, fusedDigestFor, scanFile } from "../scan.js";

let root = "";
before(async () => {
  root = await mkdtemp(join(tmpdir(), "bitgraph-mcp-scan-"));
});

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SIZES = [0, 1, 8, 63, 64, 65, 511, 512, 513, 1024, 65_535, 65_536, 65_537, 200_000];

test("a scan's digest is the file's own and its state finishes to the placement's own build", async () => {
  let checked = 0;
  for (const size of SIZES) {
    for (const kind of ["png", "txt"] as const) {
      const lead = kind === "png" ? PNG : Buffer.from("txt:");
      const bytes = Buffer.concat([lead, randomBytes(Math.max(0, size - lead.length))]).subarray(0, size);
      const path = join(root, `${kind}-${size}.bin`);
      await writeFile(path, bytes);
      const s = await scanFile(path);
      assert.equal(s.size, size);
      assert.equal(s.digestB64, createHash("sha256").update(bytes).digest("base64"), `${kind} ${size}: digest`);
      assert.equal(s.placement, placementForBytes(new Uint8Array(bytes)), `${kind} ${size}: the core's own placement choice`);
      assert.ok(s.state !== null, "a file that did not change keeps its state");
      const placement = getPlacement(s.placement);
      if (placement === undefined) throw new Error("placement missing");
      // Two slots, both finished from the same saved state: the copy leaves the state intact.
      for (const commitment of [randomBytes(32), randomBytes(32)]) {
        const built = placement.build({ original: new Uint8Array(bytes), originDigest: s.originDigest, commitment: new Uint8Array(commitment) });
        const expected = createHash("sha256").update(built).digest();
        assert.deepEqual(Buffer.from(fusedDigestFor(s, new Uint8Array(commitment))), expected, `${kind} ${size}: state finished == sha256(build)`);
        checked += 1;
      }
    }
  }
  assert.equal(checked, SIZES.length * 4);
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
    assert.ok(err.message.includes("nothing was BitGraphed"));
    assert.ok(err.message.includes(join(root, "missing.txt")));
    return true;
  });
});
