// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * Capture a real bitgraph-output-root/1 test vector from the live chains:
 * a recent BitGraph ceiling transaction on Base (block B), the next Base
 * summary block P whose claim has landed on Ethereum, the storage proof of
 * B's hash in P's state, and the claim transaction with its inclusion proof.
 *
 *   node --import tsx/esm scripts/capture-output-root-vector.ts <out.json>
 *
 * Read-only: it only reads public RPCs and Blockscout. Nothing is written
 * anywhere but the output file.
 */

import { writeFileSync } from "node:fs";
import { evmBytesToHex as bytesToHex, evmHexToBytes as hexToBytes, keccak256, decodeEip1559, decodeCeilingPayload, BASE_DISPUTE_GAME_FACTORY } from "@mikeargento/bitgraph-verify";
import { jsonRpc, blockEvidence, type Rpc } from "../src/ceiling/block.js";
import { captureAtP, findClaim, attachClaim } from "../src/ceiling/output-root-capture.js";
import { keccak_256 } from "@noble/hashes/sha3";

const WRITER = "0xf3972408D853c975F86351C311f4310220bbF2a3";
const out = process.argv[2] ?? "output-root-vector.json";

function withRetry(rpc: Rpc): Rpc {
  return async (method, params) => {
    let last: unknown;
    for (let i = 0; i < 6; i++) {
      try {
        return await rpc(method, params);
      } catch (e) {
        last = e;
        await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
      }
    }
    throw last;
  };
}

const base = withRetry(jsonRpc("https://mainnet.base.org"));
const l1 = withRetry(jsonRpc("https://ethereum-rpc.publicnode.com"));
const sel = (s: string) => "0x" + Buffer.from(keccak_256(new TextEncoder().encode(s))).toString("hex").slice(0, 8);
const word = (n: bigint) => n.toString(16).padStart(64, "0");
const call = async (to: string, data: string) => (await l1("eth_call", [{ to, data }, "latest"])) as string;

async function main() {
  // 1. Recent ceiling transactions from the writer.
  const res = await fetch(`https://base.blockscout.com/api/v2/addresses/${WRITER}/transactions?filter=from`);
  const items = ((await res.json()) as { items: Array<{ block_number: number; hash: string }> }).items;
  console.log(`writer txs: ${items.length}, newest at Base block ${items[0]?.block_number}`);

  // 2. The newest games and their summary blocks.
  const count = BigInt(await call(BASE_DISPUTE_GAME_FACTORY, sel("gameCount()")));
  const games: Array<{ index: number; p: number; rootClaim: string; created: number }> = [];
  for (let k = 1n; k <= 8n; k++) {
    const r = await call(BASE_DISPUTE_GAME_FACTORY, sel("gameAtIndex(uint256)") + word(count - k));
    const proxy = "0x" + r.slice(2 + 64 * 2 + 24, 2 + 64 * 3);
    const created = Number(BigInt("0x" + r.slice(2 + 64, 2 + 128)));
    const p = Number(BigInt(await call(proxy, sel("l2SequenceNumber()"))));
    const rootClaim = (await call(proxy, sel("rootClaim()"))).toLowerCase();
    games.push({ index: Number(count - k), p, rootClaim, created });
  }
  console.log("games:", games.map((g) => `${g.index}:P=${g.p}`).join(" "));

  // 3. Pick the newest game P that covers a writer tx B with 1 <= P - B <= 8191.
  let chosen: { game: (typeof games)[number]; tx: { block_number: number; hash: string } } | null = null;
  for (const g of games) {
    const tx = items.find((t) => g.p - t.block_number >= 1 && g.p - t.block_number <= 8191);
    if (tx) { chosen = { game: g, tx }; break; }
  }
  if (!chosen) throw new Error("no recent game covers a recent ceiling transaction");
  const { game, tx } = chosen;
  console.log(`chosen: ceiling tx ${tx.hash} in Base block ${tx.block_number}; game ${game.index} for P=${game.p} (P - B = ${game.p - tx.block_number})`);

  // 4. The ceiling transaction in Base block B.
  const bBlock = (await base("eth_getBlockByNumber", ["0x" + tx.block_number.toString(16), false])) as { hash: string };
  const ceilingEv = await blockEvidence(base, bBlock.hash, tx.hash);
  const raw = ceilingEv.rawTx;
  if (bytesToHex(keccak256(hexToBytes(raw))) !== tx.hash.toLowerCase()) throw new Error("ceiling raw tx does not hash to its hash");
  const decoded = decodeEip1559(hexToBytes(raw));
  const payload = decodeCeilingPayload(decoded.data);

  // 5. Window P on Base, then the claim on Ethereum.
  const window = await captureAtP(base, game.p, [{ blockNumber: tx.block_number, blockHash: bBlock.hash }]);
  if (window.outputRoot !== game.rootClaim) throw new Error(`computed output root ${window.outputRoot} is not the game's rootClaim ${game.rootClaim}`);
  console.log(`output root matches the game's rootClaim: ${window.outputRoot}`);
  const head = (await l1("eth_getBlockByNumber", ["latest", false])) as { number: string; timestamp: string };
  const headN = parseInt(head.number, 16), headT = parseInt(head.timestamp, 16);
  const approx = headN - Math.floor((headT - game.created) / 12);
  const claim = await findClaim(l1, window.outputRoot, approx - 40, approx + 40);
  if (!claim) throw new Error("claim event not found near the game's creation time");
  const settlements = await attachClaim(l1, window, claim, { gameIndex: game.index });
  const s = settlements[0]!;
  console.log(`settled: Base block ${s.base.blockNumber} existed by Ethereum block ${s.ethereum.blockNumber} (tx ${s.ethereum.txHash})`);

  const vector = {
    description: "bitgraph-output-root/1, captured from the live chains: a BitGraph ceiling transaction on Base, settled on Ethereum through Base's output root.",
    capturedAt: new Date().toISOString(),
    ceilingTx: {
      chainId: 8453,
      txHash: tx.hash.toLowerCase(),
      rawTx: raw.toLowerCase(),
      from: decoded.from,
      payloadRoot: bytesToHex(payload.root),
      payloadFirst: payload.firstPos.toString(),
      payloadLast: payload.lastPos.toString(),
      blockNumber: ceilingEv.blockNumber,
      blockHash: ceilingEv.blockHash,
      blockTimestamp: ceilingEv.blockTimestamp,
      header: ceilingEv.headerRlp,
      txIndex: ceilingEv.txIndex,
      txInclusionProof: ceilingEv.txInclusionProof,
    },
    settlement: s,
    expected: {
      outputRoot: window.outputRoot,
      existedBy: { chainId: 1, blockNumber: s.ethereum.blockNumber, blockHash: s.ethereum.blockHash, blockTimestamp: s.ethereum.blockTimestamp },
    },
  };
  writeFileSync(out, JSON.stringify(vector, null, 1) + "\n");
  console.log(`wrote ${out}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
