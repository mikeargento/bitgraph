// Mints the Fuse test fixtures through the unmodified enclave (local harness).
// Run: node --import tsx/esm make-fuse-fixtures.mts
// Output: ../../../src/__tests__/fuse-fixtures/ (real signatures, fake PCR0).
import { startStack, post } from "./lib.mts";
import * as F from "../../../packages/verify/dist/index.js";
import { sha256 } from "@noble/hashes/sha256";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "..", "..", "src", "__tests__", "fuse-fixtures");
mkdirSync(OUT, { recursive: true });
const b64 = F.bytesToBase64;
const write = (name: string, data: Uint8Array | string) => writeFileSync(join(OUT, name), data);
const writeJson = (name: string, obj: unknown) => write(name, JSON.stringify(obj, null, 2) + "\n");

const original = new TextEncoder().encode("BitGraph fixture: an original file that already exists.\nLine two.\n");
const png = F.base64ToBytes("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==")!;
const originDigest = sha256(original);
const pngDigest = sha256(png);
const trailer = F.getPlacement("trailer/1")!;
const container = F.getPlacement("container/1")!;
const produced = F.getPlacement("produced/1")!;

const stack = await startStack({ quiet: true, parentEnv: { FUSE_ENABLED: "true" } });
const U = stack.parentUrl;
async function allocate(): Promise<{ slotId: string; slot: F.SlotAllocation }> {
  const r = await post(`${U}/allocate-slot`, {});
  if (r.status !== 200) throw new Error("allocate: " + JSON.stringify(r.json));
  return r.json;
}
async function commitPlain(bytes: Uint8Array) {
  const r = await post(`${U}/commit`, { digests: [{ digestB64: b64(sha256(bytes)), hashAlg: "sha256" }], chainId: "bitgraph:main" });
  if (r.status !== 200) throw new Error("commit: " + JSON.stringify(r.json));
  return r.json[0];
}
async function commitFused(fused: Uint8Array, slotId: string, attribution: unknown) {
  const r = await post(`${U}/commit`, { digests: [{ digestB64: b64(sha256(fused)), hashAlg: "sha256" }], slotId, chainId: "bitgraph:main", attribution });
  if (r.status !== 200) throw new Error("fused commit: " + JSON.stringify(r.json));
  return r.json[0];
}
const vec = (slot: F.SlotAllocation) => ({
  slot,
  canonicalSlotBody: new TextDecoder().decode(F.canonicalize(F.canonicalSlotBody(slot))),
  slotRecordHashHex: F.bytesToHex(F.computeSlotRecordHash(slot)),
  preimageHex: F.bytesToHex(F.slotCommitmentPreimage(slot)),
  commitmentHex: F.bytesToHex(F.computeSlotCommitment(slot)),
});

try {
  write("original.txt", original);
  write("image.png", png);

  // 1. An ordinary recording of the original.
  const recorded = await commitPlain(original);
  writeJson("recorded.proof.json", recorded);

  // 2. trailer/1 over the original, origin declared in the signed attribution.
  const A = await allocate();
  const fusedT = trailer.build({ original, commitment: F.computeSlotCommitment(A.slot) });
  const trailerProof = await commitFused(fusedT, A.slotId, F.fuseAttribution("trailer/1", originDigest));
  write("fused-trailer.bin", fusedT);
  writeJson("trailer.proof.json", trailerProof);
  writeJson("trailer.bitgraph-fuse.json", F.buildFrame({ proof: trailerProof, placement: "trailer/1", artifactDigest: sha256(fusedT), originDigest, fusedFile: "fused-trailer.bin" }));

  // 3. container/1 over the PNG.
  const B = await allocate();
  const fusedC = container.build({ original: png, originDigest: pngDigest, commitment: F.computeSlotCommitment(B.slot) });
  const containerProof = await commitFused(fusedC, B.slotId, F.fuseAttribution("container/1", pngDigest));
  write("fused-container.tar", fusedC);
  writeJson("container.proof.json", containerProof);
  writeJson("container.bitgraph-fuse.json", F.buildFrame({ proof: containerProof, placement: "container/1", artifactDigest: sha256(fusedC), originDigest: pngDigest, fusedFile: "fused-container.tar" }));

  // 4. produced/1 (Form C) naming the original as its source.
  const C = await allocate();
  const prodO = produced.build({ originDigest, commitment: F.computeSlotCommitment(C.slot) });
  const producedOriginProof = await commitFused(prodO, C.slotId, F.fuseAttribution("produced/1", originDigest));
  write("produced-origin.json", prodO);
  writeJson("produced-origin.proof.json", producedOriginProof);
  writeJson("produced-origin.bitgraph-fuse.json", F.buildFrame({ proof: producedOriginProof, placement: "produced/1", artifactDigest: sha256(prodO), originDigest, fusedFile: "produced-origin.json", fusePayload: prodO }));

  // 5. produced/1 with no source.
  const D = await allocate();
  const prodB = produced.build({ commitment: F.computeSlotCommitment(D.slot) });
  const producedBareProof = await commitFused(prodB, D.slotId, F.fuseAttribution("produced/1"));
  write("produced-bare.json", prodB);
  writeJson("produced-bare.proof.json", producedBareProof);

  // 6. trailer/1 with the origin NOT declared in the attribution (manifest-only hint case).
  const E = await allocate();
  const fusedU = trailer.build({ original, commitment: F.computeSlotCommitment(E.slot) });
  const undeclaredProof = await commitFused(fusedU, E.slotId, F.fuseAttribution("trailer/1"));
  write("fused-trailer-undeclared.bin", fusedU);
  writeJson("trailer-undeclared.proof.json", undeclaredProof);

  // 7. Wrong slot: the file carries slot H's commitment but is committed under slot G.
  const G = await allocate();
  const H = await allocate();
  const fusedW = trailer.build({ original, commitment: F.computeSlotCommitment(H.slot) });
  const wrongProof = await commitFused(fusedW, G.slotId, F.fuseAttribution("trailer/1", originDigest));
  write("fused-wrong-slot.bin", fusedW);
  writeJson("wrong-slot.proof.json", wrongProof);

  // 8. An unregistered placement id in the signed attribution.
  const I = await allocate();
  const fusedX = trailer.build({ original, commitment: F.computeSlotCommitment(I.slot) });
  const unregProof = await commitFused(fusedX, I.slotId, { name: F.FUSE_ATTRIBUTION_NAME, title: "xmp/9", message: b64(originDigest) });
  write("fused-unregistered.bin", fusedX);
  writeJson("unregistered.proof.json", unregProof);

  // 9. Ordering: slot K allocated first, an ordinary recording J committed while K is held, then K committed.
  const K = await allocate();
  const orderJ = await commitPlain(new TextEncoder().encode("ordering: an ordinary recording committed while a slot was held\n"));
  const fusedK = trailer.build({ original, commitment: F.computeSlotCommitment(K.slot) });
  const orderK = await commitFused(fusedK, K.slotId, F.fuseAttribution("trailer/1", originDigest));
  writeJson("order-held.proof.json", orderJ);
  writeJson("order-fused-during-hold.proof.json", orderK);
  write("fused-order.bin", fusedK);

  // Vectors: one synthetic slot with fixed bytes, plus the real fixtures.
  const synthetic: F.SlotAllocation = {
    version: "bitgraph/slot/1",
    nonceB64: b64(new Uint8Array(32).fill(1)),
    counter: "7",
    epochId: b64(new Uint8Array(32).fill(2)),
    publicKeyB64: b64(new Uint8Array(32).fill(3)),
    chainId: "bitgraph:main",
    signatureB64: b64(new Uint8Array(64).fill(4)),
  };
  writeJson("vectors.json", {
    domainHex: F.bytesToHex(F.FUSE_DOMAIN),
    synthetic: vec(synthetic),
    trailerFixture: { ...vec(A.slot), fusedDigestB64: b64(sha256(fusedT)), originDigestB64: b64(originDigest) },
    containerFixture: { ...vec(B.slot), fusedDigestB64: b64(sha256(fusedC)), originDigestB64: b64(pngDigest) },
    producedOriginFixture: { ...vec(C.slot), payload: new TextDecoder().decode(prodO), fusedDigestB64: b64(sha256(prodO)) },
    producedBareFixture: { ...vec(D.slot), payload: new TextDecoder().decode(prodB), fusedDigestB64: b64(sha256(prodB)) },
  });
  write("README.md", `# Fuse fixtures

Minted through the LOCAL enclave harness (server/commit-service/local-enclave):
the unmodified enclave app.ts with a software NSM. Signatures and slot bindings
are real, under a per-run key; the measurement is the harness's fake PCR0
(ab repeated). These proofs exist on no ledger. Regenerate with
make-fuse-fixtures.mts; every proof and every commitment changes when you do.

No fixture file contains the string "nonce:".
`);
  console.log("fixtures written to", OUT);
} finally {
  stack.stop();
}
