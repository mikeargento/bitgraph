// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * The anchor pass, and the one thing it exists to get right: an absence has to
 * say WHICH KIND it is. "No upper bound was fetched" and "no upper bound
 * exists" are opposite claims and only one is about the holder.
 */

import { describe, test } from "node:test";
import * as assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { completePosition, type AnchorStatusFile } from "../anchors.js";

const POSITION = { epochId: "e/p+och==", counter: "1546" };

function fakeLedger(answers: Record<string, { status: number; body: unknown }>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    const side = url.includes("before=1") ? "before" : url.includes("witness") ? "witness" : "after";
    const a = answers[side] ?? { status: 200, body: { anchors: [], bound: { state: "undetermined", note: "no answer configured" } } };
    return new Response(JSON.stringify(a.body), { status: a.status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
}

const dir = () => mkdtempSync(join(tmpdir(), "bg-anchors-"));
const statusOf = (d: string): AnchorStatusFile => JSON.parse(readFileSync(join(d, "anchors-status.json"), "utf8")) as AnchorStatusFile;

describe("an absence says which kind it is", () => {
  test("pending and closed are written down with the ledger's own words", async () => {
    const d = dir();
    await completePosition(d, POSITION, {
      fetch: fakeLedger({
        before: { status: 200, body: { anchors: [], bound: { state: "none", note: "No anchor precedes this position in its epoch." } } },
        after: { status: 200, body: { anchors: [], bound: { state: "pending", note: "No anchor follows this position yet." } } },
      }),
    });
    const s = statusOf(d);
    assert.equal(s.before?.state, "none");
    assert.equal(s.after?.state, "pending");
    assert.match(s.after?.note ?? "", /yet/);
    assert.ok(typeof s.after?.askedAt === "string" && s.after.askedAt.length > 10, "it says when it asked");
  });

  test("a 503 is UNAVAILABLE and is never allowed to look like 'closed'", async () => {
    const d = dir();
    await completePosition(d, POSITION, {
      fetch: fakeLedger({
        before: { status: 503, body: { error: "the ledger could not be read", code: "ledger-unavailable" } },
        after: { status: 503, body: { error: "the ledger could not be read", code: "ledger-unavailable" } },
      }),
    });
    const s = statusOf(d);
    assert.equal(s.before?.state, "unavailable");
    assert.equal(s.after?.state, "unavailable");
    assert.match(s.after?.note ?? "", /gap on this machine's side/);
    assert.doesNotMatch(s.after?.note ?? "", /closed/);
  });

  test("a network failure is also UNAVAILABLE, not an empty answer", async () => {
    const d = dir();
    const boom: typeof fetch = async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    };
    const r = await completePosition(d, POSITION, { fetch: boom });
    assert.equal(r.landed, 0);
    assert.equal(statusOf(d).after?.state, "unavailable");
  });

  test("an unrecognised bound state becomes undetermined rather than being trusted", async () => {
    const d = dir();
    await completePosition(d, POSITION, {
      fetch: fakeLedger({
        before: { status: 200, body: { anchors: [], bound: { state: "definitely-fine", note: "trust me" } } },
        after: { status: 200, body: { anchors: [], bound: { state: "definitely-fine", note: "trust me" } } },
      }),
    });
    assert.equal(statusOf(d).before?.state, "undetermined");
  });
});

describe("what the pass does with what it gets", () => {
  const anchor = { attribution: { name: "Ethereum Anchor", title: "https://etherscan.io/block/25735831", message: "0xb40e3a88ae7d5c107dd48503c73036a9ec382cf807c8ade7902389c161e93e77" } };

  test("an anchor is written, and a fully anchored position gets NO status file", async () => {
    const d = dir();
    const r = await completePosition(d, POSITION, {
      fetch: fakeLedger({
        before: { status: 200, body: { anchors: [anchor], bound: { state: "anchored", note: "here it is" } } },
        after: { status: 200, body: { anchors: [anchor], bound: { state: "anchored", note: "here it is" } } },
        witness: { status: 200, body: { version: "bitgraph-anchor-witness/1", headerRlpHex: "0xdead", blockNumber: 1, blockHash: "0x00" } },
      }),
    });
    assert.equal(r.landed, 2);
    assert.ok(existsSync(join(d, "ethereum-anchors", "anchor-before.json")));
    assert.ok(existsSync(join(d, "ethereum-anchors", "anchor-after.json")));
    assert.ok(!existsSync(join(d, "anchors-status.json")), "the file's presence is itself the signal that something is unfinished");
  });

  test("a settled side is never asked about twice", async () => {
    const d = dir();
    let asks = 0;
    const counting: typeof fetch = async (input) => {
      asks++;
      const url = String(input);
      const state = url.includes("before=1") ? "none" : "closed";
      return new Response(JSON.stringify({ anchors: [], bound: { state, note: "permanent" } }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    await completePosition(d, POSITION, { fetch: counting });
    const afterFirst = asks;
    assert.equal(afterFirst, 2);
    await completePosition(d, POSITION, { fetch: counting });
    assert.equal(asks, afterFirst, "none and closed are permanent answers; asking again is wasted");
    const s = statusOf(d);
    assert.equal(s.before?.state, "none");
    assert.equal(s.after?.state, "closed");
  });

  test("a side that is only PENDING is asked again, once its interval has passed", async () => {
    const d = dir();
    let asks = 0;
    const counting: typeof fetch = async (input) => {
      asks++;
      const state = String(input).includes("before=1") ? "none" : "pending";
      return new Response(JSON.stringify({ anchors: [], bound: { state, note: "still open" } }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    await completePosition(d, POSITION, { fetch: counting });
    assert.equal(asks, 2);
    /* ⚠️ Straight away it is left alone. Without this a folder holding
     * hundreds of open positions makes hundreds of requests a minute at one
     * host, from every install, forever. */
    const soon = await completePosition(d, POSITION, { fetch: counting });
    assert.equal(asks, 2, "asked a moment ago, so not asked again");
    assert.equal(soon.waiting, 1);
    /* Later it is asked, because an anchor can only have arrived by then. */
    const later = await completePosition(d, POSITION, { fetch: counting }, { now: Date.now() + 5 * 60_000 });
    assert.equal(asks, 3, "before settled at 'none' and is gone for good; after is pending and gets asked");
    assert.equal(later.waiting, 0);
  });

  test("a failed read is retried sooner than a pending one, and still not in a loop", async () => {
    const d = dir();
    let asks = 0;
    const failing: typeof fetch = async () => {
      asks++;
      return new Response(JSON.stringify({ error: "the ledger could not be read" }), { status: 503, headers: { "Content-Type": "application/json" } });
    };
    await completePosition(d, POSITION, { fetch: failing });
    assert.equal(asks, 2);
    await completePosition(d, POSITION, { fetch: failing });
    assert.equal(asks, 2, "a host that is down does not come back faster for being asked");
    await completePosition(d, POSITION, { fetch: failing }, { now: Date.now() + 90_000 });
    assert.equal(asks, 4, "after a minute it is worth trying again");
  });

  test("a pass over many positions stops on its request budget and says it is partial", async () => {
    const { completeFolder } = await import("../anchors.js");
    const root = dir();
    let asks = 0;
    const counting: typeof fetch = async () => {
      asks++;
      return new Response(JSON.stringify({ anchors: [], bound: { state: "pending", note: "" } }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    const positions = Array.from({ length: 100 }, (_, i) => ({ epochId: "e", counter: String(i + 1) }));
    const pass = await completeFolder(root, positions, { fetch: counting }, undefined, 10);
    assert.ok(asks <= 12, `the budget held: ${asks} requests`);
    assert.equal(pass.partial, true, "a pass that stopped early never reports its counts as the folder's");
    assert.ok(pass.positions < 100);
  });

  test("an anchor with no witness still lands: a missing header is not a missing anchor", async () => {
    const d = dir();
    const r = await completePosition(d, POSITION, {
      fetch: fakeLedger({
        before: { status: 200, body: { anchors: [anchor], bound: { state: "anchored", note: "" } } },
        after: { status: 200, body: { anchors: [anchor], bound: { state: "anchored", note: "" } } },
        witness: { status: 404, body: { error: "witness unavailable" } },
      }),
    });
    assert.equal(r.landed, 2);
    assert.ok(existsSync(join(d, "ethereum-anchors", "anchor-after.json")));
    assert.ok(!existsSync(join(d, "ethereum-anchors", "anchor-after-witness.json")));
  });

  test("an epoch id with slashes and pluses in it never becomes a path", async () => {
    const d = dir();
    await completePosition(d, { epochId: "a/b+c==", counter: "7" }, {
      fetch: fakeLedger({ before: { status: 200, body: { anchors: [], bound: { state: "pending", note: "" } } }, after: { status: 200, body: { anchors: [], bound: { state: "pending", note: "" } } } }),
    });
    assert.equal(statusOf(d).position.epochId, "a/b+c==", "the epoch is recorded verbatim; only the directory name is made safe");
  });
});
