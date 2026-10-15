import type { Metadata } from "next";
import Link from "next/link";
import { ArtMaker } from "@/components/art-maker";

/**
 * Home, written as the scene (Mike, 2026-09-20: "sell me this pen"). The order is
 * the order the scene runs in: the demand first, the reach that fails, the turn,
 * then the object. The lesson is the last line, not the first, because in the
 * scene the lesson is the payoff.
 *
 * Everything that explains the protocol moved into the docs on 2026-09-20, so this
 * page does not teach. Two links carry the reader onward, and the nav carries the
 * third.
 *
 * ⚠️ Claim discipline, unchanged:
 * - The proof shows what was committed and where it sat, never that the record is
 *   true. Do not let "prove" widen on this page.
 * - Floor in time, ceiling in position. Never "proves when".
 * - It sits beside the audit system the reader already runs; it replaces nothing.
 */
export const metadata: Metadata = {
  title: "BitGraph",
  description:
    "BitGraph gives an AI audit record a position its producer could not choose: a portable BitGraph that commits the exact record, sits after a public Base block, and verifies offline. It works beside the audit system you already run.",
};

export default function HomePage() {
  return (
    <div className="frame home home-typing prose home-scroll">
      {/* 2026-10-15 (Mike: "go ballistic and make your best homepage"): the page tells the whole story in order instead of
          being a doorway. Hero (as before, in its own centred block), then 01/02/03 what happens, the measured numbers, the
          live generator, who it is for, the point of view, and where to start. Sapien's structure (Mike's example that
          night), BitGraph's look: no new colours, no imagery, the one blue card is the thesis. The old one-screen frame
          (minHeight calc(100svh - 142px), centred) became .home-hero. */}
      <div className="home-hero">
      {/* The demo is Ask Jev (Mike, 2026-10-11: ChatGPT's "See it work" leads to the Jev demo, "hes right"): a computation
          done inside a BitGraph, the position opened before it ran, which is what the line under the headline says. The
          bridge maker (ArtMaker "home") ran here from 2026-10-10; /generate still makes bridges. Same hero markup. */}
      {/* The hero IS the demo (2026-10-15, an outside reading: "Merge Make one now into the hero; See it work is already that
          button"): ArtMaker "home" renders the make button (labelled See it work) and the secondary How it works; the headline
          and the sentence are its children and fold away when a bridge is made, as on 2026-10-10. */}
      <ArtMaker mode="home" secondary={<Link className="bg-action-link" href="/docs/overview">How it works</Link>}>
        <h1>Position commitment.</h1>
        {/* Mike's line (2026-10-11), the claim this page rests on: a position is what is verified, never the content, never "when". */}
        <p className="lede home-lede-stat">The computation uses a position that opens first, so its result can&rsquo;t be&nbsp;backdated.</p>
      </ArtMaker>
      </div>

      {/* The point of view. Ceiling = "by" (what a timestamp gives); floor = "after" (what a position gives); order among
          everything recorded since. No superlative (Chainpoint rule, 2026-09-21). */}
      <section className="home-section home-pov" aria-labelledby="home-why">
        <p className="home-kicker">Why it is different</p>
        <h2 id="home-why">A timestamp says <em>by when</em>.<br />A position says <em>after what</em>.</h2>
        <p>A timestamp <em>claims</em> a record existed by a moment. A position commitment <em>proves</em> the record could not have existed before one, and fixes where it sits among everything recorded since. That is the part no clock can give, and it is the part an audit&nbsp;needs.</p>
              </section>

      {/* 01 / 02 / 03: what happens, the same three steps the demo pages list, said for any computation. Claim discipline:
          floor = a Base block the enclave READS; ceiling = the one Base transaction BitGraph WRITES; "after" and "by", never "when". */}
      <section className="home-section" aria-labelledby="home-what">
        <p className="home-kicker">What happens</p>
        <h2 id="home-what">Three steps.</h2>
        <div className="home-cards home-steps">
          <div className="home-card">
            <span className="demo-step-n" aria-hidden="true">1</span>
            <h3>A position opens</h3>
            <p>BitGraph&rsquo;s enclave opens a position and names the latest Base block. The position&rsquo;s commitment is unpredictable: nobody could have known it a second&nbsp;earlier.</p>
          </div>
          <div className="home-card">
            <span className="demo-step-n" aria-hidden="true">2</span>
            <h3>The work uses it</h3>
            <p>The commitment goes into the prompt, the dataset, the file. Whatever is made with it could not have existed before the&nbsp;BitGraph.</p>
          </div>
          <div className="home-card">
            <span className="demo-step-n" aria-hidden="true">3</span>
            <h3>The result is recorded in it</h3>
            <p>The finished bytes are committed to the same position, and one Base transaction fixes the record. A block before, a block after, seconds&nbsp;apart.</p>
          </div>
        </div>
      </section>

      {/* The numbers: BitGraph #40, measured live 2026-10-12 (/benchmark). Measured, never projected, on this page. */}
      <section className="home-section" aria-labelledby="home-numbers">
        <p className="home-kicker">Measured, not projected</p>
        <h2 id="home-numbers">One million files in one position.</h2>
        <div className="home-cards home-stats">
          <div className="home-card"><div className="home-stat">1,000,000</div><p>files in one BitGraph, each with its own place in the tree and its own&nbsp;proof.</p></div>
          <div className="home-card"><div className="home-stat">6.35 s</div><p>from the position opening to the proof, for all of them, on a&nbsp;laptop.</p></div>
          <div className="home-card"><div className="home-stat">$0.000374</div><p>in blockchain fees: one Base transaction for the million.</p></div>
        </div>
        <p className="home-section-link"><Link href="/benchmark">See the benchmark, with every number linked to its public record</Link></p>
      </section>


      {/* Who it is for: the three cards of 2026-10-11/14. Blue (one, then all three) was tried 2026-10-14/15 and dropped
          (Mike: "i dont like these blue anymore"); white, like every other card on the page. */}
      <section className="home-section" aria-labelledby="home-for">
        <p className="home-kicker">Who it is for</p>
        <h2 id="home-for">Anything a machine makes.</h2>
      {/* Three cards (Mike, 2026-10-11): what a visitor like Steven Mih would use it for, each claim one the mechanism
          delivers. Each links somewhere the two buttons do not (Mike, 2026-10-14: two of them went where the buttons go):
          the drop box, the integration guide, the benchmark. Order and most of the words from an outside review Mike brought
          2026-10-14 (Model outputs first: the page's thesis); the training-data line is the ordering claim one proof plus a
          later one delivers, not "chosen before any result was known", which one proof does not. Training data: recorded as is, its Base ceiling. Model outputs: the position opened first (the Jev demo).
          Volume: tree/1, up to 1,000,000 leaves per position, one Base write each. */}
      <div className="home-cards">
        <Link className="home-card" href="/docs/integration">
          <h2>AI model outputs</h2>
          <p>Put the position&rsquo;s commitment into the prompt. The answer could not have existed before the position opened, and the proof travels with the&nbsp;output.</p>
          <span className="home-card-link">Put it in your records</span>
        </Link>
        <Link className="home-card" href="/docs/try">
          <h2>Training data</h2>
          <p>Record the set before training. The proof fixes exactly which bytes went in, and a result recorded later provably followed&nbsp;it.</p>
          <span className="home-card-link">Record a dataset</span>
        </Link>
        {/* Was "High volume" (benchmark) until 2026-10-15 (Mike: "isnt high volume repeating itself?"; the numbers section above
            says it). Evaluations: the sealed-exam property, the /jev demo. */}
        <Link className="home-card" href="/jev">
          <h2>Evaluations</h2>
          <p>Derive the test from the commitment, and the questions could not have been in any training set. The answers are recorded in the same&nbsp;position.</p>
          <span className="home-card-link">Ask AI two questions</span>
        </Link>
      </div>
      </section>



    </div>
  );
}
