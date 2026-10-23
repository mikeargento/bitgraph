// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * BitGraph Nitro Enclave, v13: one TEE, two steps, one atomic action.
 *
 * v13 over v12 (2026-10-18 audit): no epoch lineage (epochs are independent; the host binds a Base block read as
 * each epoch's first BitGraph), no bind before init, and the signing key seeded from the NSM RNG as well.
 *
 * The enclave does one thing, bind:
 *   count N    a fresh nonce from the hardware RNG. Nobody outside sees it.
 *   count N+1  the payload, a 32-byte digest, bound at the very next count.
 * Both are signed, with the platform's attestation (which carries its own
 * signed time), and released together. If any step fails, nothing is released
 * and the counter does not move. (Once released, a proof the host then loses
 * still leaves its two counts used: a gap shows, it is not hidden.) There is no other way to make a BitGraph:
 * no held slots, no floors or anchors read in, no extra signed fields
 * (Mike, 2026-10-17: "i never want a bitgraph ever made a different way than
 * the 2 steps inside the tee"; anything else is plumbing people add on their
 * own).
 *
 * Every BitGraph is on one chain, bitgraph:main, and takes exactly two counts,
 * so the counter runs straight through: a stretch of proofs accounts for every
 * count in it.
 *
 * The proof keeps the shapes every published verifier reads: the slot record
 * (bitgraph/slot/1: nonce, count N, epoch, key, chain) embedded and hashed into
 * the commit; the commit (nonce, counter N+1, slotCounter N, slotHashB64,
 * epochId, atomic: true, prevB64, chainId). v13: no epochLink; epochs are independent.
 *
 * On boot:
 *   1. Generate an Ed25519 keypair in memory from NSM + CSPRNG randomness (never leaves the enclave)
 *   2. Generate a boot nonce (NSM GetRandom)
 *   3. epochId = SHA-256(publicKeyB64 + ":" + bootNonceB64)
 *   4. Listen for JSON requests: init, health, key, bind
 *
 * Signing flow (attestation-correct):
 *   build the complete signed body, canonicalize, SHA-256 it, request the NSM
 *   attestation with that hash as user_data, Ed25519-sign the same bytes.
 *
 * Pure pass-through: the enclave receives a digest, never bytes, and never
 * transforms an artifact.
 */

import { createServer, type Socket } from "node:net";
import { sha256 } from "@noble/hashes/sha256";
import { getPublicKeyAsync, signAsync, utils } from "@noble/ed25519";
import { canonicalize } from "bitgraph";
import type { BitGraphProof, SignedBody, SlotAllocation } from "bitgraph";

// ---------------------------------------------------------------------------
// Ed25519 keypair — generated in enclave memory, never exported
// ---------------------------------------------------------------------------

// v13 (2026-10-18 audit): the key's seed draws on the NSM hardware RNG as well as Node's CSPRNG, hashed together,
// so it never rests on the kernel's seeding alone.
let privateKey: Uint8Array;
let publicKey: Uint8Array;

// ---------------------------------------------------------------------------
// Enclave host (NitroHost: NSM for randomness, measurement and attestation)
// ---------------------------------------------------------------------------

import { NitroHost, DefaultNsmClient } from "@bitgraph/adapter-nitro";

const nsmClient = new DefaultNsmClient();
const nitroHost = new NitroHost({
  sign: (data: Uint8Array) => signAsync(data, privateKey),
  getPublicKey: async () => publicKey,
  nsmClient,
});

{
  const hw = await nitroHost.getFreshNonce();
  const sw = utils.randomPrivateKey();
  const seed = new Uint8Array(hw.length + sw.length);
  seed.set(hw, 0); seed.set(sw, hw.length);
  privateKey = sha256(seed);
}
publicKey = await getPublicKeyAsync(privateKey);
const publicKeyB64 = Buffer.from(publicKey).toString("base64");
console.log("[enclave] Ed25519 keypair generated in enclave memory (seed: NSM + CSPRNG)");
console.log(`[enclave] publicKey: ${publicKeyB64}`);

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
// ---------------------------------------------------------------------------

const bootNonceBytes = await nitroHost.getFreshNonce();
const bootNonceB64 = Buffer.from(bootNonceBytes).toString("base64");
const epochId = Buffer.from(sha256(new TextEncoder().encode(publicKeyB64 + ":" + bootNonceB64))).toString("base64");
console.log(`[enclave] epochId: ${epochId}`);

// ---------------------------------------------------------------------------
// The one chain
// ---------------------------------------------------------------------------

const CHAIN_ID = "bitgraph:main";

const chain: {
  counter: bigint;
  lastProofHashB64: string | undefined;
} = { counter: 0n, lastProofHashB64: undefined };

// v13: nothing is bound before the host has called init (it then binds the epoch's Base block read first).
let initialized = false;

// ---------------------------------------------------------------------------
// Bind — THE action: nonce at N, payload at N+1, one atomic action
// ---------------------------------------------------------------------------

async function handleBind(digestB64: unknown): Promise<BitGraphProof> {
  // Checked before anything is drawn or counted.
  if (typeof digestB64 !== "string" || Buffer.from(digestB64, "base64").length !== 32 || Buffer.from(digestB64, "base64").toString("base64") !== digestB64) {
    throw new Error("bind requires digestB64, a 32-byte SHA-256 digest in standard base64");
  }

  // Counts are local until everything has succeeded: a failure moves nothing.
  const nonceCount = chain.counter + 1n;
  const payloadCount = chain.counter + 2n;

  // Step 1: the nonce, from the hardware RNG, in its own signed record.
  const nonceB64 = Buffer.from(await nitroHost.getFreshNonce()).toString("base64");
  const slotBody = {
    version: "bitgraph/slot/1" as const,
    nonceB64,
    counter: String(nonceCount),
    epochId,
    publicKeyB64,
    chainId: CHAIN_ID,
  };
  const slotCanonical = canonicalize(slotBody);
  const slotRecord: SlotAllocation = {
    ...slotBody,
    signatureB64: Buffer.from(await signAsync(slotCanonical, privateKey)).toString("base64"),
  };
  const slotHashB64 = Buffer.from(sha256(slotCanonical)).toString("base64");

  // Step 2: the payload at the very next count, bound to that nonce.
  const commitFields: BitGraphProof["commit"] = {
    nonceB64,
    counter: String(payloadCount),
    slotCounter: String(nonceCount),
    slotHashB64,
    epochId,
    atomic: true,
  };
  if (chain.lastProofHashB64 !== undefined) commitFields.prevB64 = chain.lastProofHashB64;
  (commitFields as Record<string, unknown>).chainId = CHAIN_ID;

  const signedBody: SignedBody = {
    version: "bitgraph/1",
    artifact: { hashAlg: "sha256", digestB64 },
    commit: commitFields,
    publicKeyB64,
    enforcement: "measured-tee",
    measurement,
    attestationFormat: "aws-nitro",
  };
  const finalCanonical = canonicalize(signedBody);
  const attestation = await nitroHost.getAttestation(sha256(finalCanonical));
  const signatureB64 = Buffer.from(await signAsync(finalCanonical, privateKey)).toString("base64");

  const proof: BitGraphProof = {
    version: "bitgraph/1",
    artifact: signedBody.artifact,
    commit: signedBody.commit,
    signer: { publicKeyB64, signatureB64 },
    environment: {
      enforcement: "measured-tee",
      measurement,
      attestation: { format: attestation.format, reportB64: Buffer.from(attestation.report).toString("base64") },
    },
    slotAllocation: slotRecord,
  };

  // Everything succeeded: now the chain moves, by exactly two counts.
  chain.counter = payloadCount;
  chain.lastProofHashB64 = Buffer.from(sha256(canonicalize(proof))).toString("base64");
  return proof;
}

// ---------------------------------------------------------------------------
// Request dispatcher: init, health, key, bind. Nothing else.
// ---------------------------------------------------------------------------

async function handleRequest(req: Record<string, unknown>): Promise<unknown> {
  switch (req["action"]) {
    case "init": {
      // v13: epochs are independent (Mike, 2026-10-18: "The epochs can't link"). No predecessor is read in or
      // linked; an epoch is anchored by its first BitGraph, a Base block read the host binds. init only opens the
      // enclave for binds and reports where the counter stands (0 on a fresh epoch); calling it again is harmless.
      initialized = true;
      console.log(`[enclave] epoch ${epochId.slice(0, 16)}... open for binds at counter ${chain.counter}`);
      return { counter: String(chain.counter), epochId, chains: 1 };
    }
    case "health":
      return { status: "ok", chains: 1, publicKeyB64, measurement, enforcement: "measured-tee", epochId };
    case "key":
      // bind: "atomic" since v11; only: "bind" from v12 (nothing else, no floor read in).
      return { publicKeyB64, measurement, enforcement: "measured-tee", epochId, bind: "atomic", only: "bind" };
    case "bind":
      if (!initialized) throw new Error("not initialized: the host must call init before the first bind");
      return { proof: await handleBind(req["digestB64"]) };
    default:
      return { error: `Unknown action: ${String(req["action"])}. This enclave does one thing: bind.` };
  }
}

// ---------------------------------------------------------------------------
// Listener (one request at a time, inside the boundary)
// ---------------------------------------------------------------------------

// Handlers await (NSM, signing), and Node runs other connections' handlers
// during an await, so every request runs under this lock: each bind is atomic
// inside the boundary, not only because the parent queues its requests.
let enclaveLock: Promise<unknown> = Promise.resolve();
function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = enclaveLock.then(fn, fn);
  enclaveLock = run.catch(() => {});
  return run;
}

// allowHalfOpen: keep writable side open even when readable side ends
// (socat half-closes the connection after sending the request)
const server = createServer({ allowHalfOpen: true }, (socket: Socket) => {
  let buffer = "";
  socket.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let request: Record<string, unknown>;
    try {
      request = JSON.parse(buffer) as Record<string, unknown>;
    } catch {
      return; // not yet a complete JSON object
    }
    buffer = "";
    runExclusive(() => handleRequest(request))
      .then((response) => socket.end(JSON.stringify(response)))
      .catch((err) => socket.end(JSON.stringify({ error: `Enclave error: ${err instanceof Error ? err.message : String(err)}` })));
  });
  socket.on("error", (err) => {
    if (err.message !== "read ECONNRESET") console.error("[enclave] socket error:", err.message);
  });
});

// In a Nitro Enclave, there's no loopback network. We listen on a Unix
// domain socket and let socat bridge vsock:5000 → this socket.
const SOCKET_PATH = "/app/enclave.sock";
server.listen(SOCKET_PATH, () => {
  console.log(`[enclave] listening on ${SOCKET_PATH}`);
});
