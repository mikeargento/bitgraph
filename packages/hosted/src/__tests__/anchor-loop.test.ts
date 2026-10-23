// Copyright (c) 2024-2026 Argento Computing Inc.

/**
 * The anchor loop: head watcher at block rate, free-running timer at rest.
 *
 * Measured 2026-10-02: a 12 s timer has the same period as Ethereum slots, so
 * its phase against block production froze wherever the last restart left it,
 * and anchors landed 18 to 25 s after their block. At 12 s or less the service
 * now watches the head number and anchors when a new head appears. Above 12 s
 * nothing changes.
 *
 * Most tests swap the loop's calls (head read, anchor run) through the module's
 * test seam and drive time with mock timers. The last test runs the REAL anchor
 * path against a mocked fetch and checks the anchored block is still the
 * head's parent, by hash.
 *
 * Run: node --test src/__tests__/anchor-loop.test.ts
 */
import { test, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// bitcoin-anchor.ts imports "./eth-header.js" (the compiled name). Under node's
// type stripping only the .ts exists, so map a missing local .js to its .ts.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      if (specifier.startsWith(".") && specifier.endsWith(".js")) {
        return nextResolve(specifier.slice(0, -3) + ".ts", context);
      }
      throw err;
    }
  },
});

delete process.env.LEDGER_BUCKET;
delete process.env.ANCHOR_SIGNING_KEY_B64;
delete process.env.ANCHOR_HEAD_POLL_MS;

const anchor = await import("../bitcoin-anchor.ts");
const {
  startAnchorService, stopAnchorService, setAnchorInterval, getAnchorStatus,
  headPollMsFromEnv, HEAD_POLL_MS, __setAnchorLoopDepsForTest,
} = anchor;

/** Let pending promise chains settle (setImmediate is not mocked). */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise<void>((r) => setImmediate(r));
}

/** Advance mock time in poll-sized steps, settling async work between steps. */
async function advance(ms: number, step = 500): Promise<void> {
  let left = ms;
  while (left > 0) {
    const d = Math.min(step, left);
    mock.timers.tick(d);
    left -= d;
    await flush();
  }
}

/** A fake chain: a head number the test moves, and an anchor run that anchors head - 1. */
function fakeChain(startHead = 100) {
  const s = {
    head: startHead,
    anchored: 0,
    headReads: 0,
    checks: [] as Array<{ at: number; head: number }>,
    headFails: false,
    checkAdvances: true,
    busy: false,
  };
  __setAnchorLoopDepsForTest({
    headNumber: async () => {
      s.headReads++;
      if (s.headFails) throw new Error("rpc down");
      return s.head;
    },
    check: async () => {
      s.checks.push({ at: Date.now(), head: s.head });
      if (s.checkAdvances) s.anchored = Math.max(s.anchored, s.head - 1);
    },
    anchoredBlock: () => s.anchored,
    busy: () => s.busy,
  });
  return s;
}

beforeEach(() => {
  mock.timers.enable({ apis: ["setInterval", "setTimeout", "Date"], now: 1_000_000 });
});

afterEach(() => {
  stopAnchorService();
  __setAnchorLoopDepsForTest();
  mock.timers.reset();
  delete process.env.ANCHOR_HEAD_POLL_MS;
});

test("ANCHOR_HEAD_POLL_MS: default 1500, clamped to 500..6000, junk ignored", () => {
  assert.equal(HEAD_POLL_MS, 1500);
  assert.equal(headPollMsFromEnv(undefined), 1500);
  assert.equal(headPollMsFromEnv(""), 1500);
  assert.equal(headPollMsFromEnv("abc"), 1500);
  assert.equal(headPollMsFromEnv("100"), 500);
  assert.equal(headPollMsFromEnv("99999"), 6000);
  assert.equal(headPollMsFromEnv("2000"), 2000);
});

test("(a) head mode: anchors within one poll of a new head, never on an unchanged head", async () => {
  const s = fakeChain(100);
  startAnchorService(12_000);
  await flush();

  const st = getAnchorStatus();
  assert.equal(st.mode, "head");
  assert.equal(st.headPollMs, 1500);
  assert.equal(st.running, true);
  assert.equal(st.intervalSeconds, 12);

  // Start: the first poll sees head 100 and anchors its parent at once.
  assert.equal(s.checks.length, 1);
  assert.equal(s.anchored, 99);

  // Unchanged head for most of a slot: polls happen, no anchor runs.
  const readsBefore = s.headReads;
  await advance(10_500);
  assert.ok(s.headReads - readsBefore >= 6, `expected ~7 polls, saw ${s.headReads - readsBefore}`);
  assert.equal(s.checks.length, 1);

  // Head moves: the very next poll runs the anchor.
  s.head = 101;
  const movedAt = Date.now();
  await advance(1500);
  assert.equal(s.checks.length, 2);
  assert.ok(s.checks[1].at - movedAt <= 1500, `latency ${s.checks[1].at - movedAt}ms exceeds one poll`);
  assert.equal(s.anchored, 100);
  assert.equal(getAnchorStatus().lastSeenHead, 101);

  // A lagging backend reporting a LOWER head is ignored.
  s.head = 100;
  await advance(3000);
  assert.equal(s.checks.length, 2);

  // Several heads in a row, one run each.
  for (const h of [102, 103, 104]) {
    s.head = h;
    await advance(12_000);
  }
  assert.equal(s.checks.length, 5);
  assert.equal(s.anchored, 103);
});

test("(a) head mode: a run that did not reach head - 1 is retried on the next polls, at most 3 runs per head", async () => {
  const s = fakeChain(200);
  s.checkAdvances = false; // e.g. getLatestBlock hit a backend one block behind, or the TEE failed
  startAnchorService(12_000);
  await flush();
  assert.equal(s.checks.length, 1);
  await advance(1500);
  assert.equal(s.checks.length, 2);
  await advance(1500);
  assert.equal(s.checks.length, 3);
  await advance(6000);
  assert.equal(s.checks.length, 3, "capped at 3 runs for one head");
  // Next head gets fresh runs, and a successful one stops the retries.
  s.checkAdvances = true;
  s.head = 201;
  await advance(1500);
  assert.equal(s.checks.length, 4);
  await advance(6000);
  assert.equal(s.checks.length, 4);
});

test("(a) head mode: an anchor already in flight defers the run without spending it", async () => {
  const s = fakeChain(300);
  s.busy = true;
  startAnchorService(12_000);
  await advance(4500);
  assert.equal(s.checks.length, 0);
  s.busy = false;
  await advance(1500);
  assert.equal(s.checks.length, 1);
});

test("(b) timer mode at 3600 s: unchanged, a free-running timer with an immediate first run, no head polling", async () => {
  const s = fakeChain(400);
  startAnchorService(3_600_000);
  await flush();

  const st = getAnchorStatus();
  assert.equal(st.mode, "timer");
  assert.equal(st.headPollMs, null);
  assert.equal(st.running, true);
  assert.equal(st.intervalSeconds, 3600);

  assert.equal(s.checks.length, 1, "runs immediately on start, as before");
  s.head = 401; // head movement means nothing in timer mode
  mock.timers.tick(3_599_999);
  await flush();
  assert.equal(s.checks.length, 1);
  mock.timers.tick(1);
  await flush();
  assert.equal(s.checks.length, 2);
  mock.timers.tick(3_600_000);
  await flush();
  assert.equal(s.checks.length, 3);
  assert.equal(s.headReads, 0, "timer mode never reads the head");
});

test("(b) 13 s is still timer mode; 12 s is head mode", async () => {
  fakeChain(500);
  startAnchorService(13_000);
  assert.equal(getAnchorStatus().mode, "timer");
  setAnchorInterval(12);
  assert.equal(getAnchorStatus().mode, "head");
});

test("(c) switching interval switches modes and stops the old loop", async () => {
  const s = fakeChain(600);
  startAnchorService(3_600_000);
  await flush();
  assert.equal(s.checks.length, 1);

  // A block arrives while at rest; nothing anchors it until the next hourly tick.
  s.head = 601;
  await advance(6000);
  assert.equal(s.checks.length, 1);

  // At rest -> fire it up.
  const r = setAnchorInterval(12);
  assert.deepEqual(r, { ok: true, intervalSeconds: 12 });
  await flush();
  assert.equal(getAnchorStatus().mode, "head");
  assert.equal(s.checks.length, 2, "the head watcher anchors the current head's parent right away");

  // One new head every 12 s for a full hour. If the old 3600 s timer were
  // still alive it would add a run at the hour mark; the count proves it is gone.
  const heads = 300;
  for (let i = 1; i <= heads; i++) {
    s.head = 601 + i;
    await advance(12_000, 1500);
  }
  assert.equal(s.checks.length, 2 + heads);

  // Fire it up -> at rest: the head watcher stops (no more reads), the timer takes over.
  setAnchorInterval(3600);
  assert.equal(getAnchorStatus().mode, "timer");
  assert.equal(getAnchorStatus().headPollMs, null);
  const reads = s.headReads;
  const checks = s.checks.length;
  s.head += 5;
  await advance(60_000, 1500);
  assert.equal(s.headReads, reads, "no head polls after switching to the timer");
  assert.equal(s.checks.length, checks, "no immediate run on a timer restart, as before");
  mock.timers.tick(3_600_000 - 60_000);
  await flush();
  assert.equal(s.checks.length, checks + 1);

  // Stop stops whichever loop is running.
  stopAnchorService();
  const st = getAnchorStatus();
  assert.equal(st.running, false);
  assert.equal(st.mode, null);
  mock.timers.tick(10 * 3_600_000);
  await flush();
  assert.equal(s.checks.length, checks + 1);
  assert.equal(s.headReads, reads);
});

test("(c) stopping in head mode stops the poller, and a stopped service stays stopped on an interval change", async () => {
  const s = fakeChain(700);
  startAnchorService(12_000);
  await flush();
  stopAnchorService();
  const reads = s.headReads;
  const checks = s.checks.length;
  s.head = 710;
  await advance(60_000, 1500);
  assert.equal(s.headReads, reads);
  assert.equal(s.checks.length, checks);

  setAnchorInterval(12);
  assert.equal(getAnchorStatus().running, false);
  assert.equal(getAnchorStatus().intervalSeconds, 12);
  await advance(60_000, 1500);
  assert.equal(s.checks.length, checks);
});

test("(d) safety net: head reads failing, an anchor run still happens every 2 x interval", async () => {
  const s = fakeChain(800);
  s.headFails = true;
  startAnchorService(12_000);
  await flush();
  assert.equal(s.checks.length, 0);
  await advance(22_500, 1500);
  assert.equal(s.checks.length, 0, "nothing before 2 x interval");
  await advance(1500, 1500);
  assert.equal(s.checks.length, 1, "safety net at 24 s");
  await advance(24_000, 1500);
  assert.equal(s.checks.length, 2, "and again 24 s later");
  // Recovery: a readable, newer head anchors at once.
  s.headFails = false;
  s.head = 801;
  await advance(1500, 1500);
  assert.equal(s.checks.length, 3);
});

test("(d) safety net: a head that stops moving (missed slots) still gets a run every 2 x interval", async () => {
  const s = fakeChain(900);
  startAnchorService(12_000);
  await flush();
  assert.equal(s.checks.length, 1);
  await advance(24_000, 1500);
  assert.equal(s.checks.length, 2);
});

test("real anchor path under the head watcher: eth_blockNumber has a timeout, and the anchor is the head's parent by hash", async () => {
  __setAnchorLoopDepsForTest(); // real fetchHeadNumber and checkAndAnchor
  const PARENT = "0x" + "ab".repeat(32);
  const HEAD = "0x" + "cd".repeat(32);
  let headNum = 0x1000;
  const seen: Array<{ url: string; method?: string; hasSignal: boolean }> = [];
  const teeBodies: Array<Record<string, unknown>> = [];

  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    seen.push({ url, method: body.method as string | undefined, hasSignal: !!init?.signal });
    const ok = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
    if (url.endsWith("/commit")) {
      teeBodies.push(body);
      return ok({ commit: { epochId: "test-epoch", counter: String(teeBodies.length) } });
    }
    if (url === "https://ethereum-rpc.publicnode.com") return new Response("down", { status: 503 }); // first RPC down: fallback must work
    switch (body.method) {
      case "eth_blockNumber":
        return ok({ jsonrpc: "2.0", id: 1, result: "0x" + headNum.toString(16) });
      case "eth_getBlockByNumber":
        return ok({ jsonrpc: "2.0", id: 1, result: { hash: HEAD, parentHash: PARENT, number: "0x" + headNum.toString(16), timestamp: "0x6a000000" } });
      case "eth_getBlockByHash":
        return ok({ jsonrpc: "2.0", id: 2, result: { hash: PARENT, parentHash: "0x" + "00".repeat(32), number: "0x" + (headNum - 1).toString(16), timestamp: "0x69fffff4" } });
    }
    return new Response("?", { status: 404 });
  }) as typeof fetch;

  try {
    startAnchorService(12_000);
    await flush();
    await flush();

    const headCalls = seen.filter((c) => c.method === "eth_blockNumber");
    assert.ok(headCalls.length >= 2, "tried publicnode, then fell back");
    assert.ok(headCalls.every((c) => c.hasSignal), "every head poll carries an abort signal");
    assert.equal(teeBodies.length, 1);
    const attribution = teeBodies[0].attribution as { message: string; title: string };
    assert.equal(attribution.message, PARENT, "anchors latest - 1, by hash");
    assert.equal(attribution.title, `https://etherscan.io/block/${headNum - 1}`);
    assert.equal(getAnchorStatus().lastAnchoredBlock, headNum - 1);

    // Same head: no new commit.
    await advance(3000, 1500);
    assert.equal(teeBodies.length, 1);
  } finally {
    stopAnchorService();
    globalThis.fetch = realFetch;
  }
});
