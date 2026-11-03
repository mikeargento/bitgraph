import type { Metadata } from "next";
import { DemoRow, HeroVideo } from "@/components/demo-row";
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
   write of about $0.0003 (quoted from Base, 2026-11-02), so about $2 a day: "under $3" leaves room for gas to move. A proof
   comes back in under half a second (0.47 s, 0.41 s and 0.34 s, measured on the live site on 2026-10-31). */
const SCALE_STEPS = [
  { op: "1 million per BitGraph", big: "6,000", small: "BitGraphs hold them all" },
  { op: "speed", big: "<\u20090.5\u2009s", small: "to make each proof" },
  { op: "all written to Base", big: "<\u2009$3", small: "a day in fees, at today\u2019s prices" },
];
/* The demos are all pictures; this row shows the same proof covers every other kind of file. */
const FILE_KINDS: FileKind[] = [
  { label: "Photo", glyph: "photo" }, { label: "Video", glyph: "video" }, { label: "Music", glyph: "music" }, { label: "Design", glyph: "design" },
  { label: "AI", glyph: "ai" }, { label: "Contract", glyph: "contract" }, { label: "Medical scan", glyph: "scan" }, { label: "Software", glyph: "code" },
];

/* Every record is written to Base: the hash of its proof goes into a Base transaction from BitGraph's writer, seconds
   after the bind, and that block is the record's public ceiling. The person recording signs and sends nothing. */
const ON_BASE = [
  { tag: "Private", title: "Nothing revealed.", body: "Proof without uploading your file." },
  { tag: "Free", title: "Nothing to sign.", body: "BitGraph writes every record to Base for you." },
  { tag: "Fast", title: "Nothing to wait for.", body: "Instant proof. On Base within seconds." },
];

export default function HomePage() {
  return (
    <div className="frame home home-typing prose home-scroll docs-page tools-page sx-page is-landing is-short">
      <section className="sx-hero" aria-labelledby="home-h">
        <HeroVideo />
        {/* The first screen is the claim, centred; How it works scrolls to the demo proofs. */}
        <h1 id="home-h">Digital&nbsp;film.</h1>
        <div className="sx-cta">
          <a className="bg-action-link is-make" href="/demos">Make a BitGraph</a>
          <a className="bg-action-link" href="#how">How it works</a>
        </div>
      </section>

      <section id="how" className="home-section" aria-labelledby="home-demo">
        <p className="home-kicker">Real files, real proofs</p>
        <h2 id="home-demo">Which one came&nbsp;first?</h2>
        <p>Same picture. Different bytes. Different proofs. Open any proof and check for&nbsp;yourself.</p>
        <DemoRow />
        <p className="home-what">BitGraph captures the<br />order of anything&nbsp;digital.</p>
        <p className="home-what-sub">So anyone can see it existed, and&nbsp;when.</p>
      </section>

      <section className="home-section" aria-labelledby="home-any">
        <p className="home-kicker">Any file</p>
        <h2 id="home-any">Not just images.</h2>
        <p>Video, music, designs, contracts, medical scans, code. If it&rsquo;s a file, it gets a place in&nbsp;line.</p>
        <FileTypes kinds={FILE_KINDS} />
      </section>

      <section className="home-section home-scale-sec" aria-labelledby="home-scale">
        <p className="home-kicker">At planetary scale</p>
        <h2 id="home-scale">BitGraph is built to record every photo taken on Earth. Every&nbsp;day.</h2>
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

      <section className="home-section" aria-labelledby="home-reads">
        <p className="home-kicker">In the background</p>
        <h2 id="home-reads">Privately on the blockchain. No&nbsp;wallets. No&nbsp;tokens.</h2>
        <p>Every BitGraph is quietly written to Base, Coinbase&rsquo;s Ethereum network. Its block is public proof the record existed by&nbsp;then.</p>
        <div className="sx-cards is-3 is-plain">
          {ON_BASE.map((r) => (
            <article key={r.title} className="tl-card">
              <p className="tl-label">{r.tag}</p>
              <h3>{r.title}</h3>
              <p>{r.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="home-section" aria-labelledby="home-paths">
        <p className="home-kicker">Get started</p>
        <h2 id="home-paths">Develop your first&nbsp;photo.</h2>
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
