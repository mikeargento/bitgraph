import type { Metadata } from "next";
import Link from "next/link";

/* The site's own "not found" (Mike, 2026-10-10: the framework's bare 404 "looks bad when it happens", e.g. a typo
   like /thrre). One page for every miss: unknown paths, short links that match no record (app/[code]), and any
   notFound() call. Same frame and actions as the rest of the site; no lookup box, no suggestions to guess at. */
export const metadata: Metadata = { title: "Not found", robots: { index: false } };

export default function NotFound() {
  return (
    <div className="frame prose" style={{ padding: "56px 0 96px", maxWidth: "var(--measure)" }}>
      <h1 className="bg-page-title">Nothing here</h1>
      <p className="lede">There&rsquo;s no page at this address. If you followed a short link, check the characters after bitgraph.ing/.</p>
      <div className="actions" style={{ marginBottom: 0 }}>
        <Link className="bg-action-link is-make" href="/">Home</Link>
        <Link className="bg-action-link" href="/docs/overview">How it works</Link>
      </div>
    </div>
  );
}
