// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

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
import { writeFile, mkdtemp, mkdir, symlink } from "node:fs/promises";
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
      } else if (url.pathname === "/api/commit" || url.pathname.startsWith("/api/fuse/allocate") || url.pathname.startsWith("/api/fuse/commit")) {
        // The stand-in pipeline never reaches the boundary; nothing here may.
        send(500, { error: `unexpected ${url.pathname}` });
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

/** A stand-in for the tree pipeline: no slot, no boundary; records what it was asked to make and answers with a consistent tree. */
const treeCalls: Array<{ names: string[]; digests: string[] }> = [];
let fuseMode: "ok" | "fail" | "no-floor" = "ok";
const asIsDigests = new Set<string>();
const fakeFuseTree: FuseTreeFn = async (files, _config, opts) => {
  treeCalls.push({ names: files.map((f) => f.name), digests: files.map((f) => f.digestB64) });
  if (fuseMode === "fail") throw new FuseError("tee-restarting", "the boundary is restarting", 503);
  if (fuseMode === "no-floor") throw new FuseError("floor-missing", "the allocation returned no floor anchor, so no tree/1 commitment can be made");
  opts.onProgress?.({ phase: "commit", done: 1, total: 1 });
  mintCounter += 2; // the slot consumes one position, the commit lands on the next
  return fakeTree(files, { counter: String(mintCounter), epochId: EPOCH, asIs: asIsDigests });
};
async function connectedClient(): Promise<Client> {
  const server = buildServer({ fuseTree: fakeFuseTree });
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

test("lists the five tools", async () => {
  const client = await connectedClient();
  const tools = await client.listTools();
  const names = tools.tools.map((t) => t.name).sort();
  assert.deepEqual(names, ["bitgraph_check", "bitgraph_commit", "bitgraph_get_proof", "bitgraph_open", "bitgraph_record"]);
  const record = tools.tools.find((t) => t.name === "bitgraph_record")!;
  assert.deepEqual(Object.keys(record.inputSchema.properties ?? {}).sort(), ["again", "export_dir", "exports", "paths", "response_format"], "the old inputs stand; export_dir and exports are new and optional");
});

test("record makes ONE tree of the fresh files, leaves on-record ones alone, and writes the owner's export beside them", async () => {
  const client = await connectedClient();
  requests.length = 0;
  treeCalls.length = 0;
  const result = await client.callTool({
    name: "bitgraph_record",
    arguments: { paths: [fileA, fileB, fileC] },
  });
  assert.ok(!result.isError, JSON.stringify(result.content));
  assert.equal(requests.filter((r) => r.path === "/api/commit" || r.path.startsWith("/api/fuse/")).length, 0, "the stand-in never reaches the boundary; nothing else is sent");
  assert.equal(treeCalls.length, 1, "one tree for the whole call");
  assert.deepEqual(treeCalls[0]?.digests, [digestB, digestC], "only the fresh files are leaves; fileA was on record");
  assert.deepEqual(treeCalls[0]?.names, ["b.txt", "c.txt"], "members are named after the files");
  const batch = requests.find((r) => r.path === "/api/proofs/batch");
  if (!batch) throw new Error("no batch check preceded the tree");
  const batchBody = batch.body as { digests: string[] };
  assert.ok(batchBody.digests.every((d) => !d.includes("+") && !d.includes("=")), "check uses url-safe digests");
  const structured = result.structuredContent as RecordStructured;
  assert.deepEqual(structured.summary, { files: 3, directories: 0, fused: 2, recorded: 0, on_record: 1, carried: 0, not_fused: 0 });
  const tree = structured.tree!;
  assert.equal(tree.format, "tree/1");
  assert.equal(tree.count, 2);
  assert.equal(tree.root_document.length, 168, "the 84-byte root document, hex");
  assert.ok(tree.proof_url.includes("/proof/") && tree.proof_url.includes("counter="), "the tree's proof page is pinned to its position");
  const a = structured.results.find((r) => r.path === fileA);
  const b = structured.results.find((r) => r.path === fileB);
  const c = structured.results.find((r) => r.path === fileC);
  assert.equal(a?.outcome, "on record");
  assert.equal(a?.counter, "10", "on-record outcome reports the EARLIEST position");
  assert.equal(a?.member, 3, "an on-record set member reports its row, 1-based");
  assert.equal(a?.member_count, 10);
  assert.equal(b?.outcome, "fused");
  assert.equal(b?.counter, tree.counter, "a recorded file's position is the tree's");
  assert.equal(b?.placement, "container/2", "text goes in a container");
  assert.equal(b?.member_count, 2);
  assert.ok(b?.member === 1 || b?.member === 2);
  assert.notEqual(b?.member, c?.member, "two leaves");
  assert.ok(b?.artifact_digest && !b.artifact_digest.includes("+"), "the leaf's committed digest, url-safe");
  assert.equal(b?.proof_url, tree.proof_url, "a leaf's page is its tree's");
  // The owner's export, beside the files (the folder that holds the first path).
  assert.equal(tree.export.kind, "owner");
  assert.equal(tree.export.dir, dirname(fileA));
  assert.ok(tree.export.owner?.startsWith(dirname(fileA)), String(tree.export.owner));
  assert.equal(tree.export.members_dir, null);
  const owner = await readExportFile(tree.export.owner!);
  assert.deepEqual([...owner.tree.names!].sort(), ["b.txt", "c.txt"]);
  assert.equal(owner.proof.artifact.digestB64, fromUrlSafeB64(tree.artifact_digest));
  const text = textOf(result);
  assert.ok(text.startsWith("2 files BitGraphed as one tree at #"), text);
  assert.ok(text.includes("tree of 2"), text);
  assert.ok(text.includes(`Export, every file's leaf and name (keep it with the files): ${tree.export.owner}`), text);
  assert.ok(text.includes("bitgraph export complete"), text);
});

test("a single file is a tree of one; again=true makes an on-record one again", async () => {
  const client = await connectedClient();
  treeCalls.length = 0;
  const result = await client.callTool({
    name: "bitgraph_record",
    arguments: { paths: [fileA], again: true },
  });
  assert.ok(!result.isError, JSON.stringify(result.content));
  assert.deepEqual(treeCalls.map((c) => c.digests), [[digestA]]);
  const structured = result.structuredContent as RecordStructured;
  assert.equal(structured.tree?.count, 1);
  const row = structured.results[0];
  assert.equal(row?.outcome, "fused");
  assert.equal(row?.member, 1);
  assert.equal(row?.member_count, 1);
  assert.equal(row?.total_positions, 3, "two prior positions plus the new BitGraph");
  assert.equal(row?.proof_url, structured.tree?.proof_url);
  assert.ok(!("frames" in structured), "no Frame: a tree's evidence is its export");
  const text = textOf(result);
  assert.ok(text.startsWith("1 file BitGraphed as one tree at #"), text);
});

test("a directory is its regular files, hidden entries and links left out; its export goes beside it, never inside", async () => {
  const client = await connectedClient();
  treeCalls.length = 0;
  const result = await client.callTool({
    name: "bitgraph_record",
    arguments: { paths: [dir] },
  });
  assert.ok(!result.isError, JSON.stringify(result.content));
  assert.deepEqual(treeCalls[0]?.names, ["a1.txt", "a2.txt"]);
  const structured = result.structuredContent as RecordStructured;
  assert.deepEqual(structured.summary, { files: 2, directories: 1, fused: 2, recorded: 0, on_record: 0, carried: 0, not_fused: 0 });
  assert.equal(structured.tree?.count, 2);
  assert.equal(structured.tree?.export.dir, dirname(dir), "beside the folder");
  const owner = await readExportFile(structured.tree!.export.owner!);
  assert.deepEqual([...owner.tree.names!].sort(), ["a1.txt", join("sub", "a2.txt")], "names under the folder");
});

test("the same bytes under two paths are one leaf, made once and reported twice", async () => {
  const client = await connectedClient();
  treeCalls.length = 0;
  const result = await client.callTool({
    name: "bitgraph_record",
    arguments: { paths: [fileB, copyB] },
  });
  assert.ok(!result.isError, JSON.stringify(result.content));
  assert.deepEqual(treeCalls.map((c) => c.digests), [[digestB]]);
  const structured = result.structuredContent as RecordStructured;
  assert.equal(structured.tree?.count, 1);
  assert.equal(structured.summary.fused, 2);
  assert.equal(structured.results[0]?.artifact_digest, structured.results[1]?.artifact_digest);
});

test("a big folder is one tree: every file a leaf, nothing indexed afterwards, rows capped, progress reported", async () => {
  const client = await connectedClient();
  requests.length = 0;
  treeCalls.length = 0;
  const progress: string[] = [];
  const result = await client.callTool({ name: "bitgraph_record", arguments: { paths: [bigDir] } }, undefined, {
    onprogress: (p) => {
      if (p.message !== undefined) progress.push(p.message);
    },
  });
  assert.ok(!result.isError, JSON.stringify(result.content).slice(0, 500));
  assert.equal(treeCalls.length, 1);
  assert.equal(treeCalls[0]?.digests.length, BIG);
  assert.equal(requests.filter((r) => r.path === "/api/fuse/set-index").length, 0, "a tree's members are not sent anywhere: the export holds them");
  const structured = result.structuredContent as RecordStructured;
  assert.equal(structured.tree?.count, BIG);
  assert.equal(structured.summary.fused, BIG);
  assert.equal(structured.results.length, ROW_CAP, "the structured rows are capped");
  assert.equal(structured.omitted, BIG - ROW_CAP);
  const owner = await readExportFile(structured.tree!.export.owner!);
  assert.equal(Buffer.from(owner.tree.leaves!, "base64").length, BIG * 65, "the owner's export lists every leaf");
  const text = textOf(result);
  assert.ok(text.includes(`tree of ${BIG.toLocaleString("en-US")}`), text.slice(0, 300));
  assert.ok(text.includes("more files in the same tree"), "the markdown lists a few rows and counts the rest");
  assert.ok(progress.some((m) => /^hashed \d+ of \d+$/.test(m)), `progress notifications arrived: ${progress.slice(0, 3).join(" | ")}`);
  assert.ok(progress.includes("committing 1 of 1"), "the pipeline's phases are reported");
});

test("exports: one per file under the tree's names, both, none, and export_dir honored", async () => {
  const client = await connectedClient();
  const out = await mkdtemp(join(tmpdir(), "bitgraph-mcp-exports-"));
  const both = await client.callTool({ name: "bitgraph_record", arguments: { paths: [dir], again: true, export_dir: out, exports: "both" } });
  assert.ok(!both.isError, JSON.stringify(both.content));
  const s = both.structuredContent as RecordStructured;
  assert.equal(s.tree?.export.dir, out);
  assert.ok(s.tree?.export.owner?.startsWith(out));
  assert.equal(s.tree?.export.members, 2);
  for (const row of s.results) {
    assert.ok(row.export?.startsWith(s.tree!.export.members_dir!), `${row.path} names its own export`);
    const exp = await readExportFile(row.export!);
    assert.equal(exp.tree.member?.index, row.member! - 1);
    assert.equal(exp.tree.leaves, undefined);
  }
  assert.ok(textOf(both).includes(`One export per file: ${s.tree?.export.members_dir}`));
  const none = await client.callTool({ name: "bitgraph_record", arguments: { paths: [fileC], again: true, export_dir: out, exports: "none" } });
  const n = none.structuredContent as RecordStructured;
  assert.deepEqual([n.tree?.export.owner, n.tree?.export.members_dir, n.tree?.export.dir], [null, null, null]);
  assert.ok(textOf(none).includes("without an export no file here can show it is in this BitGraph"), textOf(none));
  // A folder that cannot be written: the export goes to the temp folder, and says so.
  const blocked = join(out, "not-a-folder");
  await writeFile(blocked, "a file where a folder should be");
  const fallback = await client.callTool({ name: "bitgraph_record", arguments: { paths: [fileC], again: true, export_dir: join(blocked, "inside") } });
  assert.ok(!fallback.isError, JSON.stringify(fallback.content));
  const f = fallback.structuredContent as RecordStructured;
  assert.match(f.tree?.export.error ?? "", /written to .*bitgraph-exports instead/);
  assert.equal(f.tree?.export.dir, join(tmpdir(), "bitgraph-exports"));
  assert.ok(f.tree?.export.owner?.startsWith(join(tmpdir(), "bitgraph-exports")));
  assert.ok(textOf(fallback).includes("The export could not be written where asked"), textOf(fallback));
});

test("a file recorded as is is its own leaf, reported as recorded, not fused", async () => {
  const client = await connectedClient();
  asIsDigests.add(digestC);
  try {
    const result = await client.callTool({ name: "bitgraph_record", arguments: { paths: [fileB, fileC], again: true } });
    assert.ok(!result.isError, JSON.stringify(result.content));
    const s = result.structuredContent as RecordStructured;
    assert.deepEqual([s.summary.fused, s.summary.recorded], [1, 1]);
    const c = s.results.find((r) => r.path === fileC)!;
    assert.equal(c.outcome, "recorded");
    assert.equal(c.placement, "as-is");
    assert.equal(c.artifact_digest, toUrlSafeB64(digestC), "as is: the leaf is the file's own digest");
    const text = textOf(result);
    assert.ok(text.startsWith("2 files BitGraphed as one tree at #"), text);
    assert.ok(text.includes(`- recorded as is · ${fileC} (`), text);
    assert.ok(text.includes("A file over 256 MiB is recorded as is: it existed by the commit, and nothing bounds it from below."), text);
  } finally {
    asIsDigests.clear();
  }
});

test("a tree failure labels every attempted file 'not fused', never 'on record'", async () => {
  const client = await connectedClient();
  fuseMode = "fail";
  try {
    const result = await client.callTool({
      name: "bitgraph_record",
      arguments: { paths: [fileA, fileC], again: true },
    });
    assert.ok(result.isError, "a failure must be an error result");
    const text = textOf(result);
    assert.ok(text.includes("Nothing was BitGraphed"), text);
    assert.ok(text.includes("the boundary is restarting"), text);
    const structured = result.structuredContent as RecordStructured;
    assert.equal(structured.tree, null);
    assert.ok(structured.results.every((r) => r.outcome === "not fused" && r.proof_url === null));
    assert.deepEqual(structured.summary, { files: 2, directories: 0, fused: 0, recorded: 0, on_record: 0, carried: 0, not_fused: 2 });
  } finally {
    fuseMode = "ok";
  }
});

test("a boundary without a floor makes nothing, and says why", async () => {
  const client = await connectedClient();
  fuseMode = "no-floor";
  try {
    const result = await client.callTool({ name: "bitgraph_record", arguments: { paths: [fileC], again: true } });
    assert.ok(result.isError);
    assert.ok(textOf(result).includes("does not return the floor block a tree needs"), textOf(result));
  } finally {
    fuseMode = "ok";
  }
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
  assert.equal(treeCalls.length, 0);
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
