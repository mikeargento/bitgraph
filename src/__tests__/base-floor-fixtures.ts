// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * Fixtures for Base-floor proofs (enclave v10, commit.slotFloor), built and
 * signed here with a throwaway key so every verdict rule can be driven to TRUE
 * and then broken one part at a time:
 *
 *   baseBlock          a Base block as a node's JSON-RPC returns it, its RLP
 *                      header encoded here independently of the verifier's
 *                      encoder, and its keccak-256 hash; stamped on Base
 *                      mainnet's schedule unless told otherwise.
 *   mintBaseTree       a tree/1 BitGraph under bitgraph-fuse/3 over a Base floor:
 *                      a trailer/1 member and an as-is member, the 84-byte root
 *                      document, a signed slot and a signed proof.
 *   mintBaseFused      one fuse/3 file (trailer/1) and its proof, for carriers.
 *   attest             the proof re-signed with an aws-nitro attestation made at a
 *                      chosen instant under a test root of this file's own.
 *
 * Real enclave-minted fuse/3 proofs live in fuse3-fixtures/; their floor block
 * (#52,271,417 from the harness's stand-in Base node) is saved beside them.
 */

import { signAsync } from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import { keccak_256 } from "@noble/hashes/sha3";
import {
  buildSignedBody,
  buildTree,
  buildTreeRootDocument,
  bytesToBase64,
  canonicalize,
  canonicalSlotBody,
  computeSignedBodyHash,
  computeSlotCommitment3,
  evmBytesToHex,
  evmHexToBytes,
  fuseAttribution,
  getPlacement,
  leafFor,
  rlpEncode,
  type BitGraphProof,
  type RpcBlockHeader,
  type SlotAllocation,
  type TreeLeaf,
} from "@mikeargento/bitgraph-verify";
import { b64, makeKey, signBody, type ManualKey } from "./audit-fixtures.js";
import { signedSlot } from "./tree-fixtures.js";
import { makeCert, makeDocB64, makeP384, PCR0_HEX, type TestKeyPair } from "./nitro-fixtures.js";

export const BASE_GENESIS = 1686789347;
export const BASE_FLOOR_NUMBER = 52_000_000;
export const BASE_FLOOR_TIME = BASE_GENESIS + 2 * BASE_FLOOR_NUMBER;
/** A stand-in SPEC v2 hash (TEST ONLY): passed to the verifier as an extra spec it accepts. */
export const TEST_SPEC_V2_B64 = bytesToBase64(sha256(new TextEncoder().encode("a test SPEC v2 for Base floors (TEST ONLY)")));

const hex = (u: Uint8Array) => evmBytesToHex(u);
const tag = (s: string) => hex(keccak_256(new TextEncoder().encode(s)));
const quantity = (n: number) => `0x${n.toString(16)}`;

/** Integer field: minimal big-endian bytes (0 is empty). */
function q(x: string): Uint8Array {
  const h = x.replace(/^0x/, "").replace(/^0+/, "");
  return h === "" ? new Uint8Array(0) : evmHexToBytes(h.length % 2 ? `0${h}` : h);
}

export interface BaseBlock {
  rpc: RpcBlockHeader;
  header: Uint8Array;
  headerHex: string;
  hash: string;
  number: number;
  timestamp: number;
}

/** A Base block (OP Stack, Prague field set). `salt` changes the state root, so the same height gets another hash. */
export function baseBlock(number = BASE_FLOOR_NUMBER, o: { timestamp?: number; salt?: string } = {}): BaseBlock {
  const timestamp = o.timestamp ?? BASE_GENESIS + 2 * number;
  const salt = o.salt ?? "";
  const rpc: RpcBlockHeader = {
    hash: "", parentHash: tag(`parent-${number}${salt}`), sha3Uncles: hex(keccak_256(Uint8Array.of(0xc0))), miner: "0x4200000000000000000000000000000000000011",
    stateRoot: tag(`state-${number}${salt}`), transactionsRoot: tag(`tx-${number}`), receiptsRoot: tag(`rc-${number}`), logsBloom: `0x${"00".repeat(256)}`,
    difficulty: "0x0", number: quantity(number), gasLimit: quantity(240_000_000), gasUsed: quantity(12_345_678),
    timestamp: quantity(timestamp), extraData: "0x", mixHash: tag(`mix-${number}`), nonce: `0x${"00".repeat(8)}`,
    baseFeePerGas: quantity(1_000_000), withdrawalsRoot: tag(`w-${number}`), blobGasUsed: "0x0", excessBlobGas: "0x0",
    parentBeaconBlockRoot: tag(`pb-${number}`), requestsHash: tag(`rq-${number}`),
  };
  const d = evmHexToBytes;
  const header = rlpEncode([
    d(rpc.parentHash), d(rpc.sha3Uncles), d(rpc.miner), d(rpc.stateRoot), d(rpc.transactionsRoot), d(rpc.receiptsRoot), d(rpc.logsBloom),
    q(rpc.difficulty), q(rpc.number), q(rpc.gasLimit), q(rpc.gasUsed), q(rpc.timestamp), d(rpc.extraData), d(rpc.mixHash), d(rpc.nonce),
    q(rpc.baseFeePerGas!), d(rpc.withdrawalsRoot!), q(rpc.blobGasUsed!), q(rpc.excessBlobGas!), d(rpc.parentBeaconBlockRoot!), d(rpc.requestsHash!),
  ]);
  const hash = hex(keccak_256(header));
  rpc.hash = hash;
  return { rpc, header, headerHex: hex(header), hash, number, timestamp };
}

/** The commit.slotFloor an enclave v10 signs for a block. */
export function slotFloorOf(b: BaseBlock): NonNullable<BitGraphProof["commit"]["slotFloor"]> {
  return { chain: "base", evmChainId: 8453, blockNumber: b.number, blockHash: b.hash, blockTimestamp: b.timestamp };
}

export interface MintOptions {
  /** The block the proof signs as its floor (default: baseBlock()). */
  floor?: BaseBlock;
  /** Override fields of the signed slotFloor (a proof whose signed time or hash differs from its block). */
  slotFloor?: Partial<NonNullable<BitGraphProof["commit"]["slotFloor"]>>;
  /** Also sign an Ethereum anchor (a proof with two floors, which no v10 enclave signs). */
  slotAnchor?: { counter: string; blockNumber: number; blockHash: string };
}

async function signCommit(key: ManualKey, slot: SlotAllocation, digest: Uint8Array, attribution: BitGraphProof["attribution"], o: MintOptions, floor: BaseBlock): Promise<BitGraphProof> {
  const commit: BitGraphProof["commit"] = {
    nonceB64: slot.nonceB64,
    counter: (BigInt(slot.counter) + 2n).toString(),
    epochId: slot.epochId,
    slotCounter: slot.counter,
    slotHashB64: b64(sha256(canonicalize(canonicalSlotBody(slot)))),
    ...(o.slotAnchor ? { slotAnchor: o.slotAnchor } : {}),
    slotFloor: { ...slotFloorOf(floor), ...(o.slotFloor ?? {}) },
  };
  (commit as unknown as Record<string, unknown>)["chainId"] = "bitgraph:main";
  const proof = await signBody(key, { hashAlg: "sha256", digestB64: bytesToBase64(digest) }, commit, "test-measurement-base", { attribution: attribution! });
  proof.slotAllocation = slot;
  return proof;
}

export interface BaseTree {
  key: ManualKey;
  floor: BaseBlock;
  proof: BitGraphProof;
  rootDocument: Uint8Array;
  /** Tree order. */
  leaves: TreeLeaf[];
  commitment: Uint8Array;
  /** The trailer/1 member: its original, its committed bytes, and its index in tree order. */
  placed: { original: Uint8Array; committed: Uint8Array; index: number };
  /** The as-is member. */
  asIs: { original: Uint8Array; index: number };
}

/** A tree/1 BitGraph under bitgraph-fuse/3 over a Base floor, pinned to TEST_SPEC_V2_B64. */
export async function mintBaseTree(o: MintOptions = {}): Promise<BaseTree> {
  const key = await makeKey();
  const slot = await signedSlot(key, "700");
  const floor = o.floor ?? baseBlock();
  const commitment = computeSlotCommitment3(slot, (o.slotFloor?.blockHash ?? floor.hash));
  const enc = new TextEncoder();
  const placedOriginal = enc.encode("A Base-floor member, finished after its floor block.\n");
  const asIsOriginal = enc.encode("A Base-floor member kept as is.\n");
  const a = leafFor(0x01, placedOriginal, commitment);
  const b = leafFor(0x00, asIsOriginal, commitment);
  const built = buildTree([a.leaf, b.leaf]);
  const rootDocument = buildTreeRootDocument(commitment, built.sorted.length, built.root);
  const attribution = { name: "bitgraph-fuse/3", title: "tree/1", message: TEST_SPEC_V2_B64 };
  const proof = await signCommit(key, slot, sha256(rootDocument), attribution, o, floor);
  const indexOf = (l: TreeLeaf) => built.sorted.findIndex((x) => bytesToBase64(x.artifact) === bytesToBase64(l.artifact));
  return { key, floor, proof, rootDocument, leaves: built.sorted, commitment, placed: { original: placedOriginal, committed: a.committed, index: indexOf(a.leaf) }, asIs: { original: asIsOriginal, index: indexOf(b.leaf) } };
}

export interface BaseFused {
  key: ManualKey;
  floor: BaseBlock;
  proof: BitGraphProof;
  original: Uint8Array;
  fused: Uint8Array;
}

/** One trailer/1 file carrying commitment/3, and its fuse/3 proof. */
export async function mintBaseFused(o: MintOptions = {}): Promise<BaseFused> {
  const key = await makeKey();
  const slot = await signedSlot(key, "800");
  const floor = o.floor ?? baseBlock();
  const commitment = computeSlotCommitment3(slot, (o.slotFloor?.blockHash ?? floor.hash));
  const original = new TextEncoder().encode("A file that travels with its proof, over a Base floor.\n");
  const fused = getPlacement("trailer/1")!.build({ original, commitment });
  const proof = await signCommit(key, slot, sha256(fused), fuseAttribution("trailer/1", sha256(original), 3), o, floor);
  return { key, floor, proof, original, fused };
}

/** A test attestation root: one P-384 root and one leaf under it. */
export interface TestRoot {
  root: TestKeyPair;
  leaf: TestKeyPair;
  rootCert: Uint8Array;
  leafCert: Uint8Array;
}

export async function makeTestRoot(): Promise<TestRoot> {
  const root = await makeP384();
  const leaf = await makeP384();
  return { root, leaf, rootCert: await makeCert(root.publicRaw, root.privateKey), leafCert: await makeCert(leaf.publicRaw, root.privateKey) };
}

/** The proof re-signed to name PCR0_HEX, with an aws-nitro attestation made at `atMs` bound to that body. */
export async function attest(proof: BitGraphProof, key: ManualKey, atMs: number, t: TestRoot): Promise<BitGraphProof> {
  const p = JSON.parse(JSON.stringify(proof)) as BitGraphProof;
  p.environment = { enforcement: p.environment.enforcement, measurement: PCR0_HEX, attestation: { format: "aws-nitro", reportB64: "" } };
  p.signer.signatureB64 = b64(await signAsync(canonicalize(buildSignedBody(p) as never), key.privateKey));
  p.environment.attestation!.reportB64 = await makeDocB64({
    leafPrivate: t.leaf.privateKey,
    leafCert: t.leafCert,
    cabundle: [t.rootCert],
    userData: new Uint8Array(Buffer.from(computeSignedBodyHash(p), "base64")),
    timestamp: atMs,
    pcr0: new Uint8Array(Buffer.from(PCR0_HEX, "hex")),
  });
  return p;
}

/** The verifier pins that accept the test root and image. */
export const pinsFor = (t: TestRoot) => ({ rootDer: t.rootCert, pcr0: [PCR0_HEX] });
