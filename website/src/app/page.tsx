import type { Metadata } from "next";

/**
 * The home page: a headline that says what BitGraph does, set like every other page's, then three plain
 * paragraphs. Technology is the full reference.
 *
 * Claim discipline, unchanged: a BitGraph is a place in line, bound by a time and after an unpredictable value. It
 * says when bits were bound, not how old they are or who made them.
 */

const TITLE = "BitGraph just puts things in order";
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

      {/* The headline, with no eyebrow over it, then three paragraphs: how a place is made, what the order makes
          possible, and what a person keeps and what it does not say. */}
      <section className="home-section home-statement" aria-labelledby="home-h">
        <h2 id="home-h">BitGraph just puts things in&nbsp;order.</h2>
        <p>
          Inside secure hardware, a number nobody could predict is drawn and recorded first. The file&rsquo;s hash takes
          the very next place. That place has never been used before and can never be used again.
        </p>
        <p>
          The parts are not new. What matters is the order. Because the number comes first and could not have been
          predicted, anything that contains it must have been finished afterward. Now one recording can establish
          what had to come before another, without a clock to trust, a ledger to keep, or a network that has to agree.
        </p>
        <p>
          What you keep is a small proof anyone can check, offline, without us. Your file never leaves your machine.
          The proof says where your file was recorded. It does not say who made it, when it was created, or whether it
          is true.
        </p>
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
