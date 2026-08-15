#!/usr/bin/env node
// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * bitgraph-play <rule.json> <bundle> [--out <file>] [--summary]
 * bitgraph-play init <file>... [--out <rule.json>]
 * bitgraph-play check <bundle-or-file>... [--json] [--out <file>]
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
 * Check: reads a bundle (a directory or archive, or a list of files such
 * as a proof.json and the file it records) and reports, in the three
 * values, what the bundle establishes about each recording it holds and
 * what bounds it. Human text on stdout by default; --json for the
 * bitgraph-check/1 report. Offline. See check.ts for the vocabulary.
 *
 * Exit codes: 0 TRUE, 1 FALSE, 2 UNDETERMINED, 3 error (init: 0 or 3).
 * Diagnostics go to stderr; stdout carries the verdict (or skeleton, or
 * check report) bytes only.
 *
 * The process exits by setting process.exitCode and returning, never by
 * process.exit(): exiting early would truncate output still draining to
 * a pipe.
 */

import { createHash } from "node:crypto";
import { createReadStream, existsSync, writeFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import { pipeline } from "node:stream/promises";
import type { AuditResult, BundleEntrySource } from "@mikeargento/bitgraph-audit";
import { ingestBundle, ingestEntries } from "@mikeargento/bitgraph-audit";
import { checkIngest, renderCheckText, serializeCheckReport } from "./check.js";
import { scaffoldRule } from "./init.js";
import type { ScaffoldEntry } from "./init.js";
import { play, PlayError } from "./play.js";
import { RuleError } from "./rule.js";

function usage(): number {
  process.stderr.write(
    "usage: bitgraph-play <rule.json> <bundle> [--out <file>] [--summary]\n" +
      "       bitgraph-play init <file>... [--out <rule.json>]\n" +
      "       bitgraph-play check <bundle-or-file>... [--json] [--out <file>]\n" +
      '  "--" ends option parsing; a rule file literally named "init" or\n' +
      '  "check" is evaluated with: bitgraph-play -- init <bundle>\n' +
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
  json: boolean;
}

function parseArgs(args: string[]): ParsedArgs | undefined {
  const parsed: ParsedArgs = { positional: [], summary: false, json: false };
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
    } else if (arg === "--json") {
      parsed.json = true;
    } else if (arg.startsWith("-")) {
      return undefined;
    } else {
      parsed.positional.push(arg);
    }
  }
  return parsed;
}

/**
 * check: one directory or archive path is ingested as a bundle; any other
 * argument list (one or more plain files, or several paths) is ingested
 * in memory as a flat set of entries named by their basenames, so
 * `bitgraph-play check proof.json photo.jpg` works without a folder.
 */
async function runCheck(args: ParsedArgs): Promise<number> {
  if (args.summary) return usage();
  const targets = args.positional;
  if (targets.length === 0) return usage();

  let ingest;
  try {
    const single = targets.length === 1 ? await stat(targets[0] as string) : undefined;
    if (single !== undefined && (single.isDirectory() || looksLikeArchive(targets[0] as string))) {
      ingest = await ingestBundle(targets[0] as string);
    } else {
      const entries: BundleEntrySource[] = [];
      for (const target of targets) {
        const info = await stat(target);
        if (info.isDirectory()) {
          // A directory among several arguments: ingest it as its own
          // bundle would be ambiguous, so refuse plainly.
          process.stderr.write(`error: ${target} is a directory; pass one bundle path, or a list of files\n`);
          return 3;
        }
        entries.push({ path: basename(target), open: () => readFile(target).then((b) => new Uint8Array(b)) });
      }
      ingest = await ingestEntries(entries);
    }
  } catch (err) {
    process.stderr.write(`error: cannot read bundle: ${(err as Error).message}\n`);
    return 3;
  }

  const report = await checkIngest(ingest);
  const bytes = args.json ? serializeCheckReport(report) : renderCheckText(report);
  if (args.outFile !== undefined) {
    writeFileSync(args.outFile, bytes);
  } else {
    process.stdout.write(bytes);
  }
  return report.result === "TRUE" ? 0 : report.result === "FALSE" ? 1 : 2;
}

function looksLikeArchive(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith(".tar") || lower.endsWith(".tar.gz") || lower.endsWith(".tgz");
}

async function runInit(args: ParsedArgs): Promise<number> {
  if (args.summary || args.json) return usage();
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
  if (args.json || args.positional.length !== 2) return usage();
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
  // "init" or "check" is reachable as `bitgraph-play -- init <bundle>`.
  const subcommand = argv[0] === "init" || argv[0] === "check" ? argv[0] : undefined;
  if (subcommand !== undefined && existsSync(subcommand)) {
    // Both readings are plausible here; a silent pick would hand a
    // 0.1.1 caller a skeleton with exit 0 where the published contract
    // returned a verdict. Refuse loudly instead.
    process.stderr.write(
      `error: a file named "${subcommand}" exists here, so this command is ambiguous.\n` +
        `  to evaluate it as a rule:  bitgraph-play -- ${subcommand} <bundle>  (or ./${subcommand})\n` +
        `  to run the ${subcommand} subcommand: rename that file or run from another directory\n`
    );
    return 3;
  }
  const parsed = parseArgs(subcommand !== undefined ? argv.slice(1) : argv);
  if (parsed === undefined) return usage();
  if (subcommand === "init") return runInit(parsed);
  if (subcommand === "check") return runCheck(parsed);
  return runEvaluate(parsed);
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
