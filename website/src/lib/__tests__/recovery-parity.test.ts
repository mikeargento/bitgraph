// The site's recovery module and its Node twin (src/recovery.ts, used by the
// CLI, SDK and MCP) are one format: the same addresses, keys, entry ids and
// plaintext bytes, and each opens what the other sealed. The root suite also
// checks the two sources line for line.
import { describe, test } from "node:test";
import * as assert from "node:assert/strict";
import * as site from "../recovery.ts";
import * as node from "../../../../src/recovery.ts";
import { sha256, utf8, vectorTree } from "./recovery-helpers.ts";

describe("recovery parity: site and Node twin", () => {
  const t = vectorTree();
  const input = { proof: t.proof, rootDocument: t.rootDocument, leavesBytes: t.leavesBytes };

  test("derivations agree for every digest in the vector tree", () => {
    const siteTree = site.recoveryTreeFrom(input);
    const nodeTree = node.recoveryTreeFrom(input);
    assert.deepEqual(Buffer.from(siteTree.proofHash32), Buffer.from(nodeTree.proofHash32));
    for (let i = 0; i < t.count; i++) {
      for (const side of site.recoverySidesOf(siteTree, i)) {
        const d = site.recoveryDigestOf(siteTree, i, side);
        assert.deepEqual(Buffer.from(d), Buffer.from(node.recoveryDigestOf(nodeTree, i, side)));
        assert.equal(site.recoveryAddress(d), node.recoveryAddress(d));
        assert.deepEqual(Buffer.from(site.recoveryKeyBytes(d)), Buffer.from(node.recoveryKeyBytes(d)));
        assert.equal(site.recoveryEntryId(d, siteTree.proofHash32, i), node.recoveryEntryId(d, nodeTree.proofHash32, i));
        assert.equal(site.recoveryObjectKeyFor(siteTree, i, side), node.recoveryObjectKeyFor(nodeTree, i, side));
      }
      const a = site.recoveryPlaintextFor(siteTree, i, t.names[i]);
      const b = node.recoveryPlaintextFor(nodeTree, i, t.names[i]);
      assert.deepEqual(Buffer.from(a.bytes), Buffer.from(b.bytes), `member ${i}: the same plaintext bytes`);
    }
  });

  test("each opens what the other sealed, and both refuse a wrong key or a moved entry", async () => {
    const siteTree = site.recoveryTreeFrom(input);
    const nodeTree = node.recoveryTreeFrom(input);
    for (let i = 0; i < t.count; i++) {
      const fromNode = await node.sealRecoveryMember(nodeTree, i, t.names[i]);
      const fromSite = await site.sealRecoveryMember(siteTree, i, t.names[i]);
      for (const [w, open, expected] of [
        ...fromNode.writes.map((w) => [w, site, fromNode.plaintext] as const),
        ...fromSite.writes.map((w) => [w, node, fromSite.plaintext] as const),
      ]) {
        assert.ok(await open.existingEntryHoldsMember(w.digest, w.objectKey, w.envelope, expected), `member ${i} ${w.side}`);
        assert.equal(await open.openRecoveryEnvelope(open.recoveryKeyBytes(sha256(utf8("another file"))), w.objectKey, w.envelope), null, "a wrong key opens nothing");
        const moved = w.objectKey.slice(0, -1) + (w.objectKey.endsWith("0") ? "1" : "0");
        assert.equal(await open.openRecoveryEnvelope(open.recoveryKeyBytes(w.digest), moved, w.envelope), null, "the key is bound in by the AAD");
      }
    }
  });
});
