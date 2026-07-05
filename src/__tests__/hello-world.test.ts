// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

import { describe, test } from "node:test";
import * as assert from "node:assert/strict";

describe("hello world", () => {
  test("passes", () => {
    assert.strictEqual("hello world", "hello world");
  });
});
