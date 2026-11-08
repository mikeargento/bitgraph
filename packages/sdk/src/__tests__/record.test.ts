// Copyright (c) 2025-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * record against a mocked fetch: no network, nothing is ever bound. The fake
 * site answers the same routes the drop box calls (the batch lookup, the
 * bind, the tree index) and records every request, so the tests pin what
 * goes out: one new file binds its own SHA-256; several bind one tree's root
 * text and index each file under its own hash; files on record, proof files
 * and BitGraphed files are never bound; a lookup that fails binds nothing.
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, access } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCarrier, checkTreeMember, parseDigestTreeRootText, treeMemberOf, type CarrierPayload, type CarrierProof, type CarrierWitness } from "@mikeargento/bitgraph-verify";
import { BitGraph } from "../bitgraph.js";
import { ApiError } from "../api.js";
import { leafOfDigest, memberPath, proofPathFor, sortedLeaves, treeFromLeaves } from "../record.js";
import { toUrlSafeB64 } from "../encoding.js";

const BASE = "https://site.test";
const EPOCH = createHash("sha256").update("record-epoch").digest("base64");
const sha = (s: string | Uint8Array) => createHash("sha256").update(s).digest("base64");

interface Call { method: string; path: string; body: unknown; auth: string | null }

/** A fake site behind globalThis.fetch. `known` digests are on record already; `ledger` can be made to fail. */
function fakeSite(opts: { known?: Map<string, string>; ledger?: "ok" | "error" | "unavailable"; bind?: "ok" | "restarting" } = {}) {
  const calls: Call[] = [];
  let counter = 500;
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL, init?: { method?: string; body?: string; headers?: Record<string, string> }) => {
    const url = new URL(String(input));
    const body = init?.body !== undefined ? (JSON.parse(init.body) as unknown) : null;
    calls.push({ method: init?.method ?? "GET", path: url.pathname, body, auth: init?.headers?.["Authorization"] ?? null });
    const json = (status: number, payload: unknown) => new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
    if (url.pathname === "/api/proofs/batch") {
      if (opts.ledger === "error") return json(500, { error: "ledger down" });
      const results: Record<string, unknown> = {};
      for (const d of (body as { digests: string[] }).digests) {
        if (opts.ledger === "unavailable") { results[d] = { proofs: [], unavailable: true }; continue; }
        const counterOf = opts.known?.get(d);
        results[d] = { proofs: counterOf !== undefined ? [{ proof: { artifact: { digestB64: d }, commit: { counter: counterOf, epochId: EPOCH, nonceB64: "old-nonce" } }, kind: "recorded" }] : [] };
      }
      return json(200, { results });
    }
    if (url.pathname === "/api/commit") {
      if (opts.bind === "restarting") return json(503, { error: "restarting" });
      const d = (body as { digests: Array<{ digestB64: string }> }).digests;
      return json(200, d.map((x) => {
        counter += 2;
        return {
          version: "bitgraph/1",
          artifact: { hashAlg: "sha256", digestB64: x.digestB64 },
          commit: { nonceB64: sha(`nonce-${counter}`), slotCounter: String(counter - 1), counter: String(counter), epochId: EPOCH, prevB64: sha(`prev-${counter}`), atomic: true },
          proofHash: "site-added",
        };
      }));
    }
    if (url.pathname === "/api/tree-members") {
      const b = body as { members: unknown[] };
      return json(200, { written: b.members.length, failed: 0, rejected: 0 });
    }
    return json(404, { error: `unexpected ${url.pathname}` });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = real; } };
}

const exists = (p: string) => access(p).then(() => true, () => false);

test("one new file: its own SHA-256 is bound once, the proof saved beside it, the nonce and both counts returned", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bitgraph-record-one-"));
  const file = join(dir, "run.log");
  await writeFile(file, "one run");
  const site = fakeSite();
  try {
    const r = await new BitGraph({ baseUrl: BASE, apiKey: "k" }).record(file);
    const binds = site.calls.filter((c) => c.path === "/api/commit");
    assert.equal(binds.length, 1);
    assert.deepEqual(binds[0]!.body, { digests: [{ digestB64: sha("one run"), hashAlg: "sha256" }], chainId: "bitgraph:main" });
    assert.equal(binds[0]!.auth, "Bearer k");
    assert.ok(site.calls.findIndex((c) => c.path === "/api/proofs/batch") < site.calls.findIndex((c) => c.path === "/api/commit"), "looked up before bound");
    assert.ok(!site.calls.some((c) => c.path === "/api/tree-members"), "one file is no tree");

    assert.equal(r.made?.kind, "file");
    assert.equal(r.made?.digestB64, sha("one run"));
    assert.equal(r.made?.nonce, sha("nonce-502"));
    assert.deepEqual(r.made?.counts, ["501", "502"]);
    assert.equal(r.made?.number, "502");
    assert.equal(r.made?.prev, sha("prev-502"));
    assert.equal(r.made?.tree, null);
    assert.equal(r.made?.proofUrl, `${BASE}/proof/${toUrlSafeB64(sha("one run"))}?counter=502&epoch=${toUrlSafeB64(EPOCH)}`);

    const [f] = r.files;
    assert.equal(f?.outcome, "made");
    assert.equal(f?.nonce, r.made?.nonce);
    assert.equal(f?.proofPath, proofPathFor(file));
    const saved = JSON.parse(await readFile(proofPathFor(file), "utf8")) as Record<string, unknown>;
    assert.ok(!("proofHash" in saved), "saved as the enclave signed it");
    assert.equal((saved["artifact"] as { digestB64: string }).digestB64, sha("one run"));
  } finally { site.restore(); }
});

test("several new files: one tree, one BitGraph of its root text, each file indexed and given its own member proof", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bitgraph-record-tree-"));
  await mkdir(join(dir, "sub"));
  const files = { b: join(dir, "b.txt"), a: join(dir, "a.txt"), c: join(dir, "sub", "c.txt") };
  await writeFile(files.a, "alpha");
  await writeFile(files.b, "beta");
  await writeFile(files.c, "gamma");
  const site = fakeSite();
  try {
    const r = await new BitGraph({ baseUrl: BASE }).record([dir]);
    const binds = site.calls.filter((c) => c.path === "/api/commit");
    assert.equal(binds.length, 1, "several files are one BitGraph");
    const m = r.made!;
    assert.equal(m.kind, "tree");
    assert.equal(m.tree?.files, 3);
    const parsed = parseDigestTreeRootText(m.tree!.rootText);
    assert.deepEqual(parsed, { files: 3, root: m.tree!.root });
    assert.equal(m.digestB64, sha(m.tree!.rootText), "the root text is what is bound");
    assert.deepEqual(binds[0]!.body, { digests: [{ digestB64: m.digestB64, hashAlg: "sha256" }], chainId: "bitgraph:main" });

    // The same tree the site builds: leaves sorted by name.
    const expected = treeFromLeaves(sortedLeaves([["b.txt", leafOfDigest(sha("beta")), sha("beta")], ["a.txt", leafOfDigest(sha("alpha")), sha("alpha")], ["sub/c.txt", leafOfDigest(sha("gamma")), sha("gamma")]]));
    assert.equal(m.tree!.root, expected.root);
    assert.deepEqual(expected.leaves.map((l) => l[0]), ["a.txt", "b.txt", "sub/c.txt"]);

    const index = site.calls.filter((c) => c.path === "/api/tree-members");
    assert.equal(index.length, 1);
    const sent = index[0]!.body as { rootDigestB64: string; epochId: string; counter: string; rootText: string; members: Array<{ digestB64: string; index: number; path: string }> };
    assert.equal(sent.rootDigestB64, m.digestB64);
    assert.equal(sent.counter, m.number);
    assert.equal(sent.epochId, EPOCH);
    assert.equal(sent.rootText, m.tree!.rootText);
    assert.deepEqual(sent.members.map((x) => x.index), [0, 1, 2]);
    assert.equal(sent.members[1]!.path, memberPath(expected, 1));
    assert.equal(m.tree!.indexed, 3);
    assert.equal(m.tree!.indexError, null);

    for (const [name, path] of Object.entries(files)) {
      const f = r.files.find((x) => x.path === path)!;
      assert.equal(f.outcome, "made", name);
      assert.equal(f.nonce, m.nonce, "every file names the nonce of the one BitGraph");
      assert.equal(f.member?.files, 3);
      const saved = JSON.parse(await readFile(proofPathFor(path), "utf8")) as unknown;
      assert.ok(treeMemberOf(saved) !== null, `${name}: the member block is in the saved proof`);
      assert.ok(checkTreeMember(saved, f.digestB64), `${name}: its own hash walks up to the root the proof binds`);
      assert.ok(!checkTreeMember(saved, sha("not this file")));
    }
  } finally { site.restore(); }
});

test("files already on record are not bound again; with every file on record nothing is made", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bitgraph-record-known-"));
  const old = join(dir, "old.txt"), fresh = join(dir, "new.txt");
  await writeFile(old, "seen before");
  await writeFile(fresh, "never seen");
  const site = fakeSite({ known: new Map([[toUrlSafeB64(sha("seen before")), "77"]]) });
  try {
    const r = await new BitGraph({ baseUrl: BASE }).record([old, fresh]);
    const binds = site.calls.filter((c) => c.path === "/api/commit");
    assert.equal(binds.length, 1);
    assert.deepEqual(binds[0]!.body, { digests: [{ digestB64: sha("never seen"), hashAlg: "sha256" }], chainId: "bitgraph:main" }, "the one new file is bound alone");
    assert.equal(r.made?.kind, "file");
    const o = r.files.find((f) => f.path === old)!;
    assert.equal(o.outcome, "on record");
    assert.equal(o.number, "77");
    assert.equal(o.nonce, "old-nonce");
    assert.equal(o.proofPath, null);
    assert.equal(await exists(proofPathFor(old)), false);

    site.calls.length = 0;
    const again = await new BitGraph({ baseUrl: BASE }).record(old);
    assert.equal(again.made, null);
    assert.ok(!site.calls.some((c) => c.path === "/api/commit"));
  } finally { site.restore(); }
});

test("a lookup that fails or is partly unavailable binds nothing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bitgraph-record-blind-"));
  const file = join(dir, "x.txt");
  await writeFile(file, "x");
  for (const ledger of ["error", "unavailable"] as const) {
    const site = fakeSite({ ledger });
    try {
      await assert.rejects(new BitGraph({ baseUrl: BASE }).record(file), (e: unknown) => e instanceof ApiError && /nothing was made/.test(e.message));
      assert.ok(!site.calls.some((c) => c.path === "/api/commit"), ledger);
      assert.equal(await exists(proofPathFor(file)), false);
    } finally { site.restore(); }
  }
});

test("proof files and BitGraphed files are skipped; write: false saves nothing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bitgraph-record-skip-"));
  const plain = join(dir, "plain.txt");
  await writeFile(plain, "plain bytes");
  await writeFile(join(dir, "older.txt.bitgraph.json"), "{}");
  const fixtures = fileURLToPath(new URL("../../../verify/src/__tests__/fixtures/carrier/", import.meta.url));
  const readJson = <T>(name: string): T => JSON.parse(readFileSync(join(fixtures, name), "utf-8")) as T;
  const payload: CarrierPayload = {
    carrier: "bitgraph-carrier/1",
    proof: readJson<CarrierProof>("demo1.proof.json"),
    floor: { status: "present", anchor: readJson<CarrierProof>("floor1.anchor.json"), witness: readJson<CarrierWitness>("floor1.witness.json") },
    ceiling: { status: "unfetched" },
  };
  await writeFile(join(dir, "doc.bitgraph.txt"), buildCarrier(new Uint8Array(readFileSync(join(fixtures, "demo1.txt"))), payload));
  const site = fakeSite();
  try {
    const r = await new BitGraph({ baseUrl: BASE }).record(dir, { write: false });
    const binds = site.calls.filter((c) => c.path === "/api/commit");
    assert.equal(binds.length, 1);
    assert.deepEqual(binds[0]!.body, { digests: [{ digestB64: sha("plain bytes"), hashAlg: "sha256" }], chainId: "bitgraph:main" });
    assert.deepEqual(r.files.filter((f) => f.outcome === "skipped").map((f) => f.path).sort(), [join(dir, "doc.bitgraph.txt"), join(dir, "older.txt.bitgraph.json")]);
    const made = r.files.find((f) => f.outcome === "made")!;
    assert.equal(made.proofPath, null);
    assert.ok(made.proof !== null, "the proof is still in the result");
    assert.equal(await exists(proofPathFor(plain)), false);
  } finally { site.restore(); }
});

test("an enclave restart is a 503 that says nothing was made", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bitgraph-record-503-"));
  const file = join(dir, "y.txt");
  await writeFile(file, "y");
  const site = fakeSite({ bind: "restarting" });
  try {
    await assert.rejects(new BitGraph({ baseUrl: BASE }).record(file), (e: unknown) => e instanceof ApiError && e.status === 503 && /nothing was made/.test(e.message));
    assert.equal(await exists(proofPathFor(file)), false);
  } finally { site.restore(); }
});
