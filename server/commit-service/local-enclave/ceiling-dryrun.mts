// Ceiling dry run: the unmodified enclave and the real parent on this machine,
// with the ceiling queue switched on and anchors carrying REAL Ethereum blocks
// (signed with a harness anchor key), so every proof has a genuine floor.
// Proofs stay local; only the writer (a separate process) touches Base.
//
//   CEILING_STATE_DIR=... node --import tsx/esm ceiling-dryrun.mts
//
// Makes 200 proofs: spaced singles, a burst of 50 inside one second, one Set,
// then more spaced singles. Every proof is saved to <state>/proofs/.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getPublicKeyAsync, signAsync, utils } from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import { startStack, post, randomDigestB64, ANCHORED_CHAIN } from "./lib.mts";
import { fuseSet } from "../../../dist/fuse.js";

const stateDir = process.env["CEILING_STATE_DIR"];
if (!stateDir) throw new Error("CEILING_STATE_DIR");
const proofsDir = join(stateDir, "proofs");
mkdirSync(proofsDir, { recursive: true });
const utf8 = (s: string) => new TextEncoder().encode(s);
const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");
const safe = (s: string) => s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const seed = utils.randomPrivateKey();
process.env["HARNESS_ANCHOR_PUBKEY_B64"] = b64(await getPublicKeyAsync(seed));
const stack = await startStack({
  quiet: true,
  parentEnv: { FUSE_ENABLED: "true", CEILING_QUEUE_PATH: join(stateDir, "queue.jsonl") },
});
const U = stack.parentUrl;
const ETH = process.env["CEILING_ETH_RPC_URL"] ?? "https://ethereum-rpc.publicnode.com";

async function latestEthBlock(): Promise<{ number: number; hash: string }> {
  const r = await fetch(ETH, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBlockByNumber", params: ["latest", false] }) });
  const j = (await r.json()) as { result: { number: string; hash: string } };
  return { number: parseInt(j.result.number, 16), hash: j.result.hash.toLowerCase() };
}

let lastAnchored = 0;
async function anchorLatest(): Promise<void> {
  const b = await latestEthBlock();
  if (b.number <= lastAnchored) return;
  const { epochId } = (await (await fetch(`${U}/key`)).json()) as { epochId: string };
  const sig = await signAsync(utf8(`bitgraph-anchor/1\n${epochId}\n${ANCHORED_CHAIN}\n${b.number}\n${b.hash}`), seed);
  const res = await post(`${U}/commit`, {
    digests: [{ digestB64: b64(sha256(utf8(b.hash))), hashAlg: "sha256" }],
    chainId: ANCHORED_CHAIN,
    attribution: { name: "Ethereum Anchor", message: b.hash, title: `https://etherscan.io/block/${b.number}` },
    anchor: { blockNumber: b.number, blockHash: b.hash, signatureB64: b64(sig) },
  });
  if (res.status !== 200) throw new Error(`anchor ${b.number}: ${res.status}`);
  lastAnchored = b.number;
  console.log(`anchor block ${b.number}`);
}

let made = 0;
function keep(proof: { proofHash?: string } & Record<string, unknown>): void {
  made++;
  writeFileSync(join(proofsDir, `${safe(proof.proofHash!)}.json`), JSON.stringify(proof, null, 2));
}
async function single(): Promise<void> {
  const r = await post(`${U}/commit`, { digests: [{ digestB64: randomDigestB64(), hashAlg: "sha256" }], chainId: ANCHORED_CHAIN });
  if (r.status !== 200) throw new Error(`commit ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
  keep((Array.isArray(r.json) ? r.json[0] : r.json) as never);
}

let anchoring = true;
const anchorLoop = (async () => {
  while (anchoring) {
    try { await anchorLatest(); } catch (e) { console.error(String(e)); }
    await sleep(3_000);
  }
})();

try {
  await anchorLatest();
  console.log("phase A: 70 spaced singles");
  for (let i = 0; i < 70; i++) { await single(); await sleep(500 + Math.random() * 2500); }
  console.log("phase B: burst of 50 in one second");
  const t0 = Date.now();
  await Promise.all(Array.from({ length: 50 }, (_, i) => sleep(i * 18).then(single)));
  console.log(`burst took ${Date.now() - t0} ms`);
  await sleep(8_000);
  console.log("phase C: one Set of 6 files");
  const transport = { baseUrl: U, allocatePath: "/allocate-slot", commitPath: "/commit", recoveryAttempts: 1, recoveryDelayMs: 1 };
  const members = Array.from({ length: 6 }, (_, i) => ({ original: utf8(`ceiling dry run member ${i} ${Date.now()}\n`), name: `m${i}.txt` }));
  const set = await fuseSet(members, { transport });
  keep({ ...(set.proof as unknown as Record<string, unknown>), proofHash: (set.proof as unknown as { proofHash?: string }).proofHash ?? (await import("../../../packages/verify/dist/index.js")).computeProofHash(set.proof as never) } as never);
  await sleep(4_000);
  console.log("phase D: 79 spaced singles");
  for (let i = 0; i < 79; i++) { await single(); await sleep(300 + Math.random() * 2200); }
  console.log(`made ${made} proofs`);
} finally {
  anchoring = false;
  await anchorLoop;
  stack.stop();
}
