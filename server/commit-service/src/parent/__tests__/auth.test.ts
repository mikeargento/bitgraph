// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * The gate and the exemption must stay separate.
 *
 * The case these tests exist for is "API_KEYS set, REQUIRE_API_KEY unset".
 * Before the split that configuration 401'd every caller without a key, which
 * meant the drop zone, every installed Folder, MCP, and the anchor service all
 * stopped working the instant the first key was issued. Losing the anchor
 * service is the one that cascades: no anchors, so the next epoch never gets
 * its first one, so the anchor-first gate holds every commit at 503.
 */

import { test } from "node:test";
// Named import rather than default: this package builds without
// esModuleInterop, so `import assert from "node:assert/strict"` will not compile.
import { strict as assert } from "node:assert";
import { AuthMisconfigured, createAuthPolicy, describeAuthPolicy } from "../auth.js";

const KEY = "k-live-abc123";
const BEARER = `Bearer ${KEY}`;

test("today's configuration: nothing set, everyone may commit, nobody is exempt", () => {
  const p = createAuthPolicy({});
  assert.equal(p.allows(undefined), true);
  assert.equal(p.allows(BEARER), true);
  assert.equal(p.isExempt(undefined), false);
  assert.equal(p.isExempt(BEARER), false, "a key nobody configured buys nothing");
  assert.equal(p.required, false);
  assert.equal(p.keyCount, 0);
});

test("keys configured but not required: anonymous callers still commit", () => {
  // The whole point of the split. Issuing a key must not lock anyone out.
  const p = createAuthPolicy({ API_KEYS: KEY });

  assert.equal(p.allows(undefined), true, "the drop zone, the Folder, MCP and the anchor service send no key");
  assert.equal(p.allows("Bearer wrong-key"), true, "even a wrong key cannot lock a caller out while the gate is off");
  assert.equal(p.allows(BEARER), true);

  assert.equal(p.isExempt(undefined), false);
  assert.equal(p.isExempt(BEARER), true, "the key's only effect is the rate-limit exemption");
  assert.equal(p.isExempt("Bearer wrong-key"), false);
});

test("multiple keys, comma separated, whitespace tolerated", () => {
  const p = createAuthPolicy({ API_KEYS: ` ${KEY} , k-anchor-xyz ,, ` });
  assert.equal(p.keyCount, 2);
  assert.equal(p.isExempt(BEARER), true);
  assert.equal(p.isExempt("Bearer k-anchor-xyz"), true);
  assert.equal(p.isExempt("Bearer k-nope"), false);
});

test("required and configured: the gate closes, and only on the gate", () => {
  const p = createAuthPolicy({ API_KEYS: KEY, REQUIRE_API_KEY: "true" });
  assert.equal(p.allows(undefined), false);
  assert.equal(p.allows("Bearer wrong-key"), false);
  assert.equal(p.allows(BEARER), true);
  assert.equal(p.isExempt(BEARER), true);
  assert.equal(p.required, true);
});

test("required with no keys refuses to boot rather than rejecting everyone", () => {
  // This config accepts nobody. From outside it is indistinguishable from an
  // outage, so it has to fail loudly at startup.
  assert.throws(
    () => createAuthPolicy({ REQUIRE_API_KEY: "true" }),
    (err: Error) => {
      assert.ok(err instanceof AuthMisconfigured);
      assert.match(err.message, /rejects every caller/);
      assert.match(err.message, /anchor service/);
      return true;
    }
  );
  assert.throws(() => createAuthPolicy({ REQUIRE_API_KEY: "true", API_KEYS: "   ,  , " }), AuthMisconfigured);
});

test("only the exact string 'true' arms the gate", () => {
  // A half-set env var must fail open, not closed. "1", "yes" and "TRUE" are
  // the shapes someone reaches for in a hurry, and any of them silently
  // closing the boundary would be the same outage in a different costume.
  for (const v of ["1", "yes", "TRUE", "True", "", "false", " true"]) {
    const p = createAuthPolicy({ API_KEYS: KEY, REQUIRE_API_KEY: v });
    assert.equal(p.required, false, `REQUIRE_API_KEY=${JSON.stringify(v)} must not arm the gate`);
    assert.equal(p.allows(undefined), true);
  }
});

test("malformed authorization headers are refused cleanly, never crash", () => {
  const p = createAuthPolicy({ API_KEYS: KEY, REQUIRE_API_KEY: "true" });
  for (const h of [undefined, "", "Bearer", "Bearer ", "Basic " + KEY, KEY, "bearer " + KEY]) {
    assert.equal(p.allows(h), false, `header ${JSON.stringify(h)} must not pass the gate`);
    assert.equal(p.isExempt(h), false);
  }
});

test("the summary line reports the policy actually in force", () => {
  assert.match(describeAuthPolicy(createAuthPolicy({})), /open to unauthenticated callers/);
  assert.match(describeAuthPolicy(createAuthPolicy({})), /nobody is rate-limit exempt/);

  const keyed = describeAuthPolicy(createAuthPolicy({ API_KEYS: KEY }));
  assert.match(keyed, /open to unauthenticated callers/);
  assert.match(keyed, /1 API key\(s\) configured/);

  const gated = describeAuthPolicy(createAuthPolicy({ API_KEYS: KEY, REQUIRE_API_KEY: "true" }));
  assert.match(gated, /refuses callers without a valid key/);
});
