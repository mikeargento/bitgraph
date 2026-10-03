/**
 * The browser's recovery queue, in node: the persistence is the in-memory
 * store (the IndexedDB one keeps the same contract), the server is the
 * route's own handler over a store in memory, and the timer is replaced so
 * backoffs are recorded instead of waited.
 *
 * Run: node --test src/lib/__tests__/recovery-queue.test.ts
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { base64ToBytes, decodeTreeLeaves, parseTreeRootDocument, committedBytesFor } from "@mikeargento/bitgraph-verify";
import {
  RecoveryInputError,
  recoverFromDigest,
  recoveryAddress,
  recoveryEntryId,
  recoveryKeyBytes,
  recoveryObjectKey,
  recoveryObjectKeyFor,
  recoveryPlaintextFor,
  recoveryTreeFrom,
  sealRecoveryEnvelope,
} from "../recovery.ts";
import { MemoryRecoveryStore } from "../recovery-store.ts";
import {
  MemoryRecoveryQueueStore,
  RecoveryQueue,
  RecoveryTransportError,
  httpRecoveryTransport,
  mergeProgressBytes,
  parsePostResults,
  recoveryJobId,
  type RecoveryQueueOptions,
  type RecoveryTransport,
} from "../recovery-queue.ts";
import { fakeFetch, serverTransport, sha256, utf8, vectorTree } from "./recovery-helpers.ts";

/** Every test here ends in well under a second; a regression that makes the queue retry forever fails at this limit instead of hanging the run. */
const T = { timeout: 20_000 };

function queueWith(over: Partial<RecoveryQueueOptions> & Pick<RecoveryQueueOptions, "store" | "transport">, waits: number[] = []) {
  return new RecoveryQueue({ sleep: async (ms) => { waits.push(ms); }, random: () => 0.5, log: () => {}, ...over });
}

/** A transport that accepts everything and records the keys: a regression shows up as a send, never as a queue retrying forever. */
function recording() {
  const sent: string[] = [];
  const transport: RecoveryTransport = { async post(entries) { sent.push(...entries.map((e) => e.key)); return entries.map((e) => ({ key: e.key, status: "created" as const })); } };
  return { sent, transport };
}

const vectorInput = () => {
  const v = vectorTree();
  return { v, input: { proof: v.proof, rootDocument: v.rootDocument, leavesBytes: v.leavesBytes, names: v.names } };
};

describe("the queue", () => {
  test("every entry of a tree is written and every file becomes recoverable", T, async () => {
    const { v, input } = vectorInput();
    const server = new MemoryRecoveryStore();
    const seen = { requests: 0, entries: 0 };
    const q = queueWith({ store: new MemoryRecoveryQueueStore(), transport: serverTransport(server, seen) });
    const changes: string[] = [];
    q.subscribe((id) => changes.push(id));
    const { id, count, keep, persisted } = await q.enqueueTree(input);
    assert.deepEqual({ count, keep, persisted }, { count: 5, keep: true, persisted: true });
    assert.equal(id, recoveryJobId(recoveryTreeFrom(input).proofHash));
    await q.idle();
    assert.deepEqual(seen, { requests: 1, entries: 9 }, "four placed files twice, the as-is file once, one request");
    assert.equal(server.objects.size, 9);
    for (let i = 0; i < 5; i++) assert.equal(q.fileStatus(id, i), "recoverable", `member ${i}`);
    const s = q.status(id)!;
    assert.deepEqual({ recoverable: s.recoverable, pending: s.pending, blocked: s.blocked, done: s.done }, { recoverable: 5, pending: 0, blocked: 0, done: true });
    assert.ok(changes.includes(id));
    // And they are what recovery finds, from the file as dropped.
    const found = await recoverFromDigest(sha256(v.memberFile), fakeFetch(server));
    assert.equal(found.length, 1);
    assert.equal(found[0]!.name, "hello.txt");
    assert.equal(q.fileStatus(id, 99), null);
    assert.equal(q.fileStatus("unknown", 0), null);
  });

  test("a file is pending until ALL its writes succeed", T, async () => {
    const { v, input } = vectorInput();
    const server = new MemoryRecoveryStore();
    const tree = recoveryTreeFrom(input);
    const leaf = decodeTreeLeaves(v.leavesBytes)![1]!;
    // The committed bytes' key answers 409 past the server's own retries, once.
    const artifactKey = recoveryObjectKey(recoveryAddress(leaf.artifact), recoveryEntryId(leaf.artifact, tree.proofHash32, 1));
    server.conflicts.set(artifactKey, 4);
    const waits: number[] = [];
    const q = queueWith({ store: new MemoryRecoveryQueueStore(), transport: serverTransport(server) }, waits);
    const after: Array<string | null> = [];
    let id = "";
    q.subscribe(() => after.push(q.fileStatus(id, 1)));
    id = (await q.enqueueTree(input)).id;
    await q.idle();
    assert.equal(after[1], "pending", "after the first batch: the original's entry kept, the committed bytes' not");
    assert.equal(q.fileStatus(id, 1), "recoverable", "after the retry pass");
    assert.equal(waits.length, 1, "one pass wait");
    assert.ok(server.objects.has(artifactKey));
  });

  test("a restart resumes from what was saved, and writes nothing twice", T, async () => {
    const { input } = vectorInput();
    const server = new MemoryRecoveryStore();
    const saved = new MemoryRecoveryQueueStore();
    // The first page: 4 entries per request, and the network dies after the first one.
    let sent = 0;
    const dying: RecoveryTransport = {
      async post(entries) {
        if (sent++ > 0) throw new TypeError("network down");
        return serverTransport(server).post(entries);
      },
    };
    const first = queueWith({ store: saved, transport: dying, maxBatchEntries: 4 });
    const { id } = await first.enqueueTree(input);
    // Let it fail a few times, then the tab is closed.
    for (let i = 0; i < 50 && sent < 3; i++) await new Promise((r) => setTimeout(r, 1));
    await first.stop();
    const writtenBefore = server.objects.size;
    assert.equal(writtenBefore, 4);
    assert.equal(saved.jobs.size, 1, "the job is saved");
    assert.ok(saved.jobs.get(id)!.leaves instanceof Uint8Array, "with its list, while it has work");
    // A new page: a fresh queue over the same saved state, and a working network.
    const seen = { requests: 0, entries: 0 };
    const second = queueWith({ store: saved, transport: serverTransport(server, seen) });
    assert.equal(second.status(id), null, "nothing known before resume");
    await second.resume();
    await second.idle();
    assert.equal(seen.entries, 9 - writtenBefore, "only what was left");
    assert.equal(server.objects.size, 9);
    for (let i = 0; i < 5; i++) assert.equal(second.fileStatus(id, i), "recoverable");
    // Done: the saved job drops its list and names but keeps per-file status.
    const rec = saved.jobs.get(id)!;
    assert.equal(rec.done, true);
    assert.equal(rec.leaves, null);
    assert.equal(rec.names, null);
    const idle = recording();
    const third = queueWith({ store: saved, transport: idle.transport });
    await third.resume();
    await third.idle();
    assert.deepEqual(idle.sent, [], "nothing to send");
    assert.equal(third.fileStatus(id, 3), "recoverable", "status survives without the list");
  });

  test("progress lost in a crash costs only rewrites: every entry answers exists, opens to the same member, and counts", T, async () => {
    const { input } = vectorInput();
    const server = new MemoryRecoveryStore();
    const saved = new MemoryRecoveryQueueStore();
    const first = queueWith({ store: saved, transport: serverTransport(server), persistEveryMs: 1e12 });
    const { id } = await first.enqueueTree(input);
    await first.idle();
    // Simulate the crash: the progress never reached storage, the job did.
    saved.progress.clear();
    saved.jobs.set(id, { ...saved.jobs.get(id)!, done: false, leaves: input.leavesBytes.slice(), names: [...input.names] });
    const before = new Map(server.objects);
    const seen = { requests: 0, entries: 0 };
    const second = queueWith({ store: saved, transport: serverTransport(server, seen) });
    await second.resume();
    await second.idle();
    assert.equal(seen.entries, 9, "everything sent again");
    assert.deepEqual(server.objects, before, "and nothing on the server changed");
    for (let i = 0; i < 5; i++) assert.equal(second.fileStatus(id, i), "recoverable");
  });

  test("opt-out: a tree marked keep-no-recovery-copy writes nothing and stores nothing of its files", T, async () => {
    const { input } = vectorInput();
    const server = new MemoryRecoveryStore();
    const saved = new MemoryRecoveryQueueStore();
    let calls = 0;
    const counting: RecoveryTransport = { async post(e) { calls++; return serverTransport(server).post(e); } };
    const q = queueWith({ store: saved, transport: counting });
    const r = await q.enqueueTree({ ...input, keepRecoveryCopy: false });
    assert.deepEqual({ count: r.count, keep: r.keep }, { count: 5, keep: false });
    await q.idle();
    assert.equal(calls, 0);
    assert.equal(server.objects.size, 0);
    for (let i = 0; i < 5; i++) assert.equal(q.fileStatus(r.id, i), "not-kept");
    const rec = saved.jobs.get(r.id)!;
    assert.deepEqual({ keep: rec.keep, leaves: rec.leaves, names: rec.names, rootDocument: rec.rootDocument }, { keep: false, leaves: null, names: null, rootDocument: null });
    assert.equal(q.status(r.id)!.recoverable, 0);
    // Changing one's mind to keep a copy is allowed; the reverse is not (what is written stays written).
    await q.enqueueTree(input);
    await q.idle();
    assert.equal(server.objects.size, 9);
    assert.equal(q.fileStatus(r.id, 0), "recoverable");
    const again = await q.enqueueTree({ ...input, keepRecoveryCopy: false });
    assert.equal(again.keep, true);
    assert.equal(q.fileStatus(r.id, 0), "recoverable");
  });

  test("a key held by somebody else's entry gets the same entry under a salted name, saved in the job before the write, and never counts the squatter a success", T, async () => {
    const { v, input } = vectorInput();
    const server = new MemoryRecoveryStore();
    const tree = recoveryTreeFrom(input);
    const leaf = decodeTreeLeaves(v.leavesBytes)![1]!;
    // Someone who knows hello.txt's digest got there first with another member's plaintext.
    const squatKey = recoveryObjectKey(recoveryAddress(leaf.origin), recoveryEntryId(leaf.origin, tree.proofHash32, 1));
    server.objects.set(squatKey, await sealRecoveryEnvelope(recoveryKeyBytes(leaf.origin), squatKey, recoveryPlaintextFor(tree, 3, "note.md").bytes));
    const jobs = new MemoryRecoveryQueueStore();
    const q = queueWith({ store: jobs, transport: serverTransport(server) });
    const { id } = await q.enqueueTree(input);
    await q.idle();
    assert.equal(q.fileStatus(id, 1), "recoverable");
    assert.deepEqual(q.fileDetail(id, 1), { origin: "kept", artifact: "kept" });
    for (const i of [0, 2, 3, 4]) assert.equal(q.fileStatus(id, i), "recoverable");
    assert.deepEqual({ ...q.status(id)!, id: "" }, { id: "", count: 5, keep: true, recoverable: 5, pending: 0, blocked: 0, done: true, persisted: true, broken: null });
    // The salt was saved with the job, and the entry sits under the name it derives.
    const salt = base64ToBytes(jobs.jobs.get(id)!.salts!["1:origin"]!)!;
    assert.equal(salt.length, 32);
    const saltedKey = recoveryObjectKeyFor(tree, 1, "origin", salt);
    assert.ok(server.objects.has(saltedKey), "the salted entry was written");
    assert.ok(server.objects.has(squatKey), "the squatter's bytes were not touched");
    // The original finds the file, once, through the salted entry; the committed bytes find it through the deterministic one.
    const byOrigin = await recoverFromDigest(leaf.origin, fakeFetch(server));
    assert.equal(byOrigin.length, 1);
    assert.equal(byOrigin[0]!.salted, true);
    assert.equal(byOrigin[0]!.leafIndex, 1);
    const committed = committedBytesFor(0x01, v.memberFile, parseTreeRootDocument(v.rootDocument)!.commitment);
    const byArtifact = await recoverFromDigest(sha256(committed), fakeFetch(server));
    assert.equal(byArtifact.length, 1);
    assert.equal(byArtifact[0]!.salted, false);
  });

  test("both names held blocks only that side of that file", T, async () => {
    const { v, input } = vectorInput();
    const server = new MemoryRecoveryStore();
    const leaf = decodeTreeLeaves(v.leavesBytes)![1]!;
    const prefix = `recovery/v1/${recoveryAddress(leaf.origin)}/`;
    // Every key under hello.txt's address answers "exists" with somebody else's bytes, whatever the name.
    const inner = serverTransport(server);
    const transport: RecoveryTransport = {
      async post(entries) {
        const rest = entries.filter((e) => !e.key.startsWith(prefix));
        const results = rest.length > 0 ? await inner.post(rest) : [];
        for (const e of entries) if (e.key.startsWith(prefix)) results.push({ key: e.key, status: "exists", envelope: Buffer.from(new Uint8Array(64).fill(1)).toString("base64") });
        return results;
      },
    };
    const q = queueWith({ store: new MemoryRecoveryQueueStore(), transport });
    const { id } = await q.enqueueTree(input);
    await q.idle();
    assert.equal(q.fileStatus(id, 1), "blocked");
    assert.deepEqual(q.fileDetail(id, 1), { origin: "blocked", artifact: "kept" }, "still recoverable from its committed bytes");
    for (const i of [0, 2, 3, 4]) assert.equal(q.fileStatus(id, i), "recoverable");
    assert.deepEqual({ ...q.status(id)!, id: "" }, { id: "", count: 5, keep: true, recoverable: 4, pending: 0, blocked: 1, done: true, persisted: true, broken: null });
    const committed = committedBytesFor(0x01, v.memberFile, parseTreeRootDocument(v.rootDocument)!.commitment);
    assert.equal((await recoverFromDigest(sha256(committed), fakeFetch(server))).length, 1);
  });

  test("a failing network is retried with doubling, capped, jittered waits until it works", T, async () => {
    const { input } = vectorInput();
    const server = new MemoryRecoveryStore();
    let failures = 7;
    const flaky: RecoveryTransport = {
      async post(e) {
        if (failures-- > 0) throw new RecoveryTransportError(503, "POST /api/recovery answered 503");
        return serverTransport(server).post(e);
      },
    };
    const waits: number[] = [];
    const q = queueWith({ store: new MemoryRecoveryQueueStore(), transport: flaky, baseDelayMs: 1000, maxDelayMs: 16_000 }, waits);
    const { id } = await q.enqueueTree(input);
    await q.idle();
    // random() = 0.5 puts each wait at three quarters of its step.
    assert.deepEqual(waits, [750, 1500, 3000, 6000, 12000, 12000, 12000]);
    assert.equal(q.status(id)!.recoverable, 5);
  });

  test("an inconsistent tree is refused before anything is saved or sent", T, async () => {
    const { input } = vectorInput();
    const saved = new MemoryRecoveryQueueStore();
    const rec = recording();
    const q = queueWith({ store: saved, transport: rec.transport });
    const flipped = input.leavesBytes.slice();
    flipped[100]! ^= 1;
    await assert.rejects(q.enqueueTree({ ...input, leavesBytes: flipped }), RecoveryInputError);
    const otherDoc = input.rootDocument.slice();
    otherDoc[30]! ^= 1;
    await assert.rejects(q.enqueueTree({ ...input, rootDocument: otherDoc }), RecoveryInputError);
    await assert.rejects(q.enqueueTree({ ...input, names: ["just one"] }), RecoveryInputError);
    await assert.rejects(q.enqueueTree({ ...input, leavesBytes: undefined }), RecoveryInputError);
    await q.idle();
    assert.equal(saved.jobs.size, 0);
    assert.deepEqual(rec.sent, [], "nothing may be sent");
  });

  test("a saved job whose list no longer rebuilds its root is reported broken and never sent", T, async () => {
    const { input } = vectorInput();
    const saved = new MemoryRecoveryQueueStore();
    const q = queueWith({ store: saved, transport: { post: async () => { throw new Error("stop"); } } });
    const { id } = await q.enqueueTree(input);
    await q.stop();
    const rec = saved.jobs.get(id)!;
    rec.leaves![70]! ^= 1;
    const after = recording();
    const resumed = queueWith({ store: saved, transport: after.transport });
    await resumed.resume();
    await resumed.idle();
    assert.deepEqual(after.sent, [], "a broken job is not sent");
    assert.match(resumed.status(id)!.broken ?? "", /root/);
    assert.equal(resumed.fileStatus(id, 0), "pending");
  });

  test("storage that fails does not stop the work: the job runs in memory and says so", T, async () => {
    const { input } = vectorInput();
    const server = new MemoryRecoveryStore();
    const saved = new MemoryRecoveryQueueStore();
    saved.failing = true;
    const q = queueWith({ store: saved, transport: serverTransport(server) });
    const r = await q.enqueueTree(input);
    assert.equal(r.persisted, false);
    await q.idle();
    assert.equal(q.status(r.id)!.recoverable, 5);
    assert.equal(q.status(r.id)!.persisted, false);
  });

  test("a broken saved job is repaired by enqueueing the same tree again with a list that rebuilds the root", T, async () => {
    const { input } = vectorInput();
    const server = new MemoryRecoveryStore();
    const saved = new MemoryRecoveryQueueStore();
    const first = queueWith({ store: saved, transport: { post: async () => { throw new Error("offline"); } } });
    const { id } = await first.enqueueTree(input);
    await first.stop();
    saved.jobs.get(id)!.leaves![70]! ^= 1;
    const q = queueWith({ store: saved, transport: serverTransport(server) });
    await q.resume();
    await q.idle();
    assert.ok(q.status(id)!.broken);
    const again = await q.enqueueTree(input);
    assert.equal(again.id, id);
    await q.idle();
    assert.equal(q.status(id)!.broken, null);
    assert.equal(q.status(id)!.recoverable, 5);
    assert.equal(server.objects.size, 9);
  });

  test("an exists answer that is not even base64 is the server's fault: the entry stays pending, never blocked", T, async () => {
    const { input } = vectorInput();
    const server = new MemoryRecoveryStore();
    let calls = 0;
    const garbled: RecoveryTransport = {
      async post(entries) {
        if (calls++ === 0) return entries.map((e) => ({ key: e.key, status: "exists" as const, envelope: "%%% not base64 %%%" }));
        return serverTransport(server).post(entries);
      },
    };
    const q = queueWith({ store: new MemoryRecoveryQueueStore(), transport: garbled });
    const seen = new Set<string | null>();
    let id = "";
    q.subscribe(() => { for (let i = 0; i < 5; i++) seen.add(q.fileStatus(id, i)); });
    id = (await q.enqueueTree(input)).id;
    await q.idle();
    assert.equal(seen.has("blocked"), false);
    assert.equal(q.status(id)!.recoverable, 5);
    assert.equal(calls, 2, "the garbled pass, then the real one");
  });

  test("a page that cannot seal sets that job aside, named, instead of stopping or spinning", T, async () => {
    const { input } = vectorInput();
    const rec = recording();
    const q = queueWith({ store: new MemoryRecoveryQueueStore(), transport: rec.transport });
    const subtle = globalThis.crypto.subtle as unknown as Record<string, unknown>;
    subtle["importKey"] = async () => { throw new Error("WebCrypto is unavailable here"); };
    try {
      const { id } = await q.enqueueTree(input);
      await q.idle();
      assert.match(q.status(id)!.broken ?? "", /could not be sealed: WebCrypto is unavailable here/);
      assert.deepEqual(rec.sent, []);
      assert.equal(q.fileStatus(id, 0), "pending");
    } finally {
      delete subtle["importKey"];
    }
    assert.equal(typeof globalThis.crypto.subtle.importKey, "function", "restored");
  });

  test("a member of a tree made here whose entries are still pending is found locally, in a lookup's shape", T, async () => {
    const { v, input } = vectorInput();
    const leaf = decodeTreeLeaves(v.leavesBytes)![1]!;
    // A site that takes no writes: the job stays pending, the tree is on record all the same.
    const refusing: RecoveryTransport = { async post() { throw new RecoveryTransportError(503, "writes off"); } };
    const waits: number[] = [];
    const q = queueWith({ store: new MemoryRecoveryQueueStore(), transport: refusing }, waits);
    const { id } = await q.enqueueTree(input);
    // Let the first attempt fail, then stop: the job is pending and saved.
    await new Promise((r) => setTimeout(r, 5));
    await q.stop();
    assert.equal(q.fileStatus(id, 1), "pending");
    const byOrigin = await q.localEntriesFor(leaf.origin);
    assert.equal(byOrigin.length, 1);
    assert.equal(byOrigin[0]!.matched, "origin");
    assert.equal(byOrigin[0]!.leafIndex, 1);
    assert.equal(byOrigin[0]!.name, "hello.txt");
    assert.equal(byOrigin[0]!.rootDocument, Buffer.from(v.rootDocument).toString("hex"));
    assert.equal(byOrigin[0]!.proof.counter, v.proof.commit?.counter);
    const byArtifact = await q.localEntriesFor(leaf.artifact);
    assert.equal(byArtifact.length, 1);
    assert.equal(byArtifact[0]!.matched, "artifact");
    assert.deepEqual(await q.localEntriesFor(sha256(utf8("never recorded"))), []);
  });

  test("enqueueing the same recording twice is one job", T, async () => {
    const { input } = vectorInput();
    const server = new MemoryRecoveryStore();
    const seen = { requests: 0, entries: 0 };
    const q = queueWith({ store: new MemoryRecoveryQueueStore(), transport: serverTransport(server, seen) });
    const a = await q.enqueueTree(input);
    const b = await q.enqueueTree(input);
    assert.equal(a.id, b.id);
    await q.idle();
    assert.deepEqual(q.jobIds(), [a.id]);
    assert.equal(seen.entries, 9);
  });
});

describe("persistence and transport pieces", () => {
  test("progress merges forward only (OR), whatever order saves land in", T, async () => {
    assert.deepEqual(mergeProgressBytes(new Uint8Array([1, 0, 2]), new Uint8Array([0, 4, 1])), new Uint8Array([1, 4, 3]));
    assert.deepEqual(mergeProgressBytes(undefined, new Uint8Array([3])), new Uint8Array([3]));
    const s = new MemoryRecoveryQueueStore();
    await s.mergeProgress("j", new Uint8Array([3, 0, 0]));
    await s.mergeProgress("j", new Uint8Array([0, 0, 0]));
    assert.deepEqual(await s.loadProgress("j"), new Uint8Array([3, 0, 0]), "a stale save cannot undo");
  });

  test("the HTTP transport posts the batch, reads results strictly, and throws on anything but 200", T, async () => {
    const sent: Array<{ url: string; body: string }> = [];
    const entries = [{ key: `recovery/v1/${"a".repeat(64)}/${"b".repeat(64)}`, envelope: "AQ==" }];
    const ok = httpRecoveryTransport({
      baseUrl: "https://bitgraph.test",
      fetch: async (url, init) => {
        sent.push({ url, body: String(init?.body) });
        return new Response(JSON.stringify({ results: [{ key: entries[0]!.key, status: "exists", envelope: "AQ==" }, { key: "not sent", status: "created" }, { key: entries[0]!.key, status: "weird" }] }), { status: 200 });
      },
    });
    assert.deepEqual(await ok.post(entries), [{ key: entries[0]!.key, status: "exists", envelope: "AQ==" }]);
    assert.equal(sent[0]!.url, "https://bitgraph.test/api/recovery");
    assert.deepEqual(JSON.parse(sent[0]!.body), { entries });
    const down = httpRecoveryTransport({ fetch: async () => new Response("{}", { status: 503 }) });
    await assert.rejects(down.post(entries), (e: unknown) => e instanceof RecoveryTransportError && e.status === 503);
    assert.throws(() => parsePostResults({ nope: 1 }, entries), RecoveryTransportError);
  });

  test("the job id is the proof hash in lowercase hex", () => {
    const { input } = vectorInput();
    const t = recoveryTreeFrom(input);
    assert.equal(recoveryJobId(t.proofHash), Buffer.from(t.proofHash, "base64").toString("hex"));
    assert.throws(() => recoveryJobId("short"), RecoveryInputError);
    void utf8;
  });
});
