/**
 * The server's half of bitgraph-recovery/1: create-only store semantics, the
 * POST and GET handlers' validation, the 409 retry, the rate limiter, the
 * writes switch, and the S3 store's mapping of S3's answers (against a fake
 * S3 client: nothing here reaches AWS).
 *
 * Run: node --test src/lib/__tests__/recovery-store.test.ts
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { bytesToBase64 } from "@mikeargento/bitgraph-verify";
import { MAX_BATCH_ENTRIES, MAX_BODY_BYTES, MAX_ENVELOPE_BYTES, MIN_ENVELOPE_BYTES } from "../recovery.ts";
import {
  MemoryRecoveryStore,
  RateLimiter,
  handleRecoveryList,
  handleRecoveryPost,
  recoveryWritesOn,
  type PostOptions,
} from "../recovery-store.ts";
import { S3RecoveryStore } from "../recovery-store-s3.ts";

const A = "a1".repeat(32);
const keyOf = (address: string, n: number) => `recovery/v1/${address}/${n.toString(16).padStart(64, "0")}`;
const envelope = (fill: number, length = 100) => {
  const e = new Uint8Array(length).fill(fill);
  e[0] = 1;
  return e;
};
const b64 = (u: Uint8Array) => bytesToBase64(u);
const quiet: PostOptions = { sleep: async () => {}, log: () => {} };
const post = (body: unknown, store = new MemoryRecoveryStore(), opts: PostOptions = quiet) =>
  handleRecoveryPost(typeof body === "string" ? body : JSON.stringify(body), store, opts);
const q = (params: Record<string, string> = {}) => new URLSearchParams(params);

describe("create-only", () => {
  test("created, then exists with the FIRST envelope, unchanged", async () => {
    const store = new MemoryRecoveryStore();
    const key = keyOf(A, 1);
    const first = await post({ entries: [{ key, envelope: b64(envelope(0x11)) }] }, store);
    assert.equal(first.status, 200);
    assert.deepEqual(first.body.results, [{ key, status: "created" }]);
    const second = await post({ entries: [{ key, envelope: b64(envelope(0x22)) }] }, store);
    assert.deepEqual(second.body.results, [{ key, status: "exists", envelope: b64(envelope(0x11)) }]);
    assert.deepEqual(store.objects.get(key), envelope(0x11), "the stored entry was not replaced");
  });

  test("a 409 is retried with a doubling wait and then answered conflict; a transient one resolves", async () => {
    const store = new MemoryRecoveryStore();
    const waits: number[] = [];
    const opts: PostOptions = { sleep: async (ms) => { waits.push(ms); }, log: () => {} };
    store.conflicts.set(keyOf(A, 1), 2);
    store.conflicts.set(keyOf(A, 2), 10);
    const r = await post({ entries: [{ key: keyOf(A, 1), envelope: b64(envelope(1)) }, { key: keyOf(A, 2), envelope: b64(envelope(2)) }] }, store, { ...opts, concurrency: 1 });
    assert.deepEqual(r.body.results, [{ key: keyOf(A, 1), status: "created" }, { key: keyOf(A, 2), status: "conflict" }]);
    assert.deepEqual(waits, [50, 100, 50, 100, 200], "two retries for the first, three for the second");
    assert.equal(store.objects.has(keyOf(A, 2)), false);
  });

  test("a store failure answers error for that entry, never created", async () => {
    const store = new MemoryRecoveryStore();
    store.failing = true;
    const r = await post({ entries: [{ key: keyOf(A, 1), envelope: b64(envelope(1)) }] }, store);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.results, [{ key: keyOf(A, 1), status: "error" }]);
  });

  test("results come back in request order, one per entry", async () => {
    const store = new MemoryRecoveryStore();
    await post({ entries: [{ key: keyOf(A, 3), envelope: b64(envelope(3)) }] }, store);
    const entries = [5, 3, 4].map((n) => ({ key: keyOf(A, n), envelope: b64(envelope(n)) }));
    const r = await post({ entries }, store);
    assert.deepEqual((r.body.results as Array<{ key: string; status: string }>).map((x) => [x.key, x.status]), [[keyOf(A, 5), "created"], [keyOf(A, 3), "exists"], [keyOf(A, 4), "created"]]);
  });
});

describe("POST validation", () => {
  const ok = { key: keyOf(A, 1), envelope: b64(envelope(1)) };

  test("the body: size, JSON, shape, count", async () => {
    assert.equal((await post("x".repeat(MAX_BODY_BYTES + 1))).status, 413);
    for (const [why, body] of [
      ["not JSON", "{entries"],
      ["an array", [ok]],
      ["null", "null"],
      ["no entries", {}],
      ["an extra field", { entries: [ok], more: 1 }],
      ["entries not an array", { entries: ok }],
      ["entries empty", { entries: [] }],
    ] as const) {
      const r = await post(body);
      assert.equal(r.status, 400, why);
      assert.equal(r.body.code, "bad-request", why);
    }
    const many = Array.from({ length: MAX_BATCH_ENTRIES + 1 }, (_, i) => ({ key: keyOf(A, i), envelope: b64(envelope(1)) }));
    assert.equal((await post({ entries: many })).status, 400, "too many");
    const store = new MemoryRecoveryStore();
    assert.equal((await post({ entries: many.slice(0, MAX_BATCH_ENTRIES) }, store)).status, 200, "exactly the cap");
    assert.equal(store.objects.size, MAX_BATCH_ENTRIES);
  });

  test("keys: only recovery/v1/<64 hex>/<64 hex>, lowercase", async () => {
    const e = b64(envelope(1));
    for (const key of [
      keyOf(A, 1).toUpperCase(),
      `recovery/v2/${A}/${"0".repeat(64)}`,
      `recovery/v1/${A}`,
      `recovery/v1/${A}/`,
      `recovery/v1/${A}/${"0".repeat(63)}`,
      `recovery/v1/${A}/${"0".repeat(64)}/x`,
      `/recovery/v1/${A}/${"0".repeat(64)}`,
      `recovery/v1/../${"0".repeat(64)}`,
      `recovery/v1/${"g".repeat(64)}/${"0".repeat(64)}`,
      `proofs/${A}`,
      "",
    ]) {
      const store = new MemoryRecoveryStore();
      const r = await post({ entries: [{ key, envelope: e }] }, store);
      assert.equal(r.status, 400, key);
      assert.equal(store.puts, 0, key);
    }
    assert.equal((await post({ entries: [{ key: 7, envelope: e }] })).status, 400);
  });

  test("envelopes: canonical base64, version 1, inside the size limits", async () => {
    const cases: Array<[string, unknown, number]> = [
      ["the smallest", b64(envelope(1, MIN_ENVELOPE_BYTES)), 200],
      ["the largest", b64(envelope(1, MAX_ENVELOPE_BYTES)), 200],
      ["one byte short", b64(envelope(1, MIN_ENVELOPE_BYTES - 1)), 400],
      ["one byte over", b64(envelope(1, MAX_ENVELOPE_BYTES + 1)), 400],
      ["far over", "A".repeat(100_000), 400],
      ["version 2", b64(Object.assign(envelope(1), { 0: 2 })), 400],
      ["version 0", b64(Object.assign(envelope(1), { 0: 0 })), 400],
      ["url-safe alphabet", b64(envelope(0xfb)).replace(/\+/g, "-").replace(/\//g, "_"), 400],
      ["no padding", b64(envelope(1, 32)).replace(/=+$/, ""), 400],
      ["non-canonical padding bits", b64(envelope(1, 31)).replace(/.=$/, "B="), 400],
      ["whitespace", ` ${b64(envelope(1))}`, 400],
      ["not a string", 12, 400],
    ];
    for (const [why, env, status] of cases) {
      const r = await post({ entries: [{ key: keyOf(A, 1), envelope: env }] });
      assert.equal(r.status, status, why);
    }
  });

  test("entries: exactly { key, envelope }, no key twice; one bad entry writes nothing", async () => {
    const store = new MemoryRecoveryStore();
    for (const entry of [null, "x", [ok], { key: ok.key }, { ...ok, extra: 1 }]) {
      assert.equal((await post({ entries: [ok, entry] }, store)).status, 400);
    }
    const dup = await post({ entries: [ok, { ...ok, envelope: b64(envelope(9)) }] }, store);
    assert.equal(dup.status, 400);
    assert.equal(dup.body.index, 1);
    assert.equal(store.puts, 0, "nothing was written by any refused batch");
  });
});

describe("GET listing", () => {
  test("ascending pages with a cursor; other addresses never leak in", async () => {
    const store = new MemoryRecoveryStore();
    const B = "b2".repeat(32);
    await post({ entries: [5, 1, 4, 2, 3].map((n) => ({ key: keyOf(A, n), envelope: b64(envelope(n)) })).concat([{ key: keyOf(B, 1), envelope: b64(envelope(9)) }]) }, store);
    const p1 = await handleRecoveryList(A, q({ limit: "2" }), store);
    assert.equal(p1.status, 200);
    assert.deepEqual((p1.body.entries as Array<{ key: string }>).map((e) => e.key), [keyOf(A, 1), keyOf(A, 2)]);
    assert.equal(p1.body.next, keyOf(A, 2).slice(-64));
    const p2 = await handleRecoveryList(A, q({ limit: "2", after: p1.body.next as string }), store);
    assert.deepEqual((p2.body.entries as Array<{ key: string }>).map((e) => e.key), [keyOf(A, 3), keyOf(A, 4)]);
    const p3 = await handleRecoveryList(A, q({ limit: "2", after: p2.body.next as string }), store);
    assert.deepEqual((p3.body.entries as Array<{ key: string; envelope: string }>), [{ key: keyOf(A, 5), envelope: b64(envelope(5)) }]);
    assert.equal(p3.body.next, null);
    const all = await handleRecoveryList(A, q(), store);
    assert.equal((all.body.entries as unknown[]).length, 5, "default limit covers them");
    const none = await handleRecoveryList("c3".repeat(32), q(), store);
    assert.deepEqual(none.body, { address: "c3".repeat(32), entries: [], next: null });
  });

  test("bad requests are 400; a store that cannot be read is 503, never an empty page", async () => {
    const store = new MemoryRecoveryStore();
    for (const address of [A.toUpperCase(), A.slice(2), `${A}0`, "../x", ""]) assert.equal((await handleRecoveryList(address, q(), store)).status, 400, address);
    for (const params of [{ after: "xyz" }, { after: A.toUpperCase() }, { limit: "0" }, { limit: "101" }, { limit: "abc" }, { limit: "1.5" }, { limit: "-1" }]) {
      assert.equal((await handleRecoveryList(A, q(params), store)).status, 400, JSON.stringify(params));
    }
    store.failing = true;
    const r = await handleRecoveryList(A, q(), store);
    assert.equal(r.status, 503);
    assert.equal(r.body.code, "recovery-unavailable");
    assert.equal("entries" in r.body, false);
  });
});

describe("switches and limits", () => {
  test("writes are off unless RECOVERY_WRITES=on", () => {
    const before = process.env.RECOVERY_WRITES;
    try {
      delete process.env.RECOVERY_WRITES;
      assert.equal(recoveryWritesOn(), false);
      for (const v of ["true", "1", "ON", "yes"]) {
        process.env.RECOVERY_WRITES = v;
        assert.equal(recoveryWritesOn(), false, v);
      }
      process.env.RECOVERY_WRITES = "on";
      assert.equal(recoveryWritesOn(), true);
    } finally {
      if (before === undefined) delete process.env.RECOVERY_WRITES;
      else process.env.RECOVERY_WRITES = before;
    }
  });

  test("the per-instance limiter counts per caller per window", () => {
    let t = 0;
    const l = new RateLimiter(3, 1000, () => t);
    assert.deepEqual([1, 2, 3, 4].map(() => l.limited("a")), [false, false, false, true]);
    assert.equal(l.limited("b"), false, "another caller");
    t = 1000;
    assert.equal(l.limited("a"), false, "a new window");
  });
});

describe("the S3 store, against a fake S3 client", () => {
  /** Enough of S3 for the store: conditional puts, gets, a sorted listing with StartAfter and MaxKeys. */
  function fakeS3(opts: { conflictTimes?: number; vanishAfter412?: boolean; failGet?: boolean; missing?: Set<string> } = {}) {
    const objects = new Map<string, Uint8Array>();
    const calls: string[] = [];
    let conflicts = opts.conflictTimes ?? 0;
    const err = (name: string, status: number) => Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status } });
    const client = {
      async send(cmd: unknown) {
        if (cmd instanceof PutObjectCommand) {
          const { Key, Body, IfNoneMatch } = cmd.input;
          calls.push(`put ${IfNoneMatch}`);
          if (conflicts > 0) {
            conflicts--;
            throw err("ConditionalRequestConflict", 409);
          }
          if (objects.has(Key!)) {
            if (opts.vanishAfter412) objects.delete(Key!);
            throw err("PreconditionFailed", 412);
          }
          objects.set(Key!, new Uint8Array(Body as Uint8Array));
          return {};
        }
        if (cmd instanceof GetObjectCommand) {
          calls.push("get");
          const key = cmd.input.Key!;
          if (opts.failGet) throw err("InternalError", 500);
          const v = objects.get(key);
          if (v === undefined || opts.missing?.has(key)) throw err("NoSuchKey", 404);
          return { Body: { transformToByteArray: async () => v.slice() } };
        }
        if (cmd instanceof ListObjectsV2Command) {
          calls.push("list");
          const { Prefix, StartAfter, MaxKeys } = cmd.input;
          const keys = [...objects.keys()].filter((k) => k.startsWith(Prefix!) && (StartAfter === undefined || k > StartAfter)).sort();
          const page = keys.slice(0, MaxKeys);
          return { Contents: page.map((Key) => ({ Key })), IsTruncated: keys.length > page.length };
        }
        throw new Error("unexpected command");
      },
    };
    return { client: client as unknown as S3Client, objects, calls };
  }

  test("a put is conditional (If-None-Match: *); 412 answers exists with the stored bytes", async () => {
    const s3 = fakeS3();
    const store = new S3RecoveryStore(s3.client, "bucket");
    assert.deepEqual(await store.putIfAbsent(keyOf(A, 1), envelope(1)), { status: "created" });
    assert.deepEqual(await store.putIfAbsent(keyOf(A, 1), envelope(2)), { status: "exists", envelope: envelope(1) });
    assert.deepEqual(s3.calls, ["put *", "put *", "get"]);
    await assert.rejects(store.putIfAbsent("proofs/x", envelope(1)), TypeError, "never writes outside recovery/");
  });

  test("409 answers conflict, and the handler retries it into created", async () => {
    const s3 = fakeS3({ conflictTimes: 2 });
    const store = new S3RecoveryStore(s3.client, "bucket");
    assert.deepEqual(await store.putIfAbsent(keyOf(A, 1), envelope(1)), { status: "conflict" });
    const r = await post({ entries: [{ key: keyOf(A, 1), envelope: b64(envelope(1)) }] }, store as never);
    assert.deepEqual(r.body.results, [{ key: keyOf(A, 1), status: "created" }]);
  });

  test("a 412 whose object then cannot be found is a conflict, never created; other failures throw", async () => {
    const vanish = fakeS3({ vanishAfter412: true });
    const store = new S3RecoveryStore(vanish.client, "bucket");
    await store.putIfAbsent(keyOf(A, 1), envelope(1));
    assert.deepEqual(await store.putIfAbsent(keyOf(A, 1), envelope(2)), { status: "conflict" });
    const failing = fakeS3({ failGet: true });
    const s2 = new S3RecoveryStore(failing.client, "bucket");
    await s2.putIfAbsent(keyOf(A, 1), envelope(1));
    await assert.rejects(s2.putIfAbsent(keyOf(A, 1), envelope(2)));
    await assert.rejects(s2.list(A, null, 10));
  });

  test("listing pages by StartAfter; next only when truncated; a listed key that is gone is skipped", async () => {
    const s3 = fakeS3({ missing: new Set([keyOf(A, 2)]) });
    const store = new S3RecoveryStore(s3.client, "bucket");
    for (const n of [1, 2, 3]) await store.putIfAbsent(keyOf(A, n), envelope(n));
    await store.putIfAbsent(keyOf("b2".repeat(32), 1), envelope(9));
    const p1 = await store.list(A, null, 2);
    assert.deepEqual(p1.entries.map((e) => e.key), [keyOf(A, 1)], "2 listed, the missing one skipped");
    assert.equal(p1.next, keyOf(A, 2).slice(-64));
    const p2 = await store.list(A, p1.next, 2);
    assert.deepEqual(p2.entries.map((e) => e.key), [keyOf(A, 3)]);
    assert.equal(p2.next, null);
  });
});
