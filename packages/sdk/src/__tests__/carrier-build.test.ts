// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * buildBitGraphedFile against a server shaped like bitgraph.ing's routes.
 *
 * 0.1.0 could not build a BitGraphed file against production, for two reasons
 * this test pins (found 2026-09-27):
 *   1. /api/proofs/witness answers with the witness object itself; 0.1.0 read a
 *      { witness } envelope the route never sends.
 *   2. The floor was asked for with the COMMIT counter. For a position held while
 *      an anchor landed, that is a later anchor than the one the enclave signed
 *      into the position record, and the floor binding refuses it.
 *
 * The fixture is a real held position: demo2 was reserved at 2871 and committed
 * at 2874, with its signed floor at anchor #2870 (floor2) and the next anchor
 * after the commit at #2876 (ceiling2). The server answers "the anchor before"
 * only for the reserved counter, and records what it was asked.
 */

import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCarrier, type CarrierProof, type CarrierWitness } from "@mikeargento/bitgraph-verify";
import { buildBitGraphedFile } from "../carrier-build.js";
import { BitGraph } from "../bitgraph.js";

const fixtures = fileURLToPath(new URL("../../../verify/src/__tests__/fixtures/carrier/", import.meta.url));
const readJson = <T>(name: string): T => JSON.parse(readFileSync(join(fixtures, name), "utf-8")) as T;

const proof = readJson<{ commit: { counter: string; slotCounter: string; epochId: string } }>("demo2.proof.json");
const floorAnchor = readJson<CarrierProof>("floor2.anchor.json");
const floorWitness = readJson<CarrierWitness>("floor2.witness.json");
const ceilingAnchor = readJson<CarrierProof>("ceiling2.anchor.json");
const ceilingWitness = readJson<CarrierWitness>("ceiling2.witness.json");
const bytes = new Uint8Array(readFileSync(join(fixtures, "demo2.txt")));

let server: Server;
let baseUrl = "";
const asked: string[] = [];

before(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    asked.push(url.pathname + url.search);
    const send = (status: number, payload: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    };
    if (url.pathname.startsWith("/api/proofs/digest/")) return send(200, { proofs: [{ proof }] });
    if (url.pathname === "/api/proofs/anchors") {
      const counter = url.searchParams.get("counter");
      if (url.searchParams.get("before") === "1") {
        // Only the reserved position's floor exists here, as the signed one.
        return counter === proof.commit.slotCounter
          ? send(200, { anchors: [floorAnchor], bound: { state: "anchored" } })
          : send(200, { anchors: [], bound: { state: "none" } });
      }
      return send(200, { anchors: [ceilingAnchor], bound: { state: "anchored" } });
    }
    if (url.pathname === "/api/proofs/witness") {
      // The production shape: the witness object at the top level, no envelope.
      const block = url.searchParams.get("block");
      if (block === String(floorWitness.blockNumber)) return send(200, floorWitness);
      if (block === String(ceilingWitness.blockNumber)) return send(200, ceilingWitness);
      return send(404, { error: "witness unavailable" });
    }
    send(404, { error: "not found" });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  if (addr === null || typeof addr === "string") throw new Error("no port");
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(() => {
  server.close();
});

test("a held position's BitGraphed file: floor asked at the reserved counter, top-level witness read, and it verifies", async () => {
  asked.length = 0;
  const built = await buildBitGraphedFile({ baseUrl }, bytes, "bitgraph-demonstration.txt");
  assert.equal(built.ceiling, "present");
  assert.equal(built.fileName, "bitgraph-demonstration.bitgraph.txt");
  assert.ok(
    asked.some((q) => q.includes(`counter=${proof.commit.slotCounter}`) && q.includes("before=1")),
    `the floor must be asked for at the reserved counter; asked: ${asked.join(" ")}`,
  );
  assert.ok(!asked.some((q) => q.includes(`counter=${proof.commit.counter}`) && q.includes("before=1")), "never at the commit counter");

  const parsed = parseCarrier(built.bytes);
  assert.equal(parsed.kind, "carrier");
  if (parsed.kind !== "carrier") return;
  assert.equal(parsed.payload.floor.status, "present");
  assert.equal((parsed.payload.floor as unknown as { anchor: { commit: { counter: string } } }).anchor.commit.counter, "2870");

  // The same judgment a stranger runs, offline, on the built file.
  const verdict = await new BitGraph({ baseUrl }).verify(built.bytes);
  assert.equal(verdict.verdict, "TRUE", JSON.stringify(verdict).slice(0, 300));
});
