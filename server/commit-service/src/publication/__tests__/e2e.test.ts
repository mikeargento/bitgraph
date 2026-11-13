// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * End to end on this machine: the real parent (src/parent/server.ts) over the local enclave harness (the enclave's own
 * app.ts with a software NSM), the publisher binding each floor through the parent's POST /commit, and a fake Base
 * node. Then a second enclave run (a new epoch, a new key), as the nightly rotation makes one. Every publication block
 * is checked with the audit package's offline check, and every proof with the verifier's integrity check. Nothing
 * here reaches the network beyond 127.0.0.1.
 */

import { test, after } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { verifyPublication, checkHourChain, type HourRecord, type PublicationBlock } from "@mikeargento/bitgraph-audit";
import { BaseChain } from "../base.js";
import { fileStore, parentBind, parentOpenEpoch, safeEpoch, type Line, type StoredProof } from "../ledger.js";
import { Publisher } from "../publisher.js";
import { FakeBase } from "./fake-base.js";

const HOUR = 3_600_000;
// The local enclave harness (local-enclave/lib.mts) sits outside this package's source root, so it is loaded at run time.
type Stack = { parentUrl: string; stop(): void };
const harness = (await import(new URL("../../../local-enclave/lib.mts", import.meta.url).href)) as {
  startStack(o: { quiet?: boolean }): Promise<Stack>;
  post(url: string, body: unknown): Promise<{ status: number; json: unknown }>;
  randomDigestB64(): string;
};
const { startStack, post, randomDigestB64 } = harness;
const dir = mkdtempSync(join(tmpdir(), "bg-publication-e2e-"));
const fake = new FakeBase();
const account = privateKeyToAccount(generatePrivateKey());
const made = new Map<string, StoredProof[]>();
let stack: Stack | null = null;
after(() => { stack?.stop(); fake.stop(); rmSync(dir, { recursive: true, force: true }); });

function keep(p: Record<string, unknown>): Record<string, unknown> {
  const c = p["commit"] as { epochId: string; counter: string };
  const l = made.get(c.epochId) ?? [];
  l.push({ counter: Number(c.counter), proof: p });
  made.set(c.epochId, l);
  return p;
}
async function commit(n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    const r = await post(`${stack!.parentUrl}/commit`, { digests: [{ digestB64: randomDigestB64(), hashAlg: "sha256" }] });
    assert.equal(r.status, 200, JSON.stringify(r.json).slice(0, 200));
    const p = { ...(r.json as Array<Record<string, unknown>>)[0]! };
    delete p["proofHash"];
    keep(p);
  }
}

const line: Line = {
  openEpoch: () => parentOpenEpoch(stack!.parentUrl),
  proofs: async (e, after) => (made.get(e) ?? []).filter((p) => p.counter > after).sort((a, b) => a.counter - b.counter),
};

test("the publisher over the real parent and enclave, across a new epoch", { timeout: 180_000 }, async () => {
  await fake.start();
  stack = await startStack({ quiet: true });
  let now = Date.UTC(2026, 10, 13, 5, 0, 10);
  const p = new Publisher({
    stateDir: join(dir, "state"),
    chain: new BaseChain({ chainId: 8453, rpcUrl: fake.url, account }),
    line,
    store: fileStore(join(dir, "store")),
    bind: async (d) => keep(await parentBind(stack!.parentUrl, d)),
    intervalMs: HOUR, replaceAfterBlocks: 3, confirmations: 2, finalGraceMs: 60_000, finalMaxWaitMs: 60_000, now: () => now, log: () => {},
  });
  const land = async () => { fake.mine(); assert.equal(await p.tick(), "confirming"); fake.skip(2); assert.equal(await p.tick(), "published"); };
  const hour = async () => { assert.match(await p.tick(), /sent/); await land(); };

  const e1 = (await parentOpenEpoch(stack.parentUrl))!;
  await commit(3);
  await hour();                          // hour 1: the three, then a floor
  await commit(2); now += HOUR; await hour(); // hour 2: the floor and two more, then a floor

  // The nightly rotation: a new enclave run is a new epoch.
  stack.stop();
  stack = await startStack({ quiet: true });
  const e2 = (await parentOpenEpoch(stack.parentUrl))!;
  assert.notEqual(e2, e1);
  await commit(1);
  // The local stop binds no closing BitGraph here, so the old epoch's last write goes out after the longest wait.
  assert.equal(await p.tick(), "waiting-for-close");
  now += 60_000; assert.equal(await p.tick(), "final-sent");
  await land(); // its floor is bound in the new epoch
  await commit(2); now += HOUR; await hour();

  const readBlock = (e: string, c: number) => JSON.parse(readFileSync(join(dir, "store", "publication", "proofs", safeEpoch(e), `${String(c).padStart(12, "0")}.json`), "utf8")) as PublicationBlock;
  let checked = 0, withFloor = 0;
  for (const e of [e1, e2]) {
    for (const { counter, proof } of made.get(e)!) {
      let blk: PublicationBlock;
      try { blk = readBlock(e, counter); } catch { continue; } // the newest floor is not published yet
      // The whole check: the block against its write, and both the proof's and its floor's signatures.
      const r = await verifyPublication({ ...proof, metadata: { ...(proof["metadata"] as object ?? {}), "bitgraph-publication/1": blk } }, { writer: account.address.toLowerCase() });
      assert.deepEqual(r.problems, [], `${e.slice(0, 6)} #${counter}`);
      checked++;
      if (r.floor) withFloor++;
    }
  }
  assert.ok(checked >= 10, `checked ${checked}`);
  assert.ok(withFloor >= 4, `with a floor: ${withFloor}`);
  const hoursOf = (e: string) => readdirSync(join(dir, "store", "publication", "hours", safeEpoch(e))).sort().map((f) => JSON.parse(readFileSync(join(dir, "store", "publication", "hours", safeEpoch(e), f), "utf8")) as HourRecord);
  const all = [...hoursOf(e1), ...hoursOf(e2)];
  assert.deepEqual(checkHourChain(all).problems, []);
  assert.equal(all.length, 4);
});
