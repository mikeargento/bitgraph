/**
 * Reading the timeline's records back for bundle export: lines still on disk and gzipped batches in the bucket
 * (an in-memory stand-in here), found by digest locally or through the by-digest index.
 *
 *   cd server/commit-service && node --import tsx/esm --test src/parent/__tests__/timeline-records.test.ts
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BitGraphProof } from "bitgraph";
import { TimelineJournal, type TimelineLine } from "../timeline-journal.js";
import { TimelineRecords, type ObjectStore } from "../timeline-records.js";

const EPOCH = "KKOixUTETu9LB6jJxX+k+jvLaUZNUSoITPjHfzubqCo=";
const digest = (n: number) => Buffer.alloc(32, n).toString("base64");
const line = (counter: number, kind: TimelineLine["kind"] = "file"): TimelineLine => ({
  kind, proof: { artifact: { hashAlg: "sha256", digestB64: digest(counter) }, commit: { counter: String(counter), epochId: EPOCH } } as unknown as BitGraphProof,
  ...(kind === "block" ? { blockFile: `block ${counter}` } : {}),
});

function bucket(): ObjectStore & { objects: Map<string, Buffer> } {
  const objects = new Map<string, Buffer>();
  return {
    objects,
    async list(prefix, startAfter, until) {
      const out: string[] = [];
      for (const k of [...objects.keys()].sort()) {
        if (!k.startsWith(prefix) || k <= startAfter) continue;
        if (until(k)) break;
        out.push(k);
      }
      return out;
    },
    async get(key) { return objects.get(key) ?? null; },
  };
}

test("records come back from the bucket's batches and from this machine, one per count", async () => {
  const dir = mkdtempSync(join(tmpdir(), "records-"));
  const b = bucket();
  let t = 1;
  const journal = new TimelineJournal(join(dir, "journal"), async (k, body) => { b.objects.set(k, body); }, () => t++);
  for (let c = 2; c <= 40; c += 2) journal.append(line(c, c % 4 === 0 ? "block" : "file"));
  await journal.flush(); // counts 2..40 go to the bucket
  for (let c = 42; c <= 50; c += 2) journal.append(line(c));
  const records = new TimelineRecords(join(dir, "journal"), dir, b);
  const got = await records.around(EPOCH, "40", 10n);
  assert.deepEqual(got.map((l) => Number(l.proof.commit.counter)).sort((x, y) => x - y), [30, 32, 34, 36, 38, 40, 42, 44, 46, 48, 50]);
  assert.equal(got.find((l) => l.proof.commit.counter === "36")?.blockFile, "block 36");
});

test("a file is found locally by its digest, else through the bucket's by-digest index", async () => {
  const dir = mkdtempSync(join(tmpdir(), "records-"));
  const b = bucket();
  const journal = new TimelineJournal(join(dir, "journal"), async () => {});
  journal.append(line(6));
  const records = new TimelineRecords(join(dir, "journal"), dir, b);
  assert.deepEqual(await records.find(digest(6)), { epochId: EPOCH, counter: "6" });
  const safe = digest(8).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  b.objects.set(`by-digest/${safe}.json`, Buffer.from(JSON.stringify(line(8).proof)));
  assert.deepEqual(await records.find(digest(8)), { epochId: EPOCH, counter: "8" });
  assert.equal(await records.find(digest(9)), null);
});

test("the genesis record is kept beside the cursors", () => {
  const dir = mkdtempSync(join(tmpdir(), "records-"));
  const records = new TimelineRecords(join(dir, "journal"), dir, null);
  assert.equal(records.genesis(EPOCH), null);
  const g: TimelineLine = { kind: "genesis", proof: line(2).proof, genesisFile: "{}" };
  records.keepGenesis(g);
  assert.deepEqual(records.genesis(EPOCH), g);
});
