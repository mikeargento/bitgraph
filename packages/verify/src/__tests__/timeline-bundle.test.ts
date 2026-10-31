/**
 * bitgraph-timeline-bundle/1. Two kinds of proofs are used here:
 *
 *   - real ones, #2 (the genesis record), #4 and #6 of epoch KKOi… from enclave v13 (PCR0 adaad0be…), checked with
 *     the real attestation path;
 *   - minted ones, made by a copy of the v13 bind (server/commit-service/src/enclave/app.ts) with a real Ed25519 key
 *     and a stand-in attestation. Nothing outside AWS can make a Nitro document, so the bundle tests replace only
 *     the attestation step (the `attested` option) with signature, slot and count checks plus a Nitro time per
 *     proof; every other check runs as in production.
 *
 *   cd packages/verify && npx tsc -p . && node --test dist/__tests__/timeline-bundle.test.js
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { sha256 } from "@noble/hashes/sha256";
import { getPublicKeyAsync, signAsync, utils } from "@noble/ed25519";
import { canonicalize } from "../canonical.js";
import { computeChainHash } from "../proof-hash.js";
import { verifyProofIntegrity } from "../verifier.js";
import { verifyAttested, type AttestedOptions, type AttestedResult } from "../attested.js";
import { verifyStretch } from "../stretch.js";
import { blockReadFileText, type BlockReadChain, type ChainBlock } from "../block-read.js";
import { checkEpochGenesis, epochGenesisCalldataHex, epochGenesisFileText } from "../epoch-genesis.js";
import { verifyTimelineBundle, TIMELINE_BUNDLE_FORMAT, type TimelineBundle, type TimelineLookups } from "../timeline-bundle.js";
import type { BitGraphProof } from "../types.js";

const b64 = (u: Uint8Array): string => Buffer.from(u).toString("base64");
const enc = new TextEncoder();
const fixture = (name: string): string => readFileSync(new URL(`../../src/__tests__/fixtures/v13/${name}`, import.meta.url), "utf8");

// ---------------------------------------------------------------------------
// Real v13 proofs
// ---------------------------------------------------------------------------

test("real v13: #2, #4, #6 attest, run unbroken, and #2 is the epoch's genesis", async () => {
  const proofs = [2, 4, 6].map((n) => JSON.parse(fixture(`proof-${n}.json`)) as BitGraphProof);
  const genesisFile = fixture("genesis-file.json");
  for (const p of proofs) {
    const r = await verifyAttested({ proof: p });
    assert.equal(r.valid, true, r.reason);
    assert.equal(r.image?.version, "v13");
    assert.equal(typeof r.attestedAtMs, "number");
  }
  assert.equal(verifyStretch(proofs).ok, true);
  assert.equal((await verifyAttested({ proof: proofs[0]!, bytes: enc.encode(genesisFile) })).valid, true);
  assert.equal(checkEpochGenesis({ file: genesisFile, proof: proofs[0]!, position: "any" }).ok, true);
});

test("real v13: a link checks only with the attestation kept in the proof before", () => {
  const [p2, p4] = [2, 4].map((n) => JSON.parse(fixture(`proof-${n}.json`)) as BitGraphProof) as [BitGraphProof, BitGraphProof];
  assert.equal(p4.commit.prevB64, computeChainHash(p2));
  const slim = { ...p2, environment: { enforcement: p2.environment.enforcement, measurement: p2.environment.measurement } };
  assert.notEqual(p4.commit.prevB64, computeChainHash(slim as BitGraphProof));
});

// ---------------------------------------------------------------------------
// A minted epoch: the v13 bind, a real key, a stand-in attestation
// ---------------------------------------------------------------------------

const MEASUREMENT = "ab".repeat(48);

async function epoch() {
  const privateKey = utils.randomPrivateKey();
  const publicKeyB64 = b64(await getPublicKeyAsync(privateKey));
  const epochId = b64(sha256(enc.encode(publicKeyB64 + ":" + b64(utils.randomPrivateKey()))));
  const state = { counter: 0n, last: undefined as string | undefined };
  const nitroMs = new Map<string, number>();
  async function bind(digestB64: string, atMs: number): Promise<BitGraphProof> {
    const nonceCount = state.counter + 1n, payloadCount = state.counter + 2n;
    const nonceB64 = b64(utils.randomPrivateKey());
    const slotBody = { version: "bitgraph/slot/1", nonceB64, counter: String(nonceCount), epochId, publicKeyB64, chainId: "bitgraph:main" };
    const slotCanonical = canonicalize(slotBody);
    const commit: Record<string, unknown> = { nonceB64, counter: String(payloadCount), slotCounter: String(nonceCount), slotHashB64: b64(sha256(slotCanonical)), epochId, atomic: true };
    if (state.last !== undefined) commit["prevB64"] = state.last;
    commit["chainId"] = "bitgraph:main";
    const signedBody = { version: "bitgraph/1", artifact: { hashAlg: "sha256", digestB64 }, commit, publicKeyB64, enforcement: "measured-tee", measurement: MEASUREMENT, attestationFormat: "aws-nitro" };
    const proof = {
      version: "bitgraph/1",
      artifact: signedBody.artifact,
      commit,
      signer: { publicKeyB64, signatureB64: b64(await signAsync(canonicalize(signedBody), privateKey)) },
      environment: { enforcement: "measured-tee", measurement: MEASUREMENT, attestation: { format: "aws-nitro", reportB64: b64(enc.encode(`stand-in ${payloadCount}`)) } },
      slotAllocation: { ...slotBody, signatureB64: b64(await signAsync(slotCanonical, privateKey)) },
    } as unknown as BitGraphProof;
    state.counter = payloadCount;
    state.last = computeChainHash(proof);
    nitroMs.set(String(payloadCount), atMs);
    return proof;
  }
  /** verifyAttested with the Nitro step replaced: the proof's own checks, the bytes, and the minted Nitro time. */
  async function attested(o: AttestedOptions): Promise<AttestedResult> {
    const base = { checks: [], pcr0: MEASUREMENT, image: null, artifactBinding: o.bytes ? "checked" as const : "not-checked" as const };
    if (o.bytes && b64(sha256(o.bytes)) !== o.proof.artifact.digestB64) return { ...base, valid: false, reason: "the bytes do not hash to the digest", attestedAtMs: null };
    const r = await verifyProofIntegrity({ proof: o.proof, trustAnchors: { requireAtomic: true }, ...(o.context ? { context: o.context } : {}) });
    if (!r.valid) return { ...base, valid: false, reason: r.reason ?? "invalid", attestedAtMs: null };
    return { ...base, valid: true, attestedAtMs: nitroMs.get(String(o.proof.commit.counter)) ?? null };
  }
  return { epochId, bind, attested };
}


const T0 = 1_793_404_750; // a Base block time, Unix seconds
const CHAIN_IDS: Record<BlockReadChain, string> = { base: "eip155:8453", ethereum: "eip155:1" };
const SPACING: Record<BlockReadChain, number> = { base: 2, ethereum: 12 };
const FIRST: Record<BlockReadChain, number> = { base: 37_500_000, ethereum: 23_700_000 };
const hashOf = (chain: BlockReadChain, n: number): string => "0x" + Buffer.from(sha256(enc.encode(`${chain} ${n}`))).toString("hex");
/** Block n (from the chain's first test block) and its time. */
const blockAt = (chain: BlockReadChain, n: number) => ({ number: FIRST[chain] + n, timestamp: T0 + SPACING[chain] * n });

const WRITER = "0xf3972408d853c975f86351c311f4310220bbf2a3";
const GENESIS = { blockNumber: 53_307_701, blockHash: "0x" + "d2".repeat(32), blockTimestamp: T0 - 100, txHash: "0x" + "8f".repeat(32) };

/**
 * One step of an epoch after its genesis:
 *   read   a block read of block n of `chain`, by the enclave `lagS` after the block's time;
 *          canonical: false puts it off the canonical chain, known: false makes the chain not know it at all
 *   file   the file the bundle is for, at Nitro time `atS` (default: just after the step before)
 *   other  someone else's file
 */
type Step =
  | { read: BlockReadChain; n: number; lagS?: number; canonical?: boolean; known?: boolean }
  | { file: true; atS?: number }
  | { other: true };

/** genesis: bound first (the usual case), last (Base was down at the epoch's start), or never shown. */
async function scenario(steps: Step[], opts: { genesis?: "first" | "last" | "none" } = {}) {
  const e = await epoch();
  const genesisFile = epochGenesisFileText({ epochId: e.epochId, chainId: 8453, writer: WRITER, ...GENESIS });
  const where = opts.genesis ?? "first";
  let genesisProof = where === "first" ? await e.bind(b64(sha256(enc.encode(genesisFile))), (GENESIS.blockTimestamp + 1) * 1000) : undefined;

  const blocks = new Map<string, ChainBlock>();
  const proofs: BitGraphProof[] = [];
  const blockFiles: Record<string, string> = {};
  const fileBytes = enc.encode("the file");
  let target = -1;
  let clockS = T0 - 10;
  for (const s of steps) {
    if ("read" in s) {
      const { number, timestamp } = blockAt(s.read, s.n);
      const hash = hashOf(s.read, s.n);
      if (s.known !== false) blocks.set(hash, { chainId: CHAIN_IDS[s.read], hash, number, timestamp, canonical: s.canonical !== false });
      const text = blockReadFileText({ epochId: e.epochId, chain: s.read, chainId: CHAIN_IDS[s.read], number, hash, timestamp });
      clockS = timestamp + (s.lagS ?? 1);
      blockFiles[String(proofs.length)] = text;
      proofs.push(await e.bind(b64(sha256(enc.encode(text))), Math.round(clockS * 1000)));
    } else if ("file" in s) {
      clockS = s.atS ?? clockS + 0.5;
      target = proofs.length;
      proofs.push(await e.bind(b64(sha256(fileBytes)), Math.round(clockS * 1000)));
    } else {
      clockS += 0.1;
      proofs.push(await e.bind(b64(sha256(enc.encode(`someone else's file ${proofs.length}`))), Math.round(clockS * 1000)));
    }
  }
  if (where === "last") genesisProof = await e.bind(b64(sha256(enc.encode(genesisFile))), Math.round((clockS + 30) * 1000));
  const bundle: TimelineBundle = {
    format: TIMELINE_BUNDLE_FORMAT,
    proofs,
    target,
    blockFiles,
    ...(genesisProof ? { genesis: { proof: genesisProof, file: genesisFile } } : {}),
  };
  const lookups: TimelineLookups = {
    block: async (_chain, _id, hash) => blocks.get(hash) ?? null,
    genesisTx: async (txHash) => (txHash === GENESIS.txHash ? { from: WRITER, to: WRITER, input: epochGenesisCalldataHex(e.epochId), blockHash: GENESIS.blockHash, blockNumber: GENESIS.blockNumber } : null),
    genesisBlock: async (hash) => (hash === GENESIS.blockHash ? { hash, number: GENESIS.blockNumber, timestamp: GENESIS.blockTimestamp } : null),
  };
  const run = (o: Partial<Parameters<typeof verifyTimelineBundle>[0]> = {}) => verifyTimelineBundle({ bundle, lookups, attested: e.attested, ...o });
  return { e, bundle, lookups, blocks, fileBytes, run };
}

const why = (r: { reasons: string[]; unconfirmed: string[] }) => [...r.reasons, ...r.unconfirmed].join("; ");

test("a bundle the chains confirm is verified, with the chain's numbers and each read's own signed lag", async () => {
  const { run, fileBytes } = await scenario([{ read: "base", n: 0, lagS: 1.5 }, { other: true }, { file: true }, { other: true }, { read: "base", n: 2, lagS: -0.8 }]);
  const r = await run({ fileBytes });
  assert.equal(r.status, "verified", why(r));
  assert.deepEqual(r.flags, []);
  assert.equal(r.genesis, "confirmed");
  assert.equal(r.preGenesis, false);
  assert.equal(r.floor?.claim, `bound after base block 37500000 (${hashOf("base", 0)}) was produced`);
  assert.equal(r.ceiling?.claim, `bound at Nitro hardware time ${new Date((T0 + 2.1) * 1000).toISOString()}, before base block 37500002's timestamp ${new Date((T0 + 4) * 1000).toISOString()}; the Nitro clock was checked against the chain at block 37500002's read (lag -0.8 s, within limits)`);
  assert.deepEqual([r.floor?.index, r.floor?.number, r.floor?.timestamp, r.floor?.lagS], [0, 37_500_000, T0, 1.5]);
  assert.deepEqual([r.ceiling?.index, r.ceiling?.number, r.ceiling?.lagS], [4, 37_500_002, -0.8]);
  assert.equal(r.file?.counter, "8");
});

test("the floor is the latest confirmed read of the chain before the file", async () => {
  const { run } = await scenario([{ read: "base", n: 0 }, { read: "ethereum", n: 0 }, { read: "base", n: 1 }, { file: true }, { read: "base", n: 2 }]);
  const r = await run();
  assert.equal(r.status, "verified", why(r));
  assert.equal(r.floor?.index, 2);
  assert.equal(r.floor?.chain, "base");
  assert.equal(r.ceiling?.index, 4);
});

test("the floor is the highest block, not the latest position: an ancient block bound just before the file does not loosen it", async () => {
  // Proof 1 binds block 50, then proof 2 a file of block 0 (ancient, read 100 s after its time) just before the file.
  const { run } = await scenario([{ read: "base", n: 50, lagS: 1 }, { read: "base", n: 0, lagS: 101 }, { file: true }, { read: "base", n: 52 }]);
  const r = await run();
  assert.equal(r.status, "verified", why(r));
  assert.equal(r.floor?.index, 0);
  assert.equal(r.floor?.number, 37_500_050);
});

test("a fast-stamped read just before the file is passed over; the floor is the highest block at or before the file", async () => {
  // Block 2 is stamped T0+4 and read 1.5 s early, at T0+2.5; the file is bound at T0+3. Block 1 is the floor.
  const { run } = await scenario([{ read: "base", n: 0 }, { read: "base", n: 1, lagS: 0.3 }, { read: "base", n: 2, lagS: -1.5 }, { file: true, atS: T0 + 3 }, { read: "base", n: 3 }]);
  const r = await run();
  assert.equal(r.status, "verified", why(r));
  assert.equal(r.floor?.number, 37_500_001);
  assert.match(r.passedOver.join(), /proof 2: .* so it is not a floor/);
});

test("a re-bound block at or below the floor is never a ceiling", async () => {
  // Proof 2 re-binds the floor's own block right after the file: fresh by its lag, but not above the floor.
  const { run } = await scenario([{ read: "base", n: 5 }, { file: true }, { read: "base", n: 5, lagS: 1 }, { read: "base", n: 6 }]);
  const r = await run();
  assert.equal(r.status, "verified", why(r));
  assert.equal(r.ceiling?.index, 3);
  assert.match(r.passedOver.join(), /proof 2: block 37500005.* so it is not a ceiling/);
});

test("a crafted read of an old block is never a ceiling: its lag passes it over", async () => {
  // Block 3 is above the floor (block 2) but read 30 s after its time, so it is not a ceiling; block 20 is.
  const { run } = await scenario([{ read: "base", n: 2 }, { file: true }, { read: "base", n: 3, lagS: 30 }, { read: "base", n: 20, lagS: 1 }]);
  const r = await run();
  assert.equal(r.status, "verified", why(r));
  assert.equal(r.ceiling?.index, 3);
  assert.equal(r.ceiling?.number, 37_500_020);
  assert.match(r.flags.join(), /proof 2, passed over as a ceiling: base block 37500003 was read 30\.0 s after its timestamp \(limit 5 s\)/);
});

test("with no qualifying read after the file, the ceiling is unconfirmed, never a lagging read", async () => {
  const { run } = await scenario([{ read: "base", n: 0 }, { file: true }, { read: "base", n: 1, lagS: 6 }]);
  const r = await run();
  assert.equal(r.status, "unconfirmed");
  assert.equal(r.ceiling, null);
  assert.equal(r.floor?.index, 0);
  assert.match(r.unconfirmed.join(), /no read after the file in this bundle qualifies as a base ceiling/);
});

test("a fresh-looking read of a block stamped before the file is never a ceiling", async () => {
  // Block 1 is above the floor and read within 5 s of its time, but it was stamped 4 s before the file was bound.
  const { run } = await scenario([{ read: "base", n: 0 }, { file: true, atS: T0 + 6 }, { read: "base", n: 1, lagS: 4.5 }, { read: "base", n: 4 }]);
  const r = await run();
  assert.equal(r.status, "verified", why(r));
  assert.equal(r.ceiling?.index, 3);
  assert.equal(r.ceiling?.number, 37_500_004);
  assert.match(r.passedOver.join(), /proof 2: block 37500001's timestamp 1793404752 is not after the file's Nitro time 1793404756\.000/);
});

test("the ceiling is strict: a block stamped at the file's own Nitro time is not one, a block after it is", async () => {
  const equal = await (await scenario([{ read: "base", n: 0 }, { file: true, atS: T0 + 2 }, { read: "base", n: 1, lagS: 1 }])).run();
  assert.equal(equal.ceiling, null);
  assert.equal(equal.status, "unconfirmed");
  const after = await (await scenario([{ read: "base", n: 0 }, { file: true, atS: T0 + 1.999 }, { read: "base", n: 1, lagS: 1 }])).run();
  assert.equal(after.status, "verified", why(after));
  assert.equal(after.ceiling?.index, 2);
});

test("the floor's block time must be at or before the file's Nitro time; a later-stamped read gives way to an earlier one", async () => {
  // Block 1 is stamped T0+2 and read 1.5 s early; the file is bound at T0+1, so block 1 is not a floor and block 0 is.
  const { run } = await scenario([{ read: "base", n: 0, lagS: 0.2 }, { read: "base", n: 1, lagS: -1.5 }, { file: true, atS: T0 + 1 }, { read: "base", n: 2 }]);
  const r = await run();
  assert.equal(r.status, "verified", why(r));
  assert.equal(r.floor?.index, 0);
  assert.match(r.passedOver.join(), /proof 1: block 37500001's timestamp 1793404752 is after the file's Nitro time 1793404751\.000, so it is not a floor/);
  const equal = await (await scenario([{ read: "base", n: 0, lagS: -1 }, { file: true, atS: T0 }, { read: "base", n: 1 }])).run();
  assert.equal(equal.floor?.index, 0, "a floor stamped at the file's own time is allowed");
});

test("a lagging floor is flagged and still used", async () => {
  const { run } = await scenario([{ read: "base", n: 0, lagS: 9 }, { file: true }, { read: "base", n: 6, lagS: 0.5 }]);
  const r = await run();
  assert.equal(r.status, "verified", why(r));
  assert.equal(r.floor?.index, 0);
  assert.match(r.flags.join(), /the floor: base block 37500000 was read 9\.0 s after/);
});

test("lag is signed: Base 2 s early is fine, 3 s early is flagged", async () => {
  const ok = await (await scenario([{ read: "base", n: 0, lagS: -2 }, { file: true, atS: T0 }, { read: "base", n: 1, lagS: -2 }])).run();
  assert.equal(ok.status, "verified", why(ok));
  assert.deepEqual(ok.flags, []);
  const early = await (await scenario([{ read: "base", n: 0, lagS: -3 }, { file: true, atS: T0 }, { read: "base", n: 1, lagS: -3 }, { read: "base", n: 2 }])).run();
  assert.equal(early.status, "verified", why(early));
  assert.match(early.flags.join(), /the floor: base block 37500000 was read 3\.0 s before its timestamp \(limit 2 s\)/);
  assert.equal(early.ceiling?.index, 3);
});

test("with Base down, an Ethereum read brackets on Ethereum; Base reads in the run are ignored", async () => {
  const { run } = await scenario([{ read: "ethereum", n: 0, lagS: 8 }, { read: "base", n: 4, lagS: 1 }, { file: true }, { read: "ethereum", n: 1, lagS: 10 }]);
  const r = await run();
  assert.equal(r.status, "verified", why(r));
  assert.deepEqual([r.floor?.chain, r.floor?.index, r.ceiling?.chain, r.ceiling?.index], ["ethereum", 0, "ethereum", 3]);
});

test("Ethereum: 60 s late is the most for a ceiling", async () => {
  const r = await (await scenario([{ read: "ethereum", n: 0, lagS: 5 }, { file: true }, { read: "ethereum", n: 1, lagS: 61 }, { read: "ethereum", n: 2, lagS: 59 }])).run();
  assert.equal(r.status, "verified", why(r));
  assert.equal(r.ceiling?.index, 3);
  assert.match(r.flags.join(), /ethereum block 23700001 was read 61\.0 s after its timestamp \(limit 60 s\)/);
});

test("only canonical blocks bracket: an orphaned or unknown read is passed over", async () => {
  const { run } = await scenario([{ read: "base", n: 0 }, { read: "base", n: 1, canonical: false }, { file: true }, { read: "base", n: 2, known: false }, { read: "base", n: 3 }]);
  const r = await run();
  assert.equal(r.status, "verified", why(r));
  assert.equal(r.floor?.index, 0);
  assert.equal(r.ceiling?.index, 4);
  assert.match(r.passedOver.join(), /proof 1: .* not on base's canonical chain/);
  assert.match(r.passedOver.join(), /proof 3: base does not know/);
});

test("a block file whose number or time the chain contradicts fails", async () => {
  const { run, blocks } = await scenario([{ read: "base", n: 0 }, { file: true }, { read: "base", n: 1 }]);
  const h = hashOf("base", 1);
  blocks.set(h, { ...blocks.get(h)!, timestamp: T0 - 3600 });
  const r = await run();
  assert.equal(r.status, "failed");
  assert.match(r.reasons.join(), /proof 2: the file says time/);
  assert.equal(r.ceiling, null);
});

test("a lookup answering from another chain id fails", async () => {
  const { run, blocks } = await scenario([{ read: "base", n: 0 }, { file: true }, { read: "base", n: 1 }]);
  const h = hashOf("base", 0);
  blocks.set(h, { ...blocks.get(h)!, chainId: "eip155:84532" });
  const r = await run();
  assert.equal(r.status, "failed");
  assert.match(r.reasons.join(), /answer came from eip155:84532/);
});

test("the Nitro times must run in order: floor, file, ceiling", async () => {
  // A stale floor (read 10 s after its block, flagged) whose Nitro time is after the file's.
  const { run } = await scenario([{ read: "base", n: 0, lagS: 10 }, { file: true, atS: T0 + 5 }, { read: "base", n: 4 }]);
  const r = await run();
  assert.equal(r.status, "failed");
  assert.match(r.reasons.join(), /floor read's Nitro time is after the file's/);
});

test("offline, the order is checked and the time is unconfirmed", async () => {
  const { e, bundle } = await scenario([{ read: "base", n: 0 }, { file: true }, { read: "base", n: 1 }]);
  const r = await verifyTimelineBundle({ bundle, attested: e.attested });
  assert.equal(r.status, "unconfirmed");
  assert.deepEqual(r.reasons, []);
  assert.equal(r.floor, null);
  assert.equal(r.ceiling, null);
  assert.equal(r.genesis, "unconfirmed");
});

test("a chain that cannot be asked leaves the bundle unconfirmed, not failed", async () => {
  const { run, lookups } = await scenario([{ read: "base", n: 0 }, { file: true }, { read: "base", n: 1 }]);
  const r = await run({ lookups: { ...lookups, block: async () => { throw new Error("timeout"); } } });
  assert.equal(r.status, "unconfirmed");
  assert.match(r.unconfirmed.join(), /could not be asked/);
});

test("the real attestation path refuses minted proofs: only the hardware makes a bundle verify", async () => {
  const { bundle, lookups } = await scenario([{ read: "base", n: 0 }, { file: true }, { read: "base", n: 1 }]);
  const r = await verifyTimelineBundle({ bundle, lookups });
  assert.equal(r.status, "failed");
  assert.match(r.reasons.join(), /does not verify/);
});

test("a proof left out of the run, or altered, fails", async () => {
  const { run, bundle } = await scenario([{ read: "base", n: 0 }, { other: true }, { file: true }, { other: true }, { read: "base", n: 1 }]);
  const gap = { ...bundle, proofs: bundle.proofs.filter((_, i) => i !== 1), target: 1, blockFiles: { "0": bundle.blockFiles["0"]!, "3": bundle.blockFiles["4"]! } };
  assert.match((await run({ bundle: gap })).reasons.join(), /unaccounted/);

  const altered = structuredClone(bundle);
  altered.proofs[3]!.artifact.digestB64 = b64(sha256(enc.encode("another file")));
  const r = await run({ bundle: altered });
  assert.equal(r.status, "failed");
  assert.match(r.reasons.join(), /proof 3 .* does not verify/);
});

test("the file's bytes must be the file's", async () => {
  const { run } = await scenario([{ read: "base", n: 0 }, { file: true }, { read: "base", n: 1 }]);
  const r = await run({ fileBytes: enc.encode("other bytes") });
  assert.equal(r.status, "failed");
  assert.match(r.reasons.join(), /the file's proof/);
});

test("a genesis record after the file confirms the epoch; the file is pre-genesis", async () => {
  const r = await (await scenario([{ read: "base", n: 0 }, { file: true }, { read: "base", n: 1 }], { genesis: "last" })).run();
  assert.equal(r.status, "verified", why(r));
  assert.equal(r.genesis, "confirmed");
  assert.equal(r.preGenesis, true);
});

test("without its epoch's genesis record a bundle is never verified", async () => {
  const r = await (await scenario([{ read: "base", n: 0 }, { file: true }, { read: "base", n: 1 }], { genesis: "none" })).run();
  assert.equal(r.status, "unconfirmed");
  assert.equal(r.genesis, "missing");
  assert.match(r.unconfirmed.join(), /does not carry its epoch's genesis record/);
});

test("a genesis record of another key or epoch fails", async () => {
  const steps: Step[] = [{ read: "base", n: 0 }, { file: true }, { read: "base", n: 1 }];
  const { run, bundle } = await scenario(steps);
  const other = await scenario(steps);
  const r = await run({ bundle: { ...bundle, genesis: other.bundle.genesis } });
  assert.equal(r.status, "failed");
  assert.match(r.reasons.join(), /another key/);
  assert.match(r.reasons.join(), /another epoch/);
});

test("a genesis Base does not confirm fails", async () => {
  const { run, lookups } = await scenario([{ read: "base", n: 0 }, { file: true }, { read: "base", n: 1 }]);
  const wrongTx: TimelineLookups = { ...lookups, genesisTx: async () => ({ from: WRITER, to: WRITER, input: epochGenesisCalldataHex("A".repeat(43) + "="), blockHash: GENESIS.blockHash, blockNumber: GENESIS.blockNumber }) };
  const r = await run({ lookups: wrongTx });
  assert.equal(r.status, "failed");
  assert.match(r.reasons.join(), /does not carry this epoch's id/);
});

test("malformed bundles are refused before anything is checked", async () => {
  const { run, bundle } = await scenario([{ read: "base", n: 0 }, { file: true }, { read: "base", n: 1 }]);
  const bads: unknown[] = [
    null, [], { ...bundle, format: "x" }, { ...bundle, target: 0 }, { ...bundle, target: 3 }, { ...bundle, proofs: bundle.proofs.slice(0, 1) },
    { ...bundle, blockFiles: undefined }, { ...bundle, blockFiles: { "2": bundle.blockFiles["2"]! } }, { ...bundle, blockFiles: { ...bundle.blockFiles, "1": "x" } }, { ...bundle, blockFiles: { ...bundle.blockFiles, "9": "x" } },
  ];
  for (const bad of bads) {
    const r = await run({ bundle: bad });
    assert.equal(r.status, "failed");
    assert.equal(r.reasons.length, 1);
  }
});
