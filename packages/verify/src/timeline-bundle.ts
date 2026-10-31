// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * bitgraph-timeline-bundle/1: everything a file's place on the block timeline rests on, in one object.
 *
 * Block reads (block-read.ts) and files are bound on one counter sequence. A bundle holds an unbroken run of proofs
 * around the file's, in counter order, the block files of the block reads in it, and the epoch's genesis record when
 * the epoch had one before the file. Each proof carries its own AWS Nitro attestation, so nothing else about the
 * enclave is needed. The first proof is a block read; its chain is the chain the file is bracketed on.
 *
 * The bracket is chosen by the verifier, on that chain, from reads the chain confirms (hash on its canonical chain;
 * number and timestamp taken from the chain, never from the file):
 *
 *   floor     the latest confirmed read before the file.
 *   ceiling   the first confirmed read after the file whose block number is strictly greater than the floor's and
 *             whose lag is within the chain's limits.
 *
 * Anyone can bind a block file, of any block, at any time. A file naming an old block only loosens a floor, but as a
 * ceiling it would claim the file existed before that old block. The two ceiling rules stop that: a read of a block
 * at or below the floor is never a ceiling, and a read whose Nitro time is far after its block's time is never a
 * ceiling. Such reads are passed over and the next one qualifies (a wider bracket, still true); when none does, the
 * ceiling is unconfirmed. A floor outside the lag limits is flagged and still used.
 *
 * Lag is signed: a read's own Nitro time minus its block's timestamp. Base and Ethereum allow 2 s early (their
 * timestamps are whole seconds), Bitcoin 2 h early (miners set its block times).
 *
 * Also checked, without any network: every proof in full (verifyAttested); the run unbroken (verifyStretch); every
 * block file binds to its proof; the floor's, the file's and the ceiling's Nitro times in order; the genesis record
 * of this epoch, under the same key, before the file. With lookups, the genesis write must be on Base.
 *
 * Status: "verified" when everything was checked and passed; "unconfirmed" when nothing failed but the time could
 * not be settled (a chain not asked or not answering, or no qualifying ceiling in the bundle); "failed" otherwise.
 */

import type { BitGraphProof } from "./types.js";
import { verifyAttested, type AttestedOptions, type AttestedResult } from "./attested.js";
import { createVerificationContext } from "./verifier.js";
import { verifyStretch } from "./stretch.js";
import { checkBlockRead, type BlockReadChain, type BlockReadFile, type ChainBlock } from "./block-read.js";
import { checkEpochGenesis, type EpochGenesisBlock, type EpochGenesisTx } from "./epoch-genesis.js";

export const TIMELINE_BUNDLE_FORMAT = "bitgraph-timeline-bundle/1" as const;

export interface TimelineBundle {
  format: typeof TIMELINE_BUNDLE_FORMAT;
  /** An unbroken run of proofs, in counter order. The first is a block read. */
  proofs: BitGraphProof[];
  /** The index in `proofs` of the file's proof: strictly after the first. */
  target: number;
  /** The block files of the block reads in the run, by their index in `proofs` (as a decimal string). Index 0 is required. */
  blockFiles: Record<string, string>;
  /** The epoch's genesis record, when the epoch had one before the file. Absent: the file is pre-genesis. */
  genesis?: { proof: BitGraphProof; file: string };
}

/** Lag limits in seconds: a read is outside them when Nitro time minus block time is above maxS or below minS. */
export interface LagLimit {
  maxS: number;
  minS: number;
}

/** Defaults: Base 2 s early to 5 s late, Ethereum 2 s early to 60 s late, Bitcoin 2 h early to 3 h late. */
export const DEFAULT_LAG_LIMITS: Readonly<Record<BlockReadChain, LagLimit>> = {
  base: { maxS: 5, minS: -2 },
  ethereum: { maxS: 60, minS: -2 },
  bitcoin: { maxS: 3 * 3600, minS: -2 * 3600 },
};

/** The chains' answers. Each returns null when the chain does not know the hash, and throws when it could not be asked. */
export interface TimelineLookups {
  block(chain: BlockReadChain, chainId: string, hash: string): Promise<ChainBlock | null>;
  genesisTx?(txHash: string): Promise<EpochGenesisTx | null>;
  genesisBlock?(blockHash: string): Promise<EpochGenesisBlock | null>;
}

export interface TimelineBundleOptions {
  bundle: unknown;
  /** The file's bytes; when given they must hash to the file proof's digest. */
  fileBytes?: Uint8Array;
  lookups?: TimelineLookups;
  lagLimits?: Partial<Record<BlockReadChain, LagLimit>>;
  /** The enclave images accepted, by PCR0. Default: every image BitGraph published. */
  pcr0?: readonly string[];
  /** The per-proof check. Default verifyAttested; tests replace it, since they cannot make Nitro documents. */
  attested?: (opts: AttestedOptions) => Promise<AttestedResult>;
}

export interface TimelineBound {
  /** The read's index in the bundle's proofs. */
  index: number;
  chain: BlockReadChain;
  chainId: string;
  hash: string;
  /** From the chain, never from the block file. */
  number: number;
  /** From the chain, Unix seconds. */
  timestamp: number;
  /** The block read's own count (its payload's). */
  counter: string;
  /** The block read's Nitro time, ms. */
  attestedAtMs: number;
  /** Signed: attestedAtMs / 1000 minus timestamp. */
  lagS: number;
}

export interface TimelineBundleResult {
  status: "verified" | "unconfirmed" | "failed";
  /** What failed. */
  reasons: string[];
  /** What could not be settled. */
  unconfirmed: string[];
  /** Lags outside the limits, on the floor or on reads passed over as ceilings. Flags never fail a bundle. */
  flags: string[];
  /** Reads passed over when choosing the bracket, and why. */
  passedOver: string[];
  file: { counter: string; digestB64: string; attestedAtMs: number | null } | null;
  floor: TimelineBound | null;
  ceiling: TimelineBound | null;
  /** confirmed: the genesis write is on Base; unconfirmed: given but Base not asked; pre-genesis: the clock check rests on Nitro alone. */
  genesis: "confirmed" | "unconfirmed" | "pre-genesis";
}

const enc = new TextEncoder();

export async function verifyTimelineBundle(opts: TimelineBundleOptions): Promise<TimelineBundleResult> {
  const reasons: string[] = [];
  const unconfirmed: string[] = [];
  const flags: string[] = [];
  const passedOver: string[] = [];
  const failed = (why: string): TimelineBundleResult => ({ status: "failed", reasons: [why], unconfirmed, flags, passedOver, file: null, floor: null, ceiling: null, genesis: "pre-genesis" });

  const shape = bundleShape(opts.bundle);
  if (typeof shape === "string") return failed(shape);
  const b = shape;
  const attested = opts.attested ?? verifyAttested;
  const limits = { ...DEFAULT_LAG_LIMITS, ...(opts.lagLimits ?? {}) };
  const pcr0 = opts.pcr0 ? { pcr0: opts.pcr0 } : {};
  const fileAt = (i: number): string | undefined => b.blockFiles[String(i)];

  // The run: unbroken, so nothing was bound inside it that the bundle does not show.
  reasons.push(...verifyStretch(b.proofs).reasons);

  // Every proof in full, with one fork-detecting context across the bundle. A block read is checked against its file.
  const context = createVerificationContext();
  const times: (number | null)[] = [];
  for (let i = 0; i < b.proofs.length; i++) {
    const proof = b.proofs[i]!;
    const text = fileAt(i);
    const bytes = text !== undefined ? enc.encode(text) : i === b.target ? opts.fileBytes : undefined;
    const r = await attested({ proof, ...(bytes !== undefined ? { bytes } : {}), ...pcr0, context });
    times.push(r.valid ? r.attestedAtMs : null);
    const role = i === b.target ? "the file's proof" : `proof ${i}`;
    if (!r.valid) reasons.push(`${role} (counter ${proof.commit?.counter ?? "?"}) does not verify: ${r.reason ?? "invalid"}`);
    else if (r.attestedAtMs === null) reasons.push(`${role} has no Nitro time`);
  }

  // Every block file, offline: it must be a block read of this proof's epoch.
  const reads = new Map<number, BlockReadFile>();
  for (const [k, text] of Object.entries(b.blockFiles)) {
    const i = Number(k);
    const r = checkBlockRead({ file: text, proof: b.proofs[i]! });
    if (r.status === "failed" || !r.file) reasons.push(...r.reasons.map((x) => `proof ${i}'s block file: ${x}`));
    else reads.set(i, r.file);
  }
  const chain = reads.get(0)?.chain;

  // The bracket, on the first read's chain. Each candidate is asked of the chain; only its answer gives time.
  type Asked = { kind: "bound"; bound: TimelineBound } | { kind: "skip" } | { kind: "stop" };
  const ask = async (i: number): Promise<Asked> => {
    const f = reads.get(i)!;
    if (!opts.lookups) {
      unconfirmed.push(`block ${f.hash} (proof ${i}) was not looked up on ${f.chain}`);
      return { kind: "stop" };
    }
    let answer: ChainBlock | null;
    try {
      answer = await opts.lookups.block(f.chain, f.chainId, f.hash);
    } catch (e) {
      unconfirmed.push(`${f.chain} could not be asked about block ${f.hash} (proof ${i}): ${e instanceof Error ? e.message : String(e)}`);
      return { kind: "stop" };
    }
    if (answer === null || answer.hash.toLowerCase() !== f.hash) {
      passedOver.push(`proof ${i}: ${f.chain} does not know block ${f.hash}`);
      return { kind: "skip" };
    }
    if (!answer.canonical) {
      passedOver.push(`proof ${i}: block ${f.hash} is not on ${f.chain}'s canonical chain`);
      return { kind: "skip" };
    }
    const r = checkBlockRead({ file: b.blockFiles[String(i)]!, proof: b.proofs[i]!, chain: answer });
    if (r.status !== "confirmed" || !r.block) {
      // The chain knows the block and the file mislabels it: the host misreported a block.
      reasons.push(...r.reasons.map((x) => `proof ${i}: ${x}`));
      return { kind: "stop" };
    }
    const at = times[i];
    if (typeof at !== "number") return { kind: "stop" };
    return { kind: "bound", bound: { index: i, ...r.block, counter: String(b.proofs[i]!.commit?.counter ?? ""), attestedAtMs: at, lagS: (at - r.block.timestamp * 1000) / 1000 } };
  };
  const outside = (x: TimelineBound): string | null => {
    const lim = limits[x.chain];
    if (x.lagS > lim.maxS) return `${x.chain} block ${x.number} was read ${x.lagS.toFixed(1)} s after its timestamp (limit ${lim.maxS} s)`;
    if (x.lagS < lim.minS) return `${x.chain} block ${x.number} was read ${(-x.lagS).toFixed(1)} s before its timestamp (limit ${-lim.minS} s)`;
    return null;
  };

  let floor: TimelineBound | null = null;
  let ceiling: TimelineBound | null = null;
  const sameChain = [...reads.keys()].filter((i) => reads.get(i)!.chain === chain).sort((x, y) => x - y);
  if (chain !== undefined && reasons.length === 0) {
    for (const i of sameChain.filter((i) => i < b.target).reverse()) {
      const a = await ask(i);
      if (a.kind === "stop") break;
      if (a.kind === "bound") { floor = a.bound; break; }
    }
    if (floor) {
      const lag = outside(floor);
      if (lag) flags.push(`the floor: ${lag}`);
      for (const i of sameChain.filter((i) => i > b.target)) {
        const a = await ask(i);
        if (a.kind === "stop") break;
        if (a.kind === "skip") continue;
        const c = a.bound;
        if (c.number <= floor.number) { passedOver.push(`proof ${i}: block ${c.number} is not above the floor's ${floor.number}, so it is not a ceiling`); continue; }
        const lag = outside(c);
        if (lag) { flags.push(`proof ${i}, passed over as a ceiling: ${lag}`); passedOver.push(`proof ${i}: its lag is outside the limits, so it is not a ceiling`); continue; }
        ceiling = c;
        break;
      }
    } else if (unconfirmed.length === 0 && reasons.length === 0) {
      unconfirmed.push(`no read before the file is a confirmed ${chain} block, so there is no floor`);
    }
    if (floor && !ceiling && unconfirmed.length === 0 && reasons.length === 0) {
      unconfirmed.push(`no read after the file in this bundle qualifies as a ${chain} ceiling`);
    }
  }

  // The hardware's clock must agree with the order.
  const fileMs = times[b.target];
  if (typeof fileMs === "number") {
    if (floor && floor.attestedAtMs > fileMs) reasons.push("the floor read's Nitro time is after the file's");
    if (ceiling && ceiling.attestedAtMs < fileMs) reasons.push("the ceiling read's Nitro time is before the file's");
  }

  // Genesis: before the file, in the same epoch under the same key, and, when Base is asked, on Base.
  let genesis: TimelineBundleResult["genesis"] = "pre-genesis";
  const target = b.proofs[b.target]!;
  if (b.genesis) {
    const g = b.genesis;
    const gr = await attested({ proof: g.proof, bytes: enc.encode(g.file), ...pcr0, context });
    const before = reasons.length;
    if (!gr.valid) reasons.push(`the genesis record does not verify: ${gr.reason ?? "invalid"}`);
    if (g.proof.signer?.publicKeyB64 !== target.signer?.publicKeyB64) reasons.push("the genesis record is signed by another key");
    try {
      if (BigInt(g.proof.commit?.counter ?? "") >= BigInt(target.slotAllocation?.counter ?? "")) reasons.push("the genesis record is not before the file");
    } catch {
      reasons.push("the genesis record's counter does not parse");
    }
    const offline = checkEpochGenesis({ file: g.file, proof: g.proof, position: "any" });
    if (!offline.ok) reasons.push(...offline.reasons.map((x) => `genesis: ${x}`));
    if (offline.genesis && offline.genesis.epochId !== target.commit?.epochId) reasons.push("the genesis record is of another epoch");
    if (reasons.length === before && offline.genesis) {
      genesis = "unconfirmed";
      const gf = offline.genesis;
      if (opts.lookups?.genesisTx && opts.lookups.genesisBlock) {
        try {
          const tx = await opts.lookups.genesisTx(gf.txHash);
          const block = await opts.lookups.genesisBlock(gf.blockHash);
          if (!tx) reasons.push(`Base does not know the genesis transaction ${gf.txHash}`);
          if (!block) reasons.push(`Base does not know the genesis block ${gf.blockHash}`);
          if (tx && block) {
            const online = checkEpochGenesis({ file: g.file, proof: g.proof, tx, block, position: "any" });
            if (online.ok) genesis = "confirmed";
            else reasons.push(...online.reasons.map((x) => `genesis: ${x}`));
          }
        } catch (e) {
          unconfirmed.push(`genesis: Base could not be asked (${e instanceof Error ? e.message : String(e)})`);
        }
      } else {
        unconfirmed.push("genesis: the transaction was not looked up on Base");
      }
    }
  }

  const status = reasons.length > 0 ? "failed" : unconfirmed.length > 0 ? "unconfirmed" : "verified";
  return {
    status,
    reasons,
    unconfirmed,
    flags,
    passedOver,
    file: { counter: String(target.commit?.counter ?? ""), digestB64: target.artifact?.digestB64 ?? "", attestedAtMs: fileMs ?? null },
    floor: status === "failed" ? null : floor,
    ceiling: status === "failed" ? null : ceiling,
    genesis,
  };
}

/** The bundle, or why it is not one. */
function bundleShape(v: unknown): TimelineBundle | string {
  if (!v || typeof v !== "object" || Array.isArray(v)) return "a bundle is a JSON object";
  const o = v as Record<string, unknown>;
  if (o["format"] !== TIMELINE_BUNDLE_FORMAT) return `not ${TIMELINE_BUNDLE_FORMAT}`;
  const proofs = o["proofs"];
  if (!Array.isArray(proofs) || proofs.length < 2 || proofs.some((p) => !p || typeof p !== "object")) return "a bundle holds at least a block read and the file";
  const target = o["target"];
  if (!Number.isSafeInteger(target) || (target as number) <= 0 || (target as number) >= proofs.length) return "the file's proof must come after the first block read";
  const files = o["blockFiles"];
  if (!files || typeof files !== "object" || Array.isArray(files)) return "a bundle carries the block files of its block reads";
  for (const [k, text] of Object.entries(files as Record<string, unknown>)) {
    if (!/^(0|[1-9][0-9]*)$/.test(k) || Number(k) >= proofs.length || typeof text !== "string") return `block file ${JSON.stringify(k)} names no proof of the bundle`;
    if (Number(k) === target) return "the file's proof is not a block read";
  }
  if (typeof (files as Record<string, unknown>)["0"] !== "string") return "the first proof of a bundle is a block read, with its block file";
  const g = o["genesis"];
  if (g !== undefined) {
    const gg = g as Record<string, unknown> | null;
    if (!gg || typeof gg !== "object" || !gg["proof"] || typeof gg["proof"] !== "object" || typeof gg["file"] !== "string") return "the genesis entry holds a proof and its file";
  }
  return o as unknown as TimelineBundle;
}
