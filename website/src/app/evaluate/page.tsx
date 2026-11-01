import type { Metadata } from "next";
import { CopyCode } from "@/components/copy-code";
import { InquiryForm } from "@/components/inquiry-form";
import { PUBLISHED_PCR0 } from "@/lib/enclave-measurements";

/**
 * Evaluate (2026-10-27): a technical buyer reproduces the guarantees without a call. The sample in /evaluate is a real
 * v13 production proof (the verifier's carrier5 fixture: file 2 of a tree of 2, counter 16). Every command and every
 * failure line below was run against it with @mikeargento/bitgraph-sdk 0.7.4 on 2026-10-27.
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
  { what: "Different bytes", how: "Change one character of sample.txt", result: "FALSE: the file is not in the tree this proof binds" },
  { what: "Moved position", how: "Edit commit.counter", result: "FALSE: user_data is not this proof's signed-body hash" },
  { what: "Rewritten history", how: "Edit commit.prevB64", result: "FALSE: user_data is not this proof's signed-body hash" },
  { what: "Different image claimed", how: "Edit environment.measurement", result: "FALSE: PCR0 … is not the proof's measurement" },
  { what: "Signature tampered", how: "Change one character of signer.signatureB64", result: "FALSE: signature does not match" },
  { what: "Unaccepted image", how: "Pin a different --pcr0", result: "FALSE: PCR0 … is not an image this verifier accepts" },
  { what: "Forged with a new key", how: "Re-sign a body with a key you generate (the verifier's test)", result: "Passes a signature-only check; FALSE with attestation" },
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
          Download a production proof and the file it covers: <a href="/evaluate/sample.txt" download>sample.txt</a> and{" "}
          <a href="/evaluate/sample.txt.bitgraph.json" download>sample.txt.bitgraph.json</a>. It is BitGraph count 16 of a v13 epoch,
          the second file of a two-file collection.
        </p>
        <Code>{`${V} sample.txt --proof sample.txt.bitgraph.json --pcr0 ${PUBLISHED_PCR0}`}</Code>
        <Code>{`TRUE

  These exact bytes are file 2 of a tree of 2, whose root was bound by BitGraph's published enclave
  image v13, as the AWS Nitro hardware attests, at 2026-10-21T01:37:40.960Z.`}</Code>
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
        <Code>{`node -e 'const f="sample.txt.bitgraph.json",p=JSON.parse(require("fs").readFileSync(f));p.commit.counter="18";require("fs").writeFileSync("moved.json",JSON.stringify(p))'
${V} sample.txt --proof moved.json`}</Code>
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

      <section className="home-section" aria-labelledby="e-6">
        <div className="sx-split">
          <div>
            <p className="home-kicker">Step 6</p>
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
