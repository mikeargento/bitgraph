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
 *
 * The rest of this file reads the dispute game factory for the writer's loop
 * (output-root-settler.ts): its DisputeGameCreated logs, each game's summary
 * block, a game's index, and the cadence of summary blocks. Measured on
 * 2026-10-03: game type 621, one game about every 20 minutes, P = 52,101,960
 * + k * 600 exactly (each game names its parent in its extraData), and
 * `l2BlockNumber()` reverts on these games while `l2SequenceNumber()` answers.
 */

import {
  computeOutputRoot, historySlot, verifyOutputRootSettlement, keccak256, mptVerify, rlpDecode,
  evmBytesToHex as bytesToHex, evmHexToBytes as hexToBytes,
  HISTORY_STORAGE_ADDRESS, HISTORY_SERVE_WINDOW, OUTPUT_ROOT_VERSION, BASE_DISPUTE_GAME_FACTORY,
  type OutputRootSettlement,
} from "@mikeargento/bitgraph-verify";
import { blockEvidence, checkedHeaderRlp, type BlockEvidence, type Rpc, type RpcBlock } from "./block.js";
import { RpcError, rpcErrorKind } from "./rpc-pool.js";

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

interface RpcProof { storageHash: string; accountProof: string[]; storageProof: Array<{ key: string; value: string; proof: string[] }> }

export interface CaptureOptions {
  /**
   * A ceiling whose evidence does not hold together (its hash is not in P's state, or B = P with
   * another hash: a block that is not canonical) is left out and listed in `skipped` instead of
   * failing the whole window, so one bad block never costs the others their settlement. Off by
   * default: captureAtP throws, as the vector script wants.
   */
  skipBad?: boolean;
  now?: () => Date;
}

export interface CaptureResult {
  window: CapturedWindow;
  skipped: Array<{ blockNumber: number; blockHash: string; reason: string }>;
}

/**
 * Capture window P on Base for the given ceiling blocks. The state-dependent call goes first, so
 * a P whose state the node no longer holds fails in one request (an RpcError of kind "state" from
 * the pool, or a plain error naming the missing state). P's header must reproduce P's hash, and
 * the message passer's account proof must reach P's state root, before anything is computed.
 * Transport failures are thrown, never turned into a skipped ceiling.
 */
export async function captureWindow(
  baseRpc: Rpc, p: number, ceilingBlocks: Array<{ blockNumber: number; blockHash: string }>, opts: CaptureOptions = {},
): Promise<CaptureResult> {
  const tag = "0x" + p.toString(16);
  const mp = (await baseRpc("eth_getProof", [MESSAGE_PASSER_ADDRESS, [], tag])) as RpcProof | null;
  if (!mp || typeof mp.storageHash !== "string" || !Array.isArray(mp.accountProof)) throw new Error(`eth_getProof for the message passer at ${p} returned no proof`);
  const block = (await baseRpc("eth_getBlockByNumber", [tag, false])) as RpcBlock | null;
  if (!block) throw new RpcError(`Base block ${p} not found`, "state");
  if (parseInt(block.number, 16) !== p) throw new Error(`asked for Base block ${p}, the node returned ${parseInt(block.number, 16)}`);
  checkedHeaderRlp(block);
  const stateRoot = block.stateRoot.toLowerCase();
  const account = mptVerify(hexToBytes(stateRoot), keccak256(hexToBytes(MESSAGE_PASSER_ADDRESS)), mp.accountProof.map(hexToBytes));
  let mpStorageRoot: string | null = null;
  if (account) {
    try {
      const fields = rlpDecode(account);
      if (Array.isArray(fields) && fields.length === 4 && fields[2] instanceof Uint8Array && fields[2].length === 32) mpStorageRoot = bytesToHex(fields[2]);
    } catch { mpStorageRoot = null; }
  }
  if (!mpStorageRoot) throw new Error(`the message passer's account proof does not reach Base block ${p}'s state root`);
  if (mpStorageRoot !== mp.storageHash.toLowerCase()) throw new Error(`the message passer's storageHash at ${p} is not the one its account proof gives`);
  const pre = { blockNumber: p, version: ZERO32, stateRoot, messagePasserStorageRoot: mpStorageRoot, blockHash: block.hash.toLowerCase() };
  const outputRoot = bytesToHex(computeOutputRoot(pre));
  const ceilings: CapturedWindow["ceilings"] = [];
  const skipped: CaptureResult["skipped"] = [];
  const bad = (c: { blockNumber: number; blockHash: string }, reason: string): void => {
    if (!opts.skipBad) throw new Error(reason);
    skipped.push({ blockNumber: c.blockNumber, blockHash: c.blockHash.toLowerCase(), reason });
  };
  for (const c of ceilingBlocks) {
    const d = p - c.blockNumber;
    if (d === 0) {
      if (c.blockHash.toLowerCase() !== pre.blockHash) { bad(c, `ceiling block ${c.blockNumber} hash does not match P's`); continue; }
      ceilings.push({ blockNumber: c.blockNumber, blockHash: c.blockHash.toLowerCase(), history: null });
      continue;
    }
    if (d < 1 || d > HISTORY_SERVE_WINDOW) continue; // not covered by this window
    const slot = bytesToHex(historySlot(c.blockNumber));
    const proof = (await baseRpc("eth_getProof", [HISTORY_STORAGE_ADDRESS, [slot], tag])) as RpcProof;
    const sp = proof?.storageProof?.[0];
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
    if (!h?.ok) { bad(c, `history proof for block ${c.blockNumber} does not verify: ${h?.detail ?? probe.reason}`); continue; }
    ceilings.push({ blockNumber: c.blockNumber, blockHash: c.blockHash.toLowerCase(), history });
  }
  const capturedAt = (opts.now?.() ?? new Date()).toISOString();
  return {
    window: { p: { blockNumber: p, blockHash: pre.blockHash, stateRoot: pre.stateRoot, messagePasserStorageRoot: pre.messagePasserStorageRoot }, outputRoot, ceilings, capturedAt },
    skipped,
  };
}

/** Capture window P on Base for the given ceiling blocks. Throws when anything returned does not hold together. */
export async function captureAtP(baseRpc: Rpc, p: number, ceilingBlocks: Array<{ blockNumber: number; blockHash: string }>): Promise<CapturedWindow> {
  return (await captureWindow(baseRpc, p, ceilingBlocks)).window;
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

export interface AttachOptions {
  /** Informational: the game's index in the factory (-1 when unknown). */
  gameIndex?: number;
  /**
   * Where the claim transaction's evidence comes from (default: blockEvidence over `l1Rpc`, one
   * eth_getBlockByHash of the full block). Whatever supplies it, every value is still checked by
   * verifyOutputRootSettlement below before a settlement is returned.
   */
  evidence?: (blockHash: string, txHash: string) => Promise<BlockEvidence>;
}

/** Complete a captured window into one settlement per ceiling, with the claim's Ethereum evidence. Each is verified before it is returned. */
export async function attachClaim(l1Rpc: Rpc, w: CapturedWindow, claim: ClaimOnEthereum, opts: AttachOptions = {}): Promise<OutputRootSettlement[]> {
  const ev = opts.evidence ? await opts.evidence(claim.blockHash, claim.txHash) : await blockEvidence(l1Rpc, claim.blockHash, claim.txHash);
  const raw = ev.rawTx;
  if (bytesToHex(keccak256(hexToBytes(raw))) !== claim.txHash) throw new Error("the claim transaction's raw bytes do not hash to its hash");
  if (ev.blockHash.toLowerCase() !== claim.blockHash.toLowerCase()) throw new Error("the claim's evidence is for another block");
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

// ── The factory's games, read from Ethereum ────────────────────────────────

/** One DisputeGameCreated event and, once asked, the game's summary block. */
export interface GameSeen {
  txHash: string;
  l1BlockNumber: number;
  l1BlockHash: string;
  logIndex: number;
  proxy: string;
  gameType: number;
  rootClaim: string;
  /** The game's summary block P (`l2SequenceNumber()`), null when the game answers neither getter. */
  p: number | null;
}

function selector(signature: string): string {
  return bytesToHex(keccak256(new TextEncoder().encode(signature))).slice(0, 10);
}
export const SELECTORS = Object.freeze({
  l2SequenceNumber: selector("l2SequenceNumber()"),
  l2BlockNumber: selector("l2BlockNumber()"),
  gameCount: selector("gameCount()"),
  gameAtIndex: selector("gameAtIndex(uint256)"),
});

interface RpcLog { address?: string; topics: string[]; blockNumber: string; blockHash: string; transactionHash: string; logIndex?: string; removed?: boolean }

/** The factory's DisputeGameCreated events in Ethereum blocks [fromBlock, toBlock], oldest first, without their summary blocks. */
export async function gameLogs(l1Rpc: Rpc, fromBlock: number, toBlock: number, factory: string = BASE_DISPUTE_GAME_FACTORY): Promise<Array<Omit<GameSeen, "p">>> {
  const logs = (await l1Rpc("eth_getLogs", [{
    address: factory,
    fromBlock: "0x" + fromBlock.toString(16),
    toBlock: "0x" + toBlock.toString(16),
    topics: [DISPUTE_GAME_CREATED_TOPIC],
  }])) as RpcLog[] | null;
  if (!Array.isArray(logs)) throw new Error("eth_getLogs returned no list");
  const out: Array<Omit<GameSeen, "p">> = [];
  for (const l of logs) {
    if (l.removed) continue;
    if (l.address && l.address.toLowerCase() !== factory.toLowerCase()) continue;
    if (l.topics.length !== 4 || l.topics[0]!.toLowerCase() !== DISPUTE_GAME_CREATED_TOPIC) continue;
    out.push({
      txHash: l.transactionHash.toLowerCase(),
      l1BlockNumber: parseInt(l.blockNumber, 16),
      l1BlockHash: l.blockHash.toLowerCase(),
      logIndex: l.logIndex ? parseInt(l.logIndex, 16) : 0,
      proxy: ("0x" + l.topics[1]!.slice(26)).toLowerCase(),
      gameType: parseInt(l.topics[2]!, 16),
      rootClaim: l.topics[3]!.toLowerCase(),
    });
  }
  return out.sort((a, b) => a.l1BlockNumber - b.l1BlockNumber || a.logIndex - b.logIndex);
}

function word(n: bigint): string {
  return n.toString(16).padStart(64, "0");
}

async function callUint(l1Rpc: Rpc, to: string, data: string): Promise<bigint | null> {
  const r = (await l1Rpc("eth_call", [{ to, data }, "latest"])) as string | null;
  if (typeof r !== "string" || r.length < 66) return null; // no code, or no return value
  return BigInt(r.slice(0, 66));
}

/**
 * A game's summary block: `l2SequenceNumber()`, or `l2BlockNumber()` on games that predate it.
 * Null when both revert. Transport failures are thrown, so the caller reads the game again later.
 */
export async function gameSummaryBlock(l1Rpc: Rpc, proxy: string): Promise<number | null> {
  for (const data of [SELECTORS.l2SequenceNumber, SELECTORS.l2BlockNumber]) {
    try {
      const v = await callUint(l1Rpc, proxy, data);
      if (v !== null) return Number(v);
    } catch (e) {
      if (rpcErrorKind(e) !== "rpc") throw e; // a revert means "not this getter"; anything else is asked again
    }
  }
  return null;
}

/** The game's index in the factory, searched back from the newest; -1 when it is not among the last `maxBack`. Informational. */
export async function gameIndexOf(l1Rpc: Rpc, proxy: string, factory: string = BASE_DISPUTE_GAME_FACTORY, maxBack = 8): Promise<number> {
  const count = await callUint(l1Rpc, factory, SELECTORS.gameCount);
  if (count === null) return -1;
  const want = proxy.toLowerCase();
  for (let i = count - 1n; i >= 0n && count - i <= BigInt(maxBack); i--) {
    const r = (await l1Rpc("eth_call", [{ to: factory, data: SELECTORS.gameAtIndex + word(i) }, "latest"])) as string | null;
    if (typeof r !== "string" || r.length < 2 + 192) continue;
    if (("0x" + r.slice(2 + 128 + 24, 2 + 192)).toLowerCase() === want) return Number(i);
  }
  return -1;
}

export interface Cadence {
  /** A summary block on the current grid (the newest seen). */
  anchor: number;
  /** Blocks between consecutive summary blocks. */
  spacing: number;
  /** False when this is the fallback: no two games of one type were seen. */
  learned: boolean;
  /** True when the newest games' summary blocks are not all on one grid of `spacing`. */
  irregular: boolean;
}

/** Base's summary-block cadence from Ethereum's record of its games (the newest game's type decides). */
export const FALLBACK_CADENCE = Object.freeze({ anchor: 52109160, spacing: 600 });

/**
 * The spacing is the most common difference between consecutive summary blocks of the newest
 * game's type, among the newest `window` such games; the anchor is the newest summary block. With
 * fewer than two such games the spacing falls back (600), and with none the anchor does too
 * (52,109,160: game 23386, the one in spec/vectors/output-root-1.json).
 */
export function learnCadence(games: readonly GameSeen[], fallback: { anchor: number; spacing: number } = FALLBACK_CADENCE, window = 16): Cadence {
  const withP = games.filter((g): g is GameSeen & { p: number } => g.p !== null && g.p > 0);
  if (withP.length === 0) return { anchor: fallback.anchor, spacing: fallback.spacing, learned: false, irregular: false };
  const newest = withP.reduce((a, b) => (b.l1BlockNumber > a.l1BlockNumber || (b.l1BlockNumber === a.l1BlockNumber && b.logIndex > a.logIndex) ? b : a));
  const ps = [...new Set(withP.filter((g) => g.gameType === newest.gameType).map((g) => g.p))].sort((a, b) => a - b).slice(-window);
  const anchor = ps[ps.length - 1]!;
  const diffs: number[] = [];
  for (let i = 1; i < ps.length; i++) diffs.push(ps[i]! - ps[i - 1]!);
  if (diffs.length === 0) return { anchor, spacing: fallback.spacing, learned: false, irregular: false };
  const counts = new Map<number, number>();
  for (const d of diffs) counts.set(d, (counts.get(d) ?? 0) + 1);
  let spacing = diffs[0]!;
  for (const [d, n] of counts) if (n > counts.get(spacing)! || (n === counts.get(spacing)! && d < spacing)) spacing = d;
  const irregular = ps.some((x) => (anchor - x) % spacing !== 0);
  return { anchor, spacing, learned: true, irregular };
}
