// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * Tests for the init scaffolder and the play() one-call pipeline.
 *
 * Same discipline as the rest of the suite: synthetic AuditResult
 * fixtures, no ledger writes, no network. The CLI wiring tests spawn the
 * built cli.js against temp files created under os.tmpdir().
 */

import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { ORDERING_PLACEHOLDER, roleNameForFile, scaffoldRule } from "../init.js";
import { play, playAudit, PlayError } from "../play.js";
import { parseRule, RuleError } from "../rule.js";
import { serializeVerdict } from "../verdict.js";
import { digestFor, makeAudit } from "./fixtures.js";

const CLI_PATH = fileURLToPath(new URL("../cli.js", import.meta.url));

function hexOf(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

// ---------------------------------------------------------------------------
// roleNameForFile
// ---------------------------------------------------------------------------

test("role names: extension dropped, path stripped, disallowed chars folded", () => {
  assert.equal(roleNameForFile("purchase_order.pdf"), "purchase_order");
  assert.equal(roleNameForFile("/some/dir/delivery note.jpg"), "delivery-note");
  assert.equal(roleNameForFile("My Photo (1).jpg"), "My-Photo-1");
  assert.equal(roleNameForFile("archive.tar.gz"), "archive.tar");
});

test("role names: backslash is an ordinary character, never a separator", () => {
  // On POSIX `a\b.jpg` is one legal filename. The CLI hands scaffoldRule a
  // platform-correct basename; this function must not re-split it.
  assert.equal(roleNameForFile(String.raw`a\b.jpg`), "a-b");
  assert.equal(roleNameForFile(String.raw`C:\photos\approval.png`), "C-photos-approval");
});

test("role names: grammar guards — never empty, never pure-integer, dotfiles keep their stem", () => {
  assert.equal(roleNameForFile("2024.jpg"), "file-2024");
  assert.equal(roleNameForFile("™️.jpg"), "file");
  assert.equal(roleNameForFile(".gitignore"), "gitignore");
  assert.equal(roleNameForFile("..."), "file");
});

// ---------------------------------------------------------------------------
// scaffoldRule
// ---------------------------------------------------------------------------

const ENTRIES = [
  { name: "po.pdf", sha256Hex: hexOf("po") },
  { name: "delivery.jpg", sha256Hex: hexOf("delivery") },
];

test("scaffold does not parse as written, and the only issue is the ordering placeholder", () => {
  const text = scaffoldRule(ENTRIES);
  assert.ok(text.includes(ORDERING_PLACEHOLDER));
  assert.throws(
    () => parseRule(text),
    (err: unknown) => {
      assert.ok(err instanceof RuleError);
      const ruleErr = err as RuleError;
      assert.equal(ruleErr.issues.length, 1);
      assert.match(ruleErr.issues[0] as string, /requires\.ordering/);
      return true;
    }
  );
});

test("scaffold parses once the floor is chosen; cast in input order; digests normalize", () => {
  const text = scaffoldRule(ENTRIES).replace(ORDERING_PLACEHOLDER, "hash-linked");
  const rule = parseRule(text);
  assert.deepEqual(Object.keys(rule.cast), ["po", "delivery"]);
  assert.equal(rule.cast["po"]?.digest, `sha256:${hexOf("po")}`);
  assert.equal(rule.cast["po"]?.means, "po.pdf");
  assert.equal(rule.requires.ordering, "hash-linked");
  assert.deepEqual(rule.claim, {
    all: [{ exists: "po" }, { exists: "delivery" }],
  });
});

test("scaffold is deterministic; id depends on digests, not entry order", () => {
  assert.equal(scaffoldRule(ENTRIES), scaffoldRule(ENTRIES));
  const reversed = scaffoldRule([...ENTRIES].reverse());
  const idOf = (text: string): string =>
    (JSON.parse(text) as { id: string }).id;
  assert.equal(idOf(scaffoldRule(ENTRIES)), idOf(reversed));
  assert.match(idOf(scaffoldRule(ENTRIES)), /^rule-[0-9a-f]{12}$/);
});

test("scaffold: colliding role names get ordinal suffixes in input order", () => {
  const text = scaffoldRule([
    { name: "a/photo.jpg", sha256Hex: hexOf("one") },
    { name: "b/photo.png", sha256Hex: hexOf("two") },
    { name: "c/photo.webp", sha256Hex: hexOf("three") },
  ]).replace(ORDERING_PLACEHOLDER, "hash-linked");
  assert.deepEqual(Object.keys(parseRule(text).cast), ["photo", "photo-2", "photo-3"]);
});

test("scaffold: a collision suffix never takes another file's natural name", () => {
  // photo.png must NOT become "photo-2" while the real photo-2.jpg is
  // pushed to "photo-2-2": an author editing the claim by role name would
  // silently bind the wrong digest.
  const text = scaffoldRule([
    { name: "photo.jpg", sha256Hex: hexOf("one") },
    { name: "photo.png", sha256Hex: hexOf("two") },
    { name: "photo-2.jpg", sha256Hex: hexOf("three") },
  ]).replace(ORDERING_PLACEHOLDER, "hash-linked");
  const rule = parseRule(text);
  assert.deepEqual(Object.keys(rule.cast), ["photo", "photo-3", "photo-2"]);
  assert.equal(rule.cast["photo-2"]?.digest, `sha256:${hexOf("three")}`);
  assert.equal(rule.cast["photo-3"]?.digest, `sha256:${hexOf("two")}`);
});

test("scaffold: backslash names keep their identity; degenerate names omit means", () => {
  const text = scaffoldRule([
    { name: String.raw`a\b.jpg`, sha256Hex: hexOf("bs") },
    { name: "b.jpg", sha256Hex: hexOf("plain") },
  ]).replace(ORDERING_PLACEHOLDER, "hash-linked");
  const rule = parseRule(text);
  assert.deepEqual(Object.keys(rule.cast), ["a-b", "b"]);
  assert.equal(rule.cast["a-b"]?.means, String.raw`a\b.jpg`);
  assert.equal(rule.cast["b"]?.means, "b.jpg");

  // A trailing-slash or empty name has no basename to assert: no means
  // key at all, never means: "".
  const degenerate = scaffoldRule([
    { name: "photos/", sha256Hex: hexOf("deg") },
  ]).replace(ORDERING_PLACEHOLDER, "hash-linked");
  const degRule = parseRule(degenerate);
  assert.deepEqual(Object.keys(degRule.cast), ["file"]);
  assert.equal(degRule.cast["file"]?.means, undefined);
});

test("scaffold: __proto__ as a filename stem becomes an ordinary cast key", () => {
  const text = scaffoldRule([{ name: "__proto__.jpg", sha256Hex: hexOf("p") }]).replace(
    ORDERING_PLACEHOLDER,
    "assumption-dependent"
  );
  const rule = parseRule(text);
  assert.deepEqual(Object.keys(rule.cast), ["__proto__"]);
  assert.equal(rule.cast["__proto__"]?.digest, `sha256:${hexOf("p")}`);
});

test("scaffold rejects empty input and malformed hex", () => {
  assert.throws(() => scaffoldRule([]));
  assert.throws(() => scaffoldRule([{ name: "a", sha256Hex: "ABC" }]));
  assert.throws(() => scaffoldRule([{ name: "a", sha256Hex: hexOf("x").toUpperCase() }]));
});

// ---------------------------------------------------------------------------
// playAudit / play
// ---------------------------------------------------------------------------

const RULE_TEXT = JSON.stringify({
  rule: "bitgraph-player/1",
  id: "play-test",
  cast: {
    first: { digest: digestFor("first") },
    second: { digest: digestFor("second") },
  },
  world: "closed",
  requires: { ordering: "hash-linked" },
  claim: { before: ["first", "second"] },
  then: { label: "ok" },
});

function chainAudit() {
  return makeAudit({
    proofs: [
      { name: "p1", digestB64: digestFor("first"), epochId: "e1", counter: "1" },
      { name: "p2", digestB64: digestFor("second"), epochId: "e1", counter: "2", prev: "p1" },
    ],
    partitions: [{ epochId: "e1", members: ["p1", "p2"], components: [["p1", "p2"]] }],
  });
}

test("playAudit: verdict, bytes, and exit code agree with the pipeline pieces", () => {
  const sha = hexOf(RULE_TEXT);
  const result = playAudit(parseRule(RULE_TEXT), sha, chainAudit());
  assert.equal(result.verdict.result, "TRUE");
  assert.equal(result.exitCode, 0);
  assert.equal(result.verdict.rule.sha256, sha);
  assert.equal(result.bytes, serializeVerdict(result.verdict));
  assert.equal(result.verdict.then?.label, "ok");
});

test("playAudit exit codes: FALSE is 1, UNDETERMINED is 2", () => {
  const falseRule = parseRule(RULE_TEXT.replace('"before"', '"after"'));
  assert.equal(playAudit(falseRule, hexOf("x"), chainAudit()).exitCode, 1);

  const emptyAudit = makeAudit({ proofs: [] });
  const rule = parseRule(RULE_TEXT);
  assert.equal(playAudit(rule, hexOf("x"), emptyAudit).exitCode, 2);
});

test("play: missing rule file throws PlayError with stage rule-read", async () => {
  await assert.rejects(
    () => play("/nonexistent/rule.json", "/nonexistent/bundle"),
    (err: unknown) => {
      assert.ok(err instanceof PlayError);
      assert.equal((err as PlayError).stage, "rule-read");
      return true;
    }
  );
});

test("play: invalid rule file throws RuleError before any bundle work", async () => {
  const dir = mkdtempSync(join(tmpdir(), "player-play-"));
  try {
    const rulePath = join(dir, "rule.json");
    writeFileSync(rulePath, '{"rule": "bitgraph-player/1"}');
    await assert.rejects(
      () => play(rulePath, "/nonexistent/bundle"),
      (err: unknown) => err instanceof RuleError
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// CLI init wiring
// ---------------------------------------------------------------------------

test("cli init: hashes files, emits skeleton on stdout, exit 0", () => {
  const dir = mkdtempSync(join(tmpdir(), "player-init-"));
  try {
    const po = join(dir, "po.pdf");
    const delivery = join(dir, "delivery.jpg");
    writeFileSync(po, "po-bytes");
    writeFileSync(delivery, "delivery-bytes");

    const run = spawnSync(process.execPath, [CLI_PATH, "init", po, delivery], {
      encoding: "utf8",
    });
    assert.equal(run.status, 0, run.stderr);
    const skeleton = JSON.parse(run.stdout) as {
      cast: Record<string, { digest: string }>;
      requires: { ordering: string };
    };
    assert.deepEqual(Object.keys(skeleton.cast), ["po", "delivery"]);
    assert.equal(skeleton.cast["po"]?.digest, `sha256:${hexOf("po-bytes")}`);
    assert.equal(skeleton.requires.ordering, ORDERING_PLACEHOLDER);
    assert.match(run.stderr, /next steps:/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cli init --out: writes the file, refuses to overwrite it, exit 3", () => {
  const dir = mkdtempSync(join(tmpdir(), "player-init-out-"));
  try {
    const input = join(dir, "photo.jpg");
    writeFileSync(input, "photo-bytes");
    const out = join(dir, "rule.json");

    const first = spawnSync(process.execPath, [CLI_PATH, "init", input, "--out", out], {
      encoding: "utf8",
    });
    assert.equal(first.status, 0, first.stderr);
    assert.equal(first.stdout, "");
    const written = JSON.parse(readFileSync(out, "utf8")) as {
      cast: Record<string, { digest: string }>;
    };
    assert.equal(written.cast["photo"]?.digest, `sha256:${hexOf("photo-bytes")}`);

    const second = spawnSync(process.execPath, [CLI_PATH, "init", input, "--out", out], {
      encoding: "utf8",
    });
    assert.equal(second.status, 3);
    assert.match(second.stderr, /refusing to overwrite/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cli init: unreadable input is an error, exit 3; no files is usage, exit 3", () => {
  const missing = spawnSync(
    process.execPath,
    [CLI_PATH, "init", "/nonexistent/file.jpg"],
    { encoding: "utf8" }
  );
  assert.equal(missing.status, 3);
  assert.match(missing.stderr, /cannot hash/);

  const empty = spawnSync(process.execPath, [CLI_PATH, "init"], { encoding: "utf8" });
  assert.equal(empty.status, 3);
  assert.match(empty.stderr, /usage:/);
});

test("cli: a file named init in cwd makes `bitgraph-play init …` a loud error, not a silent mode pick", () => {
  const dir = mkdtempSync(join(tmpdir(), "player-init-shadow-"));
  try {
    writeFileSync(join(dir, "init"), "{}");
    writeFileSync(join(dir, "photo.jpg"), "bytes");
    const run = spawnSync(process.execPath, [CLI_PATH, "init", "photo.jpg"], {
      encoding: "utf8",
      cwd: dir,
    });
    assert.equal(run.status, 3);
    assert.match(run.stderr, /ambiguous/);
    assert.equal(run.stdout, "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cli: -- forces evaluate mode, so a rule file named init is still reachable", () => {
  const dir = mkdtempSync(join(tmpdir(), "player-init-dashdash-"));
  try {
    // An invalid rule proves the point: init-mode would hash it and exit 0;
    // evaluate mode must report an invalid rule with exit 3.
    writeFileSync(join(dir, "init"), "{}");
    const run = spawnSync(process.execPath, [CLI_PATH, "--", "init", dir], {
      encoding: "utf8",
      cwd: dir,
    });
    assert.equal(run.status, 3);
    assert.match(run.stderr, /invalid rule/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("PLAYER_VERSION matches package.json (the constant must not drift across releases)", async () => {
  const { PLAYER_VERSION } = await import("../verdict.js");
  const pkg = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8")
  ) as { version: string };
  assert.equal(PLAYER_VERSION, pkg.version);
});

test("cli evaluate: unchanged contract, invalid rule reports issues on stderr, exit 3", () => {
  const dir = mkdtempSync(join(tmpdir(), "player-eval-"));
  try {
    const rulePath = join(dir, "rule.json");
    writeFileSync(rulePath, "{}");
    const run = spawnSync(process.execPath, [CLI_PATH, rulePath, dir], {
      encoding: "utf8",
    });
    assert.equal(run.status, 3);
    assert.match(run.stderr, /invalid rule/);
    assert.equal(run.stdout, "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
