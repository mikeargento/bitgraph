// Enclave v9: allocation hands back the floor. The anchor the enclave fixes at
// allocation (and signs at commit as commit.slotAnchor) is returned with the
// slot, unsigned, so a producer can bind the floor block into a fused file's
// commitment (bitgraph-fuse/2). Nothing signed changes.
// Run: node --import tsx/esm anchor-v9.mts
// SUPERSEDED by enclave v10 (2026-10-06): on the anchored chain every position now
// carries a Base floor (commit.slotFloor) and no Ethereum slotAnchor, so this v9 floor
// behaviour is not reachable on the current enclave. Kept as the record of what v9 did;
// it runs only against a v9 build (HARNESS_LEGACY_ENCLAVE=v9). The anchor checks that
// still hold in v10 live in base-floor-v10.mts.
if (process.env["HARNESS_LEGACY_ENCLAVE"] !== "v9") {
  console.log("skipped: v9 floor behaviour, superseded by enclave v10 (see base-floor-v10.mts)");
  process.exit(0);
}
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

async function anchorAt(n: number, epochId: string) {
  const blockHash = blockHashFor(n);
  const sig = await signAsync(utf8(`bitgraph-anchor/1\n${epochId}\n${CHAIN}\n${n}\n${blockHash}`), seed);
  return post(`${U}/commit`, {
    digests: [{ digestB64: b64(sha256(utf8(blockHash))), hashAlg: "sha256" }],
    chainId: CHAIN,
    attribution: { name: "Ethereum Anchor", message: blockHash, title: `https://etherscan.io/block/${n}` },
    anchor: { blockNumber: n, blockHash, signatureB64: b64(sig) },
  });
}

try {
  const { epochId } = (await (await fetch(`${U}/key`)).json()) as { epochId: string };

  // 1. Before the epoch's first anchor there is no floor to hand back.
  const early = await post(`${U}/allocate-slot`, { chainId: CHAIN });
  ok("allocation before any anchor succeeds", early.status === 200, early.json);
  ok("and carries no anchor", !("anchor" in (early.json ?? {})), early.json);

  // 2. After an anchor, allocation returns it.
  const a1 = await anchorAt(700, epochId);
  const anchor1 = proofOf(a1);
  ok("an anchor lands", a1.status === 200 && anchor1?.commit?.anchor?.blockNumber === 700, a1.json);
  const s1 = await post(`${U}/allocate-slot`, { chainId: CHAIN });
  ok("allocation after it returns the anchor", s1.json?.anchor?.blockNumber === 700 && s1.json?.anchor?.blockHash === blockHashFor(700) && s1.json?.anchor?.counter === anchor1?.commit?.counter, s1.json);

  // 3. The returned anchor is exactly the one the commit then signs, even if a newer
  //    anchor lands while the slot is held (the floor is fixed at allocation).
  const a2 = await anchorAt(701, epochId);
  ok("a newer anchor lands while the slot is held", a2.status === 200, a2.json);
  const c1 = await post(`${U}/commit`, { digests: [{ digestB64: randomDigestB64(), hashAlg: "sha256" }], slotId: s1.json.slotId });
  const p1 = proofOf(c1);
  ok("the held slot commits", c1.status === 200, c1.json);
  ok("its signed slotAnchor equals the anchor returned at allocation", JSON.stringify(p1?.commit?.slotAnchor) === JSON.stringify(s1.json.anchor), { returned: s1.json.anchor, signed: p1?.commit?.slotAnchor });

  // 4. Nothing signed changed: the slot record has exactly the v8 fields.
  const keys = Object.keys(s1.json?.slot ?? {}).sort().join(",");
  ok("the slot record has the same fields as v8", keys === "chainId,counter,epochId,nonceB64,publicKeyB64,signatureB64,version" || keys === "counter,epochId,nonceB64,publicKeyB64,signatureB64,version", keys);
  ok("the slot record carries no anchor", !("anchor" in (s1.json?.slot ?? {})), s1.json?.slot);

  // 5. A fresh allocation now returns the newer anchor.
  const s2 = await post(`${U}/allocate-slot`, { chainId: CHAIN });
  ok("a fresh allocation returns the newer anchor", s2.json?.anchor?.blockNumber === 701, s2.json);
} finally {
  stack.stop();
}
console.log(`\n${pass} checks passed${process.exitCode ? ", with failures" : ""}`);
