// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

import { describe as suite, test } from "node:test";
import * as assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe } from "../inspect.js";

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
