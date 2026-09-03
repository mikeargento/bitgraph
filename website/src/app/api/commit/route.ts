import { NextRequest, NextResponse } from "next/server";
import { storeProofByDigest, getProofByDigest } from "@/lib/s3";
import { FOLDER_VERSION } from "@/lib/folder-version";
import { currentEpochHasAnchor, TEE_URL, teeRestarting503 as teeRestarting503Bare } from "@/lib/anchor-gate";

export const dynamic = "force-dynamic";

// ── Anchor-first gate ──────────────────────────────────────────────────────
// Lives in lib/anchor-gate.ts now, shared with the Fuse routes so every
// commit surface on this site sits behind the same rule. See the header there.

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
    // Hold commits during the daily rotation window and until the new
    // epoch's first anchor has landed (see the anchor-first gate above).
    // Nothing has been minted when either path fires, so an automatic
    // client retry cannot double-record.
    const gate = await currentEpochHasAnchor();
    if (gate !== "yes") return teeRestarting503();

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
    const proofs = Array.isArray(teeData) ? teeData : [teeData];

    // Index proofs by digest in S3 (must await so lookups work immediately)
    await Promise.all(proofs.map(p => {
      const digestB64 = (p?.artifact as { digestB64?: string } | undefined)?.digestB64;
      return storeProofByDigest(p, digestB64 !== undefined ? priors.get(digestB64) : undefined);
    }));

    return NextResponse.json(teeData, { headers: VERSION_HEADER });
  } catch (e) {
    console.error("[api/commit] Error:", (e as Error).message);
    return NextResponse.json({ error: "Commit failed" }, { status: 500, headers: VERSION_HEADER });
  }
}
