/**
 * Ceilings in time (bitgraph-ceiling/1) through the audit, on the first real
 * Base write (2026-09-29, Base block 51,967,531, 46 records): record #14,092's
 * proof and the ceiling file the writer published for it. Offline only.
 */

import { describe, it, before, after } from "node:test";
import * as assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAudit, computeExitFlags } from "@mikeargento/bitgraph-audit";

async function fixture(name: string): Promise<string> {
  return readFile(new URL(`../../src/__tests__/real-fixtures/${name}`, import.meta.url), "utf8");
}

describe("audit: ceilings in time on Base (real first write)", () => {
  let dir: string;
  let proof: string;
  let ceiling: string;
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "audit-ceiling-"));
    proof = await fixture("ceiling-proof-14092.json");
    ceiling = await fixture("ceiling-14092.json");
  });
  after(async () => { await rm(dir, { recursive: true, force: true }); });

  const bundle = async (name: string, ceilingText: string, withProof = true): Promise<string> => {
    const b = join(dir, name);
    await mkdir(join(b, "base-ceiling"), { recursive: true });
    if (withProof) await writeFile(join(b, "proof.json"), proof);
    await writeFile(join(b, "base-ceiling", "ceiling.json"), ceilingText);
    return b;
  };

  it("verifies offline, reports the 50 s window, and says the header was not checked online", async () => {
    const r = await runAudit(await bundle("ok", ceiling));
    const c = r.ceilings!.checks[0]!;
    assert.equal(c.status, "verified", c.reason);
    assert.equal(c.window!.ceilingBlock, 51967531);
    assert.equal(c.window!.widthSeconds, 50);
    assert.equal(c.onChain, null);
    assert.equal(r.ingest.artifacts.length, 0, "a ceiling file is never a candidate artifact");
    assert.equal(computeExitFlags(r).code, 0);
  });

  it("a moved block time fails and sets exit bit 2", async () => {
    const s = JSON.parse(ceiling);
    s.anchor.blockTimestamp -= 120;
    const r = await runAudit(await bundle("moved", JSON.stringify(s)));
    assert.equal(r.ceilings!.checks[0]!.status, "failed");
    assert.equal(computeExitFlags(r).code & 2, 2);
  });

  it("a different writer is refused", async () => {
    const r = await runAudit(await bundle("writer", ceiling), { ceilings: { writer: "0x1E409adA667cdFaC3b6aadFc4165d199870039d5" } });
    assert.equal(r.ceilings!.checks[0]!.status, "failed");
    assert.match(r.ceilings!.checks[0]!.reason!, /^sender:/);
  });

  it("a ceiling without its proof is unmatched, not failed", async () => {
    const r = await runAudit(await bundle("alone", ceiling, false));
    assert.equal(r.ceilings!.checks[0]!.status, "unmatched");
    assert.equal(computeExitFlags(r).code, 0);
  });

  it("a status note is reported and never an artifact", async () => {
    const b = join(dir, "status");
    await mkdir(join(b, "base-ceiling"), { recursive: true });
    await writeFile(join(b, "proof.json"), proof);
    await writeFile(join(b, "base-ceiling", "ceiling-status.json"), JSON.stringify({ version: "bitgraph-ceiling-status/1", status: "none-found", note: "n" }));
    const r = await runAudit(b);
    assert.equal(r.ceilings!.statuses.length, 1);
    assert.equal(r.ingest.artifacts.length, 0);
  });
});
