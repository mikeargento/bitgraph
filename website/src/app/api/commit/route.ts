import { NextRequest, NextResponse, after } from "next/server";
import { storeProofByDigest, getProofByDigest, putFloorLinkOnce } from "@/lib/s3";
import { checkFloorLink, floorFileText, latestBaseBlock, sha256B64 } from "@/lib/floor-link";
import { FOLDER_VERSION } from "@/lib/folder-version";
import { commitsMayProceed, TEE_URL, teeRestarting503 as teeRestarting503Bare } from "@/lib/anchor-gate";
import { isNoBaseFloorRefusal } from "@/lib/fuse-core";

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
    // A caller that names no chain binds on bitgraph:main, the sequence that runs
    // straight through (enclave v11). Left to the enclave, it would land on its
    // legacy default chain, outside that sequence.
    if (body && typeof body === "object" && !Array.isArray(body) && body.chainId === undefined) body.chainId = "bitgraph:main";

    // Every BitGraph gets a Base floor and a Base ceiling (2026-10-21; the Make page had them since 2026-10-20,
    // the rest of the site did not). The ceiling: the host queues the proof hash for Base when asked, so ask for every
    // bind. The floor: the latest Base block is bound as BitGraph 1, in this same request, right before the caller's
    // digest; the link that says 1 is 2's floor is written once the enclave has answered (lib/floor-link.ts). A bind
    // whose tree already carries the block as its first leaf (the Make page, `floorLeaf: true`) needs no second floor.
    // Base not answering costs the bind its floor, never the bind: the proof page then shows the ceiling alone.
    let floor: { digestB64: string; file: string } | null = null;
    if (body && typeof body === "object" && !Array.isArray(body)) {
      body.ceiling = true;
      const leaf = body.floorLeaf === true;
      delete body.floorLeaf;
      const plain = Array.isArray(body.digests) && body.digests.length > 0 && body.slotId === undefined && body.slot === undefined && body.agency === undefined;
      if (plain && !leaf) {
        try {
          const file = floorFileText(await latestBaseBlock());
          floor = { digestB64: sha256B64(file), file };
          body.digests = [{ digestB64: floor.digestB64, hashAlg: "sha256" }, ...body.digests];
        } catch (e) {
          console.warn("[api/commit] no floor for this bind: Base did not answer:", (e as Error).message);
        }
      }
    }

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
    const gate = await commitsMayProceed();
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
      // Enclave v10 with no Base header to fix a floor from: come back in a moment.
      if (isNoBaseFloorRefusal(err)) return teeRestarting503();
      return NextResponse.json(err, { status: teeRes.status, headers: VERSION_HEADER });
    }

    const teeData = await teeRes.json();
    const proofs: Array<Record<string, unknown>> = Array.isArray(teeData) ? teeData : [teeData];

    // Index proofs by digest in S3 (must await so lookups work immediately)
    await Promise.all(proofs.map(p => {
      const digestB64 = (p?.artifact as { digestB64?: string } | undefined)?.digestB64;
      return storeProofByDigest(p, digestB64 !== undefined ? priors.get(digestB64) : undefined);
    }));

    // The floor is the site's, not the caller's: the caller gets the proofs of the digests it sent, in the shape it
    // always has, and the floor link is written after this reply (the proof page asks /api/floors for it).
    const digestOf = (p: Record<string, unknown>) => (p?.artifact as { digestB64?: string } | undefined)?.digestB64;
    const floorProof = floor ? proofs.find((p) => digestOf(p) === floor!.digestB64) ?? null : null;
    const made = floorProof ? proofs.filter((p) => p !== floorProof) : proofs;
    if (floor && floorProof) {
      const { digestB64: floorDigest, file } = floor;
      after(async () => {
        for (const p of made) {
          try {
            const r = await checkFloorLink(floorProof, p, file);
            if (!r.ok) { console.warn(`[api/commit] floor link not written for ${digestOf(p)}: ${r.error}`); continue; }
            const text = JSON.stringify(r.link, null, 2);
            await putFloorLinkOnce(r.link.record.digestB64, r.link.record.epochId, r.link.record.counter, text);
            // The same link under the floor's own position, so the floor's proof page can say which record it floors
            // (2026-10-21: a floor's page otherwise showed no floor): a floor is BitGraph 1 and has none of its own.
            const f = r.link.floor.bitgraph;
            await putFloorLinkOnce(f.digestB64, f.epochId, f.counter, text);
          } catch (e) {
            console.warn(`[api/commit] floor link failed for ${digestOf(p)} (floor ${floorDigest}):`, (e as Error).message);
          }
        }
      });
    } else if (floor) {
      console.warn("[api/commit] the enclave's reply carried no proof for the floor digest; no link written");
    }

    return NextResponse.json(Array.isArray(teeData) ? made : made[0] ?? teeData, { headers: VERSION_HEADER });
  } catch (e) {
    console.error("[api/commit] Error:", (e as Error).message);
    return NextResponse.json({ error: "Commit failed" }, { status: 500, headers: VERSION_HEADER });
  }
}
