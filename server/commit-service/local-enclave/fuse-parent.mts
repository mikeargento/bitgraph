// Deliverable 3, parent half: POST /commit under a client-held slot, behind
// FUSE_ENABLED, against the unmodified enclave. Run: node --import tsx/esm fuse-parent.mts
import { startStack, post, randomDigestB64 } from "./lib.mts";
import { verifyProofIntegrity } from "../../../packages/verify/dist/index.js";

let pass = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (!cond) { console.error("FAIL", name, JSON.stringify(detail ?? "").slice(0, 400)); process.exitCode = 1; } else { pass++; console.log("ok  ", name); } };
const forgedSlotId = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");

// ---- flag ON -------------------------------------------------------------
{
  const stack = await startStack({ quiet: true, parentEnv: { FUSE_ENABLED: "true" } });
  const U = stack.parentUrl;
  try {
    const a = await post(`${U}/allocate-slot`, {});
    ok("allocate 200 on bitgraph:main", a.status === 200 && a.json.chainId === "bitgraph:main", a.json);
    const slotId: string = a.json.slotId; const slot = a.json.slot;

    // Someone else allocates and commits in between (the anchor service does this every 12 s).
    const other = await post(`${U}/commit`, { digests: [{ digestB64: randomDigestB64(), hashAlg: "sha256" }], chainId: "bitgraph:main" });
    ok("interleaved ordinary commit 200", other.status === 200);

    const digestB64 = randomDigestB64();
    const c = await post(`${U}/commit`, { digests: [{ digestB64, hashAlg: "sha256" }], slotId, chainId: "bitgraph:main", attribution: { name: "bitgraph-fuse/1", title: "produced/1" } });
    ok("commit under held slot 200", c.status === 200, c.json);
    const proof = Array.isArray(c.json) ? c.json[0] : undefined;
    ok("proof.slotAllocation is the held record", JSON.stringify(proof?.slotAllocation) === JSON.stringify(slot), proof?.slotAllocation);
    ok("commit.nonceB64 is the held slotId", proof?.commit?.nonceB64 === slotId);
    ok("commit.slotCounter equals the held slot counter", proof?.commit?.slotCounter === slot.counter);
    ok("span [N, M] has the other commit inside it", BigInt(slot.counter) < BigInt(other.json[0].commit.counter) && BigInt(other.json[0].commit.counter) < BigInt(proof.commit.counter), { N: slot.counter, other: other.json[0].commit.counter, M: proof.commit.counter });
    ok("proof landed on the anchored chain", proof?.commit?.chainId === "bitgraph:main");
    ok("attribution sealed", proof?.attribution?.name === "bitgraph-fuse/1" && proof?.attribution?.title === "produced/1");
    ok("artifact digest is the submitted digest", proof?.artifact?.digestB64 === digestB64);
    const v = await verifyProofIntegrity({ proof });
    ok("bitgraph-verify accepts the proof (signature + slot binding)", v.valid === true, v);

    const again = await post(`${U}/commit`, { digests: [{ digestB64: randomDigestB64(), hashAlg: "sha256" }], slotId });
    ok("reusing the consumed slot is 409 slot-unavailable", again.status === 409 && again.json?.code === "slot-unavailable", again.json);
    const forged = await post(`${U}/commit`, { digests: [{ digestB64: randomDigestB64(), hashAlg: "sha256" }], slotId: forgedSlotId() });
    ok("a forged slotId is 409 slot-unavailable", forged.status === 409 && forged.json?.code === "slot-unavailable", forged.json);

    const b = await post(`${U}/allocate-slot`, {});
    const two = await post(`${U}/commit`, { digests: [{ digestB64: randomDigestB64(), hashAlg: "sha256" }, { digestB64: randomDigestB64(), hashAlg: "sha256" }], slotId: b.json.slotId });
    ok("held slot with two digests is 400 and does not consume the slot", two.status === 400, two.json);
    const one = await post(`${U}/commit`, { digests: [{ digestB64: randomDigestB64(), hashAlg: "sha256" }], slotId: b.json.slotId });
    ok("that slot still commits afterwards", one.status === 200, one.json);

    const mal = await post(`${U}/commit`, { digests: [{ digestB64: randomDigestB64(), hashAlg: "sha256" }], slotId: "not-a-nonce" });
    ok("malformed slotId is 400", mal.status === 400, mal.json);
    const num = await post(`${U}/commit`, { digests: [{ digestB64: randomDigestB64(), hashAlg: "sha256" }], slotId: 12 });
    ok("non-string slotId is 400", num.status === 400, num.json);

    const plain = await post(`${U}/commit`, { digests: [{ digestB64: randomDigestB64(), hashAlg: "sha256" }], chainId: "bitgraph:main" });
    ok("ordinary commit unchanged with the flag on", plain.status === 200 && !!plain.json[0]?.slotAllocation);
  } finally { stack.stop(); }
}

// ---- flag OFF (today's posture) -------------------------------------------
{
  const stack = await startStack({ quiet: true });
  const U = stack.parentUrl;
  try {
    const a = await post(`${U}/allocate-slot`, {});
    const c = await post(`${U}/commit`, { digests: [{ digestB64: randomDigestB64(), hashAlg: "sha256" }], slotId: a.json.slotId });
    ok("flag off: a held slotId is refused with 400, never silently replaced", c.status === 400 && /not enabled/.test(c.json?.error ?? ""), c.json);
    const plain = await post(`${U}/commit`, { digests: [{ digestB64: randomDigestB64(), hashAlg: "sha256" }], chainId: "bitgraph:main" });
    ok("flag off: ordinary commit 200", plain.status === 200);
  } finally { stack.stop(); }
}
console.log(`\n${pass} checks passed${process.exitCode ? ", with failures" : ""}`);
