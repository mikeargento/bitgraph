// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * BitGraph Nitro Enclave — BitGraph
 *
 * This enclave controls how objects come into existence and proves
 * their causal ordering. It does NOT prove time. It proves origin
 * and forward-only existence using hardware entropy.
 *
 * On boot:
 *   1. Generate Ed25519 keypair in memory (never leaves enclave)
 *   2. Generate boot nonce (32 bytes from NSM GetRandom)
 *   3. Compute epochId = SHA-256(publicKeyB64 + ":" + bootNonceB64)
 *   4. Listen on vsock port 5000 for length-prefixed JSON requests
 *
 * Origin slot protocol (2-RTT):
 *   1. allocateSlot() → TEE generates hardware nonce, signs slot record
 *      The slot is a controlled origin opportunity. It exists first.
 *   2. commit(slotId, digest) → TEE consumes slot, binds artifact hash
 *      The commit is the moment something becomes causally real.
 *
 *   Slot → Commit → Next Slot → Next Commit
 *
 *   Each commit depends on entropy generated AFTER the previous commit.
 *   This creates forward-only existence — no reordering, no backfilling.
 *
 * Ethereum front anchors:
 *   External service commits unpredictable Ethereum block hashes into
 *   the same chain. These are front anchors — they seal backward.
 *   Everything before an anchor must already exist. The anchor proves
 *   prior existence before public entropy, not creation time.
 *
 * Epochs:
 *   Each enclave boot is a new epoch. Counter resets. New keypair.
 *   Cross-epoch ordering relies on Ethereum anchors — if epoch A's
 *   last anchor references block N and epoch B's first anchor
 *   references block M > N, epoch A came first.
 *
 * Trust model:
 *   - TEE attestation (NSM)
 *   - Hardware entropy (NSM GetRandom)
 *   - Public entropy (Ethereum block hashes)
 *   - NO CLOCK PARTICIPATES IN ORDERING, and no centralized authority.
 *     Wall time is read only for expiry (slot TTL, challenge TTL, agency
 *     freshness) and never enters a signed body or an ordering decision.
 *     Slot bodies are built deliberately without a time field.
 *
 * Pure pass-through:
 *   The enclave receives a DIGEST, not bytes, and never transforms an
 *   artifact. The exact bits the caller hashed are the exact bits the proof
 *   represents. A transform endpoint (convertBW, grayscale via sharp) existed
 *   here until 2026-07-29 and was removed: it bound only the OUTPUT digest
 *   with no attested link to the input, so it demonstrated "a computation
 *   occurred" only to someone who already trusted the narrative, and it pulled
 *   a large native image-decoding surface into the measured boundary. A real
 *   derivation capability would bind inputDigest, outputDigest and a measured
 *   transform identity in one signed body. Do not reintroduce a transform
 *   into the base commit path.
 *
 * Signing flow (attestation-correct):
 *   1. Build complete signed body including attestationFormat
 *   2. Canonicalize deterministically
 *   3. SHA-256 hash the canonical bytes
 *   4. Request NSM attestation with hash as user_data
 *   5. Ed25519 sign the SAME canonical bytes
 *   Result: attestation.user_data == SHA-256(signedBody) == signed hash
 *
 * Counter gaps:
 *   Slots that expire without being consumed leave counter gaps.
 *   This is correct — prevB64 links proofs, not counters. Gaps do
 *   not break the causal chain. Slots are single-use and must never
 *   be reused.
 */

import { createServer, type Socket } from "node:net";
import { createVerify, createHash } from "node:crypto";
import { sha256 } from "@noble/hashes/sha256";
import { getPublicKeyAsync, signAsync, verifyAsync, utils } from "@noble/ed25519";
import { canonicalize, canonicalizeToString } from "bitgraph";
import { Constructor } from "bitgraph";
import type { HostCapabilities, BitGraphProof, SignedBody, SlotAllocation, ActorIdentity, AgencyEnvelope, AuthorizationPayload, WebAuthnAuthorization, PolicyBinding } from "bitgraph";
import type { EnclaveRequest, EnclaveResponse } from "../parent/vsock-client.js";

// ---------------------------------------------------------------------------
// Ed25519 keypair — generated in enclave memory, never exported
// ---------------------------------------------------------------------------

const privateKey = utils.randomPrivateKey();
const publicKey = await getPublicKeyAsync(privateKey);
const publicKeyB64 = Buffer.from(publicKey).toString("base64");

console.log("[enclave] Ed25519 keypair generated in enclave memory");
console.log(`[enclave] publicKey: ${publicKeyB64}`);

// ---------------------------------------------------------------------------
// Enclave HostCapabilities (NitroHost for real enclaves)
// ---------------------------------------------------------------------------

import { NitroHost, DefaultNsmClient } from "@bitgraph/adapter-nitro";

const nsmClient = new DefaultNsmClient();
const nitroHost = new NitroHost({
  sign: (data: Uint8Array) => signAsync(data, privateKey),
  getPublicKey: async () => publicKey,
  nsmClient,
});

const measurement = await nitroHost.getMeasurement();
console.log(`[enclave] measurement (PCR0): ${measurement}`);
if (/^0+$/.test(measurement)) {
  console.warn(
    "[enclave] WARNING: measurement is all zeros — enclave is running in debug mode.\n" +
    "[enclave] Proofs will contain a zero measurement. Redeploy without --debug-mode for production."
  );
}

// ---------------------------------------------------------------------------
// Epoch identity — computed once at boot, included in every proof
// epochId = BASE64(SHA-256(publicKeyB64 + ":" + bootNonceB64))
// ---------------------------------------------------------------------------

const bootNonceBytes = await nitroHost.getFreshNonce();
const bootNonceB64 = Buffer.from(bootNonceBytes).toString("base64");
const epochIdBytes = sha256(
  new TextEncoder().encode(publicKeyB64 + ":" + bootNonceB64)
);
const epochId = Buffer.from(epochIdBytes).toString("base64");

console.log(`[enclave] epochId: ${epochId}`);

// ---------------------------------------------------------------------------
// Constructor — initialized with epochId so callers that use
// constructor.commit()/commitDigest() also get epochId in proofs.
// The manual proof-building flow below uses epochId from module scope.
// ---------------------------------------------------------------------------

const constructor = await Constructor.initialize({ host: nitroHost, epochId });

// ---------------------------------------------------------------------------
// Per-chain state — each chainId gets its own counter, prevB64, and epochLink.
// Chains are created dynamically on first use (no registration needed).
// The "global" chain is the default for backward compatibility.
// ---------------------------------------------------------------------------

interface ChainState {
  counter: bigint;
  lastProofHashB64: string | undefined;
  pendingEpochLink: BitGraphProof["commit"]["epochLink"] | undefined;
  /** Latest authenticated Ethereum anchor committed on this chain this epoch (enclave v7). */
  latestAnchor: AnchorMark | undefined;
}

// ---------------------------------------------------------------------------
// Authenticated Ethereum anchors (enclave v7, 2026-09-06).
//
// Until v6 an anchor was an ordinary commit whose attribution said "Ethereum
// Anchor": the enclave signed whatever attribution the caller sent, so the
// proof itself could not tell a real anchor from a look-alike, and the only
// thing separating them was the ledger's anchors/ index. Here the anchor
// service proves it is the anchor service: it signs
//   "bitgraph-anchor/1\n{epochId}\n{chainId}\n{blockNumber}\n{blockHash}"
// with an Ed25519 key whose public half is baked into this image (so a key
// rotation is a new PCR0). The enclave checks the signature, checks that the
// artifact digest is SHA-256 of the block hash string, requires block numbers
// to climb per chain, and only then writes `commit.anchor` into the signed
// body. The reserved attribution name is refused without a valid anchor.
//
// At every allocation the enclave also copies the chain's latest anchor into
// the slot entry, and at commit writes it into the signed body as
// `commit.slotAnchor`: the floor a proof stands on is chosen by the enclave,
// not by the party presenting the proof. Both fields live inside `commit`,
// which every published verifier copies whole into the signed body, so a v6
// verifier keeps verifying v7 proofs. The slot record is unchanged.
// ---------------------------------------------------------------------------

const ANCHOR_SERVICE_PUBLIC_KEY_B64 = "L/zyqG3111Y0hEyKF6NIKI4amSvSBBQxGMjdjLa2520=";
// The chain the anchor service anchors. Enclave v8 refuses to commit a
// floorless proof on it: see the gate in handleCommit. Every other chain is
// unanchored by design and unaffected.
const ANCHORED_CHAIN_ID = "bitgraph:main";
const ANCHOR_ATTRIBUTION_NAME = "Ethereum Anchor";
const ANCHOR_MESSAGE_PREFIX = "bitgraph-anchor/1";
const anchorServicePublicKey = new Uint8Array(Buffer.from(ANCHOR_SERVICE_PUBLIC_KEY_B64, "base64"));

interface AnchorMark {
  /** Counter of the anchor proof on its chain (decimal string). */
  counter: string;
  blockNumber: number;
  /** 0x-prefixed lowercase hex, 32 bytes. */
  blockHash: string;
}

/** What the anchor service sends alongside an anchor commit. */
interface AnchorClaim {
  blockNumber?: unknown;
  blockHash?: unknown;
  signatureB64?: unknown;
}

const BLOCK_HASH_RE = /^0x[0-9a-f]{64}$/;

/**
 * Authenticate an anchor claim. Throws on anything short of a fully valid
 * claim; returns the block fields the enclave will sign. A rejected claim
 * has already consumed its slot, like any other rejected commit.
 */
async function verifyAnchorClaim(
  claim: AnchorClaim,
  digestB64: string,
  chainId: string,
  chain: ChainState,
): Promise<{ blockNumber: number; blockHash: string }> {
  const { blockNumber, blockHash, signatureB64 } = claim;
  if (typeof blockNumber !== "number" || !Number.isSafeInteger(blockNumber) || blockNumber <= 0) {
    throw new Error("anchor.blockNumber must be a positive integer");
  }
  if (typeof blockHash !== "string" || !BLOCK_HASH_RE.test(blockHash)) {
    throw new Error("anchor.blockHash must be 0x-prefixed lowercase hex, 32 bytes");
  }
  if (typeof signatureB64 !== "string") {
    throw new Error("anchor.signatureB64 is required");
  }
  const expectedDigest = Buffer.from(sha256(new TextEncoder().encode(blockHash))).toString("base64");
  if (expectedDigest !== digestB64) {
    throw new Error("anchor digest must be SHA-256 of the block hash string");
  }
  if (chain.latestAnchor && blockNumber <= chain.latestAnchor.blockNumber) {
    throw new Error(`anchor block ${blockNumber} does not advance past block ${chain.latestAnchor.blockNumber}`);
  }
  const message = new TextEncoder().encode(
    `${ANCHOR_MESSAGE_PREFIX}\n${epochId}\n${chainId}\n${blockNumber}\n${blockHash}`,
  );
  const sig = new Uint8Array(Buffer.from(signatureB64, "base64"));
  if (sig.length !== 64) throw new Error("anchor.signatureB64 must be a 64-byte Ed25519 signature");
  let ok = false;
  try {
    ok = await verifyAsync(sig, message, anchorServicePublicKey);
  } catch {
    ok = false;
  }
  if (!ok) throw new Error("anchor signature does not verify against the anchor service key");
  return { blockNumber, blockHash };
}

const chains = new Map<string, ChainState>();
const DEFAULT_CHAIN = "global";

function getChain(chainId?: string): ChainState {
  const id = chainId ?? DEFAULT_CHAIN;
  let chain = chains.get(id);
  if (!chain) {
    chain = { counter: 0n, lastProofHashB64: undefined, pendingEpochLink: undefined, latestAnchor: undefined };
    chains.set(id, chain);
    console.log(`[enclave] chain created: ${id}`);
  }
  return chain;
}

/** Get all chain IDs with their current state (for persistence on shutdown) */
function getAllChainStates(): Map<string, ChainState> {
  return chains;
}

// ---------------------------------------------------------------------------
// Challenge state — pending challenges for agency signing
// Each challenge is a fresh enclave nonce with a TTL.
// ---------------------------------------------------------------------------

const CHALLENGE_TTL_MS = 60_000; // 60 seconds
const MAX_PENDING_CHALLENGES = 500;
const pendingChallenges = new Map<string, number>(); // challenge → expiresAt

// Validated batch agency — allows batch proofs 2..N to inherit actor identity.
// Keyed by challenge string. Stored after first-digest validation, consumed
// when all batch digests have been committed or on TTL expiry.
interface ValidatedBatch {
  actor: ActorIdentity;
  batchDigests: string[];
  remaining: Set<string>;   // digests not yet committed
  expiresAt: number;
}
const validatedBatches = new Map<string, ValidatedBatch>();

function cleanExpiredChallenges(): void {
  const now = Date.now();
  for (const [challenge, expiresAt] of pendingChallenges) {
    if (now >= expiresAt) {
      pendingChallenges.delete(challenge);
    }
  }
  // Also clean expired batch entries
  for (const [key, batch] of validatedBatches) {
    if (now >= batch.expiresAt) {
      validatedBatches.delete(key);
    }
  }
}

async function handleChallenge(): Promise<{ challenge: string }> {
  cleanExpiredChallenges();

  if (pendingChallenges.size >= MAX_PENDING_CHALLENGES) {
    throw new Error("Too many pending challenges — try again later");
  }

  // Generate fresh nonce from NSM hardware RNG
  const nonceBytes = await nitroHost.getFreshNonce();
  const challenge = Buffer.from(nonceBytes).toString("base64");

  // Store with TTL
  pendingChallenges.set(challenge, Date.now() + CHALLENGE_TTL_MS);

  console.log(`[enclave] challenge issued (${pendingChallenges.size} pending)`);
  return { challenge };
}

// ---------------------------------------------------------------------------
// Causal slot state — pending slots for BitGraph atomic causality
// Each slot is a pre-allocated nonce signed by the enclave BEFORE any
// artifact hash is known. Consuming a slot is required to produce a proof.
// ---------------------------------------------------------------------------

const SLOT_TTL_MS = 120_000; // 2 minutes
const MAX_PENDING_SLOTS = 1000;

interface SlotEntry {
  record: SlotAllocation;
  chainId: string;
  expiresAt: number;
  /** The chain's latest authenticated anchor when the slot was allocated (enclave v7). */
  anchorAtAllocation: AnchorMark | undefined;
}

const pendingSlots = new Map<string, SlotEntry>(); // nonceB64 → SlotEntry

function cleanExpiredSlots(): void {
  const now = Date.now();
  for (const [slotId, entry] of pendingSlots) {
    if (now >= entry.expiresAt) {
      pendingSlots.delete(slotId);
    }
  }
}

/**
 * Allocate a causal slot.
 *
 * Generates a fresh nonce from the NSM hardware RNG, signs a slot record
 * that deliberately contains NO artifact data, and stores the nonce as a
 * single-use resource. A subsequent commit must reference this slotId to
 * produce a proof.
 *
 * This is the BitGraph nonce-first causal ordering primitive:
 *   allocateSlot() → slot exists → commit(slotId, digest) → slot consumed
 *
 * The signed slot record is embedded in the resulting proof so that any
 * verifier can confirm the nonce existed before the artifact was bound.
 */
async function handleAllocateSlot(chainId?: string): Promise<{ slotId: string; slot: SlotAllocation; chainId: string }> {
  cleanExpiredSlots();

  if (pendingSlots.size >= MAX_PENDING_SLOTS) {
    throw new Error("Too many pending slots — try again later");
  }

  // 1. Get or create the chain, then increment its counter.
  const chain = getChain(chainId);
  chain.counter += 1n;

  // 2. Generate fresh nonce from NSM hardware RNG
  const nonceBytes = await nitroHost.getFreshNonce();
  const nonceB64 = Buffer.from(nonceBytes).toString("base64");

  // 4. Build slot body — deliberately NO artifact hash, NO clock
  const resolvedChainId = chainId ?? DEFAULT_CHAIN;
  const slotBody = {
    version: "bitgraph/slot/1" as const,
    nonceB64,
    counter: String(chain.counter),
    epochId,
    publicKeyB64,
    ...(resolvedChainId !== DEFAULT_CHAIN ? { chainId: resolvedChainId } : {}),
  };

  // 5. Sign the slot body (proves enclave created this independently)
  const slotCanonicalBytes = canonicalize(slotBody);
  const signatureBytes = await signAsync(slotCanonicalBytes, privateKey);

  const record: SlotAllocation = {
    ...slotBody,
    signatureB64: Buffer.from(signatureBytes).toString("base64"),
  };

  // 6. Store as single-use resource
  // 7. Fix the floor now, at allocation: the latest real anchor on this
  // chain. It is signed into the proof at commit as commit.slotAnchor.
  pendingSlots.set(nonceB64, {
    record,
    chainId: resolvedChainId,
    expiresAt: Date.now() + SLOT_TTL_MS,
    anchorAtAllocation: chain.latestAnchor,
  });

  console.log(`[enclave] slot allocated: chain=${resolvedChainId} counter=${record.counter} (${pendingSlots.size} pending)`);
  return { slotId: nonceB64, slot: record, chainId: resolvedChainId };
}

// ---------------------------------------------------------------------------
// Agency verification — validates P-256 device signature
// ---------------------------------------------------------------------------

/**
 * Verify an agency envelope before including the actor in the proof.
 *
 * Two verification paths:
 *   - Direct (format undefined): P-256 signature over canonical JSON
 *   - WebAuthn (format: "webauthn"): Standard WebAuthn assertion
 *
 * Common checks:
 *   1. challenge is pending and unused (consumed on success)
 *   2. authorization.artifactHash matches the committed digest
 *   3. authorization.actorKeyId matches actor.keyId
 *   4. actor.keyId == hex(SHA-256(SPKI DER pubkey bytes))
 *   5. timestamp is within CHALLENGE_TTL_MS of now
 *   6. P-256 signature is valid (over format-specific data)
 */
function verifyAgencyEnvelope(
  agency: AgencyEnvelope,
  digestB64: string
): void {
  const { actor, authorization } = agency;
  const isWebAuthn = "format" in authorization && authorization.format === "webauthn";

  // 1. Validate challenge is pending
  cleanExpiredChallenges();
  const challengeToCheck = authorization.challenge;
  if (!pendingChallenges.has(challengeToCheck)) {
    throw new Error("Agency: challenge not found or expired");
  }

  // 2. Validate purpose
  if (authorization.purpose !== "bitgraph/commit-authorize/v1") {
    throw new Error(`Agency: invalid purpose "${authorization.purpose}"`);
  }

  // 3. Validate actorKeyId matches actor.keyId
  if (authorization.actorKeyId !== actor.keyId) {
    throw new Error("Agency: authorization.actorKeyId does not match actor.keyId");
  }

  // 4. Validate artifactHash matches the committed digest
  if (authorization.artifactHash !== digestB64) {
    throw new Error("Agency: authorization.artifactHash does not match committed digest");
  }

  // 5. Validate actor.keyId == hex(SHA-256(SPKI DER pubkey bytes))
  const pubKeyDer = Buffer.from(actor.publicKeyB64, "base64");
  const computedKeyId = createHash("sha256").update(pubKeyDer).digest("hex");
  if (computedKeyId !== actor.keyId) {
    throw new Error("Agency: actor.keyId does not match SHA-256 of public key");
  }

  // 6. Validate timestamp freshness
  const now = Date.now();
  if (Math.abs(now - authorization.timestamp) > CHALLENGE_TTL_MS) {
    throw new Error("Agency: authorization timestamp too far from current time");
  }

  // 7. Validate algorithm
  if (actor.algorithm !== "ES256") {
    throw new Error(`Agency: unsupported algorithm "${actor.algorithm}"`);
  }

  if (isWebAuthn) {
    // ── WebAuthn assertion verification ──
    const webauthn = authorization as WebAuthnAuthorization;

    // Parse clientDataJSON
    let clientData: { type?: string; challenge?: string; origin?: string };
    try {
      clientData = JSON.parse(webauthn.clientDataJSON);
    } catch {
      throw new Error("Agency: clientDataJSON is not valid JSON");
    }

    // Verify type
    if (clientData.type !== "webauthn.get") {
      throw new Error(`Agency: clientDataJSON.type must be "webauthn.get", got "${clientData.type}"`);
    }

    // Verify challenge in clientDataJSON matches the enclave-issued nonce
    // WebAuthn encodes the challenge as base64url in clientDataJSON
    if (!clientData.challenge) {
      throw new Error("Agency: clientDataJSON missing challenge field");
    }
    // Convert base64url → base64 for comparison
    let clientChallenge = clientData.challenge
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    while (clientChallenge.length % 4) clientChallenge += "=";
    if (clientChallenge !== challengeToCheck) {
      throw new Error("Agency: clientDataJSON challenge does not match enclave-issued nonce");
    }

    // Parse authenticatorData and check flags
    const authData = Buffer.from(webauthn.authenticatorDataB64, "base64");
    if (authData.length < 37) {
      throw new Error("Agency: authenticatorData too short");
    }
    const flags = authData[32]!; // flags byte is at offset 32 (after 32-byte rpIdHash)
    const UP = (flags & 0x01) !== 0; // User Present
    const UV = (flags & 0x04) !== 0; // User Verified
    if (!UP) throw new Error("Agency: authenticatorData UP (user present) flag not set");
    if (!UV) throw new Error("Agency: authenticatorData UV (user verified) flag not set");

    // Build signed data: authenticatorData || SHA-256(clientDataJSON)
    const clientDataHash = createHash("sha256")
      .update(Buffer.from(webauthn.clientDataJSON, "utf8"))
      .digest();
    const signedData = Buffer.concat([authData, clientDataHash]);

    // P-256 signature verification over WebAuthn signed data
    const sigBytes = Buffer.from(webauthn.signatureB64, "base64");
    const verifier = createVerify("SHA256");
    verifier.update(signedData);
    const valid = verifier.verify(
      { key: pubKeyDer, format: "der", type: "spki" },
      sigBytes
    );
    if (!valid) {
      throw new Error("Agency: WebAuthn P-256 signature verification failed");
    }
  } else {
    // ── Direct P-256 signature verification ──
    // Build canonical payload (sorted keys, compact JSON, no signatureB64)
    const canonicalPayload: Record<string, unknown> = {
      purpose: authorization.purpose,
      actorKeyId: authorization.actorKeyId,
      artifactHash: authorization.artifactHash,
      challenge: authorization.challenge,
      timestamp: authorization.timestamp,
    };
    // Include protocolVersion when present (backward-compatible)
    if ("protocolVersion" in authorization && (authorization as unknown as Record<string, unknown>).protocolVersion !== undefined) {
      canonicalPayload.protocolVersion = (authorization as unknown as Record<string, unknown>).protocolVersion;
    }
    const payloadBytes = Buffer.from(
      JSON.stringify(canonicalPayload, Object.keys(canonicalPayload).sort()),
      "utf8"
    );

    const sigBytes = Buffer.from(authorization.signatureB64, "base64");
    const verifier = createVerify("SHA256");
    verifier.update(payloadBytes);
    const valid = verifier.verify(
      { key: pubKeyDer, format: "der", type: "spki" },
      sigBytes
    );
    if (!valid) {
      throw new Error("Agency: P-256 signature verification failed");
    }
  }

  // Consume the challenge (single-use)
  pendingChallenges.delete(challengeToCheck);
  console.log(`[enclave] agency verified: actor=${actor.keyId.slice(0, 12)}... provider=${actor.provider} format=${isWebAuthn ? "webauthn" : "direct"}`);
}

// ---------------------------------------------------------------------------
// Commit handler — produces BitGraph proofs for pre-computed digests
// ---------------------------------------------------------------------------

/**
 * Commit a single artifact hash by consuming a pre-allocated causal slot.
 *
 * BitGraph causal invariant: one slot → one artifact → one proof.
 * The slot MUST exist before the artifact hash can be committed.
 * The slot's nonce becomes the proof's nonce (binding).
 * The slot's counter must be less than the commit's counter (ordering).
 * The SHA-256 of the canonical slot body is included in the signed
 * commit body via slotHashB64 (cryptographic binding).
 */
async function handleCommit(req: {
  slotId: string;
  digestB64: string;
  metadata?: Record<string, unknown>;
  agency?: AgencyEnvelope;
  attribution?: { name?: string; title?: string; message?: string };
  policy?: PolicyBinding;
  /** Anchor service claim; authenticated by verifyAnchorClaim (enclave v7). */
  anchor?: AnchorClaim;
}): Promise<BitGraphProof> {
  // ── Slot consumption — BitGraph causal gate ──
  // The slot MUST exist before any artifact can be committed.
  // This is the enforcement point for nonce-first atomic causality.
  cleanExpiredSlots();
  const slotEntry = pendingSlots.get(req.slotId);
  if (!slotEntry) {
    throw new Error("Slot not found or expired — call allocateSlot before committing");
  }
  const slotRecord = slotEntry.record;
  const chainId = slotEntry.chainId;
  const chain = getChain(chainId);
  pendingSlots.delete(req.slotId); // single-use consumption

  console.log(`[enclave] slot consumed: chain=${chainId} counter=${slotRecord.counter} slotId=${req.slotId.slice(0, 12)}... (${pendingSlots.size} remaining)`);

  // Validate digest
  const digestB64 = req.digestB64;
  const digestBytes = Buffer.from(digestB64, "base64");
  if (digestBytes.length !== 32) {
    throw new Error(`Invalid SHA-256 digest length: ${digestBytes.length}`);
  }

  // Authenticated anchor (enclave v7). The reserved attribution name is
  // refused unless the claim verifies, so a look-alike cannot be signed.
  let anchorMark: { blockNumber: number; blockHash: string } | undefined;
  if (req.anchor !== undefined) {
    anchorMark = await verifyAnchorClaim(req.anchor, digestB64, chainId, chain);
  } else if (req.attribution?.name === ANCHOR_ATTRIBUTION_NAME) {
    throw new Error(`attribution.name "${ANCHOR_ATTRIBUTION_NAME}" is reserved for authenticated anchor commits`);
  }

  // ── Floor gate (enclave v8) ──
  // A slot allocated before this epoch's first authenticated anchor carries no
  // floor, and a proof without a floor is exactly the one an issuer would wait
  // for: nothing in it bounds the artifact from below in time. So on the
  // anchored chain the enclave refuses to sign one. The gate reads the SLOT's
  // floor, not the chain's current state, so waiting for an anchor and then
  // spending an older slot does not get past it.
  //
  // Anchors themselves are exempt, which is what keeps this from deadlocking:
  // an authenticated anchor claim may always be committed, so the epoch's first
  // anchor lands and every slot allocated after it has a floor. The cost is a
  // narrow refusal window at each epoch start (the epoch-cycle script asks the
  // anchor service for an immediate anchor, so it is a second or two), and a
  // dependency: if the anchor service is down when an epoch begins, the
  // anchored chain refuses commits until it returns. That is the intended
  // trade: no floorless proofs on the chain whose proofs claim floors.
  if (!anchorMark && chainId === ANCHORED_CHAIN_ID && !slotEntry.anchorAtAllocation) {
    throw new Error(
      "no-anchor-floor: this slot was allocated before an authenticated anchor existed on " +
        `${ANCHORED_CHAIN_ID} in epoch ${epochId.slice(0, 12)}…, so its proof would carry no floor. ` +
        "Allocate a new slot once an anchor has landed (seconds, at an epoch boundary).",
    );
  }

  // Verify agency — supports single artifact and batch modes.
  // Batch mode: first digest validates fully (consumes challenge),
  // subsequent digests look up the validated batch by challenge.
  let verifiedActor: ActorIdentity | undefined;
  if (req.agency) {
    const bc = req.agency.batchContext;
    if (bc && bc.batchIndex > 0) {
      // Batch continuation: look up previously validated batch
      const challenge = req.agency.authorization.challenge;
      const batch = validatedBatches.get(challenge);
      if (!batch) {
        throw new Error("Agency: batch not found — first digest must be committed first");
      }
      if (!batch.remaining.has(digestB64)) {
        throw new Error("Agency: digest not in authorized batch");
      }
      batch.remaining.delete(digestB64);
      verifiedActor = batch.actor;
      // Clean up when all digests consumed
      if (batch.remaining.size === 0) {
        validatedBatches.delete(challenge);
        console.log(`[enclave] batch agency fully consumed: actor=${batch.actor.keyId.slice(0, 12)}...`);
      }
    } else {
      // Single artifact or first digest of a batch
      verifyAgencyEnvelope(req.agency, digestB64);
      verifiedActor = req.agency.actor;

      // If batch, store validated context for subsequent digests
      if (bc && bc.batchDigests && bc.batchDigests.length > 1) {
        const remaining = new Set(bc.batchDigests.filter((d: string) => d !== digestB64));
        validatedBatches.set(req.agency.authorization.challenge, {
          actor: req.agency.actor,
          batchDigests: bc.batchDigests,
          remaining,
          expiresAt: Date.now() + CHALLENGE_TTL_MS,
        });
        console.log(`[enclave] batch agency validated: ${bc.batchDigests.length} digests, actor=${req.agency.actor.keyId.slice(0, 12)}...`);
      }
    }
  }

  // ── BitGraph causal commit flow ──
  // The slot has been consumed. This commit is causally bound to
  // the pre-existing slot allocation.

  // Step 1: Counter (commit counter, guaranteed > slot counter) — per chain
  chain.counter += 1n;
  const counterStr = String(chain.counter);

  // Step 2: Nonce — use the slot's nonce (causal binding)
  // No new nonce generated here. The nonce was pre-allocated in the slot.

  // Compute slotHashB64: SHA-256 of canonical slot body.
  // This hash is included in the signed commit body, so the Ed25519
  // signature cryptographically binds this commit to the exact slot.
  const slotBody = {
    version: slotRecord.version,
    nonceB64: slotRecord.nonceB64,
    counter: slotRecord.counter,
    epochId: slotRecord.epochId,
    publicKeyB64: slotRecord.publicKeyB64,
    ...(slotRecord.chainId ? { chainId: slotRecord.chainId } : {}),
  };
  const slotHashB64 = Buffer.from(sha256(canonicalize(slotBody))).toString("base64");

  // Step 6: Build signed body
  const commitFields: BitGraphProof["commit"] = {
    nonceB64: slotRecord.nonceB64,  // bound to the pre-allocated slot
    counter: counterStr,
    slotCounter: slotRecord.counter, // proves slot preceded commit
    slotHashB64,                     // signed binding to exact slot record
    epochId,
  };

  // Proof chaining: include prevB64 from THIS chain's last proof
  if (chain.lastProofHashB64 !== undefined) {
    commitFields.prevB64 = chain.lastProofHashB64;
  }

  // Enclave v7: the floor fixed at allocation, and the anchor itself.
  if (slotEntry.anchorAtAllocation) {
    commitFields.slotAnchor = { ...slotEntry.anchorAtAllocation };
  }
  if (anchorMark) {
    commitFields.anchor = { blockNumber: anchorMark.blockNumber, blockHash: anchorMark.blockHash };
  }

  // Include chainId in commit fields (omit for global/default chain for backward compat)
  if (chainId !== DEFAULT_CHAIN) {
    (commitFields as Record<string, unknown>).chainId = chainId;
  }

  // Epoch lineage: inject epochLink on the FIRST proof of this chain in this epoch.
  // After injection, clear so subsequent proofs on this chain don't carry it.
  if (chain.pendingEpochLink) {
    commitFields.epochLink = chain.pendingEpochLink;
    console.log(`[enclave] epoch lineage injected: chain=${chainId} prevEpoch=${chain.pendingEpochLink.prevEpochId.slice(0, 12)}... prevCounter=${chain.pendingEpochLink.prevCounter}`);
    chain.pendingEpochLink = undefined; // single-use consumption
  }

  const signedBody: SignedBody = {
    version: "bitgraph/1",
    artifact: { hashAlg: "sha256", digestB64 },
    commit: commitFields,
    publicKeyB64,
    enforcement: "measured-tee",
    measurement,
  };

  // Include verified actor identity in the signed body
  if (verifiedActor) {
    signedBody.actor = verifiedActor;
  }

  // Include attribution in the signed body (cryptographically sealed)
  if (req.attribution) {
    const attr: Record<string, string> = {};
    if (req.attribution.name) attr.name = req.attribution.name;
    if (req.attribution.title) attr.title = req.attribution.title;
    if (req.attribution.message) attr.message = req.attribution.message;
    if (Object.keys(attr).length > 0) {
      signedBody.attribution = attr as SignedBody["attribution"];
    }
  }

  // Include policy binding in the signed body (cryptographically sealed)
  // This binds the proof to the exact policy document that governed the action.
  if (req.policy) {
    signedBody.policy = req.policy;
  }

  // A `principal` field was written into the signed body here until
  // 2026-07-29. It was removed because it was unverifiable and misleading in
  // two ways at once. The enclave signed whatever identity string the caller
  // supplied without checking anything, so it carried exactly the trust level
  // of `attribution` while looking like verified identity. And it was written
  // via a cast, so it never appeared in the SignedBody type and no verifier
  // reconstructed it: any proof carrying it failed signature verification
  // permanently. Verified identity is what `agency` is for, where a P-256 or
  // WebAuthn signature is checked before the actor is sealed. Do not add an
  // unverified identity field to the signed body.

  // ── BitGraph signing flow (attestation-correct) ──
  // 1. Add attestation format to signed body BEFORE hashing.
  //    AWS Nitro always uses "aws-nitro" — this is a known constant.
  // 2. Canonicalize the FINAL body (including attestationFormat).
  // 3. Compute SHA-256 of the final canonical bytes.
  // 4. Request NSM attestation with that hash as user_data.
  // 5. Sign the same final canonical bytes with Ed25519.
  //
  // Result: attestation.user_data == SHA-256(signedBody) == hash that
  // Ed25519 signature covers. All three bind to identical bytes.

  signedBody.attestationFormat = "aws-nitro";
  const finalCanonicalBytes = canonicalize(signedBody);
  const finalBodyHash = sha256(finalCanonicalBytes);

  const attestation = await nitroHost.getAttestation(finalBodyHash);
  const signatureBytes = await signAsync(finalCanonicalBytes, privateKey);

  // Step 10: Assemble proof
  const proof: BitGraphProof = {
    version: "bitgraph/1",
    artifact: signedBody.artifact,
    commit: signedBody.commit,
    signer: {
      publicKeyB64,
      signatureB64: Buffer.from(signatureBytes).toString("base64"),
    },
    environment: {
      enforcement: "measured-tee",
      measurement,
      attestation: {
        format: attestation.format,
        reportB64: Buffer.from(attestation.report).toString("base64"),
      },
    },
    // ── BitGraph causal evidence ──
    // Embed the full signed slot allocation record. The commit signature
    // binds to this via slotHashB64 (preventing slot swapping), and the
    // slot's own signature proves the enclave created it independently.
    slotAllocation: slotRecord,
  };

  // Include full agency envelope (independently verifiable)
  if (req.agency) {
    proof.agency = req.agency;
  }

  // Include policy binding (sealed in signed body)
  if (req.policy) {
    proof.policy = req.policy;
  }

  // Include attribution (sealed in signed body)
  if (signedBody.attribution) {
    proof.attribution = signedBody.attribution;
  }

  if (req.metadata !== undefined) {
    proof.metadata = req.metadata;
  }

  // Update THIS chain's proof state: hash this proof for the next proof's prevB64
  const proofCanonicalBytes = canonicalize(proof);
  chain.lastProofHashB64 = Buffer.from(sha256(proofCanonicalBytes)).toString("base64");

  // Enclave v7: an authenticated anchor becomes the floor for every slot
  // allocated on this chain from now on.
  if (anchorMark) {
    chain.latestAnchor = { counter: counterStr, blockNumber: anchorMark.blockNumber, blockHash: anchorMark.blockHash };
    console.log(`[enclave] anchor authenticated: chain=${chainId} counter=${counterStr} block=${anchorMark.blockNumber}`);
  }

  return proof;
}

// ---------------------------------------------------------------------------
// Per-chain epoch lineage verification
// Reused for both global and per-chain last proofs during init.
// ---------------------------------------------------------------------------

async function verifyAndLinkChain(chainId: string, lastProof: BitGraphProof): Promise<void> {
  // 1. Validate structure
  if (!lastProof.signer?.publicKeyB64 || !lastProof.signer?.signatureB64) {
    throw new Error(`FATAL: chain "${chainId}" lastProof missing signer fields — enclave HALTED`);
  }
  if (!lastProof.commit?.epochId) {
    throw new Error(`FATAL: chain "${chainId}" lastProof missing commit.epochId — enclave HALTED`);
  }
  if (!lastProof.version || lastProof.version !== "bitgraph/1") {
    throw new Error(`FATAL: chain "${chainId}" lastProof unsupported version — enclave HALTED`);
  }
  if (!lastProof.artifact?.digestB64 || !lastProof.artifact?.hashAlg) {
    throw new Error(`FATAL: chain "${chainId}" lastProof missing artifact fields — enclave HALTED`);
  }
  if (!lastProof.environment?.enforcement || !lastProof.environment?.measurement) {
    throw new Error(`FATAL: chain "${chainId}" lastProof missing environment fields — enclave HALTED`);
  }

  // 2. Reconstruct signed body and verify Ed25519 signature
  const prevSignedBody: SignedBody = {
    version: lastProof.version,
    artifact: lastProof.artifact,
    commit: lastProof.commit,
    publicKeyB64: lastProof.signer.publicKeyB64,
    enforcement: lastProof.environment.enforcement,
    measurement: lastProof.environment.measurement,
  };
  if (lastProof.environment.attestation?.format) {
    prevSignedBody.attestationFormat = lastProof.environment.attestation.format;
  }
  if (lastProof.agency?.actor) {
    prevSignedBody.actor = lastProof.agency.actor;
  }
  if (lastProof.attribution) {
    prevSignedBody.attribution = lastProof.attribution;
  }

  const prevCanonical = canonicalize(prevSignedBody);
  const prevPubKey = Buffer.from(lastProof.signer.publicKeyB64, "base64");
  const prevSig = Buffer.from(lastProof.signer.signatureB64, "base64");

  if (prevPubKey.length !== 32) {
    throw new Error(`FATAL: chain "${chainId}" lastProof signer key wrong length — enclave HALTED`);
  }
  if (prevSig.length !== 64) {
    throw new Error(`FATAL: chain "${chainId}" lastProof signature wrong length — enclave HALTED`);
  }

  const sigValid = await verifyAsync(prevSig, prevCanonical, prevPubKey);
  if (!sigValid) {
    throw new Error(`FATAL: chain "${chainId}" lastProof Ed25519 signature verification FAILED — enclave HALTED`);
  }

  // 3. Compute canonical hash of the full proof
  const prevProofHashB64 = Buffer.from(sha256(canonicalize(lastProof))).toString("base64");

  // 4. Build epochLink and set it on this chain
  const chain = getChain(chainId);
  chain.pendingEpochLink = {
    prevEpochId: lastProof.commit.epochId,
    prevPublicKeyB64: lastProof.signer.publicKeyB64,
    prevCounter: lastProof.commit.counter ?? "0",
    prevProofHashB64,
    toEpochId: epochId,
    toPublicKeyB64: publicKeyB64,
  };
}

// ---------------------------------------------------------------------------
// Request dispatcher
// ---------------------------------------------------------------------------

// The parent server (http-server.js) sends requests with { action: "key" },
// { action: "commitDigest", digestB64: "..." }, and { action: "init", lastKnownCounter: N }.
async function handleRequest(req: Record<string, unknown>): Promise<unknown> {
  const action = (req as { action?: string }).action;

  switch (action) {
    case "init": {
      // ── FAIL-CLOSED EPOCH LINEAGE ──
      //
      // If lastProof is provided, it MUST pass full cryptographic verification
      // or the enclave HALTS. No silent fallback to genesis.
      //
      // Genesis is allowed ONLY when:
      //   a) no lastProof is provided, AND
      //   b) allowGenesis === true is explicitly set
      //
      // Invariant: "If predecessor is invalid, continuation must fail."
      // Invariant: "Genesis must be explicit, never implicit."
      //
      // Counter does NOT carry over. Each epoch starts fresh.
      // The previous counter is referenced only inside epochLink.
      //
      // Disk (.bitgraph/last-proof.json) is only a transport — not a source of truth.
      // The enclave fully verifies the proof cryptographically before using it.

      const lastProof = (req as { lastProof?: BitGraphProof }).lastProof;
      const lastProofsPerChain = (req as { lastProofsPerChain?: Record<string, BitGraphProof> }).lastProofsPerChain;
      const allowGenesis = (req as { allowGenesis?: boolean }).allowGenesis === true;

      // ── PER-CHAIN EPOCH LINEAGE ──
      // If lastProofsPerChain is provided, verify each chain's last proof
      // and set up per-chain epoch links. This happens BEFORE the global
      // lastProof check (which handles the default/global chain).
      if (lastProofsPerChain) {
        for (const [cid, chainLastProof] of Object.entries(lastProofsPerChain)) {
          // Verify signature (same logic as global, extracted below)
          await verifyAndLinkChain(cid, chainLastProof);
          console.log(`[enclave] chain "${cid}" lineage verified`);
        }
      }

      if (lastProof) {
        // Global/default chain lineage — uses the shared verifyAndLinkChain function
        await verifyAndLinkChain(DEFAULT_CHAIN, lastProof);
        const globalChain = getChain(DEFAULT_CHAIN);
        console.log(`[enclave] global epoch lineage VERIFIED:`);
        console.log(`  prevEpoch  = ${globalChain.pendingEpochLink!.prevEpochId.slice(0, 16)}...`);
        console.log(`  prevCounter= ${globalChain.pendingEpochLink!.prevCounter}`);
        console.log(`  → thisEpoch= ${epochId.slice(0, 16)}...`);
      } else if (allowGenesis) {
        // ── EXPLICIT GENESIS ──
        // No predecessor — this is the first epoch in the lineage.
        console.log(`[enclave] GENESIS epoch (no predecessor, allowGenesis=true)`);
        console.log(`  epochId = ${epochId.slice(0, 16)}...`);
        // Genesis — no pending epoch links on any chain
      } else {
        // ── FAIL-CLOSED ──
        // No lastProof AND no allowGenesis flag → refuse to start.
        throw new Error(
          "FATAL: no lastProof provided and allowGenesis is not set — " +
          "enclave refuses to start without explicit genesis authorization or valid predecessor. " +
          "Pass { allowGenesis: true } to start a new chain, or provide lastProof for continuation."
        );
      }

      return { counter: "0", epochId, chains: chains.size };
    }
    case "health": {
      return {
        status: "ok",
        chains: chains.size,
        publicKeyB64,
        measurement,
        enforcement: "measured-tee",
        epochId,
      };
    }
    case "allocateSlot": {
      const slotChainId = (req as { chainId?: string }).chainId;
      return await handleAllocateSlot(slotChainId);
    }
    case "challenge": {
      return await handleChallenge();
    }
    case "key": {
      return {
        publicKeyB64,
        measurement,
        enforcement: "measured-tee",
        epochId,
      };
    }
    case "commitDigest": {
      // One slot → one artifact → one proof (BitGraph causal unit)
      const slotId = (req as { slotId: string }).slotId;
      if (!slotId) throw new Error("commitDigest requires slotId — call allocateSlot first");
      const digestB64 = (req as { digestB64: string }).digestB64;
      const agency = (req as { agency?: AgencyEnvelope }).agency;
      const attribution = (req as { attribution?: { name?: string; title?: string; message?: string } }).attribution;
      const policy = (req as { policy?: PolicyBinding }).policy;
      // Advisory, unsigned, stored verbatim on the proof, exactly as the
      // legacy "commit" action below has always done. A set (bitgraph-fuse/1,
      // placement set/1) carries its member manifest here; the manifest is
      // protected by hashing to the signed artifact digest, not by this
      // field. Dropped here until 2026-09-04, which left the ledger's copy
      // of a set proof without its manifest.
      const metadata = (req as { metadata?: Record<string, unknown> }).metadata;
      const anchor = (req as { anchor?: AnchorClaim }).anchor;
      const proof = await handleCommit({ slotId, digestB64, agency, attribution, policy, metadata, anchor });
      return { proof };
    }
    case "commit": {
      // One slot → one artifact → one proof (BitGraph causal unit)
      const slotId = (req as { slotId: string }).slotId;
      if (!slotId) throw new Error("commit requires slotId — call allocateSlot first");

      // Raw bytes mode: parent sends { action: "commit", bytesB64: "..." }
      // We SHA-256 hash the bytes to get the digest, then create the proof.
      const bytesB64 = (req as { bytesB64?: string }).bytesB64;
      if (bytesB64) {
        const rawBytes = Buffer.from(bytesB64, "base64");
        const digest = sha256(rawBytes);
        const digestB64 = Buffer.from(digest).toString("base64");
        const proof = await handleCommit({ slotId, digestB64 });
        return { proof };
      }
      // Single digest mode: { action: "commit", slotId, digestB64, agency?, attribution?, policy? }
      const digestB64 = (req as { digestB64: string }).digestB64;
      const agency = (req as { agency?: AgencyEnvelope }).agency;
      const attribution = (req as { attribution?: { name?: string; title?: string; message?: string } }).attribution;
      const policy = (req as { policy?: PolicyBinding }).policy;
      const metadata = (req as { metadata?: Record<string, unknown> }).metadata;
      const anchor = (req as { anchor?: AnchorClaim }).anchor;
      const proof = await handleCommit({ slotId, digestB64, agency, attribution, policy, metadata, anchor });
      return { proof };
    }
    // "convertBW" was removed 2026-07-29. See the pure pass-through note in
    // the file header. It is not deprecated, it is rejected: a transform in
    // the base commit path binds an artifact the caller never held.
    default:
      return { error: `Unknown action: ${String(action)}` };
  }
}

// ---------------------------------------------------------------------------
// Vsock listener (length-prefixed JSON framing)
// ---------------------------------------------------------------------------

const VSOCK_PORT = 5000;

// allowHalfOpen: keep writable side open even when readable side ends
// (socat half-closes the connection after sending the request)
const server = createServer({ allowHalfOpen: true }, (socket: Socket) => {
  let buffer = "";

  socket.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");

    // Try to parse as complete JSON after each chunk
    let request: Record<string, unknown>;
    try {
      request = JSON.parse(buffer) as Record<string, unknown>;
    } catch {
      // Not yet a complete JSON object, wait for more data
      return;
    }

    // Reset buffer (we consumed the message)
    buffer = "";

    // Process asynchronously and write response before closing
    handleRequest(request)
      .then((response) => {
        const json = JSON.stringify(response);
        socket.end(json);
      })
      .catch((err) => {
        const errResp = {
          error: `Enclave error: ${err instanceof Error ? err.message : String(err)}`,
        };
        socket.end(JSON.stringify(errResp));
      });
  });

  socket.on("error", (err) => {
    if (err.message !== "read ECONNRESET") {
      console.error("[enclave] socket error:", err.message);
    }
  });
});

// In a Nitro Enclave, there's no loopback network. We listen on a Unix
// domain socket and let socat bridge vsock:5000 → this socket.
const SOCKET_PATH = "/app/enclave.sock";
server.listen(SOCKET_PATH, () => {
  console.log(`[enclave] listening on ${SOCKET_PATH}`);
});

// Periodic cleanup — sweep expired slots, challenges, and validated batches
// every 30 seconds. The enclave is single-threaded (Node.js event loop), so
// no race conditions with request handlers. Existing opportunistic cleanup
// on each request is preserved — this catches idle-period accumulation.
setInterval(() => {
  cleanExpiredSlots();
  cleanExpiredChallenges();
}, 30_000);
