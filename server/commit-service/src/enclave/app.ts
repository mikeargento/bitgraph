// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * BitGraph Nitro Enclave, v12: one TEE, two steps, one atomic action.
 *
 * The enclave does one thing, bind:
 *   count N    a fresh nonce from the hardware RNG. Nobody outside sees it.
 *   count N+1  the payload, a 32-byte digest, bound at the very next count.
 * Both are signed, with the platform's attestation (which carries its own
 * signed time), and released together. If any step fails, nothing is released
 * and the counter does not move. There is no other way to make a BitGraph:
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
 * epochId, atomic: true, prevB64, chainId, epochLink on an epoch's first).
 *
 * On boot:
 *   1. Generate an Ed25519 keypair in memory (never leaves the enclave)
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
import { getPublicKeyAsync, signAsync, verifyAsync, utils } from "@noble/ed25519";
import { canonicalize } from "bitgraph";
import type { BitGraphProof, SignedBody, SlotAllocation } from "bitgraph";

// ---------------------------------------------------------------------------
// Ed25519 keypair — generated in enclave memory, never exported
// ---------------------------------------------------------------------------

const privateKey = utils.randomPrivateKey();
const publicKey = await getPublicKeyAsync(privateKey);
const publicKeyB64 = Buffer.from(publicKey).toString("base64");

console.log("[enclave] Ed25519 keypair generated in enclave memory");
console.log(`[enclave] publicKey: ${publicKeyB64}`);

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
  pendingEpochLink: BitGraphProof["commit"]["epochLink"] | undefined;
} = { counter: 0n, lastProofHashB64: undefined, pendingEpochLink: undefined };

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
  if (chain.pendingEpochLink) commitFields.epochLink = chain.pendingEpochLink;

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
  chain.pendingEpochLink = undefined;
  return proof;
}

// ---------------------------------------------------------------------------
// Epoch lineage (init): a previous epoch's last proof, verified before use
// ---------------------------------------------------------------------------

async function verifyAndLink(lastProof: BitGraphProof): Promise<void> {
  if (!lastProof.signer?.publicKeyB64 || !lastProof.signer?.signatureB64) throw new Error("FATAL: lastProof missing signer fields — enclave HALTED");
  if (!lastProof.commit?.epochId) throw new Error("FATAL: lastProof missing commit.epochId — enclave HALTED");
  if (lastProof.version !== "bitgraph/1") throw new Error("FATAL: lastProof unsupported version — enclave HALTED");
  if (!lastProof.artifact?.digestB64 || !lastProof.artifact?.hashAlg) throw new Error("FATAL: lastProof missing artifact fields — enclave HALTED");
  if (!lastProof.environment?.enforcement || !lastProof.environment?.measurement) throw new Error("FATAL: lastProof missing environment fields — enclave HALTED");

  const prevSignedBody: SignedBody = {
    version: lastProof.version,
    artifact: lastProof.artifact,
    commit: lastProof.commit,
    publicKeyB64: lastProof.signer.publicKeyB64,
    enforcement: lastProof.environment.enforcement,
    measurement: lastProof.environment.measurement,
  };
  if (lastProof.environment.attestation?.format) prevSignedBody.attestationFormat = lastProof.environment.attestation.format;
  if (lastProof.agency?.actor) prevSignedBody.actor = lastProof.agency.actor;
  if (lastProof.attribution) prevSignedBody.attribution = lastProof.attribution;
  if (lastProof.policy) prevSignedBody.policy = lastProof.policy;

  const prevPubKey = Buffer.from(lastProof.signer.publicKeyB64, "base64");
  const prevSig = Buffer.from(lastProof.signer.signatureB64, "base64");
  if (prevPubKey.length !== 32) throw new Error("FATAL: lastProof signer key wrong length — enclave HALTED");
  if (prevSig.length !== 64) throw new Error("FATAL: lastProof signature wrong length — enclave HALTED");
  if (!(await verifyAsync(prevSig, canonicalize(prevSignedBody), prevPubKey))) {
    throw new Error("FATAL: lastProof Ed25519 signature verification FAILED — enclave HALTED");
  }

  chain.pendingEpochLink = {
    prevEpochId: lastProof.commit.epochId,
    prevPublicKeyB64: lastProof.signer.publicKeyB64,
    prevCounter: lastProof.commit.counter ?? "0",
    prevProofHashB64: Buffer.from(sha256(canonicalize(lastProof))).toString("base64"),
    toEpochId: epochId,
    toPublicKeyB64: publicKeyB64,
  };
}

// ---------------------------------------------------------------------------
// Request dispatcher: init, health, key, bind. Nothing else.
// ---------------------------------------------------------------------------

async function handleRequest(req: Record<string, unknown>): Promise<unknown> {
  switch (req["action"]) {
    case "init": {
      // Fail-closed lineage: a predecessor must verify, or genesis must be explicit.
      const lastProof = req["lastProof"] as BitGraphProof | undefined;
      if (lastProof) {
        await verifyAndLink(lastProof);
        console.log(`[enclave] epoch lineage VERIFIED from ${lastProof.commit.epochId!.slice(0, 16)}...`);
      } else if (req["allowGenesis"] === true) {
        console.log(`[enclave] GENESIS epoch ${epochId.slice(0, 16)}...`);
      } else {
        throw new Error("FATAL: no lastProof provided and allowGenesis is not set — enclave refuses to start without explicit genesis or a valid predecessor.");
      }
      return { counter: String(chain.counter), epochId, chains: 1 };
    }
    case "health":
      return { status: "ok", chains: 1, publicKeyB64, measurement, enforcement: "measured-tee", epochId };
    case "key":
      // bind: "atomic" since v11; only: "bind" from v12 (nothing else, no floor read in).
      return { publicKeyB64, measurement, enforcement: "measured-tee", epochId, bind: "atomic", only: "bind" };
    case "bind":
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
