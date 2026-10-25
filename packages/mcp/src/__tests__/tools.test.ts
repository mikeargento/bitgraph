// Copyright (c) 2025-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * End-to-end tool tests: a real MCP client drives the real server over an
 * in-memory transport, against a mock bitgraph.ing that asserts the exact
 * wire shapes, with the tree pipeline replaced by a stand-in that builds a
 * consistent tree without a boundary. No real ledger writes ever happen here.
 */

import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { writeFile, readFile, mkdtemp, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { FuseError } from "@mikeargento/bitgraph";
import { buildServer, ROW_CAP, type FuseTreeFn } from "../server.js";
import { fromUrlSafeB64, readExportFile, toUrlSafeB64 } from "@mikeargento/bitgraph-sdk";
import { fakeTree } from "./fake-tree.js";

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
let copyB = "";
let dir = "";
let bigDir = "";
const BIG = 2_600;
let digestA = ""; // standard b64 of fileA bytes
let digestB = "";
let digestC = "";
const EPOCH = createHash("sha256").update("test-epoch").digest("base64");
let mintCounter = 100;
let bindCounter = 200;

function proofFor(digestB64: string): Record<string, unknown> {
  mintCounter += 2; // slot consumes one position, commit lands on the next
  return {
    version: "bitgraph/1",
    artifact: { hashAlg: "sha256", digestB64 },
    commit: { counter: String(mintCounter), epochId: EPOCH },
    signer: { publicKeyB64: "pk", signatureB64: "sig" },
    environment: { enforcement: "measured-tee", measurement: "m" },
    attribution: { name: "bitgraph-fuse/1", title: "set/1" },
  };
}

before(async () => {
  const root = await mkdtemp(join(tmpdir(), "bitgraph-mcp-e2e-"));
  fileA = join(root, "a.txt");
  fileB = join(root, "b.txt");
  fileC = join(root, "c.txt");
  copyB = join(root, "b-copy.txt");
  await writeFile(fileA, "alpha bytes");
  await writeFile(fileB, "beta bytes");
  await writeFile(fileC, "gamma bytes");
  await writeFile(copyB, "beta bytes");
  digestA = createHash("sha256").update("alpha bytes").digest("base64");
  digestB = createHash("sha256").update("beta bytes").digest("base64");
  digestC = createHash("sha256").update("gamma bytes").digest("base64");
  // A folder: two files, a hidden one, a nested one, a symbolic link.
  dir = join(root, "folder");
  await mkdir(join(dir, "sub"), { recursive: true });
  await writeFile(join(dir, "a1.txt"), "folder one");
  await writeFile(join(dir, ".hidden.txt"), "hidden");
  await writeFile(join(dir, "sub", "a2.txt"), "folder two");
  await symlink(join(dir, "a1.txt"), join(dir, "link.txt"));
  // A folder above the set/1 cap.
  bigDir = join(root, "big");
  await mkdir(bigDir);
  await Promise.all(Array.from({ length: BIG }, (_, i) => writeFile(join(bigDir, `m${String(i).padStart(5, "0")}.txt`), `member ${i}\n`)));

  const recoveryEntries = new Map<string, string>();
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
        // fileA is already on record (two positions, the first as a set member); nothing else is.
        const digests = (body as { digests: string[] }).digests;
        const results: Record<string, { proofs: Array<{ proof: unknown; member?: unknown }> }> = {};
        for (const d of digests) {
          if (d === toUrlSafeB64(digestA)) {
            results[d] = {
              proofs: [
                { proof: { artifact: { digestB64: digestA }, commit: { counter: "10", epochId: EPOCH } }, member: { index: 2, count: 10, role: "origin" } },
                { proof: { artifact: { digestB64: digestA }, commit: { counter: "55", epochId: EPOCH } } },
              ],
            };
          } else {
            results[d] = { proofs: [] };
          }
        }
        send(200, { results });
      } else if (url.pathname === "/api/fuse/set-index") {
        // Nothing indexes a tree's members; a call here is a test failure.
        send(500, { error: "unexpected set-index" });
      } else if (url.pathname === "/api/commit") {
        // Enclave v12: one bind per digest, two counts each, nothing else in the proof.
        const digests = (body as { digests: Array<{ digestB64: string }> }).digests;
        send(200, digests.map((d) => {
          bindCounter += 2;
          return { version: "bitgraph/1", artifact: { hashAlg: "sha256", digestB64: d.digestB64 }, commit: { nonceB64: "n", counter: String(bindCounter), slotCounter: String(bindCounter - 1), epochId: EPOCH, atomic: true, chainId: "bitgraph:main" } };
        }));
      } else if (url.pathname.startsWith("/api/fuse/")) {
        send(410, { error: "Gone" });
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
        } else if (digest === toUrlSafeB64(digestB)) {
          send(200, {
            proofs: [{ proof: { artifact: { digestB64: "c2V0" }, commit: { counter: "1386", epochId: EPOCH } } }],
            positions: [{ counter: "1386", epoch: toUrlSafeB64(EPOCH), lowerTime: null, upperTime: null, kind: "fused", placement: "container/2", member: { index: 4, count: 50, role: "origin" } }],
            causalWindow: null,
          });
        } else {
          send(200, { proofs: [] });
        }
      } else if (url.pathname.startsWith("/api/proofs/") && req.method === "GET" && !url.pathname.startsWith("/api/proofs/digest/") && url.pathname !== "/api/proofs/batch" && url.pathname !== "/api/proofs/witness") {
        // The ledger's proofs by digest: this server indexes none of the stand-in pipeline's trees, so a recovery entry that names one finds no proof here.
        send(200, { proofs: [] });
      } else if (url.pathname === "/api/search") {
        const q = url.searchParams.get("q") ?? "";
        if (q.replace(/[#,\s]/g, "") === "10") {
          send(200, { found: true, digest: toUrlSafeB64(digestA), counter: "10" });
        } else {
          send(200, { found: false });
        }
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
        send(404, { error: "not found" });
      }
    });
  });
  await new Promise<void>((resolve) => mock.listen(0, "127.0.0.1", resolve));
  const address = mock.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  process.env["BITGRAPH_API_URL"] = `http://127.0.0.1:${address.port}`;
  process.env["BITGRAPH_HOME"] = await mkdtemp(join(tmpdir(), "bitgraph-mcp-home-"));
  process.env["BITGRAPH_RECOVERY_TRUST"] = "none";
  process.env["BITGRAPH_API_KEY"] = "test-key-123";
});

after(() => {
  mock.close();
  delete process.env["BITGRAPH_API_URL"];
  delete process.env["BITGRAPH_API_KEY"];
});

/** A stand-in for the tree pipeline: no slot, no boundary; records what it was asked to make and answers with a consistent tree. */
const treeCalls: Array<{ names: string[]; digests: string[] }> = [];
let fuseMode: "ok" | "fail" | "no-floor" = "ok";
const asIsDigests = new Set<string>();
const fakeFuseTree: FuseTreeFn = async (files, _config, opts) => {
  treeCalls.push({ names: files.map((f) => f.name), digests: files.map((f) => f.digestB64) });
  opts.onProgress?.({ phase: "commit", done: 1, total: 1 });
  mintCounter += 2; // the slot consumes one position, the commit lands on the next
  return fakeTree(files, { counter: String(mintCounter), epochId: EPOCH, asIs: asIsDigests });
};
async function connectedClient(): Promise<Client> {
  const server = buildServer({ fuseTree: fakeFuseTree, structuredAlways: true });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

interface RecordStructured {
  tree: {
    format: string; count: number; counter: string | null; proof_url: string; artifact_digest: string; root_document: string;
    export: { kind: string; dir: string | null; owner: string | null; members_dir: string | null; members: number; floor_header: boolean; error?: string };
  } | null;
  results: Array<{ path: string; outcome: string; counter: string | null; placement: string | null; artifact_digest: string | null; member: number | null; member_count: number | null; total_positions: number; proof_url: string | null; export?: string; error?: string }>;
  omitted: number;
  summary: { files: number; directories: number; fused: number; recorded: number; on_record: number; carried: number; not_fused: number };
}
const textOf = (result: unknown): string => (((result as { content?: unknown }).content ?? []) as Array<{ text: string }>)[0]?.text ?? "";

test("lists the three tools: one way to make, two to read", async () => {
  const client = await connectedClient();
  const tools = await client.listTools();
  const names = tools.tools.map((t) => t.name).sort();
  assert.deepEqual(names, ["bitgraph_check", "bitgraph_get_proof", "bitgraph_record"]);
  const record = tools.tools.find((t) => t.name === "bitgraph_record")!;
  assert.deepEqual(Object.keys(record.inputSchema.properties ?? {}).sort(), ["paths", "response_format", "write"]);
});

test("record binds each file, saves its proof beside it, and says each BitGraph's two counts", async () => {
  const client = await connectedClient();
  requests.length = 0;
  const result = await client.callTool({ name: "bitgraph_record", arguments: { paths: [fileA, fileB] } });
  assert.ok(!result.isError, textOf(result));
  const commits = requests.filter((r) => r.path === "/api/commit");
  assert.equal(commits.length, 1, "one request for both files");
  assert.equal(requests.filter((r) => r.path.startsWith("/api/fuse/")).length, 0, "no held slot, ever");
  const sent = (commits[0]!.body as { digests: Array<{ digestB64: string }> }).digests.map((d) => d.digestB64);
  assert.deepEqual(sent, [digestA, digestB], "the files' own SHA-256s, nothing else");
  const made = (result.structuredContent as { made: Array<{ path: string; number: string; counts: [string, string]; proof_path: string | null }> }).made;
  assert.equal(made.length, 2);
  for (const m of made) {
    assert.equal(BigInt(m.counts[1]), BigInt(m.counts[0]) + 1n, "payload count = nonce count + 1");
    assert.equal(m.proof_path, `${m.path}.bitgraph.json`);
    const saved = JSON.parse(await readFile(m.proof_path!, "utf8")) as { commit: { atomic: boolean } };
    assert.equal(saved.commit.atomic, true, "the proof is saved whole beside its file");
  }
  assert.ok(textOf(result).includes("BitGraph #"), textOf(result));
});

test("record with write=false saves nothing", async () => {
  const client = await connectedClient();
  const dir = await mkdtemp(join(tmpdir(), "bitgraph-mcp-nowrite-"));
  const f = join(dir, "x.txt");
  await writeFile(f, "no proof file please");
  const result = await client.callTool({ name: "bitgraph_record", arguments: { paths: [f], write: false } });
  assert.ok(!result.isError, textOf(result));
  await assert.rejects(readFile(`${f}.bitgraph.json`, "utf8"));
});

test("record surfaces unreadable paths before any network call", async () => {
  const client = await connectedClient();
  requests.length = 0;
  treeCalls.length = 0;
  const result = await client.callTool({
    name: "bitgraph_record",
    arguments: { paths: [fileA, "/definitely/missing/file.bin"] },
  });
  assert.ok(result.isError);
  assert.equal(requests.length, 0, "no API call happened; nothing was minted");
  const text = textOf(result);
  assert.ok(text.includes("nothing was BitGraphed"), text);
  assert.ok(text.includes("/definitely/missing/file.bin"), text);
});

test("check reports positions without ever committing", async () => {
  const client = await connectedClient();
  requests.length = 0;
  const result = await client.callTool({
    name: "bitgraph_check",
    arguments: { paths: [fileB], digests: [toUrlSafeB64(digestA)] },
  });
  assert.ok(!result.isError, JSON.stringify(result.content));
  assert.ok(!requests.some((r) => r.path === "/api/commit" || r.path.startsWith("/api/fuse/")), "check never commits");
  const structured = result.structuredContent as {
    results: Array<{ input: string; on_record: boolean; positions: Array<{ member?: { index: number; count: number } }> }>;
  };
  const a = structured.results.find((r) => r.input === toUrlSafeB64(digestA));
  const b = structured.results.find((r) => r.input === fileB);
  assert.equal(a?.on_record, true);
  assert.equal(a?.positions.length, 2);
  assert.deepEqual(a?.positions[0]?.member, { index: 2, count: 10, role: "origin" });
  assert.equal(b?.on_record, false);
  assert.ok(textOf(result).includes("member 3 of 10"), textOf(result));
});

test("check accepts a directory", async () => {
  const client = await connectedClient();
  const result = await client.callTool({ name: "bitgraph_check", arguments: { paths: [dir] } });
  assert.ok(!result.isError, JSON.stringify(result.content));
  const structured = result.structuredContent as { results: Array<{ input: string }>; summary: { not_on_record: number } };
  assert.deepEqual(structured.results.map((r) => r.input), [join(dir, "a1.txt"), join(dir, "sub", "a2.txt")]);
  assert.equal(structured.summary.not_on_record, 2);
});

test("check rejects malformed digests with an actionable error", async () => {
  const client = await connectedClient();
  const result = await client.callTool({
    name: "bitgraph_check",
    arguments: { digests: ["zzz"] },
  });
  assert.ok(result.isError);
  assert.ok(textOf(result).includes("not a base64 SHA-256 digest"));
});

test("get_proof by number resolves through search and renders the window", async () => {
  const client = await connectedClient();
  const result = await client.callTool({
    name: "bitgraph_get_proof",
    arguments: { number: "#10" },
  });
  assert.ok(!result.isError, JSON.stringify(result.content));
  const text = textOf(result);
  assert.ok(text.includes("# BitGraph #10"));
  assert.ok(text.includes("BitGraphed after 2026-07-01T00:00:00.000Z"));
  assert.ok(text.includes("before the anchoring of block 2"), "the ceiling is stated in position, never as the block's mine time");
  assert.ok(text.includes("Causal positions (2)"));
  assert.ok(text.includes("/proof/"), "includes the proof page url");
});

test("get_proof renders a set member's row", async () => {
  const client = await connectedClient();
  const result = await client.callTool({
    name: "bitgraph_get_proof",
    arguments: { path: fileB },
  });
  assert.ok(!result.isError, JSON.stringify(result.content));
  const text = textOf(result);
  assert.ok(text.includes("# BitGraph #1386"), text);
  assert.ok(text.includes("Set: member 5 of 50, as the original (container/2)"), text);
});

test("get_proof for an unknown digest fails with guidance", async () => {
  const client = await connectedClient();
  const result = await client.callTool({
    name: "bitgraph_get_proof",
    arguments: { digest: toUrlSafeB64(digestC) },
  });
  assert.ok(result.isError);
  assert.ok(textOf(result).includes("Not on record"));
});

test("get_proof requires exactly one selector", async () => {
  const client = await connectedClient();
  const result = await client.callTool({
    name: "bitgraph_get_proof",
    arguments: { digest: toUrlSafeB64(digestA), number: "10" },
  });
  assert.ok(result.isError);
});

test("a markdown answer is text alone by default, so clients show the summary, not raw JSON", async () => {
  const server = buildServer({ fuseTree: fakeFuseTree });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  const md = await client.callTool({ name: "bitgraph_check", arguments: { digests: [toUrlSafeB64(digestA)] } });
  assert.ok(!md.isError, JSON.stringify(md.content));
  assert.equal(md.structuredContent, undefined, "no structuredContent with markdown");
  assert.ok(textOf(md).includes("on record"), textOf(md));
  const json = await client.callTool({ name: "bitgraph_check", arguments: { digests: [toUrlSafeB64(digestA)], response_format: "json" } });
  assert.ok(json.structuredContent !== undefined, "json still carries structuredContent");
});
