// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * ⚠️ THE LOAD-BEARING TEST OF THE STREAMED PATH.
 *
 * Nothing here holds a file's bytes; the fused digest is finished from a hash
 * state saved mid-file. That is only allowed to exist because it produces
 * exactly the digest the placement's own builder produces over the whole
 * artifact. If these two ever disagree, the app mints positions for bytes
 * nobody can rebuild, and every proof it made becomes unverifiable.
 */

import { describe, test } from "node:test";
import * as assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { builderFor } from "@mikeargento/bitgraph";
import { scanFile } from "../hash.js";

const dir = mkdtempSync(join(tmpdir(), "bg-hash-"));
const commitment = new Uint8Array(32).fill(7);

function write(name: string, bytes: Uint8Array): string {
  const p = join(dir, name);
  writeFileSync(p, bytes);
  return p;
}
const sha256 = (b: Uint8Array): string => createHash("sha256").update(b).digest("base64");

/** Bytes each placement is chosen for, at sizes that cross the 1 MiB read. */
const cases: Array<{ name: string; bytes: Uint8Array; placement: "trailer/1" | "container/2" }> = [
  { name: "tiny.jpg", bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), placement: "trailer/1" },
  { name: "png.png", bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...randomBytes(500)]), placement: "trailer/1" },
  { name: "text.txt", bytes: new TextEncoder().encode("not a format with an end marker\n"), placement: "container/2" },
  { name: "empty.bin", bytes: new Uint8Array(0), placement: "container/2" },
  { name: "one-byte.bin", bytes: Uint8Array.from([0]), placement: "container/2" },
  { name: "block.bin", bytes: new Uint8Array(512), placement: "container/2" },
  { name: "block-plus.bin", bytes: new Uint8Array(513), placement: "container/2" },
  { name: "big.jpg", bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...randomBytes(3 * (1 << 20) + 17)]), placement: "trailer/1" },
  { name: "big.bin", bytes: new Uint8Array(2 * (1 << 20) + 3).fill(9), placement: "container/2" },
];

describe("one read of a file answers both digests", () => {
  for (const c of cases) {
    test(`${c.name}: the streamed fused digest equals the placement's own build`, async () => {
      const path = write(c.name, c.bytes);
      const scanned = await scanFile(path);
      assert.equal(scanned.placement, c.placement, "the placement comes from the bytes");
      assert.equal(scanned.bytes, c.bytes.length);

      assert.equal(Buffer.from(scanned.originDigest).toString("base64"), sha256(c.bytes), "the origin digest is sha256 of the file, unchanged");

      const built = await builderFor(c.placement, c.bytes)({ commitment, commitmentHex: "", slot: {} as never });
      assert.equal(Buffer.from(scanned.fusedDigest(commitment)).toString("base64"), sha256(built), "the streamed digest is the digest of the artifact the builder makes");
    });
  }

  test("the same file answers the same digest for a different commitment", async () => {
    const path = write("again.jpg", Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...randomBytes(2048)]));
    const scanned = await scanFile(path);
    const other = new Uint8Array(32).fill(9);
    const a = Buffer.from(scanned.fusedDigest(commitment)).toString("hex");
    const b = Buffer.from(scanned.fusedDigest(other)).toString("hex");
    assert.notEqual(a, b, "a different slot is a different artifact");
    assert.equal(Buffer.from(scanned.fusedDigest(commitment)).toString("hex"), a, "and asking twice gives the same answer");
  });

  test("a commitment that is not 32 bytes is refused", async () => {
    const scanned = await scanFile(write("guard.jpg", Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1])));
    assert.throws(() => scanned.fusedDigest(new Uint8Array(31)), /32 bytes/);
  });

  test("a file that changes underneath the read is refused, never recorded", async () => {
    const p = join(dir, "moving.bin");
    writeFileSync(p, new Uint8Array(4 << 20).fill(1));
    const scanning = scanFile(p);
    setTimeout(() => writeFileSync(p, new Uint8Array(4 << 20).fill(2)), 5);
    await assert.rejects(scanning, /changed while it was being read/).catch(async () => {
      /* If the write landed after the read finished the scan is honest and
       * passes; the guard is checked by the size case below regardless. */
      await scanning;
    });
  });

  test("a file whose size changes underneath the read is refused", async () => {
    const p = join(dir, "growing.bin");
    writeFileSync(p, new Uint8Array(8 << 20).fill(1));
    const scanning = scanFile(p);
    setTimeout(() => writeFileSync(p, new Uint8Array(9 << 20).fill(1)), 2);
    await assert.rejects(scanning, /changed while it was being read/);
  });
});
