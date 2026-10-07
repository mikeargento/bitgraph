// Mints the bitgraph-fuse/3 test fixtures through the unmodified enclave (local harness, v10):
// the floor is a Base block the enclave fixed at allocation (commit.slotFloor), from the
// stand-in Base node in lib.mts.
// Run: node --import tsx/esm make-fuse3-fixtures.mts
// Output: ../../../src/__tests__/fuse3-fixtures/ (real signatures, fake PCR0, stand-in Base).
import { startStack, post } from "./lib.mts";
import * as F from "../../../packages/verify/dist/index.js";
import { sha256 } from "@noble/hashes/sha256";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "..", "..", "src", "__tests__", "fuse3-fixtures");
mkdirSync(OUT, { recursive: true });
const b64 = F.bytesToBase64;
const write = (name: string, data: Uint8Array | string) => writeFileSync(join(OUT, name), data);
const writeJson = (name: string, obj: unknown) => write(name, JSON.stringify(obj, null, 2) + "\n");

const original = new TextEncoder().encode("BitGraph fuse/3 fixture: an original file that already exists.\n");
const originDigest = sha256(original);
const trailer = F.getPlacement("trailer/1")!;

const stack = await startStack({ quiet: true, parentEnv: { FUSE_ENABLED: "true" } });
const U = stack.parentUrl;
type Floor = { chain: "base"; evmChainId: 8453; blockNumber: number; blockHash: string; blockTimestamp: number };
type Alloc = { slotId: string; slot: F.SlotAllocation; floor?: Floor; anchor?: unknown };
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

  // 1. trailer/1 over the original, commitment/3, marker fuse/3.
  const A = await allocate();
  if (!A.floor) throw new Error("the v10 enclave returned no Base floor with the allocation");
  if (A.anchor) throw new Error("the v10 enclave returned an Ethereum anchor beside the Base floor");
  const { commitment, version } = F.producerCommitment(A.slot, A.floor);
  if (version !== 3) throw new Error("expected a fuse/3 commitment");
  const fused = trailer.build({ original, commitment });
  const proof = await commitFused(fused, A.slotId, F.fuseAttribution("trailer/1", originDigest, 3));
  if (JSON.stringify(proof.commit.slotFloor) !== JSON.stringify(A.floor)) throw new Error("signed slotFloor differs from the floor returned at allocation");
  if (proof.commit.slotAnchor) throw new Error("a v10 proof signed an Ethereum floor too");
  write("fused3-trailer.bin", fused);
  writeJson("trailer3.proof.json", proof);
  writeJson("trailer3.vector.json", {
    slot: A.slot,
    floorBlockHash: A.floor.blockHash,
    slotRecordHashHex: F.bytesToHex(F.computeSlotRecordHash(A.slot)),
    preimageHex: F.bytesToHex(F.slotCommitment3Preimage(A.slot, A.floor.blockHash)),
    commitmentHex: F.bytesToHex(commitment),
    fuse2CommitmentHex: F.bytesToHex(F.computeSlotCommitment2(A.slot, A.floor.blockHash)),
    fuse1CommitmentHex: F.bytesToHex(F.computeSlotCommitment(A.slot)),
  });

  // 2. A made file (inline base64url) carrying commitment/3.
  const B = await allocate();
  const c3 = F.producerCommitment(B.slot, B.floor).commitment;
  const made = new TextEncoder().encode(`Task: summarize the fixture.\nPosition commitment: ${b64(c3).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}\n`);
  const madeProof = await commitFused(made, B.slotId, F.inlineAttribution(3));
  write("made3.txt", made);
  writeJson("made3.proof.json", madeProof);

  // 3. NEGATIVE: marker says fuse/2 over a Base floor; the bytes carry commitment/2 of the Base hash.
  //    A fuse/2 proof must bind an Ethereum slotAnchor, and this one has none: refused.
  const C = await allocate();
  const asIf2 = trailer.build({ original, commitment: F.computeSlotCommitment2(C.slot, C.floor!.blockHash) });
  const wrong2Proof = await commitFused(asIf2, C.slotId, F.fuseAttribution("trailer/1", originDigest, 2));
  write("fused3-as-fuse2.bin", asIf2);
  writeJson("as-fuse2.proof.json", wrong2Proof);

  // 4. NEGATIVE: marker says fuse/3, bytes carry the fuse/1 commitment.
  const D = await allocate();
  const wrong = trailer.build({ original, commitment: F.computeSlotCommitment(D.slot) });
  const wrongProof = await commitFused(wrong, D.slotId, F.fuseAttribution("trailer/1", originDigest, 3));
  write("fused3-wrong-commitment.bin", wrong);
  writeJson("wrong3.proof.json", wrongProof);

  console.log("fuse/3 fixtures written to", OUT);
} finally {
  stack.stop();
}
