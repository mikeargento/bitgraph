import Link from "next/link";
import { PUBLISHED_PCR0 } from "@/lib/enclave-measurements";

/**
 * The foot of every page, under the previous and next links: who runs the service and the legal pages, then the facts
 * a reader can check (the enclave, its published measurement, the hourly publication on Base), each a link. Each
 * item stays whole and carries the dot before it, so on a phone a line wraps only between items and never ends or
 * starts with a dot (the first dot of every line is clipped away; see .site-foot .row in app/site.css).
 */
const PINS_URL = "https://github.com/mikeargento/bitgraph/blob/main/server/commit-service/reproducible-build/PINS.md";
const WRITER_URL = "https://basescan.org/address/0xf3972408D853c975F86351C311f4310220bbF2a3";

export function SiteFoot() {
  return (
    <footer className="site-foot not-prose">
      <p><span className="row">
        <span>&copy; {new Date().getUTCFullYear()} Argento Computing Inc.</span>
        <span><Link href="/terms">Terms</Link></span>
        <span><Link href="/privacy">Privacy</Link></span>
      </span></p>
      <p><span className="row">
        <span><Link href="/how/trust">AWS Nitro enclave</Link></span>
        <span><a href={PINS_URL} target="_blank" rel="noopener">PCR0 {PUBLISHED_PCR0.slice(0, 12)}&hellip;</a></span>
        <span><a href={WRITER_URL} target="_blank" rel="noopener">Published hourly on Base</a></span>
      </span></p>
    </footer>
  );
}
