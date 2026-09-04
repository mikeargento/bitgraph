import type { Metadata } from "next";
import { CopyCode } from "@/components/copy-code";

export const metadata: Metadata = {
  title: "Audit a Bundle",
  description: "Audit a BitGraph Audit Bundle offline: verify every proof, reconstruct the chain, and read a plain-language report, all on your own machine with no network access.",
};

const GITHUB = "https://github.com/mikeargento/bitgraph";

export default function AuditPage() {
  return (
    <div className="prose-doc">
      <h1 className="mb-6">Audit a Bundle</h1>
      <p style={{ color: "#4b5563", marginBottom: 32 }}>
        You have been handed an Audit Bundle: an archive of BitGraph proof files, and optionally the artifact bytes, Ethereum anchor witnesses, and a manifest. This is the recipient&apos;s walkthrough. The audit runs entirely on your machine, fully offline, and reports exactly what the supplied evidence supports, nothing more.
      </p>

      <h2>What a bundle is</h2>
      <p>
        A bundle is a <code>.tar.gz</code>, <code>.tar</code>, or plain directory containing BitGraph proof JSON files. It may also include the artifact bytes each proof commits to, Ethereum anchor witness files, and a <code>manifest.json</code>. Proofs are discovered by their schema shape, not by filename, and artifacts are matched by content hash, so the layout inside the archive does not matter. A Frame file (<code>&lt;name&gt;.bitgraph-fuse.json</code>, the carrier of a fused recording) is read as a proof file: the proof inside it is the member, and the fused copy it describes is matched by content hash like any other artifact. The complete producer and consumer specification, including the deterministic contents hash and its test vectors, lives in the repository:
      </p>
      <ul>
        <li>
          <a href={`${GITHUB}/blob/main/docs/BUNDLE-FORMAT.md`} target="_blank" rel="noopener noreferrer" className="text-[#0065A4] font-medium no-underline">Bundle Format specification</a>: the wire format, precise enough to reimplement either role from the document alone.
        </li>
      </ul>

      <h2>1. Get the bundle</h2>
      <p>
        A bundle can come from anyone who collected BitGraph proofs: an export from a proof page (for a fused recording: the original, <code>proof.json</code>, the Frame, the new file in a <code>fused</code> folder, and the Ethereum anchors), an operator who assembled a set of proofs, or a colleague who handed you an archive. How you received it does not matter; the contents carry their own evidence.
      </p>

      <h2>2. Optionally check the archive hash</h2>
      <p>Two different hashes exist, and they pin different things:</p>
      <ul>
        <li>
          <strong>The archive file&apos;s SHA-256</strong> (<code>shasum -a 256 bundle.tar.gz</code>) identifies the exact archive you received. If the producer notarized the archive by committing its SHA-256 through a bitgrapher as its own proof, compare your computed hash against that notarization commit. This step is optional and only meaningful when such a commit exists.
        </li>
        <li>
          <strong>The manifest&apos;s <code>contentsHashB64</code></strong> is a deterministic hash over the bundle&apos;s entries, defined in the Bundle Format specification. You do not check this by hand: the audit tool recomputes it and reports <code>manifest-contents-hash-mismatch</code> if the declared value does not match.
        </li>
      </ul>

      <h2>3. Run the audit</h2>
      <p>With Node.js installed, run the published CLI against your bundle:</p>
      <div className="code-block">
        <div className="code-block-header">Shell<CopyCode /></div>
        <pre>{`npx @mikeargento/bitgraph-audit ./bundle.tar.gz --out ./audit`}</pre>
      </div>
      <p>Or build from source if you prefer:</p>
      <div className="code-block">
        <div className="code-block-header">Shell<CopyCode /></div>
        <pre>{`git clone https://github.com/mikeargento/bitgraph
cd bitgraph
npm install
npm run build
node packages/audit/dist/cli.js /path/to/bundle.tar.gz --out ./audit`}</pre>
      </div>
      <p>
        Both write <code>audit-report.json</code> (machine-readable, complete) and <code>audit-report.md</code> (human-readable) into the output directory. No network access occurs in either mode.
      </p>

      <h2>4. Read the executive summary</h2>
      <p>
        Open <code>audit-report.md</code>. The executive summary at the top is written for a reader with no cryptography background: how many proofs were observed, how many fully verified, how many lacked their artifact bytes (their binding to a specific file was not independently checked), whether the observed chain is intact, what anomalies and divergences exist, and what externally verifiable time evidence the bundle carries. Every anomaly is explained by consequence, and absence of evidence is stated as exactly that: a counter position missing from the bundle means the supplied evidence cannot reconstruct it, not that the authority failed to create it. The engineer-level sections and the JSON report carry the full records.
      </p>

      <h2>5. Exit codes</h2>
      <p>The CLI exit code is a bit-flag summary of the report:</p>
      <table>
        <thead><tr><th>Code</th><th>Meaning</th></tr></thead>
        <tbody>
          <tr><td>0</td><td>Clean: no verification failures, no chain anomalies, no divergences</td></tr>
          <tr><td>1</td><td>Verification failures (including proof-shaped files rejected as unsupported versions; only <code>bitgraph/1</code> is supported)</td></tr>
          <tr><td>2</td><td>Chain anomalies or divergences between valid proofs</td></tr>
          <tr><td>3</td><td>Both 1 and 2</td></tr>
          <tr><td>64</td><td>Usage or input error; no report produced</td></tr>
        </tbody>
      </table>
      <p>
        A proof whose artifact bytes are absent from the bundle is not a failure by itself; it is reported as artifact-unavailable and its bytes-free checks decide.
      </p>

      <h2>6. If you do not trust this tool</h2>
      <p>
        You do not have to. The audit package and the verifier it delegates to (<code>@mikeargento/bitgraph-verify</code>) are MIT-licensed source you can read: <code>packages/audit/</code> and <code>packages/verify/</code> in the <a href={GITHUB} target="_blank" rel="noopener noreferrer" className="text-[#0065A4] font-medium no-underline">repository</a>. The <a href={`${GITHUB}/blob/main/docs/BUNDLE-FORMAT.md`} target="_blank" rel="noopener noreferrer" className="text-[#0065A4] font-medium no-underline">bundle format</a> is specified precisely so a stranger can reimplement both the producer and the consumer from the document alone and check the same evidence independently.
      </p>
    </div>
  );
}
