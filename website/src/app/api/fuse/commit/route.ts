import { NextRequest, NextResponse } from "next/server";
import { storeProofByDigest, getProofByDigest, getAnchorBeforeCounter, LedgerUnavailableError } from "@/lib/s3";
import { TEE_URL, enclaveFixesBaseFloor, teeRestarting503 } from "@/lib/anchor-gate";
import { FUSE_ATTRIBUTION_NAME, FUSE2_ATTRIBUTION_NAME, FUSE3_ATTRIBUTION_NAME, FUSE_CHAIN, FUSE_ENABLED, fuseDisabled, isDigestB64, isFuseName, isSlotRecord, retryAfterHeaders } from "@/lib/fuse";
import { boundFloorOf, isNoBaseFloorRefusal, signedFloorMatchesBound } from "@/lib/fuse-core";
import { SET_KEY, SET_TITLE, SET2_TITLE, reconcileSetMetadata, validateSetCommit, type SetCommitOk } from "@/lib/fuse-set";
import { TREE_KEY, TREE_TITLE, reconcileTreeMetadata, validateTreeCommit, type TreeCommitOk } from "@/lib/fuse-tree";

export const dynamic = "force-dynamic";
// A set's member index (one key per member, up to 4000 for the largest set)
// is written inside this request, so the by-digest lookups that follow the
// response see every member at once.
export const maxDuration = 60;

const MAX_TITLE = 64;
const MAX_MESSAGE = 128;
const PRINTABLE = /^[\x20-\x7e]+$/;

/**
 * BitGraph Fuse, step two: commit the fused artifact's digest under the
 * exact slot allocated by POST /api/fuse/allocate.
 *
 * One digest per request. The request carries the signed slot record so this
 * route can make the anchor-first gate position-aware: an anchor must exist
 * in the slot's own epoch chain with a counter BELOW the slot counter, or the
 * fused floor is undefined. That condition can never heal for a given slot
 * (anchors only land at higher counters), so its failure is final for that
 * slot and the producer must allocate again.
 *
 * A set (attribution.title "set/1") commits the canonical manifest of its
 * members and carries that manifest, as a parsed object, under
 * metadata["bitgraph-fuse/1"]. The manifest is verified here before the slot
 * is spent (validateSetCommit), forwarded as its canonical parse, and the
 * proof that comes back carries it whether or not the boundary echoed it:
 * enclave v6 echoes metadata on a held-slot commit, v5 and older boundaries
 * dropped it, and the site works under both. Metadata on any other title is
 * refused.
 *
 * A tree (attribution { name "bitgraph-fuse/2", title "tree/1", message the
 * SHA-256 of SPEC.md }, 2026-10-03) is what the site and its tools make now:
 * the committed artifact is an 84-byte root document over a Merkle tree of
 * the files, carried as hex under metadata["bitgraph-tree/1"]. It is checked
 * here the same way, before anything is spent (validateTreeCommit: the marker,
 * a known spec, the exact metadata shape, the root document's commitment
 * against the named position and floor, its hash against the digest), and
 * the returned proof carries the root document whether or not the boundary
 * echoed it. Its members are not indexed here: a member is shown by its own
 * export or its recovery entry, never by a key this route writes.
 *
 * bitgraph-fuse/3 (enclave v10, 2026-10-06) binds a Base block instead: the
 * floor the enclave fixed at allocation and signs as commit.slotFloor. Such a
 * commit names it as body.floor; there are no Ethereum anchors to check it
 * against, so the anchor ledger is not read. Instead the proof the enclave
 * returns must sign that same block, or nothing is reported as a success. A
 * tree/1 commit under SPEC v2 is marked fuse/3, under SPEC v1 fuse/2.
 *
 * set/1 and set/2 commits stay accepted: the published SDK, CLI and MCP
 * packages (bitgraph 1.10, mcp 0.8 and earlier) make them against this route,
 * and refusing them would break every copy already installed.
 *
 * The proxy forwards the body to the parent's /commit with the slotId, then
 * writes the by-digest index the parent does not (per-position entries, for
 * fused proofs the origin digest's descendants, and for a set one key per
 * member). It refuses to return a proof minted under any slot other than
 * the one named, so a downgrade to an ordinary recording can never look
 * like success.
 */
export async function POST(req: NextRequest) {
  if (!FUSE_ENABLED) return fuseDisabled();

  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "body must be a JSON object" }, { status: 400 });
    }

    const slot = body.slot;
    if (!isSlotRecord(slot)) {
      return NextResponse.json({ error: "body.slot must be the position record returned by /api/fuse/allocate (chain bitgraph:main)" }, { status: 400 });
    }
    if (body.slotId !== slot.nonceB64) {
      return NextResponse.json({ error: "body.slotId must equal body.slot.nonceB64" }, { status: 400 });
    }
    const digests = body.digests;
    if (!Array.isArray(digests) || digests.length !== 1) {
      return NextResponse.json({ error: "a fused commit carries exactly one digest" }, { status: 400 });
    }
    const d = digests[0] as { digestB64?: unknown; hashAlg?: unknown };
    if (!isDigestB64(d?.digestB64) || d.hashAlg !== "sha256") {
      return NextResponse.json({ error: "digests[0] must be { digestB64: <base64 SHA-256>, hashAlg: 'sha256' }" }, { status: 400 });
    }
    const digestB64 = d.digestB64;

    // Attribution is the signed carrier of the placement id (title) and the
    // origin digest (message). The name is fixed so readers can recognise a
    // fused proof from the signed bytes alone.
    const attr = body.attribution as Record<string, unknown> | undefined;
    if (attr === undefined || attr === null || typeof attr !== "object" || Array.isArray(attr)) {
      return NextResponse.json({ error: `body.attribution is required: { name: '${FUSE_ATTRIBUTION_NAME}', title: <placement id>, message?: <origin digest> }` }, { status: 400 });
    }
    if (!isFuseName(attr.name)) {
      return NextResponse.json({ error: `attribution.name must be "${FUSE_ATTRIBUTION_NAME}", "${FUSE2_ATTRIBUTION_NAME}" or "${FUSE3_ATTRIBUTION_NAME}"` }, { status: 400 });
    }
    // bitgraph-fuse/2 and /3 bind the floor block into the commitment, so the
    // caller names the floor it bound: the anchor (fuse/2) or the Base floor
    // (fuse/3) /api/fuse/allocate returned.
    const named = boundFloorOf(attr.name, { anchor: body.anchor, floor: body.floor });
    if (!named.ok) return NextResponse.json({ error: named.error }, { status: 400 });
    const bound = named.bound;
    if (typeof attr.title !== "string" || attr.title.length === 0 || attr.title.length > MAX_TITLE || !PRINTABLE.test(attr.title)) {
      return NextResponse.json({ error: "attribution.title must be the placement id (printable ASCII, 1 to 64 characters)" }, { status: 400 });
    }
    if (attr.message !== undefined && (typeof attr.message !== "string" || attr.message.length > MAX_MESSAGE || !PRINTABLE.test(attr.message))) {
      return NextResponse.json({ error: "attribution.message, when present, must be the origin digest (printable ASCII, at most 128 characters)" }, { status: 400 });
    }
    const attribution: Record<string, string> = { name: bound?.chain === "base" ? FUSE3_ATTRIBUTION_NAME : bound?.chain === "ethereum" ? FUSE2_ATTRIBUTION_NAME : FUSE_ATTRIBUTION_NAME, title: attr.title };
    const floorBlockHash = bound?.mark.blockHash ?? null;
    const floorChain = bound?.chain;
    if (typeof attr.message === "string" && attr.message.length > 0) attribution.message = attr.message;

    // A set's manifest is verified BEFORE the anchor gate, the pre-read and
    // the parent call, so a bad one costs no ledger read and no slot: exact
    // shape without recursion, the size cap, the strict canonical round trip,
    // the named slot's commitment, and the hash to the committed digest. The
    // parent receives the canonical parse: value-identical to what the caller
    // sent, in canonical key order, and free of any key the shape check did
    // not admit.
    // set/1 commits the manifest of every member; set/2 commits the root
    // document of a Merkle tree over them, and its members are indexed
    // afterwards through /api/fuse/set-index, each with the path that proves
    // its place.
    const isSet = attr.title === SET_TITLE || attr.title === SET2_TITLE;
    const isTree = attr.title === TREE_TITLE;
    let verifiedSet: SetCommitOk | null = null;
    let verifiedTree: TreeCommitOk | null = null;
    if (isTree) {
      // Before the set check, which refuses metadata on every title but its own.
      const v = validateTreeCommit({ name: attr.name, message: attr.message, metadata: body.metadata, digestB64, slot, floorBlockHash, floorChain });
      if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status });
      verifiedTree = v;
    } else if (isSet || body.metadata !== undefined) {
      const v = await validateSetCommit({ title: attr.title, message: attr.message, metadata: body.metadata, digestB64, slot, floorBlockHash, floorChain });
      if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status });
      verifiedSet = v;
    }

    // A Base floor (fuse/3) is checked against the proof the enclave signs,
    // below; no Ethereum anchors exist for it. A floorless fuse/1 commit on an
    // enclave that fixes a Base floor at every allocation (v10) has its floor
    // already, so the anchor ledger has nothing to say about it either.
    const anchorGate = bound?.chain === "base" ? false : bound?.chain === "ethereum" ? true : !(await enclaveFixesBaseFloor());
    if (anchorGate) {
      // Position-aware anchor-first gate: an anchor below N in the slot's epoch.
      let anchorBefore: Record<string, unknown> | null;
      try {
        anchorBefore = await getAnchorBeforeCounter(parseInt(slot.counter, 10), slot.epochId);
      } catch (err) {
        if (err instanceof LedgerUnavailableError) {
          return NextResponse.json({ error: "BitGraph's copy could not be read; try again", code: "ledger-unavailable" }, { status: 503 });
        }
        throw err;
      }
      if (anchorBefore === null) {
        return NextResponse.json(
          {
            error: "No anchor precedes this position in its epoch, so a fused floor cannot be established for it. Reserve a new position through /api/fuse/allocate.",
            code: "no-anchor-before-slot",
          },
          { status: 409 },
        );
      }

      // fuse/2: the floor the caller bound must be the one the enclave will sign,
      // the latest anchor below this position. The ledger can trail a just-landed
      // anchor by a moment, so only a CONTRADICTION is refused: a floor older than
      // the ledger's, or the same counter with a different block. A refused one
      // costs a fresh allocation, not a proof that silently fails to verify.
      if (bound?.chain === "ethereum") {
        const ledger = (anchorBefore.commit as { counter?: unknown; anchor?: { blockHash?: unknown } } | undefined) ?? {};
        const ledgerCounter = typeof ledger.counter === "string" ? BigInt(ledger.counter) : null;
        const boundCounter = BigInt(bound.mark.counter);
        const contradicted = ledgerCounter !== null && (boundCounter < ledgerCounter || (boundCounter === ledgerCounter && String(ledger.anchor?.blockHash ?? "").toLowerCase() !== bound.mark.blockHash));
        if (contradicted) {
          return NextResponse.json(
            { error: "The floor bound into this file is not the anchor before its position. Reserve a new position through /api/fuse/allocate.", code: "floor-mismatch" },
            { status: 409 },
          );
        }
      }
    }

    // Snapshot the legacy by-digest key before committing (see api/commit).
    const priorLegacy = await getProofByDigest(digestB64);

    const auth = req.headers.get("authorization");
    const forward: Record<string, unknown> = {
      digests: [{ digestB64, hashAlg: "sha256" }],
      slotId: slot.nonceB64,
      chainId: FUSE_CHAIN,
      attribution,
    };
    if (body.agency !== undefined) forward.agency = body.agency;
    if (verifiedSet !== null) forward.metadata = { [SET_KEY]: verifiedSet.manifestObject };
    if (verifiedTree !== null) forward.metadata = { [TREE_KEY]: verifiedTree.hex };

    let teeRes: Response;
    try {
      teeRes = await fetch(`${TEE_URL}/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) },
        body: JSON.stringify(forward),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      // The request may have reached the parent. The client's recovery rule
      // (read back by digest, match commit.slotHashB64) covers this.
      return teeRestarting503();
    }
    if ([502, 503, 504].includes(teeRes.status)) return teeRestarting503();
    if (!teeRes.ok) {
      const err = await teeRes.json().catch(() => ({ error: teeRes.statusText }));
      // Enclave v10 with no Base header to fix a floor from: come back in a moment.
      if (isNoBaseFloorRefusal(err)) return teeRestarting503();
      return NextResponse.json(err, { status: teeRes.status, headers: retryAfterHeaders(teeRes) });
    }

    const teeData = (await teeRes.json()) as unknown;
    const proof = (Array.isArray(teeData) ? teeData[0] : teeData) as Record<string, unknown> | undefined;
    const minted = proof?.slotAllocation as { nonceB64?: string } | undefined;
    const commit = proof?.commit as { nonceB64?: string } | undefined;
    if (!proof || minted?.nonceB64 !== slot.nonceB64 || commit?.nonceB64 !== slot.nonceB64) {
      // Never report success for a proof under any other slot.
      console.error("[api/fuse/commit] boundary returned a proof under a different slot");
      return NextResponse.json({ error: "The boundary did not commit under the named position", code: "slot-mismatch" }, { status: 502 });
    }

    if (bound !== null && !signedFloorMatchesBound(proof, bound)) {
      // The file binds a floor the proof does not sign: its commitment can
      // never verify. Nothing is indexed and nothing reads as success.
      console.error("[api/fuse/commit] the proof signs a different floor than the one the file bound");
      return NextResponse.json({ error: "The boundary signed a different floor than the one this file bound", code: "floor-mismatch" }, { status: 502 });
    }

    if (verifiedSet !== null) {
      // The stored and returned proof carries the manifest verified above:
      // attached when the boundary dropped it, kept when the boundary echoed
      // the same bytes. A boundary that returned a DIFFERENT manifest is
      // refused outright. Nothing about the manifest is logged beyond which
      // of the two happened.
      const outcome = reconcileSetMetadata(proof, verifiedSet);
      if (outcome === "mismatch") {
        console.error("[api/fuse/commit] boundary returned a different set manifest");
        return NextResponse.json({ error: "The boundary returned a different set manifest", code: "manifest-mismatch" }, { status: 502 });
      }
      console.log("[api/fuse/commit] set manifest echoed=" + (outcome === "echoed"));
    }
    if (verifiedTree !== null) {
      // The same rule for a tree's root document: attached when dropped, kept
      // when echoed byte for byte, refused when the boundary returned another.
      const outcome = reconcileTreeMetadata(proof, verifiedTree);
      if (outcome === "mismatch") {
        console.error("[api/fuse/commit] boundary returned a different root document");
        return NextResponse.json({ error: "The boundary returned a different root document", code: "root-mismatch" }, { status: 502 });
      }
      console.log("[api/fuse/commit] tree root document echoed=" + (outcome === "echoed"));
    }

    await storeProofByDigest(proof, priorLegacy);
    return NextResponse.json({ proof });
  } catch (e) {
    console.error("[api/fuse/commit] Error:", (e as Error).message);
    return NextResponse.json({ error: "Commit failed" }, { status: 500 });
  }
}
