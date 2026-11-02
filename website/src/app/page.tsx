import type { Metadata } from "next";
import { MechanismFigure } from "@/components/mechanism-figure";
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
  "A portable proof of where your digital record stands in a counted sequence. The proof checks offline, and every one is written to Base, where anyone can confirm it existed by that block.";

export const metadata: Metadata = {
  title: { absolute: "BitGraph: Order before time" },
  description: DESCRIPTION,
  openGraph: { title: "Order before time.", description: DESCRIPTION },
  twitter: { title: "Order before time.", description: DESCRIPTION },
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
   after the bind, and that block is the record's public ceiling. The caller signs and sends nothing. */
const ON_BASE = [
  { title: "No wallet required.", body: "Send a hash. Get a proof. No wallet to connect, tokens to buy or balance to maintain." },
  { title: "No fees to manage.", body: "Every record is written to Base for you. No transactions to sign or send." },
  { title: "On Base in seconds.", body: "Your proof arrives when the record is bound. Its Base write lands seconds later, and anyone can look it up on Basescan." },
];

export default function HomePage() {
  return (
    <div className="frame home home-typing prose home-scroll docs-page tools-page sx-page is-landing is-short">
      <section className="sx-hero" aria-labelledby="home-h">
        <HeroVideo />
        {/* The first screen is the claim and its one-line definition (2026-10-31), centred; How it works scrolls to the proofs. */}
        <h1 id="home-h">Order before&nbsp;time.</h1>
        <p className="sx-sub hero-sub">A BitGraph is proof of your file&rsquo;s place in&nbsp;line.</p>
        <div className="sx-cta">
          <a className="bg-action-link is-make" href="/demos">Try it</a>
          <a className="bg-action-link" href="#how">How it works</a>
        </div>
      </section>

      <section id="how" className="home-section" aria-labelledby="home-demo">
        <p className="home-kicker">Real files, real proofs</p>
        <h2 id="home-demo">Same picture. Different bytes. Different&nbsp;proofs.</h2>
        <p>What you see isn&rsquo;t proof. Each BitGraph binds a file&rsquo;s exact bytes to a verifiable place in line. Open either proof and check for&nbsp;yourself.</p>
        <DemoRow />
      </section>

      <section className="home-section home-scale-sec" aria-labelledby="home-scale">
        <p className="home-kicker">At planetary scale</p>
        <h2 id="home-scale">BitGraph every photo taken on Earth. Every&nbsp;day.</h2>
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
        <p className="home-kicker">Every record, on chain</p>
        <h2 id="home-reads">Blockchain order, using&nbsp;Base.</h2>
        <p>Every BitGraph is written to Base, Coinbase's Ethereum network. Its Base block is public proof the record existed by&nbsp;then.</p>
        <div className="sx-cards is-3">
          {ON_BASE.map((r) => (
            <article key={r.title} className="tl-card">
              <h3>{r.title}</h3>
              <p>{r.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="home-section home-art" aria-labelledby="home-art">
        <p className="home-kicker">Made after its proof</p>
        <h2 id="home-art">This picture couldn&rsquo;t exist before BitGraph&nbsp;#122.</h2>
        <p>Every shape is drawn from a random value created inside #122. Until #122 existed, nobody could know what the picture would look&nbsp;like.</p>
        <figure className="art-figure">
          <img src="/demo/bridge-124.png" width={1920} height={1080} alt="The Golden Gate Bridge drawn in rectangles, from the unpredictable value of BitGraph #122" loading="lazy" />
          <figcaption className="demo-links">
            <a href="/proof/S1dfGEeynO7IL3acGc5SSlKxLHLMn7CtTAbPUqoKZ38?counter=122&amp;epoch=KmoEizbgaaeMeM-RMn6VuHvghxj9ZfyR9MV-hEpCrbs">#122, the seed</a>
            <a href="/proof/rQKRGOoLSh2hkaf1nZVCVg3dlvbAcInqQCj_Uy0et-E?counter=124&amp;epoch=KmoEizbgaaeMeM-RMn6VuHvghxj9ZfyR9MV-hEpCrbs">#124, the picture</a>
            <a href="https://github.com/mikeargento/bitgraph/blob/main/website/src/lib/commitment-art-v19.ts" target="_blank" rel="noopener">The code</a>
          </figcaption>
        </figure>
      </section>



      {/* Made after its proof (re-recorded 2026-11-02, with Base writes): the bridge is drawn (bitgraph-art/19) from the
          nonce the enclave drew for BitGraph #122, the request, and the finished PNG is recorded as #124. Redrawing from that
          nonce gives the same bytes. The image shown is the recorded file itself (public/demo/bridge-124.png); earlier
          recordings (#12,526 and #12,530, bridge.png; #42 and #44, bridge-44.png) stay for their own proof pages. */}

      <section className="home-section" aria-labelledby="home-any">
        <p className="home-kicker">Any file</p>
        <h2 id="home-any">Film. Tape. Ink. BitGraph.</h2>
        <p>Film is there before the light. Tape is there before the sound. Paper is there before the ink. A BitGraph is there before the&nbsp;bits.</p>
        <FileTypes kinds={FILE_KINDS} />
      </section>

      <section className="home-section" aria-labelledby="home-mech">
        <p className="home-kicker">The mechanism</p>
        <h2 id="home-mech">The position comes first.</h2>
        <p>Hardware draws an unpredictable value at count N. Your digest is bound at N+1. Both are signed together, in one action.</p>
        <MechanismFigure />
        <div className="sx-cta"><a className="bg-action-link" href="/technology">Read the technology</a></div>
      </section>

      <section className="home-section" aria-labelledby="home-paths">
        <p className="home-kicker">Ways to adopt it</p>
        <h2 id="home-paths">Use it, license it, or build on it with us.</h2>
        <div className="sx-cards">
          <a className="tl-card sx-link" href="/integrate">
            <p className="tl-label">Managed recording</p>
            <h3>Use the service.</h3>
            <p>Send digests over HTTP, the SDK or MCP. Nothing to operate.</p>
          </a>
          <a className="tl-card sx-link" href="/licensing">
            <p className="tl-label">Mechanism license</p>
            <h3>License the mechanism.</h3>
            <p>Run the recording step under your own measured build.</p>
          </a>
          <a className="tl-card sx-link" href="/licensing">
            <p className="tl-label">Custom integration</p>
            <h3>Build on it together.</h3>
            <p>Engineering work for your workflow.</p>
          </a>
        </div>
        <p className="home-paths-more">Not sure where it fits your product? <a href="/applications">See the products it sits&nbsp;under</a>.</p>
      </section>

      <section className="home-section" aria-labelledby="home-end">
        <h2 id="home-end">Give your customers a proof they can check&nbsp;themselves.</h2>
        <div className="sx-cta">
          <a className="bg-action-link is-make" href="/evaluate">Request a technical evaluation</a>
          <a className="bg-action-link" href="/licensing">Licensing</a>
        </div>
      </section>
    </div>
  );
}
