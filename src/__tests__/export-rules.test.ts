// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * The verdict rules of bitgraph-export/1 (SPEC section 12.1), from a TRUE
 * baseline: the spec's export vector re-signed with its published TEST key
 * and given a synthetic AWS Nitro attestation under a test root of this
 * file's own. Each rule is then shown turning that TRUE:
 *
 *   - the measurement policy: BitGraph's published images by default, so an
 *     image nobody published is FALSE and no list at all is UNDETERMINED;
 *   - a lookup that refutes a block is FALSE, and the reading never states an
 *     unchecked time as fact;
 *   - a Base stamp earlier than the floor or the attestation document is
 *     withheld as a time while the inclusion stays TRUE;
 *   - settlement chain ids are checked, the signed one included;
 *   - malformed parts of a known format are FALSE and never throw; unknown
 *     formats are UNDETERMINED; unsigned advisory fields change nothing.
 */

import { before, describe, test } from "node:test";
import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { signAsync } from "@noble/ed25519";
import {
  BASE_STAMP_TOLERANCE_SECONDS,
  baseTimeIsBound,
  buildSignedBody,
  canonicalize,
  computeSignedBodyHash,
  decodeHeader,
  evmHexToBytes,
  PUBLISHED_ENCLAVE_MEASUREMENTS,
  rlpEncode,
  verifyExport,
  verifyOutputRootSettlement,
  type ExportVerifyResult,
  type OutputRootSettlement,
} from "@mikeargento/bitgraph-verify";
import {
  buildTree,
  buildTreeMemberEvidence,
  buildTreeRootDocument,
  bytesToBase64,
  bytesToHex,
  currentTreeSpecHash,
  getPlacement,
  producerCommitment,
  TREE_METADATA_KEY,
  treeAttribution,
  verifyTreeMember,
} from "@mikeargento/bitgraph-verify";
import { sha256 } from "@noble/hashes/sha256";
import { makeCert, makeDocB64, makeP384, PCR0_HEX, type TestKeyPair } from "./nitro-fixtures.js";
import { BASE_TEST_CHAIN, FLOOR_NUMBER, FLOOR_TIME, chainWorld, makeBoundary, mintFromBody, signedSlot, type Boundary } from "./tree-fixtures.js";
import { b64, signBody, utf8 } from "./audit-fixtures.js";
import { buildCarrier, canonicalSlotBody, verifyCarrier, type CarrierPayload, type SlotAllocation } from "@mikeargento/bitgraph-verify";

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const VEC = JSON.parse(readFileSync(here("../../spec/vectors/export-1.json"), "utf8")) as {
  memberExport: Record<string, any>;
  ownerExport: Record<string, any>;
  memberFileHex: string;
};
const LIVE_SETTLEMENT = JSON.parse(readFileSync(here("../../spec/vectors/output-root-1.json"), "utf8")).settlement as OutputRootSettlement;
const file = Buffer.from(VEC.memberFileHex, "hex");
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const claim = (r: ExportVerifyResult, id: string) => r.claims.find((c) => c.id === id);
const TEST_KEY = createHash("sha256").update("bitgraph spec vector key (TEST ONLY, NOT A BITGRAPH KEY)").digest();
const floorTime = decodeHeader(evmHexToBytes(VEC.memberExport.floor.header)).timestamp;

let root: TestKeyPair;
let leaf: TestKeyPair;
let rootCert: Uint8Array;
let leafCert: Uint8Array;

before(async () => {
  root = await makeP384();
  leaf = await makeP384();
  rootCert = await makeCert(root.publicRaw, root.privateKey);
  leafCert = await makeCert(leaf.publicRaw, root.privateKey);
});

/** The export with its proof re-signed to name PCR0_HEX and an attestation made at `atMs` bound to that body. */
async function attested(e: Record<string, any>, atMs: number, pcr0Hex = PCR0_HEX): Promise<Record<string, any>> {
  const out = clone(e);
  const p = out.proof;
  // The signed body names the attestation's format (not its bytes), so the format goes in before signing.
  p.environment = { enforcement: p.environment.enforcement, measurement: pcr0Hex, attestation: { format: "aws-nitro", reportB64: "" } };
  p.signer.signatureB64 = Buffer.from(await signAsync(canonicalize(buildSignedBody(p) as never), TEST_KEY)).toString("base64");
  const reportB64 = await makeDocB64({
    leafPrivate: leaf.privateKey,
    leafCert,
    cabundle: [rootCert],
    userData: new Uint8Array(Buffer.from(computeSignedBodyHash(p), "base64")),
    timestamp: atMs,
    pcr0: new Uint8Array(Buffer.from(pcr0Hex, "hex")),
  });
  p.environment.attestation.reportB64 = reportB64;
  return out;
}

const trusted = () => ({ rootDer: rootCert, pcr0: [PCR0_HEX] });

describe("export/1 verdict rules", () => {
  test("baseline: a valid attestation under a trusted root and an accepted image reads TRUE", async () => {
    const e = await attested(VEC.memberExport, (floorTime + 20) * 1000);
    const r = await verifyExport(e, { bytes: file, pins: trusted() });
    assert.equal(r.verdict, "TRUE", r.reasons.join("; "));
    assert.equal(claim(r, "attestation.pins")?.result, "TRUE");
    assert.match(r.reading, /that block's header is taken as given until it is checked against Ethereum/, "an unchecked floor is said to be unchecked");
  });

  test("measurement policy: by default only BitGraph's published images pass; no list leaves it undetermined", async () => {
    const e = await attested(VEC.memberExport, (floorTime + 20) * 1000);
    const byDefault = await verifyExport(e, { bytes: file, pins: { rootDer: rootCert } });
    assert.equal(claim(byDefault, "attestation.pins")?.result, "FALSE");
    assert.match(claim(byDefault, "attestation.pins")!.detail, /not an image BitGraph published, so this proof is not BitGraph's/);
    assert.equal(byDefault.verdict, "FALSE", "a valid attestation from someone else's enclave is not a BitGraph");
    const noList = await verifyExport(e, { bytes: file, pins: { rootDer: rootCert, pcr0: [] } });
    assert.equal(claim(noList, "attestation.pins")?.result, "UNDETERMINED");
    assert.equal(noList.verdict, "UNDETERMINED");
    assert.match(noList.reading, /^Not judged in full: the image is one the verifier accepts\./);
    // The default list is BitGraph's published table, v9 included, and a real v9 image passes it.
    const v9 = PUBLISHED_ENCLAVE_MEASUREMENTS.find((m) => m.version === "v9")!.pcr0;
    const real = await attested(VEC.memberExport, (floorTime + 20) * 1000, v9);
    const r = await verifyExport(real, { bytes: file, pins: { rootDer: rootCert } });
    assert.equal(claim(r, "attestation.pins")?.result, "TRUE");
    assert.match(claim(r, "attestation.pins")!.detail, /BitGraph's published v9 image \(since 2026-09-30\)/);
    assert.equal(r.verdict, "TRUE");
  });

  test("a lookup that refutes a block makes the verdict FALSE; a confirming one drops the 'taken as given'", async () => {
    const e = await attested(VEC.memberExport, (floorTime + 20) * 1000);
    const refuted = await verifyExport(e, { bytes: file, pins: trusted(), lookups: { ethereumBlockHash: async () => "0x" + "00".repeat(32) } });
    assert.equal(claim(refuted, "confirmed.floor")?.result, "FALSE");
    assert.equal(refuted.verdict, "FALSE", "every offline claim holds, and the chain says the floor block is not its own");
    assert.match(refuted.reading, /^A lookup refutes this export: /);
    const floorHash = (VEC.memberExport.floor as { blockHash: string }).blockHash;
    const confirmed = await verifyExport(e, { bytes: file, pins: trusted(), lookups: { ethereumBlockHash: async () => floorHash } });
    assert.equal(confirmed.verdict, "TRUE");
    assert.doesNotMatch(confirmed.reading, /taken as given/);
  });

  test("a Base stamp earlier than the attestation document is withheld as a time; the inclusion stays TRUE", async () => {
    const baseTime = floorTime + 40;
    for (const [attestedAt, withheld] of [[floorTime + 20, false], [floorTime + 600, true]] as const) {
      const pre = await attested(VEC.memberExport, attestedAt * 1000);
      const world = chainWorld(pre.proof, undefined, { baseTime });
      const e = { ...pre, ceiling: world.sidecar, settlement: world.settlement };
      const r = await verifyExport(e, { bytes: file, pins: { ...trusted(), ceilingWriter: world.writer, baseChainId: BASE_TEST_CHAIN } });
      assert.equal(r.verdict, "TRUE", r.reasons.join("; "));
      assert.equal(claim(r, "ceiling.base")?.result, "TRUE", "the record is in the Base block either way");
      assert.equal(claim(r, "ceiling.ethereum")?.result, "TRUE", "the Ethereum bound does not rest on Base's stamp");
      assert.ok(r.times.ceilingEthereum);
      if (withheld) {
        assert.equal(r.times.ceilingBase, null);
        assert.match(r.baseTimeWithheld ?? "", /more than 2 s before the attestation document was made/);
        assert.match(r.reading, /The record is in a Base block, but its time is not used as a bound: /);
      } else {
        assert.equal(r.times.ceilingBase?.blockTimestamp, baseTime);
        assert.equal(r.baseTimeWithheld, null);
      }
    }
  });

  test("baseTimeIsBound: the floor, the attestation document and the one-block tolerance", () => {
    assert.equal(BASE_STAMP_TOLERANCE_SECONDS, 2);
    assert.deepEqual(baseTimeIsBound(1000, { floorTimestampSec: 990, attestedAtMs: 995_000 }), { ok: true });
    assert.equal(baseTimeIsBound(1000, { floorTimestampSec: 1001 }).ok, false, "before the floor block");
    assert.equal(baseTimeIsBound(1000, { attestedAtMs: 1_002_000 }).ok, true, "exactly one block of slack");
    assert.equal(baseTimeIsBound(1000, { attestedAtMs: 1_002_001 }).ok, false, "a millisecond past the slack");
    assert.equal(baseTimeIsBound(1000, {}).ok, true, "nothing to compare with: not known to be wrong, still provisional");
  });

  test("settlement chain ids are checked, the transaction's own signed chain id included", () => {
    assert.equal(verifyOutputRootSettlement(LIVE_SETTLEMENT).ok, true);
    const base = clone(LIVE_SETTLEMENT);
    base.base.chainId = 999999;
    assert.match(verifyOutputRootSettlement(base).reason ?? "", /^chain: the settlement is for chain 999999/);
    const eth = clone(LIVE_SETTLEMENT);
    eth.ethereum.chainId = 999999;
    assert.match(verifyOutputRootSettlement(eth).reason ?? "", /^chain: the settlement names chain 999999/);
    // A transaction signed for another chain, carried honestly in a block: the labels say 1, the signature says 5.
    const world = chainWorld(VEC.memberExport.proof);
    const s = clone(world.settlement);
    const raw = evmHexToBytes(s.ethereum.rawTx);
    assert.equal(verifyOutputRootSettlement(s, { baseChainId: BASE_TEST_CHAIN }).ok, true);
    const fields = [new Uint8Array([5]), ...new Array(8).fill(new Uint8Array(0))];
    const other = new Uint8Array([0x02, ...rlpEncode(fields as never)]);
    assert.notDeepEqual(other, raw);
    s.ethereum.rawTx = "0x" + Buffer.from(other).toString("hex");
    // The hash and the inclusion no longer match either; the chain id is caught first.
    assert.equal(verifyOutputRootSettlement(s, { baseChainId: BASE_TEST_CHAIN }).ok, false);
  });

  test("malformed parts of export/1 are FALSE and never throw; another format is UNDETERMINED", async () => {
    const numeric = clone(VEC.memberExport);
    numeric.proof.environment = { ...numeric.proof.environment, measurement: 12345, attestation: { format: "aws-nitro", reportB64: "AAAA" } };
    const r = await verifyExport(numeric, { bytes: file, pins: { pcr0: ["ab"] } });
    assert.equal(r.verdict, "FALSE");
    assert.equal(claim(r, "attestation.pcr0")?.result, "FALSE");
    const broken = await verifyExport({ format: "bitgraph-export/1", proof: VEC.memberExport.proof });
    assert.equal(claim(broken, "format")?.result, "FALSE");
    assert.equal(broken.verdict, "FALSE");
    const later = await verifyExport({ format: "bitgraph-export/2", anything: true });
    assert.equal(claim(later, "format")?.result, "UNDETERMINED");
    assert.equal(later.verdict, "UNDETERMINED");
  });

  test("unsigned advisory fields change nothing: the spec label, the names, unknown extra fields", async () => {
    const e = await attested(VEC.ownerExport, (floorTime + 20) * 1000);
    const bytes = file;
    const base = await verifyExport(e, { bytes, pins: trusted() });
    assert.equal(base.verdict, "TRUE", base.reasons.join("; "));
    const results = (r: ExportVerifyResult) => r.claims.map((c) => `${c.id}=${c.result}`);
    for (const change of [
      (x: Record<string, any>) => { x.spec = "AAAA"; },
      (x: Record<string, any>) => { x.tree.names = x.tree.names.map(() => "renamed.bin"); },
      (x: Record<string, any>) => { delete x.tree.names; },
      (x: Record<string, any>) => { x.note = "an unknown field"; x.tree.extra = [1, 2, 3]; },
    ]) {
      const m = clone(e);
      change(m);
      const r = await verifyExport(m, { bytes, pins: trusted() });
      assert.equal(r.verdict, "TRUE");
      assert.deepEqual(results(r), results(base));
    }
  });

  test("tampering with any field never throws, and only advisory fields can leave the verdict TRUE", async () => {
    const e = await attested(VEC.memberExport, (floorTime + 20) * 1000);
    const paths: string[][] = [];
    const walk = (v: unknown, path: string[]) => {
      if (v !== null && typeof v === "object") {
        for (const k of Object.keys(v as object)) walk((v as Record<string, unknown>)[k], [...path, k]);
      }
      if (path.length > 0) paths.push(path);
    };
    walk(e, []);
    const values: unknown[] = [null, 0, "x", {}];
    const stillTrue = new Set<string>();
    for (const path of paths) {
      for (const value of [undefined, ...values]) {
        const m = clone(e);
        let at: any = m;
        for (const k of path.slice(0, -1)) at = at[k];
        const last = path[path.length - 1]!;
        if (value === undefined) delete at[last];
        else at[last] = value;
        let r: ExportVerifyResult;
        try {
          r = await verifyExport(m, { bytes: file, pins: trusted() });
        } catch (err) {
          assert.fail(`${path.join(".")} = ${JSON.stringify(value)} threw: ${(err as Error).message}`);
        }
        assert.ok(["TRUE", "FALSE", "UNDETERMINED"].includes(r.verdict));
        if (r.verdict === "TRUE") stillTrue.add(`${path.join(".")}=${value === undefined ? "<deleted>" : JSON.stringify(value)}`);
      }
    }
    // The fields no check reads: the unsigned spec label, the export's own
    // floor/ceiling/settlement when absent or pending, and the proof's
    // unsigned extras. Everything signed, attested or hashed turns the verdict.
    // Allowed: the unsigned spec label and the proof's unsigned metadata echo
    // (the export carries its own root document), and an optional part made
    // absent (null or deleted), which is "not carried", never a pass of it.
    const allowed = (m: string) => /^(spec|proof\.metadata)(\.[^=]*)?=/.test(m) || /^(floor|ceiling|settlement)=(<deleted>|null)$/.test(m);
    const unexpected = [...stillTrue].filter((m) => !allowed(m));
    assert.deepEqual(unexpected, [], `changes that left the verdict TRUE: ${unexpected.join(", ")}`);
  });
});

describe("containers in a signed tree", () => {
  test("the spec's negative vector: no file of a lying container is its member", async () => {
    const n = JSON.parse(readFileSync(here("../../spec/vectors/tree-1-negative.json"), "utf8")) as {
      proof: Record<string, unknown>;
      rootDocumentHex: string;
      cases: Array<{ placement: string; file: string; bytesHex: string; evidence: never; expect: string }>;
    };
    assert.equal(n.cases.length, 6);
    for (const c of n.cases) {
      const r = await verifyTreeMember({ proof: n.proof as never, member: c.evidence, rootDocument: Buffer.from(n.rootDocumentHex, "hex"), bytes: Buffer.from(c.bytesHex, "hex") });
      assert.equal(r.category, c.expect, `${c.placement}, ${c.file}`);
      assert.ok(!r.category.startsWith("TREE_MEMBER"), `${c.placement}, ${c.file} is never a member`);
    }
  });

  test("a leaf whose container names one original and holds another is not that member, by either file", async () => {
    for (const [id, code] of [["container/1", 0x02], ["container/2", 0x03]] as const) {
      const b = await makeBoundary("700");
      const { commitment } = producerCommitment(b.slot, b.anchor);
      const inside = new TextEncoder().encode("the bytes inside the archive\n");
      const named = new TextEncoder().encode("the bytes the archive names\n");
      const lying = getPlacement(id)!.build({ original: inside, originDigest: sha256(named), commitment });
      const leaf = { placement: code, artifact: sha256(lying), origin: sha256(named) };
      const built = buildTree([leaf]);
      const rootDocument = buildTreeRootDocument(commitment, 1, built.root);
      const proof = await mintFromBody(b, {
        digests: [{ digestB64: bytesToBase64(sha256(rootDocument)), hashAlg: "sha256" }],
        slotId: b.slot.nonceB64,
        slot: b.slot,
        chainId: "bitgraph:main",
        attribution: treeAttribution(currentTreeSpecHash()),
        metadata: { [TREE_METADATA_KEY]: bytesToHex(rootDocument) },
        anchor: b.anchor,
      });
      const member = buildTreeMemberEvidence(built.sorted[0]!, 0, 1, built.tree.path(0));
      const path = await verifyTreeMember({ proof, member, rootDocument });
      assert.equal(path.category, "TREE_PATH_VALID", `${id}: the leaf is in the signed tree`);
      const byCommitted = await verifyTreeMember({ proof, member, rootDocument, bytes: lying });
      assert.equal(byCommitted.category, "INVALID_SLOT_COMMITMENT", `${id}: the archive's bytes are not a valid member`);
      const byNamed = await verifyTreeMember({ proof, member, rootDocument, bytes: named });
      assert.equal(byNamed.category, "RECONSTRUCTION_MISMATCH", `${id}: the named original does not rebuild the committed bytes`);
    }
  });
});

describe("the same rules on a BitGraphed file", () => {
  /** A signed proof under the boundary's key, with an attestation under the test root bound to it. */
  async function mintAttested(b: Boundary, slot: SlotAllocation, digestB64: string, commitExtras: Record<string, unknown>, attribution: Record<string, string>, atMs: number | null) {
    const commit = {
      nonceB64: slot.nonceB64,
      counter: (BigInt(slot.counter) + 3n).toString(),
      epochId: slot.epochId,
      slotCounter: slot.counter,
      slotHashB64: b64(sha256(canonicalize(canonicalSlotBody(slot)))),
      chainId: "bitgraph:main",
      ...commitExtras,
    };
    const proof = await signBody(b.key, { hashAlg: "sha256", digestB64 }, commit as never, PCR0_HEX, { attribution, ...(atMs !== null ? { attestation: { format: "aws-nitro", reportB64: "placeholder" } } : {}) });
    proof.slotAllocation = slot;
    if (atMs !== null) {
      const reportB64 = await makeDocB64({ leafPrivate: leaf.privateKey, leafCert, cabundle: [rootCert], userData: new Uint8Array(Buffer.from(computeSignedBodyHash(proof), "base64")), timestamp: atMs, pcr0: new Uint8Array(Buffer.from(PCR0_HEX, "hex")) });
      (proof.environment as { attestation?: { format: string; reportB64: string } }).attestation = { format: "aws-nitro", reportB64 };
    }
    return proof;
  }

  /** A carrier/2 payload: the record's proof, the floor anchor it signed (a genuine anchor proof under the same key) with its header, and the Base ceiling sidecar. */
  async function carrierWorld(attestedAtMs: number, baseTime: number) {
    const b = await makeBoundary("700");
    const inner = utf8("a record kept in a BitGraphed file\n");
    const proof = await mintAttested(b, b.slot, b64(sha256(inner)), { slotAnchor: b.anchor }, { name: "test", title: "record" }, attestedAtMs);
    const anchorSlot = await signedSlot(b.key, "696");
    const anchor = await mintAttested(b, anchorSlot, b64(sha256(utf8(b.floor.hash))), { anchor: { blockNumber: FLOOR_NUMBER, blockHash: b.floor.hash } }, { name: "Ethereum Anchor", title: `https://etherscan.io/block/${FLOOR_NUMBER}`, message: b.floor.hash }, null);
    const world = chainWorld(proof, b.floor.headerHex, { baseTime });
    const payload = {
      carrier: "bitgraph-carrier/2",
      proof,
      floor: { status: "present", anchor, witness: { version: "bitgraph-anchor-witness/1", headerRlpHex: b.floor.headerHex, blockNumber: FLOOR_NUMBER, blockHash: b.floor.hash } },
      ceiling: { status: "unfetched" },
      ceilingInTime: { status: "present", sidecar: world.sidecar },
    } as unknown as CarrierPayload;
    return { bytes: buildCarrier(inner, payload), pins: { rootDer: rootCert, pcr0: [PCR0_HEX], ceilingWriter: world.writer, baseChainId: BASE_TEST_CHAIN } };
  }

  test("a Base stamp earlier than the attestation document is withheld from the file's bounds; the inclusion stays TRUE and the verdict holds", async () => {
    const baseTime = FLOOR_TIME + 40;
    const fine = await carrierWorld((FLOOR_TIME + 20) * 1000, baseTime);
    const r1 = await verifyCarrier(fine.bytes, { pins: fine.pins });
    assert.equal(r1.verdict, "TRUE", r1.reasons.join("; "));
    assert.equal(r1.bounds?.existedBy?.timestamp, baseTime);
    assert.equal(r1.baseTimeWithheld, null);

    const late = await carrierWorld((FLOOR_TIME + 600) * 1000, baseTime);
    const r2 = await verifyCarrier(late.bytes, { pins: late.pins });
    assert.equal(r2.verdict, "TRUE", r2.reasons.join("; "));
    const c = Object.fromEntries(r2.claims.map((x) => [x.id, x.result]));
    assert.equal(c["ceiling.time.inclusion"], "TRUE", "the record is in the Base block either way");
    assert.equal(r2.bounds?.existedBy ?? null, null, "no stated bound carries the withheld time");
    assert.match(r2.baseTimeWithheld ?? "", /more than 2 s before the attestation document was made/);
    assert.match(r2.reading, /its time is not used as a bound/);
    assert.doesNotMatch(r2.reading, /existed by Base block/);
  });

  test("the image check needs the whole attestation: a document under a root the verifier does not trust leaves pins undetermined even when its PCR0 is published", async () => {
    const w = await carrierWorld((FLOOR_TIME + 20) * 1000, FLOOR_TIME + 40);
    const { rootDer: _testRoot, ...awsRootOnly } = w.pins;
    void _testRoot;
    const r = await verifyCarrier(w.bytes, { pins: { ...awsRootOnly, pcr0: [PCR0_HEX] } });
    const c = Object.fromEntries(r.claims.map((x) => [x.id, x.result]));
    assert.equal(c["attestation.root"], "FALSE", "the test root is not the AWS root");
    assert.equal(c["attestation.pins"], "UNDETERMINED", "a PCR0 on the list means nothing without verified hardware evidence");
    assert.equal(r.verdict, "FALSE");
  });
});

describe("the floor's time from the sidecar alone", () => {
  test("an export without a top-level floor still guards the Base stamp against the floor header the sidecar carries", async () => {
    const pre = await attested(VEC.memberExport, (floorTime + 20) * 1000);
    // The Base block stamped one second before the floor block; the attestation comparison alone would pass it.
    const world = chainWorld(pre.proof, VEC.memberExport.floor.header, { baseTime: floorTime - 1 });
    const e = { ...pre, floor: null, ceiling: world.sidecar, settlement: null };
    const r = await verifyExport(e, { bytes: file, pins: { ...trusted(), ceilingWriter: world.writer, baseChainId: BASE_TEST_CHAIN } });
    assert.equal(claim(r, "floor.header")?.result, "NOT_CARRIED");
    assert.equal(claim(r, "ceiling.base")?.result, "TRUE");
    assert.equal(r.times.ceilingBase, null, "the stamp is withheld as a time");
    assert.match(r.baseTimeWithheld ?? "", /before the floor block's own time/);
  });
});
