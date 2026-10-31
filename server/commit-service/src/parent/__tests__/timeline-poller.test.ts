/**
 * The timeline poller and its journal: every block bound in order, catch-up after an outage or a restart, reorgs
 * re-read, and the journal's gzipped once-a-minute batches. The chain is scripted and the enclave is a stand-in that
 * counts like v13 (nonce at N, payload at N+1).
 *
 *   cd server/commit-service && node --import tsx/esm --test src/parent/__tests__/timeline-poller.test.ts
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { parseBlockReadFile, blockReadDigestB64 } from "@mikeargento/bitgraph-verify";
import type { BitGraphProof } from "bitgraph";
import type { BlockSource, ChainHead } from "../chain-sources.js";
import { ChainPoller } from "../timeline-poller.js";
import { TimelineJournal, readTimelineObject, type TimelineLine } from "../timeline-journal.js";

const EPOCH = "KKOixUTETu9LB6jJxX+k+jvLaUZNUSoITPjHfzubqCo=";
const T0 = 1_793_404_750;
const tmp = () => mkdtempSync(join(tmpdir(), "timeline-"));
const hex = (s: string) => "0x" + createHash("sha256").update(s).digest("hex");

/** A scripted Base: blocks by number on the current branch; `fork(n, tag)` replaces block n onward. */
function chain(height: number) {
  let blocks: ChainHead[] = [];
  const make = (n: number, tag: string, parent: string): ChainHead => ({ chain: "base", chainId: "eip155:8453", number: n, hash: hex(`${tag} ${n}`), parentHash: parent, timestamp: T0 + 2 * n });
  const extend = (to: number, tag = "main") => {
    for (let n = blocks.length; n <= to; n++) blocks.push(make(n, tag, blocks[n - 1]?.hash ?? "0x" + "00".repeat(32)));
  };
  extend(height);
  let down = false;
  const source: BlockSource & { asked: number } = {
    chain: "base", chainId: "eip155:8453", origin: "https://a.example + https://b.example", asked: 0,
    ready: async () => {},
    latest: async () => { if (down) throw new Error("HTTP 503"); return blocks[blocks.length - 1]!; },
    at: async (n) => { source.asked++; if (down) throw new Error("HTTP 503"); const b = blocks[n]; if (!b) throw new Error(`no base block ${n} yet`); return b; },
    byHash: async () => null,
  };
  return {
    source,
    grow: (to: number) => extend(to),
    fork: (from: number, to: number, tag: string) => { blocks = blocks.slice(0, from); extend(to, tag); },
    setDown: (d: boolean) => { down = d; },
    hashAt: (n: number) => blocks[n]!.hash,
  };
}

/** The enclave stand-in: binds digests at counts N, N+1 and remembers them in order. */
function enclave() {
  let counter = 0;
  const bound: string[] = [];
  const bind = async (digestB64: string): Promise<BitGraphProof> => {
    counter += 2;
    bound.push(digestB64);
    return { version: "bitgraph/1", artifact: { hashAlg: "sha256", digestB64 }, commit: { counter: String(counter), slotCounter: String(counter - 1), epochId: EPOCH } } as unknown as BitGraphProof;
  };
  return { bind, bound };
}

/** A journal capturing lines in memory, for poller tests. */
const memJournal = () => { const lines: TimelineLine[] = []; return { lines, append: (l: TimelineLine) => { lines.push(l); } }; };
const numbers = (lines: TimelineLine[]) => lines.map((l) => parseBlockReadFile(l.blockFile!)!.number);

function poller(c: ReturnType<typeof chain>, e: ReturnType<typeof enclave>, j: { append(l: TimelineLine): void }, dir = tmp(), opts: { maxPerPass?: number; epoch?: () => string | null } = {}) {
  return new ChainPoller({ source: c.source, bind: e.bind, journal: j, stateDir: dir, epochId: opts.epoch ?? (() => EPOCH), pollMs: 1000, ...(opts.maxPerPass ? { maxPerPass: opts.maxPerPass } : {}) });
}

test("first start binds the head; every later block is bound, in order, as its own block file", async () => {
  const c = chain(100), e = enclave(), j = memJournal();
  const p = poller(c, e, j);
  assert.equal(await p.pass(), true);
  c.grow(104);
  assert.equal(await p.pass(), true);
  assert.deepEqual(numbers(j.lines), [100, 101, 102, 103, 104]);
  for (const [i, l] of j.lines.entries()) {
    const f = parseBlockReadFile(l.blockFile!)!;
    assert.equal(l.kind, "block");
    assert.equal(f.epochId, EPOCH);
    assert.equal(f.chainId, "eip155:8453");
    assert.equal(f.hash, c.hashAt(f.number));
    assert.equal(f.timestamp, T0 + 2 * f.number);
    assert.equal(l.proof.artifact.digestB64, blockReadDigestB64(l.blockFile!), "the proof binds the file's own digest");
    assert.equal(e.bound[i], l.proof.artifact.digestB64);
  }
  assert.equal(p.state.behind, 0);
  assert.equal(p.state.last?.number, 104);
});

test("an outage loses nothing: missed blocks are read in order once the providers answer", async () => {
  const c = chain(10), e = enclave(), j = memJournal();
  const p = poller(c, e, j);
  await p.pass();
  c.setDown(true);
  c.grow(30);
  await assert.rejects(p.pass(), /HTTP 503/);
  c.setDown(false);
  await p.pass();
  assert.deepEqual(numbers(j.lines), Array.from({ length: 21 }, (_, i) => 10 + i));
});

test("a long catch-up runs in passes of maxPerPass, and says how far behind it is", async () => {
  const c = chain(0), e = enclave(), j = memJournal();
  const p = poller(c, e, j, tmp(), { maxPerPass: 7 });
  await p.pass();
  c.grow(20);
  assert.equal(await p.pass(), false);
  assert.equal(p.state.behind, 13);
  while (!(await p.pass()));
  assert.deepEqual(numbers(j.lines), Array.from({ length: 21 }, (_, i) => i));
});

test("a restart resumes from the cursor on disk, with no gap and no repeat", async () => {
  const c = chain(50), e = enclave(), j = memJournal(), dir = tmp();
  await poller(c, e, j, dir).pass();
  c.grow(53);
  await poller(c, e, j, dir).pass();
  assert.deepEqual(numbers(j.lines), [50, 51, 52, 53]);
});

test("a reorg: the replaced blocks are read again from the fork, and the old reads stay in the record", async () => {
  const c = chain(10), e = enclave(), j = memJournal();
  const p = poller(c, e, j);
  await p.pass();
  c.grow(14);
  await p.pass();
  c.fork(13, 15, "side");
  await p.pass(); // finds the parent mismatch and walks back to 12
  await p.pass(); // reads 13', 14', 15
  assert.equal(p.state.reorgs, 1);
  assert.deepEqual(numbers(j.lines), [10, 11, 12, 13, 14, 13, 14, 15]);
  const last3 = j.lines.slice(-3).map((l) => parseBlockReadFile(l.blockFile!)!.hash);
  assert.deepEqual(last3, [c.hashAt(13), c.hashAt(14), c.hashAt(15)]);
});

test("a reorg at the tip, at the same height, is caught too", async () => {
  const c = chain(10), e = enclave(), j = memJournal();
  const p = poller(c, e, j);
  await p.pass();
  c.fork(10, 10, "side");
  await p.pass();
  await p.pass();
  assert.equal(p.state.reorgs, 1);
  assert.deepEqual(numbers(j.lines), [10, 10]);
});

test("lag: each read's attestation time minus its block's time, with the 5-minute median and the out-of-range streak", async () => {
  const c = chain(10), e = enclave(), j = memJournal();
  // The stand-in enclave's proofs carry no attestation; give each read a Nitro time by its block: block n at T0 + 2n + lag(n).
  const lagOf: Record<number, number> = { 10: 1, 11: 1.5, 12: 6, 13: 7, 14: 0.5 };
  let now = 5_000;
  const p = new ChainPoller({
    source: c.source, bind: e.bind, journal: j, stateDir: tmp(), epochId: () => EPOCH, pollMs: 1000, now: () => now,
    lagLimits: { minS: -2, maxS: 5 },
    nitroTimeMs: (proof) => { const f = parseBlockReadFile(j.lines.find((l) => l.proof === proof)?.blockFile ?? "") ; return f ? (f.timestamp + lagOf[f.number]!) * 1000 : null; },
  });
  // nitroTimeMs is asked after the journal append, so the line is there to look up.
  await p.pass();
  assert.deepEqual([p.state.lagS, p.state.outOfRange, p.state.outOfRangeStreak], [1, 0, 0]);
  c.grow(13);
  await p.pass();
  assert.deepEqual([p.state.lagS, p.state.outOfRange, p.state.outOfRangeStreak], [7, 2, 2]);
  assert.equal(p.state.medianLag5mS, (1.5 + 6) / 2);
  c.grow(14);
  await p.pass();
  assert.deepEqual([p.state.outOfRange, p.state.outOfRangeStreak], [2, 0]);
  assert.equal(p.state.lastReadAtMs, 5_000);
  now += 6 * 60_000;
  c.grow(15);
  lagOf[15] = 2;
  await p.pass();
  assert.equal(p.state.medianLag5mS, 2, "reads older than five minutes leave the median");
});

test("nothing is bound while the enclave is not open for binds", async () => {
  const c = chain(10), e = enclave(), j = memJournal();
  let epoch: string | null = null;
  const p = poller(c, e, j, tmp(), { epoch: () => epoch });
  await p.pass();
  assert.equal(j.lines.length, 0);
  epoch = EPOCH;
  await p.pass();
  assert.deepEqual(numbers(j.lines), [10]);
});

// ---------------------------------------------------------------------------
// The journal
// ---------------------------------------------------------------------------

const line = (counter: number, epochId = EPOCH): TimelineLine => ({ kind: "block", proof: { commit: { counter: String(counter), epochId } } as unknown as BitGraphProof, blockFile: `file ${counter}` });

test("the journal uploads each minute's lines as one gzipped object per epoch, then clears them", async () => {
  const dir = tmp();
  const put = new Map<string, Buffer>();
  let t = 1_793_404_750_000;
  const jr = new TimelineJournal(dir, async (k, b) => { put.set(k, b); }, () => t);
  jr.append(line(4)); jr.append(line(6)); jr.append(line(2, "A".repeat(43) + "="));
  await jr.flush();
  assert.deepEqual([...put.keys()].sort(), [
    "timeline/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/000000000002-000000000002.jsonl.gz",
    "timeline/KKOixUTETu9LB6jJxX-k-jvLaUZNUSoITPjHfzubqCo/000000000004-000000000006.jsonl.gz",
  ]);
  const main = readTimelineObject(put.get("timeline/KKOixUTETu9LB6jJxX-k-jvLaUZNUSoITPjHfzubqCo/000000000004-000000000006.jsonl.gz")!);
  assert.deepEqual(main.map((l) => l.proof.commit.counter), ["4", "6"]);
  assert.deepEqual(readdirSync(dir), []);
  t += 60_000;
  jr.append(line(8));
  await jr.flush();
  assert.equal(put.size, 3);
  assert.equal(jr.stats.objects, 3);
});

test("a failed upload keeps the batch and retries it first, oldest first", async () => {
  const dir = tmp();
  const keys: string[] = [];
  let fail = true;
  let t = 1;
  const jr = new TimelineJournal(dir, async (k) => { if (fail) throw new Error("S3 down"); keys.push(k); }, () => t++);
  jr.append(line(2));
  await jr.flush();
  assert.equal(jr.stats.lastError, "S3 down");
  jr.append(line(4));
  fail = false;
  await jr.flush();
  assert.deepEqual(keys, [`timeline/KKOixUTETu9LB6jJxX-k-jvLaUZNUSoITPjHfzubqCo/000000000002-000000000002.jsonl.gz`, `timeline/KKOixUTETu9LB6jJxX-k-jvLaUZNUSoITPjHfzubqCo/000000000004-000000000004.jsonl.gz`]);
  assert.equal(jr.stats.lastError, null);
});

test("a torn last line from a crash mid-append is left out, not fatal", async () => {
  const dir = tmp();
  const got: Buffer[] = [];
  const jr = new TimelineJournal(dir, async (_k, b) => { got.push(b); });
  jr.append(line(2));
  writeFileSync(join(dir, "pending.jsonl"), readFileSync(join(dir, "pending.jsonl"), "utf8") + '{"kind":"blo', { flag: "w" });
  await jr.flush();
  assert.equal(readTimelineObject(got[0]!).length, 1);
});

test("real v13 proofs, attestations and all, compress (a small sample; the live ratio is measured once running)", async () => {
  const fixtures = new URL("../../../../../packages/verify/src/__tests__/fixtures/v13/", import.meta.url);
  const proofs = [2, 4, 6].map((n) => JSON.parse(readFileSync(new URL(`proof-${n}.json`, fixtures), "utf8")) as BitGraphProof);
  const got: Buffer[] = [];
  const jr = new TimelineJournal(tmp(), async (_k, b) => { got.push(b); });
  for (const proof of proofs) jr.append({ kind: "file", proof });
  await jr.flush();
  assert.equal(readTimelineObject(got[0]!).length, 3);
  assert.ok(jr.stats.ratio! > 1.5, `ratio ${jr.stats.ratio}`);
  console.log(`[sample] 3 real v13 proofs: ${jr.stats.rawBytes} bytes raw, ${jr.stats.gzipBytes} gzipped, ratio ${jr.stats.ratio!.toFixed(2)}`);
});
