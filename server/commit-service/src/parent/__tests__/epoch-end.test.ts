// The epoch's closing BitGraph: the note it binds, where the rotation's close request is looked for, the journal line
// that keeps the note, and the ledger's copy of the note text, which must match the parent's byte for byte.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { BitGraphProof } from "bitgraph";
import { epochEndFileText, closeRequestPath, EPOCH_END_FORMAT } from "../epoch-end.js";
import { TimelineJournal, readTimelineObject } from "../timeline-journal.js";

const EPOCH = "UaNqmoVZLL8U8WEbDULPs3CY7cV3NU3G87TtqSaRCHI=";
const sha256B64 = (s: string) => createHash("sha256").update(s, "utf8").digest("base64");

test("the closing note names its epoch, is 2-space JSON with a final newline, and depends on nothing else", () => {
  const text = epochEndFileText(EPOCH);
  assert.ok(text.endsWith("}\n"));
  const j = JSON.parse(text) as Record<string, unknown>;
  assert.deepEqual(Object.keys(j), ["format", "epochId", "note"]);
  assert.equal(j["format"], EPOCH_END_FORMAT);
  assert.equal(j["epochId"], EPOCH);
  assert.equal(text, JSON.stringify(j, null, 2) + "\n");
  assert.equal(epochEndFileText(EPOCH), text, "the same epoch always gives the same note");
  assert.notEqual(epochEndFileText("A".repeat(43) + "="), text);
  // A fixed vector, so a change to the note's bytes cannot slip through unnoticed.
  assert.equal(sha256B64(text), "IKu+N2JMw1yoRhi+AFQgphKmS3DdudcdEyDgJI8dmlE=");
});

test("the close request is looked for under the epoch's URL-safe id, without padding", () => {
  assert.equal(closeRequestPath("/x/close", EPOCH), join("/x/close", "UaNqmoVZLL8U8WEbDULPs3CY7cV3NU3G87TtqSaRCHI.request.json"));
  assert.equal(closeRequestPath("/x/close", "a+b/c=="), join("/x/close", "a-b_c.request.json"));
});

test("the ledger rebuilds exactly the parent's note, so it can label the closing row with no lookup", () => {
  const ledger = readFileSync(join(import.meta.dirname, "../../../../../website/src/components/ledger-rows.tsx"), "utf8");
  const body = ledger.match(/function epochEndText\(epochId: string\): string \{([\s\S]*?)\n\}\n/)?.[1];
  assert.ok(body, "ledger-rows.tsx has epochEndText");
  const fromLedger = new Function("epochId", body!)(EPOCH) as string;
  assert.equal(fromLedger, epochEndFileText(EPOCH));
});

test("the journal keeps the closing record with its note", async () => {
  const dir = mkdtempSync(join(tmpdir(), "epoch-end-"));
  const put = new Map<string, Buffer>();
  const jr = new TimelineJournal(dir, async (k, b) => { put.set(k, b); }, () => 1_794_009_600_000);
  const proof = { commit: { counter: "30", epochId: EPOCH } } as unknown as BitGraphProof;
  jr.append({ kind: "end", proof, endFile: epochEndFileText(EPOCH) });
  await jr.flush();
  const [obj] = [...put.values()];
  const lines = readTimelineObject(obj!);
  assert.equal(lines.length, 1);
  assert.equal(lines[0]!.kind, "end");
  assert.equal(lines[0]!.endFile, epochEndFileText(EPOCH));
});
