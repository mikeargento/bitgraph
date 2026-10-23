// Mints the bitgraph-fuse/2 test fixtures through the unmodified enclave (local harness, v9).
// Run: node --import tsx/esm make-fuse2-fixtures.mts
// Output: ../../../src/__tests__/fuse2-fixtures/ (real signatures, fake PCR0, harness anchor).
import { startStack, post } from "./lib.mts";
import * as F from "../../../packages/verify/dist/index.js";
import { sha256 } from "@noble/hashes/sha256";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "..", "..", "src", "__tests__", "fuse2-fixtures");
mkdirSync(OUT, { recursive: true });
const b64 = F.bytesToBase64;
const write = (name: string, data: Uint8Array | string) => writeFileSync(join(OUT, name), data);
const writeJson = (name: string, obj: unknown) => write(name, JSON.stringify(obj, null, 2) + "\n");

const original = new TextEncoder().encode("BitGraph fuse/2 fixture: an original file that already exists.\n");
const originDigest = sha256(original);
const trailer = F.getPlacement("trailer/1")!;

const stack = await startStack({ quiet: true, anchor: true, parentEnv: { FUSE_ENABLED: "true" } });
const U = stack.parentUrl;
type Alloc = { slotId: string; slot: F.SlotAllocation; anchor?: { counter: string; blockNumber: number; blockHash: string } };
async function allocate(): Promise<Alloc> {
  const r = await post(`${U}/allocate-slot`, { chainId: "bitgraph:main" });
  if (r.status !== 200) throw new Error("allocate: " + JSON.stringify(r.json));
  return r.json;
}
async function commitFused(fused: Uint8Array, slotId: string, attribution: unknown) {
  const r = await post(`${U}/commit`, { digests: [{ digestB64: b64(sha256(fused)), hashAlg: "sha256" }], slotId, chainId: "bitgraph:main", attribution });
  if (r.status !== 200) throw new Error("fused commit: " + JSON.stringify(r.json));
  return r.json[0];
}

try {
  write("original.txt", original);

  // 1. trailer/1 over the original, commitment/2, marker fuse/2.
  const A = await allocate();
  if (!A.anchor) throw new Error("the v9 enclave returned no anchor with the allocation");
  const { commitment, version } = F.producerCommitment(A.slot, A.anchor);
  if (version !== 2) throw new Error("expected a fuse/2 commitment");
  const fused = trailer.build({ original, commitment });
  const proof = await commitFused(fused, A.slotId, F.fuseAttribution("trailer/1", originDigest, 2));
  if (JSON.stringify(proof.commit.slotAnchor) !== JSON.stringify(A.anchor)) throw new Error("signed slotAnchor differs from the anchor returned at allocation");
  write("fused2-trailer.bin", fused);
  writeJson("trailer2.proof.json", proof);
  writeJson("trailer2.vector.json", {
    slot: A.slot,
    floorBlockHash: A.anchor.blockHash,
    slotRecordHashHex: F.bytesToHex(F.computeSlotRecordHash(A.slot)),
    preimageHex: F.bytesToHex(F.slotCommitment2Preimage(A.slot, A.anchor.blockHash)),
    commitmentHex: F.bytesToHex(commitment),
    fuse1CommitmentHex: F.bytesToHex(F.computeSlotCommitment(A.slot)),
  });

  // 2. A made file (inline base64url) carrying commitment/2.
  const B = await allocate();
  const c2 = F.producerCommitment(B.slot, B.anchor).commitment;
  const made = new TextEncoder().encode(`Task: summarize the fixture.\nPosition commitment: ${b64(c2).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}\n`);
  const madeProof = await commitFused(made, B.slotId, F.inlineAttribution(2));
  write("made2.txt", made);
  writeJson("made2.proof.json", madeProof);

  // 3. NEGATIVE: marker says fuse/2, bytes carry the fuse/1 commitment. Must not verify as fused.
  const C = await allocate();
  const wrong = trailer.build({ original, commitment: F.computeSlotCommitment(C.slot) });
  const wrongProof = await commitFused(wrong, C.slotId, F.fuseAttribution("trailer/1", originDigest, 2));
  write("fused2-wrong-commitment.bin", wrong);
  writeJson("wrong2.proof.json", wrongProof);

  // 4. Control: a fuse/1 file from the same v9 enclave still verifies as before.
  const D = await allocate();
  const fused1 = trailer.build({ original, commitment: F.computeSlotCommitment(D.slot) });
  const proof1 = await commitFused(fused1, D.slotId, F.fuseAttribution("trailer/1", originDigest));
  write("fused1-trailer.bin", fused1);
  writeJson("trailer1.proof.json", proof1);

  console.log("fuse/2 fixtures written to", OUT);
} finally {
  stack.stop();
}
