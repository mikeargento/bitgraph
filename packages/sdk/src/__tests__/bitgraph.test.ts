// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * The SDK end to end: the BitGraph class, the localhost daemon and the CLI,
 * against a mock boundary and REAL carriers built from the verify package's
 * fixture material. No ledger writes ever happen here: the mint pipelines
 * are injected fakes that fail the test if carrier bytes ever reach them,
 * and the mock boundary answers reads only.
 */

import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { writeFile, mkdtemp } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCarrier, computeSlotCommitment, bytesToBase64, type CarrierPayload, type CarrierProof, type CarrierWitness } from "@mikeargento/bitgraph-verify";
import { BitGraph } from "../bitgraph.js";
import { serve } from "../serve.js";
import { toUrlSafeB64 } from "../encoding.js";
import type { FuseFileFn, FuseSetFn } from "../pipelines.js";

const fixtures = fileURLToPath(new URL("../../../verify/src/__tests__/fixtures/carrier/", import.meta.url));
const readJson = <T>(name: string): T => JSON.parse(readFileSync(join(fixtures, name), "utf-8")) as T;
const cliPath = fileURLToPath(new URL("../cli.js", import.meta.url));

let mock: Server;
let baseUrl = "";
let root = "";
let freshA = ""; // will mint solo
let freshB = ""; // with A, will mint as a set
let knownPath = ""; // already on record per the mock
let carrierComplete = ""; // demo2 with floor + ceiling inside
let carrierForeign = ""; // demo1, floor only, unknown to the mock ledger
let innerDigest2 = "";
let innerDigest1 = "";
let knownDigest = "";
const EPOCH = createHash("sha256").update("sdk-epoch").digest("base64");

// A shaped (unsigned) slot record: computeSlotCommitment reads fields, it does not verify.
const SLOT = {
  version: "bitgraph/slot/1" as const,
  nonceB64: createHash("sha256").update("nonce").digest("base64"),
  counter: "41",
  epochId: EPOCH,
  publicKeyB64: createHash("sha256").update("pk").digest("base64"),
  chainId: "bitgraph:main",
  signatureB64: Buffer.alloc(64, 7).toString("base64"),
};

before(async () => {
  root = await mkdtemp(join(tmpdir(), "bitgraph-sdk-"));
  freshA = join(root, "a.txt");
  freshB = join(root, "b.txt");
  knownPath = join(root, "known.txt");
  await writeFile(freshA, "alpha bytes");
  await writeFile(freshB, "beta bytes");
  await writeFile(knownPath, "gamma bytes");
  knownDigest = createHash("sha256").update("gamma bytes").digest("base64");

  const demo2 = new Uint8Array(readFileSync(join(fixtures, "demo2.txt")));
  const demo1 = new Uint8Array(readFileSync(join(fixtures, "demo1.txt")));
  innerDigest2 = createHash("sha256").update(demo2).digest("base64");
  innerDigest1 = createHash("sha256").update(demo1).digest("base64");
  const complete: CarrierPayload = {
    carrier: "bitgraph-carrier/1",
    proof: readJson<CarrierProof>("demo2.proof.json"),
    floor: { status: "present", anchor: readJson<CarrierProof>("floor2.anchor.json"), witness: readJson<CarrierWitness>("floor2.witness.json") },
    ceiling: { status: "present", basis: "counter-order", anchor: readJson<CarrierProof>("ceiling2.anchor.json"), witness: readJson<CarrierWitness>("ceiling2.witness.json") },
  };
  const foreign: CarrierPayload = {
    carrier: "bitgraph-carrier/1",
    proof: readJson<CarrierProof>("demo1.proof.json"),
    floor: { status: "present", anchor: readJson<CarrierProof>("floor1.anchor.json"), witness: readJson<CarrierWitness>("floor1.witness.json") },
    ceiling: { status: "unfetched" },
  };
  carrierComplete = join(root, "photo.bitgraph.txt");
  await writeFile(carrierComplete, buildCarrier(demo2, complete));
  carrierForeign = join(root, "doc.bitgraph.txt");
  await writeFile(carrierForeign, buildCarrier(demo1, foreign));

  mock = createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const body = raw.length > 0 ? (JSON.parse(raw) as unknown) : null;
      const send = (status: number, payload: unknown) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (url.pathname === "/api/proofs/batch") {
        const digests = (body as { digests: string[] }).digests;
        const results: Record<string, { proofs: unknown[] }> = {};
        for (const d of digests) {
          if (d === toUrlSafeB64(knownDigest)) results[d] = { proofs: [{ proof: { artifact: { digestB64: knownDigest }, commit: { counter: "7", epochId: EPOCH } } }] };
          else if (d === toUrlSafeB64(innerDigest2)) results[d] = { proofs: [{ proof: { artifact: { digestB64: innerDigest2 }, commit: { counter: "2874", epochId: EPOCH } } }] };
          else results[d] = { proofs: [] };
        }
        send(200, { results });
      } else if (url.pathname.startsWith("/api/proofs/digest/")) {
        const digest = decodeURIComponent(url.pathname.split("/").pop() ?? "");
        if (digest === toUrlSafeB64(innerDigest2)) {
          send(200, { proofs: [{ proof: { artifact: { digestB64: innerDigest2 }, commit: { counter: "2874", epochId: EPOCH } } }], positions: [], causalWindow: null });
        } else {
          send(200, { proofs: [] });
        }
      } else if (url.pathname === "/api/fuse/allocate") {
        send(200, { slot: SLOT });
      } else if (url.pathname.startsWith("/api/proofs/anchors")) {
        send(200, { anchors: [], bound: { state: "idle" } });
      } else {
        send(404, { error: `unexpected ${url.pathname}` });
      }
    });
  });
  await new Promise<void>((resolve) => mock.listen(0, "127.0.0.1", resolve));
  const addr = mock.address();
  if (addr === null || typeof addr === "string") throw new Error("no port");
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(() => {
  mock.close();
});

const fusedNames: string[] = [];
const guardFuseFile: FuseFileFn = async (file) => {
  assert.ok(!file.name.includes(".bitgraph."), `carrier bytes reached the mint: ${file.name}`);
  fusedNames.push(file.name);
  const artifactDigestB64 = createHash("sha256").update("fused:" + file.digestB64).digest("base64");
  return {
    proof: { version: "bitgraph/1", artifact: { digestB64: artifactDigestB64 }, commit: { counter: "101", epochId: EPOCH } },
    frame: { type: "bitgraph-fuse/1" },
    placement: file.placement,
    artifactDigestB64,
    originDigestB64: file.digestB64,
  };
};
const guardFuseSet: FuseSetFn = async (files, _config, opts) => {
  for (const f of files) assert.ok(!f.name.includes(".bitgraph."), `carrier bytes reached the set mint: ${f.name}`);
  fusedNames.push(...files.map((f) => f.name));
  const rows = files.map((f, index) => ({
    index,
    manifestIndex: index,
    placement: f.placement,
    originDigestB64: f.digestB64,
    artifactDigestB64: createHash("sha256").update("fused:" + f.digestB64).digest("base64"),
  }));
  const setDigest = createHash("sha256").update("set:" + rows.map((r) => r.artifactDigestB64).join(",")).digest("base64");
  return {
    set: opts.set,
    proof: { version: "bitgraph/1", artifact: { digestB64: setDigest }, commit: { counter: "202", epochId: EPOCH } },
    artifactDigestB64: setDigest,
    count: files.length,
    manifestEchoed: true,
    recovered: false,
    members: rows,
  };
};

const sdk = () => new BitGraph({ baseUrl, pipelines: { fuseFile: guardFuseFile, fuseSet: guardFuseSet } });

test("record: one fresh file mints solo; a known file is left alone; carriers never mint", async () => {
  fusedNames.length = 0;
  const r = await sdk().record([freshA, knownPath, carrierComplete, carrierForeign]);
  assert.deepEqual(fusedNames, ["a.txt"]);
  assert.equal(r.made?.kind, "solo");
  const byPath = new Map(r.files.map((f) => [f.path, f]));
  assert.equal(byPath.get(freshA)?.outcome, "recorded");
  assert.equal(byPath.get(knownPath)?.outcome, "on record");
  assert.equal(byPath.get(knownPath)?.counter, "7");
  const complete = byPath.get(carrierComplete);
  assert.equal(complete?.outcome, "on record", "a ledger-known carrier reports as on record");
  assert.equal(complete?.digest, toUrlSafeB64(innerDigest2), "looked up by the committed bytes, never the envelope");
  assert.equal(complete?.carrier?.verdict, "TRUE");
  const foreign = byPath.get(carrierForeign);
  assert.equal(foreign?.outcome, "carried");
  assert.equal(foreign?.carrier?.ceiling, "unfetched");
});

test("record: two fresh files become one set with member rows", async () => {
  fusedNames.length = 0;
  const r = await sdk().record([freshA, freshB]);
  assert.equal(r.made?.kind, "set");
  assert.equal(r.made?.kind === "set" ? r.made.count : 0, 2);
  assert.deepEqual(new Set(fusedNames), new Set(["a.txt", "b.txt"]));
  const members = r.files.filter((f) => f.outcome === "recorded");
  assert.equal(members.length, 2);
  assert.ok(members.every((m) => m.member !== null && m.memberCount === 2));
});

test("check: paths, digests and carriers, with the carrier judged offline", async () => {
  const results = await sdk().check([knownPath, toUrlSafeB64(knownDigest), carrierForeign]);
  assert.equal(results.length, 3);
  assert.equal(results[0]?.onRecord, true);
  assert.equal(results[1]?.onRecord, true, "a raw digest checks the same");
  assert.equal(results[2]?.onRecord, false);
  assert.equal(results[2]?.carrier?.verdict, "TRUE");
});

test("proof: a carrier path resolves through the committed bytes", async () => {
  const detail = await sdk().proof({ path: carrierComplete });
  assert.equal(detail.proofs[0]?.proof.commit?.counter, "2874");
  assert.equal(detail.carrier?.verdict, "TRUE");
});

test("verify: a BitGraphed file needs nothing else; plain bytes need their proof", async () => {
  const v = await sdk().verify(carrierComplete);
  assert.equal(v.verdict, "TRUE");
  assert.equal(v.carrier, "ok");
  assert.ok(v.bounds?.not_after !== null);
  const plain = await sdk().verify(freshA);
  assert.equal(plain.verdict, "UNDETERMINED");
  assert.match(plain.reasons.join(" "), /pass the proof/);
});

test("open: the slot's commitment matches the slot record, and sealing refuses bytes without it", async () => {
  const slot = await sdk().open();
  assert.equal(slot.slotCounter, "41");
  assert.equal(slot.commitmentB64, bytesToBase64(computeSlotCommitment(SLOT)));
  assert.equal(slot.ttlSeconds, 120);
  await assert.rejects(
    () => slot.seal(new TextEncoder().encode("a task that forgot the commitment")),
    /do not contain the commitment/,
    "a task without the commitment is refused before the slot is spent"
  );
});

test("serve: the localhost daemon answers the map and the verbs", async () => {
  const running = await serve({ port: 0, bitgraph: sdk() });
  try {
    const map = (await (await fetch(`http://127.0.0.1:${running.port}/`)).json()) as { verbs: string[] };
    assert.ok(map.verbs.includes("record"));
    const res = await fetch(`http://127.0.0.1:${running.port}/check`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paths: [carrierForeign], digests: [toUrlSafeB64(knownDigest)] }),
    });
    assert.equal(res.status, 200);
    const rows = (await res.json()) as Array<{ input: string; onRecord: boolean; carrier?: { verdict: string } }>;
    assert.equal(rows.length, 2);
    const byInput = new Map(rows.map((r) => [r.input, r]));
    assert.equal(byInput.get(carrierForeign)?.carrier?.verdict, "TRUE");
    assert.equal(byInput.get(toUrlSafeB64(knownDigest))?.onRecord, true);
    const bad = await fetch(`http://127.0.0.1:${running.port}/nope`, { method: "POST", body: "{}" });
    assert.equal(bad.status, 404);
  } finally {
    await running.close();
  }
});

test("cli: check --json speaks parseable JSON and exits 0", async () => {
  const { stdout, code } = await run([cliPath, "check", knownPath, "--json"], { BITGRAPH_API_URL: baseUrl });
  assert.equal(code, 0, stdout);
  const rows = JSON.parse(stdout) as Array<{ onRecord: boolean }>;
  assert.equal(rows[0]?.onRecord, true);
});

test("cli: verify exits 0 on TRUE and prints the window in position words", async () => {
  const { stdout, code } = await run([cliPath, "verify", carrierComplete], { BITGRAPH_API_URL: baseUrl });
  assert.equal(code, 0, stdout);
  assert.match(stdout, /TRUE/);
  assert.match(stdout, /before the anchoring of block/);
});

function run(argv: string[], env: Record<string, string>): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, argv, { env: { ...process.env, ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, stderr, code: code ?? -1 }));
  });
}
