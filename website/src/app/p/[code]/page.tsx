import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { digestsWithPrefix } from "@/lib/s3";

/* Short links (Mike, 2026-10-08: "build the url shortener"): /p/<the first characters of a record's digest>.
   Nothing is registered: a short link is the digest's own prefix, so anyone holding a proof can write it, and
   the long /proof/<digest> link keeps working forever. Eight characters (48 bits) by default; any longer prefix
   resolves too. One match redirects to the proof page; none says so; two or more (never seen) lists them all
   rather than guess. No counting, no tracking, no expiry. */
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Short link", robots: { index: false } };

export default async function ShortLink({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const ok = /^[A-Za-z0-9_-]{8,43}$/.test(code);
  let found: string[] = [];
  let failed = false;
  if (ok) { try { found = await digestsWithPrefix(code); } catch { failed = true; } }
  if (found.length === 1) redirect(`/proof/${found[0]}`);
  return (
    <div className="frame prose" style={{ padding: "56px 0 96px", maxWidth: "var(--measure)" }}>
      <h1 className="bg-page-title">Short link</h1>
      {!ok ? (
        <p className="lede">A short link is <code>/p/</code> followed by at least the first eight characters of a record&rsquo;s digest.</p>
      ) : failed ? (
        <p className="lede">The ledger could not be read just now. Try the link again in a moment.</p>
      ) : found.length === 0 ? (
        <p className="lede">No BitGraph on the ledger has a digest beginning <code>{code}</code>.</p>
      ) : (
        <>
          <p className="lede">More than one BitGraph has a digest beginning <code>{code}</code>. Each one:</p>
          <ul>{found.map((d) => <li key={d}><Link href={`/proof/${d}`}><code>{d}</code></Link></li>)}</ul>
        </>
      )}
    </div>
  );
}
