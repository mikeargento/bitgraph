import type { Metadata } from "next";
import { DocsPageNav } from "@/components/docs-page-nav";
import { CopyCode } from "@/components/copy-code";
import { Code } from "@/components/code";

/* /exam: the door for the sealed-exam outreach. The zip is a GitHub release
   asset, not a file served from this site, and its URL is versionless so the
   page cannot go stale on a release. The checksum lives here so a recipient
   can check the bytes against a domain that did not serve them. */
const REPO_URL: string | null = "https://github.com/mikeargento/sealed-exam";
const ZIP_URL: string | null = "https://github.com/mikeargento/sealed-exam/releases/latest/download/BitGraph-Sealed-Exam.zip";

/* Recomputed from the zip that packages/exam-cli/outreach/build.sh wrote on
   2026-09-14; rebuild the package and this line moves with it. */
const ZIP_SHA256 = "8452ef97d6fa59be88a4bdbc371813788d185432a248637691366358dbabf901";
const ZIP_SIZE = "4.1 MB";

export const metadata: Metadata = {
  title: "The sealed exam",
  description:
    "Six models from three vendors sat a paper derived from a value that did not exist before a fixed public moment. Each sitting is a folder you verify offline, with nothing but Node, in three commands.",
  openGraph: {
    title: "Freshness is a claim. This is a check.",
    description:
      "Six models from three vendors sat a paper derived from a value that did not exist before a fixed public moment. Each sitting is a folder you verify offline, with nothing but Node, in three commands.",
    type: "website",
    siteName: "BitGraph",
  },
};

export default function ExamPage() {
  return (
    <div className="frame" style={{ padding: "56px 0 96px" }}>
      <article className="prose">
        <h1>
          <span className="nowrap">Freshness is a claim.</span>{" "}
          <span className="nowrap">This is a check.</span>
        </h1>
        <p className="lede">
          Six models from three vendors sat the same kind of paper on 12 and 13 September 2026. Each paper was derived from a value that came into existence at a signed position on a public chain, and each sitting is a folder you verify with nothing but Node, offline, in three commands. The pair below is the whole claim, and this package asks you to attack it. Everything else is running code and real evidence.
        </p>

        <ul className="facts">
          <li><b>Proves</b><span>the exact question instances were derived from a commitment that did not exist before the floor block, so they were not in any training set frozen before that block; the paper&rsquo;s digest spent that slot; the answer sheet names the paper and sits at a later position on the same chain.</span></li>
          <li><b>Does not prove</b><span>that the template families are unfamiliar to the model; that the model worked alone, without tools, or quickly; when the answers were produced beyond their own floor. The answer sheet has a floor, not a ceiling.</span></li>
        </ul>

        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, margin: "1.5rem 0 0.75rem" }}>
          {REPO_URL !== null ? (
            <a className="btn is-primary" href={REPO_URL} target="_blank" rel="noopener">
              Read the source on GitHub
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          ) : (
            <button className="btn is-primary" type="button" disabled>Read the source on GitHub</button>
          )}
          {ZIP_URL !== null ? (
            <a className="btn" href={ZIP_URL}>Download BitGraph-Sealed-Exam.zip</a>
          ) : (
            <button className="btn" type="button" disabled>Download BitGraph-Sealed-Exam.zip</button>
          )}
        </div>
        <p className="meta">
          Node 20 or later &middot; a clone installs once, the {ZIP_SIZE} download installs nothing and never touches the network
        </p>

        <div className="code-block">
          <div className="code-block-header"><span>BitGraph-Sealed-Exam.zip &middot; SHA-256</span></div>
          <Code lang="bash">{`shasum -a 256 BitGraph-Sealed-Exam.zip

${ZIP_SHA256}`}</Code>
        </div>
        <p className="note">
          The repository and the zip are the same package in two forms. The repository holds the five packages in source, so the code can be read before it is run; the zip is that tree with the packages packed and the verification path vendored, so it runs with nothing installed and no network at all. Six sittings and seven fixtures in both.
        </p>

        <h2 id="run">Run it</h2>
        <p>
          From a clone of <a href={REPO_URL ?? undefined} target="_blank" rel="noopener">github.com/mikeargento/sealed-exam</a>, one install, and it is the only moment anything touches the network:
        </p>
        <div className="code-block">
          <div className="code-block-header"><span>sealed-exam/</span><CopyCode /></div>
          <Code lang="bash">{`npm install
npm run build`}</Code>
        </div>
        <p>
          From the zip, nothing: the five packages and their dependencies are vendored under <code>verifier/node_modules/</code>. Then the same three commands either way.
        </p>
        <div className="code-block">
          <div className="code-block-header"><span>sealed-exam/ &nbsp;or&nbsp; BitGraph-Sealed-Exam/</span><CopyCode /></div>
          <Code lang="bash">{`node verifier/demo.mjs                                   # the table, every value recomputed
node verifier/exam.mjs verify demo/claude-sonnet-5.exam  # one folder, every check listed
node verifier/exam.mjs selftest                          # DRBG vectors, determinism, checkers, fences: 11 self-tests`}</Code>
        </div>
        <p>
          The verifier runs in a process where <code>fetch</code> and sockets throw, so a verifier that reached for the network would fail loudly rather than quietly; the shortest test of that is to turn the wifi off first. The second command writes <code>report.html</code> beside the folder: one page, no scripts, the verdict, the score, the block number linked to a public explorer, the two floors, one question opened up, and the claim boundary again at the bottom. It reads with CSS off.
        </p>

        <h2 id="table">What the table says</h2>
        <p>
          Six real sittings and seven fixtures, printed by the verifier from the files in the package. Four of the six scored 20/20; the bank is small and the families are easy for a frontier model on purpose, because the demonstration is about freshness, not difficulty.
        </p>
        <div className="table-scroll">
          <table className="table-k">
            <tbody>
              <tr><td>ACCEPT</td><td>everything recomputes and agrees, and the score is what re-running the checkers says</td></tr>
              <tr><td>REJECT</td><td>something recomputes and disagrees; it names which of four: the paper, the commitment, the answers, or the order</td></tr>
              <tr><td>NO-EVIDENCE</td><td>something the claim needs is not in hand. Absence is never a verdict against the run</td></tr>
            </tbody>
          </table>
        </div>
        <p>
          The seven fixtures are what the verifier is for, and each was made from real positions rather than by editing signatures into shape: a paper edited and then genuinely committed under its own slot, one sitting&rsquo;s paper presented with another&rsquo;s proof, an answer sheet moved below the paper it answers, a folder whose <code>grade.json</code> claims 20/20 and is never read. One model refused four questions outright; the refusals are in the package as the API returned them, counted wrong, with a note in the verdict.
        </p>

        <h2 id="floor">Where the floor comes from</h2>
        <p>
          A hash of a question set published today is a postmark: it proves the set existed no later than now, which is the wrong direction for contamination. What contamination needs is a floor: proof that the questions could not have existed <em>before</em> a public moment, so no corpus frozen before it can contain them. A slot is allocated on the BitGraph chain; the enclave signs into it the latest Ethereum block it has authenticated; the commitment is derived from that signed slot record; the questions are derived from the commitment and a public bank; the paper is committed under the same slot. <code>SPEC.md</code> is the whole derivation (the seed, the DRBG with test vectors, the draw order, the two positions), and re-deriving a paper from it without any of this code is an afternoon in Python.
        </p>

        <p className="note">
          The packages that make positions are software of Argento Computing Inc., provided under the licence in the package, which grants evaluation use. The verifier is MIT. Questions, or a sitting of your own: <a href="/contact" className="nowrap">get in&nbsp;touch</a>.
        </p>
      </article>
    <DocsPageNav current="/exam" />
    </div>
  );
}
