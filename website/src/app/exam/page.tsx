import type { Metadata } from "next";
import { CopyCode } from "@/components/copy-code";
import { SandwichFigure } from "@/components/primitive-figures";

/**
 * The sealed exam, on two BitGraphs (Mike, 2026-10-19: "do all 3": the repo's release v3, npm 0.3.0, and this page).
 * A binds a request naming the public bank; twenty questions are derived from A's nonce; the model answers; B binds the
 * answer sheet with a Base ceiling. Repo: github.com/mikeargento/sealed-exam. The zip is a GitHub release asset and its
 * URL is versionless (releases/latest), so the page cannot point at a stale file; the checksum is here so a recipient can
 * check the bytes against a domain that did not serve them. Rebuild the package and ZIP_SHA256 moves with it.
 */
const REPO_URL = "https://github.com/mikeargento/sealed-exam";
const ZIP_URL = "https://github.com/mikeargento/sealed-exam/releases/latest/download/BitGraph-Sealed-Exam.zip";
const ZIP_SHA256 = "0b2410b278f4ddd090a2dad335e9cb0d7ccdf5a52aee0dc04f42787d28d0bc53";
const ZIP_SIZE = "11.1 MB";

/** The sitting in the package's demo/ (claude-haiku-4-5, 2026-10-19, enclave v13). */
const SITTING = {
  model: "Claude Haiku 4.5",
  score: "12/20",
  a: { n: "102", id: "G_pjZcvmt1vFvpnryeLOz1oU-oh4YbtidaJZetxDaqk", at: "05:09:47 UTC" },
  b: { n: "104", id: "DMtRKRoPudd_-dUuNwlLichD7_rTjN2ydXsGsjAthpI", at: "05:10:10 UTC" },
  ceiling: { block: 52798633, at: "05:10:13 UTC" },
};

export const metadata: Metadata = {
  title: "The sealed exam",
  description:
    "A benchmark you can prove is fresh: twenty questions derived from BitGraph A's nonce, the answers bound as BitGraph B, and the whole sitting verified offline in three commands.",
  openGraph: {
    title: "A benchmark you can prove is fresh.",
    description:
      "Twenty questions derived from BitGraph A's nonce, the answers bound as BitGraph B, and the whole sitting verified offline in three commands.",
    type: "website",
    siteName: "BitGraph",
  },
};

function Code({ children }: { children: string }) {
  return (
    <div className="code-block mk-code">
      <pre className="hiw-code">{children}</pre>
      <CopyCode />
    </div>
  );
}

export default function ExamPage() {
  return (
    <div className="frame home home-typing prose home-scroll jev-page">
      <div className="home-hero">
        <h1 className="sr-only">The sealed exam.</h1>
      </div>

      <section className="home-section" aria-labelledby="exam-h">
        <p className="home-kicker">Sealed exam</p>
        <h2 id="exam-h">A benchmark you can prove is&nbsp;fresh.</h2>
        <p style={{ marginTop: 24 }}>
          BitGraph A binds a request naming a public question bank. Twenty questions are derived from A&rsquo;s nonce,
          unseen until A is bound, so no training set frozen before A can contain them. The model answers, and the answer
          sheet is bound as BitGraph B, after A in the same sequence. Anyone checks the whole sitting offline, with nothing
          but Node.
        </p>
        <div style={{ marginTop: 24, display: "flex", gap: 12, flexWrap: "wrap" }}>
          <a className="bg-action-link" style={{ margin: 0 }} href={ZIP_URL}>Download the package</a>
          <a className="bg-action-link" style={{ margin: 0 }} href={REPO_URL} target="_blank" rel="noopener">Source on GitHub</a>
        </div>
      </section>

      <section className="home-section" aria-labelledby="exam-sitting">
        <p className="home-kicker">The results</p>
        <h2 id="exam-sitting">These exact questions could not have existed before BitGraph&nbsp;#{SITTING.a.n} was&nbsp;bound.</h2>
        <p style={{ marginTop: 24 }}>
          {SITTING.model} scored {SITTING.score} on 19 October 2026. BitGraph #{SITTING.a.n} was bound at {SITTING.a.at} and
          BitGraph #{SITTING.b.n} at {SITTING.b.at}, by the AWS Nitro attestation&rsquo;s signed clock; a Base transaction in
          block{" "}
          <a href={`https://basescan.org/block/${SITTING.ceiling.block}`} target="_blank" rel="noopener">{SITTING.ceiling.block.toLocaleString("en-US")}</a>{" "}
          ({SITTING.ceiling.at}) carries B, so the answers existed by then. The bank is small and easy on purpose: this is about
          freshness, not difficulty.
        </p>
        <div style={{ marginTop: 20, display: "flex", gap: 12, flexWrap: "wrap" }}>
          <a className="bg-action-link" style={{ margin: 0 }} href={`/proof/${SITTING.a.id}`}>BitGraph A #{SITTING.a.n}, the request</a>
          <a className="bg-action-link" style={{ margin: 0 }} href={`/proof/${SITTING.b.id}`}>BitGraph B #{SITTING.b.n}, the answers</a>
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
        <h2 id="exam-claim">What it proves, and what it does&nbsp;not.</h2>
        <ul className="facts" style={{ marginTop: 24 }}>
          <li><b>Proves</b><span>every question is derived from BitGraph A&rsquo;s nonce, which the enclave drew and bound in one atomic action and nobody could see before A existed, so the exact questions did not exist before A, and no training set frozen before A was bound contains them; A&rsquo;s request named the bank, so the bank was fixed before that nonce; BitGraph B bound the answer sheet, which names the paper and A, at a later count in the same epoch; both proofs carry an AWS Nitro attestation of a published BitGraph enclave image; where B&rsquo;s Base ceiling is in the folder, the answers existed by that block.</span></li>
          <li><b>Does not prove</b><span>that the template families are unfamiliar to the model; that the model worked alone, without tools, or quickly; that the answers came from the model the sheet names.</span></li>
        </ul>
      </section>

      <section className="home-section" aria-labelledby="exam-run">
        <p className="home-kicker">Check it</p>
        <h2 id="exam-run">Three commands, no network.</h2>
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
          proof re-signed with a laptop key that a signature check alone passes. The earlier sittings, six models from two
          vendors, are in <code>archive/</code> and still verify. The zip&rsquo;s SHA-256:
        </p>
        <Code>{ZIP_SHA256}</Code>
        <p style={{ marginTop: 16 }}>To run a sitting of your own, with your own API key:</p>
        <Code>{"npx @mikeargento/exam-cli run --provider anthropic --model <id> --name mine"}</Code>
      </section>
    </div>
  );
}
