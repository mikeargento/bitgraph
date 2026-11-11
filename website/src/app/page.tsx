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

      {/* The eyebrow and headline, then the statement: why order is the question, and what a place in line answers.
          The eyebrow is a div so the statement's paragraph size does not reach it; it is styled by its class. */}
      <section className="home-section home-statement" aria-labelledby="home-h">
        <div className="home-kicker">Provenance</div>
        <h2 id="home-h">BitGraph establishes a cryptographic position that is unused before a file consumes&nbsp;it.</h2>
        <p>
          Real or fake? Fact or fiction? Once information is digital, the file itself cannot answer. What is the order of
          the story being told? That question has an answer.
        </p>
        <p>
          Bits carry no trace of where they came from. A camera&rsquo;s readout and a generated image are both just
          numbers, and any set of numbers could be either. Watermarks get stripped. Metadata gets forged. Detectors chase
          generators and fall behind.
        </p>
        <p>So stop asking the object. Look at its <em>place</em>.</p>
        <p>
          A BitGraph is a <em>place</em> that was unused before a file consumed it: a numbered position in a counted
          line, opened by a value nobody could predict and sealed by hardware. The line only goes one direction, and
          nothing can be added behind it later.
        </p>
        <p>
          <em>Places</em> settle what inspection cannot. A photograph on record before a model existed was not made by that model.
          An answer that carries a question&rsquo;s value was written after the question was recorded. A draft on record
          in March existed in March, whatever anyone says in June.
        </p>
        <p>
          This was recorded before that. This one carries the value of the one before it, so it was made after. Link
          enough <em>places</em> and you have the order of the story.
        </p>
        <p>
          A BitGraph does not tell you who made a file, when it was made, or whether it is true. It tells you where the
          file stands. Only a file that was given a <em>place</em> has one.
        </p>
        <p>
          Anyone can check it, offline, with no account and nothing to look up. Your file never leaves your machine. Make
          one or a million.
        </p>
        <p>Anything can be made by anyone. A <em>place</em> cannot be backdated.</p>
        <p>BitGraph gives bits a <em>place</em>.</p>
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
