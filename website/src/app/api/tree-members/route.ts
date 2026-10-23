// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

import { NextResponse } from "next/server";
import { getProofsByDigest, getTreeFloorText, indexTreeMembers, ledgerWritesOn, putTreeFloorOnce, LedgerUnavailableError } from "@/lib/s3";
import { checkFloor, checkMember, parseDigestRootText, withMember, TREE_MEMBER_KEY, type TreeFloor, type TreeMember } from "@/lib/tree-member";

export const dynamic = "force-dynamic";

/**
 * Index a tree's files under their own hashes (lib/tree-member.ts). The browser that built the tree posts its members
 * after the root is bound, up to 2,000 a request:
 *
 *   { rootDigestB64, epochId, counter, rootText, members: [{ digestB64, index, path }], floor?: { file, index, path } }
 *
 * floor (2026-10-20): the tree's first leaf, base-block.json, and its path. It is checked into the same root once and
 * then stored with every member, so each file's proof carries its window's floor.
 *
 * Nothing is taken on trust: SHA-256(rootText) must be the root's digest; the root's proof is read from the ledger at
 * that position; and every member's hash is walked up its path to the root rootText names (checkMember) before its key
 * is written. A member that does not check is counted and skipped, never written.
 */
const MAX_MEMBERS = 2000;

export async function POST(req: Request) {
  if (!ledgerWritesOn()) return NextResponse.json({ error: "Ledger writes are off." }, { status: 503 });
  let body: { rootDigestB64?: unknown; epochId?: unknown; counter?: unknown; rootText?: unknown; members?: unknown; floor?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  const { rootDigestB64, epochId, counter, rootText, members, floor: floorIn } = body;
  if (typeof rootDigestB64 !== "string" || typeof epochId !== "string" || typeof counter !== "string" || typeof rootText !== "string" || !Array.isArray(members)) {
    return NextResponse.json({ error: "rootDigestB64, epochId, counter, rootText and members are required." }, { status: 400 });
  }
  if (members.length === 0 || members.length > MAX_MEMBERS) return NextResponse.json({ error: `1 to ${MAX_MEMBERS} members a request.` }, { status: 400 });
  const parsed = parseDigestRootText(rootText);
  if (!parsed) return NextResponse.json({ error: "rootText is not a digest-leaf tree's root." }, { status: 400 });

  let proof: Record<string, unknown> | null = null;
  try {
    const entries = await getProofsByDigest(rootDigestB64);
    proof = entries.find((e) => {
      const c = e.proof.commit as { epochId?: unknown; counter?: unknown } | undefined;
      return e.kind === "recorded" && String(c?.epochId) === epochId && String(c?.counter) === counter;
    })?.proof ?? null;
  } catch (e) {
    if (e instanceof LedgerUnavailableError) return NextResponse.json({ error: "ledger unavailable" }, { status: 503 });
    throw e;
  }
  // The root's own entry is written as it is bound; a moment's lag reads as not found, so the caller retries.
  if (!proof) return NextResponse.json({ error: "The root's BitGraph is not on the ledger (yet)." }, { status: 404 });

  // The floor, when sent, must be in this very tree; a floor that does not check is refused with the request.
  let floor: TreeFloor | undefined;
  if (floorIn !== undefined) {
    const f = floorIn as Partial<TreeFloor>;
    floor = { file: String(f?.file ?? ""), index: Number(f?.index), path: String(f?.path ?? "") };
    const probe: TreeMember = { format: TREE_MEMBER_KEY, files: parsed.files, index: 0, path: "", rootText, floor };
    if (!checkFloor(proof, probe)) return NextResponse.json({ error: "The floor is not a base-block.json in this tree." }, { status: 400 });
    // Kept under the root's own position too, so the root's proof page shows the floor (2026-10-22: a drop made on a
    // phone showed its floor there, opened by root digest on a desktop it did not).
    const std = rootDigestB64.replace(/-/g, "+").replace(/_/g, "/");
    try { await putTreeFloorOnce(std, epochId, counter, JSON.stringify({ format: "bitgraph-tree-floor/1", files: parsed.files, rootText, floor }, null, 2)); } catch { /* the members still index */ }
  }

  const out: Array<{ digestB64: string; body: string }> = [];
  let rejected = 0;
  for (const m of members as Array<{ digestB64?: unknown; index?: unknown; path?: unknown }>) {
    if (typeof m?.digestB64 !== "string" || typeof m.path !== "string" || !Number.isSafeInteger(m.index)) { rejected++; continue; }
    const member: TreeMember = { format: TREE_MEMBER_KEY, files: parsed.files, index: m.index as number, path: m.path, rootText, ...(floor ? { floor } : {}) };
    if (!checkMember(proof, m.digestB64, member)) { rejected++; continue; }
    out.push({ digestB64: m.digestB64.replace(/-/g, "+").replace(/_/g, "/"), body: JSON.stringify(withMember(proof, member), null, 2) });
  }
  const { written, failed } = await indexTreeMembers(out, epochId, counter);
  return NextResponse.json({ written, failed, rejected });
}

/** GET /api/tree-members?digest=&epoch=&counter=: the tree's floor kept under its root's position, or 404. */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const digest = q.get("digest"), epoch = q.get("epoch"), counter = q.get("counter");
  if (!digest || !epoch || !counter) return NextResponse.json({ error: "digest, epoch and counter are required" }, { status: 400 });
  const std = (x: string) => { const t = x.replace(/-/g, "+").replace(/_/g, "/"); return t.length === 43 ? `${t}=` : t; };
  try {
    const text = await getTreeFloorText(std(digest), std(epoch), counter);
    if (!text) return NextResponse.json({ error: "no tree floor" }, { status: 404 });
    return new NextResponse(text, { headers: { "content-type": "application/json", "cache-control": "public, max-age=60" } });
  } catch (e) {
    if (e instanceof LedgerUnavailableError) return NextResponse.json({ error: "the ledger could not be read just now" }, { status: 503 });
    throw e;
  }
}
