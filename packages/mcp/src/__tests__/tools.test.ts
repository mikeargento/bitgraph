// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * End-to-end tool tests: a real MCP client drives the real server over an
 * in-memory transport, against a mock bitgraph.ing that asserts the exact
 * wire shapes. No real ledger writes ever happen here.
 */

import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer, type FusedSummary } from "../server.js";
import { toUrlSafeB64 } from "../encoding.js";

interface Recorded {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

const requests: Recorded[] = [];
let mock: Server;
let fileA = "";
let fileB = "";
let fileC = "";
let digestA = ""; // standard b64 of fileA bytes
let digestB = "";
const EPOCH = createHash("sha256").update("test-epoch").digest("base64");
let mintCounter = 100;

function proofFor(digestB64: string): Record<string, unknown> {
  mintCounter += 2; // slot consumes one position, commit lands on the next
  return {
    version: "bitgraph/1",
    artifact: { hashAlg: "sha256", digestB64 },
    commit: { counter: String(mintCounter), epochId: EPOCH },
    signer: { publicKeyB64: "pk", signatureB64: "sig" },
    environment: { enforcement: "measured-tee", measurement: "m" },
  };
}

before(async () => {
  const dir = await mkdtemp(join(tmpdir(), "bitgraph-mcp-e2e-"));
  fileA = join(dir, "a.txt");
  fileB = join(dir, "b.txt");
  fileC = join(dir, "c.txt");
  await writeFile(fileA, "alpha bytes");
  await writeFile(fileB, "beta bytes");
  await writeFile(fileC, "gamma bytes");
  digestA = createHash("sha256").update("alpha bytes").digest("base64");
  digestB = createHash("sha256").update("beta bytes").digest("base64");

  mock = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const body = raw.length > 0 ? JSON.parse(raw) : undefined;
      const url = new URL(req.url ?? "/", "http://localhost");
      requests.push({ method: req.method ?? "", path: url.pathname + url.search, headers: req.headers, body });

      const send = (status: number, payload: unknown) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };

      if (url.pathname === "/api/proofs/batch") {
        // fileA is already on record (two positions); fileB is not.
        const digests = (body as { digests: string[] }).digests;
        const results: Record<string, { proofs: Array<{ proof: unknown }> }> = {};
        for (const d of digests) {
          if (d === toUrlSafeB64(digestA)) {
            results[d] = {
              proofs: [
                { proof: { artifact: { digestB64: digestA }, commit: { counter: "10", epochId: EPOCH } } },
                { proof: { artifact: { digestB64: digestA }, commit: { counter: "55", epochId: EPOCH } } },
              ],
            };
          } else {
            results[d] = { proofs: [] };
          }
        }
        send(200, { results });
      } else if (url.pathname === "/api/commit") {
        // Ordinary recording is no longer what the record tool does; nothing here should call it.
        send(500, { error: "unexpected /api/commit" });
      } else if (url.pathname.startsWith("/api/proofs/digest/")) {
        const digest = decodeURIComponent(url.pathname.split("/").pop() ?? "");
        if (digest === toUrlSafeB64(digestA)) {
          send(200, {
            proofs: [{ proof: { artifact: { digestB64: digestA }, commit: { counter: "10", epochId: EPOCH } } }],
            positions: [
              { counter: "10", epoch: toUrlSafeB64(EPOCH), lowerTime: "2026-07-01T00:00:00.000Z", upperTime: "2026-07-01T00:00:12.000Z" },
              { counter: "55", epoch: toUrlSafeB64(EPOCH), lowerTime: null, upperTime: null },
            ],
            causalWindow: {
              anchorBefore: { blockTime: "2026-07-01T00:00:00.000Z", blockNumber: 1 },
              anchorAfter: { blockTime: "2026-07-01T00:00:12.000Z", blockNumber: 2 },
            },
          });
        } else {
          send(200, { proofs: [] });
        }
      } else if (url.pathname === "/api/search") {
        const q = url.searchParams.get("q") ?? "";
        if (q.replace(/[#,\s]/g, "") === "10") {
          send(200, { found: true, digest: toUrlSafeB64(digestA), counter: "10" });
        } else {
          send(200, { found: false });
        }
      } else {
        send(404, { error: "not found" });
      }
    });
  });
  await new Promise<void>((resolve) => mock.listen(0, "127.0.0.1", resolve));
  const address = mock.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  process.env["BITGRAPH_API_URL"] = `http://127.0.0.1:${address.port}`;
  process.env["BITGRAPH_API_KEY"] = "test-key-123";
});

after(() => {
  mock.close();
  delete process.env["BITGRAPH_API_URL"];
  delete process.env["BITGRAPH_API_KEY"];
});

/** A stand-in for the fuse pipeline: no slot, no enclave; records what it was asked to fuse. */
const fusedCalls: Array<{ name: string; digestB64: string }> = [];
let fuseMode: "ok" | "fail" = "ok";
async function fakeFuse(bytes: Uint8Array, name: string): Promise<FusedSummary> {
  const digestB64 = createHash("sha256").update(bytes).digest("base64");
  fusedCalls.push({ name, digestB64 });
  if (fuseMode === "fail") throw new Error("the boundary is restarting");
  const artifactDigestB64 = createHash("sha256").update("fused:" + digestB64).digest("base64");
  return {
    proof: proofFor(artifactDigestB64) as unknown as FusedSummary["proof"],
    frame: { type: "bitgraph-fuse/1" },
    placement: "container/1",
    artifactDigestB64,
    originDigestB64: digestB64,
  };
}
async function connectedClient(): Promise<Client> {
  const server = buildServer({ fuseFile: fakeFuse });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

test("lists the three tools", async () => {
  const client = await connectedClient();
  const tools = await client.listTools();
  const names = tools.tools.map((t) => t.name).sort();
  assert.deepEqual(names, ["bitgraph_check", "bitgraph_get_proof", "bitgraph_record"]);
});

test("record dedups on-record files and fuses only fresh ones", async () => {
  const client = await connectedClient();
  requests.length = 0;
  fusedCalls.length = 0;
  const result = await client.callTool({
    name: "bitgraph_record",
    arguments: { paths: [fileA, fileB] },
  });
  assert.ok(!result.isError, JSON.stringify(result.content));
  assert.equal(requests.filter((r) => r.path === "/api/commit").length, 0, "nothing is committed as bytes-only");
  assert.deepEqual(fusedCalls.map((c) => c.digestB64), [digestB], "only fileB fused; fileA was on record");
  assert.equal(fusedCalls[0]?.name, "b.txt", "the artifact is named after the file");
  const batch = requests.find((r) => r.path === "/api/proofs/batch");
  if (!batch) throw new Error("no batch check preceded the fuse");
  const batchBody = batch.body as { digests: string[] };
  assert.ok(batchBody.digests.every((d) => !d.includes("+") && !d.includes("=")), "check uses url-safe digests");
  const structured = result.structuredContent as {
    results: Array<{ path: string; outcome: string; counter: string | null; placement: string | null; artifact_digest: string | null }>;
    frames: Record<string, unknown>;
    summary: { fused: number; on_record: number; not_fused: number };
  };
  assert.equal(structured.summary.fused, 1);
  assert.equal(structured.summary.on_record, 1);
  assert.equal(structured.summary.not_fused, 0);
  const a = structured.results.find((r) => r.path === fileA);
  const b = structured.results.find((r) => r.path === fileB);
  assert.equal(a?.outcome, "on record");
  assert.equal(a?.counter, "10", "on-record outcome reports the EARLIEST position");
  assert.equal(b?.outcome, "fused");
  assert.equal(b?.placement, "container/1");
  assert.ok(b?.artifact_digest && structured.frames[b.artifact_digest], "the Frame rides in the structured result under the fused digest");
});

test("record with again=true fuses even on-record files", async () => {
  const client = await connectedClient();
  fusedCalls.length = 0;
  const result = await client.callTool({
    name: "bitgraph_record",
    arguments: { paths: [fileA], again: true },
  });
  assert.ok(!result.isError, JSON.stringify(result.content));
  assert.deepEqual(fusedCalls.map((c) => c.digestB64), [digestA]);
  const structured = result.structuredContent as {
    results: Array<{ outcome: string; total_positions: number }>;
  };
  assert.equal(structured.results[0]?.outcome, "fused");
  assert.equal(structured.results[0]?.total_positions, 3, "two prior positions plus the new artifact");
});

test("check reports positions without ever committing", async () => {
  const client = await connectedClient();
  requests.length = 0;
  const result = await client.callTool({
    name: "bitgraph_check",
    arguments: { paths: [fileB], digests: [toUrlSafeB64(digestA)] },
  });
  assert.ok(!result.isError, JSON.stringify(result.content));
  assert.ok(!requests.some((r) => r.path === "/api/commit"), "check never commits");
  const structured = result.structuredContent as {
    results: Array<{ input: string; on_record: boolean; positions: unknown[] }>;
  };
  const a = structured.results.find((r) => r.input === toUrlSafeB64(digestA));
  const b = structured.results.find((r) => r.input === fileB);
  assert.equal(a?.on_record, true);
  assert.equal(a?.positions.length, 2);
  assert.equal(b?.on_record, false);
});

test("check rejects malformed digests with an actionable error", async () => {
  const client = await connectedClient();
  const result = await client.callTool({
    name: "bitgraph_check",
    arguments: { digests: ["zzz"] },
  });
  assert.ok(result.isError);
  const text = (result.content as Array<{ text: string }>)[0]?.text ?? "";
  assert.ok(text.includes("not a base64 SHA-256 digest"));
});

test("get_proof by number resolves through search and renders the window", async () => {
  const client = await connectedClient();
  const result = await client.callTool({
    name: "bitgraph_get_proof",
    arguments: { number: "#10" },
  });
  assert.ok(!result.isError, JSON.stringify(result.content));
  const text = (result.content as Array<{ text: string }>)[0]?.text ?? "";
  assert.ok(text.includes("# BitGraph #10"));
  assert.ok(text.includes("BitGraphed between 2026-07-01T00:00:00.000Z"));
  assert.ok(text.includes("Causal positions (2)"));
  assert.ok(text.includes("/proof/"), "includes the proof page url");
});

test("get_proof for an unknown digest fails with guidance", async () => {
  const client = await connectedClient();
  const result = await client.callTool({
    name: "bitgraph_get_proof",
    arguments: { digest: toUrlSafeB64(digestB) },
  });
  assert.ok(result.isError);
  const text = (result.content as Array<{ text: string }>)[0]?.text ?? "";
  assert.ok(text.includes("Not on record"));
});

test("get_proof requires exactly one selector", async () => {
  const client = await connectedClient();
  const result = await client.callTool({
    name: "bitgraph_get_proof",
    arguments: { digest: toUrlSafeB64(digestA), number: "10" },
  });
  assert.ok(result.isError);
});

test("a fuse failure labels the file 'not fused', never 'on record'", async () => {
  const client = await connectedClient();
  fuseMode = "fail";
  try {
    const result = await client.callTool({
      name: "bitgraph_record",
      arguments: { paths: [fileC] },
    });
    assert.ok(result.isError, "a failure must be an error result");
    const text = (result.content as Array<{ text: string }>)[0]?.text ?? "";
    assert.ok(text.includes("0 of 1"), text);
    assert.ok(text.includes("the boundary is restarting"), text);
    const structured = result.structuredContent as {
      results: Array<{ outcome: string; proof_url: string | null; error?: string }>;
      summary: { fused: number; on_record: number; not_fused: number };
    };
    assert.equal(structured.results[0]?.outcome, "not fused");
    assert.equal(structured.results[0]?.proof_url, null);
    assert.equal(structured.summary.not_fused, 1);
    assert.equal(structured.summary.fused, 0);
    assert.equal(structured.summary.on_record, 0);
  } finally {
    fuseMode = "ok";
  }
});

test("record surfaces unreadable paths before any network call", async () => {
  const client = await connectedClient();
  requests.length = 0;
  const result = await client.callTool({
    name: "bitgraph_record",
    arguments: { paths: [fileA, "/definitely/missing/file.bin"] },
  });
  assert.ok(result.isError);
  assert.equal(requests.length, 0, "no API call happened; nothing was minted");
  const text = (result.content as Array<{ text: string }>)[0]?.text ?? "";
  assert.ok(text.includes("nothing was BitGraphed"));
});
