// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * A ceiling in TIME for a BitGraph, carried beside the proof, never inside it.
 *
 * Every BitGraph already has a floor in time (the Ethereum block the enclave
 * fixes at slot allocation and signs at commit, `commit.slotAnchor`) and a ceiling in POSITION (the
 * anchors that follow it in the chain). This adds the one thing a record
 * cannot supply for itself: something outside the operator's control that
 * depends on the record. After a commit, a writer puts a Merkle root over
 * record hashes into a Base transaction. The block that includes it proves
 * every record under that root existed by the block's timestamp.
 *
 * The sidecar (`bitgraph-ceiling/1`) is unsigned and trusted for nothing. Every
 * value it states is recomputed here from bytes bound to a hash:
 *
 *   proof ─computeProofHash→ leaf ─merklePath→ root
 *   root  == payload.root, payload == tx.data, tx signed by the writer
 *   tx    ─MPT proof→ header.transactionsRoot, keccak(header) == blockHash
 *   blockTimestamp read from the header, not from the sidecar's own field
 *
 * What stays OUTSIDE this function, and is reported, not assumed:
 *   - whether that header is really a Base block (check it against any Base
 *     RPC; see checkCeilingOnline), and
 *   - who the writer is (the caller names the address it trusts; BitGraph
 *     publishes its own on bitgraph.ing).
 */

import { sha256 } from "@noble/hashes/sha256";
import { verifyProofIntegrity, createVerificationContext } from "./verifier.js";
import { computeProofHash } from "./proof-hash.js";
import { merkleLeafHash, merkleRootFromPath } from "./fuse-merkle.js";
import { base64ToBytes } from "./fuse.js";
import {
  bytesEqual, bytesToHex, decodeEip1559, decodeHeader, hexToBytes, keccak256, mptVerify, txTrieKey,
} from "./ceiling-evm.js";
import type { BitGraphProof, VerificationPolicy } from "./types.js";

export const CEILING_VERSION = "bitgraph-ceiling/1";
export const CEILING_MAGIC = "BGC1";
export const CEILING_PAYLOAD_BYTES = 84;

export type CeilingStatus = "pending" | "included" | "safe" | "finalized";

export interface CeilingSidecar {
  version: typeof CEILING_VERSION;
  /** Standard base64, as the ledger stores it. */
  proofHash: string;
  leafIndex: number;
  /** Tree size. RFC 9162 path checks need it; not in the build prompt's draft. */
  leafCount: number;
  /** Sibling hashes, leaf level up, 0x hex. */
  merklePath: string[];
  root: string;
  anchor: {
    chainId: number;
    writer: string;
    txHash: string;
    rawTx: string;
    payload: string;
    blockNumber: number;
    blockHash: string;
    blockTimestamp: number;
    blockHeader: string;
    txIndex: number;
    /** Trie nodes from transactionsRoot down to this transaction, 0x hex. */
    txInclusionProof: string[];
  } | null;
  status: CeilingStatus;
  statusObserved: { included: string | null; safe: string | null; finalized: string | null };
  /**
   * The floor block's header, so the window reads offline. Optional and
   * unsigned: checked by keccak256 against the proof's SIGNED slotAnchor hash.
   */
  floor?: { blockNumber: number; blockHash: string; blockTimestamp: number; blockHeader: string } | null;
  /** Reserved for v2: the Ethereum batch that settles this Base block. */
  settlement: null;
}

// ── Payload ────────────────────────────────────────────────────────────────

export interface CeilingPayload {
  root: Uint8Array;
  prev: Uint8Array;
  firstPos: bigint;
  lastPos: bigint;
}

export function encodeCeilingPayload(p: CeilingPayload): Uint8Array {
  if (p.root.length !== 32 || p.prev.length !== 32) throw new TypeError("root and prev are 32 bytes");
  const out = new Uint8Array(CEILING_PAYLOAD_BYTES);
  out.set(new TextEncoder().encode(CEILING_MAGIC), 0);
  out.set(p.root, 4);
  out.set(p.prev, 36);
  const view = new DataView(out.buffer);
  view.setBigUint64(68, p.firstPos);
  view.setBigUint64(76, p.lastPos);
  return out;
}

export function decodeCeilingPayload(bytes: Uint8Array): CeilingPayload {
  if (bytes.length !== CEILING_PAYLOAD_BYTES) throw new TypeError(`payload is ${bytes.length} bytes, expected ${CEILING_PAYLOAD_BYTES}`);
  const magic = new TextDecoder().decode(bytes.slice(0, 4));
  if (magic !== CEILING_MAGIC) throw new TypeError(`payload magic is ${JSON.stringify(magic)}, expected ${CEILING_MAGIC}`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    root: bytes.slice(4, 36),
    prev: bytes.slice(36, 68),
    firstPos: view.getBigUint64(68),
    lastPos: view.getBigUint64(76),
  };
}

/** SHA-256 of a payload: the next payload's `prev`, so the anchors chain. */
export function ceilingPayloadHash(payload: Uint8Array): Uint8Array {
  return sha256(payload);
}

/** The leaf hash of one record: SHA256(0x00 || proofHash bytes). */
export function ceilingLeaf(proofHashB64: string): Uint8Array {
  const raw = base64ToBytes(proofHashB64);
  if (!raw || raw.length !== 32) throw new TypeError("proofHash must decode to 32 bytes");
  return merkleLeafHash(raw);
}

// ── Verification ───────────────────────────────────────────────────────────

export interface CeilingCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface CeilingVerifyResult {
  /** True when every offline check passed. Says nothing about chain canonicality. */
  ok: boolean;
  reason?: string;
  checks: CeilingCheck[];
  status?: CeilingStatus;
  window?: {
    /** Floor: the proof's signed slotAnchor block. Time only if a checked header was carried. */
    floor: { blockNumber: number; blockHash: string; blockTimestamp: number | null };
    /** Ceiling: the Base block, time read from its header. */
    ceiling: { chainId: number; blockNumber: number; blockHash: string; blockTimestamp: number };
    widthSeconds: number | null;
  };
  /** One line for people. */
  label?: string;
  /** Offline, this is always false; checkCeilingOnline sets it. */
  headerCheckedAgainstChain: boolean;
}

export interface CeilingVerifyOptions {
  /** The declared writer address. A sidecar from any other sender is refused. */
  writerAddress: string;
  /** 8453 Base mainnet, 84532 Base Sepolia. */
  chainId: number;
  /** Skip the proof's own signature check (only when the caller already ran verify()). */
  proofAlreadyVerified?: boolean;
  /** Passed through to the proof's own check (measurement allowlist and so on). */
  trustAnchors?: VerificationPolicy;
}

function hhmmss(unix: number): string {
  return new Date(unix * 1000).toISOString().slice(11, 19);
}

export function ceilingLabel(status: CeilingStatus, blockNumber: number, blockTimestamp: number): string {
  const at = `Base block ${blockNumber.toLocaleString("en-US")} at ${hhmmss(blockTimestamp)} UTC`;
  if (status === "safe" || status === "finalized") return `Ceiling: ${at}, settled on Ethereum.`;
  return `Ceiling: ${at}. Relies on Base's sequencer until settled on Ethereum.`;
}

/**
 * Check a ceiling sidecar against its proof, offline. Every check runs and
 * is reported; the first failure is the `reason`.
 */
export async function verifyCeiling(
  proof: BitGraphProof,
  sidecar: CeilingSidecar,
  opts: CeilingVerifyOptions,
): Promise<CeilingVerifyResult> {
  const checks: CeilingCheck[] = [];
  const fail = (name: string, detail: string): CeilingVerifyResult => {
    checks.push({ name, ok: false, detail });
    return { ok: false, reason: `${name}: ${detail}`, checks, headerCheckedAgainstChain: false };
  };
  const pass = (name: string, detail?: string) => checks.push(detail === undefined ? { name, ok: true } : { name, ok: true, detail });

  if (sidecar?.version !== CEILING_VERSION) return fail("format", `not a ${CEILING_VERSION} sidecar`);

  // 0. The proof itself. The leaf covers the signed-body SUBSET (proofHash);
  //    the signature covers the rest, so an altered actor/policy fails here.
  if (!opts.proofAlreadyVerified) {
    const v = await verifyProofIntegrity({
      proof,
      context: createVerificationContext(),
      ...(opts.trustAnchors ? { trustAnchors: opts.trustAnchors } : {}),
    });
    if (!v.valid) return fail("proof", `the proof does not verify (${v.reason ?? "invalid"})`);
    pass("proof", "signature valid");
  }

  // 1. The record is under the root.
  let proofHash: string;
  try {
    proofHash = computeProofHash(proof);
  } catch (e) {
    return fail("record", `cannot hash the proof (${(e as Error).message})`);
  }
  if (proofHash !== sidecar.proofHash) return fail("record", "this sidecar belongs to a different proof");
  let computedRoot: Uint8Array | null;
  try {
    computedRoot = merkleRootFromPath(
      ceilingLeaf(proofHash),
      sidecar.leafIndex,
      sidecar.leafCount,
      sidecar.merklePath.map(hexToBytes),
    );
  } catch {
    computedRoot = null;
  }
  if (!computedRoot) return fail("merkle", "the path does not fit the leaf index and tree size");
  if (bytesToHex(computedRoot) !== sidecar.root.toLowerCase()) return fail("merkle", "the leaf and path do not reach the root");
  pass("merkle", `leaf ${sidecar.leafIndex} of ${sidecar.leafCount} reaches the root`);

  if (sidecar.status === "pending" || !sidecar.anchor) {
    return { ok: false, reason: "ceiling pending: no transaction included yet", checks, status: "pending", headerCheckedAgainstChain: false };
  }
  const a = sidecar.anchor;

  // 2. The payload carries that root.
  let payloadBytes: Uint8Array;
  try {
    payloadBytes = hexToBytes(a.payload);
    const p = decodeCeilingPayload(payloadBytes);
    if (bytesToHex(p.root) !== sidecar.root.toLowerCase()) return fail("payload", "the payload's root is not this sidecar's root");
    pass("payload", `${CEILING_MAGIC}, positions ${p.firstPos}-${p.lastPos}`);
  } catch (e) {
    return fail("payload", (e as Error).message);
  }

  // 3. The transaction: signed by the writer, to itself, carrying the payload.
  let rawTx: Uint8Array;
  try {
    rawTx = hexToBytes(a.rawTx);
    const tx = decodeEip1559(rawTx);
    const writer = opts.writerAddress.toLowerCase();
    if (tx.from !== writer) return fail("sender", `the transaction was signed by ${tx.from}, not the declared writer ${writer}`);
    if (tx.to !== writer) return fail("sender", `the transaction is addressed to ${tx.to ?? "a contract creation"}, not to the writer`);
    if (tx.chainId !== BigInt(opts.chainId)) return fail("chain", `the transaction is for chain ${tx.chainId}, expected ${opts.chainId}`);
    if (a.chainId !== opts.chainId) return fail("chain", `the sidecar names chain ${a.chainId}, expected ${opts.chainId}`);
    if (!bytesEqual(tx.data, payloadBytes)) return fail("payload", "the transaction's data is not the payload");
    if (tx.hash !== a.txHash.toLowerCase()) return fail("transaction", "the raw transaction does not hash to txHash");
    pass("sender", `signed by ${tx.from}`);
  } catch (e) {
    return fail("transaction", (e as Error).message);
  }

  // 4. The transaction is in the block, and the block is this header.
  let header;
  try {
    header = decodeHeader(hexToBytes(a.blockHeader));
  } catch (e) {
    return fail("header", (e as Error).message);
  }
  if (header.hash !== a.blockHash.toLowerCase()) return fail("header", "the header does not hash to blockHash");
  if (header.number !== a.blockNumber) return fail("header", `the header is block ${header.number}, the sidecar says ${a.blockNumber}`);
  if (header.timestamp !== a.blockTimestamp) return fail("header", `the header's timestamp is ${header.timestamp}, the sidecar says ${a.blockTimestamp}`);
  const inBlock = mptVerify(hexToBytes(header.transactionsRoot), txTrieKey(a.txIndex), a.txInclusionProof.map(hexToBytes));
  if (!inBlock || !bytesEqual(inBlock, rawTx)) return fail("inclusion", "the transaction is not in this block");
  pass("inclusion", `transaction ${a.txIndex} of block ${header.number}`);

  // 5. The window. The floor is the proof's own signed slotAnchor.
  const slotAnchor = proof.commit.slotAnchor;
  let floor: { blockNumber: number; blockHash: string; blockTimestamp: number | null } | null = null;
  if (slotAnchor) {
    floor = { blockNumber: slotAnchor.blockNumber, blockHash: slotAnchor.blockHash, blockTimestamp: null };
    const w = sidecar.floor;
    if (w && w.blockHeader) {
      try {
        const fh = decodeHeader(hexToBytes(w.blockHeader));
        if (fh.hash === slotAnchor.blockHash.toLowerCase() && fh.number === slotAnchor.blockNumber) {
          floor.blockTimestamp = fh.timestamp;
          pass("floor", `Ethereum block ${fh.number}, header checked against the signed hash`);
        } else {
          checks.push({ name: "floor", ok: false, detail: "the carried floor header does not match the proof's signed slotAnchor; ignored" });
        }
      } catch {
        checks.push({ name: "floor", ok: false, detail: "the carried floor header does not decode; ignored" });
      }
    }
  }
  const width = floor?.blockTimestamp != null ? header.timestamp - floor.blockTimestamp : null;
  const status = sidecar.status;
  return {
    ok: true,
    checks,
    status,
    window: {
      floor: floor ?? { blockNumber: 0, blockHash: "", blockTimestamp: null },
      ceiling: { chainId: a.chainId, blockNumber: header.number, blockHash: header.hash, blockTimestamp: header.timestamp },
      widthSeconds: width,
    },
    label: ceilingLabel(status, header.number, header.timestamp),
    headerCheckedAgainstChain: false,
  };
}

/**
 * Ask a Base node whether the sidecar's block is on the chain. Returns a
 * finding, never throws. Online is the only way to learn canonicality.
 *
 * The package makes no network calls of its own (the audit's zero-network
 * guarantee covers it), so the caller supplies the one lookup:
 * `getBlockHash(n)` returns the chain's hash at height n, or null.
 */
export async function checkCeilingOnline(
  sidecar: CeilingSidecar,
  getBlockHash: (blockNumber: number) => Promise<string | null>,
): Promise<{ onChain: boolean | null; detail: string }> {
  if (!sidecar.anchor) return { onChain: null, detail: "no anchor to check" };
  try {
    const hash = (await getBlockHash(sidecar.anchor.blockNumber))?.toLowerCase();
    if (!hash) return { onChain: null, detail: "the RPC did not return that block" };
    if (hash === sidecar.anchor.blockHash.toLowerCase()) return { onChain: true, detail: `block ${sidecar.anchor.blockNumber} matches the chain` };
    return { onChain: false, detail: `the chain's block ${sidecar.anchor.blockNumber} is ${hash}, not this header` };
  } catch (e) {
    return { onChain: null, detail: `header not checked against chain (${(e as Error).message})` };
  }
}

export { keccak256 as ceilingKeccak256 };
