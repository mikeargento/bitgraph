import type { Metadata } from "next";
import Link from "next/link";
import { CopyCode } from "@/components/copy-code";
import { Code } from "@/components/code";

export const metadata: Metadata = {
  title: "Audit a bundle",
  description:
    "Check a bundle of BitGraph proofs offline: what a bundle is, what you need, how to run the audit, how to read the report and its exit codes, and what the report cannot conclude.",
};

const GITHUB = "https://github.com/mikeargento/bitgraph";
const BUNDLE_FORMAT = `${GITHUB}/blob/main/docs/BUNDLE-FORMAT.md`;

export default function AuditPage() {
  return (
    <article className="prose">
      <h1>Audit a bundle</h1>
      <p className="lede">
        You have been handed a bundle: an archive of BitGraph proof files, and perhaps the files they commit to, Ethereum anchor witnesses and a manifest. This is the recipient&rsquo;s walkthrough. The audit runs on your machine, offline, and reports exactly what the supplied evidence supports, nothing more.
      </p>

      <h2 id="what">What a bundle is</h2>
      <p>
        A bundle is a <code>.tar.gz</code>, <code>.tar</code> or plain directory containing BitGraph proof JSON files. It may also hold the bytes each proof commits to, Ethereum anchor witness files and a <code>manifest.json</code>. Proofs are found by their schema shape, not by filename, and files are matched by their fingerprint (SHA-256 digest), so the layout inside the archive does not matter. A Frame file (<code>&lt;name&gt;.bitgraph-fuse.json</code>, the carrier of a fused file) is read as a proof file: the proof inside it is the member, and the fused copy it describes is matched by digest like any other file.
      </p>
      <p>
        A bundle can come from anyone who collected proofs: an export from the proof viewer (the original, <code>proof.json</code>, the new file under <code>new-file/</code>, and the Ethereum anchors with their witnesses), an operator who assembled a set of proofs, or a colleague who handed you an archive. How you received it does not matter; the contents carry their own evidence.
      </p>
      <p className="note">
        The producer and consumer specification, with the deterministic contents hash and its test vectors, is <a href={BUNDLE_FORMAT} target="_blank" rel="noopener noreferrer">Bundle Format</a> in the repository. It is precise enough to reimplement either role from the document alone. The Frame carrier is not yet in the document; the audit source shows how it is unwrapped.
      </p>

      <h2 id="need">What you need</h2>
      <ul className="facts">
        <li><b>Node.js</b><span>The audit is a published npm package; <code>npx</code> fetches it once. Or build it from source, below.</span></li>
        <li><b>The bundle</b><span>The archive or directory as you received it. Nothing in it is uploaded, and nothing is fetched to check it.</span></li>
        <li><b>A trust policy</b><span>Optional. A JSON file in the <code>VerificationPolicy</code> shape, passed with <code>--trust-policy</code> and applied at both verification tiers. Use it to pin the enclave measurements you accept; the <Link href="/docs/verification#policy">verification page</Link> lists the fields.</span></li>
      </ul>

      <h3>Two hashes, two meanings</h3>
      <p>Before running anything, you can check the archive you received. Two different hashes exist, and they pin different things.</p>
      <ul>
        <li>
          <strong>The archive file&rsquo;s SHA-256</strong> (<code>shasum -a 256 bundle.tar.gz</code>) identifies the exact archive you received. If the producer made a BitGraph of the archive itself, compare your computed hash against the digest that proof names. This step is optional and only meaningful when such a proof exists.
        </li>
        <li>
          <strong>The manifest&rsquo;s <code>contentsHashB64</code></strong> is a deterministic hash over the bundle&rsquo;s entries, defined in the Bundle Format specification. You do not check it by hand: the audit tool recomputes it and reports <code>manifest-contents-hash-mismatch</code> if the declared value does not match.
        </li>
      </ul>

      <h2 id="run">Run it</h2>
      <p>With Node.js installed, run the published CLI against your bundle:</p>
      <div className="code-block">
        <div className="code-block-header"><span>Shell</span><CopyCode /></div>
        <Code lang="bash">{`npx @mikeargento/bitgraph-audit ./bundle.tar.gz --out ./audit`}</Code>
      </div>
      <p>Or build from source if you prefer:</p>
      <div className="code-block">
        <div className="code-block-header"><span>Shell</span><CopyCode /></div>
        <Code lang="bash">{`git clone https://github.com/mikeargento/bitgraph
cd bitgraph
npm install
npm run build
node packages/audit/dist/cli.js /path/to/bundle.tar.gz --out ./audit`}</Code>
      </div>
      <p>
        Both write <code>audit-report.json</code> (machine-readable, complete) and <code>audit-report.md</code> (human-readable) into the output directory. No network access occurs in either mode: no RPC, no HTTP, no DNS.
      </p>

      <h2 id="report">Read the report</h2>
      <p>
        Open <code>audit-report.md</code>. The executive summary at the top is written for a reader with no cryptography background: how many proofs were observed, how many fully verified, how many lacked their file bytes (their binding to a specific file was not independently checked), whether the observed chain is intact, what anomalies and divergences exist, and what externally verifiable time evidence the bundle carries. Every anomaly is explained by consequence, and absence of evidence is stated as exactly that: a counter position missing from the bundle means the supplied evidence cannot reconstruct it, not that the authority failed to create it. The engineer-level sections and the JSON report carry the full records.
      </p>
      <h3>The status of each proof</h3>
      <ul className="facts">
        <li><b>verified</b><span>The full check passed with the file&rsquo;s bytes present in the bundle.</span></li>
        <li><b>failed</b><span>A check failed, at either tier. The verifier&rsquo;s exact reason is recorded.</span></li>
        <li><b className="break">artifact-unavailable</b><span>The bytes-free checks passed, but no bytes for this proof were in the bundle, so the digest match was not independently checked. Never reported as verified.</span></li>
      </ul>

      <h2 id="exit">Exit codes</h2>
      <p>The CLI exit code is a bit-flag summary of the report:</p>
      <div className="table-scroll">
        <table className="table-k">
          <thead><tr><th>Code</th><th>Meaning</th></tr></thead>
          <tbody>
            <tr><td>0</td><td>Clean: no verification failures, no chain anomalies, no divergences</td></tr>
            <tr><td>1</td><td>Verification failures (including proof-shaped files rejected as unsupported versions; only <code>bitgraph/1</code> is supported)</td></tr>
            <tr><td>2</td><td>Chain anomalies or divergences between valid proofs, or an anchor witness that fails its offline verification</td></tr>
            <tr><td>3</td><td>Both 1 and 2</td></tr>
            <tr><td>64</td><td>Usage or input error; no report produced</td></tr>
          </tbody>
        </table>
      </div>
      <p>
        A proof whose bytes are absent from the bundle is not a failure by itself; it is reported as <code>artifact-unavailable</code> and its bytes-free checks decide, unless a supplied trust policy makes them fail (for example <code>requireSlot</code>). Attestation results are reported in full but never change the exit code on their own; an invalid attestation document on an otherwise verified proof counts under exit code 1 only when a supplied trust policy made verification itself fail.
      </p>

      <h2 id="limits">What the report cannot conclude</h2>
      <p>A bundle is evidence, not a verdict. The report is careful about the following, and so should you be when you pass it on.</p>
      <ul className="facts">
        <li><b>Absence</b><span>An incomplete bundle yields an incomplete reconstruction. Missing proofs show up as unexplained counter positions and broken predecessor links. That means the supplied evidence cannot reconstruct those positions. It does not show that the authority never made them, nor that anyone withheld them.</span></li>
        <li><b>Missing bytes</b><span><code>artifact-unavailable</code> is not a failure. It says the digest match was not checked, not that it would have failed.</span></li>
        <li><b>The manifest</b><span>It is unsigned. Every field in it, including <code>generatedAt</code>, is advisory. The contents hash detects transport corruption; it authenticates nothing unless the hash value itself reached you through a channel you trust.</span></li>
        <li><b>Time</b><span>Unsigned <code>metadata</code> times inside proofs, manifest times, file modification times and archive entry times carry no weight. Wall-clock bounds come only from verified anchor witnesses, and they bound segments of the chain; no individual proof&rsquo;s exact time is ever established.</span></li>
        <li><b className="break">Completeness</b><span>The bundle proves what it contains, not what the operator holds. A clean audit shows the supplied proofs are consistent and valid. It does not show that these are all the proofs that exist, or that no conflicting proof exists outside the bundle.</span></li>
        <li><b>Failures</b><span>A failure belongs to an object, not to the bundle. A bundle containing an invalid proof is not an invalid bundle; the report names the object&rsquo;s failure and moves on.</span></li>
      </ul>

      <h2 id="trust">If you do not trust this tool</h2>
      <p>
        You do not have to. The audit package and the verifier it delegates to (<code>@mikeargento/bitgraph-verify</code>) are MIT-licensed source you can read: <code>packages/audit/</code> and <code>packages/verify/</code> in the <a href={GITHUB} target="_blank" rel="noopener noreferrer">repository</a>. The <a href={BUNDLE_FORMAT} target="_blank" rel="noopener noreferrer">bundle format</a> is specified precisely so a stranger can reimplement both the producer and the consumer from the document and check the same evidence independently.
      </p>

      <h2 id="next">Where next</h2>
      <ul className="doors">
        <li><Link href="/docs/verification">Verification</Link><span>What one proof&rsquo;s checks are, in order, and what each result means.</span></li>
        <li><Link href="/docs/player">Player</Link><span>Evaluate ordering rules over the proofs in a bundle and get a reproducible verdict.</span></li>
        <li><a href={BUNDLE_FORMAT} target="_blank" rel="noopener noreferrer">Bundle Format</a><span>The wire format, the contents hash and the witness procedure, in the repository.</span></li>
      </ul>
    </article>
  );
}
