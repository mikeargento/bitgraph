// The sealed exam's content, shared by its own page and the demos page (2026-11-04).
import { CopyCode } from "@/components/copy-code";
import { SandwichFigure } from "@/components/primitive-figures";
import { GoArrow } from "@/components/go-arrow";
import { codeLang } from "@/lib/code-lang";

/**
 * The sealed exam, on two BitGraphs (2026-10-19, shipped together with the repo's release v3 and npm 0.3.0).
 * A binds a request naming the public bank; twenty questions are derived from A's nonce; the model answers; B binds the
 * answer sheet. Repo: github.com/mikeargento/sealed-exam. The zip is a GitHub release asset and its
 * URL is versionless (releases/latest), so the page cannot point at a stale file; the checksum is here so a recipient can
 * check the bytes against a domain that did not serve them. Rebuild the package and ZIP_SHA256 moves with it.
 */
const REPO_URL = "https://github.com/mikeargento/sealed-exam";
const ZIP_URL = "https://github.com/mikeargento/sealed-exam/releases/latest/download/BitGraph-Sealed-Exam.zip";
const ZIP_SHA256 = "e99d692e33c3dc2171f07b365be89cc57fa844de67e29115f654d3be964ac57a";
const ZIP_SIZE = "11.2 MB";

/** The sitting in the package's demo/ (claude-haiku-4-5, 2026-10-24, enclave v13). */
const SITTING = {
  model: "Claude Haiku 4.5",
  score: "14/20",
  date: "24 October 2026",
  a: { n: "14", id: "iehfooh2p78A4BzdVdHWCCaCUYw0mwavOWVkLgv5L1c", at: "20:14:24 UTC" },
  b: { n: "18", id: "SfL8unjOBZ-SSEDKqTDgW_Bp7oEvp5PJ6LUq232wPZk", at: "20:14:43 UTC" },
};

function Code({ children }: { children: string }) {
  return (
    <div className="code-block mk-code" data-lang={codeLang(children)}>
      <pre className="hiw-code">{children}</pre>
      <CopyCode />
    </div>
  );
}

/** The sealed exam: the claim, the sitting, the figure, what it proves, and how to check it. */
export function ExamContent() {
  return (
    <>
      <section className="home-section" aria-labelledby="exam-h">
        <p className="home-kicker">Sealed exam</p>
        <h2 id="exam-h">A benchmark you can prove is&nbsp;fresh</h2>
        <p style={{ marginTop: 24 }}>
          BitGraph A binds a request naming a public question bank. Twenty questions are derived from A&rsquo;s nonce,
          unseen until A is bound, so no training set frozen before A can contain them. The model answers, and the answer
          sheet is bound as BitGraph B, after A in the same sequence. Anyone checks the whole sitting offline, with nothing
          but Node.
        </p>
        <div className="demo-bars" style={{ marginTop: 24 }}>
          <a className="bg-action-link is-bar" style={{ margin: 0 }} href={ZIP_URL}>Download the package<GoArrow /></a>
          <a className="bg-action-link is-bar" style={{ margin: 0 }} href={REPO_URL} target="_blank" rel="noopener">Source on GitHub<GoArrow /></a>
        </div>
      </section>

      <section className="home-section" aria-labelledby="exam-sitting">
        <p className="home-kicker">The results</p>
        <h2 id="exam-sitting">These exact questions could not have existed before BitGraph&nbsp;#{SITTING.a.n} was&nbsp;bound</h2>
        <p style={{ marginTop: 24 }}>
          {SITTING.model} scored {SITTING.score} on {SITTING.date}. BitGraph #{SITTING.a.n} and BitGraph #{SITTING.b.n} are counts in one sequence. The AWS Nitro attestation&rsquo;s clock, a
          hardware layer signed by AWS, puts them at {SITTING.a.at} and {SITTING.b.at}, so the answers were bound by B&rsquo;s
          attested time. The bank is small and easy on purpose: this is about
          freshness, not difficulty.
        </p>
        <div className="demo-bars" style={{ marginTop: 20 }}>
          <a className="bg-action-link is-bar" style={{ margin: 0 }} href={`/proof/${SITTING.a.id}`}>BitGraph A #{SITTING.a.n}, the request<GoArrow /></a>
          <a className="bg-action-link is-bar" style={{ margin: 0 }} href={`/proof/${SITTING.b.id}`}>BitGraph B #{SITTING.b.n}, the answers<GoArrow /></a>
        </div>
      </section>

      <section className="home-section" aria-label="How it works">
        <SandwichFigure
          a="The request"
          steps={[{ title: "20 questions", sub: "From A’s nonce" }, { title: "The model", sub: "Answers" }]}
          b="The answers"
          caption={<>The questions could not exist before&nbsp;A.<br />The answers are bound at&nbsp;B.</>}
          label="BitGraph A binds the request naming the bank. Twenty questions are derived from A's nonce, the model answers them, and BitGraph B binds the answer sheet."
        />
      </section>

      <section className="home-section" aria-labelledby="exam-claim">
        <p className="home-kicker">The claim</p>
        <h2 id="exam-claim">What it proves, and what it does&nbsp;not</h2>
        <ul className="facts" style={{ marginTop: 24 }}>
          <li><b>Proves</b><span>every question is derived from BitGraph A&rsquo;s nonce, which the enclave drew and bound in one atomic action and nobody could see before A existed, so the exact questions did not exist before A, and no training set frozen before A was bound contains them; A&rsquo;s request named the bank, so the bank was fixed before that nonce; BitGraph B bound the answer sheet, which names the paper and A, at a later count in the same epoch; both proofs carry an AWS Nitro attestation of a published BitGraph enclave image, and B&rsquo;s AWS-signed attestation time is when the answers were bound.</span></li>
          <li><b>Does not prove</b><span>that the template families are unfamiliar to the model; that the model worked alone, without tools, or quickly; that the answers came from the model the sheet names.</span></li>
        </ul>
      </section>

      <section className="home-section" aria-labelledby="exam-run">
        <p className="home-kicker">Check it</p>
        <h2 id="exam-run">Three commands, no network</h2>
        <p style={{ marginTop: 24 }}>
          Unzip the package ({ZIP_SIZE}; Node 22.13 or later). Everything it needs is inside it, and the verifier runs in a
          process where <code>fetch</code> and sockets throw, so turning the wifi off first is a fair test.
        </p>
        <Code>{`node verifier/demo.mjs
node verifier/exam.mjs verify demo/claude-haiku-4-5.exam
node verifier/exam.mjs selftest`}</Code>
        <p style={{ marginTop: 16 }}>
          The answers are <strong>ACCEPT</strong>, <strong>REJECT</strong> (naming what disagrees) or{" "}
          <strong>NO-EVIDENCE</strong> (something is not in hand). The package carries nine fixtures that should fail, among them a
          proof re-signed with a laptop key that a signature check alone passes. The zip&rsquo;s SHA-256:
        </p>
        <Code>{ZIP_SHA256}</Code>
        <p style={{ marginTop: 16 }}>To run a sitting of your own, with your own API key:</p>
        <Code>{"npx @mikeargento/exam-cli run --provider anthropic --model <id> --name mine"}</Code>
      </section>
    </>
  );
}
