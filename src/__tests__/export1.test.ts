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
import { createHash } from "node:crypto";
import { signAsync } from "@noble/ed25519";
import { canonicalize, parseExport, verifyExport } from "@mikeargento/bitgraph-verify";

const VEC = JSON.parse(readFileSync(fileURLToPath(new URL("../../spec/vectors/export-1.json", import.meta.url)), "utf8")) as {
  memberExport: Record<string, any>;
  ownerExport: Record<string, any>;
  memberFileHex: string;
  expectedClaims: Record<string, string>;
  signedBodyCanonicalHex: string;
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

describe("export/1, formats this verifier does not know: not judged, never FALSE", () => {
  // The vectors' published TEST key (spec/tools/gen-vectors.mjs), so a proof can be re-signed honestly.
  const TEST_KEY = createHash("sha256").update("bitgraph spec vector key (TEST ONLY, NOT A BITGRAPH KEY)").digest();
  const signedBodyOf = (p: Record<string, any>) => ({ version: p.version, artifact: p.artifact, commit: p.commit, publicKeyB64: p.signer.publicKeyB64, enforcement: p.environment.enforcement, measurement: p.environment.measurement, attribution: p.attribution });
  async function pinningAnotherSpec(e: Record<string, any>): Promise<Record<string, any>> {
    const out = clone(e);
    assert.equal(Buffer.from(canonicalize(signedBodyOf(out.proof) as never)).toString("hex"), VEC.signedBodyCanonicalHex, "the signed body is rebuilt exactly");
    out.proof.attribution = { ...out.proof.attribution, message: createHash("sha256").update("a later SPEC.md").digest("base64") };
    out.proof.signer.signatureB64 = Buffer.from(await signAsync(canonicalize(signedBodyOf(out.proof) as never), TEST_KEY)).toString("base64");
    return out;
  }
  const falseOnes = (r: Awaited<ReturnType<typeof verifyExport>>) => r.claims.filter((c) => c.level === "offline" && c.result === "FALSE" && !c.id.startsWith("attestation")).map((c) => c.id);

  test("a proof that pins a spec this verifier does not know: spec.pin and every tree claim UNDETERMINED", async () => {
    const member = await pinningAnotherSpec(VEC.memberExport);
    const r = await verifyExport(member, { bytes: file });
    assert.equal(claim(r, "proof.signature"), "TRUE", "honestly signed");
    assert.equal(claim(r, "spec.pin"), "UNDETERMINED");
    for (const id of ["tree.root", "tree.member", "bytes.member"]) assert.equal(claim(r, id), "UNDETERMINED", id);
    assert.deepEqual(falseOnes(r), []);
    const owner = await pinningAnotherSpec(VEC.ownerExport);
    const o = await verifyExport(owner, { bytes: Buffer.from(TREE.files[0]!.originalHex, "hex") });
    assert.equal(claim(o, "tree.leaves"), "UNDETERMINED");
    assert.match(o.claims.find((c) => c.id === "tree.leaves")!.detail, /^not judged: the proof follows a spec this verifier does not know/);
    assert.deepEqual(falseOnes(o), []);
  });

  test("a ceiling or settlement in a format this verifier does not know is UNDETERMINED; a broken known one is still FALSE", async () => {
    const settlement = JSON.parse(readFileSync(fileURLToPath(new URL("../../spec/vectors/output-root-1.json", import.meta.url)), "utf8")).settlement;
    const laterCeiling = clone(VEC.memberExport);
    laterCeiling.ceiling = { version: "bitgraph-ceiling/2", anchor: {} };
    const c = await verifyExport(laterCeiling, { bytes: file });
    assert.equal(claim(c, "ceiling.base"), "UNDETERMINED");
    assert.deepEqual(falseOnes(c), []);

    const blobs = clone(VEC.memberExport);
    blobs.settlement = { version: "bitgraph-settlement/1", baseBlock: 1 };
    const b = await verifyExport(blobs, { bytes: file });
    assert.equal(claim(b, "ceiling.ethereum"), "UNDETERMINED", "blob settlement is not taken in an export, and not called false");
    assert.deepEqual(falseOnes(b), []);

    const both = clone(VEC.memberExport);
    both.ceiling = { version: "bitgraph-ceiling/2", anchor: {} };
    both.settlement = settlement;
    const l = await verifyExport(both, { bytes: file });
    assert.equal(claim(l, "ceiling.ethereum"), "UNDETERMINED", "a verified settlement whose ceiling cannot be judged: the link is not judged");

    const broken = clone(VEC.memberExport);
    broken.settlement = { ...settlement, outputRoot: { ...settlement.outputRoot, stateRoot: "0x" + "00".repeat(32) } };
    const k = await verifyExport(broken, { bytes: file });
    assert.equal(claim(k, "ceiling.ethereum"), "FALSE", "output-root/1 that does not verify is FALSE");
    assert.doesNotMatch(k.claims.find((x) => x.id === "ceiling.ethereum")!.detail, /ceiling did not verify/, "FALSE for the settlement itself, before any link");
    const brokenCeiling = clone(VEC.memberExport);
    brokenCeiling.ceiling = { version: "bitgraph-ceiling/1", anchor: { txIndex: 0 } };
    assert.equal(claim(await verifyExport(brokenCeiling, { bytes: file }), "ceiling.base"), "FALSE", "a ceiling/1 that does not verify is FALSE");
  });
});
