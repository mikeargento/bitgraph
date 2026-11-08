import { NextRequest, NextResponse } from "next/server";
import { storeProofByDigest, getProofByDigest } from "@/lib/s3";
import { FOLDER_VERSION } from "@/lib/folder-version";
import { currentEpochId, TEE_URL, teeRestarting503 as teeRestarting503Bare } from "@/lib/tee-gate";

export const dynamic = "force-dynamic";

// ── Restart gate ───────────────────────────────────────────────────────────
// lib/tee-gate.ts: commits go ahead whenever the enclave answers /key.

// ── Folder retirement notice ───────────────────────────────────────────────
// BitGraph Folder was retired on 2026-09-01. This header used to advertise the
// current release; it now carries the retirement notice, because it is the only
// channel that reaches a copy someone already installed. See lib/folder-version.
//
// Stated on EVERY response from this route, successes and failures alike, so an
// installed Folder sees it even when its drop was held through an epoch rotation
// and retried. Downward only: the site states the value and never learns the
// client's, so nothing is added to what leaves a user's machine.
//
// A header rather than a body field, because the body is the signed proof that
// MCP and the site consume and it must not grow fields outside
// bitgraph/1.
//
// ⚠️ TEMPORARY. Delete this and lib/folder-version.ts once the notice has landed.
const VERSION_HEADER = { "X-BitGraph-Folder-Version": FOLDER_VERSION };

const teeRestarting503 = () => teeRestarting503Bare(VERSION_HEADER);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    // A caller that names no chain binds on bitgraph:main, the sequence that runs
    // straight through (enclave v11). Left to the enclave, it would land on its
    // legacy default chain, outside that sequence.
    if (body && typeof body === "object" && !Array.isArray(body) && body.chainId === undefined) body.chainId = "bitgraph:main";

    // Nothing is bound in front of a caller's digest. `floorLeaf` and `ceiling` from older clients are dropped.
    if (body && typeof body === "object" && !Array.isArray(body)) { delete body.floorLeaf; delete body.ceiling; }

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

    // Forward the caller's API key so keyed clients (e.g. bitgraph-mcp) keep
    // their rate-limit exemption at the TEE while still committing through
    // this proxy, which is what maintains the per-position by-digest index.
    const auth = req.headers.get("authorization");
    // Hold commits while the enclave does not answer (the daily rotation
    // window, or a restart). Nothing has been minted when this fires, so an
    // automatic client retry cannot double-record.
    if ((await currentEpochId()) === null) return teeRestarting503();

    let teeRes: Response;
    try {
      teeRes = await fetch(`${TEE_URL}/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) },
        body: JSON.stringify(body),
      });
    } catch {
      return teeRestarting503();
    }
    if ([502, 503, 504].includes(teeRes.status)) {
      return teeRestarting503();
    }

    if (!teeRes.ok) {
      const err = await teeRes.json().catch(() => ({ error: teeRes.statusText }));
      return NextResponse.json(err, { status: teeRes.status, headers: VERSION_HEADER });
    }

    const teeData = await teeRes.json();
    const proofs: Array<Record<string, unknown>> = Array.isArray(teeData) ? teeData : [teeData];

    // Index proofs by digest in S3 (must await so lookups work immediately)
    await Promise.all(proofs.map(p => {
      const digestB64 = (p?.artifact as { digestB64?: string } | undefined)?.digestB64;
      return storeProofByDigest(p, digestB64 !== undefined ? priors.get(digestB64) : undefined);
    }));

    const made = proofs;

    return NextResponse.json(Array.isArray(teeData) ? made : made[0] ?? teeData, { headers: VERSION_HEADER });
  } catch (e) {
    console.error("[api/commit] Error:", (e as Error).message);
    return NextResponse.json({ error: "Commit failed" }, { status: 500, headers: VERSION_HEADER });
  }
}
