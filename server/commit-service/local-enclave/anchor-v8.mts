// Enclave v8: the floor gate. On the anchored chain the enclave refuses to sign
// a proof whose slot was allocated before the epoch's first authenticated
// anchor, so no proof on that chain can lack a floor. Anchors are exempt, which
// is what stops it deadlocking. Run: node --import tsx/esm anchor-v8.mts
import { startStack, post, randomDigestB64 } from "./lib.mts";
import { getPublicKeyAsync, signAsync, utils } from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha256";

const utf8 = (s: string) => new TextEncoder().encode(s);
const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");

const seed = utils.randomPrivateKey();
process.env["HARNESS_ANCHOR_PUBKEY_B64"] = b64(await getPublicKeyAsync(seed));

const stack = await startStack({ quiet: true, parentEnv: { FUSE_ENABLED: "true" } });
const U = stack.parentUrl;
const CHAIN = "bitgraph:main";
let pass = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => {
  if (!cond) { console.error("FAIL", name, detail === undefined ? "" : JSON.stringify(detail).slice(0, 500)); process.exitCode = 1; }
  else { pass++; console.log("ok  ", name); }
};
const blockHashFor = (n: number) => "0x" + Buffer.from(sha256(utf8(`harness-block-${n}`))).toString("hex");
const proofOf = (r: { json: any }) => (Array.isArray(r.json) ? r.json[0] : r.json?.proofs?.[0] ?? r.json);
const body = (r: { json: any }) => JSON.stringify(r.json);

async function anchorAt(n: number, epochId: string, chainId = CHAIN) {
  const blockHash = blockHashFor(n);
  const sig = await signAsync(utf8(`bitgraph-anchor/1\n${epochId}\n${chainId}\n${n}\n${blockHash}`), seed);
  return post(`${U}/commit`, {
    digests: [{ digestB64: b64(sha256(utf8(blockHash))), hashAlg: "sha256" }],
    chainId,
    attribution: { name: "Ethereum Anchor", message: blockHash, title: `https://etherscan.io/block/${n}` },
    anchor: { blockNumber: n, blockHash, signatureB64: b64(sig) },
  });
}
const plain = (extra: Record<string, unknown> = {}) =>
  post(`${U}/commit`, { digests: [{ digestB64: randomDigestB64(), hashAlg: "sha256" }], chainId: CHAIN, ...extra });

try {
  const { epochId } = (await (await fetch(`${U}/key`)).json()) as { epochId: string };

  // 1. Before the epoch's first anchor, the anchored chain refuses ordinary commits.
  const r1 = await plain();
  ok("ordinary commit before the first anchor is refused", r1.status === 503 && /no-anchor-floor/.test(body(r1)), { status: r1.status, body: r1.json });
  ok("the refusal carries Retry-After", r1.headers.get("retry-after") === "15", Object.fromEntries(r1.headers));

  // 2. A slot held from that window is refused too: the gate reads the SLOT's floor,
  //    so waiting for an anchor and spending an old slot does not get past it.
  const held = await post(`${U}/allocate-slot`, { chainId: CHAIN });
  ok("a slot can still be allocated before the first anchor", held.status === 200, held.json);

  // 3. Other chains are unaffected: they are unanchored by design.
  const other = await plain({ chainId: "bitgraph:test" });
  ok("an unanchored chain still commits", other.status === 200 && !proofOf(other)?.commit?.slotAnchor, { status: other.status, commit: proofOf(other)?.commit });

  // 4. The epoch's first anchor is exempt, so it lands and nothing deadlocks.
  const a1 = await anchorAt(500, epochId);
  const anchor1 = proofOf(a1);
  ok("the epoch's first anchor is exempt and commits", a1.status === 200 && anchor1?.commit?.anchor?.blockNumber === 500, { status: a1.status, commit: anchor1?.commit });
  ok("the first anchor itself carries no floor", !("slotAnchor" in (anchor1?.commit ?? {})), anchor1?.commit);

  // 5. After it, ordinary commits work and carry the floor.
  const r5 = await plain();
  const p5 = proofOf(r5);
  ok("ordinary commit after the first anchor is 200", r5.status === 200, r5.json);
  ok("and it carries the floor", p5?.commit?.slotAnchor?.blockNumber === 500 && p5?.commit?.slotAnchor?.counter === anchor1?.commit?.counter, p5?.commit);

  // 6. The slot held from before the anchor is STILL refused: no floorless proof, ever.
  const r6 = await post(`${U}/commit`, { digests: [{ digestB64: randomDigestB64(), hashAlg: "sha256" }], slotId: held.json.slotId });
  ok("the pre-anchor slot is refused even now", r6.status === 503 && /no-anchor-floor/.test(body(r6)), { status: r6.status, body: r6.json });

  // 7. A fresh slot allocated now commits fine.
  const fresh = await post(`${U}/allocate-slot`, { chainId: CHAIN });
  const r7 = await post(`${U}/commit`, { digests: [{ digestB64: randomDigestB64(), hashAlg: "sha256" }], slotId: fresh.json.slotId });
  ok("a fresh slot commits and carries the floor", r7.status === 200 && proofOf(r7)?.commit?.slotAnchor?.blockNumber === 500, { status: r7.status, commit: proofOf(r7)?.commit });

  // 8. The gate does not weaken the v7 refusals: a bad claim is still refused, and
  //    the reserved name without a claim is still refused.
  const badSig = await post(`${U}/commit`, {
    digests: [{ digestB64: b64(sha256(utf8(blockHashFor(501)))), hashAlg: "sha256" }],
    chainId: CHAIN,
    attribution: { name: "Ethereum Anchor", message: blockHashFor(501), title: "https://etherscan.io/block/501" },
    anchor: { blockNumber: 501, blockHash: blockHashFor(501), signatureB64: b64(new Uint8Array(64)) },
  });
  ok("a bad anchor signature is still refused", badSig.status !== 200 && /signature/.test(body(badSig)), { status: badSig.status, body: badSig.json });
  const reserved = await plain({ attribution: { name: "Ethereum Anchor", message: blockHashFor(502) } });
  ok("the reserved name without a claim is still refused", reserved.status !== 200 && /reserved/.test(body(reserved)), { status: reserved.status, body: reserved.json });
} finally {
  stack.stop();
}
console.log(`\n${pass} checks passed${process.exitCode ? ", with failures" : ""}`);
