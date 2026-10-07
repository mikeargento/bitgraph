// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * A ceiling in TIME for a BitGraph, carried beside the proof, never inside it.
 *
 * Every BitGraph already has a floor in time: the block the enclave fixes at
 * slot allocation and signs at commit, an Ethereum anchor (`commit.slotAnchor`,
 * enclave v7 to v9) or a Base block (`commit.slotFloor`, enclave v10; read both
 * through signedFloorOf). An Ethereum-floor BitGraph also has a ceiling in
 * POSITION (the anchors that follow it in the chain); after the cutover to Base
 * floors there are no anchors, and order among BitGraphs is the chain of proof
 * hashes. This adds the one thing a record
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
import { base64ToBytes, signedFloorOf, type SignedFloor } from "./fuse.js";
import {
  bytesEqual, bytesToHex, decodeEip1559, decodeHeader, hexToBytes, keccak256, mptVerify, rlpEncode, txTrieKey,
  type DecodedHeader,
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
   * unsigned: checked by keccak256 against the floor the proof SIGNS
   * (signedFloorOf). `chain` names the floor's chain: absent is Ethereum (every
   * sidecar before enclave v10), "base" a Base floor, whose header's time must
   * also equal the signed blockTimestamp.
   */
  floor?: { blockNumber: number; blockHash: string; blockTimestamp: number; blockHeader: string; chain?: "ethereum" | "base" } | null;
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
  /** True when every offline check that ran passed, the carried floor header included. Says nothing about chain canonicality. */
  ok: boolean;
  reason?: string;
  checks: CeilingCheck[];
  status?: CeilingStatus;
  window?: {
    /** Floor: the block the proof signs (signedFloorOf), on its chain. Time only if a checked header was carried. */
    floor: { chain: "ethereum" | "base" | null; blockNumber: number; blockHash: string; blockTimestamp: number | null };
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

/**
 * One line for people. It states what this check establishes, the transaction's
 * inclusion in a Base block whose header is given, and never more: the sidecar's
 * `status` is what BitGraph's Base node reported when the file was written, an
 * observation the file cannot prove (an outside review on 2026-09-30 changed
 * it to "finalized" and every offline check still passed). Settlement is proven
 * only by a bitgraph-settlement/1 pointer, checked by verifySettlementPointer.
 */
export function ceilingLabel(status: CeilingStatus, blockNumber: number, blockTimestamp: number, hasSettlementPointer = false): string {
  const at = `Base block ${blockNumber.toLocaleString("en-US")} at ${hhmmss(blockTimestamp)} UTC`;
  if (hasSettlementPointer) return `Ceiling: included in ${at}. A settlement pointer to Ethereum is attached; check it with verifySettlementPointer.`;
  if (status === "safe" || status === "finalized") return `Ceiling: included in ${at}. BitGraph's Base node reported the block "${status}" when this file was written; that report is not proven here, and no settlement evidence is attached.`;
  return `Ceiling: included in ${at}. Relies on Base's sequencer until its batch data is on Ethereum; no settlement evidence is attached.`;
}

/**
 * Check a ceiling sidecar against its proof, offline. The checks run in
 * order and stop at the first failure, which is the `reason`; `ok` is true
 * only when every check that ran passed, a carried floor header included.
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
  // A malformed field anywhere is a failed check, never an exception.
  try {
    return await verifyCeilingChecks(proof, sidecar, opts, checks, fail);
  } catch (e) {
    return fail("malformed", `a field of the sidecar is malformed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function verifyCeilingChecks(
  proof: BitGraphProof,
  sidecar: CeilingSidecar,
  opts: CeilingVerifyOptions,
  checks: CeilingCheck[],
  fail: (name: string, detail: string) => CeilingVerifyResult,
): Promise<CeilingVerifyResult> {
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

  // Pending is the absence of a transaction to check. The status field is
  // the writer's report, unproven by the file, and never decides a result.
  if (!sidecar.anchor) {
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

  // 5. The window. The floor is the block the proof itself signs, on its own chain.
  let signed: SignedFloor | null;
  try {
    signed = signedFloorOf(proof);
  } catch (e) {
    return fail("floor", (e as Error).message);
  }
  let floor: { chain: "ethereum" | "base"; blockNumber: number; blockHash: string; blockTimestamp: number | null } | null = null;
  if (signed) {
    floor = { chain: signed.chain, blockNumber: signed.blockNumber, blockHash: signed.blockHash, blockTimestamp: null };
    const w = sidecar.floor;
    if (w !== null && w !== undefined) {
      if (typeof w !== "object" || typeof w.blockHeader !== "string" || w.blockHeader.length === 0) {
        return fail("floor", "the sidecar carries a floor without a header (absence is null; a present floor carries its header)");
      }
      let raw: Uint8Array;
      try {
        raw = hexToBytes(w.blockHeader);
      } catch {
        return fail("floor", "the carried floor header does not decode");
      }
      // Every part a sidecar carries must hold: a copy of the floor that is
      // not the signed floor block fails the sidecar, it is not skipped.
      const fh = checkFloorHeader(signed, raw, w.chain);
      if (!fh.ok) {
        if (fh.reason.startsWith("the header does not decode")) return fail("floor", "the carried floor header does not decode");
        const field = signed.chain === "base" ? "slotFloor" : "slotAnchor";
        const said = signed.chain === "ethereum" && w.chain === undefined ? "" : `: ${fh.reason}`;
        return fail("floor", `the carried floor header does not match the proof's signed ${field}${said}`);
      }
      floor.blockTimestamp = fh.header.timestamp;
      pass("floor", `${chainName(signed.chain)} block ${fh.header.number}, header checked against the signed hash`);
    }
  }
  const width = floor?.blockTimestamp != null ? header.timestamp - floor.blockTimestamp : null;
  const status = sidecar.status;
  return {
    ok: true,
    checks,
    status,
    window: {
      floor: floor ?? { chain: null, blockNumber: 0, blockHash: "", blockTimestamp: null },
      ceiling: { chainId: a.chainId, blockNumber: header.number, blockHash: header.hash, blockTimestamp: header.timestamp },
      widthSeconds: width,
    },
    label: ceilingLabel(status, header.number, header.timestamp, typeof (sidecar as { settlement?: unknown }).settlement === "object" && (sidecar as { settlement?: unknown }).settlement !== null),
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

// ── The floor block's header ───────────────────────────────────────────────

/**
 * Base mainnet stamps every block by its height: block n is
 * BASE_MAINNET_GENESIS_TIME + BASE_BLOCK_TIME_SECONDS * n (OP Stack, checked
 * against the live chain 2026-10-06). The enclave (v10) refuses a floor header
 * off this schedule; a verifier refuses one too, since such a header is not a
 * Base mainnet block (another chain, a testnet, or made up).
 */
export const BASE_MAINNET_GENESIS_TIME = 1686789347;
export const BASE_BLOCK_TIME_SECONDS = 2;

/** True when a block's stamp is Base mainnet's schedule for its number. */
export function onBaseSchedule(blockNumber: number, timestampSec: number): boolean {
  return timestampSec === BASE_MAINNET_GENESIS_TIME + BASE_BLOCK_TIME_SECONDS * blockNumber;
}

const chainName = (c: "ethereum" | "base") => (c === "base" ? "Base" : "Ethereum");

/**
 * Check a floor header against the floor the proof signs (signedFloorOf). The
 * header must decode, hash (keccak-256) to the signed block hash and carry the
 * signed number. For a Base floor its time must also equal the signed
 * blockTimestamp and be Base mainnet's schedule for its number. When the
 * carrier of the header names a chain (`declaredChain`, absent = Ethereum), it
 * must be the signed floor's chain: a Base floor read as an Ethereum header,
 * or the reverse, fails here even before any hash is compared.
 */
export function checkFloorHeader(
  signed: SignedFloor,
  headerRlp: Uint8Array,
  declaredChain?: unknown,
): { ok: true; header: DecodedHeader } | { ok: false; reason: string } {
  const declared = declaredChain === undefined || declaredChain === null ? "ethereum" : declaredChain;
  if (declared !== "ethereum" && declared !== "base") return { ok: false, reason: `the header names an unknown chain (${JSON.stringify(declaredChain)})` };
  const aBlock = (c: "ethereum" | "base") => (c === "base" ? "a Base block" : "an Ethereum block");
  if (declared !== signed.chain) return { ok: false, reason: `the header is given as ${aBlock(declared)}, and the proof signs ${aBlock(signed.chain)}` };
  let h: DecodedHeader;
  try {
    h = decodeHeader(headerRlp);
  } catch (e) {
    return { ok: false, reason: `the header does not decode (${(e as Error).message})` };
  }
  if (h.hash !== signed.blockHash.toLowerCase()) return { ok: false, reason: `the header does not hash to the signed ${chainName(signed.chain)} block hash` };
  if (h.number !== signed.blockNumber) return { ok: false, reason: `the header is block ${h.number}, the proof signs block ${signed.blockNumber}` };
  if (signed.chain === "base") {
    if (h.timestamp !== signed.blockTimestamp) return { ok: false, reason: `the header's time is ${h.timestamp}, the proof signs ${signed.blockTimestamp}` };
    if (!onBaseSchedule(h.number, h.timestamp)) return { ok: false, reason: `Base block ${h.number} is stamped ${h.timestamp}, off Base mainnet's schedule (${BASE_MAINNET_GENESIS_TIME + BASE_BLOCK_TIME_SECONDS * h.number})` };
  }
  return { ok: true, header: h };
}

/**
 * Whether the floor block's time may be stated as a bound (review, 2026-10-06):
 * the floor block must be no later than the commit's attestation document,
 * the time AWS's hardware signed. A floor stamped after it cannot be a "not
 * before" for a record that already existed; the block hash still floors the
 * record (it did not exist before its block), but its time is withheld.
 * Holds for either chain.
 */
export function floorTimeIsBound(floorTimestampSec: number, attestedAtMs: number | null | undefined): { ok: true } | { ok: false; reason: string } {
  if (attestedAtMs != null && floorTimestampSec * 1000 > attestedAtMs) {
    return { ok: false, reason: `the floor block is stamped ${isoSec(floorTimestampSec)}, after the attestation document was made (${isoMs(attestedAtMs)})` };
  }
  return { ok: true };
}

/** A block as an EVM node's JSON-RPC returns it (eth_getBlockByNumber), the header fields only. */
export interface RpcBlockHeader {
  hash: string; parentHash: string; sha3Uncles: string; miner: string; stateRoot: string;
  transactionsRoot: string; receiptsRoot: string; logsBloom: string;
  difficulty: string; number: string; gasLimit: string; gasUsed: string;
  timestamp: string; extraData: string; mixHash: string; nonce: string;
  baseFeePerGas?: string; withdrawalsRoot?: string; blobGasUsed?: string;
  excessBlobGas?: string; parentBeaconBlockRoot?: string; requestsHash?: string;
}

/**
 * The header's RLP, rebuilt from a node's JSON in canonical field order
 * (through Prague; Base headers have the same shape), or null when it does not
 * reproduce `expectedHash`. Null is the honest answer for a field this encoder
 * does not know: nothing unchecked is ever returned.
 */
export function headerRlpFromRpc(b: RpcBlockHeader | null | undefined, expectedHash: string): Uint8Array | null {
  if (!b || typeof b !== "object") return null;
  try {
    const q = (x: string | undefined) => {
      const h = String(x ?? "0x").replace(/^0x/i, "").replace(/^0+/, "");
      return h === "" ? new Uint8Array(0) : hexToBytes(h.length % 2 ? `0${h}` : h);
    };
    const d = (x: string | undefined) => hexToBytes(String(x ?? "0x"));
    const fields: Uint8Array[] = [
      d(b.parentHash), d(b.sha3Uncles), d(b.miner), d(b.stateRoot), d(b.transactionsRoot),
      d(b.receiptsRoot), d(b.logsBloom), q(b.difficulty), q(b.number), q(b.gasLimit),
      q(b.gasUsed), q(b.timestamp), d(b.extraData), d(b.mixHash), d(b.nonce),
    ];
    if (b.baseFeePerGas != null) fields.push(q(b.baseFeePerGas));
    if (b.withdrawalsRoot != null) fields.push(d(b.withdrawalsRoot));
    if (b.blobGasUsed != null) fields.push(q(b.blobGasUsed));
    if (b.excessBlobGas != null) fields.push(q(b.excessBlobGas));
    if (b.parentBeaconBlockRoot != null) fields.push(d(b.parentBeaconBlockRoot));
    if (b.requestsHash != null) fields.push(d(b.requestsHash));
    const rlp = rlpEncode(fields);
    return bytesToHex(keccak256(rlp)) === expectedHash.toLowerCase() ? rlp : null;
  } catch {
    return null;
  }
}

// ── The Base stamp as a time bound ─────────────────────────────────────────

const isoSec = (unix: number) => new Date(unix * 1000).toISOString().replace(".000Z", "Z");
const isoMs = (ms: number) => new Date(ms).toISOString();

/**
 * The slack allowed between a Base block's stamp and the attestation
 * document's time: one Base block. A Base stamp is whole seconds on Base's
 * fixed two-second schedule; the document's time is milliseconds on the AWS
 * Nitro hypervisor's clock. The writer puts the ceiling on Base only after
 * the proof exists, so an honest stamp is seconds to minutes after the
 * document; one block covers sealing latency and clock skew.
 */
export const BASE_STAMP_TOLERANCE_SECONDS = 2;

/**
 * Whether a Base block's stamp may be stated as an "existed by" time for a
 * record. Base stamps every block by its number, so after a halt the missed
 * time is refilled with blocks stamped in the past; in the 2026-06-25 and
 * 2026-06-26 halts those blocks were empty, but nothing in the protocol makes
 * them so. A stamp earlier than the floor block's time, or more than
 * BASE_STAMP_TOLERANCE_SECONDS earlier than the attestation document (made
 * after the signed body it binds), cannot be a bound for this record.
 * Passing says only that the stamp is not known to be wrong: the Base time
 * stays provisional until the block is checked against Base.
 */
export function baseTimeIsBound(
  baseTimestampSec: number,
  ref: { floorTimestampSec?: number | null; attestedAtMs?: number | null },
): { ok: true } | { ok: false; reason: string } {
  if (ref.floorTimestampSec != null && baseTimestampSec < ref.floorTimestampSec) {
    return { ok: false, reason: `Base stamped this block ${isoSec(baseTimestampSec)}, before the floor block's own time (${isoSec(ref.floorTimestampSec)})` };
  }
  if (ref.attestedAtMs != null && baseTimestampSec + BASE_STAMP_TOLERANCE_SECONDS < ref.attestedAtMs / 1000) {
    return { ok: false, reason: `Base stamped this block ${isoSec(baseTimestampSec)}, more than ${BASE_STAMP_TOLERANCE_SECONDS} s before the attestation document was made (${isoMs(ref.attestedAtMs)}), as Base does when it refills time after a halt` };
  }
  return { ok: true };
}

