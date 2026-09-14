import type { Metadata } from "next";

/* ── /exam: the door for the sealed-exam outreach (2026-09-14).

   Twenty cold emails go out to benchmark and evaluation people. A 4 MB zip
   attached to a first email from a stranger is the thing that gets deleted;
   a link to a page on the sender's own domain, which says what the package
   claims, what it does NOT claim, what is in it and what it costs to run, is
   the thing that gets opened. This page is that link.

   LINKED AND INDEXED since 2026-09-14, from the model-evaluation entry on
   /subjects — the vertical it is the working proof of. It was unlisted and
   noindexed while nothing was public; that stopped being true the moment
   the repository went public, five packages went to npm and a release was
   tagged, and an unlisted page guarding public work is only inconsistency.
   NOT in the Docs nav: that menu is sections of the specification, and a
   case study is not a section.

   UNLIKE /deck it keeps the site's chrome. /deck is a door with nothing on
   it because its reader already knows who sent it. This reader does not: the
   nav, the footer, the Terms and the company name ARE the trust signal that
   makes a stranger willing to run a download, and stripping them to match
   /deck would be copying a decision made for the opposite situation.

   THE FILE IS NOT SERVED FROM HERE ON PURPOSE. website/public/ is a public
   repo and a public URL, and the five packages are proprietary with an
   evaluation grant. The zip is a GitHub release asset instead, beside the
   source it was built from, which is also the host this audience trusts
   most. What has to live on bitgraph.ing is the CHECKSUM: it lets a
   recipient prove the bytes they were handed are the bytes that were
   published, from a domain that is not the one that served them. ── */

/* The two ways in. Both are dead links until the repository is pushed and a
   release is cut, so THE REPO AND THE RELEASE GO UP BEFORE THIS PAGE DOES;
   null renders the disabled state if either has to wait.

   The zip is a release asset rather than a file served from this site:
   website/public/ is a public repo and a public URL, and the packages are
   proprietary with an evaluation grant. It is a versionless URL on purpose,
   the lesson Folder taught and the Recorder download already follows — the
   link never changes between versions, so this page cannot go stale on a
   release.

   Google Drive carried the zip for the first company and nothing else
   (Mike, 2026-09-14: "I only send drive file to one company"). Everyone
   after gets this page and the repository. */
const REPO_URL: string | null = "https://github.com/mikeargento/sealed-exam";
const ZIP_URL: string | null = "https://github.com/mikeargento/sealed-exam/releases/latest/download/BitGraph-Sealed-Exam.zip";

/* The published bytes. Recomputed from the zip that
   packages/exam-cli/outreach/build.sh wrote on 2026-09-14; rebuild the
   package and this line moves with it, or the page is lying about a file it
   did not check. */
const ZIP_SHA256 = "8452ef97d6fa59be88a4bdbc371813788d185432a248637691366358dbabf901";
const ZIP_SIZE = "4.1 MB";

/* ⚠️ THE DESCRIPTION IS PART OF THE COLD OPEN. It is the line under the
   title in a Slack or mail unfurl, so it follows the same rule as the h1:
   no "Ethereum", no "block", nothing crypto-shaped before the reader knows
   why there is a chain at all (Mike, 2026-09-14: "ethereum will scare off
   people"). The mechanism is named in full one line into the page itself. */
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
    /* The reading column, inline rather than in a layout.tsx: docs/layout.tsx
       supplies this to the fifteen docs routes, and /exam is a single page
       outside that tree. Same measure and the same 56px opening gap, so this
       page and a docs page cannot sit at different widths. */
    <div style={{ width: "90%", maxWidth: "var(--frame)", margin: "0 auto", padding: "56px 0 96px" }}>
    <article className="prose-doc">
      {/* The line names the problem in their word and states the
          distinction, and does not assert what is proven — the Proves /
          Does not prove pair an inch below does that, in both directions.
          "Freshness", not "contamination": contamination is the condition,
          freshness is the thing currently CLAIMED rather than checked, which
          is the whole seam this package opens. It was "A paper that could
          not have existed before block N", the package's own title, for one
          afternoon: "paper" garden-paths to an arXiv paper for an ML
          audience, and "block N" put the only crypto-shaped words on the
          page in the first thing a stranger reads (Mike, 2026-09-14:
          "ethereum will scare off people"). The mechanism is disclosed one
          line down instead, where there is room to say why there is one. */}
      {/* Two sentences, each unbreakable, so the ONLY place the line can
          break is the full stop. The nbsps that were here broke it at
          "This is / a check." instead, which is the one break that reads as
          a mistake. At the 800px column it is one line and this changes
          nothing; on a phone, and in a narrow browser pane, it falls into
          two clean halves. */}
      <h1 className="mb-6">
        <span style={{ whiteSpace: "nowrap" }}>Freshness is a claim.</span>{" "}
        <span style={{ whiteSpace: "nowrap" }}>This is a check.</span>
      </h1>

      {/* The claim boundary leads, because it is the whole product and
          because the audience this is sent to reads a benchmark claim
          looking for what it quietly omits. Putting the omission first is
          the only version of this paragraph they will finish. It is the
          README's own opening, kept word for word so the page and the
          package cannot drift. */}
      <p className="text-[#1f2937] mb-4">
        <strong>Proves:</strong> the exact question instances were derived from a commitment that did not exist before the floor block, so they were not in any training set frozen before that block; the paper&rsquo;s digest spent that slot; the answer sheet names the paper and sits at a later position on the same chain.
      </p>
      <p className="text-[#1f2937] mb-8">
        <strong>Does not prove:</strong> that the template families are unfamiliar to the model; that the model worked alone, without tools, or quickly; when the answers were produced beyond their own floor. The answer sheet has a floor, not a ceiling.
      </p>
      <p className="text-[#1f2937] mb-10">
        That paragraph is the whole claim, and this package asks you to attack it. Everything else is running code and real evidence: six models from three vendors sat the same kind of paper on 12 and 13 September 2026, each paper derived from a value that came into existence at a signed position on a public chain, and each sitting is a folder you verify with nothing but Node, offline, in three commands.
      </p>

      {/* TWO ACTIONS. The first is FILLED (.bg-download-link), the second
          the outlined pill.

          The rule written on .bg-action-link — every action the same size,
          the primary marked by position — is the rule for a page where the
          actions are secondary to the reading. /docs/recorder already breaks
          it, and on purpose: a page whose JOB is to hand you software gets
          one filled button. /exam is that same page. A reader arrives here
          from a cold email with one question, and two outlined pills the
          same weight as the nav's "Docs" answer it too quietly.

          Filling ONE, not both: two primaries is no primary. It is the
          GitHub link rather than the download because reading is the low
          commitment, high trust thing to do first, and because a stranger's
          4 MB zip is what you delete when you have not yet seen the code.
          The filled pill is also larger (17px/600 against 15px/500), so the
          pair still reads as one action and its alternative.

          The download names its file, because a stranger should know what
          lands in their Downloads folder before they click. It is the
          outlined pill and it fits: 293px inside the 338px column a 375px
          phone gives. The name it had first, BitGraph-Sealed-Exam-Demo.zip,
          missed that by TWO PIXELS and wrapped to two lines inside a
          full-width box — which is why the word Demo went. It was also the
          last place anything called this a demo, and a filename is the part
          that travels: into a Downloads folder, a terminal, a forwarded
          thread. MEASURE A LABEL BEFORE PUTTING IT IN A PILL. */}
      <p className="mb-6" style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 10, marginTop: 28 }}>
        <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
          {REPO_URL !== null ? (
            <a className="bg-action-link bg-download-link" href={REPO_URL} target="_blank" rel="noopener">
              Read the source on GitHub
              {/* The one action here that leaves the site. No visible ↗ in
                  the pill — arrows were taken out of pills on 2026-09-11 and
                  this is still a pill — but a screen reader is told, the way
                  the GitHub row in the docs menu tells it. */}
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          ) : (
            <button className="bg-action-link bg-download-link" type="button" disabled>Read the source on GitHub</button>
          )}
          {ZIP_URL !== null ? (
            <a className="bg-action-link" href={ZIP_URL}>Download BitGraph-Sealed-Exam.zip</a>
          ) : (
            <button className="bg-action-link" type="button" disabled>Download BitGraph-Sealed-Exam.zip</button>
          )}
        </span>
        <span className="text-[#4b5563]" style={{ fontSize: 13.5 }}>
          Node 20 or later &middot; a clone installs once, the {ZIP_SIZE} download installs nothing and never touches the network
        </span>
      </p>

      {/* A company about verifiable bytes that asks you to download
          unverified bytes has made its own argument for this. It is also the
          one thing the repository cannot do for itself: a hash published
          somewhere other than the host that served the file. */}
      <div className="code-block">
        <div className="code-block-header"><span>BitGraph-Sealed-Exam.zip &middot; SHA-256</span></div>
        <pre>{`shasum -a 256 BitGraph-Sealed-Exam.zip

${ZIP_SHA256}`}</pre>
      </div>
      <p className="text-[#4b5563]" style={{ fontSize: 14, margin: "6px 0 40px" }}>
        The repository and the zip are the same package in two forms. The repository holds the five packages in source, so the code can be read before it is run; the zip is that tree with the packages packed and the verification path vendored, so it runs with nothing installed and no network at all. Six sittings and seven fixtures in both.
      </p>

      <h2 className="text-xl font-semibold mt-12 mb-4">Run it</h2>
      {/* The same three commands whichever way they came in, which is the
          point of showing the clone's two lines above them rather than
          giving each form its own section. */}
      {/* The URL belongs in this sentence, not only in the pill at the top of
          the page: the section says "from a clone" and a reader who starts
          here would otherwise have to go and find what to clone. */}
      <p className="text-[#1f2937] mb-4">
        From a clone of <a href={REPO_URL ?? undefined} target="_blank" rel="noopener" style={{ color: "#0065A4", textDecoration: "none", fontWeight: 600 }}>github.com/mikeargento/sealed-exam</a>, one install, and it is the only moment anything touches the network:
      </p>
      <div className="code-block">
        <div className="code-block-header"><span>sealed-exam/</span></div>
        <pre>{`npm install
npm run build`}</pre>
      </div>
      <p className="text-[#1f2937] mb-4">
        From the zip, nothing: the five packages and their dependencies are vendored under <code>verifier/node_modules/</code>. Then the same three commands either way.
      </p>
      <div className="code-block">
        <div className="code-block-header"><span>sealed-exam/ &nbsp;or&nbsp; BitGraph-Sealed-Exam/</span></div>
        <pre>{`node verifier/demo.mjs                                   # the table, every value recomputed
node verifier/exam.mjs verify demo/claude-sonnet-5.exam  # one folder, every check listed
node verifier/exam.mjs selftest                          # DRBG vectors, determinism, checkers, fences: 11 self-tests`}</pre>
      </div>
      <p className="text-[#1f2937] mb-8">
        The verifier runs in a process where <code>fetch</code> and sockets throw, so a verifier that reached for the network would fail loudly rather than quietly; the shortest test of that is to turn the wifi off first. The second command writes <code>report.html</code> beside the folder: one page, no scripts, the verdict, the score, the block number linked to a public explorer, the two floors, one question opened up, and the claim boundary again at the bottom. It reads with CSS off.
      </p>

      <h2 className="text-xl font-semibold mt-12 mb-4">What the table says</h2>
      <p className="text-[#1f2937] mb-4">
        Six real sittings and seven fixtures, printed by the verifier from the files in the package. Four of the six scored 20/20; the bank is small and the families are easy for a frontier model on purpose, because the demonstration is about freshness, not difficulty.
      </p>
      <table>
        <tbody>
          <tr><td><strong>ACCEPT</strong></td><td>everything recomputes and agrees, and the score is what re-running the checkers says</td></tr>
          <tr><td><strong>REJECT</strong></td><td>something recomputes and disagrees; it names which of four &mdash; the paper, the commitment, the answers, or the order</td></tr>
          <tr><td><strong>NO-EVIDENCE</strong></td><td>something the claim needs is not in hand. Absence is never a verdict against the run</td></tr>
        </tbody>
      </table>
      <p className="text-[#1f2937] mt-4 mb-8">
        The seven fixtures are what the verifier is for, and each was made from real positions rather than by editing signatures into shape: a paper edited and then genuinely committed under its own slot, one sitting&rsquo;s paper presented with another&rsquo;s proof, an answer sheet moved below the paper it answers, a folder whose <code>grade.json</code> claims 20/20 and is never read. One model refused four questions outright; the refusals are in the package as the API returned them, counted wrong, with a note in the verdict.
      </p>

      <h2 className="text-xl font-semibold mt-12 mb-4">Where the floor comes from</h2>
      <p className="text-[#1f2937] mb-8">
        A hash of a question set published today is a postmark: it proves the set existed no later than now, which is the wrong direction for contamination. What contamination needs is a floor &mdash; proof that the questions could not have existed <em>before</em> a public moment, so no corpus frozen before it can contain them. A slot is allocated on the BitGraph chain; the enclave signs into it the latest Ethereum block it has authenticated; the commitment is derived from that signed slot record; the questions are derived from the commitment and a public bank; the paper is committed under the same slot. <code>SPEC.md</code> is the whole derivation &mdash; the seed, the DRBG with test vectors, the draw order, the two positions &mdash; and re-deriving a paper from it without any of this code is an afternoon in Python.
      </p>

      {/* The Recorder page's terms line, in the same place and the same
          words, so nobody downloads without having been told. */}
      <p className="text-[#4b5563]" style={{ fontSize: 14, margin: "6px 0 40px" }}>
        The packages that make positions are software of Argento Computing Inc., provided under the licence in the package, which grants evaluation use. The verifier is MIT. Questions, or a sitting of your own: <a href="/contact" style={{ color: "#0065A4", textDecoration: "none", fontWeight: 600, whiteSpace: "nowrap" }}>get in&nbsp;touch</a>.
      </p>
    </article>
    </div>
  );
}
