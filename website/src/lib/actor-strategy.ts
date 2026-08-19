import { commitDigest, commitBatch, type AgencyEnvelope, type BitGraphProof } from "@/lib/bitgraph";
import {
  buildAgencyEnvelope,
  requestAssertion,
  type StoredCredential,
  type WebAuthnAssertion,
} from "@/lib/webauthn";
import type { CommitStrategy } from "@/lib/commit-strategy";

/**
 * /actor's commit strategy: the same camera as home, with this device's key on
 * every recording it makes.
 *
 * A declared BitGraph is an ordinary BitGraph plus one thing: a key you hold
 * signed an authorization for that exact file, and the enclave verified that
 * signature against its own single-use nonce before it would record anything.
 *
 * The run is: `begin` fetches the enclave's nonce and takes ONE touch for the
 * whole run; then each commit carries an envelope built from that assertion.
 * The enclave validates the first digest fully (and consumes the nonce), then
 * lets the rest of the run inherit the actor through `batchContext`, so a
 * forty-photo drop asks once, not forty times.
 */

/** The enclave's nonce. Never this browser's: a nonce the caller chose proves
 *  nothing about when the caller chose it, which is exactly why the enclave
 *  keeps its own pending set and consumes each one on first use.
 *
 *  ⚠️ A 503 `tee-restarting` here is rethrown under the same name the commit
 *  path uses, so the camera's rotation hold covers it: during the 23:59 UTC
 *  key renewal the run waits HERE, before the touch, and the touch only
 *  happens once there is a live nonce to sign. */
async function fetchChallenge(): Promise<string> {
  const res = await fetch("/api/challenge", { method: "POST" });
  if (!res.ok) {
    const e = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    if (res.status === 503 && e.code === "tee-restarting") {
      const held = new Error(e.error || "The camera is restarting");
      held.name = "TeeRestartingError";
      throw held;
    }
    throw new Error(e.error || "Could not reach the camera");
  }
  return ((await res.json()) as { challenge: string }).challenge;
}

/** How many single-digest requests are in flight at once for the tail of a
 *  large run. The enclave serialises commits anyway (one monotonic counter),
 *  so this only overlaps the HTTP round trips. */
const LATER_CHUNK_CONCURRENCY = 6;

export function makeActorStrategy(cred: StoredCredential): CommitStrategy {
  /** The run in progress: one nonce, one assertion, every digest the run
   *  covers (the enclave's `remaining` set is built from this list). */
  let run: { challenge: string; assertion: WebAuthnAssertion; digests: string[] } | null = null;

  const envelope = (digest: string, index: number | null): AgencyEnvelope => {
    if (!run) throw new Error("Recording was not started");
    const env = buildAgencyEnvelope(cred, run.assertion, digest, run.challenge);
    // batchContext only on a run of more than one: a solo envelope is the
    // plain single-artifact path, and the enclave stores a batch only when
    // batchDigests has more than one entry anyway.
    if (index !== null && run.digests.length > 1) {
      env.batchContext = { batchSize: run.digests.length, batchIndex: index, batchDigests: run.digests };
    }
    return env;
  };

  return {
    async begin(digests, onStatus) {
      run = null;
      onStatus("Waiting for the camera");
      // Hash first, THEN the nonce (the camera has already hashed by now): it
      // lives 60 seconds and the authorization's timestamp must land inside
      // that window, so a nonce fetched before a long hashing pass would be
      // dead on arrival.
      const challenge = await fetchChallenge();
      onStatus("Waiting for you");
      try {
        const assertion = await requestAssertion(challenge, cred.credentialIdB64);
        run = { challenge, assertion, digests };
      } finally {
        onStatus(null);
      }
    },

    one(digest) {
      return commitDigest(digest, undefined, envelope(digest, null));
    },

    async chunk(digests, offset) {
      /* ⚠️ The two shapes below are forced by how the parent numbers a request,
         and the split is what makes a run of any size work with the server
         as it is (server/commit-service/src/parent/server.ts, "Agency with
         batch support"):

         - A MULTI-digest request is renumbered by the parent: it sends the
           enclave batchIndex 0, 1, 2… for that request's digests whatever the
           client wrote. Index 0 means "validate fully against the nonce", and
           the nonce is single-use. So only the FIRST chunk of a run can go as
           one request; a second multi-digest request would present a spent
           nonce for re-validation and fail whole.
         - A SINGLE-digest request passes the client's batchContext through
           untouched, so a later chunk goes as one request per digest, each
           carrying its true index into the run, and every one of them takes
           the enclave's continuation path (nonce lookup + "is this digest in
           the authorised batch").

         Up to 50 files is therefore ONE request, exactly home's shape and
         speed. Past 50, each remaining digest is its own request, a few at a
         time. ⚠️ The enclave keeps the validated batch for 60s from the first
         chunk, so a run much past a few hundred files can find its tail
         refused ("batch not found"); the camera shows those rows as Error and
         offers to record them again, which costs one more touch. The real fix
         is one line in the parent (respect the client's batchIndex offset on
         multi-digest requests), after which every chunk can be one request;
         that is a host deploy, not a site change, and is not done here. */
      if (offset === 0) {
        return commitBatch(
          digests.map((digestB64) => ({ digestB64, hashAlg: "sha256" as const })),
          undefined,
          envelope(digests[0], 0),
        );
      }
      const out: BitGraphProof[] = new Array(digests.length);
      let next = 0;
      const worker = async () => {
        while (next < digests.length) {
          const j = next++;
          out[j] = await commitDigest(digests[j], undefined, envelope(digests[j], offset + j));
        }
      };
      await Promise.all(Array.from({ length: Math.min(LATER_CHUNK_CONCURRENCY, digests.length) }, worker));
      return out;
    },

    errorMessage(e, phase) {
      const message = e instanceof Error ? e.message : String(e);
      // The failures worth naming, because each is recoverable and none is
      // the visitor's fault. ⚠️ Anything else gets a written sentence, never
      // the raw string: a folder drop once surfaced "A requested file or
      // directory could not be found at the time an operation was
      // processed", a DOMException talking to itself.
      if (phase === "begin") {
        if (/NotAllowed|cancel/i.test(message)) return "Nothing was recorded: the authorization was cancelled.";
        return "Nothing was recorded: the camera could not be reached. Try again.";
      }
      if (/challenge|batch not found|Agency/i.test(message)) {
        return "That authorization expired before the camera had every file. The rest can be recorded again.";
      }
      return "Recording stopped partway. The files still unrecorded can be recorded again.";
    },
  };
}
