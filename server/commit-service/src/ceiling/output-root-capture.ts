// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * Building a bitgraph-output-root/1 settlement (2026-10-03): the evidence
 * that a Base ceiling transaction existed by an Ethereum block, through
 * Base's output root instead of blob data.
 *
 * Two halves, run at different times:
 *
 *   captureAtP   while Base block P is still recent (public nodes keep recent
 *                state only): P's state root and block hash, the message-passer
 *                storage root, and for every ceiling block B in (P - 8191, P]
 *                the EIP-2935 storage proof of B's hash in P's state (none when
 *                B = P). Computes the output root P's claim will carry.
 *   attachClaim  once Base's dispute game for P lands on Ethereum (about 40
 *                minutes later): checks its rootClaim equals the computed output
 *                root, then takes the claim transaction, its inclusion proof and
 *                the Ethereum header.
 *
 * Every value is self-checked against what the chain returned before it is
 * kept: a header that does not hash to its block hash, a trie that does not
 * rebuild the header's root, or a claim that does not equal the computed
 * output root is an error, never evidence. The result is verified with the
 * same verifyOutputRootSettlement a stranger runs.
 */

import {
  computeOutputRoot, historySlot, verifyOutputRootSettlement, keccak256,
  evmBytesToHex as bytesToHex, evmHexToBytes as hexToBytes,
  HISTORY_STORAGE_ADDRESS, HISTORY_SERVE_WINDOW, OUTPUT_ROOT_VERSION, BASE_DISPUTE_GAME_FACTORY,
  type OutputRootSettlement,
} from "@mikeargento/bitgraph-verify";
import { blockEvidence, type Rpc } from "./block.js";

/** L2ToL1MessagePasser predeploy: its storage root is the third field of an OP Stack output root. */
export const MESSAGE_PASSER_ADDRESS = "0x4200000000000000000000000000000000000016";
/** topic0 of DisputeGameCreated(address indexed disputeProxy, uint32 indexed gameType, bytes32 indexed rootClaim). */
export const DISPUTE_GAME_CREATED_TOPIC = "0x5b565efe82411da98814f356d0e7bcb8f0219b8d970307c5afb4a6903a8b2e35";

export interface CapturedWindow {
  /** Base block P whose output root this window predicts. */
  p: { blockNumber: number; blockHash: string; stateRoot: string; messagePasserStorageRoot: string };
  /** The output root P's claim must carry (0x hex). */
  outputRoot: string;
  /** One entry per ceiling block B covered by this window. */
  ceilings: Array<{ blockNumber: number; blockHash: string; history: OutputRootSettlement["history"] }>;
  capturedAt: string;
}

const ZERO32 = "0x" + "00".repeat(32);

interface RpcBlockLite { number: string; hash: string; stateRoot: string }
interface RpcProof { storageHash: string; accountProof: string[]; storageProof: Array<{ key: string; value: string; proof: string[] }> }

/** Capture window P on Base for the given ceiling blocks. Throws when anything returned does not hold together. */
export async function captureAtP(baseRpc: Rpc, p: number, ceilingBlocks: Array<{ blockNumber: number; blockHash: string }>): Promise<CapturedWindow> {
  const tag = "0x" + p.toString(16);
  const block = (await baseRpc("eth_getBlockByNumber", [tag, false])) as RpcBlockLite | null;
  if (!block) throw new Error(`Base block ${p} not found`);
  const mp = (await baseRpc("eth_getProof", [MESSAGE_PASSER_ADDRESS, [], tag])) as RpcProof;
  const pre = { blockNumber: p, version: ZERO32, stateRoot: block.stateRoot.toLowerCase(), messagePasserStorageRoot: mp.storageHash.toLowerCase(), blockHash: block.hash.toLowerCase() };
  const outputRoot = bytesToHex(computeOutputRoot(pre));
  const ceilings: CapturedWindow["ceilings"] = [];
  for (const c of ceilingBlocks) {
    const d = p - c.blockNumber;
    if (d === 0) {
      if (c.blockHash.toLowerCase() !== pre.blockHash) throw new Error(`ceiling block ${c.blockNumber} hash does not match P's`);
      ceilings.push({ blockNumber: c.blockNumber, blockHash: c.blockHash.toLowerCase(), history: null });
      continue;
    }
    if (d < 1 || d > HISTORY_SERVE_WINDOW) continue; // not covered by this window
    const slot = bytesToHex(historySlot(c.blockNumber));
    const proof = (await baseRpc("eth_getProof", [HISTORY_STORAGE_ADDRESS, [slot], tag])) as RpcProof;
    const sp = proof.storageProof[0];
    if (!sp) throw new Error("eth_getProof returned no storage proof");
    const history = { address: HISTORY_STORAGE_ADDRESS, slot, accountProof: proof.accountProof.map((x) => x.toLowerCase()), storageProof: sp.proof.map((x) => x.toLowerCase()) };
    // Self-check against a synthetic settlement before keeping it: the history link alone.
    const probe = verifyOutputRootSettlement({
      version: OUTPUT_ROOT_VERSION,
      base: { chainId: 8453, blockNumber: c.blockNumber, blockHash: c.blockHash.toLowerCase() },
      outputRoot: pre,
      history,
      ethereum: { chainId: 1, blockNumber: 0, blockHash: ZERO32, blockTimestamp: 0, header: "0xc0", txHash: ZERO32, txIndex: 0, rawTx: "0x", txInclusionProof: [] },
    });
    const h = probe.checks.find((x) => x.name === "history");
    if (!h?.ok) throw new Error(`history proof for block ${c.blockNumber} does not verify: ${h?.detail ?? probe.reason}`);
    ceilings.push({ blockNumber: c.blockNumber, blockHash: c.blockHash.toLowerCase(), history });
  }
  return { p: { blockNumber: p, blockHash: pre.blockHash, stateRoot: pre.stateRoot, messagePasserStorageRoot: pre.messagePasserStorageRoot }, outputRoot, ceilings, capturedAt: new Date().toISOString() };
}

export interface ClaimOnEthereum {
  txHash: string;
  blockNumber: number;
  blockHash: string;
  gameProxy: string;
  gameType: number;
}

/** Find the DisputeGameCreated event whose rootClaim is `outputRoot`, searching Ethereum blocks [fromBlock, toBlock]. */
export async function findClaim(l1Rpc: Rpc, outputRoot: string, fromBlock: number, toBlock: number, factory: string = BASE_DISPUTE_GAME_FACTORY): Promise<ClaimOnEthereum | null> {
  const logs = (await l1Rpc("eth_getLogs", [{
    address: factory,
    fromBlock: "0x" + fromBlock.toString(16),
    toBlock: "0x" + toBlock.toString(16),
    topics: [DISPUTE_GAME_CREATED_TOPIC, null, null, outputRoot.toLowerCase()],
  }])) as Array<{ transactionHash: string; blockNumber: string; blockHash: string; topics: string[] }>;
  const log = logs[0];
  if (!log) return null;
  return {
    txHash: log.transactionHash.toLowerCase(),
    blockNumber: parseInt(log.blockNumber, 16),
    blockHash: log.blockHash.toLowerCase(),
    gameProxy: "0x" + log.topics[1]!.slice(26),
    gameType: parseInt(log.topics[2]!, 16),
  };
}

/** Complete a captured window into one settlement per ceiling, with the claim's Ethereum evidence. Each is verified before it is returned. */
export async function attachClaim(l1Rpc: Rpc, w: CapturedWindow, claim: ClaimOnEthereum, opts: { gameIndex?: number } = {}): Promise<OutputRootSettlement[]> {
  const ev = await blockEvidence(l1Rpc, claim.blockHash, claim.txHash);
  const raw = ev.rawTx;
  if (bytesToHex(keccak256(hexToBytes(raw))) !== claim.txHash) throw new Error("the claim transaction's raw bytes do not hash to its hash");
  const out: OutputRootSettlement[] = [];
  for (const c of w.ceilings) {
    const s: OutputRootSettlement = {
      version: OUTPUT_ROOT_VERSION,
      base: { chainId: 8453, blockNumber: c.blockNumber, blockHash: c.blockHash },
      outputRoot: { blockNumber: w.p.blockNumber, version: ZERO32, stateRoot: w.p.stateRoot, messagePasserStorageRoot: w.p.messagePasserStorageRoot, blockHash: w.p.blockHash },
      history: c.history,
      ethereum: {
        chainId: 1,
        blockNumber: ev.blockNumber,
        blockHash: ev.blockHash,
        blockTimestamp: ev.blockTimestamp,
        header: ev.headerRlp,
        txHash: claim.txHash,
        txIndex: ev.txIndex,
        rawTx: raw.toLowerCase(),
        txInclusionProof: ev.txInclusionProof,
      },
      game: { factory: BASE_DISPUTE_GAME_FACTORY, gameType: claim.gameType, index: opts.gameIndex ?? -1, proxy: claim.gameProxy },
    };
    const v = verifyOutputRootSettlement(s);
    if (!v.ok) throw new Error(`settlement for Base block ${c.blockNumber} does not verify: ${v.reason}`);
    if (v.outputRootHex !== w.outputRoot) throw new Error("the verified output root is not the captured one");
    out.push(s);
  }
  return out;
}

/** The next summary block at or after `atLeast`, given one known summary block and the 600-block spacing. */
export function nextSummaryBlock(knownP: number, atLeast: number, spacing = 600): number {
  if (atLeast <= knownP) return knownP - Math.floor((knownP - atLeast) / spacing) * spacing;
  return knownP + Math.ceil((atLeast - knownP) / spacing) * spacing;
}
