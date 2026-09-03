import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { fuse, builderFor, FuseError } from "@mikeargento/bitgraph";
import { FUSE_ENABLED, fuseDisabled } from "@/lib/fuse";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BYTES = 25 * 1024 * 1024;

/** The bounded copy of spec 9.3, verbatim. */
const COPY_ORIGINAL = ["Original recorded", "These exact original bytes existed no later than the commit."];
const COPY_FUSED = ["Fused artifact created", "These bytes were assembled after their slot allocation and committed at this position."];

/**
 * The internal harness (spec 9.2): one file in, Form A or B out, through the
 * same fuse() the SDK exposes and the same /api/fuse routes a producer uses.
 * Behind FUSE_ENABLED, FUSE_HARNESS_ENABLED, and a shared token: an internal
 * switch, not a user login (BitGraph has none). Not a product surface.
 */
function harnessEnabled(): boolean {
  return FUSE_ENABLED && process.env.FUSE_HARNESS_ENABLED === "true";
}

function tokenOk(req: NextRequest): boolean {
  const expected = process.env.FUSE_HARNESS_TOKEN ?? "";
  if (expected.length === 0) return false;
  const got = req.headers.get("x-fuse-harness-token") ?? "";
  const a = Buffer.from(got, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

const sanitize = (name: string) => name.replace(/[\x00-\x1f\x7f/]/g, " ").trim() || "artifact";

export async function POST(req: NextRequest) {
  if (!harnessEnabled()) return fuseDisabled();
  if (!tokenOk(req)) return NextResponse.json({ error: "harness token missing or wrong" }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "expected multipart form data with a file" }, { status: 400 });
  }
  const file = form.get("file");
  const placement = form.get("placement");
  if (!(file instanceof Blob)) return NextResponse.json({ error: "field 'file' is required" }, { status: 400 });
  if (placement !== "trailer/1" && placement !== "container/1") {
    return NextResponse.json({ error: "field 'placement' must be trailer/1 or container/1" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) return NextResponse.json({ error: `file exceeds ${MAX_BYTES} bytes` }, { status: 413 });
  const original = new Uint8Array(await file.arrayBuffer());
  const name = sanitize((file as File).name ?? "artifact");
  const ext = placement === "trailer/1" ? (name.includes(".") ? name.slice(name.lastIndexOf(".")) : "") : ".tar";
  const stem = name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name;
  const fusedName = `${stem}.fused${ext}`;

  // The producer's own commit surface: this site's /api/fuse routes, behind
  // the same gate and flag, so the harness exercises exactly the public path.
  const auth = req.headers.get("authorization");
  const transport = { baseUrl: new URL(req.url).origin, ...(auth?.startsWith("Bearer ") ? { apiKey: auth.slice(7) } : {}) };

  try {
    const r = await fuse(builderFor(placement, original), { placement, original, fusedFile: fusedName, keepFused: true, transport });
    const c = r.proof.commit;
    return NextResponse.json({
      copy: [COPY_ORIGINAL, COPY_FUSED],
      category: r.verification.category,
      placement,
      slotCounter: c.slotCounter ?? null,
      commitCounter: c.counter ?? null,
      epochId: c.epochId ?? null,
      artifactDigestB64: r.artifactDigestB64,
      originDigestB64: r.originDigestB64,
      recovered: r.recovered,
      frameName: `${name}.bitgraph-fuse.json`,
      frame: r.frame,
      fusedName,
      fusedBase64: r.fusedBytes !== undefined ? Buffer.from(r.fusedBytes).toString("base64") : null,
    });
  } catch (err) {
    if (err instanceof FuseError) {
      // Nothing is labelled fused; say so with the code, never a success-looking body.
      const status = err.code === "tee-restarting" ? 503 : err.status !== null && err.status >= 400 && err.status < 600 ? err.status : 502;
      return NextResponse.json({ error: `No fused proof was completed: ${err.message}`, code: err.code }, { status });
    }
    console.error("[api/fuse/harness] Error:", (err as Error).message);
    return NextResponse.json({ error: "No fused proof was completed" }, { status: 500 });
  }
}
