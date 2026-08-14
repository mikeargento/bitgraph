// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * BitGraph Titles: format, threads, vault, keys, markers, and the
 * end-to-end title abstract (thread -> generated /2 rule -> Player
 * verdict) over synthetic evidence. No ledger writes, no network.
 */

import { strict as assert } from "node:assert";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseRule, playAudit } from "@mikeargento/bitgraph-player";
import { markerBytes, parseMarker } from "../marker.js";
import {
  checkPm,
  createPm,
  parsePm,
  PmError,
  possessionHash,
  serializePm,
  sha256HexOf,
} from "../pm.js";
import { buildThread } from "../thread.js";
import { buildTitleRule } from "../titlerule.js";
import { keygen, loadKey, KeyFileError } from "../keysfile.js";
import { initVault, lookupIdFor, vaultGet, vaultPut } from "../vault.js";
import { makeAudit } from "./fixtures.js";

function ed25519Signer(): { alg: "ed25519"; publicKey: string; privateKey: import("node:crypto").KeyObject } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  return { alg: "ed25519", publicKey: spki.subarray(spki.length - 32).toString("base64"), privateKey };
}

const WORK = Buffer.from("the wedding gallery, exact bytes, delivered once");

// ---------------------------------------------------------------------------
// Format
// ---------------------------------------------------------------------------

test("create -> serialize -> parse round-trips and the signature verifies", () => {
  const signer = ed25519Signer();
  const { pm, bytes } = createPm({ subjectBytes: WORK, claim: "held", signer, body: "origin" });
  const reparsed = parsePm(bytes);
  assert.equal(serializePm(reparsed), serializePm(pm));
  const check = checkPm(reparsed, WORK);
  assert.equal(check.signature, true);
  assert.equal(check.possession, "verified");
});

test("possession is three-valued: unverifiable without bytes, refuted by wrong bytes", () => {
  const signer = ed25519Signer();
  const { pm } = createPm({ subjectBytes: WORK, claim: "held", signer });
  assert.equal(checkPm(pm).possession, "unverifiable");
  assert.equal(checkPm(pm, Buffer.from("other bytes")).possession, "refuted");
});

test("the possession hash is not the plain digest", () => {
  // The plain digest is public on the ledger; the possession hash must
  // not be derivable from it.
  assert.notEqual(possessionHash(WORK), sha256HexOf(WORK));
});

test("tampering with any field breaks the signature", () => {
  const signer = ed25519Signer();
  const { pm } = createPm({ subjectBytes: WORK, claim: "held", signer, body: "hello" });
  const tampered = { ...pm, body: "hello!" };
  assert.equal(checkPm(tampered).signature, false);
});

test("claim-shape rules hold", () => {
  const signer = ed25519Signer();
  const other = ed25519Signer();
  // A give must name a recipient.
  assert.throws(
    () =>
      createPm({
        subjectBytes: WORK,
        claim: "give",
        signer,
        re: `sha256:${"a".repeat(64)}`,
      }),
    PmError
  );
  // A held origin must not reply to anything.
  assert.throws(
    () => createPm({ subjectBytes: WORK, claim: "held", signer, re: `sha256:${"a".repeat(64)}` }),
    PmError
  );
  // A take must reply.
  assert.throws(
    () =>
      createPm({
        subjectBytes: WORK,
        claim: "take",
        signer,
      }),
    PmError
  );
  // Well-formed give parses.
  const { bytes } = createPm({
    subjectBytes: WORK,
    claim: "give",
    signer,
    re: `sha256:${"a".repeat(64)}`,
    to: { alg: other.alg, publicKey: other.publicKey },
  });
  parsePm(bytes);
});

test("non-canonical bytes are rejected: one signature can never spawn a second valid file", () => {
  const signer = ed25519Signer();
  const { pm, bytes } = createPm({ subjectBytes: WORK, claim: "held", signer });

  // Re-spelled digest (uppercase hex inside `about`): same signed
  // content after normalization, different file digest. Must not parse.
  const respelled = JSON.parse(Buffer.from(bytes).toString("utf8")) as Record<string, unknown>;
  respelled["about"] = (respelled["about"] as string).toUpperCase().replace("SHA256", "sha256");
  assert.throws(() => parsePm(Buffer.from(JSON.stringify(respelled, null, 2) + "\n")), PmError);

  // Re-indented variant: identical JSON value, different bytes. Must not parse.
  const reindented = Buffer.from(JSON.stringify(JSON.parse(serializePm(pm))) + "\n");
  assert.throws(() => parsePm(reindented), PmError);

  // The canonical bytes themselves keep parsing.
  parsePm(bytes);
});

test("identical statements with different salts are different files", () => {
  const signer = ed25519Signer();
  const a = createPm({ subjectBytes: WORK, claim: "held", signer });
  const b = createPm({ subjectBytes: WORK, claim: "held", signer });
  assert.notEqual(sha256HexOf(a.bytes), sha256HexOf(b.bytes));
});

// ---------------------------------------------------------------------------
// Markers
// ---------------------------------------------------------------------------

test("markers are deterministic and unsalted by design", () => {
  const hex = "b".repeat(64);
  assert.deepEqual(markerBytes(hex), markerBytes(hex));
  const parsed = parseMarker(markerBytes(hex));
  assert.ok(parsed !== undefined);
  assert.equal((parsed as { of: string }).of, `sha256:${hex}`);
});

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

function conveyOnce() {
  const alice = ed25519Signer();
  const bob = ed25519Signer();
  const origin = createPm({ subjectBytes: WORK, claim: "held", signer: alice });
  const give = createPm({
    subjectBytes: WORK,
    claim: "give",
    signer: alice,
    re: `sha256:${sha256HexOf(origin.bytes)}`,
    to: { alg: bob.alg, publicKey: bob.publicKey },
  });
  const take = createPm({
    subjectBytes: WORK,
    claim: "take",
    signer: bob,
    re: `sha256:${sha256HexOf(give.bytes)}`,
  });
  return { alice, bob, origin, give, take };
}

test("open -> give -> take builds a clean thread; the taker becomes the holder", () => {
  const { bob, origin, give, take } = conveyOnce();
  const thread = buildThread([take.bytes, origin.bytes, give.bytes], WORK);
  assert.deepEqual(thread.issues, []);
  assert.equal(thread.links.length, 3);
  assert.equal(thread.head.pm.claim, "take");
  assert.equal(thread.holderKey.publicKey, bob.publicKey);
});

test("a take signed by a key the give did not name is rejected", () => {
  const { origin, give } = conveyOnce();
  const mallory = ed25519Signer();
  const forgedTake = createPm({
    subjectBytes: WORK,
    claim: "take",
    signer: mallory,
    re: `sha256:${sha256HexOf(give.bytes)}`,
  });
  const thread = buildThread([origin.bytes, give.bytes, forgedTake.bytes], WORK);
  assert.ok(thread.issues.some((i) => i.includes("did not name")));
  assert.equal(thread.head.pm.claim, "give");
});

test("a give signed by a non-holder is rejected: showing a thread never confers extension", () => {
  const { origin } = conveyOnce();
  const mallory = ed25519Signer();
  const stranger = ed25519Signer();
  const forgedGive = createPm({
    subjectBytes: WORK,
    claim: "give",
    signer: mallory,
    re: `sha256:${sha256HexOf(origin.bytes)}`,
    to: { alg: stranger.alg, publicKey: stranger.publicKey },
  });
  const thread = buildThread([origin.bytes, forgedGive.bytes], WORK);
  assert.ok(thread.issues.some((i) => i.includes("not signed by the current holder")));
});

test("two replies to one predecessor are flagged: a presented thread must be linear", () => {
  const { alice, origin } = conveyOnce();
  const b = ed25519Signer();
  const c = ed25519Signer();
  const give1 = createPm({
    subjectBytes: WORK,
    claim: "give",
    signer: alice,
    re: `sha256:${sha256HexOf(origin.bytes)}`,
    to: { alg: b.alg, publicKey: b.publicKey },
  });
  const give2 = createPm({
    subjectBytes: WORK,
    claim: "give",
    signer: alice,
    re: `sha256:${sha256HexOf(origin.bytes)}`,
    to: { alg: c.alg, publicKey: c.publicKey },
  });
  const thread = buildThread([origin.bytes, give1.bytes, give2.bytes], WORK);
  assert.ok(thread.issues.some((i) => i.includes("linear")));
});

// ---------------------------------------------------------------------------
// Vault
// ---------------------------------------------------------------------------

test("vault round-trip: sealed by subject bytes, opened only by the same bytes", () => {
  const dir = mkdtempSync(join(tmpdir(), "bg-vault-"));
  const path = join(dir, "test.bgvault");
  initVault(path);
  const signer = ed25519Signer();
  const { bytes } = createPm({ subjectBytes: WORK, claim: "held", signer });
  vaultPut(path, WORK, bytes);

  const opened = vaultGet(path, WORK);
  assert.equal(opened.length, 1);
  assert.deepEqual(new Uint8Array(opened[0] as Buffer), new Uint8Array(bytes));

  // Wrong bytes open nothing: no file, no author.
  assert.equal(vaultGet(path, Buffer.from("not the work")).length, 0);
});

test("lookup ids do not reveal the plain digest", () => {
  assert.notEqual(lookupIdFor(WORK), sha256HexOf(WORK));
});

// ---------------------------------------------------------------------------
// Key files
// ---------------------------------------------------------------------------

test("keygen -> loadKey round-trips, and a passphrase-encrypted key demands its passphrase", () => {
  const dir = mkdtempSync(join(tmpdir(), "bg-key-"));
  const plain = join(dir, "plain.json");
  const publicKey = keygen(plain);
  const loaded = loadKey(plain);
  assert.equal(loaded.publicKey, publicKey);

  const enc = join(dir, "enc.json");
  const encPub = keygen(enc, "correct horse");
  assert.throws(() => loadKey(enc), KeyFileError);
  assert.throws(() => loadKey(enc, "wrong"), KeyFileError);
  assert.equal(loadKey(enc, "correct horse").publicKey, encPub);
});

// ---------------------------------------------------------------------------
// End to end: thread -> title rule -> Player verdict
// ---------------------------------------------------------------------------

test("a complete title check: thread clean (key story) and abstract TRUE (chain story)", () => {
  const { origin, give, take } = conveyOnce();
  // The key story: signatures and give/take discipline, at the message layer.
  const thread = buildThread([origin.bytes, give.bytes, take.bytes], WORK);
  assert.deepEqual(thread.issues, []);

  // The chain story: a format 1 rule any conforming Player can evaluate.
  const ruleText = buildTitleRule(thread, { ordering: "assumption-dependent" });
  const rule = parseRule(ruleText);
  assert.equal(rule.rule, "bitgraph-player/1");

  // Synthetic recordings: the work, then each message, in thread order.
  const audit = makeAudit([
    { name: "work", digestB64: Buffer.from(sha256HexOf(WORK), "hex").toString("base64"), counter: "1" },
    { name: "m0", digestB64: Buffer.from(sha256HexOf(origin.bytes), "hex").toString("base64"), counter: "2" },
    { name: "m1", digestB64: Buffer.from(sha256HexOf(give.bytes), "hex").toString("base64"), counter: "3" },
    { name: "m2", digestB64: Buffer.from(sha256HexOf(take.bytes), "hex").toString("base64"), counter: "4" },
  ]);

  const result = playAudit(rule, "0".repeat(64), audit);
  assert.equal(result.verdict.result, "TRUE");
  assert.equal(result.verdict.verdict, "bitgraph-player-verdict/1");
});

test("a bundle recording the messages out of order refutes the abstract", () => {
  const { origin, give, take } = conveyOnce();
  const thread = buildThread([origin.bytes, give.bytes, take.bytes], WORK);
  const rule = parseRule(buildTitleRule(thread, { ordering: "assumption-dependent" }));

  const audit = makeAudit([
    { name: "work", digestB64: Buffer.from(sha256HexOf(WORK), "hex").toString("base64"), counter: "1" },
    // The take recorded BEFORE the give: the claimed order is false.
    { name: "m2", digestB64: Buffer.from(sha256HexOf(take.bytes), "hex").toString("base64"), counter: "2" },
    { name: "m1", digestB64: Buffer.from(sha256HexOf(give.bytes), "hex").toString("base64"), counter: "3" },
    { name: "m0", digestB64: Buffer.from(sha256HexOf(origin.bytes), "hex").toString("base64"), counter: "4" },
  ]);
  const result = playAudit(rule, "0".repeat(64), audit);
  assert.equal(result.verdict.result, "FALSE");
});

test("a message missing from the bundle leaves the abstract UNDETERMINED, never FALSE", () => {
  const { origin, give, take } = conveyOnce();
  const thread = buildThread([origin.bytes, give.bytes, take.bytes], WORK);
  const rule = parseRule(buildTitleRule(thread, { ordering: "assumption-dependent" }));

  const audit = makeAudit([
    { name: "work", digestB64: Buffer.from(sha256HexOf(WORK), "hex").toString("base64"), counter: "1" },
    { name: "m0", digestB64: Buffer.from(sha256HexOf(origin.bytes), "hex").toString("base64"), counter: "2" },
    { name: "m1", digestB64: Buffer.from(sha256HexOf(give.bytes), "hex").toString("base64"), counter: "3" },
    // The take's recording is absent from this bundle.
  ]);
  const result = playAudit(rule, "0".repeat(64), audit);
  assert.equal(result.verdict.result, "UNDETERMINED");
});
