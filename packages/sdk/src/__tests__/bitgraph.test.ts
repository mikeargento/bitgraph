// Copyright (c) 2025-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * The SDK's read verbs end to end: the BitGraph class, the localhost daemon
 * and the CLI, against a mock site and REAL carriers built from the verify
 * package's fixture material. The mock answers reads only; nothing is ever
 * made here (record has its own tests, record.test.ts).
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
import { buildCarrier, type CarrierPayload, type CarrierProof, type CarrierWitness } from "@mikeargento/bitgraph-verify";
import { BitGraph } from "../bitgraph.js";
import { serve } from "../serve.js";
import { toUrlSafeB64 } from "../encoding.js";

const fixtures = fileURLToPath(new URL("../../../verify/src/__tests__/fixtures/carrier/", import.meta.url));
const readJson = <T>(name: string): T => JSON.parse(readFileSync(join(fixtures, name), "utf-8")) as T;
const cliPath = fileURLToPath(new URL("../cli.js", import.meta.url));

let mock: Server;
let baseUrl = "";
let root = "";
let freshA = ""; // plain bytes, no proof
let knownPath = ""; // already on record per the mock
let carrierComplete = ""; // demo2 with floor + ceiling inside
let carrierForeign = ""; // demo1, floor only, unknown to the mock ledger
let innerDigest2 = "";
let innerDigest1 = "";
let knownDigest = "";
const EPOCH = createHash("sha256").update("sdk-epoch").digest("base64");

before(async () => {
  root = await mkdtemp(join(tmpdir(), "bitgraph-sdk-"));
  freshA = join(root, "a.txt");
  knownPath = join(root, "known.txt");
  await writeFile(freshA, "alpha bytes");
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

  const recoveryEntries = new Map<string, string>();
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
      } else if (url.pathname.startsWith("/api/proofs/") && req.method === "GET" && !url.pathname.startsWith("/api/proofs/digest/") && url.pathname !== "/api/proofs/batch") {
        send(200, { proofs: [] });
      } else if (url.pathname === "/api/recovery" && req.method === "POST") {
        // The site's recovery store in memory: create-only, the stored envelope back on "exists".
        const results = ((body as { entries: Array<{ key: string; envelope: string }> }).entries).map(({ key, envelope }) => {
          const held = recoveryEntries.get(key);
          if (held !== undefined) return { key, status: "exists", envelope: held };
          recoveryEntries.set(key, envelope);
          return { key, status: "created" };
        });
        send(200, { results });
      } else if (url.pathname === "/api/recovery/lookup" && req.method === "POST") {
        const results = ((body as { addresses: string[] }).addresses).map((address) => ({
          address,
          entries: [...recoveryEntries.entries()].filter(([k]) => k.startsWith(`recovery/v1/${address}/`)).sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, envelope]) => ({ key, envelope })),
          next: null,
        }));
        send(200, { results });
      } else if (url.pathname.startsWith("/api/recovery/")) {
        const address = url.pathname.slice("/api/recovery/".length);
        const entries = [...recoveryEntries.entries()].filter(([k]) => k.startsWith(`recovery/v1/${address}/`)).sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, envelope]) => ({ key, envelope }));
        send(200, { address, entries, next: null });
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

const sdk = () => new BitGraph({ baseUrl });

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
  assert.equal(v.view?.verdict, "TRUE");
  const plain = await sdk().verify(freshA);
  assert.equal(plain.verdict, "UNDETERMINED");
  assert.match(plain.reasons.join(" "), /pass the proof/);
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

test("cli: verify exits 0 on TRUE and prints the carried verdict", async () => {
  const { stdout, code } = await run([cliPath, "verify", carrierComplete], { BITGRAPH_API_URL: baseUrl });
  assert.equal(code, 0, stdout);
  assert.match(stdout, /TRUE/);
  assert.match(stdout, /carried proof TRUE/);
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
