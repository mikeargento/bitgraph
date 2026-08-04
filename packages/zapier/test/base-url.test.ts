// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * The API Endpoint field is the one input that decides where a customer's
 * digests are sent, so it gets validated rather than trusted. These cover the
 * mistakes that actually reach it: a bare hostname pasted without a scheme,
 * http instead of https, and a URL carrying the path someone copied it with.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { baseUrl, DEFAULT_BASE_URL } from "../src/lib/client";
import { bundleOf } from "./helpers";

const withEndpoint = (baseUrlValue: string) => bundleOf({}, { baseUrl: baseUrlValue });

test("an unset endpoint falls back to the hosted default", () => {
  assert.equal(baseUrl(bundleOf({}, {})), DEFAULT_BASE_URL);
  assert.equal(baseUrl(withEndpoint("")), DEFAULT_BASE_URL);
  assert.equal(baseUrl(withEndpoint("   ")), DEFAULT_BASE_URL);
});

test("a valid origin is accepted and normalized", () => {
  assert.equal(baseUrl(withEndpoint("https://bitgraph.ing")), "https://bitgraph.ing");
  assert.equal(
    baseUrl(withEndpoint("https://bitgraph.ing/")),
    "https://bitgraph.ing",
    "a trailing slash is stripped, since every endpoint is built by appending to this"
  );
  assert.equal(
    baseUrl(withEndpoint("https://BitGraph.ing")),
    "https://bitgraph.ing",
    "host case is normalized"
  );
  assert.equal(
    baseUrl(withEndpoint("https://boundary.example.com")),
    "https://boundary.example.com",
    "self-hosting a different boundary is the reason this field exists"
  );
});

test("a hostname with no scheme is refused, not silently guessed", () => {
  assert.throws(() => baseUrl(withEndpoint("bitgraph.ing")), /not a valid URL/);
});

test("http is refused, so digests never cross the wire in the clear", () => {
  assert.throws(() => baseUrl(withEndpoint("http://bitgraph.ing")), /must use https/);
  assert.throws(() => baseUrl(withEndpoint("ftp://bitgraph.ing")), /must use https/);
});

test("a path, query or fragment is refused and the error suggests the origin", () => {
  // Appending to an endpoint that already carries a path yields 404s that read
  // as an outage rather than as a misconfiguration, so this fails early.
  assert.throws(() => baseUrl(withEndpoint("https://bitgraph.ing/api")), /no path, query or fragment/);
  assert.throws(() => baseUrl(withEndpoint("https://bitgraph.ing?x=1")), /no path, query or fragment/);
  assert.throws(() => baseUrl(withEndpoint("https://bitgraph.ing#frag")), /no path, query or fragment/);

  assert.throws(
    () => baseUrl(withEndpoint("https://bitgraph.ing/api/commit")),
    /Try "https:\/\/bitgraph\.ing"/,
    "the message names the value that would have worked"
  );
});
