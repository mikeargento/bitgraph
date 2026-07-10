// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * Smoke-scale benchmark (Phase 4e): a 2,000-proof protocol-correct chain
 * audited end-to-end under a generous wall-clock ceiling and a sane
 * memory bound.
 *
 * This is the CI-sized companion of packages/audit/scripts/bench-audit.mjs
 * (the full 50,000-proof benchmark, run via `npm run bench` in
 * packages/audit). It exists to catch accidental quadratic regressions in
 * ingest, link resolution, position maps, or report building without long
 * runtimes: at 2,000 proofs an O(N^2) pipeline stage costs millions of
 * extra operations and blows straight through the generous ceiling, while
 * the honest linear pipeline finishes in a few seconds on any hardware.
 * No exact timings are asserted, only sanity bounds; verification is
 * never weakened (every proof carries a real Ed25519 signature and is
 * fully checked at the integrity tier).
 */

import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { buildJsonReport, buildMarkdownReport, computeExitFlags, runAudit } from "@mikeargento/bitgraph-audit";
import {
  healthyPairs,
  makeCounterChain,
  makeTempDir,
  proofJson,
  writeBundleDir,
} from "./audit-fixtures.js";

const PROOF_COUNT = 2_000;
/** Generous: the pipeline runs this in single-digit seconds on 2020s hardware. */
const WALL_CLOCK_CEILING_MS = 180_000;
/** Sanity bound on RSS growth across the audit; quadratic blowups are far larger. */
const RSS_GROWTH_CEILING_BYTES = 1024 * 1024 * 1024;

describe("audit benchmark smoke: 2,000-proof chain under sanity bounds", () => {
  it("audits a 2,000-proof healthy chain cleanly within the ceilings", async () => {
    const dir = await makeTempDir("bitgraph-audit-bench-smoke-");
    try {
      // Generation is untimed setup: real signatures through the real path.
      const chain = await makeCounterChain({
        epochId: "bench-smoke-epoch",
        pairs: healthyPairs(PROOF_COUNT),
        chainId: "bitgraph:main",
        payloadPrefix: "bench-smoke",
      });
      const files: Record<string, string> = {};
      for (let i = 0; i < chain.proofs.length; i++) {
        files[`proofs/proof-${String(i).padStart(6, "0")}.json`] = proofJson(
          chain.proofs[i]!.proof
        );
      }
      await writeBundleDir(dir, files);

      const rssBefore = process.memoryUsage().rss;
      let rssPeak = rssBefore;
      const sampler = setInterval(() => {
        const rss = process.memoryUsage().rss;
        if (rss > rssPeak) rssPeak = rss;
      }, 50);
      sampler.unref();

      const startedAt = process.hrtime.bigint();
      const result = await runAudit(dir);
      const report = buildJsonReport(result);
      const markdown = buildMarkdownReport(result);
      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      clearInterval(sampler);
      const rssAfter = process.memoryUsage().rss;
      if (rssAfter > rssPeak) rssPeak = rssAfter;

      // Correctness at scale: one continuous chain, zero anomalies.
      assert.equal(result.ingest.counts.observed, PROOF_COUNT);
      assert.equal(result.verification.failed, 0);
      assert.equal(result.verification.artifactUnavailable, PROOF_COUNT);
      assert.equal(result.reconstruction.partitions.length, 1);
      assert.equal(result.reconstruction.partitions[0]?.components.length, 1);
      assert.equal(result.anomalies.anomalies.length, 0);
      assert.equal(result.anomalies.divergences.length, 0);
      assert.equal(report.summary.chainIntact, true);
      assert.equal(computeExitFlags(result).code, 0);
      assert.ok(markdown.length > 0);

      // Sanity bounds only; real numbers live in the full 50k benchmark.
      assert.ok(
        elapsedMs < WALL_CLOCK_CEILING_MS,
        `full audit of ${PROOF_COUNT} proofs took ${Math.round(elapsedMs)}ms; ` +
          `ceiling ${WALL_CLOCK_CEILING_MS}ms (likely a quadratic regression)`
      );
      const rssGrowth = rssPeak - rssBefore;
      assert.ok(
        rssGrowth < RSS_GROWTH_CEILING_BYTES,
        `RSS grew ${Math.round(rssGrowth / (1024 * 1024))} MiB during the audit; ` +
          `ceiling ${Math.round(RSS_GROWTH_CEILING_BYTES / (1024 * 1024))} MiB`
      );

      // Leave a breadcrumb in the test log without asserting exact times.
      console.log(
        `[bench-smoke] ${PROOF_COUNT} proofs: audit+reports ${Math.round(elapsedMs)}ms, ` +
          `rss growth ${Math.round(rssGrowth / (1024 * 1024))} MiB`
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
