// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * The enclave's failure paths, on the real app.ts (2026-10-22, closing the gap the patent audit found: the code said
 * "if any step fails, nothing is released and the counter does not move", and nothing proved it).
 *
 * Runs the UNMODIFIED src/enclave/app.ts as a child process the way local-enclave/run-local-enclave.mjs does: a copy
 * with exactly three patches, a software NSM that can be told to fail, an Ed25519 signer that can be told to fail,
 * and a loopback port in place of the Unix socket. Every other line, the bind, the lock, the dispatcher, is the
 * enclave's own.
 *
 * What is asserted, for a hardware-RNG failure, a signing failure and an attestation failure:
 *   - the reply carries no proof and no field of one;
 *   - the counter did not move (init reports it, and it is harmless to call again);
 *   - a nonce that was drawn before the failure never appears in anything the enclave sent;
 *   - the next bind works, takes the next two counts, and chains to the last SUCCESSFUL proof.
 * And for the lock: concurrent binds come back as consecutive, non-interleaved pairs of counts.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { connect } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256 } from "@noble/hashes/sha256";
import { canonicalize } from "bitgraph";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, "..", "app.ts");
const BUILD = join(here, "..", "..", "..", ".build-test");
const FAULT_FILE = join(BUILD, "fault.txt");
const NSM_LOG = join(BUILD, "nsm-random.log");
const PORT = 59000 + Math.floor(Math.random() * 500);

const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");
const digestOf = (s: string) => b64(sha256(new TextEncoder().encode(s)));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function patchedApp(): string {
  let code = readFileSync(SRC, "utf8");
  const patch = (anchor: string, replacement: string, label: string) => {
    const n = code.split(anchor).length - 1;
    if (n !== 1) throw new Error(`test harness: anchor for ${label} found ${n} times; app.ts changed, refresh the harness`);
    code = code.replace(anchor, replacement);
  };
  // 1. A software NSM that fails on demand and logs every random draw, so the test can prove a drawn nonce never left.
  patch(
    "const nsmClient = new DefaultNsmClient();",
    `// TEST HARNESS ONLY
import { randomBytes as __tRandom } from "node:crypto";
import { readFileSync as __tRead, appendFileSync as __tAppend } from "node:fs";
const __fault = () => { try { return __tRead(${JSON.stringify(FAULT_FILE)}, "utf8").trim(); } catch { return ""; } };
const nsmClient = {
  async request(req: Record<string, unknown>): Promise<Record<string, unknown>> {
    if ("DescribePCR" in req) return { DescribePCR: { lock: true, data: new Uint8Array(48).fill(0xab) } };
    if ("GetRandom" in req) {
      if (__fault() === "rng") throw new Error("fault: NSM GetRandom");
      const random = new Uint8Array(__tRandom(256));
      __tAppend(${JSON.stringify(NSM_LOG)}, Buffer.from(random.subarray(0, 32)).toString("base64") + "\\n");
      return { GetRandom: { random } };
    }
    if ("Attestation" in req) {
      if (__fault() === "attest") throw new Error("fault: NSM Attestation");
      const ud = (req["Attestation"] as { user_data?: Uint8Array }).user_data ?? new Uint8Array();
      return { Attestation: { document: new TextEncoder().encode("TEST-ATTESTATION:" + Buffer.from(ud).toString("hex")) } };
    }
    throw new Error("test NSM: unsupported request " + JSON.stringify(Object.keys(req)));
  },
};`,
    "nsm client",
  );
  // 2. A signer that fails on demand (the key stays the enclave's own).
  patch(
    'import { getPublicKeyAsync, signAsync, utils } from "@noble/ed25519";',
    `import { getPublicKeyAsync, signAsync as __tSign, utils } from "@noble/ed25519";
const signAsync = async (m: Uint8Array, k: Uint8Array) => { if (__fault() === "sign") throw new Error("fault: sign"); return __tSign(m, k); };`,
    "signer",
  );
  // 3. Loopback TCP instead of the Unix socket.
  patch(
    'server.listen(SOCKET_PATH, () => {\n  console.log(`[enclave] listening on ${SOCKET_PATH}`);\n});',
    `server.listen(${PORT}, "127.0.0.1", () => { console.log("[enclave] TEST HARNESS listening on 127.0.0.1:${PORT} (instead of " + SOCKET_PATH + ")"); });`,
    "listen",
  );
  return code;
}

/** One request, one reply, the way socat presents them to the enclave (half-close after the request). */
function ask(req: Record<string, unknown>): Promise<{ raw: string; json: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const sock = connect(PORT, "127.0.0.1");
    let out = "";
    sock.on("connect", () => sock.end(JSON.stringify(req)));
    sock.on("data", (c) => { out += c.toString("utf8"); });
    sock.on("end", () => { try { resolve({ raw: out, json: JSON.parse(out) }); } catch (e) { reject(e); } });
    sock.on("error", reject);
  });
}
const setFault = (f: "" | "rng" | "sign" | "attest") => writeFileSync(FAULT_FILE, f);
const drawn = () => readFileSync(NSM_LOG, "utf8").split("\n").filter(Boolean);
const counter = async () => String((await ask({ action: "init" })).json["counter"]);
const chainHash = (proof: unknown) => b64(sha256(canonicalize(proof as Record<string, unknown>)));

let child: ChildProcess;
let stderr = "";

before(async () => {
  mkdirSync(BUILD, { recursive: true });
  writeFileSync(join(BUILD, "app.test.ts"), patchedApp());
  setFault("");
  writeFileSync(NSM_LOG, "");
  child = spawn(process.execPath, ["--import", "tsx/esm", join(BUILD, "app.test.ts")], { stdio: ["ignore", "pipe", "pipe"] });
  child.stdout!.on("data", (c) => { stderr += c.toString(); });
  child.stderr!.on("data", (c) => { stderr += c.toString(); });
  for (let i = 0; i < 200; i++) {
    if (stderr.includes("TEST HARNESS listening")) return;
    if (child.exitCode !== null) throw new Error("enclave exited:\n" + stderr);
    await sleep(100);
  }
  throw new Error("enclave did not start:\n" + stderr);
});
after(() => { child?.kill("SIGTERM"); rmSync(BUILD, { recursive: true, force: true }); });

test("a bind takes two counts and nothing else does", async () => {
  assert.equal(await counter(), "0");
  const r = await ask({ action: "bind", digestB64: digestOf("first") });
  const proof = r.json["proof"] as Record<string, Record<string, unknown>>;
  assert.ok(proof, "a proof came back");
  assert.equal(proof["commit"]["slotCounter"], "1");
  assert.equal(proof["commit"]["counter"], "2");
  assert.equal(proof["commit"]["atomic"], true);
  assert.equal(await counter(), "2");
});

for (const fault of ["rng", "sign", "attest"] as const) {
  test(`a ${fault} failure releases nothing, moves nothing, and the next bind chains past it`, async () => {
    const before = await counter();
    const lastGood = (await ask({ action: "bind", digestB64: digestOf(`good before ${fault}`) })).json["proof"];
    const afterGood = await counter();
    assert.equal(BigInt(afterGood), BigInt(before) + 2n);
    const drawnBefore = drawn().length;

    setFault(fault);
    const failed = await ask({ action: "bind", digestB64: digestOf(`fails on ${fault}`) });
    setFault("");

    // Nothing released: an error line, no proof, no field of a proof.
    assert.ok(typeof failed.json["error"] === "string" && failed.json["error"].includes("fault"), `an error came back: ${failed.raw}`);
    assert.equal(failed.json["proof"], undefined);
    for (const k of ["nonceB64", "slotAllocation", "signatureB64", "commit", "artifact"]) assert.ok(!failed.raw.includes(k), `reply carries no ${k}`);

    // A nonce drawn before the failure (sign and attest fail after the draw) never left the enclave.
    const drawnDuring = drawn().slice(drawnBefore);
    if (fault === "rng") assert.equal(drawnDuring.length, 0, "the RNG failure drew nothing");
    else assert.equal(drawnDuring.length, 1, "one nonce was drawn before the failure");
    for (const n of drawnDuring) assert.ok(!failed.raw.includes(n), "the drawn nonce is not in the reply");

    // The counter did not move.
    assert.equal(await counter(), afterGood);

    // The next bind works, takes the next two counts, chains to the last successful proof, and uses a fresh nonce.
    const next = (await ask({ action: "bind", digestB64: digestOf(`after ${fault}`) })).json["proof"] as Record<string, Record<string, unknown>>;
    assert.ok(next, "the enclave binds again");
    assert.equal(next["commit"]["slotCounter"], String(BigInt(afterGood) + 1n));
    assert.equal(next["commit"]["counter"], String(BigInt(afterGood) + 2n));
    assert.equal(next["commit"]["prevB64"], chainHash(lastGood), "prevB64 is the hash of the last successful proof, not of anything that failed");
    for (const n of drawnDuring) assert.notEqual(next["commit"]["nonceB64"], n, "a nonce from a failed attempt is never reused");
    assert.equal(await counter(), String(BigInt(afterGood) + 2n));
  });
}

test("concurrent binds never interleave: every proof holds a consecutive pair of counts, and the pairs chain", async () => {
  const start = BigInt(await counter());
  const replies = await Promise.all([1, 2, 3, 4, 5].map((i) => ask({ action: "bind", digestB64: digestOf(`concurrent ${i}`) })));
  const proofs = replies.map((r) => r.json["proof"] as Record<string, Record<string, unknown>>);
  for (const p of proofs) {
    assert.ok(p, "every concurrent bind got a proof");
    assert.equal(BigInt(p["commit"]["counter"] as string), BigInt(p["commit"]["slotCounter"] as string) + 1n, "N and N+1 in one proof");
  }
  const sorted = [...proofs].sort((a, b) => Number(BigInt(a["commit"]["counter"] as string) - BigInt(b["commit"]["counter"] as string)));
  for (let i = 0; i < sorted.length; i++) {
    assert.equal(sorted[i]!["commit"]["slotCounter"], String(start + 1n + BigInt(2 * i)), "pairs are adjacent, nothing between them");
    if (i > 0) assert.equal(sorted[i]!["commit"]["prevB64"], chainHash(sorted[i - 1]), "each chains to the one before");
  }
  assert.equal(await counter(), String(start + 10n));
});
