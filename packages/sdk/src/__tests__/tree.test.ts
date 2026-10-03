// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * tree/1 through the SDK, end to end: the REAL tree pipeline (the core's
 * fuseTree over the scan's saved hash states) against a local boundary that
 * hands out signed slots with their floor (enclave v9) and mints signed
 * proofs from the commit bodies it receives. Files and folders become one
 * tree; the exports the class and the CLI write are read back by
 * verifyExport, from the original files. Nothing here touches a network
 * beyond 127.0.0.1, and nothing is minted anywhere but in this process.
 *
 * The proofs are stub-signed, so the attestation claim is FALSE and verify
 * exits 2 for that reason alone; every other claim is asserted.
 */

import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdtemp, mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { getPublicKeyAsync, signAsync } from "@noble/ed25519";
import {
  canonicalize, canonicalSlotBody, evmBytesToHex, keccak256, rlpEncode, verifyExport, parseExport,
  type ExportVerifyResult, type SlotAllocation,
} from "@mikeargento/bitgraph-verify";
import { MAX_FUSE_BYTES, writeRecoveryEntries } from "@mikeargento/bitgraph";
import { BitGraph } from "../bitgraph.js";
import { fuseTreePipeline } from "../pipelines.js";
import { serve } from "../serve.js";
import { scanFile, type ScannedFile } from "../scan.js";
import { memberExportFromOwner, memberExportFileName, readExportFile, relativeNames, safeRelativeName, exportBaseName } from "../exports.js";

const cliPath = fileURLToPath(new URL("../cli.js", import.meta.url));
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");
const toUrlSafe = (s: string) => s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const sha = (b: Uint8Array | string) => new Uint8Array(createHash("sha256").update(b).digest());
const EPOCH = b64(sha("sdk-tree-epoch"));
const FLOOR_NUMBER = 25_600_000;
const FLOOR_TIME = 1_790_100_000;

/** A header that decodes, its keccak-256 the floor block's hash. */
function header(number: number, timestamp: number): Uint8Array {
  const u = (n: number) => { let h = n.toString(16); if (h.length % 2) h = "0" + h; return Uint8Array.from(Buffer.from(h, "hex")); };
  const z32 = new Uint8Array(32);
  return rlpEncode([z32, z32, new Uint8Array(20), z32, z32, z32, new Uint8Array(256), new Uint8Array(0), u(number), u(30_000_000), u(21_000), u(timestamp), new Uint8Array(0), z32, new Uint8Array(8), u(1000)]);
}
const floorHeader = header(FLOOR_NUMBER, FLOOR_TIME);
const floorHeaderHex = evmBytesToHex(floorHeader);
const floorHash = evmBytesToHex(keccak256(floorHeader));

let boundary: Server;
let baseUrl = "";
let priv: Uint8Array;
let pub = "";
let slotCounter = 1000;
// recovery: "absent" answers 404 like a site without the route, "off" 503 like
// one with writes off, "on" keeps sealed entries in memory like the site's
// create-only store.
const mode: { witness: boolean; floor: boolean; spec: "pinned" | "wrong" | "none"; recovery: "absent" | "off" | "on" } = { witness: true, floor: true, spec: "none", recovery: "absent" };
const recoveryEntries = new Map<string, string>();
const mintedByArtifact = new Map<string, Array<Record<string, unknown>>>();
const SPEC_TEXT = new Uint8Array(await readFile(fileURLToPath(new URL("../../../../spec/SPEC.md", import.meta.url))));
const requests: string[] = [];
let root = "";
let folder = "";
let lone = "";

async function mint(body: { digests: Array<{ digestB64: string }>; slot: SlotAllocation; attribution: Record<string, string>; metadata?: unknown; anchor?: unknown }): Promise<Record<string, unknown>> {
  const slot = body.slot;
  const commit: Record<string, unknown> = {
    nonceB64: slot.nonceB64,
    counter: String(Number(slot.counter) + 2),
    epochId: slot.epochId,
    slotCounter: slot.counter,
    slotHashB64: b64(sha(canonicalize(canonicalSlotBody(slot) as never))),
    ...(body.anchor !== undefined ? { slotAnchor: body.anchor } : {}),
    chainId: "bitgraph:main",
  };
  const artifact = { hashAlg: "sha256", digestB64: body.digests[0]!.digestB64 };
  const signed = { version: "bitgraph/1", artifact, commit, publicKeyB64: pub, enforcement: "stub", measurement: "sdk-tree-test", attribution: body.attribution };
  const signatureB64 = b64(await signAsync(canonicalize(signed as never), priv));
  return {
    version: "bitgraph/1", artifact, commit,
    signer: { publicKeyB64: pub, signatureB64 },
    environment: { enforcement: "stub", measurement: "sdk-tree-test" },
    attribution: body.attribution,
    slotAllocation: slot,
    ...(body.metadata !== undefined ? { metadata: body.metadata } : {}),
  };
}

before(async () => {
  priv = randomBytes(32);
  pub = b64(await getPublicKeyAsync(priv));
  root = await mkdtemp(join(tmpdir(), "bitgraph-sdk-tree-"));
  folder = join(root, "photos");
  await mkdir(join(folder, "sub"), { recursive: true });
  await writeFile(join(folder, "alpha.txt"), "alpha, a plain text member\n");
  await writeFile(join(folder, "photo.png"), Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("not really a picture, but the bytes say PNG")]));
  await writeFile(join(folder, "sub", "beta.txt"), "beta, one folder down\n");
  await writeFile(join(folder, ".hidden"), "left out\n");
  lone = join(root, "lone.txt");
  await writeFile(lone, "a file on its own\n");

  boundary = createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      void (async () => {
        const url = new URL(req.url ?? "/", "http://localhost");
        requests.push(url.pathname);
        const send = (status: number, payload: unknown) => {
          res.writeHead(status, { "Content-Type": "application/json" });
          res.end(JSON.stringify(payload));
        };
        const body = raw.length > 0 ? (JSON.parse(raw) as Record<string, unknown>) : {};
        if (url.pathname === "/api/proofs/batch") {
          send(200, { results: Object.fromEntries((body["digests"] as string[]).map((d) => [d, { proofs: [] }])) });
        } else if (url.pathname === "/api/fuse/allocate") {
          slotCounter += 10;
          const slotBody = { version: "bitgraph/slot/1" as const, nonceB64: b64(randomBytes(32)), counter: String(slotCounter), epochId: EPOCH, publicKeyB64: pub, chainId: "bitgraph:main" };
          const slot = { ...slotBody, signatureB64: b64(await signAsync(canonicalize(slotBody as never), priv)) };
          const anchor = { counter: String(slotCounter - 1), blockNumber: FLOOR_NUMBER, blockHash: floorHash };
          send(200, { slotId: slot.nonceB64, slot, chainId: "bitgraph:main", ...(mode.floor ? { anchor } : {}) });
        } else if (url.pathname === "/api/fuse/commit") {
          const proof = await mint(body as never);
          const key = toUrlSafe((proof["artifact"] as { digestB64: string }).digestB64);
          mintedByArtifact.set(key, [...(mintedByArtifact.get(key) ?? []), proof]);
          send(200, { proof });
        } else if (url.pathname === "/api/recovery" && req.method === "POST") {
          if (mode.recovery === "absent") send(404, { error: "unexpected /api/recovery" });
          else if (mode.recovery === "off") send(503, { error: "recovery writes are off on this site", code: "recovery-writes-off" });
          else {
            const results = (body["entries"] as Array<{ key: string; envelope: string }>).map(({ key, envelope }) => {
              const held = recoveryEntries.get(key);
              if (held !== undefined) return { key, status: "exists", envelope: held };
              recoveryEntries.set(key, envelope);
              return { key, status: "created" };
            });
            send(200, { results });
          }
        } else if (url.pathname.startsWith("/api/recovery/")) {
          if (mode.recovery === "absent") send(404, { error: `unexpected ${url.pathname}` });
          else {
            const address = url.pathname.slice("/api/recovery/".length);
            const after = url.searchParams.get("after");
            const entries = [...recoveryEntries.entries()]
              .filter(([k]) => k.startsWith(`recovery/v1/${address}/`) && (after === null || k.slice(-64) > after))
              .sort(([a], [b]) => (a < b ? -1 : 1))
              .map(([key, envelope]) => ({ key, envelope }));
            send(200, { address, entries, next: null });
          }
        } else if (url.pathname === "/api/proofs/witness") {
          if (mode.witness && url.searchParams.get("hash") === floorHash) send(200, { version: "bitgraph-anchor-witness/1", headerRlpHex: floorHeaderHex, blockNumber: FLOOR_NUMBER, blockHash: floorHash });
          else send(404, { error: "witness unavailable" });
        } else if (url.pathname.startsWith("/api/proofs/") && req.method === "GET") {
          send(200, { proofs: (mintedByArtifact.get(decodeURIComponent(url.pathname.slice("/api/proofs/".length))) ?? []).map((proof) => ({ proof })) });
        } else if (url.pathname.startsWith("/api/ceilings/")) {
          send(404, { error: "no ceiling recorded" });
        } else if (url.pathname === "/spec/SPEC.md" && mode.spec !== "none") {
          res.writeHead(200, { "Content-Type": "text/markdown" });
          res.end(mode.spec === "pinned" ? Buffer.from(SPEC_TEXT) : Buffer.from("# not the spec this proof pins\n"));
        } else {
          send(404, { error: `unexpected ${url.pathname}` });
        }
      })();
    });
  });
  await new Promise<void>((resolve) => boundary.listen(0, "127.0.0.1", resolve));
  const addr = boundary.address();
  if (addr === null || typeof addr === "string") throw new Error("no port");
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(() => {
  boundary.close();
});

const claim = (r: { claims: Array<{ id: string; result: string; detail: string }> }, id: string) => r.claims.find((c) => c.id === id);

/** Every offline claim TRUE but the stub attestation and the ones named NOT_CARRIED. */
function assertSound(r: Pick<ExportVerifyResult, "claims" | "verdict">, notCarried: readonly string[], label: string): void {
  for (const c of r.claims.filter((x) => x.level === "offline")) {
    const want = c.id === "attestation.signature" ? "FALSE" : notCarried.includes(c.id) ? "NOT_CARRIED" : "TRUE";
    assert.equal(c.result, want, `${label}: ${c.id} ${c.detail}`);
  }
  assert.equal(r.verdict, "FALSE", `${label}: the stub attestation is the one FALSE`);
}

const PENDING = ["ceiling.base", "ceiling.ethereum"];

function run(argv: string[], env: Record<string, string> = {}): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, argv, { env: { ...process.env, BITGRAPH_API_URL: baseUrl, ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, stderr, code: code ?? -1 }));
  });
}

test("the class: a folder and a file become ONE tree on the real pipeline; each file proves itself with the owner's export", async () => {
  const bg = new BitGraph({ baseUrl });
  const r = await bg.record([folder, lone]);
  const made = r.made!;
  assert.equal(made.kind, "tree");
  assert.equal(made.count, 4, "the hidden file is left out");
  assert.equal(made.proof.attribution?.title, "tree/1");
  assert.equal(made.proof.attribution?.name, "bitgraph-fuse/2");
  assert.equal(made.floor.header, floorHeaderHex, "the floor header was fetched and checked");
  assert.deepEqual([...made.names].sort(), ["lone.txt", "photos/alpha.txt", "photos/photo.png", "photos/sub/beta.txt"]);
  const byName = new Map(r.files.map((f) => [f.path, f]));
  assert.equal(byName.get(join(folder, "photo.png"))?.placement, "trailer/1");
  assert.equal(byName.get(join(folder, "alpha.txt"))?.placement, "container/2");
  assert.ok(r.files.every((f) => f.outcome === "recorded" && f.memberCount === 4 && f.counter === made.counter));
  const owner = bg.ownerExport(made);
  for (const f of r.files) {
    const bytes = new Uint8Array(await readFile(f.path));
    const v = await verifyExport(owner, { bytes });
    assertSound(v, PENDING, f.path);
    assert.equal(v.member?.index, f.member! - 1);
    assert.equal(owner.tree.names![f.member! - 1], relative(root, f.path), "named by its path under the deepest common folder");
    // The member's own export, and bg.verify with the export in place of a proof.
    const mine = bg.memberExport(made, f.member! - 1);
    assertSound(await verifyExport(mine, { bytes }), PENDING, `member ${f.path}`);
    const viaVerify = await bg.verify(f.path, mine);
    assert.equal(viaVerify.carrier, "none");
    assert.equal(viaVerify.member?.index, f.member! - 1);
    assert.equal(claim(viaVerify, "bytes.member")?.result, "TRUE");
    assert.deepEqual(viaVerify.times?.floor, { blockNumber: FLOOR_NUMBER, blockHash: floorHash, blockTimestamp: FLOOR_TIME });
  }
});

test("the pipeline: a file over the cap goes in as is by its scan digest, never read again", async () => {
  const scanned = await scanFile(lone);
  // The scan's own record of a file over 256 MiB, without the 256 MiB: the pipeline decides by size alone.
  const huge: ScannedFile = { ...scanned, size: MAX_FUSE_BYTES + 1, path: join(root, "does-not-exist.bin") };
  const other = await scanFile(join(folder, "alpha.txt"));
  const t = await fuseTreePipeline([huge, other], { baseUrl }, {});
  assert.deepEqual(t.members.map((m) => m.placement), ["as-is", "container/2"]);
  assert.equal(t.members[0]!.artifactDigestB64, scanned.digestB64, "as is: the leaf is the file's own digest");
  const bg = new BitGraph({ baseUrl });
  const v = await bg.verify(lone, bg.memberExport({ ...t, proof: t.proof, rootDocument: t.rootDocumentHex, leaves: t.leavesB64, names: ["", ""], counter: null, epoch: null, artifactDigest: "", floor: { ...t.floor, header: null } }, t.members[0]!.leafIndex));
  assert.equal(claim(v, "bytes.member")?.result, "TRUE");
  assert.match(claim(v, "floor.content")!.detail, /recorded as is: the bytes carry no commitment/);
});

test("a boundary that returns no floor makes nothing: the tree needs fuse/2", async () => {
  mode.floor = false;
  try {
    await assert.rejects(new BitGraph({ baseUrl }).record([lone], { again: true }), (e: Error & { code?: string }) => e.code === "floor-missing" && /no floor anchor/.test(e.message));
  } finally {
    mode.floor = true;
  }
});

test("cli: record a folder writes the owner's export; verify <file> <export> states every claim; exit 2 on the stub attestation alone", async () => {
  const out = await mkdtemp(join(tmpdir(), "bitgraph-sdk-tree-out-"));
  const rec = await run([cliPath, "record", folder, "--out", out, "--json", "--base-url", baseUrl]);
  assert.equal(rec.code, 0, rec.stderr);
  const r = JSON.parse(rec.stdout) as { made: { count: number; counter: string; epoch: string; artifactDigest: string; exports: { owner: string; membersDir: string | null } }; files: Array<{ path: string; member: number }> };
  assert.equal(r.made.count, 3);
  assert.equal(r.made.exports.membersDir, null, "the owner's export by default");
  assert.equal(r.made.exports.owner, join(out, `${exportBaseName(r.made)}.bitgraph.json`), "the site's own name for an owner's export");
  const owner = await readExportFile(r.made.exports.owner);
  assert.deepEqual([...owner.tree.names!].sort(), ["alpha.txt", "photo.png", "sub/beta.txt"]);
  assert.equal(owner.floor?.header, floorHeaderHex);
  const file = join(folder, "sub", "beta.txt");
  const v = await run([cliPath, "verify", file, r.made.exports.owner, "--json"]);
  assert.equal(v.code, 2, "FALSE on the stub attestation");
  const outcome = JSON.parse(v.stdout) as ExportVerifyResult;
  assertSound(outcome, PENDING, "cli verify");
  assert.equal(outcome.member?.index, r.files.find((f) => f.path === file)!.member - 1);
  // The same through --export, and the export alone (no file: the file's claims are not carried).
  const flag = await run([cliPath, "verify", file, "--export", r.made.exports.owner, "--json"]);
  assert.deepEqual((JSON.parse(flag.stdout) as ExportVerifyResult).claims, outcome.claims);
  const alone = await run([cliPath, "verify", r.made.exports.owner, "--json"]);
  assert.equal(claim(JSON.parse(alone.stdout) as ExportVerifyResult, "bytes.member")?.result, "NOT_CARRIED");
  // Human output: the member, the floor, one line per claim.
  const human = await run([cliPath, "verify", file, r.made.exports.owner]);
  assert.match(human.stdout, /^FALSE/);
  assert.match(human.stdout, /file: leaf \d of 3 \(container\/2\)/);
  assert.match(human.stdout, new RegExp(`floor: after Ethereum block ${FLOOR_NUMBER}`));
  assert.match(human.stdout, /ok {2}The proof pins a spec this verifier knows/);
  assert.match(human.stdout, /-- {2}The record is in a Base block: ceiling pending/);
  // A file that is not in the tree.
  const stranger = await run([cliPath, "verify", lone, r.made.exports.owner, "--json"]);
  assert.equal(claim(JSON.parse(stranger.stdout) as ExportVerifyResult, "tree.member")?.result, "NOT_CARRIED");
});

test("cli: --exports both writes one export per member under the tree's names; export member derives the same from the owner's", async () => {
  const out = await mkdtemp(join(tmpdir(), "bitgraph-sdk-tree-both-"));
  const rec = await run([cliPath, "record", folder, "--out", out, "--exports", "both", "--again", "--json"]);
  assert.equal(rec.code, 0, rec.stderr);
  const r = JSON.parse(rec.stdout) as { made: { exports: { owner: string; membersDir: string; members: Array<{ leafIndex: number; name: string; path: string }> } }; files: Array<{ path: string; member: number; export?: string }> };
  const { members, membersDir } = r.made.exports;
  assert.equal(members.length, 3);
  assert.deepEqual(members.map((m) => m.path.slice(membersDir.length + 1)).sort(), ["alpha.txt.bitgraph.json", "photo.png.bitgraph.json", join("sub", "beta.txt.bitgraph.json")]);
  for (const f of r.files) {
    assert.ok(f.export, `${f.path} names its export`);
    const exp = await readExportFile(f.export!);
    assert.equal(exp.tree.leaves, undefined, "a member's export lists no other leaf");
    assertSound(await verifyExport(exp, { bytes: new Uint8Array(await readFile(f.path)) }), PENDING, f.path);
    // Derived from the owner's export, the member's export is the same document.
    const owner = await readExportFile(r.made.exports.owner);
    const derived = memberExportFromOwner(owner, new Uint8Array(await readFile(f.path)))!;
    assert.deepEqual(derived.export, exp);
  }
  const target = join(out, "derived.export.json");
  const cli = await run([cliPath, "export", "member", r.made.exports.owner, join(folder, "alpha.txt"), "--out", target, "--json"]);
  assert.equal(cli.code, 0, cli.stderr);
  assertSound(await verifyExport(await readExportFile(target), { bytes: new Uint8Array(await readFile(join(folder, "alpha.txt"))) }), PENDING, "derived");
  const notIn = await run([cliPath, "export", "member", r.made.exports.owner, lone]);
  assert.equal(notIn.code, 1);
  assert.match(notIn.stderr, /is not in this BitGraph/);
  assert.deepEqual((await readdir(out)).filter((n) => n.endsWith(".json")).sort(), ["derived.export.json", basename(r.made.exports.owner)].sort(), "the owner's export and the derived one; the members sit in their folder");
});

test("writing exports never replaces a file: the same tree written twice takes a second name", async () => {
  const bg = new BitGraph({ baseUrl });
  const r = await bg.record([lone], { again: true });
  const dir = await mkdtemp(join(tmpdir(), "bitgraph-sdk-tree-twice-"));
  const first = await bg.writeExports(r.made!, dir);
  const second = await bg.writeExports(r.made!, dir);
  assert.notEqual(first.owner, second.owner);
  assert.equal(await readFile(first.owner!, "utf8"), await readFile(second.owner!, "utf8"));
  const both = await bg.writeExports(r.made!, dir, "both");
  assert.equal(both.members.length, 1);
  const again = await bg.writeExports(r.made!, dir, "members");
  assert.notEqual(again.membersDir, both.membersDir, "a members' folder already there is never written into again");
  assert.match(second.owner!, /bitgraph-\d+-[A-Za-z0-9_-]{8}\.bitgraph\.json$/, "a taken name takes the epoch");
  await assert.rejects(bg.writeExports(r.made!, dir, "everything" as never), /exports must be one of owner, members, both, none/);
});

test("cli: export complete adds the floor header once the site has it, leaves the ceiling pending, and says so", async () => {
  mode.witness = false;
  const out = await mkdtemp(join(tmpdir(), "bitgraph-sdk-tree-complete-"));
  let owner = "";
  try {
    const rec = await run([cliPath, "record", lone, "--out", out, "--again"]);
    assert.equal(rec.code, 0, rec.stderr);
    assert.match(rec.stdout, /recorded · #\d+ · tree of 1 · /);
    assert.match(rec.stdout, /the floor block's header was not fetched; export complete adds it too/);
    owner = (await readdir(out)).map((n) => join(out, n)).find((p) => p.endsWith(".bitgraph.json"))!;
    assert.equal((await readExportFile(owner)).floor, null);
  } finally {
    mode.witness = true;
  }
  const done = await run([cliPath, "export", "complete", owner, "--json"]);
  assert.equal(done.code, 0, done.stderr);
  const d = JSON.parse(done.stdout) as { path: string; changed: boolean; floor: string; ceiling: string; settlement: string; notes: string[] };
  assert.deepEqual({ changed: d.changed, floor: d.floor, ceiling: d.ceiling, settlement: d.settlement }, { changed: true, floor: "present", ceiling: "pending", settlement: "pending" });
  const after = await readExportFile(owner);
  assert.equal(after.floor?.header, floorHeaderHex);
  const v = await verifyExport(after, { bytes: new Uint8Array(await readFile(lone)) });
  assertSound(v, PENDING, "completed");
  const again = await run([cliPath, "export", "complete", owner]);
  assert.match(again.stdout, /nothing new for/);
  assert.match(again.stdout, /Base ceiling {2}pending/);
  // Not an export: refused.
  const bad = await run([cliPath, "export", "complete", lone]);
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /not a bitgraph-export\/1 file/);
});

test("names: relative to the deepest common folder, and safe as paths", () => {
  assert.deepEqual(relativeNames(["/a/b/c.txt"]), ["c.txt"]);
  assert.deepEqual(relativeNames(["/a/b/c.txt", "/a/b/d/e.txt"]), ["c.txt", join("d", "e.txt")]);
  assert.deepEqual(relativeNames(["/x/y.txt", "/z/w.txt"]), [join("x", "y.txt"), join("z", "w.txt")]);
  assert.equal(safeRelativeName("../../etc/passwd", 0), join("etc", "passwd"));
  assert.equal(safeRelativeName("/abs/name\u0001.txt", 0), join("abs", "name .txt"));
  assert.equal(safeRelativeName("", 7), "leaf-7");
  assert.equal(exportBaseName({ counter: "4821", artifactDigest: "abc" }), "bitgraph-4821");
  assert.equal(exportBaseName({ counter: null, artifactDigest: "AbCdEfGhIjKlMn" }), "bitgraph-AbCdEfGhIjKl");
  assert.equal(memberExportFileName("photo.jpg"), "photo.jpg.bitgraph.json");
  assert.equal(parseExport("{}"), null);
});

test("SPEC.md goes beside the exports only when the site serves the exact text the proof pins, and never over another", async () => {
  const bg = new BitGraph({ baseUrl });
  const r = await bg.record([lone], { again: true });
  const pinned = r.made!.proof.attribution?.message;
  assert.equal(createHash("sha256").update(SPEC_TEXT).digest("base64"), pinned, "the repository's SPEC.md is the text the proof pins");
  mode.spec = "pinned";
  try {
    const dir = await mkdtemp(join(tmpdir(), "bitgraph-sdk-tree-spec-"));
    const first = await bg.writeExports(r.made!, dir);
    assert.equal(first.spec, join(dir, "SPEC.md"));
    assert.deepEqual(new Uint8Array(await readFile(first.spec!)), SPEC_TEXT);
    const second = await bg.writeExports(r.made!, dir);
    assert.equal(second.spec, first.spec, "the same text already there is used, not written twice");
    const theirs = await mkdtemp(join(tmpdir(), "bitgraph-sdk-tree-spec-theirs-"));
    await writeFile(join(theirs, "SPEC.md"), "someone else's notes\n");
    const kept = await bg.writeExports(r.made!, theirs);
    assert.notEqual(kept.spec, join(theirs, "SPEC.md"));
    assert.equal(await readFile(join(theirs, "SPEC.md"), "utf8"), "someone else's notes\n", "a different SPEC.md is never replaced");
    assert.deepEqual(new Uint8Array(await readFile(kept.spec!)), SPEC_TEXT);
    mode.spec = "wrong";
    const other = await mkdtemp(join(tmpdir(), "bitgraph-sdk-tree-spec-wrong-"));
    const refused = await bg.writeExports(r.made!, other);
    assert.equal(refused.spec, null, "other text is never shipped under the name SPEC.md");
    assert.deepEqual((await readdir(other)).filter((n) => n.endsWith(".md")), []);
    // The CLI names it.
    mode.spec = "pinned";
    const out = await mkdtemp(join(tmpdir(), "bitgraph-sdk-tree-spec-cli-"));
    const rec = await run([cliPath, "record", lone, "--out", out, "--again"]);
    assert.equal(rec.code, 0, rec.stderr);
    assert.ok(rec.stdout.includes(`the rules this proof pins, beside it: ${join(out, "SPEC.md")}`), rec.stdout);
  } finally {
    mode.spec = "none";
  }
});

test("serve: /record writes the export, /verify reads a file with it, /export-complete fills what the site has", async () => {
  const running = await serve({ port: 0, bitgraph: new BitGraph({ baseUrl }) });
  const post = async (verb: string, body: unknown) => {
    const res = await fetch(`http://127.0.0.1:${running.port}/${verb}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  };
  try {
    const map = (await (await fetch(`http://127.0.0.1:${running.port}/`)).json()) as { verbs: string[] };
    assert.ok(map.verbs.includes("export-complete"));
    const out = await mkdtemp(join(tmpdir(), "bitgraph-sdk-tree-serve-"));
    mode.witness = false;
    let owner = "";
    try {
      const rec = await post("record", { paths: [lone], again: true, exportDir: out });
      assert.equal(rec.status, 200, JSON.stringify(rec.json));
      owner = ((rec.json["made"] as { exports: { owner: string } }).exports.owner);
      assert.ok(owner.startsWith(out));
    } finally {
      mode.witness = true;
    }
    const v = await post("verify", { path: lone, export: owner });
    assert.equal(v.status, 200);
    assert.equal(claim(v.json as never, "bytes.member")?.result, "TRUE");
    assert.equal(claim(v.json as never, "floor.header")?.result, "NOT_CARRIED", "the header was not fetched at make time");
    const done = await post("export-complete", { path: owner });
    assert.equal(done.status, 200);
    assert.deepEqual([done.json["changed"], done.json["floor"], done.json["ceiling"]], [true, "present", "pending"]);
    const again = await post("verify", { path: lone, export: owner });
    assert.equal(claim(again.json as never, "floor.header")?.result, "TRUE");
    const bad = await post("record", { paths: [lone], exports: "everything" });
    assert.equal(bad.status, 400);
    const missing = await post("export-complete", {});
    assert.equal(missing.status, 400);
  } finally {
    await running.close();
  }
});

test("recovery: the tree's entries are written after the make; recording the same files again finds every one and makes nothing", async () => {
  const dir = join(root, "kept");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "one.txt"), "kept one\n");
  await writeFile(join(dir, "two.png"), Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("kept two")]));
  mode.recovery = "on";
  try {
    const bg = new BitGraph({ baseUrl });
    const first = await bg.record(dir);
    const made = first.made!;
    assert.equal(made.count, 2);
    assert.deepEqual(made.recovery, { entries: 4, written: 4, alreadyThere: 0, blocked: 0, pending: 0, reason: null }, "two entries per placed member: under the original and under the committed bytes");
    const commits = requests.filter((p) => p === "/api/fuse/commit").length;

    const again = await bg.record(dir);
    assert.equal(again.made, null, "nothing was made");
    assert.equal(requests.filter((p) => p === "/api/fuse/commit").length, commits, "no commit was sent");
    const was = new Map(first.files.map((f) => [f.path, f]));
    for (const f of again.files) {
      assert.equal(f.outcome, "on record", f.path);
      assert.equal(f.counter, made.counter);
      assert.equal(f.member, was.get(f.path)?.member, "the same leaf");
      assert.equal(f.memberCount, 2);
      assert.equal(f.proofUrl, made.proofUrl, "the tree's own proof page, not a plain-hash lookup");
    }

    // Writing the same tree's entries again finds them all held, by this same member.
    const rewrite = await writeRecoveryEntries({ proof: made.proof as never, rootDocument: Uint8Array.from(Buffer.from(made.rootDocument, "hex")), leavesBytes: Uint8Array.from(Buffer.from(made.leaves, "base64")) }, { baseUrl });
    assert.deepEqual(rewrite, { entries: 4, written: 0, alreadyThere: 4, blocked: 0, pending: 0, reason: null });

    // recovery: false is the plain-hash index alone: the files are new to it, and are made again.
    const opted = await bg.record(dir, { recovery: false });
    assert.notEqual(opted.made, null);
    assert.equal(opted.made!.recovery, null);
  } finally {
    mode.recovery = "absent";
  }
});

test("recovery: a site not taking writes leaves the entries pending and says why; the tree is made all the same", async () => {
  const file = join(root, "pending.txt");
  await writeFile(file, "made while the site takes no recovery writes\n");
  for (const m of ["off", "absent"] as const) {
    mode.recovery = m;
    try {
      const r = await new BitGraph({ baseUrl }).record(file, { again: true });
      assert.equal(r.made?.count, 1);
      assert.equal(r.made?.recovery?.written, 0);
      assert.equal(r.made?.recovery?.pending, 2);
      assert.match(r.made?.recovery?.reason ?? "", /is not taking recovery writes yet/);
    } finally {
      mode.recovery = "absent";
    }
  }
});

test("recovery: an entry whose leaf names a file's digest but not its bytes is not that file's proof; the file is made", async () => {
  // A producer that lies: the leaf says origin = the victim's digest, but its
  // committed digest is built from other bytes. The tree is signed all the
  // same (the enclave never sees leaves), and its entries land under the
  // victim's address.
  const victim = join(root, "victim.txt");
  await writeFile(victim, "the victim's own bytes\n");
  const decoy = join(root, "decoy.png");
  await writeFile(decoy, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("decoy")]));
  const v = await scanFile(victim);
  const d = await scanFile(decoy);
  mode.recovery = "on";
  try {
    const lying = await fuseTreePipeline([{ ...d, digestB64: v.digestB64, originDigest: v.originDigest, name: "victim.txt" }], { baseUrl }, {});
    const w = await writeRecoveryEntries({ proof: lying.proof as never, rootDocument: Uint8Array.from(Buffer.from(lying.rootDocumentHex, "hex")), leavesBytes: Uint8Array.from(Buffer.from(lying.leavesB64, "base64")) }, { baseUrl });
    assert.equal(w.written, 2, "the squatted entries are stored");
    const r = await new BitGraph({ baseUrl }).record(victim);
    assert.notEqual(r.made, null, "the victim's file was made, not taken as on record");
    assert.equal(r.files[0]?.outcome, "recorded");
  } finally {
    mode.recovery = "absent";
  }
});

test("cli: record says whether the files can find their proof again from their bytes alone", async () => {
  const dir = join(root, "cli-kept");
  const out = await mkdtemp(join(tmpdir(), "bitgraph-sdk-cli-kept-"));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "a.txt"), "cli kept a\n");
  mode.recovery = "on";
  try {
    const first = await run([cliPath, "record", dir, "--out", out]);
    assert.equal(first.code, 0, first.stderr);
    assert.match(first.stdout, /^each file finds this proof again from its own bytes \(2 sealed entries kept\)$/m);
    const again = await run([cliPath, "record", dir, "--out", out]);
    assert.match(again.stdout, /^on record · #\d+ · /m, "found through its recovery entry");
    assert.doesNotMatch(again.stdout, /^recorded/m);
    mode.recovery = "off";
    const off = await run([cliPath, "record", dir, "--out", out, "--again"]);
    assert.match(off.stdout, /^not yet recoverable from the files alone: 127\.0\.0\.1:\d+ is not taking recovery writes yet/m);
    const none = await run([cliPath, "record", dir, "--out", out, "--again", "--no-recovery"]);
    assert.doesNotMatch(none.stdout, /recoverable|finds this proof again/);
  } finally {
    mode.recovery = "absent";
  }
});
