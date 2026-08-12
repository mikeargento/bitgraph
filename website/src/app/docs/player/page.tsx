import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "BitGraph Player",
  description: "Evaluate causal rules over BitGraph recordings and get a verdict anyone can reproduce from the bundle alone: offline, deterministic, three-valued.",
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
    <div className="prose-doc">
      <h1 className="mb-2">BitGraph Player</h1>
      {/* Subtitle, Mike's line. Heading furniture, not body copy: no
          terminal period, grey, one step above body in the ladder. */}
      <p style={{ color: "#1f2937", fontSize: 18, margin: "0 0 24px" }}>
        A Programmable Layer for BitGraph
      </p>
      <p style={{ color: "#1f2937", marginBottom: 16 }}>
        <strong>BitGraph records. Player evaluates.</strong>
      </p>
      <p style={{ color: "#1f2937", marginBottom: 16 }}>
        A BitGraph recording establishes that particular bytes occupied a particular causal position. Player takes a set of those recordings, applies a rule to them, and produces a verdict: <strong>TRUE, FALSE, or UNDETERMINED</strong>.
      </p>
      <p style={{ color: "#1f2937", marginBottom: 16 }}>
        Anyone with the same rule and the same evidence can reproduce that verdict themselves, on their own machine, offline. No network, no clock, no account, and no trust in whoever ran Player first.
      </p>
      <p style={{ color: "#1f2937", marginBottom: 16 }}>
        A purchase order was recorded. Later, a delivery was recorded. Later still, an approval was recorded. No declared cancellation was recorded before the approval.
      </p>
      <p style={{ color: "#1f2937", marginBottom: 32 }}>
        A Player rule can express exactly that claim and determine whether the BitGraph evidence supports it.
      </p>

      <h2>What a Player is</h2>
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

      <h2>A rule</h2>
      <div className="code-block">
        <div className="code-block-header">rule.json</div>
        <pre>{RULE_EXAMPLE}</pre>
      </div>

      <h2>What Player can prove</h2>
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

      <h2>The rule&apos;s security floor</h2>
      <p>Every rule must declare the limits under which its claim is allowed to be evaluated.</p>
      <p>
        <code>world: &quot;closed&quot;</code> scopes negative claims to the artifacts declared in the rule. For example, this rule does <strong>not</strong> claim that no cancellation exists anywhere. It claims only that no cancellation represented by the declared <code>cancellation</code> role was established before the approval. Negative claims never extend beyond the evidence the rule declares.
      </p>
      <p>
        <code>requires.ordering</code> is the rule&apos;s security floor. It specifies what kind of ordering evidence the author is willing to accept. <code>hash-linked</code> accepts conclusions supported by hash-linked ordering evidence alone. <code>assumption-dependent</code> also permits ordering conclusions that rely on accepted BitGraph assumptions, including counter order and Ethereum anchor bounds.
      </p>
      <p>
        There is no default. A rule that does not declare its ordering floor does not parse, because that floor is part of the rule&apos;s own security policy. The tool must not choose it for the author.
      </p>

      <h2>Three answers, not two</h2>
      <p>Every claim evaluates to:</p>
      <p>
        <strong>TRUE</strong>
        <br />
        The evidence supports the claim at or above the rule&apos;s declared security floor.
      </p>
      <p>
        <strong>FALSE</strong>
        <br />
        The evidence refutes the claim.
      </p>
      <p>
        <strong>UNDETERMINED</strong>
        <br />
        The available evidence does not decide.
      </p>
      <p>UNDETERMINED is the correct answer when, for example:</p>
      <ul>
        <li>the evidence does not establish the order of two recordings</li>
        <li>the same digest was recorded more than once and nothing selects the intended occurrence</li>
        <li>the available ordering evidence falls below the rule&apos;s declared security floor</li>
      </ul>
      <p>
        A two-valued evaluator would have to launder those cases into TRUE or FALSE and would therefore be wrong on some inputs. Player refuses to invent certainty. When the evidence cannot decide the claim, the verdict is UNDETERMINED and states why.
      </p>

      <h2>Run it</h2>
      <p>
        With Node.js installed, evaluate a rule against a BitGraph proof bundle. A bundle may be a directory, <code>.tar</code>, or <code>.tar.gz</code> containing BitGraph exports, including the folders written by BitGraph Folder.
      </p>
      <div className="code-block">
        <div className="code-block-header">Shell</div>
        <pre>{`npx @mikeargento/bitgraph-player rule.json bundle/ > verdict.json`}</pre>
      </div>
      <p>
        To begin a rule from the files themselves, <code>init</code> hashes the files and writes a skeleton with the <code>cast</code> filled in:
      </p>
      <div className="code-block">
        <div className="code-block-header">Shell</div>
        <pre>{`npx @mikeargento/bitgraph-player init po.pdf delivery.jpg approval.pdf --out rule.json`}</pre>
      </div>
      <p>
        It deliberately leaves <code>requires.ordering</code> unset. The security floor belongs to the rule author. Player will not choose it.
      </p>
      <p>The process exit code is the verdict summary, so another program can gate on it directly:</p>
      <table>
        <thead><tr><th>Code</th><th>Meaning</th></tr></thead>
        <tbody>
          <tr><td>0</td><td><code>TRUE</code>: the evidence supports the claim at or above the declared floor</td></tr>
          <tr><td>1</td><td><code>FALSE</code>: the evidence refutes the claim</td></tr>
          <tr><td>2</td><td><code>UNDETERMINED</code>: the evidence does not decide</td></tr>
          <tr><td>3</td><td>Error: bad rule file, unreadable bundle, or invalid usage</td></tr>
        </tbody>
      </table>

      <h2>Same evidence. Same verdict.</h2>
      <p>
        Two runs of the same rule bytes over the same bundle contents produce byte-identical verdicts, on any machine, at any later time. The verdict carries no timestamp, filesystem path, or machine-local state. Every ordering conclusion identifies the evidence it rests on and whether that conclusion depends on an assumption.
      </p>
      <p>
        Auditing a decision stops being a matter of reading a report someone wrote and becomes replaying the decision yourself.
      </p>
      <p>
        There is a loose architectural analogy to Ethereum: BitGraph provides the recorded substrate, while Player provides deterministic evaluation over it. The difference is deliberate. The EVM&apos;s value is that participants agree on execution. Player&apos;s value is that anyone can independently reproduce the evaluation. Player does not make BitGraph an authority. It makes claims over BitGraph evidence reproducible.
      </p>

      <h2>Specification</h2>
      <p>
        The semantics are specified precisely enough to reimplement. <a href={`${GITHUB}/blob/main/packages/player/SPEC.md`} target="_blank" rel="noopener noreferrer" className="text-[#0065A4] font-medium no-underline">SPEC.md</a> is normative. The <a href={NPM} target="_blank" rel="noopener noreferrer" className="text-[#0065A4] font-medium no-underline">published package</a> is the MIT-licensed reference implementation, built on the same <a href="/docs/audit" className="text-[#0065A4] font-medium no-underline">audit pipeline</a> used to inspect a BitGraph bundle by hand. A conforming Player in any language must reach the same verdict from the same rule and the same evidence.
      </p>
    </div>
  );
}
