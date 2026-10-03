// The site's own recovery writes (recovery-server.ts), for trees the hosted
// MCP makes: sealed exactly as the drop box seals, stored create-only, off
// unless RECOVERY_WRITES=on, and never a failure that reaches the caller.
// The spec's signed vector tree and a store in memory; no network, no S3.
import { describe, test } from "node:test";
import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MemoryRecoveryStore, type PutOutcome } from "../recovery-store.ts";
import { fetchRecoveredProof, recoverFromDigest, recoveryAddress, recoveryTreeFrom, sealRecoveryMember } from "../recovery.ts";
import { keepTreeOnSite, siteRecoveryNote } from "../recovery-server.ts";
import { fakeFetch, sha256, vectorTree } from "./recovery-helpers.ts";

const TREE = JSON.parse(readFileSync(new URL("../../../../spec/vectors/tree-1.json", import.meta.url), "utf8")) as {
  files: Array<{ name: string; originalHex: string; committedHex: string }>;
};

/** A store where every key under one address is already held by somebody else's bytes, whatever the name. */
class SquattedStore extends MemoryRecoveryStore {
  private readonly prefix: string;
  constructor(address: string) {
    super();
    this.prefix = `recovery/v1/${address}/`;
  }
  override async putIfAbsent(key: string, envelope: Uint8Array): Promise<PutOutcome> {
    if (key.startsWith(this.prefix)) return { status: "exists", envelope: new Uint8Array(64).fill(1) };
    return super.putIfAbsent(key, envelope);
  }
}

describe("recovery written by the site", () => {
  const t = vectorTree();
  const input = { proof: t.proof, rootDocument: t.rootDocument, leavesBytes: t.leavesBytes, names: t.names };
  const asIs = Array.from({ length: t.count }, (_, i) => t.leavesBytes[i * 65]).filter((p) => p === 0).length;
  const ENTRIES = 2 * t.count - asIs;

  test("writes on: every entry is stored, and each file then finds its proof from its own bytes", async () => {
    const store = new MemoryRecoveryStore();
    const r = await keepTreeOnSite(input, store, { writesOn: true });
    assert.deepEqual(r, { entries: ENTRIES, written: ENTRIES, alreadyThere: 0, salted: 0, blocked: 0, pending: 0, reason: null });
    assert.equal(siteRecoveryNote(r), "Each file finds this proof again from its own bytes on bitgraph.ing, even if this export is lost.");
    const fetch = fakeFetch(store, { proofs: [t.proof] });
    for (const f of TREE.files) {
      const bytes = Buffer.from(f.originalHex, "hex");
      const [entry] = await recoverFromDigest(sha256(bytes), fetch);
      assert.ok(entry, f.name);
      const bound = await fetchRecoveredProof(entry, fetch, { bytes });
      assert.ok(bound?.check.category.startsWith("TREE_MEMBER"), `${f.name}: ${bound?.check.category}`);
    }
    const again = await keepTreeOnSite(input, store, { writesOn: true });
    assert.deepEqual(again, { entries: ENTRIES, written: 0, alreadyThere: ENTRIES, salted: 0, blocked: 0, pending: 0, reason: null });
  });

  test("writes off: nothing is stored and the note says why", async () => {
    const store = new MemoryRecoveryStore();
    const r = await keepTreeOnSite(input, store, { writesOn: false });
    assert.equal(store.puts, 0);
    assert.deepEqual(r, { entries: ENTRIES, written: 0, alreadyThere: 0, salted: 0, blocked: 0, pending: ENTRIES, reason: "recovery writes are off on this site" });
    assert.match(siteRecoveryNote(r), /^Not yet recoverable from the files alone \(recovery writes are off on this site\); keep this export\.$/);
  });

  test("a key held by something else gets the entry under its salted name; conflicts are retried; a store that fails leaves entries pending", async () => {
    const tree = recoveryTreeFrom(input);
    const first = await sealRecoveryMember(tree, 0, t.names[0]);
    const store = new MemoryRecoveryStore();
    store.objects.set(first.writes[0]!.objectKey, new Uint8Array(64).fill(1));
    const second = (await sealRecoveryMember(tree, 1, t.names[1])).writes[0]!.objectKey;
    store.conflicts.set(second, 2);
    const r = await keepTreeOnSite(input, store, { writesOn: true });
    assert.equal(r.blocked, 0, "the held key is not the end of it");
    assert.equal(r.salted, 1, "that entry sits under its salted name");
    assert.equal(r.written, ENTRIES, "the conflicted key landed on a retry; the salted one landed too");
    assert.equal(r.pending, 0);
    assert.equal(store.objects.size, ENTRIES + 1, "the squatter's bytes stay; the member's entry is beside them");
    // The file still finds its proof: the salted entry opens like any other, and only once.
    const held = first.writes[0]!;
    const found = await recoverFromDigest(held.digest, fakeFetch(store, { proofs: [t.proof] }));
    assert.equal(found.length, 1);
    assert.equal(found[0]!.salted, true);
    assert.equal(found[0]!.leafIndex, 0);

    // Both names held (someone answering "exists" with their own bytes for every key under this address): blocked, never written, never counted.
    const squatted = new SquattedStore(recoveryAddress(held.digest));
    const b = await keepTreeOnSite(input, squatted, { writesOn: true });
    assert.equal(b.blocked, 1);
    assert.equal(b.salted, 0);
    assert.equal(b.written, ENTRIES - 1);

    const stuck = new MemoryRecoveryStore();
    stuck.conflicts.set(second, 99);
    const s = await keepTreeOnSite(input, stuck, { writesOn: true });
    assert.equal(s.pending, 1);
    assert.equal(s.reason, "some entries met a concurrent write every time");

    const down = new MemoryRecoveryStore();
    down.failing = true;
    const d = await keepTreeOnSite(input, down, { writesOn: true });
    assert.equal(d.written, 0);
    assert.equal(d.pending, ENTRIES);
    assert.match(d.reason ?? "", /^the recovery store could not be written/);
    assert.ok(down.puts <= 8, `a failing store is not asked once per entry (${down.puts} calls)`);
  });

  test("a tree that does not hold together is reported, never thrown", async () => {
    const r = await keepTreeOnSite({ ...input, rootDocument: new Uint8Array(84) }, new MemoryRecoveryStore(), { writesOn: true });
    assert.equal(r.written, 0);
    assert.match(r.reason ?? "", /^recovery entries were not written: /);
  });
});
