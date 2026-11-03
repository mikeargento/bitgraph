import type { Metadata } from "next";
import { CopyCode } from "@/components/copy-code";
import { InquiryForm } from "@/components/inquiry-form";
import { PUBLISHED_PCR0 } from "@/lib/enclave-measurements";

/**
 * Evaluate (2026-10-27): a technical buyer reproduces the guarantees without a call. The sample in /evaluate is a real
 * v13 production proof: the home page's ChatGPT picture, BitGraph #304 (2026-11-02, with its Base floor at #302). Every
 * command and every failure line below was run against it with @mikeargento/bitgraph-sdk 0.8.0 on 2026-11-02.
 */
export const metadata: Metadata = {
  title: "Evaluate",
  description: "Check the BitGraph mechanism yourself: verify a real proof offline, watch each kind of tampering fail, make your own BitGraph, rebuild the enclave measurement, and run the test suites.",
};

function Code({ children }: { children: string }) {
  return (
    <div className="code-block mk-code">
      <pre className="hiw-code">{children}</pre>
      <CopyCode />
    </div>
  );
}

const V = "npx @mikeargento/bitgraph-sdk verify";

const CASES: Array<{ what: string; how: string; result: string }> = [
  { what: "Different bytes", how: "Change one byte of chatgpt.png", result: "FALSE: the provided bytes do not match the committed digest" },
  { what: "Moved position", how: "Edit commit.counter", result: "FALSE: user_data is not this proof's signed-body hash" },
  { what: "Rewritten history", how: "Edit commit.prevB64", result: "FALSE: user_data is not this proof's signed-body hash" },
  { what: "Different image claimed", how: "Edit environment.measurement", result: "FALSE: PCR0 … is not the proof's measurement" },
  { what: "Signature tampered", how: "Change one character of signer.signatureB64", result: "FALSE: signature does not match" },
  { what: "Unaccepted image", how: "Pin a different --pcr0", result: "FALSE: PCR0 … is not an image this verifier accepts" },
  { what: "Forged with a new key", how: "Re-sign a body with a key you generate (the verifier's test)", result: "Passes a signature-only check; FALSE with attestation" },
];

/** Questions any proof system should answer, and BitGraph's answers; each answer restates a claim from Technology. */
const QUESTIONS: Array<{ q: string; a: string }> = [
  { q: "Can anything other than the bind produce a proof that passes?", a: "No. A proof passes only with an AWS attestation over its exact signed body from a published image. The key never leaves the enclave." },
  { q: "Can the host have the key sign any statement it chooses?", a: "No. Anyone can submit a digest, but the enclave signs only the whole step: a fresh nonce at count N, the digest at N+1, chained to the previous proof. Nobody outside picks the count, the nonce or the body." },
  { q: "Can an existing file be given an earlier place?", a: "No. A file can be bound now, at the next count, after a fresh nonce. The proof says when it was bound, not how old the file is." },
  { q: "Can one step be completed, observed or replayed apart from the rest?", a: "No. Every step that can fail comes before the counter moves, and a failure releases nothing. Tested with injected faults." },
  { q: "Can the counter be rolled back to reuse a count?", a: "No. The key and counter live only in enclave memory. A restart is a new epoch, with a new key and a counter from zero." },
  { q: "Does the verifier take the proof\u2019s word about its hardware?", a: "No. It checks the AWS certificate chain and the measurement against the published images. A signature-only check is weaker, and the verifier says so." },
  { q: "Does it claim more than the hardware enforces?", a: "No. A BitGraph says where in line and when bytes were bound. Not who made them, when they were made, or that they are true." },
];

export default function EvaluatePage() {
  return (
    <div className="frame home home-typing prose home-scroll docs-page tools-page sx-page">
      <div className="home-hero"><h1 className="sr-only">Evaluate.</h1></div>

      <section className="home-section" aria-labelledby="e-intro">
        <p className="home-kicker">Evaluate</p>
        <h2 id="e-intro">Check it yourself.</h2>
        <p>
          A few commands against a sample proof, with Node 20 or later. The output shown is what they print.
        </p>
      </section>

      <section className="home-section" aria-labelledby="e-1">
        <p className="home-kicker">Step 1</p>
        <h2 id="e-1">Verify a real proof, offline.</h2>
        <p>
          Download a production proof and the file it covers: <a href="/evaluate/chatgpt.png" download>chatgpt.png</a> and{" "}
          <a href="/evaluate/chatgpt.png.bitgraph.json" download>chatgpt.png.bitgraph.json</a>. It is BitGraph #304, the ChatGPT
          picture on the home page.
        </p>
        <Code>{`${V} chatgpt.png --proof chatgpt.png.bitgraph.json --pcr0 ${PUBLISHED_PCR0}`}</Code>
        <Code>{`TRUE

  These exact bytes were bound by BitGraph's published enclave image v13, as the AWS Nitro hardware
  attests, at 2026-11-02T06:24:05.154Z. This says where and when the bytes were bound, not when or how
  they were made.`}</Code>
        <p className="sx-fine">Disconnect from the network after the first run, which installs the verifier; it still checks.</p>
      </section>

      <section className="home-section" aria-labelledby="e-2">
        <p className="home-kicker">Step 2</p>
        <h2 id="e-2">Try to break it.</h2>
        <p>Edit the proof or the file and verify again. Each change fails, for its own reason, with exit code 2.</p>
        <div className="sx-table-wrap">
          <table className="sx-table">
            <thead><tr><th>Attack</th><th>How</th><th>Result</th></tr></thead>
            <tbody>{CASES.map((c) => <tr key={c.what}><td>{c.what}</td><td>{c.how}</td><td>{c.result}</td></tr>)}</tbody>
          </table>
        </div>
        <p>For example, moving the proof to another position:</p>
        <Code>{`node -e 'const f="chatgpt.png.bitgraph.json",p=JSON.parse(require("fs").readFileSync(f));p.commit.counter="306";require("fs").writeFileSync("moved.json",JSON.stringify(p))'
${V} chatgpt.png --proof moved.json`}</Code>
      </section>

      <section className="home-section" aria-labelledby="e-3">
        <p className="home-kicker">Step 3</p>
        <h2 id="e-3">Make your own BitGraph.</h2>
        <p>Bind any file on the live service. It is hashed on your machine and only the digest is sent; the proof is saved beside it.</p>
        <Code>{`npx -p @mikeargento/bitgraph-sdk bitgraph make yourfile
${V} yourfile --proof yourfile.bitgraph.json`}</Code>
        <p className="sx-fine">
          BitGraphs are permanent, and the digest appears in the public <a href="/ledger">ledger</a>. Bind a file you are content to
          have on record, or a fresh random one. Or drop files on <a href="/make">Make</a> in a browser.
        </p>
      </section>

      <section className="home-section" aria-labelledby="e-4">
        <p className="home-kicker">Step 4</p>
        <h2 id="e-4">Rebuild the enclave&rsquo;s measurement.</h2>
        <p>
          The PCR0 every proof is checked against comes from public source. Build it twice from a clean state and compare; Nitro hardware
          is not needed to build (Docker on linux/amd64 is).
        </p>
        <Code>{`git clone https://github.com/mikeargento/bitgraph && cd bitgraph
./server/commit-service/reproducible-build/verify-pcr0.sh enclave-v13 ${PUBLISHED_PCR0}`}</Code>
        <p className="sx-fine">
          The measurement reproduces; the image file does not byte-for-byte, because its header embeds a build time. Pins and notes:{" "}
          <span className="nb"><code>server/commit-service/reproducible-build/PINS.md</code>.</span>
        </p>
      </section>

      <section className="home-section" aria-labelledby="e-5">
        <p className="home-kicker">Step 5</p>
        <h2 id="e-5">Run the tests.</h2>
        <Code>{`npm install
npm test --workspace=packages/verify`}</Code>
        <ul className="docs-list sx-tests">
          <li><strong>Attestation.</strong> A real production proof; wrong bytes; a forgery with an attacker&rsquo;s key that passes the signature check and fails the attested one; no attestation; an unaccepted image; a changed counter.<span className="sx-path">packages/verify/src/__tests__/attested.test.ts</span></li>
          <li><strong>Sequence.</strong> A missing proof shows as a gap; broken links, wrong counts, another epoch or key.<span className="sx-path">packages/verify/src/__tests__/stretch.test.ts</span></li>
          <li><strong>Collections.</strong> Other files, outside bytes, an edited inclusion block.<span className="sx-path">packages/verify/src/__tests__/tree-member.test.ts</span></li>
          <li><strong>Atomicity.</strong> Faults injected into the RNG, signer and attestation of the unmodified enclave code release nothing and move nothing.<span className="sx-path">server/commit-service/src/enclave/__tests__/bind-failure.test.ts</span></li>
        </ul>
      </section>

      <section className="home-section" aria-labelledby="e-q">
        <p className="home-kicker">Step 6</p>
        <h2 id="e-q">Seven questions for any proof system.</h2>
        <p>Ask them of BitGraph, and of anyone else selling proof.</p>
        <div className="sx-table-wrap">
          <table className="sx-table">
            <thead><tr><th>Question</th><th>BitGraph</th></tr></thead>
            <tbody>{QUESTIONS.map((x) => <tr key={x.q}><td>{x.q}</td><td>{x.a}</td></tr>)}</tbody>
          </table>
        </div>
      </section>

      <section className="home-section" aria-labelledby="e-6">
        <div className="sx-split">
          <div>
            <p className="home-kicker">Step 7</p>
            <h2 id="e-6">Go further with us.</h2>
            <p>
              For a deeper evaluation: a proof-of-concept on your own data, keyed access above the public limits, the threat model in
              detail, and technical diligence materials under NDA.
            </p>
            <p>Read first: <a href="/technology">the mechanism and threat model</a>, and <a href="/integrate">the integration interface</a>.</p>
          </div>
          <div>
            <p className="home-kicker">Request</p>
            <h2>Request a technical evaluation.</h2>
            <InquiryForm topic="Evaluation" />
          </div>
        </div>
      </section>
    </div>
  );
}
