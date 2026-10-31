/**
 * bitgraph-block-read/1: the file a block read binds, and the rule that only the chain's own answer about the
 * block's hash counts. The proofs here are unsigned shapes: checkBlockRead reads only the digest and the epoch.
 *
 *   cd packages/verify && npx tsc -p . && node --test dist/__tests__/block-read.test.js
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { blockReadFileText, blockReadDigestB64, parseBlockReadFile, checkBlockRead, type ChainBlock } from "../block-read.js";
import type { BitGraphProof } from "../types.js";

const EPOCH = "KKOixUTETu9LB6jJxX+k+jvLaUZNUSoITPjHfzubqCo=";
const BASE_HASH = "0x" + "ab".repeat(32);
const BTC_HASH = "00000000000000000001" + "cd".repeat(22);

const baseRead = { epochId: EPOCH, chain: "base" as const, chainId: "eip155:8453", number: 37_500_000, hash: BASE_HASH, timestamp: 1_793_404_750 };

function proofOf(text: string, epochId = EPOCH): BitGraphProof {
  return { artifact: { hashAlg: "sha256", digestB64: blockReadDigestB64(text) }, commit: { epochId } } as unknown as BitGraphProof;
}

const onChain = (over: Partial<ChainBlock> = {}): ChainBlock => ({ hash: BASE_HASH, number: baseRead.number, timestamp: baseRead.timestamp, canonical: true, ...over });

test("the file's text is fixed byte for byte", () => {
  const text = blockReadFileText(baseRead);
  assert.equal(text, [
    "{",
    '  "format": "bitgraph-block-read/1",',
    `  "epochId": "${EPOCH}",`,
    '  "chain": "base",',
    '  "chainId": "eip155:8453",',
    '  "number": 37500000,',
    `  "hash": "${BASE_HASH}",`,
    '  "timestamp": 1793404750',
    "}",
    "",
  ].join("\n"));
  assert.equal(blockReadFileText({ ...baseRead, hash: BASE_HASH.toUpperCase().replace("0X", "0x") }), text, "the hash is lowercased");
  assert.deepEqual(parseBlockReadFile(text), { format: "bitgraph-block-read/1", ...baseRead });
});

test("each chain takes its own ids and hash form", () => {
  assert.doesNotThrow(() => blockReadFileText({ ...baseRead, chain: "ethereum", chainId: "eip155:1" }));
  assert.doesNotThrow(() => blockReadFileText({ ...baseRead, chain: "bitcoin", chainId: "bip122:000000000019d6689c085ae165831e93", hash: BTC_HASH }));
  assert.throws(() => blockReadFileText({ ...baseRead, chainId: "eip155:1" }), /chainId/);
  assert.throws(() => blockReadFileText({ ...baseRead, chain: "bitcoin", chainId: "bip122:000000000019d6689c085ae165831e93" }), /hash/);
  assert.throws(() => blockReadFileText({ ...baseRead, chain: "ethereum", chainId: "eip155:1", hash: BTC_HASH }), /hash/);
  assert.throws(() => blockReadFileText({ ...baseRead, chain: "solana" as never }), /unknown chain/);
});

test("the parser is strict", () => {
  const good = JSON.parse(blockReadFileText(baseRead)) as Record<string, unknown>;
  const text = (o: Record<string, unknown>) => JSON.stringify(o);
  assert.equal(parseBlockReadFile("not json"), null);
  assert.equal(parseBlockReadFile(text({ ...good, extra: 1 })), null);
  assert.equal(parseBlockReadFile(text({ ...good, format: "bitgraph-block-read/2" })), null);
  assert.equal(parseBlockReadFile(text({ ...good, number: -1 })), null);
  assert.equal(parseBlockReadFile(text({ ...good, number: 1.5 })), null);
  assert.equal(parseBlockReadFile(text({ ...good, timestamp: "1793404750" })), null);
  assert.equal(parseBlockReadFile(text({ ...good, epochId: "short" })), null);
  assert.equal(parseBlockReadFile(text({ ...good, hash: BASE_HASH.toUpperCase().replace("0X", "0x") })), null, "only lowercase is the chain's form");
});

test("a read the chain confirms takes its number and time from the chain", () => {
  const text = blockReadFileText(baseRead);
  const r = checkBlockRead({ file: text, proof: proofOf(text), chain: onChain() });
  assert.equal(r.ok, true, r.reasons.join("; "));
  assert.deepEqual(r.block, { chain: "base", chainId: "eip155:8453", hash: BASE_HASH, number: 37_500_000, timestamp: 1_793_404_750 });
});

test("without a lookup the read is unconfirmed, never ok", () => {
  const text = blockReadFileText(baseRead);
  const r = checkBlockRead({ file: text, proof: proofOf(text) });
  assert.equal(r.ok, false);
  assert.equal(r.block, null);
  assert.match(r.reasons.join(), /unconfirmed/);
});

test("a hash the chain does not know, or not on its canonical chain, fails", () => {
  const text = blockReadFileText(baseRead);
  assert.match(checkBlockRead({ file: text, proof: proofOf(text), chain: null }).reasons.join(), /does not know/);
  const orphan = checkBlockRead({ file: text, proof: proofOf(text), chain: onChain({ canonical: false }) });
  assert.equal(orphan.ok, false);
  assert.equal(orphan.block, null);
  assert.match(orphan.reasons.join(), /canonical/);
});

test("a file whose number or time disagrees with the chain fails", () => {
  const lyingNumber = blockReadFileText({ ...baseRead, number: baseRead.number + 1 });
  assert.match(checkBlockRead({ file: lyingNumber, proof: proofOf(lyingNumber), chain: onChain() }).reasons.join(), /says block/);
  const lyingTime = blockReadFileText({ ...baseRead, timestamp: baseRead.timestamp - 600 });
  const r = checkBlockRead({ file: lyingTime, proof: proofOf(lyingTime), chain: onChain() });
  assert.equal(r.ok, false);
  assert.match(r.reasons.join(), /says time/);
});

test("the file must be the proof's, in the proof's epoch", () => {
  const text = blockReadFileText(baseRead);
  const other = blockReadFileText({ ...baseRead, number: baseRead.number + 1 });
  assert.match(checkBlockRead({ file: text, proof: proofOf(other), chain: onChain() }).reasons.join(), /does not hash/);
  assert.match(checkBlockRead({ file: text, proof: proofOf(text, "A".repeat(43) + "="), chain: onChain() }).reasons.join(), /epoch/);
  assert.equal(checkBlockRead({ file: "{}", proof: proofOf(text), chain: onChain() }).file, null);
});

test("two epochs reading the same block bind different digests", () => {
  const a = blockReadDigestB64(blockReadFileText(baseRead));
  const b = blockReadDigestB64(blockReadFileText({ ...baseRead, epochId: "A".repeat(43) + "=" }));
  assert.notEqual(a, b);
});
