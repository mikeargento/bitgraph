// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * Fixtures for the tree/1 producer tests: a boundary that hands out a signed
 * slot WITH its floor anchor (enclave v9) and mints the proof from the commit
 * body it receives, signing the bound floor as commit.slotAnchor; the floor
 * block's header (synthetic, hashed to the floor the allocation names); and
 * a complete synthetic chain world for the export's two ceilings: a Base
 * block holding a ceiling transaction signed by a throwaway writer, and an
 * Ethereum block whose transaction carries Base's output root for that block
 * (B = P, so no history proof). Every value is built here and verifies for
 * real; nothing touches a network or a ledger.
 */

import { signAsync } from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import {
  bytesToBase64,
  canonicalize,
  canonicalSlotBody,
  CEILING_VERSION,
  ceilingLeaf,
  computeOutputRoot,
  computeProofHash,
  encodeCeilingPayload,
  evmBytesToHex,
  evmHexToBytes,
  keccak256,
  merkleLeafHash,
  MerkleTree,
  OUTPUT_ROOT_VERSION,
  rlpEncode,
  txTrieProof,
} from "@mikeargento/bitgraph-verify";
import type { Attribution, BitGraphProof, CeilingSidecar, OutputRootSettlement, RlpItem, SlotAllocation } from "@mikeargento/bitgraph-verify";
import { makeKey, signBody, b64 } from "./audit-fixtures.js";
import type { ManualKey } from "./audit-fixtures.js";
import type { AnchorMark } from "../fuse.js";

export const EPOCH = bytesToBase64(new Uint8Array(32).fill(0x3c));
export const FLOOR_NUMBER = 25_500_000;
export const FLOOR_TIME = 1_790_000_000;
export const BASE_TEST_CHAIN = 84532;

/** A big-endian integer as minimal bytes (RLP's integer form). */
function u(n: bigint | number): Uint8Array {
  let h = BigInt(n).toString(16);
  if (h === "0") return new Uint8Array(0);
  if (h.length % 2) h = "0" + h;
  return evmHexToBytes(h);
}

/** A block header that decodes: the fields decodeHeader reads, the rest zero. */
export function blockHeader(txRoot: Uint8Array, number: number, timestamp: number, salt = 0): Uint8Array {
  const z32 = new Uint8Array(32);
  const parent = new Uint8Array(32).fill(salt & 0xff);
  return rlpEncode([
    parent, z32, new Uint8Array(20), z32, txRoot, z32, new Uint8Array(256), u(0), u(number), u(30_000_000),
    u(21_000), u(timestamp), new Uint8Array(0), z32, new Uint8Array(8), u(1000),
  ]);
}

/** The floor block: a header whose keccak-256 is the hash the allocation names. */
export function floorBlock(number = FLOOR_NUMBER, timestamp = FLOOR_TIME): { header: Uint8Array; headerHex: string; hash: string } {
  const header = blockHeader(new Uint8Array(32), number, timestamp, 7);
  return { header, headerHex: evmBytesToHex(header), hash: evmBytesToHex(keccak256(header)) };
}

export interface Boundary {
  key: ManualKey;
  slot: SlotAllocation;
  /** What the allocation returns beside the slot: the floor the enclave will sign at commit. */
  anchor: AnchorMark;
  floor: { header: Uint8Array; headerHex: string; hash: string };
}

export async function signedSlot(key: ManualKey, counter: string): Promise<SlotAllocation> {
  const body = { version: "bitgraph/slot/1" as const, nonceB64: b64(crypto.getRandomValues(new Uint8Array(32))), counter, epochId: EPOCH, publicKeyB64: key.publicKeyB64, chainId: "bitgraph:main" };
  return { ...body, signatureB64: b64(await signAsync(canonicalize(body), key.privateKey)) };
}

export async function makeBoundary(counter = "500"): Promise<Boundary> {
  const key = await makeKey();
  const slot = await signedSlot(key, counter);
  const floor = floorBlock();
  return { key, slot, anchor: { counter: String(BigInt(counter) - 1n), blockNumber: FLOOR_NUMBER, blockHash: floor.hash }, floor };
}

/** The commit body the core sends, as the fake boundary receives it. */
export interface CommitBody {
  digests: Array<{ digestB64: string; hashAlg: string }>;
  slotId: string;
  slot: SlotAllocation;
  chainId: string;
  attribution: Attribution;
  metadata?: Record<string, unknown>;
  anchor?: AnchorMark;
  agency?: unknown;
}

export interface MintOverrides {
  /** Attach the body's metadata under proof.metadata (default true). */
  withMetadata?: boolean;
  /** Replace the echoed metadata. */
  metadata?: Record<string, unknown>;
  /** Sign this floor instead of the bound one. */
  slotAnchor?: AnchorMark;
  /** Sign this attribution instead of the body's. */
  attribution?: Attribution;
  /** Sign under this slot instead of the held one. */
  slot?: SlotAllocation;
}

/** A proof minted from a received body: the digest is the artifact, the attribution and the bound floor are signed, the slot is consumed. */
export async function mintFromBody(b: Boundary, body: CommitBody, o: MintOverrides = {}): Promise<BitGraphProof> {
  const slot = o.slot ?? b.slot;
  const commit: BitGraphProof["commit"] = {
    nonceB64: slot.nonceB64,
    counter: (BigInt(slot.counter) + 3n).toString(),
    epochId: slot.epochId,
    slotCounter: slot.counter,
    slotHashB64: b64(sha256(canonicalize(canonicalSlotBody(slot)))),
    ...(o.slotAnchor ?? body.anchor ? { slotAnchor: o.slotAnchor ?? body.anchor } : {}),
  };
  (commit as unknown as Record<string, unknown>)["chainId"] = "bitgraph:main";
  const proof = await signBody(b.key, { hashAlg: "sha256", digestB64: body.digests[0]!.digestB64 }, commit, "test-measurement-tree", { attribution: o.attribution ?? body.attribution });
  proof.slotAllocation = slot;
  if (o.metadata !== undefined) proof.metadata = structuredClone(o.metadata);
  else if (o.withMetadata !== false && body.metadata !== undefined) proof.metadata = structuredClone(body.metadata);
  return proof;
}

export interface Call { path: string; body: unknown }
export interface Answer { status: number; json: unknown }

/** A transport over the fake boundary. By default: the slot and its anchor on allocate, an honest mint on commit, an empty lookup. */
export function boundaryTransport(
  b: Boundary,
  o: {
    allocate?: (calls: Call[]) => Answer;
    commit?: (calls: Call[], body: CommitBody) => Answer | Promise<Answer>;
    lookup?: (calls: Call[]) => Answer | Promise<Answer>;
    mint?: MintOverrides;
    /** Leave the anchor out of the allocation (a boundary before enclave v9). */
    noFloor?: boolean;
  } = {},
) {
  const calls: Call[] = [];
  const f: typeof fetch = async (input, init) => {
    const url = String(input);
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, body });
    const reply = (r: Answer) => new Response(JSON.stringify(r.json), { status: r.status, headers: { "Content-Type": "application/json" } });
    if (path === "/api/fuse/allocate") {
      if (o.allocate) return reply(o.allocate(calls));
      return reply({ status: 200, json: { slotId: b.slot.nonceB64, slot: b.slot, chainId: "bitgraph:main", ...(o.noFloor ? {} : { anchor: b.anchor }) } });
    }
    if (path === "/api/fuse/commit") {
      if (o.commit) return reply(await o.commit(calls, body as CommitBody));
      return reply({ status: 200, json: { proof: await mintFromBody(b, body as CommitBody, o.mint) } });
    }
    if (path.startsWith("/api/proofs/")) return reply(o.lookup ? await o.lookup(calls) : { status: 200, json: { proofs: [] } });
    return reply({ status: 404, json: { error: "no route" } });
  };
  return { calls, transport: { baseUrl: "https://example.test", fetch: f, recoveryAttempts: 2, recoveryDelayMs: 1 } };
}

export const allocates = (calls: Call[]) => calls.filter((c) => c.path === "/api/fuse/allocate");
export const commits = (calls: Call[]) => calls.filter((c) => c.path === "/api/fuse/commit");

// ---------------------------------------------------------------------------
// The two ceilings: a Base block with the ceiling transaction, and the
// Ethereum block that carries Base's output root for it.
// ---------------------------------------------------------------------------

function addressOf(priv: Uint8Array): string {
  return evmBytesToHex(keccak256(secp256k1.getPublicKey(priv, false).slice(1)).slice(12));
}

function signTx(priv: Uint8Array, to: string, data: Uint8Array, chainId: number): Uint8Array {
  const fields: RlpItem[] = [u(chainId), u(0), u(1_000_000), u(2_000_000_000), u(30_000), evmHexToBytes(to), u(0), data, []];
  const hash = keccak256(new Uint8Array([0x02, ...rlpEncode(fields)]));
  const sig = secp256k1.sign(hash, priv, { prehash: false, format: "recovered" });
  const r = BigInt(evmBytesToHex(sig.slice(1, 33)));
  const s = BigInt(evmBytesToHex(sig.slice(33, 65)));
  return new Uint8Array([0x02, ...rlpEncode([...fields, u(sig[0]!), u(r), u(s)])]);
}

export interface ChainWorld {
  writer: string;
  sidecar: CeilingSidecar;
  /** The same record, before its transaction landed. */
  pendingSidecar: CeilingSidecar;
  settlement: OutputRootSettlement;
  baseBlock: number;
  baseTime: number;
  ethBlock: number;
  ethTime: number;
}

/**
 * A ceiling for this proof in Base block 30,000,000 (a transaction from a
 * throwaway writer whose BGC1 payload carries a root over the proof's hash),
 * and the settlement of that block on Ethereum: an output root whose
 * preimage names the block's hash directly (B = P), carried by a
 * transaction in Ethereum block 25,500,300.
 */
export function chainWorld(proof: BitGraphProof, floorHeaderHex?: string, o: { baseTime?: number } = {}): ChainWorld {
  const priv = secp256k1.utils.randomSecretKey();
  const writer = addressOf(priv);
  const proofHash = computeProofHash(proof);
  const others = [1, 2, 3].map((i) => merkleLeafHash(sha256(new Uint8Array([i]))));
  const leaves = [others[0]!, ceilingLeaf(proofHash), others[1]!, others[2]!];
  const tree = new MerkleTree(leaves);
  const payload = encodeCeilingPayload({ root: tree.root, prev: new Uint8Array(32), firstPos: 400n, lastPos: 520n });
  const raw = signTx(priv, writer, payload, BASE_TEST_CHAIN);
  const baseTxs = [evmHexToBytes("0x7e0102"), raw, evmHexToBytes("0x01aabbcc")];
  const baseTrie = txTrieProof(baseTxs, 1);
  const baseBlock = 30_000_000;
  const baseTime = o.baseTime ?? FLOOR_TIME + 40;
  const baseHeader = blockHeader(baseTrie.root, baseBlock, baseTime, 9);
  const baseHash = evmBytesToHex(keccak256(baseHeader));
  const sidecar: CeilingSidecar = {
    version: CEILING_VERSION,
    proofHash,
    leafIndex: 1,
    leafCount: leaves.length,
    merklePath: tree.path(1).map(evmBytesToHex),
    root: evmBytesToHex(tree.root),
    anchor: {
      chainId: BASE_TEST_CHAIN,
      writer,
      txHash: evmBytesToHex(keccak256(raw)),
      rawTx: evmBytesToHex(raw),
      payload: evmBytesToHex(payload),
      blockNumber: baseBlock,
      blockHash: baseHash,
      blockTimestamp: baseTime,
      blockHeader: evmBytesToHex(baseHeader),
      txIndex: 1,
      txInclusionProof: baseTrie.proof.map(evmBytesToHex),
    },
    status: "included",
    statusObserved: { included: "2026-10-03T00:00:00.000Z", safe: null, finalized: null },
    floor: floorHeaderHex !== undefined && proof.commit.slotAnchor ? { blockNumber: proof.commit.slotAnchor.blockNumber, blockHash: proof.commit.slotAnchor.blockHash, blockTimestamp: FLOOR_TIME, blockHeader: floorHeaderHex } : null,
    settlement: null,
  };
  const pendingSidecar: CeilingSidecar = { ...sidecar, anchor: null, status: "pending", statusObserved: { included: null, safe: null, finalized: null } };

  const z32 = "0x" + "00".repeat(32);
  const outputRoot = { blockNumber: baseBlock, version: z32, stateRoot: "0x" + "11".repeat(32), messagePasserStorageRoot: "0x" + "22".repeat(32), blockHash: baseHash };
  const claim = computeOutputRoot(outputRoot);
  // A dispute-game creation: an EIP-1559 transaction on Ethereum (chain 1) whose calldata carries the output root.
  const calldata = new Uint8Array([...new Uint8Array(40).fill(0x5a), ...claim, ...new Uint8Array(12).fill(0x01)]);
  const claimTx = new Uint8Array([0x02, ...rlpEncode([u(1), u(7), u(1_000_000), u(2_000_000_000), u(300_000), evmHexToBytes("0x43edb88c4b80fdd2adff2412a7bebf9df42cb40e"), u(0), calldata, [], u(1), new Uint8Array(32).fill(0x0a), new Uint8Array(32).fill(0x0b)])]);
  const ethTxs = [evmHexToBytes("0x02c0ffee"), evmHexToBytes("0x02beef"), claimTx];
  const ethTrie = txTrieProof(ethTxs, 2);
  const ethBlock = 25_500_300;
  const ethTime = FLOOR_TIME + 3_600;
  const ethHeader = blockHeader(ethTrie.root, ethBlock, ethTime, 11);
  const settlement: OutputRootSettlement = {
    version: OUTPUT_ROOT_VERSION,
    base: { chainId: BASE_TEST_CHAIN, blockNumber: baseBlock, blockHash: baseHash },
    outputRoot,
    history: null,
    ethereum: {
      chainId: 1,
      blockNumber: ethBlock,
      blockHash: evmBytesToHex(keccak256(ethHeader)),
      blockTimestamp: ethTime,
      header: evmBytesToHex(ethHeader),
      txHash: evmBytesToHex(keccak256(claimTx)),
      txIndex: 2,
      rawTx: evmBytesToHex(claimTx),
      txInclusionProof: ethTrie.proof.map(evmBytesToHex),
    },
  };
  return { writer, sidecar, pendingSidecar, settlement, baseBlock, baseTime, ethBlock, ethTime };
}

/** A fake site for completeExport: the three read routes, each answering from a table or 404. */
export function siteFetcher(routes: { witness?: Answer; ceiling?: Answer; settlement?: Answer }) {
  const seen: string[] = [];
  const f = async (input: string): Promise<Response> => {
    const path = input.replace(/^https?:\/\/[^/]+/, "");
    seen.push(path);
    const reply = (r: Answer | undefined) => new Response(JSON.stringify(r?.json ?? { error: "not found" }), { status: r?.status ?? 404, headers: { "Content-Type": "application/json" } });
    if (path.startsWith("/api/proofs/witness")) return reply(routes.witness);
    if (path.startsWith("/api/ceilings/settlement/")) return reply(routes.settlement);
    if (path.startsWith("/api/ceilings/")) return reply(routes.ceiling);
    return reply(undefined);
  };
  return { seen, fetch: f as unknown as typeof fetch };
}
