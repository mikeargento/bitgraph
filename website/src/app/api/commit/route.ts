import { NextRequest, NextResponse } from "next/server";
import { storeProofByDigest, getProofByDigest, listKeysUnderPrefix } from "@/lib/s3";

const TEE_URL = "https://nitro.occproof.com";

export const dynamic = "force-dynamic";

// ── Anchor-first gate ──────────────────────────────────────────────────────
// The boundary restarts daily (epoch rotation). A commit accepted in the
// seconds between the new epoch coming up and its FIRST anchor landing would
// mint a proof with no same-epoch lower bound: a one-sided bracket. This gate
// holds user commits until the current epoch has at least one anchor, so
// "every recording is preceded by an anchor in its own epoch" is an invariant
// of everything that commits through this proxy (web, MCP, API). The anchor
// service itself commits TEE-direct and is deliberately not gated, or the
// first anchor could never land.
// Restarting and not-yet-anchored both surface as the same retryable 503
// (code "tee-restarting"), so one client retry loop covers the whole window.
const teeRestarting503 = () =>
  NextResponse.json({ error: "The camera is restarting", code: "tee-restarting" }, { status: 503 });

let cachedKey: { epochId: string; at: number } | null = null;
const anchoredEpochs = new Set<string>();

async function currentEpochHasAnchor(): Promise<"yes" | "no" | "tee-down"> {
  try {
    if (!cachedKey || Date.now() - cachedKey.at > 10_000) {
      const r = await fetch(`${TEE_URL}/key`, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) return "tee-down";
      const k = (await r.json()) as { epochId?: string };
      if (!k.epochId) return "tee-down";
      cachedKey = { epochId: k.epochId, at: Date.now() };
    }
  } catch {
    return "tee-down";
  }
  const epochId = cachedKey.epochId;
  if (anchoredEpochs.has(epochId)) return "yes";
  const safe = epochId.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const keys = await listKeysUnderPrefix(`anchors/${safe}/`, 1);
  if (keys.length > 0) {
    anchoredEpochs.add(epochId);
    return "yes";
  }
  return "no";
}

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
