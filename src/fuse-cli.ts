#!/usr/bin/env node
// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * bitgraph-fuse: the internal harness (spec 9.2), as a command rather than a
 * page. Exercises Forms A, B and C end to end through fuse(), writes the
 * Frame (and the fused bytes when they must be kept), and prints the bounded
 * copy of spec 9.3. `check` runs verifyFuse over a Frame (or bare proof)
 * and a file, so both verification paths can be exercised from a shell.
 *
 * Not a product surface. The site has no /fuse page: a page would make the
 * website build depend on packages that are not published, which is a deploy
 * hazard; this command needs nothing but the repository.
 *
 * The raw nonce is never printed. After commit it is public inside the proof.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { sha256 } from "@noble/hashes/sha256";
import { parseFrame, verifyFuse, bytesToBase64 } from "@mikeargento/bitgraph-verify";
import type { BitGraphProof, PlacementId } from "@mikeargento/bitgraph-verify";
import { fuse, builderFor, FuseError } from "./fuse.js";
import type { FuseTransport } from "./fuse.js";

const USAGE = `bitgraph-fuse: BitGraph producer harness (profile bitgraph-fuse/1, working name)

  bitgraph-fuse fuse <file> --placement trailer/1|container/1 [options]
      Form A or B over an existing file. The file is never modified.
  bitgraph-fuse produce [--origin <file>] [options]
      Form C: a canonical payload naming an optional source.
  bitgraph-fuse check <frame-or-proof.json> <file> [--max-positions N]
      Verify a Frame (or bare proof) against the fused bytes or the original.

Options for fuse and produce:
  --out <dir>            where to write the Frame and fused bytes (default: .)
  --keep                 also write the fused bytes for byte-exact placements
  --base-url <url>       commit surface (default https://bitgraph.ing)
  --allocate-path <p>    default /api/fuse/allocate (parent-direct: /allocate-slot)
  --commit-path <p>      default /api/fuse/commit   (parent-direct: /commit)
  --api-key <key>        Authorization: Bearer <key>

Exit codes: 0 fused/verified, 1 refused or contradicted, 2 undetermined, 64 usage.
`;

/** The bounded copy of spec 9.3, verbatim. */
const COPY_ORIGINAL = "Original recorded\nThese exact original bytes existed no later than the commit.";
const COPY_FUSED = "Fused artifact created\nThese bytes were assembled after their slot allocation and committed at this position.";

interface Args { command: string; positional: string[]; flags: Map<string, string | true> }

function parseArgs(argv: string[]): Args {
  const [command = "", ...rest] = argv;
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith("--") && key !== "keep") { flags.set(key, next); i++; } else flags.set(key, true);
    } else positional.push(a);
  }
  return { command, positional, flags };
}

function sanitize(name: string): string {
  return name.replace(/[\x00-\x1f\x7f/]/g, " ").trim() || "artifact";
}

function transportFrom(flags: Map<string, string | true>): FuseTransport {
  const t: FuseTransport = {};
  const s = (k: string) => { const v = flags.get(k); return typeof v === "string" ? v : undefined; };
  const baseUrl = s("base-url"); if (baseUrl) t.baseUrl = baseUrl;
  const allocatePath = s("allocate-path"); if (allocatePath) t.allocatePath = allocatePath;
  const commitPath = s("commit-path"); if (commitPath) t.commitPath = commitPath;
  const apiKey = s("api-key"); if (apiKey) t.apiKey = apiKey;
  return t;
}

async function writeOutputs(outDir: string, label: string, frame: unknown, fusedName: string | null, fused: Uint8Array | undefined): Promise<string[]> {
  await mkdir(outDir, { recursive: true });
  const written: string[] = [];
  const framePath = join(outDir, `${label}.bitgraph-fuse.json`);
  await writeFile(framePath, JSON.stringify(frame, null, 2) + "\n");
  written.push(framePath);
  if (fused !== undefined && fusedName !== null) {
    const p = join(outDir, fusedName);
    await writeFile(p, fused);
    written.push(p);
  }
  return written;
}

async function runFuse(args: Args): Promise<number> {
  const file = args.positional[0];
  const placement = args.flags.get("placement");
  if (file === undefined || (placement !== "trailer/1" && placement !== "container/1")) { process.stderr.write(USAGE); return 64; }
  const original = new Uint8Array(await readFile(resolve(file)));
  const label = sanitize(basename(file));
  const ext = placement === "trailer/1" ? extname(label) : ".tar";
  const fusedName = `${label.slice(0, label.length - extname(label).length)}.fused${ext}`;
  const keep = args.flags.get("keep") === true;
  const r = await fuse(builderFor(placement as PlacementId, original), { placement: placement as PlacementId, original, fusedFile: fusedName, keepFused: keep, transport: transportFrom(args.flags) });
  const outDir = resolve(typeof args.flags.get("out") === "string" ? (args.flags.get("out") as string) : ".");
  const written = await writeOutputs(outDir, label, r.frame, keep ? fusedName : null, r.fusedBytes);
  report(r.proof, r.verification.category, r.recovered, true);
  process.stdout.write(`\nwrote:\n${written.map((w) => "  " + w).join("\n")}\n`);
  if (!keep) process.stdout.write(`\nThe fused bytes were not kept (${placement} is byte-exact: any verifier rebuilds them from the original and the proof). Pass --keep to write them.\n`);
  return 0;
}

async function runProduce(args: Args): Promise<number> {
  const originPath = args.flags.get("origin");
  const originDigest = typeof originPath === "string" ? sha256(new Uint8Array(await readFile(resolve(originPath)))) : undefined;
  const r = await fuse(builderFor("produced/1"), { placement: "produced/1", ...(originDigest !== undefined ? { originDigest } : {}), fusedFile: "produced.json", transport: transportFrom(args.flags) });
  const outDir = resolve(typeof args.flags.get("out") === "string" ? (args.flags.get("out") as string) : ".");
  const written = await writeOutputs(outDir, "produced", r.frame, "produced.json", r.fusedBytes);
  report(r.proof, r.verification.category, r.recovered, originDigest !== undefined);
  process.stdout.write(`\nwrote:\n${written.map((w) => "  " + w).join("\n")}\n`);
  return 0;
}

function report(proof: BitGraphProof, category: string, recovered: boolean, hasOrigin: boolean): void {
  const c = proof.commit;
  if (hasOrigin) process.stdout.write(COPY_ORIGINAL + "\n\n");
  process.stdout.write(COPY_FUSED + "\n\n");
  process.stdout.write(`verification  ${category}\n`);
  process.stdout.write(`slot          ${c.slotCounter ?? "?"}\n`);
  process.stdout.write(`commit        ${c.counter ?? "?"}\n`);
  process.stdout.write(`epoch         ${c.epochId ?? "?"}\n`);
  process.stdout.write(`artifact      ${proof.artifact.digestB64}\n`);
  if (proof.attribution?.message) process.stdout.write(`origin        ${proof.attribution.message}\n`);
  if (recovered) process.stdout.write(`note          the commit response was lost; the proof was read back by digest and matched on the held slot\n`);
}

async function runCheck(args: Args): Promise<number> {
  const [frameArg, fileArg] = args.positional;
  if (frameArg === undefined || fileArg === undefined) { process.stderr.write(USAGE); return 64; }
  const text = await readFile(resolve(frameArg), "utf8");
  const frame = parseFrame(text);
  let proof: BitGraphProof;
  if (frame !== null) proof = frame.proof;
  else {
    const parsed = JSON.parse(text) as { version?: unknown };
    if (parsed?.version !== "bitgraph/1") { process.stderr.write("not a Frame and not a bitgraph/1 proof\n"); return 64; }
    proof = parsed as unknown as BitGraphProof;
  }
  const bytes = new Uint8Array(await readFile(resolve(fileArg)));
  const max = args.flags.get("max-positions");
  const r = await verifyFuse({ proof, bytes, frame, ...(typeof max === "string" ? { maxPositions: BigInt(max) } : {}) });
  process.stdout.write(`category      ${r.category}\n`);
  process.stdout.write(`proof         ${r.proof.valid ? "valid" : `invalid: ${r.proof.reason ?? ""}`}\n`);
  process.stdout.write(`file digest   ${r.fileDigestB64}\n`);
  process.stdout.write(`artifact      ${r.artifactDigestB64}\n`);
  if (r.originDigestB64) process.stdout.write(`origin        ${r.originDigestB64}\n`);
  if (r.placement) process.stdout.write(`placement     ${r.placement}\n`);
  if (r.span) process.stdout.write(`span          slot ${r.span.slotCounter} to commit ${r.span.commitCounter} (${r.span.positions} positions)\n`);
  if (r.policy.maxPositions !== null) process.stdout.write(`span policy   ${r.policy.spanExceeded ? "EXCEEDED" : "within"} ${r.policy.maxPositions} positions\n`);
  if (r.reason) process.stdout.write(`reason        ${r.reason}\n`);
  for (const s of r.statements) process.stdout.write(`\n${s}\n`);
  process.stdout.write(`\nfloor         computed by the Player from anchors in a bundle (bitgraph-play check); not available here\n`);
  if (r.category === "RECORDED" || r.category === "FUSED_DIRECT" || r.category === "FUSED_FROM_ORIGIN") return r.policy.spanExceeded ? 1 : 0;
  if (r.category === "UNDETERMINED_PLACEMENT" || r.category === "NO_MATCH") return 2;
  return 1;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  try {
    switch (args.command) {
      case "fuse": return await runFuse(args);
      case "produce": return await runProduce(args);
      case "check": return await runCheck(args);
      default: process.stderr.write(USAGE); return 64;
    }
  } catch (err) {
    if (err instanceof FuseError) {
      process.stderr.write(`no fused proof was completed (${err.code}${err.status !== null ? `, ${err.status}` : ""}): ${err.message}\n`);
      return err.code === "tee-restarting" ? 2 : 1;
    }
    process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}

main().then((code) => { process.exitCode = code; });
