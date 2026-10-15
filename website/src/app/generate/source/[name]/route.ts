import { readFileSync } from "node:fs";
import { join } from "node:path";

/* The generator's files, raw (an outside check, 2026-10-14: the page's rendered copies did not hash to the pins, because
   HTML changed the whitespace; "serve the files raw"). Static: each file is read from src/lib at build time and served
   as text/plain, byte for byte the text the page hashes, so the SHA-256 beside it can be checked with one download. */
export const dynamic = "force-static";

export const SOURCE_FILES = ["commitment-art-v19.ts", "commitment-art-bridge.ts", "commitment-art-v16.ts", "png-deflate-v15.ts"] as const;

export function generateStaticParams() {
  return SOURCE_FILES.map((name) => ({ name }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  if (!(SOURCE_FILES as readonly string[]).includes(name)) return new Response("Not found", { status: 404 });
  const text = readFileSync(join(process.cwd(), "src", "lib", name), "utf8");
  return new Response(text, { headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `inline; filename="${name}"`, "Cache-Control": "public, max-age=3600" } });
}
