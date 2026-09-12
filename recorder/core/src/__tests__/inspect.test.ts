// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

import { describe as suite, test } from "node:test";
import * as assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, ROWS_SHOWN } from "../inspect.js";
import { slimMade, slimSkipped } from "../daemon.js";

suite("a recording described", () => {
  test("hands over its proof exactly as written, key order and all", async () => {
    const rec = mkdtempSync(join(tmpdir(), "bg-rec-"));
    mkdirSync(rec, { recursive: true });
    const text = '{\n  "version": "bitgraph/1",\n  "artifact": {"hashAlg": "sha256", "digestB64": "AA=="},\n  "commit": {"epochId": "e", "counter": "7"},\n  "proofHash": "zz"\n}\n';
    writeFileSync(join(rec, "proof.json"), text);
    writeFileSync(join(rec, "a.jpg"), "x");
    const d = await describe(rec, join(rec, "proof.json"));
    assert.equal(d.proofRaw, text);
    assert.equal((d.proof as { version?: string } | null)?.version, "bitgraph/1");
    assert.equal(d.filePath, join(rec, "a.jpg"));
  });
});

suite("the wire carries a sample, never the lot", () => {
  test("a make of many files answers with the first rows and the count", () => {
    const files = Array.from({ length: ROWS_SHOWN + 7 }, (_, i) => ({ path: `/f/${i}`, name: `${i}`, evidencePath: "" }));
    const slim = slimMade({ kind: "set", files, position: { epochId: "e", counter: "1" } } as never);
    assert.equal(slim.files.length, ROWS_SHOWN);
    assert.equal(slim.total, ROWS_SHOWN + 7);
    const sk = slimSkipped(Array.from({ length: ROWS_SHOWN + 3 }, (_, i) => ({ path: "", name: "", originDigestB64: "", reason: i % 2 ? "same-bytes" : "already-recorded", positions: [], attached: false })) as never);
    assert.equal(sk.files.length, ROWS_SHOWN);
    assert.equal(sk.total, ROWS_SHOWN + 3);
    assert.equal(sk.same, Math.floor((ROWS_SHOWN + 3) / 2));
  });
});
