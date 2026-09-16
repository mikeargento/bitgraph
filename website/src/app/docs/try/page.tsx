import type { Metadata } from "next";
import { TryZone } from "./try-zone";

export const metadata: Metadata = {
  title: "Try it",
  description:
    "Drop a file to create a proof, or add an existing proof to check it. Your file is hashed in your browser; only its hash is sent to BitGraph.",
};

/* The browser try (Mike, 2026-09-16: "build it as a try it page under tools
   and then im thinking it will be on recorder page too as a link"). One docs
   page holding the site's own camera, for whoever cannot install the Mac app.
   Not the home page and not a button in the bar: the maker as a front page
   and a New pill in every header were both cut the same day.

   The rules it keeps: hashed in the browser, nothing uploaded; the proof
   comes back to the visitor and is not held here; no hosted proof page for
   what it makes (discovery retired 2026-09-08); the position is real. */
export default function TryPage() {
  // Copy as supplied by Mike, 2026-09-16 ("Update the prose on /docs/try using
  // the exact copy below"), verbatim.
  return (
    <article className="prose-doc" style={{ maxWidth: "none" }}>
      <h1>Try BitGraph in your browser</h1>
      <p>Drop a file to create a proof, or add an existing proof to check it.</p>
      <p>
        Your file is hashed in your browser. Only its hash—a digital fingerprint—is sent to BitGraph. The file stays on your computer.
      </p>
      <p>
        Creating a proof records that fingerprint on BitGraph&rsquo;s live ledger. Save your proof from the results page.
      </p>

      <TryZone />

      <h2>Check an existing proof</h2>
      <p>
        Drop <code>proof.json</code> into the box above. Include the original file to check that it matches the proof. Verification runs in your browser.
      </p>
      <p>
        To verify outside this website, use the command-line verifier:
      </p>
      <p><code>npx @mikeargento/bitgraph-audit</code></p>

      {/* "Save proofs automatically", a section about the Mac app, was cut
          minutes after it went in (Mike, 2026-09-16: "pretend recorder app
          doesnt even exist"). */}
    </article>
  );
}
