// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * BitGraph Domain: parseDomainFile, fingerprints, the pin store, the
 * fetch, and check --from's "domain" line.
 *
 * The invariants under test:
 *   - The domain line is TRUE or UNDETERMINED, never FALSE: absence of
 *     domain evidence contradicts nothing (SPEC §9.3's open-world rule).
 *   - Fingerprints are always derived from key material, never read from
 *     the file; for es256 the fingerprint IS the actor keyId, proved
 *     against the real declared recording (fixtures/declared-12010).
 *   - A malformed file is refused at the pin, and a redirect cannot store
 *     one party's file under another party's name (the `domain` field
 *     must equal the domain the reader asked for).
 *   - A report without --from stays bitgraph-check/1 with no `from` key.
 *
 * Everything runs in memory or under a temp dir. The fetch is injected;
 * no network, no ledger writes, ever.
 */

import { strict as assert } from "node:assert";
import { createHash, generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ingestEntries } from "@mikeargento/bitgraph-audit";
import type { CheckRecording, CheckReport } from "../check.js";
import { checkIngest } from "../check.js";
import {
  checkDomain,
  diffDomainFiles,
  DomainFileError,
  domainKeyRefs,
  isDomainName,
  keyFingerprint,
  parseDomainFile,
} from "../domain.js";
import { fetchDomainFile, forgetPin, listPins, readPin, writePin } from "../pin.js";
import type { FetchLike } from "../pin.js";
import { sigMessage } from "../sig.js";

// ---------------------------------------------------------------------------
// The real declared recording: actor key ee0c6517…, provider passkey
// ---------------------------------------------------------------------------

const proofBytes = readFileSync(new URL("../../src/__tests__/fixtures/declared-12010/proof.json", import.meta.url));
const proofJson = JSON.parse(proofBytes.toString("utf8")) as {
  agency: { actor: { publicKeyB64: string; keyId: string } };
  artifact: { digestB64: string };
};
const ACTOR_KEY_B64 = proofJson.agency.actor.publicKeyB64;
const ACTOR_KEY_ID = proofJson.agency.actor.keyId;
const DIGEST_HEX = Buffer.from(proofJson.artifact.digestB64, "base64").toString("hex");

function domainText(overrides?: Record<string, unknown>): string {
  return JSON.stringify({
    version: "bitgraph-domain/1",
    domain: "acme.com",
    party: "Acme Corp",
    keys: { studio: { alg: "es256", publicKey: ACTOR_KEY_B64 } },
    ...overrides,
  });
}

async function ingestProof(bytes: Uint8Array = proofBytes) {
  return ingestEntries([{ path: "proof.json", open: () => Promise.resolve(new Uint8Array(bytes)) }]);
}

function onlyRecording(report: CheckReport): CheckRecording {
  assert.equal(report.recordings.length, 1);
  return report.recordings[0] as CheckRecording;
}

function domainLineOf(recording: CheckRecording) {
  const line = recording.lines.find((l) => l.name === "domain");
  assert.notEqual(line, undefined, "expected a domain line");
  return line as NonNullable<typeof line>;
}

// ---------------------------------------------------------------------------
// Parsing and fingerprints
// ---------------------------------------------------------------------------

test("parseDomainFile accepts a valid file and derives the party/keys", () => {
  const file = parseDomainFile(domainText(), "acme.com");
  assert.equal(file.domain, "acme.com");
  assert.equal(file.party, "Acme Corp");
  assert.deepEqual(Object.keys(file.keys), ["studio"]);
});

test("isDomainName: lowercase dotted hostnames only", () => {
  assert.equal(isDomainName("acme.com"), true);
  assert.equal(isDomainName("sub.acme-corp.co.uk"), true);
  assert.equal(isDomainName("ACME.com"), false);
  assert.equal(isDomainName("acme"), false);
  assert.equal(isDomainName("acme.com/path"), false);
  assert.equal(isDomainName("https://acme.com"), false);
  assert.equal(isDomainName("acme.com:443"), false);
  assert.equal(isDomainName(""), false);
});

test("parseDomainFile refuses malformed files with every issue named", () => {
  const bad = (text: string, expected?: string): string[] => {
    try {
      parseDomainFile(text, expected);
    } catch (err) {
      assert.ok(err instanceof DomainFileError);
      return [...err.issues];
    }
    assert.fail("expected DomainFileError");
  };
  assert.match(bad(domainText({ version: "bitgraph-domain/2" })).join(" "), /"version" must be exactly/);
  assert.match(bad(domainText({ extra: 1 })).join(" "), /unknown field "extra"/);
  assert.match(bad(domainText(), "other.example").join(" "), /refusing to store one party's file/);
  assert.match(bad(domainText({ party: "  " })).join(" "), /"party" is required/);
  assert.match(bad(domainText({ keys: {} })).join(" "), /at least one key/);
  assert.match(bad(domainText({ keys: { "1234": { alg: "es256", publicKey: ACTOR_KEY_B64 } } })).join(" "), /non-digit/);
  assert.match(
    bad(domainText({ keys: { studio: { alg: "es256", publicKey: ACTOR_KEY_B64, note: "x" } } })).join(" "),
    /unknown field "note"/
  );
  assert.match(bad(domainText({ keys: { studio: { alg: "rsa", publicKey: ACTOR_KEY_B64 } } })).join(" "), /"alg" must be/);
  assert.match(bad(domainText({ keys: { studio: { alg: "es256", publicKey: "!!!" } } })).join(" "), /does not decode/);
  assert.match(
    bad(domainText({ keys: { press: { alg: "ed25519", publicKey: Buffer.alloc(16).toString("base64") } } })).join(" "),
    /does not decode/
  );
  assert.match(bad(domainText({ domain: "https://acme.com" })).join(" "), /lowercase hostname/);
  // Oversize input is refused before parsing.
  const big = new Uint8Array(70_000);
  assert.throws(() => parseDomainFile(big), DomainFileError);
});

test("an es256 fingerprint IS the actor keyId (derived, never assigned)", () => {
  assert.equal(keyFingerprint({ alg: "es256", publicKey: ACTOR_KEY_B64 }), ACTOR_KEY_ID);
  const refs = domainKeyRefs(parseDomainFile(domainText()));
  assert.deepEqual(refs.map((r) => [r.name, r.fingerprint]), [["studio", ACTOR_KEY_ID]]);
});

test("checkDomain resolves actor keyIds case-insensitively, es256 only", () => {
  const from = checkDomain(parseDomainFile(domainText()));
  assert.equal(from.actorKeyName(ACTOR_KEY_ID), "studio");
  assert.equal(from.actorKeyName(ACTOR_KEY_ID.toUpperCase()), "studio");
  assert.equal(from.actorKeyName("00".repeat(32)), undefined);
  // An ed25519 key never actor-matches: actors are P-256.
  const edPub = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "der" }) as Buffer;
  const edOnly = parseDomainFile(
    domainText({ keys: { press: { alg: "ed25519", publicKey: edPub.subarray(edPub.length - 32).toString("base64") } } })
  );
  const edFingerprint = keyFingerprint(edOnly.keys["press"] as { alg: "ed25519"; publicKey: string });
  assert.equal(checkDomain(edOnly).actorKeyName(edFingerprint as string), undefined);
});

// ---------------------------------------------------------------------------
// check --from: the domain line
// ---------------------------------------------------------------------------

test("check --from: the real declared recording reads TRUE under its published key", async () => {
  const report = await checkIngest(await ingestProof(), { from: checkDomain(parseDomainFile(domainText())) });
  assert.equal(report.check, "bitgraph-check/2");
  assert.deepEqual(report.from, { domain: "acme.com", party: "Acme Corp" });
  const line = domainLineOf(onlyRecording(report));
  assert.equal(line.result, "TRUE");
  assert.match(line.detail, /actor key "studio" · published by acme\.com \(Acme Corp\)/);
  assert.ok(report.notChecked.some((n) => n.includes("pinned")));
});

test("check --from: a domain that never published the key reads UNDETERMINED, never FALSE", async () => {
  const otherKey = generateKeyPairSync("ec", { namedCurve: "P-256" })
    .publicKey.export({ type: "spki", format: "der" }) as Buffer;
  const from = checkDomain(
    parseDomainFile(domainText({ keys: { invoices: { alg: "es256", publicKey: otherKey.toString("base64") } } }))
  );
  const report = await checkIngest(await ingestProof(), { from });
  const line = domainLineOf(onlyRecording(report));
  assert.equal(line.result, "UNDETERMINED");
  assert.match(line.detail, /is not among the 1 key\(s\) acme\.com publishes/);
});

test("check --from: a recording that does not verify gets an UNDETERMINED domain line", async () => {
  const stripped = JSON.parse(proofBytes.toString("utf8")) as Record<string, unknown>;
  delete stripped["agency"];
  const report = await checkIngest(await ingestProof(Buffer.from(JSON.stringify(stripped))), {
    from: checkDomain(parseDomainFile(domainText())),
  });
  const recording = onlyRecording(report);
  assert.equal(recording.lines.find((l) => l.name === "signature")?.result, "FALSE");
  const line = domainLineOf(recording);
  assert.equal(line.result, "UNDETERMINED");
  assert.match(line.detail, /is not verified here/);
});

test("check --from: a detached bitgraph-sig/1 under a published ed25519 key reads TRUE", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ type: "spki", format: "der" }) as Buffer;
  const rawB64 = spki.subarray(spki.length - 32).toString("base64");
  const signature = cryptoSign(null, sigMessage(DIGEST_HEX), privateKey).toString("base64");
  const sigBytes = Buffer.from(
    JSON.stringify({
      sig: "bitgraph-sig/1",
      over: `sha256:${DIGEST_HEX}`,
      alg: "ed25519",
      publicKey: rawB64,
      signature,
    })
  );
  const from = checkDomain(parseDomainFile(domainText({ keys: { press: { alg: "ed25519", publicKey: rawB64 } } })));
  const sigEvidence = new Map([[createHash("sha256").update(sigBytes).digest("hex"), new Uint8Array(sigBytes)]]);
  const report = await checkIngest(await ingestProof(), { from, sigEvidence });
  const line = domainLineOf(onlyRecording(report));
  assert.equal(line.result, "TRUE");
  assert.match(line.detail, /signature by "press" · published by acme\.com/);
});

test("without --from the report stays bitgraph-check/1 with no from key and no domain line", async () => {
  const report = await checkIngest(await ingestProof());
  assert.equal(report.check, "bitgraph-check/1");
  assert.equal("from" in report, false);
  assert.equal(onlyRecording(report).lines.some((l) => l.name === "domain"), false);
});

// ---------------------------------------------------------------------------
// The pin store
// ---------------------------------------------------------------------------

test("pin store: write, read, list, forget; malformed pins are refused at read", () => {
  const dir = mkdtempSync(join(tmpdir(), "bitgraph-pins-"));
  try {
    const path = writePin("acme.com", Buffer.from(domainText()), dir);
    assert.ok(path.endsWith("acme.com"));
    const pin = readPin("acme.com", dir);
    assert.equal(pin?.file.party, "Acme Corp");
    assert.equal(pin?.bytes.toString("utf8"), domainText());

    // A stored file naming a different domain is refused: the store binds
    // name to statement, so a bad write cannot impersonate.
    writePin("evil.example", Buffer.from(domainText()), dir);
    assert.throws(() => readPin("evil.example", dir), DomainFileError);

    writePin("broken.example", Buffer.from("{"), dir);
    assert.throws(() => readPin("broken.example", dir), DomainFileError);

    const listed = listPins(dir);
    assert.deepEqual(listed.map((p) => [p.domain, p.malformed]), [
      ["acme.com", false],
      ["broken.example", true],
      ["evil.example", true],
    ]);
    assert.equal(listed[0]?.party, "Acme Corp");
    assert.equal(listed[0]?.keyCount, 1);

    assert.equal(forgetPin("acme.com", dir), true);
    assert.equal(readPin("acme.com", dir), undefined);
    assert.equal(forgetPin("acme.com", dir), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// The fetch (injected; the only networked verb)
// ---------------------------------------------------------------------------

function fakeFetch(body: string | Buffer, status = 200): { impl: FetchLike; urls: string[] } {
  const urls: string[] = [];
  const impl: FetchLike = (url) => {
    urls.push(url);
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      arrayBuffer: () => {
        const buf = Buffer.from(body);
        return Promise.resolve(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
      },
    });
  };
  return { impl, urls };
}

test("fetchDomainFile: fixed well-known path, verbatim bytes, strict domain binding", async () => {
  const { impl, urls } = fakeFetch(domainText());
  const fetched = await fetchDomainFile("acme.com", impl);
  assert.deepEqual(urls, ["https://acme.com/.well-known/bitgraph"]);
  assert.equal(fetched.file.party, "Acme Corp");
  assert.equal(fetched.bytes.toString("utf8"), domainText());

  // The served file names acme.com; pinning it as another.example must
  // refuse: a redirect cannot repoint the name.
  await assert.rejects(fetchDomainFile("another.example", fakeFetch(domainText()).impl), DomainFileError);
  await assert.rejects(fetchDomainFile("acme.com", fakeFetch("nope", 404).impl), /HTTP 404/);
  await assert.rejects(fetchDomainFile("acme.com", fakeFetch(Buffer.alloc(70_000)).impl), /the cap is/);
  await assert.rejects(fetchDomainFile("https://acme.com", fakeFetch(domainText()).impl), /bare hostname/);
});

// ---------------------------------------------------------------------------
// Re-pin diffs
// ---------------------------------------------------------------------------

test("diffDomainFiles reports added, removed, changed, and a renamed party", () => {
  const edPub = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "der" }) as Buffer;
  const edB64 = edPub.subarray(edPub.length - 32).toString("base64");
  const before = parseDomainFile(domainText());
  const after = parseDomainFile(
    domainText({
      party: "Acme Corporation",
      keys: {
        studio: { alg: "ed25519", publicKey: edB64 },
        press: { alg: "ed25519", publicKey: edB64 },
      },
    })
  );
  const diff = diffDomainFiles(before, after);
  assert.deepEqual(diff.partyChanged, { before: "Acme Corp", after: "Acme Corporation" });
  assert.deepEqual(diff.added.map((r) => r.name), ["press"]);
  assert.deepEqual(diff.removed.map((r) => r.name), []);
  assert.deepEqual(diff.changed.map((c) => c.name), ["studio"]);
  assert.equal(diff.unchanged, 0);
});
