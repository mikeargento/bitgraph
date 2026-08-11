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
      <p style={{ color: "#4b5563", fontSize: 18, margin: "0 0 24px" }}>
        A Programmable Layer for BitGraph
      </p>
      <p style={{ color: "#4b5563", marginBottom: 32 }}>
        BitGraph records. Player executes. A recording establishes that these bytes existed at this causal position; Player evaluates a rule over a set of recordings and produces a verdict. The verdict is a plain file anyone can reproduce from the same rule and the same bundle, on their own machine, offline: no network, no clock, no account, and no trust in whoever ran it first.
      </p>

      <h2>What a Player is</h2>
      <p>
        A rule names the artifacts it cares about and states a claim about their causal order: the delivery was recorded after the purchase order, the approval after the delivery, no cancellation before the approval. Player checks that claim against the recordings in a proof bundle and writes a verdict that shows its work, step by step, with the evidence each step rests on.
      </p>
      <p>
        The shape mirrors Ethereum&apos;s: BitGraph is the substrate that records, Player is the machine that executes over it. One difference is deliberate and worth stating plainly: the EVM&apos;s value is that everyone agrees on execution, Player&apos;s is that anyone can re-run it. Player decides; it does not enforce. No field of a rule can cause an action, and whatever pays an invoice on a TRUE sits above it.
      </p>

      <h2>A rule</h2>
      <div className="code-block">
        <div className="code-block-header">rule.json</div>
        <pre>{RULE_EXAMPLE}</pre>
      </div>
      <p>
        The file has two halves, and the split is the trust boundary. <code>cast</code> is everything taken on the rule author&apos;s word: which digest means what, which occurrence is intended, who is said to have signed it. <code>claim</code> is only what BitGraph derives from the recordings themselves. The verdict keeps the two apart, so a reader always knows which facts the ledger established and which a person asserted.
      </p>
      <p>
        Two declarations are mandatory. <code>world: &quot;closed&quot;</code> scopes every negative to the declared cast: &quot;no cancellation before approval&quot; means no cancellation <em>among the roles the author named</em>, and the verdict says so. <code>requires.ordering</code> is the rule&apos;s trust floor, the weakest ordering evidence it will accept: <code>hash-linked</code> for evidence resting on hash links alone, or <code>assumption-dependent</code> to also accept counter order and Ethereum anchor bounds. It has no default. A rule that does not state its floor does not parse, because the floor is the rule&apos;s own security policy.
      </p>

      <h2>Three answers, not two</h2>
      <p>
        Every claim evaluates to <code>TRUE</code>, <code>FALSE</code>, or <code>UNDETERMINED</code>. Undetermined is the honest answer wherever the evidence does not decide: recordings whose order the ledger does not establish, a digest recorded more than once with nothing selecting the occurrence, evidence below the rule&apos;s declared floor. A two-valued evaluator would have to launder those into one of the answers it does have, and it would be wrong on some input. Player refuses on exactly those inputs, and the verdict states which evidence was missing.
      </p>

      <h2>Run it</h2>
      <p>With Node.js installed, evaluate a rule against a bundle: a directory, <code>.tar</code>, or <code>.tar.gz</code> of BitGraph exports, such as the folders the BitGraph Folder writes.</p>
      <div className="code-block">
        <div className="code-block-header">Shell</div>
        <pre>{`npx @mikeargento/bitgraph-player rule.json bundle/ > verdict.json`}</pre>
      </div>
      <p>To start a rule from the files themselves, <code>init</code> hashes them and writes a skeleton with the cast filled in. It leaves <code>requires.ordering</code> unset, because the trust floor is the author&apos;s decision and the tool must not make it:</p>
      <div className="code-block">
        <div className="code-block-header">Shell</div>
        <pre>{`npx @mikeargento/bitgraph-player init po.pdf delivery.jpg approval.pdf --out rule.json`}</pre>
      </div>
      <p>The exit code is the verdict&apos;s summary, so a script can gate on it directly:</p>
      <table>
        <thead><tr><th>Code</th><th>Meaning</th></tr></thead>
        <tbody>
          <tr><td>0</td><td><code>TRUE</code>: the evidence supports the claim at or above the declared floor</td></tr>
          <tr><td>1</td><td><code>FALSE</code>: the evidence refutes the claim</td></tr>
          <tr><td>2</td><td><code>UNDETERMINED</code>: the evidence does not decide</td></tr>
          <tr><td>3</td><td>Error: bad rule file, unreadable bundle, usage</td></tr>
        </tbody>
      </table>

      <h2>Same bundle, same bytes</h2>
      <p>
        Two runs of the same rule bytes over the same bundle contents produce byte-identical verdicts, on any machine, at any later time. The verdict carries no timestamp, no filesystem path, and nothing machine-local; every ordering answer names the evidence it rests on and whether that evidence depends on an assumption. Auditing a decision stops being a matter of reading a report someone wrote and becomes replaying the decision yourself.
      </p>
      <p>
        The semantics are specified precisely enough to reimplement: <a href={`${GITHUB}/blob/main/packages/player/SPEC.md`} target="_blank" rel="noopener noreferrer" className="text-[#0065A4] font-medium no-underline">SPEC.md</a> is normative, and the <a href={NPM} target="_blank" rel="noopener noreferrer" className="text-[#0065A4] font-medium no-underline">published package</a> is the MIT-licensed reference implementation, built on the same <a href="/docs/audit" className="text-[#0065A4] font-medium no-underline">audit pipeline</a> that walks you through a bundle by hand. A conforming Player in any language must reach the same verdict from the same rule and evidence.
      </p>
    </div>
  );
}
