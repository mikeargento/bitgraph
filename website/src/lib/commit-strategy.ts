import { commitDigest, commitBatch, type BitGraphProof } from "@/lib/bitgraph";

/**
 * The one seam between the home camera and /actor.
 *
 * Both pages are the same instrument: hash locally, one batched ledger lookup,
 * a results list with every position the bytes hold, the folder check, the
 * export, the rotation hold. They differ in exactly ONE thing, how a digest
 * that is not yet on the ledger gets committed:
 *
 *   home    commitDigest(digest)
 *   /actor  the enclave's nonce, ONE touch, then commitDigest(digest, _, envelope),
 *           the rest of a batch inheriting that assertion through batchContext
 *
 * So the camera takes a strategy for that and owns everything else. ⚠️ /actor
 * used to be a second implementation of the camera and in one evening it
 * produced six bugs that home did not have (a lookup navigating, a heading
 * saying Recorded over lookups, a frame collapsing under its list, a folder
 * drop failing raw, a folder drop trying to MINT 15,184 positions, no wait
 * state). Every one was a duplication symptom. Nothing about recording belongs
 * on a page again; it belongs here or in the camera.
 *
 * Chunking stays the camera's: it calls `chunk` with up to 50 digests at a time
 * so progress is real and each request stays short. A strategy only decides
 * what a chunk costs.
 */
export interface CommitStrategy {
  /** Once before the first commit of a run, with every digest the run will
   *  record. This is where /actor fetches its nonce and takes its one touch,
   *  so a cancelled touch fails HERE, before anything is minted, and the
   *  camera can put the files back the way they were. Home has nothing to do.
   *  `onStatus` names the wait for the proving label ("Waiting for you");
   *  send null when the label should go back to its default. May throw a
   *  TeeRestartingError (name), which the camera holds and retries like any
   *  commit. */
  begin?(digests: string[], onStatus: (label: string | null) => void): Promise<void>;
  /** Record one digest: a solo drop, or a batch of one. */
  one(digest: string): Promise<BitGraphProof>;
  /** Record a chunk of the run, in order; `offset` is its index into the run's
   *  digests as given to `begin`. Returns one proof per digest, same order. */
  chunk(digests: string[], offset: number): Promise<BitGraphProof[]>;
  /** A sentence for the results card when a run fails, or null to stay silent
   *  (the rows already say Error). `phase` says whether the failure came from
   *  `begin` (nothing was minted) or from a commit (some of the run may be). */
  errorMessage?(e: unknown, phase: "begin" | "commit"): string | null;
}

/** Home's: the plain commit, no actor on the proof. An undeclared recording is
 *  not the degraded one; order, slot binding and anchors are identical either
 *  way, only the who differs, and here there is none. */
export const anonymous: CommitStrategy = {
  one: (digest) => commitDigest(digest),
  chunk: (digests) => commitBatch(digests.map((digestB64) => ({ digestB64, hashAlg: "sha256" as const }))),
};
