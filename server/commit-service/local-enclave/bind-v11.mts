// Enclave v11: bind, THE primitive. One atomic action inside the enclave:
// a fresh nonce at count N, the payload at N+1, signed and released together.
// The nonce never leaves the enclave before it is bound; a failed bind leaves
// no gap; every request runs under the enclave's own lock. Stretches of binds
// run straight through the counter (the sandwich).
// Run: node --import tsx/esm bind-v11.mts [path to a published bitgraph-verify, to check old verifiers]
import { connect } from "node:net";
import { startStack, post, randomDigestB64, ANCHORED_CHAIN } from "./lib.mts";
import { VsockClient } from "../src/parent/vsock-client.ts";
import { encodeBaseHeaderRlp } from "../src/parent/base-head.ts";
import { verify, createVerificationContext, verifyStretch, verifyBetween, computeChainHash } from "../../../packages/verify/dist/index.js";

const enclavePort = 59500 + Math.floor(Math.random() * 400);
const stack = await startStack({ quiet: true, enclavePort, parentEnv: { FUSE_ENABLED: "true" } });
const U = stack.parentUrl;
const base = stack.base!;
const enclave = new VsockClient({ host: "127.0.0.1", port: enclavePort });
let pass = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => {
  if (!cond) { console.error("FAIL", name, detail === undefined ? "" : JSON.stringify(detail).slice(0, 600)); process.exitCode = 1; }
  else { pass++; console.log("ok  ", name); }
};
const proofOf = (r: { json: any }) => (Array.isArray(r.json) ? r.json[0] : r.json?.proofs?.[0] ?? r.json);
const commit = async (chainId = ANCHORED_CHAIN) => proofOf(await post(`${U}/commit`, { digests: [{ digestB64: randomDigestB64(), hashAlg: "sha256" }], chainId }));
const headerB64 = () => Buffer.from(encodeBaseHeaderRlp(base.head())).toString("base64");
const strip = (p: any) => { const { proofHash: _h, ...rest } = p; return rest; };

/** One raw connection straight to the enclave, bypassing the parent's queue. */
function rawSend(msg: Record<string, unknown>): Promise<any> {
  return new Promise((resolve, reject) => {
    const sock = connect({ host: "127.0.0.1", port: enclavePort }, () => sock.write(JSON.stringify(msg)));
    const chunks: Buffer[] = [];
    sock.on("data", (c) => chunks.push(c));
    sock.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch (e) { reject(e); } });
    sock.on("error", reject);
  });
}

try {
  // 1. The enclave says it binds.
  const key = await (await fetch(`${U}/key`)).json() as { bind?: string };
  ok("/key reports bind: atomic", key.bind === "atomic", key);

  // 2. The default /commit is one bind: nonce at N, payload at N+1.
  const p1 = await commit();
  ok("the default /commit makes a proof", !!p1?.commit, p1);
  ok("it is signed atomic", p1?.commit?.atomic === true, p1?.commit);
  ok("payload count = nonce count + 1", BigInt(p1.commit.counter) === BigInt(p1.slotAllocation.counter) + 1n, { n: p1.slotAllocation.counter, n1: p1.commit.counter });
  ok("the slot record keeps its old shape (no payload in it)", Object.keys(p1.slotAllocation).sort().join() === "chainId,counter,epochId,nonceB64,publicKeyB64,signatureB64,version", p1.slotAllocation);
  ok("it carries its Base floor", p1?.commit?.slotFloor?.chain === "base", p1?.commit);
  const v1 = await verify({ proof: strip(p1), context: createVerificationContext(), policy: { requireSlot: true, requireAtomic: true } as never });
  ok("this verifier: VALID, with requireAtomic", v1.valid === true, v1);

  // 3. Old verifiers read a bind as VALID (the signed fields they copy whole).
  const published = process.argv[2];
  if (published) {
    const old = await import(published) as typeof import("../../../packages/verify/dist/index.js");
    const vo = await old.verify({ proof: strip(p1), context: old.createVerificationContext() });
    ok("published bitgraph-verify reads a bind as VALID", vo.valid === true, vo);
  }

  // 4. A failed bind releases nothing and leaves no gap.
  const pa = await commit();
  const bad = await enclave.send({ type: "bind", digestB64: "AAAA", chainId: ANCHORED_CHAIN } as never);
  ok("a bind with a bad digest is refused", !bad.ok && /32-byte/.test(bad.error ?? ""), bad);
  const badFloor = await enclave.send({ type: "bind", digestB64: randomDigestB64(), chainId: ANCHORED_CHAIN, baseFloorHeaderB64: Buffer.from("nope").toString("base64") } as never);
  ok("a bind with a bad floor header is refused", !badFloor.ok, badFloor);
  const noFloor = await enclave.send({ type: "bind", digestB64: randomDigestB64(), chainId: ANCHORED_CHAIN } as never);
  ok("a bind on the anchored chain with no floor is refused", !noFloor.ok && /no-base-floor/.test(noFloor.error ?? ""), noFloor);
  const pb = await commit();
  ok("after three failed binds the next nonce count follows the last payload count", BigInt(pb.slotAllocation.counter) === BigInt(pa.commit.counter) + 1n, { last: pa.commit.counter, next: pb.slotAllocation.counter });
  ok("and links to it", pb.commit.prevB64 === computeChainHash(strip(pa)));

  // 5. The sandwich: A, records, B. Every count accounted for.
  const A = await commit();
  const R1 = await commit();
  const R2 = await commit();
  const B = await commit();
  const stretch = [A, R1, R2, B].map(strip);
  const s = verifyStretch(stretch);
  ok("A → R → R → B is an unbroken stretch", s.ok, s);
  ok("it covers exactly 8 counts", BigInt(s.to!) - BigInt(s.from!) + 1n === 8n, s);
  ok("R1 is between A and B", verifyBetween(stretch, strip(R1)).ok);
  ok("A is not strictly between A and B", !verifyBetween(stretch, strip(A)).ok);
  const holed = verifyStretch([A, R2, B].map(strip));
  ok("leaving a record out shows the unaccounted counts", !holed.ok && holed.reasons.some((r) => /unaccounted/.test(r)), holed);

  // 6. Fuse is still there, as an option, on its own chain: a held slot is
  //    allocated on bitgraph:fuse and commits on the old path, not atomic.
  //    bitgraph:main refuses held slots, so Fuse activity takes no counts
  //    there: main stays one unbroken run of binds.
  const heldOnMain = await post(`${U}/allocate-slot`, { chainId: ANCHORED_CHAIN });
  ok("a held slot on bitgraph:main is refused (binds only)", heldOnMain.status !== 200 && /main-binds-only/.test(JSON.stringify(heldOnMain.json)), heldOnMain.json);
  const before = await commit();
  const slot = await post(`${U}/allocate-slot`, {});
  ok("Fuse: /allocate-slot hands out a slot on bitgraph:fuse by default", slot.status === 200 && slot.json?.chainId === "bitgraph:fuse" && slot.json?.slot?.chainId === "bitgraph:fuse", slot.json);
  ok("Fuse: the slot carries its Base floor", slot.json?.floor?.chain === "base", slot.json);
  const fused = proofOf(await post(`${U}/commit`, { digests: [{ digestB64: randomDigestB64(), hashAlg: "sha256" }], slotId: slot.json.slotId }));
  ok("Fuse: the held slot commits", !!fused?.commit, fused);
  ok("Fuse: its proof is not atomic", fused?.commit?.atomic === undefined, fused?.commit);
  ok("Fuse: its proof is on bitgraph:fuse with a Base floor", fused?.commit?.chainId === "bitgraph:fuse" && fused?.commit?.slotFloor?.chain === "base", fused?.commit);
  const vf = await verify({ proof: strip(fused), context: createVerificationContext() });
  ok("Fuse: its proof is still VALID", vf.valid === true, vf);
  const expired = await post(`${U}/allocate-slot`, {});
  ok("Fuse: a slot left unused is fine (it can only gap bitgraph:fuse)", expired.status === 200);
  const after = await commit();
  const around = verifyStretch([before, after].map(strip));
  ok("main stays unbroken across Fuse activity: the binds before and after are consecutive", around.ok, around);
  const mixed = verifyStretch([before, fused, after].map(strip));
  ok("a two-call proof cannot be passed off inside a main stretch", !mixed.ok && mixed.reasons.some((r) => /not a bind/.test(r)), mixed);

  // 7. The enclave's own lock: 24 binds on separate raw connections at once,
  //    no parent queue in front. Each must be atomic, and the run unbroken.
  const chain = "harness:race";
  const results = await Promise.all(Array.from({ length: 24 }, () =>
    rawSend({ action: "bind", digestB64: randomDigestB64(), chainId: chain, baseFloorHeaderB64: headerB64() })));
  const raced = results.map((r) => r.proof).filter(Boolean);
  ok("all 24 concurrent binds succeed", raced.length === 24, results.filter((r) => !r.proof).slice(0, 2));
  raced.sort((a, b) => (BigInt(a.commit.counter) < BigInt(b.commit.counter) ? -1 : 1));
  ok("no two concurrent binds share a prevB64", new Set(raced.map((p) => p.commit.prevB64 ?? "genesis")).size === raced.length);
  const rs = verifyStretch(raced);
  ok("the 24 concurrent binds form one unbroken stretch", rs.ok, rs.reasons.slice(0, 3));
} finally {
  stack.stop();
  base.close();
}
console.log(`\n${pass} checks passed${process.exitCode ? ", with failures" : ""}`);
