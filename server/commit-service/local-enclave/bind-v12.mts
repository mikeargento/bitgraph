// Enclave v12: one TEE, two steps, one atomic action, and nothing else.
// The enclave answers init, health, key and bind; a BitGraph is made one way.
// Run: node --import tsx/esm bind-v12.mts [path to a published bitgraph-verify dist/index.js]
import { connect } from "node:net";
import { startStack, post, randomDigestB64 } from "./lib.mts";
import { VsockClient } from "../src/parent/vsock-client.ts";
import { verify, createVerificationContext, verifyStretch, computeChainHash } from "../../../packages/verify/dist/index.js";

const enclavePort = 59500 + Math.floor(Math.random() * 400);
// No Base node: v12 reads nothing in. FUSE_ENABLED stays on to show held slots are refused anyway.
const stack = await startStack({ quiet: true, enclavePort, base: false, parentEnv: { FUSE_ENABLED: "true" } });
const U = stack.parentUrl;
const enclave = new VsockClient({ host: "127.0.0.1", port: enclavePort });
let pass = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => {
  if (!cond) { console.error("FAIL", name, detail === undefined ? "" : JSON.stringify(detail).slice(0, 600)); process.exitCode = 1; }
  else { pass++; console.log("ok  ", name); }
};
const strip = (p: any) => { const { proofHash: _h, ...rest } = p; return rest; };
const commit = async () => { const r = await post(`${U}/commit`, { digests: [{ digestB64: randomDigestB64(), hashAlg: "sha256" }] }); return Array.isArray(r.json) ? r.json[0] : r.json; };
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
  const key = await (await fetch(`${U}/key`)).json() as { bind?: string; only?: string; floor?: string };
  ok("/key: bind atomic, only bind, no floor", key.bind === "atomic" && key.only === "bind" && key.floor === undefined, key);

  // The one way.
  const p1 = await commit();
  ok("POST /commit makes a BitGraph", !!p1?.commit, p1);
  ok("signed atomic, payload count = nonce count + 1", p1?.commit?.atomic === true && BigInt(p1.commit.counter) === BigInt(p1.slotAllocation.counter) + 1n, p1?.commit);
  ok("on bitgraph:main", p1?.commit?.chainId === "bitgraph:main" && p1?.slotAllocation?.chainId === "bitgraph:main", p1?.commit);
  const extra = ["slotFloor", "slotAnchor", "anchor"].filter((k) => k in (p1?.commit ?? {}));
  ok("nothing read in: no floor, no anchor", extra.length === 0, extra);
  ok("no extra signed fields: no actor, attribution or policy", !("agency" in p1) && !("attribution" in p1) && !("policy" in p1), Object.keys(p1));
  ok("the time is the attestation's", typeof p1?.environment?.attestation?.reportB64 === "string" && p1.environment.attestation.reportB64.length > 0);
  const v = await verify({ proof: strip(p1), context: createVerificationContext(), policy: { requireSlot: true, requireAtomic: true } as never });
  ok("this verifier: VALID with requireAtomic", v.valid === true, v);
  if (process.argv[2]) {
    const old = await import(process.argv[2]) as any;
    const vo = await old.verify({ proof: strip(p1), context: old.createVerificationContext() });
    ok("published bitgraph-verify reads a v12 BitGraph as VALID", vo.valid === true, vo);
  }

  // Every other way is gone.
  const alloc = await post(`${U}/allocate-slot`, {});
  ok("POST /allocate-slot is gone (410)", alloc.status === 410, alloc);
  const challenge = await post(`${U}/challenge`, {});
  ok("POST /challenge is gone (410)", challenge.status === 410, challenge);
  const held = await post(`${U}/commit`, { digests: [{ digestB64: randomDigestB64(), hashAlg: "sha256" }], slotId: "A".repeat(43) + "=" });
  ok("a commit naming a held slot is refused (410)", held.status === 410, held);
  for (const action of ["allocateSlot", "commitDigest", "commit", "challenge"]) {
    const r = await rawSend({ action, digestB64: randomDigestB64(), slotId: "x" });
    ok(`the enclave refuses "${action}"`, typeof r.error === "string" && /does one thing: bind/.test(r.error), r);
  }
  const fancy = await rawSend({ action: "bind", digestB64: randomDigestB64(), attribution: { name: "Ethereum Anchor" }, policy: { x: 1 }, anchor: { blockNumber: 1 }, baseFloorHeaderB64: "AAAA", chainId: "other" });
  ok("extra fields sent with a bind are ignored, not signed", !!fancy.proof && !("attribution" in fancy.proof) && !("policy" in fancy.proof) && !("anchor" in fancy.proof.commit) && !("slotFloor" in fancy.proof.commit) && fancy.proof.commit.chainId === "bitgraph:main", fancy.proof?.commit);

  // A failed bind leaves no gap.
  const before = await commit();
  const bad1 = await enclave.send({ type: "bind", digestB64: "AAAA" } as never);
  const bad2 = await enclave.send({ type: "bind", digestB64: Buffer.alloc(32).toString("base64").replace("=", "") } as never);
  ok("bad digests are refused", !bad1.ok && !bad2.ok, { bad1, bad2 });
  const after = await commit();
  ok("after refused binds the counter runs straight on", BigInt(after.slotAllocation.counter) === BigInt(before.commit.counter) + 1n, { before: before.commit.counter, next: after.slotAllocation.counter });
  ok("and links to the proof before", after.commit.prevB64 === computeChainHash(strip(before)));

  // The whole epoch so far is one unbroken run (the fancy bind included).
  const run = [await commit(), await commit(), await commit()];
  const s = verifyStretch([before, after, ...run].map(strip));
  ok("five consecutive BitGraphs are one unbroken stretch", s.ok, s);

  // The enclave's own lock: 24 binds on raw connections at once.
  const raced = (await Promise.all(Array.from({ length: 24 }, () => rawSend({ action: "bind", digestB64: randomDigestB64() })))).map((r) => r.proof).filter(Boolean);
  ok("24 concurrent binds all succeed", raced.length === 24);
  raced.sort((a, b) => (BigInt(a.commit.counter) < BigInt(b.commit.counter) ? -1 : 1));
  const rs = verifyStretch(raced);
  ok("and form one unbroken stretch", rs.ok, rs.reasons?.slice(0, 3));
} finally {
  stack.stop();
}
console.log(`\n${pass} checks passed${process.exitCode ? ", with failures" : ""}`);
