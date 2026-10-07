// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * buildBitGraphedFile for a Base-floor proof (enclave v10): bitgraph-carrier/3.
 *
 * The floor is block #52,271,417 of the harness's stand-in Base node, the one
 * the v10 enclave fixed for the fuse/3 fixtures (src/__tests__/fuse3-fixtures/,
 * saved beside them). The harness proofs carry the harness's stand-in
 * attestation, which the openssl witness cannot be laid out from, so the proof
 * here is minted with a throwaway key (no attestation) over that same block,
 * exactly as an enclave v10 signs it. A local server plays the site (the proof
 * by digest, no ceiling yet) and the Base node (eth_getBlockByNumber by
 * height). The builder must take the header by the signed height, check it
 * against the signed floor, never ask for an anchor, and state that no
 * ceiling in position exists.
 */

import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getPublicKeyAsync, signAsync } from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import {
  buildSignedBody, bytesToBase64, canonicalize, canonicalSlotBody, computeSlotCommitment3, fuseAttribution, getPlacement,
  parseCarrier, verifyCarrier, type BitGraphProof,
} from "@mikeargento/bitgraph-verify";
import { buildBitGraphedFile, completeBitGraphedFile } from "../carrier-build.js";
import { carrierWindowView, carrierLine } from "../carrier-io.js";

const fixtures = fileURLToPath(new URL("../../../../src/__tests__/fuse3-fixtures/", import.meta.url));
const harness = JSON.parse(readFileSync(join(fixtures, "trailer3.proof.json"), "utf-8")) as { commit: { slotFloor: { chain: "base"; evmChainId: 8453; blockNumber: number; blockHash: string; blockTimestamp: number } } };
const block = JSON.parse(readFileSync(join(fixtures, "floor-base-52271417.block.json"), "utf-8")) as Record<string, string>;
const header = readFileSync(join(fixtures, "floor-base-52271417.rlp.hex"), "utf-8").trim();
const slotFloor = harness.commit.slotFloor;
const FLOOR = slotFloor.blockNumber;
const b64 = (u: Uint8Array) => bytesToBase64(u);

let proof: BitGraphProof;
let bytes: Uint8Array;

/** A fuse/3 trailer file and its proof, signed over the saved Base floor block as enclave v10 signs it. */
async function mint(): Promise<void> {
  const priv = sha256(new TextEncoder().encode("carrier-v3 test key (TEST ONLY)"));
  const publicKeyB64 = b64(await getPublicKeyAsync(priv));
  const slotBody = { version: "bitgraph/slot/1" as const, nonceB64: b64(sha256(new TextEncoder().encode("nonce"))), counter: "41", epochId: b64(new Uint8Array(32).fill(7)), publicKeyB64, chainId: "bitgraph:main" };
  const slot = { ...slotBody, signatureB64: b64(await signAsync(canonicalize(slotBody as never), priv)) };
  const original = readFileSync(join(fixtures, "original.txt"));
  bytes = getPlacement("trailer/1")!.build({ original: new Uint8Array(original), commitment: computeSlotCommitment3(slot, slotFloor.blockHash) });
  const commit = { nonceB64: slot.nonceB64, counter: "43", epochId: slot.epochId, slotCounter: slot.counter, slotHashB64: b64(sha256(canonicalize(canonicalSlotBody(slot) as never))), slotFloor, chainId: "bitgraph:main" };
  const p = {
    version: "bitgraph/1", artifact: { hashAlg: "sha256", digestB64: b64(sha256(bytes)) }, commit,
    signer: { publicKeyB64, signatureB64: "" }, environment: { enforcement: "stub", measurement: "test-measurement" },
    slotAllocation: slot, attribution: fuseAttribution("trailer/1", sha256(new Uint8Array(original)), 3),
  } as unknown as BitGraphProof;
  p.signer.signatureB64 = b64(await signAsync(canonicalize(buildSignedBody(p) as never), priv));
  proof = p;
}

let server: Server;
let baseUrl = "";
const asked: string[] = [];
let nodeBlock: Record<string, string> = block;

before(async () => {
  await mint();
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      asked.push(`${req.method} ${url.pathname}${url.search}${body ? ` ${body}` : ""}`);
      const send = (status: number, payload: unknown) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (url.pathname === "/rpc") {
        const j = JSON.parse(body) as { params?: unknown[] };
        return send(200, { jsonrpc: "2.0", id: 1, result: j.params?.[0] === `0x${FLOOR.toString(16)}` ? nodeBlock : null });
      }
      if (url.pathname.startsWith("/api/proofs/digest/")) return send(200, { proofs: [{ proof }] });
      send(404, { error: "not found" });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  if (addr === null || typeof addr === "string") throw new Error("no port");
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(() => {
  server.close();
});

test("a Base-floor proof becomes a bitgraph-carrier/3 file: the header by height, checked, and no anchor asked for", async () => {
  asked.length = 0;
  nodeBlock = block;
  const built = await buildBitGraphedFile({ baseUrl }, bytes, "original.txt", { baseRpcUrl: `${baseUrl}/rpc` });
  assert.equal(built.ceiling, "none");
  assert.equal(built.ceilingInTime, "unfetched");
  assert.ok(asked.some((q) => q.startsWith("POST /rpc") && q.includes(`"0x${FLOOR.toString(16)}"`)), asked.join(" | "));
  assert.ok(!asked.some((q) => q.includes("/api/proofs/anchors") || q.includes("/api/proofs/witness")), `no anchor or Ethereum witness is asked for: ${asked.join(" | ")}`);

  const parsed = parseCarrier(built.bytes);
  assert.equal(parsed.kind, "carrier");
  if (parsed.kind !== "carrier") return;
  assert.equal(parsed.payload.carrier, "bitgraph-carrier/3");
  assert.deepEqual(parsed.payload.floor, { status: "present", basis: "base-header", header });
  assert.deepEqual(parsed.payload.ceiling, { status: "none", basis: "hash-chain" });

  // No attestation, so the verdict is not TRUE (no image is established); the floor claims are.
  const r = await verifyCarrier(built.bytes);
  for (const id of ["bytes.digest", "proof.signature", "proof.fused", "floor.binding", "floor.header"]) {
    assert.equal(r.claims.find((c) => c.id === id)?.result, "TRUE", `${id}: ${r.claims.find((c) => c.id === id)?.detail}`);
  }
  const view = carrierWindowView(r);
  assert.deepEqual(view.not_before, { chain: "base", block: FLOOR, hash: slotFloor.blockHash, time: new Date(slotFloor.blockTimestamp * 1000).toISOString() });
  assert.equal(view.not_after, null);
  assert.equal(view.ceiling, "none");
  assert.equal(view.version, 3);
  assert.equal(view.floor_time_withheld, null);
  const line = carrierLine(view);
  assert.match(line, new RegExp(`after Base block ${FLOOR}`));
  assert.match(line, /order: the chain of proof hashes \(no closing anchor exists for a Base floor\)/);
  assert.doesNotMatch(line, /NOT FETCHED \(drop/);

  // Completion fetches only the ceiling in time; it never looks for a closing anchor.
  asked.length = 0;
  const done = await completeBitGraphedFile({ baseUrl }, built.bytes);
  assert.equal(done.ceiling, "none");
  assert.equal(done.ceilingInTime, "unfetched");
  assert.ok(!asked.some((q) => q.includes("/api/proofs/anchors")), asked.join(" | "));
});

test("NEGATIVE: a Base node whose block at that height is another block: nothing is built", async () => {
  nodeBlock = { ...block, gasUsed: "0x1" };
  await assert.rejects(buildBitGraphedFile({ baseUrl }, bytes, "original.txt", { baseRpcUrl: `${baseUrl}/rpc` }), /is not the floor block the proof signs/);
  nodeBlock = block;
});

test("NEGATIVE: a caller's header that is not the signed floor is refused; the right one is used without asking a node", async () => {
  asked.length = 0;
  const wrong = header.slice(0, -2) + (header.endsWith("0") ? "1" : "0");
  await assert.rejects(buildBitGraphedFile({ baseUrl }, bytes, "original.txt", { floorHeader: wrong, baseRpcUrl: `${baseUrl}/rpc` }), /floor header: /);
  const built = await buildBitGraphedFile({ baseUrl }, bytes, "original.txt", { floorHeader: header, baseRpcUrl: `${baseUrl}/rpc` });
  assert.equal(built.ceiling, "none");
  assert.ok(!asked.some((q) => q.startsWith("POST /rpc")), "the caller's header was used");
});
