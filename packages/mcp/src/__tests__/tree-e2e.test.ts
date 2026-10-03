// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * bitgraph_record with the server's DEFAULT pipeline (the SDK's tree pipeline
 * over the core's fuseTree) against a local boundary that hands out signed
 * slots with their floor and mints signed proofs from the commit bodies it
 * receives. The export the tool writes is read back and every file is
 * checked against it with verifyExport. Nothing leaves 127.0.0.1.
 */

import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { getPublicKeyAsync, signAsync } from "@noble/ed25519";
import { canonicalize, canonicalSlotBody, evmBytesToHex, keccak256, rlpEncode, verifyExport, type SlotAllocation } from "@mikeargento/bitgraph-verify";
import { readExportFile } from "@mikeargento/bitgraph-sdk";
import { buildServer } from "../server.js";

const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");
const sha = (b: Uint8Array | string) => new Uint8Array(createHash("sha256").update(b).digest());
const EPOCH = b64(sha("mcp-tree-epoch"));
const FLOOR_NUMBER = 25_700_000;

function u(n: number): Uint8Array {
  let h = n.toString(16);
  if (h.length % 2) h = "0" + h;
  return Uint8Array.from(Buffer.from(h, "hex"));
}
const z32 = new Uint8Array(32);
const floorHeader = rlpEncode([z32, z32, new Uint8Array(20), z32, z32, z32, new Uint8Array(256), new Uint8Array(0), u(FLOOR_NUMBER), u(30_000_000), u(21_000), u(1_790_200_000), new Uint8Array(0), z32, new Uint8Array(8), u(1000)]);
const floorHash = evmBytesToHex(keccak256(floorHeader));

let boundary: Server;
let priv: Uint8Array;
let pub = "";
let counter = 2000;
let folder = "";
const SPEC_TEXT = new Uint8Array(await readFile(fileURLToPath(new URL("../../../../spec/SPEC.md", import.meta.url))));
// The site's create-only recovery store and proofs by artifact digest, in memory.
const recoveryEntries = new Map<string, string>();
const minted = new Map<string, unknown[]>();
const toUrlSafe = (s: string) => s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

before(async () => {
  priv = randomBytes(32);
  pub = b64(await getPublicKeyAsync(priv));
  const root = await mkdtemp(join(tmpdir(), "bitgraph-mcp-tree-e2e-"));
  folder = join(root, "work");
  await mkdir(folder);
  await writeFile(join(folder, "notes.md"), "# notes\nmade by hand\n");
  await writeFile(join(folder, "frame.png"), Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("png-shaped bytes")]));
  boundary = createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      void (async () => {
        const url = new URL(req.url ?? "/", "http://localhost");
        const send = (status: number, payload: unknown) => {
          res.writeHead(status, { "Content-Type": "application/json" });
          res.end(JSON.stringify(payload));
        };
        const body = raw.length > 0 ? (JSON.parse(raw) as Record<string, unknown>) : {};
        if (url.pathname === "/api/proofs/batch") {
          send(200, { results: Object.fromEntries((body["digests"] as string[]).map((d) => [d, { proofs: [] }])) });
        } else if (url.pathname === "/api/fuse/allocate") {
          counter += 10;
          const slotBody = { version: "bitgraph/slot/1" as const, nonceB64: b64(randomBytes(32)), counter: String(counter), epochId: EPOCH, publicKeyB64: pub, chainId: "bitgraph:main" };
          const slot = { ...slotBody, signatureB64: b64(await signAsync(canonicalize(slotBody as never), priv)) };
          send(200, { slotId: slot.nonceB64, slot, chainId: "bitgraph:main", anchor: { counter: String(counter - 1), blockNumber: FLOOR_NUMBER, blockHash: floorHash } });
        } else if (url.pathname === "/api/fuse/commit") {
          const slot = body["slot"] as SlotAllocation;
          const commit = {
            nonceB64: slot.nonceB64, counter: String(Number(slot.counter) + 2), epochId: slot.epochId, slotCounter: slot.counter,
            slotHashB64: b64(sha(canonicalize(canonicalSlotBody(slot) as never))), slotAnchor: body["anchor"], chainId: "bitgraph:main",
          };
          const artifact = { hashAlg: "sha256", digestB64: (body["digests"] as Array<{ digestB64: string }>)[0]!.digestB64 };
          const signed = { version: "bitgraph/1", artifact, commit, publicKeyB64: pub, enforcement: "stub", measurement: "mcp-tree-e2e", attribution: body["attribution"] };
          const signatureB64 = b64(await signAsync(canonicalize(signed as never), priv));
          const proof = { version: "bitgraph/1", artifact, commit, signer: { publicKeyB64: pub, signatureB64 }, environment: { enforcement: "stub", measurement: "mcp-tree-e2e" }, attribution: body["attribution"], slotAllocation: slot, metadata: body["metadata"] };
          minted.set(toUrlSafe(artifact.digestB64), [...(minted.get(toUrlSafe(artifact.digestB64)) ?? []), proof]);
          send(200, { proof });
        } else if (url.pathname === "/api/recovery" && req.method === "POST") {
          send(200, {
            results: (body["entries"] as Array<{ key: string; envelope: string }>).map(({ key, envelope }) => {
              const held = recoveryEntries.get(key);
              if (held !== undefined) return { key, status: "exists", envelope: held };
              recoveryEntries.set(key, envelope);
              return { key, status: "created" };
            }),
          });
        } else if (url.pathname.startsWith("/api/recovery/")) {
          const address = url.pathname.slice("/api/recovery/".length);
          const entries = [...recoveryEntries.entries()].filter(([k]) => k.startsWith(`recovery/v1/${address}/`)).sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, envelope]) => ({ key, envelope }));
          send(200, { address, entries, next: null });
        } else if (url.pathname.startsWith("/api/proofs/") && req.method === "GET" && url.pathname !== "/api/proofs/witness") {
          send(200, { proofs: (minted.get(decodeURIComponent(url.pathname.slice("/api/proofs/".length))) ?? []).map((proof) => ({ proof })) });
        } else if (url.pathname === "/spec/SPEC.md") {
          res.writeHead(200, { "Content-Type": "text/markdown" });
          res.end(Buffer.from(SPEC_TEXT));
        } else if (url.pathname === "/api/proofs/witness") {
          send(200, { version: "bitgraph-anchor-witness/1", headerRlpHex: evmBytesToHex(floorHeader), blockNumber: FLOOR_NUMBER, blockHash: floorHash });
        } else {
          send(404, { error: `unexpected ${url.pathname}` });
        }
      })();
    });
  });
  await new Promise<void>((resolve) => boundary.listen(0, "127.0.0.1", resolve));
  const addr = boundary.address();
  if (addr === null || typeof addr === "string") throw new Error("no port");
  process.env["BITGRAPH_API_URL"] = `http://127.0.0.1:${addr.port}`;
  delete process.env["BITGRAPH_API_KEY"];
});

after(() => {
  boundary.close();
  delete process.env["BITGRAPH_API_URL"];
});

test("the default pipeline makes a signed tree/1 and the export it writes proves every file", async () => {
  const server = buildServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  const result = await client.callTool({ name: "bitgraph_record", arguments: { paths: [folder], response_format: "json" } });
  assert.ok(!result.isError, JSON.stringify(result.content).slice(0, 600));
  const s = result.structuredContent as { tree: { count: number; floor_block: number; export: { owner: string; dir: string; spec: string | null; floor_header: boolean } }; results: Array<{ path: string; member: number; placement: string }> };
  assert.equal(s.tree.count, 2);
  assert.equal(s.tree.floor_block, FLOOR_NUMBER);
  assert.equal(s.tree.export.dir, dirname(folder), "beside the folder, never inside it");
  assert.equal(s.tree.export.floor_header, true);
  assert.equal(s.tree.export.spec, join(dirname(folder), "SPEC.md"), "the rules the proof pins, beside the export");
  assert.deepEqual(new Uint8Array(await readFile(s.tree.export.spec!)), SPEC_TEXT);
  const full = JSON.parse((result.content as Array<{ text: string }>)[0]!.text) as { tree: { proof: { attribution: { name: string; title: string } } } };
  assert.deepEqual([full.tree.proof.attribution.name, full.tree.proof.attribution.title], ["bitgraph-fuse/2", "tree/1"], "the json result carries the signed proof");
  const owner = await readExportFile(s.tree.export.owner);
  assert.deepEqual([...owner.tree.names!].sort(), ["frame.png", "notes.md"]);
  for (const row of s.results) {
    const v = await verifyExport(owner, { bytes: new Uint8Array(await readFile(row.path)) });
    for (const c of v.claims.filter((x) => x.level === "offline")) {
      const want = c.id === "attestation.signature" ? "FALSE" : c.id === "ceiling.base" || c.id === "ceiling.ethereum" ? "NOT_CARRIED" : "TRUE";
      assert.equal(c.result, want, `${row.path}: ${c.id} ${c.detail}`);
    }
    assert.equal(v.member?.index, row.member - 1);
    assert.equal(v.member?.placement, row.placement);
  }
});

test("recovery: the tree keeps a sealed entry per file, and recording the same files again finds them on record in that tree", async () => {
  const kept = join(dirname(folder), "kept");
  await mkdir(kept, { recursive: true });
  await writeFile(join(kept, "a.txt"), "kept a\n");
  await writeFile(join(kept, "b.png"), Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("kept b")]));
  const server = buildServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  type Out = { tree: { count: number; proof_url: string; counter: string; recovery: { entries: number; written: number; pending: number } | null } | null; results: Array<{ path: string; outcome: string; member: number | null; member_count: number | null; proof_url: string | null; counter: string | null }> };
  const first = await client.callTool({ name: "bitgraph_record", arguments: { paths: [kept], response_format: "json" } });
  assert.ok(!first.isError, JSON.stringify(first.content).slice(0, 600));
  const made = (first.structuredContent as Out).tree!;
  assert.deepEqual(made.recovery, { entries: 4, written: 4, already_there: 0, blocked: 0, pending: 0, reason: null });
  const members = new Map((first.structuredContent as Out).results.map((r) => [r.path, r.member]));

  const again = await client.callTool({ name: "bitgraph_record", arguments: { paths: [kept] } });
  assert.ok(!again.isError, JSON.stringify(again.content).slice(0, 600));
  const s = again.structuredContent as Out;
  assert.equal(s.tree, null, "nothing was made");
  for (const r of s.results) {
    assert.equal(r.outcome, "on record", r.path);
    assert.equal(r.counter, made.counter);
    assert.equal(r.member, members.get(r.path));
    assert.equal(r.member_count, 2);
    assert.equal(r.proof_url, made.proof_url, "the tree's proof page");
  }
  const text = (again.content as Array<{ text: string }>)[0]!.text;
  assert.ok(text.startsWith("0 fused, 2 already on record."), text);

  const off = await client.callTool({ name: "bitgraph_record", arguments: { paths: [kept], recovery: false, response_format: "json" } });
  const offTree = (off.structuredContent as Out).tree;
  assert.equal(offTree?.count, 2, "recovery=false: the plain-hash index alone, so the files are made again");
  assert.equal(offTree?.recovery, null);
});
