// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * BitGraphed files through the MCP tools, end to end: a real client over an
 * in-memory transport, a mock bitgraph.ing, and REAL carriers built from the
 * verify package's fixture material (real proofs, real anchors, real block
 * headers; nothing minted, no network). The two rules under test:
 *
 *   1. The lookups use the digest of the COMMITTED bytes inside, never the
 *      envelope's, and the carried proof is judged offline (verdict, window).
 *   2. bitgraph_record NEVER mints carrier bytes: the envelope is not the
 *      recorded thing. The fake pipelines fail the test if a carrier reaches
 *      them.
 */

import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  buildCarrier,
  type CarrierPayload,
  type CarrierProof,
  type CarrierWitness,
} from "@mikeargento/bitgraph-verify";
import { buildServer, type FuseFileFn, type FuseSetFn } from "../server.js";
import { toUrlSafeB64 } from "@mikeargento/bitgraph-sdk";
import { sniffC2paBytes, scanFile } from "@mikeargento/bitgraph-sdk";

const fixtures = fileURLToPath(new URL("../../../verify/src/__tests__/fixtures/carrier/", import.meta.url));
const readJson = <T>(name: string): T => JSON.parse(readFileSync(join(fixtures, name), "utf-8")) as T;

let mock: Server;
let completePath = ""; // demo2: floor + ceiling inside
let undevPath = ""; // demo1: floor inside, ceiling unfetched
let corruptPath = ""; // demo2 carrier with a broken payload byte
let plainPath = ""; // an ordinary file that should still mint
let c2paPath = ""; // an ordinary file carrying a synthetic C2PA marker
let innerDigest2 = ""; // standard b64 of demo2's committed bytes
let innerDigest1 = "";
const EPOCH = createHash("sha256").update("carrier-epoch").digest("base64");

before(async () => {
  const root = await mkdtemp(join(tmpdir(), "bitgraph-mcp-carrier-"));

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
  const undeveloped: CarrierPayload = {
    carrier: "bitgraph-carrier/1",
    proof: readJson<CarrierProof>("demo1.proof.json"),
    floor: { status: "present", anchor: readJson<CarrierProof>("floor1.anchor.json"), witness: readJson<CarrierWitness>("floor1.witness.json") },
    ceiling: { status: "unfetched" },
  };

  completePath = join(root, "photo.bitgraph.txt");
  await writeFile(completePath, buildCarrier(demo2, complete));
  undevPath = join(root, "doc.bitgraph.txt");
  await writeFile(undevPath, buildCarrier(demo1, undeveloped));

  // Corrupt: the frame intact (tail magic still matches), one byte of the
  // JSON payload broken, so the block is found but does not parse.
  const corrupt = Buffer.from(buildCarrier(demo2, complete));
  corrupt[demo2.length + 12] = 0x58; // the payload's first byte, "{" -> "X"
  corruptPath = join(root, "broken.bitgraph.txt");
  await writeFile(corruptPath, corrupt);

  plainPath = join(root, "fresh.txt");
  await writeFile(plainPath, "fresh bytes that should mint");

  // A JUMBF description box shape: "jumd", a 16-byte type, a toggle, the "c2pa" label.
  const c2pa = Buffer.concat([
    Buffer.from("leading bytes "),
    Buffer.from("jumd"),
    Buffer.alloc(17, 3),
    Buffer.from("c2pa\0and the rest of the file"),
  ]);
  c2paPath = join(root, "credentialed.bin");
  await writeFile(c2paPath, c2pa);

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
        const results: Record<string, { proofs: Array<{ proof: unknown; member?: unknown }> }> = {};
        for (const d of digests) {
          // Only demo2's COMMITTED bytes are in this ledger; the envelope digests never are.
          results[d] =
            d === toUrlSafeB64(innerDigest2)
              ? { proofs: [{ proof: { artifact: { digestB64: innerDigest2 }, commit: { counter: "2874", epochId: EPOCH } } }] }
              : { proofs: [] };
        }
        send(200, { results });
      } else if (url.pathname.startsWith("/api/proofs/digest/")) {
        const digest = decodeURIComponent(url.pathname.split("/").pop() ?? "");
        if (digest === toUrlSafeB64(innerDigest2)) {
          send(200, {
            proofs: [{ proof: { artifact: { digestB64: innerDigest2 }, commit: { counter: "2874", epochId: EPOCH } } }],
            positions: [{ counter: "2874", epoch: toUrlSafeB64(EPOCH), lowerTime: null, upperTime: null }],
            causalWindow: null,
          });
        } else {
          send(200, { proofs: [] });
        }
      } else {
        send(404, { error: `unexpected ${url.pathname}` });
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

/** The pipelines fail the test when carrier bytes reach them. */
const fusedNames: string[] = [];
const guardFuseFile: FuseFileFn = async (file) => {
  assert.ok(!file.name.includes(".bitgraph."), `a BitGraphed file reached the mint: ${file.name}`);
  fusedNames.push(file.name);
  const artifactDigestB64 = createHash("sha256").update("fused:" + file.digestB64).digest("base64");
  return {
    proof: { version: "bitgraph/1", artifact: { digestB64: artifactDigestB64 }, commit: { counter: "500", epochId: EPOCH } },
    frame: { type: "bitgraph-fuse/1" },
    placement: file.placement,
    artifactDigestB64,
    originDigestB64: file.digestB64,
  };
};
const guardFuseSet: FuseSetFn = async (files) => {
  for (const f of files) assert.ok(!f.name.includes(".bitgraph."), `a BitGraphed file reached the set mint: ${f.name}`);
  throw new Error("no set expected in these tests");
};

async function connectedClient(): Promise<Client> {
  const server = buildServer({ fuseSet: guardFuseSet, fuseFile: guardFuseFile });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

const textOf = (result: unknown): string => ((result as { content: Array<{ text: string }> }).content[0] as { text: string }).text;
const structuredOf = <T>(result: unknown): T => (result as { structuredContent: T }).structuredContent;

test("check: a BitGraphed file is judged offline and looked up by its committed bytes", async () => {
  const client = await connectedClient();
  const result = await client.callTool({ name: "bitgraph_check", arguments: { paths: [completePath, undevPath, corruptPath, c2paPath] } });
  const text = textOf(result);
  const { results } = structuredOf<{ results: Array<Record<string, unknown>> }>(result);

  const complete = results.find((r) => r["input"] === completePath) as Record<string, unknown>;
  assert.equal(complete["on_record"], true);
  assert.equal(complete["digest"], toUrlSafeB64(innerDigest2), "the lookup digest is the committed bytes', not the envelope's");
  const view = complete["carrier"] as { verdict: string; not_before: { block: number }; not_after: { block: number } };
  assert.equal(view.verdict, "TRUE");
  assert.ok(view.not_before.block > 0 && view.not_after.block > view.not_before.block);

  const undev = results.find((r) => r["input"] === undevPath) as Record<string, unknown>;
  assert.equal(undev["on_record"], false);
  const undevView = undev["carrier"] as { verdict: string; not_after: unknown; ceiling: string };
  assert.equal(undevView.verdict, "TRUE");
  assert.equal(undevView.not_after, null);
  assert.equal(undevView.ceiling, "unfetched");
  assert.ok(text.includes("not in this ledger"), "a foreign carrier is stated, not called unrecorded");
  assert.ok(text.includes("NOT FETCHED"), "an absent ceiling is stated in those words");

  const corrupt = results.find((r) => r["input"] === corruptPath) as Record<string, unknown>;
  assert.equal(corrupt["on_record"], false);
  assert.ok(String(corrupt["note"]).includes("unreadable"), "a corrupt block is a stated condition");
  assert.ok(text.includes("not judged"), "a corrupt carrier is not judged, not 'not on record'");

  const credentialed = results.find((r) => r["input"] === c2paPath) as Record<string, unknown>;
  assert.equal(credentialed["c2pa"], true);
  assert.ok(text.includes("Content Credentials (C2PA) detected"));
});

test("record: carrier bytes never mint; the plain file still does", async () => {
  fusedNames.length = 0;
  const client = await connectedClient();
  const result = await client.callTool({ name: "bitgraph_record", arguments: { paths: [completePath, undevPath, plainPath] } });
  const text = textOf(result);
  const { summary, results } = structuredOf<{ summary: Record<string, number>; results: Array<Record<string, unknown>> }>(result);

  assert.deepEqual(fusedNames, ["fresh.txt"], "exactly the plain file reached the mint");
  assert.equal(summary["fused"], 1);
  assert.equal(summary["on_record"], 1, "the ledger-confirmed carrier reports as on record");
  assert.equal(summary["carried"], 1, "the foreign carrier reports as carried, nothing minted");
  assert.equal(summary["not_fused"], 0);

  const onRecord = results.find((r) => r["outcome"] === "on record") as Record<string, unknown>;
  assert.equal(onRecord["digest"], toUrlSafeB64(innerDigest2));
  assert.equal((onRecord["carrier"] as { verdict: string }).verdict, "TRUE");

  const carried = results.find((r) => r["outcome"] === "carried") as Record<string, unknown>;
  assert.equal(carried["digest"], toUrlSafeB64(innerDigest1));
  assert.ok(text.includes("nothing minted"), "the markdown states the envelope rule");
});

test("record: a corrupt carrier is refused loudly and never minted", async () => {
  fusedNames.length = 0;
  const client = await connectedClient();
  const result = await client.callTool({ name: "bitgraph_record", arguments: { paths: [corruptPath] } });
  assert.equal((result as { isError?: boolean }).isError, true);
  assert.deepEqual(fusedNames, [], "nothing reached the mint");
  assert.ok(textOf(result).includes("unreadable"), "the reason names the corrupt block");
});

test("get_proof: a path to a foreign BitGraphed file answers offline from the proof inside", async () => {
  const client = await connectedClient();
  const result = await client.callTool({ name: "bitgraph_get_proof", arguments: { path: undevPath } });
  const text = textOf(result);
  assert.ok(text.includes("Judged offline from the proof this BitGraphed file carries"), text);
  assert.ok(text.includes("carried proof TRUE"));
  assert.ok(text.includes("NOT FETCHED"));
});

test("get_proof: a ledger-known BitGraphed file uses the ledger and states the carried verdict", async () => {
  const client = await connectedClient();
  const result = await client.callTool({ name: "bitgraph_get_proof", arguments: { path: completePath } });
  const text = textOf(result);
  assert.ok(text.includes("#2874"), text);
  assert.ok(text.includes("carries its own proof (carried proof TRUE"), text);
});

test("c2pa sniff: the pair must be jumd then c2pa, near, in that order", async () => {
  assert.equal(sniffC2paBytes(Buffer.concat([Buffer.from("jumd"), Buffer.alloc(17), Buffer.from("c2pa")])), true);
  assert.equal(sniffC2paBytes(Buffer.from("c2pa then jumd the wrong way round")), false);
  assert.equal(sniffC2paBytes(Buffer.from("jumd alone")), false);
  assert.equal(sniffC2paBytes(Buffer.concat([Buffer.from("jumd"), Buffer.alloc(200), Buffer.from("c2pa")])), false, "too far apart");
  // Streaming: the pair split across a 64 KiB read boundary is still seen.
  const size = 64 * 1024;
  const split = Buffer.alloc(size + 40);
  Buffer.from("jumd").copy(split, size - 2);
  Buffer.from("c2pa").copy(split, size + 19);
  const root = await mkdtemp(join(tmpdir(), "bitgraph-mcp-c2pa-"));
  const p = join(root, "split.bin");
  await writeFile(p, split);
  const scanned = await scanFile(p);
  assert.equal(scanned.c2pa, true, "a pair straddling the chunk boundary is detected");
});
