/**
 * Regression: computeChainHash must exclude the anchor service's `ethereum`
 * field so that an Ethereum anchor can be resolved as a chain predecessor.
 *
 * Real-data fixture. `anchor-with-ethereum-112758.json` is a live Ethereum
 * anchor (commit 112758) exactly as it ships in an export bundle: it carries a
 * top-level `ethereum` { blockNumber, blockHash } field that the anchor service
 * appended AFTER the enclave signed it. `successor-112760.json` is the next
 * proof on the chain (the BitGraph whitepaper, commit 112760); its
 * `commit.prevB64` was computed by the enclave over the anchor as the enclave
 * saw it — before the `ethereum` field existed.
 *
 * The bug (latent since the anchor service began stamping `ethereum` on
 * 2026-04-01, exposed once the audit tool resolved prevB64 via computeChainHash
 * on 2026-07-10): computeChainHash hashed the whole proof minus only
 * `proofHash`, so the appended `ethereum` field poisoned the hash and no
 * successor's prevB64 could ever match. The anchor "vanished" from the chain
 * even though it was present in the bundle. The fix excludes `ethereum` (and
 * any ledger/service-added field) from the chain hash.
 */

import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { computeChainHash, type BitGraphProof } from "@mikeargento/bitgraph-verify";

function loadFixture(name: string): Record<string, unknown> {
  const url = new URL(`../../src/__tests__/real-fixtures/${name}`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), "utf8"));
}

describe("computeChainHash: Ethereum anchor chain link (ethereum-field regression)", () => {
  const anchor = loadFixture("anchor-with-ethereum-112758.json");
  const successor = loadFixture("successor-112760.json");
  const expectedPrev = (successor.commit as { prevB64: string }).prevB64;

  it("the fixture is the real shape: anchor carries a top-level ethereum field", () => {
    assert.ok(Object.prototype.hasOwnProperty.call(anchor, "ethereum"));
    assert.equal((anchor.commit as { counter: string }).counter, "112758");
    assert.equal((successor.commit as { counter: string }).counter, "112760");
  });

  it("resolves the successor's prevB64 to the anchor, as exported (with ethereum)", () => {
    // The whole point: the anchor is exported WITH the ethereum field, and its
    // chain hash must still equal the successor's prevB64.
    assert.equal(computeChainHash(anchor as unknown as BitGraphProof), expectedPrev);
  });

  it("ignores the ethereum field entirely (with === without)", () => {
    const withoutEth: Record<string, unknown> = { ...anchor };
    delete withoutEth.ethereum;
    assert.equal(
      computeChainHash(anchor as unknown as BitGraphProof),
      computeChainHash(withoutEth as unknown as BitGraphProof)
    );
  });

  it("also ignores the ledger-added proofHash field (with === without)", () => {
    const withoutHash: Record<string, unknown> = { ...anchor };
    delete withoutHash.proofHash;
    assert.equal(
      computeChainHash(anchor as unknown as BitGraphProof),
      computeChainHash(withoutHash as unknown as BitGraphProof)
    );
  });
});
