// Copyright (c) 2024-2026 Argento Computing Inc.

/**
 * bitgraph-carrier/4 through the CLI: a tree member's BitGraphed file unpacks
 * as the member and its own bitgraph-export/1 (never as a bare proof.json,
 * whose digest names the tree's root document and no file), so the audit
 * checks it with verifyExport beside the file, the way every tree member
 * travels. The tree is signed here with a throwaway key over the v10
 * harness's saved Base floor block; it carries no AWS attestation, so the
 * export's attestation claim is FALSE by design and the test reads the tree
 * claims, which must all hold.
 *
 * Run, after `npm run build` in packages/audit:
 *   node --test packages/audit/src/__tests__/carrier-tree.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, writeFile, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { getPublicKeyAsync, signAsync } from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import {
  assembleCarrierV4Payload, buildCarrier, buildSignedBody, buildTree, buildTreeMemberEvidence, buildTreeRootDocument, bytesToHex, canonicalize,
  canonicalSlotBody, computeSlotCommitment3, currentTreeSpecHash, leafFor, treeAttribution, type BitGraphProof,
} from "@mikeargento/bitgraph-verify";

const here = dirname(fileURLToPath(import.meta.url));
const FIX = join(here, "../../../../src/__tests__/fuse3-fixtures");
const CLI = join(here, "../../dist/cli.js");
const HEADER = readFileSync(join(FIX, "floor-base-52271417.rlp.hex"), "utf8").trim();
const b64 = (u: Uint8Array): string => Buffer.from(u).toString("base64");
const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

test("a tree member's file is audited as the member and its own export; the tree claims hold", async () => {
  const priv = sha256(utf8("carrier-v4 audit test key (TEST ONLY)"));
  const pub = b64(await getPublicKeyAsync(priv));
  const slotBody = { version: "bitgraph/slot/1" as const, nonceB64: b64(sha256(utf8("audit v4 nonce"))), counter: "61", epochId: b64(new Uint8Array(32).fill(5)), publicKeyB64: pub, chainId: "bitgraph:main" };
  const slot = { ...slotBody, signatureB64: b64(await signAsync(canonicalize(slotBody as never), priv)) };
  const slotFloor = JSON.parse(readFileSync(join(FIX, "trailer3.proof.json"), "utf8")).commit.slotFloor as Record<string, unknown>;
  const commitment = computeSlotCommitment3(slot as never, String(slotFloor["blockHash"]));
  const placed = leafFor(0x01, utf8("a placed member, audited from its BitGraphed file\n"), commitment);
  const other = leafFor(0x00, utf8("the other member, kept as is\n"), commitment);
  const built = buildTree([placed.leaf, other.leaf]);
  const rootDocument = buildTreeRootDocument(commitment, 2, built.root);
  const proof = {
    version: "bitgraph/1",
    artifact: { hashAlg: "sha256", digestB64: b64(sha256(rootDocument)) },
    commit: { nonceB64: slot.nonceB64, counter: "63", epochId: slot.epochId, slotCounter: slot.counter, slotHashB64: b64(sha256(canonicalize(canonicalSlotBody(slot as never) as never))), slotFloor, chainId: "bitgraph:main" },
    signer: { publicKeyB64: pub, signatureB64: "" },
    environment: { enforcement: "stub", measurement: "test-measurement-tree" },
    slotAllocation: slot,
    attribution: treeAttribution(currentTreeSpecHash(3)),
  } as unknown as BitGraphProof;
  proof.signer.signatureB64 = b64(await signAsync(canonicalize(buildSignedBody(proof) as never), priv));
  const i = built.sorted.findIndex((l) => bytesToHex(l.artifact) === bytesToHex(placed.leaf.artifact));
  const payload = assembleCarrierV4Payload({
    proof: proof as never,
    floor: { status: "present", basis: "base-header", header: HEADER },
    ceilingInTime: { status: "unfetched" },
    tree: { rootDocument: bytesToHex(rootDocument), member: buildTreeMemberEvidence(built.sorted[i]!, i, 2, built.tree.path(i)) },
  });
  const dir = await mkdtemp(join(tmpdir(), "audit-carrier-v4-"));
  const file = join(dir, "member.bitgraph.txt");
  await writeFile(file, buildCarrier(placed.committed, payload));
  const out = join(dir, "out");
  const run = spawnSync(process.execPath, [CLI, file, "--out", out, "--format", "json"], { encoding: "utf8" });
  assert.ok([0, 1, 2, 3].includes(run.status ?? -1), `ran (${run.status}): ${run.stderr}`);
  assert.match(run.stdout, /^carrier: UNDETERMINED/m, "no attestation: the image is not established, nothing contradicts the file");
  assert.match(run.stdout, new RegExp(`tree member: +leaf ${i} of 2 \\(trailer/1\\)`));
  assert.match(run.stdout, /no earlier than: Base block 52271417/);
  assert.match(run.stdout, /^export (TRUE|FALSE|UNDETERMINED) .*member\.txt\.bitgraph\.json/m, run.stdout);
  const report = JSON.parse(await readFile(join(out, "audit-report.json"), "utf8"));
  assert.equal(report.summary.exports.files, 1);
  assert.equal(report.summary.exports.coveredFilesChecked, 1, "the export was checked with the member's bytes");
  const check = report.exports.checks[0];
  assert.equal(check.kind, "member");
  assert.match(check.path, /member\.txt\.bitgraph\.json$/);
  assert.ok((check.failedClaims as string[]).every((c) => c.startsWith("attestation.")), `only the absent attestation fails: ${check.failedClaims.join(", ")}`);
  const result = (id: string) => (check.claims as Array<{ id: string; result: string }>).find((c) => c.id === id)?.result;
  for (const id of ["spec.pin", "tree.root", "tree.member", "bytes.member", "floor.record", "floor.content", "floor.header", "proof.signature"]) assert.equal(result(id), "TRUE", id);
  assert.equal(check.times.floor.blockNumber, 52271417);
  assert.equal(report.summary.failed, 0, "no bare proof was audited against bytes it does not name");
  const unpacked = await readdir(dirname(file));
  assert.ok(unpacked.includes("member.bitgraph.txt"));
  // A member placed in a container is a tar, and its file is named as one: the carrier's tail decides, not the extension.
  const asTar = join(dir, "member.txt.bitgraph.tar");
  await writeFile(asTar, buildCarrier(placed.committed, payload));
  const tarRun = spawnSync(process.execPath, [CLI, asTar, "--out", join(dir, "out-tar"), "--format", "json"], { encoding: "utf8" });
  assert.match(tarRun.stdout, /^carrier: UNDETERMINED/m, tarRun.stdout + tarRun.stderr);
  assert.match(tarRun.stdout, /tree member: +leaf/);
});
