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
const CHAIN_IDS: Record<BlockReadChain, string> = { base: "eip155:8453", ethereum: "eip155:1", bitcoin: "bip122:000000000019d6689c085ae165831e93" };
const hashOf = (chain: BlockReadChain, n: number): string => (chain === "bitcoin" ? "" : "0x") + Buffer.from(sha256(enc.encode(`${chain} ${n}`))).toString("hex");

const WRITER = "0xf3972408d853c975f86351c311f4310220bbf2a3";
const GENESIS = { blockNumber: 53_307_701, blockHash: "0x" + "d2".repeat(32), blockTimestamp: T0 - 100, txHash: "0x" + "8f".repeat(32) };

/**
 * An epoch with its genesis at counts 1-2, then: a block read, the file, a block read. `read` sets each bracket's
 * chain, block number and how long after the block's time the enclave read it.
 */
async function scenario(opts: { floor?: { chain: BlockReadChain; lagS: number }; ceiling?: { chain: BlockReadChain; lagS: number }; between?: number } = {}) {
  const e = await epoch();
  const genesisFile = epochGenesisFileText({ epochId: e.epochId, chainId: 8453, writer: WRITER, ...GENESIS });
  const genesisProof = await e.bind(b64(sha256(enc.encode(genesisFile))), (GENESIS.blockTimestamp + 1) * 1000);

  const blocks = new Map<string, ChainBlock>();
  const read = async (chain: BlockReadChain, number: number, timestamp: number, lagS: number) => {
    const hash = hashOf(chain, number);
    blocks.set(hash, { hash, number, timestamp, canonical: true });
    const text = blockReadFileText({ epochId: e.epochId, chain, chainId: CHAIN_IDS[chain], number, hash, timestamp });
    return { text, proof: await e.bind(b64(sha256(enc.encode(text))), Math.round((timestamp + lagS) * 1000)) };
  };
  const f = opts.floor ?? { chain: "base", lagS: 1.5 };
  const c = opts.ceiling ?? { chain: "base", lagS: 1.2 };
  const floor = await read(f.chain, 37_500_000, T0, f.lagS);
  const middle: BitGraphProof[] = [];
  for (let i = 0; i < (opts.between ?? 0); i++) middle.push(await e.bind(b64(sha256(enc.encode(`someone else's file ${i}`))), (T0 + 1) * 1000));
  const fileBytes = enc.encode("the file");
  const file = await e.bind(b64(sha256(fileBytes)), (T0 + 1) * 1000);
  const ceiling = await read(c.chain, 37_500_001, T0 + 2, c.lagS);

  const bundle: TimelineBundle = {
    format: TIMELINE_BUNDLE_FORMAT,
    proofs: [floor.proof, ...middle, file, ceiling.proof],
    target: 1 + middle.length,
    floorFile: floor.text,
    ceilingFile: ceiling.text,
    genesis: { proof: genesisProof, file: genesisFile },
  };
  const lookups: TimelineLookups = {
    block: async (_chain, _id, hash) => blocks.get(hash) ?? null,
    genesisTx: async (txHash) => (txHash === GENESIS.txHash ? { from: WRITER, to: WRITER, input: epochGenesisCalldataHex(e.epochId), blockHash: GENESIS.blockHash, blockNumber: GENESIS.blockNumber } : null),
    genesisBlock: async (hash) => (hash === GENESIS.blockHash ? { hash, number: GENESIS.blockNumber, timestamp: GENESIS.blockTimestamp } : null),
  };
  return { e, bundle, lookups, blocks, fileBytes };
}

test("a bundle the chains confirm is verified, with the chain's numbers and each read's own lag", async () => {
  const { e, bundle, lookups, fileBytes } = await scenario({ between: 2 });
  const r = await verifyTimelineBundle({ bundle, lookups, fileBytes, attested: e.attested });
  assert.equal(r.status, "verified", [...r.reasons, ...r.unconfirmed].join("; "));
  assert.deepEqual(r.flags, []);
  assert.equal(r.genesis, "confirmed");
  assert.equal(r.floor?.number, 37_500_000);
  assert.equal(r.floor?.timestamp, T0);
  assert.equal(r.floor?.lagS, 1.5);
  assert.equal(r.ceiling?.number, 37_500_001);
  assert.equal(r.ceiling?.lagS, 1.2);
  assert.equal(r.file?.counter, "10");
});

test("the real attestation path refuses minted proofs: only the hardware makes a bundle verify", async () => {
  const { bundle, lookups } = await scenario();
  const r = await verifyTimelineBundle({ bundle, lookups });
  assert.equal(r.status, "failed");
  assert.match(r.reasons.join(), /does not verify/);
});

test("offline, the order is checked and the time is unconfirmed", async () => {
  const { e, bundle } = await scenario();
  const r = await verifyTimelineBundle({ bundle, attested: e.attested });
  assert.equal(r.status, "unconfirmed");
  assert.deepEqual(r.reasons, []);
  assert.equal(r.floor, null);
  assert.equal(r.ceiling, null);
  assert.equal(r.genesis, "unconfirmed");
  assert.equal(r.unconfirmed.length, 3);
});

test("a chain that cannot be asked leaves the bundle unconfirmed, not failed", async () => {
  const { e, bundle, lookups } = await scenario();
  const down: TimelineLookups = { ...lookups, block: async () => { throw new Error("timeout"); } };
  const r = await verifyTimelineBundle({ bundle, lookups: down, attested: e.attested });
  assert.equal(r.status, "unconfirmed");
  assert.match(r.unconfirmed.join(), /could not be asked/);
});

test("a bracket the chain does not have on its canonical chain fails", async () => {
  const { e, bundle, lookups, blocks } = await scenario();
  const floorHash = hashOf("base", 37_500_000);
  blocks.set(floorHash, { ...blocks.get(floorHash)!, canonical: false });
  const r = await verifyTimelineBundle({ bundle, lookups, attested: e.attested });
  assert.equal(r.status, "failed");
  assert.match(r.reasons.join(), /canonical/);
  blocks.delete(floorHash);
  assert.match((await verifyTimelineBundle({ bundle, lookups, attested: e.attested })).reasons.join(), /does not know/);
});

test("a block file whose number or time the chain contradicts fails", async () => {
  const { e, bundle, lookups, blocks } = await scenario();
  const ceilingHash = hashOf("base", 37_500_001);
  blocks.set(ceilingHash, { ...blocks.get(ceilingHash)!, timestamp: T0 - 3600 });
  const r = await verifyTimelineBundle({ bundle, lookups, attested: e.attested });
  assert.equal(r.status, "failed");
  assert.match(r.reasons.join(), /the ceiling read: the file says time/);
});

test("a proof left out of the run, or altered, fails", async () => {
  const { e, bundle, lookups } = await scenario({ between: 2 });
  const gap = { ...bundle, proofs: bundle.proofs.filter((_, i) => i !== 1), target: bundle.target - 1 };
  assert.match((await verifyTimelineBundle({ bundle: gap, lookups, attested: e.attested })).reasons.join(), /unaccounted/);

  const altered = structuredClone(bundle);
  altered.proofs[2]!.artifact.digestB64 = b64(sha256(enc.encode("another file")));
  const r = await verifyTimelineBundle({ bundle: altered, lookups, attested: e.attested });
  assert.equal(r.status, "failed");
  assert.match(r.reasons.join(), /proof 2 .* does not verify/);
});

test("the file's bytes must be the file's", async () => {
  const { e, bundle, lookups } = await scenario();
  const r = await verifyTimelineBundle({ bundle, lookups, fileBytes: enc.encode("other bytes"), attested: e.attested });
  assert.equal(r.status, "failed");
  assert.match(r.reasons.join(), /the file's proof/);
});

test("lag outside the limits is flagged, never refused", async () => {
  const { e, bundle, lookups } = await scenario({ floor: { chain: "base", lagS: 45 }, ceiling: { chain: "bitcoin", lagS: -3 * 3600 } });
  const r = await verifyTimelineBundle({ bundle, lookups, attested: e.attested });
  assert.equal(r.status, "verified", [...r.reasons, ...r.unconfirmed].join("; "));
  assert.equal(r.flags.length, 2);
  assert.match(r.flags[0]!, /base block 37500000 was read 45\.0 s after its timestamp \(limit 30 s\)/);
  assert.match(r.flags[1]!, /bitcoin block 37500001 was read 10800\.0 s before its timestamp \(limit 7200 s\)/);
  const relaxed = await verifyTimelineBundle({ bundle, lookups, attested: e.attested, lagLimits: { base: { maxS: 60 }, bitcoin: { maxS: 3 * 3600, minS: -4 * 3600 } } });
  assert.deepEqual(relaxed.flags, []);
});

test("with Base down, Ethereum and Bitcoin reads bracket the file", async () => {
  const { e, bundle, lookups } = await scenario({ floor: { chain: "ethereum", lagS: 8 }, ceiling: { chain: "bitcoin", lagS: 600 } });
  const r = await verifyTimelineBundle({ bundle, lookups, attested: e.attested });
  assert.equal(r.status, "verified", [...r.reasons, ...r.unconfirmed].join("; "));
  assert.equal(r.floor?.chain, "ethereum");
  assert.equal(r.ceiling?.chain, "bitcoin");
});

test("without a genesis record the file is pre-genesis; a genesis after the file fails", async () => {
  const { e, bundle, lookups } = await scenario();
  const { genesis, ...withoutGenesis } = bundle;
  const pre = await verifyTimelineBundle({ bundle: withoutGenesis, lookups, attested: e.attested });
  assert.equal(pre.status, "verified");
  assert.equal(pre.genesis, "pre-genesis");

  const late = { ...bundle, genesis: { proof: bundle.proofs[bundle.proofs.length - 1]!, file: genesis!.file } };
  const r = await verifyTimelineBundle({ bundle: late, lookups, attested: e.attested });
  assert.equal(r.status, "failed");
  assert.match(r.reasons.join(), /not before the file/);
});

test("a genesis Base does not confirm fails", async () => {
  const { e, bundle, lookups } = await scenario();
  const wrongTx: TimelineLookups = { ...lookups, genesisTx: async () => ({ from: WRITER, to: WRITER, input: epochGenesisCalldataHex("A".repeat(43) + "="), blockHash: GENESIS.blockHash, blockNumber: GENESIS.blockNumber }) };
  const r = await verifyTimelineBundle({ bundle, lookups: wrongTx, attested: e.attested });
  assert.equal(r.status, "failed");
  assert.match(r.reasons.join(), /does not carry this epoch's id/);
});

test("malformed bundles are refused before anything is checked", async () => {
  const { e, bundle } = await scenario();
  for (const bad of [null, [], { ...bundle, format: "x" }, { ...bundle, target: 0 }, { ...bundle, target: bundle.proofs.length - 1 }, { ...bundle, proofs: bundle.proofs.slice(0, 2) }, { ...bundle, floorFile: undefined }]) {
    const r = await verifyTimelineBundle({ bundle: bad, attested: e.attested });
    assert.equal(r.status, "failed");
    assert.equal(r.reasons.length, 1);
  }
});
