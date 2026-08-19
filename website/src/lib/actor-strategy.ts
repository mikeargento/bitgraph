import { commitDigest, commitBatch, type AgencyEnvelope } from "@/lib/bitgraph";
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

    chunk(digests, offset) {
      /* Every chunk is ONE request, exactly home's shape and speed. The
         envelope's batchIndex is this chunk's OFFSET into the run; the parent
         numbers the request's digests from it (server/commit-service/src/
         parent/server.ts, "Agency with batch support", deployed 2026-08-19).
         Index 0 alone validates fully against the single-use nonce and opens
         the batch in the enclave; every later index takes the continuation
         path (nonce lookup + "is this digest on the authorised list"). The
         camera sends chunks in order, so the first chunk has opened the batch
         before the second arrives.

         ⚠️ The envelope's artifactHash is the RUN's first digest on EVERY
         chunk, never the chunk's own first digest. The enclave stores the
         envelope it is handed on each proof of the request, and the published
         verifier accepts a continuation proof only when artifactHash is its
         own digest or the run's first digest (batchDigests[0]) with its digest
         on the list (packages/verify, "artifactHash matches"). A chunk's own
         first digest there minted four permanent actor blocks that every
         reader rejects (#11647, #11649, #11651, #11653, 2026-08-19): the
         enclave does not re-check artifactHash on the continuation path, so
         the client alone keeps this shape honest.

         ⚠️ Before the parent change, a multi-digest request was renumbered
         from 0 whatever the client wrote, so a second chunk presented a spent
         nonce and failed whole; the tail then had to go one request per
         digest. Do not bring that shape back against a parent that respects
         the offset, and do not ship this shape against one that does not.

         ⚠️ The enclave keeps the validated batch for 60s from the first
         chunk. At the camera's ~50 commits a second that covers a few
         thousand files; a run past that can find its tail refused ("batch
         not found"), which the camera shows as Error and offers to record
         again, at the cost of one more touch. */
      if (!run) throw new Error("Recording was not started");
      return commitBatch(
        digests.map((digestB64) => ({ digestB64, hashAlg: "sha256" as const })),
        undefined,
        envelope(run.digests[0], offset),
      );
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
