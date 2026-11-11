import type { Metadata } from "next";

/**
 * The home page: an eyebrow and a headline that says what a BitGraph is, set as on every other page, then one
 * statement in plain paragraphs. Technology is the full reference.
 *
 * Claim discipline, unchanged: a BitGraph is a place in line, bound by a time and after an unpredictable value. It
 * says when bits were bound, not how old they are or who made them.
 */

const TITLE = "BitGraph establishes a cryptographic position that is unused before a file consumes it";
const DESCRIPTION =
  "Everything digital is already a copy. Any file or record gets a numbered place in line, with a proof anyone can check offline, in seconds.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION },
  twitter: { title: TITLE, description: DESCRIPTION },
};

export default function HomePage() {
  return (
    <div className="frame home home-typing prose home-scroll docs-page tools-page sx-page home-ov">
      <div className="home-hero"><h1 className="sr-only">BitGraph.</h1></div>

      {/* The eyebrow and headline, then the statement: a roll of film as the picture of what a place is, what a
          BitGraph does not say, and how it is checked. The film is an explanation, never the claim.
          The eyebrow is a div so the statement's paragraph size does not reach it; it is styled by its class. */}
      <section className="home-section home-statement" aria-labelledby="home-h">
        <div className="home-kicker">Provenance</div>
        <h2 id="home-h">BitGraph establishes a cryptographic position that is unused before a file consumes&nbsp;it.</h2>
        <p>
          On a roll of film, every frame is blank until it&rsquo;s exposed. Each frame can be used only once, and the
          frames stay in order.
        </p>
        <p>Make all the prints you like. They all point back to one frame.</p>
        <p>Digital lost that. Every file is already a copy, and nothing in it says which copy came first.</p>
        <p>
          BitGraph brings that back. A file gets a <em>place</em> in a counted line, one that has never been used before
          and can never be used again.
        </p>
        <p>It doesn&rsquo;t say who made the file or whether it&rsquo;s true. It says that this file belongs to this <em>place</em>.</p>
        <p>Anyone can check its place, offline, and what&rsquo;s in your file stays private.</p>
        {/* Where to go next, on phones only: there the bar folds to a menu, so the page offers the three ways on.
            Wide screens have them in the bar. */}
        <div className="sx-cta home-next">
          <a className="bg-action-link is-make" href="/demos">Make / Verify</a>
          <a className="bg-action-link" href="/technology">How it works</a>
          <a className="bg-action-link" href="/examples">Try a demo</a>
        </div>
      </section>
    </div>
  );
}
