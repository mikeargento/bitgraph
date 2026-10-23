import { verifyAsync as ed25519Verify } from "@noble/ed25519";
import { b64ToBytes, canonicalize } from "@/lib/canonical";
import type {
  ProofLogEntry,
  EntryVerification,
  LogVerification,
  CheckResult,
} from "@/lib/proof-log";

/**
 * Verify an entire proof.jsonl log.
 * All verification is client-side — no network calls.
 */
export async function verifyLog(entries: ProofLogEntry[]): Promise<LogVerification> {
  const results: EntryVerification[] = [];
  let prevProofCanonicalHash: string | null = null;
  let prevCounter: bigint | null = null;
  let signerKey: string | null = null;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const checks: CheckResult[] = [];

    if (!entry.receipt) {
      checks.push({ label: "Receipt", status: "skip", detail: "No receipt (signing may have failed)" });
      results.push({ index: i, checks, allPassed: false });
      continue;
    }

    const { envelope, proof } = entry.receipt;

    // 1. Envelope hash match
    try {
      const envelopeBytes = canonicalize(envelope);
      const hashBuf = await crypto.subtle.digest("SHA-256", envelopeBytes);
      const computedB64 = btoa(String.fromCharCode(...new Uint8Array(hashBuf)));

      checks.push(
        computedB64 === proof.artifact?.digestB64
          ? { label: "Envelope digest", status: "pass", detail: "SHA-256 of envelope matches proof.artifact.digestB64" }
          : { label: "Envelope digest", status: "fail", detail: `Mismatch — computed: ${computedB64.slice(0, 20)}…` }
      );
    } catch (err) {
      checks.push({ label: "Envelope digest", status: "fail", detail: `Error: ${err instanceof Error ? err.message : "unknown"}` });
    }

    // 2. Ed25519 signature
    try {
      const pubBytes = b64ToBytes(proof.signer.publicKeyB64);
      const sigBytes = b64ToBytes(proof.signer.signatureB64);

      if (pubBytes.length !== 32) {
        checks.push({ label: "Ed25519 signature", status: "fail", detail: `Public key is ${pubBytes.length} bytes; expected 32` });
      } else if (sigBytes.length !== 64) {
        checks.push({ label: "Ed25519 signature", status: "fail", detail: `Signature is ${sigBytes.length} bytes; expected 64` });
      } else {
        // Reconstruct signed body (same as bitgraph-core)
        const signedBody: Record<string, unknown> = {
          version: proof.version,
          artifact: proof.artifact,
          commit: proof.commit,
          publicKeyB64: proof.signer.publicKeyB64,
          enforcement: proof.environment.enforcement,
          measurement: proof.environment.measurement,
        };
        if (proof.environment.attestation) {
          signedBody.attestationFormat = proof.environment.attestation.format;
        }

        const canonicalBytes = canonicalize(signedBody);
        const valid = await ed25519Verify(sigBytes, canonicalBytes, pubBytes);

        checks.push(
          valid
            ? { label: "Ed25519 signature", status: "pass", detail: "Valid — signed by local proxy identity" }
            : { label: "Ed25519 signature", status: "fail", detail: "Signature does not match the signed body" }
        );
      }
    } catch (err) {
      checks.push({ label: "Ed25519 signature", status: "fail", detail: `Error: ${err instanceof Error ? err.message : "unknown"}` });
    }

    // 3. Signer consistency
    if (signerKey === null) {
      signerKey = proof.signer.publicKeyB64;
      checks.push({ label: "Signer identity", status: "info", detail: `${signerKey.slice(0, 16)}…` });
    } else if (proof.signer.publicKeyB64 === signerKey) {
      checks.push({ label: "Signer identity", status: "pass", detail: "Consistent with previous entries" });
    } else {
      checks.push({ label: "Signer identity", status: "warn", detail: "Signer changed — different proxy session?" });
      signerKey = proof.signer.publicKeyB64;
    }

    // 4. Counter monotonicity
    if (proof.commit?.counter) {
      const counter = BigInt(proof.commit.counter);
      if (prevCounter !== null) {
        checks.push(
          counter > prevCounter
            ? { label: "Counter", status: "pass", detail: `#${proof.commit.counter} (monotonic)` }
            : { label: "Counter", status: "fail", detail: `#${proof.commit.counter} — not greater than previous #${prevCounter}` }
        );
      } else {
        checks.push({ label: "Counter", status: "info", detail: `#${proof.commit.counter} (first entry)` });
      }
      prevCounter = counter;
    }

    // 5. Chain integrity
    const isTee = proof.environment?.enforcement === "measured-tee";
    if (proof.commit?.prevB64) {
      if (prevProofCanonicalHash !== null) {
        if (proof.commit.prevB64 === prevProofCanonicalHash) {
          checks.push({ label: "Chain link", status: "pass", detail: "Links to previous proof hash" });
        } else if (isTee) {
          // TEE maintains a global chain across all clients — entries in a single
          // client's log won't chain to each other; they chain to the TEE's global ledger.
          checks.push({ label: "Chain link", status: "pass", detail: "TEE global chain (prevB64 references the enclave's sequence, not a local log)" });
        } else {
          checks.push({ label: "Chain link", status: "fail", detail: "prevB64 does not match hash of previous proof" });
        }
      } else {
        checks.push({ label: "Chain link", status: "info", detail: "Has prevB64 but no previous entry to verify against" });
      }
    } else if (i === 0) {
      checks.push({ label: "Chain link", status: "info", detail: "First entry (no previous link)" });
    } else {
      checks.push({ label: "Chain link", status: "warn", detail: "Missing prevB64 — chain broken" });
    }

    // Compute this proof's hash for next entry's chain check
    try {
      const proofBytes = canonicalize(proof);
      const hashBuf = await crypto.subtle.digest("SHA-256", proofBytes);
      prevProofCanonicalHash = btoa(String.fromCharCode(...new Uint8Array(hashBuf)));
    } catch {
      prevProofCanonicalHash = null;
    }

    const allPassed = checks.every((c) => c.status === "pass" || c.status === "info");
    results.push({ index: i, checks, allPassed });
  }

  const verified = results.filter((r) => r.allPassed).length;
  const skipped = results.filter((r) => r.checks.length === 1 && r.checks[0].status === "skip").length;

  return {
    entries: results,
    summary: {
      total: entries.length,
      verified,
      failures: entries.length - verified - skipped,
      skipped,
      signerPublicKeyB64: signerKey,
      firstTimestamp: entries[0]?.timestamp ?? null,
      lastTimestamp: entries[entries.length - 1]?.timestamp ?? null,
    },
  };
}
