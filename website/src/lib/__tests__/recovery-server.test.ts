// The site's own recovery writes (recovery-server.ts), for trees the hosted
// MCP makes: sealed exactly as the drop box seals, stored create-only, off
// unless RECOVERY_WRITES=on, and never a failure that reaches the caller.
// The spec's signed vector tree and a store in memory; no network, no S3.
import { describe, test } from "node:test";
import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MemoryRecoveryStore, type PutOutcome } from "../recovery-store.ts";
import { fetchRecoveredProof, recoverFromDigest, recoveryAddress, recoveryTreeFrom, sealRecoveryMember } from "../recovery.ts";
import { BUDGET_REASON, inProcessRecoveryFetch, keepTreeOnSite, recoveredOnSite, siteRecoveryNote, type SiteRecoveryResult } from "../recovery-server.ts";

/** A result's counts, without the progress it carries for resuming. */
const counts = ({ state, ...rest }: SiteRecoveryResult) => {
  void state;
  return rest;
};
import { fakeFetch, sha256, vectorTree } from "./recovery-helpers.ts";

const TREE = JSON.parse(readFileSync(new URL("../../../../spec/vectors/tree-1.json", import.meta.url), "utf8")) as {
  files: Array<{ name: string; originalHex: string; committedHex: string; placementCode: number }>;
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
    assert.deepEqual(counts(r), { entries: ENTRIES, kept: ENTRIES, written: ENTRIES, alreadyThere: 0, salted: 0, blocked: 0, pending: 0, reason: null, done: true });
    assert.ok(r.state.progress.every((b) => b === 3), "every member: both sides kept");
    assert.equal(siteRecoveryNote(r), "Each file finds this proof again from its own bytes on bitgraph.ing, even if this export is lost.");
    const fetch = fakeFetch(store, { proofs: [t.proof] });
    for (const f of TREE.files) {
      const bytes = Buffer.from(f.originalHex, "hex");
      const [entry] = await recoverFromDigest(sha256(bytes), fetch);
      assert.ok(entry, f.name);
      const bound = await fetchRecoveredProof(entry, fetch, { bytes, trust: "none" });
      assert.ok(bound?.check.category.startsWith("TREE_MEMBER"), `${f.name}: ${bound?.check.category}`);
    }
    const again = await keepTreeOnSite(input, store, { writesOn: true });
    assert.deepEqual(counts(again), { entries: ENTRIES, kept: ENTRIES, written: 0, alreadyThere: ENTRIES, salted: 0, blocked: 0, pending: 0, reason: null, done: true });
    // Resumed from a state that has everything: the store is not asked at all.
    const puts = store.puts;
    const resumed = await keepTreeOnSite(input, store, { writesOn: true, state: r.state });
    assert.equal(store.puts, puts);
    assert.deepEqual(counts(resumed), { entries: ENTRIES, kept: ENTRIES, written: 0, alreadyThere: 0, salted: 0, blocked: 0, pending: 0, reason: null, done: true });
  });

  test("writes off: nothing is stored and the note says why", async () => {
    const store = new MemoryRecoveryStore();
    const r = await keepTreeOnSite(input, store, { writesOn: false });
    assert.equal(store.puts, 0);
    assert.deepEqual(counts(r), { entries: ENTRIES, kept: 0, written: 0, alreadyThere: 0, salted: 0, blocked: 0, pending: ENTRIES, reason: "recovery writes are off on this site", done: false });
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

    // A second request for the same tree (nothing remembered): it finds its salted entry already there and keeps it, no third copy.
    const again = await keepTreeOnSite(input, store, { writesOn: true });
    assert.equal(again.salted, 1);
    assert.equal(again.written, 0);
    assert.equal(store.objects.size, ENTRIES + 1, "no second salted copy");

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

  test("a budget stops the work with its progress, and a second call from that state finishes without rewriting", async () => {
    const store = new MemoryRecoveryStore();
    const slow = new (class extends MemoryRecoveryStore {
      override async putIfAbsent(key: string, envelope: Uint8Array) {
        await new Promise((r) => setTimeout(r, 15));
        const out = await super.putIfAbsent(key, envelope);
        store.objects.set(key, envelope);
        return out;
      }
    })();
    const first = await keepTreeOnSite(input, slow, { writesOn: true, budgetMs: 1 });
    assert.equal(first.done, false);
    assert.equal(first.reason, BUDGET_REASON);
    assert.ok(first.written < ENTRIES, `stopped early (${first.written} of ${ENTRIES})`);
    assert.match(siteRecoveryNote(first), /being written after this answer/);
    const rest = await keepTreeOnSite(input, slow, { writesOn: true, state: first.state });
    assert.equal(rest.done, true);
    assert.equal(rest.written + first.written, ENTRIES, "nothing written twice, nothing missed");
    assert.equal(rest.alreadyThere, 0);
    assert.equal(slow.objects.size, ENTRIES);
  });

  test("the site reads its own entries: a digest already in a tree is on record, with no bytes in hand; a store that cannot be read is unknown", async () => {
    const store = new MemoryRecoveryStore();
    await keepTreeOnSite(input, store, { writesOn: true });
    const proofsByDigest = async (urlSafe: string) => (urlSafe === t.proof.artifact.digestB64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") ? [t.proof] : []);
    const fetch = inProcessRecoveryFetch(store, proofsByDigest);
    const asIs = TREE.files.filter((f) => f.placementCode === 0);
    const placed = TREE.files.filter((f) => f.placementCode !== 0);
    const committed = placed.map((f) => Buffer.from(sha256(Buffer.from(f.committedHex, "hex"))).toString("base64"));
    const asIsDigests = asIs.map((f) => Buffer.from(sha256(Buffer.from(f.originalHex, "hex"))).toString("base64"));
    const origins = placed.map((f) => Buffer.from(sha256(Buffer.from(f.originalHex, "hex"))).toString("base64"));
    const r = await recoveredOnSite([...committed, ...asIsDigests, ...origins, Buffer.from(sha256(Buffer.from("never recorded"))).toString("base64")], fetch, { trust: "none" });
    // The committed bytes and an as-is file ARE what the tree commits to: on record.
    assert.equal(r.found.size, committed.length + asIsDigests.length, "every member by its committed bytes, and the as-is file by its one digest");
    for (const d of [...committed, ...asIsDigests]) {
      const [hit] = r.found.get(d)!;
      assert.equal(hit!.proof.commit?.counter, t.proof.commit?.counter);
      assert.equal(hit!.rootDocumentHex, Buffer.from(t.rootDocument).toString("hex"));
      assert.notEqual(hit!.matched, "origin");
    }
    // An original named by a placed leaf: the tree's maker declared that digest; without the bytes nothing checks it. Unknown, with the reason.
    assert.equal(r.unknown.size, origins.length, "every placed member's original is unknown here");
    for (const d of origins) assert.match(r.unknown.get(d)!, /names these bytes as the original/);
    // The ledger has no proof under the tree's digest (not written yet): not found, and not unknown either; the entry alone is not a position.
    const noProof = await recoveredOnSite(committed.slice(0, 1), inProcessRecoveryFetch(store, async () => []), { trust: "none" });
    assert.equal(noProof.found.size, 0);
    assert.equal(noProof.unknown.size, 0);
    // The default trust: the TEST vector's stub attestation is nobody's recording.
    const strict = await recoveredOnSite(committed.slice(0, 1), fetch);
    assert.equal(strict.found.size, 0);
    // A store that cannot be read: unknown, never new.
    store.failing = true;
    const down = await recoveredOnSite(committed.slice(0, 2), fetch, { trust: "none" });
    assert.equal(down.found.size, 0);
    assert.equal(down.unknown.size, 2);
  });

  test("a tree that does not hold together is reported, never thrown", async () => {
    const r = await keepTreeOnSite({ ...input, rootDocument: new Uint8Array(84) }, new MemoryRecoveryStore(), { writesOn: true });
    assert.equal(r.written, 0);
    assert.match(r.reason ?? "", /^recovery entries were not written: /);
  });
});
