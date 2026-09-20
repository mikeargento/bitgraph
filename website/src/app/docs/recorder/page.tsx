import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "BitGraph Recorder is retired",
  description:
    "BitGraph Recorder, the macOS app, is no longer offered. Everything it recorded is unaffected and still verifies offline, and every other way to make a BitGraph is unchanged.",
  robots: { index: false, follow: false },
};

/* ── Why this route exists ──────────────────────────────────────────────────
   /docs/recorder redirected to the GitHub releases page until 2026-09-20, when
   Mike retired the app. The URL is in the README, in old messages and in the
   app's own pages, so it has to land somewhere that says what happened rather
   than hand someone a download we no longer offer.

   ⚠️ bitgraph.ing/recorder/latest.json STAYS, whatever happens here. Installed
   copies poll it; removing it breaks their update check instead of ending
   anything. It pins the last version, so an installed copy simply finds
   nothing newer.

   The retirement rule, from BitGraph Folder before it (/docs/folder): nothing
   about retiring a tool touches what it recorded. A proof is a proof. */

export default function RecorderRetiredPage() {
  return (
    <article className="prose">
      <h1>BitGraph Recorder is retired</h1>
      <p className="lede">
        The macOS app is no longer offered. Nothing it recorded is affected: every BitGraph it made is exactly as good as the day it was made, and still verifies offline, with no account and nothing to look up.
      </p>

      <h2 id="what-changes">What changes</h2>
      <ul className="facts">
        <li><span>It is no longer offered for download, and there will be no further versions.</span></li>
        <li><span>A copy you already installed keeps running. Its update check finds nothing newer.</span></li>
        <li><span>Your proofs, exports and the files beside them are untouched. Keep them where they are.</span></li>
      </ul>

      <h2 id="verify">Your recordings still verify</h2>
      <p>
        A BitGraph is checked from the record and its proof, by whoever holds them. That has never needed the app, or this site, or us. The <Link href="/docs/verification">verification</Link> page lists every check, and the MIT verifier runs the same ones in your own code:
      </p>
      <p className="note">
        <code>npm install @mikeargento/bitgraph-verify</code>
      </p>

      <h2 id="instead">Making a BitGraph now</h2>
      <ul className="doors">
        <li><Link href="/docs/try">Make a BitGraph</Link><span>Drop files in your browser. They are read and hashed where they are; only fingerprints leave the machine.</span></li>
        <li><Link href="/docs/mcp">MCP server</Link><span>Connect an agent with one URL. It takes a position before a task and commits its record after.</span></li>
        <li><Link href="/docs/integration">Integration guide</Link><span>Put a commitment in a record your own system writes, sign it, commit its fingerprint.</span></li>
      </ul>
    </article>
  );
}
