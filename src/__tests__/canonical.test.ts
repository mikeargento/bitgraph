// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

import { describe, test } from "node:test";
import * as assert from "node:assert/strict";
import {
  canonicalize,
  canonicalizeToString,
  constantTimeEqual,
} from "../canonical.js";

// ---------------------------------------------------------------------------
// canonicalizeToString
// ---------------------------------------------------------------------------

describe("canonicalizeToString", () => {
  // Primitives
  test("null", () => assert.equal(canonicalizeToString(null), "null"));
  test("true", () => assert.equal(canonicalizeToString(true), "true"));
  test("false", () => assert.equal(canonicalizeToString(false), "false"));
  test("integer", () => assert.equal(canonicalizeToString(42), "42"));
  test("float", () => assert.equal(canonicalizeToString(3.14), "3.14"));
  test("negative", () => assert.equal(canonicalizeToString(-1), "-1"));
  test("zero", () => assert.equal(canonicalizeToString(0), "0"));
  test("string", () => assert.equal(canonicalizeToString("hello"), '"hello"'));
  test("empty string", () => assert.equal(canonicalizeToString(""), '""'));

  // Object key ordering
  test("sorts keys lexicographically", () => {
    assert.equal(
      canonicalizeToString({ z: 1, a: 2, m: 3 }),
      '{"a":2,"m":3,"z":1}',
    );
  });

  test("uppercase sorts before lowercase (Unicode code-point order)", () => {
    assert.equal(canonicalizeToString({ b: 2, A: 1 }), '{"A":1,"b":2}');
  });

  test("sorts nested object keys recursively", () => {
    assert.equal(
      canonicalizeToString({ outer: { z: 1, a: 2 }, b: 3 }),
      '{"b":3,"outer":{"a":2,"z":1}}',
    );
  });

  test("empty object", () => assert.equal(canonicalizeToString({}), "{}"));

  test("same output regardless of insertion order", () => {
    const a = { z: 1, a: 2 };
    const b = { a: 2, z: 1 };
    assert.equal(canonicalizeToString(a), canonicalizeToString(b));
  });

  // Arrays
  test("preserves array element order", () => {
    assert.equal(canonicalizeToString([3, 1, 2]), "[3,1,2]");
  });

  test("sorts keys inside array elements", () => {
    assert.equal(canonicalizeToString([{ b: 2, a: 1 }]), '[{"a":1,"b":2}]');
  });

  test("empty array", () => assert.equal(canonicalizeToString([]), "[]"));

  test("nested arrays preserve order", () => {
    assert.equal(
      canonicalizeToString([[1, 2], [3, 4]]),
      "[[1,2],[3,4]]",
    );
  });

  // Undefined handling
  test("skips undefined values in objects", () => {
    const obj: Record<string, unknown> = { a: 1, c: 3 };
    obj["b"] = undefined;
    assert.equal(canonicalizeToString(obj), '{"a":1,"c":3}');
  });

  // Rejection of non-serializable types
  test("throws TypeError for undefined", () => {
    assert.throws(
      () => canonicalizeToString(undefined as unknown),
      TypeError,
    );
  });

  test("throws TypeError for function", () => {
    assert.throws(
      () => canonicalizeToString((() => {}) as unknown),
      TypeError,
    );
  });

  test("throws TypeError for symbol", () => {
    assert.throws(
      () => canonicalizeToString(Symbol("x") as unknown),
      TypeError,
    );
  });

  test("throws TypeError for BigInt", () => {
    assert.throws(
      () => canonicalizeToString(BigInt(42) as unknown),
      TypeError,
    );
  });

  test("throws TypeError for BigInt inside object", () => {
    assert.throws(
      () => canonicalizeToString({ n: BigInt(1) } as unknown),
      TypeError,
    );
  });

  // NaN / Infinity → null (standard JSON.stringify behavior)
  test("NaN serializes as null", () => {
    assert.equal(canonicalizeToString(NaN), "null");
  });

  test("Infinity serializes as null", () => {
    assert.equal(canonicalizeToString(Infinity), "null");
  });

  test("-Infinity serializes as null", () => {
    assert.equal(canonicalizeToString(-Infinity), "null");
  });

  // Determinism
  test("is deterministic across repeated calls", () => {
    const obj = { c: 3, b: 2, a: 1 };
    assert.equal(canonicalizeToString(obj), canonicalizeToString(obj));
  });
});

// ---------------------------------------------------------------------------
// canonicalize
// ---------------------------------------------------------------------------

describe("canonicalize", () => {
  test("returns a Uint8Array", () => {
    assert.ok(canonicalize({}) instanceof Uint8Array);
  });

  test("UTF-8 encodes the canonical JSON string", () => {
    const bytes = canonicalize({ hello: "world" });
    assert.equal(new TextDecoder().decode(bytes), '{"hello":"world"}');
  });

  test("matches TextEncoder(canonicalizeToString(obj))", () => {
    const obj = { z: 1, a: 2 };
    const bytes = canonicalize(obj);
    const str = canonicalizeToString(obj);
    assert.deepEqual(bytes, new TextEncoder().encode(str));
  });

  test("empty object → two bytes ('{' and '}')", () => {
    assert.deepEqual(canonicalize({}), new TextEncoder().encode("{}"));
  });

  test("large payload round-trips through canonicalizeToString", () => {
    const large: Record<string, number> = {};
    for (let i = 0; i < 1000; i++) large[`key_${i}`] = i;
    const bytes = canonicalize(large);
    const str = canonicalizeToString(large);
    assert.deepEqual(bytes, new TextEncoder().encode(str));
  });

  test("throws TypeError for BigInt nested inside object", () => {
    assert.throws(() => canonicalize({ n: BigInt(1) } as unknown), TypeError);
  });
});

// ---------------------------------------------------------------------------
// constantTimeEqual
// ---------------------------------------------------------------------------

describe("constantTimeEqual", () => {
  test("equal non-empty arrays", () => {
    assert.equal(
      constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3])),
      true,
    );
  });

  test("different content same length", () => {
    assert.equal(
      constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4])),
      false,
    );
  });

  test("different lengths", () => {
    assert.equal(
      constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2])),
      false,
    );
  });

  test("empty arrays are equal", () => {
    assert.equal(
      constantTimeEqual(new Uint8Array([]), new Uint8Array([])),
      true,
    );
  });

  test("empty vs non-empty", () => {
    assert.equal(
      constantTimeEqual(new Uint8Array([]), new Uint8Array([0])),
      false,
    );
  });

  test("single byte equal", () => {
    assert.equal(
      constantTimeEqual(new Uint8Array([0xff]), new Uint8Array([0xff])),
      true,
    );
  });

  test("single byte different", () => {
    assert.equal(
      constantTimeEqual(new Uint8Array([0xff]), new Uint8Array([0xfe])),
      false,
    );
  });

  test("large equal arrays", () => {
    const a = new Uint8Array(1024).fill(0xab);
    const b = new Uint8Array(1024).fill(0xab);
    assert.equal(constantTimeEqual(a, b), true);
  });

  test("large arrays differing in last byte", () => {
    const a = new Uint8Array(1024).fill(0xab);
    const b = new Uint8Array(1024).fill(0xab);
    b[1023] = 0xac;
    assert.equal(constantTimeEqual(a, b), false);
  });

  test("large arrays differing in first byte", () => {
    const a = new Uint8Array(1024).fill(0xab);
    const b = new Uint8Array(1024).fill(0xab);
    b[0] = 0xac;
    assert.equal(constantTimeEqual(a, b), false);
  });

  test("all-zeros equal", () => {
    assert.equal(
      constantTimeEqual(new Uint8Array(32), new Uint8Array(32)),
      true,
    );
  });
});
