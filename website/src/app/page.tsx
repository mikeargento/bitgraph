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

/* Planet scale (2026-11-02): what it takes to give every photo taken on Earth in a day a place in line, each step
   checkable. Photos a day: about 6 billion, the highest current estimate (Photutorial, 2.2 trillion for 2026,
   photutorial.com/photos-statistics; Rise Above Research has 1.95 trillion). A BitGraph holds a million files (the
   million-file run on Technology, not a limit), so 6,000 BitGraphs, which one enclave makes at a few percent of its pace. Each is one Base
   write of about $0.0003 (quoted from Base, 2026-11-02), so about $2 a day, which BitGraph pays; the person recording pays nothing. A proof
   comes back in under half a second (0.47 s, 0.41 s and 0.34 s, measured on the live site on 2026-10-31). */
const SCALE_STEPS = [
  { op: "1 million per BitGraph", big: "6,000", small: "BitGraphs hold them all" },
  { op: "speed", big: "<\u20090.5\u2009s", small: "to make each proof" },
  { op: "all written to Base", big: "Free", small: "Built into BitGraph" },
];
/* The demos are all pictures; this row shows the same proof covers every other kind of file. */
const FILE_KINDS: FileKind[] = [
  { label: "Photo", glyph: "photo" }, { label: "Video", glyph: "video" }, { label: "Music", glyph: "music" }, { label: "Design", glyph: "design" },
  { label: "AI", glyph: "ai" }, { label: "Contract", glyph: "contract" }, { label: "Medical scan", glyph: "scan" }, { label: "Code", glyph: "code" },
];

export default function HomePage() {
  return (
    <div className="frame home home-typing prose home-scroll docs-page tools-page sx-page is-landing is-short">
      {/* The first screen is the claim and its proof together: the headline and the two actions, left aligned, over
          the three versions of one picture; then what BitGraph does about them. */}
      <section id="how" className="home-section home-open" aria-labelledby="home-h">
        <h1 id="home-h">Digital&nbsp;film.</h1>
        <p className="home-open-sub">Prove your photo came&nbsp;first.</p>
        <div className="sx-cta">
          <a className="bg-action-link is-make" href="/demos">Make a BitGraph</a>
          <a className="bg-action-link" href="/ledger">See the Roll</a>
        </div>
        <DemoRow />
        <p className="home-what">BitGraph captures the<br />order of anything&nbsp;digital.</p>
        <p className="home-what-sub">So anyone can see it existed, and&nbsp;when.</p>
      </section>

      <section className="home-section" aria-labelledby="home-any">
        <h2 id="home-any"><span className="is-quiet">Not just images.</span> Any&nbsp;file.</h2>
        <FileTypes kinds={FILE_KINDS} />
      </section>

      <section className="home-section home-scale-sec" aria-labelledby="home-scale">
        <h2 id="home-scale" className="is-quiet">Built to BitGraph every photo taken on Earth. Every&nbsp;day.</h2>
        <div className="scale">
          <div className="scale-top">
            <div className="scale-huge">6 billion photos</div>
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
        <p className="scale-note">Photos a day: about 6 billion, the highest current estimate (Photutorial,&nbsp;2026).</p>
      </section>

      <section className="home-section" aria-labelledby="home-paths">
        <h2 id="home-paths">Develop your first&nbsp;photo.</h2>
        <p className="home-paths-sub">Every photo is undeveloped <span className="home-break">until it&rsquo;s&nbsp;BitGraphed.</span></p>
        <div className="sx-cards">
          <a className="tl-card sx-link" href="/demos">
            <p className="tl-label">Try it</p>
            <h3>Drag and develop.</h3>
            <p>Any photo, video or file. Your proof comes back in under a&nbsp;second.</p>
          </a>
          <a className="tl-card sx-link" href="/ledger">
            <p className="tl-label">The Roll</p>
            <h3>See every frame.</h3>
            <p>Every BitGraph ever made, in order, open to&nbsp;anyone.</p>
          </a>
          <a className="tl-card sx-link" href="/integrate">
            <p className="tl-label">For developers</p>
            <h3>Build it in.</h3>
            <p>Add BitGraph to your app or camera with a few lines of&nbsp;code.</p>
          </a>
        </div>
      </section>
    </div>
  );
}
