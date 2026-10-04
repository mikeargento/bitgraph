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
        Drop files in the box and this page makes a real BitGraph of them: a position on the public sequence, floored by an Ethereum block, with the proof returned to you. Nothing here is a simulation. The position is permanent, and BitGraph keeps a public copy of each proof that cannot be deleted for ten years, so choose files whose fingerprints you are happy to have in public.
      </p>

      <dl className="terms">
        <dt>Stays on your machine</dt>
        <dd>Your files. Each one is read and hashed in your browser and never uploaded. The committed bytes, and the tree over them, are built in memory here too.</dd>
        <dt>Is sent</dt>
        <dd>The SHA-256 digest of every file you drop, to look up which are already BitGraphed. To make a BitGraph: a request for a position (nothing about your files), then the SHA-256 of the tree&rsquo;s 84-byte root document together with the position record and the root document itself. After the proof is made, each file&rsquo;s sealed recovery entry, stored under a name derived from the file&rsquo;s hash; the hash itself is never indexed. The service also sees your network address.</dd>
        <dt>Comes back</dt>
        <dd>A <code>bitgraph/1</code> proof: the position record, both counters, the enclave&rsquo;s signature and attestation, the floor block, and the marker <code>bitgraph-fuse/2</code>, <code>tree/1</code>, naming the SHA-256 of the SPEC.md the proof was made under.</dd>
        <dt>Save</dt>
        <dd>The export, beside the originals. The page that opens after a drop has an Export that gives one zip: the <code>bitgraph-export/1</code> JSON (the proof, the tree, the floor header, and the Base ceiling and its settlement once they exist) plus SPEC.md. It holds no copies of your files and no anchor proofs. The service keeps a copy of the proof too, but the copy you hold is the record.</dd>
      </dl>

      <h2 id="states">What you will see</h2>
      <ul className="facts">
        <li><b>Reading</b><span>The file is being hashed in your browser. Large files take a few seconds; nothing has been sent yet.</span></li>
        <li><b>Checking</b><span>Each file&rsquo;s digest is being looked up, to find the ones already BitGraphed. Large folders take a while.</span></li>
        <li><b>BitGraphing</b><span>A position has been allocated and the digest is being committed under it. This and the check are the only steps that talk to the service.</span></li>
        <li><b>Restarting</b><span>Around 23:59 UTC the enclave restarts for its daily key renewal and holds commits for about a minute. Your file is hashed and waiting; recording resumes on its own.</span></li>
        <li><b>Done</b><span>A single file opens its proof page. Several files become one tree at one position, each file a leaf, and are listed with a row each; open any row for its proof. A file already BitGraphed is found through its recovery entries rather than made again, and opens the proof it already has.</span></li>
        <li><b>Not made</b><span>If the service cannot be reached or refuses (for example, no anchor has landed yet in a fresh epoch), the page says so and nothing was recorded. Try again in a minute. Files of any size are streamed; nothing is sent until every file is hashed.</span></li>
      </ul>

      <h2 id="check">Check a proof you were given</h2>
      <p>
        Drop the file and its export JSON into the same box, and the checks run in your browser: the signature, the position binding, the attestation, the tree, and whether the file is the member the export names. A file alone is looked up through its recovery entries. A check you would stake something on should run outside this website, because a page served by the party being checked is trusted exactly as far as that party is. Verify offline with the SDK, one line per claim, or run the deeper audit over the unzipped export:
      </p>
      <div className="code-block">
        <div className="code-block-header"><span>Shell</span><CopyCode /></div>
        <Code lang="bash">{`# in the unzipped export, beside the file it is about
npx @mikeargento/bitgraph-sdk verify photo.jpg photo.jpg.bitgraph.json
npx @mikeargento/bitgraph-audit . --out ./audit`}</Code>
      </div>
      <p className="note">
        What the checks establish, and what they cannot: <Link href="/docs/verification">verification</Link>. To record from your own systems instead: the <Link href="/docs/integration">integration guide</Link>, or connect an agent over <Link href="/docs/mcp">MCP</Link>.
      </p>
    </article>
  );
}
