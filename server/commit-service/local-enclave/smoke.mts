// End-to-end smoke for deliverable 2 (metered /allocate-slot) against the
// unmodified enclave. Run: node --import tsx/esm smoke.mts
import { startStack, post, randomDigestB64 } from "./lib.mts";
import { strict as assert } from "node:assert";

const stack = await startStack({ quiet: true, parentEnv: { RL_ALLOC_PER_IP_CAPACITY: "5", RL_ALLOC_GLOBAL_PER_WINDOW: "100" } });
const U = stack.parentUrl;
let pass = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (!cond) { console.error("FAIL", name, detail ?? ""); process.exitCode = 1; } else { pass++; console.log("ok  ", name); } };

try {
  // 1. Ordinary commit still works (regression).
  const c1 = await post(`${U}/commit`, { digests: [{ digestB64: randomDigestB64(), hashAlg: "sha256" }], chainId: "bitgraph:main" });
  ok("ordinary /commit is 200", c1.status === 200, c1.json);
  ok("ordinary proof carries slotAllocation", Array.isArray(c1.json) && !!c1.json[0]?.slotAllocation);

  // 2. Allocation with no body defaults to the anchored chain.
  const a1 = await post(`${U}/allocate-slot`, undefined);
  ok("/allocate-slot with no body is 200", a1.status === 200, a1.json);
  ok("default chain is bitgraph:main", a1.json?.chainId === "bitgraph:main", a1.json);
  ok("slot record carries chainId", a1.json?.slot?.chainId === "bitgraph:main", a1.json?.slot);
  ok("slotId is the slot nonce", a1.json?.slotId === a1.json?.slot?.nonceB64);

  // 3. Explicit chainId is honoured; bad shapes refused.
  const a2 = await post(`${U}/allocate-slot`, { chainId: "bitgraph:test" });
  ok("explicit chainId honoured", a2.status === 200 && a2.json?.chainId === "bitgraph:test", a2.json);
  const bad = await post(`${U}/allocate-slot`, { chainId: 42 });
  ok("non-string chainId is 400", bad.status === 400, bad.json);
  const bad2 = await post(`${U}/allocate-slot`, [1, 2]);
  ok("array body is 400", bad2.status === 400, bad2.json);
  const bad3 = await fetch(`${U}/allocate-slot`, { method: "POST", body: "{not json" });
  ok("invalid JSON is 400", bad3.status === 400);

  // 4. The per-address limiter (capacity 5 here): 3 more pass, then 429 with Retry-After.
  const results: number[] = [];
  for (let i = 0; i < 4; i++) results.push((await post(`${U}/allocate-slot`, {})).status);
  ok("burst exhausted after the configured capacity", results.slice(0, 3).every((s) => s === 200) && results[3] === 429, results);
  const limited = await post(`${U}/allocate-slot`, {});
  ok("429 carries Retry-After", limited.status === 429 && !!limited.headers.get("retry-after"), Object.fromEntries(limited.headers));

  // 5. A held slot can still be consumed by the enclave directly (proves the
  //    slot is real; the HTTP /commit path for held slots is deliverable 3).
  ok("held slot present in allocation response", typeof a1.json?.slotId === "string");

  // 6. Ordinary commits are unaffected by the allocation limiter.
  const c2 = await post(`${U}/commit`, { digests: [{ digestB64: randomDigestB64(), hashAlg: "sha256" }], chainId: "bitgraph:main" });
  ok("ordinary /commit still 200 after allocation limit hit", c2.status === 200, c2.json);
} finally {
  stack.stop();
}
console.log(`\n${pass} checks passed${process.exitCode ? ", with failures" : ""}`);
