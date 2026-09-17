import { NextRequest, NextResponse } from "next/server";
import { LedgerUnavailableError, indexSetMemberEvidence, readSetPosition } from "@/lib/s3";
import { FUSE_ENABLED, fuseDisabled } from "@/lib/fuse";
import { SET_INDEX_CHUNK, bindSet } from "@/lib/fuse-set";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const B64 = /^[A-Za-z0-9+/]{43}=$/;
const SAFE = /^[A-Za-z0-9_-]{43}$/;
const COUNTER = /^[0-9]{1,18}$/;

/**
 * POST /api/fuse/set-index: index the members of a set/2 proof from their
 * evidence, a chunk at a time.
 *
 * A set/2 commit carries only the root document, so the boundary never sees
 * the member list; the producer that built the tree sends each member's
 * evidence (row, index, count, path) here afterwards. Nothing is trusted:
 * the set proof is read from its own position on the ledger, its root
 * document bound (hash to the signed digest, commitment to the slot), and
 * each member's leaf and path must recompute that root before the member
 * earns a key. A row that does not bind is counted and skipped; the answer
 * says how many were written, failed, and rejected, and never claims more.
 *
 * Body: { setDigest, epoch, counter, members: SetMemberProof[] }, at most
 * SET_INDEX_CHUNK members. setDigest is the set proof's artifact digest
 * (standard or url-safe base64), epoch and counter its position.
 */
export async function POST(req: NextRequest) {
  if (!FUSE_ENABLED) return fuseDisabled();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return NextResponse.json({ error: "body must be an object" }, { status: 400 });
  const { setDigest, epoch, counter, members } = body as Record<string, unknown>;
  if (typeof setDigest !== "string" || !(B64.test(setDigest) || SAFE.test(setDigest))) return NextResponse.json({ error: "field 'setDigest' must be a base64 SHA-256 digest" }, { status: 400 });
  if (typeof epoch !== "string" || !(B64.test(epoch) || SAFE.test(epoch))) return NextResponse.json({ error: "field 'epoch' must be a base64 epoch id" }, { status: 400 });
  if (typeof counter !== "string" || !COUNTER.test(counter)) return NextResponse.json({ error: "field 'counter' must be a decimal position" }, { status: 400 });
  if (!Array.isArray(members) || members.length === 0 || members.length > SET_INDEX_CHUNK) {
    return NextResponse.json({ error: `field 'members' must list 1 to ${SET_INDEX_CHUNK} member evidence objects` }, { status: 400 });
  }
  const safeDigest = setDigest.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  try {
    const proof = await readSetPosition(safeDigest, epoch, counter);
    if (proof === null) return NextResponse.json({ error: "no set proof at that position", code: "set-not-found" }, { status: 404 });
    const bound = await bindSet(proof);
    if (bound === null || bound.kind !== "set/2") return NextResponse.json({ error: "the proof at that position is not a bound set/2 root document", code: "not-a-set2" }, { status: 409 });
    const result = await indexSetMemberEvidence(proof, bound, members);
    console.log(`[api/fuse/set-index] members=${members.length} written=${result.written} failed=${result.failed} rejected=${result.rejected}`);
    return NextResponse.json({ count: bound.count, ...result });
  } catch (e) {
    if (e instanceof LedgerUnavailableError) return NextResponse.json({ error: "the ledger could not be read", code: "ledger-unavailable" }, { status: 503 });
    console.error("[api/fuse/set-index] failed:", e instanceof Error ? e.message : String(e));
    return NextResponse.json({ error: "indexing failed" }, { status: 500 });
  }
}
