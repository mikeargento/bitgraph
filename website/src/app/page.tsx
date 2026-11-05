import type { Metadata } from "next";
import { DemoRow } from "@/components/demo-row";
import { FileTypes, type FileKind } from "@/components/file-types";

/**
 * The home page (2026-10-27; made short 2026-10-31): the claim and a one-line definition over a proven video, then
 * evidence rather than explanation: the proven pictures, blockchain order without writes, three facts, the mechanism figure with one line, the
 * ways to adopt it. The explaining lives on Technology. The claims are the Technology page's, short; each is in the v13
 * enclave and the verifier.
 *
 * ⚠️ Claim discipline, unchanged: bound by a time and after an unpredictable value, never "created at"; it says when
 * bits were bound, not how old they are or who made them.
 */

const DESCRIPTION =
  "Every photo, video or file gets a numbered place in line, like a frame on a roll of film. Anyone can check it, offline, in seconds.";

export const metadata: Metadata = {
  title: { absolute: "BitGraph: Digital film" },
  description: DESCRIPTION,
  openGraph: { title: "Digital film is here.", description: DESCRIPTION },
  twitter: { title: "Digital film is here.", description: DESCRIPTION },
};

/* Scale (2026-11-04, records in place of photos): what a trillion records take, each step checkable. A BitGraph
   holds a million files (the million-file run on Technology, not a limit), so a trillion records are a million
   BitGraphs. Each is one Base write of about $0.0003 (quoted from Base, 2026-11-02), so about $300 for all of them.
   Storage is the proofs and their ceilings at today's sizes (about 8 KB and 5 KB each), about 13 GB for a million,
   so under 20 GB. A proof is found in under half a second (0.47 s, 0.41 s and 0.34 s, measured on the live site on
   2026-10-31). */
const SCALE_STEPS = [
  { op: "1 million per BitGraph", big: "1,000,000", small: "BitGraphs hold them all" },
  { op: "speed", big: "~5 s", small: "to make 1,000,000 proofs" },
  { op: "every proof kept", big: "<\u200920\u2009GB", small: "verifies offline, forever" },
];
/* The demos are all pictures; this row shows the same proof covers every other kind of file. */
const FILE_KINDS: FileKind[] = [
  { label: "Photo", glyph: "photo" }, { label: "Video", glyph: "video" }, { label: "Music", glyph: "music" }, { label: "Design", glyph: "design" },
  { label: "AI", glyph: "ai" }, { label: "Contract", glyph: "contract" }, { label: "Medical", glyph: "scan" }, { label: "Code", glyph: "code" },
];

export default function HomePage() {
  return (
    <div className="frame home home-typing prose home-scroll docs-page tools-page sx-page is-landing is-short">
      {/* The first screen is the claim and its proof together: the headline and the two actions, left aligned, over
          the three versions of one picture; then what BitGraph does about them. */}
      <section id="how" className="home-section home-open" aria-labelledby="home-h">
        {/* The headline breaks in two on wide screens and in four on phones; the spaces sit before each break so a
            hidden break leaves a plain space and a shown one leaves no indent. */}
        <h1 id="home-h">Everything{" "}<br className="home-h-ph" />digital{" "}<br className="home-h-dt" />is{" "}<br className="home-h-ph" />already a{" "}<br className="home-h-ph" />copy.</h1>
        <p className="home-open-sub">BitGraph just puts things in&nbsp;order.</p>
        <div className="sx-cta">
          <a className="bg-action-link is-make" href="/demos">Make a BitGraph</a>
          <a className="bg-action-link" href="/ledger">See the Ledger</a>
        </div>
        <DemoRow />
        <p className="home-what">Provenance{" "}<br />with proof.</p>
        <p className="home-what-sub">Any file or record, in order. Anyone can check it, offline,&nbsp;forever.</p>
      </section>

      <section className="home-section" aria-labelledby="home-any">
        <h2 id="home-any">Any&nbsp;file.</h2>
        <FileTypes kinds={FILE_KINDS} />
      </section>

      <section className="home-section home-scale-sec" aria-labelledby="home-scale">
        <h2 id="home-scale" className="is-quiet">Built for every record there&nbsp;is.</h2>
        <div className="scale">
          <div className="scale-top">
            <div className="scale-huge">1 trillion proofs</div>
          </div>
          <div className="scale-row">
            {SCALE_STEPS.map((x) => (
              <div key={x.op} className="scale-cell">
                <div className="scale-op">{x.op}</div>
                <div className="scale-big">{x.big}</div>
                <div className="scale-small">{x.small}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="home-section" aria-labelledby="home-paths">
        <h2 id="home-paths">Make a&nbsp;BitGraph.</h2>
        <div className="sx-cards">
          <a className="tl-card sx-link" href="/demos">
            <h3>Drag and drop.</h3>
            <p>Any photo, video or file. No account, no cost, under a&nbsp;second.</p>
          </a>
          <a className="tl-card sx-link" href="/ledger">
            <h3>View the ledger.</h3>
            <p>Every BitGraph ever made, in order. Only the hash is public. The file stays&nbsp;private.</p>
          </a>
          <a className="tl-card sx-link" href="/integrate">
            <h3>Build it in.</h3>
            <p>Add BitGraph to your app or camera with a few lines of&nbsp;code.</p>
          </a>
        </div>
      </section>
    </div>
  );
}
