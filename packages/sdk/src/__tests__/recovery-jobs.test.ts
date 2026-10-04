// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * Pending recovery jobs (recovery-jobs.ts): a tree's entries survive a site
 * that takes no writes, a run cut short by its budget, and a process that
 * died holding the lock. The spec's export vector is the tree; the site is
 * in memory; $BITGRAPH_HOME is a temporary directory. Nothing here touches
 * the network or ~/.bitgraph.
 */

import { after, before, test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TREE_METADATA_KEY,
  base64ToBytes,
  bytesToBase64,
  bytesToHex,
  buildTree,
  buildTreeRootDocument,
  encodeTreeLeaves,
  leafFor,
  treeAttribution,
  type BitGraphProof,
} from "@mikeargento/bitgraph-verify";
import { createHash } from "node:crypto";
import {
  flushRecoveryJobs,
  jobFromOwnerExport,
  keepRecoveryEntries,
  listRecoveryJobs,
  pendingMembersFor,
  recoveryJobId,
  recoveryJobsDir,
  registerRecoveryJob,
  runRecoveryJob,
  saveRecoveryJob,
  siteTag,
} from "../index.js";
import { utimes } from "node:fs/promises";

const VEC = JSON.parse(await readFile(fileURLToPath(new URL("../../../../spec/vectors/export-1.json", import.meta.url)), "utf8")) as {
  ownerExport: { proof: BitGraphProof; tree: { rootDocument: string; leaves: string; names: string[] } };
  memberExport?: unknown;
};
const owner = VEC.ownerExport;
const made = { proof: owner.proof, rootDocumentHex: owner.tree.rootDocument, leavesB64: owner.tree.leaves, names: owner.tree.names };
const count = base64ToBytes(owner.tree.leaves)!.length / 65;
const asIs = Array.from({ length: count }, (_, i) => base64ToBytes(owner.tree.leaves)![i * 65]).filter((p) => p === 0).length;
const ENTRIES = 2 * count - asIs;
const BASE = "https://example.test";

let home = "";
before(async () => {
  home = await mkdtemp(join(tmpdir(), "bitgraph-sdk-jobs-"));
  process.env["BITGRAPH_HOME"] = home;
});
after(async () => {
  delete process.env["BITGRAPH_HOME"];
  await rm(home, { recursive: true, force: true });
});

/** The site's recovery routes in memory. `writes` switches between a site with writes on, off (503) and a slow one. */
function site() {
  const store = new Map<string, string>();
  const state = { writes: "on" as "on" | "off", delayMs: 0, posts: 0 };
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    const path = new URL(url).pathname;
    if (path === "/api/recovery" && init?.method === "POST") {
      state.posts++;
      if (state.writes === "off") return json(503, { code: "recovery-writes-off" });
      if (state.delayMs > 0) await new Promise((r) => setTimeout(r, state.delayMs));
      const entries = (JSON.parse(String(init.body)) as { entries: Array<{ key: string; envelope: string }> }).entries;
      return json(200, {
        results: entries.map(({ key, envelope }) => {
          const held = store.get(key);
          if (held !== undefined) return { key, status: "exists", envelope: held };
          store.set(key, envelope);
          return { key, status: "created" };
        }),
      });
    }
    return json(404, { error: `unexpected ${path}` });
  };
  return { store, state, fetch };
}

const jobFiles = async () => (await readdir(recoveryJobsDir()).catch(() => [] as string[])).filter((n) => /^[0-9a-f]{64}\.[0-9a-f]{16}\.json$/.test(n));

const sha256 = (b: Uint8Array) => new Uint8Array(createHash("sha256").update(b).digest());
const utf8 = (s: string) => new TextEncoder().encode(s);

/**
 * A tree/1 proof built here, unsigned: real leaves, a real root document, the
 * tree/1 marker and a position. Everything recovery checks before a write
 * holds (it never checks a signature), which is all a job needs; with `n`
 * files it is more than one batch of entries.
 */
function bigTree(n: number) {
  const commitment = sha256(utf8("a test commitment"));
  const files = Array.from({ length: n }, (_, i) => ({ name: `file ${i}.txt`, original: utf8(`file ${i}\n`), code: 0x01 }));
  const madeLeaves = files.map((f) => ({ ...f, ...leafFor(f.code, f.original, commitment) }));
  const built = buildTree(madeLeaves.map((m) => m.leaf));
  const rootDocument = buildTreeRootDocument(commitment, built.sorted.length, built.root);
  const proof = {
    version: "bitgraph/1",
    artifact: { hashAlg: "sha256", digestB64: bytesToBase64(sha256(rootDocument)) },
    commit: { nonceB64: bytesToBase64(sha256(utf8("nonce"))), counter: "777", epochId: bytesToBase64(new Uint8Array(32).fill(0x5a)), slotCounter: "776" },
    signer: { publicKeyB64: bytesToBase64(new Uint8Array(32).fill(7)), signatureB64: bytesToBase64(new Uint8Array(64).fill(9)) },
    environment: { enforcement: "stub", measurement: "test-measurement" },
    attribution: treeAttribution(sha256(utf8("a test spec"))),
    metadata: { [TREE_METADATA_KEY]: bytesToHex(rootDocument) },
  } as unknown as BitGraphProof;
  const names = built.sorted.map((l) => madeLeaves.find((m) => bytesToHex(m.leaf.artifact) === bytesToHex(l.artifact))!.name);
  return { proof, rootDocumentHex: bytesToHex(rootDocument), leavesB64: bytesToBase64(encodeTreeLeaves(built.sorted)), names, entries: 2 * n };
}

test("a site that takes no writes leaves the job on disk, with its reason; the next flush, with writes on, finishes it and removes the file", async () => {
  const s = site();
  s.state.writes = "off";
  const r = await keepRecoveryEntries(made, { baseUrl: BASE }, { fetch: s.fetch, backoffMs: 1 });
  assert.equal(r.written, 0);
  assert.equal(r.pending, ENTRIES);
  assert.equal(r.done, false);
  assert.ok(r.job !== null && r.job.endsWith(`${recoveryJobId(owner.proof)}.${siteTag(BASE)}.json`), "the saved job's file is named after the proof and the site");
  assert.deepEqual(await jobFiles(), [`${recoveryJobId(owner.proof)}.${siteTag(BASE)}.json`]);
  const listed = await listRecoveryJobs();
  assert.equal(listed.length, 1);
  assert.equal(listed[0]!.count, count);
  assert.equal(listed[0]!.attempts, 1);
  assert.match(listed[0]!.lastReason ?? "", /not taking recovery writes yet/);
  assert.equal(listed[0]!.baseUrl, BASE);

  // Another site's jobs are not this site's business.
  const elsewhere = await flushRecoveryJobs({ baseUrl: "https://other.test" }, { fetch: s.fetch, backoffMs: 1 });
  assert.deepEqual(elsewhere, { worked: [], left: 0 });
  assert.equal((await jobFiles()).length, 1);

  s.state.writes = "on";
  const flushed = await flushRecoveryJobs({ baseUrl: BASE }, { fetch: s.fetch, backoffMs: 1 });
  assert.equal(flushed.worked.length, 1);
  assert.equal(flushed.left, 0);
  assert.equal(flushed.worked[0]!.result.written, ENTRIES);
  assert.equal(flushed.worked[0]!.result.done, true);
  assert.equal(s.store.size, ENTRIES);
  assert.deepEqual(await jobFiles(), [], "a finished job leaves no file");
  assert.deepEqual(await flushRecoveryJobs({ baseUrl: BASE }, { fetch: s.fetch }), { worked: [], left: 0 });
});

test("a run cut short by its budget saves its progress, and the next run writes only what is left", async () => {
  const s = site();
  s.state.delayMs = 40;
  // 300 files are 600 entries, two batches; one batch takes 40 ms and the budget allows at most one.
  const big = bigTree(300);
  const r = await keepRecoveryEntries(big, { baseUrl: BASE }, { fetch: s.fetch, backoffMs: 1, budgetMs: 20 });
  assert.equal(r.done, false);
  assert.match(r.reason ?? "", /time budget/);
  assert.ok(r.written < big.entries, `stopped early (${r.written} of ${big.entries})`);
  assert.ok(r.job !== null);
  const saved = JSON.parse(await readFile(r.job!, "utf8")) as { state: { progressB64: string }; attempts: number };
  assert.equal(saved.attempts, 1);
  assert.equal(base64ToBytes(saved.state.progressB64)!.length, 300, "one progress byte per member is saved");
  const written = r.written;
  s.state.delayMs = 0;
  s.state.posts = 0;
  const flushed = await flushRecoveryJobs({ baseUrl: BASE }, { fetch: s.fetch, backoffMs: 1 });
  assert.equal(flushed.left, 0);
  const again = flushed.worked[0]!.result;
  assert.equal(again.done, true);
  assert.equal(again.written + written, big.entries, "nothing written twice, nothing missed");
  assert.equal(again.alreadyThere, 0, "entries kept in the first run were not sent again");
  assert.equal(s.store.size, big.entries);
  assert.deepEqual(await jobFiles(), []);
});

test("a job held by a live process is left alone; a stale lock (untouched for ten minutes) is taken over", async () => {
  const s = site();
  const { job, path } = await registerRecoveryJob(made, { baseUrl: BASE });
  const lock = path.replace(/\.json$/, ".lock");
  // An empty lock, as a process that has just created it would leave for a moment: live.
  await writeFile(lock, "");
  assert.equal(await runRecoveryJob(job, { fetch: s.fetch }), null, "held by another process");
  assert.equal(s.state.posts, 0);
  const viaKeep = await keepRecoveryEntries(made, { baseUrl: BASE }, { fetch: s.fetch });
  assert.match(viaKeep.reason ?? "", /another process/);
  assert.equal(viaKeep.job, path);
  const flushed = await flushRecoveryJobs({ baseUrl: BASE }, { fetch: s.fetch });
  assert.deepEqual(flushed, { worked: [], left: 1 });

  // Staleness is the file's age, not its contents.
  const old = new Date(Date.now() - 11 * 60_000);
  await utimes(lock, old, old);
  const r = await runRecoveryJob(job, { fetch: s.fetch, backoffMs: 1 });
  assert.ok(r !== null && r.done, "a stale lock belongs to a process that is gone");
  assert.deepEqual(await jobFiles(), []);
  assert.deepEqual((await readdir(recoveryJobsDir())).filter((n) => n.endsWith(".lock")), [], "the lock is released");
});

test("a file in a pending job is on record for the next record: its member comes back from the job, verified against the job's own proof", async () => {
  const s = site();
  s.state.writes = "off";
  const r = await keepRecoveryEntries(made, { baseUrl: BASE }, { fetch: s.fetch, backoffMs: 1 });
  assert.equal(r.pending, ENTRIES, "nothing written: the job waits");
  const leaves = base64ToBytes(owner.tree.leaves)!;
  const origin0 = bytesToBase64(leaves.subarray(1 + 32, 1 + 64));
  const artifact0 = bytesToBase64(leaves.subarray(1, 1 + 32));
  const pending = await pendingMembersFor([origin0, artifact0, bytesToBase64(sha256(utf8("not in any tree")))], BASE);
  assert.equal(pending.members.size, 2);
  assert.deepEqual(pending.broken, []);
  assert.equal(pending.members.get(origin0)![0]!.leafIndex, 0);
  assert.equal(pending.members.get(artifact0)![0]!.side, "artifact");
  assert.equal(pending.members.get(origin0)![0]!.job.id, recoveryJobId(owner.proof));
  assert.equal((await pendingMembersFor([origin0], "https://other.test")).members.size, 0, "another site's jobs are not this site's");
  s.state.writes = "on";
  await flushRecoveryJobs({ baseUrl: BASE }, { fetch: s.fetch, backoffMs: 1 });
  assert.equal((await pendingMembersFor([origin0], BASE)).members.size, 0, "a finished job is gone from the pending members");
});

test("a job from an owner's export is the same job; a member's export cannot write the tree's entries", async () => {
  const s = site();
  const job = jobFromOwnerExport(owner, BASE);
  assert.equal(job.id, recoveryJobId(owner.proof));
  assert.deepEqual(job.names, owner.tree.names);
  await saveRecoveryJob(job);
  assert.equal((await listRecoveryJobs()).length, 1);
  const r = await runRecoveryJob(job, { fetch: s.fetch, backoffMs: 1 });
  assert.ok(r !== null && r.done);
  assert.equal(s.store.size, ENTRIES);
  // Base URLs compare without a trailing slash.
  assert.equal(jobFromOwnerExport(owner, `${BASE}/`).baseUrl, BASE);
  assert.throws(() => jobFromOwnerExport({ proof: owner.proof, tree: { member: {} } }, BASE), /owner's export/);
  assert.throws(() => jobFromOwnerExport("nonsense", BASE), /owner's export/);
});

test("the same proof kept on two sites is two jobs: one site's writes and progress never count for the other", async () => {
  const a = site();
  const b = site();
  const ra = await keepRecoveryEntries(made, { baseUrl: "https://a.invalid" }, { fetch: a.fetch, backoffMs: 1 });
  assert.ok(ra.done);
  // Registered for B: a fresh job with no progress, posting to B, whatever A has.
  const rb = await keepRecoveryEntries(made, { baseUrl: "https://b.invalid" }, { fetch: b.fetch, backoffMs: 1 });
  assert.ok(rb.done);
  assert.equal(rb.written, ENTRIES, "B's entries were written to B");
  assert.equal(b.store.size, ENTRIES);
  assert.equal(a.store.size, ENTRIES);
  assert.notEqual(siteTag("https://a.invalid"), siteTag("https://b.invalid"));
});

test("a holder that lost its lock to a takeover saves nothing more and cannot remove the new holder's lock", async () => {
  const s = site();
  const { job, path } = await registerRecoveryJob(made, { baseUrl: BASE });
  const lock = path.replace(/\.json$/, ".lock");
  // A slow holder: its first POST hangs until released.
  let release: (() => void) | null = null;
  const gate = new Promise<void>((r) => { release = r; });
  let posts = 0;
  const slow = async (u: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      posts++;
      if (posts === 1) await gate;
    }
    return s.fetch(u, init);
  };
  const first = runRecoveryJob(job, { fetch: slow, backoffMs: 1 });
  await new Promise((r) => setTimeout(r, 20));
  // Its lock goes stale (untouched for ten minutes, as a frozen process's would); another process takes over and finishes.
  const old = new Date(Date.now() - 11 * 60_000);
  await utimes(lock, old, old);
  const second = await runRecoveryJob(job, { fetch: s.fetch, backoffMs: 1 });
  assert.ok(second !== null && second.done, "the new holder finished the job");
  assert.deepEqual(await jobFiles(), [], "and removed it");
  release!();
  const r1 = await first;
  assert.ok(r1 !== null);
  assert.match(r1.reason ?? "", /took over/);
  assert.equal(s.store.size, ENTRIES, "no entry was written twice: the second run's entries, and the first's one batch that landed, are the same keys");
});

test("a broken job (its list no longer rebuilds its root) is set aside and reported: the history is not empty, it is unreadable", async () => {
  const s = site();
  const { job, path } = await registerRecoveryJob(made, { baseUrl: BASE });
  // Corrupt the saved list.
  const damaged = { ...job, leavesB64: bytesToBase64(new Uint8Array(65 * count).fill(7)) };
  await writeFile(path, JSON.stringify(damaged));
  const r = await runRecoveryJob(damaged, { fetch: s.fetch, backoffMs: 1 });
  assert.ok(r !== null && !r.done);
  assert.deepEqual(await jobFiles(), [], "no longer a pending job");
  const broken = (await readdir(recoveryJobsDir())).filter((n) => n.endsWith(".broken.json"));
  assert.equal(broken.length, 1);
  const pending = await pendingMembersFor([bytesToBase64(sha256(utf8("anything")))], BASE);
  assert.equal(pending.broken.length, 1, "reported to every lookup for this site");
  assert.equal((await pendingMembersFor([], "https://other.test")).broken.length, 0, "not to another site's");
  await rm(join(recoveryJobsDir(), broken[0]!));
});
