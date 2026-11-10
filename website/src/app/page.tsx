import type { Metadata } from "next";

/**
 * The home page: the claim and its answer as one headline, the three buttons, then one statement in plain
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
      <section className="home-section home-ov-hero" aria-labelledby="home-h">
        <h1 id="home-h">Everything digital{" "}<br className="home-ov-br" />is already a copy. <span className="home-ov-order">BitGraph just puts{" "}<br className="home-ov-br" />things in order.</span></h1>
        {/* Where to go next: make one, see how it works, try the demos. The same button row as the other pages. */}
        <div className="sx-cta">
          <a className="bg-action-link is-make" href="/demos">Make a BitGraph</a>
          <a className="bg-action-link" href="/technology">How it works</a>
          <a className="bg-action-link" href="/examples">Try a demo</a>
        </div>
      </section>

      {/* The statement: why order is the question, and what a place in line answers. Technology is the full reference. */}
      <section className="home-section" aria-label="Why order">
        <p>
          Real or fake? Fact or fiction? Once information is digital, the file itself cannot answer. What is the order of
          the story being told? That question has an answer.
        </p>
        <p>
          Bits carry no trace of where they came from. A camera&rsquo;s readout and a generated image are both just
          numbers, and any set of numbers could be either. Watermarks get stripped. Metadata gets forged. Detectors chase
          generators and fall behind.
        </p>
        <p>So stop asking the object. Look at its place.</p>
        <p>
          A BitGraph gives a file a place: a numbered position in a counted line, opened by a value nobody could predict
          and sealed by hardware. The line only goes one direction. No place can be prepared in advance, and none can be
          added behind it later.
        </p>
        <p>
          Places settle what inspection cannot. A photograph on record before a model existed was not made by that model.
          An answer that carries a question&rsquo;s value was written after the question was recorded. A draft on record
          in March existed in March, whatever anyone says in June.
        </p>
        <p>
          This was recorded before that. This one carries the value of the one before it, so it was made after. Link
          enough places and you have the order of the story.
        </p>
        <p>
          A BitGraph does not tell you who made a file, when it was made, or whether it is true. It tells you where the
          file stands. Only a file that was given a place has one.
        </p>
        <p>
          Anyone can check it, offline, with no account and nothing to look up. Your file never leaves your machine. Make
          one or a million.
        </p>
        <p>When anyone can make anything, inspecting the object tells you less every year. Its place does not change.</p>
        <p>BitGraph gives bits a place.</p>
      </section>
    </div>
  );
}
