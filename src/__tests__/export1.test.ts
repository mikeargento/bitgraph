// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * bitgraph-export/1 through verifyExport, from the deterministic vector in
 * spec/vectors/export-1.json (signed with a published test key, no
 * attestation). Every offline claim but the attestation must hold for the
 * honest export; every tampering must turn the right claim FALSE.
 */

import { describe, test } from "node:test";
import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseExport, verifyExport } from "@mikeargento/bitgraph-verify";

const VEC = JSON.parse(readFileSync(fileURLToPath(new URL("../../spec/vectors/export-1.json", import.meta.url)), "utf8")) as {
  memberExport: Record<string, any>;
  ownerExport: Record<string, any>;
  memberFileHex: string;
  expectedClaims: Record<string, string>;
};
const TREE = JSON.parse(readFileSync(fileURLToPath(new URL("../../spec/vectors/tree-1.json", import.meta.url)), "utf8")) as {
  files: Array<{ name: string; placementCode: number; originalHex: string; committedHex: string }>;
};
const file = Buffer.from(VEC.memberFileHex, "hex");
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const claim = (r: Awaited<ReturnType<typeof verifyExport>>, id: string) => r.claims.find((c) => c.id === id)?.result;

describe("export/1, the honest export", () => {
  test("every offline claim matches the vector's expected results", async () => {
    const r = await verifyExport(VEC.memberExport, { bytes: file });
    for (const [id, want] of Object.entries(VEC.expectedClaims)) assert.equal(claim(r, id), want, `${id}`);
    // No attestation on a test-key proof: the verdict is FALSE on that claim alone.
    assert.equal(r.verdict, "FALSE");
    assert.deepEqual(r.reasons.filter((x) => !x.startsWith("attestation")).filter((x) => !x.startsWith("confirmed")), []);
    assert.equal(r.member?.index, VEC.memberExport.tree.member.index);
    assert.ok(r.times.floor, "the floor time is read from the header");
    assert.equal(r.times.ceilingBase, null);
  });

  test("parses from text and from an object, and refuses anything else", () => {
    assert.ok(parseExport(JSON.stringify(VEC.memberExport)));
    assert.ok(parseExport(VEC.memberExport));
    assert.equal(parseExport({ ...VEC.memberExport, format: "bitgraph-export/2" }), null);
    assert.equal(parseExport("not json"), null);
  });

  test("without the file, the file's claims are NOT_CARRIED, not failures", async () => {
    const r = await verifyExport(VEC.memberExport);
    assert.equal(claim(r, "bytes.member"), "NOT_CARRIED");
    assert.equal(claim(r, "tree.member"), "TRUE");
  });

  test("the owner's export finds every file, by its original and by its committed bytes", async () => {
    for (const f of TREE.files) {
      for (const which of ["originalHex", "committedHex"] as const) {
        const r = await verifyExport(VEC.ownerExport, { bytes: Buffer.from(f[which], "hex") });
        assert.equal(claim(r, "tree.leaves"), "TRUE", f.name);
        assert.equal(claim(r, "bytes.member"), "TRUE", `${f.name} ${which}`);
      }
    }
  });
});

describe("export/1, tampered", () => {
  test("a different file: bytes.member FALSE", async () => {
    const r = await verifyExport(VEC.memberExport, { bytes: Buffer.concat([file, Buffer.from("x")]) });
    assert.equal(claim(r, "bytes.member"), "FALSE");
  });

  test("a changed path node: tree.member FALSE", async () => {
    const e = clone(VEC.memberExport);
    e.tree.member.path[0] = e.tree.member.path[0].replace(/^./, (c: string) => (c === "0" ? "1" : "0"));
    const r = await verifyExport(e, { bytes: file });
    assert.equal(claim(r, "tree.member"), "FALSE");
    assert.equal(r.verdict, "FALSE");
  });

  test("a changed root document: tree.root FALSE", async () => {
    const e = clone(VEC.memberExport);
    e.tree.rootDocument = e.tree.rootDocument.slice(0, -2) + (e.tree.rootDocument.endsWith("0") ? "1" : "0") + e.tree.rootDocument.slice(-1);
    const r = await verifyExport(e, { bytes: file });
    assert.equal(claim(r, "tree.root"), "FALSE");
  });

  test("a changed signed field: proof.signature FALSE", async () => {
    const e = clone(VEC.memberExport);
    e.proof.commit.counter = String(Number(e.proof.commit.counter) + 1);
    const r = await verifyExport(e, { bytes: file });
    assert.equal(claim(r, "proof.signature"), "FALSE");
  });

  test("a floor header that is not the signed floor block: floor.header FALSE", async () => {
    const e = clone(VEC.memberExport);
    e.floor.header = e.floor.header.slice(0, -2) + "00";
    const r = await verifyExport(e, { bytes: file });
    assert.equal(claim(r, "floor.header"), "FALSE");
  });

  test("the owner's list out of order: tree.leaves FALSE", async () => {
    const e = clone(VEC.ownerExport);
    const b = Buffer.from(e.tree.leaves, "base64");
    const swapped = Buffer.concat([b.subarray(65, 130), b.subarray(0, 65), b.subarray(130)]);
    e.tree.leaves = swapped.toString("base64");
    const r = await verifyExport(e, { bytes: Buffer.from(TREE.files[0]!.originalHex, "hex") });
    assert.equal(claim(r, "tree.leaves"), "FALSE");
  });

  test("an unsigned spec label that differs is noted, never decisive", async () => {
    const e = clone(VEC.memberExport);
    e.spec = "AAAA";
    const r = await verifyExport(e, { bytes: file });
    assert.equal(claim(r, "spec.pin"), "TRUE");
    assert.match(r.claims.find((c) => c.id === "spec.pin")!.detail, /only the signed value counts/);
  });

  test("a settlement with no verified ceiling to bind it to is FALSE, never silently accepted", async () => {
    const e = clone(VEC.memberExport);
    e.settlement = JSON.parse(readFileSync(fileURLToPath(new URL("../../spec/vectors/output-root-1.json", import.meta.url)), "utf8")).settlement;
    const r = await verifyExport(e, { bytes: file });
    assert.equal(claim(r, "ceiling.ethereum"), "FALSE");
  });
});

describe("export/1, confirmed level", () => {
  test("the reader's own lookups confirm or refute the floor block", async () => {
    const floor = VEC.memberExport.floor as { blockNumber: number; blockHash: string };
    const yes = await verifyExport(VEC.memberExport, { bytes: file, lookups: { ethereumBlockHash: async () => floor.blockHash } });
    assert.equal(claim(yes, "confirmed.floor"), "TRUE");
    const no = await verifyExport(VEC.memberExport, { bytes: file, lookups: { ethereumBlockHash: async () => "0x" + "00".repeat(32) } });
    assert.equal(claim(no, "confirmed.floor"), "FALSE");
    const none = await verifyExport(VEC.memberExport, { bytes: file });
    assert.equal(claim(none, "confirmed.floor"), "UNDETERMINED");
  });
});
