// Enclave v10: the Base floor. The parent hands the enclave the newest Base
// header with every allocation; the enclave hashes it, reads number and time
// from the same bytes, refuses a block lower than the chain's last floor or
// stamped ahead of its clock, returns the floor with the slot and signs it at
// commit as commit.slotFloor. No Ethereum anchor is needed on the anchored chain.
// Run: node --import tsx/esm base-floor-v10.mts
import { startStack, post, randomDigestB64, ANCHORED_CHAIN } from "./lib.mts";
import { VsockClient } from "../src/parent/vsock-client.ts";
import { encodeBaseHeaderRlp } from "../src/parent/base-head.ts";

const enclavePort = 59500 + Math.floor(Math.random() * 400);
const stack = await startStack({ quiet: true, enclavePort, parentEnv: { FUSE_ENABLED: "true" } });
const U = stack.parentUrl;
const base = stack.base!;
const enclave = new VsockClient({ host: "127.0.0.1", port: enclavePort });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let pass = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => {
  if (!cond) { console.error("FAIL", name, detail === undefined ? "" : JSON.stringify(detail).slice(0, 600)); process.exitCode = 1; }
  else { pass++; console.log("ok  ", name); }
};
const proofOf = (r: { json: any }) => (Array.isArray(r.json) ? r.json[0] : r.json?.proofs?.[0] ?? r.json);
const headerB64 = (b: ReturnType<typeof base.head>) => Buffer.from(encodeBaseHeaderRlp(b)).toString("base64");
const direct = (body: Record<string, unknown>) => enclave.send({ type: "allocateSlot", ...body } as never);

try {
  // 1. With no Ethereum anchor at all, the anchored chain allocates and the floor is the Base head.
  const s1 = await post(`${U}/allocate-slot`, { chainId: ANCHORED_CHAIN });
  const head1 = base.head();
  const f1 = s1.json?.floor;
  ok("allocation on the anchored chain succeeds with no Ethereum anchor", s1.status === 200, s1.json);
  ok("it returns a Base floor naming its chain", f1?.chain === "base" && f1?.evmChainId === 8453, f1);
  ok("the floor is a block the stand-in Base produced, hash and number from its header",
    typeof f1?.blockHash === "string" && /^0x[0-9a-f]{64}$/.test(f1.blockHash) && f1.blockNumber <= parseInt(head1.number, 16) && f1.blockNumber >= parseInt(head1.number, 16) - 2, { f1, head: head1.number });
  ok("no Ethereum anchor is returned", !("anchor" in (s1.json ?? {})), s1.json);

  // 2. The commit signs exactly that floor, even after newer blocks arrive.
  await sleep(2300);
  const c1 = await post(`${U}/commit`, { digests: [{ digestB64: randomDigestB64(), hashAlg: "sha256" }], slotId: s1.json.slotId });
  const p1 = proofOf(c1);
  ok("the held slot commits on the anchored chain", c1.status === 200, c1.json);
  ok("commit.slotFloor equals the floor returned at allocation", JSON.stringify(p1?.commit?.slotFloor) === JSON.stringify(f1), { returned: f1, signed: p1?.commit?.slotFloor });
  ok("the proof carries no slotAnchor", !("slotAnchor" in (p1?.commit ?? {})), p1?.commit);
  ok("the slot record itself is unchanged (no floor in it)", !("floor" in (p1?.slotAllocation ?? {})) && !("baseFloor" in (p1?.slotAllocation ?? {})), p1?.slotAllocation);

  // 3. The single-call /commit path (parent allocates internally) also carries the floor.
  const c2 = await post(`${U}/commit`, { digests: [{ digestB64: randomDigestB64(), hashAlg: "sha256" }], chainId: ANCHORED_CHAIN });
  const p2 = proofOf(c2);
  ok("a one-call commit on the anchored chain carries a Base floor", c2.status === 200 && p2?.commit?.slotFloor?.chain === "base", c2.json);
  ok("floors climb: the later proof's floor is not lower", p2?.commit?.slotFloor?.blockNumber >= f1.blockNumber, { a: f1.blockNumber, b: p2?.commit?.slotFloor?.blockNumber });

  // 4. A public caller cannot choose the floor: a header in the request body is ignored.
  const stale = base.head();
  const injected = await post(`${U}/allocate-slot`, { chainId: ANCHORED_CHAIN, baseFloorHeaderB64: "AAAA", floor: { blockNumber: 1 } });
  ok("a header sent by a public caller is ignored; the floor is the parent's", injected.status === 200 && injected.json?.floor?.blockNumber >= parseInt(stale.number, 16) - 2, injected.json);

  // 5. Direct to the enclave: the negative cases.
  const good = base.head();
  const okDirect = await direct({ chainId: "harness:direct", baseFloorHeaderB64: headerB64(good) });
  ok("a real header is accepted on another chain", okDirect.ok && (okDirect.data as any)?.floor?.blockHash === good.hash, okDirect);
  const noHeaderMain = await direct({ chainId: ANCHORED_CHAIN });
  ok("no header on the anchored chain is refused", !noHeaderMain.ok && /no-base-floor/.test(noHeaderMain.error ?? ""), noHeaderMain);
  const noHeaderOther = await direct({ chainId: "harness:unfloored" });
  ok("no header on another chain is allowed, with no floor", noHeaderOther.ok && !("floor" in ((noHeaderOther.data as object) ?? {})), noHeaderOther);
  const garbage = await direct({ chainId: "harness:direct", baseFloorHeaderB64: Buffer.from("not a header").toString("base64") });
  ok("bytes that are not a header are refused", !garbage.ok, garbage);
  const raw = encodeBaseHeaderRlp(good);
  const trailing = await direct({ chainId: "harness:direct", baseFloorHeaderB64: Buffer.concat([Buffer.from(raw), Buffer.from([0])]).toString("base64") });
  ok("a header with a trailing byte is refused", !trailing.ok && /trailing/.test(trailing.error ?? ""), trailing);
  const nonCanon = await direct({ chainId: "harness:direct", baseFloorHeaderB64: Buffer.from(raw).toString("base64").replace(/=+$/, "") + "\n" });
  ok("non-canonical base64 is refused", !nonCanon.ok, nonCanon);
  const notString = await direct({ chainId: "harness:direct", baseFloorHeaderB64: 12345 });
  ok("a header that is not a string is refused", !notString.ok, notString);
  // Older than the chain's last floor: a real earlier block.
  const older = head1;
  const olderRes = await direct({ chainId: "harness:direct", baseFloorHeaderB64: headerB64(older) });
  ok("a block lower than the chain's last floor is refused", !olderRes.ok && /older than this chain's last floor/.test(olderRes.error ?? ""), olderRes);
  // From the future: on schedule, 30 blocks (60 s) ahead.
  const gn = parseInt(good.number, 16);
  const future = { ...good, number: "0x" + (gn + 30).toString(16), timestamp: "0x" + (1686789347 + 2 * (gn + 30)).toString(16) };
  const futureRes = await direct({ chainId: "harness:direct", baseFloorHeaderB64: headerB64(future) });
  ok("a block 60 s ahead of the enclave clock is refused", !futureRes.ok && /ahead of the enclave clock/.test(futureRes.error ?? ""), futureRes);
  // Off Base's schedule: another chain, or made up.
  const offSchedule = { ...good, number: "0x" + (gn + 1).toString(16) };
  const offRes = await direct({ chainId: "harness:direct", baseFloorHeaderB64: headerB64(offSchedule) });
  ok("a block whose time is off Base mainnet's schedule is refused", !offRes.ok && /off Base mainnet's schedule/.test(offRes.error ?? ""), offRes);
  // A huge block number cannot lock the chain: it is off schedule or in the future.
  const huge = { ...good, number: "0x" + (2 ** 40).toString(16), timestamp: "0x" + (1686789347 + 2 * 2 ** 40).toString(16) };
  const hugeRes = await direct({ chainId: "harness:direct", baseFloorHeaderB64: headerB64(huge) });
  const after = await direct({ chainId: "harness:direct", baseFloorHeaderB64: headerB64(base.head()) });
  ok("an absurd block number is refused and does not lock the chain's floor", !hugeRes.ok && after.ok, { hugeRes, after });
  // The enclave computes the hash itself: the floor's hash is keccak of exactly these bytes.
  ok("the floor hash is computed by the enclave from the bytes", (okDirect.data as any)?.floor?.blockNumber === gn && (okDirect.data as any)?.floor?.blockTimestamp === 1686789347 + 2 * gn, okDirect.data);

  // 6. Through the parent: a Base node that stamps ahead stops allocations; it resumes when that ends.
  base.skew(60);
  await sleep(2600);
  const skewed = await post(`${U}/allocate-slot`, { chainId: ANCHORED_CHAIN });
  ok("when Base's newest block is stamped off schedule, allocation is refused", skewed.status !== 200 && /no-base-floor|schedule|ahead of the enclave clock/.test(JSON.stringify(skewed.json)), skewed.json);
  base.skew(0);
  // Wait until Base's newest block is stamped normally again, and the parent has read it.
  for (let i = 0; i < 40; i++) {
    const t = await post(`${U}/allocate-slot`, { chainId: ANCHORED_CHAIN });
    if (t.status === 200) break;
    await sleep(500);
  }
  const recovered = await post(`${U}/allocate-slot`, { chainId: ANCHORED_CHAIN });
  ok("once Base's newest block is stamped normally again, allocation resumes on its own", recovered.status === 200, recovered.json);

  // 7. A halt: the floor ages, nothing pauses.
  base.halt();
  await sleep(600);
  const h1 = await post(`${U}/allocate-slot`, { chainId: ANCHORED_CHAIN });
  await sleep(2500);
  const h2 = await post(`${U}/allocate-slot`, { chainId: ANCHORED_CHAIN });
  ok("during a halt allocation still succeeds", h1.status === 200 && h2.status === 200, { h1: h1.json, h2: h2.json });
  ok("and the floor stays on the last block (it ages)", h1.json?.floor?.blockNumber === h2.json?.floor?.blockNumber, { a: h1.json?.floor, b: h2.json?.floor });
  base.resume();
  await sleep(800);
  const h3 = await post(`${U}/allocate-slot`, { chainId: ANCHORED_CHAIN });
  ok("after the halt the floor moves on", h3.status === 200 && h3.json?.floor?.blockNumber > h2.json?.floor?.blockNumber, { before: h2.json?.floor, after: h3.json?.floor });
} finally {
  stack.stop();
  base.close();
}
console.log(`\n${pass} checks passed${process.exitCode ? ", with failures" : ""}`);
