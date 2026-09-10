import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { compareVersions, parseFeed, checkForUpdate } from "../update.js";

const feed = (body: unknown, status = 200): typeof fetch =>
  (async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;

describe("the update channel", () => {
  test("versions compare by part, not by string", () => {
    assert.equal(compareVersions("0.1.0", "0.1.0"), 0);
    assert.equal(compareVersions("0.2.0", "0.10.0"), -1);
    assert.equal(compareVersions("1.0.0", "0.9.9"), 1);
  });
  test("a newer feed is available, the same or older is not", async () => {
    const newer = await checkForUpdate({ current: "0.1.0", fetch: feed({ version: "0.2.0", url: "https://x/BitGraph-Recorder.dmg", notes: "https://x/notes", sha256: "a".repeat(64) }) });
    assert.equal(newer.available, true);
    assert.equal(newer.latest, "0.2.0");
    assert.equal(newer.url, "https://x/BitGraph-Recorder.dmg");
    assert.equal(newer.sha256, "a".repeat(64));
    const same = await checkForUpdate({ current: "0.2.0", fetch: feed({ version: "0.2.0", url: "https://x/d.dmg" }) });
    assert.equal(same.available, false);
    const older = await checkForUpdate({ current: "0.3.0", fetch: feed({ version: "0.2.0", url: "https://x/d.dmg" }) });
    assert.equal(older.available, false);
  });
  test("a feed that cannot be believed is an error, never 'current'", async () => {
    assert.throws(() => parseFeed({ version: "latest", url: "https://x/d.dmg" }), /names no version/);
    assert.throws(() => parseFeed({ version: "0.2.0", url: "http://x/d.dmg" }), /https/);
    assert.throws(() => parseFeed("nope"), /not an object/);
    await assert.rejects(checkForUpdate({ current: "0.1.0", fetch: feed({}, 500) }), /answered 500/);
    await assert.rejects(checkForUpdate({ current: "dev", fetch: feed({ version: "0.2.0", url: "https://x/d.dmg" }) }), /not a version/);
  });
  test("optional fields are dropped when malformed, never trusted", () => {
    const f = parseFeed({ version: "0.2.0", url: "https://x/d.dmg", notes: "javascript:alert(1)", sha256: "short" });
    assert.equal(f.notes, undefined);
    assert.equal(f.sha256, undefined);
  });
});
