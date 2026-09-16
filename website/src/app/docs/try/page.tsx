import type { Metadata } from "next";
import { TryZone } from "./try-zone";

export const metadata: Metadata = {
  title: "Try it",
  description:
    "Make a BitGraph in the browser: the file is hashed on your machine, the enclave opens a position, the digest is committed under it, and the proof comes back to you.",
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
  return (
    <article className="prose-doc" style={{ maxWidth: "none" }}>
      <h1>Try it in the browser</h1>
      <p>
        Drop a file below. It is hashed on your machine, the enclave opens a position, the digest is committed under it, and the proof comes back to you. The file never leaves your computer. Only its digest crosses.
      </p>
      <p>
        The position is real. There is no sandbox, because there is no pretend mode: what you make here sits on the same ledger as everything else, and the proof is yours to keep. Save it from the page that opens.
      </p>

      <TryZone />

      <h2>Checking one</h2>
      <p>
        To check a BitGraph you were handed, drop its <code>proof.json</code> in the same box, with the file if you have it. The check runs in this tab and asks nothing of anyone. For a check you would stake something on, run it yourself, in the <a href="/docs/recorder">Recorder</a> or with <code>npx @mikeargento/bitgraph-audit</code> in a terminal, so that nothing you trust was served by the party you are checking.
      </p>
      <p>
        The Mac app does everything this page does, writes the proof beside your file, and keeps the Ethereum anchors as they land. <a href="/docs/recorder">BitGraph Recorder</a>.
      </p>
    </article>
  );
}
