import { NextRequest, NextResponse } from "next/server";
import { verifyProofIntegrity } from "@mikeargento/bitgraph-verify";
import { getProofsByDigest } from "@/lib/s3";
import { fromUrlSafeB64, toUrlSafeB64 } from "@/lib/explorer";

export const dynamic = "force-dynamic";

/**
 * POST /api/verify: server-side proof verification.
 *
 * This exists for callers that cannot run a verifier themselves. No-code
 * automation platforms are the case that motivated it: a Make scenario built
 * from HTTP modules has no way to execute @mikeargento/bitgraph-verify, so
 * without this endpoint it can record and retrieve but never check.
 *
 * It delegates to that same MIT package rather than reimplementing anything,
 * so this endpoint and the offline verifier can never drift apart. Everything
 * it does, a stranger can redo on their own machine against the returned
 * proof, and the response says so: a verdict from the service that issued the
 * proof is a convenience, not evidence, and the response should not be
 * mistaken for the latter.
 *
 * Read-only. Nothing here writes to the ledger.
 *
 * Body:
 *   proof?               a bitgraph/1 proof object to verify
 *   digest?              artifact SHA-256, base64 (either form) or hex.
 *                        Without `proof`, the ledger's proof for it is fetched.
 *                        With `proof`, it is also compared against the proof's
 *                        own artifact digest to establish artifact binding.
 *   allowedMeasurements? string[] of accepted PCR0 values
 *   requireSlot?         default true
 *   requireEpochId?      default true
 */

interface VerifyBody {
  proof?: unknown;
  digest?: string;
  allowedMeasurements?: string[];
  requireSlot?: boolean;
  requireEpochId?: boolean;
}

const bad = (error: string) => NextResponse.json({ error }, { status: 400 });

/**
 * Accept a digest in any of the three forms a caller might hold and return
 * standard base64, the form stored inside proofs. Hex is checked first: 64 hex
 * characters are also 64 valid base64 characters, so decoding in the other
 * order would silently produce 48 wrong bytes instead of the right 32.
 */
function normalizeDigest(input: string): string | null {
  const s = input.trim();
  if (/^[0-9a-fA-F]{64}$/.test(s)) return Buffer.from(s, "hex").toString("base64");
  const standard = fromUrlSafeB64(s);
  if (!/^[A-Za-z0-9+/]{43}=$/.test(standard)) return null;
  return Buffer.from(standard, "base64").length === 32 ? standard : null;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as VerifyBody | null;
    if (body === null || typeof body !== "object") return bad("Body must be JSON.");

    const hasProof = body.proof !== undefined && body.proof !== null;
    const hasDigest = typeof body.digest === "string" && body.digest.trim().length > 0;
    if (!hasProof && !hasDigest) {
      return bad("Provide a proof object, a digest, or both.");
    }

    let claimedDigest: string | null = null;
    if (hasDigest) {
      claimedDigest = normalizeDigest(body.digest as string);
      if (claimedDigest === null) {
        return bad("digest must be a SHA-256 as 64 hex characters or 32 bytes in base64 (standard or URL-safe).");
      }
    }

    // Where the proof came from changes what a valid verdict means, so it is
    // reported back: from the ledger says these bytes are on record here, from
    // the request says only that the object itself checks out.
    let proof: Record<string, unknown> | null = null;
    let checkedAgainst: "ledger" | "supplied proof";
    let onRecord = false;
    let totalPositions = 0;

    if (hasProof) {
      if (typeof body.proof !== "object" || Array.isArray(body.proof)) {
        return bad("proof must be a JSON object.");
      }
      proof = body.proof as Record<string, unknown>;
      checkedAgainst = "supplied proof";
      const artifactDigest = (proof["artifact"] as { digestB64?: string } | undefined)?.digestB64;
      if (typeof artifactDigest === "string") {
        const entries = await getProofsByDigest(artifactDigest).catch(() => []);
        onRecord = entries.length > 0;
        totalPositions = entries.length;
      }
    } else {
      const entries = await getProofsByDigest(claimedDigest as string);
      onRecord = entries.length > 0;
      totalPositions = entries.length;
      // The earliest position is the originating proof.
      proof = (entries[0]?.proof as Record<string, unknown> | undefined) ?? null;
      checkedAgainst = "ledger";

      if (proof === null) {
        // Never recorded is not the same as failed verification, and a caller
        // that conflates them will report a clean file as tampered with.
        return NextResponse.json(
          {
            verified: false,
            status: "not on record",
            reason: "These bytes have never been recorded in the BitGraph ledger, so there is no proof to verify.",
            artifactBinding: "not-checked",
            checkedAgainst,
            onRecord: false,
            totalPositions: 0,
            artifactHash: claimedDigest,
            artifactHashUrlSafe: toUrlSafeB64(claimedDigest as string),
            proofUrl: null,
            proof: null,
          },
          { headers: { "Cache-Control": "public, s-maxage=10, stale-while-revalidate=30" } },
        );
      }
    }

    const trustAnchors: Record<string, unknown> = {
      requireSlot: body.requireSlot !== false,
      requireEpochId: body.requireEpochId !== false,
    };
    if (Array.isArray(body.allowedMeasurements) && body.allowedMeasurements.length > 0) {
      if (!body.allowedMeasurements.every((m) => typeof m === "string")) {
        return bad("allowedMeasurements must be an array of strings.");
      }
      trustAnchors["allowedMeasurements"] = body.allowedMeasurements;
    }

    const integrity = await verifyProofIntegrity({
      proof: proof as never,
      trustAnchors: trustAnchors as never,
    });

    // Artifact binding. verifyProofIntegrity never sees artifact bytes, so on
    // its own it can only say the object is sound. Comparing the caller's
    // digest against the proof's is what ties the verdict to a specific file,
    // and together the two are exactly what verify({proof, bytes}) performs.
    const proofDigest = (proof["artifact"] as { digestB64?: string } | undefined)?.digestB64 ?? null;
    let artifactBinding: "checked" | "not-checked" | "mismatch" = "not-checked";
    if (claimedDigest !== null && proofDigest !== null) {
      artifactBinding = proofDigest === claimedDigest ? "checked" : "mismatch";
    }

    let verified = integrity.valid;
    let reason: string | null = integrity.valid ? null : (integrity.reason ?? "Proof failed verification.");
    let status: string;
    if (artifactBinding === "mismatch") {
      verified = false;
      reason =
        "This proof is for different bytes. The digest supplied does not match the digest inside the proof, " +
        "so the proof does not describe that file.";
      status = "mismatch";
    } else if (!verified) {
      status = "invalid";
    } else if (artifactBinding === "checked") {
      status = "valid";
    } else {
      // Sound proof, but nothing established which file it belongs to. A flat
      // "valid" would be read as "this file is proven", which is a different
      // and unearned claim.
      status = "valid, artifact not checked";
    }

    const commit = proof["commit"] as { counter?: string; epochId?: string; chainId?: string; slotCounter?: string } | undefined;
    const urlSafeDigest = proofDigest !== null ? toUrlSafeB64(proofDigest) : null;
    const epochUrlSafe = commit?.epochId !== undefined ? toUrlSafeB64(commit.epochId) : null;

    return NextResponse.json(
      {
        verified,
        status,
        reason,
        artifactBinding,
        checkedAgainst,
        onRecord,
        totalPositions,
        artifactHash: proofDigest,
        artifactHashUrlSafe: urlSafeDigest,
        counter: commit?.counter ?? null,
        slotCounter: commit?.slotCounter ?? null,
        epochId: commit?.epochId ?? null,
        chainId: commit?.chainId ?? null,
        proofUrl:
          urlSafeDigest !== null
            ? `https://bitgraph.ing/proof/${urlSafeDigest}` +
              (commit?.counter !== undefined && epochUrlSafe !== null
                ? `?counter=${encodeURIComponent(commit.counter)}&epoch=${encodeURIComponent(epochUrlSafe)}`
                : "")
            : null,
        // Time is deliberately absent. A proof carries no clock reading; its
        // time is the two Ethereum blocks that bracket it, which live on the
        // endpoint below rather than being recomputed here.
        anchorWindow: urlSafeDigest !== null ? `/api/proofs/digest/${urlSafeDigest}` : null,
        trustAnchors,
        verifiedBy: "server",
        // Say plainly that this verdict is a convenience. The proof is
        // returned whole so the caller can redo the check without us.
        note: "Verified server-side with @mikeargento/bitgraph-verify. Re-run it yourself on the returned proof for an independent result; the verifier is MIT-licensed and needs no permission or network.",
        proof,
      },
      { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" } },
    );
  } catch (e) {
    console.error("POST /api/verify error:", (e as Error).message);
    return NextResponse.json({ error: "Verification failed" }, { status: 500 });
  }
}
