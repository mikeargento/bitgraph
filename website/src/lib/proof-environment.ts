/**
 * The attestation, sent once instead of once per proof.
 *
 * ⚠️ WHY THIS EXISTS. A drop of files that are all on record answers with the
 * whole proof for every position, and a proof's `environment` holds the Nitro
 * attestation document: about 6 KB, and IDENTICAL for every proof written in
 * the same epoch. Measured against the real 48,000 file folder on 2026-09-07,
 * re-dropped so every digest hit:
 *
 *   2,000 digests -> 4,000 proofs -> 37.4 MB of JSON, 18.7 KB per file,
 *   and exactly TWO distinct environment values among those 4,000 proofs.
 *
 * 24.1 MB of that 37.4 MB, 64 percent, was two blobs repeated 4,000 times.
 * Across the 24 requests a 48,000 file re-drop is ~900 MB for the browser to
 * decompress, parse and hold, which is what "checking takes FOREVER" was
 * (Mike, 2026-09-07). The server was never the slow part: the S3 reads finish
 * in a few seconds, and asking Vercel to compress the result made the request
 * SLOWER, 30.2s against 19.4s, because 37 MB of brotli is not free either.
 *
 * So the fix is at the source, and it is the side table this route already
 * uses for set manifests: send each distinct environment once, name it from
 * the entry, and put it back before anything reads the proof.
 *
 * ⚠️ RESTORATION MUST BE EXACT. These proofs are exported as proof.json for a
 * skeptic to verify, and `environment` carries `enforcement` and `measurement`
 * which are inside the signed body and inside `computeProofHash`'s frozen
 * subset. `attach` puts the same object back under the same key, so a restored
 * proof is byte-identical to the one the ledger holds. A proof whose reference
 * cannot be resolved is left exactly as it arrived rather than half-built.
 */

/** Entries as they travel: the proof, plus the name of the environment lifted out of it. */
export interface EnvelopeEntry {
  proof: Record<string, unknown>;
  /** Set when `environment` was lifted into the side table under this key. */
  envRef?: string;
}
type Results = Record<string, { proofs?: EnvelopeEntry[] } | undefined>;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Lift every distinct `environment` out of `results` into a table.
 *
 * Server side. Mutates the proofs in place (they are freshly parsed per
 * request and go straight out on the wire) and returns the table to send
 * alongside. Returns an empty table when there is nothing to gain, so the
 * field can simply be omitted.
 */
export function splitEnvironments(
  results: Results,
  digest: (json: string) => string,
): Record<string, Record<string, unknown>> {
  const table: Record<string, Record<string, unknown>> = {};
  const seen = new Map<string, string>();
  for (const r of Object.values(results)) {
    for (const e of r?.proofs ?? []) {
      if (!isPlainObject(e.proof)) continue;
      const env = e.proof["environment"];
      if (!isPlainObject(env)) continue;
      // Key by content: identical environments collapse to one entry no
      // matter which epoch or position they came from.
      const json = JSON.stringify(env);
      let key = seen.get(json);
      if (key === undefined) {
        key = digest(json);
        seen.set(json, key);
        table[key] = env;
      }
      delete e.proof["environment"];
      e.envRef = key;
    }
  }
  return table;
}

/**
 * Put every lifted `environment` back, in place.
 *
 * Client side, and it must run before anything reads a proof: a signature
 * check, an export, a page. Returns how many were restored, and how many
 * could not be, so a caller that cares can tell the difference between
 * "nothing was lifted" and "the table was incomplete".
 */
export function attachEnvironments(
  results: Results,
  environments: Record<string, Record<string, unknown>> | undefined,
): { attached: number; unresolved: number } {
  let attached = 0;
  let unresolved = 0;
  for (const r of Object.values(results)) {
    for (const e of r?.proofs ?? []) {
      if (typeof e.envRef !== "string" || !isPlainObject(e.proof)) continue;
      const env = environments?.[e.envRef];
      if (!isPlainObject(env)) {
        // Leave the proof as it arrived. It is short an `environment`, which
        // a verifier will refuse, and that is the honest outcome: a proof
        // that cannot be rebuilt must not look like one that verified.
        unresolved++;
        continue;
      }
      e.proof["environment"] = env;
      delete e.envRef;
      attached++;
    }
  }
  return { attached, unresolved };
}
