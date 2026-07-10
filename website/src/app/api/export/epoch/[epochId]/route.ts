import { NextRequest, NextResponse } from "next/server";
import { listKeysUnderPrefix, getObjectText, getCurrentEpoch } from "@/lib/s3";
import {
  exportEpoch,
  EpochTooLargeError,
  type EpochDataSource,
} from "@/lib/export-epoch";

// Epoch export: download one epoch's proofs as a bitgraph-bundle/1 .tar.gz
// (spec: docs/BUNDLE-FORMAT.md), auditable fully offline with
// @mikeargento/bitgraph-audit.
//
// WRITE-SIDE OPERATOR FUNCTIONALITY. Proprietary, part of the website
// (SEE LICENSE IN LICENSE), NOT part of the permissive packages. Read-only
// against the ledger: this route never writes to S3 and never commits
// anything. A closed epoch exports completely; the currently minting epoch
// exports as a labeled snapshot through the current counter (openEpochs in
// the manifest). Artifact bytes are never included: the ledger stores no
// artifacts (proofs are capability-gated by the file itself).
//
// Deliberate choice, recorded in DECISIONS.md: like every other API route
// here, this wires the website's own S3 helpers (@/lib/s3), not the
// workspace ledger package, which the website does not resolve.

export const dynamic = "force-dynamic";

// Epoch ids in S3 keys and URLs are the path-safe base64 form: A-Za-z0-9_-
// with padding stripped. Anything else is rejected before any S3 call.
const SAFE_EPOCH_ID = /^[A-Za-z0-9_-]{1,128}$/;

const RESPONSE_CHUNK = 64 * 1024;

const s3Source: EpochDataSource = {
  listProofKeys: (safeEpochId) => listKeysUnderPrefix(`proofs/${safeEpochId}/`),
  listAnchorKeys: (safeEpochId) => listKeysUnderPrefix(`anchors/${safeEpochId}/`),
  getObjectText: (key) => getObjectText(key),
  getCurrentEpochSafeId: () => getCurrentEpoch(),
};

export async function GET(_req: NextRequest, { params }: { params: Promise<{ epochId: string }> }) {
  try {
    const { epochId } = await params;
    const safeEpochId = decodeURIComponent(epochId);
    if (!SAFE_EPOCH_ID.test(safeEpochId)) {
      return NextResponse.json({ error: "bad epoch id" }, { status: 400 });
    }

    const result = await exportEpoch(s3Source, safeEpochId, new Date().toISOString());
    if (!result) {
      return NextResponse.json({ error: "epoch not found" }, { status: 404 });
    }

    const { archive, open } = result;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let offset = 0; offset < archive.length; offset += RESPONSE_CHUNK) {
          controller.enqueue(archive.subarray(offset, Math.min(offset + RESPONSE_CHUNK, archive.length)));
        }
        controller.close();
      },
    });

    return new NextResponse(stream, {
      status: 200,
      headers: {
        "Content-Type": "application/gzip",
        "Content-Length": String(archive.length),
        "Content-Disposition": `attachment; filename="bitgraph-epoch-${safeEpochId}.tar.gz"`,
        // A closed epoch's export is immutable; an open-epoch snapshot moves
        // with every new proof.
        "Cache-Control": open ? "no-store" : "public, s-maxage=3600, stale-while-revalidate=86400",
        "X-BitGraph-Epoch-Open": open ? "true" : "false",
        "X-BitGraph-Proof-Count": String(result.proofCount),
      },
    });
  } catch (e) {
    if (e instanceof EpochTooLargeError) {
      return NextResponse.json({ error: "epoch too large for export" }, { status: 413 });
    }
    console.error("GET /api/export/epoch error:", e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
