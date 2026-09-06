// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * End-to-end tool tests: a real MCP client drives the real server over an
 * in-memory transport, against a mock bitgraph.ing that asserts the exact
 * wire shapes, with the set pipeline replaced by a stand-in. No real ledger
 * writes ever happen here.
 */

import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { writeFile, mkdtemp, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { FuseError } from "@mikeargento/bitgraph";
import { buildServer, pendingIndexCount, ROW_CAP, SET_INDEX_CHUNK, type FuseFileFn, type FuseSetFn } from "../server.js";
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
let copyB = "";
let dir = "";
let bigDir = "";
const BIG = SET_INDEX_CHUNK + 100;
let digestA = ""; // standard b64 of fileA bytes
let digestB = "";
let digestC = "";
const EPOCH = createHash("sha256").update("test-epoch").digest("base64");
let mintCounter = 100;
let indexMode: "ok" | "fail" = "ok";

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
        if (indexMode === "fail") {
          send(500, { error: "indexing failed" });
        } else {
          const members = (body as { members: unknown[] }).members;
          send(200, { count: BIG, written: members.length, failed: 0, rejected: 0 });
        }
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

/** A stand-in for the set pipeline: no slot, no boundary; records what it was asked to fuse and answers like a set. */
const setCalls: Array<{ names: string[]; digests: string[]; set: string }> = [];
let fuseMode: "ok" | "fail" = "ok";
const fakeFuseSet: FuseSetFn = async (files, _config, opts) => {
  setCalls.push({ names: files.map((f) => f.name), digests: files.map((f) => f.digestB64), set: opts.set });
  if (fuseMode === "fail") throw new FuseError("tee-restarting", "the boundary is restarting", 503);
  opts.onProgress?.({ phase: "commit", done: 1, total: 1 });
  const rows = files.map((f, index) => ({ index, artifact: createHash("sha256").update("fused:" + f.digestB64).digest("base64"), origin: f.digestB64, placement: f.placement }));
  const sorted = [...rows].sort((a, b) => Buffer.from(a.artifact, "base64").compare(Buffer.from(b.artifact, "base64")));
  const manifestIndex = new Map(sorted.map((r, k) => [r.index, k]));
  const setDigest = createHash("sha256").update("set:" + sorted.map((r) => r.artifact).join(",")).digest("base64");
  return {
    set: opts.set,
    proof: proofFor(setDigest),
    artifactDigestB64: setDigest,
    count: files.length,
    manifestEchoed: true,
    recovered: false,
    members: rows.map((r) => {
      const k = manifestIndex.get(r.index) as number;
      return {
        index: r.index,
        manifestIndex: k,
        placement: r.placement,
        originDigestB64: r.origin,
        artifactDigestB64: r.artifact,
        ...(opts.set === "set/2"
          ? { memberProof: { count: files.length, index: k, member: { artifact: { algorithm: "sha256", digest: "" }, origin: { algorithm: "sha256", digest: "" }, placement: r.placement }, path: [], placement: "set/2", type: "bitgraph-fuse/1" } }
          : {}),
      };
    }),
  };
};
/** A stand-in for the single-file pipeline: records what it was asked to fuse. */
const soloCalls: Array<{ name: string; digestB64: string }> = [];
const fakeFuseFile: FuseFileFn = async (file) => {
  soloCalls.push({ name: file.name, digestB64: file.digestB64 });
  if (fuseMode === "fail") throw new FuseError("tee-restarting", "the boundary is restarting", 503);
  const artifactDigestB64 = createHash("sha256").update("fused:" + file.digestB64).digest("base64");
  return { proof: proofFor(artifactDigestB64), frame: { type: "bitgraph-fuse/1" }, placement: file.placement, artifactDigestB64, originDigestB64: file.digestB64 };
};
async function connectedClient(): Promise<Client> {
  const server = buildServer({ fuseSet: fakeFuseSet, fuseFile: fakeFuseFile });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

interface RecordStructured {
  set: { set: string; count: number; counter: string | null; proof_url: string; index: { written: number; pending: number } | null } | null;
  frames: Record<string, unknown>;
  results: Array<{ path: string; outcome: string; counter: string | null; placement: string | null; artifact_digest: string | null; member: number | null; member_count: number | null; total_positions: number; proof_url: string | null; error?: string }>;
  omitted: number;
  summary: { files: number; directories: number; fused: number; on_record: number; not_fused: number };
}
const textOf = (result: unknown): string => (((result as { content?: unknown }).content ?? []) as Array<{ text: string }>)[0]?.text ?? "";

test("lists the three tools", async () => {
  const client = await connectedClient();
  const tools = await client.listTools();
  const names = tools.tools.map((t) => t.name).sort();
  assert.deepEqual(names, ["bitgraph_check", "bitgraph_get_proof", "bitgraph_record"]);
});

test("record makes ONE set of the fresh files and leaves on-record ones alone", async () => {
  const client = await connectedClient();
  requests.length = 0;
  setCalls.length = 0;
  const result = await client.callTool({
    name: "bitgraph_record",
    arguments: { paths: [fileA, fileB, fileC] },
  });
  assert.ok(!result.isError, JSON.stringify(result.content));
  assert.equal(requests.filter((r) => r.path === "/api/commit" || r.path.startsWith("/api/fuse/")).length, 0, "the stand-in never reaches the boundary; nothing is committed as bytes-only");
  assert.equal(setCalls.length, 1, "one set for the whole call");
  assert.deepEqual(setCalls[0]?.digests, [digestB, digestC], "only the fresh files are members; fileA was on record");
  assert.deepEqual(setCalls[0]?.names, ["b.txt", "c.txt"], "members are named after the files");
  assert.equal(setCalls[0]?.set, "set/1");
  const batch = requests.find((r) => r.path === "/api/proofs/batch");
  if (!batch) throw new Error("no batch check preceded the set");
  const batchBody = batch.body as { digests: string[] };
  assert.ok(batchBody.digests.every((d) => !d.includes("+") && !d.includes("=")), "check uses url-safe digests");
  const structured = result.structuredContent as RecordStructured;
  assert.deepEqual(structured.summary, { files: 3, directories: 0, fused: 2, on_record: 1, not_fused: 0 });
  assert.ok(structured.set, "the set is reported");
  assert.equal(structured.set?.count, 2);
  assert.ok(structured.set?.proof_url.includes("/proof/") && structured.set?.proof_url.includes("counter="), "the set's proof page is pinned to its position");
  const a = structured.results.find((r) => r.path === fileA);
  const b = structured.results.find((r) => r.path === fileB);
  const c = structured.results.find((r) => r.path === fileC);
  assert.equal(a?.outcome, "on record");
  assert.equal(a?.counter, "10", "on-record outcome reports the EARLIEST position");
  assert.equal(a?.member, 3, "an on-record set member reports its row, 1-based");
  assert.equal(a?.member_count, 10);
  assert.equal(b?.outcome, "fused");
  assert.equal(b?.counter, structured.set?.counter, "a fused file's position is the set's");
  assert.equal(b?.placement, "container/2", "text goes in a container");
  assert.equal(b?.member_count, 2);
  assert.ok(b?.member === 1 || b?.member === 2);
  assert.notEqual(b?.member, c?.member, "two members, two rows");
  assert.ok(b?.artifact_digest && !b.artifact_digest.includes("+"), "the member's fused digest, url-safe");
  assert.ok(b?.proof_url?.includes(encodeURIComponent(toUrlSafeB64(digestB))), "the file's own digest finds the set");
  const text = textOf(result);
  assert.ok(text.startsWith("2 files BitGraphed as one set at #"), text);
  assert.ok(text.includes("set of 2"), text);
});

test("a single file is fused on its own, with its Frame; again=true fuses an on-record one", async () => {
  const client = await connectedClient();
  setCalls.length = 0;
  soloCalls.length = 0;
  const result = await client.callTool({
    name: "bitgraph_record",
    arguments: { paths: [fileA], again: true },
  });
  assert.ok(!result.isError, JSON.stringify(result.content));
  assert.equal(setCalls.length, 0, "one file is not a set");
  assert.deepEqual(soloCalls.map((c) => c.digestB64), [digestA]);
  const structured = result.structuredContent as RecordStructured;
  assert.equal(structured.set, null);
  const row = structured.results[0];
  assert.equal(row?.outcome, "fused");
  assert.equal(row?.member, null);
  assert.equal(row?.total_positions, 3, "two prior positions plus the new BitGraph");
  assert.ok(row?.artifact_digest && structured.frames[row.artifact_digest], "the Frame rides in the structured result under the fused digest");
  assert.ok(row?.proof_url?.includes(encodeURIComponent(row.artifact_digest ?? "")), "a single file's proof page is its own");
  const text = textOf(result);
  assert.ok(text.startsWith("1 fused, 0 already on record."), text);
  assert.ok(text.includes("its Frame is in the structured result"), text);
});

test("a directory is its regular files, hidden entries and links left out", async () => {
  const client = await connectedClient();
  setCalls.length = 0;
  const result = await client.callTool({
    name: "bitgraph_record",
    arguments: { paths: [dir] },
  });
  assert.ok(!result.isError, JSON.stringify(result.content));
  assert.deepEqual(setCalls[0]?.names, ["a1.txt", "a2.txt"]);
  const structured = result.structuredContent as RecordStructured;
  assert.deepEqual(structured.summary, { files: 2, directories: 1, fused: 2, on_record: 0, not_fused: 0 });
  assert.equal(structured.set?.count, 2);
});

test("the same bytes under two paths are one file, fused once and reported twice", async () => {
  const client = await connectedClient();
  setCalls.length = 0;
  soloCalls.length = 0;
  const result = await client.callTool({
    name: "bitgraph_record",
    arguments: { paths: [fileB, copyB] },
  });
  assert.ok(!result.isError, JSON.stringify(result.content));
  assert.equal(setCalls.length, 0, "one distinct file is fused on its own");
  assert.deepEqual(soloCalls.map((c) => c.digestB64), [digestB]);
  const structured = result.structuredContent as RecordStructured;
  assert.equal(structured.set, null);
  assert.equal(structured.summary.fused, 2);
  assert.equal(structured.results[0]?.artifact_digest, structured.results[1]?.artifact_digest);
});

test("above the set/1 cap the set is a set/2 and its evidence is indexed in chunks", async () => {
  const client = await connectedClient();
  requests.length = 0;
  setCalls.length = 0;
  indexMode = "ok";
  const progress: string[] = [];
  const result = await client.callTool({ name: "bitgraph_record", arguments: { paths: [bigDir] } }, undefined, {
    onprogress: (p) => {
      if (p.message !== undefined) progress.push(p.message);
    },
  });
  assert.ok(!result.isError, JSON.stringify(result.content).slice(0, 500));
  assert.equal(setCalls[0]?.set, "set/2");
  assert.equal(setCalls[0]?.digests.length, BIG);
  const index = requests.filter((r) => r.path === "/api/fuse/set-index");
  assert.deepEqual(index.map((r) => (r.body as { members: unknown[] }).members.length), [SET_INDEX_CHUNK, BIG - SET_INDEX_CHUNK], "evidence goes in the site's chunks");
  const body = index[0]?.body as { setDigest: string; epoch: string; counter: string };
  assert.ok(!body.setDigest.includes("+") && !body.setDigest.includes("="), "the set digest travels url-safe");
  assert.ok(!body.epoch.includes("+") && !body.epoch.includes("="), "so does the epoch");
  const structured = result.structuredContent as RecordStructured;
  assert.equal(body.counter, structured.set?.counter);
  assert.equal(structured.set?.set, "set/2");
  assert.deepEqual(structured.set?.index, { written: BIG, pending: 0 });
  assert.equal(structured.summary.fused, BIG);
  assert.equal(structured.results.length, ROW_CAP, "the structured rows are capped");
  assert.equal(structured.omitted, BIG - ROW_CAP);
  assert.equal(pendingIndexCount(), 0);
  const text = textOf(result);
  assert.ok(text.includes(`set of ${BIG.toLocaleString("en-US")}`), text.slice(0, 300));
  assert.ok(text.includes("more files in the same set"), "the markdown lists a few rows and counts the rest");
  assert.ok(progress.some((m) => /^hashed \d+ of \d+$/.test(m)), `progress notifications arrived: ${progress.slice(0, 3).join(" | ")}`);
  assert.ok(progress.some((m) => /^indexing \d+ of \d+$/.test(m)), "indexing reports progress too");
});

test("evidence the site cannot index waits, blocks a new set, and is sent first once the site is back", async () => {
  const client = await connectedClient();
  indexMode = "fail";
  const first = await client.callTool({ name: "bitgraph_record", arguments: { paths: [bigDir] } });
  assert.ok(!first.isError, "the set was made; a failed index is reported, not an error");
  const s1 = first.structuredContent as RecordStructured;
  assert.deepEqual(s1.set?.index, { written: 0, pending: BIG });
  assert.equal(pendingIndexCount(), BIG);
  assert.ok(textOf(first).includes("not findable by hash"), textOf(first).slice(0, 400));

  // Still down: nothing new is made, so the members cannot be made again by mistake.
  requests.length = 0;
  setCalls.length = 0;
  const blocked = await client.callTool({ name: "bitgraph_record", arguments: { paths: [fileC] } });
  assert.ok(blocked.isError);
  assert.ok(textOf(blocked).includes("waiting to be indexed"), textOf(blocked));
  assert.equal(setCalls.length, 0, "no set was made");
  assert.ok(!requests.some((r) => r.path === "/api/proofs/batch"), "the ledger was not even checked");
  assert.equal(pendingIndexCount(), BIG);

  // Back: the waiting evidence goes first, then the call proceeds.
  indexMode = "ok";
  requests.length = 0;
  const next = await client.callTool({ name: "bitgraph_record", arguments: { paths: [fileC] } });
  assert.ok(!next.isError, JSON.stringify(next.content).slice(0, 400));
  const firstBatch = requests.findIndex((r) => r.path === "/api/proofs/batch");
  const indexCalls = requests.map((r, i) => ({ i, path: r.path })).filter((r) => r.path === "/api/fuse/set-index");
  assert.equal(indexCalls.length, 2);
  assert.ok(indexCalls.every((r) => r.i < firstBatch), "pending evidence is sent before the ledger check");
  assert.equal(pendingIndexCount(), 0);
  assert.equal((next.structuredContent as RecordStructured).summary.fused, 1);
});

test("a set failure labels every attempted file 'not fused', never 'on record'", async () => {
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
    assert.equal(structured.set, null);
    assert.ok(structured.results.every((r) => r.outcome === "not fused" && r.proof_url === null));
    assert.deepEqual(structured.summary, { files: 2, directories: 0, fused: 0, on_record: 0, not_fused: 2 });
  } finally {
    fuseMode = "ok";
  }
});

test("record surfaces unreadable paths before any network call", async () => {
  const client = await connectedClient();
  requests.length = 0;
  setCalls.length = 0;
  const result = await client.callTool({
    name: "bitgraph_record",
    arguments: { paths: [fileA, "/definitely/missing/file.bin"] },
  });
  assert.ok(result.isError);
  assert.equal(requests.length, 0, "no API call happened; nothing was minted");
  assert.equal(setCalls.length, 0);
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
  assert.ok(text.includes("BitGraphed between 2026-07-01T00:00:00.000Z"));
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
