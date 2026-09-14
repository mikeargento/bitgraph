import { describe, test } from "node:test";
import * as assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeProofBeside } from "../task.js";

describe("the server writes the task proof beside the sealed file", () => {
  test("named after the file, whole, and never over an existing one", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bg-proof-beside-"));
    const task = join(dir, "make_task.txt");
    writeFileSync(task, "BITGRAPH TASK\ncommitment here\n");
    const proof = { version: "bitgraph/1", commit: { counter: "106" }, slotAllocation: { counter: "103" }, environment: { measurement: "abc" } } as never;
    const first = await writeProofBeside(task, proof);
    assert.equal(first, join(dir, "make_task.proof.json"));
    assert.deepEqual(JSON.parse(readFileSync(first, "utf8")), proof, "every field, as given");
    const second = await writeProofBeside(task, { ...(proof as object), commit: { counter: "110" } } as never);
    assert.equal(second, join(dir, "make_task.proof.110.json"), "a taken name gets the counter, nothing is overwritten");
    assert.equal(JSON.parse(readFileSync(first, "utf8")).commit.counter, "106");
    const bare = join(dir, "README");
    writeFileSync(bare, "x");
    assert.equal(await writeProofBeside(bare, proof), join(dir, "README.proof.json"));
    assert.ok(existsSync(join(dir, "README.proof.json")));
  });
});
