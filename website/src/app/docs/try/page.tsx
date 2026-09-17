import type { Metadata } from "next";
import Link from "next/link";
import { TryZone } from "./try-zone";
import { CopyCode } from "@/components/copy-code";
import { Code } from "@/components/code";

export const metadata: Metadata = {
  title: "Make a BitGraph",
  description:
    "Make a real BitGraph proof of a file in your browser. The file is hashed on your machine and never uploaded; the proof comes back to you and is yours to keep.",
};

/**
 * The real tool on one page. The box comes first and the words follow it
 * (Mike, 2026-09-17: "move box to the top, remove 'try it' and drop this text
 * below. i feel like this would be a better UI"): whoever arrives from the
 * green button came to drop files, and the results of a drop appear in the
 * box's place, at the top, where the eye already is. Under it, the facts worth
 * knowing before or after: what stays local, what is sent, what comes back,
 * what to save, and what each waiting or failure state means. The headline,
 * "Make or check a BitGraph", heads those words rather than sitting in the box
 * (Mike, same day); the box holds the mark and one sentence.
 */
export default function TryPage() {
  return (
    <article className="prose">
      <TryZone />

      <h1>Make or check a BitGraph</h1>
      <p className="lede">
        Drop files in the box and this page makes a real BitGraph of them: a position on the public sequence, floored by an Ethereum block, with the proof returned to you. Nothing here is a simulation. The position is permanent, so choose files you are happy to have fingerprints of on a public ledger.
      </p>

      <dl className="terms">
        <dt>Stays on your machine</dt>
        <dd>Your files. Each one is read and hashed in your browser and never uploaded. The new fused files are built in memory here too.</dd>
        <dt>Is sent</dt>
        <dd>A request for a position (nothing about your files), then the SHA-256 digest of each new fused file together with the slot record. The service also sees your network address.</dd>
        <dt>Comes back</dt>
        <dd>A <code>bitgraph/1</code> proof: the slot record, both counters, the enclave&rsquo;s signature and attestation, the floor block, and the marker naming the placement and the original&rsquo;s digest.</dd>
        <dt>Save</dt>
        <dd>The proof, beside the originals. The page that opens after a drop has an export that packages the proof, the files and the bracketing anchors as a zip. The service keeps a copy of the proof too, but the copy you hold is the record.</dd>
      </dl>

      <h2 id="states">What you will see</h2>
      <ul className="facts">
        <li><b>Reading</b><span>The file is being hashed in your browser. Large files take a few seconds; nothing has been sent yet.</span></li>
        <li><b>BitGraphing</b><span>A position has been allocated and the digest is being committed under it. This is the only step that talks to the service.</span></li>
        <li><b>Restarting</b><span>Around 23:59 UTC the enclave restarts for its daily key renewal and holds commits for about a minute. Your file is hashed and waiting; recording resumes on its own.</span></li>
        <li><b>Done</b><span>A single file opens its proof page. Several files become one set at one position and are listed with a row each; open any row for its proof.</span></li>
        <li><b>Not made</b><span>If the service cannot be reached or refuses (for example, no anchor has landed yet in a fresh epoch), the page says so and nothing was recorded. Try again in a minute. A file over 256 MB is recorded by its digest rather than fused in the browser.</span></li>
      </ul>

      <h2 id="check">Check a proof you were given</h2>
      <p>
        Drop a <code>proof.json</code> into the same box, with the original file if you have it, and the checks run in your browser: the signature, the slot binding, the attestation, and whether the file matches. A check you would stake something on should run outside this website, because a page served by the party being checked is trusted exactly as far as that party is. Use the command-line audit tool on the export:
      </p>
      <div className="code-block">
        <div className="code-block-header"><span>Shell</span><CopyCode /></div>
        <Code lang="bash">{`npx @mikeargento/bitgraph-audit ./BitGraph-export/ --out ./audit`}</Code>
      </div>
      <p className="note">
        What the checks establish, and what they cannot: <Link href="/docs/verification">verification</Link>. To record from your own systems instead: the <Link href="/docs/integration">integration guide</Link>, or connect an agent over <Link href="/docs/mcp">MCP</Link>.
      </p>
    </article>
  );
}
