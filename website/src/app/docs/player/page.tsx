import type { Metadata } from "next";
import Link from "next/link";
import { CopyCode } from "@/components/copy-code";
import { Code } from "@/components/code";

export const metadata: Metadata = {
  title: "Player",
  description:
    "Evaluate an ordering rule over a set of BitGraph proofs and get a verdict anyone can reproduce from the bundle alone: offline, deterministic, three-valued.",
};

const GITHUB = "https://github.com/mikeargento/bitgraph";
const NPM = "https://www.npmjs.com/package/@mikeargento/bitgraph-player";

/* The PO example is the SPEC's worked example and the README's, byte-for-byte
   in structure: if it drifts from what the published package accepts, the page
   is teaching a rule that does not parse. Edit it only against parseRule. */
const RULE_EXAMPLE = `{
  "rule": "bitgraph-player/1",
  "id": "po-release-payment",
  "cast": {
    "purchase_order": { "digest": "sha256:…", "means": "PO-4471" },
    "delivery":       { "digest": "sha256:…" },
    "approval":       { "digest": "sha256:…" },
    "cancellation":   { "digest": "sha256:…", "optional": true }
  },
  "world": "closed",
  "requires": { "ordering": "assumption-dependent" },
  "claim": { "all": [
    { "exists": "purchase_order" },
    { "after":  ["delivery", "purchase_order"] },
    { "after":  ["approval", "delivery"] },
    { "not": { "before": ["cancellation", "approval"] } }
  ]},
  "then": { "label": "release_payment" }
}`;

export default function PlayerPage() {
  return (
    <article className="prose">
      <p className="kicker">A programmable layer for BitGraph</p>
      <h1>Player</h1>
      <p className="lede">
        Player evaluates a rule over a set of BitGraph proofs and returns TRUE, FALSE or UNDETERMINED, offline, with the same verdict on any machine. For anyone who needs a decision about the order of recorded files that a stranger can replay.
      </p>

      <h2 id="need">What you need</h2>
      <ul className="facts">
        <li><b>Runtime</b><span>Node.js. The package runs with <code>npx</code>; nothing else is installed.</span></li>
        <li><b>Package</b><span><code>@mikeargento/bitgraph-player</code> 0.14.0, MIT-licensed.</span></li>
        <li><b>A bundle</b><span>A directory, <code>.tar</code> or <code>.tar.gz</code> of BitGraph exports: <code>proof.json</code> files, or Frame files (<code>&lt;name&gt;.bitgraph-fuse.json</code>), with the files they are about and the anchors that floor them.</span></li>
        <li><b>A rule</b><span>A JSON file naming each file by its fingerprint (SHA-256 digest) and stating a claim about their order. <code>init</code> writes the skeleton for you.</span></li>
      </ul>
      <p>
        <strong>You are done when</strong> <code>npx @mikeargento/bitgraph-player rule.json bundle/</code> writes a verdict, exits 0, 1 or 2, and the verdict names the evidence each answer rests on; and when running it again over the same rule bytes and the same bundle produces a byte-identical verdict.
      </p>

      <h2 id="what">What it is</h2>
      <p><strong>BitGraph records. Player evaluates.</strong></p>
      <p>
        A BitGraph recording establishes that particular bytes occupied a particular causal position. Player takes a set of those recordings, applies a rule to them, and produces a verdict: <strong className="nowrap">TRUE, FALSE, or UNDETERMINED</strong>.
      </p>
      <p>
        Anyone with the same rule and the same evidence can reproduce that verdict themselves, on their own machine, offline. No network, no clock, no account, and no trust in whoever ran Player first.
      </p>
      <p>
        A purchase order was recorded. Later, a delivery was recorded. Later still, an approval was recorded. No declared cancellation was recorded before the approval. A Player rule can express exactly that claim and determine whether the BitGraph evidence supports it.
      </p>
      <p>A rule names the artifacts it cares about and states a claim about their causal order:</p>
      <ul>
        <li>the delivery was recorded after the purchase order</li>
        <li>the approval was recorded after the delivery</li>
        <li>no declared cancellation occurred before the approval</li>
      </ul>
      <p>
        Player evaluates that claim against the recordings in a proof bundle and writes a verdict that shows its work, step by step, including the evidence each answer rests on.
      </p>
      <p>
        Player evaluates; it does not enforce. No field in a rule can cause an external action. If a system pays an invoice after a TRUE verdict, that system sits above Player. Player only determines what follows from the rule and the evidence it was given.
      </p>

      <h2 id="rule">A rule</h2>
      <div className="code-block">
        <div className="code-block-header"><span>rule.json</span><CopyCode /></div>
        <Code lang="json">{RULE_EXAMPLE}</Code>
      </div>

      <h2 id="cast-claim">Cast and claim</h2>
      <p>Every rule separates two kinds of facts.</p>
      <p>
        <code>cast</code> contains facts supplied by the rule author: which digest represents the purchase order, which digest represents the delivery, which occurrence is intended, or who a signer is said to represent.
      </p>
      <p>
        <code>claim</code> contains only what Player is allowed to derive from BitGraph evidence: whether a recording exists, whether one recording came before or after another, or whether the available evidence fails to establish an answer.
      </p>
      <p>
        <strong>The verdict never mixes the two.</strong> A reader can always see which facts came from BitGraph and which were asserted by the person who wrote the rule. That separation is the trust boundary.
      </p>

      <h2 id="floor">The security floor</h2>
      <p>Every rule must declare the limits under which its claim is allowed to be evaluated.</p>
      <p>
        <code>world: &quot;closed&quot;</code> scopes negative claims to the artifacts declared in the rule. For example, this rule does <strong>not</strong> claim that no cancellation exists anywhere. It claims only that no cancellation represented by the declared <code>cancellation</code> role was established before the approval. Negative claims never extend beyond the evidence the rule declares.
      </p>
      <p>
        <code>requires.ordering</code> is the rule&rsquo;s security floor. It specifies what kind of ordering evidence the author is willing to accept. <code>hash-linked</code> accepts conclusions supported by hash-linked ordering evidence alone. <code>assumption-dependent</code> also permits ordering conclusions that rely on accepted BitGraph assumptions, including counter order and Ethereum anchor floors.
      </p>
      <p>
        There is no default. A rule that does not declare its ordering floor does not parse, because that floor is part of the rule&rsquo;s own security policy. The tool must not choose it for the author.
      </p>

      <h2 id="answers">Three answers, not two</h2>
      <p>Every claim evaluates to one of three answers.</p>
      <ul className="facts">
        <li><b>TRUE</b><span>The evidence supports the claim at or above the rule&rsquo;s declared security floor.</span></li>
        <li><b>FALSE</b><span>The evidence refutes the claim.</span></li>
        <li><b>UNDETERMINED</b><span>The available evidence does not decide.</span></li>
      </ul>
      <p>UNDETERMINED is the correct answer when, for example:</p>
      <ul>
        <li>the evidence does not establish the order of two recordings</li>
        <li>the same digest was recorded more than once and nothing selects the intended occurrence</li>
        <li>the available ordering evidence falls below the rule&rsquo;s declared security floor</li>
      </ul>
      <p>
        A two-valued evaluator would have to launder those cases into TRUE or FALSE and would therefore be wrong on some inputs. Player refuses to invent certainty. When the evidence cannot decide the claim, the verdict is UNDETERMINED and states why.
      </p>

      <h2 id="run">Run it</h2>
      <p>
        With Node.js installed, evaluate a rule against a BitGraph proof bundle. A bundle may be a directory, <code>.tar</code>, or <code>.tar.gz</code> containing BitGraph exports. Discovery is by schema shape, not by filename, so any layout holding <code>proof.json</code> files works. A Frame file (<code>&lt;name&gt;.bitgraph-fuse.json</code>, the carrier of a fused recording) is read as a proof carrier.
      </p>
      <div className="code-block">
        <div className="code-block-header"><span>Shell</span><CopyCode /></div>
        <Code lang="bash">{`npx @mikeargento/bitgraph-player rule.json bundle/ > verdict.json`}</Code>
      </div>
      <p>
        To begin a rule from the files themselves, <code>init</code> hashes the files and writes a skeleton with the <code>cast</code> filled in:
      </p>
      <div className="code-block">
        <div className="code-block-header"><span>Shell</span><CopyCode /></div>
        <Code lang="bash">{`npx @mikeargento/bitgraph-player init po.pdf delivery.jpg approval.pdf --out rule.json`}</Code>
      </div>
      <p>
        It deliberately leaves <code>requires.ordering</code> unset. The security floor belongs to the rule author. Player will not choose it.
      </p>
      <p>
        To read an export without a rule, <code>check</code> prints a <code>bitgraph-check/1</code> report: a three-valued line per check for each recording, with its anchor floor. A recording marked fused adds a <code>fused</code> line (the commitment check, over the fused bytes or the original), a fused floor (the last anchored block before its slot) and a fused span (slot position to commit position).
      </p>
      <div className="code-block">
        <div className="code-block-header"><span>Shell</span><CopyCode /></div>
        <Code lang="bash">{`npx @mikeargento/bitgraph-player check export/`}</Code>
      </div>
      <p>The process exit code is the verdict summary, so another program can gate on it directly:</p>
      <div className="table-scroll">
        <table className="table-k">
          <thead><tr><th>Code</th><th>Meaning</th></tr></thead>
          <tbody>
            <tr><td>0</td><td><code>TRUE</code>: the evidence supports the claim at or above the declared floor</td></tr>
            <tr><td>1</td><td><code>FALSE</code>: the evidence refutes the claim</td></tr>
            <tr><td>2</td><td><code>UNDETERMINED</code>: the evidence does not decide</td></tr>
            <tr><td>3</td><td>Error: bad rule file, unreadable bundle, or invalid usage</td></tr>
          </tbody>
        </table>
      </div>

      {/* The check does not live on this site, and a link to a hosted
          verify.html was removed on 2026-09-08 (Mike: "no verifying or making
          will happen in browser anymore"). The argument that section made was
          right, and it survives below: a recording must stay checkable years
          from now by someone who does not have Node, and the answer to that is
          a file you already hold, not a page we hand you on the day you ask.
          The player still builds the page (dist-web/verify.html); we simply do
          not host it. Do not restore the link. */}
      <h2 id="determinism">Same evidence, same verdict</h2>
      <p>
        Two runs of the same rule bytes over the same bundle contents produce byte-identical verdicts, on any machine, at any later time. The verdict carries no clock reading, filesystem path, or machine-local state. Every ordering conclusion identifies the evidence it rests on and whether that conclusion depends on an assumption.
      </p>
      <p>
        Nothing in a check reaches the network. The bundle carries the proof, the file and the Ethereum anchor that gives its position a floor; the verifier carries its own copy of the code and the enclave measurement it will accept. Pull the cable and the verdict is the same, which is the whole design: a recording has to stay checkable years from now, by someone who should not have to trust a server to tell them what their own bytes say.
      </p>
      <p>
        That is also why the check does not live on this site. A page loaded from <code>bitgraph.ing</code> is trusted exactly as far as <code>bitgraph.ing</code> is, and we are the party being checked. A signed package you install once, pinned to a version, is a smaller thing to trust. The PCR0 it enforces is reproducible from published inputs, so you can confirm it names the enclave we say it does.
      </p>
      <p>
        Auditing a decision stops being a matter of reading a report someone wrote and becomes replaying the decision yourself.
      </p>
      <p>
        There is a loose architectural analogy to Ethereum: BitGraph provides the recorded substrate, while Player provides deterministic evaluation over it. The difference is deliberate. The EVM&rsquo;s value is that participants agree on execution. Player&rsquo;s value is that anyone can independently reproduce the evaluation. Player does not make BitGraph an authority. It makes claims over BitGraph evidence reproducible.
      </p>

      <h2 id="spec">Specification</h2>
      <p>
        The semantics are specified precisely enough to reimplement. <a href={`${GITHUB}/blob/main/packages/player/SPEC.md`} target="_blank" rel="noopener noreferrer">SPEC.md</a> is normative. The <a href={NPM} target="_blank" rel="noopener noreferrer">published package</a> is the MIT-licensed reference implementation, built on the same <Link href="/docs/audit">audit pipeline</Link> used to inspect a BitGraph bundle by hand. A conforming Player in any language must reach the same verdict from the same rule and the same evidence.
      </p>

      <h2 id="next">Where next</h2>
      <ul className="doors">
        <li><Link href="/docs/audit">Audit a bundle</Link><span>Check many proofs, their order and their anchors, offline.</span></li>
        <li><Link href="/docs/verification">Verification</Link><span>What a verifier checks on one proof, and what each result means.</span></li>
        <li><Link href="/docs/proof-format">Proof format</Link><span>The fields a rule&rsquo;s evidence is read from.</span></li>
        <li><Link href="/docs/integration">Integration guide</Link><span>Make the proofs a bundle is built from.</span></li>
      </ul>
    </article>
  );
}
