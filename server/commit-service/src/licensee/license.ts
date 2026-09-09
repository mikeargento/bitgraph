#!/usr/bin/env node
// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * A licensee, end to end.
 *
 * BitGraph's "who" is not a certificate on somebody's trust list. It is a key
 * the licensee holds, and a proof carries that identity because the ENCLAVE
 * verified a signature from it before signing the proof at all. One shared
 * TEE, one chain, one anonymity set; the licensee is a signed field, not a
 * partition. See the note on chainId at the bottom of this file for why.
 *
 * The flow, which is the enclave's own (src/enclave/app.ts):
 *
 *   POST /challenge              enclave mints a nonce from the NSM hardware
 *                                RNG, holds it 60s, single use
 *   sign(payload)                the licensee's P-256 key signs
 *                                {purpose, actorKeyId, artifactHash,
 *                                 challenge, timestamp}
 *   POST /commit + agency        the enclave re-derives the key id from the
 *                                key, checks the artifactHash IS the digest
 *                                being committed, checks the timestamp is
 *                                within 60s, verifies the P-256 signature,
 *                                consumes the challenge, and only then writes
 *                                actor into the signed body
 *
 * What that buys, checkable offline by anyone with bitgraph-verify: this exact
 * key authorized this exact artifact, once. Not "a file that claims Adobe" but
 * "a recording Adobe's key signed for, and could not have signed earlier than
 * the enclave's nonce."
 *
 * ⚠️ DEFAULTS TO THE MOCK ENCLAVE. Against the real one, every `record` mints
 * a permanent position in an Object Lock COMPLIANCE bucket with a ten-year
 * retention: nothing recorded can be removed, by anyone, including us. `--live`
 * is deliberately awkward to type for that reason.
 */

import { createHash, createSign, generateKeyPairSync } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { sha256 } from "@noble/hashes/sha256";

/** Where the licence lives: outside the repo, one file, 0600.
 *  Override with BITGRAPH_LICENSE. */
const KEY_PATH =
  process.env["BITGRAPH_LICENSE"] ??
  "/Users/argento/Desktop/Claude Code/Keys/bitgraph-license.json";

const MOCK_BASE = "http://localhost:8787";
/** The site proxy, never the TEE directly: the proxy is what maintains the
 *  per-position by-digest index, and a proof committed around it is real but
 *  unindexed. */
const LIVE_BASE = "https://bitgraph.ing/api";

interface Licence {
  /** What the proof will say. Free text today; a published key -> licensee
   *  list is what would make it mean anything to a stranger. */
  provider: string;
  /** hex(SHA-256(SPKI DER)) — derived from the key, so it cannot be relabelled. */
  keyId: string;
  publicKeyB64: string;
  privateKeyPem: string;
}

function loadLicence(): Licence {
  try {
    return JSON.parse(readFileSync(KEY_PATH, "utf8")) as Licence;
  } catch {
    console.error(`No licence at ${KEY_PATH}\nRun:  license init "<provider name>"`);
    process.exit(1);
  }
}

function init(provider: string): void {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const der = publicKey.export({ type: "spki", format: "der" }) as Buffer;
  const licence: Licence = {
    provider,
    keyId: createHash("sha256").update(der).digest("hex"),
    publicKeyB64: der.toString("base64"),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
  mkdirSync(dirname(KEY_PATH), { recursive: true });
  writeFileSync(KEY_PATH, JSON.stringify(licence, null, 2), { mode: 0o600 });
  chmodSync(KEY_PATH, 0o600);
  // The private key is never printed. The two public halves are the licence's
  // identity and are what a registry would publish.
  console.log(`licence written  ${KEY_PATH}`);
  console.log(`provider         ${licence.provider}`);
  console.log(`keyId            ${licence.keyId}`);
  console.log(`publicKeyB64     ${licence.publicKeyB64}`);
}

async function post(base: string, path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function record(base: string, file: string, live: boolean): Promise<void> {
  const licence = loadLicence();
  const bytes = readFileSync(file);
  const digestB64 = Buffer.from(sha256(bytes)).toString("base64");

  console.log(`${live ? "LIVE" : "mock"}  ${base}`);
  console.log(`file       ${basename(file)}  (${bytes.length} bytes)`);
  console.log(`digest     ${digestB64}`);
  console.log(`provider   ${licence.provider}`);

  // 1. The enclave's nonce. Not ours: this is what stops an authorization
  //    signed at leisure from being presented as fresh.
  const { challenge } = (await post(base, "/challenge", {})) as { challenge: string };
  console.log(`challenge  ${challenge.slice(0, 24)}…`);

  // 2. The payload the licensee signs. Key order is the enclave's:
  //    JSON.stringify(payload, sortedKeys). artifactHash is what binds this
  //    authorization to ONE file; it cannot be lifted onto another.
  const timestamp = Date.now();
  const payload = {
    purpose: "bitgraph/commit-authorize/v1" as const,
    actorKeyId: licence.keyId,
    artifactHash: digestB64,
    challenge,
    timestamp,
  };
  const signer = createSign("SHA256");
  signer.update(Buffer.from(JSON.stringify(payload, Object.keys(payload).sort()), "utf8"));
  const signatureB64 = signer.sign(licence.privateKeyPem).toString("base64");

  // 3. Commit. No `format` field, so the enclave takes the DIRECT P-256 path
  //    rather than the WebAuthn one: a licensee is a server with a key, not a
  //    person with a fingerprint reader.
  const proofs = (await post(base, "/commit", {
    digests: [{ digestB64, hashAlg: "sha256" }],
    chainId: "bitgraph:main",
    agency: {
      actor: {
        keyId: licence.keyId,
        publicKeyB64: licence.publicKeyB64,
        algorithm: "ES256" as const,
        provider: licence.provider,
      },
      authorization: { ...payload, signatureB64 },
    },
  })) as Array<Record<string, unknown>>;

  const proof = (Array.isArray(proofs) ? proofs[0] : proofs) as {
    commit?: { counter?: string; epochId?: string };
    agency?: { actor?: { provider?: string; keyId?: string } };
    environment?: { enforcement?: string };
  };
  const actor = proof.agency?.actor;
  console.log(`\nposition   #${proof.commit?.counter ?? "?"}  epoch ${(proof.commit?.epochId ?? "").slice(0, 12)}…`);
  console.log(`enclave    ${proof.environment?.enforcement ?? "?"}`);
  console.log(
    actor
      ? `actor      ${actor.provider}  ${String(actor.keyId).slice(0, 16)}…`
      : `actor      MISSING — the enclave did not accept the agency envelope`
  );
  if (!actor) process.exitCode = 1;
}

// ---------------------------------------------------------------------------

const [cmd, ...rest] = process.argv.slice(2);
const live = rest.includes("--live");
const args = rest.filter((a) => a !== "--live");
const base = live ? LIVE_BASE : MOCK_BASE;

if (cmd === "init" && args[0]) {
  init(args[0]);
} else if (cmd === "record" && args[0]) {
  if (live) {
    console.log("⚠️  LIVE: this mints a permanent position in a COMPLIANCE-locked bucket.\n");
  }
  await record(base, args[0], live);
} else {
  console.error(
    [
      "usage:",
      '  license init "<provider name>"     generate the licence key (once)',
      "  license record <file>              record it as that licensee (mock enclave)",
      "  license record <file> --live       ⚠️ mints a PERMANENT ledger position",
    ].join("\n")
  );
  process.exit(1);
}

/* ── Why chainId stays "bitgraph:main" ──
 *
 * The enclave will happily keep a separate counter per chainId, and it is
 * tempting to give a licensee their own. Don't, for a hosted licence: the
 * verifier treats (signer key, epochId, chainId) as a PARTITION, and the
 * directed prevB64 walk is confined to one. The enclave's chain is a single
 * global sequence with every customer's recordings interleaved, so a
 * per-licensee chainId means each licensee's links point outside their own
 * partition — ordering falls from hash-linked to counter-order — and two
 * licensees' recordings become explicitly "unordered" even though one enclave
 * stamped consecutive counters on them. That is the partitioned ledger, minus
 * the separate hardware.
 *
 * A distinct chainId is right for exactly one case: a licensee running their
 * own enclave, with their own key, measurement, restart schedule and anchors.
 * Then two authorities really are unordered relative to each other except
 * through Ethereum, and saying so is honest.
 */
