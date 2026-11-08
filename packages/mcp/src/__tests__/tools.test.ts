// Copyright (c) 2025-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * End-to-end tool tests: a real MCP client drives the real server over an
 * in-memory transport, against a mock bitgraph.ing on 127.0.0.1 that records
 * every request and answers with unsigned stand-in proofs. Nothing is ever
 * bound for real and no request leaves this machine.
 */

import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { writeFile, readFile, mkdtemp, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { checkTreeMember, parseDigestTreeRootText } from "@mikeargento/bitgraph-verify";
import { buildServer } from "../server.js";
import { toUrlSafeB64 } from "@mikeargento/bitgraph-sdk";

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
let digestA = ""; // standard b64 of fileA bytes
let digestB = "";
let digestC = "";
const EPOCH = createHash("sha256").update("test-epoch").digest("base64");
let bindCounter = 200;

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
        // fileA is already on record (two positions, the first as a tree member); nothing else is.
        const digests = (body as { digests: string[] }).digests;
        const results: Record<string, { proofs: Array<{ proof: unknown; member?: unknown }> }> = {};
        for (const d of digests) {
          if (d === toUrlSafeB64(digestA)) {
            results[d] = {
              proofs: [
                { proof: { artifact: { digestB64: digestA }, commit: { counter: "10", epochId: EPOCH } }, member: { index: 2, count: 10 } },
                { proof: { artifact: { digestB64: digestA }, commit: { counter: "55", epochId: EPOCH } } },
              ],
            };
          } else {
            results[d] = { proofs: [] };
          }
        }
        send(200, { results });
      } else if (url.pathname === "/api/commit") {
        // One bind: a fresh nonce at one count, the digest at the next.
        const digests = (body as { digests: Array<{ digestB64: string }> }).digests;
        send(200, digests.map((d) => {
          bindCounter += 2;
          return { version: "bitgraph/1", artifact: { hashAlg: "sha256", digestB64: d.digestB64 }, commit: { nonceB64: createHash("sha256").update(`nonce-${bindCounter}`).digest("base64"), counter: String(bindCounter), slotCounter: String(bindCounter - 1), epochId: EPOCH, atomic: true, chainId: "bitgraph:main" } };
        }));
      } else if (url.pathname === "/api/tree-members") {
        send(200, { written: (body as { members: unknown[] }).members.length, failed: 0, rejected: 0 });
      } else if (url.pathname.startsWith("/api/proofs/digest/")) {
        const digest = decodeURIComponent(url.pathname.split("/").pop() ?? "");
        if (digest === toUrlSafeB64(digestA)) {
          send(200, {
            proofs: [{ proof: { artifact: { digestB64: digestA }, commit: { counter: "10", epochId: EPOCH } } }],
            positions: [
              { counter: "10", epoch: toUrlSafeB64(EPOCH) },
              { counter: "55", epoch: toUrlSafeB64(EPOCH) },
            ],
          });
        } else if (digest === toUrlSafeB64(digestB)) {
          send(200, {
            proofs: [{ proof: { artifact: { digestB64: "c2V0" }, commit: { counter: "1386", epochId: EPOCH } } }],
            positions: [{ counter: "1386", epoch: toUrlSafeB64(EPOCH), member: { index: 4, count: 50 } }],
          });
        } else {
          send(200, { proofs: [] });
        }
      } else if (url.pathname.startsWith("/api/proofs/") && req.method === "GET" && !url.pathname.startsWith("/api/proofs/digest/") && url.pathname !== "/api/proofs/batch" && url.pathname !== "/api/proofs/witness") {
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
  process.env["BITGRAPH_RECOVERY_TRUST"] = "none";
  process.env["BITGRAPH_API_KEY"] = "test-key-123";
});

after(() => {
  mock.close();
  delete process.env["BITGRAPH_API_URL"];
  delete process.env["BITGRAPH_API_KEY"];
});

async function connectedClient(): Promise<Client> {
  const server = buildServer({ structuredAlways: true });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

interface RecordStructured {
  made: { kind: string; number: string; counts: [string, string]; nonce: string; digest: string; tree: { files: number; root_text: string; indexed: number } | null } | null;
  files: Array<{ path: string; outcome: string; number: string | null; nonce: string | null; proof_path: string | null; member: { index: number; files: number } | null }>;
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

test("record of several new files makes one tree and one BitGraph, saves each file's proof, and returns the nonce", async () => {
  const client = await connectedClient();
  requests.length = 0;
  const result = await client.callTool({ name: "bitgraph_record", arguments: { paths: [fileB, fileC] } });
  assert.ok(!result.isError, textOf(result));
  const lookup = requests.findIndex((r) => r.path === "/api/proofs/batch");
  const commits = requests.filter((r) => r.path === "/api/commit");
  assert.ok(lookup >= 0 && lookup < requests.findIndex((r) => r.path === "/api/commit"), "looked up before anything is bound");
  assert.equal(commits.length, 1, "one BitGraph for both files");
  assert.equal(commits[0]!.headers["authorization"], "Bearer test-key-123");
  const s = result.structuredContent as unknown as RecordStructured;
  assert.equal(s.made?.kind, "tree");
  assert.equal(s.made?.tree?.files, 2);
  assert.deepEqual(parseDigestTreeRootText(s.made!.tree!.root_text)?.files, 2);
  assert.deepEqual((commits[0]!.body as { digests: Array<{ digestB64: string }> }).digests.map((d) => d.digestB64), [s.made!.digest]);
  assert.equal(BigInt(s.made!.counts[1]), BigInt(s.made!.counts[0]) + 1n, "content count = nonce count + 1");
  assert.ok(s.made!.nonce.length > 0);
  assert.equal(requests.filter((r) => r.path === "/api/tree-members").length, 1);
  for (const [path, digest] of [[fileB, digestB], [fileC, digestC]] as const) {
    const f = s.files.find((x) => x.path === path)!;
    assert.equal(f.outcome, "made");
    assert.equal(f.nonce, s.made!.nonce);
    assert.equal(f.proof_path, `${path}.bitgraph.json`);
    const saved = JSON.parse(await readFile(f.proof_path!, "utf8")) as unknown;
    assert.ok(checkTreeMember(saved, digest), "each saved proof walks the file's own hash to the bound root");
  }
  const text = textOf(result);
  assert.ok(text.includes(`Made BitGraph #${s.made!.number} of 2 files as one tree.`), text);
  assert.ok(text.includes(`Nonce: ${s.made!.nonce}`), text);
});

test("record of one new file binds its own SHA-256; a file already on record is left alone", async () => {
  const client = await connectedClient();
  requests.length = 0;
  const result = await client.callTool({ name: "bitgraph_record", arguments: { paths: [fileA, copyB] } });
  assert.ok(!result.isError, textOf(result));
  const commits = requests.filter((r) => r.path === "/api/commit");
  assert.equal(commits.length, 1);
  assert.deepEqual((commits[0]!.body as { digests: Array<{ digestB64: string }> }).digests.map((d) => d.digestB64), [digestB], "the new file's own SHA-256, nothing else");
  assert.ok(!requests.some((r) => r.path === "/api/tree-members"), "one file is no tree");
  const s = result.structuredContent as unknown as RecordStructured;
  assert.equal(s.made?.kind, "file");
  assert.equal(s.files.find((f) => f.path === fileA)?.outcome, "on record");
  assert.equal(s.files.find((f) => f.path === fileA)?.number, "10");
  assert.equal(s.files.find((f) => f.path === copyB)?.outcome, "made");
  assert.ok(textOf(result).includes("already a BitGraph · #10"), textOf(result));
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
  const result = await client.callTool({
    name: "bitgraph_record",
    arguments: { paths: [fileA, "/definitely/missing/file.bin"] },
  });
  assert.ok(result.isError);
  assert.equal(requests.length, 0, "no API call happened; nothing was minted");
  const text = textOf(result);
  assert.ok(text.includes("nothing was made"), text);
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
  assert.ok(!requests.some((r) => r.path === "/api/commit"), "check never commits");
  const structured = result.structuredContent as {
    results: Array<{ input: string; on_record: boolean; positions: Array<{ member?: { index: number; count: number } }> }>;
  };
  const a = structured.results.find((r) => r.input === toUrlSafeB64(digestA));
  const b = structured.results.find((r) => r.input === fileB);
  assert.equal(a?.on_record, true);
  assert.equal(a?.positions.length, 2);
  assert.deepEqual(a?.positions[0]?.member, { index: 2, count: 10 });
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

test("get_proof by number resolves through search and lists its positions", async () => {
  const client = await connectedClient();
  const result = await client.callTool({
    name: "bitgraph_get_proof",
    arguments: { number: "#10" },
  });
  assert.ok(!result.isError, JSON.stringify(result.content));
  const text = textOf(result);
  assert.ok(text.includes("# BitGraph #10"));
  assert.ok(text.includes("Positions (2)"));
  assert.ok(text.includes("/proof/"), "includes the proof page url");
});

test("get_proof renders a tree member's place", async () => {
  const client = await connectedClient();
  const result = await client.callTool({
    name: "bitgraph_get_proof",
    arguments: { path: fileB },
  });
  assert.ok(!result.isError, JSON.stringify(result.content));
  const text = textOf(result);
  assert.ok(text.includes("# BitGraph #1386"), text);
  assert.ok(text.includes("Tree: file 5 of 50"), text);
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
  const server = buildServer();
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
