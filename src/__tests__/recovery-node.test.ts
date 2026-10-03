// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * Recovery entries outside the browser (src/recovery.ts, src/recovery-write.ts):
 * the Node twin of the site's module, and the writer the CLI, SDK and MCP use.
 *
 * The twin is checked against the site's source line for line, so the two
 * cannot drift (the site's own suite also seals with one and opens with the
 * other). Then the spec's export vector, a tree of five signed with the
 * published TEST key, goes through a store in memory: every member's entries
 * are written, found again from the original and from the committed bytes,
 * and verified as that member; a site with writes off, a site without the
 * route, and an entry already held by someone else each come back as what
 * they are. Nothing here touches the network.
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { TREE_MEMBER_CATEGORIES, base64ToBytes, hexToBytes, type BitGraphProof } from "@mikeargento/bitgraph-verify";
import {
  fetchRecoveredProof,
  recoverFromDigest,
  recoveryTreeFrom,
  sealRecoveryMember,
  writeRecoveryEntries,
} from "../index.js";

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

test("the Node twin is the site's module, but for its three type-only lines and the browser's cache option", () => {
  const node = readFileSync(here("../../src/recovery.ts"), "utf8");
  const site = readFileSync(here("../../website/src/lib/recovery.ts"), "utf8");
  const codeOf = (s: string) => s.slice(s.indexOf('import { sha256 } from "@noble/hashes/sha256";'));
  const twin = codeOf(node);
  const original = codeOf(site).replaceAll(', cache: "no-store" }', " }");
  assert.ok(twin.length > 10_000 && original.length > 10_000, "both files read");
  assert.equal(twin, original, "src/recovery.ts and website/src/lib/recovery.ts differ: change both or neither");
  const header = node.slice(0, node.indexOf('import { sha256 } from "@noble/hashes/sha256";'));
  assert.match(header, /NODE TWIN of website\/src\/lib\/recovery\.ts/);
});

const VEC = JSON.parse(readFileSync(here("../../spec/vectors/export-1.json"), "utf8")) as {
  ownerExport: { proof: BitGraphProof; tree: { rootDocument: string; leaves: string; names: string[] } };
};
const TREE = JSON.parse(readFileSync(here("../../spec/vectors/tree-1.json"), "utf8")) as {
  files: Array<{ name: string; originalHex: string; committedHex: string; placementCode: number }>;
};
const proof = VEC.ownerExport.proof;
const rootDocument = hexToBytes(VEC.ownerExport.tree.rootDocument)!;
const leavesBytes = base64ToBytes(VEC.ownerExport.tree.leaves)!;
const names = VEC.ownerExport.tree.names;
const count = leavesBytes.length / 65;
const asIsCount = Array.from({ length: count }, (_, i) => leavesBytes[i * 65]).filter((p) => p === 0).length;
const ENTRIES = 2 * count - asIsCount;
const sha = (b: Uint8Array) => new Uint8Array(createHash("sha256").update(b).digest());
const toUrlSafe = (s: string) => s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** The site's routes in memory: create-only POST /api/recovery, its listing, and the proof by artifact digest. */
function site(mode: { writes: "on" | "off" | "absent" } = { writes: "on" }) {
  const store = new Map<string, string>();
  const posts: number[] = [];
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    const path = new URL(url).pathname;
    if (path === "/api/recovery" && init?.method === "POST") {
      if (mode.writes === "absent") return json(404, { error: "no route" });
      if (mode.writes === "off") return json(503, { code: "recovery-writes-off" });
      const entries = (JSON.parse(String(init.body)) as { entries: Array<{ key: string; envelope: string }> }).entries;
      posts.push(entries.length);
      return json(200, {
        results: entries.map(({ key, envelope }) => {
          const held = store.get(key);
          if (held !== undefined) return { key, status: "exists", envelope: held };
          store.set(key, envelope);
          return { key, status: "created" };
        }),
      });
    }
    if (path.startsWith("/api/recovery/")) {
      if (mode.writes === "absent") return json(404, { error: "no route" });
      const address = path.slice("/api/recovery/".length);
      const entries = [...store.entries()].filter(([k]) => k.startsWith(`recovery/v1/${address}/`)).sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, envelope]) => ({ key, envelope }));
      return json(200, { address, entries, next: null });
    }
    if (path === `/api/proofs/${toUrlSafe(proof.artifact.digestB64)}`) return json(200, { proofs: [{ proof }] });
    return json(404, { error: `unexpected ${path}` });
  };
  return { store, posts, fetch, mode };
}

test("every member's entries are written once, and each file finds its proof again from the original or the committed bytes", async () => {
  const s = site();
  const opts = { baseUrl: "https://example.test", fetch: s.fetch, backoffMs: 1 };
  const w = await writeRecoveryEntries({ proof, rootDocument, leavesBytes, names }, opts);
  assert.deepEqual(w, { entries: ENTRIES, written: ENTRIES, alreadyThere: 0, blocked: 0, pending: 0, reason: null });
  assert.equal(s.store.size, ENTRIES);

  for (const f of TREE.files) {
    for (const hex of new Set([f.originalHex, f.committedHex])) {
      const bytes = Uint8Array.from(Buffer.from(hex, "hex"));
      const found = await recoverFromDigest(sha(bytes), s.fetch, { baseUrl: opts.baseUrl });
      assert.equal(found.length, 1, `${f.name}: one tree holds these bytes`);
      const bound = await fetchRecoveredProof(found[0]!, s.fetch, { baseUrl: opts.baseUrl, bytes });
      assert.ok(bound !== null, `${f.name}: the proof was found`);
      assert.ok((TREE_MEMBER_CATEGORIES as readonly string[]).includes(bound.check.category), `${f.name}: ${bound.check.category}`);
      assert.equal(found[0]!.name, f.name, "the sealed name comes back");
    }
  }

  // The same tree again: every entry is already there, opened and found to be this member.
  const again = await writeRecoveryEntries({ proof, rootDocument, leavesBytes, names }, opts);
  assert.deepEqual(again, { entries: ENTRIES, written: 0, alreadyThere: ENTRIES, blocked: 0, pending: 0, reason: null });
});

test("a site with writes off, or without the route, leaves every entry pending and says why, after one request", async () => {
  for (const writes of ["off", "absent"] as const) {
    const s = site({ writes });
    let calls = 0;
    const counting = (url: string, init?: RequestInit) => {
      calls++;
      return s.fetch(url, init);
    };
    const w = await writeRecoveryEntries({ proof, rootDocument, leavesBytes, names }, { baseUrl: "https://example.test", fetch: counting, backoffMs: 1 });
    assert.equal(w.written, 0);
    assert.equal(w.pending, ENTRIES);
    assert.match(w.reason ?? "", /^example\.test is not taking recovery writes yet/);
    assert.equal(calls, 1, `${writes}: no retries against a site that takes no writes`);
  }
});

test("an entry already held by something else is blocked, never counted as written", async () => {
  const s = site();
  const tree = recoveryTreeFrom({ proof, rootDocument, leavesBytes });
  const first = await sealRecoveryMember(tree, 0, names[0]);
  const second = await sealRecoveryMember(tree, 1, names[1]);
  // Member 1's envelope parked under member 0's first key: it opens with neither the right key nor the right AAD.
  s.store.set(first.writes[0]!.objectKey, Buffer.from(second.writes[0]!.envelope).toString("base64"));
  const w = await writeRecoveryEntries({ proof, rootDocument, leavesBytes, names }, { baseUrl: "https://example.test", fetch: s.fetch, backoffMs: 1 });
  assert.equal(w.blocked, 1);
  assert.equal(w.written, ENTRIES - 1);
  assert.equal(w.pending, 0);
});

test("a site that errors is retried, then reported pending with the status", async () => {
  let calls = 0;
  const failing = async () => {
    calls++;
    return new Response("{}", { status: 500 });
  };
  const w = await writeRecoveryEntries({ proof, rootDocument, leavesBytes, names }, { baseUrl: "https://example.test", fetch: failing, retries: 2, backoffMs: 1 });
  assert.equal(calls, 3, "the first try and two retries");
  assert.equal(w.pending, ENTRIES);
  assert.equal(w.reason, "POST /api/recovery answered 500");
});
