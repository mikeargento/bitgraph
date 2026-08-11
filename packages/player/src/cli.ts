#!/usr/bin/env node
// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * bitgraph-play <rule.json> <bundle> [--out <file>] [--summary]
 *
 * Evaluates a bitgraph-player/1 rule against a proof bundle (directory,
 * .tar, .tar.gz, or .tgz) and writes the verdict JSON to stdout (or
 * --out). Offline: the audit pipeline and the evaluator make no network
 * requests of any kind.
 *
 * Exit codes: 0 TRUE, 1 FALSE, 2 UNDETERMINED, 3 error.
 * Diagnostics go to stderr; stdout carries verdict bytes only.
 *
 * The process exits by setting process.exitCode and returning, never by
 * process.exit(): exiting early would truncate a verdict still draining
 * to a pipe.
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { runAudit } from "@mikeargento/bitgraph-audit";
import type { AuditResult } from "@mikeargento/bitgraph-audit";
import { resolveCast } from "./cast.js";
import { evaluate } from "./evaluate.js";
import { parseRule, RuleError } from "./rule.js";
import { buildVerdict, serializeVerdict } from "./verdict.js";

function usage(): number {
  process.stderr.write(
    "usage: bitgraph-play <rule.json> <bundle> [--out <file>] [--summary]\n" +
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

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const positional: string[] = [];
  let outFile: string | undefined;
  let summary = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg === "--out") {
      const next = args[++i];
      if (next === undefined || next.startsWith("-")) return usage();
      outFile = next;
    } else if (arg === "--summary") {
      summary = true;
    } else if (arg.startsWith("-")) {
      return usage();
    } else {
      positional.push(arg);
    }
  }
  if (positional.length !== 2) return usage();
  const [rulePath, bundlePath] = positional as [string, string];

  let ruleBytes: Buffer;
  try {
    ruleBytes = readFileSync(rulePath);
  } catch (err) {
    process.stderr.write(`error: cannot read rule file: ${(err as Error).message}\n`);
    return 3;
  }
  const ruleSha256Hex = createHash("sha256").update(ruleBytes).digest("hex");

  let rule;
  try {
    rule = parseRule(ruleBytes.toString("utf8"));
  } catch (err) {
    if (err instanceof RuleError) {
      process.stderr.write("error: invalid rule\n");
      for (const issue of err.issues) process.stderr.write(`  - ${issue}\n`);
    } else {
      process.stderr.write(`error: ${(err as Error).message}\n`);
    }
    return 3;
  }

  let audit: AuditResult;
  try {
    audit = await runAudit(bundlePath);
  } catch (err) {
    process.stderr.write(`error: bundle audit failed: ${(err as Error).message}\n`);
    return 3;
  }

  const resolutions = resolveCast(rule.cast, audit);
  const evaluation = evaluate(rule, resolutions, audit);
  const verdict = buildVerdict(rule, ruleSha256Hex, resolutions, evaluation, audit);
  const bytes = serializeVerdict(verdict);

  if (outFile !== undefined) {
    writeFileSync(outFile, bytes);
  } else {
    process.stdout.write(bytes);
  }
  if (summary) printSummary(audit);

  switch (evaluation.result) {
    case "TRUE":
      return 0;
    case "FALSE":
      return 1;
    case "UNDETERMINED":
      return 2;
  }
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
