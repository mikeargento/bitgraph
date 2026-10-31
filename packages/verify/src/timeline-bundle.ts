// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * bitgraph-timeline-bundle/1: everything a file's place on the block timeline rests on, in one object.
 *
 * Block reads (block-read.ts) and files are bound on one counter sequence. A bundle holds every proof from a block
 * read before the file (the floor) to a block read after it (the ceiling), in counter order, with both block files,
 * and the epoch's genesis record when the epoch had one before the file. Each proof carries its own AWS Nitro
 * attestation, so nothing else about the enclave is needed.
 *
 * verifyTimelineBundle checks, without any network:
 *   - every proof in full (verifyAttested): Ed25519, slot record, atomic counts, the attestation's chain to the AWS
 *     root, user_data = the signed body's hash, a published PCR0;
 *   - the run is unbroken (verifyStretch): one epoch and key, each nonce count right after the previous payload
 *     count, each prevB64 the previous proof's chain hash, so nothing was bound between them that is not shown;
 *   - the first and last proofs bind their block files, and the file's proof is strictly between them;
 *   - the genesis record, when given: it binds a bitgraph-epoch-genesis/1 file of this epoch, under the same key,
 *     before the file.
 * With lookups it also asks the chains, and only their answers give time:
 *   - each bracketing block's hash must be on its chain's canonical chain; its number and timestamp are the chain's,
 *     never the file's;
 *   - the genesis transaction and its block must be what the genesis file names.
 * Lag is each bracketing read's own Nitro time minus its block's chain timestamp. A lag outside the chain's limits
 * is flagged, never refused: catching up after an outage reads old blocks on purpose.
 *
 * Status: "verified" when everything was checked and passed; "unconfirmed" when nothing failed but a chain was not
 * asked or could not answer (the order is proven, the time is not); "failed" otherwise.
 */

import type { BitGraphProof } from "./types.js";
import { verifyAttested, type AttestedOptions, type AttestedResult } from "./attested.js";
import { createVerificationContext } from "./verifier.js";
import { verifyStretch } from "./stretch.js";
import { checkBlockRead, type BlockReadChain, type ChainBlock } from "./block-read.js";
import { checkEpochGenesis, type EpochGenesisBlock, type EpochGenesisTx } from "./epoch-genesis.js";

export const TIMELINE_BUNDLE_FORMAT = "bitgraph-timeline-bundle/1" as const;

export interface TimelineBundle {
  format: typeof TIMELINE_BUNDLE_FORMAT;
  /** Every proof from the floor read to the ceiling read, inclusive, in counter order. */
  proofs: BitGraphProof[];
  /** The index in `proofs` of the file's proof: strictly between the first and the last. */
  target: number;
  /** The block file the first proof binds. */
  floorFile: string;
  /** The block file the last proof binds. */
  ceilingFile: string;
  /** The epoch's genesis record, when the epoch had one before the file. Absent: the file is pre-genesis. */
  genesis?: { proof: BitGraphProof; file: string };
}

/** Lag limits in seconds: a read is flagged when Nitro time minus block time is above maxS or below minS. */
export interface LagLimit {
  maxS: number;
  minS?: number;
}

/** Defaults: Base 30 s, Ethereum 60 s, Bitcoin 3 h late or 2 h early (miners set Bitcoin's block times). */
export const DEFAULT_LAG_LIMITS: Readonly<Record<BlockReadChain, LagLimit>> = {
  base: { maxS: 30 },
  ethereum: { maxS: 60 },
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
  /** attestedAtMs / 1000 minus timestamp. */
  lagS: number;
}

export interface TimelineBundleResult {
  status: "verified" | "unconfirmed" | "failed";
  /** What failed. */
  reasons: string[];
  /** What was not confirmed: a chain not asked, or not answering. */
  unconfirmed: string[];
  /** Lags outside the limits. Flags never fail a bundle. */
  flags: string[];
  file: { counter: string; digestB64: string; attestedAtMs: number | null } | null;
  /** Set only when the chain confirmed the block. */
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
  const failed = (why: string): TimelineBundleResult => ({ status: "failed", reasons: [why], unconfirmed, flags, file: null, floor: null, ceiling: null, genesis: "pre-genesis" });

  const shape = bundleShape(opts.bundle);
  if (typeof shape === "string") return failed(shape);
  const b = shape;
  const last = b.proofs.length - 1;
  const attested = opts.attested ?? verifyAttested;
  const limits = { ...DEFAULT_LAG_LIMITS, ...(opts.lagLimits ?? {}) };
  const pcr0 = opts.pcr0 ? { pcr0: opts.pcr0 } : {};

  // The run: unbroken, so nothing was bound inside it that the bundle does not show.
  const stretch = verifyStretch(b.proofs);
  reasons.push(...stretch.reasons);

  // Every proof in full, with one fork-detecting context across the bundle.
  const context = createVerificationContext();
  const times: (number | null)[] = [];
  for (let i = 0; i <= last; i++) {
    const proof = b.proofs[i]!;
    const bytes = i === 0 ? enc.encode(b.floorFile) : i === last ? enc.encode(b.ceilingFile) : i === b.target ? opts.fileBytes : undefined;
    const r = await attested({ proof, ...(bytes !== undefined ? { bytes } : {}), ...pcr0, context });
    times.push(r.valid ? r.attestedAtMs : null);
    const role = i === 0 ? "the floor read" : i === last ? "the ceiling read" : i === b.target ? "the file's proof" : `proof ${i}`;
    if (!r.valid) reasons.push(`${role} (counter ${proof.commit?.counter ?? "?"}) does not verify: ${r.reason ?? "invalid"}`);
    else if (r.attestedAtMs === null) reasons.push(`${role} has no Nitro time`);
  }

  // The brackets: their block files, then what the chains say about them.
  const bound = async (i: number, text: string, role: string): Promise<TimelineBound | null> => {
    const proof = b.proofs[i]!;
    let chain: ChainBlock | null | undefined;
    const file = checkBlockRead({ file: text, proof });
    if (file.status === "failed" || !file.file) {
      reasons.push(...file.reasons.map((x) => `${role}: ${x}`));
      return null;
    }
    const f = file.file;
    if (opts.lookups) {
      try {
        chain = await opts.lookups.block(f.chain, f.chainId, f.hash);
      } catch (e) {
        unconfirmed.push(`${role}: ${f.chain} could not be asked about block ${f.hash} (${e instanceof Error ? e.message : String(e)})`);
        return null;
      }
    } else {
      unconfirmed.push(`${role}: block ${f.hash} was not looked up on ${f.chain}`);
      return null;
    }
    const r = checkBlockRead({ file: text, proof, chain });
    if (r.status !== "confirmed" || !r.block) {
      reasons.push(...r.reasons.map((x) => `${role}: ${x}`));
      return null;
    }
    const at = times[i];
    if (typeof at !== "number") return null;
    const lagS = (at - r.block.timestamp * 1000) / 1000;
    const lim = limits[r.block.chain];
    if (lagS > lim.maxS) flags.push(`${role}: ${r.block.chain} block ${r.block.number} was read ${lagS.toFixed(1)} s after its timestamp (limit ${lim.maxS} s)`);
    if (lim.minS !== undefined && lagS < lim.minS) flags.push(`${role}: ${r.block.chain} block ${r.block.number} was read ${(-lagS).toFixed(1)} s before its timestamp (limit ${-lim.minS} s)`);
    return { ...r.block, counter: String(proof.commit?.counter ?? ""), attestedAtMs: at, lagS };
  };
  const floor = await bound(0, b.floorFile, "the floor read");
  const ceiling = await bound(last, b.ceilingFile, "the ceiling read");

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
    file: { counter: String(target.commit?.counter ?? ""), digestB64: target.artifact?.digestB64 ?? "", attestedAtMs: times[b.target] ?? null },
    floor,
    ceiling,
    genesis,
  };
}

/** The bundle, or why it is not one. */
function bundleShape(v: unknown): TimelineBundle | string {
  if (!v || typeof v !== "object" || Array.isArray(v)) return "a bundle is a JSON object";
  const o = v as Record<string, unknown>;
  if (o["format"] !== TIMELINE_BUNDLE_FORMAT) return `not ${TIMELINE_BUNDLE_FORMAT}`;
  const proofs = o["proofs"];
  if (!Array.isArray(proofs) || proofs.length < 3 || proofs.some((p) => !p || typeof p !== "object")) return "a bundle holds at least three proofs: the floor read, the file, the ceiling read";
  const target = o["target"];
  if (!Number.isSafeInteger(target) || (target as number) <= 0 || (target as number) >= proofs.length - 1) return "the file's proof must be strictly between the floor read and the ceiling read";
  if (typeof o["floorFile"] !== "string" || typeof o["ceilingFile"] !== "string") return "a bundle carries the floor and ceiling block files";
  const g = o["genesis"];
  if (g !== undefined) {
    const gg = g as Record<string, unknown> | null;
    if (!gg || typeof gg !== "object" || !gg["proof"] || typeof gg["proof"] !== "object" || typeof gg["file"] !== "string") return "the genesis entry holds a proof and its file";
  }
  return o as unknown as TimelineBundle;
}
