import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { explain, isBlocked, BLOCKED_PREFIX, BLOCKED_HOW } from "../blocked.js";

const fsError = (code: string, path: string) => Object.assign(new Error(`${code}: operation not permitted, open '${path}'`), { code, path });

describe("macOS blocking the app", () => {
  test("EPERM on a path becomes a sentence that names the path and the settings pane", () => {
    const why = explain(fsError("EPERM", "/Users/x/Desktop/BitGraph/Recordings/.index.jsonl"));
    assert.equal(why.blocked, true);
    assert.equal(why.path, "/Users/x/Desktop/BitGraph/Recordings/.index.jsonl");
    assert.equal(why.message, `${BLOCKED_PREFIX}/Users/x/Desktop/BitGraph/Recordings/.index.jsonl. ${BLOCKED_HOW}`);
    assert.ok(!why.message.includes("EPERM"), "the raw code never reaches the person");
  });
  test("EACCES counts too, and a block without a path still says where to go", () => {
    const why = explain(Object.assign(new Error("EACCES"), { code: "EACCES" }));
    assert.equal(why.blocked, true);
    assert.ok(why.message.startsWith(`${BLOCKED_PREFIX}a folder it needs.`));
  });
  test("every other error passes through untouched", () => {
    assert.equal(isBlocked(fsError("ENOENT", "/nowhere")), false);
    const why = explain(fsError("ENOENT", "/nowhere"));
    assert.equal(why.blocked, false);
    assert.ok(why.message.startsWith("ENOENT"));
    assert.equal(explain("plain string").message, "plain string");
  });
});
