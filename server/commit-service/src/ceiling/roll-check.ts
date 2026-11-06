// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * A closed roll's write, checked from the writer's own state directory. Read-only: it sends nothing, and the only
 * thing it asks a chain (when given a way to) is what a transaction hash holds.
 *
 * Two questions, answered from disk:
 *
 *   Is the write correct? The root in the batch is the Merkle root of its records, in order of position. The 84-byte
 *   payload carries that root and the first and last positions. The signed transaction is from the writer to itself,
 *   carries exactly that payload, and hashes to the recorded transaction hash. The block header hashes to the
 *   recorded block and the transaction is in it. Every record's sidecar reaches the same root by its own path.
 *
 *   Does it carry everything? Every record the parent queued for the epoch is in one of the epoch's writes, none is
 *   still waiting, and none is there twice.
 *
 * A sidecar's last link, that its proof hash is the hash of a real signed proof, needs the proof itself, which the
 * writer never holds; verifyCeiling (packages/verify) makes that check with the proof in hand, as a proof page does.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  MerkleTree, ceilingLeaf, decodeCeilingPayload, decodeEip1559, decodeHeader, merkleRootFromPath, mptVerify, txTrieKey,
  evmBytesToHex as bytesToHex, evmHexToBytes as hexToBytes, type CeilingSidecar,
} from "@mikeargento/bitgraph-verify";
import type { CeilingQueueItem } from "../parent/ceiling-queue.js";
import type { Batch } from "./writer.js";

export interface RollWriteReport {
  batch: string;
  state: string;
  records: number;
  firstPos: string;
  lastPos: string;
  root: string;
  txHash: string | null;
  blockNumber: number | null;
  blockTimestamp: number | null;
  /** How many of the records have a sidecar on disk that reaches the root and names this transaction. */
  sidecarsOk: number;
  problems: string[];
}

export interface RollReport {
  ok: boolean;
  epochId: string;
  /** Records the parent queued for this epoch, counted once each. */
  queued: number;
  /** Records under a root in a transaction that is in a block. */
  written: number;
  /** Queued, not in any write: still held (the roll is open or the write is in flight), by proof hash. */
  waiting: string[];
  writes: RollWriteReport[];
  problems: string[];
}

export interface RollCheckOptions {
  stateDir: string;
  /** The parent's queue file (default <stateDir>/queue.jsonl). */
  queuePath?: string;
  /** The epoch to check (default: the epoch of the newest write). */
  epochId?: string;
  /** The writer's address, when it should be compared; otherwise only "from itself to itself" is checked. */
  writer?: string;
  /** What Base says a transaction holds, to compare with the state on disk. Omitted: nothing is asked. */
  onChain?: (txHash: string) => Promise<{ from: string; to: string | null; input: string; blockHash: string | null; blockNumber: number | null } | null>;
}

const safeName = (b64: string): string => b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const lower = (s: string | null | undefined): string => (s ?? "").toLowerCase();

function queuedFor(queuePath: string, epochId: string): Map<string, CeilingQueueItem> {
  const out = new Map<string, CeilingQueueItem>();
  if (!existsSync(queuePath)) return out;
  for (const line of readFileSync(queuePath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let i: CeilingQueueItem;
    try { i = JSON.parse(line) as CeilingQueueItem; } catch { continue; }
    if (i.epochId === epochId && typeof i.proofHash === "string" && !out.has(i.proofHash)) out.set(i.proofHash, i);
  }
  return out;
}

export async function checkRoll(o: RollCheckOptions): Promise<RollReport> {
  const batchDir = join(o.stateDir, "batches");
  const all: Batch[] = existsSync(batchDir)
    ? readdirSync(batchDir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(batchDir, f), "utf8")) as Batch)
    : [];
  all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const live = all.filter((b) => b.state !== "dropped");
  const epochId = o.epochId ?? live[live.length - 1]?.group.epochId ?? "";
  const problems: string[] = [];
  if (!epochId) return { ok: false, epochId, queued: 0, written: 0, waiting: [], writes: [], problems: ["no write on disk, and no epoch was named"] };

  const mine = live.filter((b) => b.group.epochId === epochId);
  const queued = queuedFor(o.queuePath ?? join(o.stateDir, "queue.jsonl"), epochId);
  const seen = new Map<string, string>();
  const writes: RollWriteReport[] = [];
  let written = 0;

  for (const b of mine) {
    const p: string[] = [];
    const inc = b.inclusion ?? null;
    // 1. The root is the Merkle root of the records, in order of position.
    const positions = b.items.map((i) => BigInt(i.position));
    for (let n = 1; n < positions.length; n++) if (positions[n]! <= positions[n - 1]!) { p.push(`records are not in rising order of position at index ${n}`); break; }
    const tree = new MerkleTree(b.items.map((i) => ceilingLeaf(i.proofHash)));
    if (bytesToHex(tree.root) !== lower(b.root)) p.push("the records do not hash to the batch's root");
    // 2. The payload carries that root and the positions it covers.
    let payload: Uint8Array | null = null;
    try {
      payload = hexToBytes(b.payload);
      const d = decodeCeilingPayload(payload);
      if (bytesToHex(d.root) !== lower(b.root)) p.push("the payload's root is not the batch's root");
      if (positions.length > 0 && (d.firstPos !== positions[0] || d.lastPos !== positions[positions.length - 1])) p.push(`the payload covers positions ${d.firstPos}-${d.lastPos}, the records ${positions[0]}-${positions[positions.length - 1]}`);
    } catch (e) { p.push(`payload: ${(e as Error).message}`); }
    // 3 and 4. The transaction, and the block it is in.
    if (!inc) p.push(`no transaction in a block yet (state ${b.state})`);
    else {
      try {
        const tx = decodeEip1559(hexToBytes(inc.rawTx));
        if (tx.to !== tx.from) p.push(`the transaction goes from ${tx.from} to ${tx.to ?? "a contract creation"}, not to itself`);
        if (o.writer && tx.from !== lower(o.writer)) p.push(`the transaction was signed by ${tx.from}, not the writer ${lower(o.writer)}`);
        if (payload && bytesToHex(tx.data) !== bytesToHex(payload)) p.push("the transaction's data is not the payload");
        if (tx.hash !== lower(inc.txHash)) p.push("the signed transaction does not hash to the recorded transaction hash");
        const header = decodeHeader(hexToBytes(inc.headerRlp));
        if (header.hash !== lower(inc.blockHash)) p.push("the block header does not hash to the recorded block hash");
        if (header.number !== inc.blockNumber) p.push(`the header is block ${header.number}, the batch says ${inc.blockNumber}`);
        const inBlock = mptVerify(hexToBytes(header.transactionsRoot), txTrieKey(inc.txIndex), inc.txInclusionProof.map(hexToBytes));
        if (!inBlock || bytesToHex(inBlock) !== lower(inc.rawTx)) p.push("the transaction is not in that block");
      } catch (e) { p.push(`transaction: ${(e as Error).message}`); }
      if (o.onChain) {
        const c = await o.onChain(inc.txHash).catch((e: unknown) => { p.push(`Base could not be asked: ${(e as Error).message}`); return undefined; });
        if (c === null) p.push("Base does not have this transaction");
        else if (c) {
          if (lower(c.input) !== lower(b.payload)) p.push("on Base, the transaction's data is not this payload");
          if (lower(c.blockHash) !== lower(inc.blockHash)) p.push(`on Base, the transaction is in block ${c.blockHash ?? "none yet"}, not ${inc.blockHash}`);
          if (lower(c.from) !== lower(c.to)) p.push("on Base, the transaction is not from the writer to itself");
        }
      }
    }
    // 5. Every record's sidecar reaches the root by its own path.
    let sidecarsOk = 0;
    const bad: string[] = [];
    for (let n = 0; n < b.items.length; n++) {
      const i = b.items[n]!;
      const prior = seen.get(i.proofHash);
      if (prior) p.push(`${i.proofHash} is in two writes (${prior} and ${b.id})`);
      seen.set(i.proofHash, b.id);
      const path = join(o.stateDir, "sidecars", `${safeName(i.proofHash)}.ceiling.json`);
      let why: string | null = null;
      try {
        const s = JSON.parse(readFileSync(path, "utf8")) as CeilingSidecar;
        const root = merkleRootFromPath(ceilingLeaf(i.proofHash), s.leafIndex, s.leafCount, s.merklePath.map(hexToBytes));
        if (s.proofHash !== i.proofHash) why = "names another proof";
        else if (s.leafIndex !== n || s.leafCount !== b.items.length) why = `says leaf ${s.leafIndex} of ${s.leafCount}, the batch ${n} of ${b.items.length}`;
        else if (!root || bytesToHex(root) !== lower(b.root)) why = "its path does not reach the root";
        else if (inc && lower(s.anchor?.txHash) !== lower(inc.txHash)) why = s.anchor ? "names another transaction" : "does not name the transaction yet";
      } catch (e) { why = existsSync(path) ? `unreadable (${(e as Error).message})` : "missing"; }
      if (why) bad.push(`${i.proofHash}: ${why}`); else sidecarsOk++;
    }
    if (bad.length > 0) p.push(`${bad.length} sidecar${bad.length === 1 ? "" : "s"} failed: ${bad.slice(0, 5).join("; ")}${bad.length > 5 ? "; ..." : ""}`);
    if (inc && p.length === 0) written += b.items.length;
    writes.push({
      batch: b.id, state: b.state, records: b.items.length, firstPos: b.firstPos, lastPos: b.lastPos, root: b.root,
      txHash: inc?.txHash ?? null, blockNumber: inc?.blockNumber ?? null, blockTimestamp: inc?.blockTimestamp ?? null, sidecarsOk, problems: p,
    });
  }

  // Everything: each queued record of the epoch is under one of its roots.
  const waiting = [...queued.keys()].filter((h) => !seen.has(h));
  const unqueued = [...seen.keys()].filter((h) => !queued.has(h));
  if (mine.length === 0) problems.push("no write for this epoch on disk");
  if (unqueued.length > 0) problems.push(`${unqueued.length} written record${unqueued.length === 1 ? " is" : "s are"} not in the queue file (a queue file that was rotated or is not the parent's)`);
  if (waiting.length > 0) problems.push(`${waiting.length} queued record${waiting.length === 1 ? " is" : "s are"} not in any write`);
  for (const w of writes) for (const p of w.problems) problems.push(`write ${w.batch}: ${p}`);
  return { ok: problems.length === 0, epochId, queued: queued.size, written, waiting, writes, problems };
}

/** The report as lines for a terminal. */
export function formatRollReport(r: RollReport): string {
  const lines = [`Epoch ${r.epochId || "(none)"}`, `Queued by the parent: ${r.queued}`, `Written to Base and checked: ${r.written}`];
  for (const w of r.writes) {
    lines.push("", `Write ${w.batch} (${w.state})`, `  records ${w.records}, positions ${w.firstPos} to ${w.lastPos}`, `  root ${w.root}`);
    if (w.txHash) lines.push(`  transaction ${w.txHash}`, `  Base block ${w.blockNumber}, ${w.blockTimestamp ? new Date(w.blockTimestamp * 1000).toISOString() : "time unknown"}`);
    lines.push(`  sidecars reaching the root: ${w.sidecarsOk} of ${w.records}`);
  }
  lines.push("", r.ok ? "PASS: one root per write, every queued record under it, every sidecar reaches it." : "FAIL:");
  if (!r.ok) for (const p of r.problems) lines.push(`  ${p}`);
  return lines.join("\n") + "\n";
}
