/**
 * bitgraph-ceiling/1: the offline verifier against a synthetic Base block
 * built here from scratch (a real production proof, a transaction signed with
 * a throwaway key, a header whose transactionsRoot is the rebuilt trie), and
 * every adversarial case the build prompt lists. Nothing touches a network.
 */

import { test } from "node:test";
import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha256";
import { computeProofHash } from "../proof-hash.js";
import { MerkleTree, merkleLeafHash } from "../fuse-merkle.js";
import {
  CEILING_VERSION, ceilingLeaf, ceilingPayloadHash, decodeCeilingPayload, encodeCeilingPayload, verifyCeiling,
  type CeilingSidecar,
} from "../ceiling.js";
import { bytesToHex, hexToBytes, keccak256, rlpDecode, rlpEncode, decodeEip1559, type RlpItem } from "../ceiling-evm.js";
import { txTrieProof } from "../ceiling-trie.js";
import type { BitGraphProof } from "../types.js";

const fix = (dir: string, name: string): string => readFileSync(new URL(`../../src/__tests__/fixtures/${dir}/${name}`, import.meta.url), "utf8");
const proof = JSON.parse(fix("carrier", "demo2.proof.json")) as BitGraphProof;
const floorHeader = fix("ceiling", "floor-26037892.header.hex").trim();
const CHAIN = 84532;

function u(n: bigint | number): Uint8Array {
  let h = BigInt(n).toString(16);
  if (h === "0") return new Uint8Array(0);
  if (h.length % 2) h = "0" + h;
  return hexToBytes(h);
}

function addressOf(priv: Uint8Array): string {
  return bytesToHex(keccak256(secp256k1.getPublicKey(priv, false).slice(1)).slice(12));
}

function signTx(priv: Uint8Array, opts: { to: string; data: Uint8Array; chainId?: number; nonce?: number }): Uint8Array {
  const fields: RlpItem[] = [
    u(opts.chainId ?? CHAIN), u(opts.nonce ?? 0), u(1_000_000), u(2_000_000_000), u(30_000),
    hexToBytes(opts.to), u(0), opts.data, [],
  ];
  const hash = keccak256(new Uint8Array([0x02, ...rlpEncode(fields)]));
  const sig = secp256k1.sign(hash, priv, { prehash: false, format: "recovered" });
  const rec = sig[0]!;
  const r = BigInt(bytesToHex(sig.slice(1, 33)));
  const s = BigInt(bytesToHex(sig.slice(33, 65)));
  return new Uint8Array([0x02, ...rlpEncode([...fields, u(rec), u(r), u(s)])]);
}

function header(txRoot: Uint8Array, number: number, timestamp: number): Uint8Array {
  const z32 = new Uint8Array(32);
  return rlpEncode([
    z32, z32, new Uint8Array(20), z32, txRoot, z32, new Uint8Array(256), u(0), u(number), u(30_000_000),
    u(21_000), u(timestamp), new Uint8Array(0), z32, new Uint8Array(8), u(1000),
  ]);
}

interface World { sidecar: CeilingSidecar; writer: string; priv: Uint8Array }

/** Build a complete, valid world; `tweak` edits the ingredients before anything is hashed. */
function build(tweak: { data?: (p: Uint8Array) => Uint8Array; signer?: Uint8Array; to?: string; chainId?: number } = {}): World {
  const priv = secp256k1.utils.randomSecretKey();
  const writer = addressOf(priv);
  const proofHash = computeProofHash(proof);
  const others = [1, 2, 3, 4].map((i) => merkleLeafHash(sha256(new Uint8Array([i]))));
  const leaves = [others[0]!, others[1]!, ceilingLeaf(proofHash), others[2]!, others[3]!];
  const tree = new MerkleTree(leaves);
  let payload = encodeCeilingPayload({ root: tree.root, prev: new Uint8Array(32), firstPos: 2870n, lastPos: 2880n });
  if (tweak.data) payload = tweak.data(payload);
  const raw = signTx(tweak.signer ?? priv, { to: tweak.to ?? writer, data: payload, ...(tweak.chainId ? { chainId: tweak.chainId } : {}) });
  const block = [hexToBytes("0x7e0102"), hexToBytes("0x02c0ffee"), raw, hexToBytes("0x01aabbcc")];
  const txIndex = 2;
  const { root: txRoot, proof: inclusion } = txTrieProof(block, txIndex);
  const ts = 1_790_000_000;
  const hdr = header(txRoot, 30_000_000, ts);
  const fh = rlpDecode(hexToBytes(floorHeader)) as Uint8Array[];
  const floorTs = Number(BigInt(bytesToHex(fh[11]!)));
  const sidecar: CeilingSidecar = {
    version: CEILING_VERSION,
    proofHash,
    leafIndex: 2,
    leafCount: 5,
    merklePath: tree.path(2).map(bytesToHex),
    root: bytesToHex(tree.root),
    anchor: {
      chainId: CHAIN,
      writer,
      txHash: bytesToHex(keccak256(raw)),
      rawTx: bytesToHex(raw),
      payload: bytesToHex(payload),
      blockNumber: 30_000_000,
      blockHash: bytesToHex(keccak256(hdr)),
      blockTimestamp: ts,
      blockHeader: bytesToHex(hdr),
      txIndex,
      txInclusionProof: inclusion.map(bytesToHex),
    },
    status: "included",
    statusObserved: { included: "2026-09-29T00:00:00.000Z", safe: null, finalized: null },
    floor: { blockNumber: 26037892, blockHash: proof.commit.slotAnchor!.blockHash, blockTimestamp: floorTs, blockHeader: floorHeader },
    settlement: null,
  };
  return { sidecar, writer, priv };
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

test("payload round-trips and chains", () => {
  const root = sha256(new Uint8Array([1]));
  const p = encodeCeilingPayload({ root, prev: new Uint8Array(32), firstPos: 7n, lastPos: 2n ** 63n });
  assert.equal(p.length, 84);
  assert.equal(new TextDecoder().decode(p.slice(0, 4)), "BGC1");
  const d = decodeCeilingPayload(p);
  assert.deepEqual(d.root, root);
  assert.equal(d.lastPos, 2n ** 63n);
  assert.equal(ceilingPayloadHash(p).length, 32);
});

test("a single-record batch's root is its leaf hash", () => {
  const leaf = ceilingLeaf(computeProofHash(proof));
  assert.deepEqual(new MerkleTree([leaf]).root, leaf);
});

test("tx decoder recovers the signer", () => {
  const priv = secp256k1.utils.randomSecretKey();
  const raw = signTx(priv, { to: addressOf(priv), data: new Uint8Array(84) });
  assert.equal(decodeEip1559(raw).from, addressOf(priv));
});

test("a valid sidecar verifies and reports the window", async () => {
  const { sidecar, writer } = build();
  const r = await verifyCeiling(proof, sidecar, { writerAddress: writer, chainId: CHAIN });
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.window!.ceiling.blockNumber, 30_000_000);
  assert.equal(r.window!.floor.blockNumber, 26037892);
  assert.ok(r.window!.floor.blockTimestamp! > 0);
  assert.equal(r.window!.widthSeconds, 1_790_000_000 - r.window!.floor.blockTimestamp!);
  assert.match(r.label!, /Relies on Base's sequencer until its batch data is on Ethereum; no settlement evidence is attached\.$/);
  assert.equal(r.headerCheckedAgainstChain, false);
});

test("at safe the label says settled", async () => {
  const { sidecar, writer } = build();
  sidecar.status = "safe";
  const r = await verifyCeiling(proof, sidecar, { writerAddress: writer, chainId: CHAIN });
  assert.match(r.label!, /reported the block "(safe|finalized)" when this file was written; that report is not proven here, and no settlement evidence is attached\.$/);
  assert.doesNotMatch(r.label!, /settled on Ethereum/);
  assert.doesNotMatch(r.label!, /Relies/);
});

test("pending says pending, never a ceiling", async () => {
  const { sidecar, writer } = build();
  sidecar.status = "pending";
  sidecar.anchor = null;
  const r = await verifyCeiling(proof, sidecar, { writerAddress: writer, chainId: CHAIN });
  assert.equal(r.ok, false);
  assert.match(r.reason!, /ceiling pending/);
  assert.equal(r.window, undefined);
});

// ── adversarial fixtures ──

const rejects = async (name: string, mk: () => { sidecar: CeilingSidecar; writer: string; p?: BitGraphProof }, re: RegExp) =>
  test(`rejects: ${name}`, async () => {
    const { sidecar, writer, p } = mk();
    const r = await verifyCeiling(p ?? proof, sidecar, { writerAddress: writer, chainId: CHAIN });
    assert.equal(r.ok, false, `accepted: ${name}`);
    assert.match(r.reason!, re);
  });

await rejects("wrong sender", () => {
  const other = secp256k1.utils.randomSecretKey();
  const w = build({ signer: other });
  return { sidecar: w.sidecar, writer: w.writer };
}, /^sender: .*not the declared writer/);

await rejects("declared writer is someone else", () => {
  const w = build();
  return { sidecar: w.sidecar, writer: "0x" + "11".repeat(20) };
}, /^sender:/);

await rejects("not addressed to the writer", () => {
  const w = build({ to: "0x" + "22".repeat(20) });
  return { sidecar: w.sidecar, writer: w.writer };
}, /^sender: .*addressed to/);

await rejects("altered root (sidecar)", () => {
  const w = build();
  const s = clone(w.sidecar);
  s.root = "0x" + "ab".repeat(32);
  return { sidecar: s, writer: w.writer };
}, /^merkle:/);

await rejects("altered root (payload, re-signed by the writer)", () => {
  const w = build({ data: (p) => { const q = p.slice(); q[10] = q[10]! ^ 1; return q; } });
  return { sidecar: w.sidecar, writer: w.writer };
}, /^payload: .*root/);

await rejects("leaf not in the tree", () => {
  const w = build();
  const s = clone(w.sidecar);
  s.leafIndex = 3;
  return { sidecar: s, writer: w.writer };
}, /^merkle:/);

await rejects("tampered block header", () => {
  const w = build();
  const s = clone(w.sidecar);
  const h = hexToBytes(s.anchor!.blockHeader);
  h[h.length - 3] = h[h.length - 3]! ^ 1;
  s.anchor!.blockHeader = bytesToHex(h);
  return { sidecar: s, writer: w.writer };
}, /^header:/);

await rejects("tampered timestamp (sidecar field)", () => {
  const w = build();
  const s = clone(w.sidecar);
  s.anchor!.blockTimestamp -= 3600;
  return { sidecar: s, writer: w.writer };
}, /^header: .*timestamp/);

await rejects("transaction not in the block", () => {
  const w = build();
  const s = clone(w.sidecar);
  s.anchor!.txIndex = 1;
  return { sidecar: s, writer: w.writer };
}, /^inclusion:/);

await rejects("inclusion proof from another block", () => {
  const w1 = build();
  const w2 = build();
  const s = clone(w1.sidecar);
  s.anchor!.txInclusionProof = w2.sidecar.anchor!.txInclusionProof;
  return { sidecar: s, writer: w1.writer };
}, /^inclusion:/);

await rejects("wrong magic", () => {
  const w = build({ data: (p) => { const q = p.slice(); q.set(new TextEncoder().encode("BGC2"), 0); return q; } });
  return { sidecar: w.sidecar, writer: w.writer };
}, /^payload: .*magic/);

await rejects("sidecar belonging to a different proof", () => {
  const w = build();
  const other = clone(proof);
  other.commit.counter = "9999";
  return { sidecar: w.sidecar, writer: w.writer, p: other };
}, /^(proof|record):/);

await rejects("wrong chain", () => {
  const w = build({ chainId: 8453 });
  return { sidecar: w.sidecar, writer: w.writer };
}, /^chain:/);

test("a rebuilt header with a moved timestamp passes offline and says it was not checked against the chain", async () => {
  const w = build();
  const s = clone(w.sidecar);
  const f = rlpDecode(hexToBytes(s.anchor!.blockHeader)) as Uint8Array[];
  // A fabricated header must still commit to the real transactionsRoot to pass;
  // moving the timestamp changes the hash, which only a Base RPC can refute.
  f[11] = u(1_700_000_000);
  const h = rlpEncode(f);
  s.anchor!.blockHeader = bytesToHex(h);
  s.anchor!.blockHash = bytesToHex(keccak256(h));
  s.anchor!.blockTimestamp = 1_700_000_000;
  const r = await verifyCeiling(proof, s, { writerAddress: w.writer, chainId: CHAIN });
  assert.equal(r.ok, true);
  assert.equal(r.headerCheckedAgainstChain, false);
});

test("a floor header that is not the proof's signed floor fails the sidecar: every part it carries must hold", async () => {
  const w = build();
  const s = clone(w.sidecar);
  const f = rlpDecode(hexToBytes(s.floor!.blockHeader)) as Uint8Array[];
  f[11] = u(1);
  s.floor!.blockHeader = bytesToHex(rlpEncode(f));
  const r = await verifyCeiling(proof, s, { writerAddress: w.writer, chainId: CHAIN });
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /^floor: the carried floor header does not match the proof's signed slotAnchor/);
  assert.equal(r.window, undefined, "no window from a sidecar that failed");
});

test("the status field never decides: a sidecar with its transaction verifies whatever its status says", async () => {
  const w = build();
  const s = clone(w.sidecar);
  (s as { status: string }).status = "pending";
  const r = await verifyCeiling(proof, s, { writerAddress: w.writer, chainId: CHAIN });
  assert.equal(r.ok, true, r.reason);
});
