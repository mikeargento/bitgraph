import { NextRequest, NextResponse } from "next/server";
import { storeProofByDigest, getProofByDigest } from "@/lib/s3";

const TEE_URL = "https://nitro.occproof.com";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Snapshot what the legacy by-digest key holds BEFORE committing. The EC2
    // parent overwrites that key fire-and-forget as soon as the TEE responds,
    // so a post-commit read races it and can miss the prior recording; the
    // pre-commit snapshot is what lets storeProofByDigest backfill a
    // legacy-only original into the per-position index instead of orphaning it.
    const priors = new Map<string, Record<string, unknown> | null>();
    const digests = Array.isArray(body?.digests) ? (body.digests as Array<{ digestB64?: string }>) : [];
    await Promise.all(digests.map(async (d) => {
      if (typeof d?.digestB64 === "string") {
        priors.set(d.digestB64, await getProofByDigest(d.digestB64));
      }
    }));

    const teeRes = await fetch(`${TEE_URL}/commit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!teeRes.ok) {
      const err = await teeRes.json().catch(() => ({ error: teeRes.statusText }));
      return NextResponse.json(err, { status: teeRes.status });
    }

    const teeData = await teeRes.json();
    const proofs = Array.isArray(teeData) ? teeData : [teeData];

    // Index proofs by digest in S3 (must await so lookups work immediately)
    await Promise.all(proofs.map(p => {
      const digestB64 = (p?.artifact as { digestB64?: string } | undefined)?.digestB64;
      return storeProofByDigest(p, digestB64 !== undefined ? priors.get(digestB64) : undefined);
    }));

    return NextResponse.json(teeData);
  } catch (e) {
    console.error("[api/commit] Error:", (e as Error).message);
    return NextResponse.json({ error: "Commit failed" }, { status: 500 });
  }
}
