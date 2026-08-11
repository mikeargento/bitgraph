#!/usr/bin/env node
// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * bitgraph-play <rule.json> <bundle> [--out <file>] [--summary]
 * bitgraph-play init <file>... [--out <rule.json>]
 *
 * Evaluate: runs a bitgraph-player/1 rule against a proof bundle
 * (directory, .tar, .tar.gz, or .tgz) and writes the verdict JSON to
 * stdout (or --out). Offline: the audit pipeline and the evaluator make
 * no network requests of any kind.
 *
 * Init: hashes the given files and emits a rule skeleton with the cast
 * filled in. The skeleton does not run as written: requires.ordering is
 * a placeholder the author must replace — the trust floor has no
 * default, and the scaffolder must not choose it either.
 *
 * Exit codes: 0 TRUE, 1 FALSE, 2 UNDETERMINED, 3 error (init: 0 or 3).
 * Diagnostics go to stderr; stdout carries the verdict (or skeleton)
 * bytes only.
 *
 * The process exits by setting process.exitCode and returning, never by
 * process.exit(): exiting early would truncate output still draining to
 * a pipe.
 */

import { createHash } from "node:crypto";
import { createReadStream, existsSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { pipeline } from "node:stream/promises";
import type { AuditResult } from "@mikeargento/bitgraph-audit";
import { scaffoldRule } from "./init.js";
import type { ScaffoldEntry } from "./init.js";
import { play, PlayError } from "./play.js";
import { RuleError } from "./rule.js";

function usage(): number {
  process.stderr.write(
    "usage: bitgraph-play <rule.json> <bundle> [--out <file>] [--summary]\n" +
      "       bitgraph-play init <file>... [--out <rule.json>]\n" +
      '  "--" ends option parsing; a rule file literally named "init" is\n' +
      "  evaluated with: bitgraph-play -- init <bundle>\n" +
      "  exit codes: 0 TRUE, 1 FALSE, 2 UNDETERMINED, 3 error\n"
  );
  return 3;
}

function printSummary(audit: AuditResult): void {
  const lines: string[] = [];
  const c = audit.ingest.counts;
  lines.push(
    `bundle: ${c.observed} observed proof(s), ${c.artifacts} artifact(s), ${c.witnesses} witness file(s)`
  );
  for (const partition of audit.reconstruction.partitions) {
    const key = partition.key;
    lines.push(
      `partition epoch=${key.epochId ?? "(none)"} chain=${key.chainId} key=${key.publicKeyB64.slice(0, 12)}…: ` +
        `${partition.memberProofHashes.length} proof(s) in ${partition.components.length} component(s)`
    );
  }
  const rel = audit.reconstruction.epochRelationships;
  lines.push(
    `epochs: ${rel.epochs.length} observed, ${rel.orderedPairs.length} lineage-ordered pair(s), ` +
      `${audit.temporal.anchorOrderedPairs.length} anchor-ordered pair(s)`
  );
  lines.push(
    `unchained: ${audit.reconstruction.unchainedProofHashes.length}, unpartitioned: ${audit.reconstruction.unpartitionedProofHashes.length}`
  );
  process.stderr.write(lines.join("\n") + "\n");
}

async function sha256HexOfFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

interface ParsedArgs {
  positional: string[];
  outFile?: string;
  summary: boolean;
}

function parseArgs(args: string[]): ParsedArgs | undefined {
  const parsed: ParsedArgs = { positional: [], summary: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg === "--") {
      // End of options: everything after is positional, dashes and all.
      parsed.positional.push(...args.slice(i + 1));
      break;
    } else if (arg === "--out") {
      const next = args[++i];
      if (next === undefined || next.startsWith("-")) return undefined;
      parsed.outFile = next;
    } else if (arg === "--summary") {
      parsed.summary = true;
    } else if (arg.startsWith("-")) {
      return undefined;
    } else {
      parsed.positional.push(arg);
    }
  }
  return parsed;
}

async function runInit(args: ParsedArgs): Promise<number> {
  if (args.summary) return usage();
  const files = args.positional;
  if (files.length === 0) return usage();
  if (args.outFile !== undefined && existsSync(args.outFile)) {
    process.stderr.write(
      `error: refusing to overwrite existing file: ${args.outFile}\n`
    );
    return 3;
  }

  const entries: ScaffoldEntry[] = [];
  for (const file of files) {
    let sha256Hex: string;
    try {
      sha256Hex = await sha256HexOfFile(file);
    } catch (err) {
      process.stderr.write(`error: cannot hash ${file}: ${(err as Error).message}\n`);
      return 3;
    }
    // Platform-correct basename here, at the boundary: scaffoldRule
    // itself splits only on "/" so its output is machine-independent.
    entries.push({ name: basename(file), sha256Hex });
    process.stderr.write(`  sha256:${sha256Hex}  ${file}\n`);
  }

  const skeleton = scaffoldRule(entries);
  if (args.outFile !== undefined) {
    // Exclusive write: the pre-hash existsSync is only a fast-fail, and
    // hashing is unbounded in duration, so the refusal must hold at the
    // write itself or a file created mid-hash is silently clobbered.
    try {
      writeFileSync(args.outFile, skeleton, { flag: "wx" });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") {
        process.stderr.write(
          `error: refusing to overwrite existing file: ${args.outFile}\n`
        );
        return 3;
      }
      throw err;
    }
    process.stderr.write(`wrote ${args.outFile}\n`);
  } else {
    process.stdout.write(skeleton);
  }
  process.stderr.write(
    "\nnext steps:\n" +
      '  1. set requires.ordering — "hash-linked" accepts only hash-link evidence;\n' +
      '     "assumption-dependent" also accepts counter and anchor evidence\n' +
      "  2. say what each digest means; refine the claim (before / after / between / not)\n" +
      "  3. bitgraph-play <rule.json> <bundle>\n"
  );
  return 0;
}

async function runEvaluate(args: ParsedArgs): Promise<number> {
  if (args.positional.length !== 2) return usage();
  const [rulePath, bundlePath] = args.positional as [string, string];

  let result;
  try {
    result = await play(rulePath, bundlePath);
  } catch (err) {
    if (err instanceof RuleError) {
      process.stderr.write("error: invalid rule\n");
      for (const issue of err.issues) process.stderr.write(`  - ${issue}\n`);
    } else if (err instanceof PlayError) {
      process.stderr.write(`error: ${err.message}\n`);
    } else {
      process.stderr.write(`error: ${(err as Error).message}\n`);
    }
    return 3;
  }

  if (args.outFile !== undefined) {
    writeFileSync(args.outFile, result.bytes);
  } else {
    process.stdout.write(result.bytes);
  }
  if (args.summary) printSummary(result.audit);
  return result.exitCode;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  // "--" as the first token forces evaluate mode: parseArgs treats
  // everything after it as positional, so a rule file literally named
  // "init" is reachable as `bitgraph-play -- init <bundle>`.
  const isInit = argv[0] === "init";
  if (isInit && existsSync("init")) {
    // Both readings are plausible here; a silent pick would hand a
    // 0.1.1 caller a skeleton with exit 0 where the published contract
    // returned a verdict. Refuse loudly instead.
    process.stderr.write(
      'error: a file named "init" exists here, so this command is ambiguous.\n' +
        '  to evaluate it as a rule:  bitgraph-play -- init <bundle>  (or ./init)\n' +
        "  to scaffold a rule: rename that file or run from another directory\n"
    );
    return 3;
  }
  const parsed = parseArgs(isInit ? argv.slice(1) : argv);
  if (parsed === undefined) return usage();
  return isInit ? runInit(parsed) : runEvaluate(parsed);
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    process.stderr.write(`error: ${(err as Error).message}\n`);
    process.exitCode = 3;
  }
);
