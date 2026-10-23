// Enclave v7: authenticated Ethereum anchors and the allocation-time floor.
// Run: node --import tsx/esm anchor-v7.mts
//
// The harness swaps the enclave's baked anchor-service public key for a key
// generated here (HARNESS_ANCHOR_PUBKEY_B64), so this driver can play the
// anchor service: sign claims, send them through the parent, and check what
// the enclave signs into commit.anchor / commit.slotAnchor. Negative cases
// prove the enclave refuses every wrong claim. The last block verifies v7
// proofs with the PUBLISHED verify 1.7.0 (old verifier, new proof).
import { startStack, post, randomDigestB64 } from "./lib.mts";
import { strict as assert } from "node:assert";
import { getPublicKeyAsync, signAsync, utils } from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import { verifyProofIntegrity } from "../../../packages/verify/dist/index.js";

const OLD_VERIFY = process.env["OLD_VERIFY_DIR"]; // e.g. <scratch>/old-verify/node_modules/@mikeargento/bitgraph-verify

const utf8 = (s: string) => new TextEncoder().encode(s);
const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");

const seed = utils.randomPrivateKey();
const pub = await getPublicKeyAsync(seed);
const otherSeed = utils.randomPrivateKey();
process.env["HARNESS_ANCHOR_PUBKEY_B64"] = b64(pub);

const stack = await startStack({ quiet: true, parentEnv: { FUSE_ENABLED: "true" } });
const U = stack.parentUrl;
const CHAIN = "bitgraph:main";
let pass = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => {
  if (!cond) { console.error("FAIL", name, detail === undefined ? "" : JSON.stringify(detail).slice(0, 600)); process.exitCode = 1; }
  else { pass++; console.log("ok  ", name); }
};

const blockHashFor = (n: number) => "0x" + Buffer.from(sha256(utf8(`harness-block-${n}`))).toString("hex");
const digestOf = (blockHash: string) => b64(sha256(utf8(blockHash)));

interface ClaimOpts { blockHash?: string; epochId?: string; chainId?: string; prefix?: string; seed?: Uint8Array; sentBlockNumber?: number }
async function claim(n: number, epochId: string, o: ClaimOpts = {}) {
  const blockHash = o.blockHash ?? blockHashFor(n);
  const msg = `${o.prefix ?? "bitgraph-anchor/1"}\n${o.epochId ?? epochId}\n${o.chainId ?? CHAIN}\n${n}\n${blockHash}`;
  const sig = await signAsync(utf8(msg), o.seed ?? seed);
  return { blockNumber: o.sentBlockNumber ?? n, blockHash, signatureB64: b64(sig) };
}

async function anchorCommit(n: number, epochId: string, o: ClaimOpts & { digestB64?: string; omitAnchor?: boolean; chainIdBody?: string; slotId?: string } = {}) {
  const c = await claim(n, epochId, o);
  const body: Record<string, unknown> = {
    digests: [{ digestB64: o.digestB64 ?? digestOf(c.blockHash), hashAlg: "sha256" }],
    chainId: o.chainIdBody ?? CHAIN,
    attribution: { name: "Ethereum Anchor", message: c.blockHash, title: `https://etherscan.io/block/${n}` },
  };
  if (!o.omitAnchor) body["anchor"] = c;
  if (o.slotId) body["slotId"] = o.slotId;
  return post(`${U}/commit`, body);
}

const plain = (extra: Record<string, unknown> = {}) =>
  post(`${U}/commit`, { digests: [{ digestB64: randomDigestB64(), hashAlg: "sha256" }], chainId: CHAIN, ...extra });
const proofOf = (r: { json: any }) => (Array.isArray(r.json) ? r.json[0] : r.json?.proofs?.[0] ?? r.json);
const errOf = (r: { json: any }) => JSON.stringify(r.json);

try {
  const { epochId } = (await (await fetch(`${U}/key`)).json()) as { epochId: string };
  assert.ok(epochId);

  // 1. Before any anchor, a proof on an UNANCHORED chain carries neither field.
  //    (On the anchored chain, v8's floor gate refuses this commit outright;
  //    anchor-v8.mts is where that is tested.)
  const p1 = proofOf(await plain({ chainId: "bitgraph:test" }));
  ok("proof on an unanchored chain has no slotAnchor", p1?.commit && !("slotAnchor" in p1.commit) && !("anchor" in p1.commit), p1?.commit);

  // 3. The reserved name without a claim is refused.
  const r3 = await anchorCommit(100, epochId, { omitAnchor: true });
  ok("reserved attribution name without a claim is refused", r3.status !== 200 && /reserved/.test(errOf(r3)), { status: r3.status, body: r3.json });

  // 4. A valid claim: the enclave signs commit.anchor.
  const r4 = await anchorCommit(100, epochId);
  const a100 = proofOf(r4);
  ok("valid anchor claim is 200", r4.status === 200, r4.json);
  ok("commit.anchor carries the block", a100?.commit?.anchor?.blockNumber === 100 && a100?.commit?.anchor?.blockHash === blockHashFor(100), a100?.commit);
  ok("the first anchor stands on no floor", !("slotAnchor" in (a100?.commit ?? {})), a100?.commit);
  ok("attribution kept on the anchor proof", a100?.attribution?.name === "Ethereum Anchor", a100?.attribution);
  const v4 = await verifyProofIntegrity({ proof: a100 });
  ok("anchor proof verifies (workspace verify)", v4.valid === true, v4);

  // 4b. A slot allocated NOW, while anchor 100 is the latest, to prove later that
  //     the floor is fixed at allocation and not at commit.
  const held = await post(`${U}/allocate-slot`, { chainId: CHAIN });
  ok("slot allocated while anchor 100 is the latest", held.status === 200 && typeof held.json?.slotId === "string", held.json);

  // 5. Every slot allocated from now on carries that anchor as its floor.
  const p5 = proofOf(await plain());
  ok("ordinary proof after the anchor carries slotAnchor", p5?.commit?.slotAnchor?.blockNumber === 100 && p5?.commit?.slotAnchor?.blockHash === blockHashFor(100), p5?.commit);
  ok("slotAnchor.counter is the anchor proof's counter", p5?.commit?.slotAnchor?.counter === a100?.commit?.counter, { slotAnchor: p5?.commit?.slotAnchor, anchorCounter: a100?.commit?.counter });
  const v5 = await verifyProofIntegrity({ proof: p5 });
  ok("floored proof verifies (workspace verify)", v5.valid === true, v5);

  // 6. A second anchor lands, and only THEN is the held slot spent. Its floor is
  //    still anchor 100, the latest at the moment it was allocated.
  const rMid = await anchorCommit(101, epochId);
  ok("a second anchor lands while the slot is held", rMid.status === 200, rMid.json);
  const r6 = await post(`${U}/commit`, { digests: [{ digestB64: randomDigestB64(), hashAlg: "sha256" }], slotId: held.json.slotId });
  const p6 = proofOf(r6);
  ok("held slot commits", r6.status === 200, r6.json);
  ok("floor is fixed at allocation, not at commit", p6?.commit?.slotAnchor?.blockNumber === 100, p6?.commit?.slotAnchor);

  // 7. Negative claims: each refused, and the floor stays at block 100.
  const neg: Array<[string, Promise<{ status: number; json: any }>, RegExp]> = [
    ["replayed block 101", anchorCommit(101, epochId), /advance/],
    ["block 99 goes backwards", anchorCommit(99, epochId), /advance/],
    ["signed by another key", anchorCommit(102, epochId, { seed: otherSeed }), /signature/],
    ["signed for another epoch", anchorCommit(102, epochId, { epochId: "not-this-epoch" }), /signature/],
    ["signed for another chain", anchorCommit(102, epochId, { chainId: "bitgraph:test" }), /signature/],
    ["blockNumber altered after signing", anchorCommit(102, epochId, { sentBlockNumber: 103 }), /signature/],
    ["digest is not SHA-256 of the block hash", anchorCommit(102, epochId, { digestB64: randomDigestB64() }), /SHA-256 of the block hash/],
    ["uppercase block hash", anchorCommit(102, epochId, { blockHash: blockHashFor(102).toUpperCase().replace("0X", "0x") }), /lowercase/],
    ["wrong message prefix", anchorCommit(102, epochId, { prefix: "bitgraph-anchor/0" }), /signature/],
  ];
  for (const [name, p, re] of neg) {
    const r = await p;
    ok(`refused: ${name}`, r.status !== 200 && re.test(errOf(r)), { status: r.status, body: r.json });
  }
  const p7 = proofOf(await plain());
  ok("floor still block 101 after the refused claims", p7?.commit?.slotAnchor?.blockNumber === 101, p7?.commit?.slotAnchor);

  // 8. The next real anchor: it stands on 101, and everything after stands on it.
  const r8 = await anchorCommit(102, epochId);
  const a101 = proofOf(r8);
  ok("third anchor is 200", r8.status === 200, r8.json);
  ok("that anchor stands on the previous one", a101?.commit?.slotAnchor?.blockNumber === 101 && a101?.commit?.anchor?.blockNumber === 102, a101?.commit);
  const p8 = proofOf(await plain());
  ok("floor advanced to block 102", p8?.commit?.slotAnchor?.blockNumber === 102 && p8?.commit?.slotAnchor?.counter === a101?.commit?.counter, p8?.commit?.slotAnchor);

  // 9. Another chain has its own (empty) anchor state.
  const p9 = proofOf(await plain({ chainId: "bitgraph:test" }));
  ok("unanchored chain carries no floor", p9?.commit && !("slotAnchor" in p9.commit), p9?.commit);
  const r9 = await anchorCommit(103, epochId, { chainIdBody: "bitgraph:test" });
  ok("claim signed for main is refused on test chain", r9.status !== 200 && /signature/.test(errOf(r9)), { status: r9.status, body: r9.json });

  // 10. Both new fields are signed: tampering breaks the proof.
  const t1 = structuredClone(p8); t1.commit.slotAnchor.blockNumber = 100;
  ok("tampered slotAnchor fails verification", (await verifyProofIntegrity({ proof: t1 })).valid === false);
  const t2 = structuredClone(a101); t2.commit.anchor.blockHash = blockHashFor(7);
  ok("tampered anchor fails verification", (await verifyProofIntegrity({ proof: t2 })).valid === false);
  const t3 = structuredClone(p8); delete t3.commit.slotAnchor;
  ok("removed slotAnchor fails verification", (await verifyProofIntegrity({ proof: t3 })).valid === false);

  // 11. Backward compatibility: the published verify 1.7.0 verifies v7 proofs.
  if (OLD_VERIFY) {
    const old = await import(`${OLD_VERIFY}/dist/index.js`);
    for (const [name, proof] of [["anchor proof", a100], ["floored proof", p5], ["second anchor", a101], ["held-slot proof", p6]] as const) {
      const r = await old.verifyProofIntegrity({ proof });
      ok(`verify 1.7.0 accepts v7 ${name}`, r.valid === true, r);
    }
    const r = await old.verifyProofIntegrity({ proof: t1 });
    ok("verify 1.7.0 rejects the tampered floor too", r.valid === false, r);
  } else {
    console.log("skip: OLD_VERIFY_DIR unset, old-verifier compatibility not checked");
  }
} finally {
  stack.stop();
}
console.log(`\n${pass} checks passed${process.exitCode ? ", with failures" : ""}`);
