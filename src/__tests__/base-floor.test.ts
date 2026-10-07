// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * The Base floor (enclave v10, commit.slotFloor) through every reader of the
 * floor: bitgraph-export/1 (verifyExport, and the builder's floorFromHeader,
 * fetchFloorHeader and completeExport), the ceiling sidecar (verifyCeiling),
 * and the BitGraphed file (bitgraph-carrier/3, verifyCarrier).
 *
 * Each section starts from a TRUE baseline (signed here with a throwaway key
 * and a synthetic AWS Nitro attestation under a test root) and then breaks
 * one part at a time: a header that is not the signed block, a header whose
 * time is not the signed time, a header off Base's schedule, a floor stamped
 * after the attestation, a proof that signs two floors, and a Base floor read
 * as an Ethereum header (and the reverse). The real harness-minted fuse/3
 * proofs are checked against their floor block too.
 */

import { before, describe, test } from "node:test";
import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  assembleCarrierV2Payload,
  assembleCarrierV3Payload,
  buildCarrier,
  checkFloorHeader,
  completeCarrier,
  completeCarrierInTime,
  floorTimeIsBound,
  headerRlpFromRpc,
  onBaseSchedule,
  parseCarrier,
  signedFloorOf,
  verifyCarrier,
  verifyCeiling,
  verifyExport,
  evmBytesToHex,
  evmHexToBytes,
  type BitGraphProof,
  type CarrierPayload,
  type CarrierProof,
  type ExportVerifyResult,
  type RpcBlockHeader,
} from "@mikeargento/bitgraph-verify";
import { buildMemberExport, completeExport, fetchFloorHeader, floorFromHeader } from "../export.js";
import { BASE_TEST_CHAIN, chainWorld, floorBlock } from "./tree-fixtures.js";
import {
  attest,
  baseBlock,
  BASE_FLOOR_NUMBER,
  BASE_FLOOR_TIME,
  makeTestRoot,
  mintBaseFused,
  mintBaseTree,
  pinsFor,
  TEST_SPEC_V2_B64,
  type BaseTree,
  type TestRoot,
} from "./base-floor-fixtures.js";

const FIX = fileURLToPath(new URL("../../src/__tests__/fuse3-fixtures/", import.meta.url));
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const claim = (r: { claims: Array<{ id: string; result: string; detail: string; restsOn: string; name: string }> }, id: string) => r.claims.find((c) => c.id === id);
const extra = { extraSpecHashes: [TEST_SPEC_V2_B64] };

let t: TestRoot;
before(async () => {
  t = await makeTestRoot();
});

/** A member export of the tree's placed file, its proof attested `afterFloorS` seconds after the floor block. */
async function memberExport(tree: BaseTree, header: string | null, afterFloorS = 20, chain?: unknown): Promise<Record<string, any>> {
  const proof = await attest(tree.proof, tree.key, (BASE_FLOOR_TIME + afterFloorS) * 1000, t);
  const e = buildMemberExport({ proof, rootDocument: tree.rootDocument, leaves: tree.leaves }, tree.placed.index) as unknown as Record<string, any>;
  if (header !== null) e.floor = { ...(chain !== undefined ? { chain } : { chain: "base" }), blockNumber: tree.floor.number, blockHash: tree.floor.hash, header };
  return e;
}

describe("the Base schedule and the floor-time rule", () => {
  test("Base mainnet stamps block n at genesis + 2n; anything else is off schedule", () => {
    assert.ok(onBaseSchedule(BASE_FLOOR_NUMBER, BASE_FLOOR_TIME));
    assert.ok(!onBaseSchedule(BASE_FLOOR_NUMBER, BASE_FLOOR_TIME + 1));
    // The real harness floor follows the schedule too.
    const p = JSON.parse(readFileSync(FIX + "trailer3.proof.json", "utf8")) as BitGraphProof;
    assert.ok(onBaseSchedule(p.commit.slotFloor!.blockNumber, p.commit.slotFloor!.blockTimestamp));
  });

  test("a floor stamped after the attestation is withheld as a bound; at or before it, it is a bound", () => {
    assert.deepEqual(floorTimeIsBound(100, 100_000), { ok: true });
    assert.deepEqual(floorTimeIsBound(100, 101_000), { ok: true });
    const late = floorTimeIsBound(100, 99_999);
    assert.equal(late.ok, false);
    assert.match((late as { reason: string }).reason, /after the attestation document was made/);
    assert.deepEqual(floorTimeIsBound(100, null), { ok: true }, "no attestation time: nothing to compare");
  });

  test("headerRlpFromRpc rebuilds a Base header from a node's JSON, and refuses one that does not hash to the expected block", () => {
    const b = baseBlock();
    assert.equal(evmBytesToHex(headerRlpFromRpc(b.rpc, b.hash)!), b.headerHex);
    assert.equal(headerRlpFromRpc({ ...b.rpc, gasUsed: "0x1" }, b.hash), null);
    assert.equal(headerRlpFromRpc(null, b.hash), null);
  });
});

describe("the real harness fuse/3 proofs against their floor block", () => {
  const header = readFileSync(FIX + "floor-base-52271417.rlp.hex", "utf8").trim();
  const block = JSON.parse(readFileSync(FIX + "floor-base-52271417.block.json", "utf8")) as RpcBlockHeader;
  for (const name of ["trailer3.proof.json", "made3.proof.json"]) {
    test(`${name}: the stand-in Base node's header is the signed floor`, () => {
      const p = JSON.parse(readFileSync(FIX + name, "utf8")) as BitGraphProof;
      const r = checkFloorHeader(signedFloorOf(p)!, evmHexToBytes(header), "base");
      assert.ok(r.ok, r.ok ? "" : r.reason);
      assert.equal(evmBytesToHex(headerRlpFromRpc(block, p.commit.slotFloor!.blockHash)!), header, "the node's JSON rebuilds the same bytes");
      // Negative: the same header read as an Ethereum floor is refused before any hash is compared.
      const eth = checkFloorHeader(signedFloorOf(p)!, evmHexToBytes(header));
      assert.equal(eth.ok, false);
      assert.match((eth as { reason: string }).reason, /given as an Ethereum block, and the proof signs a Base block/);
    });
  }
});

describe("export/1 with a Base floor", () => {
  test("baseline: the export verifies TRUE, names Base, and reads the floor's time from the header", async () => {
    const tree = await mintBaseTree();
    const e = await memberExport(tree, tree.floor.headerHex);
    const r = await verifyExport(e, { bytes: tree.placed.committed, pins: pinsFor(t), ...extra });
    assert.equal(r.verdict, "TRUE", r.reasons.join("; "));
    const h = claim(r, "floor.header")!;
    assert.equal(h.result, "TRUE");
    assert.equal(h.restsOn, `Base block ${BASE_FLOOR_NUMBER}, header as given`);
    assert.match(h.detail, /its time is the signed one, on Base mainnet's schedule/);
    assert.deepEqual(r.times.floor, { chain: "base", blockNumber: BASE_FLOOR_NUMBER, blockHash: tree.floor.hash, blockTimestamp: BASE_FLOOR_TIME });
    assert.equal(r.floorTimeWithheld, null);
    assert.match(claim(r, "floor.record")!.detail, new RegExp(`after Base block ${BASE_FLOOR_NUMBER}`));
    assert.match(claim(r, "floor.content")!.detail, new RegExp(`Base block ${BASE_FLOOR_NUMBER}`));
    assert.match(r.reading, new RegExp(`Recorded after Base block ${BASE_FLOOR_NUMBER} \\(2026-09-30T`));
    assert.match(r.reading, /taken as given until it is checked against Base/);
    assert.doesNotMatch(r.reading, /Ethereum/, "nothing about an Ethereum floor");
    assert.equal(claim(r, "confirmed.floor")!.name, "The floor block is Base's own");
    assert.match(claim(r, "confirmed.floor")!.detail, /no Base lookup was given/);
  });

  test("confirmed: the floor is asked of Base by height, and the canonical hash there must be the signed one", async () => {
    const tree = await mintBaseTree();
    const e = await memberExport(tree, tree.floor.headerHex);
    const asked: number[] = [];
    const yes = await verifyExport(e, { bytes: tree.placed.committed, pins: pinsFor(t), ...extra, lookups: { baseBlockHash: async (n) => (asked.push(n), n === BASE_FLOOR_NUMBER ? tree.floor.hash : null) } });
    assert.equal(claim(yes, "confirmed.floor")!.result, "TRUE");
    assert.deepEqual(asked, [BASE_FLOOR_NUMBER]);
    assert.doesNotMatch(yes.reading, /taken as given/);
    // Negative: another block at that height (a reorg, or a header made up) refutes the export.
    const no = await verifyExport(e, { bytes: tree.placed.committed, pins: pinsFor(t), ...extra, lookups: { baseBlockHash: async () => baseBlock(BASE_FLOOR_NUMBER, { salt: "reorg" }).hash } });
    assert.equal(claim(no, "confirmed.floor")!.result, "FALSE");
    assert.equal(no.verdict, "FALSE");
    // Negative: an Ethereum node is never asked about a Base floor.
    const eth = await verifyExport(e, { bytes: tree.placed.committed, pins: pinsFor(t), ...extra, lookups: { ethereumBlockHash: async () => tree.floor.hash } });
    assert.equal(claim(eth, "confirmed.floor")!.result, "UNDETERMINED");
  });

  test("NEGATIVE: a header that is not the signed block (same height, another hash) is FALSE", async () => {
    const tree = await mintBaseTree();
    const other = baseBlock(BASE_FLOOR_NUMBER, { salt: "other" });
    const e = await memberExport(tree, other.headerHex);
    const r = await verifyExport(e, { bytes: tree.placed.committed, pins: pinsFor(t), ...extra });
    assert.equal(claim(r, "floor.header")!.result, "FALSE");
    assert.match(claim(r, "floor.header")!.detail, /does not hash to the signed Base block hash/);
    assert.equal(r.verdict, "FALSE");
    assert.equal(r.times.floor, null);
  });

  test("NEGATIVE: a header whose time is not the signed blockTimestamp is FALSE", async () => {
    const tree = await mintBaseTree({ slotFloor: { blockTimestamp: BASE_FLOOR_TIME + 2 } });
    const e = await memberExport(tree, tree.floor.headerHex);
    const r = await verifyExport(e, { bytes: tree.placed.committed, pins: pinsFor(t), ...extra });
    assert.equal(claim(r, "floor.header")!.result, "FALSE");
    assert.match(claim(r, "floor.header")!.detail, new RegExp(`the header's time is ${BASE_FLOOR_TIME}, the proof signs ${BASE_FLOOR_TIME + 2}`));
  });

  test("NEGATIVE: a header off Base mainnet's schedule is FALSE, even when the proof signs its time", async () => {
    const off = baseBlock(BASE_FLOOR_NUMBER, { timestamp: BASE_FLOOR_TIME + 1 });
    const tree = await mintBaseTree({ floor: off });
    const e = await memberExport(tree, off.headerHex);
    const r = await verifyExport(e, { bytes: tree.placed.committed, pins: pinsFor(t), ...extra });
    assert.equal(claim(r, "floor.header")!.result, "FALSE");
    assert.match(claim(r, "floor.header")!.detail, /off Base mainnet's schedule/);
  });

  test("NEGATIVE: a floor stamped after the attestation document: its time is withheld as a bound, the floor itself holds", async () => {
    const tree = await mintBaseTree();
    const e = await memberExport(tree, tree.floor.headerHex, -10);
    const r = await verifyExport(e, { bytes: tree.placed.committed, pins: pinsFor(t), ...extra });
    assert.equal(claim(r, "floor.header")!.result, "TRUE", "the header is the signed block");
    assert.match(claim(r, "floor.header")!.detail, /after the attestation document was made .*so its time is not used as a bound/);
    assert.equal(r.times.floor, null, "no floor time is reported");
    assert.match(r.floorTimeWithheld ?? "", /stamped 2026-09-30T.*after the attestation document/);
    assert.match(r.reading, new RegExp(`Recorded after Base block ${BASE_FLOOR_NUMBER};`), "the block, never its time");
    assert.match(r.reading, /The floor block's time is not used as a bound: /);
    // Exactly at the attestation's second it is still a bound.
    const atSecond = await verifyExport(await memberExport(tree, tree.floor.headerHex, 0), { bytes: tree.placed.committed, pins: pinsFor(t), ...extra });
    assert.ok(atSecond.times.floor);
  });

  test("NEGATIVE: a proof that signs both floors is ambiguous: FALSE, no floor read", async () => {
    const eth = floorBlock();
    const tree = await mintBaseTree({ slotAnchor: { counter: "699", blockNumber: 25_500_000, blockHash: eth.hash } });
    const e = await memberExport(tree, tree.floor.headerHex);
    const r = await verifyExport(e, { bytes: tree.placed.committed, pins: pinsFor(t), ...extra });
    assert.equal(claim(r, "floor.header")!.result, "FALSE");
    assert.match(claim(r, "floor.header")!.detail, /signs two floors .* ambiguous/);
    assert.equal(r.times.floor, null);
    assert.equal(r.verdict, "FALSE");
  });

  test("NEGATIVE: a Base-floor proof checked against an Ethereum header, or its own header labelled Ethereum, is FALSE", async () => {
    const tree = await mintBaseTree();
    // An Ethereum header, given as Ethereum (no chain): wrong chain for this proof.
    const eth = floorBlock();
    const e1 = await memberExport(tree, eth.headerHex, 20, null);
    const r1 = await verifyExport(e1, { bytes: tree.placed.committed, pins: pinsFor(t), ...extra });
    assert.equal(claim(r1, "floor.header")!.result, "FALSE");
    assert.match(claim(r1, "floor.header")!.detail, /given as an Ethereum block, and the proof signs a Base block/);
    // The right Base header, but the export calls it Ethereum (chain absent): still FALSE.
    const e2 = await memberExport(tree, tree.floor.headerHex);
    delete e2.floor.chain;
    const r2 = await verifyExport(e2, { bytes: tree.placed.committed, pins: pinsFor(t), ...extra });
    assert.equal(claim(r2, "floor.header")!.result, "FALSE");
    // The reverse: an Ethereum-floor export whose floor is relabelled Base.
    const vec = JSON.parse(readFileSync(fileURLToPath(new URL("../../spec/vectors/export-1.json", import.meta.url)), "utf8")) as { memberExport: Record<string, any>; memberFileHex: string };
    const e3 = clone(vec.memberExport);
    e3.floor.chain = "base";
    const r3 = await verifyExport(e3, { bytes: Buffer.from(vec.memberFileHex, "hex") });
    assert.equal(claim(r3, "floor.header")!.result, "FALSE");
    assert.match(claim(r3, "floor.header")!.detail, /given as a Base block, and the proof signs an Ethereum block/);
    // And an unknown chain name.
    const e4 = await memberExport(tree, tree.floor.headerHex, 20, "solana");
    assert.equal(claim(await verifyExport(e4, { bytes: tree.placed.committed, pins: pinsFor(t), ...extra }), "floor.header")!.result, "FALSE");
  });

  test("the export's floor names a different block than its header: FALSE", async () => {
    const tree = await mintBaseTree();
    const e = await memberExport(tree, tree.floor.headerHex);
    e.floor.blockNumber += 1;
    const r = await verifyExport(e, { bytes: tree.placed.committed, pins: pinsFor(t), ...extra });
    assert.equal(claim(r, "floor.header")!.result, "FALSE");
  });

  test("the Ethereum vector is unchanged: no chain on its floor, no chain in its times", async () => {
    const vec = JSON.parse(readFileSync(fileURLToPath(new URL("../../spec/vectors/export-1.json", import.meta.url)), "utf8")) as { memberExport: Record<string, any>; memberFileHex: string };
    assert.equal("chain" in vec.memberExport.floor, false);
    const r = await verifyExport(vec.memberExport, { bytes: Buffer.from(vec.memberFileHex, "hex") });
    assert.equal(claim(r, "floor.header")!.result, "TRUE");
    assert.equal(claim(r, "floor.header")!.restsOn.startsWith("Ethereum block "), true);
    assert.equal(r.times.floor && "chain" in r.times.floor, false);
    assert.equal(claim(r, "confirmed.floor")!.name, "The floor block is Ethereum's own");
  });
});

describe("the export builder with a Base floor", () => {
  test("floorFromHeader: the signed Base block, with its chain; anything else null", async () => {
    const tree = await mintBaseTree();
    assert.deepEqual(floorFromHeader(tree.proof, tree.floor.headerHex), { chain: "base", blockNumber: BASE_FLOOR_NUMBER, blockHash: tree.floor.hash, header: tree.floor.headerHex });
    assert.equal(floorFromHeader(tree.proof, baseBlock(BASE_FLOOR_NUMBER, { salt: "x" }).headerHex), null);
    assert.equal(floorFromHeader(tree.proof, floorBlock().headerHex), null, "an Ethereum header is not a Base floor");
    const late = await mintBaseTree({ slotFloor: { blockTimestamp: BASE_FLOOR_TIME + 2 } });
    assert.equal(floorFromHeader(late.proof, late.floor.headerHex), null, "a header whose time is not the signed one");
  });

  test("buildMemberExport names the chain of a Base floor even when the caller left it out", async () => {
    const tree = await mintBaseTree();
    const e = buildMemberExport({ proof: tree.proof, rootDocument: tree.rootDocument, leaves: tree.leaves }, tree.placed.index, { floor: { blockNumber: BASE_FLOOR_NUMBER, blockHash: tree.floor.hash, header: tree.floor.headerHex } });
    assert.equal(e.floor?.chain, "base");
  });

  /** A Base node (JSON-RPC by height) and a site whose ceiling routes have nothing yet. */
  function world(block: RpcBlockHeader | null) {
    const calls: Array<{ url: string; method: string; body: any }> = [];
    const f = async (input: string, init?: RequestInit): Promise<Response> => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ url: input, method: init?.method ?? "GET", body });
      const json = (s: number, j: unknown) => new Response(JSON.stringify(j), { status: s, headers: { "content-type": "application/json" } });
      if (input.startsWith("https://base.test")) return json(200, { jsonrpc: "2.0", id: 1, result: body?.params?.[0] === `0x${BASE_FLOOR_NUMBER.toString(16)}` ? block : null });
      return json(404, { error: "not found" });
    };
    return { calls, fetch: f as unknown as typeof fetch };
  }

  test("fetchFloorHeader asks the Base node for the signed height and keeps the header only when it is the signed block", async () => {
    const tree = await mintBaseTree();
    const w = world(tree.floor.rpc);
    const f = await fetchFloorHeader(tree.proof, w.fetch, { baseRpcUrl: "https://base.test" });
    assert.deepEqual(f, { chain: "base", blockNumber: BASE_FLOOR_NUMBER, blockHash: tree.floor.hash, header: tree.floor.headerHex });
    assert.equal(w.calls.length, 1);
    assert.equal(w.calls[0]!.body.method, "eth_getBlockByNumber");
    assert.deepEqual(w.calls[0]!.body.params, [`0x${BASE_FLOOR_NUMBER.toString(16)}`, false]);
    // Negative: the node's block at that height is another block.
    const other = world(baseBlock(BASE_FLOOR_NUMBER, { salt: "fork" }).rpc);
    assert.equal(await fetchFloorHeader(tree.proof, other.fetch, { baseRpcUrl: "https://base.test" }), null);
  });

  test("completeExport embeds a Base floor fetched by height, verified; never from the Ethereum witness route", async () => {
    const tree = await mintBaseTree();
    const e = buildMemberExport({ proof: tree.proof, rootDocument: tree.rootDocument, leaves: tree.leaves }, tree.placed.index);
    const w = world(tree.floor.rpc);
    const done = await completeExport(e, w.fetch, { baseUrl: "https://site.test", baseRpcUrl: "https://base.test" });
    assert.equal(done.floor, "present");
    assert.equal(done.export.floor?.chain, "base");
    assert.equal(w.calls.some((c) => c.url.includes("/api/proofs/witness")), false);
    const r = await verifyExport(done.export, { bytes: tree.placed.committed, ...extra });
    assert.equal(claim(r, "floor.header")!.result, "TRUE");
    // Negative: a node answering another block leaves the floor out, with a note.
    const bad = await completeExport(e, world(baseBlock(BASE_FLOOR_NUMBER, { salt: "fork" }).rpc).fetch, { baseUrl: "https://site.test", baseRpcUrl: "https://base.test" });
    assert.equal(bad.floor, "absent");
    assert.ok(bad.notes.some((n) => /is not the floor block the proof signs; not embedded/.test(n)), bad.notes.join("; "));
  });
});

describe("the ceiling sidecar with a Base floor", () => {
  test("the carried Base floor header is checked against slotFloor; the window names Base; its time feeds the stamp rule", async () => {
    const tree = await mintBaseTree();
    const w = chainWorld(tree.proof, undefined, { baseTime: BASE_FLOOR_TIME + 40 });
    const sidecar = { ...w.sidecar, floor: { chain: "base" as const, blockNumber: BASE_FLOOR_NUMBER, blockHash: tree.floor.hash, blockTimestamp: BASE_FLOOR_TIME, blockHeader: tree.floor.headerHex } };
    const r = await verifyCeiling(tree.proof, sidecar, { writerAddress: w.writer, chainId: BASE_TEST_CHAIN });
    assert.ok(r.ok, r.reason);
    assert.equal(r.window?.floor.chain, "base");
    assert.equal(r.window?.floor.blockTimestamp, BASE_FLOOR_TIME);
    assert.equal(r.window?.widthSeconds, 40);
    assert.match(r.checks.find((c) => c.name === "floor")!.detail!, /^Base block /);
    // Without a carried floor the window still names the signed Base block, with no time.
    const bare = await verifyCeiling(tree.proof, { ...w.sidecar, floor: null }, { writerAddress: w.writer, chainId: BASE_TEST_CHAIN });
    assert.ok(bare.ok);
    assert.deepEqual(bare.window?.floor, { chain: "base", blockNumber: BASE_FLOOR_NUMBER, blockHash: tree.floor.hash, blockTimestamp: null });
  });

  test("NEGATIVE: the sidecar's Base floor without its chain, another header, or for a proof with both floors fails the sidecar", async () => {
    const tree = await mintBaseTree();
    const w = chainWorld(tree.proof, undefined, { baseTime: BASE_FLOOR_TIME + 40 });
    const floor = { blockNumber: BASE_FLOOR_NUMBER, blockHash: tree.floor.hash, blockTimestamp: BASE_FLOOR_TIME, blockHeader: tree.floor.headerHex };
    const noChain = await verifyCeiling(tree.proof, { ...w.sidecar, floor }, { writerAddress: w.writer, chainId: BASE_TEST_CHAIN });
    assert.equal(noChain.ok, false);
    assert.match(noChain.reason!, /^floor: the carried floor header does not match the proof's signed slotFloor: the header is given as an Ethereum block/);
    const other = await verifyCeiling(tree.proof, { ...w.sidecar, floor: { ...floor, chain: "base", blockHeader: baseBlock(BASE_FLOOR_NUMBER, { salt: "x" }).headerHex } }, { writerAddress: w.writer, chainId: BASE_TEST_CHAIN });
    assert.equal(other.ok, false);
    assert.match(other.reason!, /does not hash to the signed Base block hash/);
    const both = await mintBaseTree({ slotAnchor: { counter: "699", blockNumber: 25_500_000, blockHash: floorBlock().hash } });
    const wb = chainWorld(both.proof);
    const r = await verifyCeiling(both.proof, { ...wb.sidecar, floor: null }, { writerAddress: wb.writer, chainId: BASE_TEST_CHAIN });
    assert.equal(r.ok, false);
    assert.match(r.reason!, /^floor: the proof signs two floors/);
  });

  test("the export reads a Base ceiling over a Base floor, the stamp checked against the floor's time", async () => {
    const tree = await mintBaseTree();
    const e = await memberExport(tree, tree.floor.headerHex);
    const w = chainWorld(e.proof as BitGraphProof, undefined, { baseTime: BASE_FLOOR_TIME + 40 });
    e.ceiling = w.sidecar;
    const r = await verifyExport(e, { bytes: tree.placed.committed, pins: { ...pinsFor(t), ceilingWriter: w.writer, baseChainId: BASE_TEST_CHAIN }, ...extra });
    assert.equal(claim(r, "ceiling.base")!.result, "TRUE");
    assert.equal(r.times.ceilingBase?.blockTimestamp, BASE_FLOOR_TIME + 40);
    // A Base stamp before the floor block's own time is withheld.
    const early = chainWorld(e.proof as BitGraphProof, undefined, { baseTime: BASE_FLOOR_TIME - 4 });
    e.ceiling = early.sidecar;
    const r2 = await verifyExport(e, { bytes: tree.placed.committed, pins: { ...pinsFor(t), ceilingWriter: early.writer, baseChainId: BASE_TEST_CHAIN }, ...extra });
    assert.equal(r2.times.ceilingBase, null);
    assert.match(r2.baseTimeWithheld ?? "", /before the floor block's own time/);
  });
});

describe("bitgraph-carrier/3: the BitGraphed file over a Base floor", () => {
  async function carrier3(o: Parameters<typeof mintBaseFused>[0] = {}, afterFloorS = 20, header?: string) {
    const m = await mintBaseFused(o);
    const proof = await attest(m.proof, m.key, (BASE_FLOOR_TIME + afterFloorS) * 1000, t);
    const payload = assembleCarrierV3Payload({ proof: proof as unknown as CarrierProof, floor: { status: "present", basis: "base-header", header: header ?? m.floor.headerHex }, ceilingInTime: { status: "unfetched" } });
    return { m, proof, payload, bytes: buildCarrier(m.fused, payload) };
  }

  test("baseline: the exact shape, and it verifies TRUE with the floor on Base and no ceiling in position", async () => {
    const { m, payload, bytes } = await carrier3();
    assert.equal(payload.carrier, "bitgraph-carrier/3");
    assert.deepEqual(payload.floor, { status: "present", basis: "base-header", header: m.floor.headerHex });
    assert.deepEqual(payload.ceiling, { status: "none", basis: "hash-chain" });
    assert.deepEqual(payload.ceilingInTime, { status: "unfetched" });
    const r = await verifyCarrier(bytes, { pins: pinsFor(t) });
    assert.equal(r.verdict, "TRUE", r.reasons.join("; "));
    assert.equal(r.version, 3);
    assert.equal(r.ceiling, "none");
    for (const id of ["bytes.digest", "proof.signature", "proof.fused", "floor.binding", "floor.header", "attestation.pins"]) assert.equal(claim(r, id)?.result, "TRUE", `${id}: ${claim(r, id)?.detail}`);
    assert.equal(claim(r, "floor.anchor"), undefined, "no anchor stands under a Base floor");
    assert.equal(claim(r, "ceiling.position")?.result, "NOT_CARRIED");
    assert.match(claim(r, "ceiling.position")!.detail, /chain of proof hashes/);
    assert.equal(claim(r, "floor.header")!.restsOn, `Base block ${BASE_FLOOR_NUMBER}, header as given`);
    assert.deepEqual(r.bounds?.notBefore, { chain: "base", blockNumber: BASE_FLOOR_NUMBER, blockHash: m.floor.hash, timestamp: BASE_FLOOR_TIME });
    assert.equal(r.bounds?.notAfter, null);
    assert.equal(r.floorTimeWithheld, null);
    assert.match(r.reading, new RegExp(`Recorded after Base block ${BASE_FLOOR_NUMBER} \\(2026-09-30T[0-9:]+Z\\); its order among BitGraphs is the chain of proof hashes\\.`));
    assert.match(r.reading, new RegExp(`Rests on: SHA-256, Ed25519, the AWS Nitro root \\([0-9A-F]+…\\), Base block ${BASE_FLOOR_NUMBER}\\.`));
    assert.doesNotMatch(r.reading, /Ethereum|anchoring/);
    assert.equal(claim(r, "confirmed.floor")!.name, "The floor block is Base's own");
  });

  test("confirmed: the floor is asked of a Base node by height; an Ethereum node is not asked", async () => {
    const { m, bytes } = await carrier3();
    const yes = await verifyCarrier(bytes, { pins: pinsFor(t), lookups: { baseBlockHash: async (n) => (n === BASE_FLOOR_NUMBER ? m.floor.hash : null) } });
    assert.equal(claim(yes, "confirmed.floor")!.result, "TRUE");
    const no = await verifyCarrier(bytes, { pins: pinsFor(t), lookups: { baseBlockHash: async () => baseBlock(BASE_FLOOR_NUMBER, { salt: "reorg" }).hash } });
    assert.equal(claim(no, "confirmed.floor")!.result, "FALSE");
    assert.equal(no.verdict, "FALSE");
    const eth = await verifyCarrier(bytes, { pins: pinsFor(t), lookups: { ethereumBlockHash: async () => m.floor.hash } });
    assert.equal(claim(eth, "confirmed.floor")!.result, "UNDETERMINED");
    assert.match(claim(eth, "confirmed.floor")!.detail, /no Base node given/);
  });

  test("NEGATIVE: a header that is not the signed block is FALSE", async () => {
    const { bytes } = await carrier3({}, 20, baseBlock(BASE_FLOOR_NUMBER, { salt: "other" }).headerHex);
    const r = await verifyCarrier(bytes, { pins: pinsFor(t) });
    assert.equal(r.verdict, "FALSE");
    assert.equal(claim(r, "floor.binding")!.result, "FALSE");
    assert.match(claim(r, "floor.binding")!.detail, /does not hash to the signed Base block hash/);
  });

  test("NEGATIVE: a header whose time disagrees with the signed one is FALSE", async () => {
    const { bytes } = await carrier3({ slotFloor: { blockTimestamp: BASE_FLOOR_TIME + 2 } });
    const r = await verifyCarrier(bytes, { pins: pinsFor(t) });
    assert.equal(r.verdict, "FALSE");
    assert.match(claim(r, "floor.binding")!.detail, /the header's time is .*the proof signs/);
  });

  test("NEGATIVE: a header off Base's schedule is FALSE", async () => {
    const off = baseBlock(BASE_FLOOR_NUMBER, { timestamp: BASE_FLOOR_TIME - 1 });
    const { bytes } = await carrier3({ floor: off }, 20, off.headerHex);
    const r = await verifyCarrier(bytes, { pins: pinsFor(t) });
    assert.equal(r.verdict, "FALSE");
    assert.match(claim(r, "floor.binding")!.detail, /off Base mainnet's schedule/);
  });

  test("NEGATIVE: a floor stamped after the attestation: the time is withheld, the block still floors the record", async () => {
    const { bytes } = await carrier3({}, -6);
    const r = await verifyCarrier(bytes, { pins: pinsFor(t) });
    assert.equal(r.verdict, "TRUE", r.reasons.join("; "));
    assert.match(r.floorTimeWithheld ?? "", /after the attestation document was made/);
    assert.equal(r.bounds?.notBefore.timestamp, null, "the window states no floor time");
    assert.match(r.reading, new RegExp(`Recorded after Base block ${BASE_FLOOR_NUMBER};`));
    assert.match(r.reading, /The floor block's time is not used as a bound: /);
  });

  test("NEGATIVE: a proof that signs both floors is FALSE, in a /3 block and in a /2 block", async () => {
    const eth = floorBlock();
    const anchor = { counter: "799", blockNumber: 25_500_000, blockHash: eth.hash };
    const { bytes, proof, m } = await carrier3({ slotAnchor: anchor });
    const r = await verifyCarrier(bytes, { pins: pinsFor(t) });
    assert.equal(r.verdict, "FALSE");
    assert.match(claim(r, "floor.binding")!.detail, /signs two floors/);
    const v2 = assembleCarrierV2Payload({ proof: proof as unknown as CarrierProof, floor: { status: "present", anchor: {}, witness: { headerRlpHex: eth.headerHex, blockNumber: 25_500_000, blockHash: eth.hash } }, ceiling: { status: "unfetched" }, ceilingInTime: { status: "unfetched" } });
    const r2 = await verifyCarrier(buildCarrier(m.fused, v2), { pins: pinsFor(t) });
    assert.equal(claim(r2, "floor.binding")!.result, "FALSE");
    assert.match(claim(r2, "floor.binding")!.detail, /signs two floors/);
  });

  test("NEGATIVE: a Base-floor proof carried with an Ethereum floor (a /2 block) is FALSE", async () => {
    const { proof, m } = await carrier3();
    const eth = floorBlock();
    const v2 = assembleCarrierV2Payload({ proof: proof as unknown as CarrierProof, floor: { status: "present", anchor: {}, witness: { headerRlpHex: eth.headerHex, blockNumber: 25_500_000, blockHash: eth.hash } }, ceiling: { status: "unfetched" }, ceilingInTime: { status: "unfetched" } });
    const r = await verifyCarrier(buildCarrier(m.fused, v2), { pins: pinsFor(t) });
    assert.equal(r.verdict, "FALSE");
    assert.match(claim(r, "floor.binding")!.detail, /the proof signs a Base floor \(commit\.slotFloor\), and this block carries an Ethereum anchor/);
  });

  test("the block's shape: /3 requires a Base header and states no ceiling in position; /2 refuses a Base header", async () => {
    const { m, payload } = await carrier3();
    const shapeOf = (p: unknown) => parseCarrier(buildCarrier(m.fused, p as CarrierPayload));
    const corrupt = (p: unknown, re: RegExp) => {
      const r = shapeOf(p);
      assert.equal(r.kind, "corrupt");
      assert.match((r as { reason: string }).reason, re);
    };
    assert.equal(shapeOf(payload).kind, "carrier");
    corrupt({ ...payload, ceiling: { status: "unfetched" } }, /states no ceiling in position/);
    corrupt({ ...payload, floor: { status: "present", basis: "base-header", header: "0xzz" } }, /no readable Base block header/);
    corrupt({ ...payload, floor: { ...payload.floor, anchor: {} } }, /carries no anchor proof/);
    corrupt({ ...payload, ceilingInTime: undefined }, /ceilingInTime is missing/);
    corrupt({ ...payload, carrier: "bitgraph-carrier/2" }, /unknown floor basis "base-header"/);
    corrupt({ ...payload, carrier: "bitgraph-carrier/4" }, /unknown carrier version/);
  });

  test("completion: no closing anchor is ever stamped into /3; the ceiling in time is", async () => {
    const { bytes } = await carrier3();
    const c = completeCarrier(bytes, null, { asOfCounter: "900", epochId: "e" });
    assert.equal(c.changed, false);
    assert.match(c.error ?? "", /has no ceiling in position: its order is the chain of proof hashes/);
    const ct = completeCarrierInTime(bytes, null, { at: "2026-10-06T00:00:00.000Z" });
    assert.equal(ct.changed, true);
    const p = parseCarrier(ct.bytes);
    assert.equal(p.kind === "carrier" && p.payload.ceilingInTime?.status, "unfetched");
  });
});
