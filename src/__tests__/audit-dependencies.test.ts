// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * Dependency audit for @mikeargento/bitgraph-audit (Phase 4e).
 *
 * The audit package promises zero runtime network access. This suite pins
 * that promise mechanically:
 *
 *   1. The declared runtime dependency closure is exactly
 *      @mikeargento/bitgraph-verify plus @noble/hashes, with
 *      @noble/ed25519 arriving only transitively through verify. Nothing
 *      else, and no peer or optional dependencies that could widen it.
 *   2. An fs walk of the shipped module graphs (packages/audit/dist and
 *      packages/verify/dist, which is inside the runtime closure) asserts
 *      no compiled file references node:http, node:https, node:net,
 *      node:dgram, node:tls, XMLHttpRequest, WebSocket, a bare
 *      http/https/net/tls/dgram import, or a global fetch call.
 *
 * The @noble packages were audited by hand and recorded in DECISIONS.md:
 * pure crypto, no network APIs. (@noble/hashes sha3-addons defines a hash
 * CLASS METHOD named fetch for XOF output; it is not the global fetch and
 * the audit package does not import sha3-addons.)
 */

import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// Compiled location: <repo>/dist/__tests__/audit-dependencies.test.js
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

async function walkJsFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walkJsFiles(abs)));
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      out.push(abs);
    }
  }
  return out;
}

/**
 * Forbidden references. Substring checks for the node: specifiers and the
 * browser network globals (these strings have no legitimate reason to
 * appear anywhere in the compiled output, comments included), plus
 * pattern checks for bare-specifier network imports and global fetch
 * calls.
 */
const FORBIDDEN_SUBSTRINGS = [
  "node:http",
  "node:https",
  "node:net",
  "node:dgram",
  "node:tls",
  "XMLHttpRequest",
  "WebSocket",
] as const;

const FORBIDDEN_PATTERNS: ReadonlyArray<[name: string, pattern: RegExp]> = [
  ["bare network import", /(?:from\s*|require\s*\(\s*|import\s*\(\s*)["'](?:http|https|net|tls|dgram)["']/],
  ["global fetch call", /\bfetch\s*\(/],
];

async function assertGraphClean(distDir: string): Promise<number> {
  const files = await walkJsFiles(distDir);
  assert.ok(files.length > 0, `compiled module graph exists at ${distDir} (run the build first)`);
  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const needle of FORBIDDEN_SUBSTRINGS) {
      assert.ok(!source.includes(needle), `${file} must not reference ${needle}`);
    }
    for (const [name, pattern] of FORBIDDEN_PATTERNS) {
      assert.ok(!pattern.test(source), `${file} must not contain a ${name}`);
    }
  }
  return files.length;
}

describe("audit package dependency audit: zero network surface", () => {
  it("declares exactly the allowed runtime dependency closure", async () => {
    const auditPkg = JSON.parse(
      await readFile(join(repoRoot, "packages", "audit", "package.json"), "utf8")
    ) as Record<string, Record<string, string> | undefined>;
    const verifyPkg = JSON.parse(
      await readFile(join(repoRoot, "packages", "verify", "package.json"), "utf8")
    ) as Record<string, Record<string, string> | undefined>;

    assert.deepEqual(
      Object.keys(auditPkg["dependencies"] ?? {}).sort(),
      ["@mikeargento/bitgraph-verify", "@noble/hashes"],
      "audit runtime dependencies are exactly verify + @noble/hashes"
    );
    assert.deepEqual(
      Object.keys(verifyPkg["dependencies"] ?? {}).sort(),
      ["@noble/ed25519", "@noble/hashes"],
      "verify (the only workspace dependency) brings exactly the @noble crypto pair"
    );
    // No side doors that could widen the closure at install time.
    for (const [pkgName, pkg] of [
      ["audit", auditPkg],
      ["verify", verifyPkg],
    ] as const) {
      assert.equal(pkg["peerDependencies"], undefined, `${pkgName} has no peerDependencies`);
      assert.equal(pkg["optionalDependencies"], undefined, `${pkgName} has no optionalDependencies`);
      assert.equal(pkg["bundledDependencies"], undefined, `${pkgName} has no bundledDependencies`);
    }
  });

  it("packages/audit/dist references no network API", async () => {
    const count = await assertGraphClean(join(repoRoot, "packages", "audit", "dist"));
    assert.ok(count >= 15, `walked the full audit module graph (${count} files)`);
  });

  it("packages/verify/dist (runtime closure member) references no network API", async () => {
    const count = await assertGraphClean(join(repoRoot, "packages", "verify", "dist"));
    assert.ok(count >= 4, `walked the full verify module graph (${count} files)`);
  });
});
